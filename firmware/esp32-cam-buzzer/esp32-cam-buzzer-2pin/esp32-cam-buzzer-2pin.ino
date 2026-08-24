/*
 * Fibott — ESP32-CAM Firmware (2-Pin Buzzer Variant)
 *
 * Board:    AI Thinker ESP32-CAM  (Arduino IDE → Tools → Board)
 * PSRAM:    Tools → PSRAM → "OPI PSRAM"  (required)
 * Flash:    micro-USB via onboard CH340C or FTDI programmer
 *
 * Required Libraries:
 *   - ArduinoJson ≥ 7.0 (by Benoit Blanchon)
 *
 * Hardware Wiring (2-Pin Buzzer):
 *   - Buzzer (+) Positive / Signal Lead → GPIO14
 *   - Buzzer (-) Negative / Ground Lead → GND
 *   - Servo Signal Line               → GPIO13
 *   - Status LED                      → GPIO33 (onboard red LED)
 *
 * Supports both Active 2-Pin Buzzers (direct ON/OFF) and Passive 2-Pin Buzzers
 * (PWM frequency generation for pitch variations). Select your mode in config.h.
 */

#include "config.h"
#include "esp_camera.h"
#include "driver/ledc.h"
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>

// ── OV2640 Pin Mapping (AI-Thinker ESP32-CAM) ───────────────────────────────
#define CAM_PWDN   32
#define CAM_RESET  -1
#define CAM_XCLK    0
#define CAM_SIOD   26
#define CAM_SIOC   27
#define CAM_D7     35
#define CAM_D6     34
#define CAM_D5     39
#define CAM_D4     36
#define CAM_D3     21
#define CAM_D2     19
#define CAM_D1     18
#define CAM_D0      5
#define CAM_VSYNC  25
#define CAM_HREF   23
#define CAM_PCLK   22

// ── Kiosk Finite State Machine ────────────────────────────────────────────────
enum KioskState { STATE_IDLE, STATE_READY, STATE_PROCESSING, STATE_SUCCESS, STATE_ERROR };
static KioskState state = STATE_IDLE;
static char activeSessionId[128] = "";

// ── Servo Control (LEDC Timer 0 / Channel 0) ─────────────────────────────────
static void servoSetup() {
  ledc_timer_config_t tc = {};
  tc.speed_mode      = LEDC_LOW_SPEED_MODE;
  tc.duty_resolution = LEDC_TIMER_16_BIT;
  tc.timer_num       = LEDC_TIMER_0;
  tc.freq_hz         = 50;
  tc.clk_cfg         = LEDC_AUTO_CLK;
  ledc_timer_config(&tc);

  ledc_channel_config_t cc = {};
  cc.gpio_num   = PIN_SERVO;
  cc.speed_mode = LEDC_LOW_SPEED_MODE;
  cc.channel    = LEDC_CHANNEL_0;
  cc.intr_type  = LEDC_INTR_DISABLE;
  cc.timer_sel  = LEDC_TIMER_0;
  cc.duty       = 0;
  cc.hpoint     = 0;
  ledc_channel_config(&cc);
}

static void servoWrite(uint32_t us) {
  uint32_t duty = (uint32_t)((uint64_t)us * 65536 / 20000);
  ledc_set_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_0, duty);
  ledc_update_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_0);
}

static void gateClose() { servoWrite(SERVO_CLOSED_US); }
static void gateOpen()  { servoWrite(SERVO_OPEN_US);   }

// ── 2-Pin Buzzer Driver (Supports Active and Passive Piezo Elements) ─────────
#if BUZZER_MODE == BUZZER_TYPE_PASSIVE
static void buzzerPwmSetup() {
  ledc_timer_config_t tc = {};
  tc.speed_mode      = LEDC_LOW_SPEED_MODE;
  tc.duty_resolution = LEDC_TIMER_10_BIT;
  tc.timer_num       = LEDC_TIMER_1;
  tc.freq_hz         = 2000;
  tc.clk_cfg         = LEDC_AUTO_CLK;
  ledc_timer_config(&tc);

  ledc_channel_config_t cc = {};
  cc.gpio_num   = PIN_BUZZER;
  cc.speed_mode = LEDC_LOW_SPEED_MODE;
  cc.channel    = LEDC_CHANNEL_1;
  cc.intr_type  = LEDC_INTR_DISABLE;
  cc.timer_sel  = LEDC_TIMER_1;
  cc.duty       = 0;
  cc.hpoint     = 0;
  ledc_channel_config(&cc);
}

