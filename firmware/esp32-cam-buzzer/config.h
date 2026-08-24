#pragma once

// ── WiFi ─────────────────────────────────────────────────────────────────────
#define WIFI_SSID     "YOUR_WIFI_SSID"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"

// ── Backend ───────────────────────────────────────────────────────────────────
#define BACKEND_HOST  "your-app.vercel.app"   // no https:// prefix
#define BACKEND_PORT  443
#define DEVICE_API_KEY "your-device-api-key-here"
#define PATH_LOGS      "/api/device/logs"

// ── Servo ─────────────────────────────────────────────────────────────────────
// GPIO13 is safe (not a strapping pin). Do NOT use GPIO12 (MTDI strapping pin).
#define PIN_SERVO       13
#define SERVO_CLOSED_US 1500   // calibrate once assembled
#define SERVO_OPEN_US   2000

// ── Buzzer ────────────────────────────────────────────────────────────────────
// Active buzzer, HIGH = on. GPIO14 is free on the AI-Thinker board (not used by
// the camera data lines, PSRAM, or the servo/LED above).
#define PIN_BUZZER 14

// ── Status LED ────────────────────────────────────────────────────────────────
#define PIN_LED_STATUS 33      // onboard red LED, active-LOW

// ── Timing ────────────────────────────────────────────────────────────────────
#define BACKEND_TIMEOUT_S 15    // WiFiClientSecure timeout for uploads
#define POLL_INTERVAL_MS  2000  // session polling interval
#define GATE_OPEN_MS      3000  // how long to hold the gate open after ACCEPT
#define RETRY_DELAY_MS    2000  // pause before retrying after ERROR state
