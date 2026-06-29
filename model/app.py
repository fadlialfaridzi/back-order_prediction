"""
Flask inference service untuk pipeline Random Forest backorder.

Model yang dimuat adalah sklearn Pipeline lengkap. API menerima fitur mentah:
- numerik dapat berupa angka atau null;
- fitur biner menerima Yes/No, 1/0, true/false;
- sentinel -99 dinormalisasi menjadi missing value;
- preprocessing yang dipelajari saat training diterapkan oleh pipeline.

Menjalankan lokal:
    python app.py

Production example:
    gunicorn -w 1 --threads 4 -b 0.0.0.0:5001 app:app
"""

from __future__ import annotations

import json
import logging
import math
import os
import sys
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from flask import Flask, jsonify, request

try:
    from flask_cors import CORS
except ImportError:  # CORS bersifat opsional
    CORS = None

BASE_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = BASE_DIR / "output"
MODEL_PATH = Path(os.getenv("MODEL_PATH", OUTPUT_DIR / "rf_model.pkl"))
METADATA_PATH = Path(
    os.getenv("MODEL_METADATA_PATH", OUTPUT_DIR / "rf_model_metadata.json")
)

DEFAULT_NUMERIC_FEATURES = [
    "national_inv",
    "lead_time",
    "in_transit_qty",
    "forecast_3_month",
    "forecast_6_month",
    "forecast_9_month",
    "sales_1_month",
    "sales_3_month",
    "sales_6_month",
    "sales_9_month",
    "min_bank",
    "pieces_past_due",
    "perf_6_month_avg",
    "perf_12_month_avg",
    "local_bo_qty",
]
DEFAULT_BINARY_FEATURES = [
    "potential_issue",
    "deck_risk",
    "oe_constraint",
    "ppap_risk",
    "stop_auto_buy",
    "rev_stop",
]
DEFAULT_SENTINELS = {
    "perf_6_month_avg": -99,
    "perf_12_month_avg": -99,
}

MAX_BATCH_SIZE = int(os.getenv("MAX_BATCH_SIZE", "10000"))
MAX_CONTENT_LENGTH_MB = int(os.getenv("MAX_CONTENT_LENGTH_MB", "10"))
PORT = int(os.getenv("PORT", "5001"))
HOST = os.getenv("HOST", "0.0.0.0")

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s | %(levelname)-8s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[logging.StreamHandler(sys.stdout)],
)
LOGGER = logging.getLogger("backorder.api")


class InputValidationError(ValueError):
    pass


def load_artifacts() -> tuple[Any, dict[str, Any]]:
    if not MODEL_PATH.exists():
        raise FileNotFoundError(f"Model tidak ditemukan: {MODEL_PATH}")
    if not METADATA_PATH.exists():
        raise FileNotFoundError(f"Metadata tidak ditemukan: {METADATA_PATH}")

    LOGGER.info("Memuat model: %s", MODEL_PATH)
    model = joblib.load(MODEL_PATH)
    with METADATA_PATH.open("r", encoding="utf-8") as file:
        metadata = json.load(file)

    return model, metadata


MODEL, META = load_artifacts()
FEATURES = META.get("feature_names", DEFAULT_NUMERIC_FEATURES + DEFAULT_BINARY_FEATURES)
NUMERIC_FEATURES = META.get("numeric_features", DEFAULT_NUMERIC_FEATURES)
BINARY_FEATURES = META.get("binary_features", DEFAULT_BINARY_FEATURES)
SENTINEL_VALUES = META.get("sentinel_values", DEFAULT_SENTINELS)
THRESHOLD = float(META.get("optimal_threshold", 0.5))
THRESHOLD_STATUS = META.get("threshold_status", "unknown")
MODEL_VERSION = META.get("trained_at", "unknown")
ID_COLUMN = META.get("id_column", "sku")

if not 0 <= THRESHOLD <= 1:
    raise RuntimeError(f"Threshold metadata tidak valid: {THRESHOLD}")


def get_positive_class_index() -> int:
    classifier = (
        MODEL.named_steps.get("classifier")
        if hasattr(MODEL, "named_steps")
        else MODEL
    )
    classes = list(classifier.classes_)
    if 1 not in classes:
        raise RuntimeError(f"Kelas positif 1 tidak ditemukan pada model: {classes}")
    return classes.index(1)


