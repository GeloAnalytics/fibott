# 🛠️ Fibott Hardware Installation & Setup Manual

This document is the official, comprehensive guide for technicians, engineers, and installers setting up the **Fibott Reverse Vending Kiosk** hardware.

---

## 📑 Table of Contents

1. [System Architecture (100% Wireless Dual-ESP32 Design)](#1-system-architecture-100-wireless-dual-esp32-design)
2. [Bill of Materials (BOM)](#2-bill-of-materials-bom)
3. [Pinout & Complete Wiring Diagram](#3-pinout--complete-wiring-diagram)
4. [Software & Arduino IDE Setup](#4-software--arduino-ide-setup)
5. [Firmware Configuration (`config.h`)](#5-firmware-configuration-configh)
6. [Flashing Instructions](#6-flashing-instructions)
7. [Testing & Verification Workflow](#7-testing--verification-workflow)
8. [Current Classification Safety Status](#8-current-classification-safety-status)
9. [Troubleshooting & FAQs](#9-troubleshooting--faqs)

---

## 1. System Architecture (100% Wireless Dual-ESP32 Design)

The Fibott kiosk uses a **Dual-ESP32 Wireless Architecture** to separate high-frequency machine learning vision processing from high-current motor actuation with **ZERO physical wiring between the two microcontrollers**:

```
 5V Clean Logic Supply                                              5V High-Current Supply
┌──────────────────────┐                                           ┌──────────────────────┐
│  +5V            GND  │                                           │  +5V            GND  │
└─┬────────────────┬───┘                                           └─┬────────────────┬───┘
  │                │                                                 │                │
  ▼                ▼                                                 ▼                ▼
┌───────────────────────────────┐     2.4 GHz ESP-NOW Wireless      ┌───────────────────────────────┐
│      ESP32 #1: ESP32-CAM      │ · · · · · · · · · · · · · · · · > │  ESP32 #2: Kiosk Controller   │
│         (Vision Node)         │    (ZERO PHYSICAL WIRING!)        │        (Actuator Node)        │
│                               │                                   │                               │
│ • OV2640 Image Acquisition    │                                   │ • SG90/MG90S Servo Gate       │
│ • MobileNetV1 TinyML in PSRAM │                                   │ • Status LED Indicators       │
│ • Two-class TinyML inference  │                                   │ • Dedicated Motor Power       │
│ • WiFi + Cloud Sync (Vercel)  │                                   │ • Sub-10ms Wireless Receiver  │
│ • Sub-10ms ESP-NOW Broadcast  │                                   │                               │
└───────────────────────────────┘                                   └───────────────────────────────┘
```

### Why Wireless Dual-ESP32?
* **Zero Brownouts & Complete Electrical Isolation:** Micro-servos draw up to 1.2A–1.5A stall current when opening/closing. Because there is **no electrical wiring or common ground connection** between the boards, inductive motor kickback and voltage sags can NEVER reach the camera or cause camera brownouts.
* **Flexible Modular Placement:** The camera unit and the trapdoor actuator can be placed in separate compartments or physical housings of the kiosk without running long signal cables.
* **Non-Blocking Real-Time Operation:** The ESP32-CAM broadcasts commands (`CMD:OPEN`, `CMD:REJECT`, `CMD:READY`) via Espressif's high-speed ESP-NOW protocol (<10ms latency) while uploading frames to the cloud.

---

## 2. Bill of Materials (BOM)

| Item | Specification | Quantity | Purpose |
|:---|:---|:---|:---|
| **ESP32-CAM** | AI-Thinker module with OV2640 camera & PSRAM | 1 | Image capture & on-device AI inference |
| **ESP32 DevKit** | Standard 30-pin or 38-pin ESP32 NodeMCU / WROOM-32 | 1 | Servo gate actuator controller |
| **Servo Motor** | SG90 (plastic gear) or MG90S (metal gear, recommended) | 1 | Chute trapdoor / gate mechanism |
| **Power Supply** | 5V DC 2.0A–3.0A power adapters or dual USB supplies | 1–2 | Clean power for logic and dedicated motor power |
| **Jumper Wires** | Female-to-Female Dupont wires | ~4 | Actuator wiring on 2nd ESP32 |
| **USB Cables / FTDI**| Micro-USB cable (or FTDI programmer for ESP32-CAM) | 1–2 | Firmware flashing and serial debugging |

---

## 3. Pinout & Complete Wiring Diagram

### A. Inter-ESP32 Connection
> ⚡ **NO PHYSICAL WIRES BETWEEN BOARDS!**
> - The ESP32-CAM and ESP32 DevKit communicate **100% wirelessly** via Espressif ESP-NOW at 2.4 GHz.
> - **No UART RX/TX cables** and **No inter-board GND wires** are required.

### B. ESP32-CAM (Vision Node)
| Pin | Connect To | Description |
|:---|:---|:---|
| **5V** | 5V Power Supply (+) | Clean logic power |
| **GND** | Power Supply (-) | Ground |
| **GPIO33** | Internal | Built-in Red Status LED |
| **GPIO4** | Internal | Built-in Flash LED (dimmed PWM for chute illumination) |

### C. 2nd ESP32 (Actuator Controller)
| Pin | Connect To | Description |
|:---|:---|:---|
| **VIN / 5V** | 5V Power Supply (+) | Board power |
| **GND** | Power Supply (-) & Servo Ground | Ground |
| **GPIO18** | **Servo Signal** (Orange / Yellow wire) | 50Hz PWM Servo signal |
| **5V Rail** | **Servo Power** (Red wire) | Dedicated 5V power to servo motor |
| **GPIO2** | Internal | Built-in Blue Status & Packet LED |

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

### Part A: ESP32-CAM Configuration
Open [`firmware/esp32-cam-vision/config.h`](file:///c:/Users/PC/Fibott/firmware/esp32-cam-vision/config.h):

```cpp
// WiFi Configuration
#define WIFI_SSID      "Fibott"           // Hotspot SSID
#define WIFI_PASSWORD  ""                 // Hotspot Password (empty if open)

// Backend Server Configuration
#define BACKEND_HOST   "fibott.vercel.app"  // Hostname without https://
#define BACKEND_PORT   443
#define DEVICE_API_KEY "fibott_dev_xxxxxxxxxxxxxxxxxxxxxxxxxxxx" // From Admin Panel

// Current values retained for the planned reject path. They are not enforced
// by the current two-class vision loop.
#define ML_CONFIDENCE_THRESHOLD 0.50f
#define ML_MARGIN_THRESHOLD     0.05f

// Planned reject-path switches. They are not currently applied at runtime.
#define FILTER_ENABLE_HAND_DETECTION  true
#define FILTER_ENABLE_PAPER_DETECTION true
#define FILTER_ENABLE_EMPTY_CHUTE     true
```

### Part B: 2nd ESP32 Controller Configuration
Open [`firmware/kiosk-controller/config.h`](file:///c:/Users/PC/Fibott/firmware/kiosk-controller/config.h):

```cpp
// Connect to the same WiFi AP to automatically synchronize 2.4 GHz channel
#define WIFI_SSID     "Fibott"
#define WIFI_PASSWORD ""

#define PIN_SERVO       18
#define GATE_OPEN_MS    3000
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
You can test the servo gate on the 2nd ESP32 immediately without the camera!
1. Open Serial Monitor on the 2nd ESP32 port at **115200 baud**.
2. Type these commands into the input bar and press Enter:
   - `OPEN` ➔ Servo opens for 3 seconds, then closes.
   - `CLOSE` ➔ Forces servo gate closed.
   - `REJECT` ➔ Rejection sequence (flashes reject LED, keeps gate locked).
   - `STATUS` ➔ Displays pin status, channel, and firmware version.

### Step 2: Wireless ESP-NOW Link Test
1. Power on both boards (no wires connecting them).
2. On the 2nd ESP32 Serial Monitor, you should see:
   ```
   [WIRELESS_RECV] Packet received: 'CMD:BOOT'
   [ACTUATOR] ESP32-CAM booted successfully (wireless ping)
   ```

### Step 3: Full End-to-End Deposit Test
1. Log into the Fibott web app on a smartphone or browser.
2. Tap **"Start Recycling"** on the User Dashboard.
3. The kiosk controller will receive `CMD:READY` wirelessly and blink the blue LED.
4. Insert a **plastic bottle** ➔ Camera classifies frame ➔ Wireless packet `CMD:OPEN` sent ➔ Gate opens for 3s ➔ Points awarded.
5. Do **not** use paper or a hand as an acceptance/rejection test for this release: the current two-class loop does not enforce its reject controls and may open the gate. Test only under supervision until the reject path is implemented.

---

## 8. Current Classification Safety Status

The current ESP32-CAM artifact has two labels only: `PET_BOTTLE` and `ALUMINUM_CAN`. A successful inference always selects one of those labels. The current vision loop then marks it confident and sends `CMD:OPEN`.

`config.h` still contains confidence/margin and hand/paper/empty-chute settings for the planned reject path, but they are not applied by the current code. Do not claim that the kiosk rejects hands, paper, empty chutes, or general trash. Keep testing supervised until a reject class or calibrated out-of-distribution policy has been implemented and validated on the physical kiosk.

---

## 9. Troubleshooting & FAQs

### Q1: Camera fails to initialize (`esp_camera_init failed`)
* **Solution 1:** Verify that `PSRAM` is set to **OPI PSRAM** in Arduino IDE.
* **Solution 2:** Gently unclip and reseat the OV2640 ribbon cable into the camera connector.
* **Solution 3:** Ensure the power supply provides at least **5V 2A**.

### Q2: 2nd ESP32 does not receive wireless commands
* **Solution 1:** Ensure both ESP32 boards have the same `WIFI_SSID` in `config.h` so they are on the exact same 2.4 GHz channel.
* **Solution 2:** Type `STATUS` into the Serial Monitor of the 2nd ESP32 to verify its listening channel.

### Q3: Servo gate does not move
* **Solution 1:** Verify that the 2nd ESP32 is powered and the servo signal wire is connected to **GPIO18**.
* **Solution 2:** Check that the servo power (Red wire) is connected to **5V**, not 3.3V.
* **Solution 3:** Open Serial Monitor and type `OPEN` to verify physical servo function.

### Q4: 401 Unauthorized in Serial Monitor
* **Solution:** The `DEVICE_API_KEY` in `config.h` does not match any active device in the database. Generate a new key in the Admin Panel and update `config.h`.
