"""
retrain_esp32_model_v2.py
Same-data recipe improvement over scripts/ml/train_esp32_model.py.
NO new images are added -- uses the exact same 96 files in ml-data/PET_BOTTLE (65)
and ml-data/ALUMINUM_CAN (31). What changes vs. the original script:

  1. STRATIFIED split instead of a random global shuffle+slice. With only 96 images
     total, a plain shuffle can (and did) land an unrepresentative validation set,
     especially for the 31-image minority class (ALUMINUM_CAN) -- which is exactly
     the class the user reports being misrecognized.
  2. STRATIFIED 5-FOLD CROSS-VALIDATION to get an honest accuracy estimate. A single
     80/20 split on 96 images means the reported "val_accuracy" is one 19-image
     sample -- noisy enough to be meaningless on its own. Averaging over 5 folds
     (every image gets used for validation exactly once) is a far more trustworthy
     number, reported as mean +/- std, PLUS per-class recall (the number that
     actually explains "cans get called bottles").
  3. RICHER augmentation: adds RandomRotation / RandomZoom / RandomTranslation on
     top of the existing flip/brightness/contrast/saturation/hue set.
  4. CLASS-BALANCED augmentation: ALUMINUM_CAN (31 images, ~32% of the data) gets
     proportionally more augmented copies per fold/split than PET_BOTTLE (65 images)
     so the model sees roughly as many effective can examples as bottle examples
     per epoch, on top of (not instead of) the existing class_weight compensation.

None of this can fix what only ~96 total images (many probably not shot from the
kiosk's own camera/angle/lighting) fundamentally cannot teach a model. This is a
recipe ceiling-raiser on the existing data, not a substitute for real kiosk-angle
photos eventually. The honest k-fold numbers below say clearly how close to that
ceiling we are.

Output format matches the original script exactly (model_data.h layout, constant
names, model_meta.json shape) so the existing firmware needs ZERO changes.
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

OUT_DIR.mkdir(parents=True, exist_ok=True)
HEADER_PATH.parent.mkdir(parents=True, exist_ok=True)

IMG_SIZE     = 96
BATCH_SIZE   = 16
EPOCHS_P1    = 40
EPOCHS_P2    = 80
PATIENCE     = 15
CV_EPOCHS_P1 = 25
CV_EPOCHS_P2 = 40
CV_PATIENCE  = 8
SEED         = 42
CLASSES      = ["PET_BOTTLE", "ALUMINUM_CAN"]
N_FOLDS      = 5
BASE_AUG_MULT = 5  # majority class gets ~5x (1 original + 4 augmented), matching the old script

print("Loading TensorFlow ...")
import tensorflow as tf
from sklearn.model_selection import StratifiedKFold, train_test_split
print(f"  TF {tf.__version__}  NumPy {np.__version__}")

t_start = time.time()

# ── Load dataset (identical images, identical preprocessing to the original script) ──
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
    if not d.exists():
        print(f"  WARN: {d} missing -- skipping {cls}")
        continue
    imgs, lbls = load_class(d, idx)
    print(f"  {cls}: {len(imgs)} images (label={idx})")
    all_X.extend(imgs)
    all_y.extend(lbls)

X = np.array(all_X, dtype=np.uint8)
y = np.array(all_y, dtype=np.int32)
print(f"Total: {len(X)} images  (class balance: "
      f"{CLASSES[0]}={int((y==0).sum())}  {CLASSES[1]}={int((y==1).sum())})")

# ── Augmentation ────────────────────────────────────────────────────────────────
geo_aug = tf.keras.Sequential([
    tf.keras.layers.RandomRotation(0.06, fill_mode="reflect", seed=SEED),   # ~+/-21.6deg
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
    """Per-class augmentation multiplier inversely proportional to class count,
    so the minority class (ALUMINUM_CAN) gets proportionally more augmented
    copies than the majority class (PET_BOTTLE) -- offsetting the 65:31 raw
    imbalance in what the model actually sees per epoch, on top of class_weight."""
    counts = {c: int((y_np == c).sum()) for c in range(len(CLASSES))}
    max_c = max(counts.values())
    parts = []
    for c in range(len(CLASSES)):
        mask = y_np == c
        Xc, yc = X_np[mask], y_np[mask]
        if counts[c] == 0:
            continue
        mult = max(1, round(BASE_AUG_MULT * (max_c / counts[c])))
        ds_c = tf.data.Dataset.from_tensor_slices((Xc, yc)).map(
            preprocess_fn, num_parallel_calls=tf.data.AUTOTUNE)
        copies = [ds_c] + [
            tf.data.Dataset.from_tensor_slices((Xc, yc))
                .map(preprocess_fn, num_parallel_calls=tf.data.AUTOTUNE)
                .map(augment_fn, num_parallel_calls=tf.data.AUTOTUNE)
            for _ in range(mult - 1)
        ]
        ds_c_all = copies[0]
        for cpy in copies[1:]:
            ds_c_all = ds_c_all.concatenate(cpy)
        parts.append((ds_c_all, counts[c] * mult))
        print(f"    class {CLASSES[c]}: {counts[c]} real -> x{mult} -> "
              f"{counts[c]*mult} effective training examples")
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


def build_model():
    base = tf.keras.applications.MobileNet(
        input_shape=(IMG_SIZE, IMG_SIZE, 3), alpha=0.25,
        include_top=False, weights="imagenet", pooling="avg",
    )
    base.trainable = False
    inp = tf.keras.Input((IMG_SIZE, IMG_SIZE, 3), name="image_input")
    x = base(inp, training=False)
    x = tf.keras.layers.BatchNormalization()(x)
    x = tf.keras.layers.Dropout(0.3)(x)
    x = tf.keras.layers.Dense(64, activation="relu",
            kernel_regularizer=tf.keras.regularizers.l2(1e-4))(x)
    x = tf.keras.layers.Dropout(0.2)(x)
    out = tf.keras.layers.Dense(len(CLASSES), activation="softmax", name="classifier")(x)
    model = tf.keras.Model(inp, out, name="fibott_esp32")
    return model, base


def train_one(X_train, y_train, X_val, y_val, epochs_p1, epochs_p2, patience, verbose=0):
    model, base = build_model()
    # NOTE: make_balanced_train_ds() already equalizes the effective per-class
    # example COUNT via per-class augmentation multipliers. Two things were
    # tried and rejected during development of this script:
    #   - full linear class_weight (ratio of raw counts, ~2.1x) stacked on top
    #     of that: double-compensates, collapsed PET_BOTTLE recall to ~0%.
    #   - no class_weight at all: swung the other way -- ALUMINUM_CAN recall
    #     dropped to 17-50% across CV folds, because the ~24-25 real CAN photos
    #     (vs ~52 real PET photos) are still less diverse even after being
    #     augmented up to matching counts.
    # A mild sqrt-scaled class_weight is the middle ground: majority class
    # weight=1.0, minority class weight=sqrt(raw_count_ratio) instead of the
    # full ratio, so it nudges without re-dominating the already-balanced counts.
    counts = {i: int((y_train == i).sum()) for i in range(len(CLASSES))}
    max_c = max(counts.values())
    class_weight = {i: float(np.sqrt(max_c / max(counts.get(i, 1), 1))) for i in range(len(CLASSES))}

    train_ds = make_balanced_train_ds(X_train, y_train)
    val_ds = make_val_ds(X_val, y_val)

    model.compile(optimizer=tf.keras.optimizers.Adam(1e-3),
                  loss="categorical_crossentropy", metrics=["accuracy"])
    cbs = [
        tf.keras.callbacks.EarlyStopping("val_accuracy", patience=patience,
                                          restore_best_weights=True, verbose=verbose),
        tf.keras.callbacks.ReduceLROnPlateau("val_loss", factor=0.5, patience=5,
                                              min_lr=1e-7, verbose=verbose),
    ]
    model.fit(train_ds, validation_data=val_ds, epochs=epochs_p1,
              class_weight=class_weight, callbacks=cbs, verbose=verbose)

    base.trainable = True
    for layer in base.layers[:-15]:
        layer.trainable = False
    model.compile(optimizer=tf.keras.optimizers.Adam(3e-5),
                  loss="categorical_crossentropy", metrics=["accuracy"])
    cbs2 = [
        tf.keras.callbacks.EarlyStopping("val_accuracy", patience=patience,
                                          restore_best_weights=True, verbose=verbose),
        tf.keras.callbacks.ReduceLROnPlateau("val_loss", factor=0.5, patience=5,
                                              min_lr=1e-7, verbose=verbose),
    ]
    model.fit(train_ds, validation_data=val_ds, epochs=epochs_p2,
              class_weight=class_weight, callbacks=cbs2, verbose=verbose)

    val_loss, val_acc = model.evaluate(val_ds, verbose=0)

    # per-class recall/precision (the number that actually explains "cans -> bottles")
    y_pred = []
    for xb, _ in val_ds:
        probs = model.predict(xb, verbose=0)
        y_pred.extend(np.argmax(probs, axis=1).tolist())
    y_pred = np.array(y_pred)
    per_class = {}
    for c in range(len(CLASSES)):
        mask = y_val == c
        n = int(mask.sum())
        correct = int((y_pred[mask] == c).sum()) if n > 0 else 0
        per_class[CLASSES[c]] = {"n": n, "recall": round(correct / n, 4) if n else None}
    return model, float(val_acc), float(val_loss), per_class


# ── PASS 1: stratified 5-fold CV for an honest accuracy estimate ────────────────
print(f"\n{'='*70}\nPASS 1: Stratified {N_FOLDS}-fold cross-validation "
      f"(honest accuracy estimate, reduced epochs for speed)\n{'='*70}")
skf = StratifiedKFold(n_splits=N_FOLDS, shuffle=True, random_state=SEED)
fold_accs, fold_per_class = [], []
for fold_i, (train_idx, val_idx) in enumerate(skf.split(X, y), start=1):
    print(f"\n--- Fold {fold_i}/{N_FOLDS} "
          f"(train={len(train_idx)}, val={len(val_idx)}) ---")
    Xt, yt = X[train_idx], y[train_idx]
    Xv, yv = X[val_idx], y[val_idx]
    t0 = time.time()
    _, val_acc, val_loss, per_class = train_one(
        Xt, yt, Xv, yv, CV_EPOCHS_P1, CV_EPOCHS_P2, CV_PATIENCE, verbose=0)
    dt = time.time() - t0
    print(f"  fold {fold_i}: val_acc={round(val_acc,4)} val_loss={round(val_loss,4)} "
          f"({dt:.0f}s)  per-class recall: "
          f"{ {k: v['recall'] for k, v in per_class.items()} }")
    fold_accs.append(val_acc)
    fold_per_class.append(per_class)

cv_mean = float(np.mean(fold_accs))
cv_std = float(np.std(fold_accs))
can_recalls = [fp["ALUMINUM_CAN"]["recall"] for fp in fold_per_class
               if fp["ALUMINUM_CAN"]["recall"] is not None]
pet_recalls = [fp["PET_BOTTLE"]["recall"] for fp in fold_per_class
               if fp["PET_BOTTLE"]["recall"] is not None]
cv_can_recall_mean = float(np.mean(can_recalls)) if can_recalls else None
cv_pet_recall_mean = float(np.mean(pet_recalls)) if pet_recalls else None

print(f"\n{'='*70}")
print(f"5-FOLD CV RESULT: accuracy = {cv_mean*100:.1f}% +/- {cv_std*100:.1f}%")
print(f"  PET_BOTTLE recall (mean across folds)  : "
      f"{cv_pet_recall_mean*100:.1f}%" if cv_pet_recall_mean is not None else "  n/a")
print(f"  ALUMINUM_CAN recall (mean across folds) : "
      f"{cv_can_recall_mean*100:.1f}%" if cv_can_recall_mean is not None else "  n/a")
print(f"{'='*70}")

# ── PASS 2: train the final production model on one stratified 80/20 split ─────
print(f"\n{'='*70}\nPASS 2: Training final production model "
      f"(stratified 80/20 split, full epoch budget)\n{'='*70}")
X_train, X_val, y_train, y_val = train_test_split(
    X, y, test_size=0.20, random_state=SEED, stratify=y)
print(f"Train={len(X_train)} ({int((y_train==0).sum())} PET / {int((y_train==1).sum())} CAN)  "
      f"Val={len(X_val)} ({int((y_val==0).sum())} PET / {int((y_val==1).sum())} CAN)")

model, val_acc, val_loss, per_class = train_one(
    X_train, y_train, X_val, y_val, EPOCHS_P1, EPOCHS_P2, PATIENCE, verbose=2)
total_params = model.count_params()
print(f"\nFinal (single-split) val_acc={round(val_acc,4)}  val_loss={round(val_loss,4)}")
print(f"Per-class recall on this split: "
      f"{ {k: v['recall'] for k, v in per_class.items()} }")

print(f"Saving Keras model -> {KERAS_PATH} ...")
model.save(str(KERAS_PATH))

# ── TFLite INT8 conversion ──────────────────────────────────────────────────────
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
print(f"Saved: {TFLITE_PATH}")

# ── Verify quantization + spot-check ────────────────────────────────────────────
print("Verifying TFLite ...")
interp = tf.lite.Interpreter(model_content=tflite_bytes)
interp.allocate_tensors()
inp_d = interp.get_input_details()[0]
out_d = interp.get_output_details()[0]

inp_scale = float(inp_d["quantization"][0])
inp_zp = int(inp_d["quantization"][1])
out_scale = float(out_d["quantization"][0])
out_zp = int(out_d["quantization"][1])

print(f"  Input : shape={inp_d['shape'].tolist()} dtype={inp_d['dtype'].__name__} "
      f"scale={inp_scale} zp={inp_zp}")
print(f"  Output: shape={out_d['shape'].tolist()} dtype={out_d['dtype'].__name__} "
      f"scale={out_scale} zp={out_zp}")

tflite_correct = 0
for ci, cn in enumerate(CLASSES):
    idxs = [i for i in range(len(X_val)) if y_val[i] == ci]
    n_correct_c = 0
    for i in idxs:
        img_u8 = X_val[i]
        img_f = tf.keras.applications.mobilenet.preprocess_input(img_u8.astype(np.float32))
        img_i8 = np.round(np.array(img_f) / inp_scale + inp_zp).astype(np.int8)
        interp.set_tensor(inp_d["index"], img_i8[np.newaxis])
        interp.invoke()
        raw = interp.get_tensor(out_d["index"])[0].astype(np.float32)
        probs = (raw - out_zp) * out_scale
        pred = int(np.argmax(probs))
        if pred == ci:
            n_correct_c += 1
            tflite_correct += 1
    print(f"  {cn}: {n_correct_c}/{len(idxs)} correct on TFLite INT8 model")
tflite_val_acc = tflite_correct / len(X_val) if len(X_val) else 0.0
print(f"  TFLite INT8 overall val accuracy: {round(tflite_val_acc*100,1)}%")

# ── Generate C header (identical format to original script) ────────────────────
print(f"Generating model_data.h -> {HEADER_PATH}")
lines = []
lines.append("/*")
lines.append(" * model_data.h  --  Auto-generated by scripts/retrain_esp32_model_v2.py")
lines.append(" * DO NOT EDIT MANUALLY.")
lines.append(" *")
lines.append(f" * Architecture : MobileNetV1 alpha=0.25  {IMG_SIZE}x{IMG_SIZE} RGB  INT8")
lines.append(f" * Classes      : 0=PET_BOTTLE  1=ALUMINUM_CAN")
lines.append(f" * Val accuracy : {round(val_acc*100,1)}% (single 80/20 split, internet images)")
lines.append(f" * 5-fold CV    : {round(cv_mean*100,1)}% +/- {round(cv_std*100,1)}% "
             f"(honest estimate, every image validated once)")
lines.append(f" * CAN recall   : {round(cv_can_recall_mean*100,1)}% (mean across folds) "
             f"-- the number that predicts real-world can misses")
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

# ── Metadata JSON ────────────────────────────────────────────────────────────────
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
    "val_accuracy": round(float(val_acc), 6),
    "val_loss": round(float(val_loss), 6),
    "tflite_val_accuracy": round(float(tflite_val_acc), 6),
    "cv_5fold_accuracy_mean": round(cv_mean, 6),
    "cv_5fold_accuracy_std": round(cv_std, 6),
    "cv_5fold_accuracy_per_fold": [round(a, 6) for a in fold_accs],
    "cv_5fold_pet_bottle_recall_mean": round(cv_pet_recall_mean, 6) if cv_pet_recall_mean is not None else None,
    "cv_5fold_aluminum_can_recall_mean": round(cv_can_recall_mean, 6) if cv_can_recall_mean is not None else None,
    "final_split_per_class_recall": {k: v["recall"] for k, v in per_class.items()},
    "tflite_size_bytes": sz,
    "total_parameters": total_params,
    "architecture": f"MobileNetV1-alpha0.25-{IMG_SIZE}x{IMG_SIZE}-INT8",
    "train_images": len(X_train),
    "val_images": len(y_val),
    "total_images": len(X),
    "class_counts": {CLASSES[0]: int((y == 0).sum()), CLASSES[1]: int((y == 1).sum())},
    "recipe": "retrain_esp32_model_v2 -- stratified split, stratified 5-fold CV, "
              "class-balanced augmentation, +rotation/zoom/translation. Same 96 source images "
              "as the original run, no new data added.",
    "note": "TRAINED ON INTERNET IMAGES. Must be validated on real kiosk captures before production. "
            "The 5-fold CV accuracy/recall figures are the trustworthy numbers -- the single-split "
            "val_accuracy above is one 19-20 image sample and can look better or worse than reality "
            "by chance on a dataset this small.",
}
META_PATH.write_text(json.dumps(meta, indent=2))
print(f"Metadata: {META_PATH}")

elapsed = time.time() - t_start
print("")
print("=" * 70)
print("  ESP32 model retrain (v2, same data) complete!")
print(f"  TFLite INT8           : {round(sz/1024,1)} KB")
print(f"  5-fold CV accuracy    : {cv_mean*100:.1f}% +/- {cv_std*100:.1f}%  <- trust this one")
print(f"  5-fold CAN recall     : "
      f"{cv_can_recall_mean*100:.1f}%" if cv_can_recall_mean is not None else "n/a")
print(f"  Final model val_acc   : {val_acc*100:.1f}% (single split, noisier)")
print(f"  TFLite INT8 val_acc   : {tflite_val_acc*100:.1f}%")
print(f"  Total time            : {elapsed/60:.1f} min")
print("=" * 70)
