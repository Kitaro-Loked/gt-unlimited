# GT UNLIMITED — Financial Terminal

English | [中文](docs/README.zh-CN.md)

A self-hosted, single-page financial monitoring terminal inspired by Bloomberg / TradingView. Built with vanilla HTML/CSS/JS and designed for traders who want a centralized dashboard for global markets, derivatives, risk, macro events and news.

GT UNLIMITED is open source and welcomes contributors in every language. Multilingual documentation lives in [`docs/`](docs/).

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Quick Start](#quick-start)
- [Project Structure](#project-structure)
- [Configuration](#configuration)
- [Data Sources](#data-sources)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [Code of Conduct](#code-of-conduct)
- [License](#license)

## Features

- **Multi-asset market data**: stocks, crypto, FX, commodities, rates, ETFs
- **TradingView integration**: main chart, heat-maps, technical analysis, scanners
- **Derivatives toolbox**: options chain, options lab, advanced volatility surface, swaps, structured products
- **Portfolio & risk**: PnL, attribution, beta/alpha, parametric/historical/Monte-Carlo VaR, stress testing, bond duration/convexity
- **Fundamental analysis**: financial statements (FA), company profile (DES), sell-side research (RES), ownership, M&A deals, valuation models
- **Macro & global events**: interactive 2D/3D globe, risk monitors, central bank rates, yield curve, economic calendar
- **Newsroom**: multi-source RSS news wall with text-to-speech broadcast
- **Audio stream**: built-in radio player for background music
- **Workspace presets**: one-click dashboards for A-shares, US tech, crypto, FX/commodities, risk, etc.

## Tech Stack

- Vanilla HTML5 / CSS3 / JavaScript (no build step)
- [GridStack](https://gridstackjs.com/) for draggable widgets
- [TradingView](https://www.tradingview.com/widget/) embed widgets
- Leaflet + [globe.gl](https://globe.gl/) for the event globe
- A lightweight Node.js CORS proxy (`api/proxy-server.js`)
- [Caddy](https://caddyserver.com/) as the production static server / reverse proxy

## Quick Start

```bash
cd trading.2009731.xyz

# 1. Start the CORS proxy
node api/proxy-server.js &

# 2. Start Caddy (serves static files and proxies /api/* to the Node service)
caddy run

# 3. Open http://localhost (or your configured domain)
```

If you don't have Caddy, you can also open `web/index.html` directly from any static server; just make sure `/api/proxy` is reachable for external data sources.

## Configuration

By default the terminal boots without authentication. To enable a simple login screen:

```bash
cp web/config.example.js web/config.js
# edit web/config.js with your own username/password
```

Then add this line in `web/index.html` **before** `/assets/app.js`:

```html
<script src="/config.js"></script>
```

`web/config.js` is ignored by Git so your credentials never get committed.

## Project Structure

```
trading.2009731.xyz/
├── api/                  # Node.js CORS proxy
├── web/                  # Frontend static files
│   ├── index.html        # Main entry
│   ├── assets/           # Styles, widget scripts, images, fonts
│   └── config.example.js # Optional auth template
├── scripts/              # Helper scripts
├── docs/                 # Multilingual documentation
├── Caddyfile             # Caddy configuration
├── LICENSE               # MIT license
└── README.md             # English main documentation
```

## Data Sources

All data comes from free public APIs and RSS feeds (Yahoo Finance, Binance, Frankfurter, GDACS, BBC, Reuters, FRED, etc.). External requests are proxied through `/api/proxy` to avoid browser CORS issues.

## Roadmap

- 3D volatility surface visualization
- Interest-rate / credit / commodity swap calculators
- Structured product pricing engine
- Standardized financial statement teardown (20+ years)
- Sell-side research aggregation and full-text search
- Portfolio attribution and risk models
- Excel / Google Sheets add-on for financial modeling
- Full feature parity between 2D map and 3D globe
- News TTS broadcast dashboard
- Stable audio player

See [ARCHITECTURE.md](docs/ARCHITECTURE.md) for design details.

## Contributing

We welcome contributors from all languages and backgrounds. Please read [CONTRIBUTING.md](docs/CONTRIBUTING.md) before opening a Pull Request.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](docs/CODE_OF_CONDUCT.md).

## License

MIT License — see [LICENSE](./LICENSE). Copyright (c) 2026 Kitaro-Loked.
