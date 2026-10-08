# 🛠️ Fibott Hardware Installation & Setup Manual

This document is the official, comprehensive guide for technicians, engineers, and installers setting up the **Fibott Reverse Vending Kiosk** hardware.

---

## 📑 Table of Contents

1. [System Architecture (Dual-ESP32 Design)](#1-system-architecture-dual-esp32-design)
2. [Bill of Materials (BOM)](#2-bill-of-materials-bom)
3. [Pinout & Complete Wiring Diagram](#3-pinout--complete-wiring-diagram)
4. [Software & Arduino IDE Setup](#4-software--arduino-ide-setup)
5. [Firmware Configuration (`config.h`)](#5-firmware-configuration-configh)
6. [Flashing Instructions](#6-flashing-instructions)
7. [Testing & Verification Workflow](#7-testing--verification-workflow)
8. [Anti-False-Positive Engine (Hand & Paper Rejection)](#8-anti-false-positive-engine-hand--paper-rejection)
9. [Troubleshooting & FAQs](#9-troubleshooting--faqs)

---

## 1. System Architecture (Dual-ESP32 Design)

The Fibott kiosk uses a **Dual-ESP32 Architecture** to separate high-frequency machine learning vision processing from high-current motor actuation:

```
                                  5V 2A+ External Power Supply
                                  ┌──────────────────────────┐
                                  │   +5V              GND   │
                                  └────┬────────────────┬────┘
                                       │                │
            ┌──────────────────────────┴────┐           │ (Common GND)
            │                               │           │
            ▼                               ▼           ▼
┌───────────────────────────────┐       ┌───────────────────────────────┐
│      ESP32 #1: ESP32-CAM      │       │  ESP32 #2: Kiosk Controller   │
│         (Vision Node)         │       │        (Actuator Node)        │
│                               │       │                               │
│ • OV2640 Image Acquisition    │       │ • SG90/MG90S Servo Gate       │
│ • MobileNetV1 TinyML in PSRAM │       │ • Audio Feedback Buzzer       │
│ • Skin / Paper / Clutter Stop │       │ • Status LED Indicators       │
│ • WiFi + Cloud Sync (Vercel)  │       │ • Dedicated Motor Power       │
│                               │       │                               │
│    GPIO13 (TX) ───────────────┼───────┼──> GPIO16 (RX2)               │
│    GPIO14 (RX) <──────────────┼───────┼─── GPIO17 (TX2) [Optional]    │
│    GND ───────────────────────┼───────┼─── GND [Mandatory]            │
└───────────────────────────────┘       └───────────────────────────────┘
```

### Why Two ESP32 Boards?
* **Zero Brownouts:** Micro-servos draw up to 1.2A–1.5A stall current when opening/closing. Connecting a servo directly to the ESP32-CAM often causes voltage drops that reset the camera sensor. Offloading the servo to the 2nd ESP32 completely protects camera stability.
* **Non-Blocking Operation:** The camera can immediately begin uploading telemetry and polling the next session while the 2nd ESP32 smoothly operates the gate and audio feedback.

---

## 2. Bill of Materials (BOM)

| Item | Specification | Quantity | Purpose |
|:---|:---|:---|:---|
| **ESP32-CAM** | AI-Thinker module with OV2640 camera & PSRAM | 1 | Image capture & on-device AI inference |
| **ESP32 DevKit** | Standard 30-pin or 38-pin ESP32 NodeMCU / WROOM-32 | 1 | Servo & buzzer actuator controller |
| **Servo Motor** | SG90 (plastic gear) or MG90S (metal gear, recommended) | 1 | Chute trapdoor / gate mechanism |
| **Buzzer** | 5V Active Piezo Buzzer (or 2-pin passive buzzer) | 1 | Audio feedback for user interaction |
| **Power Supply** | 5V DC 2.0A–3.0A power adapter or LM2596 Buck Converter | 1 | Stable power for logic and motor |
| **Jumper Wires** | Female-to-Female and Male-to-Female Dupont wires | ~15 | Interconnection |
| **USB Cables / FTDI**| Micro-USB cable (or FTDI programmer for ESP32-CAM) | 1–2 | Firmware flashing and serial debugging |

---

## 3. Pinout & Complete Wiring Diagram

### A. Inter-ESP32 UART Connection
| ESP32-CAM Pin | 2nd ESP32 Controller Pin | Description |
|:---|:---|:---|
| **GPIO13** | **GPIO16 (RX2)** | High-speed serial command line (115200 baud) |
| **GPIO14** | **GPIO17 (TX2)** | Feedback signal line |
| **GND** | **GND** | **MANDATORY: Both boards must share common ground!** |

### B. ESP32-CAM (Vision Node)
| Pin | Connect To | Description |
|:---|:---|:---|
| **5V** | 5V Power Supply (+) | Logic power |
| **GND** | Power Supply (-) | Ground |
| **GPIO33** | Internal | Built-in Red Status LED |
| **GPIO4** | Internal | Built-in Flash LED (chute illumination) |

### C. 2nd ESP32 (Actuator Controller)
| Pin | Connect To | Description |
|:---|:---|:---|
| **VIN / 5V** | 5V Power Supply (+) | Board power |
| **GND** | Power Supply (-) & Servo Ground & Buzzer (-) | Ground |
| **GPIO18** | **Servo Signal** (Orange / Yellow wire) | 50Hz PWM Servo signal |
| **GPIO19** | **Buzzer (+)** (Long lead / red wire) | Audio signal |
| **5V Rail** | **Servo Power** (Red wire) | Direct 5V power to servo motor |

---

## 4. Software & Arduino IDE Setup

### 1. Install Arduino IDE
Download and install **Arduino IDE 2.x** or **1.8.x** from [arduino.cc](https://www.arduino.cc/en/software).

### 2. Add ESP32 Board Manager URL
1. In Arduino IDE, go to **File → Preferences**.
2. In **Additional Board Manager URLs**, paste:
   ```
   https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
   ```
3. Go to **Tools → Board → Boards Manager**, search for `esp32`, and install **esp32 by Espressif Systems** (version 2.0.14 or 3.x).

### 3. Install Required Libraries
Open **Sketch → Include Library → Manage Libraries...** and install:
1. **ArduinoJson** (Version **7.x** by Benoit Blanchon).
2. **Chirale_TensorFlowLite** (by Chirale / TFLite Micro for ESP32).

---

## 5. Firmware Configuration (`config.h`)

Before flashing the **ESP32-CAM**, open [`firmware/esp32-cam-vision/config.h`](file:///c:/Users/PC/Fibott/firmware/esp32-cam-vision/config.h) and verify these settings:

```cpp
// WiFi Configuration
#define WIFI_SSID      "Fibott"           // Hotspot SSID
#define WIFI_PASSWORD  ""                 // Hotspot Password (empty if open)

// Backend Server Configuration
#define BACKEND_HOST   "fibott.vercel.app"  // Hostname without https://
#define BACKEND_PORT   443
#define DEVICE_API_KEY "fibott_dev_xxxxxxxxxxxxxxxxxxxxxxxxxxxx" // From Admin Panel

// Strict AI Rejection Thresholds
#define ML_CONFIDENCE_THRESHOLD 0.78f     // 78% certainty minimum
#define ML_MARGIN_THRESHOLD     0.50f     // 50% separation margin

// Anti-False-Positive Filters
#define FILTER_ENABLE_HAND_DETECTION  true
#define FILTER_ENABLE_PAPER_DETECTION true
#define FILTER_ENABLE_EMPTY_CHUTE     true
```

> 🔑 **Where to get `DEVICE_API_KEY`:**
> 1. Log into the Fibott Web Portal as Admin.
> 2. Go to **Admin → Hardware / Device Alerts**.
> 3. Register your kiosk device (or copy the existing API key).

---

## 6. Flashing Instructions

### Part A: Flashing ESP32 #1 (ESP32-CAM)
1. Open [`firmware/esp32-cam-vision/esp32-cam-vision.ino`](file:///c:/Users/PC/Fibott/firmware/esp32-cam-vision/esp32-cam-vision.ino) in Arduino IDE.
2. Select the board configuration in **Tools**:
   - **Board:** `AI Thinker ESP32-CAM`
   - **PSRAM:** `OPI PSRAM` (or `Enabled`) ⚠️ *Crucial! Camera will fail without PSRAM!*
   - **Upload Speed:** `921600` (or `115200` if upload fails)
   - **Partition Scheme:** `Huge APP (3MB No OTA/1MB SPIFFS)`
   - **Port:** Select the COM port of your ESP32-CAM.
3. **Bootloader Mode:** Connect **GPIO0 to GND** with a jumper wire.
4. Plug in the USB cable and click **Upload**.
5. Once the upload displays `Done uploading (100%)`:
   - **Disconnect GPIO0 from GND**.
   - Press the **RST** button on the bottom of the ESP32-CAM.
6. Open **Serial Monitor** at **115200 baud** to observe the boot diagnostic banner.

---

### Part B: Flashing ESP32 #2 (Kiosk Actuator Controller)
1. Open [`firmware/kiosk-controller/kiosk-controller.ino`](file:///c:/Users/PC/Fibott/firmware/kiosk-controller/kiosk-controller.ino) in Arduino IDE.
2. Select the board configuration in **Tools**:
   - **Board:** `ESP32 Dev Module` (or `NodeMCU-32S` / `ESP32 WROOM-32`)
   - **Upload Speed:** `921600`
   - **Port:** Select the COM port of your 2nd ESP32.
3. Click **Upload**.
4. Once completed, open the **Serial Monitor** at **115200 baud**.

---

## 7. Testing & Verification Workflow

### Step 1: Standalone Hardware Test (Bench Test)
You can test the servo and buzzer on the 2nd ESP32 immediately without the camera!
1. Open Serial Monitor on the 2nd ESP32 port at **115200 baud**.
2. Type these commands into the input bar and press Enter:
   - `OPEN` ➔ Servo opens for 3 seconds, plays success chime, then closes.
   - `REJECT` ➔ Plays 3 rapid warning beeps.
   - `BEEP` ➔ Tests the buzzer.
   - `STATUS` ➔ Displays pin status and firmware version.

### Step 2: UART Link Test
1. Power on both boards with **GPIO13 connected to GPIO16** and **GND connected to GND**.
2. On the 2nd ESP32 Serial Monitor, you should see:
   ```
   [RECV    ] Command: 'CMD:BOOT'
   [ACTUATOR] ESP32-CAM booted successfully
   ```

### Step 3: Full End-to-End Deposit Test
1. Log into the Fibott web app on a smartphone or browser.
2. Tap **"Start Recycling"** on the User Dashboard.
3. The kiosk will beep (`CMD:READY`) and blink the LED.
4. Insert a **plastic bottle** ➔ Camera captures frame ➔ Gate opens for 3s (`CMD:OPEN`) ➔ Points added to user wallet.
5. Insert a **piece of paper** or **hand** ➔ Camera rejects frame ➔ 3 rapid warning beeps (`CMD:REJECT`) ➔ Gate remains locked.

---

## 8. Anti-False-Positive Engine (Hand & Paper Rejection)

The kiosk uses a 4-layer defense system against non-recyclable materials:

| Test Layer | Trigger Condition | Result |
|:---|:---|:---|
| **1. Hand / Skin Detector** | Skin tone RGB pixel ratio > 16% of scene | **REJECTED** (`hand_detected`) |
| **2. Flat Paper Detector** | High uniform brightness (>155) & zero color variance (<7.5) | **REJECTED** (`paper_detected`) |
| **3. Empty Chute Detector** | Excessively dark scene (brightness < 22) | **REJECTED** (`empty_chute`) |
| **4. Strict AI Margin** | Model confidence < 78% or class difference < 50% | **REJECTED** (`low_confidence`) |

---

## 9. Troubleshooting & FAQs

### Q1: Camera fails to initialize (`esp_camera_init failed`)
* **Solution 1:** Verify that `PSRAM` is set to **OPI PSRAM** in Arduino IDE.
* **Solution 2:** Gently unclip and reseat the OV2640 ribbon cable into the camera connector.
* **Solution 3:** Ensure the power supply provides at least **5V 2A**.

### Q2: Servo gate does not move
* **Solution 1:** Verify that the 2nd ESP32 is powered and the servo signal wire is connected to **GPIO18**.
* **Solution 2:** Check that the servo power (Red wire) is connected to **5V**, not 3.3V.
* **Solution 3:** Open Serial Monitor and type `OPEN` to verify physical servo function.

### Q3: 401 Unauthorized in Serial Monitor
* **Solution:** The `DEVICE_API_KEY` in `config.h` does not match any active device in the database. Generate a new key in the Admin Panel and update `config.h`.

### Q4: Camera reboots when the servo turns
* **Solution:** Make sure you are using the **Dual-ESP32 architecture**! Do NOT connect the servo to the ESP32-CAM. Power the servo from the 2nd ESP32 or external 5V power supply with common ground.
