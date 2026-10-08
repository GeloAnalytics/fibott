/*
 * Fibott — ESP32-CAM Vision & AI Inference Firmware
 * 
 * ── Dual-ESP32 Wireless Architecture (Vision & Cloud Node) ───────────────────
 *
 * Board:    AI Thinker ESP32-CAM  (Arduino IDE → Tools → Board)
 * PSRAM:    Tools → PSRAM → "OPI PSRAM"  (REQUIRED — camera will not init without it)
 * Flash:    micro-USB via onboard CH340C (or FTDI: GPIO0 to GND during upload)
 *
 * Libraries required:
 *   - ArduinoJson  ≥ 7.0  (by Benoit Blanchon)
 *   - "Chirale_TensorFlowLite" (Library Manager)
 *
 * ── Wireless Interconnect (ZERO Physical Wiring to 2nd ESP32) ────────────────
 *   Communication with the Kiosk Controller is 100% wireless over 2.4 GHz ESP-NOW.
 *   - No UART TX/RX wires
 *   - No common ground wire needed (electrically isolated power domains)
 *   - ESP32-CAM GPIO33  →  Onboard red status LED (active-LOW)
 *   - ESP32-CAM GPIO4   →  Onboard Flash LED (dimmed PWM for chute illumination)
 *
 * ── Rejection Capabilities ───────────────────────────────────────────────────
 *   - Strict MobileNet INT8 Confidence Threshold (>= 78% & margin >= 50%)
 *   - Real-time Human Hand / Skin Tone rejection filter
 *   - Flat Paper / Cardboard / Tissue rejection filter
 *   - Blank / Empty chute rejection filter
 */

#include "config.h"
#include "esp_camera.h"
#include "img_converters.h"
#include "model_data.h"
#include "driver/ledc.h"
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <esp_now.h>

// ── TensorFlow Lite Micro ───────────────────────────────────────────────────
#include <Chirale_TensorFlowLite.h>
#include "tensorflow/lite/micro/all_ops_resolver.h"
#include "tensorflow/lite/micro/micro_interpreter.h"
#include "tensorflow/lite/schema/schema_generated.h"

// ── Wireless Command Packet Struct ───────────────────────────────────────────
typedef struct __attribute__((packed)) {
  char magic[4];        // "FIBO"
  uint8_t version;      // 1
  char command[24];     // "CMD:OPEN", "CMD:REJECT", "CMD:READY", "CMD:BOOT", "CMD:ERROR"
  uint32_t seq;         // Monotonic packet sequence counter
} WirelessCommandPacket;

static uint8_t espNowBroadcastMac[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
static bool espNowReady = false;
static uint32_t packetSeqNum = 0;

struct LocalClassificationResult {
  const char* materialType; // "PET_BOTTLE", "ALUMINUM_CAN", or "REJECTED"
  const char* rejectReason; // "low_confidence", "hand_detected", "paper_detected", etc.
  float petProb;
  float canProb;
  float confidence;
  bool isConfident;
};

// ── Serial diagnostic macros ──────────────────────────────────────────────────
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
  STATE_ERROR
};
static KioskState state = STATE_IDLE;
static char activeSessionId[128] = "";

static unsigned long lastHeartbeatMs = 0;
static unsigned long lastWifiWarnMs  = 0;

// ── Status LED (GPIO33, Active-LOW) ──────────────────────────────────────────
static void ledOn()  { digitalWrite(PIN_LED_STATUS, LOW);  }
static void ledOff() { digitalWrite(PIN_LED_STATUS, HIGH); }

// ── Flash LED Dimming Control (GPIO4, LEDC Timer 3 / Channel 3) ──────────────
#define FLASH_PWM_RESOLUTION_BITS 10
#define FLASH_PWM_MAX_DUTY        ((1 << FLASH_PWM_RESOLUTION_BITS) - 1)

