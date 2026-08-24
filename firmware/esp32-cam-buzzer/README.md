# ESP32-CAM Buzzer Firmware Options

This folder contains two Arduino firmware versions for the **Fibott Reverse Vending Kiosk**, tailored to the specific type of buzzer hardware component you are using:

---

## 📁 Available Firmware Versions

### 1. [`esp32-cam-buzzer-2pin/`](./esp32-cam-buzzer-2pin/)
* **Hardware:** 2-pin standalone buzzer (Piezo disk or electromagnetic buzzer element without a breakout PCB).
* **Connections:** 2 wires (`+` / Signal to **GPIO14**, `-` / Ground to **GND**).
* **Modes Supported:** Active 2-pin buzzer (direct GPIO ON/OFF) and Passive 2-pin buzzer (hardware PWM tone generation with custom pitch frequencies).
* **Best for:** Direct component wiring, compact setups, custom tone pitches.

### 2. [`esp32-cam-buzzer-3pin/`](./esp32-cam-buzzer-3pin/)
* **Hardware:** 3-pin buzzer breakout module (such as KY-012, HW-508, or KY-006 module boards).
* **Connections:** 3 wires (`VCC` to **5V/3.3V**, `GND` to **GND**, `SIG`/`I/O` to **GPIO14**).
* **Modes Supported:** Active-HIGH modules, Active-LOW modules (via onboard transistor), and Passive 3-pin modules.
* **Best for:** Modular breakout boards with transistor drivers and power regulation.

---

## 🔌 Hardware Comparison Quick Reference

| Feature | 2-Pin Buzzer Version | 3-Pin Buzzer Module Version |
| :--- | :--- | :--- |
| **Number of Pins** | 2 (`+`, `-`) | 3 (`VCC`, `GND`, `SIG`) |
| **Power Source** | Driven directly by GPIO14 | Power from VCC pin (5V or 3.3V) |
| **Signal Pin** | GPIO14 | GPIO14 |
| **Transistor Driver** | Optional / External | Built-in on breakout PCB |
| **Polarity Option** | Direct HIGH / PWM | Configurable Active-HIGH or Active-LOW |
| **Folder Name** | [`esp32-cam-buzzer-2pin`](./esp32-cam-buzzer-2pin/) | [`esp32-cam-buzzer-3pin`](./esp32-cam-buzzer-3pin/) |

---

## 🚀 Getting Started

1. Check your buzzer component pins:
   - If it has **2 pins** (usually labeled `+` and `-` or one longer lead): Open [`esp32-cam-buzzer-2pin/esp32-cam-buzzer-2pin.ino`](./esp32-cam-buzzer-2pin/esp32-cam-buzzer-2pin.ino).
   - If it has **3 pins** on a small circuit board (labeled `VCC`, `GND`, `I/O` or `+`, `-`, `S`): Open [`esp32-cam-buzzer-3pin/esp32-cam-buzzer-3pin.ino`](./esp32-cam-buzzer-3pin/esp32-cam-buzzer-3pin.ino).
2. Edit `config.h` in the corresponding folder to set your Wi-Fi credentials (`WIFI_SSID`, `WIFI_PASSWORD`) and backend API key (`DEVICE_API_KEY`).
3. Select board **AI Thinker ESP32-CAM** in Arduino IDE and flash!
