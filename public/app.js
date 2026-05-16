const WL = [
  ["AI Infrastructure", ["NVDA", "AMD", "AVGO", "ARM"]],
  ["Megacap Tech", ["AAPL", "MSFT", "META", "GOOGL", "AMZN", "TSLA"]],
  ["Semis", ["MU", "QCOM", "MRVL", "INTC"]],
  ["High Beta", ["PLTR", "COIN", "RBLX", "SHOP"]]
];

const quotes = {
  AAPL: [189.2, 0.84], MSFT: [426.6, 0.42], NVDA: [132.8, 1.94], AMZN: [183.1, -0.28],
  META: [471.4, 0.74], GOOGL: [174.3, -0.16], TSLA: [184.8, -1.72], AMD: [161.5, 1.11],
  AVGO: [1398.2, 0.67], ARM: [118.5, 2.22], MU: [126.7, 0.35], QCOM: [205.9, -0.4],
  MRVL: [78.6, 0.91], INTC: [31.9, -0.7], PLTR: [24.2, 3.1], COIN: [228.6, -2.3],
  RBLX: [38.7, 1.4], SHOP: [63.8, 0.5]
};

const strategyCatalog = [
  {
    name: "Call Bias Scenario",
    bias: "CALL",
    desc: "Models upside exposure using a near-the-money call and a defined premium-at-risk view.",
    best: "Positive score, lower IV",
    type: "call",
    strike: (s) => r5(s * 1.03)
  },
  {
    name: "Put Bias Scenario",
    bias: "PUT",
    desc: "Models downside exposure using a near-the-money put and a defined premium-at-risk view.",
    best: "Negative score, weak momentum",
    type: "put",
    strike: (s) => r5(s * 0.97)
  },
  {
    name: "Neutral Volatility Scenario",
    bias: "NEUTRAL",
    desc: "Models a two-sided move where direction is unclear but expected move is elevated.",
    best: "Mixed score, high IV",
    type: "call",
    strike: (s) => r5(s)
  },
  {
    name: "Range Compression Scenario",
    bias: "NEUTRAL",
    desc: "Models a lower-direction setup where realized volatility is below implied volatility.",
    best: "Low realized vol",
    type: "call",
    strike: (s) => r5(s * 1.05)
  },
  {
    name: "Event Expansion Scenario",
    bias: "VOL",
    desc: "Models larger expected movement into a catalyst by raising volatility assumptions.",
    best: "High expected move",
    type: "put",
    strike: (s) => r5(s)
  },
  {
    name: "Hedge Scenario",
    bias: "PUT",
    desc: "Models protective downside exposure against a long underlying assumption.",
    best: "Risk control",
    type: "put",
    strike: (s) => r5(s * 0.95)
  }
];

const state = {
  ticker: "AAPL",
  price: 189.2,
  change: 0.84,
  positions: [],
  user: null,
  chartRange: "1M",
  chartMode: "candles",
  chartHover: null,
  candles: [],
  indicators: {
    vwap: true,
    sma: false,
    ema: true,
    orderBlocks: false,
    fvg: false,
    trend: true
  },
  indicatorData: {
    vwap: [],
    sma: [],
    ema: [],
    orderBlocks: [],
    fvg: [],
    confluence: [],
    trendState: "neutral",
    confluenceScore: 0
  },
  model: null,
  pulseTimer: null,
  liveTimer: null,
  live: {
    active: false,
    lastUpdate: null,
    source: "model",
    quotes: {},
    baseline: {}
  },
  positionId: 1,
  resetInputs: true
};

function qs(id) { return document.getElementById(id); }
function money(v) { return `$${Number(v).toFixed(2)}`; }
function pct(v) { return `${Number(v) >= 0 ? "+" : ""}${Number(v).toFixed(2)}%`; }
function r5(v) { return Math.round(v / 5) * 5; }
function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

function loadPrefs() {
  try {
    return JSON.parse(window.localStorage?.getItem("optionai:prefs") || "{}");
  } catch {
    return {};
  }
}

function savePrefs(patch = {}) {
  try {
    const current = loadPrefs();
    window.localStorage?.setItem("optionai:prefs", JSON.stringify({ ...current, ...patch }));
  } catch {
    // Storage can be unavailable in private browsing or strict file contexts.
  }
}

function applyPrefs() {
  const prefs = loadPrefs();
  if (typeof prefs.liveFeed === "boolean") qs("liveFeedInput").checked = prefs.liveFeed;
  if (typeof prefs.autoPulse === "boolean") qs("autoPulseInput").checked = prefs.autoPulse;
  if (prefs.trend) qs("trendInput").value = prefs.trend;
  if (prefs.volRegime) qs("volRegimeInput").value = prefs.volRegime;
  if (prefs.indicators) {
    state.indicators = { ...state.indicators, ...prefs.indicators };
  }
  document.querySelectorAll("[data-indicator]").forEach((input) => {
    input.checked = Boolean(state.indicators[input.dataset.indicator]);
  });
  renderIndicatorControls();
  if (prefs.chartRange) {
    state.chartRange = prefs.chartRange;
    document.querySelectorAll("#rangeButtons button").forEach((button) => {
      button.classList.toggle("active", button.dataset.range === state.chartRange);
    });
  }
  if (prefs.chartMode) {
    state.chartMode = prefs.chartMode;
    document.querySelectorAll("#chartModeButtons button").forEach((button) => {
      button.classList.toggle("active", button.dataset.mode === state.chartMode);
    });
  }
}

function renderIndicatorControls() {
  document.querySelectorAll("[data-indicator]").forEach((input) => {
    input.checked = Boolean(state.indicators[input.dataset.indicator]);
    input.closest("label")?.classList.toggle("active", input.checked);
  });
}

const supabaseConfig = window.OPTIONAI_SUPABASE || {};
const hasSupabaseConfig = Boolean(
  supabaseConfig.url &&
  supabaseConfig.anonKey &&
  !supabaseConfig.url.includes("YOUR_PROJECT_REF") &&
  !supabaseConfig.anonKey.includes("YOUR_SUPABASE")
);
const supabaseClient = hasSupabaseConfig && window.supabase
  ? window.supabase.createClient(supabaseConfig.url, supabaseConfig.anonKey)
  : null;

function setAuthMessage(message, isError = true) {
  const el = qs("authMessage");
  el.textContent = message || "";
  el.style.color = isError ? "var(--red)" : "var(--green)";
}

function showApp(user) {
  state.user = user;
  qs("authScreen").classList.add("hidden");
  document.querySelector(".shell").classList.remove("auth-pending");
  resizeChart();
  if (qs("liveFeedInput")?.checked) startLiveFeed();
}

