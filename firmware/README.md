# Fibott Firmware Directory

This directory contains the ESP32 and micro-controller firmware projects for the **Fibott Reverse Vending Kiosk**.

---

## 📁 Firmware Projects Index

1. [`esp32-cam/`](./esp32-cam/)  
   Base ESP32-CAM firmware with OV2640 camera capture, SG90 servo gate control (**GPIO13**), onboard status LED (**GPIO33**), and Next.js backend HTTPS polling/uploading.

2. [`esp32-cam-buzzer/esp32-cam-buzzer-2pin/`](./esp32-cam-buzzer/esp32-cam-buzzer-2pin/)  
   ESP32-CAM firmware variant for raw **2-pin buzzers** (Signal on **GPIO14**, Ground on **GND**). Supports active ON/OFF mode and passive LEDC hardware PWM tone generation.

3. [`esp32-cam-buzzer/esp32-cam-buzzer-3pin/`](./esp32-cam-buzzer/esp32-cam-buzzer-3pin/)  
   ESP32-CAM firmware variant for **3-pin buzzer breakout modules** (KY-012, HW-508, KY-006). Supports configurable active-HIGH / active-LOW transistor logic on **GPIO14**.

4. [`kiosk-controller/`](./kiosk-controller/)  
   Secondary microcontroller firmware for auxiliary chute sensor inputs and mechanical hardware triggers.

---

For complete system architecture and pinout specifications, see [docs/SYSTEM.md](../docs/SYSTEM.md).