POSITIVE_CLASS_INDEX = get_positive_class_index()


def is_missing_scalar(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str) and value.strip() == "":
        return True
    try:
        result = pd.isna(value)
        return bool(result) if isinstance(result, (bool, np.bool_)) else False
    except Exception:
        return False


def normalize_binary_value(value: Any, column: str, row_index: int) -> Any:
    if is_missing_scalar(value):
        return pd.NA

    if isinstance(value, (bool, np.bool_)):
        return "Yes" if bool(value) else "No"

    if isinstance(value, (int, np.integer)) and value in (0, 1):
        return "Yes" if int(value) == 1 else "No"

    if isinstance(value, (float, np.floating)):
        if not math.isfinite(float(value)):
            raise InputValidationError(
                f"Baris {row_index}, kolom '{column}': nilai tidak boleh infinity."
            )
        if float(value) in (0.0, 1.0):
            return "Yes" if float(value) == 1.0 else "No"

    text = str(value).strip().lower()
    if text in {"yes", "y", "true", "1"}:
        return "Yes"
    if text in {"no", "n", "false", "0"}:
        return "No"

    raise InputValidationError(
        f"Baris {row_index}, kolom '{column}': nilai '{value}' tidak valid; "
        "gunakan Yes/No, true/false, atau 1/0."
    )


def prepare_records(records: list[dict[str, Any]]) -> tuple[pd.DataFrame, list[Any]]:
    if not records:
        raise InputValidationError("Data prediksi kosong.")
    if len(records) > MAX_BATCH_SIZE:
        raise InputValidationError(
            f"Maksimal {MAX_BATCH_SIZE:,} baris per request."
        )

    identifiers: list[Any] = []
    normalized_rows: list[dict[str, Any]] = []

    for index, record in enumerate(records):
        if not isinstance(record, dict):
            raise InputValidationError(f"Elemen data pada indeks {index} harus berupa object JSON.")

        missing_keys = [feature for feature in FEATURES if feature not in record]
        if missing_keys:
            raise InputValidationError(
                f"Baris {index} tidak memiliki fitur wajib: {missing_keys}. "
                "Gunakan null bila nilainya memang tidak tersedia."
            )

        row: dict[str, Any] = {}
        identifiers.append(record.get(ID_COLUMN))

        for column in NUMERIC_FEATURES:
            value = record.get(column)
            if is_missing_scalar(value):
                row[column] = np.nan
                continue

            try:
                numeric = float(value)
            except (TypeError, ValueError) as exc:
                raise InputValidationError(
                    f"Baris {index}, kolom '{column}': '{value}' bukan angka."
                ) from exc

            if not math.isfinite(numeric):
                raise InputValidationError(
                    f"Baris {index}, kolom '{column}': nilai harus finite."
                )

            sentinel = SENTINEL_VALUES.get(column)
            row[column] = np.nan if sentinel is not None and numeric == sentinel else numeric

        for column in BINARY_FEATURES:
            row[column] = normalize_binary_value(record.get(column), column, index)

        normalized_rows.append(row)

    frame = pd.DataFrame(normalized_rows, columns=FEATURES)
    return frame, identifiers


def predict_frame(frame: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    probability = MODEL.predict_proba(frame)[:, POSITIVE_CLASS_INDEX]
    prediction = (probability >= THRESHOLD).astype(np.int8)
    return probability, prediction


# Warm-up dengan schema valid agar latency request pertama lebih stabil.
WARMUP_ROW = {
    **{feature: 0.0 for feature in NUMERIC_FEATURES},
    **{feature: "No" for feature in BINARY_FEATURES},
}
MODEL.predict_proba(pd.DataFrame([WARMUP_ROW], columns=FEATURES))
LOGGER.info(
    "Model siap | fitur=%s | threshold=%.8f | threshold_status=%s",
    len(FEATURES),
    THRESHOLD,
    THRESHOLD_STATUS,
)

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_LENGTH_MB * 1024 * 1024

cors_origins = os.getenv("CORS_ORIGINS")
if cors_origins:
    if CORS is None:
        LOGGER.warning("CORS_ORIGINS diatur tetapi flask-cors belum terpasang.")
    else:
        origins = [origin.strip() for origin in cors_origins.split(",") if origin.strip()]
        CORS(app, resources={r"/*": {"origins": origins}})
        LOGGER.info("CORS aktif untuk: %s", origins)


@app.errorhandler(413)
def payload_too_large(_: Exception):
    return jsonify({
        "error": "payload_too_large",
        "message": f"Ukuran request maksimal {MAX_CONTENT_LENGTH_MB} MB.",
    }), 413


@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "model_loaded": True,
        "model_version": MODEL_VERSION,
        "threshold": THRESHOLD,
        "threshold_status": THRESHOLD_STATUS,
    })


