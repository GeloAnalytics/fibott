/*
 * Fibott — 2nd ESP32 Kiosk Controller (Servo Gate & Buzzer Actuator)
 *
 * Board:    ESP32 Dev Module / NodeMCU-32S / ESP32 WROOM-32
 *
 * ── Hardware Wiring ─────────────────────────────────────────────────────────────
 *   GPIO16 (RX2)  ←  ESP32-CAM GPIO13 (TX)
 *   GPIO17 (TX2)  →  ESP32-CAM GPIO14 (RX)
 *   GND           ── ESP32-CAM GND (MANDATORY COMMON GROUND)
 *   GPIO18        →  Servo signal wire (SG90 / MG90S Gate Actuator)
 *   GPIO19        →  Buzzer (+) / signal lead
 *   GND           →  Buzzer (-) lead
 *   GPIO2         →  Status LED
 *
 * ── Functionality ───────────────────────────────────────────────────────────────
 *   1. Listens for UART commands from ESP32-CAM (Serial2 at 115200 baud).
 *   2. Opens/closes the servo gate with non-blocking timing.
 *   3. Plays audio feedback for Boot, Ready, Accepted, and Rejected deposits.
 *   4. Allows interactive testing via USB Serial Monitor (commands: OPEN, CLOSE, BEEP, REJECT).
 */

#include "config.h"
#include "driver/ledc.h"

HardwareSerial CamSerial(2); // UART2: RX2=GPIO16, TX2=GPIO17

#define LOG(tag, msg)       Serial.printf("[%-8s] %s\n", tag, msg)
#define LOGF(tag, fmt, ...) Serial.printf("[%-8s] " fmt "\n", tag, ##__VA_ARGS__)

// ── Servo Control (LEDC Timer 0 / Channel 0, 50Hz 16-bit) ────────────────────
static void servoSetup() {
  LOGF("SERVO", "Initialising servo on GPIO%d (50Hz)", PIN_SERVO);
  ledc_timer_config_t tc = {};
  tc.speed_mode      = LEDC_LOW_SPEED_MODE;
  tc.duty_resolution = LEDC_TIMER_16_BIT;
  tc.timer_num       = LEDC_TIMER_0;
  tc.freq_hz         = 50;
  tc.clk_cfg         = LEDC_AUTO_CLK;
  ledc_timer_config(&tc);

  ledc_channel_config_t cc = {};
  cc.gpio_num   = PIN_SERVO;
  cc.speed_mode = LEDC_LOW_SPEED_MODE;
  cc.channel    = LEDC_CHANNEL_0;
  cc.intr_type  = LEDC_INTR_DISABLE;
  cc.timer_sel  = LEDC_TIMER_0;
  cc.duty       = 0;
  cc.hpoint     = 0;
  ledc_channel_config(&cc);
}

static void servoWrite(uint32_t us) {
  uint32_t duty = (uint32_t)((uint64_t)us * 65536 / 20000);
  ledc_set_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_0, duty);
  ledc_update_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_0);
}

static void gateClose() {
  LOGF("GATE", "Servo Closed (%u µs)", SERVO_CLOSED_US);
  servoWrite(SERVO_CLOSED_US);
}

static void gateOpen() {
  LOGF("GATE", "Servo OPEN (%u µs)", SERVO_OPEN_US);
  servoWrite(SERVO_OPEN_US);
}

// ── Buzzer Driver ─────────────────────────────────────────────────────────────
#if BUZZER_MODE == BUZZER_TYPE_PASSIVE
static void buzzerPwmSetup() {
  ledc_timer_config_t tc = {};
  tc.speed_mode      = LEDC_LOW_SPEED_MODE;
  tc.duty_resolution = LEDC_TIMER_10_BIT;
  tc.timer_num       = LEDC_TIMER_1;
  tc.freq_hz         = 2000;
  tc.clk_cfg         = LEDC_AUTO_CLK;
  ledc_timer_config(&tc);

  ledc_channel_config_t cc = {};
  cc.gpio_num   = PIN_BUZZER;
  cc.speed_mode = LEDC_LOW_SPEED_MODE;
  cc.channel    = LEDC_CHANNEL_1;
  cc.intr_type  = LEDC_INTR_DISABLE;
  cc.timer_sel  = LEDC_TIMER_1;
  cc.duty       = 0;
  cc.hpoint     = 0;
  ledc_channel_config(&cc);
}

static void buzzerTone(uint32_t freqHz) {
  if (freqHz == 0) {
    ledc_set_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_1, 0);
    ledc_update_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_1);
    return;
  }
  ledc_set_freq(LEDC_LOW_SPEED_MODE, LEDC_TIMER_1, freqHz);
  ledc_set_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_1, 512);
  ledc_update_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_1);
}

static void buzzerNoTone() {
  ledc_set_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_1, 0);
  ledc_update_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_1);
}
#endif

static void buzzerSetup() {
  pinMode(PIN_BUZZER, OUTPUT);
#if BUZZER_MODE == BUZZER_TYPE_PASSIVE
  buzzerPwmSetup();
  buzzerNoTone();
#else
  digitalWrite(PIN_BUZZER, LOW);
#endif
  LOG("BUZZER", "Buzzer ready on GPIO" String(PIN_BUZZER));
}

