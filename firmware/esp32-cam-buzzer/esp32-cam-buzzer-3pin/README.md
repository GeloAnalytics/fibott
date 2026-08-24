# ESP32-CAM 3-Pin Buzzer Module Firmware

This firmware variant is designed for **3-pin buzzer breakout modules** (e.g. KY-012, HW-508, KY-006, or generic active/passive buzzer PCB modules) featuring onboard transistor drivers and power regulation.

---

## 🛠️ Wiring Diagram

| ESP32-CAM Pin | Buzzer Module Pin | Description |
| :--- | :--- | :--- |
| **5V** or **3.3V** | **VCC** (or `+`) | Module power input (Match module voltage: usually 5V or 3.3V) |
| **GND** | **GND** (or `-`) | Module ground connection |
| **GPIO14** | **SIG** / **I/O** / **S** | Signal control line |
| **GPIO13** | Servo Signal (`PWM`) | Gate servo control |
| **GPIO33** | Onboard LED | Status LED indicator (active-LOW) |

---

## ⚙️ Configuration (`config.h`)

Open `config.h` to set your credentials and module logic polarity:

```cpp
#define WIFI_SSID     "YOUR_WIFI_SSID"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"
#define DEVICE_API_KEY "your-device-api-key"
```

### Module Polarity Configuration (`BUZZER_ACTIVE_LOGIC`)

Breakout modules use an onboard transistor (NPN or PNP) to switch the buzzer. Depending on your board model:

- **Active-HIGH Modules** (`#define BUZZER_ACTIVE_LOGIC HIGH`):
  - Setting `GPIO14` to `HIGH` turns the buzzer **ON**.
  - Setting `GPIO14` to `LOW` turns the buzzer **OFF**.
  - *Default for most NPN transistor breakout boards.*

- **Active-LOW Modules** (`#define BUZZER_ACTIVE_LOGIC LOW`):
  - Setting `GPIO14` to `LOW` turns the buzzer **ON**.
  - Setting `GPIO14` to `HIGH` turns the buzzer **OFF**.
  - *Used by PNP transistor boards (e.g. HW-508, some KY-012 variations).*

> 💡 **Testing Polarity:** If your buzzer stays on constantly or stays silent when it should beep, change `BUZZER_ACTIVE_LOGIC` from `HIGH` to `LOW` (or vice versa).

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
