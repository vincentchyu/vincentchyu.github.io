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
- **Footprint**: 山河足迹，记录户外徒步、越野跑、骑行、自驾等数字轨迹，并与摄影作品时空对齐。
- **Media Journal**: 从 NeoDB 定时同步的书影音记录。
- **Tools**: 在线开发者工具。
- **Photography**: 摄影作品画廊，支持按年份归档、EXIF 信息展示和沉浸式预览。
- **Sonic Lens**: 音乐播放统计与偏好分布子站。
- **Admin**: 照片管理后台。
- **Legacy**: 历史页面与旧站兼容内容。

## 技术栈

- **前端**: 原生 HTML/CSS/JavaScript (无重型框架依赖)，WebGL 地图由 MapLibre GL JS 驱动
- **样式**: Site Shell + 自定义 CSS (支持高对比度户外暗黑模式)
- **交互**: 原生 HTML/CSS/JavaScript，照片后台采用虚拟滚动和懒加载，足迹底图热插拔与 Canvas HUD
- **评论**: Valine
- **自动化**: Go (用于照片处理、EXIF 提取、GPX 解析、时空对齐与数据生成)
- **存储**: Cloudflare R2 / 火山引擎 TOS (图片 CDN)

## 站点框架与导航

公开页面统一使用 `web/shared/styles/site-shell.css` 与
`web/shared/scripts/site-shell.js` 注入 `VINCENT CHYU` 基础菜单：
`HOME`、`MEDIA JOURNAL`、`FOOTPRINT`、`PORTFOLIO`、`SONIC LENS`、`DEVELOPER TOOLS`、
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

## 山河足迹工作流 (Footprint & Track Workflow)

`web/tracks/` 是山河足迹全景数字资产系统，结合了 WebGL 多图源地图渲染、GPX 智能抽稀、双向联动高程/心率 HUD、以及与摄影作品的时空对齐关联。

### 1. 两阶段轨迹管理工作流 (Two-Stage Workflow)

为了避免算法推测与用户人工微调冲突，山河足迹采用清晰的**待整理池 ➔ 人工确认 ➔ 正式构建**工作流：

```text
原始 GPX 轨迹
  │
  ├── ① 放入待整理池 (~/.config/gpx/pending/)
  │      ↓
  ├── ② 执行预重命名: go run cmd/update-tracks/main.go --suggest-rename --run
  │      ↓ (系统自动调用 photools 逆地理反查省份、推算速度、生成标准 5 段文件名)
  │
  ├── ③ 人工核对与微调 (如修正实际运动类型、优化路线标题)
  │      ↓
  ├── ④ 移动至正式目录 (~/.config/gpx/)
  │      ↓
  └── ⑤ 正式构建数据: go run cmd/update-tracks/main.go
         (严格按文件名 5 段拆解，100% 保留人工干预结果，不读取 pending 目录)
```

- **待整理池预处理**:
  - `go run cmd/update-tracks/main.go --suggest-rename`（预览重命名建议）
  - `go run cmd/update-tracks/main.go --suggest-rename --run`（自动扫描 `pending/` 目录并批量应用标准命名）
- **正式构建**:
  - `go run cmd/update-tracks/main.go`（仅扫描 `~/.config/gpx/` 根目录下的正式 `.gpx` 文件，不递归 `pending/`）
- **智能抽稀与摄影对齐**:
  - 采用 **Douglas-Peucker 算法** 进行双精度几何抽稀（全景底图 8m 容差，详情高保真 2.5m 容差），体积缩减 70%+。
  - 自动将单反摄影照片 EXIF 拍摄时间与 GPS 轨迹点做时空线性插值关联，在地图上生成 📷 照片图钉与 Profile HUD 联动胶片轮播栏。
- **输出分片数据**: 生成总览索引 `web/tracks/data/manifest.json` 与单条高保真分片 `web/tracks/data/tracks/{id}.json`。

### 2. 轨迹文件命名规范与拆解机制 (Track Naming & Parsing)

#### 🌟 推荐标准格式 (Standard 5-Part Format)

```text
{运动类型}-{国家}-{省份}-{路线/地点名称}-{YYYYMMDD}.gpx
```

#### 📌 字段解析机制（人工干预最高优先级）

当文件名为上述标准 5 段格式时，构建引擎将**直接严格按段拆解**，绝对不被任何算法推算或 GPX 内置标签覆盖：

| 字段 | 示例 | 最终渲染机制 |
| :--- | :--- | :--- |
| **{运动类型}** | `hiking`、`cycling`、`driving`、`trail_running`、`walking`、`transit` | 严格采用该运动类型与荧光配色，不被平均速度算法覆盖。 |
| **{国家}** | `中国` | 严格采用该国家标签。 |
| **{省份}** | `新疆`、`四川`、`广东` | 严格采用该省份标签并点亮地图对应省份。 |
| **{路线/地点名称}** | `喀拉峻鲜花台深度`、`夏特古道`、`火凤线` | 严格提取为卡片与 HUD 主标题（自动将下划线替换为空格，绝不拼接类型与省份前缀）。 |
| **{YYYYMMDD}** | `20260610` | 提取为基准活动日期，用于时间倒序索引与照片时空匹配。 |

#### 💡 规范命名范例

- 🥾 **户外徒步**: `hiking-中国-新疆-喀拉峻鲜花台深度-20260610.gpx`
- 🚗 **公路自驾**: `driving-中国-新疆-独库公路自驾巡游-20260613.gpx`
- 🚲 **绿道骑行**: `cycling-中国-广东-从化流溪河绿道-20251115.gpx`
- 🏃 **山野越野跑**: `trail_running-中国-四川-四姑娘山长坪沟-20260710.gpx`

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
-   `updatet`: 手动运行山河足迹轨迹更新与摄影时空关联 (执行 `cmd/update-tracks`)。
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
