/* 产业链关联 · 全球跨市场思维导图
 * 节点覆盖科技/半导体/汽车/能源/消费/材料/金融/加密货币/大宗商品，
 * 支持点击聚焦、搜索高亮、导入导出与本地自定义关系。
 * Registers as custom tool id 'supplychain' via window.GT_EXTRA_TOOLS. */
(function () {
  'use strict';

  window.GT_EXTRA_TOOLS = window.GT_EXTRA_TOOLS || {};

  const STORAGE_KEY = 'gt-supplychain-v2';

  const CATEGORIES = ['Tech', 'Semicon', 'EV', 'Auto', 'Energy', 'Consumer', 'Materials', 'Finance', 'Crypto', 'Commodity'];

  const TYPE_LABELS = {
    supplier: '上游供应商',
    customer: '下游客户',
    competitor: '竞争对手',
    partner: '合作伙伴',
  };
  const TYPE_COLORS = {
    supplier: 'var(--up)',
    customer: 'var(--down)',
    competitor: 'var(--warning)',
    partner: 'var(--info)',
  };
  const CATEGORY_COLORS = {
    Tech: '#C9A25E',
    Semicon: '#8FA3B8',
    EV: '#4C9F70',
    Auto: '#D89A4A',
    Energy: '#D05B4B',
    Consumer: '#A87FCC',
    Materials: '#6E9E7F',
    Finance: '#5B8DB8',
    Crypto: '#F2A900',
    Commodity: '#9C8F7A',
  };

  const CURATED_NODES = [
    // Tech
    { id: 'AAPL', name: 'Apple', category: 'Tech', url: 'https://www.apple.com/' },
    { id: 'GOOGL', name: 'Alphabet', category: 'Tech', url: 'https://abc.xyz/' },
    { id: 'MSFT', name: 'Microsoft', category: 'Tech', url: 'https://www.microsoft.com/' },
    { id: 'AMZN', name: 'Amazon', category: 'Tech', url: 'https://www.amazon.com/' },
    { id: 'META', name: 'Meta', category: 'Tech', url: 'https://about.meta.com/' },
    { id: 'IBM', name: 'IBM', category: 'Tech', url: 'https://www.ibm.com/' },
    { id: 'ORCL', name: 'Oracle', category: 'Tech', url: 'https://www.oracle.com/' },
    { id: 'CRM', name: 'Salesforce', category: 'Tech', url: 'https://www.salesforce.com/' },
    { id: 'ADBE', name: 'Adobe', category: 'Tech', url: 'https://www.adobe.com/' },
    { id: 'NFLX', name: 'Netflix', category: 'Tech', url: 'https://www.netflix.com/' },
    { id: 'TCEHY', name: 'Tencent', category: 'Tech', url: 'https://www.tencent.com/' },
    { id: 'BABA', name: 'Alibaba', category: 'Tech', url: 'https://www.alibaba.com/' },
    { id: 'JD', name: 'JD.com', category: 'Tech', url: 'https://www.jd.com/' },
    { id: 'SAMSUNG', name: 'Samsung', category: 'Tech', url: 'https://www.samsung.com/' },
    { id: 'FOXCONN', name: 'Foxconn', category: 'Tech', url: 'https://www.foxconn.com/' },
    { id: 'SONY', name: 'Sony', category: 'Tech', url: 'https://www.sony.com/' },
    { id: 'PANASONIC', name: 'Panasonic', category: 'Tech', url: 'https://www.panasonic.com/' },
    { id: 'LG', name: 'LG', category: 'Tech', url: 'https://www.lg.com/' },
    // Semicon
    { id: 'TSM', name: 'TSMC', category: 'Semicon', url: 'https://www.tsmc.com/' },
    { id: 'NVDA', name: 'Nvidia', category: 'Semicon', url: 'https://www.nvidia.com/' },
    { id: 'AMD', name: 'AMD', category: 'Semicon', url: 'https://www.amd.com/' },
    { id: 'INTC', name: 'Intel', category: 'Semicon', url: 'https://www.intel.com/' },
    { id: 'QCOM', name: 'Qualcomm', category: 'Semicon', url: 'https://www.qualcomm.com/' },
    { id: 'AVGO', name: 'Broadcom', category: 'Semicon', url: 'https://www.broadcom.com/' },
    { id: 'MU', name: 'Micron', category: 'Semicon', url: 'https://www.micron.com/' },
    { id: 'HYNIX', name: 'SK Hynix', category: 'Semicon', url: 'https://www.skhynix.com/' },
    { id: 'LRCX', name: 'Lam Research', category: 'Semicon', url: 'https://www.lamresearch.com/' },
    { id: 'AMAT', name: 'Applied Materials', category: 'Semicon', url: 'https://www.appliedmaterials.com/' },
    { id: 'KLAC', name: 'KLA', category: 'Semicon', url: 'https://www.kla.com/' },
    { id: 'ASML', name: 'ASML', category: 'Semicon', url: 'https://www.asml.com/' },
    { id: 'TEL', name: 'Tokyo Electron', category: 'Semicon', url: 'https://www.tel.com/' },
    { id: 'ADI', name: 'Analog Devices', category: 'Semicon', url: 'https://www.analog.com/' },
    { id: 'MCHP', name: 'Microchip', category: 'Semicon', url: 'https://www.microchip.com/' },
    { id: 'NXPI', name: 'NXP', category: 'Semicon', url: 'https://www.nxp.com/' },
    { id: 'STM', name: 'STMicro', category: 'Semicon', url: 'https://www.st.com/' },
    { id: 'ON', name: 'ON Semi', category: 'Semicon', url: 'https://www.onsemi.com/' },
    { id: 'SWKS', name: 'Skyworks', category: 'Semicon', url: 'https://www.skyworksinc.com/' },
    { id: 'QRVO', name: 'Qorvo', category: 'Semicon', url: 'https://www.qorvo.com/' },
    { id: 'COHU', name: 'Cohu', category: 'Semicon', url: 'https://www.cohu.com/' },
    { id: 'TER', name: 'Teradyne', category: 'Semicon', url: 'https://www.teradyne.com/' },
    // EV
    { id: 'TSLA', name: 'Tesla', category: 'EV', url: 'https://www.tesla.com/' },
    { id: 'BYD', name: 'BYD', category: 'EV', url: 'https://www.byd.com/' },
    { id: 'NIO', name: 'NIO', category: 'EV', url: 'https://www.nio.com/' },
    { id: 'XPEV', name: 'XPeng', category: 'EV', url: 'https://www.xpeng.com/' },
    { id: 'LI', name: 'Li Auto', category: 'EV', url: 'https://www.li.auto/' },
    { id: 'RIVN', name: 'Rivian', category: 'EV', url: 'https://rivian.com/' },
    { id: 'LCID', name: 'Lucid', category: 'EV', url: 'https://lucidmotors.com/' },
    { id: 'CATL', name: 'CATL', category: 'EV', url: 'https://www.catl.com/' },
    // Auto
    { id: 'GM', name: 'GM', category: 'Auto', url: 'https://www.gm.com/' },
    { id: 'F', name: 'Ford', category: 'Auto', url: 'https://www.ford.com/' },
    { id: 'VWAGY', name: 'Volkswagen', category: 'Auto', url: 'https://www.volkswagenag.com/' },
    { id: 'BMWYY', name: 'BMW', category: 'Auto', url: 'https://www.bmwgroup.com/' },
    { id: 'TM', name: 'Toyota', category: 'Auto', url: 'https://www.toyota.com/' },
    { id: 'HMC', name: 'Honda', category: 'Auto', url: 'https://global.honda/' },
    { id: 'HYMTF', name: 'Hyundai', category: 'Auto', url: 'https://www.hyundai.com/' },
    { id: 'TTM', name: 'Tata Motors', category: 'Auto', url: 'https://www.tatamotors.com/' },
    // Energy
    { id: 'XOM', name: 'ExxonMobil', category: 'Energy', url: 'https://corporate.exxonmobil.com/' },
    { id: 'CVX', name: 'Chevron', category: 'Energy', url: 'https://www.chevron.com/' },
    { id: 'SHEL', name: 'Shell', category: 'Energy', url: 'https://www.shell.com/' },
    { id: 'BP', name: 'BP', category: 'Energy', url: 'https://www.bp.com/' },
    { id: 'TTE', name: 'TotalEnergies', category: 'Energy', url: 'https://totalenergies.com/' },
    { id: 'COP', name: 'ConocoPhillips', category: 'Energy', url: 'https://www.conocophillips.com/' },
    { id: 'OXY', name: 'Occidental', category: 'Energy', url: 'https://www.oxy.com/' },
    { id: 'ENB', name: 'Enbridge', category: 'Energy', url: 'https://www.enbridge.com/' },
    { id: 'EQNR', name: 'Equinor', category: 'Energy', url: 'https://www.equinor.com/' },
    { id: 'ARAMCO', name: 'Saudi Aramco', category: 'Energy', url: 'https://www.aramco.com/' },
    { id: 'PTR', name: 'PetroChina', category: 'Energy', url: 'https://www.petrochina.com.cn/' },
    { id: 'SNP', name: 'Sinopec', category: 'Energy', url: 'http://www.sinopec.com/' },
    // Consumer
    { id: 'WMT', name: 'Walmart', category: 'Consumer', url: 'https://www.walmart.com/' },
    { id: 'COST', name: 'Costco', category: 'Consumer', url: 'https://www.costco.com/' },
    { id: 'HD', name: 'Home Depot', category: 'Consumer', url: 'https://www.homedepot.com/' },
    { id: 'MCD', name: "McDonald's", category: 'Consumer', url: 'https://www.mcdonalds.com/' },
    { id: 'NKE', name: 'Nike', category: 'Consumer', url: 'https://www.nike.com/' },
    { id: 'LULU', name: 'Lululemon', category: 'Consumer', url: 'https://www.lululemon.com/' },
    { id: 'KO', name: 'Coca-Cola', category: 'Consumer', url: 'https://www.coca-colacompany.com/' },
    { id: 'PEP', name: 'PepsiCo', category: 'Consumer', url: 'https://www.pepsico.com/' },
    { id: 'PG', name: 'P&G', category: 'Consumer', url: 'https://us.pg.com/' },
    { id: 'UL', name: 'Unilever', category: 'Consumer', url: 'https://www.unilever.com/' },
    { id: 'SBUX', name: 'Starbucks', category: 'Consumer', url: 'https://www.starbucks.com/' },
    { id: 'LVMH', name: 'LVMH', category: 'Consumer', url: 'https://www.lvmh.com/' },
    // Materials
    { id: 'FCX', name: 'Freeport-McMoRan', category: 'Materials', url: 'https://www.fcx.com/' },
    { id: 'NEM', name: 'Newmont', category: 'Materials', url: 'https://www.newmont.com/' },
    { id: 'GOLD', name: 'Barrick Gold', category: 'Materials', url: 'https://www.barrick.com/' },
    { id: 'ALB', name: 'Albemarle', category: 'Materials', url: 'https://www.albemarle.com/' },
    { id: 'SQM', name: 'SQM', category: 'Materials', url: 'https://www.sqm.com/' },
    // Finance
    { id: 'JPM', name: 'JPMorgan', category: 'Finance', url: 'https://www.jpmorgan.com/' },
    { id: 'BAC', name: 'Bank of America', category: 'Finance', url: 'https://www.bankofamerica.com/' },
    { id: 'GS', name: 'Goldman Sachs', category: 'Finance', url: 'https://www.goldmansachs.com/' },
    { id: 'MS', name: 'Morgan Stanley', category: 'Finance', url: 'https://www.morganstanley.com/' },
    { id: 'HSBC', name: 'HSBC', category: 'Finance', url: 'https://www.hsbc.com/' },
    // Crypto
    { id: 'BTC', name: 'Bitcoin', category: 'Crypto', url: 'https://bitcoin.org/' },
    { id: 'ETH', name: 'Ethereum', category: 'Crypto', url: 'https://ethereum.org/' },
    { id: 'COIN', name: 'Coinbase', category: 'Crypto', url: 'https://www.coinbase.com/' },
    { id: 'MSTR', name: 'MicroStrategy', category: 'Crypto', url: 'https://www.microstrategy.com/' },
    // Commodity / Macro
    { id: 'XAU', name: 'Gold', category: 'Commodity', url: 'https://www.gold.org/' },
    { id: 'WTI', name: 'WTI Oil', category: 'Commodity', url: 'https://www.eia.gov/petroleum/' },
    { id: 'DXY', name: 'US Dollar Index', category: 'Commodity', url: 'https://www.ice.com/indexdata/USDollarIndex' },
    { id: 'TNX', name: 'US 10Y Yield', category: 'Commodity', url: 'https://www.treasury.gov/' },
    { id: 'VIX', name: 'VIX', category: 'Commodity', url: 'https://www.cboe.com/tradable_products/vix/' },
  ];

  const CURATED_EDGES = [
    // Tech / Semicon supply chain
    ['TSM', 'AAPL', 'supplier', 'TSMC 代工 Apple A 系列 / M 系列芯片'],
    ['TSM', 'NVDA', 'supplier', 'TSMC 代工 Nvidia GPU 与 AI 加速器'],
    ['TSM', 'AMD', 'supplier', 'TSMC 代工 AMD CPU / GPU'],
    ['TSM', 'QCOM', 'supplier', 'TSMC 代工高通骁龙移动 SoC'],
    ['TSM', 'AVGO', 'supplier', 'TSMC 代工 Broadcom 定制芯片'],
    ['TSM', 'INTC', 'supplier', 'Intel 部分产品使用 TSMC 先进封装/代工'],
    ['TSM', 'SONY', 'supplier', 'TSMC 代工 Sony 图像传感器 / PS 芯片'],
    ['SAMSUNG', 'AAPL', 'supplier', 'Samsung 供应 OLED 屏幕与存储芯片'],
    ['SAMSUNG', 'NVDA', 'supplier', 'Samsung 供应 HBM 高带宽内存'],
    ['SAMSUNG', 'QCOM', 'supplier', 'Samsung 代工部分骁龙芯片'],
    ['SAMSUNG', 'SONY', 'supplier', 'Samsung 供应图像传感器与存储'],
    ['FOXCONN', 'AAPL', 'supplier', 'Foxconn 组装 iPhone、Mac 等主力产品'],
    ['FOXCONN', 'NVDA', 'supplier', 'Foxconn 代工 AI 服务器与 GPU 模块'],
    ['FOXCONN', 'AMD', 'supplier', 'Foxconn 组装显卡与服务器'],
    ['FOXCONN', 'SONY', 'supplier', 'Foxconn 代工 PS 主机'],
    ['QCOM', 'AAPL', 'supplier', '高通供应 iPhone 基带芯片'],
    ['QCOM', 'GM', 'supplier', '高通供应车载智能座舱芯片'],
    ['QCOM', 'TSLA', 'supplier', '高通供应车载信息娱乐芯片'],
    ['QCOM', 'SAMSUNG', 'supplier', '高通芯片用于三星 Galaxy'],
    ['AVGO', 'AAPL', 'supplier', 'Broadcom 供应 iPhone 射频与无线充电芯片'],
    ['AVGO', 'GOOGL', 'supplier', 'Broadcom 供应 Google 数据中心 TPU 互联芯片'],
    ['MU', 'AAPL', 'supplier', '美光供应内存与存储'],
    ['MU', 'NVDA', 'supplier', '美光供应 HBM / 显存'],
    ['MU', 'AMD', 'supplier', '美光供应 CPU/GPU 内存'],
    ['HYNIX', 'NVDA', 'supplier', 'SK Hynix 供应 HBM3 / HBM3e'],
    ['HYNIX', 'AAPL', 'supplier', 'SK Hynix 供应内存颗粒'],
    ['ASML', 'TSM', 'supplier', 'ASML 供应 EUV 光刻机'],
    ['ASML', 'SAMSUNG', 'supplier', 'ASML 供应 EUV 光刻机'],
    ['ASML', 'INTC', 'supplier', 'ASML 供应 High-NA / EUV 设备'],
    ['AMAT', 'TSM', 'supplier', '应用材料供应沉积/刻蚀/量测设备'],
    ['AMAT', 'SAMSUNG', 'supplier', '应用材料供应晶圆制造设备'],
    ['LRCX', 'TSM', 'supplier', 'Lam Research 供应刻蚀/CVD 设备'],
    ['LRCX', 'SAMSUNG', 'supplier', 'Lam Research 供应刻蚀设备'],
    ['KLAC', 'TSM', 'supplier', 'KLA 供应过程控制与量测设备'],
    ['TEL', 'TSM', 'supplier', 'Tokyo Electron 供应涂胶显影/沉积设备'],
    ['TEL', 'SAMSUNG', 'supplier', 'Tokyo Electron 供应半导体设备'],
    ['ADI', 'AAPL', 'supplier', 'ADI 供应电源管理 / 信号链芯片'],
    ['NXPI', 'AAPL', 'supplier', 'NXP 供应 UWB / NFC 芯片'],
    ['STM', 'AAPL', 'supplier', 'ST 供应 iPhone 传感器 / 电源芯片'],
    ['ON', 'AAPL', 'supplier', 'ON Semi 供应图像传感器'],
    ['SWKS', 'AAPL', 'supplier', 'Skyworks 供应射频前端'],
    ['QRVO', 'AAPL', 'supplier', 'Qorvo 供应射频模组'],
    ['COHU', 'TSM', 'supplier', 'Cohu 供应半导体测试分选设备'],
    ['TER', 'TSM', 'supplier', 'Teradyne 供应 SoC / 存储测试机'],
    // EV / Battery supply chain
    ['CATL', 'TSLA', 'supplier', 'CATL 供应磷酸铁锂电池'],
    ['CATL', 'NIO', 'supplier', 'CATL 供应动力电池'],
    ['CATL', 'XPEV', 'supplier', 'CATL 供应电池包'],
    ['CATL', 'LI', 'supplier', 'CATL 供应增程/纯电电池'],
    ['CATL', 'BMWYY', 'supplier', 'CATL 供应宝马动力电池'],
    ['CATL', 'VWAGY', 'supplier', 'CATL 供应大众 ID 系列电池'],
    ['CATL', 'GM', 'supplier', 'CATL 与通用 Ultium 电池合作'],
    ['BYD', 'TSLA', 'supplier', 'BYD 供应刀片电池传闻/实际供货'],
    ['PANASONIC', 'TSLA', 'supplier', '松下供应 2170 / 4680 电池'],
    ['LG', 'TSLA', 'supplier', 'LG 供应 2170 电池'],
    ['LG', 'GM', 'supplier', 'LG 与通用合资 Ultium Cells'],
    ['LG', 'HYMTF', 'supplier', 'LG 供应现代起亚电池'],
    ['NVDA', 'TSLA', 'supplier', 'Nvidia 供应 Tesla FSD / Dojo 芯片'],
    ['NVDA', 'BYD', 'supplier', 'Nvidia 供应自动驾驶 Orin 芯片'],
    ['NVDA', 'XPEV', 'supplier', 'Nvidia 供应智驾芯片'],
    ['ALB', 'TSLA', 'supplier', 'Albemarle 供应锂盐'],
    ['SQM', 'TSLA', 'supplier', 'SQM 供应碳酸锂'],
    ['ALB', 'BYD', 'supplier', 'Albemarle 向比亚迪供应锂'],
    ['SQM', 'BYD', 'supplier', 'SQM 向比亚迪供应锂'],
    ['FCX', 'TSLA', 'supplier', 'Freeport 供应铜用于电机与线束'],
    // Competitors
    ['AAPL', 'SAMSUNG', 'competitor', '智能手机 / 可穿戴 / 芯片竞争'],
    ['AAPL', 'GOOGL', 'competitor', 'iOS vs Android / 服务生态竞争'],
    ['MSFT', 'GOOGL', 'competitor', '云 / AI / 办公软件竞争'],
    ['MSFT', 'AMZN', 'competitor', 'Azure vs AWS 云竞争'],
    ['MSFT', 'ORCL', 'competitor', '数据库 / 云软件竞争'],
    ['AMZN', 'BABA', 'competitor', '电商与云全球竞争'],
    ['AMZN', 'JD', 'competitor', '电商物流竞争'],
    ['BABA', 'JD', 'competitor', '中国电商与物流竞争'],
    ['META', 'GOOGL', 'competitor', '数字广告与 AI 竞争'],
    ['META', 'TCEHY', 'competitor', '社交 / 游戏 / VR 竞争'],
    ['TCEHY', 'BABA', 'competitor', '中国科技生态竞争'],
    ['NVDA', 'AMD', 'competitor', 'GPU / AI 加速器竞争'],
    ['NVDA', 'INTC', 'competitor', 'AI / 数据中心芯片竞争'],
    ['AMD', 'INTC', 'competitor', 'CPU / 数据中心竞争'],
    ['TSM', 'SAMSUNG', 'competitor', '先进制程代工竞争'],
    ['TSM', 'INTC', 'competitor', '晶圆代工竞争'],
    ['QCOM', 'AVGO', 'competitor', '无线射频 / 定制芯片竞争'],
    ['QCOM', 'NXPI', 'competitor', '汽车半导体竞争'],
    ['MU', 'HYNIX', 'competitor', 'DRAM / HBM 竞争'],
    ['MU', 'SAMSUNG', 'competitor', '存储芯片竞争'],
    ['TSLA', 'BYD', 'competitor', '全球电动车销量竞争'],
    ['TSLA', 'NIO', 'competitor', '高端智能电动车竞争'],
    ['TSLA', 'XPEV', 'competitor', '智能电动车竞争'],
    ['TSLA', 'LI', 'competitor', '增程 / 纯电 SUV 竞争'],
    ['TSLA', 'RIVN', 'competitor', '电动皮卡 / SUV 竞争'],
    ['TSLA', 'LCID', 'competitor', '豪华电动车竞争'],
    ['BYD', 'NIO', 'competitor', '中国新能源市场竞争'],
    ['BYD', 'XPEV', 'competitor', '中国电动车竞争'],
    ['NIO', 'XPEV', 'competitor', '新势力竞争'],
    ['NIO', 'LI', 'competitor', '新势力 SUV 竞争'],
    ['XPEV', 'LI', 'competitor', '新势力竞争'],
    ['RIVN', 'LCID', 'competitor', '美国新势力电动车竞争'],
    ['GM', 'F', 'competitor', '美国传统车企竞争'],
    ['GM', 'VWAGY', 'competitor', '全球汽车电动化竞争'],
    ['GM', 'TM', 'competitor', '全球销量与混动竞争'],
    ['F', 'VWAGY', 'competitor', '传统车企转型竞争'],
    ['VWAGY', 'BMWYY', 'competitor', '德系豪华车竞争'],
    ['VWAGY', 'TM', 'competitor', '全球销量竞争'],
    ['BMWYY', 'TM', 'competitor', '豪华 / 混动技术竞争'],
    ['TM', 'HMC', 'competitor', '日系混动竞争'],
    ['HMC', 'HYMTF', 'competitor', '日韩汽车竞争'],
    ['XOM', 'CVX', 'competitor', '美国综合油气竞争'],
    ['XOM', 'SHEL', 'competitor', '全球油气巨头竞争'],
    ['XOM', 'BP', 'competitor', '油气上下游竞争'],
    ['XOM', 'TTE', 'competitor', '综合能源竞争'],
    ['CVX', 'SHEL', 'competitor', '全球 LNG / 油气竞争'],
    ['SHEL', 'BP', 'competitor', '欧洲综合能源竞争'],
    ['SHEL', 'TTE', 'competitor', '欧洲能源转型竞争'],
    ['BP', 'TTE', 'competitor', '欧洲综合能源竞争'],
    ['ARAMCO', 'XOM', 'competitor', '全球最大油气公司竞争'],
    ['ARAMCO', 'PTR', 'competitor', '国家石油巨头竞争'],
    ['PTR', 'SNP', 'competitor', '中国炼化一体化竞争'],
    ['WMT', 'COST', 'competitor', '仓储零售竞争'],
    ['WMT', 'AMZN', 'competitor', '零售与电商竞争'],
    ['NKE', 'LULU', 'competitor', '运动服饰竞争'],
    ['KO', 'PEP', 'competitor', '饮料双寡头竞争'],
    ['PG', 'UL', 'competitor', '日化快消竞争'],
    ['ALB', 'SQM', 'competitor', '锂盐供应商竞争'],
    ['JPM', 'BAC', 'competitor', '美国银行竞争'],
    ['GS', 'MS', 'competitor', '投行竞争'],
    ['COIN', 'MSTR', 'competitor', '加密资产暴露方式竞争'],
    // Partners / strategic alliances
    ['AAPL', 'FOXCONN', 'partner', 'iPhone 主力代工战略合作伙伴'],
    ['TSM', 'ASML', 'partner', 'EUV 设备联合研发与供应'],
    ['NVDA', 'MSFT', 'partner', 'Azure AI 基础设施深度整合'],
    ['NVDA', 'AMZN', 'partner', 'AWS AI / 云计算芯片合作'],
    ['NVDA', 'GOOGL', 'partner', 'Google Cloud TPU 与 GPU 合作'],
    ['NVDA', 'META', 'partner', 'Meta AI 训练集群 GPU 供应'],
    ['SAMSUNG', 'QCOM', 'partner', '芯片代工与 Galaxy 芯片合作'],
    ['TSLA', 'PANASONIC', 'partner', '内华达超级工厂电池合资'],
    ['GM', 'LG', 'partner', 'Ultium Cells 电池合资企业'],
    ['BYD', 'TM', 'partner', '丰田与比亚迪电动车平台合作'],
    ['BYD', 'HYMTF', 'partner', '现代起亚与比亚迪电池合作传闻'],
    ['CATL', 'VWAGY', 'partner', '大众标准电芯合作'],
    ['CATL', 'BMWYY', 'partner', '宝马动力电池长期合作'],
    ['XOM', 'SHEL', 'partner', '全球 LNG 项目合作'],
    ['TCEHY', 'NFLX', 'partner', '腾讯内容与平台分发合作'],
    ['JPM', 'GS', 'partner', '国债承销 / 交易对手合作'],
    // Cross-asset / macro relationships
    ['WTI', 'XOM', 'partner', '油价影响油气巨头盈利与估值'],
    ['WTI', 'CVX', 'partner', '油价与 Chevron 上下游业绩联动'],
    ['WTI', 'SHEL', 'partner', '油价与 Shell 综合收益联动'],
    ['WTI', 'BP', 'partner', '油价与 BP 收益联动'],
    ['WTI', 'ARAMCO', 'partner', '油价决定沙特阿美产量与收入'],
    ['XAU', 'NEM', 'supplier', 'Newmont 等矿业公司向市场供应黄金'],
    ['XAU', 'GOLD', 'supplier', 'Barrick 开采并供应黄金'],
    ['XAU', 'FCX', 'supplier', 'Freeport 副产品金供应'],
    ['DXY', 'EURUSD', 'competitor', '美元指数与欧元美元通常反向'],
    ['DXY', 'XAU', 'competitor', '美元强势通常压制黄金'],
    ['DXY', 'BTC', 'competitor', '美元流动性影响比特币定价'],
    ['TNX', 'JPM', 'partner', '利率水平影响银行净息差'],
    ['TNX', 'BAC', 'partner', '利率影响美国银行盈利能力'],
    ['TNX', 'XAU', 'competitor', '利率上行通常压制无息资产黄金'],
    ['VIX', 'SPX', 'competitor', 'VIX 与标普 500 通常反向'],
    ['VIX', 'NDX', 'competitor', 'VIX 与纳斯达克通常反向'],
    ['BTC', 'COIN', 'customer', 'Coinbase 依赖比特币交易收入'],
    ['BTC', 'MSTR', 'customer', 'MicroStrategy 持有大量比特币作为储备'],
    ['ETH', 'COIN', 'customer', 'Coinbase 依赖以太坊交易收入'],
  ];

  const esc = (s) => String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;' }[c]));
  const norm = (s) => String(s).trim().toUpperCase();

  function readCustom() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { nodes: [], edges: [] }; } catch (e) { return { nodes: [], edges: [] }; }
  }
  function writeCustom(data) { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }

  function buildGraph(filterCat) {
    const custom = readCustom();
    const nodeMap = new Map();
    function addNode(n, isCustom) {
      const id = norm(n.id);
      if (!id || nodeMap.has(id)) return;
      nodeMap.set(id, { id, name: n.name || id, category: n.category || 'Tech', url: n.url || '', desc: n.desc || '', custom: isCustom });
    }
    CURATED_NODES.forEach((n) => addNode(n, false));
    custom.nodes.forEach((n) => addNode(n, true));

    const edges = [];
    function addEdge(e, isCustom) {
      const s = norm(e.source), t = norm(e.target);
      if (!s || !t || s === t) return;
      if (!nodeMap.has(s)) nodeMap.set(s, { id: s, name: s, category: e.category || 'Tech', url: '', desc: '', custom: true });
      if (!nodeMap.has(t)) nodeMap.set(t, { id: t, name: t, category: e.category || 'Tech', url: '', desc: '', custom: true });
      edges.push({ source: s, target: t, type: e.type || 'partner', desc: e.desc || '', custom: isCustom });
    }
    CURATED_EDGES.forEach(([s, t, type, desc]) => addEdge({ source: s, target: t, type, desc }, false));
    custom.edges.forEach((e) => addEdge(e, true));

    const allNodes = Array.from(nodeMap.values());
    const visibleNodes = filterCat === 'All' ? allNodes : allNodes.filter((n) => n.category === filterCat);
    const visibleIds = new Set(visibleNodes.map((n) => n.id));
    const visibleEdges = edges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target));
    return { nodes: visibleNodes, edges: visibleEdges, allNodes, allEdges: edges };
  }

  function injectStyle() {
    if (document.getElementById('supplychain-style')) return;
    const style = document.createElement('style');
    style.id = 'supplychain-style';
    style.textContent = `
.sc-root { display:flex; flex-direction:column; gap:8px; height:100%; }
.sc-head { display:flex; justify-content:space-between; align-items:center; gap:8px; font-size:9px; letter-spacing:0.12em; color:var(--text-muted); text-transform:uppercase; }
.sc-head-right { font-family:var(--font-mono); color:var(--text-dim); }
.sc-controls { display:grid; grid-template-columns:1fr auto auto; gap:6px; align-items:end; }
.sc-search, .sc-select { background:rgba(237,230,218,0.04); border:1px solid var(--hairline); border-radius:8px; color:var(--text); font-family:var(--font-mono); font-size:11px; padding:7px 9px; outline:none; }
.sc-search:focus, .sc-select:focus { border-color:var(--acc-dim); background:rgba(237,230,218,0.07); }
.sc-search::placeholder { color:var(--text-dim); }
.sc-graph-wrap { flex:1; min-height:120px; border:1px solid var(--hairline); border-radius:10px; background:rgba(22,17,11,0.22); position:relative; overflow:hidden; }
.sc-svg { width:100%; height:100%; display:block; }
.sc-svg line { transition:opacity .2s; }
.sc-node { cursor:pointer; }
.sc-node circle { transition:r .2s, stroke .2s; }
.sc-node:hover circle { stroke:var(--acc); }
.sc-node text { pointer-events:none; font-family:var(--font-mono); font-size:9px; fill:var(--text); }
.sc-node.dim { opacity:.2; }
.sc-legend { position:absolute; top:6px; left:6px; display:flex; flex-wrap:wrap; gap:6px; font-size:9px; color:var(--text-muted); font-family:var(--font-mono); pointer-events:none; }
.sc-legend span { display:flex; align-items:center; gap:3px; }
.sc-legend i { width:10px; height:2px; border-radius:1px; display:inline-block; }
.sc-focus { font-size:11px; color:var(--text); display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.sc-focus b { font-family:var(--font-mono); color:var(--acc); font-size:12px; }
.sc-focus a { color:var(--acc); font-size:10px; }
.sc-tag { font-size:9px; text-transform:uppercase; letter-spacing:0.08em; padding:1px 7px; border-radius:999px; border:1px solid var(--hairline); color:var(--text-muted); }
.sc-cards { display:grid; grid-template-columns:repeat(2, 1fr); gap:6px; }
.sc-card { border:1px solid var(--hairline); border-radius:8px; padding:7px 8px; background:rgba(237,230,218,0.02); }
.sc-card-title { font-size:9px; letter-spacing:0.1em; text-transform:uppercase; margin-bottom:5px; display:flex; justify-content:space-between; align-items:center; }
.sc-card-title span { color:var(--text-dim); font-family:var(--font-mono); }
.sc-card-chips { display:flex; flex-wrap:wrap; gap:4px; }
.sc-chip { font-size:9px; font-family:var(--font-mono); padding:2px 7px; border-radius:999px; border:1px solid var(--hairline); background:transparent; color:var(--text-muted); cursor:pointer; transition:all .15s; }
.sc-chip:hover { border-color:var(--acc-dim); color:var(--acc); background:var(--acc-glow); }
.sc-custom { border-top:1px solid var(--hairline); padding-top:8px; }
.sc-custom-title { font-size:9px; color:var(--text-dim); letter-spacing:0.1em; text-transform:uppercase; margin-bottom:5px; }
.sc-custom-grid { display:grid; grid-template-columns:1fr 1fr auto auto auto; gap:5px; align-items:end; }
.sc-custom-grid input, .sc-custom-grid select { background:rgba(237,230,218,0.04); border:1px solid var(--hairline); border-radius:6px; color:var(--text); font-family:var(--font-mono); font-size:10px; padding:6px 7px; outline:none; }
.sc-foot { display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; }
.sc-foot .tool-btn { font-size:10px; padding:5px 10px; }
.sc-src { font-size:9px; color:var(--text-dim); letter-spacing:0.06em; }
.sc-hint { font-size:10px; color:var(--text-dim); text-align:center; padding:8px; }
@media (max-width:520px){ .sc-controls { grid-template-columns:1fr; } .sc-custom-grid { grid-template-columns:1fr 1fr; } .sc-cards { grid-template-columns:1fr; } }
`;
    document.head.appendChild(style);
  }

  function roleOf(edge, focusId) {
    if (edge.type === 'supplier') { if (edge.target === focusId) return 'supplier'; if (edge.source === focusId) return 'customer'; }
    if (edge.type === 'customer') { if (edge.source === focusId) return 'supplier'; if (edge.target === focusId) return 'customer'; }
    return edge.type;
  }

  // Mind-map layout: center focus, suppliers-left, customers-right, partners-top, competitors-bottom, others ring
  function computeLayout(nodes, edges, focusId, w, h) {
    const pad = 34;
    const availW = Math.max(w - pad * 2, 80);
    const availH = Math.max(h - pad * 2, 80);
    const cx = w / 2, cy = h / 2;
    const R = Math.min(availW, availH) * 0.30;
    const R2 = Math.min(availW, availH) * 0.48;
    const positions = new Map();
    if (!focusId || !nodes.some((n) => n.id === focusId)) {
      const count = nodes.length;
      nodes.forEach((n, i) => {
        const angle = (i / Math.max(1, count)) * Math.PI * 2 - Math.PI / 2;
        positions.set(n.id, { x: cx + Math.cos(angle) * R, y: cy + Math.sin(angle) * R });
      });
      return positions;
    }
    positions.set(focusId, { x: cx, y: cy });
    const neighborIds = new Set();
    edges.forEach((e) => { if (e.source === focusId) neighborIds.add(e.target); if (e.target === focusId) neighborIds.add(e.source); });
    const buckets = { supplier: [], customer: [], competitor: [], partner: [] };
    neighborIds.forEach((id) => {
      const edge = edges.find((e) => (e.source === focusId && e.target === id) || (e.target === focusId && e.source === id));
      if (!edge) return;
      const role = roleOf(edge, focusId);
      if (buckets[role]) buckets[role].push(id);
    });
    const sectors = {
      supplier: { center: Math.PI, spread: Math.PI * 0.35 },
      customer: { center: 0, spread: Math.PI * 0.35 },
      partner: { center: -Math.PI / 2, spread: Math.PI * 0.25 },
      competitor: { center: Math.PI / 2, spread: Math.PI * 0.25 },
    };
    Object.entries(buckets).forEach(([role, list]) => {
      const sec = sectors[role];
      const n = list.length;
      list.forEach((id, i) => {
        const t = n === 1 ? 0 : i / (n - 1);
        const angle = sec.center - sec.spread + 2 * sec.spread * t;
        positions.set(id, { x: cx + Math.cos(angle) * R, y: cy + Math.sin(angle) * R });
      });
    });
    const others = nodes.filter((n) => n.id !== focusId && !neighborIds.has(n.id));
    others.forEach((n, i) => {
      const angle = (i / Math.max(1, others.length)) * Math.PI * 2 - Math.PI / 2;
      positions.set(n.id, { x: cx + Math.cos(angle) * R2, y: cy + Math.sin(angle) * R2 });
    });
    return positions;
  }

  function renderGraph(state, svgEl, wrapEl) {
    const rect = wrapEl.getBoundingClientRect();
    const w = Math.max(rect.width, 200), h = Math.max(rect.height, 120);
    svgEl.setAttribute('viewBox', `0 0 ${w.toFixed(0)} ${h.toFixed(0)}`);
    const { nodes, edges } = state.graph;
    state.positions = computeLayout(nodes, edges, state.focus, w, h);
    const highlight = state.highlight ? norm(state.highlight) : null;

    const parts = [];
    parts.push(`<defs><marker id="sc-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 L2,4 z" fill="var(--text-dim)" /></marker></defs>`);

    edges.forEach((e) => {
      const p1 = state.positions.get(e.source), p2 = state.positions.get(e.target);
      if (!p1 || !p2) return;
      const color = TYPE_COLORS[e.type] || 'var(--text-dim)';
      const dash = e.type === 'competitor' ? 'stroke-dasharray="3,3"' : e.type === 'partner' ? 'stroke-dasharray="6,4"' : '';
      const directed = e.type === 'supplier' || e.type === 'customer';
      const marker = directed ? ' marker-end="url(#sc-arrow)"' : '';
      const dim = highlight && e.source !== highlight && e.target !== highlight ? ' opacity="0.15"' : ' opacity="0.75"';
      parts.push(`<line x1="${p1.x.toFixed(1)}" y1="${p1.y.toFixed(1)}" x2="${p2.x.toFixed(1)}" y2="${p2.y.toFixed(1)}" stroke="${color}" stroke-width="1.2" ${dash}${marker}${dim}><title>${esc(e.source)} → ${esc(e.target)} · ${TYPE_LABELS[e.type] || e.type}${e.desc ? ' · ' + esc(e.desc) : ''}</title></line>`);
    });

    nodes.forEach((n) => {
      const p = state.positions.get(n.id);
      if (!p) return;
      const isFocus = n.id === state.focus;
      const isHighlight = highlight && n.id === highlight;
      const r = isFocus ? 11 : 6;
      const fill = CATEGORY_COLORS[n.category] || 'var(--acc)';
      const stroke = isFocus || isHighlight ? 'var(--text)' : 'var(--surface-raised)';
      const strokeWidth = isFocus ? 2.5 : 1.5;
      const dimClass = highlight && n.id !== highlight ? ' dim' : '';
      parts.push(`<g class="sc-node${dimClass}" data-node="${esc(n.id)}" transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)})">` +
        `<circle r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" />` +
        `<text y="${r + 12}" text-anchor="middle">${esc(n.id)}</text>` +
        `<title>${esc(n.name)} · ${esc(n.category)}${n.desc ? ' · ' + esc(n.desc) : ''}</title></g>`);
    });
    svgEl.innerHTML = parts.join('');
  }

  function renderCards(state, cardsEl, focusInfoEl) {
    if (!state.focus) {
      cardsEl.innerHTML = '';
      focusInfoEl.innerHTML = '<span class="sc-hint">点击节点或搜索代码以查看产业链关系 · 节点圆圈聚焦，关系卡片带链接</span>';
      return;
    }
    const node = state.graph.nodes.find((n) => n.id === state.focus) || state.graph.allNodes.find((n) => n.id === state.focus);
    if (!node) {
      focusInfoEl.innerHTML = '<span class="sc-hint">当前筛选下未显示该节点</span>';
      cardsEl.innerHTML = '';
      return;
    }
    const link = node.url ? `<a href="${esc(node.url)}" target="_blank" rel="noopener">官网 →</a>` : '';
    focusInfoEl.innerHTML = `<b>${esc(node.id)}</b> <span>${esc(node.name)}</span><span class="sc-tag">${esc(node.category)}</span>${link}`;

    const groups = { supplier: [], customer: [], competitor: [], partner: [] };
    state.graph.edges.forEach((e) => {
      if (e.source !== state.focus && e.target !== state.focus) return;
      const other = e.source === state.focus ? e.target : e.source;
      const role = roleOf(e, state.focus);
      if (groups[role]) groups[role].push({ id: other, desc: e.desc });
    });
    const hasAny = Object.values(groups).some((arr) => arr.length);
    if (!hasAny) { cardsEl.innerHTML = '<div class="sc-hint">暂无记录的关系</div>'; return; }

    cardsEl.innerHTML = Object.entries(groups)
      .filter(([, list]) => list.length)
      .map(([role, list]) => {
        const seen = new Map();
        list.forEach((x) => { if (!seen.has(x.id)) seen.set(x.id, x.desc); });
        return `
          <div class="sc-card">
            <div class="sc-card-title" style="color:${TYPE_COLORS[role]}">${TYPE_LABELS[role]}<span>${seen.size}</span></div>
            <div class="sc-card-chips">
              ${Array.from(seen.entries()).map(([id, desc]) => `<button type="button" class="sc-chip" data-chip="${esc(id)}" title="${esc(desc || '')}">${esc(id)}</button>`).join('')}
            </div>
          </div>`;
      }).join('');
  }

  window.GT_EXTRA_TOOLS['supplychain'] = {
    mount(el, setStatus) {
      injectStyle();
      el.innerHTML = `
        <div class="tool sc-root">
          <div class="sc-head"><span>产业链关联 · 全球思维导图</span><span class="sc-head-right" data-count>0 nodes</span></div>
          <div class="sc-controls">
            <input type="text" class="sc-search" data-search placeholder="输入代码或公司名称…">
            <select class="sc-select" data-cat>${CATEGORIES.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}<option value="All" selected>全部行业</option></select>
            <button type="button" class="tool-btn" data-focus-btn>聚焦</button>
          </div>
          <div class="sc-graph-wrap" data-graph>
            <svg class="sc-svg" data-svg xmlns="http://www.w3.org/2000/svg"></svg>
            <div class="sc-legend">
              <span><i style="background:var(--up)"></i>供应商</span>
              <span><i style="background:var(--down)"></i>客户</span>
              <span><i style="background:var(--warning)"></i>竞争</span>
              <span><i style="background:var(--info)"></i>合作</span>
            </div>
          </div>
          <div class="sc-focus" data-focus-info></div>
          <div class="sc-cards" data-cards></div>
          <div class="sc-custom">
            <div class="sc-custom-title">自定义关系 · 本地保存</div>
            <div class="sc-custom-grid">
              <input type="text" data-csrc placeholder="源公司代码">
              <input type="text" data-ctgt placeholder="目标公司代码">
              <select data-ctype>${Object.entries(TYPE_LABELS).map(([k,v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('')}</select>
              <select data-ccat>${CATEGORIES.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select>
              <button type="button" class="tool-btn" data-cadd>添加</button>
            </div>
          </div>
          <div class="sc-foot">
            <div>
              <button type="button" class="tool-btn ghost" data-export>导出 JSON</button>
              <label class="tool-btn ghost" style="cursor:pointer"><input type="file" data-import accept=".json,application/json" style="display:none">导入 JSON</label>
            </div>
            <span class="sc-src">来源：整理公开资料 · 可本地补充</span>
          </div>
        </div>`;

      const countEl = el.querySelector('[data-count]');
      const searchInput = el.querySelector('[data-search]');
      const catSelect = el.querySelector('[data-cat]');
      const focusBtn = el.querySelector('[data-focus-btn]');
      const graphWrap = el.querySelector('[data-graph]');
      const svgEl = el.querySelector('[data-svg]');
      const focusInfoEl = el.querySelector('[data-focus-info]');
      const cardsEl = el.querySelector('[data-cards]');
      const cSrc = el.querySelector('[data-csrc]');
      const cTgt = el.querySelector('[data-ctgt]');
      const cType = el.querySelector('[data-ctype]');
      const cCat = el.querySelector('[data-ccat]');
      const cAdd = el.querySelector('[data-cadd]');
      const exportBtn = el.querySelector('[data-export]');
      const importInput = el.querySelector('[data-import]');

      const state = { filter: 'All', focus: null, highlight: null, graph: buildGraph('All'), positions: new Map() };

      function rebuild() {
        state.graph = buildGraph(state.filter);
        renderGraph(state, svgEl, graphWrap);
        renderCards(state, cardsEl, focusInfoEl);
        countEl.textContent = `${state.graph.nodes.length} nodes · ${state.graph.edges.length} edges`;
      }

      function doFocus(id) {
        if (!id) return;
        const target = state.graph.allNodes.find((n) => n.id === id || n.name.toUpperCase().includes(id));
        if (!target) { focusInfoEl.innerHTML = '<span class="sc-hint">未找到匹配节点</span>'; return; }
        state.focus = target.id;
        state.highlight = target.id;
        state.filter = 'All';
        catSelect.value = 'All';
        rebuild();
      }

      const onSearch = () => doFocus(norm(searchInput.value));
      focusBtn.addEventListener('click', onSearch);
      searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') onSearch(); });

      catSelect.addEventListener('change', () => { state.filter = catSelect.value; state.focus = null; state.highlight = null; rebuild(); });

      svgEl.addEventListener('click', (e) => {
        const nodeEl = e.target.closest('[data-node]');
        if (!nodeEl) return;
        const id = nodeEl.getAttribute('data-node');
        if (state.focus === id) {
          // second click opens link if any
          const node = state.graph.allNodes.find((n) => n.id === id);
          if (node && node.url) window.open(node.url, '_blank', 'noopener');
        } else {
          state.focus = id;
          state.highlight = id;
          renderGraph(state, svgEl, graphWrap);
          renderCards(state, cardsEl, focusInfoEl);
        }
      });

      cardsEl.addEventListener('click', (e) => {
        const chip = e.target.closest('[data-chip]');
        if (!chip) return;
        doFocus(chip.getAttribute('data-chip'));
      });

      cAdd.addEventListener('click', () => {
        const s = norm(cSrc.value), t = norm(cTgt.value), type = cType.value, cat = cCat.value;
        if (!s || !t) { focusInfoEl.innerHTML = '<span class="sc-hint">请填写源公司和目标公司代码</span>'; return; }
        if (s === t) { focusInfoEl.innerHTML = '<span class="sc-hint">源公司与目标公司不能相同</span>'; return; }
        const custom = readCustom();
        if (!custom.nodes.find((n) => norm(n.id) === s)) custom.nodes.push({ id: s, name: s, category: cat });
        if (!custom.nodes.find((n) => norm(n.id) === t)) custom.nodes.push({ id: t, name: t, category: cat });
        if (!custom.edges.find((e) => norm(e.source) === s && norm(e.target) === t && e.type === type)) custom.edges.push({ source: s, target: t, type });
        writeCustom(custom);
        state.focus = s;
        [cSrc, cTgt].forEach((i) => (i.value = ''));
        rebuild();
      });

      exportBtn.addEventListener('click', () => {
        const full = buildGraph('All');
        const blob = new Blob([JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), nodes: full.allNodes, edges: full.allEdges }, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `gt-supplychain-${new Date().toISOString().slice(0,10)}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
      });

      importInput.addEventListener('change', async () => {
        const file = importInput.files && importInput.files[0];
        if (!file) return;
        try {
          const json = JSON.parse(await file.text());
          const custom = readCustom();
          (json.nodes || []).forEach((n) => {
            const id = norm(n.id);
            if (!id || custom.nodes.find((x) => norm(x.id) === id)) return;
            custom.nodes.push({ id, name: n.name || id, category: n.category || 'Tech', url: n.url || '', desc: n.desc || '' });
          });
          (json.edges || []).forEach((e) => {
            const s = norm(e.source), t = norm(e.target);
            if (!s || !t || s === t) return;
            if (!custom.edges.find((x) => norm(x.source) === s && norm(x.target) === t && x.type === e.type)) custom.edges.push({ source: s, target: t, type: e.type || 'partner', desc: e.desc || '' });
          });
          writeCustom(custom);
          rebuild();
        } catch (err) {
          focusInfoEl.innerHTML = '<span class="sc-hint">导入失败：JSON 格式错误</span>';
        } finally { importInput.value = ''; }
      });

      let resizeObserver = null;
      if ('ResizeObserver' in window) {
        resizeObserver = new ResizeObserver(() => renderGraph(state, svgEl, graphWrap));
        resizeObserver.observe(graphWrap);
      } else { window.addEventListener('resize', rebuild); }

      rebuild();
      setStatus('online');

      return () => { if (resizeObserver) resizeObserver.disconnect(); else window.removeEventListener('resize', rebuild); };
    },
  };
})();
