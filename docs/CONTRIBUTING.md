# Contributing to GT UNLIMITED / 贡献指南

Thank you for your interest in making GT UNLIMITED better! This guide is bilingual (English + 中文) so developers from different language backgrounds can participate.

## Quick start for contributors

1. Fork the repository on GitHub.
2. Clone your fork locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/gt-unlimited.git
   cd gt-unlimited
   ```
3. Create a feature branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```
4. Make your changes and test them locally.
5. Commit with a clear message:
   ```bash
   git commit -m "feat: add 3D volatility surface renderer"
   ```
6. Push to your fork and open a Pull Request.

## Areas where help is especially welcome

- Derivatives pricing: options vol surface, swaps, structured products
- Fundamental data: financial statement parsing, ratio adjustments
- Risk models: VaR, stress testing, attribution analysis
- Globe / map features: parity between 2D and 3D event visualization
- Newsroom: RSS aggregation, text-to-speech, audio player fixes
- Translations and documentation in more languages
- Excel / Google Sheets plugin prototypes

## Code style

- Use plain HTML/CSS/JS. Avoid adding a build step unless absolutely necessary.
- Keep widgets self-contained under `web/assets/`.
- Match the existing indentation and naming conventions.
- Add comments for complex calculations.

## Reporting bugs

Please use the GitHub Issue template and include:
- Browser / OS version
- Steps to reproduce
- Expected vs actual behavior
- Screenshots if helpful

## 中文贡献指南

1. 在 GitHub 上 Fork 本仓库。
2. 克隆你的 Fork 到本地。
3. 创建功能分支：`git checkout -b feature/你的功能名`
4. 修改代码并在本地测试。
5. 提交并发起 Pull Request。

如果你不熟悉 Git，也可以直接在 Issue 中描述你的想法，由维护者协助实现。

## Community

- Discussions: use GitHub Discussions for questions and ideas.
- Issues: use GitHub Issues for bugs and feature requests.
