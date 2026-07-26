/*
 * Fibott — KIOSK_CONTROLLER firmware  (Version 1)
 *
 * Board:    ESP32 Dev Module  (Arduino IDE → Tools → Board)
 *
 * Libraries (Sketch → Include Library → Manage Libraries):
 *   - ArduinoJson  ≥ 7.0  (by Benoit Blanchon)
 *
 * Legacy controller-era prototype.
 *
 * The mobile-first baseline does not use this board as the active kiosk
 * controller. Keep this sketch only as migration support while the repo
 * moves to the single-ESP32-CAM design.
 *
 * ── UART command protocol ──────────────────────────────────────────────────
 *  All messages are newline-terminated ASCII. One command or response per line.
 *
 *  Legacy Controller → Camera:
 *    PING                      Health check
 *    STATUS                    Request camera status
 *    CAPTURE <session_code>    Capture image and upload with this session code
 *    SERVO OPEN                Open the gate servo
 *    SERVO CLOSE               Close the gate servo
 *
 *  Legacy Camera → Controller:
 *    PONG                      Response to PING
 *    STATUS READY              Camera initialised and idle
 *    STATUS ERROR              Camera not ready
 *    RESULT ACCEPT             Backend accepted the deposit
 *    RESULT REJECT             Backend rejected the deposit
 *    RESULT ERROR              Upload or network error
 *    SERVO OPENED              Servo open confirmed
 *    SERVO CLOSED              Servo close confirmed
 *
 * ── State machine ──────────────────────────────────────────────────────────
 *  BOOT → CONNECT_WIFI → CONNECT_CAM → READY
 *  READY → WAIT_BUTTON
 *  WAIT_BUTTON →(START)→ CLAIMING
 *  CLAIMING →(200)→ CAPTURING | →(fail)→ WAIT_BUTTON
 *  CAPTURING →(RESULT)→ ACCEPTING | REJECTING | WAIT_BUTTON(error)
 *  ACCEPTING → WAIT_BUTTON
 *  REJECTING → WAIT_BUTTON
 *
 * See docs/STATUS.md for overall project status.
 * See hardware/README.md for wiring detail and device provisioning.
 */

#include "config.h"
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>

// ── UART to camera ────────────────────────────────────────────────────────────
HardwareSerial CamSerial(2);  // UART2 — reassigned to GPIO16/17 in setup()

// Send a command to the camera and wait for a response line.
// Returns the trimmed response, or "" on timeout.
static String camSend(const char *cmd, unsigned long timeoutMs = CAM_UART_TIMEOUT_MS) {
  CamSerial.println(cmd);
  CamSerial.flush();
  Serial.printf("[uart→cam] %s\n", cmd);
  unsigned long deadline = millis() + timeoutMs;
  while (millis() < deadline) {
    if (CamSerial.available()) {
      String resp = CamSerial.readStringUntil('\n');
      resp.trim();
      if (resp.length()) {
        Serial.printf("[cam→uart] %s\n", resp.c_str());
        return resp;
      }
    }
    delay(5);
  }
  Serial.println("[uart] timeout");
  return "";
}

// ── Buzzer ────────────────────────────────────────────────────────────────────
static void beep(int n, int onMs = 200, int gapMs = 150) {
  for (int i = 0; i < n; i++) {
    digitalWrite(PIN_BUZZER, HIGH); delay(onMs);
    digitalWrite(PIN_BUZZER, LOW);
    if (i < n - 1) delay(gapMs);
  }
}

// ── Button debounce ───────────────────────────────────────────────────────────
// Returns true if the button is pressed (active-LOW, debounced).
static bool buttonPressed(int pin) {
  if (digitalRead(pin) != LOW) return false;
  delay(30);
  return digitalRead(pin) == LOW;
}

// ── Backend: claim oldest pending session ─────────────────────────────────────
// Returns the session code on success, or "" on failure.
static String claimSession() {
  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(10);

  if (!client.connect(BACKEND_HOST, BACKEND_PORT)) {
    Serial.println("[http] claimSession: connect failed");
    return "";
  }

  client.printf("POST /api/device/sessions/claim HTTP/1.1\r\n");
  client.printf("Host: %s\r\n", BACKEND_HOST);
  client.printf("x-device-api-key: %s\r\n", DEVICE_API_KEY);
  client.printf("Content-Length: 0\r\n");
  client.printf("Connection: close\r\n\r\n");
  client.flush();

  String statusLine = client.readStringUntil('\n');
  int statusCode = 0;
  if (statusLine.startsWith("HTTP/1."))
    statusCode = statusLine.substring(9, 12).toInt();
  while (client.connected()) {
    if (client.readStringUntil('\n') == "\r") break;
  }
  String body = client.readString();
  client.stop();

  Serial.printf("[http] claim %d — %s\n", statusCode, body.c_str());
  if (statusCode != 200) return "";

  JsonDocument doc;
  if (deserializeJson(doc, body) != DeserializationError::Ok) return "";
  return doc["sessionCode"].as<String>();
}

