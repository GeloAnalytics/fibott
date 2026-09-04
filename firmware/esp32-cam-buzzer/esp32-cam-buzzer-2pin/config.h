#pragma once

// ═══════════════════════════════════════════════════════════════════════════════
// Fibott ESP32-CAM Canonical Firmware — config.h
//
// Edit this file before flashing. All user-configurable settings are here.
// DO NOT modify the .ino file for configuration.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Firmware Version ──────────────────────────────────────────────────────────
// Appears in boot banner and heartbeat logs in the admin panel.
#define FIRMWARE_VERSION "1.7.1-model-v3-real-photos"

// ── Local ML Inference Configuration ─────────────────────────────────────────
// Minimum confidence required to accept local classification decision (0.0 to 1.0).
// If top class probability < ML_CONFIDENCE_THRESHOLD, item is REJECTED safely.
#define ML_CONFIDENCE_THRESHOLD 0.40f

// ── Camera Capture Resolution ─────────────────────────────────────────────────
// The local classifier only ever needs a 96x96 downsample (MODEL_INPUT_SIZE in
// model_data.h), so capturing at full VGA (640x480) just meant decoding 4x more
// JPEG data than necessary on every single deposit before inference could even
// start. QVGA (320x240) is still ~3.3x oversampled relative to what the model
// reads, and is what gets uploaded to the backend for admin review / cloud
// disagreement tracking — still plenty to see what was dropped in.
//
// If you go back to VGA, or try something else, change ONLY this block — the
// RGB decode buffer in initLocalML() (esp32-cam-buzzer-2pin.ino) sizes itself
// from CAPTURE_WIDTH/CAPTURE_HEIGHT, so it can't silently drift out of sync
// with cameraInit()'s actual frame_size the way it used to.
#define CAPTURE_FRAMESIZE  FRAMESIZE_QVGA
#define CAPTURE_WIDTH      320
#define CAPTURE_HEIGHT     240


// ── WiFi Configuration ────────────────────────────────────────────────────────
// The kiosk must connect to the Fibott open HotSpot ("Fibott" SSID on MikroTik).
// If testing locally, set these to your development WiFi credentials.
#define WIFI_SSID     "Fibott"
#define WIFI_PASSWORD ""

// ── Backend API Configuration ─────────────────────────────────────────────────
// BACKEND_HOST: Vercel hostname WITHOUT https://
// DEVICE_API_KEY: The plaintext API key generated in the admin device management.
//                 Must match a registered ACTIVE device in the database.
#define BACKEND_HOST   "fibott.vercel.app"
#define BACKEND_PORT   443
#define DEVICE_API_KEY "fibott_dev_7cd2f63b3fcaae7fa973ea58d8f94680df86c05f589bd189"
#define PATH_LOGS      "/api/device/logs"

// ── Servo Gate Configuration ──────────────────────────────────────────────────
// GPIO13 is safe on AI-Thinker ESP32-CAM:
//   NOT a strapping pin, NOT used by camera data lines or PSRAM.
//   DO NOT use GPIO12 (MTDI strapping pin — changes flash voltage on boot).
//
// Pulse widths in microseconds for an SG90/MG90S servo:
//   Typical range: 500µs (0°) to 2500µs (180°)
//   1500µs ≈ 90° (centre/closed), 2000µs ≈ ~135° (open)
//   Calibrate SERVO_OPEN_US for your specific gate mechanism.
#define PIN_SERVO       13
#define SERVO_CLOSED_US 1500   // Closed position — calibrate with your gate
#define SERVO_OPEN_US   2000   // Open position  — calibrate with your gate

// ── 2-Pin Buzzer Configuration ────────────────────────────────────────────────
// Connect buzzer (+) / signal lead → GPIO14
// Connect buzzer (-) / ground lead → GND
//
// GPIO14 is safe on the AI-Thinker board:
//   Not used by camera, PSRAM, or servo. Safe for digital output.
//
// Select your buzzer type below:
//   BUZZER_TYPE_ACTIVE  (1): Active buzzer with internal oscillator.
//                            GPIO14 HIGH = beep ON, LOW = beep OFF.
//                            Simple and reliable. Pitch is fixed by the buzzer.
//
//   BUZZER_TYPE_PASSIVE (2): Passive piezo element.
//                            Requires ESP32 LEDC hardware PWM (Timer1, Channel1).
//                            Supports custom pitch frequencies for each event.
//                            Uses TONE_*_HZ constants below.
#define PIN_BUZZER          14
#define BUZZER_TYPE_ACTIVE  1
#define BUZZER_TYPE_PASSIVE 2

