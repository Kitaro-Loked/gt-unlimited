#!/usr/bin/env python3
# Add cn (Chinese label) to WIDGETS entries in app.js where missing.
import re, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent / 'web/assets'
APP = ROOT / 'app.js'

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
}

text = APP.read_text(encoding='utf-8')

def repl(m):
    before = m.group(1)
    title = m.group(2)
    rest = m.group(3)
    # Extract id from preceding context if possible; fallback: use title
    # Instead we match per-id by scanning the whole block.
    # But simpler: if block already has cn, leave it.
    if re.search(r"\bcn\s*:", rest.split('w:')[0]):
        return m.group(0)
    # Determine id from nearest preceding key (heuristic: look back in text)
    start = m.start()
    back = text[:start]
    key_match = None
    for km in re.finditer(r"\b(\w+)\s*:\s*\{", back):
        key_match = km
    wid = key_match.group(1) if key_match else None
    cn = CN.get(wid)
    if not cn:
        return m.group(0)
    indent = '      '
    return f"{before}{title},\n{indent}cn: '{cn}',{rest}"

# Match title line followed by w: line, possibly with cn in between.
pattern = re.compile(r"^(\s+)(title:\s*'[^']+'),?\n((?:(?!\bw:\b).)*?\n)(\s+w:)", re.MULTILINE | re.DOTALL)
text = pattern.sub(repl, text)

# Safety: ensure every WIDGETS entry has cn (second pass using id-keyed regex)
for wid, cn in CN.items():
    if re.search(rf"\b{wid}\s*:\s*\{{[\s\S]*?\bcn\s*:", text):
        continue
    text = re.sub(
        rf"(\b{wid}\s*:\s*\{{\s*title:\s*'[^']+'),",
        rf"\1,\n      cn: '{cn}',",
        text,
        count=1,
    )

APP.write_text(text, encoding='utf-8')
print('cn labels injected/verified.')
