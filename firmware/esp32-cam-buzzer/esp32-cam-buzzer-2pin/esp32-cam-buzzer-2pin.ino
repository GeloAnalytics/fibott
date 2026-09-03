/*
 * Fibott — ESP32-CAM Canonical Firmware (2-Pin Buzzer)
 *
 * ── This is the ONE and ONLY production firmware for the Fibott kiosk. ────────
 *
 * Board:    AI Thinker ESP32-CAM  (Arduino IDE → Tools → Board)
 * PSRAM:    Tools → PSRAM → "OPI PSRAM"  (REQUIRED — camera will not init without it)
 * Flash:    micro-USB via the onboard CH340C — no FTDI adapter needed
 * Upload:   Connect GPIO0 to GND during flash, disconnect and reset after upload
 *
 * Libraries required (Sketch → Include Library → Manage Libraries):
 *   - ArduinoJson  ≥ 7.0  (by Benoit Blanchon)
 *
 * ── Hardware Wiring ─────────────────────────────────────────────────────────────
 *   GPIO13  → Servo signal (SG90/MG90S gate actuator)
 *   GPIO14  → Buzzer (+) positive/signal lead
 *   GND     → Buzzer (-) negative/ground lead
 *   GPIO33  → Onboard red status LED (active-LOW, built into the module)
 *   5V/GND  → External 5V 2A+ power supply (camera + servo draw peak ~1.5A)
 *
 * ── Buzzer Mode ──────────────────────────────────────────────────────────────────
 *   Set BUZZER_MODE in config.h:
 *     BUZZER_TYPE_ACTIVE  = direct HIGH/LOW (active buzzer with internal oscillator)
 *     BUZZER_TYPE_PASSIVE = LEDC hardware PWM with pitch control (passive buzzer)
 *
 * ── Audible Feedback Protocol ────────────────────────────────────────────────────
 *   1 short beep  (80ms)   Boot complete
 *   1 mid beep   (100ms)   Session active / ready for deposit
 *   1 long tone  (300ms)   Deposit ACCEPTED (gate opens)
 *   3 rapid beeps(120ms×3) Deposit REJECTED
 *   1 long warn  (500ms)   Wi-Fi / upload / network error
 *
 * ── State Machine ────────────────────────────────────────────────────────────────
 *   IDLE       → poll /api/kiosk/session every POLL_INTERVAL_MS
 *   READY      → prompt beep + LED blink, then capture image
 *   PROCESSING → upload image → SUCCESS or ERROR
 *   SUCCESS    → open gate for GATE_OPEN_MS, then IDLE
 *   ERROR      → re-check session → READY (retry) or IDLE (expired)
 *
 * See docs/SYSTEM.md for the full architecture.
 */

#include "config.h"
#include "esp_camera.h"
#include "driver/ledc.h"
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>

// ── Serial diagnostic macros ──────────────────────────────────────────────────
// All Serial output uses these so you can search for a prefix in the monitor.
#define LOG(tag, msg)       Serial.printf("[%-8s] %s\n", tag, msg)
#define LOGF(tag, fmt, ...) Serial.printf("[%-8s] " fmt "\n", tag, ##__VA_ARGS__)

// ── OV2640 Camera Pin Map (AI-Thinker ESP32-CAM) ─────────────────────────────
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

// ── Kiosk FSM States ──────────────────────────────────────────────────────────
enum KioskState {
  STATE_IDLE,
  STATE_READY,
  STATE_PROCESSING,
  STATE_SUCCESS,
  STATE_ERROR
};
static KioskState state = STATE_IDLE;
static char activeSessionId[128] = "";

// Heartbeat and error counters
static unsigned long lastHeartbeatMs = 0;
static unsigned long lastWifiWarnMs  = 0;
static int uploadErrorCount = 0;

