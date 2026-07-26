#pragma once

// ── WiFi ─────────────────────────────────────────────────────────────────────
#define WIFI_SSID     "YOUR_WIFI_SSID"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"

// ── Backend ───────────────────────────────────────────────────────────────────
#define BACKEND_HOST   "your-app.vercel.app"   // no https:// prefix
#define BACKEND_PORT   443
#define DEVICE_API_KEY "your-controller-api-key-here"

// ── UART to ESP32-CAM ─────────────────────────────────────────────────────────
// Wire: Controller GPIO17 (TX) → ESP32-CAM GPIO14 (RX)
//       Controller GPIO16 (RX) → ESP32-CAM GPIO15 (TX)
//       Common GND
#define CAM_UART_BAUD 115200
#define CAM_UART_RX   16
#define CAM_UART_TX   17
// Timeout waiting for camera UART response (ms)
#define CAM_UART_TIMEOUT_MS 15000

// ── Buttons (active-LOW, internal pull-up) ────────────────────────────────────
#define BTN_START   2   // Blue  — START DEPOSIT
#define BTN_CONFIRM 4   // White — CONFIRM / NEXT (reserved for future use)
#define BTN_CANCEL  5   // Red   — CANCEL current transaction
#define BTN_ADMIN   18  // Blue  — ADMIN / MAINTENANCE

// ── Buzzer ────────────────────────────────────────────────────────────────────
#define PIN_BUZZER  19  // Active buzzer, HIGH = on

// ── Timing ────────────────────────────────────────────────────────────────────
// How long the gate stays open after ACCEPT (controller-side delay before SERVO CLOSE).
// Must be longer than the ESP32-CAM's servo open time.
#define GATE_OPEN_MS 3500

// How long to wait for the camera to respond before declaring an error.
// Keep well above the worst-case classify + POST round-trip time (~10 s).
#define RESULT_TIMEOUT_MS 20000
