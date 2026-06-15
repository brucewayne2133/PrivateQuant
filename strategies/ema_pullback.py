from __future__ import annotations

import pandas as pd


class BasicTrendStrategy:
    name = "ema_pullback"

    def prepare(self, df: pd.DataFrame) -> pd.DataFrame:
        out = df.copy()
        out["ema_fast"] = out["Close"].ewm(span=21, adjust=False).mean()
        out["ema_slow"] = out["Close"].ewm(span=55, adjust=False).mean()
        out["pullback"] = (out["Close"] - out["ema_fast"]) / out["ema_fast"]
        return out

    def signal(self, df: pd.DataFrame, idx: int, in_position: bool) -> str:
        if idx < 56:
            return "hold"
        row = df.iloc[idx]
        trend_up = row["ema_fast"] > row["ema_slow"]
        if not in_position and trend_up and row["pullback"] < -0.0025:
            return "buy"
        if in_position and row["Close"] > row["ema_fast"]:
            return "sell"
        return "hold"
