# AGENTS.md

## 项目概览

这是一个以 GitHub Pages 为主的个人网站仓库，核心内容分成六块：

1. 主页与站点入口，主要在仓库根目录的 `index.html`，以及 `web/home/`、`web/tools/`、`web/shared/`。
2. 摄影站点，主要在 `web/photography/`，包含源码、构建产物、照片目录以及分片索引文件（本地工作区的 `data/photos-manifest.json` 和 `data/photos/*.json`，线上发布前缀为 `pages/photos-manifest.json` 和 `pages/photos/*.json`）。
3. 山河足迹（FOOTPRINT），主要在 `web/tracks/`，包含全景 WebGL 地图、暗黑/等高线/卫星多底图、轨迹焦点弱化、高程与心率双向联动 HUD、以及与摄影作品时空对齐关联（数据在 `web/tracks/data/manifest.json` 与 `tracks/*.json`）。
4. 照片管理后台，主要在 `web/admin/`，由 Go 后端提供 API，支持分页列表、虚拟滚动和批量编辑。
5. 历史兼容页面，主要在 `web/legacy/`，旧入口保留在 `web/before/` 作为 redirect shim。
6. SonicLens 子站，主要在 `web/sonic-lens/`，使用 Cloudflare Pages Functions。

仓库同时包含 Go 工具链、Cloudflare R2/KV 访问逻辑、EXIF/缩略图处理、GPX 轨迹解析与时空对齐流水线、以及 macOS 启动脚本。

## 关键目录

- `cmd/static/`：本地静态站点预览服务，默认监听 `:3000`。
- `cmd/admin/`：照片管理后台服务，默认监听 `:3002`。
- `cmd/update-photos/`：照片扫描、EXIF 提取、缩略图生成、R2 上传和分片索引生成入口。
- `cmd/update-tracks/`：轨迹扫描、Douglas-Peucker 抽稀、心率提取、摄影时空对齐与分片索引生成入口（默认扫描源 `~/.config/gpx/`）。
- `internal/track/`：轨迹数据模型、Haversine 测距、Douglas-Peucker 抽稀算法、GPX 智能解析器与相册照片时空匹配对齐引擎。
- `internal/photo/`：照片处理主逻辑，负责扫描 `web/photography/gallery_images/`、生成/更新 `web/photography/data/photos-manifest.json` 与 `web/photography/data/photos/*.json`、合并旧元数据、上传原图和缩略图。
- `internal/imaging/`：缩略图和大图压缩逻辑，输出 WebP 为主。
- `internal/storage/`：Cloudflare R2、Cloudflare API/KV 访问封装。
- `internal/admin/`：照片后台 HTTP API、重建流程、文件读取和代理。
- `pkg/config/`：`.env` 加载入口。
- `web/home/`：主页专属资源与脚本。
- `web/tools/`：开发者工具页。
- `web/tracks/`：山河足迹前端页面，`data/manifest.json` 和 `data/tracks/*.json` 为轨迹索引与分片数据。
- `web/legacy/`：历史页面和兼容内容。
- `web/shared/`：跨页面共享的脚本、样式、字体和媒体资源。
- `web/admin/`：管理后台前端。
- `web/photography/`：摄影站点，`src/` 是源码，`dist/` 是已提交的构建输出，`gallery_images/` 是输入照片，`data/photos-manifest.json` 和 `data/photos/*.json` 是生成数据，`photos.json` 仅作旧版兼容读取兜底，不再作为正常写入目标。
- `web/sonic-lens/`：Cloudflare Pages 站点，`functions/api/` 是后端函数，`public/` 是静态资源。
- `web/before/`：旧站和历史资源，当前仅保留 redirect shim 和少量兼容文件。
- `shell/`：macOS `launchctl` 配置和启动/停止脚本。

## 运行方式

- `go run cmd/static/main.go`：本地预览静态站点，`http://localhost:3000`。
- `go run cmd/admin/main.go`：启动照片管理后台，`http://localhost:3002`。
- `go run cmd/update-photos/main.go`：手动执行照片更新流程。
- `go run cmd/update-tracks/main.go`：手动执行轨迹与摄影时空关联更新流程。
- `go run cmd/scan-tracks/main.go`：扫描正式包与预备包 GPX 冲突，生成时空重叠清单与 Markdown 报告（支持 `--hiking`、`--running`、`-type <type>` 过滤）。
- `go run cmd/merge-tracks/main.go`：根据清单执行双向点位融合弥补与心率时空插值合并（支持 `--hiking`、`--running`、`-id <id>`、`-name <keyword>`、`-all`）。
- `go run cmd/concat-tracks/main.go`：将多日/多段分段轨迹按天数时序首尾顺次相连拼接为完整大环线（支持 `-pattern`、`-title`、`-out`）。
- `./run.sh init`：生成并安装 macOS LaunchAgent。
- `./run.sh start`：同时启动照片管理后台(:3002)和本地博客预览(:3000)。
- `./run.sh stop`：同时停止后台服务和本地博客预览。
- `./run.sh updatep`：运行照片更新。
- `./run.sh updatet`：运行山河足迹轨迹更新与摄影时空对齐。
- `./run.sh synct`：一键自动同步 iPhone 苹果健康增量数据到山河足迹（支持 `./run.sh synct [zip路径]`）。

`run.sh` 会先检查 `exiftool`，缺失时尝试用 Homebrew 安装。

