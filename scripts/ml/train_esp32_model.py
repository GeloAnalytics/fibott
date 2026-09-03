"""
train_esp32_model.py
Trains MobileNetV1 alpha=0.25 at 96x96 on ml-data images.
Outputs: TFLite INT8 model + C header (model_data.h) for Arduino.
Classes: 0=PET_BOTTLE  1=ALUMINUM_CAN  (fixed order, matches weights.json)
"""
import os, sys, json, pathlib
import numpy as np
from PIL import Image

os.environ["TF_CPP_MIN_LOG_LEVEL"] = "2"

ROOT        = pathlib.Path(r"c:/Users/PC/Fibott")
DATA_DIR    = ROOT / "ml-data"
OUT_DIR     = ROOT / "models" / "esp32"
KERAS_PATH  = OUT_DIR / "fibott_classifier.keras"
TFLITE_PATH = OUT_DIR / "fibott_classifier_int8.tflite"
HEADER_PATH = ROOT / "firmware/esp32-cam-buzzer/esp32-cam-buzzer-2pin/model_data.h"
META_PATH   = OUT_DIR / "model_meta.json"

OUT_DIR.mkdir(parents=True, exist_ok=True)

IMG_SIZE   = 96
BATCH_SIZE = 16
EPOCHS_P1  = 40
EPOCHS_P2  = 80
PATIENCE   = 15
SEED       = 42
CLASSES    = ["PET_BOTTLE", "ALUMINUM_CAN"]

print("Loading TensorFlow ...")
import tensorflow as tf
print(f"  TF {tf.__version__}  NumPy {np.__version__}")


def load_class(cls_dir, label):
    imgs, lbls = [], []
    exts = {".jpg", ".jpeg", ".png"}
    files = [f for f in cls_dir.iterdir() if f.suffix.lower() in exts]
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
        print(f"  WARN: {d} missing — skipping {cls}")
        continue
    imgs, lbls = load_class(d, idx)
    print(f"  {cls}: {len(imgs)} images (label={idx})")
    all_X.extend(imgs)
    all_y.extend(lbls)

if len(set(all_y)) < 2:
    print("ERROR: need at least 2 classes with images.")
    sys.exit(1)

X = np.array(all_X, dtype=np.uint8)
y = np.array(all_y, dtype=np.int32)

rng  = np.random.default_rng(SEED)
perm = rng.permutation(len(X))
X, y = X[perm], y[perm]

n_val        = max(2, int(len(X) * 0.20))
X_val, y_val     = X[:n_val], y[:n_val]
X_train, y_train = X[n_val:], y[n_val:]
print(f"Train={len(X_train)}, Val={len(y_val)}")

from collections import Counter
counts = Counter(y_train.tolist())
max_c  = max(counts.values())
class_weight = {i: max_c / counts.get(i, 1) for i in range(len(CLASSES))}
print("Class weights:", {CLASSES[i]: round(class_weight[i], 2) for i in range(len(CLASSES))})


def preprocess_fn(x, y):
    x = tf.cast(x, tf.float32)
    x = tf.keras.applications.mobilenet.preprocess_input(x)
    return x, tf.one_hot(y, len(CLASSES))

def augment_fn(x, y):
    x = tf.image.random_flip_left_right(x)
    x = tf.image.random_flip_up_down(x)
    x = tf.image.random_brightness(x, max_delta=0.25)
    x = tf.image.random_contrast(x, 0.75, 1.25)
    x = tf.image.random_saturation(x, 0.7, 1.3)
    x = tf.image.random_hue(x, 0.05)
    return x, y

