# Vincent's Personal Website & Blog

<p align="center">
  <img alt="Logo" src="web/shared/media/logo.png" width="100">
</p>

<p align="center">
  <strong>程序员 & 尼康摄影师</strong>
</p>

<p align="center">
  <a href="https://blog-vincent.chyu.org">🌐 访问网站</a>
</p>

## 项目概述

这是一个静态生成的个人网站，托管于 GitHub Pages。它不仅是我的技术博客，也是我的摄影作品集、书影音记录展示平台和本地可管理的摄影后台。

主要包含以下部分：
- **Home**: 主页入口与站点导航。
- **Media Journal**: 从 NeoDB 定时同步的书影音记录。
- **Tools**: 在线开发者工具。
- **Photography**: 摄影作品画廊，支持按年份归档、EXIF 信息展示和沉浸式预览。
- **Sonic Lens**: 音乐播放统计与偏好分布子站。
- **Admin**: 照片管理后台。
- **Legacy**: 历史页面与旧站兼容内容。

## 技术栈

- **前端**: 原生 HTML/CSS/JavaScript (无重型框架依赖)
- **样式**: Material Design Lite (MDL) + 自定义 CSS
- **交互**: 原生 HTML/CSS/JavaScript，照片后台采用虚拟滚动和懒加载
- **评论**: Valine
- **自动化**: Go (用于照片处理和数据生成)
- **存储**: Cloudflare R2 (图片 CDN)

## 站点框架与导航

公开页面统一使用 `web/shared/styles/site-shell.css` 与
`web/shared/scripts/site-shell.js` 注入 `VINCENT CHYU` 基础菜单：
`HOME`、`MEDIA JOURNAL`、`PORTFOLIO`、`SONIC LENS`、`DEVELOPER TOOLS`、
`ABOUT ME`、`CONTACT`。新增公开页面应优先接入这套共享 shell，再添加页面自己的内容区。

## 摄影工作流 (Photography Workflow)

摄影板块采用了自动化的工作流来管理大量高画质照片：

1.  **本地管理**: 照片按年份存放在 `web/photography/gallery_images/` 目录。
2.  **自动化处理**: 使用 Go 脚本 (`go run cmd/update-photos/main.go`) 扫描目录。
    -   自动提取 EXIF 元数据（光圈、快门、ISO 等）。
    -   自动生成 WebP 格式的高效缩略图。
    -   自动上传原图和缩略图到 Cloudflare R2 对象存储。
3.  **数据驱动**: 脚本生成 `web/photography/data/photos-manifest.json` 和按年分片的 `web/photography/data/photos/*.json`，前端先加载 manifest 再按需加载年份分片，避免单个大 JSON 随照片增长而拖慢首屏。
    -   本地 `go run cmd/static/main.go` 读取工作区内的 `web/photography/data/`。
    -   线上发布后读取 R2/CDN 的 `https://cdn-xxx.org/pages/photos-manifest.json` 和 `https://cdn-xxx.org/pages/photos/{year}.json`。
    -   `photos.json` 仅保留为旧版兼容读取兜底，不再由正常写入流程更新。
4.  **前端发布产物**: 摄影页业务脚本源码保留在 `web/photography/js/`，线上发布前使用 `go run ./cmd/build-photography-assets` 生成 `web/photography/dist/gallery.bundle.min.js`，减少线上业务脚本请求数并压缩体积。
    -   仓库内置 `go run ./cmd/build-photography-assets --check` 校验模式，可用于发布前或 CI 中检查 bundle 是否已同步更新。

### 管理后台 (Admin Panel)

为了更高效地管理照片库，我们开发了一个基于 Web 的本地管理后台：

-   **高性能浏览**: 引入 **虚拟滚动 (Virtual Scrolling)** 技术，轻松流畅地管理数千张照片，大幅降低内存占用。
-   **沉浸式预览**: 支持 R2 原图预览，集成 **平移与缩放 (Pan & Zoom)** 功能，方便检查细节。
-   **实时重建**: 可视化的重建进度与实时日志输出，上传/编辑/删除会同步更新对应年份分片和 manifest。

详细的脚本使用方式请参考本文件下方的 `run.sh` 章节。

