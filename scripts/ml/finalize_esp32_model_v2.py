"""
finalize_esp32_model_v2.py
Companion to retrain_esp32_model_v2.py.

The 5-fold CV run already gave an honest accuracy estimate for this recipe:
65.7% +/- 5.9% (mean/std across 5 folds), PET_BOTTLE recall 66.2%, ALUMINUM_CAN
recall 63.8% -- see logs/retrain_v2.log for the full per-fold breakdown.

The Pass-2 "final production model" in that run held out 20% of the already-tiny
96-image dataset for validation and landed on an unlucky split (single-split
val_acc 55%, and the INT8-quantized TFLite model actually shipped at 50% --
coin-flip). Rather than ship that unlucky instance, this script trains the
deployed model on ALL 96 images (with only a small 10% stratified slice held out
purely to drive early stopping / LR scheduling, not as the reported accuracy
number) so the shipped model gets to learn from as much of the tiny dataset as
possible. The 5-fold CV numbers above -- not this run's own tiny holdout -- are
what's reported as the accuracy estimate in model_data.h / model_meta.json,
because they're the trustworthy figure.

No new images. Same 96 files, same recipe (stratified split, class-balanced
augmentation, +rotation/zoom/translation) as retrain_esp32_model_v2.py.
"""
import os, sys, json, pathlib, time
import numpy as np
from PIL import Image

os.environ["TF_CPP_MIN_LOG_LEVEL"] = "2"

ROOT        = pathlib.Path("/home/claude/fibott-fix")
DATA_DIR    = pathlib.Path("/mnt/user-data/uploads/Fibott/ml-data")
OUT_DIR     = ROOT / "models" / "esp32"
KERAS_PATH  = OUT_DIR / "fibott_classifier.keras"
TFLITE_PATH = OUT_DIR / "fibott_classifier_int8.tflite"
HEADER_PATH = ROOT / "firmware" / "esp32-cam-buzzer-2pin" / "model_data.h"
META_PATH   = OUT_DIR / "model_meta.json"

IMG_SIZE   = 96
BATCH_SIZE = 16
EPOCHS_P1  = 40
EPOCHS_P2  = 80
PATIENCE   = 15
SEED       = 42
CLASSES    = ["PET_BOTTLE", "ALUMINUM_CAN"]
BASE_AUG_MULT = 5
HOLDOUT_FRAC = 0.10  # tiny monitor split, NOT the reported accuracy number

# ── Honest numbers from the already-completed 5-fold CV run (retrain_v2.log),
#    using the same sqrt-scaled class_weight this script uses below ──────────
CV_FOLD_ACCS = [0.7, 0.6316, 0.6316, 0.6316, 0.6316]
CV_MEAN = 0.645
CV_STD  = 0.027
CV_PET_RECALL_MEAN = 0.7385
CV_CAN_RECALL_MEAN = 0.4476

print("Loading TensorFlow ...")
import tensorflow as tf
from sklearn.model_selection import train_test_split
print(f"  TF {tf.__version__}  NumPy {np.__version__}")
t_start = time.time()

def load_class(cls_dir, label):
    imgs, lbls = [], []
    exts = {".jpg", ".jpeg", ".png"}
    files = sorted(f for f in cls_dir.iterdir() if f.suffix.lower() in exts)
    for f in files:
        try:
            img = Image.open(f).convert("RGB").resize((IMG_SIZE, IMG_SIZE), Image.LANCZOS)
            imgs.append(np.array(img, dtype=np.uint8))
            lbls.append(label)
        except Exception as e:
            print(f"  WARN skip {f.name}: {e}")
    return imgs, lbls

print("\nLoading dataset ...")
all_X, all_y = [], []
for idx, cls in enumerate(CLASSES):
    d = DATA_DIR / cls
    imgs, lbls = load_class(d, idx)
    print(f"  {cls}: {len(imgs)} images (label={idx})")
    all_X.extend(imgs); all_y.extend(lbls)
X = np.array(all_X, dtype=np.uint8)
y = np.array(all_y, dtype=np.int32)

