const API = window.location.origin;
const MAX_POINTS = 1200;
const DEFAULT_VISIBLE_CANDLES = 320;
const RING_RADIUS = 64;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const SETTINGS_KEY = 'backtest-quant-chart-settings';
const REFRESH_IDLE_MS = 900;
const REFRESH_RUNNING_MS = 420;
const AVAILABILITY_REFRESH_MS = 12000;

let tradeSort = { key: 'time', dir: 'desc' };
let userRanges = { price: null, equity: null };
let preserveZoomEnabled = true;
let liveFollowEnabled = true;
let fitTradesEnabled = true;
let statusLoopHandle = null;
let strategyUniverse = [];

const chartTheme = {
  bull: '#26a69a',
  bear: '#ef5350',
  wick: '#94a3b8',
  border: '#94a3b8',
  background: '#0a0a0a',
  grid: '#20262e',
  showGrid: false,
  scaleMode: 'linear',
  autoFit: true,
  themePreset: 'dark',
};

const els = {
  strategy: document.getElementById('strategy'),
  symbol: document.getElementById('symbol'),
  timeframe: document.getElementById('timeframe'),
  startingCash: document.getElementById('startingCash'),
  speedSelect: document.getElementById('speedSelect'),
  maxTrades: document.getElementById('maxTrades'),
  strategyChecklist: document.getElementById('strategyChecklist'),
  strategySearch: document.getElementById('strategySearch'),
  strategyCountBadge: document.getElementById('strategyCountBadge'),
  selectAllStrategiesBtn: document.getElementById('selectAllStrategiesBtn'),
  clearStrategiesBtn: document.getElementById('clearStrategiesBtn'),
  bullColor: document.getElementById('bullColor'),
  bearColor: document.getElementById('bearColor'),
  wickColor: document.getElementById('wickColor'),
  borderColor: document.getElementById('borderColor'),
  bgColor: document.getElementById('bgColor'),
  gridColor: document.getElementById('gridColor'),
  themePreset: document.getElementById('themePreset'),
  scaleMode: document.getElementById('scaleMode'),
  autoFitToggle: document.getElementById('autoFitToggle'),
  showGridToggle: document.getElementById('showGridToggle'),
  preserveZoomToggle: document.getElementById('preserveZoomToggle'),
  liveFollowToggle: document.getElementById('liveFollowToggle'),
  fitTradesToggle: document.getElementById('fitTradesToggle'),
  startBtn: document.getElementById('startBtn'),
  pauseBtn: document.getElementById('pauseBtn'),
  continueBtn: document.getElementById('continueBtn'),
  resetBtn: document.getElementById('resetBtn'),
  runAllBtn: document.getElementById('runAllBtn'),
  exportCsvBtn: document.getElementById('exportCsvBtn'),
  sortTimeBtn: document.getElementById('sortTimeBtn'),
  sortPnlBtn: document.getElementById('sortPnlBtn'),
  clearRunsBtn: document.getElementById('clearRunsBtn'),
  stateText: document.getElementById('stateText'),
  barText: document.getElementById('barText'),
  priceText: document.getElementById('priceText'),
  pnlText: document.getElementById('pnlText'),
  tradesProgressText: document.getElementById('tradesProgressText'),
  tradesProgressBar: document.getElementById('tradesProgressBar'),
  dataRefreshText: document.getElementById('dataRefreshText'),
  dataStatusPanel: document.getElementById('dataStatusPanel'),
  kpiPnl: document.getElementById('kpiPnl'),
  kpiEquity: document.getElementById('kpiEquity'),
  kpiPrice: document.getElementById('kpiPrice'),
  kpiPosition: document.getElementById('kpiPosition'),
  statusRibbon: document.getElementById('statusRibbon'),
  monitorBox: document.getElementById('monitorBox'),
  tradeFeed: document.getElementById('tradeFeed'),
  heroMeta: document.getElementById('heroMeta'),
  ringProgress: document.getElementById('ringProgress'),
  ringPercent: document.getElementById('ringPercent'),
  ringProfit: document.getElementById('ringProfit'),
  performanceStateBadge: document.getElementById('performanceStateBadge'),
  heroEquityPeak: document.getElementById('heroEquityPeak'),
  heroDrawdown: document.getElementById('heroDrawdown'),
  heroSharpeLike: document.getElementById('heroSharpeLike'),
  statTotalTrades: document.getElementById('statTotalTrades'),
  statWinrate: document.getElementById('statWinrate'),
  statTotalPnl: document.getElementById('statTotalPnl'),
  statAvgWin: document.getElementById('statAvgWin'),
  statAvgLoss: document.getElementById('statAvgLoss'),
  statEquityPeak: document.getElementById('statEquityPeak'),
  statMaxDrawdown: document.getElementById('statMaxDrawdown'),
  statSharpeLike: document.getElementById('statSharpeLike'),
  runComparison: document.getElementById('runComparison'),
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    Object.assign(chartTheme, saved);
    preserveZoomEnabled = saved.preserveZoomEnabled ?? true;
    liveFollowEnabled = saved.liveFollowEnabled ?? true;
    fitTradesEnabled = saved.fitTradesEnabled ?? true;
  } catch (_) {}
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...chartTheme, preserveZoomEnabled, liveFollowEnabled, fitTradesEnabled }));
  } catch (_) {}
}