static void flashSetup() {
  LOGF("FLASH", "Initialising dimmable flash on GPIO4 (%.0f%% brightness)", FLASH_BRIGHTNESS * 100);
  ledc_timer_config_t tc = {};
  tc.speed_mode      = LEDC_LOW_SPEED_MODE;
  tc.duty_resolution = (ledc_timer_bit_t)FLASH_PWM_RESOLUTION_BITS;
  tc.timer_num       = LEDC_TIMER_3;
  tc.freq_hz         = 5000;
  tc.clk_cfg         = LEDC_AUTO_CLK;
  ledc_timer_config(&tc);

  ledc_channel_config_t cc = {};
  cc.gpio_num   = 4;
  cc.speed_mode = LEDC_LOW_SPEED_MODE;
  cc.channel    = LEDC_CHANNEL_3;
  cc.intr_type  = LEDC_INTR_DISABLE;
  cc.timer_sel  = LEDC_TIMER_3;
  cc.duty       = 0;
  cc.hpoint     = 0;
  ledc_channel_config(&cc);
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

// ── Wireless Setup (ESP-NOW 2.4 GHz) ──────────────────────────────────────────
static void wirelessSetup() {
  LOG("WIRELESS", "Initialising ESP-NOW wireless transmitter (0 physical wires)...");

  if (esp_now_init() != ESP_OK) {
    LOG("WIRELESS", "WARN: esp_now_init failed! Actuation commands will not transmit.");
    return;
  }

  esp_now_peer_info_t peerInfo = {};
  memcpy(peerInfo.peer_addr, espNowBroadcastMac, 6);
  peerInfo.channel = 0; // 0 = follow current active Wi-Fi channel
  peerInfo.encrypt = false;

  if (esp_now_add_peer(&peerInfo) != ESP_OK) {
    LOG("WIRELESS", "WARN: Failed to add ESP-NOW broadcast peer.");
  } else {
    espNowReady = true;
    LOG("WIRELESS", "ESP-NOW broadcast ready (channel follows active Wi-Fi).");
  }
}

// ── Send Command to 2nd ESP32 Controller via ESP-NOW ──────────────────────────
static void sendControllerCmd(const char* cmd) {
  if (!cmd || strlen(cmd) == 0) return;

  LOGF("WIRELESS→ACTUATOR", "%s", cmd);

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
    LOG("WIRELESS", "WARN: ESP-NOW not initialized, command not sent over the air");
  }
}

// ── Camera Initialization ─────────────────────────────────────────────────────
static bool cameraInit() {
  LOG("CAMERA", "Initialising OV2640 with PSRAM...");

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
  cfg.frame_size   = CAPTURE_FRAMESIZE;
  cfg.jpeg_quality = 12;
  cfg.fb_count     = 1;
  cfg.fb_location  = CAMERA_FB_IN_PSRAM;
  cfg.grab_mode    = CAMERA_GRAB_LATEST;

  esp_err_t err = esp_camera_init(&cfg);
  if (err != ESP_OK) {
    LOGF("CAMERA", "FATAL: esp_camera_init failed (0x%x)", err);
    return false;
  }

  sensor_t *s = esp_camera_sensor_get();
  if (s) {
    s->set_brightness(s, 1);
    s->set_saturation(s, -1);
    s->set_gainceiling(s, GAINCEILING_16X);
    s->set_aec2(s, 1);
    s->set_ae_level(s, 1);
  }

  LOGF("CAMERA", "OV2640 ready (%dx%d QVGA)", CAPTURE_WIDTH, CAPTURE_HEIGHT);
  return true;
}