## 环境变量

- `pkg/config` 会尝试从当前目录的 `.env`、`scripts/.env`、以及用户目录下的脚本路径加载环境变量。
- R2 相关变量支持两套命名：`NUXT_PROVIDER_S3_*` 和 `R2_*`。
- Cloudflare KV/Pages 相关变量主要是 `CF_ACCOUNT_ID`、`CF_API_TOKEN`、`CF_KV_DATABASE_ID`、`DB`。
- 如果 R2 配置缺失，后台和照片更新仍可能启动，但上传、删除和 CDN 相关能力会受限。

## 开发约定

- 保持当前技术栈风格：Go + 原生 HTML/CSS/JS，不要随意引入新框架。
- 维护静态站点时，优先编辑源码文件，再按需更新生成产物。
- 不要随意改动 `web/photography/dist/`、`web/photography/data/`、`web/photography/photos.json`、`shell/bin/` 这类生成文件，除非你明确在做重建。
- 修改照片流水线时，要同步考虑本地文件、`photos-manifest.json`、年份分片、R2 对象键名和后台 API 的一致性。
- `web/admin` 的照片列表 API 支持分页查询，默认页面应优先用 `format=page` 的 cursor 分页模式。
- 约定：`web/photography/data/photos-manifest.json` 只作为本地开发和工作区生成产物；线上读取对应的 `pages/photos-manifest.json`，年份分片对应 `pages/photos/{year}.json`。
- 约定：正常更新流程不再写入 `web/photography/photos.json`，它只作为迁移期间的旧版读取兜底。
- 约定：全站任何页面（摄影、足迹、后台）消费照片媒体资源时，严禁硬编码 TOS 或 R2 域名，统一使用 `web/shared/scripts/photo-source.js`（`window.PhotoSource.resolvePhotoUrls(p)`）进行动态解析与双源容灾降级；预览场景优先加载 WebP 压缩缩略图。
- 约定：山河足迹多图源注册表 (`web/tracks/map-sources.js`) 统一管理所有底图 Provider 与 Style，个人 API Key 隔离保存于浏览器 localStorage，源码严禁包含敏感凭据。
- 约定：山河足迹高亮轨迹采用三层复合渲染架构（`casing` 深黑描边 + `glow` 运动主题色光晕 + `core` 亮白芯线），确保在暗黑、等高线、街道、卫星全底图下均保持高对比度与穿透力。
- 约定：`go run cmd/static/main.go` 只用于本地调试，并会注入 `local` 数据模式；生产环境不应依赖它来发布摄影数据。
- 约定：`web/ARCHITECTURE.md` 代表当前前端 canonical 目录树，`web/before/` 仅保留兼容跳转。
- 约定：凡是涉及目录重组、前后端分层、运行方式、API 契约、性能模型等较大的变动，都要同步更新 `CHANGELOG.md`，保持变更记录与代码一致。
- 现有注释和 UI 文案中中英文混用较多，新增内容尽量跟随所在文件的既有语言风格。
- 保留用户已经做过的未提交改动，不要回滚不相关文件。
- ⚠️ **约定（反回归约束）：山河足迹 `web/tracks/tracks.js` 存在三路异步竞态（`style.load`、`loadOverviewTracks`、`selectTrack` fetch），历史上每次新增需求改动后多次引发"点击轨迹后无轨迹显示"的回归 Bug。任何对该文件的修改必须严格遵守以下防御规则**：
  1. **`selectTrack` 中的 `applyFocusDimming(true)` 必须在 `fetch(tracks/{id}.json)` 成功并确认 `activeTrackId` 未变更之后调用**，严禁在 fetch 发起前或 `.then` 外部调用。fetch 失败时必须恢复 `activeTrackId = null` 并调用 `applyFocusDimming(false)` 还原底网可见性。
  2. **`renderMapTracks()` 必须在 `overviewGeoJSON` 未加载时设置 `pendingMapRender = true` 并 return**，由 `loadOverviewTracks()` 在数据到达后自动消费并重新调用 `renderMapTracks()`。严禁静默丢弃渲染请求。
  3. **`style.load` handler 中必须同时尝试恢复 `overviewGeoJSON` 底网和 `activeTrackDetail` 选中轨迹**，不可假设任何一方的加载时序。
  4. **修改后必须运行 `node --check web/tracks/tracks.js` 验证语法**，并在浏览器中实际测试以下场景：首次加载全景底网→切换分类→点击轨迹→fetch 成功渲染→返回全景→再次切换分类。

## 测试与验证

- Go 代码改动后，优先运行 `go test ./...`。
- `internal/storage/kv_test.go` 更像集成测试，默认会触碰真实 Cloudflare 环境，没配环境变量时会自动跳过。
- `internal/photo/exif_test.go` 依赖本机硬编码样例图片路径。
- `internal/imaging/thumbnail_test.go` 也依赖本机路径，并会把生成结果写到本机固定位置。
- 因此，遇到测试失败时先区分是代码回归还是本机环境/样本文件问题。

## 交互注意事项

- 这个仓库当前可能处于脏工作区状态，编辑前先看 `git status`。
- 如果要批量改文件，优先使用 `apply_patch`。
- 如果你在改 Go 逻辑，尽量同时检查相关的前端 API 调用、静态资源路径和测试假设。
- 如果你在改 `web/sonic-lens/`，记得它是 Cloudflare Pages Functions，不是普通 Node 后端。
