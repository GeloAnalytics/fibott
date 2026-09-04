"""
finalize_esp32_model_v3.py
Companion to retrain_esp32_model_v3.py. The 5-fold CV run already gave the
honest estimate for this recipe + the full 124-image dataset (96 internet +
28 real ESP32 captures, source-aware balanced augmentation):
  73.4% +/- 3.8% accuracy, PET_BOTTLE recall 82.2%, ALUMINUM_CAN recall 58.4%
See logs/retrain_v3.log / logs/cv_v3_result.json for the full breakdown.

As with v2's finalize step: the deployed model is trained on ~90% of the
data (small stratified monitor slice held out only for early stopping), not
an 80/20 split, so the shipped model doesn't sacrifice a fifth of an already
small dataset to a validation set that then produces a worse model. The
5-fold CV numbers above are what's reported as the accuracy estimate.
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

IMG_SIZE      = 96
BATCH_SIZE    = 16
EPOCHS_P1     = 40
EPOCHS_P2     = 80
PATIENCE      = 15
SEED          = 42
CLASSES       = ["PET_BOTTLE", "ALUMINUM_CAN"]
BASE_AUG_MULT = 5
HOLDOUT_FRAC  = 0.10
REAL_PHOTO_MAX_BYTES = 50_000

CV_FOLD_ACCS = [0.7200000286102295, 0.6800000071525574, 0.7200000286102295, 0.7599999904632568, 0.7916666865348816]
CV_MEAN = 0.7343333482742309
CV_STD  = 0.038233200912282286
CV_PET_RECALL_MEAN = 0.82166
CV_CAN_RECALL_MEAN = 0.58446

print("Loading TensorFlow ...")
import tensorflow as tf
from sklearn.model_selection import train_test_split
print(f"  TF {tf.__version__}  NumPy {np.__version__}")
t_start = time.time()

def load_class(cls_dir, label):
    imgs, lbls, sources = [], [], []
    exts = {".jpg", ".jpeg", ".png"}
    files = sorted(f for f in cls_dir.iterdir() if f.suffix.lower() in exts)
    for f in files:
        try:
            size = f.stat().st_size
            img = Image.open(f).convert("RGB").resize((IMG_SIZE, IMG_SIZE), Image.LANCZOS)
            imgs.append(np.array(img, dtype=np.uint8))
            lbls.append(label)
            sources.append("real" if size < REAL_PHOTO_MAX_BYTES else "internet")
        except Exception as e:
            print(f"  WARN skip {f.name}: {e}")
    return imgs, lbls, sources

print("\nLoading dataset ...")
all_X, all_y, all_src = [], [], []
for idx, cls in enumerate(CLASSES):
    d = DATA_DIR / cls
    imgs, lbls, sources = load_class(d, idx)
    n_real = sum(1 for s in sources if s == "real")
    print(f"  {cls}: {len(imgs)} images -- {n_real} real, {len(imgs)-n_real} internet")
    all_X.extend(imgs); all_y.extend(lbls); all_src.extend(sources)
X = np.array(all_X, dtype=np.uint8)
y = np.array(all_y, dtype=np.int32)
src = np.array(all_src)

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

def _augmented_group_ds(Xg, yg, mult):
    ds_g = tf.data.Dataset.from_tensor_slices((Xg, yg)).map(preprocess_fn, num_parallel_calls=tf.data.AUTOTUNE)
    copies = [ds_g] + [
        tf.data.Dataset.from_tensor_slices((Xg, yg)).map(preprocess_fn, num_parallel_calls=tf.data.AUTOTUNE)
            .map(augment_fn, num_parallel_calls=tf.data.AUTOTUNE)
        for _ in range(mult - 1)
    ]
    out = copies[0]
    for cpy in copies[1:]:
        out = out.concatenate(cpy)
    return out

def make_balanced_train_ds(X_np, y_np, src_np):
    class_counts = {c: int((y_np == c).sum()) for c in range(len(CLASSES))}
    max_class = max(class_counts.values())
    parts, total = [], 0
    for c in range(len(CLASSES)):
        cmask = y_np == c
        class_target = BASE_AUG_MULT * (max_class / class_counts[c])
        real_mask = cmask & (src_np == "real")
        int_mask  = cmask & (src_np == "internet")
        n_real, n_int = int(real_mask.sum()), int(int_mask.sum())
        real_boost = (n_int / n_real) ** 0.5 if (n_real > 0 and n_int > 0) else 1.0
        for mask, n, is_real in [(int_mask, n_int, False), (real_mask, n_real, True)]:
            if n == 0:
                continue
            mult = max(1, round(class_target * (real_boost if is_real else 1.0)))
            Xg, yg = X_np[mask], y_np[mask]
            parts.append((_augmented_group_ds(Xg, yg, mult), n * mult))
            total += n * mult
            print(f"    {CLASSES[c]}/{'real' if is_real else 'internet'}: {n} real -> x{mult} -> {n*mult} effective")
    ds = parts[0][0]
    for p, _ in parts[1:]:
        ds = ds.concatenate(p)
    ds = ds.shuffle(total, seed=SEED)
    return ds.batch(BATCH_SIZE).prefetch(tf.data.AUTOTUNE)

def make_val_ds(X_np, y_np):
    ds = tf.data.Dataset.from_tensor_slices((X_np, y_np))
    ds = ds.map(preprocess_fn, num_parallel_calls=tf.data.AUTOTUNE)
    return ds.batch(BATCH_SIZE).prefetch(tf.data.AUTOTUNE)

print(f"\n{'='*70}\nTraining deployed model on ~90% of the full 124-image dataset\n{'='*70}")
idx_all = np.arange(len(X))
idx_train, idx_mon = train_test_split(idx_all, test_size=HOLDOUT_FRAC, random_state=SEED, stratify=y)
X_train, y_train, src_train = X[idx_train], y[idx_train], src[idx_train]
X_mon, y_mon = X[idx_mon], y[idx_mon]
print(f"Train={len(X_train)} ({int((y_train==0).sum())} PET / {int((y_train==1).sum())} CAN, "
      f"{int((src_train=='real').sum())} real)  Monitor={len(X_mon)} "
      f"({int((y_mon==0).sum())} PET / {int((y_mon==1).sum())} CAN)")

counts = {i: int((y_train == i).sum()) for i in range(len(CLASSES))}
max_c = max(counts.values())
class_weight = {i: float(np.sqrt(max_c / max(counts.get(i, 1), 1))) for i in range(len(CLASSES))}
print("Class weights:", {CLASSES[i]: round(class_weight[i], 2) for i in range(len(CLASSES))})

train_ds = make_balanced_train_ds(X_train, y_train, src_train)
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
print(f"\nMonitor-split acc={round(mon_acc,4)} loss={round(mon_loss,4)} ({len(X_mon)} images, low-signal)")

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

print("Verifying TFLite ...")
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

print(f"Generating model_data.h -> {HEADER_PATH}")
lines = []
lines.append("/*")
lines.append(" * model_data.h  --  Auto-generated by scripts/finalize_esp32_model_v3.py")
lines.append(" * DO NOT EDIT MANUALLY.")
lines.append(" *")
lines.append(f" * Architecture : MobileNetV1 alpha=0.25  {IMG_SIZE}x{IMG_SIZE} RGB  INT8")
lines.append(f" * Classes      : 0=PET_BOTTLE  1=ALUMINUM_CAN")
lines.append(f" * Dataset      : 124 images (96 internet product photos + 28 real ESP32")
lines.append(f" *                kiosk captures). Real photos are source-aware boosted during")
lines.append(f" *                augmentation so they carry more weight than their raw count.")
lines.append(f" * 5-fold CV    : {round(CV_MEAN*100,1)}% +/- {round(CV_STD*100,1)}% accuracy -- HONEST estimate")
lines.append(f" * CV PET recall: {round(CV_PET_RECALL_MEAN*100,1)}%   "
             f"CV CAN recall: {round(CV_CAN_RECALL_MEAN*100,1)}%  (mean across 5 folds)")
lines.append(f" * Deployed model trained on {len(X_train)}/{len(X)} images (small "
             f"{len(X_mon)}-image slice held out only for early stopping)")
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
    "real_photo_images": int((src == "real").sum()),
    "internet_photo_images": int((src == "internet").sum()),
    "class_counts": {CLASSES[0]: int((y == 0).sum()), CLASSES[1]: int((y == 1).sum())},
    "recipe": "retrain_esp32_model_v3 + finalize_esp32_model_v3 -- stratified 5-fold CV, "
              "class-balanced AND source-aware (real vs internet) balanced augmentation "
              "(sqrt-scaled boost for the real-photo subgroup within each class), "
              "+rotation/zoom/translation. 124 images: 96 original internet product photos "
              "+ 28 real ESP32 kiosk captures added this round.",
    "note": "First retrain to include real ESP32-camera-captured training photos (28 of 124), "
            "not just internet product photos. 5-fold CV accuracy improved from 64.5% (v2, "
            "internet-only + first 12 real photos folded in inconsistently) to 73.4%, and "
            "ALUMINUM_CAN recall from 44.8% to 58.4% -- real photos measurably helped, "
            "especially on the weaker class. Still a small dataset (124 images, most classes "
            "under 20 unique real items) -- expect continued improvement as the image-logging "
            "pipeline (deposit-image route) accumulates real deposits over time. Must be "
            "validated against live kiosk usage.",
}
META_PATH.write_text(json.dumps(meta, indent=2))
print(f"Metadata: {META_PATH}")

elapsed = time.time() - t_start
print("")
print("=" * 70)
print("  ESP32 model finalize (v3, +28 real photos) complete!")
print(f"  TFLite INT8              : {round(sz/1024,1)} KB")
print(f"  5-fold CV accuracy       : {CV_MEAN*100:.1f}% +/- {CV_STD*100:.1f}%  <- trust this one")
print(f"  5-fold CV CAN recall     : {CV_CAN_RECALL_MEAN*100:.1f}%")
print(f"  5-fold CV PET recall     : {CV_PET_RECALL_MEAN*100:.1f}%")
print(f"  Monitor-slice TFLite acc : {mon_tflite_acc*100:.1f}% ({len(X_mon)} images, low-signal)")
print(f"  Total time               : {elapsed/60:.1f} min")
print("=" * 70)
