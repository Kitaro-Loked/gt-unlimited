# GT UNLIMITED — 金融终端

[English](../README.md) | 中文

一个自托管、单页的金融监控终端，灵感来自 Bloomberg / TradingView。使用原生 HTML/CSS/JS 构建，面向希望拥有集中式全球行情、衍生品、风险、宏观事件与新闻看板的交易者。

- **官方实例**: https://trading.2009731.xyz
- **开源仓库**: https://github.com/Kitaro-Loked/gt-unlimited

## 目录

- [功能特性](#功能特性)
- [技术栈](#技术栈)
- [快速开始](#快速开始)
- [项目结构](#项目结构)
- [配置](#配置)
- [路线图](#路线图)
- [如何贡献](#如何贡献)
- [行为准则](#行为准则)
- [许可证](#许可证)

## 功能特性

### 多资产行情
- 股票、加密货币、外汇、大宗商品、利率、ETF
- TradingView 主图、热力图、技术分析、扫描器

### 衍生品工具箱
- 期权链与期权实验室
- **期权波动率曲面**（Volatility Surface）
- **互换（Swaps）** 定价与现金流分析
- **结构化产品**定价与情景分析

### 投资组合与风险
- 实时 PnL 与归因分析（Attribution Analysis）
- Beta / Alpha 测算
- 参数法 / 历史法 / 蒙特卡洛 VaR
- 压力测试（Stress Testing）
- 债券久期 / 凸性（Duration / Convexity）拉动分析

### 基本面与财务分析
- 超过 20 年的标准化与原始财务报表（FA）
- 自动调整后的财务比率
- 公司概况与管理层信息（DES）
- 股权结构分析（Ownership Analysis）
- 卖方一致预期（Target Price / EPS Consensus）
- 卖方研究报告（RES）：汇集摩根士丹利、高盛等投行深度研报
- 全球并购交易数据库（M&A Deals）
- 估值模型与可比公司分析（Comps）

### 宏观与全球事件
- 交互式 2D / 3D 地球仪
- 风险监控、央行利率、收益率曲线、经济日历
- 可切换显示的新闻事件层级

### 新闻室与音频
- 多源 RSS 新闻墙
- 文本转语音播报
- 可直接播放新闻的广播看板
- 内置背景音乐播放器

### 工作区预设
- 一键切换：A股、美股科技、加密货币、外汇大宗、风控、新闻等看板

## 技术栈

- 原生 HTML5 / CSS3 / JavaScript（无构建步骤）
- [GridStack](https://gridstackjs.com/) 可拖拽小部件
- [TradingView](https://www.tradingview.com/widget/) 嵌入组件
- Leaflet + [globe.gl](https://globe.gl/) 事件地球仪
- 轻量级 Node.js CORS 代理（`api/proxy-server.js`）
- [Caddy](https://caddyserver.com/) 生产静态服务器 / 反向代理

## 快速开始

GT UNLIMITED 可以在任意服务器部署。以下提供三种方式。

### A. IP + 端口（最快，纯 HTTP）

无需域名或 Caddy，Node 代理本身就提供静态前端服务。

```bash
cd gt-unlimited
node api/proxy-server.js
```

然后访问 `http://<你的服务器IP>:3456`。

默认监听 `0.0.0.0:3456`。可通过 `PORT=8080 node api/proxy-server.js` 修改端口。

### B. 绑定域名并自动申请 HTTPS（Caddy）

```bash
cd gt-unlimited

# 1. 复制模板并填写你的域名
cp Caddyfile.example Caddyfile
# 编辑 Caddyfile：把 example.com 换成你的域名

# 2. 启动 CORS 代理
node api/proxy-server.js &

# 3. 启动 Caddy
caddy run
```

自动 HTTPS 要求：
- DNS A 记录指向服务器 IP；
- 服务器 80 / 443 端口对外开放；
- Caddy 会自动向 Let's Encrypt 申请并续期证书。

### C. 本地开发

```bash
cd gt-unlimited
node api/proxy-server.js &
# 打开 http://localhost:3456
```

## 项目结构

```
gt-unlimited/
├── api/                       # Node.js CORS 代理服务
├── web/                       # 前端静态文件
│   ├── assets/                # 图片、字体、全局样式
│   ├── index.html             # 单页入口
│   ├── config.example.js      # 登录配置模板
│   └── sw.js                  # Service Worker
├── scripts/                   # 辅助脚本
├── docs/                      # 多语言文档
├── Caddyfile.example          # Caddy 配置模板
├── .gitignore                 # Caddyfile 与本地配置被忽略
├── LICENSE                    # MIT 许可证
└── README.md                  # 英文主文档
```

## 配置

默认无需登录即可启动。如需启用登录页：

```bash
cp web/config.example.js web/config.js
# 编辑 web/config.js 设置用户名与密码
```

## 路线图

- [ ] 期权波动率曲面 3D 可视化
- [ ] 利率 / 信用 / 商品互换计算器
- [ ] 结构化产品定价引擎（雪球、反向可转换债券等）
- [ ] 标准化财务报表拆解（20+ 年历史）
- [ ] 卖方研报聚合与全文检索
- [ ] 投资组合归因与风险模型
- [ ] Excel / Google Sheets 插件（财务建模与估值）
- [ ] 3D 地球仪与 2D 地图功能对齐
- [ ] 新闻 TTS 广播看板
- [ ] 音乐播放器稳定性优化

## 如何贡献

欢迎所有语言的开发者参与！请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 与 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。

## 行为准则

本项目遵循 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。

## 许可证

[MIT License](../LICENSE) © Kitaro-Loked