@app.route("/model/info", methods=["GET"])
def model_info():
    return jsonify({
        "model_type": META.get("model_type"),
        "trained_at": META.get("trained_at"),
        "feature_names": FEATURES,
        "numeric_features": NUMERIC_FEATURES,
        "binary_features": BINARY_FEATURES,
        "optimal_threshold": THRESHOLD,
        "threshold_status": THRESHOLD_STATUS,
        "validation_metrics_before_threshold_tuning": META.get(
            "validation_metrics_before_threshold_tuning"
        ),
        "threshold_tuning": META.get("threshold_tuning"),
        "library_versions": META.get("library_versions"),
    })


@app.route("/predict", methods=["POST"])
def predict_single():
    if not request.is_json:
        return jsonify({
            "error": "unsupported_media_type",
            "message": "Gunakan Content-Type: application/json.",
        }), 415

    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({
            "error": "invalid_json",
            "message": "Body harus berupa satu object JSON.",
        }), 400

    try:
        frame, identifiers = prepare_records([payload])
        probability, prediction = predict_frame(frame)

        response: dict[str, Any] = {
            "probability_backorder": round(float(probability[0]), 8),
            "prediction": int(prediction[0]),
            "status": "Backorder" if prediction[0] == 1 else "Aman",
            "threshold_used": THRESHOLD,
            "model_version": MODEL_VERSION,
        }
        if identifiers[0] is not None:
            response[ID_COLUMN] = identifiers[0]
        return jsonify(response)

    except InputValidationError as exc:
        return jsonify({"error": "validation_error", "message": str(exc)}), 400
    except Exception:
        LOGGER.exception("Kesalahan internal pada /predict")
        return jsonify({
            "error": "internal_server_error",
            "message": "Prediksi gagal diproses.",
        }), 500


@app.route("/predict/batch", methods=["POST"])
def predict_batch():
    if not request.is_json:
        return jsonify({
            "error": "unsupported_media_type",
            "message": "Gunakan Content-Type: application/json.",
        }), 415

    payload = request.get_json(silent=True)
    if isinstance(payload, list):
        records = payload
    elif isinstance(payload, dict):
        records = payload.get("data")
    else:
        records = None

    if not isinstance(records, list):
        return jsonify({
            "error": "invalid_json",
            "message": "Body harus berupa list atau object {'data': [...] }.",
        }), 400

    try:
        frame, identifiers = prepare_records(records)
        probability, prediction = predict_frame(frame)

        results: list[dict[str, Any]] = []
        for index, (prob, pred) in enumerate(zip(probability, prediction)):
            row: dict[str, Any] = {
                "index": index,
                "probability_backorder": round(float(prob), 8),
                "prediction": int(pred),
                "status": "Backorder" if pred == 1 else "Aman",
            }
            if identifiers[index] is not None:
                row[ID_COLUMN] = identifiers[index]
            results.append(row)

        backorder_count = int(prediction.sum())
        total = len(results)
        return jsonify({
            "results": results,
            "summary": {
                "total": total,
                "backorder": backorder_count,
                "aman": total - backorder_count,
                "backorder_percentage": round(100 * backorder_count / total, 4),
            },
            "threshold_used": THRESHOLD,
            "model_version": MODEL_VERSION,
        })

    except InputValidationError as exc:
        return jsonify({"error": "validation_error", "message": str(exc)}), 400
    except Exception:
        LOGGER.exception("Kesalahan internal pada /predict/batch")
        return jsonify({
            "error": "internal_server_error",
            "message": "Prediksi batch gagal diproses.",
        }), 500


if __name__ == "__main__":
    app.run(host=HOST, port=PORT, debug=False, threaded=True)
