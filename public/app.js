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

const strategies = [
  ["Bull Call Spread", "Bullish", "Buy ATM call and sell 5% OTM call. Defined risk with capped upside.", "Moderate uptrend"],
  ["Bear Put Spread", "Bearish", "Buy ATM put and sell 5% OTM put. Better for controlled downside views.", "Moderate decline"],
  ["Long Straddle", "Volatility", "Buy the same strike call and put. Needs a large move in either direction.", "Event risk"],
  ["Iron Condor", "Range", "Sell OTM call and put spreads. Designed for range-bound names and richer IV.", "Sideways market"],
  ["Covered Call", "Income", "Own shares and sell an OTM call. Generates yield but caps upside.", "Long stock"],
  ["Protective Put", "Hedge", "Own shares and buy a put. Insurance against downside into catalysts.", "Risk control"]
];

const state = {
  ticker: "AAPL",
  price: 189.2,
  change: 0.84,
  positions: [],
  user: null
};

function qs(id) { return document.getElementById(id); }
function money(v) { return `$${Number(v).toFixed(2)}`; }
function r5(v) { return Math.round(v / 5) * 5; }

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
}

function showAuth(message = "") {
  state.user = null;
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
  if (error) {
    showAuth(error.message);
  } else if (data.session?.user) {
    showApp(data.session.user);
  } else {
    showAuth();
  }

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

function expiryDates() {
  return [14, 21, 30, 45, 60, 90, 120].map((days) => {
    const date = new Date(Date.now() + days * 86400000);
    const move = ((5 - date.getDay()) + 7) % 7 || 7;
    date.setDate(date.getDate() + move);
    return date.toISOString().slice(0, 10);
  });
}

function loadChart() {
  qs("tvChart").src = `https://www.tradingview.com/widgetembed/?symbol=${encodeURIComponent(state.ticker)}&interval=D&theme=dark&style=1&withdateranges=1&studies=RSI%40tv-basicstudies%1FMACD%40tv-basicstudies`;
}

function buildWatchlist() {
  qs("watchlist").innerHTML = WL.map(([name, tickers]) => `
    <div class="watch-category">
      <h3>${name}</h3>
      ${tickers.map((ticker) => `<button class="watch-row" data-ticker="${ticker}"><strong>${ticker}</strong><span>${money((quotes[ticker] || [state.price])[0])}</span></button>`).join("")}
    </div>
  `).join("");
  document.querySelectorAll(".watch-row").forEach((button) => {
    button.addEventListener("click", () => analyze(button.dataset.ticker));
  });
}

function setActiveTicker() {
  document.querySelectorAll(".watch-row").forEach((button) => button.classList.toggle("active", button.dataset.ticker === state.ticker));
}

function renderQuote() {
  qs("quoteTicker").textContent = state.ticker;
  qs("quotePrice").textContent = money(state.price);
  qs("quoteChange").textContent = `${state.change >= 0 ? "+" : ""}${state.change.toFixed(2)}%`;
  qs("quoteChange").className = state.change >= 0 ? "up" : "down";
  qs("pageTitle").textContent = `${state.ticker} Options Desk`;
  qs("stockInput").value = state.price.toFixed(2);
  qs("strikeInput").value = r5(state.price);
  qs("posSymbol").value = state.ticker;
  setActiveTicker();
}

function advisor() {
  const iv = Number(qs("ivInput").value);
  const momentum = state.change;
  const verdict = momentum > 0.75 && iv < 65 ? "Call" : momentum < -0.75 ? "Put" : "Neutral";
  qs("verdictPill").textContent = verdict;
  qs("verdictPill").className = `verdict ${verdict.toLowerCase()}`;
  qs("advisorTitle").textContent = verdict === "Neutral" ? "Balanced setup" : `${verdict} bias`;
  qs("advisorText").textContent = verdict === "Call"
    ? "Momentum and trend favor upside. Prefer defined-risk call spreads unless implied volatility is unusually cheap."
    : verdict === "Put"
      ? "Price action is leaning lower. A put spread can express downside while controlling premium at risk."
      : "Signals are mixed. Range or hedged structures are cleaner than chasing direction.";
  qs("signals").innerHTML = [
    ["Momentum", `${momentum >= 0 ? "+" : ""}${momentum.toFixed(2)}%`],
    ["Synthetic IV", `${iv.toFixed(0)}%`],
    ["Suggested strike", money(r5(state.price * (verdict === "Put" ? 0.97 : 1.03)))],
    ["Expiry focus", qs("expirySelect").value]
  ].map(([label, value]) => `<div class="signal"><span>${label}</span><strong>${value}</strong></div>`).join("");
}

function renderChain() {
  const S = state.price;
  const iv = Number(qs("ivInput").value) / 100;
  const expiry = qs("expirySelect").value;
  const T = Math.max(0.002, (new Date(expiry) - Date.now()) / 31536000000);
  const step = S < 50 ? 1 : S < 150 ? 2.5 : 5;
  const rows = [];
  for (let k = r5(S * 0.85); k <= r5(S * 1.15); k += step) {
    const skew = 1 + Math.abs(k - S) / S * 1.4;
    const c = bs(S, k, T, 0.0525, iv * skew, "call");
    const p = bs(S, k, T, 0.0525, iv * skew, "put");
    const spread = S < 80 ? 0.08 : 0.18;
    rows.push(`<tr class="${Math.abs(k - S) < step ? "atm" : ""}">
      <td class="call-text">${money(Math.max(0.01, c.price - spread))}</td><td class="call-text">${money(c.price + spread)}</td><td class="call-text">${c.delta.toFixed(3)}</td><td>${(iv * skew * 100).toFixed(0)}%</td><td>${Math.round(80 + Math.random() * 900)}</td>
      <td class="strike">${k}</td>
      <td>${Math.round(80 + Math.random() * 760)}</td><td>${(iv * skew * 100).toFixed(0)}%</td><td class="put-text">${p.delta.toFixed(3)}</td><td class="put-text">${money(p.price + spread)}</td><td class="put-text">${money(Math.max(0.01, p.price - spread))}</td>
    </tr>`);
  }
  qs("chainBody").innerHTML = rows.join("");
  qs("chainMeta").textContent = `Spot ${money(S)} · synthetic Black-Scholes chain`;
  advisor();
}

function renderGreeks() {
  const S = Number(qs("stockInput").value);
  const K = Number(qs("strikeInput").value);
  const T = Math.max(0.002, (new Date(qs("calcExpiry").value) - Date.now()) / 31536000000);
  const r = Number(qs("rateInput").value) / 100;
  const sig = Number(qs("ivInput").value) / 100;
  const res = bs(S, K, T, r, sig, qs("typeInput").value);
  const metrics = res ? [
    ["Option Price", money(res.price)],
    ["Delta", res.delta.toFixed(4)],
    ["Gamma", res.gamma.toFixed(4)],
    ["Theta/day", money(res.theta)],
    ["Vega / 1% IV", money(res.vega)],
    ["Rho", money(res.rho)]
  ] : [];
  qs("greekMetrics").innerHTML = metrics.map(([k, v]) => `<div class="metric"><span>${k}</span><strong>${v}</strong></div>`).join("");
  renderPositions();
}

function renderStrategies() {
  const iv = Number(qs("ivInput").value);
  qs("strategyGrid").innerHTML = strategies.map(([name, bias, desc, best]) => {
    const width = Math.max(5, r5(state.price * 0.05));
    const cost = name.includes("Condor") ? "Credit" : money(Math.max(0.35, state.price * iv / 1000));
    return `<article class="strategy">
      <h3>${name}</h3>
      <p>${desc}</p>
      <dl>
        <dt>Bias</dt><dd>${bias}</dd>
        <dt>Best for</dt><dd>${best}</dd>
        <dt>Width</dt><dd>${money(width)}</dd>
        <dt>Est. cost</dt><dd>${cost}</dd>
      </dl>
    </article>`;
  }).join("");
}

function renderPositions() {
  let total = 0;
  qs("positions").innerHTML = state.positions.length ? state.positions.map((pos, index) => {
    const T = Math.max(0.002, (new Date(pos.expiry) - Date.now()) / 31536000000);
    const current = bs(state.price, pos.strike, T, 0.0525, Number(qs("ivInput").value) / 100, pos.type).price;
    const pnl = (current - pos.premium) * pos.qty * 100;
    total += pnl;
    return `<div class="position">
      <div class="position-head"><span>${pos.symbol} ${pos.type.toUpperCase()} ${pos.strike}</span><span class="${pnl >= 0 ? "up" : "down"}">${pnl >= 0 ? "+" : ""}${money(pnl)}</span></div>
      <small>${pos.qty} contract(s) · ${pos.expiry} · entry ${money(pos.premium)} · mark ${money(current)}</small>
    </div>`;
  }).join("") : `<p style="color: var(--muted);">No positions yet.</p>`;
  qs("portfolioTotal").innerHTML = state.positions.length ? `Total P&L <strong class="${total >= 0 ? "up" : "down"}">${total >= 0 ? "+" : ""}${money(total)}</strong>` : "";
}

function analyze(ticker) {
  state.ticker = ticker.toUpperCase();
  const known = quotes[state.ticker];
  if (known) {
    state.price = known[0];
    state.change = known[1];
  } else {
    const seed = [...state.ticker].reduce((sum, char) => sum + char.charCodeAt(0), 0);
    state.price = 35 + (seed % 230);
    state.change = ((seed % 700) - 350) / 100;
  }
  qs("tickerInput").value = state.ticker;
  loadChart();
  renderQuote();
  renderChain();
  renderGreeks();
  renderStrategies();
}

function init() {
  document.querySelector(".shell").classList.add("auth-pending");
  qs("expirySelect").innerHTML = expiryDates().map((date, index) => `<option ${index === 2 ? "selected" : ""}>${date}</option>`).join("");
  qs("calcExpiry").value = qs("expirySelect").value;
  qs("posExpiry").value = qs("expirySelect").value;
  buildWatchlist();
  document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("active", item === tab));
    document.querySelectorAll(".panel").forEach((panel) => panel.classList.remove("active"));
    qs(`${tab.dataset.tab}Panel`).classList.add("active");
  }));
  qs("tickerForm").addEventListener("submit", (event) => {
    event.preventDefault();
    analyze(qs("tickerInput").value || state.ticker);
  });
  ["expirySelect", "ivInput"].forEach((id) => qs(id).addEventListener("input", () => {
    qs("calcExpiry").value = qs("expirySelect").value;
    renderChain();
    renderGreeks();
    renderStrategies();
  }));
  ["stockInput", "strikeInput", "calcExpiry", "rateInput", "typeInput"].forEach((id) => qs(id).addEventListener("input", renderGreeks));
  qs("positionForm").addEventListener("submit", (event) => {
    event.preventDefault();
    state.positions.push({
      symbol: qs("posSymbol").value.toUpperCase() || state.ticker,
      type: qs("posType").value,
      strike: Number(qs("posStrike").value || qs("strikeInput").value),
      expiry: qs("posExpiry").value,
      premium: Number(qs("posPremium").value || 1),
      qty: Number(qs("posQty").value || 1)
    });
    renderPositions();
  });
  analyze("AAPL");
  initAuth();
}

init();
