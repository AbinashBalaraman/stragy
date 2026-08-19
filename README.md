<div align="center">

# ⚡ Stragy

### Institutional-Grade Quantitative Strategy Builder, Algorithmic Backtester & Market Intelligence Engine

[![Live Demo](https://img.shields.io/badge/Live%20Demo-stragy.onrender.com-00C853?style=for-the-badge&logo=render&logoColor=white)](https://stragy.onrender.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](./LICENSE)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS v4](https://img.shields.io/badge/Tailwind-v4-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![Node.js](https://img.shields.io/badge/Node.js-22+-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)

**[Explore Live Demo →](https://stragy.onrender.com/)**

---

</div>

## 📌 Overview

**Stragy** is a full-stack algorithmic backtesting and quantitative trading platform purpose-built for the Indian Financial Markets (NSE & BSE) and global equities. It bridges the gap between visual, no-code strategy creation and institutional-grade risk verification.

Whether you are designing intraday momentum breakouts, mean-reversion swing systems, or multi-indicator trend-following algorithms, Stragy provides instant backtesting, rigorous walkforward out-of-sample testing, Monte Carlo robustness suites, real-time market scanners, and native broker execution mapping.

---

## ✨ Key Features

### 1. 🛠️ Visual Strategy Builder & AST Compiler
- **Modular Rule Builder**: Compose complex entry and exit conditions using intuitive visual blocks.
- **Rich Technical Indicators**: EMA, SMA, RSI, Bollinger Bands, MACD, Supertrend, ATR, and Volume-SMA.
- **Custom Risk Controls**: Configurable Stop-Loss (%), Take-Profit (%), Trailing Stop (Dynamic %), Fixed-Fraction/Fixed-Risk Position Sizing, and Max Drawdown Circuit Breakers.
- **JSON Strategy AST**: Export, import, and share versioned Strategy Abstract Syntax Trees (ASTs).

### 2. 📊 Institutional Backtesting Engine
- **Full Quantitative Metrics**: Computes CAGR, Sharpe Ratio, Sortino Ratio, Calmar Ratio, Alpha, Beta, Win Rate, Profit Factor, and Max Consecutive Losses.
- **Indian Market Statutory Costs**: Realistic simulation including **STT** (Securities Transaction Tax), **SEBI turnover charges**, **Exchange transaction fees**, **Stamp Duty**, **GST (18%)**, and customizable slippage.
- **Visual Analytics**: Interactive Equity Curve vs Benchmark, Drawdown Underwater Charts, Monthly Returns Heatmaps, and Trade Logs with PnL distributions.

### 3. 🛡️ Robustness & Anti-Overfitting Suite
- **Monte Carlo Simulations**: Runs 100+ randomized iterations to forecast drawdown confidence intervals (P10, P50, P90).
- **Walk-Forward Train/Test Split**: Automatically tests strategies on out-of-sample market regimes to flag overfitting risk.
- **2D Parameter Sensitivity Heatmap**: Evaluates parameter fragility across 2D matrices to ensure stable parameter plateaus.

### 4. 🔍 Multi-Universe Market Scanner & Real-Time Intelligence
- **Universes Supported**: All NSE Equities (2,050+), BSE Equities, NIFTY 50, Bank NIFTY, NIFTY IT, NIFTY Auto, NIFTY Pharma, NIFTY Metal, NIFTY FMCG, and Major Indices.
- **Market Movers**: Top Gainers, Top Losers, Volume Shockers (>1.25x 20D volume), and 52-Week High/Low breakout alerts.
- **Derivatives Open Interest (OI)**: Real-time categorization into *Long Buildup*, *Short Covering*, *Short Buildup*, and *Long Unwinding*.
- **Option Chain & Volume Profile**: Real-time PCR, Max Pain strikes, Point of Control (POC), and Value Area (VAH/VAL) mapping.
- **Trading Session Calendar**: Snap scanner data to historical trading dates across the past 250 market sessions.

### 5. 🤖 AI Quantitative Copilot
- Natural language strategy generation, logic debugging, and automated risk optimization.
- One-click application of AI-generated strategies directly into the backtesting engine.

### 6. 🔌 Angel One SmartAPI Ready
- Pre-mapped token IDs for seamless connection with Angel One's SmartAPI ecosystem.
- Ready for live quote polling, WebSocket feeds, and automated GTT bracket order dispatching.

---

## 🏗️ Architecture & Technology Stack

```
stragy/
├── src/
│   ├── components/            # React 19 UI Components
│   │   ├── chat/              # AI Copilot Dock & Floating Assistant
│   │   ├── layout/            # Navigation, Status Bar & Header
│   │   ├── library/           # Strategy Templates & Saved Strategies
│   │   ├── results/           # Backtest Dashboard, Charts & Comparison
│   │   ├── scanner/           # Market Scanner, Option Chain, Volume Profile
│   │   └── strategy/          # Visual Strategy Builder & Indicator Panels
│   ├── server/                # Backend Quantitative Engine
│   │   ├── backtest/          # Engine, Indicators, Simulator & Scanner
│   │   └── data/              # Symbols Universe, SmartAPI & OHLCV Store
│   └── shared/                # Shared Types, Schemas & Templates
├── server.ts                  # Express Backend & API Router
├── start.js                   # Self-Healing Production Runner
└── render.yaml                # Cloud Blueprint Deployment Config
```

- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Motion, Lucide Icons, Recharts.
- **Backend**: Node.js, Express, esbuild, TypeScript.
- **Data & Math**: Vectorized indicator math in RAM, in-memory caching with TTL.

---

## 🚀 Quick Start (Local Development)

### Prerequisites
- Node.js `v18.0.0` or higher
- npm or yarn

### 1. Clone the repository
```bash
git clone https://github.com/AbinashBalaraman/stragy.git
cd stragy
```

### 2. Install dependencies
```bash
npm install
```

### 3. Setup environment variables (Optional)
```bash
cp .env.example .env
```
*(Optionally add your Gemini API Key or Angel One SmartAPI credentials to `.env`)*

### 4. Start the development server
```bash
npm run dev
```
Open **`http://localhost:3000`** in your browser.

---

## 📦 Production Build & Deployment

### Build Command
```bash
npm run build
```

### Start Command
```bash
npm start
```

### Deploy to Render
1. Connect your GitHub repository `AbinashBalaraman/stragy` to [Render](https://render.com).
2. Render will automatically detect `render.yaml` with the following configuration:
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Environment Variable**: `NODE_ENV=production`

---

## ⚙️ Environment Variables

| Variable | Required | Description |
| :--- | :--- | :--- |
| `PORT` | Optional | Port for the server (defaults to `3000`) |
| `NODE_ENV` | Optional | Environment mode (`development` / `production`) |
| `GEMINI_API_KEY` | Optional | API Key for AI Copilot strategy generation |
| `SMARTAPI_API_KEY` | Optional | Angel One SmartAPI Key |
| `SMARTAPI_CLIENT_CODE` | Optional | Angel One Client ID |
| `SMARTAPI_PASSWORD` | Optional | Angel One Pin / Password |
| `SMARTAPI_TOTP_SECRET` | Optional | TOTP Secret for automated 2FA login |

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.

---

## 👨‍💻 Author

**Abinash Balaraman**
- GitHub: [@AbinashBalaraman](https://github.com/AbinashBalaraman)
- Live App: [stragy.onrender.com](https://stragy.onrender.com)
