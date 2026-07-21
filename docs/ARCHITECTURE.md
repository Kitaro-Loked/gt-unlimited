# GT UNLIMITED Architecture

GT UNLIMITED is a browser-first, self-hosted financial dashboard. It is intentionally kept simple so that contributors can understand and modify it quickly.

## Design principles

1. **No build step**: plain HTML, CSS, and JavaScript files are served as static assets.
2. **Widget-based layout**: each panel is an independent GridStack widget.
3. **CORS proxy for external data**: the browser cannot fetch many finance APIs directly, so a tiny Node.js proxy handles cross-origin requests.
4. **Configuration over code**: optional `web/config.js` enables authentication without touching source files.

## High-level flow

```
User Browser
    │
    ├── loads static files from Caddy / static server
    │
    ├── fetches external market data via /api/proxy
    │       └── Caddy proxies to api/proxy-server.js
    │
    └── renders widgets (charts, globe, news, portfolio, risk)
```

## Directory responsibilities

- `web/index.html` — single-page shell; loads GridStack, TradingView, Leaflet, globe.gl, and widget scripts.
- `web/assets/` — styles, widget JavaScript, images, and fonts.
- `web/config.example.js` — template for optional login credentials.
- `api/proxy-server.js` — lightweight Express-style CORS proxy.
- `Caddyfile` — production static server and reverse proxy rules.
- `docs/` — multilingual documentation for global contributors.

## Widget categories

| Category | Examples |
|----------|----------|
| Market data | quotes, heat-maps, scanners, charts |
| Derivatives | options chain, vol surface, swaps, structured products |
| Portfolio | PnL, attribution, beta/alpha, VaR, stress tests |
| Fundamental | financial statements, ownership, M&A, research |
| Macro | globe events, central bank rates, yield curve, economic calendar |
| Newsroom | RSS wall, TTS broadcast, radio player |

## Data sources

Most data comes from free public APIs fetched through the CORS proxy. Contributors can add new adapters in `web/assets/data-adapters/` if the codebase introduces that folder in the future.

## Security notes

- Never commit real credentials. Use `web/config.example.js` as a template.
- Keep the proxy server behind Caddy or another reverse proxy in production.
- Rate-limit the proxy to avoid abuse.

## Future architecture ideas

- Modular plugin system for new widgets
- WebSocket feed for real-time prices
- Optional backend database for portfolio snapshots
- Excel / Google Sheets add-on using a simple REST API