// ── Telemetry: Send Log to Backend ────────────────────────────────────────────
static void sendLog(const char* level, const char* tag, const char* message, const char* details = nullptr) {
  if (WiFi.status() != WL_CONNECTED) return;

  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(8000); // 8s timeout in ms

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

    const char *boundary = "FibottBoundary42";

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

// ── ESP32 Local ML Engine & Strict Heuristics ─────────────────────────────────
static uint8_t *tensorArenaBuffer = nullptr;
static uint8_t *rgbDecodeBuffer   = nullptr;
static bool tfliteInitialized     = false;

static const tflite::Model      *tfliteModel        = nullptr;
static tflite::MicroInterpreter *tfliteInterpreter   = nullptr;
static TfLiteTensor             *tfliteInputTensor   = nullptr;
static TfLiteTensor             *tfliteOutputTensor  = nullptr;

static bool initLocalML() {
  if (tfliteInitialized) return true;

  LOG("TINYML", "Initialising MobileNetV1 96x96 INT8 TFLite Micro...");
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
  LOG("TINYML", "Engine initialized successfully!");
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

  // 1. Decode JPEG to RGB888
  int srcW = fb->width;
  int srcH = fb->height;

  if (!fmt2rgb888(fb->buf, fb->len, fb->format, rgbDecodeBuffer)) {
    LOG("TINYML", "ERROR: RGB888 decode failed");
    res.rejectReason = "decode_failed";
    return res;
  }

  // 2. Run Visual Heuristics (Hand & Paper & Empty chute filters)
  int skinPixelCount = 0;
  long totalBrightness = 0;
  long totalColorDiff  = 0;
  int sampleCount = 0;

  int totalPixels = srcW * srcH;
  int step = 6; // sample every 6th pixel for high speed

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

  float skinRatio = sampleCount > 0 ? (float)skinPixelCount / sampleCount : 0.0f;
  float avgBrightness = sampleCount > 0 ? (float)totalBrightness / sampleCount : 0.0f;
  float avgColorDiff = sampleCount > 0 ? (float)totalColorDiff / sampleCount : 0.0f;

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

  // 4. Run MobileNetV1 Inference
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

  char details[64];
  snprintf(details, sizeof(details), "heap=%u state=IDLE v=%s", ESP.getFreeHeap(), FIRMWARE_VERSION);
  sendLog("INFO", "HEARTBEAT", "Vision node online", details);
}

// ── Setup ─────────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(200);

  Serial.println("\n");
  Serial.println("╔══════════════════════════════════════════════════╗");
  Serial.println("║   Fibott ESP32-CAM (Dedicated Vision & AI)       ║");
  Serial.printf( "║  Firmware v%-38s║\n", FIRMWARE_VERSION);
  Serial.println("║  Wireless ESP-NOW Link → Kiosk Controller (0 Wires)║");
  Serial.println("╚══════════════════════════════════════════════════╝");
  Serial.println();

  pinMode(PIN_LED_STATUS, OUTPUT);
  ledOff();

  flashSetup();

  LOG("BOOT", "Starting OV2640 camera...");
  if (!cameraInit()) {
    LOG("BOOT", "FATAL: Camera init failed — entering blink halt loop");
    while (true) {
      ledOn();  delay(100);
      ledOff(); delay(100);
    }
  }

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
    sendLog("INFO", "BOOT", "ESP32-CAM Vision node online", WiFi.localIP().toString().c_str());
  }

  // Initialize ESP-NOW wireless transmitter on current Wi-Fi channel
  wirelessSetup();

  // Notify 2nd ESP32 that Vision Node has booted (wirelessly!)
  sendControllerCmd("CMD:BOOT");

  LOG("BOOT", "Boot sequence complete — State: IDLE");
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
      LOGF("FSM", "IDLE → READY (session=%s)", activeSessionId);
      state = STATE_READY;
      break;
    }

    case STATE_READY: {
      LOG("FSM", "READY — Notifying 2nd ESP32 to prompt user");
      sendControllerCmd("CMD:READY"); // 2nd ESP32 beeps & blinks LED

      // Wait 0.8s for user to insert item and motion to settle
      delay(800);

      LOG("FSM", "READY → PROCESSING (capturing frame)");
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

      // Run Local TinyML & Anti-False-Positive Filter checks
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
        LOG("FSM", "Deposit SUCCESS → IDLE");
        state = STATE_IDLE;
      } else {
        LOGF("FSM", "❌ Item REJECTED (Reason: %s, Conf: %.2f) — Gate stays LOCKED 🔒",
             mlRes.rejectReason, mlRes.confidence);

        // Command 2nd ESP32 to play 3 reject beeps and ensure servo gate remains locked
        sendControllerCmd("CMD:REJECT");

        // Notify user's mobile app of rejection with reason
        sendRejectResult(activeSessionId, mlRes.rejectReason, mlRes.confidence);

        char logDetails[128];
        snprintf(logDetails, sizeof(logDetails), "reason=%s pet=%.2f can=%.2f conf=%.2f",
                 mlRes.rejectReason, mlRes.petProb, mlRes.canProb, mlRes.confidence);
        sendLog("WARN", "REJECT", "Non-recyclable or unrecognized item rejected", logDetails);

        esp_camera_fb_return(fb);
        ledOff();

        activeSessionId[0] = '\0';
        LOG("FSM", "REJECTED → IDLE");
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
