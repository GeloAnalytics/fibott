/*
 * Fibott — ESP32-S3 N16R8 CAM (OV3640) Vision & AI Inference Firmware
 *
 * ── Hardware Specs & Configuration ──────────────────────────────────────────
 * Board:     ESP32-S3 N16R8 CAM (Dual-Core LX7 @ 240MHz)
 * Flash:     16MB SPI Flash (N16)
 * PSRAM:     8MB Octal SPI (OPI) PSRAM (R8)
 * Sensor:    OV3640 (3 Megapixel CMOS Sensor) / OV2640 / OV5640 compatible
 *
 * ── Arduino IDE Tools Menu Configuration ─────────────────────────────────────
 *   - Board:             "ESP32S3 Dev Module"
 *   - PSRAM:             "OPI PSRAM" (REQUIRED — Camera & TinyML need 8MB Octal RAM)
 *   - Flash Size:        "16MB (128Mb)"
 *   - Flash Mode:        "QIO 80MHz" or "OPI 80MHz"
 *   - Partition Scheme:  "16M Flash (3MB APP / 9.9MB FATFS)" or "Huge APP (3MB No OTA/1MB SPIFFS)"
 *   - USB CDC On Boot:   "Enabled" (Outputs Serial to USB-C port automatically)
 *   - Upload Mode:       "UART0 / Hardware CDC"
 *   - CPU Frequency:     "240MHz (WiFi)"
 *
 * ── Libraries Required (Arduino Library Manager) ─────────────────────────────
 *   - ArduinoJson  >= 7.0  (by Benoit Blanchon)
 *   - "Chirale_TensorFlowLite" (by Chirale)
 *
 * ── Wireless Interconnect (ZERO Physical Wiring to 2nd ESP32) ────────────────
 *   Communication with the Kiosk Controller is 100% wireless over 2.4 GHz ESP-NOW.
 *   - Sub-10ms wireless command transmission (CMD:OPEN, CMD:REJECT, CMD:READY)
 *   - Complete galvanic isolation between camera logic and servo motors
 *
 * ── Advanced Multi-Tiered Rejection System ──────────────────────────────────
 *   - Hardware accelerated MobileNetV1 INT8 inference in Octal PSRAM (<45ms)
 *   - Strict softmax confidence (>= 78%) and class separation margin (>= 50%)
 *   - Real-time Human Hand & Skin tone rejection filter
 *   - Flat Paper / Cardboard / Tissue rejection filter
 *   - Blank / Dark chute rejection filter
 */

#include "config.h"
#include "camera_pins.h"
#include "esp_camera.h"
#include "img_converters.h"
#include "model_data.h"
#include "driver/ledc.h"
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <esp_now.h>
#include <esp_wifi.h>

// ── TensorFlow Lite Micro ───────────────────────────────────────────────────
#include <Chirale_TensorFlowLite.h>
#include "tensorflow/lite/micro/all_ops_resolver.h"
#include "tensorflow/lite/micro/micro_interpreter.h"
#include "tensorflow/lite/schema/schema_generated.h"

// ── Serial Diagnostic Macros ──────────────────────────────────────────────────
#define LOG(tag, msg)       Serial.printf("[%-8s] %s\n", tag, msg)
#define LOGF(tag, fmt, ...) Serial.printf("[%-8s] " fmt "\n", tag, ##__VA_ARGS__)

// ── Wireless Command Packet Struct (ESP-NOW) ─────────────────────────────────
typedef struct __attribute__((packed)) {
  char magic[4];        // "FIBO"
  uint8_t version;      // 1
  char command[24];     // "CMD:OPEN", "CMD:REJECT", "CMD:READY", "CMD:BOOT", "CMD:ERROR"
  uint32_t seq;         // Monotonic packet sequence counter
} WirelessCommandPacket;

