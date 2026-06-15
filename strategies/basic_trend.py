from __future__ import annotations

import pandas as pd


class BasicTrendStrategy:
    name = "basic_trend"

    def prepare(self, df: pd.DataFrame) -> pd.DataFrame:
        out = df.copy()
        out["fast_ma"] = out["Close"].rolling(10).mean()
        out["slow_ma"] = out["Close"].rolling(30).mean()
        return out

    def signal(self, df: pd.DataFrame, idx: int, in_position: bool) -> str:
        if idx < 31:
            return "hold"
        row = df.iloc[idx]
        prev = df.iloc[idx - 1]
        if pd.isna(row["fast_ma"]) or pd.isna(row["slow_ma"]):
            return "hold"
        crossed_up = prev["fast_ma"] <= prev["slow_ma"] and row["fast_ma"] > row["slow_ma"]
        crossed_down = prev["fast_ma"] >= prev["slow_ma"] and row["fast_ma"] < row["slow_ma"]
        if not in_position and crossed_up:
            return "buy"
        if in_position and crossed_down:
            return "sell"
        return "hold"
