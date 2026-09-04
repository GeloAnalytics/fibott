"""
retrain_esp32_model_v3.py
Retrain on the FULL dataset now that real ESP32-captured photos have been
added on top of the original 96 internet photos: 124 images total
(78 PET_BOTTLE, 46 ALUMINUM_CAN), of which 28 (13 PET / 15 CAN) are real
captures from the actual kiosk camera -- dark, close-up, QVGA, ~7-11KB JPEGs,
as opposed to the ~70-500KB internet product photos.

What's new vs v2 (which only balanced PET vs CAN):
  - SOURCE-aware augmentation. Real photos are the domain-matched ones (they
    look like what the ESP32 actually sees) but are a small minority (28/124,
    ~23%). Splitting each class into (internet, real) subgroups and boosting
    the real subgroup's augmentation multiplier -- sqrt-scaled, not full
    linear, learned from the class-balance over/under-correction earlier
    this session -- gives real photos more per-image weight in what the
    model actually trains on, without letting 13-15 unique real images
    swamp the set through pure duplication.
  - Source is detected by file size: real ESP32 JPEGs are a clean 6-11KB,
    internet photos are 70KB+. No overlap, no fragile filename parsing.
  - Everything else (stratified 5-fold CV for the honest estimate, stratified
    split, class-balanced counts via BASE_AUG_MULT, sqrt-scaled class_weight,
    +rotation/zoom/translation) is unchanged from v2.
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

IMG_SIZE      = 96
BATCH_SIZE    = 16
EPOCHS_P1     = 40
EPOCHS_P2     = 80
PATIENCE      = 15
CV_EPOCHS_P1  = 25
CV_EPOCHS_P2  = 40
CV_PATIENCE   = 8
SEED          = 42
CLASSES       = ["PET_BOTTLE", "ALUMINUM_CAN"]
N_FOLDS       = 5
BASE_AUG_MULT = 5
REAL_PHOTO_MAX_BYTES = 50_000  # real ESP32 JPEGs are 6-11KB; internet photos are 70KB+

print("Loading TensorFlow ...")
import tensorflow as tf
from sklearn.model_selection import StratifiedKFold, train_test_split
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
    if not d.exists():
        print(f"  WARN: {d} missing -- skipping {cls}")
        continue
    imgs, lbls, sources = load_class(d, idx)
    n_real = sum(1 for s in sources if s == "real")
    print(f"  {cls}: {len(imgs)} images (label={idx}) -- {n_real} real, {len(imgs)-n_real} internet")
    all_X.extend(imgs); all_y.extend(lbls); all_src.extend(sources)

X = np.array(all_X, dtype=np.uint8)
y = np.array(all_y, dtype=np.int32)
src = np.array(all_src)
print(f"Total: {len(X)} images  ({CLASSES[0]}={int((y==0).sum())}  {CLASSES[1]}={int((y==1).sum())})  "
      f"real={int((src=='real').sum())}  internet={int((src=='internet').sum())}")

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

def make_balanced_train_ds(X_np, y_np, src_np, verbose=True):
    """Two-level balancing:
    1. Per-class count balance (as v2): each class's augmented total matches
       the majority class's, via a full-ratio multiplier -- this worked fine
       last time without over-correcting (that problem was class_weight
       stacking on top, not the augmentation-count balance itself).
    2. Per-(class, source) balance WITHIN each class: the real-photo subgroup
       gets a sqrt-scaled multiplier boost relative to the internet subgroup,
       so real (domain-matched) images carry more weight per-image without
       fully dominating through duplication.
    """
    class_counts = {c: int((y_np == c).sum()) for c in range(len(CLASSES))}
    max_class = max(class_counts.values())
    parts, total = [], 0
    for c in range(len(CLASSES)):
        cmask = y_np == c
        class_target = BASE_AUG_MULT * (max_class / class_counts[c])  # full ratio, class-level

        real_mask = cmask & (src_np == "real")
        int_mask  = cmask & (src_np == "internet")
        n_real, n_int = int(real_mask.sum()), int(int_mask.sum())

        # Split class_target between the two source subgroups, sqrt-boosting
        # the smaller (real) one relative to its raw share -- moderate, not
        # full linear, correction.
        if n_real > 0 and n_int > 0:
            real_boost = (n_int / n_real) ** 0.5
        else:
            real_boost = 1.0

        for mask, n, is_real in [(int_mask, n_int, False), (real_mask, n_real, True)]:
            if n == 0:
                continue
            mult = class_target * (real_boost if is_real else 1.0)
            mult = max(1, round(mult))
            Xg, yg = X_np[mask], y_np[mask]
            parts.append((_augmented_group_ds(Xg, yg, mult), n * mult))
            total += n * mult
            if verbose:
                print(f"    {CLASSES[c]}/{'real' if is_real else 'internet'}: "
                      f"{n} real -> x{mult} -> {n*mult} effective")

    ds = parts[0][0]
    for p, _ in parts[1:]:
        ds = ds.concatenate(p)
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
    return tf.keras.Model(inp, out, name="fibott_esp32"), base


def train_one(X_train, y_train, src_train, X_val, y_val, epochs_p1, epochs_p2, patience, verbose=0):
    model, base = build_model()
    counts = {i: int((y_train == i).sum()) for i in range(len(CLASSES))}
    max_c = max(counts.values())
    class_weight = {i: float(np.sqrt(max_c / max(counts.get(i, 1), 1))) for i in range(len(CLASSES))}

    train_ds = make_balanced_train_ds(X_train, y_train, src_train, verbose=(verbose > 0))
    val_ds = make_val_ds(X_val, y_val)

    model.compile(optimizer=tf.keras.optimizers.Adam(1e-3), loss="categorical_crossentropy", metrics=["accuracy"])
    cbs = [
        tf.keras.callbacks.EarlyStopping("val_accuracy", patience=patience, restore_best_weights=True, verbose=verbose),
        tf.keras.callbacks.ReduceLROnPlateau("val_loss", factor=0.5, patience=5, min_lr=1e-7, verbose=verbose),
    ]
    model.fit(train_ds, validation_data=val_ds, epochs=epochs_p1, class_weight=class_weight, callbacks=cbs, verbose=verbose)

    base.trainable = True
    for layer in base.layers[:-15]:
        layer.trainable = False
    model.compile(optimizer=tf.keras.optimizers.Adam(3e-5), loss="categorical_crossentropy", metrics=["accuracy"])
    cbs2 = [
        tf.keras.callbacks.EarlyStopping("val_accuracy", patience=patience, restore_best_weights=True, verbose=verbose),
        tf.keras.callbacks.ReduceLROnPlateau("val_loss", factor=0.5, patience=5, min_lr=1e-7, verbose=verbose),
    ]
    model.fit(train_ds, validation_data=val_ds, epochs=epochs_p2, class_weight=class_weight, callbacks=cbs2, verbose=verbose)

    val_loss, val_acc = model.evaluate(val_ds, verbose=0)

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
print(f"\n{'='*70}\nPASS 1: Stratified {N_FOLDS}-fold CV on the FULL 124-image dataset "
      f"(96 internet + 28 real)\n{'='*70}")
skf = StratifiedKFold(n_splits=N_FOLDS, shuffle=True, random_state=SEED)
fold_accs, fold_per_class = [], []
for fold_i, (train_idx, val_idx) in enumerate(skf.split(X, y), start=1):
    print(f"\n--- Fold {fold_i}/{N_FOLDS} (train={len(train_idx)}, val={len(val_idx)}) ---")
    Xt, yt, st = X[train_idx], y[train_idx], src[train_idx]
    Xv, yv = X[val_idx], y[val_idx]
    t0 = time.time()
    _, val_acc, val_loss, per_class = train_one(Xt, yt, st, Xv, yv, CV_EPOCHS_P1, CV_EPOCHS_P2, CV_PATIENCE, verbose=0)
    dt = time.time() - t0
    print(f"  fold {fold_i}: val_acc={round(val_acc,4)} val_loss={round(val_loss,4)} ({dt:.0f}s)  "
          f"per-class recall: { {k: v['recall'] for k, v in per_class.items()} }")
    fold_accs.append(val_acc)
    fold_per_class.append(per_class)

cv_mean = float(np.mean(fold_accs))
cv_std = float(np.std(fold_accs))
can_recalls = [fp["ALUMINUM_CAN"]["recall"] for fp in fold_per_class if fp["ALUMINUM_CAN"]["recall"] is not None]
pet_recalls = [fp["PET_BOTTLE"]["recall"] for fp in fold_per_class if fp["PET_BOTTLE"]["recall"] is not None]
cv_can_recall_mean = float(np.mean(can_recalls)) if can_recalls else None
cv_pet_recall_mean = float(np.mean(pet_recalls)) if pet_recalls else None

print(f"\n{'='*70}")
print(f"5-FOLD CV RESULT: accuracy = {cv_mean*100:.1f}% +/- {cv_std*100:.1f}%")
print(f"  PET_BOTTLE recall (mean)  : {cv_pet_recall_mean*100:.1f}%" if cv_pet_recall_mean is not None else "  n/a")
print(f"  ALUMINUM_CAN recall (mean): {cv_can_recall_mean*100:.1f}%" if cv_can_recall_mean is not None else "  n/a")
print(f"{'='*70}")

with open(ROOT / "logs" / "cv_v3_result.json", "w") as f:
    json.dump({
        "cv_mean": cv_mean, "cv_std": cv_std,
        "fold_accs": fold_accs,
        "cv_pet_recall_mean": cv_pet_recall_mean,
        "cv_can_recall_mean": cv_can_recall_mean,
    }, f, indent=2)

print(f"\nTotal time: {(time.time()-t_start)/60:.1f} min")
