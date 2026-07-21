# GT UNLIMITED 代理服务器

由于浏览器安全限制，部分外部 API（Polymarket、GDACS 灾害 RSS 等）无法直接从静态站点跨域请求。本代理用于解决这些请求的 CORS 问题。

## 快速启动

```bash
cd gt-unlimited
node api/proxy-server.js
```

默认监听 `0.0.0.0:3456`。

## 配合 Caddy 使用

项目根目录提供 `Caddyfile.example` 模板，复制为 `Caddyfile` 后代理 `/api/*` 到本服务：

```bash
# 1. 复制模板并设置域名
cd gt-unlimited
cp Caddyfile.example Caddyfile
# 编辑 Caddyfile：将 example.com 替换为你的域名

# 2. 启动代理
node api/proxy-server.js &

# 3. 启动 Caddy
caddy run
```

## 端口自定义

通过环境变量 `PORT` 修改监听端口：

```bash
PORT=8080 node api/proxy-server.js
```

## 代理的端点

前端 widget 会自动优先使用同域 `/api/proxy?url=<encoded-url>` 访问以下数据：

- `https://gamma-api.polymarket.com/events` — Polymarket 预测市场
- `https://www.gdacs.org/xml/rss_7d.xml` — GDACS 全球灾害 RSS
- 其他公开新闻 RSS

如果未运行本代理，widget 会尝试公共 CORS 代理；再失败时显示 fallback 链接。
