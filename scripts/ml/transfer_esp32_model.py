"""Fine-tune Fibott's two-class ESP32 model with local kiosk captures.

The script deliberately trains only PET_BOTTLE and ALUMINUM_CAN.  It retains
the original ``ml-data`` images, adds real ESP32-CAM captures from ``Dataset``,
and evaluates on complete, unseen physical-item groups.  That prevents a run
of near-identical frames of the same Coke bottle appearing in both training
and validation.

By default artifacts go under ``models/esp32/candidates/transfer-v4``.  Pass
``--promote`` only after the grouped evaluation passes; promotion updates the
Keras model, TFLite model, metadata, and ESP32 header together.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import shutil
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image

import tensorflow as tf


ROOT = Path(__file__).resolve().parents[2]
LEGACY_ROOT = ROOT / "ml-data"
KIOSK_ROOT = ROOT / "Dataset"
MODEL_ROOT = ROOT / "models" / "esp32"
BASE_MODEL = MODEL_ROOT / "fibott_classifier.keras"
CANDIDATE_ROOT = MODEL_ROOT / "candidates" / "transfer-v4"
FIRMWARE_HEADER = ROOT / "firmware" / "esp32-cam-vision" / "model_data.h"

IMAGE_SIZE = 96
CLASSES = ("PET_BOTTLE", "ALUMINUM_CAN")
LABEL_INDEX = {label: index for index, label in enumerate(CLASSES)}
SEED = 42
BATCH_SIZE = 16


@dataclass(frozen=True)
class Sample:
    path: Path
    label: int
    source: str
    group: str


def patch_legacy_keras_compatibility() -> None:
    """Make the local TensorFlow 2.17 runtime read the legacy Keras artifact.

    The September model was written by an older Keras release which serialized
    three now-removed no-op configuration values.  They do not change the
    weights or forward pass, so ignoring them is safe and allows transfer
    learning from the original learned weights.
    """

    import keras.src.initializers as initializers
    import keras.src.layers.core.dense as dense
    import keras.src.layers.normalization.batch_normalization as batch_norm

    glorot_init = initializers.GlorotUniform.__init__
    initializers.GlorotUniform.__init__ = (
        lambda self, seed=None, input_axes=None, output_axes=None, **kwargs: glorot_init(self, seed=seed)
    )

    batch_norm_init = batch_norm.BatchNormalization.__init__
    batch_norm.BatchNormalization.__init__ = (
        lambda self, *args, renorm=None, renorm_clipping=None, renorm_momentum=None, **kwargs:
        batch_norm_init(self, *args, **kwargs)
    )

    dense_init = dense.Dense.__init__
    dense.Dense.__init__ = (
        lambda self, *args, quantization_config=None, **kwargs: dense_init(self, *args, **kwargs)
    )


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as image_file:
        for block in iter(lambda: image_file.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def image_files(path: Path) -> list[Path]:
    return sorted(
        file for file in path.rglob("*") if file.is_file() and file.suffix.lower() in {".jpg", ".jpeg", ".png"}
    )


def collect_samples() -> tuple[list[Sample], int]:
    if not LEGACY_ROOT.is_dir() or not KIOSK_ROOT.is_dir():
        raise FileNotFoundError("Expected both ml-data/ and Dataset/ in the repository root.")

    samples: list[Sample] = []
    seen: set[str] = set()
    skipped_duplicates = 0

    # New kiosk frames come first so a duplicate is represented by the capture
    # provenance and product group, rather than as an unrelated legacy image.
    kiosk_labels = {"plasticbottle": "PET_BOTTLE", "Sodacans": "ALUMINUM_CAN"}
    for folder, label_name in kiosk_labels.items():
        class_dir = KIOSK_ROOT / folder
        for file in image_files(class_dir):
            content_hash = sha256(file)
            if content_hash in seen:
                skipped_duplicates += 1
                continue
            seen.add(content_hash)
            product = file.parent.name
            samples.append(Sample(file, LABEL_INDEX[label_name], "kiosk", f"kiosk/{label_name}/{product}"))

    for label_name in CLASSES:
        for file in image_files(LEGACY_ROOT / label_name):
            content_hash = sha256(file)
            if content_hash in seen:
                skipped_duplicates += 1
                continue
            seen.add(content_hash)
            # The old imported data has no dependable physical-item grouping.
            samples.append(Sample(file, LABEL_INDEX[label_name], "legacy", f"legacy/{label_name}/{file.stem}"))

    if {sample.label for sample in samples} != {0, 1}:
        raise RuntimeError("Both bottle and can images are required.")
    return samples, skipped_duplicates


def load_images(samples: list[Sample]) -> tuple[np.ndarray, np.ndarray]:
    images: list[np.ndarray] = []
    labels: list[int] = []
    for sample in samples:
        try:
            with Image.open(sample.path) as image:
                resized = image.convert("RGB").resize((IMAGE_SIZE, IMAGE_SIZE), Image.Resampling.LANCZOS)
                images.append(np.asarray(resized, dtype=np.uint8))
                labels.append(sample.label)
        except Exception as error:  # pragma: no cover - diagnostic path
            raise RuntimeError(f"Could not read {sample.path}: {error}") from error
    return np.asarray(images, dtype=np.uint8), np.asarray(labels, dtype=np.int32)


def choose_kiosk_holdout(samples: list[Sample]) -> set[str]:
    rng = random.Random(SEED)
    held_out: set[str] = set()
    for class_index in range(len(CLASSES)):
        groups = sorted({sample.group for sample in samples if sample.label == class_index and sample.source == "kiosk"})
        if len(groups) < 2:
            raise RuntimeError(f"Need at least two kiosk product groups for {CLASSES[class_index]}.")
        group_count = max(1, round(len(groups) * 0.25))
        held_out.update(rng.sample(groups, group_count))
    return held_out


def datasets(train_x: np.ndarray, train_y: np.ndarray, valid_x: np.ndarray, valid_y: np.ndarray):
    augmenter = tf.keras.Sequential(
        [
            tf.keras.layers.RandomFlip("horizontal", seed=SEED),
            tf.keras.layers.RandomRotation(0.06, fill_mode="reflect", seed=SEED),
            tf.keras.layers.RandomZoom(0.12, fill_mode="reflect", seed=SEED),
            tf.keras.layers.RandomTranslation(0.08, 0.08, fill_mode="reflect", seed=SEED),
            tf.keras.layers.RandomBrightness(0.12, value_range=(0, 255), seed=SEED),
            tf.keras.layers.RandomContrast(0.12, seed=SEED),
        ],
        name="kiosk_augmentation",
    )

    def preprocess(image, label, training: bool):
        image = tf.cast(image, tf.float32)
        if training:
            image = augmenter(image, training=True)
        return tf.keras.applications.mobilenet.preprocess_input(image), tf.one_hot(label, len(CLASSES))

    train = tf.data.Dataset.from_tensor_slices((train_x, train_y))
    train = train.shuffle(len(train_x), seed=SEED, reshuffle_each_iteration=True)
    train = train.map(lambda image, label: preprocess(image, label, True), num_parallel_calls=tf.data.AUTOTUNE)
    train = train.batch(BATCH_SIZE).prefetch(tf.data.AUTOTUNE)

    valid = tf.data.Dataset.from_tensor_slices((valid_x, valid_y))
    valid = valid.map(lambda image, label: preprocess(image, label, False), num_parallel_calls=tf.data.AUTOTUNE)
    return train, valid.batch(BATCH_SIZE).prefetch(tf.data.AUTOTUNE)


def evaluate_tflite(model_path: Path, images: np.ndarray, labels: np.ndarray) -> dict:
    interpreter = tf.lite.Interpreter(model_path=str(model_path))
    interpreter.allocate_tensors()
    input_detail = interpreter.get_input_details()[0]
    output_detail = interpreter.get_output_details()[0]
    input_scale, input_zero_point = input_detail["quantization"]
    output_scale, output_zero_point = output_detail["quantization"]

    predictions: list[int] = []
    for image in images:
        preprocessed = tf.keras.applications.mobilenet.preprocess_input(image.astype(np.float32))
        quantized = np.round(preprocessed / input_scale + input_zero_point).clip(-128, 127).astype(np.int8)
        interpreter.set_tensor(input_detail["index"], quantized[np.newaxis, ...])
        interpreter.invoke()
        output = interpreter.get_tensor(output_detail["index"])[0].astype(np.float32)
        probabilities = (output - output_zero_point) * output_scale
        predictions.append(int(np.argmax(probabilities)))

    predictions_array = np.asarray(predictions)
    per_class = {
        label: round(float(np.mean(predictions_array[labels == index] == index)), 4)
        for index, label in enumerate(CLASSES)
    }
    return {"accuracy": round(float(np.mean(predictions_array == labels)), 4), "per_class_recall": per_class}


def make_header(model_bytes: bytes, input_detail: dict, output_detail: dict, metadata: dict) -> str:
    input_scale, input_zero_point = input_detail["quantization"]
    output_scale, output_zero_point = output_detail["quantization"]
    lines = [
        "/*",
        " * model_data.h -- generated by scripts/ml/transfer_esp32_model.py",
        " * Two-class transfer-learning model: 0=PET_BOTTLE, 1=ALUMINUM_CAN.",
        f" * Training images: {metadata['total_images']} ({metadata['legacy_images']} legacy + {metadata['kiosk_images']} kiosk).",
        " * Grouped kiosk holdout metrics are stored in the adjacent model_meta.json.",
        " */",
        "#pragma once",
        "#include <stdint.h>",
        "",
        f"#define MODEL_INPUT_SIZE          {IMAGE_SIZE}",
        "#define MODEL_INPUT_CHANNELS      3",
        "#define MODEL_NUM_CLASSES         2",
        "#define MODEL_CLASS_PET_BOTTLE    0",
        "#define MODEL_CLASS_ALUMINUM_CAN  1",
        "",
        f"#define MODEL_INPUT_SCALE         {input_scale}f",
        f"#define MODEL_INPUT_ZERO_POINT    {int(input_zero_point)}",
        f"#define MODEL_OUTPUT_SCALE        {output_scale}f",
        f"#define MODEL_OUTPUT_ZERO_POINT   {int(output_zero_point)}",
        "#define MODEL_TENSOR_ARENA_SIZE   (300 * 1024)",
        "",
        f"const unsigned int g_model_data_len = {len(model_bytes)}U;",
        "alignas(8) const unsigned char g_model_data[] = {",
    ]
    for offset in range(0, len(model_bytes), 16):
        chunk = model_bytes[offset : offset + 16]
        suffix = "," if offset + 16 < len(model_bytes) else ""
        lines.append("  " + ", ".join(f"0x{byte:02x}" for byte in chunk) + suffix)
    return "\n".join(lines + ["};", ""])


def convert_and_write(model: tf.keras.Model, output_dir: Path, metadata: dict) -> tuple[Path, Path, dict, bytes]:
    output_dir.mkdir(parents=True, exist_ok=True)
    keras_path = output_dir / "fibott_classifier.keras"
    tflite_path = output_dir / "fibott_classifier_int8.tflite"
    header_path = output_dir / "model_data.h"
    model.save(keras_path)

    representative = metadata.pop("representative_images")

    def representative_dataset():
        for image in representative:
            preprocessed = tf.keras.applications.mobilenet.preprocess_input(image.astype(np.float32))
            yield [preprocessed[np.newaxis, ...]]

    converter = tf.lite.TFLiteConverter.from_keras_model(model)
    converter.optimizations = [tf.lite.Optimize.DEFAULT]
    converter.representative_dataset = representative_dataset
    converter.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS_INT8]
    converter.inference_input_type = tf.int8
    converter.inference_output_type = tf.int8
    model_bytes = converter.convert()
    tflite_path.write_bytes(model_bytes)

    interpreter = tf.lite.Interpreter(model_content=model_bytes)
    interpreter.allocate_tensors()
    input_detail = interpreter.get_input_details()[0]
    output_detail = interpreter.get_output_details()[0]
    metadata.update(
        {
            "classes": list(CLASSES),
            "architecture": "MobileNetV1-alpha0.25-96x96-INT8",
            "input_quantization": {"scale": input_detail["quantization"][0], "zero_point": int(input_detail["quantization"][1])},
            "output_quantization": {"scale": output_detail["quantization"][0], "zero_point": int(output_detail["quantization"][1])},
            "tflite_size_bytes": len(model_bytes),
        }
    )
    header_path.write_text(make_header(model_bytes, input_detail, output_detail, metadata), encoding="utf-8")
    (output_dir / "model_meta.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    return keras_path, tflite_path, header_path, model_bytes


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--promote", action="store_true", help="replace the currently deployed artifacts after an improved holdout result")
    args = parser.parse_args()

    tf.keras.utils.set_random_seed(SEED)
    np.random.seed(SEED)
    random.seed(SEED)

    samples, skipped_duplicates = collect_samples()
    holdout_groups = choose_kiosk_holdout(samples)
    train_samples = [sample for sample in samples if sample.group not in holdout_groups]
    valid_samples = [sample for sample in samples if sample.group in holdout_groups]
    train_x, train_y = load_images(train_samples)
    valid_x, valid_y = load_images(valid_samples)

    baseline = evaluate_tflite(MODEL_ROOT / "fibott_classifier_int8.tflite", valid_x, valid_y)
    print("Grouped kiosk holdout groups:", sorted(holdout_groups))
    print("September model baseline:", baseline)

    patch_legacy_keras_compatibility()
    model = tf.keras.models.load_model(BASE_MODEL, compile=False)
    backbone = model.get_layer("mobilenet_0.25_224")
    train_ds, valid_ds = datasets(train_x, train_y, valid_x, valid_y)

    backbone.trainable = False
    model.compile(optimizer=tf.keras.optimizers.Adam(1e-4), loss="categorical_crossentropy", metrics=["accuracy"])
    callbacks = [
        tf.keras.callbacks.EarlyStopping(monitor="val_accuracy", patience=8, restore_best_weights=True),
        tf.keras.callbacks.ReduceLROnPlateau(monitor="val_loss", patience=4, factor=0.5, min_lr=1e-6),
    ]
    model.fit(train_ds, validation_data=valid_ds, epochs=30, callbacks=callbacks, verbose=2)

    backbone.trainable = True
    for layer in backbone.layers[:-20]:
        layer.trainable = False
    model.compile(optimizer=tf.keras.optimizers.Adam(1e-5), loss="categorical_crossentropy", metrics=["accuracy"])
    model.fit(train_ds, validation_data=valid_ds, epochs=25, callbacks=callbacks, verbose=2)

    metadata = {
        "transfer_base": str(BASE_MODEL.relative_to(ROOT)),
        "transfer_base_sha256": sha256(BASE_MODEL),
        "total_images": len(samples),
        "legacy_images": sum(sample.source == "legacy" for sample in samples),
        "kiosk_images": sum(sample.source == "kiosk" for sample in samples),
        "class_counts": {label: sum(sample.label == index for sample in samples) for index, label in enumerate(CLASSES)},
        "skipped_exact_duplicates": skipped_duplicates,
        "grouped_kiosk_holdout_groups": sorted(holdout_groups),
        "baseline_grouped_holdout": baseline,
        "representative_images": train_x[: min(len(train_x), 100)],
    }
    _, candidate_tflite, candidate_header, _ = convert_and_write(model, CANDIDATE_ROOT, metadata)
    candidate = evaluate_tflite(candidate_tflite, valid_x, valid_y)
    metadata["candidate_grouped_holdout"] = candidate
    # Update metadata/header now that the measured candidate metric is available.
    (CANDIDATE_ROOT / "model_meta.json").write_text(json.dumps(metadata, indent=2, default=lambda value: value.tolist()), encoding="utf-8")

    improved = candidate["accuracy"] >= baseline["accuracy"] and all(
        candidate["per_class_recall"][label] >= baseline["per_class_recall"][label] for label in CLASSES
    )
    print("Transfer candidate:", candidate)
    print("Promotion eligible:", improved)
    if args.promote:
        if not improved:
            raise SystemExit("Candidate did not improve both class recalls; refusing to replace the deployed model.")
        shutil.copy2(CANDIDATE_ROOT / "fibott_classifier.keras", MODEL_ROOT / "fibott_classifier.keras")
        shutil.copy2(candidate_tflite, MODEL_ROOT / "fibott_classifier_int8.tflite")
        shutil.copy2(CANDIDATE_ROOT / "model_meta.json", MODEL_ROOT / "model_meta.json")
        shutil.copy2(candidate_header, FIRMWARE_HEADER)
        print("Promoted transfer-learning model and firmware header.")


if __name__ == "__main__":
    main()