def make_ds(X_np, y_np, augment=False, shuffle=False):
    ds = tf.data.Dataset.from_tensor_slices((X_np, y_np))
    if shuffle:
        ds = ds.shuffle(len(X_np), seed=SEED)
    ds = ds.map(preprocess_fn, num_parallel_calls=tf.data.AUTOTUNE)
    if augment:
        copies = [ds.map(augment_fn, num_parallel_calls=tf.data.AUTOTUNE) for _ in range(4)]
        for c in copies:
            ds = ds.concatenate(c)
        ds = ds.shuffle(len(X_np) * 5, seed=SEED)
    return ds.batch(BATCH_SIZE).prefetch(tf.data.AUTOTUNE)

train_ds = make_ds(X_train, y_train, augment=True, shuffle=True)
val_ds   = make_ds(X_val, y_val)


print("\nBuilding MobileNetV1 alpha=0.25 ...")
base = tf.keras.applications.MobileNet(
    input_shape=(IMG_SIZE, IMG_SIZE, 3),
    alpha=0.25,
    include_top=False,
    weights="imagenet",
    pooling="avg",
)
base.trainable = False
print(f"  Backbone params: {base.count_params()}")

inp  = tf.keras.Input((IMG_SIZE, IMG_SIZE, 3), name="image_input")
x    = base(inp, training=False)
x    = tf.keras.layers.BatchNormalization()(x)
x    = tf.keras.layers.Dropout(0.3)(x)
x    = tf.keras.layers.Dense(64, activation="relu",
         kernel_regularizer=tf.keras.regularizers.l2(1e-4))(x)
x    = tf.keras.layers.Dropout(0.2)(x)
out  = tf.keras.layers.Dense(len(CLASSES), activation="softmax", name="classifier")(x)

model = tf.keras.Model(inp, out, name="fibott_esp32")
model.compile(
    optimizer=tf.keras.optimizers.Adam(1e-3),
    loss="categorical_crossentropy",
    metrics=["accuracy"],
)
print(f"  Total params: {model.count_params()}")

cbs = [
    tf.keras.callbacks.EarlyStopping(
        "val_accuracy", patience=PATIENCE, restore_best_weights=True, verbose=1),
    tf.keras.callbacks.ReduceLROnPlateau(
        "val_loss", factor=0.5, patience=5, min_lr=1e-7, verbose=1),
]

print("\nPhase 1: head training (backbone frozen) ...")
model.fit(train_ds, validation_data=val_ds, epochs=EPOCHS_P1,
          class_weight=class_weight, callbacks=cbs, verbose=1)

print("\nPhase 2: fine-tune top backbone layers ...")
base.trainable = True
for layer in base.layers[:-15]:
    layer.trainable = False
model.compile(
    optimizer=tf.keras.optimizers.Adam(3e-5),
    loss="categorical_crossentropy",
    metrics=["accuracy"],
)
cbs2 = [
    tf.keras.callbacks.EarlyStopping(
        "val_accuracy", patience=PATIENCE, restore_best_weights=True, verbose=1),
    tf.keras.callbacks.ReduceLROnPlateau(
        "val_loss", factor=0.5, patience=5, min_lr=1e-7, verbose=1),
]
model.fit(train_ds, validation_data=val_ds, epochs=EPOCHS_P2,
          class_weight=class_weight, callbacks=cbs2, verbose=1)

val_loss, val_acc = model.evaluate(val_ds, verbose=0)
total_params = model.count_params()
print(f"\nFinal val_acc={round(val_acc, 4)}  val_loss={round(val_loss, 4)}")

print(f"Saving Keras model -> {KERAS_PATH} ...")
model.save(str(KERAS_PATH))

# ── TFLite INT8 conversion ───────────────────────────────────────────────────
print("Converting to TFLite INT8 ...")

def rep_dataset():
    for xb, _ in make_ds(X_train, y_train, augment=False):
        for xi in xb:
            yield [tf.expand_dims(xi, 0)]

conv = tf.lite.TFLiteConverter.from_keras_model(model)
conv.optimizations = [tf.lite.Optimize.DEFAULT]
conv.representative_dataset = rep_dataset
conv.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS_INT8]
conv.inference_input_type  = tf.int8
conv.inference_output_type = tf.int8
tflite_bytes = conv.convert()

