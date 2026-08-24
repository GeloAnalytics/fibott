# Fibott - ML Classifier

Reference for `src/lib/classifier.ts`. This explains why the classifier works
the way it does. For operator-facing guidance, see
[CLIENT-GUIDE.md](CLIENT-GUIDE.md). For architecture and command references,
see [SYSTEM.md](SYSTEM.md).

---

## Why A Zero-Shot Bootstrap

There is no bottle/can-specific model shipped with this project yet.
`classifyImage()` falls back to MobileNetV2 pretrained on ImageNet-1k, then maps
ImageNet labels to Fibott material types through `LABEL_KEYWORDS` in
`src/lib/classifier.ts`.

```ts
const LABEL_KEYWORDS: Record<"PET_BOTTLE" | "ALUMINUM_CAN", string[]> = {
  PET_BOTTLE: [
    "water bottle",
    "pop bottle",
    "soda bottle",
    "beer bottle",
    "wine bottle",
    "pill bottle",
  ],
  ALUMINUM_CAN: ["milk can"],
};
```

ImageNet-1k has no dedicated beverage-can class. `"milk can"` is the closest
available zero-shot proxy. This lets the full capture, classify, accept/reject,
and award-points pipeline work before real kiosk training data exists, but it is
not a reliable can detector.

`MIN_CONFIDENCE = 0.15` is a low trust floor for out-of-distribution images.
Below that floor, the result is always `REJECTED`.

---

## Classification Paths

1. Fine-tuned head: if `models/bottle-can-head/weights.json` exists,
   `classifyImage()` uses it automatically.
2. Zero-shot fallback: if no fine-tuned head exists, the MobileNet keyword
   mapping is used.

The fine-tuned head path is controlled by `FIBOTT_ML_HEAD_PATH`, defaulting to
`models/bottle-can-head/weights.json`. Deleting or moving that file reverts to
zero-shot fallback on the next server start.

---

## Current Model State

As of the latest known training run, the fine-tuned head had poor validation
accuracy because it was trained on outdoor TACO litter-detection images rather
than real kiosk-angle photos. The dataset mismatch is the bottleneck.

The fix is better data, not more app code.

```bash
# Once real kiosk photos exist, organize them into:
#   ml-data/PET_BOTTLE/*.jpg
#   ml-data/ALUMINUM_CAN/*.jpg
#   ml-data/REJECTED/*.jpg
npm run ml:train
```

Useful commands:

- `npm run ml:setup` - create local ML data folders
- `npm run ml:import` - import a prepared image dataset
- `npm run ml:import:taco` - import from TACO annotations
- `npm run ml:train` - train the fine-tuned head

Internet-sourced images can bootstrap the pipeline, but real kiosk-angle photos
are the highest-value training data.

---

## Operator Notes

- A rejected item is not automatically contamination. Check
  `classificationLabel` in Admin Deposit History before assuming a physical
  problem.
- A sudden spike in rejections usually points to camera angle, lighting, or
  chute positioning.
- Aluminum cans are weaker than bottles in zero-shot mode because `"milk can"`
  is only a rough visual proxy.