#define BUZZER_MODE BUZZER_TYPE_ACTIVE   // ← Change this if you have a passive buzzer

// ── Tone Frequencies (Passive Buzzer Mode Only) ───────────────────────────────
// These are ignored when BUZZER_MODE == BUZZER_TYPE_ACTIVE.
// Tune to your liking. Human-audible range: ~200Hz – 8000Hz.
#define TONE_BOOT_HZ   2700   // 1 short beep — boot complete
#define TONE_READY_HZ  3000   // 1 mid beep   — session active, place item
#define TONE_ACCEPT_HZ 3500   // 1 long tone  — deposit accepted
#define TONE_REJECT_HZ 1800   // 3 rapid beeps — deposit rejected
#define TONE_ERROR_HZ  1200   // 1 long warn  — WiFi / upload error

// ── Status LED Configuration ──────────────────────────────────────────────────
// GPIO33 is the onboard red LED on the AI-Thinker ESP32-CAM module.
// It is active-LOW: writing LOW turns it ON, writing HIGH turns it OFF.
#define PIN_LED_STATUS 33

// ── System Timing Constants ───────────────────────────────────────────────────
// Increase BACKEND_TIMEOUT_S if you experience frequent upload timeouts on slow
// WiFi. Decrease POLL_INTERVAL_MS for faster session detection (uses more power).

// HTTP connection + read timeout for WiFiClientSecure operations.
// IMPORTANT: WiFiClientSecure::setTimeout() takes MILLISECONDS (inherited from Stream).
// Use BACKEND_TIMEOUT_MS in the .ino — never pass BACKEND_TIMEOUT_S directly.
#define BACKEND_TIMEOUT_S  15
#define BACKEND_TIMEOUT_MS (BACKEND_TIMEOUT_S * 1000)   // 15 000 ms — use this in setTimeout()

// The accept/reject decision and gate movement are made entirely by local
// on-device ML (see classifyLocallyML() in the .ino) — uploadImage() below
// is best-effort BACKGROUND telemetry (points, admin deposit history, image
// logging, model-disagreement tracking) that runs AFTER the gate has already
// closed. A slow/dropped sync only delays points crediting slightly, it can
// never stall the kiosk between deposits — so there is no UX cost to giving
// it plenty of room.
//
// /api/device/deposit-image now does real work per request: decode the
// multipart image, base64-encode it, and write it (plus the deposit row) to
// Postgres via Prisma. On Vercel's free/hobby tier a cold function start
// plus a cold Neon Postgres connection can easily take several seconds on
// the first request after any idle period — 6s was too tight and caused
// "socket closed early / empty HTTP status" failures on otherwise-correct
// requests. Widened to 20s. Worst case with 2 attempts is now ~40s, all of
// it after the gate has already closed.
#define BACKGROUND_SYNC_TIMEOUT_S    20
#define BACKGROUND_SYNC_TIMEOUT_MS   (BACKGROUND_SYNC_TIMEOUT_S * 1000)  // 20 000 ms
#define BACKGROUND_SYNC_MAX_ATTEMPTS 2

// How often to poll /api/kiosk/session while in IDLE state (milliseconds).
// Set to 500ms for fast session detection latency.
#define POLL_INTERVAL_MS  500

// How long the gate stays open after an ACCEPT decision (milliseconds).
// Adjust based on your chute mechanism — 3 seconds is typical for a single item.
#define GATE_OPEN_MS      3000

// How long to pause in ERROR state before re-checking and retrying (milliseconds).
#define RETRY_DELAY_MS    2000

// How often to send a heartbeat ping to the admin panel while IDLE (milliseconds).
// This updates Device.lastSeenAt in the database so admins can see "last seen X ago".
// 60000 = every 1 minute. Set higher to reduce network traffic.
#define HEARTBEAT_INTERVAL_MS 60000