static uint8_t espNowBroadcastMac[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
static bool espNowReady = false;
static uint32_t packetSeqNum = 0;

// ── Classification Result Struct ─────────────────────────────────────────────
struct LocalClassificationResult {
  const char* materialType; // "PET_BOTTLE", "ALUMINUM_CAN", or "REJECTED"
  const char* rejectReason; // "low_confidence", "hand_detected", "paper_detected", etc.
  float petProb;
  float canProb;
  float confidence;
  bool isConfident;
};

// ── Kiosk FSM States ──────────────────────────────────────────────────────────
enum KioskState {
  STATE_IDLE,
  STATE_READY,
  STATE_PROCESSING,
  STATE_ERROR
};
static KioskState state = STATE_IDLE;
static char activeSessionId[128] = "";

static unsigned long lastHeartbeatMs = 0;
static unsigned long lastWifiWarnMs  = 0;

// ── Status LED Control ────────────────────────────────────────────────────────
static void ledInit() {
#if defined(PIN_LED_STATUS) && PIN_LED_STATUS >= 0
  pinMode(PIN_LED_STATUS, OUTPUT);
  #if LED_STATUS_ACTIVE_LOW
    digitalWrite(PIN_LED_STATUS, HIGH);
  #else
    digitalWrite(PIN_LED_STATUS, LOW);
  #endif
#endif
}

static void ledOn() {
#if defined(PIN_LED_STATUS) && PIN_LED_STATUS >= 0
  #if LED_STATUS_ACTIVE_LOW
    digitalWrite(PIN_LED_STATUS, LOW);
  #else
    digitalWrite(PIN_LED_STATUS, HIGH);
  #endif
#endif
}

static void ledOff() {
#if defined(PIN_LED_STATUS) && PIN_LED_STATUS >= 0
  #if LED_STATUS_ACTIVE_LOW
    digitalWrite(PIN_LED_STATUS, HIGH);
  #else
    digitalWrite(PIN_LED_STATUS, LOW);
  #endif
#endif
}

// ── Flash LED Dimmable PWM Control (LEDC) ────────────────────────────────────
#define FLASH_PWM_RESOLUTION_BITS 10
#define FLASH_PWM_MAX_DUTY        ((1 << FLASH_PWM_RESOLUTION_BITS) - 1)
static bool flashConfigured = false;

static void flashSetup() {
#if defined(PIN_LED_FLASH) && PIN_LED_FLASH >= 0
  LOGF("FLASH", "Initialising dimmable flash LED on GPIO%d (%.0f%% brightness)", 
       PIN_LED_FLASH, FLASH_BRIGHTNESS * 100);

  ledc_timer_config_t tc = {};
  tc.speed_mode      = LEDC_LOW_SPEED_MODE;
  tc.duty_resolution = (ledc_timer_bit_t)FLASH_PWM_RESOLUTION_BITS;
  tc.timer_num       = LEDC_TIMER_1;
  tc.freq_hz         = 5000;
  tc.clk_cfg         = LEDC_AUTO_CLK;
  ledc_timer_config(&tc);

  ledc_channel_config_t cc = {};
  cc.gpio_num   = PIN_LED_FLASH;
  cc.speed_mode = LEDC_LOW_SPEED_MODE;
  cc.channel    = LEDC_CHANNEL_1;
  cc.intr_type  = LEDC_INTR_DISABLE;
  cc.timer_sel  = LEDC_TIMER_1;
  cc.duty       = 0;
  cc.hpoint     = 0;
  ledc_channel_config(&cc);

  flashConfigured = true;
#else
  LOG("FLASH", "No dedicated flash pin defined, skipping flash LED setup");
#endif
}

static void flashOn() {
  if (!flashConfigured) return;
  uint32_t duty = (uint32_t)(FLASH_BRIGHTNESS * FLASH_PWM_MAX_DUTY);
  ledc_set_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_1, duty);
  ledc_update_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_1);
}

static void flashOff() {
  if (!flashConfigured) return;
  ledc_set_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_1, 0);
  ledc_update_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_1);
}

// ── Wireless Setup (ESP-NOW 2.4 GHz) ──────────────────────────────────────────
static void wirelessSetup() {
  LOG("WIRELESS", "Initialising ESP-NOW wireless transmitter on ESP32-S3...");

  if (esp_now_init() != ESP_OK) {
    LOG("WIRELESS", "WARN: esp_now_init failed! Actuation commands will not transmit.");
    return;
  }

  esp_now_peer_info_t peerInfo = {};
  memcpy(peerInfo.peer_addr, espNowBroadcastMac, 6);
  peerInfo.channel = WIRELESS_ESPNOW_CHANNEL;
  peerInfo.encrypt = false;

  if (esp_now_add_peer(&peerInfo) != ESP_OK) {
    LOG("WIRELESS", "WARN: Failed to add ESP-NOW broadcast peer.");
  } else {
    espNowReady = true;
    LOG("WIRELESS", "ESP-NOW broadcast ready (following active Wi-Fi channel).");
  }
}

