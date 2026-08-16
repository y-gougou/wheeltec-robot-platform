#!/usr/bin/env python
"""Export the selected SAGE-CNN checkpoint and scaler for the desktop app."""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

import joblib
import torch


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--model-root",
        type=Path,
        default=Path(r"C:\Users\86141\Desktop\yp projects\model\model\ypmodel"),
    )
    parser.add_argument(
        "--selected-dir",
        type=Path,
        default=Path(r"C:\Users\86141\Desktop\yp projects\model\model\ypmodel\selected_sage_cnn_model"),
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).resolve().parents[2] / "models" / "sage_no_saf",
    )
    parser.add_argument("--opset", type=int, default=17)
    parser.add_argument("--name", default="SAGE-CNN selected")
    parser.add_argument("--labels", default="normal,wheel_slip,drive_abnormal,shaft_eccentricity")
    parser.add_argument("--prefer-cuda", dest="prefer_cuda", action="store_true", default=True)
    parser.add_argument("--no-prefer-cuda", dest="prefer_cuda", action="store_false")
    return parser.parse_args()


def scaler_to_json(scaler) -> dict:
    if hasattr(scaler, "min_") and hasattr(scaler, "scale_"):
        return {
            "type": "minmax",
            "min": [float(v) for v in scaler.min_],
            "scale": [float(v) for v in scaler.scale_],
        }
    if hasattr(scaler, "mean_") and hasattr(scaler, "scale_"):
        return {
            "type": "standard",
            "mean": [float(v) for v in scaler.mean_],
            "scale": [float(v) for v in scaler.scale_],
        }
    raise TypeError("Unsupported scaler type; expected sklearn MinMaxScaler or StandardScaler")


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    args = parse_args()
    sys.path.insert(0, str(args.model_root))
    from models import build_model  # pylint: disable=import-error,import-outside-toplevel

    ckpt_path = args.selected_dir / "sage_cnn_selected_best_model.pth"
    scaler_path = args.selected_dir / "strict_scaler.pkl"
    feature_config_path = args.selected_dir / "feature_config_used.json"
    output_onnx = args.output_dir / "sage_cnn_selected_best_model.onnx"

    args.output_dir.mkdir(parents=True, exist_ok=True)

    checkpoint = torch.load(str(ckpt_path), map_location="cpu")
    state_dict = checkpoint.get("model_state_dict", checkpoint)
    model = build_model("sage_no_saf", input_channels=15, num_classes=4)
    model.load_state_dict(state_dict)
    model.eval()

    dummy = torch.zeros(1, 15, 50, dtype=torch.float32)
    torch.onnx.export(
        model,
        dummy,
        str(output_onnx),
        input_names=["input"],
        output_names=["logits"],
        opset_version=args.opset,
        do_constant_folding=True,
        external_data=False,
    )

    scaler = joblib.load(str(scaler_path))
    with (args.output_dir / "scaler.json").open("w", encoding="utf-8") as f:
        json.dump(scaler_to_json(scaler), f, ensure_ascii=False, indent=2)

    shutil.copy2(feature_config_path, args.output_dir / "feature_config_used.json")
    manifest = {
        "name": args.name,
        "backend": "onnxruntime",
        "model_path": output_onnx.name,
        "scaler_path": "scaler.json",
        "feature_config_path": "feature_config_used.json",
        "input_shape": [1, 15, 50],
        "labels": [label.strip() for label in args.labels.split(",") if label.strip()],
        "runtime_options": {
            "prefer_cuda": bool(args.prefer_cuda),
        },
    }
    with (args.output_dir / "model_manifest.json").open("w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print(f"Exported ONNX model: {output_onnx}")
    print(f"Exported scaler: {args.output_dir / 'scaler.json'}")
    print(f"Exported manifest: {args.output_dir / 'model_manifest.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
