"""
train_esp32_3class.py
Retrains the MobileNetV1 alpha=0.25 (96x96 INT8) model on the local Dataset/ folder
to classify 3 classes:
  0 = PET_BOTTLE       (plastic bottles)
  1 = ALUMINUM_CAN     (soda cans)
  2 = NOT_BOTTLE_OR_CAN (non-bottles, non-cans, hands, paper, empty chute, etc.)

Outputs:
  - models/esp32/fibott_classifier.keras
  - models/esp32/fibott_classifier_int8.tflite
  - models/esp32/model_meta.json
  - firmware/esp32-cam-vision/model_data.h
"""
import os, sys, json, pathlib, time, random
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

os.environ["TF_CPP_MIN_LOG_LEVEL"] = "2"
os.environ["PYTHONIOENCODING"] = "utf-8"

ROOT        = pathlib.Path(__file__).resolve().parent.parent.parent
DATA_DIR    = ROOT / "Dataset"
OUT_DIR     = ROOT / "models" / "esp32"
KERAS_PATH  = OUT_DIR / "fibott_classifier.keras"
TFLITE_PATH = OUT_DIR / "fibott_classifier_int8.tflite"
HEADER_PATH = ROOT / "firmware" / "esp32-cam-vision" / "model_data.h"
META_PATH   = OUT_DIR / "model_meta.json"

OUT_DIR.mkdir(parents=True, exist_ok=True)
HEADER_PATH.parent.mkdir(parents=True, exist_ok=True)

IMG_SIZE   = 96
BATCH_SIZE = 16
SEED       = 42

CLASSES = ["PET_BOTTLE", "ALUMINUM_CAN", "NOT_BOTTLE_OR_CAN"]

print("=" * 70)
print(" Fibott ESP32-CAM 3-Class Retraining")
print(" Classes: 0=PET_BOTTLE, 1=ALUMINUM_CAN, 2=NOT_BOTTLE_OR_CAN")
print("=" * 70)

print("\nImporting TensorFlow ...")
import tensorflow as tf
from sklearn.model_selection import train_test_split
print(f"  TF version: {tf.__version__}")

# Set seeds
np.random.seed(SEED)
tf.random.set_seed(SEED)
random.seed(SEED)


def load_folder_images(folder_path, label):
    imgs, lbls = [], []
    exts = {".jpg", ".jpeg", ".png"}
    files = sorted([f for f in folder_path.rglob("*") if f.suffix.lower() in exts])
    for f in files:
        try:
            img = Image.open(f).convert("RGB").resize((IMG_SIZE, IMG_SIZE), Image.LANCZOS)
            imgs.append(np.array(img, dtype=np.uint8))
            lbls.append(label)
        except Exception as e:
            print(f"  WARN skipping {f.name}: {e}")
    return imgs, lbls