// ── Send Command to 2nd ESP32 Controller via ESP-NOW ──────────────────────────
static void sendControllerCmd(const char* cmd) {
  if (!cmd || strlen(cmd) == 0) return;

  LOGF("WIRELESS->ACT", "%s", cmd);

  if (espNowReady) {
    WirelessCommandPacket pkt = {};
    memcpy(pkt.magic, WIRELESS_MAGIC, 4);
    pkt.version = 1;
    strncpy(pkt.command, cmd, sizeof(pkt.command) - 1);
    pkt.seq = ++packetSeqNum;

    esp_err_t res = esp_now_send(espNowBroadcastMac, (const uint8_t*)&pkt, sizeof(pkt));
    if (res != ESP_OK) {
      LOGF("WIRELESS", "WARN: esp_now_send failed (0x%x)", res);
    }
  } else {
    LOG("WIRELESS", "WARN: ESP-NOW not initialized, command not transmitted");
  }
}

// ── Camera Initialization (OV3640 / OV2640 / OV5640) ─────────────────────────
static bool cameraInit() {
  LOG("CAMERA", "Initialising camera subsystem on ESP32-S3 N16R8...");

  if (!psramFound()) {
    LOG("CAMERA", "FATAL: Octal PSRAM not found! Set Tools -> PSRAM -> 'OPI PSRAM'");
    return false;
  }

  LOGF("CAMERA", "Octal PSRAM detected: %u KB total, %u KB free", 
       ESP.getPsramSize() / 1024, ESP.getFreePsram() / 1024);

  camera_config_t cfg = {};
  cfg.ledc_channel = LEDC_CHANNEL_0;
  cfg.ledc_timer   = LEDC_TIMER_0;
  cfg.pin_d0       = Y2_GPIO_NUM;
  cfg.pin_d1       = Y3_GPIO_NUM;
  cfg.pin_d2       = Y4_GPIO_NUM;
  cfg.pin_d3       = Y5_GPIO_NUM;
  cfg.pin_d4       = Y6_GPIO_NUM;
  cfg.pin_d5       = Y7_GPIO_NUM;
  cfg.pin_d6       = Y8_GPIO_NUM;
  cfg.pin_d7       = Y9_GPIO_NUM;
  cfg.pin_xclk     = XCLK_GPIO_NUM;
  cfg.pin_pclk     = PCLK_GPIO_NUM;
  cfg.pin_vsync    = VSYNC_GPIO_NUM;
  cfg.pin_href     = HREF_GPIO_NUM;
  cfg.pin_sccb_sda = SIOD_GPIO_NUM;
  cfg.pin_sccb_scl = SIOC_GPIO_NUM;
  cfg.pin_pwdn     = PWDN_GPIO_NUM;
  cfg.pin_reset    = RESET_GPIO_NUM;
  cfg.xclk_freq_hz = 20000000;
  cfg.pixel_format = PIXFORMAT_JPEG;
  cfg.frame_size   = CAPTURE_FRAMESIZE;
  cfg.jpeg_quality = CAPTURE_JPEG_QUAL;
  cfg.fb_count     = CAPTURE_FB_COUNT;        // Double buffering in 8MB Octal PSRAM
  cfg.fb_location  = CAMERA_FB_IN_PSRAM;
  cfg.grab_mode    = CAMERA_GRAB_LATEST;

  esp_err_t err = esp_camera_init(&cfg);
  if (err != ESP_OK) {
    LOGF("CAMERA", "FATAL: esp_camera_init failed (0x%x)", err);
    return false;
  }

  sensor_t *s = esp_camera_sensor_get();
  if (s) {
    // Detect sensor model
    const char* sensorName = "Unknown";
    if (s->id.PID == 0x3640 || s->id.PID == 0x364c) sensorName = "OV3640 (3MP)";
    else if (s->id.PID == 0x2642 || s->id.PID == 0x2640) sensorName = "OV2640 (2MP)";
    else if (s->id.PID == 0x5640) sensorName = "OV5640 (5MP)";
    
    LOGF("CAMERA", "Camera Sensor Identified: %s (PID=0x%04X, MID=0x%04X)", 
         sensorName, s->id.PID, s->id.MIDH);

    // Apply optimal exposure, gain, and color balance settings
    s->set_brightness(s, 1);
    s->set_contrast(s, 1);
    s->set_saturation(s, 0);
    s->set_gainceiling(s, GAINCEILING_16X);
    s->set_aec2(s, 1);
    s->set_ae_level(s, 1);
    s->set_awb_gain(s, 1);
  }

  LOGF("CAMERA", "Camera ready (%dx%d, FB Count: %d, JPEG Qual: %d)", 
       CAPTURE_WIDTH, CAPTURE_HEIGHT, CAPTURE_FB_COUNT, CAPTURE_JPEG_QUAL);
  return true;
}

