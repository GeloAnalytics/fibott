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
 *   - "Chirale_TensorFlowLite" (Library Manager). NOT "Arduino_TensorFlowLite_ESP32" —
 *     that one fails to compile against modern arduino-esp32 core 3.x (a bug in its
 *     own bundled flatbuffers headers, unrelated to this sketch).
 *     See the comment above the #include block below if your installed
 *     library's MicroInterpreter constructor signature doesn't match.
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
#include "img_converters.h"
#include "model_data.h"
#include "driver/ledc.h"
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>

// ── TensorFlow Lite Micro (real on-device inference) ─────────────────────────
// Using "Chirale_TensorFlowLite" (Library Manager, actively maintained, lists
// "esp32" as a supported architecture). Its top-level umbrella header is named
// after the library itself, unlike the old TensorFlowLite_ESP32.h.
//
// Chirale tracks a newer upstream TFLite Micro snapshot than the previous
// library, where MicroInterpreter's constructor dropped the ErrorReporter
// argument entirely (replaced by an internal logging mechanism) — so this now
// uses the plain 4-argument form. If this doesn't match what your installed
// copy expects, the compiler error will say so exactly (wrong argument count,
// or a missing-symbol error naming what changed) — send it over and I'll
// match it to Chirale's actual signature instead of guessing again.
#include <Chirale_TensorFlowLite.h>
#include "tensorflow/lite/micro/all_ops_resolver.h"
#include "tensorflow/lite/micro/micro_interpreter.h"
#include "tensorflow/lite/schema/schema_generated.h"

// This struct MUST be defined here, before any function that uses it — Arduino's
// automatic function-prototype generation inserts a forward declaration of
// classifyLocallyML() (see below) right after this include block, BEFORE the
// rest of the file is parsed. If this struct were defined later in the file
// (it used to live down by initLocalML()), that auto-generated prototype would
// reference an as-yet-undefined type and fail with "LocalClassificationResult
// does not name a type" — which is exactly the error this fixes.
struct LocalClassificationResult {
  const char* materialType; // "PET_BOTTLE", "ALUMINUM_CAN", or "REJECTED"
  float petProb;
  float canProb;
  float confidence;
  bool isConfident;
};

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

// ── Flash LED Brightness Control (LEDC Timer 3 / Channel 3) ─────────────────
// GPIO4 is the AI-Thinker board's built-in flash LED. It sits behind an
// onboard transistor switch (the GPIO doesn't source the LED's current
// directly), so PWM-dimming it behaves exactly like dimming any other
// switched LED -- no different electrically from the plain on/off it's
// replacing. Was a straight digitalWrite() HIGH (i.e. 100% duty, fixed) in
// captureImage() -- full brightness at close range in a small chute was
// overexposing anything shiny or light-colored, confirmed by the reviewed
// deposit photos (most were badly blown out).
// Camera XCLK uses Timer2/Channel2, servo uses Timer0/Channel0, and the
// passive-buzzer build (if BUZZER_MODE is ever switched) uses Timer1/
// Channel1 -- Timer3/Channel3 is free regardless of buzzer mode.
// 5kHz is far faster than one exposure's integration time, so duty-cycling
// reads as a steady, dimmer light to the sensor rather than flicker/banding.
#define FLASH_PWM_RESOLUTION_BITS 10
#define FLASH_PWM_MAX_DUTY        ((1 << FLASH_PWM_RESOLUTION_BITS) - 1)  // 1023
// 0.0-1.0 fraction of full brightness. Was effectively 1.0. Tune this again
// after your next reviewed batch if captures are still too bright/dark.
#define FLASH_BRIGHTNESS 0.5f