static void buzzerTone(uint32_t freqHz) {
  if (freqHz == 0) {
    ledc_set_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_1, 0);
    ledc_update_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_1);
    return;
  }
  ledc_set_freq(LEDC_LOW_SPEED_MODE, LEDC_TIMER_1, freqHz);
  ledc_set_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_1, 512); // 50% duty
  ledc_update_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_1);
}

static void buzzerNoTone() {
  ledc_set_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_1, 0);
  ledc_update_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_1);
}
#endif

static void buzzerSetup() {
  pinMode(PIN_BUZZER, OUTPUT);
#if BUZZER_MODE == BUZZER_TYPE_PASSIVE
  buzzerPwmSetup();
  buzzerNoTone();
#else
  digitalWrite(PIN_BUZZER, LOW);
#endif
}

static void playBeep(int n, int onMs = 200, int gapMs = 150, uint32_t freqHz = TONE_BOOT_HZ) {
  for (int i = 0; i < n; i++) {
#if BUZZER_MODE == BUZZER_TYPE_PASSIVE
    buzzerTone(freqHz);
    delay(onMs);
    buzzerNoTone();
#else
    digitalWrite(PIN_BUZZER, HIGH);
    delay(onMs);
    digitalWrite(PIN_BUZZER, LOW);
#endif
    if (i < n - 1) delay(gapMs);
  }
}

// ── Onboard Status LED (GPIO33, Active-LOW) ──────────────────────────────────
static void ledOn()  { digitalWrite(PIN_LED_STATUS, LOW);  }
static void ledOff() { digitalWrite(PIN_LED_STATUS, HIGH); }

// ── Camera Initialization ─────────────────────────────────────────────────────
static bool cameraInit() {
  camera_config_t cfg = {};
  cfg.ledc_channel = LEDC_CHANNEL_2;
  cfg.ledc_timer   = LEDC_TIMER_2;
  cfg.pin_d0       = CAM_D0;
  cfg.pin_d1       = CAM_D1;
  cfg.pin_d2       = CAM_D2;
  cfg.pin_d3       = CAM_D3;
  cfg.pin_d4       = CAM_D4;
  cfg.pin_d5       = CAM_D5;
  cfg.pin_d6       = CAM_D6;
  cfg.pin_d7       = CAM_D7;
  cfg.pin_xclk     = CAM_XCLK;
  cfg.pin_pclk     = CAM_PCLK;
  cfg.pin_vsync    = CAM_VSYNC;
  cfg.pin_href     = CAM_HREF;
  cfg.pin_sccb_sda = CAM_SIOD;
  cfg.pin_sccb_scl = CAM_SIOC;
  cfg.pin_pwdn     = CAM_PWDN;
  cfg.pin_reset    = CAM_RESET;
  cfg.xclk_freq_hz = 20000000;
  cfg.pixel_format = PIXFORMAT_JPEG;
  cfg.frame_size   = FRAMESIZE_VGA;
  cfg.jpeg_quality = 12;
  cfg.fb_count     = 1;
  cfg.fb_location  = CAMERA_FB_IN_PSRAM;
  cfg.grab_mode    = CAMERA_GRAB_LATEST;

  if (esp_camera_init(&cfg) != ESP_OK) return false;

  sensor_t *s = esp_camera_sensor_get();
  s->set_brightness(s, 1);
  s->set_saturation(s, -1);
  return true;
}