// ── Telemetry: Send Diagnostic Log to Backend ─────────────────────────────────
static void sendLog(const char* level, const char* tag, const char* message, const char* details = nullptr) {
  if (WiFi.status() != WL_CONNECTED) return;

  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(8000);

  if (!client.connect(BACKEND_HOST, BACKEND_PORT)) return;

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

  String statusLine = client.readStringUntil('\n');
  LOGF("TELEMETRY", "[%s/%s]: %s | %s", level, tag, message, statusLine.c_str());
  client.stop();
}

// ── Fast Reject Notification to App ──────────────────────────────────────────
static void sendRejectResult(const char *sessionId, const char *reasonLabel, float confidence) {
  if (WiFi.status() != WL_CONNECTED || !sessionId || strlen(sessionId) == 0) return;

  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(5000);

  if (!client.connect(BACKEND_HOST, BACKEND_PORT)) return;

  char label[64];
  snprintf(label, sizeof(label), "rejected:%s", reasonLabel);

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
  LOGF("REJECT-SYNC", "Reject notified (%s) | %s", reasonLabel, statusLine.c_str());
  client.stop();
}

// ── Session Polling ───────────────────────────────────────────────────────────
static bool pollSession(char *outSessionId, size_t maxLen) {
  if (WiFi.status() != WL_CONNECTED) return false;

  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(BACKEND_TIMEOUT_MS);

  if (!client.connect(BACKEND_HOST, BACKEND_PORT)) {
    LOG("POLL", "TCP connect failed");
    return false;
  }

  client.printf("GET /api/kiosk/session HTTP/1.1\r\n");
  client.printf("Host: %s\r\n", BACKEND_HOST);
  client.printf("x-device-api-key: %s\r\n", DEVICE_API_KEY);
  client.printf("Connection: close\r\n\r\n");
  client.flush();

  String statusLine = client.readStringUntil('\n');
  if (statusLine.indexOf("401") >= 0) {
    LOG("POLL", "ERROR 401 Unauthorized API Key");
    client.stop();
    return false;
  }

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
  if (!id || strlen(id) == 0) return false;

  strncpy(outSessionId, id, maxLen - 1);
  outSessionId[maxLen - 1] = '\0';
  LOGF("POLL", "Active session found: %s", outSessionId);
  return true;
}

// ── Frame Capture ─────────────────────────────────────────────────────────────
static camera_fb_t* captureImage() {
  LOG("CAMERA", "Illuminating chute and capturing frame...");
  flashOn();
  delay(60);

  // Grab warm-up frame for auto-exposure convergence
  camera_fb_t *warm = esp_camera_fb_get();
  if (warm) esp_camera_fb_return(warm);

  camera_fb_t *fb = esp_camera_fb_get();
  flashOff();

  if (!fb) {
    LOG("CAMERA", "ERROR: esp_camera_fb_get() returned NULL");
    return nullptr;
  }

  LOGF("CAMERA", "Captured frame: %u bytes (%ux%u)", fb->len, fb->width, fb->height);
  return fb;
}

