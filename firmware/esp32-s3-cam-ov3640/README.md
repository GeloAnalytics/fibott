# ESP32-S3 N16R8 CAM (OV3640) Vision & AI Inference Node

This firmware turns the **ESP32-S3 N16R8 CAM Development Board** (with **OV3640 3MP Sensor**, **16MB Flash**, and **8MB Octal PSRAM**) into a high-performance **Computer Vision and On-Device TinyML Processing Node** for Fibott, replacing the legacy ESP32-CAM.

---

## 🚀 Why Upgrade to ESP32-S3 N16R8 + OV3640?

| Feature | Legacy ESP32-CAM (AI-Thinker) | ESP32-S3 N16R8 CAM (OV3640) | Advantage |
|:---|:---|:---|:---|
| **SoC / Architecture** | ESP32 Dual-Core LX6 @ 160–240MHz | **ESP32-S3 Dual-Core Xtensa LX7 @ 240MHz** | ~2x–3x faster TinyML inference with Vector DSP instructions |
| **Camera Sensor** | OV2640 (2.0 Megapixel) | **OV3640 (3.0 Megapixel)** | Crisp detail, higher dynamic range, better low-light response |
| **Flash Memory** | 4 MB Quad-SPI Flash | **16 MB SPI Flash (N16)** | Massive room for large models, OTA partitions, and file systems |
| **PSRAM Memory** | 2 MB / 4 MB Quad-SPI PSRAM | **8 MB Octal (OPI) PSRAM (R8)** | Double-buffered DMA capture, zero frame drops, larger TFLite arenas |
| **USB Connectivity** | Requires external FTDI or CH340 + GPIO0 jumper | **Native USB-C (USB CDC & JTAG on chip)** | Single-cable flashing & real-time serial monitor without jumpers |
| **Wireless Protocol** | ESP-NOW + 2.4GHz Wi-Fi | **ESP-NOW + 2.4GHz Wi-Fi + BLE 5.0** | Sub-10ms inter-board control with zero physical wires |

---

## 🎯 Primary Responsibilities

1. **OV3640 High-Speed Image Acquisition:** Captures clean, high-dynamic-range frames with auto-exposure, auto-white-balance, and dimmable flash illumination.
2. **On-Device MobileNetV1 TinyML:** Real-time INT8 quantized neural network inference accelerated by ESP32-S3's vector extensions in 8MB Octal PSRAM (< 45ms per inference).
3. **Multi-Tier Rejection Engine:**
   - Detects and rejects **Human Hands & Skin Tones** in the chute.
   - Detects and rejects **Flat White Paper, Tissues, and Cardboard**.
   - Detects and rejects **Empty / Dark chute scenes**.
   - Enforces strict minimum confidence (≥ 78%) and class separation margin (≥ 50%).
4. **Wireless ESP-NOW Control Protocol:** Transmits instant actuation triggers (`CMD:OPEN`, `CMD:REJECT`, `CMD:READY`, `CMD:BOOT`) over 2.4 GHz ESP-NOW to the 2nd ESP32 Kiosk Controller with **zero physical wires**.
5. **Cloud Backend Telemetry & Sync:** Polls user recycling sessions, background-uploads deposit frames via multipart HTTPS (`POST /api/device/deposit-image`), and logs hardware telemetry.

---

## 📁 File Structure

```
firmware/esp32-s3-cam-ov3640/
├── esp32-s3-cam-ov3640.ino   # Main Arduino sketch & FSM logic
├── config.h                 # User credentials, thresholds, and sensor settings
├── camera_pins.h            # Pinout definitions for ESP32-S3 CAM boards
├── model_data.h             # Quantized MobileNetV1 INT8 neural network model
└── README.md                # Documentation and flashing guide
```

---

## ⚙️ Configuration (`config.h`)

Open `config.h` before flashing to configure your credentials:

```cpp
#define WIFI_SSID      "Fibott"
#define WIFI_PASSWORD  "your-wifi-password"
#define BACKEND_HOST   "fibott.vercel.app"
#define DEVICE_API_KEY "fibott_dev_your_key_here"
```

---

## 🔌 Camera Pinout Reference (`camera_pins.h`)

The default configuration is preset for standard **ESP32-S3 N16R8 CAM**, **Freenove ESP32-S3 CAM**, and **ESP32-S3-EYE** modules:

