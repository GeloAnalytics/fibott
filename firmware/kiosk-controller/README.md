# 2nd ESP32 Kiosk Actuator Controller (Servo Gate & Buzzer Node)

This firmware runs on the second **ESP32 Dev Module / NodeMCU-32S** to handle all physical hardware actuators: the **Servo Gate** and the **Audio Feedback Buzzer**.

---

## 🎯 Primary Responsibilities

1. **Gate Actuation:** Smooth 50Hz LEDC hardware PWM driving the SG90 / MG90S servo gate without introducing electrical noise to the camera.
2. **Audio Feedback:** Boot chimes, ready beeps, acceptance tones, and rejection warning pulses.
3. **Wireless ESP-NOW Command Receiver:** Listens wirelessly over 2.4 GHz ESP-NOW for `CMD:OPEN`, `CMD:REJECT`, and `CMD:READY` with sub-10ms response time.
4. **Interactive Serial Monitor Debugger:** Allows manual bench-testing using USB Serial Monitor (`OPEN`, `CLOSE`, `REJECT`, `BEEP`, `STATUS`).

---

## 🔌 Hardware Wiring

> ⚡ **ZERO WIRING TO ESP32-CAM:** Inter-ESP32 communication is completely wireless (ESP-NOW)!

| 2nd ESP32 Pin | Component Pin | Description |
|:---|:---|:---|
| **GPIO18** | **Servo Signal Wire** (Yellow/Orange) | SG90 / MG90S Gate Actuator |
| **GPIO19** | **Buzzer (+)** | Active / Passive Buzzer |
| **GND** | **Buzzer (-)** & Servo GND (Brown/Black) | Ground |
| **5V** | **Servo VCC** (Red wire) | Dedicated 5V 2A Power Supply |
| **GPIO2** | Built-in Blue LED (Internal) | Status & wireless packet indicator |

---

## 💻 Arduino IDE Flashing Guide

1. Board: **ESP32 Dev Module** (or NodeMCU-32S / ESP32 WROOM-32)
2. Upload Speed: **921600** (or 115200)
3. Configure WiFi credentials in `config.h` (connects to same AP to match Wi-Fi channel automatically).
4. Connect via USB and click **Upload**.
5. Open Serial Monitor at **115200 baud**.
6. Type `OPEN` to test opening the gate, `REJECT` to test warning beeps, or `BEEP` to test the buzzer!