// ── Servo Control (LEDC Timer 0 / Channel 0) ─────────────────────────────────
// Camera uses Timer 2 / Channel 2, so Timer 0 is safe.
static void servoSetup() {
  LOGF("SERVO", "Initialising servo on GPIO%d (50 Hz, 16-bit)", PIN_SERVO);
  ledc_timer_config_t tc = {};
  tc.speed_mode      = LEDC_LOW_SPEED_MODE;
  tc.duty_resolution = LEDC_TIMER_16_BIT;
  tc.timer_num       = LEDC_TIMER_0;
  tc.freq_hz         = 50;
  tc.clk_cfg         = LEDC_AUTO_CLK;
  if (ledc_timer_config(&tc) != ESP_OK) {
    LOG("SERVO", "ERROR: Timer config failed");
  }

  ledc_channel_config_t cc = {};
  cc.gpio_num   = PIN_SERVO;
  cc.speed_mode = LEDC_LOW_SPEED_MODE;
  cc.channel    = LEDC_CHANNEL_0;
  cc.intr_type  = LEDC_INTR_DISABLE;
  cc.timer_sel  = LEDC_TIMER_0;
  cc.duty       = 0;
  cc.hpoint     = 0;
  if (ledc_channel_config(&cc) != ESP_OK) {
    LOG("SERVO", "ERROR: Channel config failed");
  }
}

static void servoWrite(uint32_t us) {
  uint32_t duty = (uint32_t)((uint64_t)us * 65536 / 20000);
  ledc_set_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_0, duty);
  ledc_update_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_0);
}

static void gateClose() {
  LOGF("GATE", "Closing gate (servo %u µs)", SERVO_CLOSED_US);
  servoWrite(SERVO_CLOSED_US);
}
static void gateOpen()  {
  LOGF("GATE", "Opening gate (servo %u µs)", SERVO_OPEN_US);
  servoWrite(SERVO_OPEN_US);
}

