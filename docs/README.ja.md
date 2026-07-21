# GT UNLIMITED — 金融ターミナル

[English](../README.md) | [中文](README.zh-CN.md) | 日本語

Bloomberg / TradingView にインスパイアされた、自己ホスト型のシングルページ金融監視ターミナルです。HTML/CSS/JS のみで構築され、グローバル市場、デリバティブ、リスク、マクロイベント、ニュースを一元管理できるダッシュボードを目指しています。

- **公式インスタンス**: https://trading.2009731.xyz
- **リポジトリ**: https://github.com/Kitaro-Loked/gt-unlimited

## 主な機能

- 株式、暗号資産、FX、商品、金利、ETF のマルチアセット市場データ
- TradingView 統合チャート、ヒートマップ、テクニカル分析
- オプション、ボラティリティ曲面、スワップ、ストラクチャードプロダクト
- ポートフォリオの PnL、アトリビューション、ベータ/アルファ、VaR、ストレステスト
- 財務諸表（FA）、企業概要（DES）、証券会社レポート（RES）
- インタラクティブな 2D/3D グローブ、ニュース、RSS、TTS 放送

## クイックスタート

```bash
cd gt-unlimited
node api/proxy-server.js &
caddy run
```

詳細は [English README](../README.md) または [中文文档](README.zh-CN.md) をご覧ください。

## ライセンス

[MIT License](../LICENSE) © Kitaro-Loked
