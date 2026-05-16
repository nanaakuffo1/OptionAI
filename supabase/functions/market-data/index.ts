const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

type MarketRequest = {
  ticker?: string;
  tickers?: string[];
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const apiKey = Deno.env.get("POLYGON_API_KEY");
  if (!apiKey) return json({ error: "POLYGON_API_KEY secret is not configured" }, 500);

  let payload: MarketRequest;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const requested = Array.isArray(payload.tickers) ? payload.tickers : [payload.ticker];
  const tickers = [...new Set(requested
    .map((value) => String(value || "").trim().toUpperCase())
    .filter(Boolean)
  )].slice(0, 40);

  if (!tickers.length || tickers.some((ticker) => !/^[A-Z][A-Z0-9.]{0,9}$/.test(ticker))) {
    return json({ error: "Invalid ticker list" }, 400);
  }

  const loadTicker = async (ticker: string) => {
    const url = new URL(`https://api.polygon.io/v2/last/trade/${encodeURIComponent(ticker)}`);
    url.searchParams.set("apiKey", apiKey);

    const polygonRes = await fetch(url);
    const polygonData = await polygonRes.json().catch(() => null);

    if (!polygonRes.ok) {
      return {
        ticker,
        error: polygonData?.error || polygonData?.message || `Polygon HTTP ${polygonRes.status}`
      };
    }

    const result = polygonData?.results;
    const price = Number(result?.p);
    if (!Number.isFinite(price)) return { ticker, error: "Polygon returned no trade price" };

    return {
      ticker,
      price,
      size: Number(result?.s || 0),
      timestamp: result?.t || Date.now(),
      source: "Polygon last trade"
    };
  };

  const quotes = await Promise.all(tickers.map(loadTicker));
  const validQuotes = quotes.filter((quote) => "price" in quote);
  if (!validQuotes.length) return json({ error: "Polygon returned no valid prices", quotes }, 502);

  if (!Array.isArray(payload.tickers)) return json(validQuotes[0]);
  return json({
    quotes: validQuotes,
    errors: quotes.filter((quote) => "error" in quote),
    source: "Polygon last trade"
  });
});
