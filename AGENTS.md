# AGENTS.md

## 项目概览

这是一个以 GitHub Pages 为主的个人网站仓库，核心内容分成五块：

1. 主页与站点入口，主要在仓库根目录的 `index.html`，以及 `web/home/`、`web/tools/`、`web/shared/`。
2. 摄影站点，主要在 `web/photography/`，包含源码、构建产物、照片目录以及分片索引文件（本地工作区的 `data/photos-manifest.json` 和 `data/photos/*.json`，线上发布前缀为 `pages/photos-manifest.json` 和 `pages/photos/*.json`）。
3. 照片管理后台，主要在 `web/admin/`，由 Go 后端提供 API，支持分页列表、虚拟滚动和批量编辑。
4. 历史兼容页面，主要在 `web/legacy/`，旧入口保留在 `web/before/` 作为 redirect shim。
5. SonicLens 子站，主要在 `web/sonic-lens/`，使用 Cloudflare Pages Functions。

仓库同时包含 Go 工具链、Cloudflare R2/KV 访问逻辑、EXIF/缩略图处理、以及 macOS 启动脚本。

## 关键目录

- `cmd/static/`：本地静态站点预览服务，默认监听 `:3000`。
- `cmd/admin/`：照片管理后台服务，默认监听 `:3002`。
- `cmd/update-photos/`：照片扫描、EXIF 提取、缩略图生成、R2 上传和分片索引生成入口。
- `internal/photo/`：照片处理主逻辑，负责扫描 `web/photography/gallery_images/`、生成/更新 `web/photography/data/photos-manifest.json` 与 `web/photography/data/photos/*.json`、合并旧元数据、上传原图和缩略图。
- `internal/imaging/`：缩略图和大图压缩逻辑，输出 WebP 为主。
- `internal/storage/`：Cloudflare R2、Cloudflare API/KV 访问封装。
- `internal/admin/`：照片后台 HTTP API、重建流程、文件读取和代理。
- `pkg/config/`：`.env` 加载入口。
- `web/home/`：主页专属资源与脚本。
- `web/tools/`：开发者工具页。
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
- `./run.sh init`：生成并安装 macOS LaunchAgent。
- `./run.sh start`：同时启动后台服务和本地博客预览。
- `./run.sh stop`：同时停止后台服务和本地博客预览。
- `./run.sh update`：运行照片更新。

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
- 约定：`go run cmd/static/main.go` 只用于本地调试，并会注入 `local` 数据模式；生产环境不应依赖它来发布摄影数据。
- 约定：`web/ARCHITECTURE.md` 代表当前前端 canonical 目录树，`web/before/` 仅保留兼容跳转。
- 约定：凡是涉及目录重组、前后端分层、运行方式、API 契约、性能模型等较大的变动，都要同步更新 `CHANGELOG.md`，保持变更记录与代码一致。
- 现有注释和 UI 文案中中英文混用较多，新增内容尽量跟随所在文件的既有语言风格。
- 保留用户已经做过的未提交改动，不要回滚不相关文件。

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