function showAuth(message = "") {
  state.user = null;
  stopLiveFeed();
  qs("authScreen").classList.remove("hidden");
  document.querySelector(".shell").classList.add("auth-pending");
  setAuthMessage(message);
}

async function initAuth() {
  if (!supabaseClient) {
    showAuth("Add your Supabase URL and anon key in supabase-config.js.");
    return;
  }

  const { data, error } = await supabaseClient.auth.getSession();
  if (error) showAuth(error.message);
  else if (data.session?.user) showApp(data.session.user);
  else showAuth();

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    if (session?.user) showApp(session.user);
    else showAuth();
  });

  qs("authForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    setAuthMessage("Signing in...", false);
    const email = qs("authEmail").value.trim();
    const password = qs("authPassword").value;
    const { error: signInError } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (signInError) setAuthMessage(signInError.message);
  });

  qs("logoutButton").addEventListener("click", async () => {
    await supabaseClient.auth.signOut();
  });
}

function ncdf(x) {
  const a = [0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429];
  const p = 0.3275911;
  const s = x < 0 ? -1 : 1;
  const z = Math.abs(x);
  const t = 1 / (1 + p * z);
  const y = 1 - (((((a[4] * t + a[3]) * t) + a[2]) * t + a[1]) * t + a[0]) * t * Math.exp(-z * z);
  return 0.5 * (1 + s * y);
}

function npdf(x) { return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI); }

function bs(S, K, T, r, sig, type) {
  if (!S || !K || T <= 0 || !sig) return null;
  const d1 = (Math.log(S / K) + (r + sig * sig / 2) * T) / (sig * Math.sqrt(T));
  const d2 = d1 - sig * Math.sqrt(T);
  const eRT = Math.exp(-r * T);
  const nd1 = ncdf(d1);
  const npd1 = npdf(d1);
  const price = type === "call"
    ? S * nd1 - K * eRT * ncdf(d2)
    : K * eRT * ncdf(-d2) - S * ncdf(-d1);
  const delta = type === "call" ? nd1 : nd1 - 1;
  const gamma = npd1 / (S * sig * Math.sqrt(T));
  const theta = type === "call"
    ? (-(S * npd1 * sig) / (2 * Math.sqrt(T)) - r * K * eRT * ncdf(d2)) / 365
    : (-(S * npd1 * sig) / (2 * Math.sqrt(T)) + r * K * eRT * ncdf(-d2)) / 365;
  const vega = S * npd1 * Math.sqrt(T) / 100;
  const rho = type === "call" ? K * T * eRT * ncdf(d2) / 100 : -K * T * eRT * ncdf(-d2) / 100;
  return { price, delta, gamma, theta, vega, rho };
}

function hashTicker(value) {
  return [...value].reduce((acc, char) => ((acc << 5) - acc + char.charCodeAt(0)) >>> 0, 2166136261);
}

