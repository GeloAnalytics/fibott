#pragma once

// ═══════════════════════════════════════════════════════════════════════════════
// Fibott Kiosk Controller (2nd ESP32: Servo Gate & Buzzer Actuator)
// config.h
// ═══════════════════════════════════════════════════════════════════════════════

// ── Firmware Version ──────────────────────────────────────────────────────────
#define FIRMWARE_VERSION "2.0.0-actuator-controller"

// ── UART Connection to ESP32-CAM ──────────────────────────────────────────────
// Connect:
//   ESP32-CAM GPIO13 (TX)  →  Controller GPIO16 (RX2)
//   ESP32-CAM GPIO14 (RX)  ←  Controller GPIO17 (TX2)
//   ESP32-CAM GND          ──  Controller GND (Mandatory Common Ground!)
#define CAM_UART_BAUD 115200
#define CAM_UART_RX   16
#define CAM_UART_TX   17

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