// ── Telemetry Logging ─────────────────────────────────────────────────────────
static void sendLog(const char* level, const char* tag, const char* message, const char* details = nullptr) {
  if (WiFi.status() != WL_CONNECTED) return;
  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(BACKEND_TIMEOUT_S);
  if (!client.connect(BACKEND_HOST, BACKEND_PORT)) return;

  JsonDocument doc;
  doc["level"] = level;
  doc["tag"] = tag;
  doc["message"] = message;
  if (details) doc["details"] = details;

  String body;
  serializeJson(doc, body);

  client.printf("POST %s HTTP/1.1\r\n", PATH_LOGS);
  client.printf("Host: %s\r\n", BACKEND_HOST);
  client.printf("x-device-api-key: %s\r\n", DEVICE_API_KEY);
  client.printf("Content-Type: application/json\r\n");
  client.printf("Content-Length: %u\r\n", (unsigned)body.length());
  client.printf("Connection: close\r\n\r\n");
  client.print(body);
  client.flush();
  client.stop();
}

// ── Session Polling ───────────────────────────────────────────────────────────
static bool pollSession(char *outSessionId, size_t maxLen) {
  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(BACKEND_TIMEOUT_S);

  if (!client.connect(BACKEND_HOST, BACKEND_PORT)) {
    Serial.println("[poll] Connect failed");
    return false;
  }

  client.printf("GET /api/kiosk/session HTTP/1.1\r\n");
  client.printf("Host: %s\r\n", BACKEND_HOST);
  client.printf("x-device-api-key: %s\r\n", DEVICE_API_KEY);
  client.printf("Connection: close\r\n\r\n");
  client.flush();

  client.readStringUntil('\n'); // Consume status line

  while (client.connected()) {
    if (client.readStringUntil('\n') == "\r") break;
  }
  String body = client.readString();
  client.stop();

  int jStart = body.indexOf('{');
  int jEnd   = body.lastIndexOf('}');
  String jsonBody = (jStart >= 0 && jEnd > jStart) ? body.substring(jStart, jEnd + 1) : body;

  JsonDocument doc;
  if (deserializeJson(doc, jsonBody) != DeserializationError::Ok) return false;
  if (!doc["active"].as<bool>()) return false;

  const char *id = doc["sessionId"].as<const char *>();
  if (!id) return false;
  strncpy(outSessionId, id, maxLen - 1);
  outSessionId[maxLen - 1] = '\0';
  return true;
}

// ── Deposit Image Upload ──────────────────────────────────────────────────────
static String uploadImage(camera_fb_t *fb, const char *sessionId) {
  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(BACKEND_TIMEOUT_S);

  if (!client.connect(BACKEND_HOST, BACKEND_PORT)) return "";

  const char *boundary = "FibottBoundary42";

  String sessionPart;
  if (sessionId && strlen(sessionId) > 0) {
    sessionPart  = "--"; sessionPart += boundary; sessionPart += "\r\n";
    sessionPart += "Content-Disposition: form-data; name=\"sessionId\"\r\n\r\n";
    sessionPart += sessionId; sessionPart += "\r\n";
  }

  String imagePart;
  imagePart  = "--"; imagePart += boundary; imagePart += "\r\n";
  imagePart += "Content-Disposition: form-data; name=\"image\"; filename=\"frame.jpg\"\r\n";
  imagePart += "Content-Type: image/jpeg\r\n\r\n";

  String footer = "\r\n--"; footer += boundary; footer += "--\r\n";

  size_t contentLen = sessionPart.length() + imagePart.length() + fb->len + footer.length();

  client.printf("POST /api/device/deposit-image HTTP/1.1\r\n");
  client.printf("Host: %s\r\n", BACKEND_HOST);
  client.printf("x-device-api-key: %s\r\n", DEVICE_API_KEY);
  client.printf("Content-Type: multipart/form-data; boundary=%s\r\n", boundary);
  client.printf("Content-Length: %u\r\n", (unsigned)contentLen);
  client.printf("Connection: close\r\n\r\n");

  if (sessionPart.length()) client.print(sessionPart);
  client.print(imagePart);
  const size_t CHUNK = 4096;
  for (size_t off = 0; off < fb->len; off += CHUNK) {
    client.write(fb->buf + off, min(CHUNK, fb->len - off));
  }
  client.print(footer);
  client.flush();

  client.readStringUntil('\n');

  while (client.connected()) {
    if (client.readStringUntil('\n') == "\r") break;
  }
  String body = client.readString();
  client.stop();

  int jStart = body.indexOf('{');
  int jEnd   = body.lastIndexOf('}');
  String jsonBody = (jStart >= 0 && jEnd > jStart) ? body.substring(jStart, jEnd + 1) : body;

  JsonDocument doc;
  if (deserializeJson(doc, jsonBody) != DeserializationError::Ok) return "";
  return doc["servoAction"].as<String>();
}

