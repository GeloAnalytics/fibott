# Fibott ML: bottle vs. can classification

How `src/lib/classifier.ts` decides `PET_BOTTLE` / `ALUMINUM_CAN` /
`REJECTED` from an ESP32-CAM image, and how to make it actually reliable
for your specific kiosk instead of a generic photo classifier.

See [`docs/SYSTEM.md`](SYSTEM.md) for where this fits in the overall
deposit flow.

## Two modes, same function

`classifyImage(buffer)` picks one of two paths automatically, in this
order:

1. **Fine-tuned head** (`models/bottle-can-head/weights.json`), if it
   exists — a small classifier trained on your own kiosk photos. Use this
   in production.
2. **Zero-shot ImageNet fallback** — no training required, works the
   moment you install dependencies, but has a real accuracy ceiling
   explained below. Use this to get the deposit loop wired end-to-end
   before you've collected any training photos.

Both modes share the same first step: run the input image through a
pretrained **MobileNetV2** (`@tensorflow-models/mobilenet`, weights fetched
from Google's model hosting on first use — this *is* the "adopt a
pretrained model" part, not a model trained from scratch). Where they
differ is what happens to MobileNet's output.

## Mode 2: zero-shot ImageNet mapping (the current default)

MobileNet's own classifier head predicts across the standard 1000 ImageNet
classes. `classifier.ts` keyword-matches the top prediction against:

```
PET_BOTTLE:   "water bottle", "pop bottle", "soda bottle",
              "beer bottle", "wine bottle", "pill bottle"
ALUMINUM_CAN: "milk can"
```

**Be honest with yourself about the can mapping.** ImageNet-1k has no
class for a beverage can — no "soda can," no "beer can." "milk can" (a
large lidded steel container) is the closest thing that exists, and it's a
weak visual proxy for a crushed Coke can. Bottles map fairly well (five
real bottle-shaped ImageNet classes); cans effectively don't. Expect this
mode to reject or misclassify a meaningful fraction of real cans. It's a
functional placeholder to unblock building the rest of the pipeline, not
the shipped accuracy target.

A confidence floor (`MIN_CONFIDENCE = 0.15` in `classifier.ts`) forces
low-confidence top predictions to `REJECTED` rather than guessing — tune
this constant if you're seeing too many false accepts/rejects during
testing.

## Mode 1: fine-tuned head (what you actually want in production)

This is transfer learning: freeze MobileNet as a fixed feature extractor,
train only a small new layer on top using images from your actual kiosk.

**Why this matters more than the model architecture:** the biggest
accuracy gain here doesn't come from a fancier model — it comes from
training on photos that match production conditions (same camera, same
chute lighting, same distance/angle, crushed and uncrushed items, wet
labels, partially crumpled cans, etc). A generic "bottles and cans"
internet dataset trained on clean product photography will not transfer
well to a dim plastic chute.

### Steps

1. **Collect images from the real ESP32-CAM**, not stock photos. Save them
   into:
   ```
   ml-data/PET_BOTTLE/*.jpg
   ml-data/ALUMINUM_CAN/*.jpg
   ml-data/REJECTED/*.jpg
   ```
   `REJECTED` should be deliberately varied — empty chute, a hand, a random
   piece of trash, a bottle cap alone — anything that should *not* trigger
   an accept. Start with ~40–50 images per class; more matters less than
   variety (different lighting, different bottle brands/colors, crushed vs.
   whole).
2. **Train:**
   ```
   npm run ml:train
   ```
   This runs `scripts/ml/train.ts`: embeds every image through the same
   frozen MobileNet (`embedImage()` in `classifier.ts`), trains a single
   dense softmax layer on top (3 classes, ~30 epochs, prints train/val
   accuracy per epoch), and writes the result to
   `models/bottle-can-head/weights.json`.
3. **Deploy:** nothing else to wire up — `classifyImage()` checks for that
   file's existence on first call and uses it automatically. Restart the
   server (or redeploy) to pick up a newly trained head; it's loaded once
   and cached in memory per process.
4. **Iterate:** misclassifications in production are training data. Save
   the ESP32-CAM frames for deposits that got rejected wrongly or accepted
   wrongly (there's no automatic image capture pipeline for this yet — see
   the note in `docs/SYSTEM.md` §4.3 about `imageUrl` not being populated
   by `/api/device/deposit-image` today), sort them into `ml-data/`, and
   re-run `npm run ml:train`.

### Why weights are hand-serialized JSON instead of a standard tfjs model file

The deployed app uses plain `@tensorflow/tfjs` (pure JS/CPU backend) rather
than `@tensorflow/tfjs-node`, specifically to avoid native-module build
pain on Windows (`tfjs-node` needs a working node-gyp/Python/MSVC toolchain
to install). Plain `tfjs` doesn't register the `file://` IO handler that
`tf.LayersModel.save()`/`tf.loadLayersModel()` normally use outside a
browser. So `scripts/ml/train.ts` and `classifier.ts` serialize/deserialize
the head's weights as plain JSON instead — it's a single Dense layer, so
this is a few KB and trivially portable. If you later add more layers to
the head, keep the same pattern (dump `getWeights()`, restore via
`setWeights()`) rather than reaching for `tfjs-node`.

## Practical tuning notes

- `MIN_CONFIDENCE` in `classifier.ts` — raise it if the kiosk is accepting
  things it shouldn't; lower it if it's rejecting real bottles/cans too
  often.
- MobileNet is loaded once per server process and cached
  (`loadModel()`/`loadFineTunedHead()` singletons in `classifier.ts`) — on
  a serverless platform with cold starts, the first request after a cold
  start pays the model-load cost; subsequent requests on the same instance
  don't.
- Inference runs on the CPU backend (no GPU/WASM), which is slower than a
  native backend but portable across Windows/Linux without a build step —
  fine for one classification per deposit, not for high-throughput video.
  Measured on this dev machine: ~8s for the first classification in a
  process (includes downloading + parsing MobileNet's weights), ~1.6s for
  every classification after that in the same process. That's the budget
  for a single deposit's "insert item → gate opens/buzzer" latency — worth
  keeping in mind if the UX needs to feel instant. If it doesn't, revisit
  `@tensorflow/tfjs-node` (real speedup, but reintroduces the native-build
  requirement this setup deliberately avoided — more viable if you deploy
  to Linux rather than developing/running on Windows).