function syncSettingsUI() {
  els.bullColor.value = chartTheme.bull;
  els.bearColor.value = chartTheme.bear;
  els.wickColor.value = chartTheme.wick;
  els.borderColor.value = chartTheme.border;
  els.bgColor.value = chartTheme.background;
  els.gridColor.value = chartTheme.grid;
  els.themePreset.value = chartTheme.themePreset;
  els.scaleMode.value = chartTheme.scaleMode;
  els.autoFitToggle.checked = chartTheme.autoFit;
  els.showGridToggle.checked = chartTheme.showGrid;
  els.preserveZoomToggle.checked = preserveZoomEnabled;
  els.liveFollowToggle.checked = liveFollowEnabled;
  els.fitTradesToggle.checked = fitTradesEnabled;
}

function applyThemePreset(name) {
  if (name === 'light') {
    Object.assign(chartTheme, {
      bull: '#089981',
      bear: '#f23645',
      wick: '#64748b',
      border: '#64748b',
      background: '#ffffff',
      grid: '#e2e8f0',
      themePreset: 'light',
    });
  } else {
    Object.assign(chartTheme, {
      bull: '#26a69a',
      bear: '#ef5350',
      wick: '#94a3b8',
      border: '#94a3b8',
      background: '#0a0a0a',
      grid: '#20262e',
      themePreset: 'dark',
    });
  }
  syncSettingsUI();
  saveSettings();
}

function minMax(values) {
  if (!values || values.length === 0) return [0, 1];
  let min = Math.min(...values), max = Math.max(...values);
  if (min === max) {
    const pad = Math.abs(min || 1) * 0.01;
    return [min - pad, max + pad];
  }
  const pad = (max - min) * 0.06;
  return [min - pad, max + pad];
}

function trimBuffer(arr, max = MAX_POINTS) {
  return arr.length > max ? arr.slice(arr.length - max) : arr;
}

function getVisibleRange(xValues, visibleCount = DEFAULT_VISIBLE_CANDLES) {
  if (!xValues || xValues.length === 0) return null;
  const startIndex = Math.max(0, xValues.length - visibleCount);
  return [xValues[startIndex], xValues[xValues.length - 1]];
}

function expandRangeToInclude(defaultRange, values) {
  if (!defaultRange || !values?.length) return defaultRange;
  const timestamps = values.filter(Boolean).map(value => new Date(value).getTime()).filter(Number.isFinite);
  if (!timestamps.length) return defaultRange;
  const defaultStart = new Date(defaultRange[0]).getTime();
  const defaultEnd = new Date(defaultRange[1]).getTime();
  const minTs = Math.min(defaultStart, ...timestamps);
  const maxTs = Math.max(defaultEnd, ...timestamps);
  return [new Date(minTs).toISOString(), new Date(maxTs).toISOString()];
}

function deriveFollowRange(xValues, markerTimes = []) {
  const baseWindow = Math.max(DEFAULT_VISIBLE_CANDLES, Math.min(MAX_POINTS, Math.floor((xValues?.length || 0) * 0.9)));
  const baseRange = getVisibleRange(xValues, baseWindow);
  return fitTradesEnabled ? expandRangeToInclude(baseRange, markerTimes) : baseRange;
}

function effectiveXRange(defaultRange, userRange, forceFollow = false) {
  if (forceFollow && liveFollowEnabled) return defaultRange;
  return preserveZoomEnabled && userRange ? userRange : defaultRange;
}

function snapMarkersToSet(trades, timestampField, priceField, allowedSet) {
  const x = [];
  const y = [];
  for (const trade of trades) {
    const ts = trade[timestampField];
    const price = trade[priceField];
    if (!ts || price == null || !allowedSet.has(ts)) continue;
    x.push(ts);
    y.push(Number(price));
  }
  return { x: trimBuffer(x), y: trimBuffer(y) };
}

function snapEquityMarkersToMap(trades, timestampField, equityMap) {
  const x = [];
  const y = [];
  for (const trade of trades) {
    const ts = trade[timestampField];
    if (!ts || !equityMap.has(ts)) continue;
    x.push(ts);
    y.push(Number(equityMap.get(ts)));
  }
  return { x: trimBuffer(x), y: trimBuffer(y) };
}

function gridColor() {
  return chartTheme.showGrid ? chartTheme.grid : 'rgba(0,0,0,0)';
}