// ── Wi-Fi Reconnection Watchdog ───────────────────────────────────────────────
static void ensureWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.print("[wifi] Reconnecting");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  unsigned long deadline = millis() + 15000;
  while (WiFi.status() != WL_CONNECTED && millis() < deadline) {
    delay(500); Serial.print(".");
  }
  Serial.println(WiFi.status() == WL_CONNECTED ? " OK" : " Failed");
}

// ── Setup ─────────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  Serial.println("\n[boot] Fibott ESP32-CAM (2-Pin Buzzer Firmware)");

  pinMode(PIN_LED_STATUS, OUTPUT);
  ledOff();

  buzzerSetup();
  servoSetup();
  gateClose();

  if (!cameraInit()) {
    Serial.println("[boot] FATAL: Camera initialization failed");
    while (true) { ledOn(); delay(200); ledOff(); delay(200); }
  }

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.printf("\n[wifi] Connected IP: %s\n", WiFi.localIP().toString().c_str());
  sendLog("INFO", "WIFI", "WiFi connected", WiFi.localIP().toString().c_str());

  ledOn(); delay(200); ledOff();
  playBeep(1, 80, 150, TONE_BOOT_HZ); // 1 short boot beep
  Serial.println("[boot] System ready");
  sendLog("INFO", "BOOT", "Fibott ESP32-CAM (2-Pin Buzzer) online");
}

// ── Main Loop (Finite State Machine) ──────────────────────────────────────────
void loop() {
  ensureWifi();

  switch (state) {

    case STATE_IDLE: {
      char sessionId[128] = "";
      if (!pollSession(sessionId, sizeof(sessionId))) {
        delay(POLL_INTERVAL_MS);
        break;
      }
      strncpy(activeSessionId, sessionId, sizeof(activeSessionId));
      Serial.printf("[fsm] IDLE → READY session=%s\n", activeSessionId);
      state = STATE_READY;
      break;
    }

    case STATE_READY: {
      Serial.println("[fsm] READY — user prompt");
      playBeep(1, 100, 150, TONE_READY_HZ);
      for (int i = 0; i < 6; i++) { ledOn(); delay(200); ledOff(); delay(200); }
      delay(2000);
      Serial.println("[fsm] Capturing image...");
      ledOn();
      state = STATE_PROCESSING;
      break;
    }

    case STATE_PROCESSING: {
      camera_fb_t *fb = esp_camera_fb_get();
      if (!fb) {
        Serial.println("[cam] Capture failed, retrying");
        ledOff();
        delay(POLL_INTERVAL_MS);
        break;
      }

      String action = uploadImage(fb, activeSessionId);
      esp_camera_fb_return(fb);
      ledOff();

      if (action == "ACCEPT") {
        Serial.println("[fsm] Deposit ACCEPTED");
        state = STATE_SUCCESS;
      } else if (action == "REJECT") {
        Serial.println("[fsm] Deposit REJECTED");
        playBeep(3, 120, 100, TONE_REJECT_HZ); // 3 rapid rejection beeps
        state = STATE_ERROR;
      } else {
        Serial.println("[fsm] Upload error");
        playBeep(1, 500, 150, TONE_ERROR_HZ); // 1 long error tone
        state = STATE_ERROR;
      }
      break;
    }

    case STATE_SUCCESS: {
      playBeep(1, 300, 150, TONE_ACCEPT_HZ); // Accept tone
      gateOpen();
      delay(GATE_OPEN_MS);
      gateClose();
      activeSessionId[0] = '\0';
      state = STATE_IDLE;
      break;
    }

    case STATE_ERROR: {
      char sessionId[128] = "";
      bool active = pollSession(sessionId, sizeof(sessionId)) && strcmp(sessionId, activeSessionId) == 0;
      if (active) {
        delay(RETRY_DELAY_MS);
        state = STATE_READY;
      } else {
        activeSessionId[0] = '\0';
        state = STATE_IDLE;
      }
      break;
    }
  }
}