sz = len(tflite_bytes)
print(f"TFLite INT8: {sz} bytes ({round(sz/1024, 1)} KB)")
TFLITE_PATH.write_bytes(tflite_bytes)
print(f"Saved: {TFLITE_PATH}")

# ── Verify ───────────────────────────────────────────────────────────────────
print("Verifying TFLite ...")
interp = tf.lite.Interpreter(model_content=tflite_bytes)
interp.allocate_tensors()
inp_d = interp.get_input_details()[0]
out_d = interp.get_output_details()[0]

inp_scale = float(inp_d["quantization"][0])
inp_zp    = int(inp_d["quantization"][1])
out_scale = float(out_d["quantization"][0])
out_zp    = int(out_d["quantization"][1])

print(f"  Input : shape={inp_d['shape'].tolist()} dtype={inp_d['dtype'].__name__} scale={inp_scale} zp={inp_zp}")
print(f"  Output: shape={out_d['shape'].tolist()} dtype={out_d['dtype'].__name__} scale={out_scale} zp={out_zp}")

for ci, cn in enumerate(CLASSES):
    samps = [(X_val[i], y_val[i]) for i in range(len(X_val)) if y_val[i] == ci]
    if not samps:
        continue
    img_u8, _ = samps[0]
    img_f  = tf.keras.applications.mobilenet.preprocess_input(img_u8.astype(np.float32))
    img_i8 = np.round(np.array(img_f) / inp_scale + inp_zp).astype(np.int8)
    interp.set_tensor(inp_d["index"], img_i8[np.newaxis])
    interp.invoke()
    raw   = interp.get_tensor(out_d["index"])[0].astype(np.float32)
    probs = (raw - out_zp) * out_scale
    pred  = int(np.argmax(probs))
    ok    = "OK   " if pred == ci else "WRONG"
    print(f"  [{ok}] {cn}: P(PET)={round(probs[0],3)} P(CAN)={round(probs[1],3)} -> {CLASSES[pred]}")

# ── Generate C header ────────────────────────────────────────────────────────
print(f"Generating model_data.h -> {HEADER_PATH}")

lines = []
lines.append("/*")
lines.append(" * model_data.h  --  Auto-generated by scripts/ml/train_esp32_model.py")
lines.append(" * DO NOT EDIT MANUALLY.")
lines.append(" *")
lines.append(f" * Architecture : MobileNetV1 alpha=0.25  {IMG_SIZE}x{IMG_SIZE} RGB  INT8")
lines.append(f" * Classes      : 0=PET_BOTTLE  1=ALUMINUM_CAN")
lines.append(f" * Val accuracy : {round(val_acc*100,1)}%  (internet images -- NOT kiosk captures)")
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

HEADER_PATH.parent.mkdir(parents=True, exist_ok=True)
HEADER_PATH.write_text("\n".join(lines), encoding="utf-8")
print(f"  Written {HEADER_PATH.stat().st_size} bytes")

# ── Metadata JSON ────────────────────────────────────────────────────────────
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
    "tflite_size_bytes": sz,
    "total_parameters": total_params,
    "architecture": f"MobileNetV1-alpha0.25-{IMG_SIZE}x{IMG_SIZE}-INT8",
    "train_images": len(X_train),
    "val_images": len(y_val),
    "note": "TRAINED ON INTERNET IMAGES. Must be validated on real kiosk captures before production.",
}
META_PATH.write_text(json.dumps(meta, indent=2))
print(f"Metadata: {META_PATH}")

print("")
print("=" * 60)
print("  ESP32 model pipeline complete!")
print(f"  TFLite INT8  : {round(sz/1024,1)} KB")
print(f"  Val accuracy : {round(val_acc*100,1)}%  (internet images -- unvalidated on kiosk)")
print("=" * 60)