function layout(title, yRange = null, xRange = null) {
  return {
    title: { text: title, font: { color: chartTheme.themePreset === 'light' ? '#0f172a' : '#e2e8f0', size: 15 } },
    template: chartTheme.themePreset === 'light' ? 'plotly_white' : 'plotly_dark',
    paper_bgcolor: chartTheme.background,
    plot_bgcolor: chartTheme.background,
    margin: { l: 14, r: 14, t: 36, b: 20 },
    dragmode: 'pan',
    hovermode: 'x unified',
    showlegend: false,
    bargap: 0.08,
    xaxis: {
      type: 'date',
      range: xRange,
      autorange: false,
      fixedrange: false,
      rangeslider: { visible: false },
      gridcolor: gridColor(),
      zeroline: false,
      showline: false,
      ticks: 'outside',
      tickcolor: chartTheme.themePreset === 'light' ? '#94a3b8' : '#475569',
      color: chartTheme.themePreset === 'light' ? '#334155' : '#94a3b8'
    },
    yaxis: {
      type: chartTheme.scaleMode,
      range: chartTheme.autoFit ? yRange : undefined,
      autorange: chartTheme.autoFit,
      fixedrange: false,
      side: 'right',
      gridcolor: gridColor(),
      zeroline: false,
      showline: false,
      ticks: 'outside',
      tickcolor: chartTheme.themePreset === 'light' ? '#94a3b8' : '#475569',
      color: chartTheme.themePreset === 'light' ? '#334155' : '#94a3b8'
    }
  };
}

function initEmptyCharts() {
  Plotly.react('priceChart', [], layout('Price Candles'), { displayModeBar: false, responsive: true, scrollZoom: true });
  Plotly.react('equityChart', [], layout('Equity Curve'), { displayModeBar: false, responsive: true, scrollZoom: true });
}

function bindChartInteractions() {
  const priceChart = document.getElementById('priceChart');
  const equityChart = document.getElementById('equityChart');
  if (priceChart && !priceChart.__boundZoom) {
    priceChart.on('plotly_relayout', (ev) => {
      if (ev['xaxis.range[0]'] && ev['xaxis.range[1]']) userRanges.price = [ev['xaxis.range[0]'], ev['xaxis.range[1]']];
      if (ev['xaxis.autorange']) userRanges.price = null;
    });
    priceChart.__boundZoom = true;
  }
  if (equityChart && !equityChart.__boundZoom) {
    equityChart.on('plotly_relayout', (ev) => {
      if (ev['xaxis.range[0]'] && ev['xaxis.range[1]']) userRanges.equity = [ev['xaxis.range[0]'], ev['xaxis.range[1]']];
      if (ev['xaxis.autorange']) userRanges.equity = null;
    });
    equityChart.__boundZoom = true;
  }
}

async function call(path, method = 'POST', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || data.message || `Request failed: ${res.status}`);
  return data;
}

function setText(el, value) {
  if (el && el.textContent !== value) el.textContent = value;
}

function renderTradeFeed(completed) {
  const sorted = [...completed.slice(-50)].sort((a, b) => {
    if (tradeSort.key === 'pnl') return tradeSort.dir === 'asc' ? Number(a.pnl || 0) - Number(b.pnl || 0) : Number(b.pnl || 0) - Number(a.pnl || 0);
    const ta = new Date(a.exit_time || a.entry_time || 0).getTime();
    const tb = new Date(b.exit_time || b.entry_time || 0).getTime();
    return tradeSort.dir === 'asc' ? ta - tb : tb - ta;
  });

  if (!sorted.length) {
    els.tradeFeed.innerHTML = '<div class="trade-row"><div>Waiting for trades</div><div class="trade-side">—</div><div class="pnl-flat">0.00</div></div>';
    return;
  }

  els.tradeFeed.innerHTML = sorted.map(trade => {
    const pnl = Number(trade.pnl || 0);
    const pnlClass = pnl > 0 ? 'pnl-pos' : pnl < 0 ? 'pnl-neg' : 'pnl-flat';
    const side = (trade.side || 'long').toUpperCase();
    const time = trade.exit_time || trade.entry_time || '—';
    return `<div class="trade-row"><div>${time}</div><div class="trade-side">${side}</div><div class="${pnlClass}">${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}</div></div>`;
  }).join('');
}

function renderRunComparison(runs) {
  if (!runs || !runs.length) {
    els.runComparison.innerHTML = '<div class="comparison-row"><div>No runs yet</div><div>—</div><div>—</div><div>—</div><div>—</div><div>—</div></div>';
    return;
  }
  els.runComparison.innerHTML = runs.slice().reverse().map(run => {
    const pnl = Number(run.total_pnl || 0);
    const score = Number(run.score || 0);
    const pnlClass = pnl > 0 ? 'pnl-pos' : pnl < 0 ? 'pnl-neg' : 'pnl-flat';
    const scoreClass = score > 0 ? 'score-pos' : score < 0 ? 'score-neg' : 'pnl-flat';
    return `<div class="comparison-row ${run.best ? 'best-run' : ''}"><div>${run.strategy}${run.best ? '<span class="best-badge">BEST</span>' : ''}</div><div class="${scoreClass}">${score.toFixed(2)}</div><div class="${pnlClass}">${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}</div><div>${Number(run.winrate || 0).toFixed(2)}%</div><div class="pnl-neg">${Number(run.max_drawdown || 0).toFixed(2)}%</div><div>${run.trades || 0}</div></div>`;
  }).join('');
}

