#pragma once

// ── WiFi Configuration ────────────────────────────────────────────────────────
#define WIFI_SSID     "YOUR_WIFI_SSID"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"

// ── Backend API Configuration ─────────────────────────────────────────────────
#define BACKEND_HOST   "your-app.vercel.app"   // Hostname without https://
#define BACKEND_PORT   443
#define DEVICE_API_KEY "your-device-api-key-here"
#define PATH_LOGS      "/api/device/logs"

// ── Servo Configuration ───────────────────────────────────────────────────────
// GPIO13 is a safe pin on ESP32-CAM (not a strapping pin, not used by camera/PSRAM).
#define PIN_SERVO       13
#define SERVO_CLOSED_US 1500   // Calibrate for closed position (microseconds)
#define SERVO_OPEN_US   2000   // Calibrate for open position (microseconds)

// ── 2-Pin Buzzer Configuration ────────────────────────────────────────────────
// Signal/Positive (+) lead connected to GPIO14. Negative (-) lead to GND.
#define PIN_BUZZER 14

// Buzzer Mode:
//   1 = Active 2-Pin Buzzer  (Internal oscillator, HIGH = ON, LOW = OFF)
//   2 = Passive 2-Pin Buzzer (Requires PWM frequency generation)
#define BUZZER_TYPE_ACTIVE  1
#define BUZZER_TYPE_PASSIVE 2

#define BUZZER_MODE BUZZER_TYPE_ACTIVE

// Frequency settings for Passive Buzzer mode (in Hz)
#define TONE_BOOT_HZ   2700   // Boot complete beep
#define TONE_READY_HZ  3000   // Kiosk ready for deposit
#define TONE_ACCEPT_HZ 3500   // Deposit accepted tone
#define TONE_REJECT_HZ 1800   // Deposit rejected tone
#define TONE_ERROR_HZ  1200   // System / network error tone

// ── Status LED Configuration ──────────────────────────────────────────────────
#define PIN_LED_STATUS 33     // Onboard red LED (active-LOW)

// ── System Timing Constants ───────────────────────────────────────────────────
#define BACKEND_TIMEOUT_S 15   // HTTP connection timeout (seconds)
#define POLL_INTERVAL_MS  2000 // Active session polling interval (ms)
#define GATE_OPEN_MS      3000 // Gate hold-open duration after ACCEPT (ms)
#define RETRY_DELAY_MS    2000 // Pause duration in error state before retry (ms)
