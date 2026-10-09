/*
 * Fibott — 2nd ESP32 Kiosk Controller (Servo Gate Actuator)
 *
 * Board:    ESP32 Dev Module / NodeMCU-32S / ESP32 WROOM-32
 *
 * ── Wireless Interconnect (ZERO Physical Wiring to ESP32-CAM) ────────────────
 *   Commands from ESP32-CAM are received 100% wirelessly over 2.4 GHz ESP-NOW.
 *   - No UART TX/RX wires
 *   - No common ground wire needed (electrically isolated power domains)
 *
 * ── Actuator Pinout ─────────────────────────────────────────────────────────
 *   GPIO18  →  Servo Signal Wire (SG90 / MG90S Gate Actuator)
 *   5V Rail →  Servo VCC (Red wire, dedicated 5V power)
 *   GND     →  Servo GND (Brown/Black wire)
 *   Internal→  Built-in Onboard Blue LED (LED_BUILTIN / GPIO2, no wiring needed)
 *
 * ── Functionality ───────────────────────────────────────────────────────────
 *   1. Listens for wireless ESP-NOW commands from ESP32-CAM (sub-10ms latency).
 *   2. Opens/closes the servo gate with non-blocking timing.
 *   3. Allows interactive testing via USB Serial Monitor (commands: OPEN, CLOSE, REJECT).
 */

#include "config.h"
#include "driver/ledc.h"
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>

#define LOG(tag, msg)       Serial.printf("[%-8s] %s\n", tag, msg)
#define LOGF(tag, fmt, ...) Serial.printf("[%-8s] " fmt "\n", tag, ##__VA_ARGS__)

// ── Wireless Protocol Struct ──────────────────────────────────────────────────
typedef struct __attribute__((packed)) {
  char magic[4];        // "FIBO"
  uint8_t version;      // 1
  char command[24];     // "CMD:OPEN", "CMD:REJECT", "CMD:READY", "CMD:BOOT", "CMD:ERROR"
  uint32_t seq;         // Sequence counter
} WirelessCommandPacket;

// Thread-safe command buffer from ESP-NOW interrupt context to loop()
static String pendingCmd = "";
static volatile bool hasPendingCmd = false;
static portMUX_TYPE cmdMux = portMUX_INITIALIZER_UNLOCKED;

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
  LOG("ACTUATOR", "🌟 Deposit ACCEPTED — Opening gate");

  // 1. Open Gate Servo
  ledOn();
  gateOpen();

  // 2. Hold gate open for configured duration
  delay(GATE_OPEN_MS);

  // 3. Close Gate Servo
  gateClose();
  ledOff();
  LOG("ACTUATOR", "🔒 Gate closed — Ready for next item");
}

static void executeDepositRejectCycle() {
  LOG("ACTUATOR", "🚫 Deposit REJECTED — Gate stays LOCKED");
  flashLed(3, 110, 80);
  gateClose();
}

// ── Process Commands ──────────────────────────────────────────────────────────
static void handleCommand(String cmd) {
  cmd.trim();
  if (cmd.length() == 0) return;

  LOGF("EXEC", "Executing command: '%s'", cmd.c_str());

  if (cmd == "CMD:OPEN" || cmd == "OPEN") {
    executeDepositAcceptCycle();
  }
  else if (cmd == "CMD:REJECT" || cmd == "REJECT") {
    executeDepositRejectCycle();
  }
  else if (cmd == "CMD:READY" || cmd == "READY") {
    LOG("ACTUATOR", "Session active — Ready");
    flashLed(2, 120, 100);
  }
  else if (cmd == "CMD:BOOT" || cmd == "BOOT") {
    LOG("ACTUATOR", "ESP32-CAM booted successfully (wireless ping)");
    flashLed(1, 200, 0);
  }
  else if (cmd == "CMD:ERROR" || cmd == "ERROR") {
    LOG("ACTUATOR", "Error notification received from camera");
    flashLed(4, 100, 100);
  }
  else if (cmd == "CLOSE") {
    gateClose();
  }
  else if (cmd == "STATUS") {
    Serial.printf("[STATUS  ] Firmware: %s | Servo: GPIO%d | Channel: %d | MAC: %s\n",
                  FIRMWARE_VERSION, PIN_SERVO, WiFi.channel(), WiFi.macAddress().c_str());
  }
  else {
    LOGF("WARN", "Unknown command: '%s'", cmd.c_str());
  }
}