def generate_synthetic_negatives(count=30):
    """
    Generates diverse non-bottle/non-can synthetic training samples:
      - Plain cardboard / white paper / newsprint / receipt textures
      - Skin tone patches (hands under LED)
      - Dark/empty chute variations with LED hot-spots
      - Random gradient / abstract textures
    """
    synth_imgs = []
    
    # 1. Paper / Flat white / Cardboard textures
    for _ in range(count // 3):
        bg_col = (random.randint(190, 245), random.randint(185, 240), random.randint(170, 230))
        im = Image.new("RGB", (IMG_SIZE, IMG_SIZE), color=bg_col)
        draw = ImageDraw.Draw(im)
        # Random folds or print lines
        for _ in range(random.randint(2, 6)):
            y = random.randint(10, 85)
            draw.line([(0, y), (IMG_SIZE, y + random.randint(-5, 5))],
                      fill=(random.randint(50, 160), random.randint(50, 160), random.randint(50, 160)),
                      width=random.randint(1, 3))
        synth_imgs.append(np.array(im, dtype=np.uint8))

    # 2. Skin tone textures (simulating hand / arm / fingers in chute)
    for _ in range(count // 3):
        # Human skin tone ranges under LED
        base_r = random.randint(140, 225)
        base_g = int(base_r * random.uniform(0.60, 0.78))
        base_b = int(base_g * random.uniform(0.60, 0.80))
        im = Image.new("RGB", (IMG_SIZE, IMG_SIZE), color=(base_r, base_g, base_b))
        # Add slight shading / gradient
        arr = np.array(im, dtype=np.float32)
        noise = np.random.normal(0, 8, arr.shape)
        arr = np.clip(arr + noise, 0, 255).astype(np.uint8)
        synth_imgs.append(arr)

    # 3. Empty chute / dark background with subtle glare or metal floor
    for _ in range(count - (2 * (count // 3))):
        base_dark = random.randint(10, 45)
        im = Image.new("RGB", (IMG_SIZE, IMG_SIZE), color=(base_dark, base_dark, base_dark))
        draw = ImageDraw.Draw(im)
        # Glare or chute corner
        if random.random() > 0.5:
            cx, cy = random.randint(20, 75), random.randint(20, 75)
            r = random.randint(15, 35)
            draw.ellipse([cx - r, cy - r, cx + r, cy + r],
                         fill=(random.randint(70, 130), random.randint(70, 130), random.randint(70, 130)))
            im = im.filter(ImageFilter.GaussianBlur(radius=random.randint(5, 12)))
        synth_imgs.append(np.array(im, dtype=np.uint8))

    return synth_imgs


print("\nLoading dataset from:", DATA_DIR)
all_X, all_y = [], []

# 0. PET_BOTTLE (plasticbottle)
pet_imgs, pet_lbls = load_folder_images(DATA_DIR / "plasticbottle", 0)
print(f"  Class 0 (PET_BOTTLE):        {len(pet_imgs)} images")
all_X.extend(pet_imgs); all_y.extend(pet_lbls)

# 1. ALUMINUM_CAN (Sodacans)
can_imgs, can_lbls = load_folder_images(DATA_DIR / "Sodacans", 1)
print(f"  Class 1 (ALUMINUM_CAN):      {len(can_imgs)} images")
all_X.extend(can_imgs); all_y.extend(can_lbls)

# 2. NOT_BOTTLE_OR_CAN (notBottleOrCan)
not_imgs, not_lbls = load_folder_images(DATA_DIR / "notBottleOrCan", 2)
print(f"  Class 2 (NOT_BOTTLE_OR_CAN): {len(not_imgs)} real images")

# Add synthetic negative samples to bolster non-bottle / non-can representations
synth_negatives = generate_synthetic_negatives(count=30)
print(f"  + Added {len(synth_negatives)} diverse synthetic non-bottle/non-can samples (paper, skin tone, empty chute)")
not_imgs.extend(synth_negatives)
not_lbls.extend([2] * len(synth_negatives))
print(f"  Class 2 total base:          {len(not_imgs)} images")

all_X.extend(not_imgs); all_y.extend(not_lbls)

X = np.array(all_X, dtype=np.uint8)
y = np.array(all_y, dtype=np.int32)
print(f"\nTotal Base Images: {len(X)}")

# Stratified train / validation split (85% train, 15% validation)
idx_train, idx_val = train_test_split(
    np.arange(len(X)),
    test_size=0.15,
    random_state=SEED,
    stratify=y
)

X_train_raw, y_train_raw = X[idx_train], y[idx_train]
X_val, y_val = X[idx_val], y[idx_val]

print(f"Train Raw: {len(X_train_raw)} images (PET={(y_train_raw==0).sum()}, CAN={(y_train_raw==1).sum()}, NOT={(y_train_raw==2).sum()})")
print(f"Val Raw:   {len(X_val)} images (PET={(y_val==0).sum()}, CAN={(y_val==1).sum()}, NOT={(y_val==2).sum()})")

# Data Augmentation Pipeline
geo_aug = tf.keras.Sequential([
    tf.keras.layers.RandomRotation(0.08, fill_mode="reflect", seed=SEED),
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

def build_balanced_dataset(X_data, y_data, target_per_class=350):
    ds_parts = []
    total_effective = 0
    for c in range(len(CLASSES)):
        mask = (y_data == c)
        Xc = X_data[mask]
        yc = y_data[mask]
        n = len(Xc)
        mult = max(1, round(target_per_class / n))
        
        base_ds = tf.data.Dataset.from_tensor_slices((Xc, yc)).map(preprocess_fn, num_parallel_calls=tf.data.AUTOTUNE)
        copies = [base_ds]
        for _ in range(mult - 1):
            aug_ds = tf.data.Dataset.from_tensor_slices((Xc, yc))\
                     .map(preprocess_fn, num_parallel_calls=tf.data.AUTOTUNE)\
                     .map(augment_fn, num_parallel_calls=tf.data.AUTOTUNE)
            copies.append(aug_ds)
            
        class_ds = copies[0]
        for cp in copies[1:]:
            class_ds = class_ds.concatenate(cp)
        ds_parts.append(class_ds)
        effective_count = n * mult
        total_effective += effective_count
        print(f"  Class {CLASSES[c]}: {n} images x {mult} -> {effective_count} augmented samples")
        
    combined = ds_parts[0]
    for p in ds_parts[1:]:
        combined = combined.concatenate(p)
    combined = combined.shuffle(total_effective, seed=SEED)
    return combined.batch(BATCH_SIZE).prefetch(tf.data.AUTOTUNE), total_effective

print("\nBuilding balanced augmented train dataset (~350 samples/class) ...")
train_ds, n_train_effective = build_balanced_dataset(X_train_raw, y_train_raw, target_per_class=350)

val_ds = tf.data.Dataset.from_tensor_slices((X_val, y_val))\
         .map(preprocess_fn, num_parallel_calls=tf.data.AUTOTUNE)\
         .batch(BATCH_SIZE).prefetch(tf.data.AUTOTUNE)

print(f"\nBuilding MobileNetV1 alpha=0.25 (96x96x3) for {len(CLASSES)} classes ...")
base_mobilenet = tf.keras.applications.MobileNet(
    input_shape=(IMG_SIZE, IMG_SIZE, 3),
    alpha=0.25,
    include_top=False,
    weights="imagenet",
    pooling="avg",
)
base_mobilenet.trainable = False

inputs = tf.keras.Input((IMG_SIZE, IMG_SIZE, 3), name="image_input")
features = base_mobilenet(inputs, training=False)
x = tf.keras.layers.BatchNormalization()(features)
x = tf.keras.layers.Dropout(0.3)(x)
x = tf.keras.layers.Dense(64, activation="relu", kernel_regularizer=tf.keras.regularizers.l2(1e-4))(x)
x = tf.keras.layers.Dropout(0.2)(x)
outputs = tf.keras.layers.Dense(len(CLASSES), activation="softmax", name="classifier")(x)

model = tf.keras.Model(inputs, outputs, name="fibott_esp32_3class")
model.compile(
    optimizer=tf.keras.optimizers.Adam(1e-3),
    loss="categorical_crossentropy",
    metrics=["accuracy"],
)
print(f"  Total parameters: {model.count_params()}")

# Phase 1: Train Head
print("\n" + "=" * 70)
print(" Phase 1: Training Classification Head (Backbone Frozen) ...")
print("=" * 70)

cbs_phase1 = [
    tf.keras.callbacks.EarlyStopping("val_accuracy", patience=12, restore_best_weights=True, verbose=1),
    tf.keras.callbacks.ReduceLROnPlateau("val_loss", factor=0.5, patience=4, min_lr=1e-6, verbose=1),
]

history_p1 = model.fit(
    train_ds,
    validation_data=val_ds,
    epochs=35,
    callbacks=cbs_phase1,
    verbose=2,
)

# Phase 2: Fine-tuning top layers of MobileNet
print("\n" + "=" * 70)
print(" Phase 2: Fine-tuning MobileNet Backbone (Top Layers Unfrozen) ...")
print("=" * 70)

base_mobilenet.trainable = True
# Freeze early feature layers, fine-tune the last 20 layers
for layer in base_mobilenet.layers[:-20]:
    layer.trainable = False

model.compile(
    optimizer=tf.keras.optimizers.Adam(1e-4),
    loss="categorical_crossentropy",
    metrics=["accuracy"],
)

cbs_phase2 = [
    tf.keras.callbacks.EarlyStopping("val_accuracy", patience=15, restore_best_weights=True, verbose=1),
    tf.keras.callbacks.ReduceLROnPlateau("val_loss", factor=0.5, patience=5, min_lr=1e-7, verbose=1),
]

history_p2 = model.fit(
    train_ds,
    validation_data=val_ds,
    epochs=50,
    callbacks=cbs_phase2,
    verbose=2,
)

print(f"\nSaving Keras model to: {KERAS_PATH}")
model.save(KERAS_PATH)

# Evaluate on Validation Set
val_preds = model.predict(val_ds)
val_pred_labels = np.argmax(val_preds, axis=1)
keras_acc = np.mean(val_pred_labels == y_val)
print(f"\nFinal Keras Validation Accuracy: {keras_acc*100:.2f}%")

per_class_recalls = {}
for i, cname in enumerate(CLASSES):
    mask = (y_val == i)
    if mask.sum() > 0:
        rec = np.mean(val_pred_labels[mask] == i)
        per_class_recalls[cname] = float(rec)
        print(f"  Recall [{cname}]: {rec*100:.1f}% ({mask.sum()} val images)")

# TFLite INT8 Quantization
print("\n" + "=" * 70)
print(" Quantizing to INT8 TFLite Micro FlatBuffer ...")
print("=" * 70)

def representative_dataset_gen():
    # Use random subset of raw images preprocessed
    for img in X_train_raw[:80]:
        img_f = img.astype(np.float32) / 127.5 - 1.0
        yield [np.expand_dims(img_f, axis=0)]

converter = tf.lite.TFLiteConverter.from_keras_model(model)
converter.optimizations = [tf.lite.Optimize.DEFAULT]
converter.representative_dataset = representative_dataset_gen
converter.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS_INT8]
converter.inference_input_type = tf.int8
converter.inference_output_type = tf.int8

tflite_bytes = converter.convert()
TFLITE_PATH.write_bytes(tflite_bytes)
tflite_sz = len(tflite_bytes)
print(f"  TFLite INT8 model size: {tflite_sz} bytes ({tflite_sz / 1024:.1f} KB)")

# Test with TFLite Interpreter
interp = tf.lite.Interpreter(model_content=tflite_bytes)
interp.allocate_tensors()
inp_det = interp.get_input_details()[0]
out_det = interp.get_output_details()[0]

inp_scale, inp_zp = inp_det["quantization"]
out_scale, out_zp = out_det["quantization"]
print(f"  Input Quantization:  Scale={inp_scale}, ZeroPoint={inp_zp}")
print(f"  Output Quantization: Scale={out_scale}, ZeroPoint={out_zp}")

# Verify TFLite on Validation Set
tflite_preds = []
for img in X_val:
    img_f = (img.astype(np.float32) / 127.5) - 1.0
    q_inp = np.round(img_f / inp_scale + inp_zp).clip(-128, 127).astype(np.int8)
    interp.set_tensor(inp_det["index"], np.expand_dims(q_inp, axis=0))
    interp.invoke()
    q_out = interp.get_tensor(out_det["index"])[0]
    prob_out = (q_out.astype(np.float32) - out_zp) * out_scale
    tflite_preds.append(np.argmax(prob_out))

tflite_preds = np.array(tflite_preds)
tflite_acc = np.mean(tflite_preds == y_val)
print(f"  TFLite INT8 Validation Accuracy: {tflite_acc*100:.2f}%")

# Generate C header model_data.h
print("\n" + "=" * 70)
print(f" Generating C Header: {HEADER_PATH} ...")
print("=" * 70)

lines = []
lines.append("/*")
lines.append(" * model_data.h  --  Auto-generated by scripts/ml/train_esp32_3class.py")
lines.append(" * DO NOT EDIT MANUALLY.")
lines.append(" *")
lines.append(f" * Architecture : MobileNetV1 alpha=0.25  {IMG_SIZE}x{IMG_SIZE} RGB  INT8")
lines.append(" * Classes      : 0=PET_BOTTLE  1=ALUMINUM_CAN  2=NOT_BOTTLE_OR_CAN")
lines.append(f" * Total Images : {len(X)} base images (PET={(y==0).sum()}, CAN={(y==1).sum()}, NOT={(y==2).sum()})")
lines.append(f" * TFLite Acc   : {tflite_acc*100:.1f}% on validation slice")
lines.append(f" * TFLite size  : {tflite_sz} bytes ({tflite_sz / 1024:.1f} KB)")
lines.append(f" * Total params : {model.count_params()}")
lines.append(" *")
lines.append(" * INPUT PREPROCESSING (must be replicated exactly in firmware):")
lines.append(f" *   1. Capture/resize frame to {IMG_SIZE}x{IMG_SIZE} RGB888")
lines.append(" *   2. MobileNet preprocess: float_pix = (uint8_pix / 127.5f) - 1.0f")
lines.append(f" *   3. Quantize: int8_pix = (int8_t)roundf(float_pix / {inp_scale}f + (float)({inp_zp}))")
lines.append(" *")
lines.append(" * OUTPUT DEQUANTIZATION:")
lines.append(f" *   float_prob = ((float)int8_out - ({out_zp})) * {out_scale}f")
lines.append(" *")
lines.append(" * TENSOR ARENA: allocate >= 300000 bytes (from PSRAM via heap_caps_malloc)")
lines.append(" */")
lines.append("")
lines.append("#pragma once")
lines.append("#include <stdint.h>")
lines.append("")
lines.append(f"#define MODEL_INPUT_SIZE              {IMG_SIZE}")
lines.append(f"#define MODEL_INPUT_CHANNELS          3")
lines.append(f"#define MODEL_NUM_CLASSES             3")
lines.append(f"#define MODEL_CLASS_PET_BOTTLE        0")
lines.append(f"#define MODEL_CLASS_ALUMINUM_CAN      1")
lines.append(f"#define MODEL_CLASS_NOT_BOTTLE_OR_CAN 2")
lines.append("")
lines.append(f"#define MODEL_INPUT_SCALE             {inp_scale}f")
lines.append(f"#define MODEL_INPUT_ZERO_POINT        {inp_zp}")
lines.append(f"#define MODEL_OUTPUT_SCALE            {out_scale}f")
lines.append(f"#define MODEL_OUTPUT_ZERO_POINT       {out_zp}")
lines.append(f"#define MODEL_TENSOR_ARENA_SIZE       (300 * 1024)  // bytes from PSRAM")
lines.append("")
lines.append(f"// TFLite flatbuffer -- {tflite_sz} bytes")
lines.append(f"const unsigned int  g_model_data_len = {tflite_sz}U;")
lines.append("alignas(8) const unsigned char g_model_data[] = {")

for i in range(0, tflite_sz, 16):
    chunk = tflite_bytes[i:i + 16]
    comma = "," if (i + 16) < tflite_sz else ""
    lines.append("  " + ", ".join(f"0x{b:02x}" for b in chunk) + comma)

lines.append("};")
lines.append("")

HEADER_PATH.write_text("\n".join(lines), encoding="utf-8")
print(f"  Header written successfully to {HEADER_PATH} ({HEADER_PATH.stat().st_size} bytes)")

meta = {
    "classes": CLASSES,
    "class_indices": {
        "PET_BOTTLE": 0,
        "ALUMINUM_CAN": 1,
        "NOT_BOTTLE_OR_CAN": 2,
    },
    "input_size": IMG_SIZE,
    "input_channels": 3,
    "input_dtype": "int8",
    "output_dtype": "int8",
    "input_scale": float(inp_scale),
    "input_zero_point": int(inp_zp),
    "output_scale": float(out_scale),
    "output_zero_point": int(out_zp),
    "keras_val_accuracy": float(keras_acc),
    "tflite_val_accuracy": float(tflite_acc),
    "per_class_recall": per_class_recalls,
    "tflite_size_bytes": tflite_sz,
    "total_parameters": int(model.count_params()),
    "architecture": f"MobileNetV1-alpha0.25-{IMG_SIZE}x{IMG_SIZE}-INT8",
    "total_base_images": len(X),
    "train_images": len(X_train_raw),
    "val_images": len(X_val),
    "base_class_counts": {
        "PET_BOTTLE": int((y == 0).sum()),
        "ALUMINUM_CAN": int((y == 1).sum()),
        "NOT_BOTTLE_OR_CAN": int((y == 2).sum()),
    },
    "trained_at": time.strftime("%Y-%m-%d %H:%M:%S"),
    "dataset_source": "Dataset/ (plasticbottle, Sodacans, notBottleOrCan) + synthetic negatives + balanced augmentation",
}
META_PATH.write_text(json.dumps(meta, indent=2))
print(f"  Metadata written to {META_PATH}")

print("\n" + "=" * 70)
print("  3-CLASS ESP32 RETRAINING COMPLETE!")
print(f"  TFLite size: {tflite_sz / 1024:.1f} KB")
print(f"  TFLite Accuracy: {tflite_acc * 100:.1f}%")
print("=" * 70)
