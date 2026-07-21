/* GT UNLIMITED — 全球事件地球仪 v4
 * 2D 模式：Leaflet + OSM/CartoDB 切片
 * 3D 模式：globe.gl (Three.js)
 *
 * 覆盖类别：冲突、灾害、宏观/金融、健康、气候、科技/网络、航运、地缘热点。
 * 数据源：GDACS、NASA EONET、USGS、BBC、WHO、ReliefWeb、The Hacker News、
 *        ACLED、内置静态热点、宏观经济日历、模拟航运数据。
 * 所有外部请求均经 /api/proxy?url= 代理；失败时自动回退到静态/演示数据。
 * 3D 模式具备与 2D 同等能力：分类筛选、搜索、时间线、点击飞向、自动旋转调速、详情面板、航运弧线。
 *
 * Registers as custom tool id 'globe' via window.GT_EXTRA_TOOLS.
 */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  /* ── External library URLs ── */
  const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  const LEAFLET_JS  = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
  const GLOBE_GL_JS = 'https://unpkg.com/globe.gl@2.32.1/dist/globe.gl.min.js';
  const EARTH_TEXTURE_DARK  = 'https://unpkg.com/three-globe/example/img/earth-dark.jpg';
  const EARTH_TEXTURE_LIGHT = 'https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg';
  const EARTH_BUMP = 'https://unpkg.com/three-globe/example/img/earth-topology.png';

  /* ── Data source URLs ── */
  const GDACS_RSS = 'https://www.gdacs.org/xml/rss_7d.xml';
  const BBC_RSS   = 'https://feeds.bbci.co.uk/news/world/rss.xml';
  const BBC_TECH_RSS = 'https://feeds.bbci.co.uk/news/technology/rss.xml';
  const ACLED_API = 'https://api.acleddata.com/acled/read';
  const EONET_API = 'https://eonet.gsfc.nasa.gov/api/v3/events?days=7&status=open';
  const USGS_URL  = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson';
  const WHO_RSS   = 'https://www.who.int/rss-feeds/news-english.xml';
  const RELIEFWEB_RSS = 'https://reliefweb.int/updates?format=rss';
  const THN_RSS   = 'https://feeds.feedburner.com/TheHackersNews';

  const FETCH_TIMEOUT_MS = 15000;

  const PROXY_URLS = [
    (u) => `/api/proxy?url=${encodeURIComponent(u)}`,
    (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  ];

  const LS_KEY = 'gt-globe-v4';

  /* ── Categories ── */
  const CATEGORIES = {
    conflict:       { label: '冲突',      color: '#D05B4B', icon: '⚔️' },
    disaster:       { label: '灾害',      color: '#D89A4A', icon: '🔥' },
    macro:          { label: '宏观',      color: '#5A8FBD', icon: '🏦' },
    health:         { label: '健康',      color: '#4C9F70', icon: '⚕️' },
    climate:        { label: '气候',      color: '#7BA3A8', icon: '🌊' },
    tech:           { label: '科技',      color: '#A085C9', icon: '💻' },
    shipping:       { label: '航运',      color: '#C9A25E', icon: '🚢' },
    geopolitical:   { label: '地缘',      color: '#B85C7A', icon: '🌍' },
  };

  const TILE_LAYERS = {
    dark:    { label: 'Dark',    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',      options: { attribution: '&copy;OSM &copy;CartoDB', subdomains: 'abcd', maxZoom: 19 } },
    voyager: { label: 'Light',   url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', options: { attribution: '&copy;OSM &copy;CartoDB', subdomains: 'abcd', maxZoom: 19 } },
    osm:     { label: 'OSM',     url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',                   options: { attribution: '&copy;OpenStreetMap contributors', maxZoom: 19 } },
  };

  /* ── Static hotspot datasets ── */

  // 航运咽喉
  const SHIPPING_CHOKEPOINTS = [
    { id: 'hormuz',    name: '霍尔木兹海峡', lat: 26.50, lon: 56.30,  desc: '全球约 20% 原油运输通道，油轮通行密度最高。' },
    { id: 'malacca',   name: '马六甲海峡',   lat: 2.50,  lon: 101.50, desc: '东亚能源与贸易关键航道。' },
    { id: 'suez',      name: '苏伊士运河',   lat: 30.00, lon: 32.50,  desc: '欧亚海运捷径。' },
    { id: 'panama',    name: '巴拿马运河',   lat: 9.00,  lon: -79.50, desc: '美洲东西海岸航运枢纽。' },
    { id: 'bab',       name: '曼德海峡',     lat: 12.50, lon: 43.30,  desc: '红海-亚丁湾入口，中东-欧洲航线要道。' },
    { id: 'bosporus',  name: '博斯普鲁斯海峡', lat: 41.10, lon: 29.10, desc: '黑海-地中海唯一通道。' },
    { id: 'gibraltar', name: '直布罗陀海峡', lat: 36.00, lon: -5.50,  desc: '地中海-大西洋出入口。' },
    { id: 'dover',     name: '英吉利海峡',   lat: 51.00, lon: 1.50,   desc: '欧洲西北部最繁忙航道。' },
    { id: 'lombok',    name: '龙目海峡',     lat: -8.50, lon: 116.00, desc: '印尼群岛间深水航道。' },
    { id: 'taiwanstrait', name: '台湾海峡',  lat: 24.00, lon: 119.00, desc: '东亚半导体与能源运输关键水道。' },
    { id: 'korea',     name: '朝鲜海峡',     lat: 34.00, lon: 129.00, desc: '日韩能源与商品运输咽喉。' },
    { id: 'mozambique',name: '莫桑比克海峡', lat: -18.00, lon: 39.00, desc: '非洲东海岸-印度洋重要航线。' },
  ];

  // 地缘热点
  const GEOPOLITICAL_HOTSPOTS = [
    { id: 'ukraine',  name: '乌克兰',       lat: 49.00, lon: 31.00,  desc: '持续地缘冲突热点，影响欧洲能源与粮食安全。' },
    { id: 'gaza',     name: '加沙地带',     lat: 31.50, lon: 34.50,  desc: '中东冲突核心区域，波及红海航运。' },
    { id: 'sudan',    name: '苏丹',         lat: 15.00, lon: 30.00,  desc: '武装冲突与人道危机。' },
    { id: 'myanmar',  name: '缅甸',         lat: 21.00, lon: 96.00,  desc: '长期内战与难民危机。' },
    { id: 'yemen',    name: '也门',         lat: 15.00, lon: 48.00,  desc: '代理人冲突与红海航运威胁。' },
    { id: 'syria',    name: '叙利亚',       lat: 35.00, lon: 38.00,  desc: '多年内战与地缘博弈。' },
    { id: 'drc',      name: '刚果（金）',   lat: -2.00, lon: 23.00,  desc: '东部武装冲突热点，关键矿产供应风险。' },
    { id: 'ethiopia', name: '埃塞俄比亚',   lat: 9.00,  lon: 40.00,  desc: '地区冲突与流离失所。' },
    { id: 'taiwan',   name: '台海',         lat: 23.70, lon: 121.00, desc: '西太平洋地缘与半导体供应链焦点。' },
    { id: 'kashmir',  name: '克什米尔',     lat: 34.50, lon: 76.00,  desc: '南亚长期领土争议地区。' },
    { id: 'korean',   name: '朝鲜半岛',     lat: 38.00, lon: 127.00, desc: '东北亚安全与核议题热点。' },
    { id: 'mali',     name: '马里/萨赫勒',  lat: 17.00, lon: -4.00,  desc: '萨赫勒地区极端主义与政变风险。' },
    { id: 'iran',     name: '伊朗',         lat: 32.00, lon: 53.00,  desc: '中东核问题与代理人冲突焦点。' },
    { id: 'belarus',  name: '白俄罗斯/东欧边境', lat: 53.90, lon: 27.60, desc: '东欧地缘紧张前沿。' },
    { id: 'arctic',   name: '北极圈',       lat: 75.00, lon: 0.00,   desc: '资源、航道与军事博弈新前沿。' },
    { id: 'southchinasea', name: '南海',    lat: 12.00, lon: 115.00, desc: '海上贸易通道与领土主张争议。' },
    { id: 'nagorno',  name: '纳卡地区',     lat: 39.80, lon: 46.75,  desc: '高加索地区领土与族群冲突热点。' },
    { id: 'haiti',    name: '海地',         lat: 18.97, lon: -72.29, desc: '加勒比海国家治理与帮派暴力危机。' },
    { id: 'venezuela',name: '委内瑞拉',     lat: 6.42,  lon: -66.59, desc: '拉美政治、能源与难民危机。' },
    { id: 'libya',    name: '利比亚',       lat: 27.00, lon: 17.00,  desc: '北非能源出口国长期分裂冲突。' },
  ];

  // 金融/经济重镇
  const FINANCIAL_CENTERS = [
    { id: 'nyse',        name: '纽约金融区',   lat: 40.71, lon: -74.01, desc: '美股、美债与全球资本流动中心。' },
    { id: 'lse',         name: '伦敦金融城',   lat: 51.51, lon: -0.09,  desc: '欧洲外汇、债券与大宗商品交易中心。' },
    { id: 'hkex',        name: '香港中环',     lat: 22.28, lon: 114.16, desc: '亚洲股票、离岸人民币与 IPO 枢纽。' },
    { id: 'tokyo',       name: '东京金融区',   lat: 35.68, lon: 139.69, desc: '日本央行与亚洲债券市场风向标。' },
    { id: 'singapore',   name: '新加坡',       lat: 1.35,  lon: 103.82, desc: '东南亚大宗商品与外汇交易中心。' },
    { id: 'dxb',         name: '迪拜',         lat: 25.20, lon: 55.27,  desc: '中东贸易与金融中心。' },
    { id: 'frankfurt',   name: '法兰克福',     lat: 50.11, lon: 8.68,   desc: '欧洲央行总部与欧元区金融核心。' },
    { id: 'shanghai',    name: '上海陆家嘴',   lat: 31.23, lon: 121.50, desc: '中国股票、债券与商品期货核心。' },
    { id: 'mumbai',      name: '孟买 BKC',     lat: 19.06, lon: 72.87,  desc: '印度金融与衍生品交易中心。' },
    { id: 'sao-paulo',   name: '圣保罗',       lat: -23.55,lon: -46.64, desc: '拉美最大股票与外汇市场。' },
    { id: 'sydney',      name: '悉尼',         lat: -33.87,lon: 151.21, desc: '澳洲金融与大宗商品定价中心。' },
    { id: 'zurich',      name: '苏黎世',       lat: 47.37, lon: 8.54,   desc: '黄金、外汇与私人银行枢纽。' },
    { id: 'toronto',     name: '多伦多金融区', lat: 43.65, lon: -79.38, desc: '加拿大股票、矿业与金融中心。' },
    { id: 'johannesburg',name: '约翰内斯堡',   lat: -26.20,lon: 28.04,  desc: '非洲最大股票与黄金市场。' },
    { id: 'beijing',     name: '北京金融街',   lat: 39.90, lon: 116.40, desc: '中国央行与金融监管中枢。' },
    { id: 'zug',         name: '瑞士楚格',     lat: 47.17, lon: 8.52,   desc: '加密资产与大宗商品贸易中心。' },
  ];

  // 健康热点
  const HEALTH_HOTSPOTS = [
    { id: 'who-hq',      name: 'WHO 日内瓦总部',   lat: 46.23, lon: 6.14,   desc: '全球公共卫生协调中枢。' },
    { id: 'cdc-atlanta', name: '美国 CDC',         lat: 33.80, lon: -84.32, desc: '美国疾病控制与预防中心。' },
    { id: 'wuhan',       name: '武汉',             lat: 30.59, lon: 114.31, desc: '新发传染病监测关键节点。' },
    { id: 'kinshasa',    name: '金沙萨',           lat: -4.44, lon: 15.27,  desc: '非洲猴痘与埃博拉疫情热点区域。' },
    { id: 'lagos',       name: '拉各斯',           lat: 6.52,  lon: 3.38,   desc: '西非传染病监测与港口健康关口。' },
    { id: 'mumbai-health',name: '孟买',            lat: 19.08, lon: 72.88,  desc: '南亚高密度城市公共卫生压力点。' },
    { id: 'dhaka',       name: '达卡',             lat: 23.81, lon: 90.41,  desc: '气候变化与健康风险叠加区域。' },
    { id: 'cairo',       name: '开罗',             lat: 30.04, lon: 31.24,  desc: '中东与北非公共卫生枢纽。' },
    { id: 'sao-paulo-health', name: '圣保罗',      lat: -23.55,lon: -46.64, desc: '拉美寨卡、登革热与呼吸道病毒监测点。' },
    { id: 'jakarta',     name: '雅加达',           lat: -6.21, lon: 106.85, desc: '东南亚登革热与禽流感热点。' },
    { id: 'bangkok',     name: '曼谷',             lat: 13.76, lon: 100.50, desc: '东南亚旅游与传染病传播枢纽。' },
    { id: 'london-health',name: '伦敦',            lat: 51.51, lon: -0.13,  desc: '欧洲公共卫生研究与监测中心。' },
  ];

  // 气候/环境热点
  const CLIMATE_HOTSPOTS = [
    { id: 'amazon',      name: '亚马逊雨林',       lat: -3.46, lon: -62.22, desc: '热带雨林砍伐与碳汇退化热点。' },
    { id: 'congo-basin', name: '刚果盆地',         lat: -0.71, lon: 21.64,  desc: '非洲热带雨林与生物多样性热点。' },
    { id: 'barents',     name: '巴伦支海',         lat: 74.00, lon: 35.00,  desc: '北极海冰消退与能源开采前沿。' },
    { id: 'great-barrier',name: '大堡礁',          lat: -18.29,lon: 147.70, desc: '珊瑚白化与海洋温度上升指标区。' },
    { id: 'sahel-drought',name: '萨赫勒干旱带',    lat: 15.00, lon: 0.00,   desc: '荒漠化、干旱与粮食安全脆弱区。' },
    { id: 'indus-delta', name: '印度河三角洲',     lat: 24.80, lon: 67.00,  desc: '海平面上升与洪水复合型风险。' },
    { id: 'ganges',      name: '恒河平原',         lat: 25.50, lon: 85.00,  desc: '极端高温、洪水与人口密集交汇区。' },
    { id: 'california-fire',name: '加利福尼亚',    lat: 36.78, lon: -119.42,desc: '野火、干旱与极端天气频发区。' },
    { id: 'australia-fire',name: '澳大利亚东南部', lat: -35.00,lon: 149.00, desc: '丛林大火与极端高温热点。' },
    { id: 'mediterranean',name: '地中海',          lat: 35.00, lon: 18.00,  desc: '极端高温、山火与旅游经济风险。' },
    { id: 'gulf-mexico', name: '墨西哥湾',         lat: 25.00, lon: -90.00, desc: '飓风、油气设施与海运风险区。' },
    { id: 'philippines', name: '菲律宾',           lat: 13.00, lon: 122.00, desc: '台风、洪水与岛屿灾害高发区。' },
    { id: 'pakistan-flood',name: '巴基斯坦印度河流域', lat: 28.00, lon: 69.00, desc: '季风洪水与气候脆弱性热点。' },
    { id: 'horn-africa', name: '非洲之角',         lat: 8.00,  lon: 45.00,  desc: '长期干旱与饥荒风险区。' },
  ];

  // 科技/网络热点
  const TECH_HOTSPOTS = [
    { id: 'silicon-valley', name: '硅谷',          lat: 37.44, lon: -122.14, desc: '全球半导体、AI 与风险投资中心。' },
    { id: 'shenzhen',       name: '深圳',          lat: 22.54, lon: 114.06,  desc: '硬件制造、供应链与科技出口枢纽。' },
    { id: 'taipei',         name: '台北/新竹',     lat: 25.03, lon: 121.56,  desc: '半导体制造与先进制程核心。' },
    { id: 'seoul',          name: '首尔',          lat: 37.57, lon: 126.98,  desc: '存储芯片、显示面板与科技产业中心。' },
    { id: 'tokyo-tech',     name: '东京',          lat: 35.68, lon: 139.69,  desc: '电子、机器人和金融科技重镇。' },
    { id: 'tel-aviv',       name: '特拉维夫',      lat: 32.09, lon: 34.78,   desc: '网络安全与初创科技中心。' },
    { id: 'bangalore',      name: '班加罗尔',      lat: 12.97, lon: 77.59,   desc: '印度 IT 服务与软件出口中心。' },
    { id: 'dublin',         name: '都柏林',        lat: 53.35, lon: -6.26,   desc: '欧洲数据中心与跨国科技总部。' },
    { id: 'singapore-tech', name: '新加坡',        lat: 1.35,  lon: 103.82,  desc: '东南亚数据中心与海底光缆枢纽。' },
    { id: 'tallinn',        name: '塔林',          lat: 59.44, lon: 24.75,   desc: '北约网络防御中心与数字政府前沿。' },
    { id: 'ashburn',        name: '阿什本数据中心', lat: 39.04, lon: -77.49,  desc: '全球约 70% 互联网流量经过此地。' },
    { id: 'frankfurt-tech', name: '法兰克福',      lat: 50.11, lon: 8.68,    desc: '欧洲大陆互联网交换与数据中心枢纽。' },
    { id: 'moscow-cyber',   name: '莫斯科',        lat: 55.76, lon: 37.62,   desc: '国家级网络行动与信息安全焦点。' },
    { id: 'beijing-tech',   name: '北京中关村',    lat: 39.98, lon: 116.31,  desc: '中国 AI、半导体与互联网监管中心。' },
  ];

  const STATIC_MARKERS = (() => {
    const out = [];
    const add = (list, cat, source) => {
      list.forEach((m) => out.push({ ...m, cat, source: source || 'https://www.crisisgroup.org/' }));
    };
    add(SHIPPING_CHOKEPOINTS, 'shipping', 'https://www.marinetraffic.com/');
    add(GEOPOLITICAL_HOTSPOTS, 'geopolitical', 'https://www.crisisgroup.org/');
    add(FINANCIAL_CENTERS, 'macro', 'https://www.tradingeconomics.com/');
    add(HEALTH_HOTSPOTS, 'health', 'https://www.who.int/');
    add(CLIMATE_HOTSPOTS, 'climate', 'https://climate.nasa.gov/');
    add(TECH_HOTSPOTS, 'tech', 'https://thehackernews.com/');
    return out;
  })();

  // 3D 航运弧线（主要航线）
  const SHIPPING_LANES = [
    { from: [31.23, 121.50], to: [33.72, -118.25], name: '上海 → 洛杉矶/长滩', type: 'container' },
    { from: [31.23, 121.50], to: [51.95, 4.15],   name: '上海 → 鹿特丹',     type: 'container' },
    { from: [1.35,  103.82], to: [51.95, 4.15],   name: '新加坡 → 鹿特丹',   type: 'container' },
    { from: [1.35,  103.82], to: [25.20, 55.27],  name: '新加坡 → 杰贝阿里', type: 'container' },
    { from: [25.20, 55.27],  to: [51.95, 4.15],   name: '杰贝阿里 → 鹿特丹', type: 'container' },
    { from: [26.50, 56.30],  to: [51.95, 4.15],   name: '霍尔木兹 → 鹿特丹', type: 'tanker' },
    { from: [26.50, 56.30],  to: [1.35, 103.82],  name: '霍尔木兹 → 新加坡', type: 'tanker' },
    { from: [26.50, 56.30],  to: [40.71, -74.01], name: '霍尔木兹 → 纽约',   type: 'tanker' },
    { from: [30.00, 32.50],  to: [51.95, 4.15],   name: '苏伊士 → 鹿特丹',   type: 'mixed' },
    { from: [30.00, 32.50],  to: [31.23, 121.50], name: '苏伊士 → 上海',     type: 'mixed' },
    { from: [9.00, -79.50],  to: [40.71, -74.01], name: '巴拿马 → 纽约',     type: 'container' },
    { from: [9.00, -79.50],  to: [31.23, 121.50], name: '巴拿马 → 上海',     type: 'container' },
    { from: [-23.55,-46.64], to: [40.71, -74.01], name: '桑托斯 → 纽约',     type: 'bulk' },
    { from: [-33.87,151.21], to: [1.35, 103.82],  name: '悉尼 → 新加坡',     type: 'container' },
    { from: [35.68, 139.69], to: [33.72, -118.25],name: '东京 → 长滩',      type: 'container' },
    { from: [22.28, 114.16], to: [1.35, 103.82],  name: '香港 → 新加坡',     type: 'container' },
    { from: [22.54, 114.06], to: [33.72, -118.25],name: '深圳 → 长滩',      type: 'container' },
    { from: [1.35, 103.82],  to: [22.54, 114.06], name: '新加坡 → 深圳',     type: 'container' },
    { from: [51.95, 4.15],   to: [40.71, -74.01], name: '鹿特丹 → 纽约',     type: 'container' },
  ];

  const CHOKEPOINT_IDS = new Set(SHIPPING_CHOKEPOINTS.map((m) => m.id));

  // 模拟油轮
  function generateSimulatedTankers() {
    const arr = [];
    const lanes = [
      { base: [26.50, 56.30], name: '霍尔木兹' },
      { base: [2.50, 101.50], name: '马六甲' },
      { base: [12.50, 43.30], name: '曼德海峡' },
      { base: [30.00, 32.50], name: '苏伊士' },
      { base: [9.00, -79.50], name: '巴拿马' },
    ];
    lanes.forEach((lane, li) => {
      for (let i = 0; i < 8; i += 1) {
        arr.push({
          id: `tanker-${li}-${i}`,
          cat: 'shipping',
          name: `油轮 ${lane.name}#${i + 1}`,
          lat: lane.base[0] + (Math.random() - 0.5) * 1.6,
          lon: lane.base[1] + (Math.random() - 0.5) * 2.4,
          desc: `${lane.name}附近油轮（演示位置）。航向 ${Math.floor(Math.random() * 360)}°。`,
          source: 'https://www.marinetraffic.com/',
          ts: new Date(Date.now() - Math.floor(Math.random() * 86400000)).toISOString(),
        });
      }
    });
    return arr;
  }

  // 宏观经济事件日历（2026 年下半年示例）
  function generateMacroEvents() {
    const events = [
      { name: 'FOMC 利率决议', city: '华盛顿', lat: 38.90, lon: -77.03, dates: ['2026-07-29','2026-09-16','2026-11-04','2026-12-16'] },
      { name: '非农数据 NFP', city: '华盛顿', lat: 38.90, lon: -77.03, dates: ['2026-08-07','2026-09-04','2026-10-02','2026-11-06','2026-12-04'] },
      { name: 'ECB 利率决议', city: '法兰克福', lat: 50.11, lon: 8.68, dates: ['2026-07-23','2026-09-10','2026-10-22','2026-12-10'] },
      { name: 'BoE 利率决议', city: '伦敦', lat: 51.51, lon: -0.13, dates: ['2026-07-31','2026-09-18','2026-11-06','2026-12-18'] },
      { name: 'BoJ 利率决议', city: '东京', lat: 35.68, lon: 139.69, dates: ['2026-07-15','2026-09-24','2026-12-19'] },
      { name: 'PBOC 利率决议', city: '北京', lat: 39.90, lon: 116.40, dates: ['2026-08-20','2026-10-20','2026-12-20'] },
      { name: '澳洲联储决议', city: '悉尼', lat: -33.87, lon: 151.21, dates: ['2026-08-04','2026-09-15','2026-11-03'] },
      { name: 'G20 财长会议', city: '里约热内卢', lat: -22.90, lon: -43.17, dates: ['2026-07-18','2026-11-14'] },
      { name: 'OPEC+ 部长级会议', city: '维也纳', lat: 48.21, lon: 16.37, dates: ['2026-08-05','2026-12-03'] },
      { name: 'Jackson Hole 央行年会', city: '杰克逊霍尔', lat: 43.48, lon: -110.76, dates: ['2026-08-27'] },
    ];
    const out = [];
    events.forEach((e) => {
      e.dates.forEach((d) => {
        out.push({
          id: `macro-${e.name}-${d}`,
          cat: 'macro',
          name: `${e.name} · ${e.city}`,
          lat: e.lat, lon: e.lon,
          desc: `${e.name} (${d})，影响全球资产定价与资金流动。`,
          source: 'https://www.forexfactory.com/calendar',
          ts: `${d}T00:00:00Z`,
        });
      });
    });
    return out;
  }

  /* ── Shared utilities ── */
  function injectLink(href, rel, id) {
    if (id && document.getElementById(id)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const link = document.createElement('link');
      if (id) link.id = id;
      link.rel = rel;
      link.href = href;
      link.onload = resolve;
      link.onerror = () => reject(new Error('Failed to load ' + href));
      document.head.appendChild(link);
    });
  }

  function loadScript(src, check) {
    return new Promise((resolve, reject) => {
      if (typeof check === 'function' && check()) return resolve();
      if (typeof check === 'string' && typeof window[check] !== 'undefined') return resolve(window[check]);
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.crossOrigin = 'anonymous';
      s.onload = () => resolve(typeof check === 'string' ? window[check] : undefined);
      s.onerror = () => reject(new Error('Failed to load ' + src));
      document.head.appendChild(s);
    });
  }

  function loadLeaflet() {
    return Promise.all([
      injectLink(LEAFLET_CSS, 'stylesheet', 'gt-leaflet-css'),
      loadScript(LEAFLET_JS, 'L'),
    ]).then(([, L]) => L);
  }

  function loadGlobeGl() {
    return loadScript(GLOBE_GL_JS, 'Globe').then(() => window.Globe);
  }

  async function fetchWithProxy(url, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      try {
        const direct = await fetch(url, { signal: ctrl.signal, mode: 'cors' });
        if (direct.ok) return await direct.text();
      } catch (e) { /* fall through */ }
      for (const makeProxy of PROXY_URLS) {
        try {
          const r = await fetch(makeProxy(url), { signal: ctrl.signal });
          if (!r.ok) continue;
          const text = await r.text();
          try {
            const json = JSON.parse(text);
            if (json && typeof json.contents === 'string') return json.contents;
          } catch (parseErr) { /* raw */ }
          return text;
        } catch (e) { /* next */ }
      }
      throw new Error('fetch failed: ' + url);
    } finally { clearTimeout(t); }
  }

  async function tryFetchText(url) {
    try { return await fetchWithProxy(url, FETCH_TIMEOUT_MS); } catch (e) { return null; }
  }

  async function tryFetchJson(url) {
    const text = await tryFetchText(url);
    if (!text) return null;
    try { return JSON.parse(text); } catch (e) { return null; }
  }

  function formatTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso).slice(0, 16);
    return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function cssEscape(s) {
    if (typeof window !== 'undefined' && window.CSS && window.CSS.escape) return window.CSS.escape(s);
    return String(s).replace(/(["\\])/g, '\\$1');
  }

  function classifyByKeywords(title, desc) {
    const s = `${title || ''} ${desc || ''}`.toLowerCase();
    const maps = [
      { cat: 'conflict', k: ['war','conflict','attack','strike','bomb','missile','invasion','battle','ceasefire','rebel','militia','drone','airstrike','casualty','killed','clash'] },
      { cat: 'disaster', k: ['earthquake','tsunami','volcano','flood','landslide','avalanche','typhoon','hurricane','cyclone','tornado','disaster','magnitude','aftershock'] },
      { cat: 'health',   k: ['covid','pandemic','outbreak','virus','disease','who','health','vaccine','malaria','dengue','mpox','ebola','flu','infection'] },
      { cat: 'climate',  k: ['climate','wildfire','drought','heatwave','global warming','carbon','emission','sea level','ice','glacier','flood','deforestation'] },
      { cat: 'tech',     k: ['cyber','hack','breach','ransomware','malware','ai','semiconductor','chip','data center','cloud','outage','internet','tech'] },
      { cat: 'macro',    k: ['fed','ecb','boe','boj','pboc','rate','inflation','gdp','employment','nfp','fomc','opec','trade','tariff','budget','imf','world bank'] },
      { cat: 'shipping', k: ['ship','tanker','port','canal','strait','vessel','container','maritime','shipping','hormuz','suez','panama','malacca'] },
    ];
    for (const m of maps) {
      if (m.k.some((kw) => s.includes(kw))) return m.cat;
    }
    return null;
  }

  /* ── Parsers ── */
  function parseGDACS(xmlText) {
    const markers = [];
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlText, 'application/xml');
      doc.querySelectorAll('item').forEach((item) => {
        const title = item.querySelector('title')?.textContent || '';
        const link = item.querySelector('link')?.textContent || '';
        const desc = item.querySelector('description')?.textContent || '';
        const lat = parseFloat(item.querySelector('geo\:lat, lat')?.textContent || '');
        const lon = parseFloat(item.querySelector('geo\:long, long')?.textContent || '');
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
        const eventType = (item.querySelector('gdacs\:eventtype, eventtype')?.textContent || 'disaster').toLowerCase();
        const severity = item.querySelector('gdacs\:severity, severity')?.textContent || '';
        const date = item.querySelector('pubDate')?.textContent || '';
        markers.push({
          id: 'gdacs-' + Math.random().toString(36).slice(2, 8),
          cat: 'disaster', name: title, lat, lon,
          desc: desc.replace(/<[^>]+>/g, ' ').slice(0, 220),
          source: link, ts: date,
          meta: `${CATEGORIES.disaster.label} · ${eventType}${severity ? ' · ' + severity : ''} · ${formatTime(date)}`,
        });
      });
    } catch (e) { /* ignore */ }
    return markers;
  }

  function parseEonet(data) {
    const markers = [];
    if (!data || !Array.isArray(data.events)) return markers;
    data.events.forEach((ev) => {
      const geo = Array.isArray(ev.geometry) && ev.geometry[0];
      if (!geo || !Array.isArray(geo.coordinates)) return;
      const [lon, lat] = geo.coordinates;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      const catId = (ev.categories && ev.categories[0] && ev.categories[0].id) || '';
      const title = ev.title || '';
      let cat = 'disaster';
      if (['wildfires','volcanoes','earthquakes'].includes(catId)) cat = 'disaster';
      else if (['severeStorms','floods','drought','dustHaze'].includes(catId)) cat = 'climate';
      else if (catId === 'seaLakeIce') cat = 'climate';
      const date = ev.geometry[0].date || ev.date || '';
      markers.push({
        id: 'eonet-' + (ev.id || Math.random().toString(36).slice(2, 8)),
        cat, name: title, lat, lon,
        desc: `${title} · NASA EONET 监测事件`,
        source: ev.sources && ev.sources[0] ? ev.sources[0].url : 'https://eonet.gsfc.nasa.gov/',
        ts: date,
        meta: `${CATEGORIES[cat].label} · ${catId} · ${formatTime(date)}`,
      });
    });
    return markers;
  }

  function parseUsgs(data) {
    const markers = [];
    if (!data || !Array.isArray(data.features)) return markers;
    data.features.forEach((f) => {
      const coords = f.geometry && f.geometry.coordinates;
      if (!Array.isArray(coords)) return;
      const [lon, lat, depth] = coords;
      const props = f.properties || {};
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      markers.push({
        id: 'usgs-' + (props.code || Math.random().toString(36).slice(2, 8)),
        cat: 'disaster', name: props.title || '地震',
        lat, lon,
        desc: `${props.title || '地震'} · 深度 ${Number.isFinite(depth) ? depth + 'km' : '—'} · 震级 ${props.mag || '—'}`,
        source: props.url || 'https://earthquake.usgs.gov/',
        ts: props.time ? new Date(props.time).toISOString() : '',
        meta: `${CATEGORIES.disaster.label} · M${props.mag || ''} · ${formatTime(props.time)}`,
      });
    });
    return markers;
  }

  const NEWS_CITY_MAP = [
    { k: ['美国','华盛顿','纽约','US','Washington','New York'], lat: 40.71, lon: -74.01 },
    { k: ['中国','北京','上海','China','Beijing','Shanghai'], lat: 31.23, lon: 121.47 },
    { k: ['英国','伦敦','UK','London'], lat: 51.51, lon: -0.09 },
    { k: ['俄罗斯','莫斯科','Russia','Moscow'], lat: 55.76, lon: 37.62 },
    { k: ['乌克兰','Ukraine','Kyiv'], lat: 50.45, lon: 30.52 },
    { k: ['以色列','加沙','Gaza','Israel'], lat: 31.50, lon: 34.50 },
    { k: ['印度','新德里','India','Delhi'], lat: 28.61, lon: 77.21 },
    { k: ['日本','东京','Japan','Tokyo'], lat: 35.68, lon: 139.69 },
    { k: ['欧盟','布鲁塞尔','EU','Brussels'], lat: 50.85, lon: 4.35 },
    { k: ['中东','伊朗','Iran','Saudi','沙特','迪拜','Dubai','UAE','卡塔尔','Qatar'], lat: 24.71, lon: 46.68 },
    { k: ['韩国','首尔','Korea','Seoul'], lat: 37.57, lon: 126.98 },
    { k: ['巴西','圣保罗','Brazil','Sao Paulo'], lat: -23.55, lon: -46.64 },
    { k: ['非洲','南非','Sudan','Nigeria','Egypt','Congo','Ethiopia','Kenya'], lat: -1.00, lon: 20.00 },
    { k: ['东南亚','印尼','雅加达','Indonesia','Jakarta','泰国','曼谷','Thailand','Bangkok','越南','Vietnam'], lat: 4.00, lon: 110.00 },
    { k: ['澳洲','悉尼','Australia','Sydney'], lat: -33.87, lon: 151.21 },
    { k: ['加拿大','Toronto','Canada'], lat: 43.65, lon: -79.38 },
    { k: ['墨西哥','Mexico'], lat: 19.43, lon: -99.13 },
    { k: ['阿根廷','Argentina','Buenos Aires'], lat: -34.60, lon: -58.38 },
    { k: ['土耳其','Turkey','Istanbul'], lat: 39.93, lon: 32.85 },
    { k: ['巴基斯坦','Pakistan','Islamabad'], lat: 30.38, lon: 69.34 },
  ];

  function guessLocationFromText(text) {
    const s = String(text || '');
    return NEWS_CITY_MAP.find((c) => c.k.some((kw) => s.toLowerCase().includes(kw.toLowerCase())));
  }

  function parseNewsRss(xmlText, sourceName, sourceUrl, defaultCat) {
    const markers = [];
    try {
      const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
      Array.from(doc.querySelectorAll('item')).slice(0, 14).forEach((item) => {
        const title = item.querySelector('title')?.textContent || '';
        const link = item.querySelector('link')?.textContent || '';
        const date = item.querySelector('pubDate')?.textContent || '';
        const hit = guessLocationFromText(title);
        if (!hit) return;
        const cat = classifyByKeywords(title) || defaultCat;
        markers.push({
          id: `news-${sourceName}-${Math.random().toString(36).slice(2, 8)}`,
          cat, name: title, lat: hit.lat, lon: hit.lon,
          desc: title, source: link || sourceUrl, ts: date,
          meta: `${sourceName} · ${CATEGORIES[cat].label} · ${formatTime(date)}`,
        });
      });
    } catch (e) { /* ignore */ }
    return markers;
  }

  function parseWhoRss(xmlText) {
    const markers = [];
    try {
      const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
      Array.from(doc.querySelectorAll('item')).slice(0, 12).forEach((item) => {
        const title = item.querySelector('title')?.textContent || '';
        const link = item.querySelector('link')?.textContent || '';
        const date = item.querySelector('pubDate')?.textContent || '';
        const hit = guessLocationFromText(title);
        const lat = hit ? hit.lat : 46.23;
        const lon = hit ? hit.lon : 6.14;
        markers.push({
          id: 'who-' + Math.random().toString(36).slice(2, 8),
          cat: 'health', name: title, lat, lon,
          desc: title, source: link || 'https://www.who.int/', ts: date,
          meta: `WHO · ${formatTime(date)}`,
        });
      });
    } catch (e) { /* ignore */ }
    return markers;
  }

  function parseReliefWeb(xmlText) {
    const markers = [];
    try {
      const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
      Array.from(doc.querySelectorAll('item')).slice(0, 12).forEach((item) => {
        const title = item.querySelector('title')?.textContent || '';
        const link = item.querySelector('link')?.textContent || '';
        const date = item.querySelector('pubDate')?.textContent || '';
        const desc = item.querySelector('description')?.textContent || '';
        const hit = guessLocationFromText(title + ' ' + desc);
        if (!hit) return;
        const cat = classifyByKeywords(title + ' ' + desc) || 'disaster';
        markers.push({
          id: 'relief-' + Math.random().toString(36).slice(2, 8),
          cat, name: title, lat: hit.lat, lon: hit.lon,
          desc: desc.replace(/<[^>]+>/g, ' ').slice(0, 220),
          source: link || 'https://reliefweb.int/', ts: date,
          meta: `ReliefWeb · ${CATEGORIES[cat].label} · ${formatTime(date)}`,
        });
      });
    } catch (e) { /* ignore */ }
    return markers;
  }

  async function fetchACLED() {
    const params = new URLSearchParams({ limit: '50', format: 'json', fields: 'event_date,country,latitude,longitude,event_type,notes,fatalities' });
    const text = await tryFetchText(`${ACLED_API}?${params.toString()}`);
    if (!text) return [];
    try {
      const data = JSON.parse(text);
      const rows = Array.isArray(data.data) ? data.data : Array.isArray(data) ? data : [];
      return rows.slice(0, 30).map((r) => ({
        id: 'acled-' + Math.random().toString(36).slice(2, 8),
        cat: 'conflict', name: r.country || r.event_type || 'ACLED 事件',
        lat: parseFloat(r.latitude), lon: parseFloat(r.longitude),
        desc: `${r.event_type || '冲突'}${r.fatalities ? ' · 死亡人数 ' + r.fatalities : ''}${r.notes ? ' · ' + String(r.notes).slice(0, 120) : ''}`,
        source: 'https://acleddata.com/', ts: r.event_date || '',
        meta: `ACLED · ${r.event_type || '冲突'} · ${formatTime(r.event_date)}`,
      })).filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lon));
    } catch (e) { return []; }
  }

  async function fetchDisasters() {
    const xml = await tryFetchText(GDACS_RSS);
    return xml ? parseGDACS(xml) : [];
  }

  async function fetchNewsMarkers() {
    const xml = await tryFetchText(BBC_RSS);
    return xml ? parseNewsRss(xml, 'BBC', 'https://www.bbc.com/news/world', 'geopolitical') : [];
  }

  async function fetchTechNewsMarkers() {
    const [thn, bbctech] = await Promise.all([
      tryFetchText(THN_RSS),
      tryFetchText(BBC_TECH_RSS),
    ]);
    const out = [];
    if (thn) out.push(...parseNewsRss(thn, 'THN', 'https://thehackernews.com/', 'tech'));
    if (bbctech) out.push(...parseNewsRss(bbctech, 'BBC Tech', 'https://www.bbc.com/news/technology', 'tech'));
    return out;
  }

  async function fetchEonetMarkers() {
    const data = await tryFetchJson(EONET_API);
    return data ? parseEonet(data) : [];
  }

  async function fetchUsgsMarkers() {
    const data = await tryFetchJson(USGS_URL);
    return data ? parseUsgs(data) : [];
  }

  async function fetchWhoMarkers() {
    const xml = await tryFetchText(WHO_RSS);
    return xml ? parseWhoRss(xml) : [];
  }

  async function fetchReliefWebMarkers() {
    const xml = await tryFetchText(RELIEFWEB_RSS);
    return xml ? parseReliefWeb(xml) : [];
  }

  async function loadAllMarkers() {
    const sources = await Promise.all([
      fetchDisasters(),
      fetchNewsMarkers(),
      fetchACLED(),
      fetchEonetMarkers(),
      fetchUsgsMarkers(),
      fetchWhoMarkers(),
      fetchReliefWebMarkers(),
      fetchTechNewsMarkers(),
    ]);
    let merged = STATIC_MARKERS.slice()
      .concat(generateSimulatedTankers())
      .concat(generateMacroEvents());
    sources.forEach((arr) => { if (arr && arr.length) merged = merged.concat(arr); });

    const seen = new Set();
    return merged.filter((m) => {
      if (!Number.isFinite(m.lat) || !Number.isFinite(m.lon)) return false;
      const key = `${m.cat}-${(m.name || '').slice(0, 22)}-${Math.round(m.lat * 8)}-${Math.round(m.lon * 8)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /* ── Styles ── */
  function injectStyle() {
    if (document.getElementById('globe-style')) return;
    const style = document.createElement('style');
    style.id = 'globe-style';
    style.textContent = `
.globe-root { position:relative; width:100%; height:100%; overflow:hidden; border-radius:var(--radius-inner); background:var(--bg); display:flex; flex-direction:column; }
.globe-toolbar { position:relative; z-index:10; display:flex; align-items:center; gap:8px; flex-wrap:wrap; padding:8px 10px; border-bottom:1px solid var(--hairline); background:var(--surface); backdrop-filter:blur(6px); }
.globe-title { font-family:var(--font-serif); font-size:11px; letter-spacing:0.14em; color:var(--text-muted); text-transform:uppercase; white-space:nowrap; }
.globe-search { flex:1 1 120px; min-width:100px; max-width:220px; background:var(--bg-elevated); color:var(--text); border:1px solid var(--hairline); border-radius:10px; padding:5px 9px; font-size:11px; outline:none; }
.globe-search:focus { border-color:var(--acc-dim); }
.globe-btn { background:var(--bg-elevated); color:var(--text); border:1px solid var(--hairline); border-radius:10px; padding:5px 9px; font-size:10px; cursor:pointer; white-space:nowrap; transition:border-color .15s, background .15s, color .15s; }
.globe-btn:hover { border-color:var(--acc-dim); background:var(--surface-raised); }
.globe-btn.active { border-color:var(--acc); color:var(--acc); }
.globe-btn:disabled { opacity:.45; cursor:not-allowed; }
.globe-layer-group, .globe-tile-group, .globe-rotate-group { display:flex; gap:4px; align-items:center; }
.globe-rotate-group { display:none; }
.globe-rotate-group.visible { display:flex; }
.globe-status { margin-left:auto; font-size:9px; color:var(--text-dim); white-space:nowrap; }
.globe-body { flex:1 1 auto; display:flex; overflow:hidden; position:relative; }
.globe-map-wrap { flex:1 1 auto; position:relative; min-width:0; }
.globe-map { width:100%; height:100%; background:var(--bg); }
.globe-3d-wrap { width:100%; height:100%; background:var(--bg); }
.globe-sidebar { width:230px; flex:0 0 230px; border-left:1px solid var(--hairline); background:var(--surface); display:flex; flex-direction:column; overflow:hidden; }
.globe-sidebar-header { padding:8px 10px; font-size:10px; letter-spacing:0.1em; color:var(--text-muted); text-transform:uppercase; border-bottom:1px solid var(--hairline); display:flex; justify-content:space-between; align-items:center; }
.globe-sidebar-count { color:var(--acc); font-family:var(--font-mono); }
.globe-timeline { flex:1 1 auto; overflow-y:auto; padding:6px; }
.globe-timeline-item { padding:7px 8px; margin-bottom:5px; border-radius:10px; cursor:pointer; background:var(--bg-elevated); border:1px solid transparent; transition:border-color .15s, background .15s; }
.globe-timeline-item:hover { border-color:var(--acc-dim); background:var(--surface-raised); }
.globe-timeline-item.active { border-color:var(--acc); background:color-mix(in srgb, var(--acc) 8%, var(--surface-raised)); }
.globe-timeline-cat { font-size:9px; color:var(--text-dim); margin-bottom:2px; }
.globe-timeline-title { font-size:10px; color:var(--text); line-height:1.35; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.globe-timeline-meta { font-size:9px; color:var(--text-dim); margin-top:3px; }
.globe-detail { padding:8px 10px; border-top:1px solid var(--hairline); font-size:10px; color:var(--text-muted); line-height:1.4; min-height:44px; }
.globe-detail b { color:var(--text); }
.globe-detail a { color:var(--acc); text-decoration:none; }
.globe-detail a:hover { text-decoration:underline; }
.globe-empty { padding:16px; text-align:center; font-size:11px; color:var(--text-dim); }
.globe-legend-dot { display:inline-block; width:7px; height:7px; border-radius:50%; margin-right:4px; }
@media (max-width:720px){ .globe-sidebar { width:160px; flex:0 0 160px; } .globe-toolbar { gap:6px; } .globe-title { display:none; } }
/* Leaflet overrides */
.globe-map .leaflet-popup-content-wrapper { background:var(--surface-raised); color:var(--text); border:1px solid var(--hairline-strong); border-radius:var(--radius-sm); box-shadow:0 12px 36px rgba(0,0,0,.35); }
.globe-map .leaflet-popup-tip { background:var(--surface-raised); border:1px solid var(--hairline-strong); }
.globe-map .leaflet-popup-content { margin:10px 12px; font-size:11px; line-height:1.45; }
.globe-map .leaflet-popup-content h4 { margin:0 0 5px; font-size:12px; color:var(--text); font-family:var(--font-sans); }
.globe-map .leaflet-popup-content p { margin:0 0 6px; color:var(--text-muted); }
.globe-map .leaflet-popup-content a { color:var(--acc); text-decoration:none; font-size:10px; }
.globe-map .leaflet-popup-content a:hover { text-decoration:underline; }
.globe-map .leaflet-popup-content .globe-popup-meta { color:var(--text-dim); font-size:9px; margin-bottom:6px; }
.globe-map .leaflet-control-attribution { background:rgba(16,14,11,.75) !important; color:var(--text-dim) !important; font-size:9px !important; }
.globe-map .leaflet-control-attribution a { color:var(--text-dim) !important; }
.globe-map .leaflet-container { background:var(--bg); }
`;
    document.head.appendChild(style);
  }

  function injectPulseAnimation() {
    if (document.getElementById('globe-pulse-anim')) return;
    const s = document.createElement('style');
    s.id = 'globe-pulse-anim';
    s.textContent = '@keyframes g-globe-pulse { 0% { box-shadow: 0 0 0 0 rgba(201,162,94,0.55); } 70% { box-shadow: 0 0 0 8px rgba(201,162,94,0); } 100% { box-shadow: 0 0 0 0 rgba(201,162,94,0); } }';
    document.head.appendChild(s);
  }

  function buildPopupHtml(m) {
    const cat = CATEGORIES[m.cat] || CATEGORIES.geopolitical;
    return `<h4>${m.name}</h4><div class="globe-popup-meta">${cat.icon || ''} ${cat.label} · ${m.lat.toFixed(3)}, ${m.lon.toFixed(3)} · ${formatTime(m.ts)}</div><p>${m.desc || ''}</p>${m.source ? `<a href="${m.source}" target="_blank" rel="noopener">查看来源 →</a>` : ''}`;
  }

  function createIcon(L, color, pulse) {
    return L.divIcon({
      className: pulse ? 'globe-marker-pulse' : 'globe-marker-icon',
      html: `<span style="display:block;width:${pulse?12:10}px;height:${pulse?12:10}px;border-radius:50%;background:${color};box-shadow:${pulse?'0 0 0 0 '+color+';animation:g-globe-pulse 1.8s infinite':'0 0 8px '+color};border:1.5px solid var(--surface-raised,#221C14);"></span>`,
      iconSize: [pulse?14:12, pulse?14:12], iconAnchor: [pulse?7:6, pulse?7:6],
    });
  }

  /* ── Persistence ── */
  function loadSavedState() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return null;
  }

  function saveState(state) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  /* ── Main widget ── */
  window.GT_EXTRA_TOOLS['globe'] = {
    mount(el, setStatus) {
      injectStyle();
      injectPulseAnimation();
      setStatus('loading');

      const saved = loadSavedState() || {};
      const root = document.createElement('div');
      root.className = 'globe-root';
      const uid = Math.random().toString(36).slice(2, 9);
      const mapId = 'globe-map-' + uid;

      const catButtons = Object.entries(CATEGORIES).map(([key, c]) =>
        `<button class="globe-btn active" data-cat="${key}">${c.icon} ${c.label}</button>`
      ).join('');

      root.innerHTML = `
        <div class="globe-toolbar">
          <div class="globe-title">Global Events</div>
          <input class="globe-search" type="text" placeholder="搜索地点 / 事件..." id="globe-search-${uid}">
          <div class="globe-layer-group">${catButtons}</div>
          <div class="globe-tile-group" id="globe-tile-group-${uid}">
            <button class="globe-btn active" data-tile="dark">Dark</button>
            <button class="globe-btn" data-tile="voyager">Light</button>
            <button class="globe-btn" data-tile="osm">OSM</button>
          </div>
          <div class="globe-rotate-group" id="globe-rotate-group-${uid}">
            <button class="globe-btn" data-rotate="0">暂停</button>
            <button class="globe-btn" data-rotate="0.3">0.3x</button>
            <button class="globe-btn active" data-rotate="0.7">0.7x</button>
            <button class="globe-btn" data-rotate="1.5">1.5x</button>
          </div>
          <button class="globe-btn" id="globe-3d-btn-${uid}">3D</button>
          <div class="globe-status" id="globe-status-${uid}">加载中...</div>
        </div>
        <div class="globe-body">
          <div class="globe-map-wrap">
            <div class="globe-map" id="${mapId}"></div>
            <div class="globe-3d-wrap" id="globe-3d-${uid}" style="display:none"></div>
          </div>
          <div class="globe-sidebar">
            <div class="globe-sidebar-header">事件时间线 <span class="globe-sidebar-count" id="globe-count-${uid}">0</span></div>
            <div class="globe-timeline" id="globe-timeline-${uid}"></div>
            <div class="globe-detail" id="globe-detail-${uid}">悬停或点击事件查看详情</div>
          </div>
        </div>`;
      el.appendChild(root);

      const statusEl = root.querySelector('#globe-status-' + uid);
      const countEl = root.querySelector('#globe-count-' + uid);
      const timelineEl = root.querySelector('#globe-timeline-' + uid);
      const detailEl = root.querySelector('#globe-detail-' + uid);
      const searchEl = root.querySelector('#globe-search-' + uid);
      const btn3d = root.querySelector('#globe-3d-btn-' + uid);
      const mapWrap = root.querySelector('.globe-map');
      const d3Wrap = root.querySelector('#globe-3d-' + uid);
      const rotateGroup = root.querySelector('#globe-rotate-group-' + uid);

      let L = null, map = null, tileLayer = null, markersLayer = null;
      let globeApi = null;
      let currentMarkers = [], visibleMarkers = [];
      let activeCats = new Set(saved.activeCats || Object.keys(CATEGORIES));
      let mode3d = saved.mode3d === true;
      let rotateSpeed = Number(saved.rotateSpeed) || 0.7;
      let selectedId = null;
      let tileKey = saved.tileKey || 'dark';
      let lastSearch = saved.lastSearch || '';
      searchEl.value = lastSearch;

      function updateStatus(text) { statusEl.textContent = text; }

      function showDetail(m) {
        const cat = CATEGORIES[m.cat] || CATEGORIES.geopolitical;
        detailEl.innerHTML = `<b>${m.name}</b> <span style="color:${cat.color}">${cat.icon} ${cat.label}</span><br>${m.desc || ''}<br>${m.source ? `<a href="${m.source}" target="_blank" rel="noopener">来源 →</a>` : ''} <span style="color:var(--text-dim)">${formatTime(m.ts)} · ${m.lat.toFixed(2)}, ${m.lon.toFixed(2)}</span>`;
      }

      function setSelectedId(id) {
        selectedId = id;
        root.querySelectorAll('.globe-timeline-item').forEach((el) => {
          el.classList.toggle('active', el.dataset.id === id);
        });
      }

      function flyTo2D(m) {
        if (!map) return;
        map.flyTo([m.lat, m.lon], 6, { duration: 1.2 });
        if (m.leafletMarker) m.leafletMarker.openPopup();
      }

      function flyTo3D(m) {
        if (!globeApi) return;
        globeApi.pointOfView({ lat: m.lat, lng: m.lon, altitude: 1.6 }, 1200);
      }

      function renderTimeline(items) {
        timelineEl.innerHTML = '';
        if (!items.length) { timelineEl.innerHTML = '<div class="globe-empty">无匹配事件</div>'; countEl.textContent = '0'; return; }
        countEl.textContent = items.length;
        items.forEach((m) => {
          const cat = CATEGORIES[m.cat] || CATEGORIES.geopolitical;
          const div = document.createElement('div');
          div.className = 'globe-timeline-item';
          div.dataset.id = m.id;
          div.innerHTML = `<div class="globe-timeline-cat"><span class="globe-legend-dot" style="background:${cat.color};"></span>${cat.label}</div><div class="globe-timeline-title">${m.name}</div><div class="globe-timeline-meta">${formatTime(m.ts)} · ${m.lat.toFixed(1)}, ${m.lon.toFixed(1)}</div>`;
          div.addEventListener('mouseenter', () => showDetail(m));
          div.addEventListener('click', () => {
            setSelectedId(m.id);
            showDetail(m);
            if (!mode3d) flyTo2D(m);
            else flyTo3D(m);
          });
          timelineEl.appendChild(div);
        });
        if (selectedId) {
          const active = timelineEl.querySelector(`[data-id="${cssEscape(selectedId)}"]`);
          if (active) active.classList.add('active');
        }
      }

      function getFilteredMarkers() {
        const q = searchEl.value.trim().toLowerCase();
        return currentMarkers.filter((m) => {
          if (!activeCats.has(m.cat)) return false;
          if (!q) return true;
          return `${m.name} ${m.desc || ''} ${CATEGORIES[m.cat]?.label || ''}`.toLowerCase().includes(q);
        });
      }

      function getVisibleArcs() {
        if (!activeCats.has('shipping')) return [];
        const q = searchEl.value.trim().toLowerCase();
        if (!q) return SHIPPING_LANES;
        return SHIPPING_LANES.filter((a) => a.name.toLowerCase().includes(q));
      }

      function filterAndRender() {
        visibleMarkers = getFilteredMarkers();

        if (mode3d) {
          if (globeApi) {
            globeApi.pointsData(visibleMarkers).labelsData(visibleMarkers).arcsData(getVisibleArcs());
          }
        } else {
          if (markersLayer) {
            markersLayer.clearLayers();
            visibleMarkers.forEach((m) => {
              const cat = CATEGORIES[m.cat] || CATEGORIES.geopolitical;
              const isChoke = CHOKEPOINT_IDS.has(m.id) || m.id.startsWith('tanker-');
              const marker = L.marker([m.lat, m.lon], { icon: createIcon(L, cat.color, isChoke) });
              marker.bindPopup(buildPopupHtml(m));
              marker.on('popupopen', () => { m.leafletMarker = marker; showDetail(m); setSelectedId(m.id); });
              m.leafletMarker = marker;
              markersLayer.addLayer(marker);
            });
          }
        }
        const sorted = visibleMarkers.slice().sort((a, b) => {
          const ta = a.ts ? new Date(a.ts).getTime() : 0;
          const tb = b.ts ? new Date(b.ts).getTime() : 0;
          return tb - ta;
        });
        renderTimeline(sorted);
      }

      function setTileLayer(key) {
        if (!map || mode3d) return;
        if (tileLayer) map.removeLayer(tileLayer);
        const cfg = TILE_LAYERS[key];
        tileLayer = L.tileLayer(cfg.url, cfg.options);
        tileLayer.addTo(map);
        tileKey = key;
        root.querySelectorAll('[data-tile]').forEach((b) => b.classList.toggle('active', b.dataset.tile === key));
        persist();
      }

      function persist() {
        saveState({
          activeCats: Array.from(activeCats),
          mode3d,
          rotateSpeed,
          tileKey,
          lastSearch: searchEl.value,
        });
      }

      function isLightTheme() {
        return document.body.classList.contains('light-mode') || document.body.classList.contains('theme-pure-white');
      }

      function initLeaflet() {
        const mapEl = root.querySelector('#' + mapId);
        map = L.map(mapEl, { zoomControl: true, attributionControl: true }).setView([22, 10], 2.3);
        L.control.scale({ imperial: false }).addTo(map);
        setTileLayer(tileKey);
        markersLayer = L.layerGroup().addTo(map);
      }

      function setRotateSpeed(speed) {
        rotateSpeed = speed;
        rotateGroup.querySelectorAll('[data-rotate]').forEach((b) => {
          b.classList.toggle('active', parseFloat(b.dataset.rotate) === speed);
        });
        if (globeApi && globeApi.controls && globeApi.controls()) {
          globeApi.controls().autoRotate = speed > 0;
          globeApi.controls().autoRotateSpeed = speed;
        }
        persist();
      }

      function initGlobeGl() {
        if (globeApi) return;
        d3Wrap.innerHTML = '';
        const Globe = window.Globe;
        const catColor = (m) => (CATEGORIES[m.cat] || CATEGORIES.geopolitical).color;
        const light = isLightTheme();
        globeApi = Globe()(d3Wrap)
          .globeImageUrl(light ? EARTH_TEXTURE_LIGHT : EARTH_TEXTURE_DARK)
          .bumpImageUrl(EARTH_BUMP)
          .backgroundColor('rgba(0,0,0,0)')
          .showAtmosphere(true)
          .atmosphereColor(light ? '#4da6ff' : '#C9A25E')
          .pointsData(visibleMarkers)
          .pointLat((d) => d.lat)
          .pointLng((d) => d.lon)
          .pointColor(catColor)
          .pointAltitude(0.01)
          .pointRadius(0.28)
          .pointResolution(12)
          .pointLabel((d) => d.name)
          .labelsData(visibleMarkers)
          .labelLat((d) => d.lat)
          .labelLng((d) => d.lon)
          .labelText((d) => d.name)
          .labelSize(0.11)
          .labelColor(catColor)
          .labelDotRadius(0.10)
          .labelAltitude(0.02)
          .labelResolution(2)
          .labelIncludeDot(true)
          .arcsData(getVisibleArcs())
          .arcStartLat((d) => d.from[0])
          .arcStartLng((d) => d.from[1])
          .arcEndLat((d) => d.to[0])
          .arcEndLng((d) => d.to[1])
          .arcColor(() => ['#C9A25E', '#A87F3F'])
          .arcAltitude(0.18)
          .arcStroke(0.35)
          .arcDashLength(0.4)
          .arcDashGap(0.2)
          .arcDashAnimateTime(2000)
          .arcsTransitionDuration(600)
          .onPointHover((m) => { if (m) showDetail(m); })
          .onLabelHover((m) => { if (m) showDetail(m); })
          .onPointClick((m) => { if (m) { showDetail(m); setSelectedId(m.id); flyTo3D(m); } })
          .onLabelClick((m) => { if (m) { showDetail(m); setSelectedId(m.id); flyTo3D(m); } });

        if (globeApi.controls && globeApi.controls()) {
          globeApi.controls().autoRotate = rotateSpeed > 0;
          globeApi.controls().autoRotateSpeed = rotateSpeed;
          globeApi.controls().enableZoom = true;
        }
        setRotateSpeed(rotateSpeed);
      }

      function resizeGlobe() {
        if (!mode3d || !globeApi || !d3Wrap) return;
        const rect = d3Wrap.getBoundingClientRect();
        globeApi.width(rect.width).height(rect.height);
      }

      function setMode3d(on) {
        mode3d = on;
        btn3d.textContent = on ? '2D' : '3D';
        btn3d.classList.toggle('active', on);
        root.querySelector('.globe-tile-group').style.display = on ? 'none' : '';
        rotateGroup.classList.toggle('visible', on);
        if (on) {
          mapWrap.style.display = 'none';
          d3Wrap.style.display = 'block';
          if (!globeApi) initGlobeGl();
          else { filterAndRender(); resizeGlobe(); }
          setTimeout(resizeGlobe, 50);
        } else {
          d3Wrap.style.display = 'none';
          mapWrap.style.display = '';
          if (map) setTimeout(() => { map.invalidateSize(); filterAndRender(); }, 50);
        }
        persist();
      }

      // Category toggles
      root.querySelectorAll('[data-cat]').forEach((btn) => {
        const key = btn.dataset.cat;
        btn.classList.toggle('active', activeCats.has(key));
        btn.addEventListener('click', () => {
          activeCats.has(key) ? activeCats.delete(key) : activeCats.add(key);
          btn.classList.toggle('active', activeCats.has(key));
          filterAndRender();
          persist();
        });
      });

      // Tile toggles
      root.querySelectorAll('[data-tile]').forEach((btn) => {
        btn.addEventListener('click', () => setTileLayer(btn.dataset.tile));
      });

      // Rotate speed toggles
      rotateGroup.querySelectorAll('[data-rotate]').forEach((btn) => {
        btn.addEventListener('click', () => setRotateSpeed(parseFloat(btn.dataset.rotate)));
      });

      // 3D toggle
      btn3d.addEventListener('click', () => setMode3d(!mode3d));

      // Search
      let searchDebounce = 0;
      searchEl.addEventListener('input', () => {
        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(() => { filterAndRender(); persist(); }, 150);
      });

      // Load data + Leaflet, then optionally preload globe.gl
      Promise.all([loadLeaflet(), loadAllMarkers()])
        .then(([leaflet, markers]) => {
          L = leaflet;
          currentMarkers = markers;
          initLeaflet();
          filterAndRender();
          setStatus('online');
          updateStatus(`更新于 ${new Date().toLocaleTimeString('zh-CN', {hour:'2-digit', minute:'2-digit'})} · ${markers.length} 事件`);
          // 预加载 globe.gl；若用户保存了 3D 模式，需等库加载完成再切 3D
          const globePromise = loadGlobeGl().catch(() => null);
          if (mode3d) {
            globePromise.then((Globe) => {
              if (Globe) setMode3d(true);
              else { mode3d = false; persist(); }
            });
          }
        })
        .catch((err) => {
          console.warn('[globe] init failed:', err);
          updateStatus('初始化失败');
          setStatus('error');
        });

      let resizeObserver = null;
      if ('ResizeObserver' in window) {
        resizeObserver = new ResizeObserver(() => { if (mode3d) resizeGlobe(); else if (map) map.invalidateSize(); });
        resizeObserver.observe(root.querySelector('.globe-map-wrap'));
      }

      return function cleanup() {
        if (globeApi && globeApi._destructor) globeApi._destructor();
        if (map) { map.remove(); map = null; }
        if (resizeObserver) resizeObserver.disconnect();
        if (root.parentNode) root.parentNode.removeChild(root);
      };
    }
  };
})();
