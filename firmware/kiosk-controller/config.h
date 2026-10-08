#pragma once

// ═══════════════════════════════════════════════════════════════════════════════
// Fibott Kiosk Controller (2nd ESP32: Servo Gate & Buzzer Actuator)
// config.h
// ═══════════════════════════════════════════════════════════════════════════════

// ── Firmware Version ──────────────────────────────────────────────────────────
#define FIRMWARE_VERSION "2.1.0-wireless-actuator-controller"

// ── Wireless Inter-ESP32 Protocol (ESP-NOW 2.4 GHz) ───────────────────────────
// ZERO physical wiring required between ESP32-CAM and ESP32 DevKit!
// Commands (CMD:OPEN, CMD:REJECT, CMD:READY, CMD:BOOT, etc.) are received
// wirelessly over 2.4 GHz ESP-NOW with sub-10ms response time.
#define WIRELESS_MAGIC "FIBO"

// ── WiFi Channel Synchronization ──────────────────────────────────────────────
// By connecting to the same 2.4GHz WiFi AP as the ESP32-CAM, this controller
// automatically synchronizes to the exact same Wi-Fi channel.
#define WIFI_SSID     "Fibott"
#define WIFI_PASSWORD ""

// ── Servo Gate Actuator Configuration ─────────────────────────────────────────
// Connect SG90 / MG90S signal wire to GPIO18
// External 5V supply connected to Servo 5V and GND.
#define PIN_SERVO       18
#define SERVO_CLOSED_US 1500   // Rest/Closed pulse width (~90°) — adjust for chute
#define SERVO_OPEN_US   2000   // Open pulse width (~135°) — adjust for chute
#define GATE_OPEN_MS    3000   // How long gate stays open for deposit (milliseconds)

// ── Buzzer Configuration ──────────────────────────────────────────────────────
// Connect buzzer (+) lead to GPIO19, (-) lead to GND
#define PIN_BUZZER          19
#define BUZZER_TYPE_ACTIVE  1
#define BUZZER_TYPE_PASSIVE 2
#define BUZZER_MODE         BUZZER_TYPE_ACTIVE  // Set to PASSIVE if using passive piezo

// ── Status LED Configuration ──────────────────────────────────────────────────
#define PIN_LED_STATUS 2  // Onboard blue LED on ESP32 DevKit (active-HIGH)
