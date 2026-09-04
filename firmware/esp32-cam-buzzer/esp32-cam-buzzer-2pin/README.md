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
3. Upload Speed: `921600` (see note below — this used to say 115200)
4. Partition Scheme: pick one with a large APP partition — e.g. **"Huge APP (3MB No OTA/1MB SPIFFS)"**
   (see note below)
5. Connect GPIO0 to GND during flash, then release and reset.

### Why flashing got slower, and how to get it back

This firmware now links real TensorFlow Lite Micro (see the `.ino`'s header comment) on top of the
already-large baked-in model in `model_data.h`. That's strictly more for the compiler to build and more
bytes to write to flash than the old build had — expected, not a bug, and the trade for the local model
actually running instead of being dead weight. Two settings claw most of that back:

- **Upload Speed** was documented as `115200` (a very conservative fallback), which is the single
  biggest lever on how long the *flashing* step itself takes — at 115200 baud a couple of megabytes can
  take several minutes just to transfer over serial. Try `921600` first; if you get sync/timeout errors
  during the "Connecting..." handshake, step down to `460800`, then `230400`. This only affects the
  serial transfer, not compile time.
- **Partition Scheme** determines how much flash the compiled sketch is allowed to use. If yours is set
  to a small-APP scheme, the larger binary can be slow to fit, fail to fit, or fail verification after
  upload. `Huge APP (3MB No OTA/1MB SPIFFS)` (exact wording varies by board-package version) gives it
  room.
- **Compile time** (as opposed to the flash-transfer step) is mostly one-time per code change — Arduino
  caches build objects, so re-uploading without touching the `.ino`/headers should be much faster than
  the first build after installing the TFLite Micro library. If every single upload recompiles from
  scratch, that's a sign the IDE isn't caching builds (check Preferences → "Show verbose output" to see
  what's actually being rebuilt).

If flashing is still uncomfortably slow after both of those, the next lever is swapping the current
`tflite::AllOpsResolver` (in `initLocalML()`, `.ino`) for a `tflite::MicroMutableOpResolver<N>` that only
registers the handful of ops MobileNetV1 actually uses — smaller compile, smaller binary, faster flash.
It's not done by default because getting the op list wrong fails silently at `AllocateTensors()` at
runtime, and that's a harder problem to debug than a slow upload — worth doing only once the current
build is confirmed working end-to-end on real hardware.