// ── Image Upload & Cloud Record ───────────────────────────────────────────────
static String uploadImage(camera_fb_t *fb, const char *sessionId,
                           const char *localMaterialType, float localConfidence) {
  if (WiFi.status() != WL_CONNECTED) return "";

  for (int attempt = 1; attempt <= BACKGROUND_SYNC_MAX_ATTEMPTS; attempt++) {
    WiFiClientSecure client;
    client.setInsecure();
    client.setTimeout(BACKGROUND_SYNC_TIMEOUT_MS);

    if (!client.connect(BACKEND_HOST, BACKEND_PORT)) {
      if (attempt < BACKGROUND_SYNC_MAX_ATTEMPTS) { delay(250); continue; }
      return "";
    }

    const char *boundary = "FibottBoundaryS3_42";

    String sessionPart;
    if (sessionId && strlen(sessionId) > 0) {
      sessionPart  = "--"; sessionPart += boundary; sessionPart += "\r\n";
      sessionPart += "Content-Disposition: form-data; name=\"sessionId\"\r\n\r\n";
      sessionPart += sessionId; sessionPart += "\r\n";
    }

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

    String imagePart;
    imagePart  = "--"; imagePart += boundary; imagePart += "\r\n";
    imagePart += "Content-Disposition: form-data; name=\"image\"; filename=\"frame.jpg\"\r\n";
    imagePart += "Content-Type: image/jpeg\r\n\r\n";

    String footer = "\r\n--"; footer += boundary; footer += "--\r\n";

    size_t contentLen = sessionPart.length() + localTypePart.length() + localConfPart.length()
                       + imagePart.length() + fb->len + footer.length();

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

    const size_t CHUNK = 4096;
    for (size_t off = 0; off < fb->len; off += CHUNK) {
      size_t toWrite = min(CHUNK, fb->len - off);
      client.write(fb->buf + off, toWrite);
    }
    client.print(footer);
    client.flush();

    String statusLine = client.readStringUntil('\n');
    LOGF("UPLOAD", "HTTP Status: %s", statusLine.c_str());

    while (client.connected()) {
      if (client.readStringUntil('\n') == "\r") break;
    }
    String body = client.readString();
    client.stop();

    int jStart = body.indexOf('{');
    int jEnd   = body.lastIndexOf('}');
    String jsonBody = (jStart >= 0 && jEnd > jStart) ? body.substring(jStart, jEnd + 1) : body;

    JsonDocument doc;
    if (deserializeJson(doc, jsonBody) == DeserializationError::Ok) {
      String action = doc["servoAction"].as<String>();
      return action;
    }
  }
  return "";
}

// ── ESP32-S3 Local ML Engine & Strict Heuristics ──────────────────────────────
static uint8_t *tensorArenaBuffer = nullptr;
static uint8_t *rgbDecodeBuffer   = nullptr;
static bool tfliteInitialized     = false;

static const tflite::Model      *tfliteModel        = nullptr;
static tflite::MicroInterpreter *tfliteInterpreter   = nullptr;
static TfLiteTensor             *tfliteInputTensor   = nullptr;
static TfLiteTensor             *tfliteOutputTensor  = nullptr;

