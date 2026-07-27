# Fibott — ML Classifier

Reference for `src/lib/classifier.ts`. This explains *why* it works the way it does — for the day-to-day operational read (what accuracy to expect, what to do about it), see `CLIENT-GUIDE.md` §4. For the two-mode dispatch and training commands at a glance, see `SYSTEM.md` → ML Classifier.

---

## Why a zero-shot bootstrap, not a trained model

There is no bottle/can-specific model shipped with this project yet. `classifyImage()` falls back to **MobileNetV2 pretrained on ImageNet-1k**, run through a keyword mapping (`LABEL_KEYWORDS` in `classifier.ts`):

```ts
const LABEL_KEYWORDS: Record<"PET_BOTTLE" | "ALUMINUM_CAN", string[]> = {
  PET_BOTTLE: ["water bottle", "pop bottle", "soda bottle", "beer bottle", "wine bottle", "pill bottle"],
  ALUMINUM_CAN: ["milk can"],
};
```

ImageNet-1k has no dedicated beverage-can class — `"milk can"` (a large lidded steel can) is the closest visual proxy available zero-shot. This is a bootstrap that lets the whole pipeline (capture → classify → accept/reject → award points) work end-to-end before any training data exists, not a reliable can detector. Expect it to misclassify or reject items a human would obviously recognize, especially cans, where the label mapping is weakest.

`MIN_CONFIDENCE = 0.15` exists because MobileNet's top-1 probability on out-of-distribution images — a kiosk chute, not a clean product photo — is often low even when the label is directionally right. Below that floor, the result is always `REJECTED` rather than trusted.

## The two paths `classifyImage()` can take

1. **Fine-tuned head** (`models/bottle-can-head/weights.json`) — if this file exists, `classifyImage()` uses it automatically, no code change needed. It's a small dense head (optionally with one hidden layer — see `hiddenUnits` in `SerializedHead`) trained on top of frozen MobileNet embeddings (`embedImage()`), and directly predicts `PET_BOTTLE` / `ALUMINUM_CAN` / `REJECTED` instead of relying on the ImageNet keyword proxy.
2. **Zero-shot fallback** (`mapPrediction()`) — active right now, described above.

Once a `weights.json` exists at `FIBOTT_ML_HEAD_PATH` (defaults to `models/bottle-can-head/weights.json`), it takes over on the next server start. Deleting or moving that file reverts to the zero-shot fallback with no other change.

## Current state and what it takes to fix it

As of the last training run, the fine-tuned head sat at roughly **10% validation accuracy** — trained on an outdoor TACO litter-detection dataset, which looks nothing like a lit kiosk chute photographing a bottle or can head-on. The dataset mismatch, not the training code, is the bottleneck.

The fix is data, not code:

```bash
# once real kiosk photos exist (accepted + rejected examples, ideally
# labeled from real deposits — see Admin → Deposit History for imageUrl
# references), organize them into:
#   ml-data/PET_BOTTLE/*.jpg
#   ml-data/ALUMINUM_CAN/*.jpg
npm run ml:train
```

`npm run ml:setup` creates the `ml-data/` folder structure. `npm run ml:import` / `npm run ml:import:taco` are dataset-import helpers for internet-sourced images — useful for bootstrapping before real kiosk captures exist, but not a substitute for them. The single highest-leverage next step for classifier accuracy is collecting a real batch of kiosk-angle photos and retraining against those, not further tuning the zero-shot keyword list.

## Practical guidance while running on the zero-shot fallback

- Rejections aren't necessarily contamination or non-recyclables — check `classificationLabel` on rejected `Deposit` rows (Admin → Deposit History) before assuming a physical problem.
- A sudden spike in rejections is more likely to be a camera/lighting/angle change than a sudden change in what people are depositing.
- Aluminum cans are classified through a much weaker proxy (`"milk can"`) than bottles are — expect a higher miss rate there specifically.