function seededRandom(seed) {
  let x = seed >>> 0;
  return () => {
    x += 0x6D2B79F5;
    let t = x;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rangePoints() {
  return { "1D": 78, "5D": 120, "1M": 96, "3M": 132 }[state.chartRange] || 96;
}

function expiryDates() {
  return [14, 21, 30, 45, 60, 90, 120].map((days) => {
    const date = new Date(Date.now() + days * 86400000);
    const move = ((5 - date.getDay()) + 7) % 7 || 7;
    date.setDate(date.getDate() + move);
    return date.toISOString().slice(0, 10);
  });
}

function daysToExpiry(value) {
  return Math.max(0, Math.ceil((new Date(value) - Date.now()) / 86400000));
}

function getT(value = qs("expirySelect").value) {
  return Math.max(0.002, (new Date(value) - Date.now()) / 31536000000);
}

function getRate() {
  return (Number(qs("rateInput").value) || 5.25) / 100;
}

function getIv() {
  return Math.max(1, Number(qs("ivInput").value) || 32);
}

function generateCandles(ticker = state.ticker) {
  const count = rangePoints();
  const [basePrice, change] = quotes[ticker] || syntheticQuote(ticker);
  const iv = getIv() / 100;
  const random = seededRandom(hashTicker(`${ticker}:${state.chartRange}:${Math.round(iv * 100)}`));
  const drift = change / 100 / count;
  const noise = Math.max(0.002, iv / Math.sqrt(252) / 2.7);
  const candles = [];
  let close = basePrice * (1 - change / 100);

  for (let i = 0; i < count; i += 1) {
    const open = close;
    const shock = (random() - 0.5) * noise * open;
    const trend = drift * open;
    close = Math.max(0.5, open + shock + trend);
    const spread = Math.max(open, close) * (0.002 + random() * noise);
    const high = Math.max(open, close) + spread;
    const low = Math.max(0.1, Math.min(open, close) - spread);
    candles.push({
      t: i,
      open,
      high,
      low,
      close,
      volume: Math.round(250000 + random() * 1800000)
    });
  }

  state.candles = candles;
  state.price = candles[candles.length - 1].close;
  state.change = ((state.price - candles[0].open) / candles[0].open) * 100;
}

function syntheticQuote(ticker) {
  const seed = hashTicker(ticker);
  const price = 25 + (seed % 260);
  const change = ((seed % 700) - 350) / 100;
  return [price, change];
}

function allDashboardTickers() {
  return [...new Set([
    ...WL.flatMap(([, tickers]) => tickers),
    state.ticker,
    ...state.positions.map((pos) => pos.symbol)
  ].filter(Boolean).map((ticker) => ticker.toUpperCase()))];
}

function currentPriceFor(ticker) {
  const symbol = ticker.toUpperCase();
  return state.live.quotes[symbol]?.price ?? (quotes[symbol] || syntheticQuote(symbol))[0];
}

function currentChangeFor(ticker) {
  const symbol = ticker.toUpperCase();
  const live = state.live.quotes[symbol];
  if (live) {
    const base = state.live.baseline[symbol] || live.price;
    return base ? ((live.price - base) / base) * 100 : 0;
  }
  return (quotes[symbol] || syntheticQuote(symbol))[1] || 0;
}

function rollingSma(period = 20) {
  return state.candles.map((_, index) => {
    if (index + 1 < period) return null;
    const slice = state.candles.slice(index + 1 - period, index + 1);
    return slice.reduce((sum, c) => sum + c.close, 0) / period;
  });
}

function rollingEma(period = 21) {
  const k = 2 / (period + 1);
  let ema = null;
  return state.candles.map((c, index) => {
    if (ema === null) {
      const seed = state.candles.slice(0, Math.min(period, index + 1));
      ema = seed.reduce((sum, item) => sum + item.close, 0) / seed.length;
    } else {
      ema = c.close * k + ema * (1 - k);
    }
    return ema;
  });
}

function rollingVwap() {
  let pv = 0;
  let vol = 0;
  return state.candles.map((c) => {
    const typical = (c.high + c.low + c.close) / 3;
    pv += typical * c.volume;
    vol += c.volume;
    return vol ? pv / vol : typical;
  });
}

function detectOrderBlocks() {
  const blocks = [];
  const volumes = state.candles.map((c) => c.volume);
  const avgVolume = volumes.reduce((sum, v) => sum + v, 0) / Math.max(1, volumes.length);
  for (let i = 2; i < state.candles.length - 2; i += 1) {
    const c = state.candles[i];
    const next = state.candles[i + 1];
    const wide = Math.abs(c.close - c.open) > (c.high - c.low) * 0.42;
    const highVolume = c.volume > avgVolume * 1.18;
    if (!wide || !highVolume) continue;
    if (c.close < c.open && next.close > c.high) {
      blocks.push({ start: i, end: state.candles.length - 1, low: c.low, high: c.open, type: "bullish" });
    }
    if (c.close > c.open && next.close < c.low) {
      blocks.push({ start: i, end: state.candles.length - 1, low: c.open, high: c.high, type: "bearish" });
    }
  }
  return blocks.slice(-4);
}

function detectFairValueGaps() {
  const gaps = [];
  for (let i = 2; i < state.candles.length; i += 1) {
    const left = state.candles[i - 2];
    const right = state.candles[i];
    if (right.low > left.high) {
      gaps.push({ start: i - 2, end: state.candles.length - 1, low: left.high, high: right.low, type: "bullish" });
    }
    if (right.high < left.low) {
      gaps.push({ start: i - 2, end: state.candles.length - 1, low: right.high, high: left.low, type: "bearish" });
    }
  }
  return gaps.slice(-5);
}

function calculateIndicators() {
  const sma = rollingSma(20);
  const ema = rollingEma(21);
  const vwap = rollingVwap();
  const orderBlocks = detectOrderBlocks();
  const fvg = detectFairValueGaps();
  const last = state.candles[state.candles.length - 1];
  const lastSma = sma[sma.length - 1] || last.close;
  const lastEma = ema[ema.length - 1] || last.close;
  const lastVwap = vwap[vwap.length - 1] || last.close;
  const emaPrev = ema[Math.max(0, ema.length - 8)] || lastEma;
  const emaSlope = ((lastEma - emaPrev) / Math.max(0.01, emaPrev)) * 100;
  const nearPct = Math.abs(last.close - lastVwap) / last.close * 100;
  const confluence = [];

  const add = (label, score, value) => {
    confluence.push({
      label,
      score,
      value,
      side: score > 0.5 ? "call" : score < -0.5 ? "put" : "neutral"
    });
  };

  add("VWAP", last.close > lastVwap ? 12 : -12, last.close > lastVwap ? "Above" : "Below");
  add("EMA", last.close > lastEma && emaSlope > 0 ? 14 : last.close < lastEma && emaSlope < 0 ? -14 : 0, `${emaSlope >= 0 ? "+" : ""}${emaSlope.toFixed(2)}% slope`);
  add("SMA", last.close > lastSma ? 8 : -8, last.close > lastSma ? "Above" : "Below");

  const activeBlock = [...orderBlocks].reverse().find((block) => last.close >= block.low && last.close <= block.high);
  if (activeBlock) add("Order block", activeBlock.type === "bullish" ? 10 : -10, activeBlock.type);
  else add("Order block", 0, "No active zone");

  const activeGap = [...fvg].reverse().find((gap) => last.close >= gap.low && last.close <= gap.high);
  if (activeGap) add("Fair value gap", activeGap.type === "bullish" ? 9 : -9, activeGap.type);
  else add("Fair value gap", 0, "No active gap");

  let trendState = "neutral";
  if (last.close > lastVwap && lastEma > lastSma && emaSlope > 0.05) trendState = "bullish";
  else if (last.close < lastVwap && lastEma < lastSma && emaSlope < -0.05) trendState = "bearish";
  else if (nearPct < 0.35 || Math.abs(emaSlope) < 0.03) trendState = "range";

  const trendScore = trendState === "bullish" ? 16 : trendState === "bearish" ? -16 : 0;
  add("Trend state", trendScore, trendState);

  state.indicatorData = {
    sma,
    ema,
    vwap,
    orderBlocks,
    fvg,
    confluence,
    trendState,
    confluenceScore: confluence.reduce((sum, item) => sum + item.score, 0)
  };
}

function resizeChart() {
  const canvas = qs("priceChart");
  if (!canvas) return;
  const frame = canvas.parentElement;
  const rect = frame.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = Math.max(320, rect.width - 2);
  const cssHeight = Math.max(280, Math.min(430, Math.round(window.innerHeight * 0.42)));
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  drawChart();
}

function drawChart() {
  const canvas = qs("priceChart");
  if (!canvas || !state.candles.length) return;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const pad = { left: 10, right: 68, top: 18, bottom: 28 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const highs = state.candles.map((c) => c.high);
  const lows = state.candles.map((c) => c.low);
  const max = Math.max(...highs);
  const min = Math.min(...lows);
  const buffer = Math.max(0.01, (max - min) * 0.12);
  const yMax = max + buffer;
  const yMin = min - buffer;
  const yFor = (price) => pad.top + (yMax - price) / (yMax - yMin) * plotH;
  const xFor = (i) => pad.left + i / Math.max(1, state.candles.length - 1) * plotW;

  ctx.fillStyle = "#06080d";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(141, 152, 168, 0.13)";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#8d98a8";
  ctx.font = "12px system-ui, sans-serif";
  for (let i = 0; i <= 4; i += 1) {
    const y = pad.top + (plotH / 4) * i;
    const price = yMax - ((yMax - yMin) / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
    ctx.fillText(money(price), width - pad.right + 10, y + 4);
  }

  drawIndicatorZones(ctx, xFor, yFor, pad, width, height);
  if (state.chartMode === "line") drawLineChart(ctx, xFor, yFor, pad, width, height);
  else drawCandles(ctx, xFor, yFor, plotW);
  drawIndicatorLines(ctx, xFor, yFor);
  drawTrendBadge(ctx, pad);

  const last = state.candles[state.candles.length - 1];
  const lastY = yFor(last.close);
  ctx.strokeStyle = state.change >= 0 ? "rgba(66, 217, 130, 0.8)" : "rgba(255, 100, 115, 0.8)";
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(pad.left, lastY);
  ctx.lineTo(width - pad.right, lastY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = state.change >= 0 ? "#42d982" : "#ff6473";
  ctx.fillText(money(last.close), width - pad.right + 10, lastY - 8);

  if (state.chartHover !== null) drawCrosshair(ctx, xFor, yFor, pad, width, height);
}

function drawIndicatorZones(ctx, xFor, yFor, pad, width, height) {
  const drawZone = (zone, color) => {
    const x = xFor(zone.start);
    const y1 = yFor(zone.high);
    const y2 = yFor(zone.low);
    ctx.fillStyle = color;
    ctx.fillRect(x, Math.min(y1, y2), width - pad.right - x, Math.max(2, Math.abs(y2 - y1)));
  };
  if (state.indicators.orderBlocks) {
    state.indicatorData.orderBlocks.forEach((zone) => {
      drawZone(zone, zone.type === "bullish" ? "rgba(66, 217, 130, 0.08)" : "rgba(255, 100, 115, 0.08)");
    });
    if (!state.indicatorData.orderBlocks.length) drawNoZoneNote(ctx, "No order block zones detected", pad.left + 12, pad.top + 42);
  }
  if (state.indicators.fvg) {
    state.indicatorData.fvg.forEach((zone) => {
      drawZone(zone, zone.type === "bullish" ? "rgba(106, 180, 255, 0.07)" : "rgba(245, 185, 66, 0.07)");
    });
    if (!state.indicatorData.fvg.length) drawNoZoneNote(ctx, "No fair value gaps detected", pad.left + 12, pad.top + (state.indicators.orderBlocks ? 66 : 42));
  }
}

function drawNoZoneNote(ctx, text, x, y) {
  const width = ctx.measureText ? ctx.measureText(text).width + 14 : 160;
  ctx.fillStyle = "rgba(11, 16, 24, 0.78)";
  ctx.fillRect(x, y, width, 22);
  ctx.fillStyle = "rgba(141, 152, 168, 0.9)";
  ctx.font = "11px system-ui, sans-serif";
  ctx.fillText(text, x + 7, y + 15);
}

function drawSeriesLine(ctx, series, xFor, yFor, color, dash = [], label = "") {
  ctx.beginPath();
  let started = false;
  series.forEach((value, index) => {
    if (value === null || !Number.isFinite(value)) return;
    const x = xFor(index);
    const y = yFor(value);
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  });
  if (!started) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.4;
  ctx.setLineDash(dash);
  ctx.stroke();
  ctx.setLineDash([]);

  if (label) {
    let lastIndex = series.length - 1;
    while (lastIndex >= 0 && (series[lastIndex] === null || !Number.isFinite(series[lastIndex]))) lastIndex -= 1;
    const value = series[lastIndex];
    if (value !== null && Number.isFinite(value)) {
      const x = xFor(lastIndex);
      const y = yFor(value);
      const text = `${label} ${money(value)}`;
      const boxWidth = ctx.measureText ? ctx.measureText(text).width + 12 : 92;
      ctx.fillStyle = "rgba(6, 8, 13, 0.86)";
      ctx.fillRect(x - boxWidth - 8, y - 10, boxWidth, 20);
      ctx.strokeStyle = color;
      ctx.strokeRect(x - boxWidth - 8, y - 10, boxWidth, 20);
      ctx.fillStyle = color;
      ctx.font = "11px system-ui, sans-serif";
      ctx.fillText(text, x - boxWidth - 2, y + 4);
    }
  }
}

function drawIndicatorLines(ctx, xFor, yFor) {
  if (state.indicators.vwap) drawSeriesLine(ctx, state.indicatorData.vwap, xFor, yFor, "rgba(245, 185, 66, 0.95)", [6, 4], "VWAP");
  if (state.indicators.sma) drawSeriesLine(ctx, state.indicatorData.sma, xFor, yFor, "rgba(185, 144, 255, 0.92)", [2, 4], "SMA");
  if (state.indicators.ema) drawSeriesLine(ctx, state.indicatorData.ema, xFor, yFor, "rgba(106, 180, 255, 0.96)", [], "EMA");
}

function drawTrendBadge(ctx, pad) {
  if (!state.indicators.trend) return;
  const trend = state.indicatorData.trendState;
  const label = `Trend: ${trend[0].toUpperCase()}${trend.slice(1)}`;
  ctx.font = "12px system-ui, sans-serif";
  const width = ctx.measureText ? ctx.measureText(label).width + 18 : 110;
  ctx.fillStyle = trend === "bullish" ? "rgba(66, 217, 130, 0.12)" : trend === "bearish" ? "rgba(255, 100, 115, 0.12)" : "rgba(245, 185, 66, 0.12)";
  ctx.strokeStyle = trend === "bullish" ? "rgba(66, 217, 130, 0.42)" : trend === "bearish" ? "rgba(255, 100, 115, 0.42)" : "rgba(245, 185, 66, 0.42)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect?.(pad.left + 10, pad.top + 8, width, 26, 8);
  if (ctx.roundRect) {
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.fillRect(pad.left + 10, pad.top + 8, width, 26);
  }
  ctx.fillStyle = trend === "bullish" ? "#42d982" : trend === "bearish" ? "#ff6473" : "#f5b942";
  ctx.fillText(label, pad.left + 19, pad.top + 26);
}

function drawLineChart(ctx, xFor, yFor, pad, width, height) {
  const firstY = yFor(state.candles[0].close);
  const lastY = yFor(state.candles[state.candles.length - 1].close);
  const grad = ctx.createLinearGradient(0, firstY, 0, height - pad.bottom);
  grad.addColorStop(0, "rgba(106, 180, 255, 0.26)");
  grad.addColorStop(1, "rgba(106, 180, 255, 0)");

  ctx.beginPath();
  state.candles.forEach((c, i) => {
    const x = xFor(i);
    const y = yFor(c.close);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.lineTo(xFor(state.candles.length - 1), height - pad.bottom);
  ctx.lineTo(xFor(0), height - pad.bottom);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  state.candles.forEach((c, i) => {
    const x = xFor(i);
    const y = yFor(c.close);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = lastY <= firstY ? "#42d982" : "#ff6473";
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawCandles(ctx, xFor, yFor, plotW) {
  const bodyW = clamp(plotW / state.candles.length * 0.58, 3, 11);
  state.candles.forEach((c, i) => {
    const x = xFor(i);
    const up = c.close >= c.open;
    const color = up ? "#42d982" : "#ff6473";
    const openY = yFor(c.open);
    const closeY = yFor(c.close);
    const highY = yFor(c.high);
    const lowY = yFor(c.low);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, highY);
    ctx.lineTo(x, lowY);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillRect(x - bodyW / 2, Math.min(openY, closeY), bodyW, Math.max(2, Math.abs(openY - closeY)));
  });
}

function drawCrosshair(ctx, xFor, yFor, pad, width, height) {
  const index = clamp(state.chartHover, 0, state.candles.length - 1);
  const candle = state.candles[index];
  const x = xFor(index);
  const y = yFor(candle.close);
  ctx.strokeStyle = "rgba(238, 243, 248, 0.32)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, pad.top);
  ctx.lineTo(x, height - pad.bottom);
  ctx.moveTo(pad.left, y);
  ctx.lineTo(width - pad.right, y);
  ctx.stroke();
  qs("chartReadout").textContent = `O ${money(candle.open)} H ${money(candle.high)} L ${money(candle.low)} C ${money(candle.close)} Vol ${candle.volume.toLocaleString()}`;
}

function pulseChart() {
  if (!qs("autoPulseInput").checked || !state.candles.length || state.live.active) return;
  const last = state.candles[state.candles.length - 1];
  const score = state.model ? state.model.score / 100 : 0;
  const iv = getIv() / 100;
  const random = seededRandom(Date.now() + hashTicker(state.ticker));
  const open = last.close;
  const directional = open * score * 0.0008;
  const noise = open * (random() - 0.5) * iv * 0.012;
  const close = Math.max(0.5, open + directional + noise);
  const spread = Math.max(open, close) * (0.0015 + random() * iv * 0.006);
  state.candles.push({
    t: last.t + 1,
    open,
    high: Math.max(open, close) + spread,
    low: Math.max(0.1, Math.min(open, close) - spread),
    close,
    volume: Math.round(250000 + random() * 1800000)
  });
  while (state.candles.length > rangePoints()) state.candles.shift();
  state.price = close;
  state.change = ((state.price - state.candles[0].open) / state.candles[0].open) * 100;
  renderAll(false);
  qs("chartStatus").textContent = `Modeled pulse updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
}

function stopLiveFeed() {
  if (state.liveTimer) window.clearInterval(state.liveTimer);
  state.liveTimer = null;
  state.live.active = false;
  state.live.source = "model";
}

function liveStatus(message) {
  const el = qs("chartStatus");
  if (el) el.textContent = message;
}

async function fetchLiveTrade() {
  if (!qs("liveFeedInput").checked) return;
  if (!supabaseClient || !state.user) {
    state.live.active = false;
    liveStatus("Live feed needs Supabase sign-in and deployed market-data function.");
    return;
  }

  const tickers = allDashboardTickers();
  const { data, error } = await supabaseClient.functions.invoke("market-data", {
    body: { tickers }
  });

  if (error) throw new Error(error.message || "Live feed request failed");
  if (!data) throw new Error("Live feed returned no data");

  if (Array.isArray(data.quotes)) applyLiveQuotes(data.quotes);
  else if (typeof data.price === "number") applyLiveQuotes([data]);
  else throw new Error("Live feed returned no prices");
}

function applyLiveQuotes(feedQuotes) {
  const now = new Date();
  feedQuotes.forEach((quote) => {
    const symbol = String(quote.ticker || "").toUpperCase();
    const price = Number(quote.price);
    if (!symbol || !Number.isFinite(price) || price <= 0) return;
    if (!state.live.baseline[symbol]) state.live.baseline[symbol] = currentPriceFor(symbol);
    state.live.quotes[symbol] = {
      ...quote,
      ticker: symbol,
      price,
      updatedAt: now
    };
  });

  const selected = state.live.quotes[state.ticker];
  if (!selected) throw new Error(`No live price for ${state.ticker}`);
  applyLiveTrade(selected);
}

function applyLiveTrade(trade) {
  const price = Number(trade.price);
  if (!Number.isFinite(price) || price <= 0 || !state.candles.length) return;
  const last = state.candles[state.candles.length - 1];
  const open = last.close;
  const spread = Math.max(open, price) * 0.0018;
  state.candles.push({
    t: last.t + 1,
    open,
    high: Math.max(open, price, trade.high || 0) + spread,
    low: Math.max(0.1, Math.min(open, price, trade.low || Number.POSITIVE_INFINITY) - spread),
    close: price,
    volume: Number(trade.size || trade.volume || last.volume || 0)
  });
  while (state.candles.length > rangePoints()) state.candles.shift();
  state.price = price;
  state.change = ((state.price - state.candles[0].open) / state.candles[0].open) * 100;
  state.live.active = true;
  state.live.lastUpdate = new Date();
  state.live.source = trade.source || "Live feed";
  renderAll(false);
  liveStatus(`${state.live.source} updated ${allDashboardTickers().length} dashboard tickers at ${state.live.lastUpdate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`);
}

function startLiveFeed() {
  stopLiveFeed();
  if (!qs("liveFeedInput").checked) {
    liveStatus("Modeled pulse. No private market-data key exposed.");
    return;
  }
  liveStatus("Starting secure live feed...");
  fetchLiveTrade().catch((error) => {
    state.live.active = false;
    liveStatus(`Live feed unavailable: ${error.message}. Using modeled pulse fallback.`);
  });
  state.liveTimer = window.setInterval(() => {
    fetchLiveTrade().catch((error) => {
      state.live.active = false;
      liveStatus(`Live feed unavailable: ${error.message}. Using modeled pulse fallback.`);
    });
  }, 10000);
}

function realizedVol() {
  if (state.candles.length < 3) return 0;
  const returns = state.candles.slice(1).map((c, i) => Math.log(c.close / state.candles[i].close));
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

function calculateModel() {
  const iv = getIv();
  const rv = realizedVol();
  const T = getT();
  const dte = daysToExpiry(qs("expirySelect").value);
  const lookback = Math.min(24, state.candles.length - 1);
  const recent = state.candles[state.candles.length - 1].close;
  const prior = state.candles[state.candles.length - 1 - lookback].close;
  const momentum = ((recent - prior) / prior) * 100;
  const sma = state.candles.slice(-20).reduce((sum, c) => sum + c.close, 0) / Math.min(20, state.candles.length);
  const priceVsSma = ((recent - sma) / sma) * 100;
  const trendScope = qs("trendInput").value;
  const volRegime = qs("volRegimeInput").value;
  const scopeMultiplier = trendScope === "short" ? 1.2 : trendScope === "long" ? 0.82 : 1;
  const volMultiplier = volRegime === "high" ? 0.78 : volRegime === "low" ? 1.08 : 1;
  const momentumScore = clamp(momentum / 5, -1, 1) * 42;
  const trendScore = clamp(state.change / 4, -1, 1) * 28;
  const smaScore = clamp(priceVsSma / 4, -1, 1) * 18;
  const ivDrag = Math.max(0, iv - 65) * 0.28;
  const enabledConfluence = state.indicatorData.confluence.filter((item) => {
    if (item.label === "VWAP") return state.indicators.vwap;
    if (item.label === "EMA") return state.indicators.ema;
    if (item.label === "SMA") return state.indicators.sma;
    if (item.label === "Order block") return state.indicators.orderBlocks;
    if (item.label === "Fair value gap") return state.indicators.fvg;
    if (item.label === "Trend state") return state.indicators.trend;
    return true;
  });
  const confluenceScore = enabledConfluence.reduce((sum, item) => sum + item.score, 0);
  const score = clamp((momentumScore + trendScore + smaScore + confluenceScore * 0.45) * scopeMultiplier * volMultiplier, -100, 100);
  const adjusted = score > 0 ? score - ivDrag : score + ivDrag;
  const output = adjusted > 18 ? "CALL" : adjusted < -18 ? "PUT" : "NEUTRAL";
  const confidence = clamp(42 + Math.abs(adjusted) * 0.48 - Math.max(0, iv - rv) * 0.08 - (dte < 7 ? 9 : 0), 18, 94);
  const expectedMove = state.price * (iv / 100) * Math.sqrt(T);
  state.model = {
    output,
    score: adjusted,
    confidence,
    momentum,
    priceVsSma,
    confluenceScore,
    trendState: state.indicatorData.trendState,
    rv,
    iv,
    dte,
    expectedMove,
    rate: getRate() * 100,
    explanation: modelExplanation(output, adjusted, momentum, priceVsSma, iv, rv, expectedMove, confluenceScore, state.indicatorData.trendState)
  };
}

function modelExplanation(output, score, momentum, priceVsSma, iv, rv, expectedMove, confluenceScore, trendState) {
  const direction = output === "CALL"
    ? "positive price momentum and trend alignment"
    : output === "PUT"
      ? "negative price momentum and downside trend alignment"
      : "mixed directional evidence";
  const volText = iv > rv
    ? "implied volatility is above realized volatility, so premium sensitivity is important"
    : "realized volatility is above implied volatility, so the model allows wider movement";
  return `The ${output} output comes from ${direction}. Momentum is ${pct(momentum)}, price versus short average is ${pct(priceVsSma)}, trend state is ${trendState}, and indicator confluence contributes ${confluenceScore.toFixed(1)} points. ${volText}. The one-expiry expected move is about ${money(expectedMove)}.`;
}

function renderModel() {
  calculateModel();
  const model = state.model;
  qs("verdictPill").textContent = model.output;
  qs("verdictPill").className = `verdict ${model.output.toLowerCase()}`;
  qs("modelTitle").textContent = `${model.output} statistical signal`;
  qs("modelText").textContent = model.output === "CALL"
    ? "The current inputs produce an upside statistical bias. This is a calculated scenario, not financial advice."
    : model.output === "PUT"
      ? "The current inputs produce a downside statistical bias. This is a calculated scenario, not financial advice."
      : "The current inputs do not produce a strong directional edge. The calculator is treating the setup as balanced.";
  qs("scoreFill").style.width = `${clamp(Math.abs(model.score), 6, 100)}%`;
  qs("scoreFill").className = model.output.toLowerCase();
  qs("signals").innerHTML = [
    ["Model score", model.score.toFixed(1)],
    ["Confidence", `${model.confidence.toFixed(0)}%`],
    ["Momentum", pct(model.momentum)],
    ["Trend state", model.trendState],
    ["Confluence", model.confluenceScore.toFixed(1)],
    ["Price vs avg", pct(model.priceVsSma)],
    ["Realized vol", `${model.rv.toFixed(1)}%`],
    ["IV input", `${model.iv.toFixed(0)}%`],
    ["Expected move", money(model.expectedMove)],
    ["DTE", `${model.dte} days`],
    ["Risk-free", `${model.rate.toFixed(2)}%`]
  ].map(([label, value]) => `<div class="signal"><span>${label}</span><strong>${value}</strong></div>`).join("");
  renderConfluence();
  qs("modelExplanation").textContent = model.explanation;
}

function renderConfluence() {
  const trend = state.indicatorData.trendState;
  const pill = qs("trendStatePill");
  if (pill) {
    pill.textContent = `Trend: ${trend[0].toUpperCase()}${trend.slice(1)}`;
    pill.className = `trend-pill ${trend}`;
  }
  qs("confluencePanel").innerHTML = state.indicatorData.confluence.map((item) => {
    const enabled = (
      item.label === "VWAP" ? state.indicators.vwap :
      item.label === "EMA" ? state.indicators.ema :
      item.label === "SMA" ? state.indicators.sma :
      item.label === "Order block" ? state.indicators.orderBlocks :
      item.label === "Fair value gap" ? state.indicators.fvg :
      item.label === "Trend state" ? state.indicators.trend : true
    );
    const score = enabled ? item.score : 0;
    const side = !enabled ? "neutral" : score > 0.5 ? "call" : score < -0.5 ? "put" : "neutral";
    return `<div class="confluence-row ${side}">
      <span>${item.label}${enabled ? "" : " (off)"}</span>
      <strong>${item.value} · ${score > 0 ? "+" : ""}${score.toFixed(0)}</strong>
    </div>`;
  }).join("");
}

function buildWatchlist() {
  qs("watchlist").innerHTML = WL.map(([name, tickers]) => `
    <div class="watch-category">
      <h3>${name}</h3>
      ${tickers.map((ticker) => `<button class="watch-row" type="button" data-ticker="${ticker}"><strong>${ticker}</strong><span data-watch-price="${ticker}">${money(currentPriceFor(ticker))}</span></button>`).join("")}
    </div>
  `).join("");
  document.querySelectorAll(".watch-row").forEach((button) => {
    button.addEventListener("click", () => analyze(button.dataset.ticker, true));
  });
}

function renderWatchlistPrices() {
  document.querySelectorAll("[data-watch-price]").forEach((el) => {
    const ticker = el.dataset.watchPrice;
    el.textContent = money(currentPriceFor(ticker));
    el.className = state.live.quotes[ticker] ? "live-price" : "";
  });
}

function setActiveTicker() {
  document.querySelectorAll(".watch-row").forEach((button) => button.classList.toggle("active", button.dataset.ticker === state.ticker));
}

function renderQuote() {
  if (state.live.quotes[state.ticker]) {
    state.price = state.live.quotes[state.ticker].price;
    state.change = currentChangeFor(state.ticker);
  }
  qs("quoteTicker").textContent = state.ticker;
  qs("quotePrice").textContent = money(state.price);
  qs("quoteChange").textContent = pct(state.change);
  qs("quoteChange").className = state.change >= 0 ? "up" : "down";
  qs("pageTitle").textContent = `${state.ticker} Options Desk`;
  qs("chartTitle").textContent = `${state.ticker} modeled price path`;
  if (document.activeElement !== qs("stockInput")) qs("stockInput").value = state.price.toFixed(2);
  if (state.resetInputs) {
    qs("strikeInput").value = r5(state.price);
    qs("posSymbol").value = state.ticker;
    qs("posStrike").value = r5(state.price);
    state.resetInputs = false;
  }
  setActiveTicker();
  renderWatchlistPrices();
}

function renderChain() {
  const S = state.price;
  const iv = getIv() / 100;
  const expiry = qs("expirySelect").value;
  const T = getT(expiry);
  const step = S < 50 ? 1 : S < 150 ? 2.5 : 5;
  const rows = [];
  const seed = hashTicker(`${state.ticker}:${expiry}`);
  for (let k = r5(S * 0.85); k <= r5(S * 1.15); k += step) {
    const skew = 1 + Math.abs(k - S) / S * 1.35;
    const c = bs(S, k, T, getRate(), iv * skew, "call");
    const p = bs(S, k, T, getRate(), iv * skew, "put");
    const spread = S < 80 ? 0.08 : 0.18;
    const distance = Math.abs(k - S) / Math.max(step, 1);
    const volBase = Math.max(30, Math.round(980 / (1 + distance) + (seed % 130)));
    rows.push(`<tr class="${Math.abs(k - S) < step ? "atm" : ""}">
      <td class="call-text">${money(Math.max(0.01, c.price - spread))}</td><td class="call-text">${money(c.price + spread)}</td><td class="call-text">${c.delta.toFixed(3)}</td><td>${(iv * skew * 100).toFixed(0)}%</td><td>${volBase}</td>
      <td class="strike">${k}</td>
      <td>${Math.max(20, Math.round(volBase * 0.86))}</td><td>${(iv * skew * 100).toFixed(0)}%</td><td class="put-text">${p.delta.toFixed(3)}</td><td class="put-text">${money(p.price + spread)}</td><td class="put-text">${money(Math.max(0.01, p.price - spread))}</td>
    </tr>`);
  }
  qs("chainBody").innerHTML = rows.join("");
  qs("chainMeta").textContent = `Spot ${money(S)} - synthetic Black-Scholes chain - ${daysToExpiry(expiry)} DTE`;
}

function renderGreeks() {
  const S = Number(qs("stockInput").value);
  const K = Number(qs("strikeInput").value);
  const T = getT(qs("calcExpiry").value);
  const sig = getIv() / 100;
  const res = bs(S, K, T, getRate(), sig, qs("typeInput").value);
  const expectedMove = S * sig * Math.sqrt(T);
  const metrics = res ? [
    ["Option price", money(res.price)],
    ["Delta", res.delta.toFixed(4)],
    ["Gamma", res.gamma.toFixed(4)],
    ["Theta/day", money(res.theta)],
    ["Vega / 1% IV", money(res.vega)],
    ["Rho", money(res.rho)],
    ["Expected move", money(expectedMove)],
    ["Breakeven", qs("typeInput").value === "call" ? money(K + res.price) : money(K - res.price)],
    ["DTE", `${daysToExpiry(qs("calcExpiry").value)} days`]
  ] : [];
  qs("greekMetrics").innerHTML = metrics.map(([k, v]) => `<div class="metric"><span>${k}</span><strong>${v}</strong></div>`).join("");
}

function renderStrategies() {
  const iv = getIv();
  qs("strategyGrid").innerHTML = strategyCatalog.map((strategy, index) => {
    const strike = strategy.strike(state.price);
    const premium = estimatePremium(strategy.type, strike);
    const width = Math.max(5, r5(state.price * 0.05));
    return `<article class="strategy">
      <h3>${strategy.name}</h3>
      <p>${strategy.desc}</p>
      <dl>
        <dt>Output</dt><dd>${strategy.bias}</dd>
        <dt>Best for</dt><dd>${strategy.best}</dd>
        <dt>Strike</dt><dd>${money(strike)}</dd>
        <dt>Est. mark</dt><dd>${money(premium)}</dd>
        <dt>Width ref</dt><dd>${money(width)}</dd>
        <dt>IV input</dt><dd>${iv.toFixed(0)}%</dd>
      </dl>
      <button class="scenario-button" type="button" data-strategy="${index}">Load Scenario</button>
    </article>`;
  }).join("");
  document.querySelectorAll("[data-strategy]").forEach((button) => {
    button.addEventListener("click", () => loadScenario(Number(button.dataset.strategy)));
  });
}

function estimatePremium(type, strike, expiry = qs("calcExpiry").value) {
  const res = bs(state.price, strike, getT(expiry), getRate(), getIv() / 100, type);
  return res ? Math.max(0.01, res.price) : 1;
}

function loadScenario(index) {
  const strategy = strategyCatalog[index];
  const strike = strategy.strike(state.price);
  const premium = estimatePremium(strategy.type, strike);
  qs("typeInput").value = strategy.type;
  qs("strikeInput").value = strike;
  qs("posType").value = strategy.type;
  qs("posStrike").value = strike;
  qs("posPremium").value = premium.toFixed(2);
  qs("posExpiry").value = qs("calcExpiry").value;
  renderGreeks();
}

function positionMark(pos) {
  const sourcePrice = pos.symbol === state.ticker ? state.price : currentPriceFor(pos.symbol);
  const res = bs(sourcePrice, pos.strike, getT(pos.expiry), getRate(), getIv() / 100, pos.type);
  return res ? Math.max(0.01, res.price) : pos.premium;
}

function renderPositions() {
  let total = 0;
  qs("positions").innerHTML = state.positions.length ? state.positions.map((pos) => {
    const current = positionMark(pos);
    const pnl = (current - pos.premium) * pos.qty * 100;
    total += pnl;
    const dte = daysToExpiry(pos.expiry);
    const breakeven = pos.type === "call" ? pos.strike + pos.premium : pos.strike - pos.premium;
    const maxLoss = pos.premium * pos.qty * 100;
    const maxProfit = "Unlimited";
    const stopHit = pos.stop && current <= pos.stop;
    const targetHit = pos.target && current >= pos.target;
    const alert = stopHit ? "Stop alert" : targetHit ? "Target alert" : dte <= 7 ? "Expiry alert" : "Monitoring";
    const alertClass = stopHit ? "down" : targetHit ? "up" : dte <= 7 ? "warn" : "";
    return `<div class="position">
      <div class="position-head">
        <span>${pos.symbol} ${pos.type.toUpperCase()} ${pos.strike}</span>
        <button class="remove-position" type="button" data-remove="${pos.id}" aria-label="Remove position">Remove</button>
      </div>
      <div class="position-pnl ${pnl >= 0 ? "up" : "down"}">${pnl >= 0 ? "+" : ""}${money(pnl)}</div>
      <small>${pos.qty} contract(s) - ${dte} DTE - entry ${money(pos.premium)} - mark ${money(current)}</small>
      <small>Breakeven ${money(breakeven)} - max loss ${money(maxLoss)} - max profit ${maxProfit}</small>
      <small class="${alertClass}">${alert}${pos.stop ? ` - stop ${money(pos.stop)}` : ""}${pos.target ? ` - target ${money(pos.target)}` : ""}</small>
    </div>`;
  }).join("") : `<p class="empty-state">No positions yet. Load a scenario or add one manually.</p>`;
  qs("portfolioTotal").innerHTML = state.positions.length ? `Total modeled P&L <strong class="${total >= 0 ? "up" : "down"}">${total >= 0 ? "+" : ""}${money(total)}</strong>` : "";
  document.querySelectorAll("[data-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      state.positions = state.positions.filter((pos) => pos.id !== Number(button.dataset.remove));
      renderPositions();
    });
  });
}

function renderAll(redrawChart = true) {
  renderQuote();
  calculateIndicators();
  renderModel();
  renderChain();
  renderGreeks();
  renderStrategies();
  renderPositions();
  if (redrawChart) resizeChart();
  else drawChart();
}

function analyze(ticker, resetChart = true) {
  state.ticker = (ticker || state.ticker).trim().toUpperCase();
  state.resetInputs = true;
  stopLiveFeed();
  state.price = currentPriceFor(state.ticker);
  state.change = currentChangeFor(state.ticker);
  qs("tickerInput").value = state.ticker;
  if (resetChart) generateCandles(state.ticker);
  renderAll();
  if (qs("liveFeedInput").checked) startLiveFeed();
}

function initChartEvents() {
  const canvas = qs("priceChart");
  canvas.addEventListener("mousemove", (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const index = Math.round((x / rect.width) * (state.candles.length - 1));
    state.chartHover = clamp(index, 0, state.candles.length - 1);
    drawChart();
  });
  canvas.addEventListener("mouseleave", () => {
    state.chartHover = null;
    qs("chartReadout").textContent = "Move over the chart for OHLC details.";
    drawChart();
  });
  qs("rangeButtons").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-range]");
    if (!button) return;
    state.chartRange = button.dataset.range;
    savePrefs({ chartRange: state.chartRange });
    document.querySelectorAll("#rangeButtons button").forEach((item) => item.classList.toggle("active", item === button));
    generateCandles(state.ticker);
    renderAll();
  });
  qs("chartModeButtons").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-mode]");
    if (!button) return;
    state.chartMode = button.dataset.mode;
    savePrefs({ chartMode: state.chartMode });
    document.querySelectorAll("#chartModeButtons button").forEach((item) => item.classList.toggle("active", item === button));
    drawChart();
  });
  qs("liveFeedInput").addEventListener("change", () => {
    savePrefs({ liveFeed: qs("liveFeedInput").checked });
    if (qs("liveFeedInput").checked) startLiveFeed();
    else stopLiveFeed();
    if (!qs("liveFeedInput").checked) liveStatus("Modeled pulse. No private market-data key exposed.");
  });
  qs("autoPulseInput").addEventListener("change", () => {
    savePrefs({ autoPulse: qs("autoPulseInput").checked });
  });
  qs("indicatorControls").addEventListener("change", (event) => {
    const input = event.target.closest("input[data-indicator]");
    if (!input) return;
    state.indicators[input.dataset.indicator] = input.checked;
    renderIndicatorControls();
    savePrefs({ indicators: state.indicators });
    renderAll();
    liveStatus(`Indicators updated: ${Object.entries(state.indicators).filter(([, enabled]) => enabled).map(([name]) => name).join(", ") || "none"}`);
  });
  qs("resetIndicators").addEventListener("click", () => {
    state.indicators = {
      vwap: true,
      sma: false,
      ema: true,
      orderBlocks: false,
      fvg: false,
      trend: true
    };
    document.querySelectorAll("[data-indicator]").forEach((input) => {
      input.checked = Boolean(state.indicators[input.dataset.indicator]);
    });
    renderIndicatorControls();
    savePrefs({ indicators: state.indicators });
    renderAll();
    liveStatus("Indicators reset to clean default: VWAP, EMA, Trend.");
  });
  window.addEventListener("resize", resizeChart);
  state.pulseTimer = window.setInterval(pulseChart, 4500);
}

function init() {
  document.querySelector(".shell").classList.add("auth-pending");
  const dates = expiryDates();
  qs("expirySelect").innerHTML = dates.map((date, index) => `<option ${index === 2 ? "selected" : ""}>${date}</option>`).join("");
  qs("calcExpiry").value = qs("expirySelect").value;
  qs("posExpiry").value = qs("expirySelect").value;
  buildWatchlist();
  initChartEvents();
  applyPrefs();

  document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("active", item === tab));
    document.querySelectorAll(".panel").forEach((panel) => panel.classList.remove("active"));
    qs(`${tab.dataset.tab}Panel`).classList.add("active");
  }));

  qs("tickerForm").addEventListener("submit", (event) => {
    event.preventDefault();
    analyze(qs("tickerInput").value || state.ticker, true);
  });

  ["expirySelect", "ivInput", "trendInput", "volRegimeInput", "rateInput"].forEach((id) => qs(id).addEventListener("input", () => {
    savePrefs({
      trend: qs("trendInput").value,
      volRegime: qs("volRegimeInput").value
    });
    qs("calcExpiry").value = qs("expirySelect").value;
    generateCandles(state.ticker);
    renderAll();
  }));

  ["stockInput", "strikeInput", "calcExpiry", "typeInput"].forEach((id) => qs(id).addEventListener("input", () => {
    renderGreeks();
    renderPositions();
  }));

  qs("positionForm").addEventListener("submit", (event) => {
    event.preventDefault();
    state.positions.push({
      id: state.positionId++,
      symbol: qs("posSymbol").value.trim().toUpperCase() || state.ticker,
      type: qs("posType").value,
      strike: Number(qs("posStrike").value || qs("strikeInput").value),
      expiry: qs("posExpiry").value || qs("calcExpiry").value,
      premium: Number(qs("posPremium").value || estimatePremium(qs("posType").value, Number(qs("posStrike").value || qs("strikeInput").value))),
      qty: Number(qs("posQty").value || 1),
      stop: Number(qs("posStop").value) || null,
      target: Number(qs("posTarget").value) || null
    });
    ["posPremium", "posStop", "posTarget"].forEach((id) => { qs(id).value = ""; });
    renderPositions();
    if (qs("liveFeedInput").checked) {
      fetchLiveTrade().catch((error) => liveStatus(`Live feed unavailable: ${error.message}. Using latest cached prices.`));
    }
  });

  analyze("AAPL", true);
  initAuth();
}

init();