function selectedStrategies() {
  return Array.from(els.strategyChecklist.querySelectorAll('input[type="checkbox"]:checked')).map(input => input.value);
}

function updateStrategyCount() {
  const total = strategyUniverse.length || 0;
  const selected = selectedStrategies().length;
  if (!els.strategyCountBadge) return;
  els.strategyCountBadge.textContent = total ? `${selected} / ${total} selected` : '0 selected';
}

function renderStrategyChecklist(filterText = '') {
  const selected = new Set(selectedStrategies());
  const normalized = filterText.trim().toLowerCase();
  const visible = strategyUniverse.filter(name => !normalized || name.toLowerCase().includes(normalized));

  if (!visible.length) {
    els.strategyChecklist.innerHTML = '<div class="strategy-item"><div class="strategy-item-main"><div class="strategy-item-name">No matching strategies</div><div class="strategy-item-meta">Try another search term</div></div></div>';
    updateStrategyCount();
    return;
  }

  const shouldDefaultAll = selected.size === 0;
  els.strategyChecklist.innerHTML = visible.map((name, index) => `
    <label class="strategy-item">
      <input type="checkbox" value="${name}" ${(shouldDefaultAll || selected.has(name)) ? 'checked' : ''} />
      <div class="strategy-item-main">
        <span class="strategy-item-name">${name}</span>
        <span class="strategy-item-meta">Strategy ${String(index + 1).padStart(2, '0')}</span>
      </div>
    </label>
  `).join('');
  updateStrategyCount();
}

async function loadStrategies() {
  try {
    const data = await fetch(`${API}/strategies`, { cache: 'no-store' }).then(r => r.json());
    const strategies = data.strategies || [];
    if (!strategies.length) return;
    strategyUniverse = strategies;
    const current = els.strategy.value;
    els.strategy.innerHTML = strategies.map(name => `<option value="${name}">${name}</option>`).join('');
    if (strategies.includes(current)) els.strategy.value = current;
    renderStrategyChecklist(els.strategySearch?.value || '');
  } catch (_) {}
}

async function loadTimeframeAvailability() {
  try {
    const symbol = els.symbol.value || 'BTCUSDT';
    const data = await fetch(`${API}/availability?symbol=${encodeURIComponent(symbol)}`, { cache: 'no-store' }).then(r => r.json());
    const discoveredAssets = data.dataset_status ? Object.keys(data.dataset_status) : (data.assets || []);
    const enabledAssets = new Set(data.assets || []);
    const currentAsset = els.symbol.value;
    els.symbol.innerHTML = discoveredAssets.map(asset => {
      const enabled = enabledAssets.has(asset);
      return `<option value="${asset}" ${enabled ? '' : 'disabled'}>${enabled ? asset : `${asset} (missing)`}</option>`;
    }).join('');
    if (enabledAssets.has(currentAsset)) {
      els.symbol.value = currentAsset;
    } else {
      const firstEnabledAsset = Array.from(els.symbol.options).find(option => !option.disabled);
      if (firstEnabledAsset) els.symbol.value = firstEnabledAsset.value;
    }

    const available = new Set(data.timeframes || []);
    Array.from(els.timeframe.options).forEach(option => {
      const enabled = available.has(option.value);
      option.disabled = !enabled;
      option.textContent = enabled ? option.value : `${option.value} (missing)`;
    });
    if (els.timeframe.selectedOptions[0]?.disabled) {
      const firstEnabled = Array.from(els.timeframe.options).find(option => !option.disabled);
      if (firstEnabled) els.timeframe.value = firstEnabled.value;
    }

    setText(els.dataRefreshText, data.last_refresh || '—');
    const status = data.dataset_status || {};
    els.dataStatusPanel.innerHTML = Object.entries(status).map(([asset, info]) => {
      const frames = info.timeframes || {};
      const chips = ['1m', '5m', '10m', '15m', '30m', '1h'].map(tf => {
        const meta = frames[tf];
        if (!meta) return `<span class="data-chip data-chip-missing">${tf}</span>`;
        return `<span class="data-chip data-chip-ok">${tf}</span><span class="data-chip data-chip-meta">${meta.rows}</span>`;
      }).join('');
      const modified = info.latest_modified ? `<div class="data-modified">Updated: ${info.latest_modified}</div>` : `<div class="data-modified">Updated: —</div>`;
      return `<div class="data-asset-row"><div class="data-asset-name">${asset}</div>${modified}<div class="data-timeframe-list">${chips}</div></div>`;
    }).join('');
  } catch (_) {}
}

