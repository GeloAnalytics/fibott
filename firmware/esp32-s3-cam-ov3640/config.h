#pragma once

// ═══════════════════════════════════════════════════════════════════════════════
// Fibott ESP32-S3 N16R8 CAM (OV3640) Vision & AI Node — config.h
// (ESP32-S3 Dual-Core LX7 + 16MB Flash + 8MB Octal PSRAM + OV3640 3MP Sensor)
//
// In this architecture:
//   - ESP32-S3 CAM is DEDICATED to OV3640 Camera + MobileNet TinyML + Cloud Sync.
//   - The Servo Gate is driven by the secondary ESP32 (Kiosk Controller).
//   - Commands (CMD:OPEN, CMD:REJECT, CMD:READY, CMD:BOOT, etc.) are sent wirelessly
//     via 2.4 GHz ESP-NOW with ZERO physical wiring between boards.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Firmware Version ──────────────────────────────────────────────────────────
#define FIRMWARE_VERSION "3.0.0-s3-n16r8-ov3640"

// ── Camera Hardware Board Model Selection ─────────────────────────────────────
// Select your board type below (CAMERA_MODEL_ESP32S3_CAM_N16R8 is standard):
#define CAMERA_MODEL_ESP32S3_CAM_N16R8
// #define CAMERA_MODEL_ESP32S3_EYE
// #define CAMERA_MODEL_XIAO_ESP32S3
// #define CAMERA_MODEL_WAVESHARE_ESP32S3_CAM
// #define CAMERA_MODEL_CUSTOM

// ── Strict Local ML Inference & Rejection Configuration ─────────────────────
// 2-class softmax model (PET vs CAN). Random clutter, hands, and paper
// output ~0.50-0.65 probability. Genuine bottles & cans output >0.80.
// Setting threshold to 0.78f and margin to 0.50f ensures non-bottles and non-cans
// (hands, paper, cups, trash) are strictly REJECTED!
#define ML_CONFIDENCE_THRESHOLD 0.78f
#define ML_MARGIN_THRESHOLD     0.50f   // |petProb - canProb| must be >= 0.50

// ── Smart Anti-False-Positive Heuristic Filters ───────────────────────────────
#define FILTER_ENABLE_HAND_DETECTION  true  // Detect human skin tones in chute
#define FILTER_ENABLE_PAPER_DETECTION true  // Detect flat white/paper sheets
#define FILTER_ENABLE_EMPTY_CHUTE     true  // Detect blank/empty dark chute

// ── Camera Capture & OV3640 Sensor Settings ──────────────────────────────────
// ESP32-S3 with 8MB OPI PSRAM easily supports higher resolutions & double-buffering.
// For MobileNetV1 TinyML inference and fast cloud upload, QVGA (320x240) provides
// optimal balance of frame rate, inference latency, and image clarity.
#define CAPTURE_FRAMESIZE  FRAMESIZE_QVGA   // Options: FRAMESIZE_QVGA, FRAMESIZE_VGA, FRAMESIZE_SVGA
#define CAPTURE_WIDTH      320
#define CAPTURE_HEIGHT     240
#define CAPTURE_JPEG_QUAL  10               // 10 = High Quality (1-63, lower is better)
#define CAPTURE_FB_COUNT   2                // Double-buffered DMA in 8MB Octal PSRAM

// ── Flash LED Illumination Settings ───────────────────────────────────────────
// If your board has an onboard Flash LED (e.g. GPIO48 / GPIO21 / GPIO4)
#define FLASH_BRIGHTNESS   0.50f            // 50% PWM brightness to prevent overexposure

// ── WiFi Configuration ────────────────────────────────────────────────────────
#define WIFI_SSID     "Fibott"
#define WIFI_PASSWORD ""

// ── Backend API Configuration ─────────────────────────────────────────────────
#define BACKEND_HOST   "fibott.vercel.app"
#define BACKEND_PORT   443
#define DEVICE_API_KEY "fibott_dev_7cd2f63b3fcaae7fa973ea58d8f94680df86c05f589bd189"
#define PATH_LOGS      "/api/device/logs"

// ── Wireless Inter-ESP32 Protocol (ESP-NOW 2.4 GHz) ───────────────────────────
// Zero physical wiring between ESP32-S3 CAM and ESP32 DevKit Controller!
// Commands are broadcast over ESP-NOW on the active Wi-Fi channel.
#define WIRELESS_MAGIC          "FIBO"
#define WIRELESS_ESPNOW_CHANNEL 0      // 0 = follow current active Wi-Fi channel

// ── System Timing Constants ───────────────────────────────────────────────────
#define BACKEND_TIMEOUT_S            15
#define BACKEND_TIMEOUT_MS           (BACKEND_TIMEOUT_S * 1000)

#define BACKGROUND_SYNC_TIMEOUT_S    20
#define BACKGROUND_SYNC_TIMEOUT_MS   (BACKGROUND_SYNC_TIMEOUT_S * 1000)
#define BACKGROUND_SYNC_MAX_ATTEMPTS 2

#define POLL_INTERVAL_MS             500
#define RETRY_DELAY_MS               2000
#define HEARTBEAT_INTERVAL_MS        60000