| Signal | ESP32-S3 GPIO | Description |
|:---|:---|:---|
| **XCLK** | `GPIO 15` | Master Clock (20 MHz) |
| **PCLK** | `GPIO 13` | Pixel Clock |
| **VSYNC** | `GPIO 6` | Vertical Sync |
| **HREF** | `GPIO 7` | Horizontal Reference |
| **SIOD (SDA)** | `GPIO 4` | I2C / SCCB Data |
| **SIOC (SCL)** | `GPIO 5` | I2C / SCCB Clock |
| **Y2 – Y9 (D0–D7)** | `11, 9, 8, 10, 12, 18, 17, 16` | 8-bit Parallel Camera Data Bus |
| **Status LED** | `GPIO 2` | Onboard Activity LED |
| **Flash LED** | `GPIO 48` (or configurable) | Chute Illumination (PWM dimmed) |
| **Power (5V / GND)** | `5V` & `GND` | Clean 5V DC power supply |

---

## 💻 Arduino IDE Flashing & Setup Guide

### 1. Install Arduino ESP32 Board Package
1. Open Arduino IDE → **Preferences**.
2. Add the following URL to **Additional Board Manager URLs**:
   ```
   https://espressif.github.io/arduino-esp32/package_esp32_index.json
   ```
3. Go to **Boards Manager** → Search `esp32` by Espressif Systems → Install version **2.0.14** or newer (3.x supported).

### 2. Install Required Libraries
Open **Tools → Manage Libraries...** and install:
- **`ArduinoJson`** (version ≥ 7.0 by Benoit Blanchon)
- **`Chirale_TensorFlowLite`** (by Chirale)

### 3. Configure Arduino IDE Tools Menu
Ensure your **Tools** menu matches these settings exactly:

| Setting | Value |
|:---|:---|
| **Board** | **`ESP32S3 Dev Module`** |
| **PSRAM** | **`OPI PSRAM`** *(CRITICAL: S3 N16R8 uses 8MB Octal PSRAM)* |
| **Flash Size** | **`16MB (128Mb)`** |
| **Flash Mode** | **`QIO 80MHz`** or **`OPI 80MHz`** |
| **Partition Scheme** | **`16M Flash (3MB APP/9.9MB FATFS)`** or **`Huge APP (3MB No OTA/1MB SPIFFS)`** |
| **USB CDC On Boot** | **`Enabled`** *(Allows Serial monitor to work through USB-C port)* |
| **Upload Mode** | **`UART0 / Hardware CDC`** |
| **USB DFU On Boot** | `Disabled` |
| **CPU Frequency** | **`240MHz (WiFi)`** |
| **Core Debug Level** | `None` (or `Info` for verbose diagnostics) |
| **Port** | Select your ESP32-S3 USB COM port |

### 4. Upload Firmware
1. Connect the ESP32-S3 board to your PC using a USB-C cable.
2. Click **Upload** (arrow icon).
3. Open **Serial Monitor** at **115200 baud**.
4. You should see the startup banner displaying dual-core diagnostics, 8MB PSRAM detection, OV3640 sensor initialization, and ESP-NOW link ready!

---

## 📡 Wireless Inter-ESP32 Protocol (ESP-NOW)

The ESP32-S3 CAM sends instant binary commands to the secondary ESP32 Kiosk Controller over 2.4 GHz ESP-NOW:

```
┌──────────────────────────────────────┐     2.4 GHz ESP-NOW Wireless Link     ┌──────────────────────────────────────┐
│     ESP32-S3 N16R8 (Vision Node)     │ · · · · · · · · · · · · · · · · · · · > │     ESP32 #2: Kiosk Controller       │
│                                      │       (ZERO PHYSICAL WIRING!)           │           (Actuator Node)            │
│ • OV3640 3MP Camera Capture          │                                         │ • SG90 / MG90S Gate Servo (GPIO18)   │
│ • MobileNetV1 INT8 in 8MB Octal PSRAM│                                         │ • Onboard Blue Status LED (GPIO2)    │
│ • Multi-Layer Rejection Engine       │                                         │ • Independent 5V Motor Power Supply  │
│ • WiFi + Cloud Backend Sync          │                                         │ • Sub-10ms Wireless Command Reaction │
└──────────────────────────────────────┘                                         └──────────────────────────────────────┘
```

| Command | Payload | Action on 2nd ESP32 |
|:---|:---|:---|
| `CMD:BOOT` | `WirelessCommandPacket` | Initial boot notification & status blink |
| `CMD:READY` | `WirelessCommandPacket` | Prompts user with ready chime & LED pattern |
| `CMD:OPEN` | `WirelessCommandPacket` | Opens servo gate for 3s to accept bottle/can |
| `CMD:REJECT` | `WirelessCommandPacket` | Flashes reject pattern; keeps gate firmly locked 🔒 |
| `CMD:ERROR` | `WirelessCommandPacket` | Flashes error warning pattern |
