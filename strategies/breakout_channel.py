from __future__ import annotations

import pandas as pd


class BasicTrendStrategy:
    name = "breakout_channel"

    def prepare(self, df: pd.DataFrame) -> pd.DataFrame:
        out = df.copy()
        out["channel_high"] = out["High"].rolling(20).max().shift(1)
        out["channel_low"] = out["Low"].rolling(20).min().shift(1)
        return out

    def signal(self, df: pd.DataFrame, idx: int, in_position: bool) -> str:
        if idx < 21:
            return "hold"
        row = df.iloc[idx]
        if pd.isna(row["channel_high"]) or pd.isna(row["channel_low"]):
            return "hold"
        if not in_position and row["Close"] > row["channel_high"]:
            return "buy"
        if in_position and row["Close"] < row["channel_low"]:
            return "sell"
        return "hold"
