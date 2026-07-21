/**
 * GT UNLIMITED - Financial Terminal
 * Optimized single-page dashboard for trading.2009731.xyz
 */

(function () {
  'use strict';

  const STORAGE_KEYS = {
    auth: 'terminal_auth_v2',
    user: 'terminal_curr_user',
    theme: 'terminal_theme',
    // v11: 新增打新系列 4 组件（A股打新/港股打新/美股打新/新股表现），升 key 使旧布局失效
    layout: 'gridstack-layout-v11',
    journal: 'terminal-journal-v1',
    ghost: 'terminal-ghost-v1',
  };

  const CONFIG = {
    // 如需登录验证，在 index.html 加载 app.js 之前引入 web/config.js 并设置 window.TERMINAL_AUTH
    login: (typeof window !== 'undefined' && window.TERMINAL_AUTH) || null,
    clocks: {
      HKG: 'Asia/Hong_Kong',
      DXB: 'Asia/Dubai',
      NYC: 'America/New_York',
      SYD: 'Australia/Sydney',
    },
    grid: {
      column: 12,
      cellHeight: '40px',
      margin: 5,
      float: true,
      handle: '.drag-handle',
      animate: true,
      resizable: { autoHide: false, handles: 'se' },
    },
    chart: {
      autosize: true,
      symbol: 'FX:AUDUSD',
      interval: '1',
      timezone: 'Asia/Hong_Kong',
      style: '1',
      locale: 'zh_CN',
      enable_publishing: false,
      allow_symbol_change: true,
      hide_side_toolbar: false,
      withdateranges: true,
      details: true,
      hotlist: true,
      calendar: true,
      show_popup_button: true,
    },
  };

  const WIDGETS = {
    // 主图：TradingView 高级图表（核心图表组件）
    main: {
      title: 'CORE_TERMINAL',
      cn: '主图',
      w: 8,
      h: 12,
      minW: 4,
      minH: 6,
      type: 'chart',
      icon: '📈',
    },
    // 外汇交叉盘：TradingView 货币对报价矩阵
    forex: {
      title: 'FOREX',
      cn: '外汇交叉盘',
      w: 4,
      h: 5,
      minW: 2,
      minH: 3,
      type: 'iframe',
      src: 'https://www.tradingview.com/embed-widget/forex-cross-rates/',
      icon: '💱',
    },
    // 科学计算器：Desmos 嵌入式计算器
    calc: {
      title: 'CALCULATOR',
      cn: '科学计算器',
      w: 4,
      h: 6,
      minW: 2,
      minH: 3,
      type: 'iframe',
      src: 'https://www.desmos.com/scientific?embed',
      className: 'calc-frame',
      icon: '🧮',
    },
    // 实时快讯：金十数据 7×24 快讯流
    news: {
      title: 'LIVE_NEWS',
      cn: '实时快讯',
      w: 4,
      h: 5,
      minW: 2,
      minH: 3,
      type: 'iframe',
      src: 'https://www.jin10.com/example/flash_v2.html',
      icon: '📰',
    },
    // 财经日历：TradingView 财经事件日历
    calendar: {
      title: 'CALENDAR',
      cn: '财经日历',
      w: 6,
      h: 6,
      minW: 3,
      minH: 4,
      type: 'iframe',
      src: 'https://www.tradingview.com/embed-widget/events/',
      icon: '📅',
    },
    // 股票扫描器：TradingView 股票筛选器
    scanner: {
      title: 'SCANNER',
      cn: '股票扫描器',
      w: 6,
      h: 6,
      minW: 3,
      minH: 4,
      type: 'iframe',
      src: 'https://www.tradingview.com/embed-widget/screener/',
      icon: '🔍',
    },
    // 音乐流：修复为原生音频播放器
    music: {
      title: 'AUDIO_STREAM',
      cn: '音乐流',
      w: 4,
      h: 6,
      minW: 3,
      minH: 4,
      type: 'custom',
      tool: 'musicplayer',
      icon: '🎵',
    },
    // 仓位计算器：风险/仓位/盈亏比计算
    risk: {
      title: 'RISK_CALC',
      cn: '仓位计算器',
      w: 4,
      h: 7,
      minW: 3,
      minH: 5,
      type: 'custom',
      tool: 'risk',
      icon: '🎯',
    },
    // 加密货币：加密行情综合面板
    crypto: {
      title: 'CRYPTO_BOARD',
      cn: '加密货币',
      w: 4,
      h: 7,
      minW: 3,
      minH: 4,
      type: 'custom',
      tool: 'crypto',
      icon: '🪙',
    },
    // 恐慌贪婪指数：Alternative.me 情绪指标
    feargreed: {
      title: 'FEAR_GREED',
      cn: '恐慌贪婪指数',
      w: 4,
      h: 5,
      minW: 3,
      minH: 4,
      type: 'custom',
      tool: 'feargreed',
      icon: '😨',
    },
    // 技术评级：TradingView 技术分析评分
    tech: {
      title: 'TECH_RATING',
      cn: '技术评级',
      w: 4,
      h: 6,
      minW: 3,
      minH: 4,
      type: 'tv-embed',
      embed: 'technical-analysis',
      icon: '🧭',
    },
    // 外汇热力图：TradingView 外汇热力图
    heatmap: {
      title: 'FX_HEATMAP',
      cn: '外汇热力图',
      w: 6,
      h: 6,
      minW: 3,
      minH: 4,
      type: 'tv-embed',
      embed: 'forex-heat-map',
      icon: '🗺️',
    },
    // 斐波那契计算：回撤/扩展位计算
    fib: {
      title: 'FIB_LEVELS',
      cn: '斐波那契计算',
      w: 4,
      h: 6,
      minW: 3,
      minH: 4,
      type: 'custom',
      tool: 'fib',
      icon: '📐',
    },
    // 枢轴点计算：Classic / Camarilla / Fib
    pivot: {
      title: 'PIVOT_POINTS',
      cn: '枢轴点计算',
      w: 4,
      h: 6,
      minW: 3,
      minH: 4,
      type: 'custom',
      tool: 'pivot',
      icon: '⚖️',
    },
    // 全球交易时段：各市场开收盘倒计时
    sessions: {
      title: 'FX_SESSIONS',
      cn: '全球交易时段',
      w: 12,
      h: 14,
      minW: 6,
      minH: 6,
      type: 'custom',
      tool: 'sessions',
      icon: '🌐',
    },
    // 交易日志：记录交易与复盘
    journal: {
      title: 'TRADE_JOURNAL',
      cn: '交易日志',
      w: 6,
      h: 8,
      minW: 4,
      minH: 5,
      type: 'custom',
      tool: 'journal',
      icon: '📓',
    },
    // 全球市场概览：TradingView 市场概览
    marketview: {
      title: 'GLOBAL_MARKETS',
      cn: '全球市场概览',
      w: 6,
      h: 7,
      minW: 3,
      minH: 4,
      type: 'tv-embed',
      embed: 'market-overview',
      icon: '🌍',
    },
    // 美股热力图：标普 500 板块热力图
    stockheat: {
      title: 'US_HEATMAP',
      cn: '美股热力图',
      w: 6,
      h: 7,
      minW: 3,
      minH: 4,
      type: 'tv-embed',
      embed: 'stock-heatmap',
      icon: '🔥',
    },
    // 加密热力图：市值与涨跌热力图
    cryptoheat: {
      title: 'CRYPTO_HEATMAP',
      cn: '加密热力图',
      w: 6,
      h: 7,
      minW: 3,
      minH: 4,
      type: 'tv-embed',
      embed: 'crypto-heatmap',
      icon: '🧊',
    },
    // 实时汇率：主要货币对报价
    fxrates: {
      title: 'FX_RATES',
      cn: '实时汇率',
      w: 4,
      h: 7,
      minW: 3,
      minH: 5,
      type: 'custom',
      tool: 'fxrates',
      icon: '💹',
    },
    // 加密市场全局：市值/恐惧/多空情绪
    gcrypto: {
      title: 'CRYPTO_GLOBAL',
      cn: '加密市场全局',
      w: 4,
      h: 7,
      minW: 3,
      minH: 5,
      type: 'custom',
      tool: 'gcrypto',
      icon: '📊',
    },
    // 资金费率：币安合约资金费率
    funding: {
      title: 'FUNDING_RATES',
      cn: '资金费率',
      w: 4,
      h: 7,
      minW: 3,
      minH: 5,
      type: 'custom',
      tool: 'funding',
      icon: '⚡',
    },
    // 大宗商品：黄金/原油/铜等报价
    commodities: {
      title: 'COMMODITIES',
      cn: '大宗商品',
      w: 4,
      h: 7,
      minW: 3,
      minH: 4,
      type: 'custom',
      tool: 'commodities',
      icon: '🛢️',
    },
    // 价格提醒：自定义价格告警
    alerts: {
      title: 'PRICE_ALERTS',
      cn: '价格提醒',
      w: 4,
      h: 7,
      minW: 3,
      minH: 5,
      type: 'custom',
      tool: 'alerts',
      icon: '🔔',
    },
    // 自选观察：自定义品种列表
    watchlist: {
      title: 'WATCHLIST',
      cn: '自选观察',
      w: 4,
      h: 7,
      minW: 3,
      minH: 5,
      type: 'custom',
      tool: 'watchlist',
      icon: '⭐',
    },
    // 多空情绪：币安多空持仓比
    sentiment: {
      title: 'LS_SENTIMENT',
      cn: '多空情绪',
      w: 4,
      h: 7,
      minW: 3,
      minH: 5,
      type: 'custom',
      tool: 'sentiment',
      icon: '🧠',
    },
    // 爆仓监控：实时大额爆仓数据
    liquidations: {
      title: 'LIQUIDATIONS',
      cn: '爆仓监控',
      w: 4,
      h: 7,
      minW: 3,
      minH: 5,
      type: 'custom',
      tool: 'liquidations',
      icon: '💥',
    },
    // 我的爆仓(币安)：币安强平记录
    myliquidations: {
      title: 'MY_LIQS',
      cn: '我的爆仓(币安)',
      w: 4,
      h: 7,
      minW: 3,
      minH: 5,
      type: 'custom',
      tool: 'myliquidations',
      icon: '🔑',
    },
    // 全市场爆仓：全交易所爆仓汇总
    marketliqs: {
      title: 'MARKET_LIQS',
      cn: '全市场爆仓',
      w: 4,
      h: 7,
      minW: 3,
      minH: 5,
      type: 'custom',
      tool: 'marketliqs',
      icon: '🌐',
    },
    // A股热力图：申万行业热力图
    ashareheat: {
      title: 'A_HEATMAP',
      cn: 'A股热力图',
      w: 6,
      h: 7,
      minW: 4,
      minH: 5,
      type: 'custom',
      tool: 'ashareheat',
      icon: '🟥',
    },
    // A股涨停池：涨停/炸板/跌停监控
    asharelimit: {
      title: 'A_LIMIT_UP',
      cn: 'A股涨停池',
      w: 4,
      h: 7,
      minW: 3,
      minH: 5,
      type: 'custom',
      tool: 'asharelimit',
      icon: '🚀',
    },
    // A股盘面总览：涨跌家数与量能
    ashareboard: {
      title: 'A_BOARD',
      cn: 'A股盘面总览',
      w: 4,
      h: 7,
      minW: 3,
      minH: 5,
      type: 'custom',
      tool: 'ashareboard',
      icon: '📈',
    },
    // 技术仪表盘：多周期技术指标
    indicators: {
      title: 'TA_DASHBOARD',
      cn: '技术仪表盘',
      w: 6,
      h: 7,
      minW: 4,
      minH: 5,
      type: 'custom',
      tool: 'indicators',
      icon: '📶',
    },
    // 相关性矩阵：资产相关性分析
    correlation: {
      title: 'CORRELATION',
      cn: '相关性矩阵',
      w: 6,
      h: 7,
      minW: 4,
      minH: 5,
      type: 'custom',
      tool: 'correlation',
      icon: '🔗',
    },
    // 外汇金属行情：货币对与贵金属
    fxboard: {
      title: 'FX_METALS',
      cn: '外汇金属行情',
      w: 4,
      h: 7,
      minW: 3,
      minH: 5,
      type: 'custom',
      tool: 'fxboard',
      icon: '💱',
    },
    // 货币强弱：G8 货币强弱指数
    fxstrength: {
      title: 'CCY_STRENGTH',
      cn: '货币强弱',
      w: 4,
      h: 6,
      minW: 3,
      minH: 4,
      type: 'custom',
      tool: 'fxstrength',
      icon: '💪',
    },
    // 自动枢轴点：自动计算日/周枢轴
    autopivot: {
      title: 'AUTO_PIVOT',
      cn: '自动枢轴点',
      w: 4,
      h: 7,
      minW: 3,
      minH: 5,
      type: 'custom',
      tool: 'autopivot',
      icon: '⚖️',
    },
    // 交易计算器Pro：点值/保证金/盈亏
    calculators: {
      title: 'TRADE_CALCS',
      cn: '交易计算器Pro',
      w: 4,
      h: 7,
      minW: 3,
      minH: 5,
      type: 'custom',
      tool: 'calculators',
      icon: '🧮',
    },
    // 复利与期望：复利与期望收益计算
    compound: {
      title: 'COMPOUND_RR',
      cn: '复利与期望',
      w: 4,
      h: 7,
      minW: 3,
      minH: 5,
      type: 'custom',
      tool: 'compound',
      icon: '📈',
    },
    // 交易纪律清单：开仓前检查清单
    checklist: {
      title: 'CHECKLIST',
      cn: '交易纪律清单',
      w: 4,
      h: 7,
      minW: 3,
      minH: 4,
      type: 'custom',
      tool: 'checklist',
      icon: '✅',
    },
    // 交易笔记：随手记录交易想法
    notes: {
      title: 'TRADE_NOTES',
      cn: '交易笔记',
      w: 5,
      h: 7,
      minW: 3,
      minH: 4,
      type: 'custom',
      tool: 'notes',
      icon: '📝',
    },
    // A股资金流向：南北向与主力流向
    ashareflow: {
      title: 'A_MONEY_FLOW',
      cn: 'A股资金流向',
      w: 4,
      h: 7,
      minW: 3,
      minH: 5,
      type: 'custom',
      tool: 'ashareflow',
      icon: '💰',
    },
    // A股市场情绪：涨跌与涨跌停情绪
    asharemood: {
      title: 'A_MOOD',
      cn: 'A股市场情绪',
      w: 4,
      h: 7,
      minW: 3,
      minH: 5,
      type: 'custom',
      tool: 'asharemood',
      icon: '🌡️',
    },
    // A股多维榜单：涨幅/换手率/量比
    asharehot: {
      title: 'A_LEADERS',
      cn: 'A股多维榜单',
      w: 6,
      h: 7,
      minW: 4,
      minH: 5,
      type: 'custom',
      tool: 'asharehot',
      icon: '📊',
    },
    // 币安涨跌榜：24h 涨跌排行
    cryptotop: {
      title: 'CRYPTO_TOP',
      cn: '币安涨跌榜',
      w: 4,
      h: 7,
      minW: 3,
      minH: 5,
      type: 'custom',
      tool: 'cryptotop',
      icon: '🏆',
    },
    // 合约持仓量监控：持仓量变化
    cryptooi: {
      title: 'CRYPTO_OI',
      cn: '合约持仓量监控',
      w: 4,
      h: 6,
      minW: 3,
      minH: 4,
      type: 'custom',
      tool: 'cryptooi',
      icon: '📈',
    },
    // 全球股指：主要股指行情
    globalidx: {
      title: 'GLOBAL_IDX',
      cn: '全球股指',
      w: 6,
      h: 7,
      minW: 4,
      minH: 5,
      type: 'custom',
      tool: 'globalidx',
      icon: '🌐',
    },
    // 港股行情板：港股涨跌榜
    hkboard: {
      title: 'HK_BOARD',
      cn: '港股行情板',
      w: 4,
      h: 7,
      minW: 3,
      minH: 5,
      type: 'custom',
      tool: 'hkboard',
      icon: '🇭🇰',
    },
    // 美股行情板：美股涨跌榜
    usboard: {
      title: 'US_BOARD',
      cn: '美股行情板',
      w: 4,
      h: 7,
      minW: 3,
      minH: 5,
      type: 'custom',
      tool: 'usboard',
      icon: '🇺🇸',
    },
    // A股板块热度：行业资金流向
    asharesector: {
      title: 'A_SECTORS',
      cn: 'A股板块热度',
      w: 6,
      h: 7,
      minW: 4,
      minH: 5,
      type: 'custom',
      tool: 'asharesector',
      icon: '🏭',
    },
    // A股涨停梯队：连板高度统计
    ashareladder: {
      title: 'A_LADDER',
      cn: 'A股涨停梯队',
      w: 4,
      h: 7,
      minW: 3,
      minH: 5,
      type: 'custom',
      tool: 'ashareladder',
      icon: '🪜',
    },
    // A股个股速查：个股行情速览
    asharequote: {
      title: 'A_QUOTE',
      cn: 'A股个股速查',
      w: 4,
      h: 6,
      minW: 3,
      minH: 4,
      type: 'custom',
      tool: 'asharequote',
      icon: '🔎',
    },
    // A股资金面：两融/北向/资金流
    asharecapital: {
      title: 'A_CAPITAL',
      cn: 'A股资金面',
      w: 6,
      h: 8,
      minW: 4,
      minH: 6,
      type: 'custom',
      tool: 'asharecapital',
      icon: '💸',
    },
    // 期指与ETF：股指期货与ETF行情
    asharefut: {
      title: 'A_FUT_ETF',
      cn: '期指与ETF',
      w: 4,
      h: 7,
      minW: 3,
      minH: 5,
      type: 'custom',
      tool: 'asharefut',
      icon: '📉',
    },
    // 可转债与新股：可转债与新股日历
    asharecb: {
      title: 'A_CB_IPO',
      cn: '可转债与新股',
      w: 4,
      h: 7,
      minW: 3,
      minH: 5,
      type: 'custom',
      tool: 'asharecb',
      icon: '📑',
    },
    // 多空持仓比：账户多空比监控
    cryptols: {
      title: 'CRYPTO_LS',
      cn: '多空持仓比',
      w: 4,
      h: 9,
      minW: 3,
      minH: 6,
      type: 'custom',
      tool: 'cryptols',
      icon: '🐂',
    },
    // 期现基差套利：合约基差监控
    cryptobasis: {
      title: 'CRYPTO_BASIS',
      cn: '期现基差套利',
      w: 4,
      h: 8,
      minW: 4,
      minH: 6,
      type: 'custom',
      tool: 'cryptobasis',
      icon: '🏷️',
    },
    // 期权波动率：DVOL 与隐含波动
    cryptodvol: {
      title: 'CRYPTO_VOL',
      cn: '期权波动率',
      w: 5,
      h: 6,
      minW: 4,
      minH: 5,
      type: 'custom',
      tool: 'cryptodvol',
      icon: '📡',
    },
    // 新币上线监控：币安新币与涨幅
    cryptonew: {
      title: 'CRYPTO_NEW',
      cn: '新币上线监控',
      w: 5,
      h: 8,
      minW: 4,
      minH: 6,
      type: 'custom',
      tool: 'cryptonew',
      icon: '🆕',
    },
    // 币圈量能异动榜：成交量异动
    cryptovol: {
      title: 'CRYPTO_VOLSPIKE',
      cn: '币圈量能异动榜',
      w: 4,
      h: 6,
      minW: 3,
      minH: 4,
      type: 'custom',
      tool: 'cryptovol',
      icon: '🌋',
    },
    // 全球债市：主要国债收益率
    globalbond: {
      title: 'GLOBAL_BOND',
      cn: '全球债市',
      w: 4,
      h: 7,
      minW: 3,
      minH: 5,
      type: 'custom',
      tool: 'globalbond',
      icon: '🏦',
    },
    // 美股明星榜：热门美股榜
    ushot: {
      title: 'US_HOT',
      cn: '美股明星榜',
      w: 4,
      h: 7,
      minW: 3,
      minH: 5,
      type: 'custom',
      tool: 'ushot',
      icon: '🌟',
    },
    // 欧股行情板：欧洲股指与个股
    euboard: {
      title: 'EU_BOARD',
      cn: '欧股行情板',
      w: 6,
      h: 9,
      minW: 4,
      minH: 6,
      type: 'custom',
      tool: 'euboard',
      icon: '🇪🇺',
    },
    // 全球期货：商品期货行情
    globalfut: {
      title: 'GLOBAL_FUT',
      cn: '全球期货',
      w: 6,
      h: 7,
      minW: 4,
      minH: 5,
      type: 'custom',
      tool: 'globalfut',
      icon: '🌾',
    },
    // ETF期权链：50ETF/300ETF 期权
    optionchain: {
      title: 'A_OPTION',
      cn: 'ETF期权链',
      w: 4,
      h: 7,
      minW: 3,
      minH: 5,
      type: 'custom',
      tool: 'optionchain',
      icon: '⛓️',
    },
    // 期权情绪流：期权大单流向
    cryptooptflow: {
      title: 'CRYPTO_OPT',
      cn: '期权情绪流',
      w: 5,
      h: 8,
      minW: 4,
      minH: 7,
      type: 'custom',
      tool: 'cryptooptflow',
      icon: '🎚️',
    },
    // 期权实验室：期权盈亏模拟
    optionlab: {
      title: 'OPTION_LAB',
      cn: '期权实验室',
      w: 4,
      h: 8,
      minW: 3,
      minH: 6,
      type: 'custom',
      tool: 'optionlab',
      icon: '🧪',
    },
    // 人气热股榜：WSB 与热门股
    hotrank: {
      title: 'HOT_RANK',
      cn: '人气热股榜',
      w: 4,
      h: 7,
      minW: 3,
      minH: 5,
      type: 'custom',
      tool: 'hotrank',
      icon: '🎖️',
    },
    // 台股行情板：台湾股市行情
    twboard: {
      title: 'TW_BOARD',
      cn: '台股行情板',
      w: 4,
      h: 7,
      minW: 3,
      minH: 5,
      type: 'custom',
      tool: 'twboard',
      icon: '🥭',
    },
    // 亚太明星股：亚太热门个股
    asiahot: {
      title: 'ASIA_HOT',
      cn: '亚太明星股',
      w: 4,
      h: 9,
      minW: 3,
      minH: 6,
      type: 'custom',
      tool: 'asiahot',
      icon: '🌏',
    },
    // 新兴市场股：新兴国家热股
    emhot: {
      title: 'EM_HOT',
      cn: '新兴市场股',
      w: 4,
      h: 6,
      minW: 3,
      minH: 4,
      type: 'custom',
      tool: 'emhot',
      icon: '🌎',
    },
    // 南向资金：港股通资金流向
    hkflow: {
      title: 'HK_FLOW',
      cn: '南向资金',
      w: 4,
      h: 8,
      minW: 3,
      minH: 6,
      type: 'custom',
      tool: 'hkflow',
      icon: '🌊',
    },
    // 策略计算器：期权与波动率工具
    tradecalc: {
      title: 'TRADE_TOOLS',
      cn: '策略计算器',
      w: 4,
      h: 7,
      minW: 3,
      minH: 5,
      type: 'custom',
      tool: 'tradecalc',
      icon: '🕸️',
    },
    // 市场假期日历：全球交易所假期
    holidays: {
      title: 'HOLIDAYS',
      cn: '市场假期日历',
      w: 4,
      h: 7,
      minW: 3,
      minH: 5,
      type: 'custom',
      tool: 'holidays',
      icon: '🏖️',
    },
    // 经济数据日历：宏观数据发布
    econdata: {
      title: 'ECON_DATA',
      cn: '经济数据日历',
      w: 6,
      h: 9,
      minW: 4,
      minH: 6,
      type: 'custom',
      tool: 'econdata',
      icon: '🗓️',
    },
    // 分红与高股息：A股分红榜
    dividend: {
      title: 'A_DIVIDEND',
      cn: '分红与高股息',
      w: 6,
      h: 7,
      minW: 4,
      minH: 5,
      type: 'custom',
      tool: 'dividend',
      icon: '💵',
    },
    // A股打新：A股新股申购
    ipoashare: {
      title: 'A_IPO',
      cn: 'A股打新',
      w: 6,
      h: 8,
      minW: 4,
      minH: 6,
      type: 'custom',
      tool: 'ipoashare',
      icon: '🀄',
    },
    // 港股打新：港股新股申购
    ipohk: {
      title: 'HK_IPO',
      cn: '港股打新',
      w: 4,
      h: 7,
      minW: 3,
      minH: 5,
      type: 'custom',
      tool: 'ipohk',
      icon: '🎟️',
    },
    // 美股打新：美股IPO日历
    ipous: {
      title: 'US_IPO',
      cn: '美股打新',
      w: 4,
      h: 7,
      minW: 3,
      minH: 5,
      type: 'custom',
      tool: 'ipous',
      icon: '🗽',
    },
    // 新股表现：上市表现统计
    ipostats: {
      title: 'IPO_STATS',
      cn: '新股表现',
      w: 6,
      h: 9,
      minW: 4,
      minH: 7,
      type: 'custom',
      tool: 'ipostats',
      icon: '🎰',
    },
    // 全球热力图：全球股市热力图
    worldheat: {
      title: 'WORLD_HEAT',
      cn: '全球热力图',
      w: 6,
      h: 7,
      minW: 4,
      minH: 5,
      type: 'custom',
      tool: 'worldheat',
      icon: '🌡️',
    },
    // 全球事件地球仪：3D 地球事件
    globe: {
      title: 'GLOBE_EVENTS',
      cn: '全球事件地球仪',
      w: 8,
      h: 8,
      minW: 4,
      minH: 5,
      type: 'custom',
      tool: 'globe',
      icon: '🌍',
    },
    // Polymarket预测市场：事件预测市场
    polymarket: {
      title: 'POLYMARKET',
      cn: 'Polymarket预测市场',
      w: 6,
      h: 8,
      minW: 4,
      minH: 5,
      type: 'custom',
      tool: 'polymarket',
      icon: '🔮',
    },
    // 日股行情板：日经/东证个股
    jpboard: {
      title: 'JP_BOARD',
      cn: '日股行情板',
      w: 4,
      h: 7,
      minW: 3,
      minH: 5,
      type: 'custom',
      tool: 'jpboard',
      icon: '🇯🇵',
    },
    // 印度行情板：印度股指与个股
    inboard: {
      title: 'IN_BOARD',
      cn: '印度行情板',
      w: 4,
      h: 7,
      minW: 3,
      minH: 5,
      type: 'custom',
      tool: 'inboard',
      icon: '🇮🇳',
    },
    // 英股行情板：富时/英股行情
    ukboard: {
      title: 'UK_BOARD',
      cn: '英股行情板',
      w: 4,
      h: 7,
      minW: 3,
      minH: 5,
      type: 'custom',
      tool: 'ukboard',
      icon: '🇬🇧',
    },
    // 德股行情板：DAX/德股行情
    deboard: {
      title: 'DE_BOARD',
      cn: '德股行情板',
      w: 4,
      h: 7,
      minW: 3,
      minH: 5,
      type: 'custom',
      tool: 'deboard',
      icon: '🇩🇪',
    },
    // 巴西行情板：巴西股指与个股
    brboard: {
      title: 'BR_BOARD',
      cn: '巴西行情板',
      w: 4,
      h: 7,
      minW: 3,
      minH: 5,
      type: 'custom',
      tool: 'brboard',
      icon: '🇧🇷',
    },
    // 市场情绪：综合情绪指标
    marketsentiment: {
      title: 'MARKET_SENTIMENT',
      cn: '市场情绪',
      w: 4,
      h: 7,
      minW: 3,
      minH: 5,
      type: 'custom',
      tool: 'marketsentiment',
      icon: '🧭',
    },
    // 产业链关联：行业上下游关系
    supplychain: {
      title: 'SUPPLY_CHAIN',
      cn: '产业链关联',
      w: 6,
      h: 8,
      minW: 4,
      minH: 5,
      type: 'custom',
      tool: 'supplychain',
      icon: '🔗',
    },
    // 中东行情板：中东市场
    mideastboard: {
      title: 'MEA_BOARD',
      cn: '中东行情板',
      w: 6,
      h: 8,
      minW: 4,
      minH: 5,
      type: 'custom',
      tool: 'mideastboard',
      icon: '🕌',
    },
    // 非洲行情板：非洲市场
    africaboard: {
      title: 'AFRICA_BOARD',
      cn: '非洲行情板',
      w: 5,
      h: 7,
      minW: 3,
      minH: 4,
      type: 'custom',
      tool: 'africaboard',
      icon: '🌍',
    },
    // 拉美行情板：拉美市场
    latamboard: {
      title: 'LATAM_BOARD',
      cn: '拉美行情板',
      w: 5,
      h: 7,
      minW: 3,
      minH: 4,
      type: 'custom',
      tool: 'latamboard',
      icon: '🌎',
    },
    // 东盟行情板：东南亚市场
    aseanboard: {
      title: 'ASEAN_BOARD',
      cn: '东盟行情板',
      w: 6,
      h: 7,
      minW: 4,
      minH: 4,
      type: 'custom',
      tool: 'aseanboard',
      icon: '🌏',
    },
    // 大洋洲行情板：澳新市场
    oceaniaboard: {
      title: 'OCEANIA_BOARD',
      cn: '大洋洲行情板',
      w: 4,
      h: 6,
      minW: 3,
      minH: 4,
      type: 'custom',
      tool: 'oceaniaboard',
      icon: '🦘',
    },
    // 韩国行情板：韩股行情
    koreaboard: {
      title: 'KOREA_BOARD',
      cn: '韩国行情板',
      w: 5,
      h: 8,
      minW: 3,
      minH: 5,
      type: 'custom',
      tool: 'koreaboard',
      icon: '🇰🇷',
    },
    // 外汇交叉矩阵：主要货币对报价矩阵
    fxmatrix: {
      title: 'FX_MATRIX',
      cn: '外汇交叉矩阵',
      w: 6,
      h: 8,
      minW: 4,
      minH: 5,
      type: 'custom',
      tool: 'fxmatrix',
      icon: '🔀',
    },
    // 美债收益率曲线：美债期限结构
    yieldcurve: {
      title: 'YIELD_CURVE',
      cn: '美债收益率曲线',
      w: 6,
      h: 8,
      minW: 4,
      minH: 5,
      type: 'custom',
      tool: 'yieldcurve',
      icon: '📉',
    },
    // 全球央行利率：主要央行政策利率
    cbankrates: {
      title: 'CBANK_RATES',
      cn: '全球央行利率',
      w: 5,
      h: 8,
      minW: 3,
      minH: 5,
      type: 'custom',
      tool: 'cbankrates',
      icon: '🏛️',
    },
    // 商品期货曲线：商品期限结构
    futurescurve: {
      title: 'FUTURES_CURVE',
      cn: '商品期货曲线',
      w: 6,
      h: 8,
      minW: 4,
      minH: 5,
      type: 'custom',
      tool: 'futurescurve',
      icon: '🌾',
    },
    // 风险指标监控：VIX/信用利差等
    riskmon: {
      title: 'RISK_MONITOR',
      cn: '风险指标监控',
      w: 6,
      h: 8,
      minW: 4,
      minH: 5,
      type: 'custom',
      tool: 'riskmon',
      icon: '⚠️',
    },

    // 加密货币ETF资金流：BTC/ETH ETF 资金流
    cryptoetf: {
      title: 'CRYPTO_ETF',
      cn: '加密货币ETF资金流',
      w: 6, h: 8, minW: 4, minH: 5,
      type: 'custom', tool: 'cryptoetf', icon: '💰',
    },
    // A股龙虎榜：机构/游资龙虎榜
    asharedragon: {
      title: 'A_DRAGON',
      cn: 'A股龙虎榜',
      w: 6, h: 8, minW: 4, minH: 5,
      type: 'custom', tool: 'asharedragon', icon: '🐉',
    },
    // 美股财报日历：本周/今日重点财报
    earnings: {
      title: 'EARNINGS',
      cn: '美股财报日历',
      w: 6, h: 8, minW: 4, minH: 5,
      type: 'custom', tool: 'earnings', icon: '📊',
    },
    // 美联储议息倒计时：下次 FOMC 倒计时
    fedmeetings: {
      title: 'FED_MEETINGS',
      cn: '美联储议息倒计时',
      w: 5, h: 8, minW: 3, minH: 5,
      type: 'custom', tool: 'fedmeetings', icon: '⏳',
    },
    // 外汇隐含波动率：G7 FX 隐含波动率
    fxvol: {
      title: 'FX_VOL',
      cn: '外汇隐含波动率',
      w: 5, h: 7, minW: 3, minH: 4,
      type: 'custom', tool: 'fxvol', icon: '📉',
    },
    // 北向资金：沪深港通北向净流入
    northbound: {
      title: 'NORTHBOUND',
      cn: '北向资金',
      w: 4, h: 6, minW: 3, minH: 4,
      type: 'custom', tool: 'northbound', icon: '💹',
    },
    // 大宗商品监控：贵金属 / 能源 / 农产品
    commoditywatch: {
      title: 'COMMODITY_WATCH',
      cn: '大宗商品监控',
      w: 6, h: 8, minW: 4, minH: 5,
      type: 'custom', tool: 'commoditywatch', icon: '🌾',
    },
    // 基本金属专业版：LME/COMEX/SHFE 六大金属实时行情 + 曲线
    basemetalspro: {
      title: 'BASE_METALS_PRO',
      cn: '基本金属专业版',
      w: 6, h: 8, minW: 4, minH: 5,
      type: 'custom', tool: 'basemetalspro', icon: '🔩',
    },
    // 能源期货专业版：原油 / 天然气 / 成品油 + 价差
    energypro: {
      title: 'ENERGY_PRO',
      cn: '能源期货专业版',
      w: 6, h: 8, minW: 4, minH: 5,
      type: 'custom', tool: 'energypro', icon: '⛽',
    },
    // 农产品专业版：谷物 / 软商品 / 畜牧 + 涨跌分布
    agripro: {
      title: 'AGRI_PRO',
      cn: '农产品专业版',
      w: 6, h: 8, minW: 4, minH: 5,
      type: 'custom', tool: 'agripro', icon: '🌽',
    },
    // 俄罗斯市场：MOEX 指数与蓝筹个股行情
    russia: {
      title: 'RUSSIA_BOARD',
      cn: '俄罗斯市场',
      w: 5, h: 7, minW: 3, minH: 4,
      type: 'tv-embed', embed: 'russia-market', icon: '🇷🇺',
    },
    // 土耳其市场：BIST 100 与金融航空龙头
    turkey: {
      title: 'TURKEY_BOARD',
      cn: '土耳其市场',
      w: 5, h: 7, minW: 3, minH: 4,
      type: 'tv-embed', embed: 'turkey-market', icon: '🇹🇷',
    },
    // 沙特市场：TASI 指数与 Aramco 等权重股
    saudi: {
      title: 'SAUDI_BOARD',
      cn: '沙特市场',
      w: 5, h: 7, minW: 3, minH: 4,
      type: 'tv-embed', embed: 'saudi-market', icon: '🇸🇦',
    },
    // 新兴市场债：EMB / PCY / EMHY 等 ETF 行情
    emdebt: {
      title: 'EM_DEBT',
      cn: '新兴市场债',
      w: 5, h: 7, minW: 3, minH: 4,
      type: 'tv-embed', embed: 'em-debt', icon: '📜',
    },
    // 高收益债：HYG / JNK / BKLN 等垃圾债 ETF
    junkbond: {
      title: 'JUNK_BOND',
      cn: '高收益债',
      w: 5, h: 7, minW: 3, minH: 4,
      type: 'tv-embed', embed: 'junk-bond', icon: '💳',
    },
    // 通胀保值债：TIPS / VTIP / STIP 等抗通胀债券
    tips: {
      title: 'TIPS_BOARD',
      cn: '通胀保值债',
      w: 5, h: 7, minW: 3, minH: 4,
      type: 'tv-embed', embed: 'tips-board', icon: '🛡️',
    },
    // 新兴市场货币：离岸人民币 / 印度卢比 / 巴西雷亚尔等
    emfx: {
      title: 'EM_FX',
      cn: '新兴市场货币',
      w: 6, h: 7, minW: 4, minH: 4,
      type: 'tv-embed', embed: 'em-fx', icon: '💱',
    },
    // 贵金属：黄金 / 白银 / 铂金 / 钯金 / GLD / SLV
    preciousmetals: {
      title: 'PRECIOUS_METALS',
      cn: '贵金属',
      w: 5, h: 7, minW: 3, minH: 4,
      type: 'tv-embed', embed: 'precious-metals', icon: '🥇',
    },
    // 基本金属：铜 / 铝 / 镍 / 锌 / 铅 / 锡期货
    basemetals: {
      title: 'BASE_METALS',
      cn: '基本金属',
      w: 5, h: 7, minW: 3, minH: 4,
      type: 'tv-embed', embed: 'base-metals', icon: '🔩',
    },
    // 能源期货：WTI / 布伦特 / 天然气 / 汽油 / 取暖油
    energyfut: {
      title: 'ENERGY_FUTURES',
      cn: '能源期货',
      w: 5, h: 7, minW: 3, minH: 4,
      type: 'tv-embed', embed: 'energy-futures', icon: '⛽',
    },
    // 农产品：玉米 / 小麦 / 大豆 / 咖啡 / 糖 / 棉花 / 活牛 / 瘦肉猪
    agriculture: {
      title: 'AGRICULTURE',
      cn: '农产品',
      w: 6, h: 7, minW: 4, minH: 4,
      type: 'tv-embed', embed: 'agriculture', icon: '🌽',
    },
    // DeFi 代币：UNI / AAVE / MKR / COMP / CRV / LDO / DYDX
    defi: {
      title: 'DEFI_TOKENS',
      cn: 'DeFi 代币',
      w: 5, h: 7, minW: 3, minH: 4,
      type: 'tv-embed', embed: 'defi-tokens', icon: '🔗',
    },
    // 比特币矿股：MARA / RIOT / CLSK / COIN / HUT / BITF
    btcminers: {
      title: 'BTC_MINERS',
      cn: '比特币矿股',
      w: 5, h: 7, minW: 3, minH: 4,
      type: 'tv-embed', embed: 'btc-miners', icon: '⛏️',
    },
    // REITs：VNQ / IYR / XLRE / O / PLD / AMT 等房地产信托
    reits: {
      title: 'REIT_BOARD',
      cn: 'REITs',
      w: 5, h: 7, minW: 3, minH: 4,
      type: 'tv-embed', embed: 'reit-board', icon: '🏢',
    },
    // 半导体：SMH / SOXX / NVDA / AMD / INTC / TSM / AVGO / MU
    semiconductor: {
      title: 'SEMICONDUCTOR',
      cn: '半导体',
      w: 6, h: 7, minW: 4, minH: 4,
      type: 'tv-embed', embed: 'semiconductor', icon: '💻',
    },
    // 清洁能源：ICLN / PBW / QCLN / URA / CCJ / ENPH / SEDG
    cleanenergy: {
      title: 'CLEAN_ENERGY',
      cn: '清洁能源',
      w: 5, h: 7, minW: 3, minH: 4,
      type: 'tv-embed', embed: 'clean-energy', icon: '🔋',
    },
    // AI 主题：BOTZ / IRBO / MSFT / GOOGL / AMZN / META / PLTR
    aithematic: {
      title: 'AI_THEMATIC',
      cn: 'AI 主题',
      w: 6, h: 7, minW: 4, minH: 4,
      type: 'tv-embed', embed: 'ai-thematic', icon: '🤖',
    },
    // 波动率指数：VIX / VIXY / UVXY / SVXY / VVIX / OVX
    volindices: {
      title: 'VOL_INDICES',
      cn: '波动率指数',
      w: 5, h: 7, minW: 3, minH: 4,
      type: 'tv-embed', embed: 'volatility-indices', icon: '📉',
    },
    // 信用利差：美债收益率 / HYG / LQD / EMB / TLT
    creditspreads: {
      title: 'CREDIT_SPREADS',
      cn: '信用利差',
      w: 6, h: 7, minW: 4, minH: 4,
      type: 'tv-embed', embed: 'credit-default-swaps', icon: '⚖️',
    },
    // v15 新增：金融分析套件（Bloomberg 风格）
    finstatements: {
      title: 'FA_STATEMENTS',
      cn: '财务报表拆解',
      w: 7, h: 8, minW: 4, minH: 5,
      type: 'custom', tool: 'finstatements', icon: '📑',
    },
    companydes: {
      title: 'COMPANY_DES',
      cn: '公司概况与管理',
      w: 6, h: 7, minW: 4, minH: 5,
      type: 'custom', tool: 'companydes', icon: '🏢',
    },
    researchres: {
      title: 'SELL_SIDE_RES',
      cn: '卖方研究报告',
      w: 6, h: 8, minW: 4, minH: 5,
      type: 'custom', tool: 'researchres', icon: '📰',
    },
    fundamentaldata: {
      title: 'FUNDAMENTAL_DATA',
      cn: '基本面数据模型',
      w: 6, h: 8, minW: 4, minH: 5,
      type: 'custom', tool: 'fundamentaldata', icon: '🧮',
    },
    ownership: {
      title: 'OWNERSHIP',
      cn: '股权结构分析',
      w: 6, h: 7, minW: 4, minH: 5,
      type: 'custom', tool: 'ownership', icon: '📊',
    },
    madeals: {
      title: 'M_A_DEALS',
      cn: '全球并购交易',
      w: 6, h: 7, minW: 4, minH: 5,
      type: 'custom', tool: 'madeals', icon: '🤝',
    },
    swaps: {
      title: 'SWAPS_PRICING',
      cn: '互换定价',
      w: 5, h: 7, minW: 3, minH: 4,
      type: 'custom', tool: 'swaps', icon: '🔀',
    },
    structuredproducts: {
      title: 'STRUCTURED_PROD',
      cn: '结构化产品定价',
      w: 6, h: 8, minW: 4, minH: 5,
      type: 'custom', tool: 'structuredproducts', icon: '🧩',
    },
    portriskpro: {
      title: 'PORT_RISK_PRO',
      cn: '组合风险建模',
      w: 7, h: 8, minW: 4, minH: 5,
      type: 'custom', tool: 'portriskpro', icon: '🛡️',
    },
    optsurfacepro: {
      title: 'OPT_SURFACE_PRO',
      cn: '期权波动率曲面PRO',
      w: 7, h: 8, minW: 4, minH: 5,
      type: 'custom', tool: 'optsurfacepro', icon: '🌊',
    },
    newscast: {
      title: 'NEWSCAST',
      cn: '新闻直播播报',
      w: 6, h: 7, minW: 4, minH: 5,
      type: 'custom', tool: 'newscast', icon: '📡',
    },
  };

  const DEFAULT_LAYOUT = [
    { x: 0, y: 0, w: 8, h: 12, id: 'main' },
    { x: 8, y: 0, w: 4, h: 5, id: 'forex' },
    { x: 8, y: 5, w: 4, h: 6, id: 'calc' },
    { x: 8, y: 11, w: 4, h: 5, id: 'news' },
    { x: 0, y: 12, w: 4, h: 7, id: 'risk' },
    { x: 4, y: 12, w: 4, h: 7, id: 'crypto' },
    { x: 8, y: 16, w: 4, h: 5, id: 'feargreed' },
    { x: 0, y: 19, w: 6, h: 6, id: 'calendar' },
    { x: 6, y: 21, w: 6, h: 6, id: 'scanner' },
    { x: 0, y: 25, w: 6, h: 6, id: 'heatmap' },
    { x: 8, y: 27, w: 4, h: 6, id: 'tech' },
    { x: 0, y: 31, w: 4, h: 6, id: 'fib' },
    { x: 4, y: 31, w: 4, h: 6, id: 'pivot' },
    { x: 8, y: 33, w: 4, h: 4, id: 'music' },
    { x: 0, y: 37, w: 12, h: 14, id: 'sessions' },
    { x: 0, y: 42, w: 6, h: 8, id: 'journal' },
    { x: 6, y: 27, w: 6, h: 7, id: 'marketview' },
    { x: 6, y: 34, w: 6, h: 7, id: 'stockheat' },
    { x: 0, y: 42, w: 6, h: 7, id: 'cryptoheat' },
    { x: 6, y: 42, w: 4, h: 7, id: 'fxrates' },
    { x: 10, y: 42, w: 4, h: 7, id: 'gcrypto' },
    { x: 6, y: 49, w: 4, h: 7, id: 'funding' },
    { x: 10, y: 49, w: 4, h: 7, id: 'commodities' },
    { x: 0, y: 56, w: 6, h: 7, id: 'asharehot' },
    { x: 6, y: 56, w: 6, h: 7, id: 'globalidx' },
    { x: 0, y: 63, w: 4, h: 7, id: 'ashareflow' },
    { x: 4, y: 63, w: 4, h: 7, id: 'asharemood' },
    { x: 8, y: 63, w: 4, h: 7, id: 'cryptotop' },
    { x: 0, y: 70, w: 4, h: 6, id: 'cryptooi' },
    { x: 4, y: 70, w: 4, h: 7, id: 'hkboard' },
    { x: 8, y: 70, w: 4, h: 7, id: 'usboard' },
    // v9 新增：A股深化 / 币圈扩展 / 全球市场（放在 y90 起的干净区域，避免与上方浮动堆叠冲突）
    { x: 0, y: 90, w: 6, h: 7, id: 'asharesector' },
    { x: 6, y: 90, w: 6, h: 8, id: 'asharecapital' },
    { x: 0, y: 98, w: 4, h: 7, id: 'ashareladder' },
    { x: 4, y: 98, w: 4, h: 6, id: 'asharequote' },
    { x: 8, y: 98, w: 4, h: 7, id: 'asharefut' },
    { x: 0, y: 105, w: 4, h: 7, id: 'asharecb' },
    { x: 4, y: 105, w: 4, h: 9, id: 'cryptols' },
    { x: 8, y: 105, w: 4, h: 8, id: 'cryptobasis' },
    { x: 0, y: 114, w: 5, h: 6, id: 'cryptodvol' },
    { x: 5, y: 114, w: 5, h: 8, id: 'cryptonew' },
    { x: 0, y: 120, w: 4, h: 6, id: 'cryptovol' },
    { x: 4, y: 120, w: 4, h: 7, id: 'globalbond' },
    { x: 8, y: 120, w: 4, h: 7, id: 'ushot' },
    { x: 0, y: 127, w: 6, h: 9, id: 'euboard' },
    { x: 6, y: 127, w: 6, h: 7, id: 'globalfut' },
    // v10 新增：期权/衍生品、人气与资金、全球市场、交易工具
    { x: 0, y: 136, w: 4, h: 7, id: 'optionchain' },
    { x: 4, y: 136, w: 4, h: 8, id: 'hkflow' },
    { x: 8, y: 136, w: 4, h: 7, id: 'hotrank' },
    { x: 0, y: 144, w: 4, h: 8, id: 'optionlab' },
    { x: 4, y: 144, w: 4, h: 7, id: 'tradecalc' },
    { x: 8, y: 144, w: 4, h: 7, id: 'holidays' },
    { x: 0, y: 152, w: 6, h: 9, id: 'econdata' },
    { x: 6, y: 152, w: 5, h: 8, id: 'cryptooptflow' },
    { x: 0, y: 161, w: 4, h: 7, id: 'twboard' },
    { x: 4, y: 161, w: 4, h: 9, id: 'asiahot' },
    { x: 8, y: 161, w: 4, h: 6, id: 'emhot' },
    { x: 0, y: 170, w: 6, h: 7, id: 'dividend' },
    // v11 新增：打新系列（A股/港股/美股打新 + 新股表现统计）
    { x: 0, y: 177, w: 6, h: 8, id: 'ipoashare' },
    { x: 6, y: 177, w: 6, h: 9, id: 'ipostats' },
    { x: 0, y: 186, w: 4, h: 7, id: 'ipohk' },
    { x: 4, y: 186, w: 4, h: 7, id: 'ipous' },
    // v12 新增：全球热力图、全球事件地球仪、Polymarket预测市场
    { x: 0, y: 205, w: 6, h: 7, id: 'worldheat' },
    { x: 6, y: 205, w: 6, h: 8, id: 'globe' },
    { x: 0, y: 213, w: 6, h: 8, id: 'polymarket' },
    // v13 新增：日/印/英/德/巴行情板、市场情绪、产业链关联
    { x: 0, y: 225, w: 4, h: 7, id: 'jpboard' },
    { x: 4, y: 225, w: 4, h: 7, id: 'inboard' },
    { x: 8, y: 225, w: 4, h: 7, id: 'ukboard' },
    { x: 0, y: 232, w: 4, h: 7, id: 'deboard' },
    { x: 4, y: 232, w: 4, h: 7, id: 'brboard' },
    { x: 8, y: 232, w: 4, h: 7, id: 'marketsentiment' },
    { x: 0, y: 239, w: 6, h: 8, id: 'supplychain' },
    // v14 新增：中东 / 非洲 / 拉美 / 东盟 / 大洋洲 / 韩国独立行情板
    { x: 6, y: 239, w: 6, h: 8, id: 'mideastboard' },
    { x: 0, y: 247, w: 5, h: 7, id: 'africaboard' },
    { x: 5, y: 247, w: 5, h: 7, id: 'latamboard' },
    { x: 0, y: 254, w: 6, h: 7, id: 'aseanboard' },
    { x: 6, y: 254, w: 4, h: 6, id: 'oceaniaboard' },
    { x: 10, y: 254, w: 5, h: 8, id: 'koreaboard' },
  ];

  const state = {
    theme: localStorage.getItem(STORAGE_KEYS.theme) || 'dark',
    grid: null,
    chartWidget: null,
    commandOpen: false,
    menuOpen: false,
    activeCommandIndex: 0,
  };

  // Utility helpers
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const escapeHtml = (str) =>
    String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const debounce = (fn, ms) => {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  };

  const fmtNum = (n, d = 2) =>
    Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

  const parseVal = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };

  // Theme management
  const Theme = {
    LIST: ['dark', 'light', 'green', 'pure-white', 'ocean', 'midnight'],
    LABELS: {
      dark: 'DARK',
      light: 'LIGHT',
      green: 'GREEN',
      'pure-white': 'WHITE',
      ocean: 'OCEAN',
      midnight: 'MIDNIGHT',
    },
    ICONS: {
      dark: '◐',
      light: '◑',
      green: '●',
      'pure-white': '○',
      ocean: '◉',
      midnight: '◐',
    },
    isLight(theme) {
      return theme === 'light' || theme === 'pure-white';
    },
    bodyClass(theme) {
      if (theme === 'dark') return '';
      if (theme === 'light') return 'light-mode';
      return `theme-${theme}`;
    },
    tvTheme(theme) {
      return this.isLight(theme) ? 'light' : 'dark';
    },
    apply(theme) {
      state.theme = theme;
      document.body.className = this.bodyClass(theme);
      const icon = $('.mode-icon', $('#theme-icon'));
      const label = $('.mode-label', $('#theme-icon'));
      if (icon) {
        icon.innerText = this.ICONS[theme] || '◐';
      }
      if (label) {
        label.innerText = `${this.LABELS[theme] || theme.toUpperCase()} MODE`;
      }
      localStorage.setItem(STORAGE_KEYS.theme, theme);
      // Update iframe srcs to match theme where supported
      Widgets.updateIframeThemes();
      TvEmbeds.refreshAll();
      if (state.chartWidget && typeof state.chartWidget.applyOverrides === 'function') {
        // TradingView widget doesn't support runtime theme switch easily; reload chart
        Widgets.initMainChart();
      }
      ThemeMenu.render();
    },
  };

  // Theme picker dropdown
  const ThemeMenu = {
    open: false,
    toggle() {
      if (this.open) this.close();
      else this.openMenu();
    },
    openMenu() {
      this.open = true;
      const menu = $('#theme-menu');
      const btn = $('#theme-icon');
      if (menu) {
        menu.classList.add('open');
        menu.setAttribute('aria-hidden', 'false');
      }
      if (btn) btn.setAttribute('aria-expanded', 'true');
      this.render();
    },
    close() {
      this.open = false;
      const menu = $('#theme-menu');
      const btn = $('#theme-icon');
      if (menu) {
        menu.classList.remove('open');
        menu.setAttribute('aria-hidden', 'true');
      }
      if (btn) btn.setAttribute('aria-expanded', 'false');
    },
    render() {
      const list = $('#theme-menu-list');
      if (!list) return;
      list.innerHTML = Theme.LIST
        .map(
          (key) => `
          <button type="button" class="theme-menu-item${state.theme === key ? ' active' : ''}" data-theme="${escapeHtml(key)}">
            <span class="theme-menu-icon">${Theme.ICONS[key] || '◐'}</span>
            <span class="theme-menu-name">${escapeHtml(Theme.LABELS[key] || key.toUpperCase())}</span>
            ${state.theme === key ? '<span class="theme-menu-check">✓</span>' : ''}
          </button>`
        )
        .join('');
    },
  };

  // Auth management
  const Auth = {
    isAuthenticated() {
      return localStorage.getItem(STORAGE_KEYS.auth) === 'active';
    },
    login(username, password) {
      const auth = CONFIG.login;
      if (auth && username === auth.username && password === auth.password) {
        localStorage.setItem(STORAGE_KEYS.auth, 'active');
        localStorage.setItem(STORAGE_KEYS.user, username);
        return true;
      }
      return false;
    },
    logout() {
      localStorage.removeItem(STORAGE_KEYS.auth);
      localStorage.removeItem(STORAGE_KEYS.user);
      location.reload();
    },
    showOverlay() {
      const overlay = $('#login-overlay');
      if (overlay) overlay.classList.remove('hidden');
    },
    hideOverlay() {
      const overlay = $('#login-overlay');
      if (overlay) overlay.classList.add('hidden');
    },
  };

  // World clocks
  const Clocks = {
    update() {
      // 页面不可见时跳过时钟刷新，减少后台开销
      if (document.hidden) return;
      const el = $('#clocks');
      if (!el) return;
      const now = new Date();
      el.innerHTML = Object.entries(CONFIG.clocks)
        .map(([name, zone]) => {
          const time = now.toLocaleString('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
            timeZone: zone,
          });
          return `<span>${escapeHtml(name)} <b>${escapeHtml(time)}</b></span>`;
        })
        .join('');
    },
    start() {
      this.update();
      setInterval(() => this.update(), 1000);
    },
  };

  // Animations
  const Animations = {
    chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_$#@&*',
    decodeText(element, finalText, duration = 900) {
      if (!element) return;
      const original = finalText || element.innerText;
      const length = original.length;
      const start = performance.now();
      const frame = (now) => {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);
        // ease-out cubic：揭示速度前快后慢，收尾更沉稳（对齐 var(--ease-snap)）
        const eased = 1 - Math.pow(1 - progress, 3);
        const revealed = Math.floor(eased * length);
        let out = '';
        for (let i = 0; i < length; i++) {
          if (original[i] === ' ') {
            out += ' ';
          } else if (i < revealed) {
            out += original[i];
          } else {
            out += this.chars[Math.floor(Math.random() * this.chars.length)];
          }
        }
        element.innerText = out;
        if (progress < 1) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    },
    initSpotlight() {
      document.addEventListener('mousemove', (e) => {
        const card = e.target.closest('.grid-stack-item-content');
        if (!card) return;
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        card.style.setProperty('--mouse-x', `${x}px`);
        card.style.setProperty('--mouse-y', `${y}px`);
      });
    },
    initEntrance() {
      // Observe added grid items and apply staggered entrance
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((m) => {
          m.addedNodes.forEach((node) => {
            if (node.nodeType === 1 && node.classList.contains('grid-stack-item')) {
              const index = $$('.grid-stack-item').indexOf(node);
              // 更沉稳的 stagger 间隔，并封顶避免恢复布局时后排卡片等待过久
              node.style.animationDelay = `${Math.min(index, 10) * 0.09}s`;
              node.classList.add('entering');
              node.addEventListener('animationend', () => node.classList.remove('entering'), { once: true });
            }
          });
        });
      });
      const gridEl = $('.grid-stack');
      if (gridEl) observer.observe(gridEl, { childList: true });
    },
    initMagneticButton() {
      const btn = $('#widget-menu-toggle');
      if (!btn) return;
      btn.addEventListener('mousemove', (e) => {
        const rect = btn.getBoundingClientRect();
        const x = e.clientX - rect.left - rect.width / 2;
        const y = e.clientY - rect.top - rect.height / 2;
        // 跟随期用短缓动制造磁吸迟滞感
        btn.style.transition = 'transform 0.15s var(--ease-snap)';
        btn.style.transform = `translate(${x * 0.18}px, ${y * 0.18}px) scale(1.03)`;
      });
      btn.addEventListener('mouseleave', () => {
        // 回弹期用长重缓动，复位更沉稳
        btn.style.transition = 'transform 0.7s var(--ease-snap)';
        btn.style.transform = '';
      });
      btn.addEventListener('click', () => {
        const ripple = document.createElement('span');
        ripple.className = 'ripple';
        btn.appendChild(ripple);
        btn.classList.add('animating-ripple');
        const cleanup = () => {
          btn.classList.remove('animating-ripple');
          ripple.remove();
        };
        ripple.addEventListener('animationend', cleanup, { once: true });
        // 兜底：animationend 未触发时也能清理
        setTimeout(cleanup, 800);
      });
    },
    initTerminalDecode() {
      const terminalId = $('.terminal-id');
      if (!terminalId) return;
      // Preserve pulse dot, decode the actual text node (skip whitespace-only nodes)
      const textNode = Array.from(terminalId.childNodes).find(
        (n) => n.nodeType === 3 && n.textContent.trim().length > 0
      );
      if (!textNode) return;
      const finalText = textNode.textContent.trim();
      textNode.textContent = '';
      const span = document.createElement('span');
      span.className = 'terminal-decode-text';
      span.innerText = finalText;
      terminalId.appendChild(span);
      const cursor = document.createElement('span');
      cursor.className = 'cursor';
      terminalId.appendChild(cursor);
      setTimeout(() => this.decodeText(span, finalText, 1000), 400);
    },
  };

  // System HUD: connection, latency, data flow
  const SystemHUD = {
    el: null,
    statusEl: null,
    latencyEl: null,
    flowEl: null,
    lastLatency: null,
    flowTimeout: null,
    init() {
      this.el = $('#system-hud');
      this.statusEl = $('#hud-status');
      this.latencyEl = $('#hud-latency');
      this.flowEl = $('#hud-flow');
      if (!this.el) return;

      this.updateOnlineStatus();
      this.measure();
      setInterval(() => this.measure(), 5000);

      window.addEventListener('online', () => this.updateOnlineStatus());
      window.addEventListener('offline', () => this.updateOnlineStatus());
    },
    updateOnlineStatus() {
      const online = navigator.onLine;
      if (this.statusEl) {
        this.statusEl.classList.toggle('online', online);
        this.statusEl.classList.toggle('offline', !online);
      }
    },
    async measure() {
      // 页面不可见时跳过本轮轮询，恢复可见后下一轮自动继续
      if (document.hidden) return;
      if (!navigator.onLine) {
        if (this.latencyEl) this.latencyEl.textContent = 'OFFLINE';
        return;
      }
      const start = performance.now();
      try {
        await fetch(`${window.location.origin}/?ping=${Date.now()}`, {
          method: 'HEAD',
          cache: 'no-store',
          referrerPolicy: 'no-referrer',
        });
        this.lastLatency = Math.round(performance.now() - start);
        if (this.latencyEl) {
          this.latencyEl.textContent = `${this.lastLatency}ms`;
          this.latencyEl.classList.add('active');
          setTimeout(() => this.latencyEl.classList.remove('active'), 300);
        }
      } catch (e) {
        this.lastLatency = null;
        if (this.latencyEl) this.latencyEl.textContent = 'TIMEOUT';
        if (this.statusEl) {
          this.statusEl.classList.remove('online');
          this.statusEl.classList.add('offline');
        }
      }
    },
    pulseFlow() {
      if (!this.flowEl) return;
      this.flowEl.classList.add('active');
      clearTimeout(this.flowTimeout);
      this.flowTimeout = setTimeout(() => this.flowEl.classList.remove('active'), 1200);
    },
  };

  // Toast notifications
  const Toast = {
    stack: null,
    init() {
      this.stack = $('#toast-stack');
    },
    show(message, icon = '▸', duration = 2200) {
      if (!this.stack) return;
      const toast = document.createElement('div');
      toast.className = 'toast';
      toast.innerHTML = `
        <span class="toast-icon">${icon}</span>
        <span class="toast-message">${escapeHtml(message)}</span>
      `;
      this.stack.appendChild(toast);
      setTimeout(() => {
        toast.classList.add('out');
        toast.addEventListener('animationend', () => toast.remove(), { once: true });
      }, duration);
    },
  };

  // TradingView external embed widgets (free, no API key required)
  const TV_EMBEDS = {
    'technical-analysis': {
      src: 'https://s3.tradingview.com/external-embedding/embed-widget-technical-analysis.js',
      config: {
        width: '100%',
        height: '100%',
        isTransparent: true,
        showIntervalTabs: true,
        displayMode: 'single',
        symbol: 'FX:EURUSD',
        interval: '1h',
      },
    },
    'forex-heat-map': {
      src: 'https://s3.tradingview.com/external-embedding/embed-widget-forex-heat-map.js',
      config: {
        width: '100%',
        height: '100%',
        isTransparent: true,
        currencies: ['USD', 'EUR', 'JPY', 'GBP', 'AUD', 'CAD', 'CHF', 'NZD'],
      },
    },
    'market-overview': {
      src: 'https://s3.tradingview.com/external-embedding/embed-widget-market-overview.js',
      config: {
        width: '100%',
        height: '100%',
        isTransparent: true,
        showFloatingTooltip: true,
        dateRange: '1D',
        showChart: true,
        showSymbolLogo: true,
        tabs: [
          {
            title: '指数',
            symbols: [
              { s: 'SP:SPX', d: '标普500' },
              { s: 'NASDAQ:NDX', d: '纳指100' },
              { s: 'DJ:DJI', d: '道琼斯' },
              { s: 'HKEX:HSI1!', d: '恒生' },
              { s: 'SSE:000001', d: '上证指数' },
              { s: 'XETR:DAX', d: 'DAX' },
              { s: 'NYMEX:BZ1!', d: '布油' },
            ],
          },
          {
            title: '外汇',
            symbols: [
              { s: 'FX:EURUSD' },
              { s: 'FX:GBPUSD' },
              { s: 'FX:USDJPY' },
              { s: 'FX:AUDUSD' },
              { s: 'FX:USDCNH', d: '离岸人民币' },
              { s: 'TVC:DXY', d: '美元指数' },
            ],
          },
        ],
      },
    },
    'stock-heatmap': {
      src: 'https://s3.tradingview.com/external-embedding/embed-widget-stock-heatmap.js',
      config: {
        width: '100%',
        height: '100%',
        isTransparent: true,
        exchanges: [],
        dataSource: 'SPX500',
        grouping: 'sector',
        blockSize: 'market_cap_basic',
        blockColor: 'change',
        symbolUrl: '',
        hasTopBar: false,
        isZoomEnabled: true,
        hasSymbolTooltip: true,
      },
    },
    'crypto-heatmap': {
      src: 'https://s3.tradingview.com/external-embedding/embed-widget-crypto-coins-heatmap.js',
      config: {
        width: '100%',
        height: '100%',
        isTransparent: true,
        dataSource: 'Crypto',
        blockSize: 'market_cap_calc',
        blockColor: '24h_close_change|5',
        hasTopBar: false,
        isZoomEnabled: true,
        hasSymbolTooltip: true,
      },
    },
    // 跨市场与衍生品行情板（基于 TradingView market-overview 嵌入）
    // 注：MOEX 俄罗斯代码在公开 scanner 中不返回数据，但 TradingView 嵌入通常仍能展示，故保留。
    'russia-market': {
      src: 'https://s3.tradingview.com/external-embedding/embed-widget-market-overview.js',
      config: {
        width: '100%', height: '100%', isTransparent: true, showFloatingTooltip: true, dateRange: '1D', showChart: true, showSymbolLogo: true,
        tabs: [{
          title: '俄罗斯市场',
          symbols: [
            { s: 'MOEX:IMOEX', d: 'MOEX' },
            { s: 'MOEX:SBER', d: 'Sberbank' },
            { s: 'MOEX:GAZP', d: 'Gazprom' },
            { s: 'MOEX:LKOH', d: 'Lukoil' },
            { s: 'MOEX:YNDX', d: 'Yandex' },
            { s: 'MOEX:ROSN', d: 'Rosneft' },
            { s: 'MOEX:VTBR', d: 'VTB' },
          ],
        }],
      },
    },
    'turkey-market': {
      src: 'https://s3.tradingview.com/external-embedding/embed-widget-market-overview.js',
      config: {
        width: '100%', height: '100%', isTransparent: true, showFloatingTooltip: true, dateRange: '1D', showChart: true, showSymbolLogo: true,
        tabs: [{
          title: '土耳其市场',
          symbols: [
            { s: 'BIST:XU100', d: 'BIST 100' },
            { s: 'BIST:THYAO', d: 'Turkish Airlines' },
            { s: 'BIST:GARAN', d: 'Garanti' },
            { s: 'BIST:ASELS', d: 'Aselsan' },
            { s: 'BIST:BIMAS', d: 'BIM' },
            { s: 'BIST:EKGYO', d: 'Emlak Konut' },
          ],
        }],
      },
    },
    'saudi-market': {
      src: 'https://s3.tradingview.com/external-embedding/embed-widget-market-overview.js',
      config: {
        width: '100%', height: '100%', isTransparent: true, showFloatingTooltip: true, dateRange: '1D', showChart: true, showSymbolLogo: true,
        tabs: [{
          title: '沙特市场',
          symbols: [
            { s: 'TADAWUL:TASI', d: 'TASI' },
            { s: 'TADAWUL:2222', d: 'Aramco' },
            { s: 'TADAWUL:1180', d: 'Al Rajhi' },
            { s: 'TADAWUL:7010', d: 'STC' },
            { s: 'TADAWUL:2350', d: 'SABIC' },
          ],
        }],
      },
    },
    'em-debt': {
      src: 'https://s3.tradingview.com/external-embedding/embed-widget-market-overview.js',
      config: {
        width: '100%', height: '100%', isTransparent: true, showFloatingTooltip: true, dateRange: '1D', showChart: true, showSymbolLogo: true,
        tabs: [{
          title: '新兴市场债',
          symbols: [
            { s: 'NASDAQ:EMB', d: 'EMB' },
            { s: 'AMEX:PCY', d: 'PCY' },
            { s: 'AMEX:EBND', d: 'EBND' },
            { s: 'AMEX:LEMB', d: 'LEMB' },
            { s: 'AMEX:EMLC', d: 'EMLC' },
          ],
        }],
      },
    },
    'junk-bond': {
      src: 'https://s3.tradingview.com/external-embedding/embed-widget-market-overview.js',
      config: {
        width: '100%', height: '100%', isTransparent: true, showFloatingTooltip: true, dateRange: '1D', showChart: true, showSymbolLogo: true,
        tabs: [{
          title: '高收益债',
          symbols: [
            { s: 'AMEX:HYG', d: 'HYG' },
            { s: 'AMEX:JNK', d: 'JNK' },
            { s: 'AMEX:BKLN', d: 'BKLN' },
            { s: 'AMEX:SJNK', d: 'SJNK' },
            { s: 'AMEX:SHYG', d: 'SHYG' },
          ],
        }],
      },
    },
    'tips-board': {
      src: 'https://s3.tradingview.com/external-embedding/embed-widget-market-overview.js',
      config: {
        width: '100%', height: '100%', isTransparent: true, showFloatingTooltip: true, dateRange: '1D', showChart: true, showSymbolLogo: true,
        tabs: [{
          title: '通胀保值债',
          symbols: [
            { s: 'AMEX:TIP', d: 'TIP' },
            { s: 'AMEX:SCHP', d: 'SCHP' },
            { s: 'NASDAQ:VTIP', d: 'VTIP' },
            { s: 'AMEX:STIP', d: 'STIP' },
            { s: 'AMEX:LTPZ', d: 'LTPZ' },
            { s: 'AMEX:SPIP', d: 'SPIP' },
          ],
        }],
      },
    },
    'em-fx': {
      src: 'https://s3.tradingview.com/external-embedding/embed-widget-market-overview.js',
      config: {
        width: '100%', height: '100%', isTransparent: true, showFloatingTooltip: true, dateRange: '1D', showChart: true, showSymbolLogo: true,
        tabs: [{
          title: '新兴市场货币',
          symbols: [
            { s: 'FX_IDC:USDCNY', d: '离岸人民币' },
            { s: 'FX_IDC:USDINR', d: '印度卢比' },
            { s: 'FX_IDC:USDBRL', d: '巴西雷亚尔' },
            { s: 'FX_IDC:USDMXN', d: '墨西哥比索' },
            { s: 'FX_IDC:USDZAR', d: '南非兰特' },
            { s: 'FX_IDC:USDRUB', d: '俄罗斯卢布' },
            { s: 'FX_IDC:USDTRY', d: '土耳其里拉' },
          ],
        }],
      },
    },
    'precious-metals': {
      src: 'https://s3.tradingview.com/external-embedding/embed-widget-market-overview.js',
      config: {
        width: '100%', height: '100%', isTransparent: true, showFloatingTooltip: true, dateRange: '1D', showChart: true, showSymbolLogo: true,
        tabs: [
          {
            title: '贵金属现货',
            symbols: [
              { s: 'TVC:GOLD', d: '黄金' },
              { s: 'TVC:SILVER', d: '白银' },
              { s: 'TVC:PLATINUM', d: '铂金' },
              { s: 'TVC:PALLADIUM', d: '钯金' },
            ],
          },
          {
            title: '贵金属ETF',
            symbols: [
              { s: 'AMEX:GLD', d: 'GLD' },
              { s: 'AMEX:SLV', d: 'SLV' },
              { s: 'AMEX:PPLT', d: 'PPLT' },
              { s: 'AMEX:PALL', d: 'PALL' },
            ],
          },
          {
            title: 'COMEX期货',
            symbols: [
              { s: 'COMEX:GC1!', d: '黄金期货' },
              { s: 'COMEX:SI1!', d: '白银期货' },
            ],
          },
        ],
      },
    },
    'base-metals': {
      src: 'https://s3.tradingview.com/external-embedding/embed-widget-market-overview.js',
      config: {
        width: '100%', height: '100%', isTransparent: true, showFloatingTooltip: true, dateRange: '1D', showChart: true, showSymbolLogo: true,
        tabs: [
          {
            title: '基本金属',
            symbols: [
              { s: 'COMEX:HG1!', d: '铜' },
              { s: 'COMEX:ALI1!', d: '铝' },
              { s: 'LME:NI1!', d: '镍' },
              { s: 'LME:PB1!', d: '铅' },
              { s: 'SHFE:ZN1!', d: '锌' },
              { s: 'LME:SN1!', d: '锡' },
            ],
          },
          {
            title: '上期所',
            symbols: [
              { s: 'SHFE:CU1!', d: '沪铜' },
              { s: 'SHFE:AL1!', d: '沪铝' },
              { s: 'SHFE:ZN1!', d: '沪锌' },
              { s: 'SHFE:NI1!', d: '沪镍' },
              { s: 'SHFE:SN1!', d: '沪锡' },
              { s: 'SHFE:PB1!', d: '沪铅' },
            ],
          },
          {
            title: '期货/ETF',
            symbols: [
              { s: 'COMEX:HG1!', d: '铜期货' },
              { s: 'COMEX:ALI1!', d: '铝期货' },
              { s: 'AMEX:CPER', d: 'CPER' },
              { s: 'AMEX:DBB', d: 'DBB' },
            ],
          },
        ],
      },
    },
    'energy-futures': {
      src: 'https://s3.tradingview.com/external-embedding/embed-widget-market-overview.js',
      config: {
        width: '100%', height: '100%', isTransparent: true, showFloatingTooltip: true, dateRange: '1D', showChart: true, showSymbolLogo: true,
        tabs: [
          {
            title: '能源期货',
            symbols: [
              { s: 'NYMEX:CL1!', d: 'WTI原油' },
              { s: 'NYMEX:NG1!', d: '天然气' },
              { s: 'NYMEX:BZ1!', d: '布伦特原油' },
              { s: 'NYMEX:RB1!', d: '汽油' },
              { s: 'NYMEX:HO1!', d: '取暖油' },
            ],
          },
          {
            title: '原油/能源ETF',
            symbols: [
              { s: 'AMEX:USO', d: 'USO' },
              { s: 'AMEX:UNG', d: 'UNG' },
              { s: 'AMEX:DBO', d: 'DBO' },
              { s: 'AMEX:UCO', d: 'UCO' },
            ],
          },
          {
            title: '成品油价差',
            symbols: [
              { s: 'NYMEX:RB1!', d: 'RBOB汽油' },
              { s: 'NYMEX:HO1!', d: '取暖油' },
              { s: 'NYMEX:CL1!', d: 'WTI原油' },
              { s: 'NYMEX:BZ1!', d: '布伦特原油' },
            ],
          },
        ],
      },
    },
    'agriculture': {
      src: 'https://s3.tradingview.com/external-embedding/embed-widget-market-overview.js',
      config: {
        width: '100%', height: '100%', isTransparent: true, showFloatingTooltip: true, dateRange: '1D', showChart: true, showSymbolLogo: true,
        tabs: [
          {
            title: '谷物',
            symbols: [
              { s: 'CBOT:ZC1!', d: '玉米' },
              { s: 'CBOT:ZW1!', d: '小麦' },
              { s: 'CBOT:ZS1!', d: '大豆' },
            ],
          },
          {
            title: '软商品',
            symbols: [
              { s: 'ICEUS:KC1!', d: '咖啡' },
              { s: 'ICEUS:SB1!', d: '糖' },
              { s: 'ICEUS:CT1!', d: '棉花' },
            ],
          },
          {
            title: '畜牧',
            symbols: [
              { s: 'CME:LE1!', d: '活牛' },
              { s: 'CME:HE1!', d: '瘦肉猪' },
            ],
          },
        ],
      },
    },
    'defi-tokens': {
      src: 'https://s3.tradingview.com/external-embedding/embed-widget-market-overview.js',
      config: {
        width: '100%', height: '100%', isTransparent: true, showFloatingTooltip: true, dateRange: '1D', showChart: true, showSymbolLogo: true,
        tabs: [{
          title: 'DeFi',
          symbols: [
            { s: 'COINBASE:UNIUSD', d: 'Uniswap' },
            { s: 'COINBASE:AAVEUSD', d: 'Aave' },
            { s: 'COINBASE:COMPUSD', d: 'Compound' },
            { s: 'BINANCE:CRVUSDT', d: 'Curve' },
            { s: 'BINANCE:LDOUSDT', d: 'Lido' },
            { s: 'BINANCE:DYDXUSDT', d: 'dYdX' },
            { s: 'BINANCE:SNXUSDT', d: 'Synthetix' },
          ],
        }],
      },
    },
    'btc-miners': {
      src: 'https://s3.tradingview.com/external-embedding/embed-widget-market-overview.js',
      config: {
        width: '100%', height: '100%', isTransparent: true, showFloatingTooltip: true, dateRange: '1D', showChart: true, showSymbolLogo: true,
        tabs: [{
          title: '比特币矿股',
          symbols: [
            { s: 'NASDAQ:MARA', d: 'Marathon' },
            { s: 'NASDAQ:RIOT', d: 'Riot' },
            { s: 'NASDAQ:CLSK', d: 'CleanSpark' },
            { s: 'NASDAQ:COIN', d: 'Coinbase' },
            { s: 'NASDAQ:HUT', d: 'Hut 8' },
            { s: 'NASDAQ:CORZ', d: 'Core Scientific' },
          ],
        }],
      },
    },
    'reit-board': {
      src: 'https://s3.tradingview.com/external-embedding/embed-widget-market-overview.js',
      config: {
        width: '100%', height: '100%', isTransparent: true, showFloatingTooltip: true, dateRange: '1D', showChart: true, showSymbolLogo: true,
        tabs: [{
          title: 'REITs',
          symbols: [
            { s: 'AMEX:VNQ', d: 'Vanguard REIT' },
            { s: 'AMEX:IYR', d: 'iShares REIT' },
            { s: 'AMEX:XLRE', d: 'Real Estate ETF' },
            { s: 'NYSE:O', d: 'Realty Income' },
            { s: 'NYSE:PLD', d: 'Prologis' },
            { s: 'NYSE:AMT', d: 'American Tower' },
          ],
        }],
      },
    },
    'semiconductor': {
      src: 'https://s3.tradingview.com/external-embedding/embed-widget-market-overview.js',
      config: {
        width: '100%', height: '100%', isTransparent: true, showFloatingTooltip: true, dateRange: '1D', showChart: true, showSymbolLogo: true,
        tabs: [
          {
            title: '半导体',
            symbols: [
              { s: 'NASDAQ:SMH', d: 'VanEck Semi' },
              { s: 'NASDAQ:SOXX', d: 'iShares Semi' },
              { s: 'NASDAQ:NVDA', d: 'NVIDIA' },
              { s: 'NASDAQ:AMD', d: 'AMD' },
              { s: 'NASDAQ:INTC', d: 'Intel' },
              { s: 'NYSE:TSM', d: 'TSMC' },
              { s: 'NASDAQ:AVGO', d: 'Broadcom' },
              { s: 'NASDAQ:MU', d: 'Micron' },
            ],
          },
          {
            title: '设备与材料',
            symbols: [
              { s: 'NASDAQ:AMAT', d: 'Applied Materials' },
              { s: 'NASDAQ:LRCX', d: 'Lam Research' },
              { s: 'NASDAQ:KLAC', d: 'KLA' },
              { s: 'NASDAQ:ASML', d: 'ASML' },
              { s: 'NASDAQ:SNPS', d: 'Synopsys' },
              { s: 'NASDAQ:CDNS', d: 'Cadence' },
            ],
          },
        ],
      },
    },
    'clean-energy': {
      src: 'https://s3.tradingview.com/external-embedding/embed-widget-market-overview.js',
      config: {
        width: '100%', height: '100%', isTransparent: true, showFloatingTooltip: true, dateRange: '1D', showChart: true, showSymbolLogo: true,
        tabs: [
          {
            title: '清洁能源',
            symbols: [
              { s: 'NASDAQ:ICLN', d: 'iShares Global Clean' },
              { s: 'AMEX:PBW', d: 'WilderHill Clean' },
              { s: 'NASDAQ:QCLN', d: 'Clean Edge' },
              { s: 'AMEX:URA', d: 'Global X Uranium' },
              { s: 'NYSE:CCJ', d: 'Cameco' },
              { s: 'NASDAQ:ENPH', d: 'Enphase' },
              { s: 'NASDAQ:SEDG', d: 'SolarEdge' },
            ],
          },
          {
            title: '核能/铀',
            symbols: [
              { s: 'AMEX:URA', d: 'URA' },
              { s: 'NYSE:CCJ', d: 'Cameco' },
              { s: 'AMEX:URNM', d: 'URNM' },
              { s: 'AMEX:UUUU', d: 'Energy Fuels' },
              { s: 'NYSE:SMR', d: 'NuScale' },
            ],
          },
        ],
      },
    },
    'ai-thematic': {
      src: 'https://s3.tradingview.com/external-embedding/embed-widget-market-overview.js',
      config: {
        width: '100%', height: '100%', isTransparent: true, showFloatingTooltip: true, dateRange: '1D', showChart: true, showSymbolLogo: true,
        tabs: [
          {
            title: 'AI主题',
            symbols: [
              { s: 'NASDAQ:BOTZ', d: 'Global X Robotics & AI' },
              { s: 'AMEX:ROBO', d: 'ROBO Global' },
              { s: 'NASDAQ:MSFT', d: 'Microsoft' },
              { s: 'NASDAQ:GOOGL', d: 'Alphabet' },
              { s: 'NASDAQ:AMZN', d: 'Amazon' },
              { s: 'NASDAQ:META', d: 'Meta' },
              { s: 'NASDAQ:PLTR', d: 'Palantir' },
            ],
          },
          {
            title: 'AI基础设施',
            symbols: [
              { s: 'NASDAQ:MSFT', d: 'Microsoft' },
              { s: 'NASDAQ:GOOGL', d: 'Alphabet' },
              { s: 'NASDAQ:AMZN', d: 'Amazon' },
              { s: 'NASDAQ:META', d: 'Meta' },
              { s: 'NYSE:CRM', d: 'Salesforce' },
              { s: 'NYSE:SNOW', d: 'Snowflake' },
              { s: 'NYSE:NET', d: 'Cloudflare' },
            ],
          },
        ],
      },
    },
    'volatility-indices': {
      src: 'https://s3.tradingview.com/external-embedding/embed-widget-market-overview.js',
      config: {
        width: '100%', height: '100%', isTransparent: true, showFloatingTooltip: true, dateRange: '1D', showChart: true, showSymbolLogo: true,
        tabs: [{
          title: '波动率指数',
          symbols: [
            { s: 'TVC:VIX', d: 'VIX' },
            { s: 'TVC:VVIX', d: 'VVIX' },
            { s: 'TVC:OVX', d: '原油波动率' },
          ],
        }],
      },
    },
    'credit-default-swaps': {
      src: 'https://s3.tradingview.com/external-embedding/embed-widget-market-overview.js',
      config: {
        width: '100%', height: '100%', isTransparent: true, showFloatingTooltip: true, dateRange: '1D', showChart: true, showSymbolLogo: true,
        tabs: [
          {
            title: '信用利差',
            symbols: [
              { s: 'TVC:US10Y', d: '10Y Yield' },
              { s: 'TVC:US02Y', d: '2Y Yield' },
              { s: 'AMEX:HYG', d: 'HYG' },
              { s: 'AMEX:LQD', d: 'LQD' },
              { s: 'NASDAQ:EMB', d: 'EMB' },
              { s: 'NASDAQ:TLT', d: 'TLT' },
            ],
          },
          {
            title: '收益率曲线',
            symbols: [
              { s: 'TVC:US02Y', d: '2Y' },
              { s: 'TVC:US05Y', d: '5Y' },
              { s: 'TVC:US10Y', d: '10Y' },
              { s: 'TVC:US30Y', d: '30Y' },
            ],
          },
        ],
      },
    },
  };

  const TvEmbeds = {
    render(container, embedKey) {
      const def = TV_EMBEDS[embedKey];
      if (!def || !container) return;
      container.innerHTML = '';
      const widget = document.createElement('div');
      widget.className = 'tradingview-widget-container';
      const inner = document.createElement('div');
      inner.className = 'tradingview-widget-container__widget';
      widget.appendChild(inner);
      const script = document.createElement('script');
      script.type = 'text/javascript';
      script.async = true;
      script.src = def.src;
      script.text = JSON.stringify({
        ...def.config,
        colorTheme: Theme.tvTheme(state.theme),
        locale: 'zh_CN',
      });
      widget.appendChild(script);
      container.appendChild(widget);
    },
    refreshAll() {
      $$('.tv-embed[data-embed]').forEach((container) => {
        this.render(container, container.dataset.embed);
      });
    },
  };

  // Custom trading tools: pure client-side or free public data (no API key)
  const Tools = {
    cleanups: {},
    mount(id, el, setStatus) {
      // 外部 widget 文件可注册到 window.GT_EXTRA_TOOLS
      const tool = this[id] || (window.GT_EXTRA_TOOLS || {})[id];
      if (!tool || !el) return;
      this.destroy(id);
      const maybeCleanup = tool.mount(el, setStatus);
      this.cleanups[id] = typeof maybeCleanup === 'function' ? maybeCleanup : null;
      setStatus('online');
      SystemHUD.pulseFlow();
    },
    destroy(id) {
      if (typeof this.cleanups[id] === 'function') {
        try { this.cleanups[id](); } catch (e) { /* noop */ }
      }
      delete this.cleanups[id];
    },

    // Position size / risk-reward calculator (pure JS)
    risk: {
      presets: {
        fx: { pointSize: 0.0001, pointValue: 10 },
        jpy: { pointSize: 0.01, pointValue: 10 },
        gold: { pointSize: 1, pointValue: 100 },
        btc: { pointSize: 1, pointValue: 1 },
      },
      mount(el) {
        el.innerHTML = `
          <div class="tool">
            <div class="tool-grid">
              <label class="field"><span>账户余额 $</span><input type="number" data-f="balance" value="10000" min="0"></label>
              <label class="field"><span>风险比例 %</span><input type="number" data-f="risk" value="1" min="0" step="0.1"></label>
            </div>
            <label class="field"><span>品种预设</span>
              <select data-f="preset">
                <option value="fx">外汇直盘 · $10 / 点 / 手</option>
                <option value="jpy">日元盘 · $10 / 点 / 手</option>
                <option value="gold">黄金 XAU · $100 / $1 / 手</option>
                <option value="btc">BTC · $1 / $1 / 手</option>
                <option value="custom">自定义参数</option>
              </select>
            </label>
            <div class="tool-grid">
              <label class="field"><span>点大小</span><input type="number" data-f="pointSize" value="0.0001" step="any"></label>
              <label class="field"><span>每手点值 $</span><input type="number" data-f="pointValue" value="10" step="any"></label>
            </div>
            <div class="tool-grid">
              <label class="field"><span>入场价</span><input type="number" data-f="entry" step="any" placeholder="1.08500"></label>
              <label class="field"><span>止损价</span><input type="number" data-f="sl" step="any" placeholder="1.08000"></label>
            </div>
            <label class="field"><span>止盈价（可选 · 计算 R:R）</span><input type="number" data-f="tp" step="any" placeholder="1.09500"></label>
            <div class="tool-results" data-results></div>
          </div>`;
        const get = (f) => $(`[data-f="${f}"]`, el);
        const out = $('[data-results]', el);
        const compute = () => {
          const balance = parseVal(get('balance').value);
          const riskPct = parseVal(get('risk').value);
          const pointSize = parseVal(get('pointSize').value);
          const pointValue = parseVal(get('pointValue').value);
          const entry = parseVal(get('entry').value);
          const sl = parseVal(get('sl').value);
          const tp = parseVal(get('tp').value);
          if (!balance || !riskPct || !pointSize || !pointValue || entry === null || sl === null || entry === sl) {
            out.innerHTML = '<div class="tool-hint">填写入场价 / 止损价后自动计算</div>';
            return;
          }
          const riskAmt = (balance * riskPct) / 100;
          const distPoints = Math.abs(entry - sl) / pointSize;
          const lots = riskAmt / (distPoints * pointValue);
          const dir = entry > sl ? '<b class="pos">做多 LONG</b>' : '<b class="neg">做空 SHORT</b>';
          let rrHtml = '';
          if (tp !== null && tp !== entry) {
            const rr = Math.abs(tp - entry) / Math.abs(entry - sl);
            const valid = (entry > sl && tp > entry) || (entry < sl && tp < entry);
            const rrClass = !valid ? 'neg' : rr >= 2 ? 'pos' : rr >= 1 ? 'warn' : 'neg';
            const reward = lots * (Math.abs(tp - entry) / pointSize) * pointValue;
            rrHtml = `
              <div class="result-row"><span>风险回报比</span><b class="${rrClass}">1 : ${fmtNum(rr, 2)}${valid ? '' : ' ⚠ 方向有误'}</b></div>
              <div class="result-row"><span>潜在盈利</span><b class="pos">+$${fmtNum(reward)}</b></div>`;
          }
          out.innerHTML = `
            <div class="result-row"><span>方向</span>${dir}</div>
            <div class="result-row"><span>风险金额</span><b class="neg">-$${fmtNum(riskAmt)}</b></div>
            <div class="result-row"><span>止损距离</span><b>${fmtNum(distPoints, 1)} 点</b></div>
            <div class="result-row highlight"><span>建议手数</span><b>${fmtNum(lots, 2)} 手</b></div>
            <div class="result-row"><span>≈ 迷你手 / 微手</span><b>${fmtNum(lots * 10, 1)} / ${fmtNum(lots * 100, 0)}</b></div>
            ${rrHtml}`;
        };
        el.addEventListener('input', (e) => {
          if (e.target.dataset.f === 'preset') {
            const p = this.presets[e.target.value];
            if (p) {
              get('pointSize').value = p.pointSize;
              get('pointValue').value = p.pointValue;
            }
          }
          compute();
        });
        compute();
      },
    },

    // Fibonacci retracement / extension calculator (pure JS)
    fib: {
      ratios: [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1],
      extRatios: [1.272, 1.618, 2, 2.618],
      mount(el) {
        el.innerHTML = `
          <div class="tool">
            <div class="tool-grid">
              <label class="field"><span>低点 Low</span><input type="number" data-f="low" step="any" placeholder="1.0800"></label>
              <label class="field"><span>高点 High</span><input type="number" data-f="high" step="any" placeholder="1.1000"></label>
            </div>
            <label class="field"><span>波段方向</span>
              <select data-f="trend">
                <option value="up">上涨 · 低→高（看回撤支撑）</option>
                <option value="down">下跌 · 高→低（看反弹压力）</option>
              </select>
            </label>
            <div class="tool-results padless" data-results></div>
          </div>`;
        const get = (f) => $(`[data-f="${f}"]`, el);
        const out = $('[data-results]', el);
        const compute = () => {
          const low = parseVal(get('low').value);
          const high = parseVal(get('high').value);
          const trend = get('trend').value;
          if (low === null || high === null || high <= low) {
            out.innerHTML = '<div class="tool-hint">请输入有效的高点 / 低点</div>';
            return;
          }
          const range = high - low;
          const d = range >= 500 ? 2 : range >= 50 ? 3 : range >= 1 ? 4 : 5;
          const price = (r) => (trend === 'up' ? high - range * r : low + range * r);
          const extPrice = (r) => (trend === 'up' ? low + range * r : high - range * r);
          const rows = this.ratios
            .map((r) => {
              const key = r === 0.382 || r === 0.5 || r === 0.618;
              return `<tr class="${key ? 'key-level' : ''}"><td class="lv">${(r * 100).toFixed(1)}%</td><td class="pr">${fmtNum(price(r), d)}</td></tr>`;
            })
            .join('');
          const extRows = this.extRatios
            .map((r) => `<tr><td class="lv">EXT ${(r * 100).toFixed(1)}%</td><td class="pr">${fmtNum(extPrice(r), d)}</td></tr>`)
            .join('');
          out.innerHTML = `
            <div class="level-title">${trend === 'up' ? '回撤位（支撑）' : '反弹位（压力）'}</div>
            <table class="level-table">${rows}</table>
            <div class="level-title">扩展位（目标）</div>
            <table class="level-table">${extRows}</table>`;
        };
        el.addEventListener('input', compute);
        compute();
      },
    },

    // Pivot points calculator: Classic / Camarilla / Fibonacci (pure JS)
    pivot: {
      mount(el) {
        el.innerHTML = `
          <div class="tool">
            <div class="tool-grid">
              <label class="field"><span>前高 H</span><input type="number" data-f="h" step="any" placeholder="1.0920"></label>
              <label class="field"><span>前低 L</span><input type="number" data-f="l" step="any" placeholder="1.0830"></label>
            </div>
            <div class="tool-grid">
              <label class="field"><span>收盘 C</span><input type="number" data-f="c" step="any" placeholder="1.0880"></label>
              <label class="field"><span>算法</span>
                <select data-f="method">
                  <option value="classic">经典 Classic</option>
                  <option value="camarilla">卡玛利拉 Camarilla</option>
                  <option value="fibo">斐波那契 Fib</option>
                </select>
              </label>
            </div>
            <div class="tool-results padless" data-results></div>
          </div>`;
        const get = (f) => $(`[data-f="${f}"]`, el);
        const out = $('[data-results]', el);
        const compute = () => {
          const h = parseVal(get('h').value);
          const l = parseVal(get('l').value);
          const c = parseVal(get('c').value);
          if (h === null || l === null || c === null || h <= l) {
            out.innerHTML = '<div class="tool-hint">请输入前一周期的 高 / 低 / 收</div>';
            return;
          }
          const method = get('method').value;
          const range = h - l;
          const d = c >= 500 ? 2 : c >= 50 ? 3 : c >= 1 ? 4 : 5;
          const p = (h + l + c) / 3;
          let levels = [];
          if (method === 'classic') {
            levels = [
              ['R3', h + 2 * (p - l), 'res'],
              ['R2', p + range, 'res'],
              ['R1', 2 * p - l, 'res'],
              ['P', p, 'piv'],
              ['S1', 2 * p - h, 'sup'],
              ['S2', p - range, 'sup'],
              ['S3', l - 2 * (h - p), 'sup'],
            ];
          } else if (method === 'camarilla') {
            levels = [
              ['R4', c + (range * 1.1) / 2, 'res'],
              ['R3', c + (range * 1.1) / 4, 'res'],
              ['R2', c + (range * 1.1) / 6, 'res'],
              ['R1', c + (range * 1.1) / 12, 'res'],
              ['S1', c - (range * 1.1) / 12, 'sup'],
              ['S2', c - (range * 1.1) / 6, 'sup'],
              ['S3', c - (range * 1.1) / 4, 'sup'],
              ['S4', c - (range * 1.1) / 2, 'sup'],
            ];
          } else {
            levels = [
              ['R3', p + range, 'res'],
              ['R2', p + 0.618 * range, 'res'],
              ['R1', p + 0.382 * range, 'res'],
              ['P', p, 'piv'],
              ['S1', p - 0.382 * range, 'sup'],
              ['S2', p - 0.618 * range, 'sup'],
              ['S3', p - range, 'sup'],
            ];
          }
          out.innerHTML = `<table class="level-table">${levels
            .map(([name, price, cls]) => `<tr class="${cls}"><td class="lv">${name}</td><td class="pr">${fmtNum(price, d)}</td></tr>`)
            .join('')}</table>`;
        };
        el.addEventListener('input', compute);
        compute();
      },
    },

    // Global market sessions, live (pure JS, timezone-aware)
    // 7 组 47 个市场: 外汇时段 / 亚太 / 欧洲 / 美洲 / 中东非 / 期货大宗 / 24/7
    // days:[0..6] 自定义交易日(0=周日, 如中东周日-周四); 缺省 weekdays:true = 周一~周五
    // 跨日时段 close<=open (如 CME 18:00→次日17:00, days 为开盘日); week:{} = 每周连续市(外汇现货)
    // 交易时间为公开资料近似值, 未含节假日; 上期所仅画日盘, 夜盘见 note
    sessions: {
      groups: [
        {
          title: '外汇时段 · FOREX',
      cn: '全球交易时段',
          items: [
            { name: '威灵顿', code: 'WLG', tz: 'Pacific/Auckland', open: [8, 0], close: [17, 0], weekdays: true },
            { name: '悉尼', code: 'SYD', tz: 'Australia/Sydney', open: [7, 0], close: [16, 0], weekdays: true },
            { name: '东京', code: 'TYO', tz: 'Asia/Tokyo', open: [9, 0], close: [18, 0], weekdays: true },
            { name: '法兰克福', code: 'FRA', tz: 'Europe/Berlin', open: [8, 0], close: [17, 0], weekdays: true },
            { name: '伦敦', code: 'LON', tz: 'Europe/London', open: [8, 0], close: [17, 0], weekdays: true },
            { name: '纽约', code: 'NYC', tz: 'America/New_York', open: [8, 0], close: [17, 0], weekdays: true },
          ],
        },
        {
          title: '亚太股市 · APAC',
          items: [
            { name: '新西兰', code: 'NZX', tz: 'Pacific/Auckland', open: [10, 0], close: [16, 45], weekdays: true },
            { name: '澳大利亚', code: 'ASX', tz: 'Australia/Sydney', open: [10, 0], close: [16, 0], weekdays: true },
            { name: '日本', code: 'TSE', tz: 'Asia/Tokyo', open: [9, 0], close: [15, 0], lunch: [[11, 30], [12, 30]], weekdays: true },
            { name: '韩国', code: 'KRX', tz: 'Asia/Seoul', open: [9, 0], close: [15, 30], weekdays: true },
            { name: '中国A股', code: 'SSE', tz: 'Asia/Shanghai', open: [9, 30], close: [15, 0], lunch: [[11, 30], [13, 0]], weekdays: true },
            { name: '香港', code: 'HKEX', tz: 'Asia/Hong_Kong', open: [9, 30], close: [16, 0], lunch: [[12, 0], [13, 0]], weekdays: true },
            { name: '台湾', code: 'TWSE', tz: 'Asia/Taipei', open: [9, 0], close: [13, 30], weekdays: true },
            { name: '新加坡', code: 'SGX', tz: 'Asia/Singapore', open: [9, 0], close: [17, 0], weekdays: true },
            { name: '马来西亚', code: 'KLSE', tz: 'Asia/Kuala_Lumpur', open: [9, 0], close: [17, 0], lunch: [[12, 30], [14, 30]], weekdays: true },
            { name: '印尼', code: 'IDX', tz: 'Asia/Jakarta', open: [9, 30], close: [15, 15], lunch: [[12, 0], [13, 30]], weekdays: true },
            { name: '菲律宾', code: 'PSE', tz: 'Asia/Manila', open: [9, 30], close: [15, 0], lunch: [[12, 0], [13, 0]], weekdays: true },
            { name: '越南', code: 'HOSE', tz: 'Asia/Ho_Chi_Minh', open: [9, 0], close: [15, 0], lunch: [[11, 30], [13, 0]], weekdays: true },
            { name: '泰国', code: 'SET', tz: 'Asia/Bangkok', open: [10, 0], close: [16, 30], lunch: [[12, 30], [14, 30]], weekdays: true },
            { name: '印度', code: 'NSE', tz: 'Asia/Kolkata', open: [9, 15], close: [15, 30], weekdays: true },
          ],
        },
        {
          title: '欧洲股市 · EUROPE',
          items: [
            { name: '俄罗斯', code: 'MOEX', tz: 'Europe/Moscow', open: [9, 50], close: [18, 50], weekdays: true },
            { name: '土耳其', code: 'BIST', tz: 'Europe/Istanbul', open: [10, 0], close: [18, 0], weekdays: true },
            { name: '德国', code: 'XETRA', tz: 'Europe/Berlin', open: [9, 0], close: [17, 30], weekdays: true },
            { name: '法国', code: 'PAR', tz: 'Europe/Paris', open: [9, 0], close: [17, 30], weekdays: true },
            { name: '荷兰', code: 'AMS', tz: 'Europe/Amsterdam', open: [9, 0], close: [17, 30], weekdays: true },
            { name: '意大利', code: 'MIL', tz: 'Europe/Rome', open: [9, 0], close: [17, 30], weekdays: true },
            { name: '西班牙', code: 'BME', tz: 'Europe/Madrid', open: [9, 0], close: [17, 30], weekdays: true },
            { name: '瑞士', code: 'SIX', tz: 'Europe/Zurich', open: [9, 0], close: [17, 30], weekdays: true },
            { name: '瑞典', code: 'STO', tz: 'Europe/Stockholm', open: [9, 0], close: [17, 30], weekdays: true },
            { name: '英国', code: 'LSE', tz: 'Europe/London', open: [8, 0], close: [16, 30], weekdays: true },
          ],
        },
        {
          title: '美洲股市 · AMERICAS',
          items: [
            { name: '美国', code: 'NYSE', tz: 'America/New_York', open: [9, 30], close: [16, 0], weekdays: true },
            { name: '加拿大', code: 'TSX', tz: 'America/Toronto', open: [9, 30], close: [16, 0], weekdays: true },
            { name: '墨西哥', code: 'BMV', tz: 'America/Mexico_City', open: [8, 30], close: [15, 0], weekdays: true },
            { name: '巴西', code: 'B3', tz: 'America/Sao_Paulo', open: [10, 0], close: [17, 0], weekdays: true },
            { name: '阿根廷', code: 'BCBA', tz: 'America/Argentina/Buenos_Aires', open: [11, 0], close: [17, 0], weekdays: true },
            { name: '智利', code: 'BCS', tz: 'America/Santiago', open: [9, 30], close: [16, 0], weekdays: true },
          ],
        },
        {
          title: '中东与非洲 · MEA',
          items: [
            { name: '沙特', code: 'TADAWUL', tz: 'Asia/Riyadh', open: [10, 0], close: [15, 0], days: [0, 1, 2, 3, 4] },
            { name: '阿联酋', code: 'DFM', tz: 'Asia/Dubai', open: [10, 0], close: [15, 0], weekdays: true },
            { name: '卡塔尔', code: 'QSE', tz: 'Asia/Qatar', open: [9, 30], close: [13, 10], days: [0, 1, 2, 3, 4] },
            { name: '以色列', code: 'TASE', tz: 'Asia/Jerusalem', open: [10, 0], close: [17, 25], days: [0, 1, 2, 3, 4] },
            { name: '南非', code: 'JSE', tz: 'Africa/Johannesburg', open: [9, 0], close: [17, 0], weekdays: true },
          ],
        },
        {
          title: '期货与大宗 · FUTURES',
          items: [
            { name: 'CME股指期货', code: 'CME', tz: 'America/New_York', open: [18, 0], close: [17, 0], days: [0, 1, 2, 3, 4] },
            { name: 'COMEX黄金', code: 'COMEX', tz: 'America/New_York', open: [18, 0], close: [17, 0], days: [0, 1, 2, 3, 4] },
            { name: '伦敦金属', code: 'LME', tz: 'Europe/London', open: [1, 0], close: [19, 0], weekdays: true },
            { name: '上期所', code: 'SHFE', tz: 'Asia/Shanghai', open: [9, 0], close: [15, 0], breaks: [[[10, 15], [10, 30]], [[11, 30], [13, 30]]], weekdays: true, note: '日盘+夜盘21:00-01:00' },
          ],
        },
        {
          title: '全天候 · 24/7',
          items: [
            { name: '加密货币', code: 'CRYPTO', tz: 'UTC', always: true },
            { name: '外汇现货', code: 'FX SPOT', tz: 'America/New_York', week: { openDay: 0, open: [17, 0], closeDay: 5, close: [17, 0] } },
          ],
        },
      ],
      offsetHours(tz, date) {
        const parts = new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          hour12: false,
          year: 'numeric',
          month: 'numeric',
          day: 'numeric',
          hour: 'numeric',
          minute: 'numeric',
          second: 'numeric',
        })
          .formatToParts(date)
          .reduce((acc, p) => {
            acc[p.type] = p.value;
            return acc;
          }, {});
        const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
        return (asUTC - date.getTime()) / 3600000;
      },
      /* 当地 分钟数(0-1439) 与 星期(0=周日) */
      localParts(tz, date) {
        const parts = new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          hour12: false,
          weekday: 'short',
          hour: 'numeric',
          minute: 'numeric',
        })
          .formatToParts(date)
          .reduce((acc, p) => {
            acc[p.type] = p.value;
            return acc;
          }, {});
        const days = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
        return { mins: (+parts.hour % 24) * 60 + +parts.minute, day: days[parts.weekday] };
      },
      fmtDur(mins) {
        mins = Math.max(0, Math.round(mins));
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        return h >= 24 ? `${Math.floor(h / 24)}d${h % 24}h` : `${h}h${String(m).padStart(2, '0')}m`;
      },
      toMin(hm) {
        return hm[0] * 60 + hm[1];
      },
      /* 交易日数组: days 优先, weekdays:true = 周一~周五, 缺省每天 */
      daysOf(s) {
        return s.days || (s.weekdays ? [1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5, 6]);
      },
      /* 盘中休息段: breaks 多段 或 lunch 单段 */
      breaksOf(s) {
        if (s.breaks) return s.breaks;
        return s.lunch ? [s.lunch] : [];
      },
      /* 当前状态: open / lunch / closed + 文案 */
      stateOf(s, now) {
        if (s.always) return { state: 'open', label: '24/7 交易中' };
        const lp = this.localParts(s.tz, now);
        /* 每周连续市(外汇现货): 周日 open → 周五 close 不间断 */
        if (s.week) {
          const w = s.week;
          const openM = this.toMin(w.open);
          const closeM = this.toMin(w.close);
          const beforeOpen = lp.day < w.openDay || (lp.day === w.openDay && lp.mins < openM);
          const afterClose = lp.day > w.closeDay || (lp.day === w.closeDay && lp.mins >= closeM);
          if (beforeOpen || afterClose) {
            let gap = ((w.openDay - lp.day + 7) % 7) * 1440 + (openM - lp.mins);
            if (gap <= 0) gap += 7 * 1440;
            return { state: 'closed', label: `周末休市·开市 ${this.fmtDur(gap)}` };
          }
          const left = (w.closeDay - lp.day) * 1440 + (closeM - lp.mins);
          return { state: 'open', label: `连续市·距周末收盘 ${this.fmtDur(left)}` };
        }
        const days = this.daysOf(s);
        const inDay = (d) => days.includes(d);
        const openM = this.toMin(s.open);
        const closeM = this.toMin(s.close);
        const overnight = closeM <= openM; // 跨日时段(如 CME 18:00→次日17:00, days 为开盘日)
        const trading = overnight
          ? (inDay(lp.day) && lp.mins >= openM) || (inDay((lp.day + 6) % 7) && lp.mins < closeM)
          : inDay(lp.day) && lp.mins >= openM && lp.mins < closeM;
        if (trading) {
          const brks = this.breaksOf(s);
          for (const b of brks) {
            const bs = this.toMin(b[0]);
            const be = this.toMin(b[1]);
            if (lp.mins >= bs && lp.mins < be) {
              return { state: 'lunch', label: `午休中·复市 ${this.fmtDur(be - lp.mins)}` };
            }
          }
          let left;
          if (overnight) {
            left = lp.mins < closeM ? closeM - lp.mins : 1440 - lp.mins + closeM;
          } else {
            const next = brks.map((b) => this.toMin(b[0])).filter((bs) => bs > lp.mins);
            left = (next.length ? Math.min(...next) : closeM) - lp.mins;
          }
          return { state: 'open', label: `交易中·剩余 ${this.fmtDur(left)}` };
        }
        /* 休市: 逐日扫描下一开盘时刻(自动覆盖周末/周日-周四等交易日模式) */
        let gap = null;
        for (let off = 0; off <= 8 && gap === null; off++) {
          const g = off * 1440 + (openM - lp.mins);
          if (g > 0 && inDay((lp.day + off) % 7)) gap = g;
        }
        const prefix = !inDay(lp.day) ? '休市' : lp.mins < openM ? '未开盘' : '已收盘';
        return { state: 'closed', label: `${prefix}·开市 ${this.fmtDur(gap || 0)}` };
      },
      /* 时段条分段（UTC 0-100%）；午休/盘中休息段单独着色，跨日时段自动拆分 */
      segments(s, now) {
        if (s.always || s.week) return [{ left: 0, width: 100, kind: 'main' }];
        const off = this.offsetHours(s.tz, now) * 60; // 分钟
        const seg = (aMin, bMin, kind) => {
          const a = (((aMin - off) % 1440) + 1440) % 1440;
          const b = (((bMin - off) % 1440) + 1440) % 1440;
          if (b <= a) {
            return [
              { left: (a / 1440) * 100, width: ((1440 - a) / 1440) * 100, kind },
              { left: 0, width: (b / 1440) * 100, kind },
            ];
          }
          return [{ left: (a / 1440) * 100, width: ((b - a) / 1440) * 100, kind }];
        };
        const openM = this.toMin(s.open);
        const closeM = this.toMin(s.close);
        const brks = this.breaksOf(s);
        if (!brks.length) return seg(openM, closeM, 'main');
        const out = [];
        let cur = openM;
        for (const b of brks) {
          out.push(...seg(cur, this.toMin(b[0]), 'main'));
          out.push(...seg(this.toMin(b[0]), this.toMin(b[1]), 'lunch'));
          cur = this.toMin(b[1]);
        }
        out.push(...seg(cur, closeM, 'main'));
        return out.filter((r) => r.width > 0.05);
      },
      mount(el) {
        el.innerHTML = '<div class="sessions-wrap"></div>';
        const wrap = $('.sessions-wrap', el);
        const render = () => {
          const now = new Date();
          const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
          let fxOpen = 0;
          const body = this.groups
            .map((g, gi) => {
              const rows = g.items
                .map((s) => {
                  const st = this.stateOf(s, now);
                  if (gi === 0 && st.state === 'open') fxOpen++;
                  const localTime = s.always
                    ? '全天'
                    : now.toLocaleTimeString('en-GB', {
                        timeZone: s.tz,
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false,
                      });
                  const fills = this.segments(s, now)
                    .map(
                      (r) =>
                        `<div class="session-fill${r.kind === 'lunch' ? ' lunch' : ''}" style="left:${r.left.toFixed(2)}%;width:${r.width.toFixed(2)}%"></div>`
                    )
                    .join('');
                  return `
                <div class="session-row ${st.state === 'open' ? 'open' : ''}${st.state === 'lunch' ? ' lunch-break' : ''}">
                  <div class="session-info">
                    <b>${s.name} ${s.code}</b>
                    <div class="session-info-sub">
                      <span class="session-local">${localTime}${s.note ? ` · ${s.note}` : ''}</span>
                      <span class="session-state">${st.label}</span>
                    </div>
                  </div>
                  <div class="session-track">
                    ${fills}
                    <div class="session-now" style="left:${((utcMin / 1440) * 100).toFixed(2)}%"></div>
                  </div>
                </div>`;
                })
                .join('');
              return `<div class="session-group-title">${g.title}</div>${rows}`;
            })
            .join('');
          const badge = fxOpen >= 2 ? '<div class="session-badge">⚡ 外汇时段重叠 · 高波动窗口</div>' : '';
          wrap.innerHTML = `
            <div class="session-scale"><span>00</span><span>06</span><span>12</span><span>18</span><span>24 UTC</span></div>
            ${body}${badge}`;
        };
        render();
        const timer = setInterval(render, 30000);
        return () => clearInterval(timer);
      },
    },

    // Crypto live board via Binance public WebSocket (no API key, REST fallback)
    crypto: {
      symbols: ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'LTCUSDT'],
      fmtPrice(p) {
        if (p >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 1 });
        if (p >= 1) return p.toFixed(2);
        return p.toPrecision(4);
      },
      mount(el, setStatus) {
        el.innerHTML = `
          <div class="crypto-wrap">
            <div class="crypto-head"><span>BINANCE · 24H</span><span class="crypto-status" data-conn>连接中…</span></div>
            <div class="crypto-rows">
              ${this.symbols
                .map(
                  (s) => `
                <div class="crypto-row" data-sym="${s}">
                  <span class="crypto-name">${s.replace('USDT', '')}<i>/USDT</i></span>
                  <span class="crypto-price" data-price>—</span>
                  <span class="crypto-chg" data-chg>—</span>
                </div>`
                )
                .join('')}
            </div>
          </div>`;
        const conn = $('[data-conn]', el);
        const prices = {};
        let ws = null;
        let pollTimer = null;
        let alive = true;
        const update = (sym, price, open) => {
          const row = $(`.crypto-row[data-sym="${sym}"]`, el);
          if (!row || !Number.isFinite(price)) return;
          const priceEl = $('[data-price]', row);
          const chgEl = $('[data-chg]', row);
          const prev = prices[sym];
          prices[sym] = price;
          priceEl.textContent = this.fmtPrice(price);
          if (prev !== undefined && prev !== price) {
            row.classList.remove('flash-up', 'flash-down');
            void row.offsetWidth;
            row.classList.add(price > prev ? 'flash-up' : 'flash-down');
          }
          const pct = open ? ((price - open) / open) * 100 : 0;
          chgEl.textContent = `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
          chgEl.classList.toggle('pos', pct >= 0);
          chgEl.classList.toggle('neg', pct < 0);
          SystemHUD.pulseFlow();
        };
        const startPoll = () => {
          if (pollTimer || !alive) return;
          const fetchOnce = async () => {
            try {
              const res = await fetch(
                `https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(this.symbols))}`
              );
              const data = await res.json();
              (Array.isArray(data) ? data : []).forEach((t) => update(t.symbol, parseFloat(t.lastPrice), parseFloat(t.openPrice)));
              setStatus('online');
            } catch (e) {
              setStatus('offline');
            }
          };
          fetchOnce();
          pollTimer = setInterval(fetchOnce, 15000);
        };
        try {
          const streams = this.symbols.map((s) => `${s.toLowerCase()}@miniTicker`).join('/');
          ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);
          ws.onopen = () => {
            if (!alive) return;
            conn.textContent = '● LIVE';
            conn.className = 'crypto-status live';
            setStatus('online');
          };
          ws.onmessage = (ev) => {
            try {
              const d = JSON.parse(ev.data).data;
              if (d && d.s) update(d.s, parseFloat(d.c), parseFloat(d.o));
            } catch (e) { /* noop */ }
          };
          ws.onclose = () => {
            if (!alive) return;
            conn.textContent = 'POLLING';
            conn.className = 'crypto-status poll';
            startPoll();
          };
          ws.onerror = () => {
            if (ws) ws.close();
          };
        } catch (e) {
          startPoll();
        }
        return () => {
          alive = false;
          if (ws) ws.close();
          if (pollTimer) clearInterval(pollTimer);
        };
      },
    },

    // Crypto Fear & Greed Index via alternative.me public API (no API key)
    feargreed: {
      labels: {
        'Extreme Fear': '极度恐慌',
        Fear: '恐慌',
        Neutral: '中性',
        Greed: '贪婪',
        'Extreme Greed': '极度贪婪',
      },
      colorOf(v) {
        if (v < 25) return 'var(--down)';
        if (v < 45) return 'color-mix(in srgb, var(--down) 50%, var(--warning))';
        if (v < 55) return 'var(--warning)';
        if (v < 75) return 'color-mix(in srgb, var(--warning) 50%, var(--up))';
        return 'var(--up)';
      },
      gaugeSvg(value) {
        const polar = (pct) => {
          const angle = Math.PI * (1 - pct / 100);
          return [50 + 42 * Math.cos(angle), 50 - 42 * Math.sin(angle)];
        };
        const segments = [
          [0, 20, 'var(--down)'],
          [20, 40, 'color-mix(in srgb, var(--down) 50%, var(--warning))'],
          [40, 60, 'var(--warning)'],
          [60, 80, 'color-mix(in srgb, var(--warning) 50%, var(--up))'],
          [80, 100, 'var(--up)'],
        ];
        const arcs = segments
          .map(([a, b, color]) => {
            const [x1, y1] = polar(a + 1);
            const [x2, y2] = polar(b - 1);
            return `<path d="M ${x1.toFixed(2)} ${y1.toFixed(2)} A 42 42 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}" fill="none" stroke="${color}" stroke-width="9"/>`;
          })
          .join('');
        const angle = Math.PI * (1 - value / 100);
        const nx = 50 + 32 * Math.cos(angle);
        const ny = 50 - 32 * Math.sin(angle);
        return `
          <svg viewBox="0 0 100 58" class="fng-svg">
            ${arcs}
            <line x1="50" y1="50" x2="${nx.toFixed(2)}" y2="${ny.toFixed(2)}" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <circle cx="50" cy="50" r="3.5" fill="currentColor"/>
          </svg>`;
      },
      mount(el, setStatus) {
        el.innerHTML = '<div class="fng-wrap"><div class="tool-hint">加载中…</div></div>';
        const wrap = $('.fng-wrap', el);
        const load = async () => {
          try {
            const res = await fetch('https://api.alternative.me/fng/?limit=7');
            const json = await res.json();
            const list = json.data || [];
            if (!list.length) throw new Error('empty');
            const cur = list[0];
            const value = parseInt(cur.value, 10);
            wrap.innerHTML = `
              <div class="fng-gauge">${this.gaugeSvg(value)}</div>
              <div class="fng-value" style="color:${this.colorOf(value)}">${value}</div>
              <div class="fng-label">${this.labels[cur.value_classification] || cur.value_classification}</div>
              <div class="fng-history">
                ${list
                  .slice()
                  .reverse()
                  .map((d) => {
                    const v = parseInt(d.value, 10);
                    return `<div class="fng-bar" title="${v} · ${this.labels[d.value_classification] || d.value_classification}"><span style="height:${v}%;background:${this.colorOf(v)}"></span></div>`;
                  })
                  .join('')}
              </div>
              <div class="fng-foot">CRYPTO FEAR & GREED · 近7日</div>`;
            setStatus('online');
          } catch (e) {
            wrap.innerHTML = '<div class="tool-hint">数据加载失败，稍后自动重试</div>';
            setStatus('offline');
          }
        };
        load();
        const timer = setInterval(load, 5 * 60 * 1000);
        return () => clearInterval(timer);
      },
    },

    // Trade journal with stats, localStorage persistence, CSV export
    journal: {
      mount(el) {
        el.innerHTML = `
          <div class="tool journal">
            <div class="journal-stats" data-stats></div>
            <div class="journal-form">
              <input type="text" data-f="symbol" placeholder="品种" maxlength="12">
              <select data-f="side"><option value="long">多</option><option value="short">空</option></select>
              <input type="number" data-f="entry" placeholder="入场" step="any">
              <input type="number" data-f="exit" placeholder="出场" step="any">
              <input type="number" data-f="pnl" placeholder="盈亏 $" step="any">
              <input type="text" data-f="note" placeholder="备注" maxlength="40">
              <button type="button" class="tool-btn" data-add>+ 记录</button>
            </div>
            <div class="journal-table-wrap">
              <table class="data-table">
                <thead><tr><th>日期</th><th>品种</th><th>向</th><th>入场</th><th>出场</th><th>盈亏 $</th><th></th></tr></thead>
                <tbody data-rows></tbody>
              </table>
            </div>
            <div class="journal-foot">
              <button type="button" class="tool-btn ghost" data-export>导出 CSV</button>
              <button type="button" class="tool-btn ghost danger" data-clear>清空</button>
            </div>
          </div>`;
        const rowsEl = $('[data-rows]', el);
        const statsEl = $('[data-stats]', el);
        const get = (f) => $(`[data-f="${f}"]`, el);
        const read = () => {
          try {
            return JSON.parse(localStorage.getItem(STORAGE_KEYS.journal)) || [];
          } catch (e) {
            return [];
          }
        };
        const write = (list) => localStorage.setItem(STORAGE_KEYS.journal, JSON.stringify(list));
        const render = () => {
          const list = read();
          rowsEl.innerHTML =
            list
              .slice()
              .reverse()
              .map(
                (t) => `
              <tr>
                <td>${escapeHtml(t.date)}</td>
                <td>${escapeHtml(t.symbol)}</td>
                <td class="${t.side === 'long' ? 'pos' : 'neg'}">${t.side === 'long' ? '多' : '空'}</td>
                <td>${escapeHtml(t.entry)}</td>
                <td>${escapeHtml(t.exit)}</td>
                <td class="${t.pnl >= 0 ? 'pos' : 'neg'}" title="${escapeHtml(t.note || '')}">${t.pnl >= 0 ? '+' : ''}${fmtNum(t.pnl)}</td>
                <td><button type="button" class="row-del" data-del="${t.id}" title="删除">×</button></td>
              </tr>`
              )
              .join('') || '<tr class="empty-row"><td colspan="7">暂无记录 · 添加你的第一笔交易</td></tr>';
          const n = list.length;
          const wins = list.filter((t) => t.pnl > 0);
          const total = list.reduce((s, t) => s + t.pnl, 0);
          const grossW = wins.reduce((s, t) => s + t.pnl, 0);
          const grossL = Math.abs(list.filter((t) => t.pnl < 0).reduce((s, t) => s + t.pnl, 0));
          const pf = grossL > 0 ? grossW / grossL : grossW > 0 ? Infinity : 0;
          statsEl.innerHTML = `
            <div class="stat"><span>交易数</span><b>${n}</b></div>
            <div class="stat"><span>胜率</span><b>${n ? ((wins.length / n) * 100).toFixed(1) : '0.0'}%</b></div>
            <div class="stat"><span>总盈亏</span><b class="${total >= 0 ? 'pos' : 'neg'}">${total >= 0 ? '+' : ''}$${fmtNum(total)}</b></div>
            <div class="stat"><span>盈利因子</span><b>${pf === Infinity ? '∞' : fmtNum(pf, 2)}</b></div>`;
        };
        $('[data-add]', el).addEventListener('click', () => {
          const pnl = parseVal(get('pnl').value);
          if (pnl === null) {
            Toast.show('请填写盈亏金额', '⚠');
            return;
          }
          const now = new Date();
          const list = read();
          list.push({
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
            date: `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
            symbol: get('symbol').value.trim().toUpperCase() || '—',
            side: get('side').value,
            entry: get('entry').value || '—',
            exit: get('exit').value || '—',
            pnl,
            note: get('note').value.trim(),
          });
          write(list);
          ['symbol', 'entry', 'exit', 'pnl', 'note'].forEach((f) => {
            get(f).value = '';
          });
          render();
          Toast.show('交易已记录', '✓');
        });
        rowsEl.addEventListener('click', (e) => {
          const btn = e.target.closest('[data-del]');
          if (!btn) return;
          write(read().filter((t) => t.id !== btn.dataset.del));
          render();
        });
        $('[data-export]', el).addEventListener('click', () => {
          const list = read();
          if (!list.length) {
            Toast.show('暂无数据可导出', '⚠');
            return;
          }
          const csv = [
            'date,symbol,side,entry,exit,pnl,note',
            ...list.map((t) => [t.date, t.symbol, t.side, t.entry, t.exit, t.pnl, `"${String(t.note).replace(/"/g, '""')}"`].join(',')),
          ].join('\n');
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
          a.download = `journal-${new Date().toISOString().slice(0, 10)}.csv`;
          a.click();
          URL.revokeObjectURL(a.href);
        });
        $('[data-clear]', el).addEventListener('click', () => {
          if (window.confirm('确定清空全部交易记录？')) {
            write([]);
            render();
          }
        });
        render();
      },
    },
  };

  // Transparent-card state: persisted map of widgetId -> true
  const Ghost = {
    read() {
      try {
        return JSON.parse(localStorage.getItem(STORAGE_KEYS.ghost)) || {};
      } catch (e) {
        return {};
      }
    },
    write(map) {
      localStorage.setItem(STORAGE_KEYS.ghost, JSON.stringify(map));
    },
    apply(el, id) {
      const content = el ? $('.grid-stack-item-content', el) : null;
      if (content) content.classList.toggle('card-transparent', !!this.read()[id]);
    },
    toggle(el, id) {
      const map = this.read();
      if (map[id]) delete map[id];
      else map[id] = true;
      this.write(map);
      this.apply(el, id);
      return !!map[id];
    },
  };

  // Lazy-load observers for iframe widgets (key: grid item element)
  const iframeObservers = new WeakMap();

  // Widget rendering and management
  const Widgets = {
    getLayout() {
      try {
        const saved = localStorage.getItem(STORAGE_KEYS.layout);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length) return parsed;
        }
      } catch (e) {
        console.warn('Failed to load layout:', e);
      }
      return DEFAULT_LAYOUT;
    },
    saveLayout: debounce(() => {
      if (!state.grid) return;
      try {
        const res = state.grid.save(false);
        localStorage.setItem(STORAGE_KEYS.layout, JSON.stringify(res));
      } catch (e) {
        console.warn('Failed to save layout:', e);
      }
    }, 300),
    buildContent(id) {
      const def = WIDGETS[id];
      if (!def) return '';

      const bodyClass = ['widget-body'];
      if (def.className) bodyClass.push(def.className);
      if (def.type === 'custom') bodyClass.push('tool-body');

      let inner = '';
      if (def.type === 'chart') {
        inner = `<div id="tv-main"></div>`;
      } else if (def.type === 'iframe') {
        const themeParam = Theme.tvTheme(state.theme);
        const separator = def.src.includes('?') ? '&' : '?';
        const src = def.src.includes('desmos.com')
          ? def.src
          : `${def.src}${separator}theme=${themeParam}`;
        const allow = def.allow ? ` allow="${def.allow}"` : '';
        const cls = def.className || '';
        inner = `<iframe class="${cls}" data-src="${escapeHtml(src)}"${allow} allowfullscreen loading="lazy"></iframe>`;
      } else if (def.type === 'tv-embed') {
        inner = `<div class="tv-embed" data-embed="${def.embed}"></div>`;
      } else if (def.type === 'custom') {
        inner = `<div class="tool-root" data-tool="${def.tool}"></div>`;
      }

      return `
        <div class="drag-handle">
          <span class="drag-handle-left">
            <span class="widget-status loading" data-status="loading" aria-hidden="true"></span>
            <span>${def.icon}</span>
            <span>:: ${def.title}${def.cn ? ` · ${def.cn}` : ''}</span>
          </span>
          <span class="drag-handle-actions">
            <button class="drag-handle-btn ghost-toggle" data-action="ghost" title="透明背景">◍</button>
            <button class="drag-handle-btn" data-action="remove" title="关闭组件" aria-label="关闭组件">×</button>
          </span>
        </div>
        <div class="${bodyClass.join(' ')}">
          <div class="widget-loader">INITIALIZING</div>
          <div class="widget-error">
            <span>加载失败</span>
            <button data-action="reload">重试</button>
          </div>
          ${inner}
        </div>
      `;
    },
    add(id, layoutOverride = {}) {
      const def = WIDGETS[id];
      if (!def) return;
      state.grid.addWidget({
        w: layoutOverride.w ?? def.w,
        h: layoutOverride.h ?? def.h,
        x: layoutOverride.x ?? undefined,
        y: layoutOverride.y ?? undefined,
        id,
        minW: def.minW,
        minH: def.minH,
        content: this.buildContent(id),
      });
      this.initWidget(id);
      this.saveLayout();
    },
    remove(id) {
      const item = state.grid.engine.nodes.find((n) => n.id === id);
      if (item) {
        Tools.destroy(id);
        // 清理该组件的懒加载 observer，避免组件移除后仍触发加载
        const observer = iframeObservers.get(item.el);
        if (observer) {
          observer.disconnect();
          iframeObservers.delete(item.el);
        }
        state.grid.removeWidget(item.el, true);
        this.saveLayout();
      }
    },
    initWidget(id) {
      const node = state.grid.engine.nodes.find((n) => n.id === id);
      if (!node) return;
      const def = WIDGETS[id] || {};
      const el = node.el;
      Ghost.apply(el, id);
      const status = $('.widget-status', el);
      const setStatus = (s) => {
        if (!status) return;
        status.dataset.status = s;
        status.className = `widget-status ${s}`;
      };

      const iframe = $('iframe[data-src]', el);
      if (iframe && !iframe.src) {
        const loadIframe = () => {
          setStatus('loading');
          iframe.src = iframe.dataset.src;
          iframe.addEventListener('load', () => {
            const loader = $('.widget-loader', el);
            if (loader) loader.remove();
            setStatus('online');
            const body = $('.widget-body', el);
            if (body) {
              body.classList.add('flash');
              body.addEventListener('animationend', () => body.classList.remove('flash'), { once: true });
            }
            SystemHUD.pulseFlow();
          });
          iframe.addEventListener('error', () => {
            const error = $('.widget-error', el);
            if (error) error.classList.add('visible');
            setStatus('offline');
          });
        };
        if ('IntersectionObserver' in window) {
          // 懒加载：组件进入视区附近（提前 400px）才真正加载 iframe
          const observer = new IntersectionObserver(
            (entries) => {
              if (entries.some((entry) => entry.isIntersecting)) {
                observer.disconnect();
                iframeObservers.delete(el);
                loadIframe();
              }
            },
            { rootMargin: '400px 0px', threshold: 0.01 }
          );
          observer.observe(el);
          iframeObservers.set(el, observer);
        } else {
          // 老浏览器兜底：直接加载
          loadIframe();
        }
      } else if (id === 'main') {
        // Main chart is initialized separately
        setStatus('loading');
        setTimeout(() => {
          this.initMainChart();
          setStatus('online');
          SystemHUD.pulseFlow();
          const body = $('.widget-body', el);
          if (body) {
            body.classList.add('flash');
            body.addEventListener('animationend', () => body.classList.remove('flash'), { once: true });
          }
        }, 100);
      } else if (def.type === 'tv-embed') {
        setStatus('loading');
        const container = $('.tv-embed', el);
        if (container) {
          TvEmbeds.render(container, def.embed);
          const done = () => {
            const loader = $('.widget-loader', el);
            if (loader) loader.remove();
            setStatus('online');
            SystemHUD.pulseFlow();
            const body = $('.widget-body', el);
            if (body) {
              body.classList.add('flash');
              body.addEventListener('animationend', () => body.classList.remove('flash'), { once: true });
            }
          };
          const observer = new MutationObserver(() => {
            if (container.querySelector('iframe')) {
              observer.disconnect();
              done();
            }
          });
          observer.observe(container, { childList: true, subtree: true });
          setTimeout(() => {
            observer.disconnect();
            done();
          }, 10000);
        }
      } else if (def.type === 'custom') {
        setStatus('loading');
        const loader = $('.widget-loader', el);
        if (loader) loader.remove();
        const root = $('.tool-root', el);
        if (root) {
          Tools.mount(id, root, setStatus);
          const body = $('.widget-body', el);
          if (body) {
            body.classList.add('flash');
            body.addEventListener('animationend', () => body.classList.remove('flash'), { once: true });
          }
        }
      }
    },
    updateIframeThemes() {
      const themeParam = Theme.tvTheme(state.theme);
      $$('iframe[data-src]').forEach((iframe) => {
        const base = iframe.dataset.src.split('?')[0];
        if (base.includes('desmos.com')) return;
        // 尚未懒加载的 iframe 不强制加载，仅同步 data-src 主题参数
        if (!iframe.src) {
          iframe.dataset.src = `${base}?theme=${themeParam}`;
          return;
        }
        const newSrc = `${base}?theme=${themeParam}`;
        if (iframe.src !== newSrc) {
          iframe.src = newSrc;
        }
      });
    },
    initMainChart() {
      const container = $('#tv-main');
      if (!container || typeof TradingView === 'undefined') return;
      // Clear previous widget if any
      container.innerHTML = '';
      try {
        state.chartWidget = new TradingView.widget({
          ...CONFIG.chart,
          theme: Theme.tvTheme(state.theme),
          container_id: 'tv-main',
        });
        const loader = container.parentElement.querySelector('.widget-loader');
        if (loader) loader.remove();
      } catch (e) {
        console.error('TradingView chart init failed:', e);
      }
    },
    restore() {
      const layout = this.getLayout();
      layout.forEach((w) => {
        const def = WIDGETS[w.id];
        if (!def) return;
        state.grid.addWidget({
          w: w.w,
          h: w.h,
          x: w.x,
          y: w.y,
          id: w.id,
          minW: def.minW,
          minH: def.minH,
          content: this.buildContent(w.id),
        });
      });
      // Initialize widgets after grid is populated
      Object.keys(WIDGETS).forEach((id) => {
        if (state.grid.engine.nodes.find((n) => n.id === id)) {
          this.initWidget(id);
        }
      });
      // Main chart init with a small delay to ensure container is ready
      setTimeout(() => this.initMainChart(), 600);
    },
  };

  // Widget add menu
  const WidgetMenu = {
    activeTab: 'widgets',
    activeIndex: 0,
    search: '',
    toggle() {
      state.menuOpen = !state.menuOpen;
      const menu = $('#widget-menu');
      const toggle = $('#widget-menu-toggle');
      if (menu) {
        menu.classList.toggle('open', state.menuOpen);
        menu.setAttribute('aria-hidden', String(!state.menuOpen));
      }
      if (toggle) {
        toggle.classList.toggle('open', state.menuOpen);
      }
      if (state.menuOpen) {
        this.activeTab = 'widgets';
        this.activeIndex = 0;
        this.search = '';
        const input = $('#widget-menu-search');
        if (input) input.value = '';
        this.render();
        setTimeout(() => $('#widget-menu-search')?.focus(), 50);
      }
    },
    open(tab = 'widgets') {
      state.menuOpen = true;
      this.activeTab = tab;
      this.activeIndex = 0;
      this.search = '';
      const menu = $('#widget-menu');
      const toggle = $('#widget-menu-toggle');
      if (menu) {
        menu.classList.add('open');
        menu.setAttribute('aria-hidden', 'false');
      }
      if (toggle) toggle.classList.add('open');
      const input = $('#widget-menu-search');
      if (input) input.value = '';
      this.render();
      setTimeout(() => input?.focus(), 50);
    },
    close() {
      state.menuOpen = false;
      state.commandOpen = false;
      const menu = $('#widget-menu');
      const toggle = $('#widget-menu-toggle');
      if (menu) {
        menu.classList.remove('open');
        menu.setAttribute('aria-hidden', 'true');
      }
      if (toggle) toggle.classList.remove('open');
    },
    setTab(tab) {
      this.activeTab = tab;
      this.activeIndex = 0;
      this.render();
      const input = $('#widget-menu-search');
      if (input) input.focus();
    },
    setSearch(v) {
      this.search = v.trim().toLowerCase();
      this.activeIndex = 0;
      this.render();
    },
    getFilteredItems() {
      const term = this.search;
      if (this.activeTab === 'widgets') {
        return Object.entries(WIDGETS).filter(([id, def]) => {
          if (!term) return true;
          return (id + ' ' + def.title + ' ' + (def.cn || '')).toLowerCase().includes(term);
        });
      }
      if (this.activeTab === 'workspaces') {
        return Workspace.PRESETS.filter((p) => {
          if (!term) return true;
          return (p.id + ' ' + p.name + ' ' + p.desc + ' ' + p.category).toLowerCase().includes(term);
        });
      }
      if (this.activeTab === 'commands') {
        return COMMANDS.filter((c) => {
          if (!term) return true;
          return (c.id + ' ' + c.label + ' ' + c.keys).toLowerCase().includes(term);
        });
      }
      return [];
    },
    renderWidgets(items) {
      if (!items.length) return `<div class="widget-menu-empty">无匹配组件</div>`;
      const html = items
        .map(([id, def]) => {
          const exists = state.grid?.engine.nodes.some((n) => n.id === id);
          return `
            <div class="widget-menu-item ${exists ? 'added' : ''}" data-widget="${id}">
              <span>${def.icon} ${def.title}${def.cn ? ` <span class="widget-cn">${def.cn}</span>` : ''}</span>
              <span class="widget-key">${exists ? '已添加' : ''}</span>
            </div>
          `;
        })
        .join('');
      return `<div class="widget-menu-list">${html}</div>`;
    },
    renderWorkspaces(items) {
      if (!items.length) return `<div class="widget-menu-empty">无匹配看板</div>`;
      const groups = {};
      items.forEach((p) => {
        groups[p.category] = groups[p.category] || [];
        groups[p.category].push(p);
      });
      const html = Object.entries(groups)
        .map(
          ([cat, list]) => `
          <div class="widget-workspace-category">
            <div class="widget-workspace-category-title">${escapeHtml(cat)}</div>
            ${list
              .map(
                (p) => `
              <div class="widget-workspace-item" data-preset="${escapeHtml(p.id)}" title="${escapeHtml(p.desc)}">
                <div class="widget-workspace-item-left">
                  <span class="widget-workspace-item-icon">${p.icon}</span>
                  <div class="widget-workspace-item-info">
                    <div class="widget-workspace-item-name">${escapeHtml(p.name)}</div>
                    <div class="widget-workspace-item-desc">${escapeHtml(p.desc)}</div>
                  </div>
                </div>
                <span class="widget-workspace-item-count">${p.widgets.length}</span>
              </div>`
              )
              .join('')}
          </div>`
        )
        .join('');
      return html;
    },
    renderCommands(items) {
      if (!items.length) return `<div class="widget-menu-empty">无匹配命令</div>`;
      const html = items
        .map((c) => `
          <div class="widget-command-item" data-cmd="${c.id}">
            <span>${escapeHtml(c.label)}</span>
            <kbd>${c.keys}</kbd>
          </div>
        `)
        .join('');
      return `<div class="widget-command-list">${html}</div>`;
    },
    render() {
      const body = $('#widget-menu-body');
      if (!body) return;
      // update tabs
      $$('.widget-menu-tab').forEach((tab) => {
        const active = tab.dataset.tab === this.activeTab;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', String(active));
      });
      const items = this.getFilteredItems();
      if (this.activeTab === 'widgets') body.innerHTML = this.renderWidgets(items);
      else if (this.activeTab === 'workspaces') body.innerHTML = this.renderWorkspaces(items);
      else if (this.activeTab === 'commands') body.innerHTML = this.renderCommands(items);
      this.highlightActive();
      if (!state.menuOpen || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      body.querySelectorAll('.widget-menu-item, .widget-workspace-item, .widget-command-item').forEach((item, i) => {
        item.animate(
          [
            { opacity: 0, transform: 'translateY(6px)' },
            { opacity: 1, transform: 'translateY(0)' },
          ],
          {
            duration: 320,
            delay: 40 + Math.min(i, 12) * 22,
            easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
            fill: 'backwards',
          }
        );
      });
    },
    highlightActive() {
      const items = this.getSelectableItems();
      items.forEach((el, i) => el.classList.toggle('active', i === this.activeIndex));
      const active = items[this.activeIndex];
      if (active) active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    },
    getSelectableItems() {
      return $$('.widget-menu-item:not(.added), .widget-workspace-item, .widget-command-item', $('#widget-menu'));
    },
    moveActive(dir) {
      const items = this.getSelectableItems();
      if (!items.length) return;
      this.activeIndex = (this.activeIndex + dir + items.length) % items.length;
      this.highlightActive();
    },
    executeActive() {
      const items = this.getSelectableItems();
      const active = items[this.activeIndex];
      if (!active) return;
      if (active.dataset.widget) {
        const id = active.dataset.widget;
        const exists = state.grid?.engine.nodes.some((n) => n.id === id);
        if (!exists) Widgets.add(id);
        this.close();
      } else if (active.dataset.preset) {
        Workspace.openPreset(active.dataset.preset);
        this.close();
      } else if (active.dataset.cmd) {
        const cmd = COMMANDS.find((c) => c.id === active.dataset.cmd);
        if (cmd) {
          cmd.action();
          Toast.show(`已执行：${cmd.label}`, '⌘');
        }
        this.close();
      }
    },
  };

  // Workspace presets: collapsible sidebar with dashboard layouts
  const Workspace = {
    expanded: false,
    STORAGE_KEY: 'terminal-workspace-expanded',
    PRESETS: [
      // 按市场分类
      {
        id: 'ashare',
        category: '市场',
        icon: '🇨🇳',
        name: 'A股大盘',
        desc: '行情 / 板块 / 资金 / 涨停',
        widgets: ['main', 'ashareboard', 'asharehot', 'asharesector', 'ashareladder', 'asharelimit', 'ashareflow', 'asharemood'],
      },
      {
        id: 'asharethemes',
        category: '市场',
        icon: '🐉',
        name: 'A股题材龙头',
        desc: '龙虎榜 / 涨停梯队 / 人气股',
        widgets: ['main', 'asharedragon', 'ashareladder', 'asharehot', 'asharesector', 'asharelimit', 'asharequote'],
      },
      {
        id: 'hkus',
        category: '市场',
        icon: '🇭🇰',
        name: '港股通',
        desc: '港股 / 南向资金 / 美股联动',
        widgets: ['main', 'hkboard', 'hkflow', 'usboard', 'globalidx', 'ushot'],
      },
      {
        id: 'us',
        category: '市场',
        icon: '🇺🇸',
        name: '美股明星',
        desc: '美股行情 / 热力图 / 财报',
        widgets: ['main', 'usboard', 'ushot', 'stockheat', 'marketview', 'earnings'],
      },
      {
        id: 'usearnings',
        category: '市场',
        icon: '📊',
        name: '美股财报季',
        desc: '财报日历 / 明星股 / 期权',
        widgets: ['main', 'earnings', 'usboard', 'ushot', 'optionchain', 'marketview'],
      },
      {
        id: 'crypto',
        category: '市场',
        icon: '₿',
        name: '加密货币',
        desc: '行情 / 合约 / 爆仓 / ETF',
        widgets: ['main', 'crypto', 'cryptotop', 'cryptooi', 'funding', 'cryptovol', 'cryptobasis', 'cryptoetf'],
      },
      {
        id: 'fxcommodity',
        category: '市场',
        icon: '💱',
        name: '外汇大宗',
        desc: '外汇矩阵 / 货币强弱 / 期货',
        widgets: ['main', 'forex', 'fxrates', 'fxstrength', 'fxmatrix', 'fxvol', 'commodities', 'globalfut', 'futurescurve'],
      },
      {
        id: 'commodities',
        category: '市场',
        icon: '🛢️',
        name: '商品期货',
        desc: '贵金属 / 能源 / 农产品 / 期限结构',
        widgets: ['main', 'commoditywatch', 'commodities', 'globalfut', 'futurescurve', 'fxstrength'],
      },
      {
        id: 'rates',
        category: '市场',
        icon: '🏦',
        name: '债券利率',
        desc: '美债曲线 / 央行利率 / 风险',
        widgets: ['main', 'globalbond', 'yieldcurve', 'cbankrates', 'fedmeetings', 'riskmon'],
      },
      // 按功能分类
      {
        id: 'analysis',
        category: '功能',
        icon: '📈',
        name: '行情分析',
        desc: '指数 / 热力图 / 情绪',
        widgets: ['main', 'marketview', 'globalidx', 'worldheat', 'stockheat', 'cryptoheat', 'ashareheat', 'fxstrength', 'marketsentiment'],
      },
      {
        id: 'sentiment',
        category: '功能',
        icon: '🧠',
        name: '情绪监控',
        desc: '恐慌贪婪 / 多空比 / 市场情绪',
        widgets: ['main', 'feargreed', 'marketsentiment', 'sentiment', 'cryptols', 'asharemood'],
      },
      {
        id: 'capitalflow',
        category: '功能',
        icon: '💰',
        name: '资金流向',
        desc: 'A股资金 / 北向 / 南向 / ETF / 费率',
        widgets: ['main', 'ashareflow', 'asharecapital', 'northbound', 'hkflow', 'cryptoetf', 'funding', 'cryptols'],
      },
      {
        id: 'derivatives',
        category: '功能',
        icon: '⛓️',
        name: '期权衍生品',
        desc: '期权链 / 期权实验室 / 波动率',
        widgets: ['main', 'optionchain', 'optionlab', 'optsurfacepro', 'cryptooptflow', 'cryptodvol', 'cryptobasis', 'futurescurve', 'swaps', 'structuredproducts'],
      },
      {
        id: 'macro',
        category: '功能',
        icon: '🌍',
        name: '宏观雷达',
        desc: 'VIX / 利差 / 央行 / 美联储',
        widgets: ['main', 'riskmon', 'yieldcurve', 'cbankrates', 'fedmeetings', 'fxvol', 'globalbond', 'econdata'],
      },
      {
        id: 'events',
        category: '功能',
        icon: '📅',
        name: '事件日历',
        desc: '财经日历 / 经济数据 / 假期 / 财报',
        widgets: ['main', 'calendar', 'econdata', 'holidays', 'fedmeetings', 'earnings', 'ipostats', 'globe', 'newscast'],
      },
      {
        id: 'tools',
        category: '功能',
        icon: '🧰',
        name: '交易工具',
        desc: '计算器 / 日志 / 清单',
        widgets: ['main', 'risk', 'calculators', 'compound', 'fib', 'pivot', 'autopivot', 'tradecalc', 'journal', 'checklist'],
      },
      {
        id: 'risk',
        category: '功能',
        icon: '🛡️',
        name: '风险管理',
        desc: '仓位 / 爆仓 / 监控',
        widgets: ['main', 'risk', 'portriskpro', 'alerts', 'watchlist', 'riskmon', 'liquidations', 'myliquidations', 'marketliqs', 'sentiment'],
      },
      {
        id: 'data',
        category: '功能',
        icon: '📡',
        name: '数据监控',
        desc: '指标 / 相关性 / 加密 / 外汇',
        widgets: ['main', 'sentiment', 'indicators', 'correlation', 'fxboard', 'gcrypto', 'funding', 'cryptols'],
      },
      {
        id: 'ipo',
        category: '功能',
        icon: '🎰',
        name: 'IPO打新',
        desc: 'A股 / 港股 / 美股 / 统计',
        widgets: ['main', 'ipoashare', 'ipohk', 'ipous', 'ipostats'],
      },
      // 按地区分类
      {
        id: 'apac',
        category: '地区',
        icon: '🌏',
        name: '亚太市场',
        desc: '中 / 港 / 日 / 韩 / 台 / 东盟',
        widgets: ['main', 'ashareboard', 'hkboard', 'twboard', 'jpboard', 'koreaboard', 'asiahot', 'aseanboard'],
      },
      {
        id: 'chinahk',
        category: '地区',
        icon: '🇨🇳',
        name: '大中华区',
        desc: 'A股 / 港股 / 台湾 / 韩国',
        widgets: ['main', 'ashareboard', 'hkboard', 'twboard', 'koreaboard', 'asharehot', 'hkflow'],
      },
      {
        id: 'europeamerica',
        category: '地区',
        icon: '🌍',
        name: '欧美市场',
        desc: '美 / 欧 / 英 / 德 / 情绪',
        widgets: ['main', 'usboard', 'euboard', 'ukboard', 'deboard', 'globalidx', 'marketsentiment'],
      },
      {
        id: 'emerging',
        category: '地区',
        icon: '🌎',
        name: '新兴市场',
        desc: '巴西 / 拉美 / 印度 / 非洲',
        widgets: ['main', 'brboard', 'latamboard', 'emhot', 'africaboard', 'mideastboard', 'inboard'],
      },
      {
        id: 'meaafrica',
        category: '地区',
        icon: '🕌',
        name: '中东非洲',
        desc: '中东 / 非洲 / 大洋洲',
        widgets: ['main', 'mideastboard', 'africaboard', 'oceaniaboard', 'globalidx'],
      },
      // 按策略分类
      {
        id: 'trend',
        category: '策略',
        icon: '📈',
        name: '趋势跟踪',
        desc: '主图 / 指标 / 货币强弱 / 相关',
        widgets: ['main', 'indicators', 'autopivot', 'fxstrength', 'correlation', 'globalidx', 'marketsentiment'],
      },
      {
        id: 'arbitrage',
        category: '策略',
        icon: '⚖️',
        name: '套利监控',
        desc: '基差 / 期货曲线 / 外汇矩阵',
        widgets: ['main', 'cryptobasis', 'futurescurve', 'fxmatrix', 'correlation', 'funding', 'optionlab'],
      },
      {
        id: 'swing',
        category: '策略',
        icon: '🎯',
        name: '波段交易',
        desc: '斐波 / 枢轴 / 仓位 / 自选',
        widgets: ['main', 'fib', 'pivot', 'risk', 'watchlist', 'alerts', 'journal'],
      },
      {
        id: 'intraday',
        category: '策略',
        icon: '⚡',
        name: '日内交易',
        desc: '时段 / 快讯 / 个股 / 热力',
        widgets: ['main', 'sessions', 'news', 'fxboard', 'cryptotop', 'asharequote', 'alerts'],
      },
      {
        id: 'allocation',
        category: '策略',
        icon: '⚓',
        name: '资产配置',
        desc: '全球指数 / 债 / 商品 / 加密 / 外汇',
        widgets: ['main', 'globalidx', 'globalbond', 'commoditywatch', 'crypto', 'worldheat', 'fxstrength'],
      },
      // 新增跨市场/衍生品看板预设
      {
        id: 'emeafrontier',
        category: '市场',
        icon: '🕌',
        name: '欧亚前沿市场',
        desc: '俄罗斯 / 土耳其 / 沙特 / 新兴市场货币',
        widgets: ['main', 'russia', 'turkey', 'saudi', 'emfx', 'mideastboard', 'globalidx'],
      },
      {
        id: 'fixedincome',
        category: '市场',
        icon: '📜',
        name: '固定收益',
        desc: '新兴市场债 / 高收益债 / TIPS / 信用利差',
        widgets: ['main', 'emdebt', 'junkbond', 'tips', 'creditspreads', 'yieldcurve', 'globalbond'],
      },
      {
        id: 'preciousmetals',
        category: '市场',
        icon: '🥇',
        name: '贵金属',
        desc: '黄金 / 白银 / 铂金 / 钯金 / 基本金属',
        widgets: ['main', 'preciousmetals', 'basemetals', 'basemetalspro', 'commodities', 'fxstrength', 'fxboard'],
      },
      {
        id: 'energy',
        category: '市场',
        icon: '⛽',
        name: '能源期货',
        desc: '原油 / 天然气 / 汽油 / 取暖油 / 期货曲线',
        widgets: ['main', 'energyfut', 'energypro', 'globalfut', 'futurescurve', 'commodities', 'fxstrength'],
      },
      {
        id: 'agriculture',
        category: '市场',
        icon: '🌽',
        name: '农产品',
        desc: '玉米 / 小麦 / 大豆 / 咖啡 / 糖 / 棉花 / 畜牧',
        widgets: ['main', 'agriculture', 'agripro', 'commoditywatch', 'energyfut', 'futurescurve'],
      },
      {
        id: 'realestate',
        category: '市场',
        icon: '🏢',
        name: '房地产与REITs',
        desc: 'VNQ / IYR / XLRE / O / PLD / AMT',
        widgets: ['main', 'reits', 'stockheat', 'marketview', 'yieldcurve'],
      },
      {
        id: 'semiconductor',
        category: '市场',
        icon: '💻',
        name: '半导体',
        desc: 'SMH / SOXX / NVDA / AMD / TSM / AVGO / MU',
        widgets: ['main', 'semiconductor', 'stockheat', 'tech', 'usboard', 'ushot'],
      },
      {
        id: 'cleanenergy',
        category: '市场',
        icon: '🔋',
        name: '清洁能源',
        desc: 'ICLN / PBW / QCLN / URA / CCJ / ENPH / SEDG',
        widgets: ['main', 'cleanenergy', 'energyfut', 'commoditywatch', 'stockheat'],
      },
      {
        id: 'aitheme',
        category: '市场',
        icon: '🤖',
        name: 'AI革命',
        desc: 'BOTZ / IRBO / MSFT / GOOGL / AMZN / META / PLTR',
        widgets: ['main', 'aithematic', 'stockheat', 'semiconductor', 'ushot'],
      },
      {
        id: 'volatility',
        category: '功能',
        icon: '📉',
        name: '波动率交易',
        desc: 'VIX / VIXY / UVXY / SVXY / VVIX / OVX',
        widgets: ['main', 'volindices', 'riskmon', 'optionlab', 'fxvol'],
      },
      {
        id: 'defi',
        category: '市场',
        icon: '🔗',
        name: 'DeFi',
        desc: 'UNI / AAVE / MKR / COMP / CRV / LDO / DYDX',
        widgets: ['main', 'defi', 'crypto', 'cryptotop', 'funding', 'cryptooi'],
      },
      {
        id: 'btcminers',
        category: '市场',
        icon: '⛏️',
        name: '比特币矿股',
        desc: 'MARA / RIOT / CLSK / COIN / HUT / BITF',
        widgets: ['main', 'btcminers', 'crypto', 'cryptoetf', 'cryptobasis', 'funding'],
      },
      {
        id: 'credit',
        category: '功能',
        icon: '⚖️',
        name: '信用利差',
        desc: '美债 / 投资级 / 高收益 / 新兴债利差',
        widgets: ['main', 'creditspreads', 'yieldcurve', 'globalbond', 'riskmon'],
      },
      {
        id: 'emfx',
        category: '市场',
        icon: '💱',
        name: '新兴市场外汇',
        desc: '离岸人民币 / 印度卢比 / 雷亚尔 / 比索 / 兰特 / 卢布 / 里拉',
        widgets: ['main', 'emfx', 'fxstrength', 'fxboard', 'fxrates'],
      },
      {
        id: 'commoditiesall',
        category: '市场',
        icon: '🌾',
        name: '大宗商品全览',
        desc: '贵金属 / 基本金属 / 能源 / 农产品',
        widgets: ['main', 'preciousmetals', 'basemetals', 'basemetalspro', 'energyfut', 'energypro', 'agriculture', 'agripro', 'commoditywatch', 'futurescurve'],
      },
      {
        id: 'thematicrotation',
        category: '策略',
        icon: '🎭',
        name: '主题行业轮动',
        desc: '半导体 / 清洁能源 / AI / REITs',
        widgets: ['main', 'semiconductor', 'cleanenergy', 'aithematic', 'reits', 'stockheat'],
      },
      {
        id: 'ustech',
        category: '市场',
        icon: '🇺🇸',
        name: '美股科技',
        desc: 'AI / 半导体 / 美股明星 / 热力图',
        widgets: ['main', 'aithematic', 'semiconductor', 'usboard', 'ushot', 'stockheat'],
      },
      {
        id: 'globalrates',
        category: '功能',
        icon: '🏛️',
        name: '全球利率',
        desc: 'TIPS / 美债曲线 / 全球债市 / 央行利率 / 美联储',
        widgets: ['main', 'tips', 'yieldcurve', 'globalbond', 'cbankrates', 'fedmeetings'],
      },
      {
        id: 'cryptoderivatives',
        category: '功能',
        icon: '⛓️',
        name: '加密衍生品',
        desc: 'DeFi / 矿股 / 基差 / 资金费率 / 持仓量',
        widgets: ['main', 'defi', 'btcminers', 'cryptobasis', 'funding', 'cryptooi'],
      },
      {
        id: 'crossassetrisk',
        category: '策略',
        icon: '🛡️',
        name: '跨资产风险',
        desc: '波动率 / 信用利差 / 风险监控 / 恐慌贪婪',
        widgets: ['main', 'volindices', 'creditspreads', 'riskmon', 'feargreed', 'marketsentiment'],
      },
      {
        id: 'frontierbonds',
        category: '市场',
        icon: '🌍',
        name: '前沿债券',
        desc: 'EM债 / 高收益 / TIPS / 信用利差 / 利率曲线',
        widgets: ['main', 'emdebt', 'junkbond', 'tips', 'creditspreads', 'globalbond', 'yieldcurve'],
      },
      {
        id: 'macroinflation',
        category: '功能',
        icon: '📈',
        name: '通胀宏观',
        desc: 'TIPS / 能源 / 农产品 / 贵金属 / 美债',
        widgets: ['main', 'tips', 'energyfut', 'agriculture', 'preciousmetals', 'yieldcurve'],
      },
      // v15 新增一键看板
      {
        id: 'fundamentalanalysis',
        category: '功能',
        icon: '📑',
        name: '基本面分析',
        desc: '财务报表 / 公司资料 / 估值模型 / 股权结构',
        widgets: ['main', 'finstatements', 'companydes', 'fundamentaldata', 'ownership', 'researchres'],
      },
      {
        id: 'equityresearch',
        category: '功能',
        icon: '📰',
        name: '股票研究',
        desc: '卖方研报 / 并购 / 股权结构 / 公司概况',
        widgets: ['main', 'researchres', 'companydes', 'ownership', 'madeals', 'earnings'],
      },
      {
        id: 'derivativespro',
        category: '功能',
        icon: '🌊',
        name: '衍生品专业版',
        desc: '期权曲面 / 期权链 / 互换 / 结构化产品',
        widgets: ['main', 'optsurfacepro', 'optionlab', 'optionchain', 'swaps', 'structuredproducts', 'cryptodvol'],
      },
      {
        id: 'portfolioriskpro',
        category: '策略',
        icon: '🛡️',
        name: '组合风险建模',
        desc: '组合风险 /归因 / VaR / 压力测试 / Beta-Alpha',
        widgets: ['main', 'portriskpro', 'portfoliorisk', 'riskmon', 'correlation', 'volindices'],
      },
      {
        id: 'newsroom',
        category: '功能',
        icon: '📡',
        name: '新闻直播间',
        desc: '新闻播报 / 全球事件地球仪 / 财经日历',
        widgets: ['main', 'newscast', 'globe', 'calendar', 'econdata', 'marketsentiment'],
      },
      {
        id: 'media',
        category: '功能',
        icon: '🎧',
        name: '媒体中心',
        desc: '新闻播报 / 音乐流',
        widgets: ['newscast', 'music'],
      },
    ],
    grouped() {
      const groups = {};
      this.PRESETS.forEach((p) => {
        groups[p.category] = groups[p.category] || [];
        groups[p.category].push(p);
      });
      return groups;
    },
    isExpanded() {
      try {
        return localStorage.getItem(this.STORAGE_KEY) === '1';
      } catch (e) {
        return false;
      }
    },
    setExpanded(v) {
      try {
        localStorage.setItem(this.STORAGE_KEY, v ? '1' : '0');
      } catch (e) { /* noop */ }
    },
    toggle() {
      this.expanded = !this.expanded;
      this.apply();
      this.setExpanded(this.expanded);
    },
    apply() {
      document.body.classList.toggle('workspace-expanded', this.expanded);
      if (state.grid) setTimeout(() => state.grid.resize(), 360);
    },
    render() {
      const list = $('#workspace-sidebar-list');
      if (!list) return;
      const groups = this.grouped();
      list.innerHTML = Object.entries(groups)
        .map(
          ([cat, items]) => `
          <div class="workspace-category">
            <div class="workspace-category-title">${escapeHtml(cat)}</div>
            ${items
              .map(
                (p) => `
              <div class="workspace-item" data-preset="${escapeHtml(p.id)}" title="${escapeHtml(p.desc)}">
                <div class="workspace-item-left">
                  <span class="workspace-item-icon">${p.icon}</span>
                  <div class="workspace-item-info">
                    <div class="workspace-item-name">${escapeHtml(p.name)}</div>
                    <div class="workspace-item-desc">${escapeHtml(p.desc)}</div>
                  </div>
                </div>
                <span class="workspace-item-count">${p.widgets.length}</span>
              </div>`
              )
              .join('')}
          </div>`
        )
        .join('');
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        list.querySelectorAll('.workspace-item').forEach((item, i) => {
          item.animate(
            [
              { opacity: 0, transform: 'translateX(-8px)' },
              { opacity: 1, transform: 'translateX(0)' },
            ],
            {
              duration: 350,
              delay: 60 + Math.min(i, 16) * 25,
              easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
              fill: 'backwards',
            }
          );
        });
      }
    },
    openPreset(id) {
      const preset = this.PRESETS.find((p) => p.id === id);
      if (!preset || !state.grid) return;
      const currentIds = state.grid.engine.nodes.map((n) => n.id).filter(Boolean);
      currentIds.forEach((wid) => Widgets.remove(wid));
      preset.widgets.forEach((wid) => {
        if (WIDGETS[wid]) Widgets.add(wid);
      });
      Widgets.saveLayout();
      Toast.show(`已切换工作区：${preset.name}`, preset.icon);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    init() {
      this.expanded = this.isExpanded();
      this.apply();
      this.render();
    },
  };

  // Command palette
  const COMMANDS = [
    { id: 'theme-toggle', label: '打开主题菜单', keys: 'T', action: () => ThemeMenu.toggle() },
    { id: 'add-main', label: '添加主图组件', keys: '1', action: () => Widgets.add('main') },
    { id: 'add-forex', label: '添加外汇组件', keys: '2', action: () => Widgets.add('forex') },
    { id: 'add-calc', label: '添加计算器', keys: '3', action: () => Widgets.add('calc') },
    { id: 'add-news', label: '添加新闻组件', keys: '4', action: () => Widgets.add('news') },
    { id: 'add-calendar', label: '添加日历组件', keys: '5', action: () => Widgets.add('calendar') },
    { id: 'add-scanner', label: '添加扫描器', keys: '6', action: () => Widgets.add('scanner') },
    { id: 'add-music', label: '添加音乐流', keys: '7', action: () => Widgets.add('music') },
    { id: 'add-risk', label: '添加仓位计算器', keys: '8', action: () => Widgets.add('risk') },
    { id: 'add-crypto', label: '添加加密货币行情', keys: '9', action: () => Widgets.add('crypto') },
    { id: 'add-feargreed', label: '添加恐慌贪婪指数', keys: '0', action: () => Widgets.add('feargreed') },
    { id: 'add-tech', label: '添加技术评级', keys: 'Q', action: () => Widgets.add('tech') },
    { id: 'add-heatmap', label: '添加外汇热力图', keys: 'H', action: () => Widgets.add('heatmap') },
    { id: 'add-fib', label: '添加斐波那契计算', keys: 'F', action: () => Widgets.add('fib') },
    { id: 'add-pivot', label: '添加枢轴点计算', keys: 'P', action: () => Widgets.add('pivot') },
    { id: 'add-sessions', label: '添加全球交易时段', keys: 'S', action: () => Widgets.add('sessions') },
    { id: 'add-journal', label: '添加交易日志', keys: 'J', action: () => Widgets.add('journal') },
    { id: 'add-marketview', label: '添加全球市场概览', keys: 'M', action: () => Widgets.add('marketview') },
    { id: 'add-stockheat', label: '添加美股热力图', keys: 'U', action: () => Widgets.add('stockheat') },
    { id: 'add-cryptoheat', label: '添加加密热力图', keys: 'C', action: () => Widgets.add('cryptoheat') },
    { id: 'add-fxrates', label: '添加实时汇率', keys: 'X', action: () => Widgets.add('fxrates') },
    { id: 'add-gcrypto', label: '添加加密市场全局', keys: 'G', action: () => Widgets.add('gcrypto') },
    { id: 'add-funding', label: '添加资金费率', keys: 'N', action: () => Widgets.add('funding') },
    { id: 'add-commodities', label: '添加大宗商品', keys: 'O', action: () => Widgets.add('commodities') },
    { id: 'add-alerts', label: '添加价格提醒', keys: 'A', action: () => Widgets.add('alerts') },
    { id: 'add-watchlist', label: '添加自选观察', keys: 'W', action: () => Widgets.add('watchlist') },
    { id: 'add-sentiment', label: '添加多空情绪', keys: 'B', action: () => Widgets.add('sentiment') },
    { id: 'add-liquidations', label: '添加爆仓监控', keys: 'L', action: () => Widgets.add('liquidations') },
    { id: 'add-myliquidations', label: '添加我的爆仓(币安)', keys: 'ML', action: () => Widgets.add('myliquidations') },
    { id: 'add-marketliqs', label: '添加全市场爆仓', keys: 'AL', action: () => Widgets.add('marketliqs') },
    { id: 'add-ashareheat', label: '添加A股热力图', keys: 'AH', action: () => Widgets.add('ashareheat') },
    { id: 'add-asharelimit', label: '添加A股涨停池', keys: 'ZT', action: () => Widgets.add('asharelimit') },
    { id: 'add-ashareboard', label: '添加A股盘面总览', keys: 'AB', action: () => Widgets.add('ashareboard') },
    { id: 'add-ashareflow', label: '添加A股资金流向榜', keys: 'AF', action: () => Widgets.add('ashareflow') },
    { id: 'add-asharemood', label: '添加A股市场情绪', keys: 'AM', action: () => Widgets.add('asharemood') },
    { id: 'add-asharehot', label: '添加A股多维榜单', keys: 'AO', action: () => Widgets.add('asharehot') },
    { id: 'add-cryptotop', label: '添加币安涨跌榜', keys: 'CT', action: () => Widgets.add('cryptotop') },
    { id: 'add-cryptooi', label: '添加合约持仓量监控', keys: 'OI', action: () => Widgets.add('cryptooi') },
    { id: 'add-globalidx', label: '添加全球股指行情板', keys: 'GI', action: () => Widgets.add('globalidx') },
    { id: 'add-hkboard', label: '添加港股行情板', keys: 'HK', action: () => Widgets.add('hkboard') },
    { id: 'add-usboard', label: '添加美股行情板', keys: 'US', action: () => Widgets.add('usboard') },
    { id: 'add-asharesector', label: '添加A股板块热度', keys: 'SEC', action: () => Widgets.add('asharesector') },
    { id: 'add-ashareladder', label: '添加A股涨停梯队', keys: 'LD', action: () => Widgets.add('ashareladder') },
    { id: 'add-asharequote', label: '添加A股个股速查', keys: 'AQ', action: () => Widgets.add('asharequote') },
    { id: 'add-asharecapital', label: '添加A股资金面', keys: 'AC', action: () => Widgets.add('asharecapital') },
    { id: 'add-asharefut', label: '添加期指与ETF', keys: 'FU', action: () => Widgets.add('asharefut') },
    { id: 'add-asharecb', label: '添加可转债与新股', keys: 'CB', action: () => Widgets.add('asharecb') },
    { id: 'add-cryptols', label: '添加多空持仓比', keys: 'LS', action: () => Widgets.add('cryptols') },
    { id: 'add-cryptobasis', label: '添加期现基差套利', keys: 'BA', action: () => Widgets.add('cryptobasis') },
    { id: 'add-cryptodvol', label: '添加期权波动率', keys: 'DV', action: () => Widgets.add('cryptodvol') },
    { id: 'add-cryptonew', label: '添加新币上线监控', keys: 'NW', action: () => Widgets.add('cryptonew') },
    { id: 'add-cryptovol', label: '添加币圈量能异动榜', keys: 'VS', action: () => Widgets.add('cryptovol') },
    { id: 'add-globalbond', label: '添加全球债市', keys: 'GB', action: () => Widgets.add('globalbond') },
    { id: 'add-ushot', label: '添加美股明星榜', keys: 'UH', action: () => Widgets.add('ushot') },
    { id: 'add-euboard', label: '添加欧股行情板', keys: 'EU', action: () => Widgets.add('euboard') },
    { id: 'add-globalfut', label: '添加全球期货', keys: 'GF', action: () => Widgets.add('globalfut') },
    { id: 'add-optionchain', label: '添加ETF期权链', keys: 'OC', action: () => Widgets.add('optionchain') },
    { id: 'add-cryptooptflow', label: '添加期权情绪流', keys: 'OF', action: () => Widgets.add('cryptooptflow') },
    { id: 'add-optionlab', label: '添加期权实验室', keys: 'OL', action: () => Widgets.add('optionlab') },
    { id: 'add-hotrank', label: '添加人气热股榜', keys: 'HR', action: () => Widgets.add('hotrank') },
    { id: 'add-twboard', label: '添加台股行情板', keys: 'TW', action: () => Widgets.add('twboard') },
    { id: 'add-asiahot', label: '添加亚太明星股', keys: 'AS', action: () => Widgets.add('asiahot') },
    { id: 'add-emhot', label: '添加新兴市场股', keys: 'EM', action: () => Widgets.add('emhot') },
    { id: 'add-hkflow', label: '添加南向资金', keys: 'HF', action: () => Widgets.add('hkflow') },
    { id: 'add-tradecalc', label: '添加策略计算器', keys: 'TC', action: () => Widgets.add('tradecalc') },
    { id: 'add-holidays', label: '添加市场假期日历', keys: 'HD', action: () => Widgets.add('holidays') },
    { id: 'add-econdata', label: '添加经济数据日历', keys: 'EC', action: () => Widgets.add('econdata') },
    { id: 'add-dividend', label: '添加分红与高股息', keys: 'DI', action: () => Widgets.add('dividend') },
    { id: 'add-ipoashare', label: '添加A股打新', keys: 'IA', action: () => Widgets.add('ipoashare') },
    { id: 'add-ipohk', label: '添加港股打新', keys: 'IH', action: () => Widgets.add('ipohk') },
    { id: 'add-ipous', label: '添加美股打新', keys: 'IU', action: () => Widgets.add('ipous') },
    { id: 'add-ipostats', label: '添加新股表现', keys: 'IP', action: () => Widgets.add('ipostats') },
    { id: 'add-worldheat', label: '添加全球热力图', keys: 'WH', action: () => Widgets.add('worldheat') },
    { id: 'add-globe', label: '添加全球事件地球仪', keys: 'GL', action: () => Widgets.add('globe') },
    { id: 'add-polymarket', label: '添加Polymarket预测市场', keys: 'PM', action: () => Widgets.add('polymarket') },
    { id: 'add-jpboard', label: '添加日股行情板', keys: 'JP', action: () => Widgets.add('jpboard') },
    { id: 'add-inboard', label: '添加印度行情板', keys: 'IN', action: () => Widgets.add('inboard') },
    { id: 'add-ukboard', label: '添加英股行情板', keys: 'UK', action: () => Widgets.add('ukboard') },
    { id: 'add-deboard', label: '添加德股行情板', keys: 'DE', action: () => Widgets.add('deboard') },
    { id: 'add-brboard', label: '添加巴西行情板', keys: 'BR', action: () => Widgets.add('brboard') },
    { id: 'add-marketsentiment', label: '添加市场情绪', keys: 'MS', action: () => Widgets.add('marketsentiment') },
    { id: 'add-supplychain', label: '添加产业链关联', keys: 'SC', action: () => Widgets.add('supplychain') },
    { id: 'add-mideastboard', label: '添加中东行情板', keys: 'MEA', action: () => Widgets.add('mideastboard') },
    { id: 'add-africaboard', label: '添加非洲行情板', keys: 'AF', action: () => Widgets.add('africaboard') },
    { id: 'add-latamboard', label: '添加拉美行情板', keys: 'LA', action: () => Widgets.add('latamboard') },
    { id: 'add-aseanboard', label: '添加东盟行情板', keys: 'ASE', action: () => Widgets.add('aseanboard') },
    { id: 'add-oceaniaboard', label: '添加大洋洲行情板', keys: 'OC', action: () => Widgets.add('oceaniaboard') },
    { id: 'add-koreaboard', label: '添加韩国行情板', keys: 'KO', action: () => Widgets.add('koreaboard') },
    { id: 'add-indicators', label: '添加技术仪表盘', keys: 'I', action: () => Widgets.add('indicators') },
    { id: 'add-correlation', label: '添加相关性矩阵', keys: 'K', action: () => Widgets.add('correlation') },
    { id: 'add-fxboard', label: '添加外汇金属行情', keys: 'D', action: () => Widgets.add('fxboard') },
    { id: 'add-fxstrength', label: '添加货币强弱', keys: 'E', action: () => Widgets.add('fxstrength') },
    { id: 'add-autopivot', label: '添加自动枢轴点', keys: 'V', action: () => Widgets.add('autopivot') },
    { id: 'add-calculators', label: '添加交易计算器Pro', keys: 'Z', action: () => Widgets.add('calculators') },
    { id: 'add-compound', label: '添加复利与期望', keys: 'Y', action: () => Widgets.add('compound') },
    { id: 'add-checklist', label: '添加交易纪律清单', keys: 'CK', action: () => Widgets.add('checklist') },
    { id: 'add-notes', label: '添加交易笔记', keys: 'NT', action: () => Widgets.add('notes') },
    { id: 'add-cryptoetf', label: '添加加密货币ETF资金流', keys: 'CE', action: () => Widgets.add('cryptoetf') },
    { id: 'add-asharedragon', label: '添加A股龙虎榜', keys: 'DR', action: () => Widgets.add('asharedragon') },
    { id: 'add-earnings', label: '添加美股财报日历', keys: 'ER', action: () => Widgets.add('earnings') },
    { id: 'add-fedmeetings', label: '添加美联储议息倒计时', keys: 'FM', action: () => Widgets.add('fedmeetings') },
    { id: 'add-fxvol', label: '添加外汇隐含波动率', keys: 'FV', action: () => Widgets.add('fxvol') },
    { id: 'add-northbound', label: '添加北向资金', keys: 'NB', action: () => Widgets.add('northbound') },
    { id: 'add-commoditywatch', label: '添加大宗商品监控', keys: 'CW', action: () => Widgets.add('commoditywatch') },
    { id: 'add-russia', label: '添加俄罗斯市场', keys: 'RU', action: () => Widgets.add('russia') },
    { id: 'add-turkey', label: '添加土耳其市场', keys: 'TK', action: () => Widgets.add('turkey') },
    { id: 'add-saudi', label: '添加沙特市场', keys: 'SA', action: () => Widgets.add('saudi') },
    { id: 'add-emdebt', label: '添加新兴市场债', keys: 'ED', action: () => Widgets.add('emdebt') },
    { id: 'add-junkbond', label: '添加高收益债', keys: 'JB', action: () => Widgets.add('junkbond') },
    { id: 'add-tips', label: '添加通胀保值债', keys: 'TP', action: () => Widgets.add('tips') },
    { id: 'add-emfx', label: '添加新兴市场货币', keys: 'EF', action: () => Widgets.add('emfx') },
    { id: 'add-preciousmetals', label: '添加贵金属', keys: 'PR', action: () => Widgets.add('preciousmetals') },
    { id: 'add-basemetals', label: '添加基本金属', keys: 'BM', action: () => Widgets.add('basemetals') },
    { id: 'add-basemetalspro', label: '添加基本金属专业版', keys: 'BP', action: () => Widgets.add('basemetalspro') },
    { id: 'add-energyfut', label: '添加能源期货', keys: 'EN', action: () => Widgets.add('energyfut') },
    { id: 'add-energypro', label: '添加能源期货专业版', keys: 'EP', action: () => Widgets.add('energypro') },
    { id: 'add-agriculture', label: '添加农产品', keys: 'AG', action: () => Widgets.add('agriculture') },
    { id: 'add-agripro', label: '添加农产品专业版', keys: 'AP', action: () => Widgets.add('agripro') },
    { id: 'add-defi', label: '添加DeFi代币', keys: 'DF', action: () => Widgets.add('defi') },
    { id: 'add-btcminers', label: '添加比特币矿股', keys: 'MN', action: () => Widgets.add('btcminers') },
    { id: 'add-reits', label: '添加REITs', keys: 'RE', action: () => Widgets.add('reits') },
    { id: 'add-semiconductor', label: '添加半导体', keys: 'SM', action: () => Widgets.add('semiconductor') },
    { id: 'add-cleanenergy', label: '添加清洁能源', keys: 'CL', action: () => Widgets.add('cleanenergy') },
    { id: 'add-aithematic', label: '添加AI主题', keys: 'AI', action: () => Widgets.add('aithematic') },
    { id: 'add-volindices', label: '添加波动率指数', keys: 'VI', action: () => Widgets.add('volindices') },
    { id: 'add-creditspreads', label: '添加信用利差', keys: 'CS', action: () => Widgets.add('creditspreads') },
    { id: 'workspace-ashare', label: '工作区：A股大盘', keys: 'WS1', action: () => Workspace.openPreset('ashare') },
    { id: 'workspace-asharethemes', label: '工作区：A股题材龙头', keys: 'WS2', action: () => Workspace.openPreset('asharethemes') },
    { id: 'workspace-hkus', label: '工作区：港股通', keys: 'WS3', action: () => Workspace.openPreset('hkus') },
    { id: 'workspace-us', label: '工作区：美股明星', keys: 'WS4', action: () => Workspace.openPreset('us') },
    { id: 'workspace-usearnings', label: '工作区：美股财报季', keys: 'WS5', action: () => Workspace.openPreset('usearnings') },
    { id: 'workspace-crypto', label: '工作区：加密货币', keys: 'WS6', action: () => Workspace.openPreset('crypto') },
    { id: 'workspace-fxcommodity', label: '工作区：外汇大宗', keys: 'WS7', action: () => Workspace.openPreset('fxcommodity') },
    { id: 'workspace-commodities', label: '工作区：商品期货', keys: 'WS8', action: () => Workspace.openPreset('commodities') },
    { id: 'workspace-rates', label: '工作区：债券利率', keys: 'WS9', action: () => Workspace.openPreset('rates') },
    { id: 'workspace-analysis', label: '工作区：行情分析', keys: 'WF1', action: () => Workspace.openPreset('analysis') },
    { id: 'workspace-sentiment', label: '工作区：情绪监控', keys: 'WF2', action: () => Workspace.openPreset('sentiment') },
    { id: 'workspace-capitalflow', label: '工作区：资金流向', keys: 'WF3', action: () => Workspace.openPreset('capitalflow') },
    { id: 'workspace-derivatives', label: '工作区：期权衍生品', keys: 'WF4', action: () => Workspace.openPreset('derivatives') },
    { id: 'workspace-macro', label: '工作区：宏观雷达', keys: 'WF5', action: () => Workspace.openPreset('macro') },
    { id: 'workspace-events', label: '工作区：事件日历', keys: 'WF6', action: () => Workspace.openPreset('events') },
    { id: 'workspace-tools', label: '工作区：交易工具', keys: 'WF7', action: () => Workspace.openPreset('tools') },
    { id: 'workspace-risk', label: '工作区：风险管理', keys: 'WF8', action: () => Workspace.openPreset('risk') },
    { id: 'workspace-data', label: '工作区：数据监控', keys: 'WF9', action: () => Workspace.openPreset('data') },
    { id: 'workspace-ipo', label: '工作区：IPO打新', keys: 'WF0', action: () => Workspace.openPreset('ipo') },
    { id: 'workspace-apac', label: '工作区：亚太市场', keys: 'WR1', action: () => Workspace.openPreset('apac') },
    { id: 'workspace-chinahk', label: '工作区：大中华区', keys: 'WR2', action: () => Workspace.openPreset('chinahk') },
    { id: 'workspace-europeamerica', label: '工作区：欧美市场', keys: 'WR3', action: () => Workspace.openPreset('europeamerica') },
    { id: 'workspace-emerging', label: '工作区：新兴市场', keys: 'WR4', action: () => Workspace.openPreset('emerging') },
    { id: 'workspace-meaafrica', label: '工作区：中东非洲', keys: 'WR5', action: () => Workspace.openPreset('meaafrica') },
    { id: 'workspace-trend', label: '工作区：趋势跟踪', keys: 'WT1', action: () => Workspace.openPreset('trend') },
    { id: 'workspace-arbitrage', label: '工作区：套利监控', keys: 'WT2', action: () => Workspace.openPreset('arbitrage') },
    { id: 'workspace-swing', label: '工作区：波段交易', keys: 'WT3', action: () => Workspace.openPreset('swing') },
    { id: 'workspace-intraday', label: '工作区：日内交易', keys: 'WT4', action: () => Workspace.openPreset('intraday') },
    { id: 'workspace-allocation', label: '工作区：资产配置', keys: 'WT5', action: () => Workspace.openPreset('allocation') },
    { id: 'workspace-emeafrontier', label: '工作区：欧亚前沿市场', keys: 'WN1', action: () => Workspace.openPreset('emeafrontier') },
    { id: 'workspace-fixedincome', label: '工作区：固定收益', keys: 'WN2', action: () => Workspace.openPreset('fixedincome') },
    { id: 'workspace-preciousmetals', label: '工作区：贵金属', keys: 'WN3', action: () => Workspace.openPreset('preciousmetals') },
    { id: 'workspace-energy', label: '工作区：能源期货', keys: 'WN4', action: () => Workspace.openPreset('energy') },
    { id: 'workspace-agriculture', label: '工作区：农产品', keys: 'WN5', action: () => Workspace.openPreset('agriculture') },
    { id: 'workspace-realestate', label: '工作区：房地产与REITs', keys: 'WN6', action: () => Workspace.openPreset('realestate') },
    { id: 'workspace-semiconductor', label: '工作区：半导体', keys: 'WN7', action: () => Workspace.openPreset('semiconductor') },
    { id: 'workspace-cleanenergy', label: '工作区：清洁能源', keys: 'WN8', action: () => Workspace.openPreset('cleanenergy') },
    { id: 'workspace-aitheme', label: '工作区：AI革命', keys: 'WN9', action: () => Workspace.openPreset('aitheme') },
    { id: 'workspace-volatility', label: '工作区：波动率交易', keys: 'WN0', action: () => Workspace.openPreset('volatility') },
    { id: 'workspace-defi', label: '工作区：DeFi', keys: 'WJ1', action: () => Workspace.openPreset('defi') },
    { id: 'workspace-btcminers', label: '工作区：比特币矿股', keys: 'WJ2', action: () => Workspace.openPreset('btcminers') },
    { id: 'workspace-credit', label: '工作区：信用利差', keys: 'WJ3', action: () => Workspace.openPreset('credit') },
    { id: 'workspace-emfx', label: '工作区：新兴市场外汇', keys: 'WJ4', action: () => Workspace.openPreset('emfx') },
    { id: 'workspace-commoditiesall', label: '工作区：大宗商品全览', keys: 'WJ5', action: () => Workspace.openPreset('commoditiesall') },
    { id: 'workspace-thematicrotation', label: '工作区：主题行业轮动', keys: 'WJ6', action: () => Workspace.openPreset('thematicrotation') },
    { id: 'workspace-ustech', label: '工作区：美股科技', keys: 'WJ7', action: () => Workspace.openPreset('ustech') },
    { id: 'workspace-globalrates', label: '工作区：全球利率', keys: 'WJ8', action: () => Workspace.openPreset('globalrates') },
    { id: 'workspace-cryptoderivatives', label: '工作区：加密衍生品', keys: 'WJ9', action: () => Workspace.openPreset('cryptoderivatives') },
    { id: 'workspace-crossassetrisk', label: '工作区：跨资产风险', keys: 'WJ0', action: () => Workspace.openPreset('crossassetrisk') },
    { id: 'workspace-frontierbonds', label: '工作区：前沿债券', keys: 'WK1', action: () => Workspace.openPreset('frontierbonds') },
    { id: 'workspace-macroninflation', label: '工作区：通胀宏观', keys: 'WK2', action: () => Workspace.openPreset('macroinflation') },
    { id: 'reset-layout', label: '重置布局', keys: 'R', action: () => {
      localStorage.removeItem(STORAGE_KEYS.layout);
      location.reload();
    }},
    // v15 新增组件与看板命令
    { id: 'add-finstatements', label: '添加财务报表拆解', keys: 'FA', action: () => Widgets.add('finstatements') },
    { id: 'add-companydes', label: '添加公司概况与管理', keys: 'DE', action: () => Widgets.add('companydes') },
    { id: 'add-researchres', label: '添加卖方研究报告', keys: 'RE', action: () => Widgets.add('researchres') },
    { id: 'add-fundamentaldata', label: '添加基本面数据模型', keys: 'FD', action: () => Widgets.add('fundamentaldata') },
    { id: 'add-ownership', label: '添加股权结构分析', keys: 'OW', action: () => Widgets.add('ownership') },
    { id: 'add-madeals', label: '添加全球并购交易', keys: 'MA', action: () => Widgets.add('madeals') },
    { id: 'add-swaps', label: '添加互换定价', keys: 'SW', action: () => Widgets.add('swaps') },
    { id: 'add-structuredproducts', label: '添加结构化产品定价', keys: 'SP', action: () => Widgets.add('structuredproducts') },
    { id: 'add-portriskpro', label: '添加组合风险建模', keys: 'PR', action: () => Widgets.add('portriskpro') },
    { id: 'add-optsurfacepro', label: '添加期权波动率曲面PRO', keys: 'OS', action: () => Widgets.add('optsurfacepro') },
    { id: 'add-newscast', label: '添加新闻直播播报', keys: 'NC', action: () => Widgets.add('newscast') },
    { id: 'workspace-fundamentalanalysis', label: '工作区：基本面分析', keys: 'WF10', action: () => Workspace.openPreset('fundamentalanalysis') },
    { id: 'workspace-equityresearch', label: '工作区：股票研究', keys: 'WF11', action: () => Workspace.openPreset('equityresearch') },
    { id: 'workspace-derivativespro', label: '工作区：衍生品专业版', keys: 'WF12', action: () => Workspace.openPreset('derivativespro') },
    { id: 'workspace-portfolioriskpro', label: '工作区：组合风险建模', keys: 'WF13', action: () => Workspace.openPreset('portfolioriskpro') },
    { id: 'workspace-newsroom', label: '工作区：新闻直播间', keys: 'WF14', action: () => Workspace.openPreset('newsroom') },
    { id: 'workspace-media', label: '工作区：媒体中心', keys: 'WF15', action: () => Workspace.openPreset('media') },
  ];

  const CommandPalette = {
    open() {
      state.commandOpen = true;
      WidgetMenu.open('commands');
    },
    close() {
      state.commandOpen = false;
      WidgetMenu.close();
    },
    toggle() {
      if (state.commandOpen || state.menuOpen) this.close();
      else this.open();
    },
    render(filter = '') {
      // delegated to WidgetMenu commands tab
      WidgetMenu.search = filter;
      WidgetMenu.render();
    },
    executeByIndex(index) {
      WidgetMenu.activeIndex = index;
      WidgetMenu.executeActive();
    },
  };

  // Event bindings
  function bindEvents() {
    // Theme picker
    $('#theme-icon')?.addEventListener('click', (e) => {
      e.stopPropagation();
      ThemeMenu.toggle();
    });

    $('#theme-menu')?.addEventListener('click', (e) => {
      const item = e.target.closest('[data-theme]');
      if (!item) return;
      const theme = item.dataset.theme;
      if (Theme.LIST.indexOf(theme) >= 0) {
        Theme.apply(theme);
        Toast.show(`主题已切换：${Theme.LABELS[theme] || theme.toUpperCase()}`, '◐');
      }
      ThemeMenu.close();
    });

    // Unified Widget Menu (widgets / workspaces / commands)
    $('#widget-menu-toggle')?.addEventListener('click', (e) => {
      e.stopPropagation();
      WidgetMenu.toggle();
    });

    $('#widget-menu')?.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-tab]');
      if (tab) {
        WidgetMenu.setTab(tab.dataset.tab);
        return;
      }
      const widgetItem = e.target.closest('[data-widget]');
      if (widgetItem) {
        const id = widgetItem.dataset.widget;
        const exists = state.grid.engine.nodes.some((n) => n.id === id);
        if (!exists) Widgets.add(id);
        WidgetMenu.close();
        return;
      }
      const presetItem = e.target.closest('[data-preset]');
      if (presetItem) {
        Workspace.openPreset(presetItem.dataset.preset);
        WidgetMenu.close();
        return;
      }
      const cmdItem = e.target.closest('[data-cmd]');
      if (cmdItem) {
        const cmd = COMMANDS.find((c) => c.id === cmdItem.dataset.cmd);
        if (cmd) {
          cmd.action();
          Toast.show(`已执行：${cmd.label}`, '⌘');
        }
        WidgetMenu.close();
      }
    });

    const menuSearch = $('#widget-menu-search');
    if (menuSearch) {
      menuSearch.addEventListener('input', (e) => {
        WidgetMenu.setSearch(e.target.value);
      });
      menuSearch.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          WidgetMenu.moveActive(1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          WidgetMenu.moveActive(-1);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          WidgetMenu.executeActive();
        } else if (e.key === 'Escape') {
          WidgetMenu.close();
        } else if (e.key === 'Tab') {
          e.preventDefault();
          const tabs = ['widgets', 'workspaces', 'commands'];
          const next = tabs[(tabs.indexOf(WidgetMenu.activeTab) + 1) % tabs.length];
          WidgetMenu.setTab(next);
        }
      });
    }

    // Workspace sidebar
    $('#workspace-toggle')?.addEventListener('click', (e) => {
      e.stopPropagation();
      Workspace.toggle();
    });

    $('#workspace-sidebar-list')?.addEventListener('click', (e) => {
      const item = e.target.closest('[data-preset]');
      if (item) {
        Workspace.openPreset(item.dataset.preset);
      }
    });

    document.addEventListener('click', (e) => {
      const menu = $('#widget-menu');
      const toggle = $('#widget-menu-toggle');
      if (state.menuOpen && menu && !menu.contains(e.target) && !toggle.contains(e.target)) {
        WidgetMenu.close();
      }
      const themeMenu = $('#theme-menu');
      const themeToggle = $('#theme-icon');
      if (ThemeMenu.open && themeMenu && !themeMenu.contains(e.target) && !themeToggle.contains(e.target)) {
        ThemeMenu.close();
      }
    });

    // Grid widget actions (remove, reload)
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const widgetEl = btn.closest('.grid-stack-item');
      const id = widgetEl?.getAttribute('gs-id');
      if (action === 'remove' && id) {
        Widgets.remove(id);
      } else if (action === 'ghost' && id) {
        const on = Ghost.toggle(widgetEl, id);
        Toast.show(on ? '卡片背景已透明' : '卡片背景已恢复', '◍');
      } else if (action === 'reload') {
        const iframe = $('iframe', widgetEl);
        if (iframe) iframe.src = iframe.src;
        const error = $('.widget-error', widgetEl);
        if (error) error.classList.remove('visible');
      }
    });

    // Layout persistence
    state.grid.on('dragstop resizestop', Widgets.saveLayout);
    state.grid.on('added removed change', Widgets.saveLayout);

    // Global keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      const isTyping = e.target.matches('input, textarea, [contenteditable]');

      // Cmd/Ctrl + K or / to open unified menu on commands tab
      if (((e.metaKey || e.ctrlKey) && e.key === 'k') || (!isTyping && e.key === '/')) {
        e.preventDefault();
        CommandPalette.open();
        return;
      }

      if (e.key === 'Escape' && (state.menuOpen || state.commandOpen)) {
        e.preventDefault();
        WidgetMenu.close();
        state.commandOpen = false;
        return;
      }

      if (isTyping) return;

      if (e.key.toLowerCase() === 't' && !state.menuOpen) {
        ThemeMenu.toggle();
      } else if (e.shiftKey && e.key === 'W' && !state.menuOpen) {
        e.preventDefault();
        Workspace.toggle();
      }
    });

    // Window resize handling
    window.addEventListener('resize', debounce(() => {
      if (state.grid) state.grid.resize();
    }, 200));

    // Widget-to-chart symbol linking
    window.addEventListener('gt:set-symbol', (e) => {
      const tv = e.detail && e.detail.tv;
      if (typeof tv !== 'string' || !tv.trim()) return;
      CONFIG.chart.symbol = tv.trim();
      Widgets.initMainChart();
      Toast.show(`主图已切换：${tv.trim()}`, '📈');
    });
  }

  // Boot the app after authentication
  function boot() {
    Theme.apply(state.theme);
    Clocks.start();
    Toast.init();
    SystemHUD.init();

    Animations.initSpotlight();
    Animations.initEntrance();
    Animations.initMagneticButton();
    Animations.initTerminalDecode();

    state.grid = GridStack.init(CONFIG.grid);

    Widgets.restore();
    bindEvents();
    Workspace.init();
  }

  // Initialize on DOM ready
  function init() {
    // Auth disabled: boot directly without login
    Auth.hideOverlay();
    const displayUser = $('#display-user');
    if (displayUser) displayUser.innerText = 'GT';
    boot();
  }

  // Expose minimal API for inline handlers
  window.App = {
    auth: Auth,
    theme: Theme,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
