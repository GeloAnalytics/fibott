/*
 * Fibott — ESP32-CAM firmware  (Version 1)
 *
 * Board:    AI Thinker ESP32-CAM  (Arduino IDE → Tools → Board)
 * PSRAM:    Tools → PSRAM → "OPI PSRAM"  (required)
 * Flash:    micro-USB via the onboard CH340C — no FTDI adapter needed
 *
 * Libraries (Sketch → Include Library → Manage Libraries):
 *   - ArduinoJson  ≥ 7.0  (by Benoit Blanchon)
 *
 * Mobile-first: polls the backend for a session, captures an image, uploads
 * it, and drives the gate servo — no UART, no controller board required.
 *
 * Flow:
 *   1. Connect to WiFi
 *   2. Poll GET /api/device/session every POLL_INTERVAL_MS
 *   3. When a session is found: capture → upload → drive servo → repeat
 *
 * ── GPIO assignments ───────────────────────────────────────────────────────
 *  GPIO13  Servo signal (safe, not a strapping pin)
 *  GPIO33  Onboard red status LED, active-LOW
 *
 * See hardware/README.md for full pinout and wiring detail.
 * See docs/SYSTEM.md for the active architecture.
 */

#include "config.h"
#include "esp_camera.h"
#include "driver/ledc.h"
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>

// ── OV2640 pin map (AI-Thinker ESP32-CAM) ────────────────────────────────────
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

// ── Servo (esp-idf ledc, TIMER_0/CHANNEL_0 — camera uses TIMER_2/CHANNEL_2) ─
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

// ── Status LED (GPIO33, active-LOW) ──────────────────────────────────────────
static void ledOn()  { digitalWrite(PIN_LED_STATUS, LOW);  }
static void ledOff() { digitalWrite(PIN_LED_STATUS, HIGH); }

// ── Camera init ───────────────────────────────────────────────────────────────
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
  cfg.frame_size   = FRAMESIZE_VGA;   // 640×480
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

// ── Session polling ───────────────────────────────────────────────────────────
// Returns the 6-digit session code if a session is ready, or "" if none/error.
static String pollSession() {
  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(BACKEND_TIMEOUT_S);

  if (!client.connect(BACKEND_HOST, BACKEND_PORT)) {
    Serial.println("[poll] connect failed");
    return "";
  }

  client.printf("GET /api/device/session HTTP/1.1\r\n");
  client.printf("Host: %s\r\n", BACKEND_HOST);
  client.printf("x-device-api-key: %s\r\n", DEVICE_API_KEY);
  client.printf("Connection: close\r\n\r\n");
  client.flush();

  String statusLine = client.readStringUntil('\n');
  int statusCode = 0;
  if (statusLine.startsWith("HTTP/1."))
    statusCode = statusLine.substring(9, 12).toInt();
  while (client.connected()) {
    if (client.readStringUntil('\n') == "\r") break;
  }
  String body = client.readString();
  client.stop();

  if (statusCode != 200) return "";

  JsonDocument doc;
  if (deserializeJson(doc, body) != DeserializationError::Ok) return "";
  if (!doc["active"].as<bool>()) return "";

  return doc["sessionCode"].as<String>();
}

// ── Image upload ──────────────────────────────────────────────────────────────
// Uploads the captured frame with the session code.
// Returns "ACCEPT", "REJECT", or "" on any error.
static String uploadImage(camera_fb_t *fb, const char *sessionCode) {
  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(BACKEND_TIMEOUT_S);

  if (!client.connect(BACKEND_HOST, BACKEND_PORT)) {
    Serial.println("[http] connect failed");
    return "";
  }

  const char *boundary = "FibottBoundary42";

  String sessionPart;
  if (sessionCode && strlen(sessionCode) == 6) {
    sessionPart  = "--"; sessionPart += boundary; sessionPart += "\r\n";
    sessionPart += "Content-Disposition: form-data; name=\"sessionCode\"\r\n\r\n";
    sessionPart += sessionCode;
    sessionPart += "\r\n";
  }

  String imagePart;
  imagePart  = "--"; imagePart += boundary; imagePart += "\r\n";
  imagePart += "Content-Disposition: form-data; name=\"image\"; filename=\"frame.jpg\"\r\n";
  imagePart += "Content-Type: image/jpeg\r\n\r\n";

  String footer = "\r\n--";
  footer += boundary;
  footer += "--\r\n";

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
  for (size_t off = 0; off < fb->len; off += CHUNK)
    client.write(fb->buf + off, min(CHUNK, fb->len - off));
  client.print(footer);
  client.flush();

  String statusLine2 = client.readStringUntil('\n');
  int statusCode = 0;
  if (statusLine2.startsWith("HTTP/1."))
    statusCode = statusLine2.substring(9, 12).toInt();
  while (client.connected()) {
    if (client.readStringUntil('\n') == "\r") break;
  }
  String body = client.readString();
  client.stop();

  Serial.printf("[http] %d — %s\n", statusCode, body.c_str());
  if (statusCode != 200) return "";

  JsonDocument doc;
  if (deserializeJson(doc, body) != DeserializationError::Ok) return "";
  return doc["servoAction"].as<String>();
}

// ── WiFi watchdog ─────────────────────────────────────────────────────────────
static void ensureWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.print("[wifi] reconnecting");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  unsigned long deadline = millis() + 15000;
  while (WiFi.status() != WL_CONNECTED && millis() < deadline) {
    delay(500);
    Serial.print(".");
  }
  Serial.println(WiFi.status() == WL_CONNECTED ? " ok" : " failed");
}

// ── Setup ─────────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  Serial.println("\n[boot] Fibott ESP32-CAM");

  pinMode(PIN_LED_STATUS, OUTPUT);
  ledOff();

  servoSetup();
  gateClose();

  if (!cameraInit()) {
    Serial.println("[boot] FATAL: camera init failed");
    while (true) { ledOn(); delay(200); ledOff(); delay(200); }
  }

  Serial.printf("[wifi] connecting to %s", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.printf("\n[wifi] %s\n", WiFi.localIP().toString().c_str());

  ledOn(); delay(200); ledOff();
  Serial.println("[boot] ready — polling for sessions");
}

// ── Loop ──────────────────────────────────────────────────────────────────────
void loop() {
  ensureWifi();

  String code = pollSession();
  if (!code.length()) {
    delay(POLL_INTERVAL_MS);
    return;
  }

  Serial.printf("[session] active — code=%s\n", code.c_str());
  ledOn();

  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("[cam] capture failed");
    ledOff();
    delay(POLL_INTERVAL_MS);
    return;
  }
  Serial.printf("[cam] %u bytes\n", fb->len);

  String action = uploadImage(fb, code.c_str());
  esp_camera_fb_return(fb);
  ledOff();

  if (action == "ACCEPT") {
    Serial.println("[gate] ACCEPT — opening");
    gateOpen();
    delay(GATE_OPEN_MS);
    gateClose();
    Serial.println("[gate] closed");
  } else {
    Serial.println("[gate] REJECT — gate stays closed");
  }

  delay(POLL_INTERVAL_MS);
}
