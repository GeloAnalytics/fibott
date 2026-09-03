# Fibott — ESP32-CAM Firmware

This directory contains the **one canonical firmware** for the Fibott reverse vending kiosk and its auxiliary controller.

---

## 📁 Firmware Files

| Folder | Target | Purpose |
|:---|:---|:---|
| [`esp32-cam-buzzer/esp32-cam-buzzer-2pin/`](./esp32-cam-buzzer/esp32-cam-buzzer-2pin/) | **AI-Thinker ESP32-CAM** | Production firmware — camera, servo gate, 2-pin buzzer, WiFi, telemetry |
| [`kiosk-controller/`](./kiosk-controller/) | Standalone MCU | Auxiliary chute sensors and gate triggers (secondary controller) |

> **`esp32-cam/`** (if still present) is a legacy no-buzzer sketch kept only for git history.
> Do not flash it — use the 2-pin buzzer firmware above.

---

## 🚀 Quick Start (ESP32-CAM)

### 1. Hardware Wiring

| ESP32-CAM Pin | Component | Description |
|:---|:---|:---|
| **GPIO13** | Servo signal (PWM) | SG90/MG90S gate actuator |
| **GPIO14** | Buzzer (+) / signal | 2-pin buzzer positive lead |
| **GND** | Buzzer (−) | 2-pin buzzer ground lead |
| **GPIO33** | Onboard red LED | Status indicator (active-LOW) |
| **5V / GND** | External power supply | Use 5V 2A+ (camera + servo peak ~1.5A) |

### 2. Configure `config.h`

Open [`esp32-cam-buzzer/esp32-cam-buzzer-2pin/config.h`](./esp32-cam-buzzer/esp32-cam-buzzer-2pin/config.h) and set:

```cpp
#define WIFI_SSID      "your-wifi-name"
#define WIFI_PASSWORD  "your-wifi-pass"
#define DEVICE_API_KEY "fibott_dev_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

All timing, servo positions, buzzer mode, and frequencies are also in `config.h`.

### 3. Arduino IDE Settings

| Setting | Value |
|:---|:---|
| Board | **AI Thinker ESP32-CAM** |
| PSRAM | **OPI PSRAM** ← required! |
| Upload Speed | 115200 |
| CPU Frequency | 240 MHz |

### 4. Flash

1. Connect **GPIO0 → GND** before powering on (enter bootloader mode)
2. Click **Upload** in Arduino IDE
3. After upload finishes, **disconnect GPIO0 from GND** and press **RST**
4. Open Serial Monitor at **115200 baud** — you'll see the full boot banner

---

## 🔊 Audible Feedback (2-Pin Buzzer)

| Event | Pattern | Frequency (passive mode) |
|:---|:---|:---|
| Boot complete | 1 short beep (80 ms) | 2700 Hz |
| Session active / ready | 1 mid beep (100 ms) | 3000 Hz |
| Deposit accepted | 1 long tone (300 ms) | 3500 Hz |
| Deposit rejected | 3 rapid beeps (120 ms each) | 1800 Hz |
| WiFi / upload error | 1 long warning tone (500 ms) | 1200 Hz |

---

## 📡 Admin Telemetry

The firmware sends structured logs to `/api/device/logs` which appear in the **Admin → System & Hardware Logs** panel in real-time. Key events logged:

- Boot complete with IP address, RSSI, heap, firmware version
- WiFi connections and disconnects/reconnects
- Camera capture failures with diagnostic hints
- Image upload success/failure with HTTP status codes
- Deposit classification results (label, material, confidence)
- Periodic heartbeat (every 60s while idle) to update device "last seen" time

---

## 🛠️ Serial Monitor Diagnostics

The firmware uses a structured `[TAG    ]` format on all serial output.
Search for these tags in the Serial Monitor (115200 baud):

| Tag | Description |
|:---|:---|
| `[BOOT    ]` | Startup sequence events |
| `[WIFI    ]` | WiFi connection/reconnection |
| `[POLL    ]` | Session polling to backend |
| `[CAMERA  ]` | OV2640 frame capture |
| `[UPLOAD  ]` | Image upload to Vercel |
| `[GATE    ]` | Servo open/close |
| `[FSM     ]` | State machine transitions |
| `[HEARTBT ]` | Periodic health pings |
| `[TELEMETRY]` | Log relay confirmation |