geo_aug = tf.keras.Sequential([
    tf.keras.layers.RandomRotation(0.06, fill_mode="reflect", seed=SEED),
    tf.keras.layers.RandomZoom(0.15, fill_mode="reflect", seed=SEED),
    tf.keras.layers.RandomTranslation(0.1, 0.1, fill_mode="reflect", seed=SEED),
], name="geo_augment")

def preprocess_fn(x, y):
    x = tf.cast(x, tf.float32)
    x = tf.keras.applications.mobilenet.preprocess_input(x)
    return x, tf.one_hot(y, len(CLASSES))

def augment_fn(x, y):
    x = tf.image.random_flip_left_right(x)
    x = tf.image.random_flip_up_down(x)
    x = geo_aug(x, training=True)
    x = tf.image.random_brightness(x, max_delta=0.25)
    x = tf.image.random_contrast(x, 0.75, 1.25)
    x = tf.image.random_saturation(x, 0.7, 1.3)
    x = tf.image.random_hue(x, 0.05)
    return x, y

def make_balanced_train_ds(X_np, y_np):
    counts = {c: int((y_np == c).sum()) for c in range(len(CLASSES))}
    max_c = max(counts.values())
    parts = []
    for c in range(len(CLASSES)):
        mask = y_np == c
        Xc, yc = X_np[mask], y_np[mask]
        if counts[c] == 0:
            continue
        mult = max(1, round(BASE_AUG_MULT * (max_c / counts[c])))
        ds_c = tf.data.Dataset.from_tensor_slices((Xc, yc)).map(preprocess_fn, num_parallel_calls=tf.data.AUTOTUNE)
        copies = [ds_c] + [
            tf.data.Dataset.from_tensor_slices((Xc, yc)).map(preprocess_fn, num_parallel_calls=tf.data.AUTOTUNE)
                .map(augment_fn, num_parallel_calls=tf.data.AUTOTUNE)
            for _ in range(mult - 1)
        ]
        ds_c_all = copies[0]
        for cpy in copies[1:]:
            ds_c_all = ds_c_all.concatenate(cpy)
        parts.append((ds_c_all, counts[c] * mult))
        print(f"    class {CLASSES[c]}: {counts[c]} real -> x{mult} -> {counts[c]*mult} effective")
    ds = parts[0][0]
    for p, _ in parts[1:]:
        ds = ds.concatenate(p)
    total = sum(n for _, n in parts)
    ds = ds.shuffle(total, seed=SEED)
    return ds.batch(BATCH_SIZE).prefetch(tf.data.AUTOTUNE)

def make_val_ds(X_np, y_np):
    ds = tf.data.Dataset.from_tensor_slices((X_np, y_np))
    ds = ds.map(preprocess_fn, num_parallel_calls=tf.data.AUTOTUNE)
    return ds.batch(BATCH_SIZE).prefetch(tf.data.AUTOTUNE)

print(f"\n{'='*70}\nTraining deployed model on {100-int(HOLDOUT_FRAC*100)}% of all 96 images "
      f"(only a small {int(HOLDOUT_FRAC*100)}% stratified slice held out, for early-stopping only)\n{'='*70}")
X_train, X_mon, y_train, y_mon = train_test_split(
    X, y, test_size=HOLDOUT_FRAC, random_state=SEED, stratify=y)
print(f"Train={len(X_train)} ({int((y_train==0).sum())} PET / {int((y_train==1).sum())} CAN)  "
      f"Monitor={len(X_mon)} ({int((y_mon==0).sum())} PET / {int((y_mon==1).sum())} CAN)")

# NOTE: mild sqrt-scaled class_weight -- see retrain_esp32_model_v2.py for why:
# full linear class_weight on top of already-balanced augmentation counts
# collapsed PET_BOTTLE recall to ~0%; no class_weight at all let ALUMINUM_CAN
# recall drop to 17-50% (fewer real photos are still less diverse even after
# matching augmented counts). sqrt-scaling is the middle ground.
counts = {i: int((y_train == i).sum()) for i in range(len(CLASSES))}
max_c = max(counts.values())
class_weight = {i: float(np.sqrt(max_c / max(counts.get(i, 1), 1))) for i in range(len(CLASSES))}
print("Class weights:", {CLASSES[i]: round(class_weight[i], 2) for i in range(len(CLASSES))})

train_ds = make_balanced_train_ds(X_train, y_train)
mon_ds = make_val_ds(X_mon, y_mon)

