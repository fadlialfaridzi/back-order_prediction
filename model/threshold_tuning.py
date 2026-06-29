"""
Threshold tuning untuk pipeline Random Forest backorder.

Script ini memilih threshold hanya dari validation_data.csv.gz yang dibuat
oleh train.py. Testing_BOP.csv bersifat opsional dan hanya dipakai untuk
satu kali evaluasi final setelah threshold sudah dipilih.

Contoh:
    python threshold_tuning.py
    python threshold_tuning.py --strategy max_f1
    python threshold_tuning.py --strategy fbeta --beta 2
    python threshold_tuning.py --strategy target_recall --target-recall 0.70
    python threshold_tuning.py --strategy min_cost --cost-fn 20 --cost-fp 1
    python threshold_tuning.py --test Testing_BOP.csv
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    classification_report,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_OUTPUT_DIR = BASE_DIR / "output"
DEFAULT_MODEL_PATH = DEFAULT_OUTPUT_DIR / "rf_model.pkl"
DEFAULT_METADATA_PATH = DEFAULT_OUTPUT_DIR / "rf_model_metadata.json"
DEFAULT_VALIDATION_PATH = DEFAULT_OUTPUT_DIR / "validation_data.csv.gz"

TARGET_COLUMN = "went_on_backorder"
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

LOGGER = logging.getLogger("backorder.threshold")


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def resolve_path(value: str | Path) -> Path:
    path = Path(value)
    return path if path.is_absolute() else (BASE_DIR / path).resolve()


def setup_logging(output_dir: Path, level: str = "INFO") -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    log_path = output_dir / f"threshold_tuning_{datetime.now():%Y%m%d_%H%M%S}.log"

    root = logging.getLogger()
    root.handlers.clear()
    root.setLevel(getattr(logging, level.upper(), logging.INFO))

    formatter = logging.Formatter(
        "%(asctime)s | %(levelname)-8s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    stream = logging.StreamHandler(sys.stdout)
    stream.setFormatter(formatter)
    file_handler = logging.FileHandler(log_path, encoding="utf-8")
    file_handler.setFormatter(formatter)
    root.addHandler(stream)
    root.addHandler(file_handler)


def json_default(value: Any) -> Any:
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        return float(value)
    if isinstance(value, (np.bool_,)):
        return bool(value)
    if isinstance(value, Path):
        return str(value)
    raise TypeError(f"Tipe tidak dapat diserialisasi: {type(value)!r}")


def read_table(path: Path) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(f"File tidak ditemukan: {path}")
    suffixes = [suffix.lower() for suffix in path.suffixes]
    if path.suffix.lower() in {".xlsx", ".xls", ".xlsm"}:
        return pd.read_excel(path)
    compression = "gzip" if suffixes[-2:] == [".csv", ".gz"] else "infer"
    return pd.read_csv(path, low_memory=False, compression=compression)


def normalize_target(series: pd.Series) -> pd.Series:
    result = pd.Series(pd.NA, index=series.index, dtype="Int64")
    numeric = pd.to_numeric(series, errors="coerce")
    result.loc[numeric.eq(0)] = 0
    result.loc[numeric.eq(1)] = 1

    text = series.astype("string").str.strip().str.lower()
    result.loc[text.isin({"yes", "y", "true", "backorder", "1"})] = 1
    result.loc[text.isin({"no", "n", "false", "aman", "0"})] = 0
    return result


def normalize_binary_series(series: pd.Series, column: str) -> pd.Series:
    output = pd.Series(pd.NA, index=series.index, dtype="string")
    numeric = pd.to_numeric(series, errors="coerce")
    output.loc[numeric.eq(0)] = "No"
    output.loc[numeric.eq(1)] = "Yes"

    text = series.astype("string").str.strip().str.lower()
    output.loc[text.isin({"yes", "y", "true", "1"})] = "Yes"
    output.loc[text.isin({"no", "n", "false", "0"})] = "No"

    original_non_missing = series.notna() & series.astype("string").str.strip().ne("")
    invalid = original_non_missing & output.isna()
    if invalid.any():
        examples = series.loc[invalid].astype(str).value_counts().head(5).to_dict()
        raise ValueError(f"Nilai tidak valid pada '{column}': {examples}")
    return output


def prepare_labeled_data(
    df: pd.DataFrame,
    *,
    feature_names: list[str],
    numeric_features: list[str],
    binary_features: list[str],
    sentinel_values: dict[str, float],
) -> tuple[pd.DataFrame, pd.Series]:
    required = set(feature_names + [TARGET_COLUMN])
    missing = sorted(required - set(df.columns))
    if missing:
        raise ValueError(f"Kolom wajib tidak ditemukan: {missing}")

    y = normalize_target(df[TARGET_COLUMN])
    valid = y.notna()
    if not valid.all():
        LOGGER.warning("%s baris target tidak valid dibuang.", f"{int((~valid).sum()):,}")

    X = df.loc[valid, feature_names].copy().reset_index(drop=True)
    y = y.loc[valid].astype("int8").reset_index(drop=True)

    if y.nunique() != 2:
        raise ValueError("Data evaluasi harus memiliki dua kelas target.")

    for column in numeric_features:
        raw = X[column]
        cleaned = raw.replace(r"^\s*$", np.nan, regex=True)
        converted = pd.to_numeric(cleaned, errors="coerce")
        invalid = cleaned.notna() & converted.isna()
        if invalid.any():
            examples = raw.loc[invalid].astype(str).value_counts().head(5).to_dict()
            raise ValueError(f"Nilai numerik tidak valid pada '{column}': {examples}")
        X[column] = converted.astype("float64")

    for column, sentinel in sentinel_values.items():
        if column in X.columns:
            X.loc[X[column].eq(sentinel), column] = np.nan

    for column in binary_features:
        X[column] = normalize_binary_series(X[column], column)

    return X, y


def positive_probability(model: Any, X: pd.DataFrame) -> np.ndarray:
    classifier = (
        model.named_steps.get("classifier")
        if hasattr(model, "named_steps")
        else model
    )
    classes = list(classifier.classes_)
    if 1 not in classes:
        raise RuntimeError(f"Kelas positif 1 tidak ditemukan pada model: {classes}")
    return model.predict_proba(X)[:, classes.index(1)]


def build_exact_threshold_table(
    y_true: np.ndarray,
    probability: np.ndarray,
    beta: float,
    cost_fn: float,
    cost_fp: float,
) -> pd.DataFrame:
    """Hitung confusion counts tepat pada setiap nilai probabilitas unik."""
    if len(y_true) == 0:
        raise ValueError("Data validation kosong.")

    order = np.argsort(-probability, kind="mergesort")
    scores = probability[order]
    labels = y_true[order].astype(np.int8)

    tp_cumulative = np.cumsum(labels == 1)
    fp_cumulative = np.cumsum(labels == 0)
    end_of_group = np.r_[np.flatnonzero(np.diff(scores) != 0), len(scores) - 1]

    threshold = scores[end_of_group]
    tp = tp_cumulative[end_of_group].astype(np.int64)
    fp = fp_cumulative[end_of_group].astype(np.int64)

    positives = int((labels == 1).sum())
    negatives = int((labels == 0).sum())
    fn = positives - tp
    tn = negatives - fp

    precision = np.divide(
        tp,
        tp + fp,
        out=np.zeros_like(tp, dtype=float),
        where=(tp + fp) != 0,
    )
    recall = tp / positives
    f1 = np.divide(
        2 * precision * recall,
        precision + recall,
        out=np.zeros_like(precision),
        where=(precision + recall) != 0,
    )
    beta_sq = beta * beta
    fbeta = np.divide(
        (1 + beta_sq) * precision * recall,
        beta_sq * precision + recall,
        out=np.zeros_like(precision),
        where=(beta_sq * precision + recall) != 0,
    )
    total_cost = cost_fn * fn + cost_fp * fp

    table = pd.DataFrame(
        {
            "threshold": threshold,
            "precision": precision,
            "recall": recall,
            "f1": f1,
            "fbeta": fbeta,
            "tp": tp,
            "fp": fp,
            "fn": fn,
            "tn": tn,
            "total_cost": total_cost,
            "predicted_positive": tp + fp,
        }
    )

    # Tambahkan threshold 1.0 bila ia benar-benar merepresentasikan prediksi kosong.
    if probability.max() < 1.0:
        empty_row = pd.DataFrame(
            [{
                "threshold": 1.0,
                "precision": 0.0,
                "recall": 0.0,
                "f1": 0.0,
                "fbeta": 0.0,
                "tp": 0,
                "fp": 0,
                "fn": positives,
                "tn": negatives,
                "total_cost": cost_fn * positives,
                "predicted_positive": 0,
            }]
        )
        table = pd.concat([empty_row, table], ignore_index=True)

    # Threshold 0.0 merepresentasikan seluruh sampel positif jika skor minimum > 0.
    if probability.min() > 0.0:
        all_row = pd.DataFrame(
            [{
                "threshold": 0.0,
                "precision": positives / len(labels),
                "recall": 1.0,
                "f1": 2 * positives / (len(labels) + positives),
                "fbeta": (1 + beta_sq) * (positives / len(labels)) / (
                    beta_sq * (positives / len(labels)) + 1
                ),
                "tp": positives,
                "fp": negatives,
                "fn": 0,
                "tn": 0,
                "total_cost": cost_fp * negatives,
                "predicted_positive": len(labels),
            }]
        )
        table = pd.concat([table, all_row], ignore_index=True)

    return table.sort_values("threshold", ascending=False).reset_index(drop=True)


def choose_threshold(
    table: pd.DataFrame,
    *,
    strategy: str,
    target_recall: float | None,
    min_precision: float | None,
    manual_threshold: float | None,
) -> tuple[float, pd.Series | None]:
    if manual_threshold is not None:
        return float(manual_threshold), None

    candidates = table.copy()
    if min_precision is not None:
        candidates = candidates[candidates["precision"] >= min_precision]
    if candidates.empty:
        raise ValueError("Tidak ada threshold yang memenuhi --min-precision.")

    if strategy == "max_f1":
        selected = candidates.sort_values(
            ["f1", "recall", "precision", "threshold"],
            ascending=[False, False, False, False],
        ).iloc[0]
    elif strategy == "fbeta":
        selected = candidates.sort_values(
            ["fbeta", "recall", "precision", "threshold"],
            ascending=[False, False, False, False],
        ).iloc[0]
    elif strategy == "target_recall":
        if target_recall is None:
            raise ValueError("--target-recall wajib untuk strategy target_recall.")
        feasible = candidates[candidates["recall"] >= target_recall]
        if feasible.empty:
            best_recall = float(candidates["recall"].max())
            raise ValueError(
                f"Target recall {target_recall:.4f} tidak tercapai. "
                f"Recall maksimum setelah constraint adalah {best_recall:.4f}."
            )
        selected = feasible.sort_values(
            ["precision", "fbeta", "threshold"],
            ascending=[False, False, False],
        ).iloc[0]
    elif strategy == "min_cost":
        selected = candidates.sort_values(
            ["total_cost", "fn", "fp", "threshold"],
            ascending=[True, True, True, False],
        ).iloc[0]
    else:
        raise ValueError(f"Strategy tidak dikenali: {strategy}")

    return float(selected["threshold"]), selected


def evaluate_at_threshold(
    y_true: pd.Series,
    probability: np.ndarray,
    threshold: float,
) -> dict[str, Any]:
    prediction = (probability >= threshold).astype(np.int8)
    cm = confusion_matrix(y_true, prediction, labels=[0, 1])
    tn, fp, fn, tp = (int(v) for v in cm.ravel())

    return {
        "threshold": float(threshold),
        "rows": int(len(y_true)),
        "positive_rate": float(y_true.mean()),
        "average_precision": float(average_precision_score(y_true, probability)),
        "roc_auc": float(roc_auc_score(y_true, probability)),
        "accuracy": float(accuracy_score(y_true, prediction)),
        "precision": float(precision_score(y_true, prediction, zero_division=0)),
        "recall": float(recall_score(y_true, prediction, zero_division=0)),
        "f1": float(f1_score(y_true, prediction, zero_division=0)),
        "confusion_matrix": {"tn": tn, "fp": fp, "fn": fn, "tp": tp},
    }


def log_evaluation(name: str, metrics: dict[str, Any]) -> None:
    cm = metrics["confusion_matrix"]
    LOGGER.info("=" * 72)
    LOGGER.info("EVALUASI %s", name.upper())
    LOGGER.info("=" * 72)
    LOGGER.info("Threshold         : %.8f", metrics["threshold"])
    LOGGER.info("Average Precision : %.6f", metrics["average_precision"])
    LOGGER.info("ROC-AUC           : %.6f", metrics["roc_auc"])
    LOGGER.info("Precision         : %.6f", metrics["precision"])
    LOGGER.info("Recall            : %.6f", metrics["recall"])
    LOGGER.info("F1                : %.6f", metrics["f1"])
    LOGGER.info("Accuracy          : %.6f", metrics["accuracy"])
    LOGGER.info(
        "Confusion matrix  : TN=%s FP=%s FN=%s TP=%s",
        cm["tn"], cm["fp"], cm["fn"], cm["tp"],
    )


def main(args: argparse.Namespace) -> None:
    output_dir = resolve_path(args.output_dir)
    setup_logging(output_dir, args.log_level)

    for name, value in {
        "--manual-threshold": args.manual_threshold,
        "--target-recall": args.target_recall,
        "--min-precision": args.min_precision,
    }.items():
        if value is not None and not 0 <= value <= 1:
            raise ValueError(f"{name} harus berada pada rentang 0 sampai 1.")
    if args.beta <= 0:
        raise ValueError("--beta harus > 0.")
    if args.cost_fn < 0 or args.cost_fp < 0:
        raise ValueError("Biaya FP/FN tidak boleh negatif.")

    model_path = resolve_path(args.model)
    metadata_path = resolve_path(args.metadata)
    validation_path = resolve_path(args.validation)

    if not model_path.exists():
        raise FileNotFoundError(f"Model tidak ditemukan: {model_path}")
    if not metadata_path.exists():
        raise FileNotFoundError(f"Metadata tidak ditemukan: {metadata_path}")

    with metadata_path.open("r", encoding="utf-8") as file:
        metadata = json.load(file)

    feature_names = metadata.get(
        "feature_names", DEFAULT_NUMERIC_FEATURES + DEFAULT_BINARY_FEATURES
    )
    numeric_features = metadata.get("numeric_features", DEFAULT_NUMERIC_FEATURES)
    binary_features = metadata.get("binary_features", DEFAULT_BINARY_FEATURES)
    sentinel_values = metadata.get("sentinel_values", DEFAULT_SENTINELS)

    LOGGER.info("Memuat model: %s", model_path)
    model = joblib.load(model_path)

    LOGGER.info("Memuat validation set: %s", validation_path)
    validation_df = read_table(validation_path)
    X_validation, y_validation = prepare_labeled_data(
        validation_df,
        feature_names=feature_names,
        numeric_features=numeric_features,
        binary_features=binary_features,
        sentinel_values=sentinel_values,
    )

    probability = positive_probability(model, X_validation)
    threshold_table = build_exact_threshold_table(
        y_validation.to_numpy(),
        probability,
        beta=args.beta,
        cost_fn=args.cost_fn,
        cost_fp=args.cost_fp,
    )

    chosen_threshold, selected_row = choose_threshold(
        threshold_table,
        strategy=args.strategy,
        target_recall=args.target_recall,
        min_precision=args.min_precision,
        manual_threshold=args.manual_threshold,
    )

    validation_metrics = evaluate_at_threshold(
        y_validation,
        probability,
        chosen_threshold,
    )
    log_evaluation("validation", validation_metrics)

    analysis_path = output_dir / "threshold_analysis.csv"
    threshold_table.to_csv(analysis_path, index=False)

    result: dict[str, Any] = {
        "tuned_at": utc_now_iso(),
        "model_file": str(model_path),
        "validation_file": str(validation_path),
        "strategy": "manual" if args.manual_threshold is not None else args.strategy,
        "beta": float(args.beta),
        "target_recall": args.target_recall,
        "min_precision": args.min_precision,
        "cost_fn": float(args.cost_fn),
        "cost_fp": float(args.cost_fp),
        "chosen_threshold": float(chosen_threshold),
        "validation_metrics": validation_metrics,
        "selected_threshold_row": selected_row.to_dict() if selected_row is not None else None,
        "threshold_analysis_file": str(analysis_path),
    }

    if args.test is not None:
        test_path = resolve_path(args.test)
        LOGGER.warning(
            "Testing set digunakan hanya untuk evaluasi final. Jangan gunakan hasil test untuk memilih ulang threshold."
        )
        test_df = read_table(test_path)
        X_test, y_test = prepare_labeled_data(
            test_df,
            feature_names=feature_names,
            numeric_features=numeric_features,
            binary_features=binary_features,
            sentinel_values=sentinel_values,
        )
        test_probability = positive_probability(model, X_test)
        test_metrics = evaluate_at_threshold(y_test, test_probability, chosen_threshold)
        log_evaluation("test final", test_metrics)
        result["test_file"] = str(test_path)
        result["test_metrics"] = test_metrics

        report = classification_report(
            y_test,
            (test_probability >= chosen_threshold).astype(np.int8),
            labels=[0, 1],
            target_names=["Aman (0)", "Backorder (1)"],
            zero_division=0,
        )
        for line in report.strip().splitlines():
            LOGGER.info("  %s", line)

    result_path = output_dir / "threshold_result.json"
    with result_path.open("w", encoding="utf-8") as file:
        json.dump(result, file, indent=2, ensure_ascii=False, default=json_default)

    metadata["optimal_threshold"] = float(chosen_threshold)
    metadata["threshold_status"] = "tuned"
    metadata["threshold_tuning"] = result
    with metadata_path.open("w", encoding="utf-8") as file:
        json.dump(metadata, file, indent=2, ensure_ascii=False, default=json_default)

    LOGGER.info("Threshold terpilih: %.8f", chosen_threshold)
    LOGGER.info("Analisis threshold : %s", analysis_path)
    LOGGER.info("Hasil tuning       : %s", result_path)
    LOGGER.info("Metadata diperbarui: %s", metadata_path)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Threshold tuning pada validation set independen."
    )
    parser.add_argument("--model", default=str(DEFAULT_MODEL_PATH))
    parser.add_argument("--metadata", default=str(DEFAULT_METADATA_PATH))
    parser.add_argument("--validation", default=str(DEFAULT_VALIDATION_PATH))
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    parser.add_argument(
        "--strategy",
        choices=["max_f1", "fbeta", "target_recall", "min_cost"],
        default="fbeta",
        help="Default fbeta dengan beta=2 untuk lebih menekankan recall.",
    )
    parser.add_argument("--beta", type=float, default=2.0)
    parser.add_argument("--target-recall", type=float, default=None)
    parser.add_argument(
        "--min-precision",
        type=float,
        default=None,
        help="Constraint precision minimum, misalnya 0.10.",
    )
    parser.add_argument("--cost-fn", type=float, default=10.0)
    parser.add_argument("--cost-fp", type=float, default=1.0)
    parser.add_argument(
        "--manual-threshold",
        type=float,
        default=None,
        help="Override threshold manual 0 sampai 1.",
    )
    parser.add_argument(
        "--test",
        default=None,
        help="Opsional: Testing_BOP.csv untuk satu kali evaluasi final.",
    )
    parser.add_argument(
        "--log-level",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
        default="INFO",
    )
    main(parser.parse_args())
