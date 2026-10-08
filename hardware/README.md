# Fibott Hardware Directory

This directory contains hardware documentation, wiring diagrams, and hardware references for the **Fibott Reverse Vending Kiosk**.

---

## 🔌 Dual-ESP32 Wireless Hardware Components

Fibott uses a **Dual-ESP32 100% Wireless Architecture** with zero physical wiring between the two microcontrollers:

### 1. Vision & AI Node (ESP32-CAM)
- **Microcontroller:** AI-Thinker ESP32-CAM board (with PSRAM enabled).
- **Camera Sensor:** OV2640 JPEG camera sensor (QVGA 320x240 capture).
- **Status LED:** Onboard red LED (**GPIO33**, active-LOW).
- **Chute Illumination:** Onboard flash LED (**GPIO4**, dimmed PWM).
- **Interconnect:** 2.4 GHz ESP-NOW wireless transmitter (0 physical wires).
- **Power Supply:** Clean 5V 2A DC supply or USB.

### 2. Actuator & Audio Node (ESP32 DevKit)
- **Microcontroller:** ESP32 DevKit / NodeMCU-32S / ESP32 WROOM-32.
- **Gate Actuator:** SG90 / MG90S Micro Servo (Signal connected to **GPIO18**).
- **Audio Output:** 5V Active or Passive Buzzer (Signal connected to **GPIO19**).
- **Status LED:** Onboard blue LED (**GPIO2**).
- **Interconnect:** 2.4 GHz ESP-NOW wireless receiver (sub-10ms latency).
- **Power Supply:** Independent 5V 2A+ DC supply for motor isolation.

---

For full pinouts, schematic details, and system architecture, see [docs/HARDWARE_SETUP_GUIDE.md](../docs/HARDWARE_SETUP_GUIDE.md) and [docs/SYSTEM.md](../docs/SYSTEM.md).
