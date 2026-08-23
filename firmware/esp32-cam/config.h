#pragma once

// ── WiFi ─────────────────────────────────────────────────────────────────────
#define WIFI_SSID     "Fibott"
#define WIFI_PASSWORD "Fibott@2026"

// ── Backend ───────────────────────────────────────────────────────────────────
#define BACKEND_HOST  "fibott.vercel.app"
#define BACKEND_PORT  443
#define DEVICE_API_KEY "fibott_dev_7cd2f63b3fcaae7fa973ea58d8f94680df86c05f589bd189"
#define PATH_LOGS      "/api/device/logs"

// ── Servo ─────────────────────────────────────────────────────────────────────
// GPIO13 is safe (not a strapping pin). Do NOT use GPIO12 (MTDI strapping pin).
#define PIN_SERVO       13
#define SERVO_CLOSED_US 1500   // calibrate once assembled
#define SERVO_OPEN_US   2000

// ── Status LED ────────────────────────────────────────────────────────────────
#define PIN_LED_STATUS 33      // onboard red LED, active-LOW

// ── Timing ────────────────────────────────────────────────────────────────────
#define BACKEND_TIMEOUT_S 15    // WiFiClientSecure timeout for uploads
#define POLL_INTERVAL_MS  2000  // session polling interval
#define GATE_OPEN_MS      3000  // how long to hold the gate open after ACCEPT
#define RETRY_DELAY_MS    2000  // pause before retrying after ERROR state