static void flashSetup() {
  LOGF("FLASH", "Initialising dimmable flash on GPIO4 (%.0f%% brightness)", FLASH_BRIGHTNESS * 100);
  ledc_timer_config_t tc = {};
  tc.speed_mode      = LEDC_LOW_SPEED_MODE;
  tc.duty_resolution = (ledc_timer_bit_t)FLASH_PWM_RESOLUTION_BITS;
  tc.timer_num       = LEDC_TIMER_3;
  tc.freq_hz         = 5000;
  tc.clk_cfg         = LEDC_AUTO_CLK;
  if (ledc_timer_config(&tc) != ESP_OK) {
    LOG("FLASH", "ERROR: Timer config failed");
  }

  ledc_channel_config_t cc = {};
  cc.gpio_num   = 4;
  cc.speed_mode = LEDC_LOW_SPEED_MODE;
  cc.channel    = LEDC_CHANNEL_3;
  cc.intr_type  = LEDC_INTR_DISABLE;
  cc.timer_sel  = LEDC_TIMER_3;
  cc.duty       = 0;
  cc.hpoint     = 0;
  if (ledc_channel_config(&cc) != ESP_OK) {
    LOG("FLASH", "ERROR: Channel config failed");
  }
}

static void flashOn() {
  uint32_t duty = (uint32_t)(FLASH_BRIGHTNESS * FLASH_PWM_MAX_DUTY);
  ledc_set_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_3, duty);
  ledc_update_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_3);
}

static void flashOff() {
  ledc_set_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_3, 0);
  ledc_update_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_3);
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
  // Capture at CAPTURE_FRAMESIZE (see config.h) — the local classifier only
  // ever needs a 96x96 downsample, so a smaller capture means less JPEG data
  // to decode into RGB888 before every inference, and a smaller/faster
  // upload for the background cloud-sync record. QVGA (320x240) is still
  // ~3.3x oversampled relative to the model's 96x96 input.
  cfg.pixel_format = PIXFORMAT_JPEG;
  cfg.frame_size   = CAPTURE_FRAMESIZE;
  cfg.jpeg_quality = 12;               // 0 = best, 63 = worst
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

  // The drop chute is a dark, enclosed space lit only by the brief GPIO4 flash
  // in captureImage() — real captures were coming back very dark/underexposed
  // even with the flash on. Push the sensor harder to compensate:
  s->set_gainceiling(s, GAINCEILING_16X); // allow much more analog gain in low light
                                           // (default is 2X — far too conservative in here)
  s->set_aec2(s, 1);                      // "advanced AEC" — adapts exposure faster to a
                                           // sudden lighting change (the flash turning on)
  s->set_ae_level(s, 1);                  // bias the auto-exposure target brighter (range -2..2)

  LOGF("CAMERA", "OV2640 ready — %dx%d JPEG, PSRAM frame buffer", CAPTURE_WIDTH, CAPTURE_HEIGHT);
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