## 书影音工作流 (Media Journal Workflow)

`web/media/` 是 NeoDB 书影音记录展示页，前端以原生 HTML/CSS/JS 读取
`web/media/data/{book,movie,tv,music,game,podcast}.json`。空分类应保持为
`[]`，便于静态页面稳定渲染空状态。

数据更新入口是：

```bash
go run cmd/update-neodb/main.go
```

本地运行需要 `NEODB_API_TOKEN`。线上通过 `.github/workflows/neodb-refresh.yml`
每日定时拉取 NeoDB，并在 JSON 有变化时提交回仓库。

## 本地开发

### 依赖

- Node.js & npm
- Go (用于运行自动化脚本)
- `exiftool` (用于提取照片元数据 - 脚本会自动尝试安装，或使用 `brew install exiftool` 手动安装)

### 运行

#### 1. 静态网站预览 (Static Site Preview)

运行静态文件服务器，预览网站效果。这个模式会把前端标记为 `local`，摄影页优先读取本地 `web/photography/data/` 下的 manifest 和分片数据，不依赖 R2：

```bash
go run cmd/static/main.go
```

访问 `http://localhost:3000` 即可预览。

本地预览会自动把摄影页切回源码脚本顺序加载，因此修改 `web/photography/js/` 后无需先手动重打 bundle。

#### 2. 照片管理后台 (Photo Admin Panel)

运行管理后台，用于上传、管理照片和重建数据：

```bash
go run cmd/admin/main.go
```

访问 `http://localhost:3002` 进入管理后台。

#### 3. 本地双服务联动

`run.sh start` 会同时启动：

- `http://localhost:3000` 的本地博客/静态预览
- `http://localhost:3002` 的照片管理后台

## MacOS 管理脚本

为了方便在 macOS 上部署和管理后台服务，项目提供了一套封装好的 Shell 脚本。

### 核心脚本 (`run.sh`)

位于项目根目录的 `run.sh` 是主要的入口点，封装了常用的管理命令。

**前置依赖**:
- `exiftool`: 用于照片元数据提取。脚本会自动检查，如果未安装，将尝试使用 Homebrew 安装。

**用法**:

```bash
chmod +x run.sh
./run.sh [command]
```

**可用命令**:

-   `init`: 初始化环境。编译后台和本地预览二进制，并安装两个 LaunchAgent 配置文件。
-   `start`: 启动服务。通过 `launchctl` 同时加载并启动后台和本地博客预览。
-   `stop`: 停止服务。卸载并停止后台和本地博客预览。
-   `updatep`: 手动运行照片库更新逻辑 (执行 `cmd/update-photos`)。
-   `updaten`: 手动运行 NeoDB 书影音数据更新逻辑 (执行 `cmd/update-neodb`)。
-   `verify`: 校验摄影页 bundle 是否为最新构建结果，并运行 `go test ./...`。

### 目录结构 (`shell/`)

-   `shell/script/`: 包含构建、启动和停止的具体实现脚本。
-   `shell/launch/`: 存放 LaunchAgent 配置文件模板。
-   `shell/bin/`: 存放编译后的二进制文件 (已添加到 `.gitignore`)。

### 变更记录

- 任何涉及目录重组、前后端分层、启动方式、API 契约或性能模型的大改动，建议同步更新 `CHANGELOG.md`，保证代码、约束和变更记录一致。

## 发布与压缩

- 摄影页业务 JS 的发布前校验已接入仓库工作流：本地可运行 `./run.sh verify`，CI 会执行 `go run ./cmd/build-photography-assets --check`，避免源码更新后漏提 `gallery.bundle.min.js`。
- 当前仓库里与摄影页 JS 压缩直接相关、且真正可控的优化仍然是：bundle、minify、合理缓存。托管/CDN 侧压缩策略暂不在仓库内管理。

### 前端目录

- `web/` 是主站前端的 canonical 目录树。
- `web/home/`、`web/media/`、`web/tools/`、`web/photography/`、`web/admin/`、`web/legacy/`、`web/shared/` 各自负责不同页面和资源。
- `web/before/` 仅保留旧入口的兼容跳转和历史资源。

## License

Apache License 2.0