// ── State machine ─────────────────────────────────────────────────────────────
enum State { WAIT_BUTTON, CLAIMING, CAPTURING, ACCEPTING, REJECTING };
static State state = WAIT_BUTTON;
static String activeCode = "";

static void handleWaitButton() {
  // Check CANCEL (no-op in idle, just consume the press)
  if (buttonPressed(BTN_CANCEL)) {
    Serial.println("[btn] cancel in idle — no-op");
    while (digitalRead(BTN_CANCEL) == LOW) delay(10);
    return;
  }

  if (!buttonPressed(BTN_START)) return;
  while (digitalRead(BTN_START) == LOW) delay(10);  // wait for release

  Serial.println("[btn] START pressed — claiming session");
  state = CLAIMING;
}

static void handleClaiming() {
  String code = claimSession();
  if (!code.length()) {
    Serial.println("[claim] no session — wait for user to open app");
    beep(2, 100, 80);  // two short beeps = no session found
    state = WAIT_BUTTON;
    return;
  }

  activeCode = code;
  Serial.printf("[claim] session %s — sending CAPTURE\n", code.c_str());
  beep(1, 80);  // single short beep = session found

  String cmd = "CAPTURE " + code;
  state = CAPTURING;
  // CAPTURE is sent on the next tick so state is already CAPTURING when we wait
  String resp = camSend(cmd.c_str(), RESULT_TIMEOUT_MS);

  if (resp == "RESULT ACCEPT") {
    state = ACCEPTING;
  } else if (resp == "RESULT REJECT") {
    state = REJECTING;
  } else {
    Serial.println("[capture] error or timeout");
    beep(1, 500);
    activeCode = "";
    state = WAIT_BUTTON;
  }
}

static void handleAccepting() {
  Serial.println("[accept] sending SERVO OPEN");
  camSend("SERVO OPEN", 3000);
  delay(GATE_OPEN_MS);
  Serial.println("[accept] sending SERVO CLOSE");
  camSend("SERVO CLOSE", 3000);
  beep(1, 300);  // one long beep = success
  activeCode = "";
  state = WAIT_BUTTON;
  Serial.println("[state] → WAIT_BUTTON");
}

static void handleRejecting() {
  beep(3);  // three beeps = rejected
  activeCode = "";
  state = WAIT_BUTTON;
  Serial.println("[state] → WAIT_BUTTON");
}

// ── Setup ─────────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  Serial.println("\n[boot] Fibott KIOSK_CONTROLLER");

  // Buzzer
  pinMode(PIN_BUZZER, OUTPUT);
  digitalWrite(PIN_BUZZER, LOW);

  // Buttons — active-LOW with internal pull-up
  pinMode(BTN_START,   INPUT_PULLUP);
  pinMode(BTN_CONFIRM, INPUT_PULLUP);
  pinMode(BTN_CANCEL,  INPUT_PULLUP);
  pinMode(BTN_ADMIN,   INPUT_PULLUP);

  // UART to camera
  CamSerial.begin(CAM_UART_BAUD, SERIAL_8N1, CAM_UART_RX, CAM_UART_TX);

  // WiFi
  Serial.printf("[wifi] connecting to %s", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.printf("\n[wifi] %s\n", WiFi.localIP().toString().c_str());

  // Ping camera — retry until it responds
  Serial.print("[cam] waiting for camera PONG");
  while (true) {
    String resp = camSend("PING", 3000);
    if (resp == "PONG") break;
    Serial.print(".");
    delay(500);
  }
  Serial.println("\n[cam] camera ready");

  beep(3, 100, 80);  // three short beeps = kiosk ready
  Serial.println("[boot] ready — waiting for START button");
}

// ── Loop ──────────────────────────────────────────────────────────────────────
void loop() {
  // WiFi watchdog
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[wifi] reconnecting...");
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
    Serial.printf("[wifi] %s\n", WiFi.localIP().toString().c_str());
  }

  switch (state) {
    case WAIT_BUTTON: handleWaitButton(); break;
    case CLAIMING:    handleClaiming();   break;
    case ACCEPTING:   handleAccepting();  break;
    case REJECTING:   handleRejecting();  break;
    case CAPTURING:   break;  // never reaches loop() in CAPTURING — handled inline
  }
}