static void playBeep(int count, int onMs = 150, int gapMs = 100, uint32_t freqHz = 2500) {
  for (int i = 0; i < count; i++) {
#if BUZZER_MODE == BUZZER_TYPE_PASSIVE
    buzzerTone(freqHz);
    delay(onMs);
    buzzerNoTone();
#else
    digitalWrite(PIN_BUZZER, HIGH);
    delay(onMs);
    digitalWrite(PIN_BUZZER, LOW);
#endif
    if (i < count - 1) delay(gapMs);
  }
}

// ── Status LED ────────────────────────────────────────────────────────────────
static void ledOn()  { digitalWrite(PIN_LED_STATUS, HIGH); }
static void ledOff() { digitalWrite(PIN_LED_STATUS, LOW);  }

static void flashLed(int times, int onMs = 120, int offMs = 100) {
  for (int i = 0; i < times; i++) {
    ledOn();  delay(onMs);
    ledOff(); if (i < times - 1) delay(offMs);
  }
}

// ── Gate Cycle Execution ──────────────────────────────────────────────────────
static void executeDepositAcceptCycle() {
  LOG("ACTUATOR", "🌟 Deposit ACCEPTED — Opening gate & playing chime");
  
  // 1. Success Chime (High tone)
  playBeep(1, 280, 0, 3200);

  // 2. Open Gate Servo
  ledOn();
  gateOpen();

  // 3. Hold gate open for configured duration
  delay(GATE_OPEN_MS);

  // 4. Close Gate Servo
  gateClose();
  ledOff();
  LOG("ACTUATOR", "🔒 Gate closed — Ready for next item");
}

static void executeDepositRejectCycle() {
  LOG("ACTUATOR", "🚫 Deposit REJECTED — Gate stays LOCKED");
  
  // 3 rapid warning beeps
  playBeep(3, 110, 80, 1600);
  gateClose();
}

// ── Process Incoming Commands ─────────────────────────────────────────────────
static void handleCommand(String cmd) {
  cmd.trim();
  if (cmd.length() == 0) return;

  LOGF("RECV", "Command: '%s'", cmd.c_str());

  if (cmd == "CMD:OPEN" || cmd == "OPEN") {
    executeDepositAcceptCycle();
  }
  else if (cmd == "CMD:REJECT" || cmd == "REJECT") {
    executeDepositRejectCycle();
  }
  else if (cmd == "CMD:READY" || cmd == "READY") {
    LOG("ACTUATOR", "Session active — Prompting user");
    playBeep(1, 100, 0, 2800);
    flashLed(2, 120, 100);
  }
  else if (cmd == "CMD:BOOT" || cmd == "BOOT") {
    LOG("ACTUATOR", "ESP32-CAM booted successfully");
    playBeep(1, 80, 0, 2400);
    flashLed(1, 200, 0);
  }
  else if (cmd == "CMD:ERROR" || cmd == "ERROR") {
    LOG("ACTUATOR", "Error notification from camera");
    playBeep(1, 400, 0, 1000);
  }
  else if (cmd == "CLOSE") {
    gateClose();
  }
  else if (cmd == "BEEP") {
    playBeep(2, 100, 80, 2500);
  }
  else if (cmd == "STATUS") {
    Serial.printf("[STATUS  ] Firmware: %s | Servo: GPIO%d | Buzzer: GPIO%d\n",
                  FIRMWARE_VERSION, PIN_SERVO, PIN_BUZZER);
  }
  else {
    LOGF("WARN", "Unknown command: '%s'", cmd.c_str());
  }
}

// ── Setup ─────────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(300);

  // Initialize UART2 for communication with ESP32-CAM
  CamSerial.begin(CAM_UART_BAUD, SERIAL_8N1, CAM_UART_RX, CAM_UART_TX);

  Serial.println("\n");
  Serial.println("╔══════════════════════════════════════════════════╗");
  Serial.println("║   Fibott 2nd ESP32 Kiosk Actuator Controller    ║");
  Serial.printf( "║  Firmware v%-38s║\n", FIRMWARE_VERSION);
  Serial.println("║  Servo Gate (GPIO18) | Buzzer (GPIO19)           ║");
  Serial.println("╚══════════════════════════════════════════════════╝");
  Serial.println();

  pinMode(PIN_LED_STATUS, OUTPUT);
  ledOff();

  buzzerSetup();
  servoSetup();
  gateClose();

  // Boot beep
  playBeep(1, 100, 0, 2600);
  flashLed(2, 100, 80);

  LOG("BOOT", "Kiosk Actuator Controller Ready!");
  LOG("BOOT", "Listening for ESP32-CAM UART commands (CMD:OPEN, CMD:REJECT, CMD:READY)...");
  LOG("BOOT", "Type 'OPEN', 'CLOSE', 'REJECT', or 'BEEP' in Serial Monitor for manual test.");
}

// ── Main Loop ─────────────────────────────────────────────────────────────────
void loop() {
  // 1. Check for incoming commands from ESP32-CAM over UART2
  if (CamSerial.available()) {
    String camCmd = CamSerial.readStringUntil('\n');
    handleCommand(camCmd);
  }

  // 2. Check for manual debugging commands from USB Serial Monitor
  if (Serial.available()) {
    String debugCmd = Serial.readStringUntil('\n');
    handleCommand(debugCmd);
  }
}
