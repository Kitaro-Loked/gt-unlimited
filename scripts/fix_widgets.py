#!/usr/bin/env python3
"""Fix WIDGETS section formatting and ensure every entry has a cn label."""
import re, pathlib

APP = pathlib.Path('/root/trading.2009731.xyz/web/assets/app.js')
text = APP.read_text(encoding='utf-8')

CN = {
    'main': '主图',
    'forex': '外汇交叉盘',
    'calc': '科学计算器',
    'news': '实时快讯',
    'calendar': '财经日历',
    'scanner': '股票扫描器',
    'music': '音乐流',
    'risk': '仓位计算器',
    'crypto': '加密货币',
    'feargreed': '恐慌贪婪指数',
    'tech': '技术评级',
    'heatmap': '外汇热力图',
    'fib': '斐波那契计算',
    'pivot': '枢轴点计算',
    'sessions': '全球交易时段',
    'journal': '交易日志',
    'marketview': '全球市场概览',
    'stockheat': '美股热力图',
    'cryptoheat': '加密热力图',
    'fxrates': '实时汇率',
    'gcrypto': '加密市场全局',
    'funding': '资金费率',
    'commodities': '大宗商品',
    'alerts': '价格提醒',
    'watchlist': '自选观察',
    'sentiment': '多空情绪',
    'liquidations': '爆仓监控',
    'indicators': '技术仪表盘',
    'correlation': '相关性矩阵',
    'fxboard': '外汇金属行情',
    'fxstrength': '货币强弱',
    'autopivot': '自动枢轴点',
    'calculators': '交易计算器Pro',
    'compound': '复利与期望',
    'checklist': '交易纪律清单',
    'notes': '交易笔记',
    'worldheat': '全球热力图',
    'globe': '全球事件地球仪',
    'polymarket': 'Polymarket预测市场',
    'fxmatrix': '外汇交叉矩阵',
    'yieldcurve': '美债收益率曲线',
    'cbankrates': '全球央行利率',
    'futurescurve': '商品期货曲线',
    'riskmon': '风险指标监控',
    'myliquidations': '我的爆仓(币安)',
    'marketliqs': '全市场爆仓',
    'ashareheat': 'A股热力图',
    'asharelimit': 'A股涨停池',
    'ashareboard': 'A股盘面总览',
    'ashareflow': 'A股资金流向',
    'asharemood': 'A股市场情绪',
    'asharehot': 'A股多维榜单',
    'cryptotop': '币安涨跌榜',
    'cryptooi': '合约持仓量监控',
    'globalidx': '全球股指',
    'hkboard': '港股行情板',
    'usboard': '美股行情板',
    'asharesector': 'A股板块热度',
    'ashareladder': 'A股涨停梯队',
    'asharequote': 'A股个股速查',
    'asharecapital': 'A股资金面',
    'asharefut': '期指与ETF',
    'asharecb': '可转债与新股',
    'cryptols': '多空持仓比',
    'cryptobasis': '期现基差套利',
    'cryptodvol': '期权波动率',
    'cryptonew': '新币上线监控',
    'cryptovol': '币圈量能异动榜',
    'globalbond': '全球债市',
    'ushot': '美股明星榜',
    'euboard': '欧股行情板',
    'globalfut': '全球期货',
    'optionchain': 'ETF期权链',
    'cryptooptflow': '期权情绪流',
    'optionlab': '期权实验室',
    'hotrank': '人气热股榜',
    'twboard': '台股行情板',
    'asiahot': '亚太明星股',
    'emhot': '新兴市场股',
    'hkflow': '南向资金',
    'tradecalc': '策略计算器',
    'holidays': '市场假期日历',
    'econdata': '经济数据日历',
    'dividend': '分红与高股息',
    'ipoashare': 'A股打新',
    'ipohk': '港股打新',
    'ipous': '美股打新',
    'ipostats': '新股表现',
    'jpboard': '日股行情板',
    'inboard': '印度行情板',
    'ukboard': '英股行情板',
    'deboard': '德股行情板',
    'brboard': '巴西行情板',
    'marketsentiment': '市场情绪',
    'supplychain': '产业链关联',
    'mideastboard': '中东行情板',
    'africaboard': '非洲行情板',
    'latamboard': '拉美行情板',
    'aseanboard': '东盟行情板',
    'oceaniaboard': '大洋洲行情板',
    'koreaboard': '韩国行情板',
}

# 1. Fix same-line cn + w:  -> split into two lines
#    e.g. "      cn: '主图',      w: 8,"
text = re.sub(
    r"^(\s+cn:\s*'[^']+',)\s*(w:\s*\d+,?)",
    r"\1\n\2",
    text,
    flags=re.MULTILINE,
)

# 2. Fix lines that lost the "w:" label (e.g. "      4," inside a widget block)
#    Detect by looking for a line that is just whitespace+number+comma, preceded by title/cn and followed by h:
text = re.sub(
    r"^(\s+)(\d+,\s*)$\n(?=\s+h:\s*\d)",
    r"\1w: \2\n",
    text,
    flags=re.MULTILINE,
)

# 3. Ensure every widget entry has cn: right after title.
def fix_entry(m):
    body = m.group(0)
    wid = m.group(1)
    cn = CN.get(wid)
    if not cn:
        return body
    # If already has cn, leave formatting alone (just make sure it's on its own line)
    if re.search(r"\bcn\s*:", body):
        # normalize same-line cn if any
        body = re.sub(r"\bcn:\s*'([^']+)',\s*", r"cn: '\1',\n      ", body, count=1)
        return body
    # Insert cn after title line
    body = re.sub(
        r"^(\s+title:\s*'[^']+'),",
        r"\1,\n      cn: '%s'," % cn,
        body,
        count=1,
        flags=re.MULTILINE,
    )
    return body

# Match each widget entry from id: { ... } ending at the matching } before next id or end of WIDGETS.
# Use a simpler approach: match id: { ... } where the closing brace is at base indent (4 spaces).
text = re.sub(
    r"^    ([A-Za-z0-9_]+): \{(?:(?!^    [A-Za-z0-9_]+: \{).)*?^    \},",
    fix_entry,
    text,
    flags=re.MULTILINE | re.DOTALL,
)

APP.write_text(text, encoding='utf-8')
print('WIDGETS section fixed.')
