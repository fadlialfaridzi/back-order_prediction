"""
Flask Sidecar — ML Inference Service
=====================================
Memuat rf_model.pkl sekali saat startup dan melayani prediksi
backorder melalui REST API.

Penggunaan:
    python app.py
    # atau production:
    gunicorn -w 2 -b 0.0.0.0:5001 app:app

Endpoints:
    POST /predict       — prediksi 1 item
    POST /predict/batch — prediksi banyak item sekaligus
    GET  /model/info    — metadata model (fitur, threshold, metrik)
    GET  /health        — health check
"""

import json
import logging
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from flask import Flask, jsonify, request
from flask_cors import CORS

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

BASE_DIR      = Path(__file__).resolve().parent
OUTPUT_DIR    = BASE_DIR / "output"
MODEL_PATH    = OUTPUT_DIR / "rf_model.pkl"
METADATA_PATH = OUTPUT_DIR / "rf_model_metadata.json"

# ---------------------------------------------------------------------------
# Load model & metadata SEKALI saat startup
# ---------------------------------------------------------------------------

logger.info("Memuat model dari: %s", MODEL_PATH)
MODEL = joblib.load(MODEL_PATH)
logger.info("Model berhasil dimuat (%s).", type(MODEL).__name__)

with open(METADATA_PATH, "r", encoding="utf-8") as f:
    META = json.load(f)

FEATURES  = META["feature_names"]
THRESHOLD = META.get("optimal_threshold", 0.5)
logger.info("Fitur: %d | Threshold: %.2f", len(FEATURES), THRESHOLD)

# Warm-up: satu prediksi dummy agar tree ter-cache di RAM
_dummy = pd.DataFrame([{f: 0 for f in FEATURES}])
MODEL.predict_proba(_dummy)
logger.info("Warm-up selesai.")

# ---------------------------------------------------------------------------
# Flask App
# ---------------------------------------------------------------------------

app = Flask(__name__)
CORS(app)


@app.route("/health", methods=["GET"])
def health():
    """Health check sederhana."""
    return jsonify({"status": "ok", "model_loaded": True, "threshold": THRESHOLD})


@app.route("/predict", methods=["POST"])
def predict_single():
    """
    Prediksi backorder untuk 1 item.

    Request body (JSON):
        { "national_inv": 100, "lead_time": 8, ... }  (21 fitur)

    Response:
        { "probability": 0.3721, "prediction": 1, "status": "Backorder",
          "threshold_used": 0.15 }
    """
    try:
        data = request.get_json(force=True)
        if not data:
            return jsonify({"error": "Request body kosong."}), 400

        # Validasi kelengkapan fitur
        missing = [f for f in FEATURES if f not in data]
        if missing:
            return jsonify({
                "error": f"Fitur tidak lengkap: {missing}",
                "required_features": FEATURES,
            }), 400

        # Buat DataFrame 1 baris dengan urutan kolom yang benar
        row = {f: float(data[f]) for f in FEATURES}
        df  = pd.DataFrame([row])

        proba = float(MODEL.predict_proba(df)[0, 1])
        pred  = int(proba >= THRESHOLD)

        return jsonify({
            "probability": round(proba, 4),
            "prediction": pred,
            "status": "Backorder" if pred == 1 else "Aman",
            "threshold_used": THRESHOLD,
        })

    except (ValueError, TypeError) as e:
        return jsonify({"error": f"Data tidak valid: {str(e)}"}), 400
    except Exception as e:
        logger.exception("Error pada /predict")
        return jsonify({"error": f"Internal server error: {str(e)}"}), 500


@app.route("/predict/batch", methods=["POST"])
def predict_batch():
    """
    Prediksi backorder untuk banyak item sekaligus.

    Request body (JSON):
        { "data": [ {fitur1: val, ...}, {fitur1: val, ...}, ... ] }

    Response:
        { "results": [...], "summary": {...}, "threshold_used": 0.15 }
    """
    try:
        body = request.get_json(force=True)
        records = body.get("data", [])

        if not records:
            return jsonify({"error": "Field 'data' kosong atau tidak ada."}), 400

        if len(records) > 10000:
            return jsonify({"error": "Maksimal 10.000 baris per batch."}), 400

        df = pd.DataFrame(records)

        # Validasi fitur
        missing = [f for f in FEATURES if f not in df.columns]
        if missing:
            return jsonify({
                "error": f"Fitur tidak lengkap: {missing}",
                "required_features": FEATURES,
            }), 400

        df = df[FEATURES].astype(float)
        probas = MODEL.predict_proba(df)[:, 1]
        preds  = (probas >= THRESHOLD).astype(int)

        results = []
        for i in range(len(df)):
            results.append({
                "index": i,
                "probability": round(float(probas[i]), 4),
                "prediction": int(preds[i]),
                "status": "Backorder" if preds[i] == 1 else "Aman",
            })

        n_backorder = int(preds.sum())
        summary = {
            "total": len(results),
            "backorder": n_backorder,
            "aman": len(results) - n_backorder,
            "backorder_pct": round(100 * n_backorder / len(results), 2),
        }

        return jsonify({
            "results": results,
            "summary": summary,
            "threshold_used": THRESHOLD,
        })

    except (ValueError, TypeError) as e:
        return jsonify({"error": f"Data tidak valid: {str(e)}"}), 400
    except Exception as e:
        logger.exception("Error pada /predict/batch")
        return jsonify({"error": f"Internal server error: {str(e)}"}), 500


@app.route("/model/info", methods=["GET"])
def model_info():
    """Kembalikan metadata model (fitur, threshold, metrik training)."""
    return jsonify(META)


# ---------------------------------------------------------------------------
# Entry Point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=False)
