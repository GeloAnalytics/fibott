# ESP32-CAM Vision & AI Inference Node

This firmware turns the **AI-Thinker ESP32-CAM** into a dedicated **Computer Vision and AI Processing Node**.

---

## 🎯 Primary Responsibilities

1. **OV2640 Image Capture:** High-speed frame acquisition with auto-exposure and dimmed flash LED illumination (GPIO4).
2. **On-Device MobileNetV1 TinyML:** Real-time INT8 quantized neural network inference running in PSRAM.
3. **Current Classification Behavior:** Runs a two-class PET-bottle/aluminum-can model. On a successful inference the current firmware treats the result as accepted and sends `CMD:OPEN`.
4. **Wireless ESP-NOW Control Protocol:** Transmits commands (`CMD:OPEN`, `CMD:REJECT`, `CMD:READY`, `CMD:BOOT`) wirelessly to the 2nd ESP32 Kiosk Controller over 2.4 GHz ESP-NOW with zero physical wiring.
5. **WiFi & Cloud Telemetry:** Polls user recycling sessions, background-syncs deposit records with Vercel/Postgres, and streams hardware logs.

> **Safety notice:** confidence/margin and hand/paper/empty-chute settings exist in `config.h`, but the current vision loop does not enforce them. This firmware is for supervised bench testing until a reject path is implemented and validated.

---

## 🔌 Hardware Wiring

> ⚡ **ZERO WIRING TO 2ND ESP32:** Inter-ESP32 communication is completely wireless (ESP-NOW)!

| ESP32-CAM Pin | Connect To | Description |
|:---|:---|:---|
| **5V** | 5V 2A Power Supply (+) | Logic power |
| **GND** | Power Supply (-) | Ground |
| **GPIO33** | Built-in Red LED (Internal) | Status Indicator |
| **GPIO4** | Built-in Flash LED (Internal) | Chute illumination |

---

## ⚙️ Configuration (`config.h`)

Open `config.h` to set your credentials:

```cpp
#define WIFI_SSID      "Fibott"
#define WIFI_PASSWORD  "your-wifi-password"
#define BACKEND_HOST   "fibott.vercel.app"
#define DEVICE_API_KEY "fibott_dev_your_key_here"
```

---

## 💻 Arduino IDE Flashing Guide

1. Board: **AI Thinker ESP32-CAM**
2. PSRAM: **OPI PSRAM** (Required!)
3. Upload Speed: **921600** (or 115200 if connection fails)
4. Partition Scheme: **Huge APP (3MB No OTA/1MB SPIFFS)**
5. Connect **GPIO0 to GND** before powering on to enter bootloader mode.
6. Click **Upload**, wait for completion, then disconnect GPIO0 from GND and press **RST**.
