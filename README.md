# OptionAI

OptionAI is a protected options dashboard built from the original single-file prototype. It can run as a static GitHub Pages site with Supabase Auth.

It includes:

- Supabase email/password sign-in gate for GitHub Pages
- Native OptionAI canvas chart with modeled pulse and optional secure live feed
- Synthetic Black-Scholes options chain
- Greeks calculator
- Strategy cards
- Portfolio mark-to-model P&L

## GitHub Pages + Supabase

1. Create a Supabase project.
2. In Supabase Auth, create approved users manually.
3. Disable public signups in the Supabase Auth settings if you want invite-only access.
4. Copy your project URL and anon public key into `supabase-config.js`.
5. Push this repository to GitHub.
6. In GitHub repository settings, enable Pages from the `main` branch and `/root` folder.
7. Add your GitHub Pages URL to Supabase Auth allowed redirect/site URLs.

The anon key is safe to publish in frontend code when Row Level Security is enabled. Do not put service-role keys or paid market data API secrets in GitHub Pages code.

## Secure live market data

GitHub Pages cannot protect market-data API keys. OptionAI uses a Supabase Edge Function at `supabase/functions/market-data` so the browser can request prices without seeing the provider secret.

The included function uses Polygon's `/v2/last/trade/{ticker}` endpoint. Polygon plan recency controls whether this is delayed or real-time. Their docs list Developer as 15-minute delayed and Advanced/Business + Expansion as real-time for this endpoint.

Deploy:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set POLYGON_API_KEY=YOUR_POLYGON_KEY
supabase functions deploy market-data
```

After deployment, open the app, sign in, and enable **Live Feed**. If the function or provider key is missing, the chart falls back to the modeled pulse.

## Optional Supabase database

Run `supabase-schema.sql` in the Supabase SQL editor if you later want authenticated users to save positions privately. The included policies restrict each user to their own rows.

## Local static preview

You can preview the static app with any simple local server:

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173`.

## Node server fallback

`server.js` is still included as an alternate local/Node deployment with a password gate. For GitHub Pages, use the root-level static files and Supabase Auth instead.