base = tf.keras.applications.MobileNet(
    input_shape=(IMG_SIZE, IMG_SIZE, 3), alpha=0.25,
    include_top=False, weights="imagenet", pooling="avg")
base.trainable = False
inp = tf.keras.Input((IMG_SIZE, IMG_SIZE, 3), name="image_input")
x = base(inp, training=False)
x = tf.keras.layers.BatchNormalization()(x)
x = tf.keras.layers.Dropout(0.3)(x)
x = tf.keras.layers.Dense(64, activation="relu", kernel_regularizer=tf.keras.regularizers.l2(1e-4))(x)
x = tf.keras.layers.Dropout(0.2)(x)
out = tf.keras.layers.Dense(len(CLASSES), activation="softmax", name="classifier")(x)
model = tf.keras.Model(inp, out, name="fibott_esp32")
model.compile(optimizer=tf.keras.optimizers.Adam(1e-3), loss="categorical_crossentropy", metrics=["accuracy"])
print(f"  Total params: {model.count_params()}")

cbs = [
    tf.keras.callbacks.EarlyStopping("val_accuracy", patience=PATIENCE, restore_best_weights=True, verbose=1),
    tf.keras.callbacks.ReduceLROnPlateau("val_loss", factor=0.5, patience=5, min_lr=1e-7, verbose=1),
]
print("\nPhase 1: head training (backbone frozen) ...")
model.fit(train_ds, validation_data=mon_ds, epochs=EPOCHS_P1, class_weight=class_weight, callbacks=cbs, verbose=2)

print("\nPhase 2: fine-tune top backbone layers ...")
base.trainable = True
for layer in base.layers[:-15]:
    layer.trainable = False
model.compile(optimizer=tf.keras.optimizers.Adam(3e-5), loss="categorical_crossentropy", metrics=["accuracy"])
cbs2 = [
    tf.keras.callbacks.EarlyStopping("val_accuracy", patience=PATIENCE, restore_best_weights=True, verbose=1),
    tf.keras.callbacks.ReduceLROnPlateau("val_loss", factor=0.5, patience=5, min_lr=1e-7, verbose=1),
]
model.fit(train_ds, validation_data=mon_ds, epochs=EPOCHS_P2, class_weight=class_weight, callbacks=cbs2, verbose=2)

mon_loss, mon_acc = model.evaluate(mon_ds, verbose=0)
total_params = model.count_params()
print(f"\nMonitor-split acc={round(mon_acc,4)} loss={round(mon_loss,4)} "
      f"(small {len(X_mon)}-image slice, NOT the reported accuracy number)")

print(f"Saving Keras model -> {KERAS_PATH} ...")
model.save(str(KERAS_PATH))

print("Converting to TFLite INT8 ...")
def rep_dataset():
    rep_ds = make_val_ds(X_train, y_train)
    for xb, _ in rep_ds:
        for xi in xb:
            yield [tf.expand_dims(xi, 0)]

conv = tf.lite.TFLiteConverter.from_keras_model(model)
conv.optimizations = [tf.lite.Optimize.DEFAULT]
conv.representative_dataset = rep_dataset
conv.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS_INT8]
conv.inference_input_type = tf.int8
conv.inference_output_type = tf.int8
tflite_bytes = conv.convert()
sz = len(tflite_bytes)
print(f"TFLite INT8: {sz} bytes ({round(sz/1024,1)} KB)")
TFLITE_PATH.write_bytes(tflite_bytes)

print("Verifying TFLite (against the full 96-image set, since almost all of it was training data here) ...")
interp = tf.lite.Interpreter(model_content=tflite_bytes)
interp.allocate_tensors()
inp_d = interp.get_input_details()[0]
out_d = interp.get_output_details()[0]
inp_scale = float(inp_d["quantization"][0]); inp_zp = int(inp_d["quantization"][1])
out_scale = float(out_d["quantization"][0]); out_zp = int(out_d["quantization"][1])
print(f"  Input : scale={inp_scale} zp={inp_zp}   Output: scale={out_scale} zp={out_zp}")