function updatePerformance(status) {
  const startingCash = Number(els.startingCash.value) || 100000;
  const profit = Number(status.current_pnl || 0);
  const pct = startingCash > 0 ? (profit / startingCash) * 100 : 0;
  const normalized = Math.min(Math.abs(pct), 100);
  const offset = RING_CIRCUMFERENCE * (1 - normalized / 100);
  const positive = profit >= 0;
  els.ringProgress.style.strokeDasharray = `${RING_CIRCUMFERENCE}`;
  els.ringProgress.style.strokeDashoffset = `${offset}`;
  els.ringProgress.style.stroke = positive ? chartTheme.bull : chartTheme.bear;
  setText(els.ringPercent, `${pct.toFixed(2)}%`);
  setText(els.ringProfit, `${positive ? '+' : ''}${profit.toFixed(2)}`);
  els.ringProfit.className = `ring-profit ${profit > 0 ? 'pnl-pos' : profit < 0 ? 'pnl-neg' : 'pnl-flat'}`;
}

function computeTradeStats(trades) {
  const completed = (trades || []).filter(t => t.action === 'trade');
  const pnls = completed.map(t => Number(t.pnl || 0));
  const wins = pnls.filter(v => v > 0);
  const losses = pnls.filter(v => v < 0);
  const totalPnl = pnls.reduce((a, b) => a + b, 0);
  return {
    totalTrades: completed.length,
    winrate: completed.length ? (wins.length / completed.length) * 100 : 0,
    totalPnl,
    avgWin: wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : 0,
    avgLoss: losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : 0,
    completed,
  };
}

function updateStatsPanel(stats, status) {
  const equityPeak = Number(status.equity_peak || 0).toFixed(2);
  const drawdown = `${Number(status.max_drawdown || 0).toFixed(2)}%`;
  const sharpe = `${Number(status.sharpe_like || 0).toFixed(2)}`;
  setText(els.statTotalTrades, String(stats.totalTrades));
  setText(els.statWinrate, `${stats.winrate.toFixed(2)}%`);
  setText(els.statTotalPnl, `${stats.totalPnl >= 0 ? '+' : ''}${stats.totalPnl.toFixed(2)}`);
  setText(els.statAvgWin, `${stats.avgWin.toFixed(2)}`);
  setText(els.statAvgLoss, `${stats.avgLoss.toFixed(2)}`);
  setText(els.statEquityPeak, equityPeak);
  setText(els.statMaxDrawdown, drawdown);
  setText(els.statSharpeLike, sharpe);
  setText(els.heroEquityPeak, equityPeak);
  setText(els.heroDrawdown, drawdown);
  setText(els.heroSharpeLike, sharpe);
}

