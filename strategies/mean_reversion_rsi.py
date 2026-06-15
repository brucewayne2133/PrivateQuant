from __future__ import annotations

import pandas as pd


class BasicTrendStrategy:
    name = "mean_reversion_rsi"

    def prepare(self, df: pd.DataFrame) -> pd.DataFrame:
        out = df.copy()
        delta = out["Close"].diff()
        gain = delta.clip(lower=0).rolling(14).mean()
        loss = (-delta.clip(upper=0)).rolling(14).mean()
        rs = gain / loss.replace(0, pd.NA)
        out["rsi"] = 100 - (100 / (1 + rs))
        out["rsi"] = out["rsi"].fillna(50)
        return out

    def signal(self, df: pd.DataFrame, idx: int, in_position: bool) -> str:
        if idx < 15:
            return "hold"
        rsi = df.iloc[idx]["rsi"]
        if not in_position and rsi < 30:
            return "buy"
        if in_position and rsi > 55:
            return "sell"
        return "hold"