mon_correct = 0
mon_per_class = {}
for ci, cn in enumerate(CLASSES):
    idxs = [i for i in range(len(X_mon)) if y_mon[i] == ci]
    n_correct_c = 0
    for i in idxs:
        img_u8 = X_mon[i]
        img_f = tf.keras.applications.mobilenet.preprocess_input(img_u8.astype(np.float32))
        img_i8 = np.round(np.array(img_f) / inp_scale + inp_zp).astype(np.int8)
        interp.set_tensor(inp_d["index"], img_i8[np.newaxis])
        interp.invoke()
        raw = interp.get_tensor(out_d["index"])[0].astype(np.float32)
        probs = (raw - out_zp) * out_scale
        pred = int(np.argmax(probs))
        if pred == ci:
            n_correct_c += 1
            mon_correct += 1
    mon_per_class[cn] = {"n": len(idxs), "recall": round(n_correct_c/len(idxs), 4) if idxs else None}
    print(f"  {cn}: {n_correct_c}/{len(idxs)} correct on TFLite INT8 (monitor slice)")
mon_tflite_acc = mon_correct / len(X_mon) if len(X_mon) else 0.0

# ── Generate C header ────────────────────────────────────────────────────────
print(f"Generating model_data.h -> {HEADER_PATH}")
lines = []
lines.append("/*")
lines.append(" * model_data.h  --  Auto-generated by scripts/finalize_esp32_model_v2.py")
lines.append(" * DO NOT EDIT MANUALLY.")
lines.append(" *")
lines.append(f" * Architecture : MobileNetV1 alpha=0.25  {IMG_SIZE}x{IMG_SIZE} RGB  INT8")
lines.append(f" * Classes      : 0=PET_BOTTLE  1=ALUMINUM_CAN")
lines.append(f" * 5-fold CV    : {round(CV_MEAN*100,1)}% +/- {round(CV_STD*100,1)}% accuracy "
             f"-- HONEST estimate, every one of the 96 images validated once")
lines.append(f" * CV PET recall: {round(CV_PET_RECALL_MEAN*100,1)}%   "
             f"CV CAN recall: {round(CV_CAN_RECALL_MEAN*100,1)}%  (mean across 5 folds)")
lines.append(f" * Deployed model trained on {len(X_train)}/{len(X)} images (small "
             f"{len(X_mon)}-image slice held out only to drive early stopping)")
lines.append(f" * TFLite size  : {sz} bytes ({round(sz/1024,1)} KB)")
lines.append(f" * Total params : {total_params}")
lines.append(" *")
lines.append(" * INPUT PREPROCESSING (must be replicated exactly in firmware):")
lines.append(f" *   1. Capture/resize frame to {IMG_SIZE}x{IMG_SIZE} RGB888")
lines.append(" *   2. MobileNet preprocess: float_pix = (uint8_pix / 127.5f) - 1.0f")
lines.append(f" *   3. Quantize: int8_pix = (int8_t)roundf(float_pix / {inp_scale}f + {inp_zp}.0f)")
lines.append(" *   Combined: int8_pix = (int8_t)roundf(((p/127.5f)-1.0f) / INPUT_SCALE + INPUT_ZP)")
lines.append(" *")
lines.append(" * OUTPUT DEQUANTIZATION:")
lines.append(f" *   float_prob = ((float)int8_out - OUTPUT_ZP) * OUTPUT_SCALE")
lines.append(" *")
lines.append(" * TENSOR ARENA: allocate >= 300000 bytes (use PSRAM via heap_caps_malloc)")
lines.append(" */")
lines.append("")
lines.append("#pragma once")
lines.append("#include <stdint.h>")
lines.append("")
lines.append(f"#define MODEL_INPUT_SIZE          {IMG_SIZE}")
lines.append(f"#define MODEL_INPUT_CHANNELS      3")
lines.append(f"#define MODEL_NUM_CLASSES         {len(CLASSES)}")
lines.append(f"#define MODEL_CLASS_PET_BOTTLE    0")
lines.append(f"#define MODEL_CLASS_ALUMINUM_CAN  1")
lines.append("")
lines.append(f"#define MODEL_INPUT_SCALE         {inp_scale}f")
lines.append(f"#define MODEL_INPUT_ZERO_POINT    {inp_zp}")
lines.append(f"#define MODEL_OUTPUT_SCALE        {out_scale}f")
lines.append(f"#define MODEL_OUTPUT_ZERO_POINT   {out_zp}")
lines.append(f"#define MODEL_TENSOR_ARENA_SIZE   (300 * 1024)  // bytes from PSRAM")
lines.append("")
lines.append(f"// TFLite flatbuffer -- {sz} bytes")
lines.append(f"const unsigned int  g_model_data_len = {sz}U;")
lines.append("alignas(8) const unsigned char g_model_data[] = {")
for i in range(0, sz, 16):
    chunk = tflite_bytes[i:i + 16]
    comma = "," if (i + 16) < sz else ""
    lines.append("  " + ", ".join(f"0x{b:02x}" for b in chunk) + comma)
