# Fibott Hardware Directory

This directory contains hardware documentation, wiring diagrams, and hardware references for the **Fibott Reverse Vending Kiosk**.

---

## 🔌 Core Hardware Components

- **Microcontroller:** AI-Thinker ESP32-CAM board (with PSRAM enabled).
- **Camera Sensor:** OV2640 JPEG camera sensor.
- **Gate Actuator:** SG90 / MG90S Micro Servo (Signal connected to **GPIO13**).
- **Status LED:** Onboard red LED (**GPIO33**, active-LOW).
- **Audio Output Options:**
  - **2-Pin Buzzer:** Signal connected to **GPIO14**, Ground to **GND**.
  - **3-Pin Buzzer Module:** Power (**5V/3.3V**), Ground (**GND**), Signal (**GPIO14**).
- **Power Supply:** 5V 2A+ DC supply recommended for stable camera capture and servo actuation.

---

For full pinouts, schematic details, and system architecture, see [docs/SYSTEM.md](../docs/SYSTEM.md).
