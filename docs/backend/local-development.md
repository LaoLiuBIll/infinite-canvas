---
title: 本地开发
description: 前后端分开启动时的本地开发方式
---

# 本地开发

如果你需要改代码，建议前后端分开启动

## 1. 准备环境变量

```bash
cp .env.example .env
```

默认配置下：

- 后端端口是 `8080`
- 前端端口是 `3000`
- SQLite 数据库是 `data/infinite-canvas.db`

## 2. 启动后端

在仓库根目录执行：

```bash
go run .
```

后端会读取根目录 `.env`，并监听：

```text
http://127.0.0.1:8080
```

## 3. 启动前端

在 `web` 目录执行：

```bash
bun run dev
```

前端默认访问：

```text
http://localhost:3000
```

开发代理默认转发到 `http://127.0.0.1:8080`。如果你的后端端口不同，启动前设置 `API_BASE_URL`

公开部署时，在 `web` 目录构建前端时设置 `INFINITE_CANVAS_SITE_URL` 为站点的公开地址，例如 `INFINITE_CANVAS_SITE_URL=https://example.com bun run build`。首页和配音工作台会使用该地址生成 canonical 和 JSON-LD。

## 常见场景

- 改画布、页面和交互：主要看 `web/`
- 改接口、业务逻辑和数据库：主要看仓库根目录下的 Go 代码
- 改文档站内容：主要看 `docs/content/docs/`
