/* 期权策略实验室 OPTION_LAB — 纯本地计算，无任何网络请求（无需接口实测，2026-07-16 编写）
 * Tab1 策略盈亏图：内置 8 种模板（买入看涨/买入看跌/备兑看涨/保护性看跌/牛市价差/熊市价差/跨式/宽跨式），
 *   输入标的价格/行权价（多腿分别输入）/权利金/合约乘数，SVG 绘制到期盈亏曲线
 *   （横轴默认围绕行权价均价 ±30%，自动扩展以包含现价与盈亏平衡点），
 *   标注最大盈利/最大亏损/盈亏平衡点数值（按分段线性解析求值，非图上采样近似）。
 * Tab2 BS 定价与希腊字母：Black-Scholes 公式（无股息、欧式），正态 CDF 用 Abramowitz & Stegun
 *   7 位近似（误差 <1e-7，自实现无外部库），输出认购/认沽理论价与 Delta/Gamma/Theta(每日)/Vega(1%)/Rho(1%)。
 * 配色约定：盈利区 var(--up) 松绿，亏损区 var(--down) 陶土红，现价标记 var(--info)，平衡点 var(--warning)。
 * Registers as custom tool id 'optionlab' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  const ROOT = typeof window !== 'undefined' ? window : globalThis;
  ROOT.GT_EXTRA_TOOLS = ROOT.GT_EXTRA_TOOLS || {};

  const TABS = [
    { id: 'strat', label: '策略盈亏 PAYOFF' },
    { id: 'bs', label: 'BS定价 GREEKS' },
  ];

  function injectStyle() {
    if (document.getElementById('olab-style')) return;
    const style = document.createElement('style');
    style.id = 'olab-style';
    style.textContent = `
.olab-tabs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.olab-tab.active {
  border-color: var(--acc);
  color: var(--acc);
}
.olab-strat-desc {
  font-size: 9px;
  line-height: 1.6;
  color: var(--text-dim);
  letter-spacing: 0.04em;
  margin: 8px 0;
}
.olab-chart-wrap {
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  background: var(--surface-raised);
  padding: 6px 4px 2px;
  margin: 10px 0 6px;
}
.olab-svg {
  width: 100%;
  height: auto;
  display: block;
}
.olab-legend {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 9px;
  color: var(--text-muted);
  margin: 0 2px 8px;
}
.olab-legend i {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 2px;
  margin-right: 4px;
  vertical-align: -1px;
}
.olab-greeks {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--font-mono);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  overflow: hidden;
  margin-bottom: 8px;
}
.olab-greeks th {
  font-size: 9px;
  letter-spacing: 0.1em;
  color: var(--text-muted);
  font-weight: 400;
  text-align: right;
  padding: 6px 10px;
  border-bottom: 1px solid var(--hairline);
  background: var(--surface-raised);
}
.olab-greeks th:first-child { text-align: left; }
.olab-greeks td {
  padding: 6px 10px;
  text-align: right;
  border-bottom: 1px solid var(--hairline);
  color: var(--text);
}
.olab-greeks td:first-child {
  text-align: left;
  color: var(--text-muted);
  font-family: var(--font-sans);
  font-size: 10px;
}
.olab-greeks tr:last-child td { border-bottom: none; }
.olab-greeks tr.hl td {
  color: var(--acc);
  font-weight: 700;
  background: var(--acc-glow);
}
`;
    document.head.appendChild(style);
  }

  /* ---------- 通用小工具 ---------- */
  const parseVal = (v) => {
    if (v === '' || v == null) return null;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };

  function fmtNum(n, maxDec) {
    if (!Number.isFinite(n)) return '—';
    return n.toLocaleString('en-US', { maximumFractionDigits: maxDec == null ? 2 : maxDec });
  }

  // 价格自适应精度（与 calculators 一致）
  function fmtPrice(v) {
    if (!Number.isFinite(v)) return '—';
    if (v >= 1000) return fmtNum(v, 1);
    if (v >= 100) return fmtNum(v, 2);
    if (v >= 1) return fmtNum(v, 4);
    return fmtNum(v, 6);
  }

  // 坐标轴紧凑格式
  function fmtCompact(v) {
    const a = Math.abs(v);
    if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (a >= 1e5) return (v / 1e3).toFixed(0) + 'k';
    if (a >= 1e4) return (v / 1e3).toFixed(1) + 'k';
    return fmtNum(v, a < 10 ? 2 : a < 1000 ? 1 : 0);
  }

  const fmtSign = (v) => (v >= 0 ? '+' : '') + fmtNum(v, 2);

  const HINT_FILL = '<div class="tool-hint">填写完整参数后自动计算</div>';

  /* ---------- BS 数学：正态分布与 Black-Scholes ---------- */
  // 标准正态 CDF，Abramowitz & Stegun 26.2.17，|误差| < 7.5e-8
  function ncdf(x) {
    if (!Number.isFinite(x)) return x > 0 ? 1 : 0;
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const d = 0.3989422804014327; // 1/sqrt(2π)
    const p =
      d *
      Math.exp((-x * x) / 2) *
      (t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429)))));
    return x > 0 ? 1 - p : p;
  }

  const npdf = (x) => Math.exp((-x * x) / 2) * 0.3989422804014327;

  // S,K 同单位；T 年；sig、r 小数。返回理论价与希腊字母（Theta 每自然日，Vega/Rho 每 1 个百分点）
  function bsAll(S, K, T, sig, r) {
    const sq = Math.sqrt(T);
    const d1 = (Math.log(S / K) + (r + (sig * sig) / 2) * T) / (sig * sq);
    const d2 = d1 - sig * sq;
    const ert = Math.exp(-r * T);
    const Nd1 = ncdf(d1);
    const Nd2 = ncdf(d2);
    const Nmd2 = ncdf(-d2);
    const pdf = npdf(d1);
    return {
      call: S * Nd1 - K * ert * Nd2,
      put: K * ert * Nmd2 - S * ncdf(-d1),
      dC: Nd1,
      dP: Nd1 - 1,
      gamma: pdf / (S * sig * sq),
      vega: (S * pdf * sq) / 100,
      thetaC: (-(S * pdf * sig) / (2 * sq) - r * K * ert * Nd2) / 365,
      thetaP: (-(S * pdf * sig) / (2 * sq) + r * K * ert * Nmd2) / 365,
      rhoC: (K * T * ert * Nd2) / 100,
      rhoP: (-K * T * ert * Nmd2) / 100,
    };
  }

  /* ---------- 策略到期盈亏（分段线性，解析求值） ---------- */
  // leg: {kind:'stock'|'call'|'put', dir:+1 买 / -1 卖, K, prem, S0}
  function legPayoff(leg, st) {
    if (leg.kind === 'stock') return leg.dir * (st - leg.S0);
    if (leg.kind === 'call') return leg.dir * (Math.max(st - leg.K, 0) - leg.prem);
    return leg.dir * (Math.max(leg.K - st, 0) - leg.prem);
  }

  const payoffAt = (legs, st) => legs.reduce((a, l) => a + legPayoff(l, st), 0);

  // 最高行权价之上的盈亏斜率（判断盈亏是否封顶；标的价格有下界 0，低端极值必在候选点内）
  function endSlopeHi(legs) {
    let hi = 0;
    for (const l of legs) {
      if (l.kind === 'stock') hi += l.dir;
      else if (l.kind === 'call') hi += l.dir;
    }
    return hi;
  }

  // 极值：St ∈ [0, ∞)，盈亏分段线性，拐点只在行权价处，候选点 {0, 各行权价} + 高端斜率外推
  function strategyMetrics(legs) {
    const ks = [...new Set(legs.filter((l) => l.K).map((l) => l.K))].sort((a, b) => a - b);
    const cand = [0, ...ks].map((p) => payoffAt(legs, p));
    const sHi = endSlopeHi(legs);
    return {
      maxP: sHi > 1e-12 ? Infinity : Math.max(...cand),
      minP: sHi < -1e-12 ? -Infinity : Math.min(...cand),
    };
  }

  // 盈亏平衡点：分段线性方程求根（区间扫描 + 端部外推）
  function breakevens(legs) {
    const ks = [...new Set(legs.filter((l) => l.K).map((l) => l.K))].sort((a, b) => a - b);
    const pts = [0, ...ks];
    const roots = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const fa = payoffAt(legs, a);
      const fb = payoffAt(legs, b);
      if (Math.abs(fa) < 1e-10) roots.push(a);
      if (fa * fb < 0) roots.push(a - (fa * (b - a)) / (fb - fa));
    }
    const last = pts[pts.length - 1];
    const fl = payoffAt(legs, last);
    const sHi = endSlopeHi(legs);
    if (Math.abs(sHi) > 1e-12 && Math.abs(fl) > 1e-10 && fl * sHi < 0) {
      const r = last - fl / sHi;
      if (r > last) roots.push(r);
    }
    return [...new Set(roots.map((r) => Math.round(r * 1e6) / 1e6))].filter((r) => r >= 0).sort((a, b) => a - b);
  }

  /* ---------- 策略模板 ---------- */
  const F_S = { f: 'S', label: '标的价格 S', def: 100 };
  const F_M = { f: 'M', label: '合约乘数', def: 1 };
  const STRATS = [
    {
      id: 'longcall',
      name: '买入看涨 LONG CALL',
      desc: '买入认购：亏损以权利金为限，上方盈利理论不封顶。',
      fields: [F_S, { f: 'K1', label: '行权价 K', def: 100 }, { f: 'P1', label: '权利金', def: 3 }, F_M],
      legs: (v) => [{ kind: 'call', dir: 1, K: v.K1, prem: v.P1 }],
    },
    {
      id: 'longput',
      name: '买入看跌 LONG PUT',
      desc: '买入认沽：亏损以权利金为限，下方盈利随标的大跌放大。',
      fields: [F_S, { f: 'K1', label: '行权价 K', def: 100 }, { f: 'P1', label: '权利金', def: 2.5 }, F_M],
      legs: (v) => [{ kind: 'put', dir: 1, K: v.K1, prem: v.P1 }],
    },
    {
      id: 'covered',
      name: '备兑看涨 COVERED CALL',
      desc: '持有标的 + 卖出认购：权利金补贴持仓，让渡行权价以上的收益。',
      fields: [F_S, { f: 'K1', label: '行权价 K · 卖出认购', def: 105 }, { f: 'P1', label: '权利金', def: 2 }, F_M],
      legs: (v) => [
        { kind: 'stock', dir: 1, S0: v.S },
        { kind: 'call', dir: -1, K: v.K1, prem: v.P1 },
      ],
    },
    {
      id: 'protect',
      name: '保护性看跌 PROTECTIVE PUT',
      desc: '持有标的 + 买入认沽：支付权利金为持仓买保险，锁定下行风险。',
      fields: [F_S, { f: 'K1', label: '行权价 K · 买入认沽', def: 95 }, { f: 'P1', label: '权利金', def: 1.5 }, F_M],
      legs: (v) => [
        { kind: 'stock', dir: 1, S0: v.S },
        { kind: 'put', dir: 1, K: v.K1, prem: v.P1 },
      ],
    },
    {
      id: 'bullspread',
      name: '牛市价差 BULL CALL SPREAD',
      desc: '买入低行权价认购 + 卖出高行权价认购：低成本做多，盈亏均有限。',
      needOrder: true,
      fields: [
        F_S,
        F_M,
        { f: 'K1', label: '低行权价 K1 · 买入认购', def: 95 },
        { f: 'P1', label: '权利金 ①', def: 4 },
        { f: 'K2', label: '高行权价 K2 · 卖出认购', def: 105 },
        { f: 'P2', label: '权利金 ②', def: 1.5 },
      ],
      legs: (v) => [
        { kind: 'call', dir: 1, K: v.K1, prem: v.P1 },
        { kind: 'call', dir: -1, K: v.K2, prem: v.P2 },
      ],
    },
    {
      id: 'bearspread',
      name: '熊市价差 BEAR PUT SPREAD',
      desc: '买入高行权价认沽 + 卖出低行权价认沽：低成本做空，盈亏均有限。',
      needOrder: true,
      fields: [
        F_S,
        F_M,
        { f: 'K1', label: '低行权价 K1 · 卖出认沽', def: 95 },
        { f: 'P1', label: '权利金 ①', def: 1.5 },
        { f: 'K2', label: '高行权价 K2 · 买入认沽', def: 105 },
        { f: 'P2', label: '权利金 ②', def: 4 },
      ],
      legs: (v) => [
        { kind: 'put', dir: -1, K: v.K1, prem: v.P1 },
        { kind: 'put', dir: 1, K: v.K2, prem: v.P2 },
      ],
    },
    {
      id: 'straddle',
      name: '跨式 LONG STRADDLE',
      desc: '同行权价买入认购 + 认沽：赌大幅波动，方向不限，亏损为双份权利金。',
      fields: [F_S, { f: 'K1', label: '行权价 K（双腿共用）', def: 100 }, { f: 'P1', label: '认购权利金', def: 3 }, { f: 'P2', label: '认沽权利金', def: 2.8 }, F_M],
      legs: (v) => [
        { kind: 'call', dir: 1, K: v.K1, prem: v.P1 },
        { kind: 'put', dir: 1, K: v.K1, prem: v.P2 },
      ],
    },
    {
      id: 'strangle',
      name: '宽跨式 LONG STRANGLE',
      desc: '买入虚值认沽 + 虚值认购：比跨式便宜，但需要更大的波动才能回本。',
      needOrder: true,
      fields: [
        F_S,
        F_M,
        { f: 'K1', label: '低行权价 K1 · 买入认沽', def: 95 },
        { f: 'P1', label: '权利金 ①', def: 1.5 },
        { f: 'K2', label: '高行权价 K2 · 买入认购', def: 105 },
        { f: 'P2', label: '权利金 ②', def: 1.8 },
      ],
      legs: (v) => [
        { kind: 'put', dir: 1, K: v.K1, prem: v.P1 },
        { kind: 'call', dir: 1, K: v.K2, prem: v.P2 },
      ],
    },
  ];

  /* ---------- Tab1: SVG 盈亏图 ---------- */
  const VW = 640;
  const VH = 250;
  const PT = 26; // 上留白（行权价标签）
  const PB = 26; // 下留白（价格刻度）
  const PL = 8;
  const PR = 8;

  function buildChart(legs, M, S, ks) {
    const bes = breakevens(legs);
    const mt = strategyMetrics(legs);
    const center = ks.length ? ks.reduce((a, b) => a + b, 0) / ks.length : S;
    let lo = center * 0.7;
    let hi = center * 1.3;
    if (S > 0) {
      lo = Math.min(lo, S * 0.96);
      hi = Math.max(hi, S * 1.04);
    }
    for (const b of bes) {
      lo = Math.min(lo, b * 0.985);
      hi = Math.max(hi, b * 1.015);
    }
    if (!(lo > 0)) lo = 0.01;

    const N = 200;
    const pts = [];
    let vmin = 0;
    let vmax = 0;
    for (let i = 0; i <= N; i++) {
      const p = lo + ((hi - lo) * i) / N;
      const v = payoffAt(legs, p) * M;
      pts.push({ p, v });
      if (v < vmin) vmin = v;
      if (v > vmax) vmax = v;
    }
    const dv = vmax - vmin || 1;
    vmin -= dv * 0.09;
    vmax += dv * 0.09;

    const X = (p) => PL + ((p - lo) / (hi - lo)) * (VW - PL - PR);
    const Y = (v) => VH - PB - ((v - vmin) / (vmax - vmin)) * (VH - PT - PB);
    const zy = Y(0);
    const F = (n) => n.toFixed(1);

    // 按符号切段（零点附近插值），盈利段绿 / 亏损段红
    const segs = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const xa = X(a.p);
      const ya = Y(a.v);
      const xb = X(b.p);
      const yb = Y(b.v);
      if ((a.v >= 0 && b.v >= 0) || (a.v <= 0 && b.v <= 0)) {
        segs.push({ pos: a.v >= 0, pts: [[xa, ya], [xb, yb]] });
      } else {
        const pc = a.p - (a.v * (b.p - a.p)) / (b.v - a.v);
        const xc = X(pc);
        segs.push({ pos: a.v > 0, pts: [[xa, ya], [xc, zy]] });
        segs.push({ pos: b.v > 0, pts: [[xc, zy], [xb, yb]] });
      }
    }

    let svg = '';
    // 盈亏填充区
    for (const s of segs) {
      const [x1, y1] = s.pts[0];
      const [x2, y2] = s.pts[s.pts.length - 1];
      if (Math.abs(x2 - x1) < 0.01 && Math.abs(y2 - y1) < 0.01) continue;
      svg += `<polygon points="${F(x1)},${F(y1)} ${F(x2)},${F(y2)} ${F(x2)},${F(zy)} ${F(x1)},${F(zy)}" fill="${s.pos ? 'var(--up)' : 'var(--down)'}" fill-opacity="0.10"/>`;
    }
    // 零轴
    svg += `<line x1="${PL}" y1="${F(zy)}" x2="${VW - PR}" y2="${F(zy)}" stroke="var(--hairline-strong)" stroke-width="1" stroke-dasharray="4 3"/>`;
    // 行权价竖线 + 标签（顶部，多 K 时交错）
    ks.forEach((k, i) => {
      const x = X(k);
      svg += `<line x1="${F(x)}" y1="${PT}" x2="${F(x)}" y2="${VH - PB}" stroke="var(--text-dim)" stroke-width="1" stroke-dasharray="2 3" opacity="0.7"/>`;
      svg += `<text x="${F(x)}" y="${12 + (i % 2) * 9}" text-anchor="middle" font-size="8.5" font-family="var(--font-mono)" fill="var(--text-dim)">K${ks.length > 1 ? i + 1 : ''} ${fmtPrice(k)}</text>`;
    });
    // 现价竖线 + 标签（底部）
    if (S > 0 && S >= lo && S <= hi) {
      const x = X(S);
      svg += `<line x1="${F(x)}" y1="${PT}" x2="${F(x)}" y2="${VH - PB}" stroke="var(--info)" stroke-width="1" stroke-dasharray="3 3"/>`;
      svg += `<text x="${F(Math.min(Math.max(x, PL + 14), VW - PR - 14))}" y="${VH - PB - 4}" text-anchor="middle" font-size="8.5" font-family="var(--font-mono)" fill="var(--info)">S ${fmtPrice(S)}</text>`;
    }
    // 盈亏曲线（分段着色）
    for (const s of segs) {
      const [x1, y1] = s.pts[0];
      const [x2, y2] = s.pts[s.pts.length - 1];
      if (Math.abs(x2 - x1) < 0.01 && Math.abs(y2 - y1) < 0.01) continue;
      svg += `<polyline points="${s.pts.map((q) => F(q[0]) + ',' + F(q[1])).join(' ')}" fill="none" stroke="${s.pos ? 'var(--up)' : 'var(--down)'}" stroke-width="1.6" stroke-linejoin="round"/>`;
    }
    // 盈亏平衡点圆点 + 价格标签
    let lastBeX = -999;
    let stagger = 0;
    for (const b of bes) {
      const x = X(b);
      svg += `<circle cx="${F(x)}" cy="${F(zy)}" r="3" fill="var(--warning)" stroke="var(--bg)" stroke-width="1"/>`;
      let ty = zy - 7;
      if (x - lastBeX < 48) {
        stagger ^= 1;
        if (stagger) ty = zy + 13;
      } else {
        stagger = 0;
      }
      lastBeX = x;
      svg += `<text x="${F(x)}" y="${F(ty)}" text-anchor="middle" font-size="8.5" font-family="var(--font-mono)" fill="var(--warning)">${fmtPrice(b)}</text>`;
    }
    // 坐标刻度
    svg += `<text x="${PL + 2}" y="${PT + 2}" font-size="8.5" font-family="var(--font-mono)" fill="var(--text-dim)">${fmtCompact(vmax)}</text>`;
    svg += `<text x="${PL + 2}" y="${VH - PB - 2}" font-size="8.5" font-family="var(--font-mono)" fill="var(--text-dim)">${fmtCompact(vmin)}</text>`;
    svg += `<text x="${PL}" y="${VH - 10}" font-size="8.5" font-family="var(--font-mono)" fill="var(--text-muted)">${fmtPrice(lo)}</text>`;
    svg += `<text x="${F((VW - PL - PR) / 2 + PL)}" y="${VH - 10}" text-anchor="middle" font-size="8.5" font-family="var(--font-mono)" fill="var(--text-muted)">${fmtPrice((lo + hi) / 2)}</text>`;
    svg += `<text x="${VW - PR}" y="${VH - 10}" text-anchor="end" font-size="8.5" font-family="var(--font-mono)" fill="var(--text-muted)">${fmtPrice(hi)}</text>`;

    // 指标行（数值 = 每单位盈亏 × 合约乘数）
    const netPrem = legs.reduce((a, l) => (l.kind === 'stock' ? a : a - l.dir * l.prem), 0) * M;
    const nowPnl = payoffAt(legs, S) * M;
    const maxHtml =
      mt.maxP === Infinity
        ? '<b class="pos">无上限 ∞</b>'
        : `<b class="${mt.maxP * M >= 0 ? 'pos' : 'neg'}">${fmtSign(mt.maxP * M)}</b>`;
    const minHtml =
      mt.minP === -Infinity
        ? '<b class="neg">无下限 -∞</b>'
        : `<b class="${mt.minP * M >= 0 ? 'pos' : 'neg'}">${fmtSign(mt.minP * M)}</b>`;
    const rows = `
      <div class="result-row highlight"><span>最大盈利</span>${maxHtml}</div>
      <div class="result-row"><span>最大亏损</span>${minHtml}</div>
      <div class="result-row"><span>盈亏平衡点</span><b>${bes.length ? bes.map(fmtPrice).join(' / ') : '—'}</b></div>
      <div class="result-row"><span>现价到期盈亏</span><b class="${nowPnl >= 0 ? 'pos' : 'neg'}">${fmtSign(nowPnl)}</b></div>
      <div class="result-row"><span>净权利金（期权腿）</span><b>${
        Math.abs(netPrem) < 1e-10 ? '0' : (netPrem < 0 ? '净支出 ' : '净收入 ') + fmtNum(Math.abs(netPrem), 2)
      }</b></div>`;
    return { svg: `<svg viewBox="0 0 ${VW} ${VH}" class="olab-svg" role="img" aria-label="到期盈亏曲线">${svg}</svg>`, rows };
  }

  /* ---------- Tab1 面板 ---------- */
  function stratHtml() {
    return `
      <label class="field"><span>策略模板</span>
        <select data-f="strat">${STRATS.map((s) => `<option value="${s.id}">${s.name}</option>`).join('')}</select>
      </label>
      <div class="olab-strat-desc" data-desc></div>
      <div data-fields></div>
      <div class="olab-chart-wrap" data-chart></div>
      <div class="olab-legend">
        <span><i style="background:var(--up)"></i>盈利区</span>
        <span><i style="background:var(--down)"></i>亏损区</span>
        <span><i style="background:var(--info)"></i>现价 S</span>
        <span><i style="background:var(--warning)"></i>盈亏平衡点</span>
      </div>
      <div class="tool-results" data-results></div>`;
  }

  function renderStratFields(pane, strat) {
    const fs = strat.fields;
    let html = '';
    for (let i = 0; i < fs.length; i += 2) {
      html +=
        '<div class="tool-grid">' +
        fs
          .slice(i, i + 2)
          .map(
            (f) =>
              `<label class="field"><span>${f.label}</span><input type="number" inputmode="decimal" min="0" step="any" data-f="${f.f}" value="${f.def}"></label>`
          )
          .join('') +
        '</div>';
    }
    pane.querySelector('[data-fields]').innerHTML = html;
    pane.querySelector('[data-desc]').textContent = strat.desc;
  }

  function stratCompute(pane) {
    const chartEl = pane.querySelector('[data-chart]');
    const out = pane.querySelector('[data-results]');
    const sel = pane.querySelector('[data-f="strat"]');
    const strat = STRATS.find((s) => s.id === sel.value) || STRATS[0];
    const fieldsEl = pane.querySelector('[data-fields]');
    if (pane._sid !== strat.id || !fieldsEl.firstChild) {
      pane._sid = strat.id;
      renderStratFields(pane, strat);
    }
    const get = (f) => pane.querySelector(`[data-f="${f}"]`);
    const vals = {};
    let ok = true;
    for (const f of strat.fields) {
      const n = parseVal(get(f.f).value);
      vals[f.f] = n;
      // 权利金允许为 0，其余必须为正
      if (n === null || (f.f[0] === 'P' ? n < 0 : n <= 0)) ok = false;
    }
    if (!ok) {
      chartEl.innerHTML = '';
      out.innerHTML = HINT_FILL;
      return;
    }
    if (strat.needOrder && vals.K1 >= vals.K2) {
      chartEl.innerHTML = '';
      out.innerHTML = '<div class="tool-hint">低行权价 K1 需小于高行权价 K2</div>';
      return;
    }
    const legs = strat.legs(vals);
    const ks = [...new Set(legs.filter((l) => l.K).map((l) => l.K))].sort((a, b) => a - b);
    const res = buildChart(legs, vals.M, vals.S, ks);
    chartEl.innerHTML = res.svg;
    out.innerHTML = res.rows;
  }

  /* ---------- Tab2: BS 定价与希腊字母 ---------- */
  function bsHtml() {
    return `
      <div class="tool-grid">
        <label class="field"><span>标的价格 S</span><input type="number" inputmode="decimal" data-f="S" value="100" min="0" step="any"></label>
        <label class="field"><span>行权价 K</span><input type="number" inputmode="decimal" data-f="K" value="100" min="0" step="any"></label>
      </div>
      <div class="tool-grid">
        <label class="field"><span>到期天数 T（天）</span><input type="number" inputmode="decimal" data-f="T" value="30" min="0" step="any"></label>
        <label class="field"><span>波动率 σ（%）</span><input type="number" inputmode="decimal" data-f="SIG" value="20" min="0" step="any"></label>
      </div>
      <div class="tool-grid">
        <label class="field"><span>无风险利率 r（%）</span><input type="number" inputmode="decimal" data-f="R" value="2" step="any"></label>
      </div>
      <div data-results></div>`;
  }

  function bsCompute(pane) {
    const get = (f) => pane.querySelector(`[data-f="${f}"]`);
    const out = pane.querySelector('[data-results]');
    const S = parseVal(get('S').value);
    const K = parseVal(get('K').value);
    const Td = parseVal(get('T').value);
    const sigPct = parseVal(get('SIG').value);
    const rPct = parseVal(get('R').value);
    if (!S || S <= 0 || !K || K <= 0 || !Td || Td <= 0 || !sigPct || sigPct <= 0 || rPct === null) {
      out.innerHTML = '<div class="tool-hint">S / K / T / σ 需为正数，r 可为任意实数</div>';
      return;
    }
    const g = bsAll(S, K, Td / 365, sigPct / 100, rPct / 100);
    const F4 = (v) => fmtNum(v, 4);
    out.innerHTML = `
      <table class="olab-greeks">
        <thead><tr><th>指标</th><th>认购 CALL</th><th>认沽 PUT</th></tr></thead>
        <tbody>
          <tr class="hl"><td>理论价</td><td>${F4(g.call)}</td><td>${F4(g.put)}</td></tr>
          <tr><td>Delta Δ</td><td>${F4(g.dC)}</td><td>${F4(g.dP)}</td></tr>
          <tr><td>Theta Θ /日</td><td>${F4(g.thetaC)}</td><td>${F4(g.thetaP)}</td></tr>
          <tr><td>Rho Ρ /1%</td><td>${F4(g.rhoC)}</td><td>${F4(g.rhoP)}</td></tr>
          <tr><td>Gamma Γ（C=P）</td><td colspan="2">${F4(g.gamma)}</td></tr>
          <tr><td>Vega ν /1%（C=P）</td><td colspan="2">${F4(g.vega)}</td></tr>
        </tbody>
      </table>
      <div class="tool-hint">T 按自然日 /365 年化；Theta 为每自然日时间损耗；Vega / Rho 对应波动率 / 利率变动 1 个百分点</div>`;
  }

  const PANES = {
    strat: { html: stratHtml, compute: stratCompute },
    bs: { html: bsHtml, compute: bsCompute },
  };

  ROOT.GT_EXTRA_TOOLS['optionlab'] = {
    mount(el, setStatus) {
      injectStyle();
      el.innerHTML = `
        <div class="tool olab-root">
          <div class="olab-tabs" data-tabs>
            ${TABS.map(
              (t, i) =>
                `<button type="button" class="tool-btn ghost olab-tab${i === 0 ? ' active' : ''}" data-tab="${t.id}">${t.label}</button>`
            ).join('')}
          </div>
          <div data-pane></div>
        </div>`;

      const tabsBar = el.querySelector('[data-tabs]');
      const pane = el.querySelector('[data-pane]');
      let activeTab = TABS[0].id;

      const renderTab = (id) => {
        activeTab = id;
        tabsBar.querySelectorAll('.olab-tab').forEach((b) => {
          b.classList.toggle('active', b.dataset.tab === id);
        });
        pane.innerHTML = PANES[id].html();
        PANES[id].compute(pane);
      };

      const onTabClick = (e) => {
        const btn = e.target.closest('.olab-tab');
        if (!btn || btn.dataset.tab === activeTab) return;
        renderTab(btn.dataset.tab);
      };
      const onInput = () => PANES[activeTab].compute(pane);

      tabsBar.addEventListener('click', onTabClick);
      pane.addEventListener('input', onInput);
      pane.addEventListener('change', onInput);

      renderTab(activeTab);
      setStatus('online'); // 纯本地计算，挂载即可用

      return () => {
        tabsBar.removeEventListener('click', onTabClick);
        pane.removeEventListener('input', onInput);
        pane.removeEventListener('change', onInput);
      };
    },
  };

  // Node 环境导出纯函数便于自测（浏览器 script 标签下无 module，自动跳过）
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ncdf, bsAll, payoffAt, strategyMetrics, breakevens, buildChart, STRATS };
  }
})();
