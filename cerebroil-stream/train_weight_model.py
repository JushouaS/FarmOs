"""
train_weight_model.py: trains the broiler weight model that kinect_weight.py uses.

    python train_weight_model.py path/to/features_center_crop_reference_intrinsics.csv

The CSV has one row per bird per frame: the measurements taken from the bird's outline and the Kinect depth
picture (columns as in kinect_weight.FEATURES) and the bird's real weight (`weight_g`), with `session`
(the day) and `band_id` (the wing band, one number per bird). Only the five size measurements are used. The
heights and the point-cloud columns of the older provisional model add nothing once the footprint is known
(tested with whole birds held out), and they cannot be measured the same way on the live camera.

Why the settings are strict: the file holds only a few hundred different birds (about 100 frames of each), so a
free-running model learns each bird by heart and looks far better than it is. The trees here are shallow, need
many rows to split, and may only make a bigger bird heavier. The accuracy printed at the end is measured on
birds the model never saw.

Writes models/weight_model_size_v1.json (the model) and models/weight_model_size_v1.meta.json (the settings and
what the accuracy is).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.model_selection import GroupKFold

from kinect_weight import FEATURES, FX_REF

OUT_DIR = Path(__file__).parent / "models"
MODEL_FILE = OUT_DIR / "weight_model_size_v1.json"
META_FILE = OUT_DIR / "weight_model_size_v1.meta.json"

ROUNDS = 250
PARAMS = {
    "eta": 0.05,
    "max_depth": 3,
    "min_child_weight": 200,        # a leaf must hold many rows, so no leaf can be one bird
    "subsample": 0.7,
    "lambda": 20.0,
    "objective": "reg:squarederror",
    "tree_method": "hist",
    "seed": 0,
}
# area, length, width and pixel count can only raise the weight; elongation (a shape) is free.
MONOTONE = {"projected_area_mm2": 1, "length_mm": 1, "width_mm": 1, "elongation": 0, "pixel_count": 1}


def fit(X: np.ndarray, y: np.ndarray) -> xgb.Booster:
    params = {**PARAMS, "monotone_constraints": "(" + ",".join(str(MONOTONE[c]) for c in FEATURES) + ")"}
    return xgb.train(params, xgb.DMatrix(X, label=y), num_boost_round=ROUNDS)


def held_out(df: pd.DataFrame, groups: np.ndarray, k: int) -> tuple[float, float, float, float]:
    X, y = df[FEATURES].values.astype(np.float32), df.weight_g.values
    pred = np.zeros(len(y))
    for train, test in GroupKFold(k).split(X, y, groups):
        pred[test] = fit(X[train], y[train]).predict(xgb.DMatrix(X[test]))
    e = pred - y
    return float(np.abs(e).mean()), float(100 * np.abs(e / y).mean()), float(1 - (e**2).sum() / ((y - y.mean()) ** 2).sum()), float(e.mean())


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    df = pd.read_csv(sys.argv[1]).dropna(subset=FEATURES + ["weight_g"])
    bird = (df.session.astype(str) + "_" + df.band_id.astype(str)).values
    day = df.session.astype(str).values
    print(f"{len(df)} rows, {len(set(bird))} birds-on-a-day, {len(set(day))} days")

    by_bird = held_out(df, bird, 5)
    by_day = held_out(df, day, 6)
    print("held out by bird: MAE %.1f g (%.1f %%)  R2 %.3f  bias %+.1f g" % by_bird)
    print("held out by day : MAE %.1f g (%.1f %%)  R2 %.3f  bias %+.1f g" % by_day)

    model = fit(df[FEATURES].values.astype(np.float32), df.weight_g.values)
    OUT_DIR.mkdir(exist_ok=True)
    model.save_model(str(MODEL_FILE))
    META_FILE.write_text(
        json.dumps(
            {
                "features": FEATURES,
                "fx_reference_px": FX_REF,
                "rows": int(len(df)),
                "birds": int(len(set(bird))),
                "days": sorted(set(day)),
                "params": {**PARAMS, "rounds": ROUNDS},
                "unseen_birds": {"mae_g": round(by_bird[0], 1), "mae_percent": round(by_bird[1], 1), "r2": round(by_bird[2], 3), "bias_g": round(by_bird[3], 1)},
                "unseen_days": {"mae_g": round(by_day[0], 1), "mae_percent": round(by_day[1], 1), "r2": round(by_day[2], 3), "bias_g": round(by_day[3], 1)},
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print("wrote", MODEL_FILE.name, "and", META_FILE.name)


if __name__ == "__main__":
    main()
