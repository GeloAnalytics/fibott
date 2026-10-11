# Fibott ML Classifier

**Last updated:** 2026-10-11

The normal kiosk path is on-device inference, not the server-side classifier. The ESP32-CAM runs the `models/esp32/fibott_classifier_int8.tflite` artifact and uploads its local material type and confidence with the captured image. `src/app/api/device/deposit-image` records that local result; it uses the server classifier only for older firmware that does not provide local metadata, or optionally for comparison logging.

## Current model

| Property | Value |
|---|---|
| Architecture | MobileNetV1, alpha 0.25, 96x96, INT8 |
| Classes | `PET_BOTTLE`, `ALUMINUM_CAN` |
| Training images | 248 (142 PET bottle, 106 aluminum can) |
| Grouped holdout accuracy | 81.25% |
| PET recall | 64.71% |
| Aluminum can recall | 100% |

The model has no reject/non-recyclable class. A two-class softmax always chooses one of its two known classes, so it cannot alone determine whether an item is a bottle or can.

## Safety status

The current vision loop marks every successful inference confident and sends `CMD:OPEN`. The threshold, margin, and hand/paper/empty-chute configuration values are not applied in the current implementation. This artifact must not be used as a standalone non-recyclable detector or in an unattended public kiosk.

## Server classifier

`src/lib/classifier.ts` remains as a legacy compatibility and comparison path. Its zero-shot ImageNet mapping is not authoritative for current firmware. Do not remove it until all deployed devices send `localMaterialType` and `localConfidence`.

## Next model work

1. Collect labeled kiosk-angle images for PET, aluminum, and a broad `REJECTED` class.
2. Train and validate a three-class or explicit out-of-distribution model with held-out kiosk groups.
3. Enforce a calibrated confidence/margin policy before `CMD:OPEN`.
4. Validate accepted and rejected cases on the real ESP32-CAM under kiosk lighting.