static bool initLocalML() {
  if (tfliteInitialized) return true;

  LOG("TINYML", "Initialising MobileNetV1 96x96 INT8 on ESP32-S3 Vector Engine...");
  size_t rgbBufferBytes = (size_t)CAPTURE_WIDTH * (size_t)CAPTURE_HEIGHT * 3;

  if (psramFound()) {
    tensorArenaBuffer = (uint8_t*) heap_caps_malloc(MODEL_TENSOR_ARENA_SIZE, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    rgbDecodeBuffer   = (uint8_t*) heap_caps_malloc(rgbBufferBytes, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  }

  if (!tensorArenaBuffer) tensorArenaBuffer = (uint8_t*) malloc(MODEL_TENSOR_ARENA_SIZE);
  if (!rgbDecodeBuffer)   rgbDecodeBuffer   = (uint8_t*) malloc(rgbBufferBytes);

  if (!tensorArenaBuffer || !rgbDecodeBuffer) {
    LOG("TINYML", "ERROR: PSRAM/SRAM allocation failed!");
    return false;
  }

  tfliteModel = tflite::GetModel(g_model_data);
  if (tfliteModel->version() != TFLITE_SCHEMA_VERSION) {
    LOGF("TINYML", "ERROR: Model schema version %d mismatch", (int)tfliteModel->version());
    return false;
  }

  static tflite::AllOpsResolver resolver;
  static tflite::MicroInterpreter staticInterpreter(
      tfliteModel, resolver, tensorArenaBuffer, MODEL_TENSOR_ARENA_SIZE);
  tfliteInterpreter = &staticInterpreter;

  if (tfliteInterpreter->AllocateTensors() != kTfLiteOk) {
    LOG("TINYML", "ERROR: AllocateTensors() failed");
    return false;
  }

  tfliteInputTensor  = tfliteInterpreter->input(0);
  tfliteOutputTensor = tfliteInterpreter->output(0);
  tfliteInitialized  = true;
  LOG("TINYML", "ESP32-S3 MobileNetV1 Engine initialized successfully!");
  return true;
}

static LocalClassificationResult classifyLocallyML(camera_fb_t *fb) {
  LocalClassificationResult res;
  res.materialType = "REJECTED";
  res.rejectReason = "unknown";
  res.petProb      = 0.0f;
  res.canProb      = 0.0f;
  res.confidence   = 0.0f;
  res.isConfident  = false;

  if (!fb || !fb->buf || fb->len == 0) {
    res.rejectReason = "empty_frame";
    return res;
  }

  if (!tfliteInitialized && !initLocalML()) {
    res.rejectReason = "ml_init_failed";
    return res;
  }

  unsigned long startMs = millis();

  // 1. Decode JPEG to RGB888 in Octal PSRAM
  int srcW = fb->width;
  int srcH = fb->height;

  if (!fmt2rgb888(fb->buf, fb->len, fb->format, rgbDecodeBuffer)) {
    LOG("TINYML", "ERROR: RGB888 decode failed");
    res.rejectReason = "decode_failed";
    return res;
  }

  // 2. Run Visual Heuristics (Hand & Paper & Empty chute filters)
  int skinPixelCount   = 0;
  long totalBrightness = 0;
  long totalColorDiff  = 0;
  int sampleCount      = 0;

  int totalPixels = srcW * srcH;
  int step = 6; // Fast sampling step

  for (int i = 0; i < totalPixels * 3; i += (step * 3)) {
    uint8_t r = rgbDecodeBuffer[i];
    uint8_t g = rgbDecodeBuffer[i + 1];
    uint8_t b = rgbDecodeBuffer[i + 2];

    int brightness = (r + g + b) / 3;
    totalBrightness += brightness;

    int diff = abs(r - g) + abs(g - b) + abs(b - r);
    totalColorDiff += diff;

    // Skin Tone heuristic: Human skin under LED lighting (R > G > B, significant red bias)
    if (r > 80 && g > 45 && b > 20 && (r > g) && (g > b) && (r - g > 15) && (r - b > 22)) {
      skinPixelCount++;
    }
    sampleCount++;
  }

  float skinRatio     = sampleCount > 0 ? (float)skinPixelCount / sampleCount : 0.0f;
  float avgBrightness = sampleCount > 0 ? (float)totalBrightness / sampleCount : 0.0f;
  float avgColorDiff  = sampleCount > 0 ? (float)totalColorDiff / sampleCount : 0.0f;

  LOGF("FILTER", "Scene stats: Brightness=%.1f, ColorDiff=%.1f, SkinRatio=%.1f%%",
       avgBrightness, avgColorDiff, skinRatio * 100.0f);

  // Rejection check: Non-bottle/non-can skin-like or organic feature
  if (FILTER_ENABLE_HAND_DETECTION && skinRatio > 0.16f) {
    LOGF("FILTER", "🚫 REJECTED: Non-bottle/can organic object detected (%.1f%%)", skinRatio * 100.0f);
    res.materialType = "REJECTED";
    res.rejectReason = "not_bottle_or_can";
    res.confidence = skinRatio;
    return res;
  }

  // Rejection check: Flat non-bottle/non-can sheet (paper, cardboard, tissue, flat packaging)
  if (FILTER_ENABLE_PAPER_DETECTION && avgBrightness > 155.0f && avgColorDiff < 7.5f) {
    LOGF("FILTER", "🚫 REJECTED: Non-bottle/can flat material detected (Brightness=%.1f)", avgBrightness);
    res.materialType = "REJECTED";
    res.rejectReason = "not_bottle_or_can";
    res.confidence = 0.90f;
    return res;
  }

  // Rejection check: Empty chute / no object placed
  if (FILTER_ENABLE_EMPTY_CHUTE && avgBrightness < 22.0f) {
    LOGF("FILTER", "🚫 REJECTED: Empty chute / no bottle or can detected (Brightness=%.1f)", avgBrightness);
    res.materialType = "REJECTED";
    res.rejectReason = "not_bottle_or_can";
    res.confidence = 0.90f;
    return res;
  }

  // 3. Preprocess & Quantize into TFLite Input Tensor
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

  // 4. Run MobileNetV1 Inference (Accelerated by ESP32-S3 Vector DSP)
  if (tfliteInterpreter->Invoke() != kTfLiteOk) {
    LOG("TINYML", "ERROR: Invoke() failed");
    res.rejectReason = "not_bottle_or_can";
    return res;
  }

  // 5. Dequantize output probabilities
  int8_t petRawOut = tfliteOutputTensor->data.int8[MODEL_CLASS_PET_BOTTLE];
  int8_t canRawOut = tfliteOutputTensor->data.int8[MODEL_CLASS_ALUMINUM_CAN];
  res.petProb = ((float)petRawOut - (float)MODEL_OUTPUT_ZERO_POINT) * MODEL_OUTPUT_SCALE;
  res.canProb = ((float)canRawOut - (float)MODEL_OUTPUT_ZERO_POINT) * MODEL_OUTPUT_SCALE;

  float margin = fabs(res.petProb - res.canProb);

  if (res.canProb > res.petProb) {
    res.materialType = "ALUMINUM_CAN";
    res.confidence   = res.canProb;
  } else {
    res.materialType = "PET_BOTTLE";
    res.confidence   = res.petProb;
  }

  // GENERAL REJECTION: Only genuine bottles or cans with high confidence & margin pass
  res.isConfident = (res.confidence >= ML_CONFIDENCE_THRESHOLD && margin >= ML_MARGIN_THRESHOLD);

  if (!res.isConfident) {
    res.materialType = "REJECTED";
    res.rejectReason = "not_bottle_or_can";
  }

  unsigned long elapsedMs = millis() - startMs;
  LOGF("TINYML", "Inference in %lums | %s (PET=%.2f, CAN=%.2f, margin=%.2f, pass=%s)",
       elapsedMs, res.materialType, res.petProb, res.canProb, margin, res.isConfident ? "YES" : "NO");

  return res;
}

// ── WiFi Watchdog ─────────────────────────────────────────────────────────────
static void ensureWifi() {
  if (WiFi.status() == WL_CONNECTED) return;

  unsigned long now = millis();
  if (now - lastWifiWarnMs > 30000) {
    LOG("WIFI", "WARN: Reconnecting to WiFi...");
    lastWifiWarnMs = now;
  }

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  unsigned long deadline = millis() + 15000;
  while (WiFi.status() != WL_CONNECTED && millis() < deadline) {
    delay(500);
  }
}

static void maybeHeartbeat() {
  unsigned long now = millis();
  if (now - lastHeartbeatMs < HEARTBEAT_INTERVAL_MS) return;
  lastHeartbeatMs = now;

  char details[128];
  snprintf(details, sizeof(details), "heap=%u psram=%u state=IDLE v=%s", 
           ESP.getFreeHeap(), ESP.getFreePsram(), FIRMWARE_VERSION);
  sendLog("INFO", "HEARTBEAT", "ESP32-S3 Vision node online", details);
}

// ── Setup ─────────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println("\n");
  Serial.println("╔══════════════════════════════════════════════════════════════════════╗");
  Serial.println("║   Fibott ESP32-S3 N16R8 CAM (OV3640) Vision & AI Inference Node     ║");
  Serial.printf( "║  Firmware v%-58s║\n", FIRMWARE_VERSION);
  Serial.println("║  Hardware: Dual-Core LX7 240MHz | 16MB Flash | 8MB Octal PSRAM       ║");
  Serial.println("║  Wireless Link: ESP-NOW 2.4 GHz -> Kiosk Controller (0 Wires)       ║");
  Serial.println("╚══════════════════════════════════════════════════════════════════════╝");
  Serial.println();

  // Print Chip & Memory Diagnostics
  LOGF("BOOT", "Chip Model: %s (Rev %d), CPU: %d MHz, Cores: 2", 
       ESP.getChipModel(), ESP.getChipRevision(), ESP.getCpuFreqMHz());
  LOGF("BOOT", "Flash Size: %u MB, PSRAM Size: %u MB (Free: %u KB)",
       ESP.getFlashChipSize() / (1024 * 1024),
       ESP.getPsramSize() / (1024 * 1024),
       ESP.getFreePsram() / 1024);

  ledInit();
  ledOff();

  flashSetup();

  LOG("BOOT", "Initialising OV3640 camera sensor...");
  if (!cameraInit()) {
    LOG("BOOT", "FATAL: Camera init failed — entering blink halt loop");
    while (true) {
      ledOn();  delay(100);
      ledOff(); delay(100);
    }
  }

  // Pre-initialize TinyML Engine in PSRAM
  initLocalML();

  // Wi-Fi Connection
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.setSleep(false);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long wifiDeadline = millis() + 20000;
  while (WiFi.status() != WL_CONNECTED && millis() < wifiDeadline) {
    delay(500);
  }

  if (WiFi.status() == WL_CONNECTED) {
    LOGF("WIFI", "Connected! IP: %s (RSSI: %d dBm, Channel: %d)",
         WiFi.localIP().toString().c_str(), WiFi.RSSI(), WiFi.channel());
    sendLog("INFO", "BOOT", "ESP32-S3 N16R8 Vision node online", WiFi.localIP().toString().c_str());
  }

  // Initialize ESP-NOW wireless transmitter on current Wi-Fi channel
  wirelessSetup();

  // Notify 2nd ESP32 that Vision Node has booted (wirelessly!)
  sendControllerCmd("CMD:BOOT");

  LOG("BOOT", "ESP32-S3 Boot sequence complete — State: IDLE");
}

// ── Main Loop ─────────────────────────────────────────────────────────────────
void loop() {
  ensureWifi();

  switch (state) {

    case STATE_IDLE: {
      maybeHeartbeat();

      char sessionId[128] = "";
      if (!pollSession(sessionId, sizeof(sessionId))) {
        delay(POLL_INTERVAL_MS);
        break;
      }

      strncpy(activeSessionId, sessionId, sizeof(activeSessionId));
      LOGF("FSM", "IDLE -> READY (session=%s)", activeSessionId);
      state = STATE_READY;
      break;
    }

    case STATE_READY: {
      LOG("FSM", "READY — Notifying 2nd ESP32 to prompt user");
      sendControllerCmd("CMD:READY"); // 2nd ESP32 beeps & blinks LED

      // Wait 0.8s for user to place item and motion to settle
      delay(800);

      LOG("FSM", "READY -> PROCESSING (capturing frame)");
      ledOn();
      state = STATE_PROCESSING;
      break;
    }

    case STATE_PROCESSING: {
      camera_fb_t *fb = captureImage();
      if (!fb) {
        LOG("FSM", "Frame capture failed — retrying in 1s");
        ledOff();
        sendControllerCmd("CMD:ERROR");
        delay(1000);
        break;
      }

      // Run Local TinyML & Anti-False-Positive Filter checks on ESP32-S3
      LocalClassificationResult mlRes = classifyLocallyML(fb);

      if (mlRes.isConfident) {
        LOGF("FSM", "✅ Item ACCEPTED (%s) — Triggering Servo Gate on 2nd ESP32!", mlRes.materialType);

        // Command 2nd ESP32 to open servo gate for 3s and play accept chime
        sendControllerCmd("CMD:OPEN");

        // Sync deposit with cloud backend in background
        uploadImage(fb, activeSessionId, mlRes.materialType, mlRes.confidence);

        esp_camera_fb_return(fb);
        ledOff();

        activeSessionId[0] = '\0';
        LOG("FSM", "Deposit SUCCESS -> IDLE");
        state = STATE_IDLE;
      } else {
        LOGF("FSM", "❌ Item REJECTED (Reason: %s, Conf: %.2f) — Gate stays LOCKED 🔒",
             mlRes.rejectReason, mlRes.confidence);

        // Command 2nd ESP32 to flash reject pattern and ensure servo gate remains locked
        sendControllerCmd("CMD:REJECT");

        // Notify user's mobile app of rejection with specific reason
        sendRejectResult(activeSessionId, mlRes.rejectReason, mlRes.confidence);

        char logDetails[128];
        snprintf(logDetails, sizeof(logDetails), "reason=%s pet=%.2f can=%.2f conf=%.2f",
                 mlRes.rejectReason, mlRes.petProb, mlRes.canProb, mlRes.confidence);
        sendLog("WARN", "REJECT", "Non-recyclable or unrecognized item rejected", logDetails);

        esp_camera_fb_return(fb);
        ledOff();

        activeSessionId[0] = '\0';
        LOG("FSM", "REJECTED -> IDLE");
        state = STATE_IDLE;
      }
      break;
    }

    case STATE_ERROR: {
      sendControllerCmd("CMD:ERROR");
      delay(RETRY_DELAY_MS);
      state = STATE_IDLE;
      break;
    }
  }
}
