# SonicLens Web Project

由于这是一个 Cloudflare Pages 项目，后端 API 使用 **Pages Functions** 实现。

## 目录结构

- `functions/api/` - 后端 API 代码 (运行在 Cloudflare Workers 上)
- `public/` - 静态网站资源 (HTML, CSS, JS)

## 本地开发

需要安装 `wrangler` CLI。

1. **安装依赖**
   ```bash
   npm install -g wrangler
   ```

2. **启动本地开发服务器**
   你需要绑定 D1 数据库。假设你的 D1 数据库名为 `lastfm-scrobbler-db`，且你已经配置了本地/远程 D1。

   ```bash
   # 在 web_project 目录下运行
   # --d1 DB=DATABASE_NAME 将数据库绑定到环境变量 DB
   wrangler pages dev public --d1 DB=lastfm-scrobbler-db
   ```

   或者，如果你想直接连接到远程 D1 数据库（注意延迟）：
   ```bash
   wrangler pages dev public --d1 DB=lastfm-scrobbler-db --remote
   ```

## API 接口

- `GET /api/stats` - 获取综合统计数据
- `GET /api/recent?page=1&limit=20` - 获取最近播放记录

## 部署

将代码推送到 GitHub 仓库后，在 Cloudflare Dashboard 中创建一个 Pages 项目并连接该仓库。

**Build 设置**:
- **Framework Preset**: None
- **Build command**: (空)
- **Build output directory**: `web/lastfm-scrobbler/public` (根据你仓库的实际路径调整)

**环境变量绑定**:
在 Pages 项目设置 -> Functions -> D1 Database Bindings 中：
- Variable name: `DB`
- D1 database: 选择你的数据库
