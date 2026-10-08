# ESP32-CAM Vision & AI Inference Node

This firmware turns the **AI-Thinker ESP32-CAM** into a dedicated **Computer Vision and AI Processing Node**.

---

## 🎯 Primary Responsibilities

1. **OV2640 Image Capture:** High-speed frame acquisition with auto-exposure and dimmed flash LED illumination (GPIO4).
2. **On-Device MobileNetV1 TinyML:** Real-time INT8 quantized neural network inference running in PSRAM.
3. **Multi-Layer Rejection Engine:**
   - Detects and rejects **Human Hands & Skin Tones** in the chute.
   - Detects and rejects **Flat White Paper, Tissues, and Cardboard**.
   - Detects and rejects **Empty/Dark chute scenes**.
   - Enforces strict minimum confidence (≥ 78%) and separation margin (≥ 50%).
4. **UART Control Protocol:** Transmits commands (`CMD:OPEN`, `CMD:REJECT`, `CMD:READY`, `CMD:BOOT`) to the 2nd ESP32 Kiosk Controller on GPIO13 (TX).
5. **WiFi & Cloud Telemetry:** Polls user recycling sessions, background-syncs deposit records with Vercel/Postgres, and streams hardware logs.

---

## 🔌 Hardware Wiring

| ESP32-CAM Pin | Connect To | Description |
|:---|:---|:---|
| **GPIO13 (TX)** | 2nd ESP32 **GPIO16 (RX2)** | Command transmitter |
| **GPIO14 (RX)** | 2nd ESP32 **GPIO17 (TX2)** | Feedback receiver (optional) |
| **GND** | 2nd ESP32 **GND** & Power GND | **Mandatory Common Ground** |
| **5V** | 5V 2A Power Supply | Power |
| **GPIO33** | Built-in Red LED | Status Indicator |
| **GPIO4** | Built-in Flash LED | Chute illumination |

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