// ── ESP-NOW Receive Callback (Supports ESP32 Core 2.x and 3.x) ─────────────────
#if defined(ESP_ARDUINO_VERSION_MAJOR) && (ESP_ARDUINO_VERSION_MAJOR >= 3)
void onDataRecv(const esp_now_recv_info_t *info, const uint8_t *incomingData, int len)
#else
void onDataRecv(const uint8_t *mac_addr, const uint8_t *incomingData, int len)
#endif
{
  char buf[32] = {0};

  if (len >= (int)sizeof(WirelessCommandPacket)) {
    const WirelessCommandPacket *pkt = (const WirelessCommandPacket *)incomingData;
    if (memcmp(pkt->magic, WIRELESS_MAGIC, 4) == 0) {
      strncpy(buf, pkt->command, sizeof(buf) - 1);
    }
  } else if (len > 0) {
    int copyLen = (len < 31) ? len : 31;
    memcpy(buf, incomingData, copyLen);
    buf[copyLen] = '\0';
  }

  if (strlen(buf) > 0) {
    portENTER_CRITICAL_ISR(&cmdMux);
    pendingCmd = String(buf);
    hasPendingCmd = true;
    portEXIT_CRITICAL_ISR(&cmdMux);
  }
}

// ── Wireless Receiver Setup (ESP-NOW) ─────────────────────────────────────────
static void wirelessSetup() {
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);

#ifdef WIFI_SSID
  if (strlen(WIFI_SSID) > 0) {
    LOGF("WIRELESS", "Connecting to WiFi AP '%s' for channel synchronization...", WIFI_SSID);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    unsigned long deadline = millis() + 6000;
    while (WiFi.status() != WL_CONNECTED && millis() < deadline) {
      delay(200);
    }
    if (WiFi.status() == WL_CONNECTED) {
      LOGF("WIRELESS", "WiFi connected! Channel: %d | IP: %s",
           WiFi.channel(), WiFi.localIP().toString().c_str());
    } else {
      LOGF("WIRELESS", "WiFi associating in background. Channel: %d", WiFi.channel());
    }
  }
#endif

  LOG("WIRELESS", "Initialising ESP-NOW wireless receiver (0 physical wires)...");
  if (esp_now_init() != ESP_OK) {
    LOG("WIRELESS", "FATAL: esp_now_init failed!");
    return;
  }

  esp_now_register_recv_cb(onDataRecv);

  LOGF("WIRELESS", "ESP-NOW listening on Channel %d | MAC: %s",
       WiFi.channel(), WiFi.macAddress().c_str());
}

// ── Setup ─────────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(300);

  Serial.println("\n");
  Serial.println("╔══════════════════════════════════════════════════╗");
  Serial.println("║   Fibott 2nd ESP32 Kiosk Actuator Controller    ║");
  Serial.printf( "║  Firmware v%-38s║\n", FIRMWARE_VERSION);
  Serial.println("║  Wireless ESP-NOW Receiver (0 Physical Wires)    ║");
  Serial.println("║  Servo Gate (GPIO18)                             ║");
  Serial.println("╚══════════════════════════════════════════════════╝");
  Serial.println();

  pinMode(PIN_LED_STATUS, OUTPUT);
  ledOff();

  servoSetup();
  gateClose();

  // Boot indicator
  flashLed(2, 100, 80);

  // Initialize Wireless ESP-NOW
  wirelessSetup();

  LOG("BOOT", "Kiosk Actuator Controller Ready!");
  LOG("BOOT", "Listening for ESP-NOW wireless commands (CMD:OPEN, CMD:REJECT, CMD:READY)...");
  LOG("BOOT", "Type 'OPEN', 'CLOSE', or 'REJECT' in Serial Monitor for manual test.");
}

// ── Main Loop ─────────────────────────────────────────────────────────────────
void loop() {
  // 1. Process incoming wireless commands safely outside ISR context
  if (hasPendingCmd) {
    String cmd;
    portENTER_CRITICAL(&cmdMux);
    cmd = pendingCmd;
    hasPendingCmd = false;
    portEXIT_CRITICAL(&cmdMux);

    LOGF("WIRELESS_RECV", "Packet received: '%s'", cmd.c_str());
    handleCommand(cmd);
  }

  // 2. Check for manual debugging commands from USB Serial Monitor
  if (Serial.available()) {
    String debugCmd = Serial.readStringUntil('\n');
    handleCommand(debugCmd);
  }
}
