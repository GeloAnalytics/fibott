# ESP32-CAM 2-Pin Buzzer Firmware

This firmware variant is designed for **2-pin standalone buzzers** (active or passive piezo elements) connected directly to the ESP32-CAM.

---

## 🛠️ Wiring Diagram

| ESP32-CAM Pin | Buzzer Lead / Component Pin | Description |
| :--- | :--- | :--- |
| **GPIO14** | **Positive (+) / Signal** | Buzzer positive lead (long pin or marked `+`) |
| **GND** | **Negative (-) / Ground** | Buzzer ground lead (short pin or marked `-`) |
| **GPIO13** | Servo Signal (`PWM`) | Gate servo control |
| **GPIO33** | Onboard LED | Status LED indicator (active-LOW) |
| **5V / GND** | Power Supply | Recommended 5V 2A+ external power supply |

> ⚠️ **Note on GPIO14:** GPIO14 is safe to use on the AI-Thinker ESP32-CAM board. It is not used by PSRAM, camera data lines, or strapping pins during boot.

---

## ⚙️ Configuration (`config.h`)

Open `config.h` to configure your Wi-Fi and buzzer mode:

```cpp
#define WIFI_SSID     "YOUR_WIFI_SSID"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"
#define DEVICE_API_KEY "your-device-api-key"
```

### Active vs. Passive Buzzer Modes

- **Active 2-Pin Buzzer** (`BUZZER_MODE BUZZER_TYPE_ACTIVE`):
  - Simple ON/OFF digital output via GPIO14.
  - Generates standard beep pulses.

- **Passive 2-Pin Buzzer** (`BUZZER_MODE BUZZER_TYPE_PASSIVE`):
  - Uses ESP32 LEDC hardware PWM generator (Timer 1, Channel 1).
  - Plays different sound pitch frequencies:
    - Boot complete: 2700 Hz
    - Ready prompt: 3000 Hz
    - Deposit Accepted: 3500 Hz
    - Deposit Rejected: 1800 Hz
    - Error warning: 1200 Hz

---

## 🔊 Audible Feedback Patterns

- **1 Short Beep:** Boot complete / System entering IDLE.
- **1 Mid Beep:** Session active / Ready for bottle/can placement.
- **1 Long Tone:** Deposit ACCEPTED (Gate opens).
- **3 Rapid Beeps:** Deposit REJECTED (Unrecognized item).
- **1 Long Warning Tone:** Wi-Fi or API upload error.

---

## 💻 Arduino IDE Flash Instructions

1. Board: `AI Thinker ESP32-CAM`
2. PSRAM: `OPI PSRAM` (Enabled)
3. Upload Speed: `115200`
4. Connect GPIO0 to GND during flash, then release and reset.