// ── 2-Pin Buzzer Driver ───────────────────────────────────────────────────────
#if BUZZER_MODE == BUZZER_TYPE_PASSIVE
static void buzzerPwmSetup() {
  LOGF("BUZZER", "Passive PWM mode — GPIO%d, LEDC Timer1/Channel1", PIN_BUZZER);
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
#endif // BUZZER_TYPE_PASSIVE

static void buzzerSetup() {
  pinMode(PIN_BUZZER, OUTPUT);
#if BUZZER_MODE == BUZZER_TYPE_PASSIVE
  buzzerPwmSetup();
  buzzerNoTone();
  LOG("BUZZER", "Passive PWM buzzer ready");
#else
  digitalWrite(PIN_BUZZER, LOW);
  LOG("BUZZER", "Active buzzer ready (direct ON/OFF)");
#endif
}

// n     = number of beeps
// onMs  = beep on duration in ms
// gapMs = silence between beeps in ms
// freqHz= tone frequency (passive mode only; ignored in active mode)
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

// ── Status LED (GPIO33, Active-LOW) ──────────────────────────────────────────
static void ledOn()  { digitalWrite(PIN_LED_STATUS, LOW);  }
static void ledOff() { digitalWrite(PIN_LED_STATUS, HIGH); }

// ── Camera Initialization ─────────────────────────────────────────────────────
static bool cameraInit() {
  LOG("CAMERA", "Initialising OV2640...");
  LOG("CAMERA", "PSRAM must be enabled (OPI PSRAM in Arduino IDE tools)");

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
  cfg.frame_size   = FRAMESIZE_VGA;  // 640×480
  cfg.jpeg_quality = 12;             // 0 = best, 63 = worst; 12 is a good balance
  cfg.fb_count     = 1;
  cfg.fb_location  = CAMERA_FB_IN_PSRAM;
  cfg.grab_mode    = CAMERA_GRAB_LATEST;

  esp_err_t err = esp_camera_init(&cfg);
  if (err != ESP_OK) {
    LOGF("CAMERA", "FATAL: esp_camera_init failed (err=0x%x)", err);
    LOGF("CAMERA", "Common causes:");
    LOG("CAMERA",  "  1) PSRAM not enabled in Arduino IDE (Tools → PSRAM → OPI PSRAM)");
    LOG("CAMERA",  "  2) Loose camera ribbon cable — reseat it");
    LOG("CAMERA",  "  3) Power supply too weak — use 5V 2A+");
    LOG("CAMERA",  "  4) Camera module physically damaged");
    return false;
  }

  sensor_t *s = esp_camera_sensor_get();
  if (!s) {
    LOG("CAMERA", "ERROR: esp_camera_sensor_get() returned NULL after init");
    return false;
  }
  s->set_brightness(s,  1);  // Slight brightness boost for indoor lighting
  s->set_saturation(s, -1);  // Slightly reduced saturation

  LOG("CAMERA", "OV2640 ready — VGA JPEG, PSRAM frame buffer");
  return true;
}

// ── Telemetry: Send Log to Backend Admin Panel ────────────────────────────────
// This sends structured logs to /api/device/logs which appear in the admin
// System & Hardware Logs view in real-time.
//
// level  : "INFO" | "WARN" | "ERROR"
// tag    : short uppercase category, e.g. "BOOT", "WIFI", "CAMERA", "UPLOAD"
// message: human-readable description
// details: optional extra data (IP address, error code, etc.)
static void sendLog(const char* level, const char* tag, const char* message, const char* details = nullptr) {
  if (WiFi.status() != WL_CONNECTED) {
    LOGF("TELEMETRY", "SKIP log (no WiFi) — [%s] %s", tag, message);
    return;
  }

  WiFiClientSecure client;
  client.setInsecure();  // Skip cert verify — Vercel uses valid Let's Encrypt certs
  client.setTimeout(8);  // Short timeout; don't block the FSM

  if (!client.connect(BACKEND_HOST, BACKEND_PORT)) {
    LOGF("TELEMETRY", "ERROR: Could not connect to %s:%d for log", BACKEND_HOST, BACKEND_PORT);
    return;
  }

  JsonDocument doc;
  doc["level"]   = level;
  doc["tag"]     = tag;
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

  // Read HTTP status line (don't block long; just drain)
  String statusLine = client.readStringUntil('\n');
  LOGF("TELEMETRY", "Log sent [%s/%s]: %s | HTTP: %s", level, tag, message, statusLine.c_str());
  client.stop();
}

// ── Session Polling ───────────────────────────────────────────────────────────
// Returns true and fills outSessionId if an ACTIVE session exists on the server.
static bool pollSession(char *outSessionId, size_t maxLen) {
  if (WiFi.status() != WL_CONNECTED) {
    LOG("POLL", "SKIP — WiFi not connected");
    return false;
  }

  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(BACKEND_TIMEOUT_MS);  // milliseconds — see config.h

  LOGF("POLL", "Connecting to %s:%d ...", BACKEND_HOST, BACKEND_PORT);
  if (!client.connect(BACKEND_HOST, BACKEND_PORT)) {
    LOG("POLL", "ERROR: TCP connect failed — check WiFi / DNS / Vercel reachability");
    return false;
  }

  client.printf("GET /api/kiosk/session HTTP/1.1\r\n");
  client.printf("Host: %s\r\n", BACKEND_HOST);
  client.printf("x-device-api-key: %s\r\n", DEVICE_API_KEY);
  client.printf("Connection: close\r\n\r\n");
  client.flush();

  // Read status line
  String statusLine = client.readStringUntil('\n');
  LOGF("POLL", "HTTP Status: %s", statusLine.c_str());

  // Check for 401 — device API key rejected
  if (statusLine.indexOf("401") >= 0) {
    LOG("POLL", "ERROR: 401 Unauthorized — DEVICE_API_KEY in config.h is invalid or device is INACTIVE in DB");
    client.stop();
    return false;
  }

  // Drain HTTP headers
  while (client.connected()) {
    String line = client.readStringUntil('\n');
    if (line == "\r") break;
  }
  String body = client.readString();
  client.stop();

  // Strip chunked-encoding prefix if present (e.g. "83\r\n{...}\r\n0")
  int jStart = body.indexOf('{');
  int jEnd   = body.lastIndexOf('}');
  String jsonBody = (jStart >= 0 && jEnd > jStart)
                    ? body.substring(jStart, jEnd + 1)
                    : body;

  LOGF("POLL", "Response body: %s", jsonBody.c_str());

  JsonDocument doc;
  DeserializationError derr = deserializeJson(doc, jsonBody);
  if (derr != DeserializationError::Ok) {
    LOGF("POLL", "ERROR: JSON parse failed (%s) — raw body: %s", derr.c_str(), jsonBody.c_str());
    return false;
  }

  if (!doc["active"].as<bool>()) {
    LOG("POLL", "No active session found");
    return false;
  }

  const char *id = doc["sessionId"].as<const char *>();
  if (!id || strlen(id) == 0) {
    LOG("POLL", "ERROR: active=true but sessionId is missing or empty");
    return false;
  }

  strncpy(outSessionId, id, maxLen - 1);
  outSessionId[maxLen - 1] = '\0';
  LOGF("POLL", "Active session found: %s", outSessionId);
  return true;
}

// ── Image Capture ─────────────────────────────────────────────────────────────
// Returns a camera frame buffer, or NULL on failure (with verbose diagnostics).
static camera_fb_t* captureImage() {
  LOG("CAMERA", "Capturing frame from OV2640...");
  camera_fb_t *fb = esp_camera_fb_get();

  if (!fb) {
    LOG("CAMERA", "ERROR: esp_camera_fb_get() returned NULL");
    LOG("CAMERA", "  Possible causes:");
    LOG("CAMERA", "  1) Camera ribbon cable loose — reseat it");
    LOG("CAMERA", "  2) PSRAM exhausted — check for memory leaks (fb_return always called?)");
    LOG("CAMERA", "  3) Camera brownout — check 5V 2A+ power supply");
    LOG("CAMERA", "  4) OV2640 needs reinitialisation — consider restart");
    return nullptr;
  }

  LOGF("CAMERA", "Frame captured: %u bytes (%ux%u)", fb->len, fb->width, fb->height);
  if (fb->len < 1000) {
    LOG("CAMERA", "WARN: Frame is very small (<1KB) — may be a blank/corrupted JPEG");
    LOG("CAMERA", "  Check lighting conditions and camera ribbon cable");
  }
  return fb;
}

// ── Image Upload ──────────────────────────────────────────────────────────────
// Posts the JPEG to /api/device/deposit-image.
// Returns "ACCEPT", "REJECT", or "" on any network/server error.
static String uploadImage(camera_fb_t *fb, const char *sessionId) {
  if (WiFi.status() != WL_CONNECTED) {
    LOG("UPLOAD", "ERROR: Cannot upload — WiFi not connected");
    return "";
  }

  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(BACKEND_TIMEOUT_MS);  // milliseconds — see config.h

  LOGF("UPLOAD", "Connecting to %s:%d for image upload...", BACKEND_HOST, BACKEND_PORT);
  if (!client.connect(BACKEND_HOST, BACKEND_PORT)) {
    LOG("UPLOAD", "ERROR: TCP connect failed for image upload");
    LOG("UPLOAD", "  Check: WiFi signal strength, Vercel endpoint reachability");
    return "";
  }

  const char *boundary = "FibottBoundary42";

  // Build multipart session ID field
  String sessionPart;
  if (sessionId && strlen(sessionId) > 0) {
    sessionPart  = "--"; sessionPart += boundary; sessionPart += "\r\n";
    sessionPart += "Content-Disposition: form-data; name=\"sessionId\"\r\n\r\n";
    sessionPart += sessionId; sessionPart += "\r\n";
  }

  // Build image part header
  String imagePart;
  imagePart  = "--"; imagePart += boundary; imagePart += "\r\n";
  imagePart += "Content-Disposition: form-data; name=\"image\"; filename=\"frame.jpg\"\r\n";
  imagePart += "Content-Type: image/jpeg\r\n\r\n";

  String footer = "\r\n--"; footer += boundary; footer += "--\r\n";

  size_t contentLen = sessionPart.length() + imagePart.length() + fb->len + footer.length();

  LOGF("UPLOAD", "Uploading %u bytes (sessionId=%s)", (unsigned)contentLen, sessionId ? sessionId : "none");

  client.printf("POST /api/device/deposit-image HTTP/1.1\r\n");
  client.printf("Host: %s\r\n", BACKEND_HOST);
  client.printf("x-device-api-key: %s\r\n", DEVICE_API_KEY);
  client.printf("Content-Type: multipart/form-data; boundary=%s\r\n", boundary);
  client.printf("Content-Length: %u\r\n", (unsigned)contentLen);
  client.printf("Connection: close\r\n\r\n");

  if (sessionPart.length()) client.print(sessionPart);
  client.print(imagePart);

  // Stream image in 4KB chunks to avoid RAM overflow
  const size_t CHUNK = 4096;
  for (size_t off = 0; off < fb->len; off += CHUNK) {
    size_t toWrite = min(CHUNK, fb->len - off);
    client.write(fb->buf + off, toWrite);
  }
  client.print(footer);
  client.flush();

  // Read response
  String statusLine = client.readStringUntil('\n');
  LOGF("UPLOAD", "HTTP Status: %s", statusLine.c_str());

  if (statusLine.indexOf("401") >= 0) {
    LOG("UPLOAD", "ERROR: 401 Unauthorized — device API key rejected by backend");
    client.stop();
    return "";
  }
  if (statusLine.indexOf("413") >= 0) {
    LOG("UPLOAD", "ERROR: 413 Payload Too Large — reduce camera JPEG quality or frame size");
    client.stop();
    return "";
  }
  if (statusLine.indexOf("502") >= 0) {
    LOG("UPLOAD", "ERROR: 502 Bad Gateway — classifier service failed on the server side");
    client.stop();
    return "";
  }

  while (client.connected()) {
    if (client.readStringUntil('\n') == "\r") break;
  }
  String body = client.readString();
  client.stop();

  int jStart = body.indexOf('{');
  int jEnd   = body.lastIndexOf('}');
  String jsonBody = (jStart >= 0 && jEnd > jStart) ? body.substring(jStart, jEnd + 1) : body;

  LOGF("UPLOAD", "Response: %s", jsonBody.c_str());

  JsonDocument doc;
  DeserializationError derr = deserializeJson(doc, jsonBody);
  if (derr != DeserializationError::Ok) {
    LOGF("UPLOAD", "ERROR: JSON parse failed (%s)", derr.c_str());
    return "";
  }

  // Log classification result if available
  if (doc["classification"].is<JsonObject>()) {
    const char* label      = doc["classification"]["label"] | "unknown";
    float       confidence = doc["classification"]["confidence"] | 0.0f;
    const char* material   = doc["classification"]["materialType"] | "unknown";
    LOGF("UPLOAD", "Classification: label=%s material=%s confidence=%.2f", label, material, confidence);
  }

  String action = doc["servoAction"].as<String>();
  LOGF("UPLOAD", "Server decision: servoAction=%s", action.c_str());
  return action;
}

// ── WiFi Reconnection Watchdog ────────────────────────────────────────────────
static void ensureWifi() {
  if (WiFi.status() == WL_CONNECTED) return;

  // Rate-limit the WARN log to once every 30 seconds
  unsigned long now = millis();
  if (now - lastWifiWarnMs > 30000) {
    LOG("WIFI", "WARN: WiFi connection lost — attempting reconnect...");
    lastWifiWarnMs = now;
  }

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  unsigned long deadline = millis() + 15000;
  int dots = 0;
  while (WiFi.status() != WL_CONNECTED && millis() < deadline) {
    delay(500);
    Serial.print(".");
    if (++dots % 20 == 0) Serial.println();
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    LOGF("WIFI", "Reconnected — IP: %s", WiFi.localIP().toString().c_str());
    sendLog("WARN", "WIFI", "WiFi reconnected after dropout", WiFi.localIP().toString().c_str());
  } else {
    LOG("WIFI", "ERROR: Reconnection timed out (15s) — will retry next loop");
    sendLog("ERROR", "WIFI", "WiFi reconnection failed — kiosk offline");
  }
}

// ── Periodic Heartbeat ────────────────────────────────────────────────────────
// Sends a lightweight INFO ping every HEARTBEAT_INTERVAL_MS while in IDLE.
// This updates Device.lastSeenAt on the server so the admin panel can show
// "last seen X minutes ago" for each device.
static void maybeHeartbeat() {
  unsigned long now = millis();
  if (now - lastHeartbeatMs < HEARTBEAT_INTERVAL_MS) return;
  lastHeartbeatMs = now;

  char details[64];
  snprintf(details, sizeof(details), "heap=%u state=IDLE v=%s", ESP.getFreeHeap(), FIRMWARE_VERSION);
  LOGF("HEARTBT", "Sending heartbeat — %s", details);
  sendLog("INFO", "HEARTBEAT", "Kiosk online and idle", details);
}

// ── Setup ─────────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(200);  // Let serial settle

  Serial.println("\n");
  Serial.println("╔══════════════════════════════════════════════════╗");
  Serial.println("║       Fibott ESP32-CAM Kiosk Controller          ║");
  Serial.printf( "║  Firmware v%-38s║\n", FIRMWARE_VERSION);
  Serial.println("║  2-Pin Buzzer | Servo Gate | OV2640 Camera       ║");
  Serial.println("╚══════════════════════════════════════════════════╝");
  Serial.println();

  // ── GPIO setup ───────────────────────────────────────────────────────
  LOG("BOOT", "Configuring GPIO pins...");
  pinMode(PIN_LED_STATUS, OUTPUT);
  ledOff();
  LOG("BOOT", "  LED GPIO33 (status LED, active-LOW) — OK");

  // ── Buzzer ───────────────────────────────────────────────────────────
  buzzerSetup();

  // ── Servo ────────────────────────────────────────────────────────────
  servoSetup();
  gateClose();
  LOG("BOOT", "Gate closed (servo at rest position)");
  delay(300);  // Allow servo to reach position before camera init

  // ── Camera ───────────────────────────────────────────────────────────
  LOG("BOOT", "Starting camera...");
  if (!cameraInit()) {
    LOG("BOOT", "═══════════════════════════════════════════════════");
    LOG("BOOT", "FATAL: Camera failed to initialise — entering halt loop");
    LOG("BOOT", "The LED will blink rapidly. Check serial output above");
    LOG("BOOT", "for specific failure diagnostics.");
    LOG("BOOT", "═══════════════════════════════════════════════════");
    // Rapid LED blink to indicate fatal camera failure
    while (true) {
      ledOn();  delay(100);
      ledOff(); delay(100);
    }
  }

  // ── WiFi ─────────────────────────────────────────────────────────────
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.setSleep(false);  // Disable Wi-Fi modem sleep for 10x lower packet latency

  LOGF("WIFI", "Connecting to SSID: %s ...", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long wifiDeadline = millis() + 20000;
  int dots = 0;
  while (WiFi.status() != WL_CONNECTED && millis() < wifiDeadline) {
    delay(500);
    Serial.print(".");
    if (++dots % 20 == 0) Serial.println();
  }
  Serial.println();

  if (WiFi.status() != WL_CONNECTED) {
    LOG("WIFI", "ERROR: Could not connect to WiFi within 20 seconds!");
    LOGF("WIFI", "  SSID   : %s", WIFI_SSID);
    LOG("WIFI",  "  Check  : SSID/password in config.h, router reachability, 2.4GHz band");
    LOG("WIFI",  "  Device will continue and retry WiFi in the main loop...");
    // Don't halt — we'll retry via ensureWifi() in the main loop
  } else {
    LOGF("WIFI", "Connected! IP: %s  RSSI: %d dBm", WiFi.localIP().toString().c_str(), WiFi.RSSI());
  }

  // ── Backend connectivity check ────────────────────────────────────────
  if (WiFi.status() == WL_CONNECTED) {
    LOGF("BOOT", "Backend: %s:%d", BACKEND_HOST, BACKEND_PORT);
    LOGF("BOOT", "API Key prefix: %.19s...", DEVICE_API_KEY);

    // Send boot log to admin panel
    char bootDetails[128];
    snprintf(bootDetails, sizeof(bootDetails),
             "ip=%s rssi=%d heap=%u v=%s",
             WiFi.localIP().toString().c_str(), WiFi.RSSI(), ESP.getFreeHeap(), FIRMWARE_VERSION);
    sendLog("INFO", "BOOT", "Fibott ESP32-CAM (2-Pin Buzzer) online and ready", bootDetails);
    sendLog("INFO", "WIFI", "WiFi connected at boot", WiFi.localIP().toString().c_str());
  }

  // ── Boot complete ─────────────────────────────────────────────────────
  ledOn(); delay(200); ledOff();
  playBeep(1, 80, 0, TONE_BOOT_HZ);  // 1 short boot beep

  LOG("BOOT", "═══════════════════════════════════════════════════");
  LOG("BOOT", "Boot complete — entering IDLE state");
  LOGF("BOOT", "Free heap: %u bytes", ESP.getFreeHeap());
  LOG("BOOT", "═══════════════════════════════════════════════════");
  LOG("BOOT", "Serial legend:");
  LOG("BOOT", "  [BOOT    ] — startup events");
  LOG("BOOT", "  [WIFI    ] — wifi connection events");
  LOG("BOOT", "  [POLL    ] — session polling to backend");
  LOG("BOOT", "  [CAMERA  ] — OV2640 capture events");
  LOG("BOOT", "  [UPLOAD  ] — image upload to backend");
  LOG("BOOT", "  [GATE    ] — servo gate open/close");
  LOG("BOOT", "  [FSM     ] — state machine transitions");
  LOG("BOOT", "  [HEARTBT ] — periodic health pings to admin");
  LOG("BOOT", "  [TELEMETRY] — log relay to admin panel");
  Serial.println();

  lastHeartbeatMs = millis();
}

// ── Main Loop (Finite State Machine) ─────────────────────────────────────────
void loop() {
  ensureWifi();

  switch (state) {

    // ── IDLE: Poll for an active kiosk session ──────────────────────────
    case STATE_IDLE: {
      maybeHeartbeat();

      char sessionId[128] = "";
      if (!pollSession(sessionId, sizeof(sessionId))) {
        delay(POLL_INTERVAL_MS);
        break;
      }

      strncpy(activeSessionId, sessionId, sizeof(activeSessionId));
      LOGF("FSM", "IDLE → READY  (session=%s)", activeSessionId);
      state = STATE_READY;
      break;
    }

    // ── READY: Alert user, wait for item, capture ───────────────────────
    case STATE_READY: {
      LOG("FSM", "READY — prompting user to place item");
      playBeep(1, 100, 0, TONE_READY_HZ);  // 1 mid prompt beep

      // Fast LED blink: "place item now"
      for (int i = 0; i < 2; i++) {
        ledOn();  delay(150);
        ledOff(); delay(150);
      }

      // 0.5s pause for positioning
      delay(500);

      LOG("FSM", "READY → PROCESSING (capturing image)");
      ledOn();  // LED stays on during capture/upload
      state = STATE_PROCESSING;
      break;
    }

    // ── PROCESSING: Capture frame and upload to backend ─────────────────
    case STATE_PROCESSING: {
      camera_fb_t *fb = captureImage();
      if (!fb) {
        LOG("FSM", "PROCESSING: Capture failed — retrying in 2s");
        ledOff();
        sendLog("ERROR", "CAMERA", "Frame capture failed in PROCESSING state",
                "esp_camera_fb_get() returned NULL — check ribbon cable and power");
        delay(POLL_INTERVAL_MS);
        // Stay in PROCESSING to retry capture
        break;
      }

      String action = uploadImage(fb, activeSessionId);
      esp_camera_fb_return(fb);  // CRITICAL: always return the frame buffer
      ledOff();

      if (action == "ACCEPT") {
        LOG("FSM", "PROCESSING → SUCCESS (deposit accepted by backend)");
        sendLog("INFO", "DEPOSIT", "Deposit accepted — opening gate", activeSessionId);
        state = STATE_SUCCESS;

      } else if (action == "REJECT") {
        LOG("FSM", "PROCESSING → ERROR (deposit rejected by backend classifier)");
        sendLog("INFO", "DEPOSIT", "Deposit rejected — item not recyclable", activeSessionId);
        playBeep(3, 120, 100, TONE_REJECT_HZ);  // 3 rapid rejection beeps
        state = STATE_ERROR;

      } else {
        // Empty string = network/server error
        uploadErrorCount++;
        LOGF("FSM", "PROCESSING → ERROR (upload failed — consecutive errors: %d)", uploadErrorCount);

        char errorDetails[128];
        snprintf(errorDetails, sizeof(errorDetails),
                 "sessionId=%s consecutiveErrors=%d heap=%u",
                 activeSessionId, uploadErrorCount, ESP.getFreeHeap());
        sendLog("ERROR", "UPLOAD", "Image upload failed — no response from backend", errorDetails);

        if (uploadErrorCount >= 3) {
          LOG("FSM", "WARN: 3+ consecutive upload failures — possible network or backend issue");
          sendLog("WARN", "UPLOAD",
                  "Repeated upload failures — check Vercel deployment and WiFi signal",
                  errorDetails);
        }
        playBeep(1, 500, 0, TONE_ERROR_HZ);  // 1 long error tone
        state = STATE_ERROR;
      }
      break;
    }

    // ── SUCCESS: Open gate, wait, close gate ────────────────────────────
    case STATE_SUCCESS: {
      LOG("FSM", "SUCCESS — opening gate");
      playBeep(1, 300, 0, TONE_ACCEPT_HZ);  // 1 long accept tone
      gateOpen();
      delay(GATE_OPEN_MS);
      gateClose();
      LOG("FSM", "SUCCESS — gate closed, resetting session");
      uploadErrorCount = 0;
      activeSessionId[0] = '\0';
      LOG("FSM", "SUCCESS → IDLE");
      state = STATE_IDLE;
      break;
    }

    // ── ERROR: Check if session still valid; retry or return to IDLE ────
    case STATE_ERROR: {
      LOG("FSM", "ERROR — checking if session is still active on server");
      char sessionId[128] = "";
      bool stillActive = pollSession(sessionId, sizeof(sessionId))
                         && strcmp(sessionId, activeSessionId) == 0;

      if (stillActive) {
        LOGF("FSM", "ERROR → READY (session %s still active, will retry)", activeSessionId);
        delay(RETRY_DELAY_MS);
        state = STATE_READY;
      } else {
        LOG("FSM", "ERROR → IDLE (session expired or cancelled by user)");
        activeSessionId[0] = '\0';
        uploadErrorCount = 0;
        state = STATE_IDLE;
      }
      break;
    }
  }
}