// ── Fast Reject Notification: tell the app a locally-rejected item happened ──
// A local REJECT (confidence < ML_CONFIDENCE_THRESHOLD) used to only produce
// an admin-facing sendLog() entry — the user's phone had no idea anything was
// scanned at all, even though recycling-session.tsx already has a fully-built
// amber "Item Rejected / Unrecognized" banner with a retry tip that was just
// never being triggered. This posts the tiny, image-free JSON payload
// /api/device/scan already accepts for a pre-classified result — processDeposit()
// already handles materialType="REJECTED" correctly: it writes a REJECTED
// Deposit row against the still-ACTIVE session (no points, session stays open
// so the app's poll picks it up and the user can try again) without touching
// session status. Modeled on sendLog() above — short timeout, best-effort,
// never worth retrying since the gate has already closed either way.
static void sendRejectResult(const char *sessionId, const char *topLabel, float confidence) {
  if (WiFi.status() != WL_CONNECTED) {
    LOG("REJECT-SYNC", "SKIP (no WiFi)");
    return;
  }
  if (!sessionId || strlen(sessionId) == 0) {
    LOG("REJECT-SYNC", "SKIP (no active sessionId)");
    return;
  }

  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(5000);  // milliseconds — short; this only tells the app to show a tip

  if (!client.connect(BACKEND_HOST, BACKEND_PORT)) {
    LOG("REJECT-SYNC", "ERROR: could not connect to backend");
    return;
  }

  char label[40];
  snprintf(label, sizeof(label), "low_confidence:%s", topLabel);

  JsonDocument doc;
  doc["sessionId"] = sessionId;
  doc["materialType"] = "REJECTED";
  doc["classificationLabel"] = label;
  doc["confidence"] = confidence;

  String body;
  serializeJson(doc, body);

  client.printf("POST /api/device/scan HTTP/1.1\r\n");
  client.printf("Host: %s\r\n", BACKEND_HOST);
  client.printf("x-device-api-key: %s\r\n", DEVICE_API_KEY);
  client.printf("Content-Type: application/json\r\n");
  client.printf("Content-Length: %u\r\n", (unsigned)body.length());
  client.printf("Connection: close\r\n\r\n");
  client.print(body);
  client.flush();

  String statusLine = client.readStringUntil('\n');
  LOGF("REJECT-SYNC", "Reject notified | HTTP: %s", statusLine.c_str());
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
// Flashes ESP32 Flash LED (GPIO4) during capture for active translucency illumination.
static camera_fb_t* captureImage() {
  LOGF("CAMERA", "Capturing frame from OV2640 with Flash LED active (%.0f%% brightness)...", FLASH_BRIGHTNESS * 100);

  flashOn();  // was: pinMode(4, OUTPUT); digitalWrite(4, HIGH); -- full brightness, no dimming
  delay(60);  // Allow LED to illuminate and camera sensor to settle

  // A fixed delay alone doesn't give the sensor's auto-exposure loop a real
  // chance to react to the flash turning on -- AEC/AGC re-target based on what
  // they measure IN a captured frame, not on a timer. The frame captured right
  // after the flash switches on is measured against the (dark, pre-flash) old
  // exposure setting and comes back badly under-exposed. Grab and discard one
  // "warm-up" frame under flash lighting so AEC/AGC (tuned harder in
  // cameraInit() above) converges before the frame that's actually used.
  // Costs one extra frame period (roughly 60-100ms at QVGA) — worth it against
  // captures that were coming back nearly black.
  camera_fb_t *warm = esp_camera_fb_get();
  if (warm) esp_camera_fb_return(warm);

  camera_fb_t *fb = esp_camera_fb_get();

  flashOff();  // was: digitalWrite(4, LOW);

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
// localMaterialType/localConfidence: the ESP32's own real on-device TFLite
// Micro decision (already made and already acted on — the gate is already
// closed by the time this runs). Sent to the backend as the authoritative
// classification for points/recording, instead of letting deposit-image
// independently re-guess with its much weaker zero-shot cloud model. See
// the matching comment in deposit-image/route.ts.
static String uploadImage(camera_fb_t *fb, const char *sessionId,
                           const char *localMaterialType, float localConfidence) {
  if (WiFi.status() != WL_CONNECTED) {
    LOG("UPLOAD", "ERROR: Cannot upload — WiFi not connected");
    return "";
  }

  for (int attempt = 1; attempt <= BACKGROUND_SYNC_MAX_ATTEMPTS; attempt++) {
    WiFiClientSecure client;
    client.setInsecure();
    // Short, background-sync timeout — NOT BACKEND_TIMEOUT_MS. The gate
    // decision is already made and the gate is already closed by the time
    // this runs; a hung socket here must not tie up the kiosk. See config.h.
    client.setTimeout(BACKGROUND_SYNC_TIMEOUT_MS);

    LOGF("UPLOAD", "Connecting to %s:%d for image upload (attempt %d/%d)...",
         BACKEND_HOST, BACKEND_PORT, attempt, BACKGROUND_SYNC_MAX_ATTEMPTS);
    if (!client.connect(BACKEND_HOST, BACKEND_PORT)) {
      LOGF("UPLOAD", "WARN: TCP connect failed on attempt %d/%d", attempt, BACKGROUND_SYNC_MAX_ATTEMPTS);
      if (attempt < BACKGROUND_SYNC_MAX_ATTEMPTS) { delay(250); continue; }
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

    // Build the local-decision fields — this is what makes this route trust
    // the ESP32's real decision instead of re-guessing server-side.
    String localTypePart;
    localTypePart  = "--"; localTypePart += boundary; localTypePart += "\r\n";
    localTypePart += "Content-Disposition: form-data; name=\"localMaterialType\"\r\n\r\n";
    localTypePart += localMaterialType; localTypePart += "\r\n";

    char confBuf[16];
    snprintf(confBuf, sizeof(confBuf), "%.4f", localConfidence);
    String localConfPart;
    localConfPart  = "--"; localConfPart += boundary; localConfPart += "\r\n";
    localConfPart += "Content-Disposition: form-data; name=\"localConfidence\"\r\n\r\n";
    localConfPart += confBuf; localConfPart += "\r\n";

    // Build image part header
    String imagePart;
    imagePart  = "--"; imagePart += boundary; imagePart += "\r\n";
    imagePart += "Content-Disposition: form-data; name=\"image\"; filename=\"frame.jpg\"\r\n";
    imagePart += "Content-Type: image/jpeg\r\n\r\n";

    String footer = "\r\n--"; footer += boundary; footer += "--\r\n";

    size_t contentLen = sessionPart.length() + localTypePart.length() + localConfPart.length()
                       + imagePart.length() + fb->len + footer.length();

    LOGF("UPLOAD", "Uploading %u bytes (sessionId=%s, local=%s/%.2f)",
         (unsigned)contentLen, sessionId ? sessionId : "none", localMaterialType, localConfidence);

    client.printf("POST /api/device/deposit-image HTTP/1.1\r\n");
    client.printf("Host: %s\r\n", BACKEND_HOST);
    client.printf("x-device-api-key: %s\r\n", DEVICE_API_KEY);
    client.printf("Content-Type: multipart/form-data; boundary=%s\r\n", boundary);
    client.printf("Content-Length: %u\r\n", (unsigned)contentLen);
    client.printf("Connection: close\r\n\r\n");

    if (sessionPart.length()) client.print(sessionPart);
    client.print(localTypePart);
    client.print(localConfPart);
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

    if (statusLine.length() == 0) {
      LOGF("UPLOAD", "WARN: Empty HTTP status on attempt %d/%d (socket closed early) — retrying...",
           attempt, BACKGROUND_SYNC_MAX_ATTEMPTS);
      client.stop();
      if (attempt < BACKGROUND_SYNC_MAX_ATTEMPTS) { delay(250); continue; }
      return "";
    }

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
      if (attempt < BACKGROUND_SYNC_MAX_ATTEMPTS) { delay(250); continue; }
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
  return "";
}

// ── ESP32 Local ML Classifier (MobileNetV1 96x96 INT8, real TFLite Micro) ────
// LocalClassificationResult is defined near the top of the file now (with the
// TFLite includes) — see the comment there for why it can't live here.

static uint8_t *tensorArenaBuffer = nullptr;
static uint8_t *rgbDecodeBuffer   = nullptr;
static bool tfliteInitialized     = false;

static const tflite::Model      *tfliteModel        = nullptr;
static tflite::MicroInterpreter *tfliteInterpreter   = nullptr;
static TfLiteTensor             *tfliteInputTensor   = nullptr;
static TfLiteTensor             *tfliteOutputTensor  = nullptr;

static bool initLocalML() {
  if (tfliteInitialized) return true;

  LOG("TINYML", "Initialising MobileNetV1 96x96 INT8 TFLite Micro engine...");
  LOGF("TINYML", "Model size: %u bytes | Tensor Arena: %d KB", g_model_data_len, MODEL_TENSOR_ARENA_SIZE / 1024);

  // Allocate Tensor Arena and RGB decode buffer from PSRAM to preserve internal SRAM & stack.
  // (There's no separate "input tensor" scratch buffer anymore — preprocessing
  // writes straight into the interpreter's own input tensor, see below.)
  //
  // Both the PSRAM allocation and the internal-SRAM fallback below are sized
  // from CAPTURE_WIDTH/CAPTURE_HEIGHT (config.h) — they used to be hardcoded
  // to two DIFFERENT sizes (640x480 for PSRAM, 320x240 for the SRAM fallback)
  // left over from an earlier resolution change. That mismatch meant that if
  // the PSRAM allocation above ever failed and this fell back to internal
  // SRAM, fmt2rgb888() would decode a full-size camera frame into a buffer
  // only a quarter that size — a heap buffer overflow. Fixed by deriving both
  // from the same constants so they can never drift apart again.
  size_t rgbBufferBytes = (size_t)CAPTURE_WIDTH * (size_t)CAPTURE_HEIGHT * 3;
  if (psramFound()) {
    tensorArenaBuffer = (uint8_t*) heap_caps_malloc(MODEL_TENSOR_ARENA_SIZE, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    rgbDecodeBuffer   = (uint8_t*) heap_caps_malloc(rgbBufferBytes, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  }

  if (!tensorArenaBuffer) {
    LOG("TINYML", "WARN: PSRAM allocation failed, attempting fallback to internal SRAM...");
    tensorArenaBuffer = (uint8_t*) malloc(MODEL_TENSOR_ARENA_SIZE);
  }
  if (!rgbDecodeBuffer) {
    rgbDecodeBuffer = (uint8_t*) malloc(rgbBufferBytes);
  }
  if (!tensorArenaBuffer || !rgbDecodeBuffer) {
    LOG("TINYML", "ERROR: Could not allocate memory buffers for Local ML inference!");
    return false;
  }

  // Map the flatbuffer (no copy — this just points into g_model_data).
  tfliteModel = tflite::GetModel(g_model_data);
  if (tfliteModel->version() != TFLITE_SCHEMA_VERSION) {
    LOGF("TINYML", "ERROR: model schema version %d != TFLite Micro schema %d — "
         "retrain with a matching TF version or update the TFLite Micro library",
         (int)tfliteModel->version(), TFLITE_SCHEMA_VERSION);
    return false;
  }

  // AllOpsResolver is deliberately used instead of a hand-picked
  // MicroMutableOpResolver: MobileNetV1 needs CONV_2D, DEPTHWISE_CONV_2D,
  // FULLY_CONNECTED, MEAN, SOFTMAX, RESHAPE and friends, and getting that op
  // list wrong just fails silently at AllocateTensors(). Trade a bit of flash
  // for "it definitely has the op it needs."
  static tflite::AllOpsResolver resolver;
  // 4-argument MicroInterpreter constructor (model, resolver, arena, arena_size)
  // — Chirale_TensorFlowLite tracks a newer TFLite Micro snapshot than the
  // library this used to target, one where ErrorReporter was dropped from this
  // constructor entirely. If your installed Chirale version wants a different
  // argument list, the compiler will say so exactly — send me that error.
  static tflite::MicroInterpreter staticInterpreter(
      tfliteModel, resolver, tensorArenaBuffer, MODEL_TENSOR_ARENA_SIZE);
  tfliteInterpreter = &staticInterpreter;

  if (tfliteInterpreter->AllocateTensors() != kTfLiteOk) {
    LOG("TINYML", "ERROR: AllocateTensors() failed — increase MODEL_TENSOR_ARENA_SIZE in model_data.h");
    return false;
  }

  tfliteInputTensor  = tfliteInterpreter->input(0);
  tfliteOutputTensor = tfliteInterpreter->output(0);

  LOGF("TINYML", "Arena used: %u / %u bytes",
       (unsigned)tfliteInterpreter->arena_used_bytes(), (unsigned)MODEL_TENSOR_ARENA_SIZE);

  tfliteInitialized = true;
  LOG("TINYML", "TFLite Micro engine initialized successfully in PSRAM!");
  return true;
}

static LocalClassificationResult classifyLocallyML(camera_fb_t *fb) {
  LocalClassificationResult res;
  res.materialType = "REJECTED";
  res.petProb      = 0.0f;
  res.canProb      = 0.0f;
  res.confidence   = 0.0f;
  res.isConfident  = false;

  if (!fb || !fb->buf || fb->len == 0) {
    LOG("TINYML", "ERROR: Empty camera frame buffer passed to ML engine");
    return res;
  }

  if (!tfliteInitialized && !initLocalML()) {
    LOG("TINYML", "ERROR: Local ML engine failed to initialise — rejecting for safety");
    return res;
  }

  unsigned long startMs = millis();

  // 1. Decode JPEG to RGB888
  int srcW = fb->width;
  int srcH = fb->height;

  if (!fmt2rgb888(fb->buf, fb->len, fb->format, rgbDecodeBuffer)) {
    LOG("TINYML", "ERROR: Failed to decode framebuffer to RGB888");
    return res;
  }

  // 2. Resize + quantize straight into the interpreter's own input tensor —
  // no separate scratch buffer or memcpy needed. Formula matches
  // scripts/ml/train_esp32_model.py exactly:
  //   int8_pix = round(((rgb_uint8 / 127.5f) - 1.0f) / MODEL_INPUT_SCALE + MODEL_INPUT_ZERO_POINT)
  int8_t *inTensor = tfliteInputTensor->data.int8;
  for (int y = 0; y < MODEL_INPUT_SIZE; y++) {
    int srcY = (y * srcH) / MODEL_INPUT_SIZE;
    for (int x = 0; x < MODEL_INPUT_SIZE; x++) {
      int srcX = (x * srcW) / MODEL_INPUT_SIZE;
      int srcIdx    = (srcY * srcW + srcX) * 3;
      int targetIdx = (y * MODEL_INPUT_SIZE + x) * 3;

      for (int c = 0; c < 3; c++) {
        uint8_t pixVal    = rgbDecodeBuffer[srcIdx + c];
        float   floatVal  = ((float)pixVal / 127.5f) - 1.0f;
        int     quantized = (int)roundf(floatVal / MODEL_INPUT_SCALE + (float)MODEL_INPUT_ZERO_POINT);
        if (quantized < -128) quantized = -128;
        if (quantized > 127)  quantized = 127;
        inTensor[targetIdx + c] = (int8_t)quantized;
      }
    }
  }

  // 3. Run the real MobileNetV1 model (this replaces what used to be a fake
  // RGB-variance/glare heuristic — see git history if you need to compare).
  if (tfliteInterpreter->Invoke() != kTfLiteOk) {
    LOG("TINYML", "ERROR: Invoke() failed — rejecting for safety");
    return res;
  }

  // 4. Dequantize output probabilities. Class order is fixed by training:
  // 0=PET_BOTTLE, 1=ALUMINUM_CAN (see MODEL_CLASS_* in model_data.h).
  int8_t petRawOut = tfliteOutputTensor->data.int8[MODEL_CLASS_PET_BOTTLE];
  int8_t canRawOut = tfliteOutputTensor->data.int8[MODEL_CLASS_ALUMINUM_CAN];
  res.petProb = ((float)petRawOut - (float)MODEL_OUTPUT_ZERO_POINT) * MODEL_OUTPUT_SCALE;
  res.canProb = ((float)canRawOut - (float)MODEL_OUTPUT_ZERO_POINT) * MODEL_OUTPUT_SCALE;

  if (res.canProb > res.petProb) {
    res.materialType = "ALUMINUM_CAN";
    res.confidence   = res.canProb;
  } else {
    res.materialType = "PET_BOTTLE";
    res.confidence   = res.petProb;
  }

  res.isConfident = (res.confidence >= ML_CONFIDENCE_THRESHOLD);
  if (!res.isConfident) {
    res.materialType = "REJECTED";
  }

  unsigned long elapsedMs = millis() - startMs;
  LOGF("TINYML", "Inference complete in %lu ms | Decision: %s (PET: %.2f, CAN: %.2f, conf: %.2f, pass: %s)",
       elapsedMs, res.materialType, res.petProb, res.canProb, res.confidence, res.isConfident ? "YES" : "NO");

  return res;
}


// sendFastScanResult() (POST /api/device/scan) used to run here as a second,
// separate background call right after uploadImage(). Removed: uploadImage()
// now sends the ESP32's local decision itself (see its localMaterialType/
// localConfidence multipart fields), so this second call was redundant and
// was actively harmful — it landed on a session uploadImage() had already
// marked COMPLETED and wrote a phantom orphaned REJECTED Deposit row on every
// single successful deposit. See the call site in STATE_PROCESSING and the
// matching comment in deposit-image/route.ts.

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

  // ── Flash LED ────────────────────────────────────────────────────────
  flashSetup();

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

    // ── PROCESSING: Local TinyML Classification → Gate Open Decision ─────────
    case STATE_PROCESSING: {
      camera_fb_t *fb = captureImage();
      if (!fb) {
        LOG("FSM", "PROCESSING: Capture failed — retrying in 2s");
        ledOff();
        sendLog("ERROR", "CAMERA", "Frame capture failed in PROCESSING state",
                "esp_camera_fb_get() returned NULL — check ribbon cable and power");
        delay(POLL_INTERVAL_MS);
        break;
      }

      // 1. Local TinyML Inference (MobileNetV1 INT8 on ESP32)
      LOG("FSM", "Running Local ESP32 TinyML classification...");
      LocalClassificationResult mlRes = classifyLocallyML(fb);

      LOGF("FSM", "Local ML Result: %s (PET=%.2f, CAN=%.2f, conf=%.2f, threshold=%.2f, pass=%s)",
           mlRes.materialType, mlRes.petProb, mlRes.canProb, mlRes.confidence, ML_CONFIDENCE_THRESHOLD,
           mlRes.isConfident ? "YES" : "NO");

      // 2. Gate Decision based on Local Confidence
      if (mlRes.isConfident) {
        LOGF("FSM", "Item ACCEPTED locally (%s) — Opening Gate ⚡", mlRes.materialType);
        playBeep(1, 300, 0, TONE_ACCEPT_HZ);
        gateOpen();

        // Hold gate open for GATE_OPEN_MS, then close it right away. The
        // physical deposit cycle must never wait on network conditions — it
        // used to close the gate only AFTER both network calls below
        // finished, so a slow/dropped WiFi link could leave the gate open
        // (and the kiosk unable to serve the next customer) for up to ~35s.
        delay(GATE_OPEN_MS);
        gateClose();
        LOG("FSM", "Gate closed — syncing deposit with cloud backend in background");

        // Background sync: upload the frame AND the local decision together
        // in one call, so the backend records/awards points on what the ESP32
        // actually decided (and already acted on), not an independent guess.
        // This is best-effort: the local model already made the accept/reject
        // call and the gate has already closed, so a slow or failed sync here
        // only delays points/telemetry — it can no longer stall the kiosk
        // itself. (See BACKGROUND_SYNC_* in config.h — worst case is now
        // ~12s of background work, not ~35s blocking the FSM.)
        //
        // NOTE: this used to ALSO call sendFastScanResult() right after —
        // that sent the same decision to /api/device/scan as a second,
        // separate deposit-completion call. Since uploadImage() above already
        // completes the deposit (and the backend session is no longer ACTIVE
        // once it does), that second call was landing on a session that had
        // already been marked COMPLETED and writing a phantom orphaned
        // REJECTED row for every single successful deposit. Removed — one
        // call now does the whole job.
        String serverDecision = uploadImage(fb, activeSessionId, mlRes.materialType, mlRes.confidence);

        esp_camera_fb_return(fb);  // Release frame buffer RAM
        ledOff();

        LOG("FSM", "SUCCESS — deposit complete, gate closed");
        uploadErrorCount = 0;
        activeSessionId[0] = '\0';
        LOG("FSM", "SUCCESS → IDLE");
        state = STATE_IDLE;
      } else {
        LOGF("FSM", "Item REJECTED locally (confidence %.2f < threshold %.2f) — Keeping Gate Closed 🔒",
             mlRes.confidence, ML_CONFIDENCE_THRESHOLD);
        playBeep(3, 120, 100, TONE_REJECT_HZ);
        gateClose();

        // Send telemetry log for rejected item (admin-facing)
        char logDetails[128];
        snprintf(logDetails, sizeof(logDetails), "decision=%s pet_prob=%.2f can_prob=%.2f conf=%.2f thresh=%.2f",
                 mlRes.materialType, mlRes.petProb, mlRes.canProb, mlRes.confidence, ML_CONFIDENCE_THRESHOLD);
        sendLog("WARN", "LOCAL_ML", "Deposit rejected due to low classification confidence", logDetails);

        // Tell the user's phone too, not just the admin log — see sendRejectResult()
        // comment above. Session is still ACTIVE at this point (only cleared below),
        // so this reaches the right session while it can still be retried.
        sendRejectResult(activeSessionId, mlRes.materialType, mlRes.confidence);

        esp_camera_fb_return(fb);
        ledOff();

        activeSessionId[0] = '\0';
        LOG("FSM", "REJECTED → IDLE");
        state = STATE_IDLE;
      }
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