function renderCharts(status) {
  const candles = trimBuffer(status.candles || []);
  const curve = trimBuffer(status.equity || []);
  const candleX = candles.map(c => c.timestamp);
  const candleOpen = candles.map(c => Number(c.open));
  const candleHigh = candles.map(c => Number(c.high));
  const candleLow = candles.map(c => Number(c.low));
  const candleClose = candles.map(c => Number(c.close));
  const candleSet = new Set(candleX);
  const [priceMin, priceMax] = minMax(candleLow.concat(candleHigh).filter(v => Number.isFinite(v)));

  const equityX = curve.map(r => r.timestamp);
  const equityY = curve.map(r => Number(r.equity));
  const equityMap = new Map(curve.map(point => [point.timestamp, point.equity]));
  const [eqMin, eqMax] = minMax(equityY.filter(v => Number.isFinite(v)));

  const completedTrades = (status.trades || []).filter(t => t.action === 'trade');
  const priceEntryMarkers = snapMarkersToSet(completedTrades, 'entry_time', 'entry_price', candleSet);
  const priceExitMarkers = snapMarkersToSet(completedTrades, 'exit_time', 'exit_price', candleSet);
  const equityEntryMarkers = snapEquityMarkersToMap(completedTrades, 'entry_time', equityMap);
  const equityExitMarkers = snapEquityMarkersToMap(completedTrades, 'exit_time', equityMap);
  const priceMarkerTimes = priceEntryMarkers.x.concat(priceExitMarkers.x);
  const equityMarkerTimes = equityEntryMarkers.x.concat(equityExitMarkers.x);
  const priceFollowRange = deriveFollowRange(candleX, priceMarkerTimes);
  const equityFollowRange = deriveFollowRange(equityX, equityMarkerTimes);
  const priceRange = effectiveXRange(priceFollowRange, userRanges.price, status.running);
  const equityRange = effectiveXRange(equityFollowRange, userRanges.equity, status.running);

  if (!candles.length) {
    Plotly.react('priceChart', [], {
      ...layout('Price Candles'),
      annotations: [{ text: 'Waiting for data', x: 0.5, y: 0.5, xref: 'paper', yref: 'paper', showarrow: false, font: { color: '#94a3b8', size: 18 } }]
    }, { displayModeBar: false, responsive: true, scrollZoom: true });
  } else {
    Plotly.react('priceChart', [
      {
        type: 'candlestick',
        x: candleX,
        open: candleOpen,
        high: candleHigh,
        low: candleLow,
        close: candleClose,
        increasing: { line: { color: chartTheme.bull, width: 1 }, fillcolor: chartTheme.bull },
        decreasing: { line: { color: chartTheme.bear, width: 1 }, fillcolor: chartTheme.bear },
        whiskerwidth: 0.4,
        name: 'OHLC'
      },
      {
        x: priceEntryMarkers.x,
        y: priceEntryMarkers.y,
        type: 'scatter',
        mode: 'markers',
        marker: { color: chartTheme.bull, size: 10, symbol: 'triangle-up' },
        hovertemplate: 'BUY<br>%{x}<br>%{y:.2f}<extra></extra>'
      },
      {
        x: priceExitMarkers.x,
        y: priceExitMarkers.y,
        type: 'scatter',
        mode: 'markers',
        marker: { color: chartTheme.bear, size: 10, symbol: 'triangle-down' },
        hovertemplate: 'SELL<br>%{x}<br>%{y:.2f}<extra></extra>'
      }
    ], layout(`Price Candles • ${status.symbol || '—'} • ${status.timeframe || '—'}`, chartTheme.autoFit ? [priceMin, priceMax] : null, priceRange), { displayModeBar: false, responsive: true, scrollZoom: true });
  }

  Plotly.react('equityChart', [
    {
      x: equityX,
      y: equityY,
      type: 'scatter',
      mode: 'lines',
      line: { color: chartTheme.bull, width: 2, shape: 'spline', smoothing: 0.35 },
      fill: 'none'
    },
    {
      x: equityEntryMarkers.x,
      y: equityEntryMarkers.y,
      type: 'scatter',
      mode: 'markers',
      marker: { color: chartTheme.bull, size: 9, symbol: 'triangle-up' },
      hovertemplate: 'BUY<br>%{x}<br>%{y:.2f}<extra></extra>'
    },
    {
      x: equityExitMarkers.x,
      y: equityExitMarkers.y,
      type: 'scatter',
      mode: 'markers',
      marker: { color: chartTheme.bear, size: 9, symbol: 'triangle-down' },
      hovertemplate: 'SELL<br>%{x}<br>%{y:.2f}<extra></extra>'
    }
  ], layout(`Equity Curve • ${status.speed || 'normal'}`, chartTheme.autoFit ? [eqMin, eqMax] : null, equityRange), { displayModeBar: false, responsive: true, scrollZoom: true });
}

function updatePerformanceBadge(status) {
  const stateLabel = status.running ? 'Running' : (status.paused ? 'Paused' : 'Idle');
  setText(els.performanceStateBadge, stateLabel);
  els.performanceStateBadge.className = `performance-state-badge ${status.running ? 'status-run' : status.paused ? 'status-wait' : 'status-stop'}`;
}

