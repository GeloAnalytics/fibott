#pragma once

// ═══════════════════════════════════════════════════════════════════════════════
// Fibott ESP32-CAM Vision & AI Inference Firmware — config.h
// (Dual-ESP32 Wireless Architecture: Vision & Cloud Node)
//
// In this wireless architecture:
//   - ESP32-CAM is DEDICATED to Camera + TinyML + Cloud Sync.
//   - The Servo Gate and Buzzer are driven by the secondary ESP32 (Kiosk Controller).
//   - ESP32-CAM sends trigger commands (CMD:OPEN, CMD:REJECT, CMD:READY, etc.)
//     wirelessly via 2.4 GHz ESP-NOW with ZERO physical wiring between boards.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Firmware Version ──────────────────────────────────────────────────────────
#define FIRMWARE_VERSION "2.1.0-wireless-espnow-vision"

// ── Strict Local ML Inference & Rejection Configuration ─────────────────────
// With a 2-class softmax model (PET vs CAN), random clutter / hands / paper
// will output ~0.50-0.65 probability. Genuine bottles & cans output >0.80.
// Setting threshold to 0.78f and margin to 0.50f ensures non-bottles and non-cans
// (hands, paper, cups, trash) are strictly REJECTED!
#define ML_CONFIDENCE_THRESHOLD 0.78f
#define ML_MARGIN_THRESHOLD     0.50f   // |petProb - canProb| must be >= 0.50

// ── Smart Anti-False-Positive Heuristic Filters ───────────────────────────────
#define FILTER_ENABLE_HAND_DETECTION  true  // Detect human skin tones in chute
#define FILTER_ENABLE_PAPER_DETECTION true  // Detect flat white/paper sheets
#define FILTER_ENABLE_EMPTY_CHUTE     true  // Detect blank/empty dark chute

// ── Camera Capture Resolution ─────────────────────────────────────────────────
#define CAPTURE_FRAMESIZE  FRAMESIZE_QVGA
#define CAPTURE_WIDTH      320
#define CAPTURE_HEIGHT     240

// ── Flash LED Brightness ──────────────────────────────────────────────────────
#define FLASH_BRIGHTNESS   0.50f  // 50% PWM brightness to prevent overexposure

// ── WiFi Configuration ────────────────────────────────────────────────────────
#define WIFI_SSID     "Fibott"
#define WIFI_PASSWORD ""

// ── Backend API Configuration ─────────────────────────────────────────────────
#define BACKEND_HOST   "fibott.vercel.app"
#define BACKEND_PORT   443
#define DEVICE_API_KEY "fibott_dev_7cd2f63b3fcaae7fa973ea58d8f94680df86c05f589bd189"
#define PATH_LOGS      "/api/device/logs"

// ── Wireless Inter-ESP32 Protocol (ESP-NOW 2.4 GHz) ───────────────────────────
// Zero physical wiring between ESP32-CAM and ESP32 DevKit Controller!
// Commands are broadcast over ESP-NOW on the active Wi-Fi channel.
#define WIRELESS_MAGIC        "FIBO"
#define WIRELESS_ESPNOW_CHANNEL 0      // 0 = follow current active Wi-Fi channel

// ── Status LED Configuration ──────────────────────────────────────────────────
#define PIN_LED_STATUS 33 // Onboard red LED (active-LOW)

// ── System Timing Constants ───────────────────────────────────────────────────
#define BACKEND_TIMEOUT_S            15
#define BACKEND_TIMEOUT_MS           (BACKEND_TIMEOUT_S * 1000)

#define BACKGROUND_SYNC_TIMEOUT_S    20
#define BACKGROUND_SYNC_TIMEOUT_MS   (BACKGROUND_SYNC_TIMEOUT_S * 1000)
#define BACKGROUND_SYNC_MAX_ATTEMPTS 2

#define POLL_INTERVAL_MS             500
#define RETRY_DELAY_MS               2000
#define HEARTBEAT_INTERVAL_MS        60000