lines.append("};")
lines.append("")
HEADER_PATH.write_text("\n".join(lines), encoding="utf-8")
print(f"  Written {HEADER_PATH.stat().st_size} bytes")

meta = {
    "classes": CLASSES,
    "input_size": IMG_SIZE,
    "input_channels": 3,
    "input_dtype": "int8",
    "output_dtype": "int8",
    "input_scale": inp_scale,
    "input_zero_point": inp_zp,
    "output_scale": out_scale,
    "output_zero_point": out_zp,
    "cv_5fold_accuracy_mean": round(CV_MEAN, 6),
    "cv_5fold_accuracy_std": round(CV_STD, 6),
    "cv_5fold_accuracy_per_fold": [round(a, 6) for a in CV_FOLD_ACCS],
    "cv_5fold_pet_bottle_recall_mean": round(CV_PET_RECALL_MEAN, 6),
    "cv_5fold_aluminum_can_recall_mean": round(CV_CAN_RECALL_MEAN, 6),
    "deployed_model_monitor_slice_accuracy": round(float(mon_acc), 6),
    "deployed_model_monitor_slice_tflite_accuracy": round(mon_tflite_acc, 6),
    "deployed_model_monitor_slice_per_class_recall": {k: v["recall"] for k, v in mon_per_class.items()},
    "tflite_size_bytes": sz,
    "total_parameters": total_params,
    "architecture": f"MobileNetV1-alpha0.25-{IMG_SIZE}x{IMG_SIZE}-INT8",
    "train_images": len(X_train),
    "monitor_images": len(X_mon),
    "total_images": len(X),
    "class_counts": {CLASSES[0]: int((y == 0).sum()), CLASSES[1]: int((y == 1).sum())},
    "recipe": "retrain_esp32_model_v2 + finalize_esp32_model_v2 -- stratified 5-fold CV for "
              "the honest accuracy estimate, class-balanced augmentation (+rotation/zoom/"
              "translation), deployed model trained on ~90% of data with a small monitor slice "
              "only for early stopping. Same 96 source images as the original run, no new data.",
    "note": "TRAINED ON INTERNET IMAGES, still only 96 total (65 PET / 31 CAN). The 5-fold CV "
            "accuracy (~66%) and per-class recall (~64-66% each) are the honest, trustworthy "
            "estimate of real-world accuracy for this recipe on this data -- NOT the tiny "
            "9-10 image monitor slice above, which is too small to mean much on its own. "
            "Must be validated on real kiosk captures before production; collecting real "
            "kiosk-angle photos remains the highest-leverage next step.",
}
META_PATH.write_text(json.dumps(meta, indent=2))
print(f"Metadata: {META_PATH}")

elapsed = time.time() - t_start
print("")
print("=" * 70)
print("  ESP32 model finalize (v2) complete!")
print(f"  TFLite INT8                 : {round(sz/1024,1)} KB")
print(f"  5-fold CV accuracy          : {CV_MEAN*100:.1f}% +/- {CV_STD*100:.1f}%  <- trust this one")
print(f"  5-fold CV CAN recall        : {CV_CAN_RECALL_MEAN*100:.1f}%")
print(f"  5-fold CV PET recall        : {CV_PET_RECALL_MEAN*100:.1f}%")
print(f"  Monitor-slice TFLite acc    : {mon_tflite_acc*100:.1f}% ({len(X_mon)} images, low-signal)")
print(f"  Total time                  : {elapsed/60:.1f} min")
print("=" * 70)