function applyStatus(status) {
  if (status.available_strategies && status.available_strategies.length) {
    const current = els.strategy.value;
    els.strategy.innerHTML = status.available_strategies.map(name => `<option value="${name}">${name}</option>`).join('');
    els.strategy.value = status.available_strategies.includes(current) ? current : status.strategy || status.available_strategies[0];
  }

  renderCharts(status);

  const stateLabel = status.running ? 'running' : (status.paused ? 'paused' : 'idle');
  setText(els.stateText, stateLabel);
  setText(els.barText, `${status.current_index || 0} / ${status.total_bars || 0}`);
  setText(els.priceText, status.latest_price != null ? Number(status.latest_price).toFixed(2) : '—');
  setText(els.pnlText, status.current_pnl != null ? Number(status.current_pnl).toFixed(2) : '—');
  const tradesCompleted = Number(status.trades_completed || 0);
  const maxTrades = Number(status.max_trades || 0);
  setText(els.tradesProgressText, `${tradesCompleted} / ${maxTrades > 0 ? maxTrades : '∞'}`);
  els.tradesProgressBar.style.width = `${maxTrades > 0 ? Math.min(100, (tradesCompleted / maxTrades) * 100) : 0}%`;
  setText(els.kpiPnl, status.current_pnl != null ? Number(status.current_pnl).toFixed(2) : '—');
  setText(els.kpiEquity, status.current_equity != null ? Number(status.current_equity).toFixed(2) : '—');
  setText(els.kpiPrice, status.latest_price != null ? Number(status.latest_price).toFixed(2) : '—');
  setText(els.kpiPosition, status.current_position ? status.current_position.side.toUpperCase() : 'FLAT');
  setText(els.heroMeta, `${status.symbol || 'BTCUSDT'} • ${status.timeframe || '1m'} • ${status.speed || els.speedSelect.value || 'normal'} • ${status.strategy || els.strategy.value} • max trades ${status.max_trades || 0}`);

  const stats = computeTradeStats(status.trades || []);
  updatePerformance(status);
  updatePerformanceBadge(status);
  updateStatsPanel(stats, status);
  renderTradeFeed(stats.completed);
  renderRunComparison(status.run_history || []);

  if (status.running && !status.current_position) {
    els.statusRibbon.className = 'status-ribbon status-wait';
    setText(els.statusRibbon, `Simulation running • No trade active • Bar ${status.current_index || 0} / ${status.total_bars || 0}`);
  } else if (status.running) {
    els.statusRibbon.className = 'status-ribbon status-run';
    setText(els.statusRibbon, `Simulation running • Position active • Bar ${status.current_index || 0} / ${status.total_bars || 0}`);
  } else if (status.paused) {
    els.statusRibbon.className = 'status-ribbon status-stop';
    setText(els.statusRibbon, 'Simulation paused');
  } else {
    els.statusRibbon.className = 'status-ribbon status-stop';
    setText(els.statusRibbon, status.message || 'Idle');
  }

  els.monitorBox.innerHTML = `
    <div><b>Message:</b> ${status.message || ''}</div>
    <div><b>Current index:</b> ${status.current_index || 0}</div>
    <div><b>Strategy:</b> ${status.strategy || '—'}</div>
    <div><b>Equity peak:</b> ${Number(status.equity_peak || 0).toFixed(2)}</div>
    <div><b>Max drawdown:</b> <span class="pnl-neg">${Number(status.max_drawdown || 0).toFixed(2)}%</span></div>
    <div><b>Current equity:</b> ${status.current_equity != null ? Number(status.current_equity).toFixed(2) : '—'}</div>
    <div><b>Current PnL:</b> <span class="${status.current_pnl > 0 ? 'pnl-pos' : status.current_pnl < 0 ? 'pnl-neg' : 'pnl-flat'}">${status.current_pnl != null ? Number(status.current_pnl).toFixed(2) : '—'}</span></div>
    <div><b>Sharpe-like:</b> ${Number(status.sharpe_like || 0).toFixed(2)}</div>
    <div><b>Batch size:</b> ${status.batch_size || '—'}</div>
    <div><b>Position:</b> ${status.current_position ? JSON.stringify(status.current_position) : 'none'}</div>
  `;
}

function scheduleStatusRefresh(delay = REFRESH_IDLE_MS) {
  clearTimeout(statusLoopHandle);
  statusLoopHandle = setTimeout(refreshStatus, delay);
}

async function refreshStatus() {
  try {
    const status = await fetch(`${API}/status`, { cache: 'no-store' }).then(r => r.json());
    applyStatus(status);
    scheduleStatusRefresh(status.running ? REFRESH_RUNNING_MS : REFRESH_IDLE_MS);
  } catch (e) {
    els.statusRibbon.className = 'status-ribbon status-stop';
    setText(els.statusRibbon, `Backend not reachable: ${e.message}`);
    scheduleStatusRefresh(1500);
  }
}

function resetChartState() {
  userRanges = { price: null, equity: null };
  initEmptyCharts();
  bindChartInteractions();
}

els.sortTimeBtn.onclick = () => { tradeSort = { key: 'time', dir: tradeSort.key === 'time' && tradeSort.dir === 'desc' ? 'asc' : 'desc' }; refreshStatus(); };
els.sortPnlBtn.onclick = () => { tradeSort = { key: 'pnl', dir: tradeSort.key === 'pnl' && tradeSort.dir === 'desc' ? 'asc' : 'desc' }; refreshStatus(); };
els.clearRunsBtn.onclick = async () => { try { await call('/clear-runs', 'POST'); await refreshStatus(); setText(els.statusRibbon, 'Run history cleared'); } catch (e) { els.statusRibbon.className = 'status-ribbon status-stop'; setText(els.statusRibbon, `Clear-runs failed: ${e.message}`); } };

els.exportCsvBtn.onclick = async () => {
  try {
    const data = await fetch(`${API}/runs`, { cache: 'no-store' }).then(r => r.json());
    const runs = data.runs || [];
    const header = ['strategy','score','pnl','winrate','drawdown','sharpe','trades'];
    const rows = runs.map(run => [run.strategy, Number(run.score || 0).toFixed(2), Number(run.total_pnl || 0).toFixed(2), Number(run.winrate || 0).toFixed(2), Number(run.max_drawdown || 0).toFixed(2), Number(run.sharpe_like || 0).toFixed(2), run.trades || 0]);
    const csv = [header, ...rows].map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'run_comparison.csv';
    a.click();
    URL.revokeObjectURL(url);
    setText(els.statusRibbon, 'CSV exported');
  } catch (e) {
    els.statusRibbon.className = 'status-ribbon status-stop';
    setText(els.statusRibbon, `Export failed: ${e.message}`);
  }
};

