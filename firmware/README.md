# Fibott — Dual-ESP32 Wireless Hardware & Firmware System

This directory contains the firmware for the **Dual-ESP32 100% Wireless Architecture** of the Fibott reverse vending kiosk.

> 📖 **Complete Installation Guide:** See [docs/HARDWARE_SETUP_GUIDE.md](../docs/HARDWARE_SETUP_GUIDE.md) for full wiring schematics, BOM, troubleshooting, and step-by-step setup.

---

## 📁 Architecture Overview

```
┌──────────────────────────────────────┐     2.4 GHz ESP-NOW Wireless Link     ┌──────────────────────────────────────┐
│        ESP32 #1: ESP32-CAM           │ · · · · · · · · · · · · · · · · · · · > │     ESP32 #2: Kiosk Controller       │
│            (Vision Node)             │       (ZERO PHYSICAL WIRING!)           │           (Actuator Node)            │
│                                      │                                         │                                      │
│ • OV2640 Image Capture               │                                         │ • SG90 / MG90S Gate Servo (GPIO18)   │
│ • MobileNetV1 TinyML Inference       │                                         │ • Onboard Blue Status LED (GPIO2)    │
│ • Anti-Hand & Anti-Paper Filters     │                                         │ • Independent 5V Motor Power Supply  │
│ • WiFi + Cloud Backend Sync          │                                         │ • Sub-10ms Wireless Command Reaction │
│ • Independent 5V Clean Logic Power   │                                         │                                      │
└──────────────────────────────────────┘                                         └──────────────────────────────────────┘
```

---

## 📁 Firmware Folders

| [`esp32-cam-vision/`](./esp32-cam-vision/) | **AI-Thinker ESP32-CAM** | Vision node: OV2640 camera capture, two-class on-device AI classification (PET bottle or aluminum can), cloud sync, ESP-NOW wireless transmitter. Current firmware does not enforce configured rejection settings. |
| [`kiosk-controller/`](./kiosk-controller/) | **Standard ESP32 DevKit** | Dedicated servo gate actuator, status LED feedback, ESP-NOW wireless command receiver, USB bench testing. |

---

## 🔌 Hardware Wiring Guide

### 1. Inter-ESP32 Interconnect
> ⚡ **NO PHYSICAL WIRES BETWEEN BOARDS!**
> - The two ESP32 modules communicate **100% wirelessly** via Espressif ESP-NOW at 2.4 GHz.
> - No UART TX/RX wires are needed.
> - No common ground wire is required, keeping the camera power domain completely isolated from motor electrical spikes.

### 2. ESP32-CAM (Vision Node) Wiring
| Pin | Connection | Note |
|:---|:---|:---|
| **5V / GND** | 5V 2A Power Supply (or USB) | Clean power without motor noise |
| **GPIO33** | Built-in Red LED | Activity indicator (internal) |
| **GPIO4** | Built-in Flash LED | Chute illumination (PWM dimmed, internal) |

### 3. 2nd ESP32 (Actuator Node) Wiring
| Pin | Component | Note |
|:---|:---|:---|
| **GPIO18** | **Servo Signal Wire** (Yellow/Orange) | SG90 / MG90S Gate Actuator |
| **GND** | **Servo Ground** (Brown/Black) | Ground |
| **5V** | **Servo VCC** (Red) | Dedicated 5V power supply |
| **GPIO2** | Built-in Blue LED | Wireless packet & status indicator (internal) |

---

## ⚠️ Current classification safety status

The active artifact is a two-class model: `PET_BOTTLE` or `ALUMINUM_CAN`. It has no non-recyclable output. The firmware currently marks every successful inference as confident and broadcasts `CMD:OPEN`; the configured confidence/margin values and hand, paper, and empty-chute options are not applied by the vision loop.

Do not use this firmware in an unattended public kiosk or describe it as rejecting hands, paper, or general trash. Use supervised bench tests only until a calibrated reject path is implemented and verified.

---

## 📡 Wireless Command Protocol (ESP-NOW)

| Command | Direction | Action on 2nd ESP32 |
|:---|:---|:---|
| `CMD:BOOT` | ESP32-CAM → Controller | Blinks status LED |
| `CMD:READY` | ESP32-CAM → Controller | Blinks ready LED pattern |
| `CMD:OPEN` | ESP32-CAM → Controller | Opens servo gate for 3s, then closes |
| `CMD:REJECT` | ESP32-CAM → Controller | Flashes reject LED pattern, keeps gate locked |
| `CMD:ERROR` | ESP32-CAM → Controller | Flashes error LED pattern |

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
2. Configure your WiFi credentials in `config.h` (connects to same AP to match Wi-Fi channel automatically).
3. Select Board: **ESP32 Dev Module** (or your ESP32 model).
4. Click **Upload**.
5. Open Serial Monitor (115200 baud) — you can type `OPEN`, `CLOSE`, `REJECT`, or `STATUS` to test the hardware directly!
