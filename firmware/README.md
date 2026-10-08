# Fibott — Dual-ESP32 Hardware & Firmware System

This directory contains the firmware for the **Dual-ESP32 Architecture** of the Fibott reverse vending kiosk.

> 📖 **Complete Installation Guide:** See [docs/HARDWARE_SETUP_GUIDE.md](../docs/HARDWARE_SETUP_GUIDE.md) for full wiring schematics, BOM, troubleshooting, and step-by-step setup.

---

## 📁 Architecture Overview

```
┌──────────────────────────────────────┐       UART Serial (115200)      ┌──────────────────────────────────────┐
│        ESP32 #1: ESP32-CAM           │ ── GPIO13 (TX) ──> GPIO16 (RX) ──> │     ESP32 #2: Kiosk Controller       │
│                                      │ <── GPIO14 (RX) <── GPIO17 (TX) ── │                                      │
│ • OV2640 Image Capture               │ ──── Common GND ───────────────> │ • SG90 / MG90S Gate Servo (GPIO18)   │
│ • MobileNetV1 TinyML Inference       │                                  │ • Audio Buzzer (GPIO19)              │
│ • Anti-Hand & Anti-Paper Filters     │                                  │ • Status LEDs                        │
│ • WiFi + Cloud Backend Sync          │                                  │ • Powered with clean motor power     │
└──────────────────────────────────────┘                                  └──────────────────────────────────────┘
```

---

## 📁 Firmware Folders

| Folder | Target Board | Primary Responsibility |
|:---|:---|:---|
| [`esp32-cam-vision/`](./esp32-cam-vision/) | **AI-Thinker ESP32-CAM** | Camera capture, on-device AI classification, paper/hand rejection filters, cloud backend sync, UART command transmitter. |
| [`kiosk-controller/`](./kiosk-controller/) | **Standard ESP32 DevKit** | Dedicated servo gate actuator, buzzer audio feedback, hardware testing. |

---

## 🔌 Hardware Wiring Guide

### 1. Inter-ESP32 UART Wiring
| ESP32-CAM Pin | 2nd ESP32 Controller Pin | Description |
|:---|:---|:---|
| **GPIO13 (TX)** | **GPIO16 (RX2)** | Command line from ESP32-CAM to Controller |
| **GPIO14 (RX)** | **GPIO17 (TX2)** | Feedback line from Controller to ESP32-CAM |
| **GND** | **GND** | **MANDATORY Common Ground** |

### 2. ESP32-CAM (Vision Node) Wiring
| Pin | Connection | Note |
|:---|:---|:---|
| **5V / GND** | 5V 2A Power Supply | Clean power without motor noise |
| **GPIO33** | Built-in Red LED | Activity indicator |
| **GPIO4** | Built-in Flash LED | Chute illumination (PWM dimmed) |

### 3. 2nd ESP32 (Actuator Node) Wiring
| Pin | Component | Note |
|:---|:---|:---|
| **GPIO18** | **Servo Signal Wire** (Yellow/Orange) | SG90 / MG90S Gate Actuator |
| **GPIO19** | **Buzzer (+)** | Active / Passive Buzzer |
| **GND** | **Buzzer (-)** & Servo Ground (Brown/Black) | Ground |
| **5V** | **Servo VCC** (Red) | Connected to 5V power supply |

---

## 🚫 Anti-False-Positive Filtering (Rejecting Hands, Paper, Trash)

In earlier versions, a 2-class Softmax model guaranteed that the higher output was always ≥ 50%, causing flat paper, hands, and random objects to be accepted.

In **v2.0.0**, four layers of rejection are active:

1. **High Confidence Threshold (`0.78f`) & Margin (`0.50f`)**:
   - Random objects produce split probabilities (e.g. 55% PET / 45% CAN).
   - Only items with **≥ 78% certainty** and **≥ 50% separation margin** between classes are accepted.
2. **Skin Tone / Hand Detector**:
   - Analyzes normalized RGB ratios (`R > G > B` with red bias).
   - If skin tone exceeds 16% of the frame, the deposit is instantly rejected with `hand_detected`.
3. **Flat Paper / Tissue / Cardboard Detector**:
   - Detects high uniform brightness without specular gloss or curvature.
   - Instantly rejected with `paper_detected`.
4. **Empty Chute Detector**:
   - Detects empty or excessively dark scenes and rejects with `empty_chute`.
5. **Server-Side Allowlist**:
   - The cloud classifier strictly validates against verified bottle/can keywords and rejects any non-recyclable item.

---

## 📡 UART Command Protocol

| Command | Direction | Action on 2nd ESP32 |
|:---|:---|:---|
| `CMD:BOOT` | ESP32-CAM → Controller | Plays boot beep |
| `CMD:READY` | ESP32-CAM → Controller | Plays prompt beep + blinks ready LED |
| `CMD:OPEN` | ESP32-CAM → Controller | Plays accept tone (3200Hz), opens servo gate for 3s, then closes |
| `CMD:REJECT` | ESP32-CAM → Controller | Plays 3 rapid warning beeps (1600Hz), keeps gate locked |
| `CMD:ERROR` | ESP32-CAM → Controller | Plays error buzz (1000Hz) |

---

## 🚀 How to Flash

### For ESP32-CAM:
1. Open [`firmware/esp32-cam-vision/esp32-cam-vision.ino`](./esp32-cam-vision/esp32-cam-vision.ino) in Arduino IDE.
2. Configure your WiFi credentials and Device API key in `config.h`.
3. Select Board: **AI Thinker ESP32-CAM**, PSRAM: **OPI PSRAM**.
4. Bridge **GPIO0 to GND**, plug in USB, click **Upload**.
5. Disconnect GPIO0 from GND and press **RST**.

### For 2nd ESP32 (Controller):
1. Open [`firmware/kiosk-controller/kiosk-controller.ino`](./kiosk-controller/kiosk-controller.ino) in Arduino IDE.
2. Select Board: **ESP32 Dev Module** (or your ESP32 model).
3. Click **Upload**.
4. Open Serial Monitor (115200 baud) — you can type `OPEN`, `CLOSE`, `REJECT`, or `BEEP` to test the hardware directly!
