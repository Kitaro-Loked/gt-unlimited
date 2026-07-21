# GT UNLIMITED — Financial Terminal

English (Mirror) | [中文](https://github.com/Kitaro-Loked/gt-unlimited-cn)

> **Note**: This is the **English mirror repository**. The primary Chinese repository is at **[gt-unlimited-cn](https://github.com/Kitaro-Loked/gt-unlimited-cn)**. All active development and the latest documentation are maintained in the Chinese repository.

A self-hosted, single-page financial monitoring terminal inspired by Bloomberg / TradingView. Built with vanilla HTML/CSS/JS and designed for traders who want a centralized dashboard for global markets, derivatives, risk, macro events and news.

- **Official instance**: https://trading.2009731.xyz
- **Primary repository (Chinese)**: https://github.com/Kitaro-Loked/gt-unlimited-cn ⭐
- **This repository (English mirror)**: https://github.com/Kitaro-Loked/gt-unlimited

---

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

GT UNLIMITED can run on any server. Choose one of the following deployment modes.

### A. IP + port (fastest, plain HTTP)

No domain or Caddy required — the Node proxy also serves the static frontend.

```bash
cd gt-unlimited
node api/proxy-server.js
```

Then open `http://<your-server-ip>:3456`.

The proxy listens on `0.0.0.0:3456` by default. Change the port with `PORT=8080 node api/proxy-server.js`.

### B. Bind a domain with automatic HTTPS (Caddy)

```bash
cd gt-unlimited

# 1. Copy the template and set your domain
cp Caddyfile.example Caddyfile
# edit Caddyfile: replace example.com with your domain

# 2. Start the CORS proxy
node api/proxy-server.js &

# 3. Start Caddy
caddy run
```

Requirements for automatic HTTPS:
- Your DNS A record points to the server IP.
- Ports 80 and 443 are open.
- Caddy will automatically obtain and renew Let's Encrypt certificates.

### C. Local development

```bash
cd gt-unlimited
node api/proxy-server.js &
# open http://localhost:3456
```

## Project Structure

```
gt-unlimited/
├── api/                       # Node.js CORS proxy
├── web/                       # Frontend static files
│   ├── index.html             # Main entry
│   ├── assets/                # Styles, widget scripts, images, fonts
│   └── config.example.js      # Optional auth template
├── scripts/                   # Helper scripts
├── docs/                      # Multilingual documentation
├── Caddyfile.example          # Caddy configuration template
├── .gitignore                 # Caddyfile and local config are ignored
├── LICENSE                    # MIT license
└── README.md                  # English main documentation
```

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

> **Note**: For the most up-to-date contributing guidelines and active development, please visit the [primary Chinese repository](https://github.com/Kitaro-Loked/gt-unlimited-cn).

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](docs/CODE_OF_CONDUCT.md).

## License

MIT License — see [LICENSE](./LICENSE). Copyright (c) 2026 Kitaro-Loked.
