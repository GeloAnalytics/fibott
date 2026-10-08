# 2nd ESP32 Kiosk Actuator Controller (Servo Gate & Buzzer Node)

This firmware runs on the second **ESP32 Dev Module / NodeMCU-32S** to handle all physical hardware actuators: the **Servo Gate** and the **Audio Feedback Buzzer**.

---

## 🎯 Primary Responsibilities

1. **Gate Actuation:** Smooth 50Hz LEDC hardware PWM driving the SG90 / MG90S servo gate without introducing electrical noise to the camera.
2. **Audio Feedback:** Boot chimes, ready beeps, acceptance tones, and rejection warning pulses.
3. **UART Command Receiver:** Listens on `Serial2` (RX2 = GPIO16) for `CMD:OPEN`, `CMD:REJECT`, and `CMD:READY` from the ESP32-CAM.
4. **Interactive Serial Monitor Debugger:** Allows manual bench-testing using USB Serial Monitor (`OPEN`, `CLOSE`, `REJECT`, `BEEP`, `STATUS`).

---

## 🔌 Hardware Wiring

| 2nd ESP32 Pin | Component Pin | Description |
|:---|:---|:---|
| **GPIO16 (RX2)** | ESP32-CAM **GPIO13 (TX)** | UART command input from camera |
| **GPIO17 (TX2)** | ESP32-CAM **GPIO14 (RX)** | UART feedback output to camera |
| **GND** | ESP32-CAM **GND** & Power GND | **Mandatory Common Ground** |
| **GPIO18** | **Servo Signal Wire** (Yellow/Orange) | SG90 / MG90S Gate Actuator |
| **GPIO19** | **Buzzer (+)** | Active / Passive Buzzer |
| **GND** | **Buzzer (-)** & Servo GND (Brown/Black) | Ground |
| **5V** | **Servo VCC** (Red wire) | 5V 2A Power Supply |
| **GPIO2** | Built-in Blue LED | Status indicator |

---

## 💻 Arduino IDE Flashing Guide

1. Board: **ESP32 Dev Module** (or NodeMCU-32S / ESP32 WROOM-32)
2. Upload Speed: **921600** (or 115200)
3. Connect via USB and click **Upload**.
4. Open Serial Monitor at **115200 baud**.
5. Type `OPEN` to test opening the gate, `REJECT` to test warning beeps, or `BEEP` to test the buzzer!
