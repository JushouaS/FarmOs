"""
behavior_log.py: turns the live behaviour monitor's latest picture into one readable row a minute for
logs/behavior/behavior-YYYY-MM-DD.csv.

The row starts with a sentence anyone can read, then the numbers behind it for Excel:

    time       2026-11-07T19:30:00+08:00
    summary    25 birds seen; 2 still for 30+ min (of 23 watched long enough); 4 in a huddle (16% of the flock).
    birds_seen          25    birds the detector found in the picture
    still_birds         2     birds that stayed still for the whole still window (still_window_min)
    birds_judged        23    birds followed long enough to say whether they were still (new arrivals are not yet)
    huddled_birds       4     birds in a huddle that has lasted at least huddle_window_min
    huddled_pct         16    huddled_birds as a share of birds_seen, 0 to 100 (35 or more is a warning)
    moving_pct          91    share of the judged birds that moved, 0 to 100 (blank with fewer than 3 judged)
    still_window_min    30    how long a bird must stay still to count (LIVE_INACTIVE_SECONDS)
    huddle_window_min   10    how long a huddle must last to count (LIVE_HUDDLE_SECONDS)
    problem             why there is no reading this minute, in words; blank when all is well

"Still" is not "sick": the Pi does not know the lighting hours, so at night still birds are simply resting. A blank
number means unknown (no picture, too early to judge), never zero.
"""
from __future__ import annotations

from typing import Any

COLUMNS = ["summary", "birds_seen", "still_birds", "birds_judged", "huddled_birds", "huddled_pct", "moving_pct",
           "still_window_min", "huddle_window_min", "problem"]

#: A huddle holding this share of the flock is worth a warning (behavior.FDI_WARN, as a percent).
HUDDLE_WARN_PCT = 35

PROBLEMS = {
    "no_frame": "The camera gave no picture.",
    "bad_frame": "The camera picture could not be read.",
    "model_not_installed": "The bird detector is not installed (models/detector.onnx).",
}


def _minutes(seconds: float) -> int | float:
    m = seconds / 60
    return int(m) if m == int(m) else round(m, 1)


def problem_text(error: str | None) -> str | None:
    if not error:
        return None
    return PROBLEMS.get(error, f"Error: {error}")


def row(last: dict[str, Any] | None, fresh: bool, error: str | None,
        still_window_s: float, huddle_window_s: float) -> dict[str, Any]:
    """One CSV row (without the time) from behavior.Engine.last. fresh: the picture was checked recently."""
    window = _minutes(still_window_s)
    out: dict[str, Any] = {
        "still_window_min": window,
        "huddle_window_min": _minutes(huddle_window_s),
    }
    if not fresh or last is None:
        out["summary"] = "No reading this minute."
        out["problem"] = problem_text(error) or "No new picture was checked in the last minute."
        return out

    n = int(last["n"])
    still = last.get("still") or []
    judged = sum(1 for s in still if s is not None)
    still_count = sum(1 for s in still if s is True)
    huddled = sum(1 for h in (last.get("in_huddle") or []) if h)
    huddled_pct = round(float(last.get("fdi") or 0.0) * 100)
    moving = last.get("flock_moving")
    out.update({
        "birds_seen": n,
        "still_birds": still_count,
        "birds_judged": judged,
        "huddled_birds": huddled,
        "huddled_pct": huddled_pct,
        "moving_pct": round(float(moving) * 100) if moving is not None else None,
        "problem": problem_text(error),
    })

    if n == 0:
        out["summary"] = "No birds seen."
        return out
    parts = [f"{n} bird{'s' if n != 1 else ''} seen"]
    if judged == 0:
        parts.append(f"too early to say which are still (a bird needs {window} min of watching)")
    else:
        still_text = f"{still_count} still for {window}+ min" if still_count else f"none still for {window}+ min"
        if judged < n:
            still_text += f" (of {judged} watched long enough)"
        parts.append(still_text)
    if huddled:
        huddle_text = f"{huddled} in a huddle ({huddled_pct}% of the flock)"
        if huddled_pct >= HUDDLE_WARN_PCT:
            huddle_text += f", above the {HUDDLE_WARN_PCT}% warning level"
        parts.append(huddle_text)
    else:
        parts.append("no huddle")
    out["summary"] = "; ".join(parts) + "."
    return out