els.startBtn.onclick = async () => {
  try {
    resetChartState();
    await call('/start', 'POST', {
      strategy: els.strategy.value,
      symbol: els.symbol.value,
      timeframe: els.timeframe.value,
      starting_cash: Number(els.startingCash.value),
      speed: els.speedSelect.value,
      max_trades: Number(els.maxTrades.value || 0),
    });
    await refreshStatus();
  } catch (e) {
    els.statusRibbon.className = 'status-ribbon status-stop';
    setText(els.statusRibbon, `Start failed: ${e.message}`);
  }
};

els.runAllBtn.onclick = async () => {
  try {
    els.statusRibbon.className = 'status-ribbon status-wait';
    setText(els.statusRibbon, 'Running all strategies...');
    await call('/run-all', 'POST', {
      symbol: els.symbol.value,
      timeframe: els.timeframe.value,
      starting_cash: Number(els.startingCash.value),
      speed: els.speedSelect.value,
      max_trades: Number(els.maxTrades.value || 0),
      strategies: selectedStrategies(),
    });
    resetChartState();
    await refreshStatus();
    els.statusRibbon.className = 'status-ribbon status-run';
    setText(els.statusRibbon, 'Batch comparison completed');
  } catch (e) {
    els.statusRibbon.className = 'status-ribbon status-stop';
    setText(els.statusRibbon, `Run-all failed: ${e.message}`);
  }
};

els.pauseBtn.onclick = async () => { try { await call('/pause'); await refreshStatus(); } catch (e) { els.statusRibbon.className = 'status-ribbon status-stop'; setText(els.statusRibbon, `Pause failed: ${e.message}`); } };
els.continueBtn.onclick = async () => { try { await call('/continue'); await refreshStatus(); } catch (e) { els.statusRibbon.className = 'status-ribbon status-stop'; setText(els.statusRibbon, `Continue failed: ${e.message}`); } };
els.resetBtn.onclick = async () => { try { await call('/reset'); resetChartState(); await refreshStatus(); } catch (e) { els.statusRibbon.className = 'status-ribbon status-stop'; setText(els.statusRibbon, `Reset failed: ${e.message}`); } };
els.symbol.onchange = () => { loadTimeframeAvailability(); };

els.themePreset.onchange = () => { applyThemePreset(els.themePreset.value); refreshStatus(); };
els.bullColor.oninput = () => { chartTheme.bull = els.bullColor.value; saveSettings(); refreshStatus(); };
els.bearColor.oninput = () => { chartTheme.bear = els.bearColor.value; saveSettings(); refreshStatus(); };
els.wickColor.oninput = () => { chartTheme.wick = els.wickColor.value; saveSettings(); refreshStatus(); };
els.borderColor.oninput = () => { chartTheme.border = els.borderColor.value; saveSettings(); refreshStatus(); };
els.bgColor.oninput = () => { chartTheme.background = els.bgColor.value; saveSettings(); refreshStatus(); };
els.gridColor.oninput = () => { chartTheme.grid = els.gridColor.value; saveSettings(); refreshStatus(); };
els.scaleMode.onchange = () => { chartTheme.scaleMode = els.scaleMode.value; saveSettings(); refreshStatus(); };
els.autoFitToggle.onchange = () => { chartTheme.autoFit = els.autoFitToggle.checked; saveSettings(); refreshStatus(); };
els.showGridToggle.onchange = () => { chartTheme.showGrid = els.showGridToggle.checked; saveSettings(); refreshStatus(); };
els.preserveZoomToggle.onchange = () => { preserveZoomEnabled = els.preserveZoomToggle.checked; saveSettings(); refreshStatus(); };
els.liveFollowToggle.onchange = () => { liveFollowEnabled = els.liveFollowToggle.checked; saveSettings(); refreshStatus(); };
els.fitTradesToggle.onchange = () => { fitTradesEnabled = els.fitTradesToggle.checked; saveSettings(); refreshStatus(); };

if (els.strategySearch) {
  els.strategySearch.oninput = () => renderStrategyChecklist(els.strategySearch.value);
}
if (els.selectAllStrategiesBtn) {
  els.selectAllStrategiesBtn.onclick = () => {
    els.strategyChecklist.querySelectorAll('input[type="checkbox"]').forEach(input => { input.checked = true; });
    updateStrategyCount();
  };
}
if (els.clearStrategiesBtn) {
  els.clearStrategiesBtn.onclick = () => {
    els.strategyChecklist.querySelectorAll('input[type="checkbox"]').forEach(input => { input.checked = false; });
    updateStrategyCount();
  };
}
if (els.strategyChecklist) {
  els.strategyChecklist.addEventListener('change', (event) => {
    if (event.target?.matches('input[type="checkbox"]')) updateStrategyCount();
  });
}

loadSettings();
syncSettingsUI();
initEmptyCharts();
bindChartInteractions();
loadStrategies();
loadTimeframeAvailability();
refreshStatus();
setInterval(loadTimeframeAvailability, AVAILABILITY_REFRESH_MS);
