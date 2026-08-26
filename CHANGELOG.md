# Changelog

## 2026-08-26

### 新功能 & 架构重构

- **全站统一摄影数据源与媒体 URL 解析公共组件 (`web/shared/scripts/photo-source.js`)**：
  - **动态数据源联动 (Dynamic Source Resolution)**：彻底消除在业务页面硬编码火山引擎 TOS 或 Cloudflare R2 域名的做法，根据线上 `pages/gallery-source.json`（或本地 `web/photography/data/gallery-source.json`）动态确定当前活跃源（`active_source: "r2" | "tos"`）与对应 Public Base URL。
  - **缩略图极速分级加载规范 (WebP Thumbnail First)**：针对地图弹窗、胶片轮播栏等预览场景，一律优先拉取高压缩比的 WebP 缩略图（`pages/thumbnails/*.webp`，约 100KB 毫秒级秒开），大图灯箱（Lightbox）按需加载 4K 原片，提供双 CDN 互相容灾降级（Fallback）。
  - **跨页面全站复用**：已无缝接入山河足迹（Tracks）与摄影画廊（Photography），并提供独立单元测试套件 `test-photo-source.js`。

- **山河足迹日间/夜间双模 UI 颜色与对比度重构 (`web/tracks/tracks.css`)**：
  - 全面基于 CSS 变量重构浅色日间（Light Mode）与深色夜间（Dark Mode）自适应主题，侧边栏、卡片、输入框、下拉菜单、高程 HUD 和图源弹窗在白天模式下自动呈现明亮清爽的浅白毛玻璃质感，夜间呈现深邃暗黑磨砂玻璃，彻底解决日夜混杂视觉割裂问题。
  - 高程剖面 Canvas Tooltip 与参考线自适应浅色与深色渲染；运动类型 Tab 切换实时动态联动汇总统计条。

- **山河足迹两阶段轨迹管理工作流与标准文件名精准拆解 (`cmd/update-tracks` & `internal/track`)**：
  - **待整理池与正式目录解耦 (Two-Stage Workflow)**：
    - 阶段一：`go run cmd/update-tracks/main.go --suggest-rename [--run]` 优先扫描待整理池 `~/.config/gpx/pending/`，自动联动本地 `photools geodata` 3D KD-Tree 逆地理编码引擎反查省市并执行预重命名。
    - 阶段二：用户人工微调核对后移动至正式目录 `~/.config/gpx/`。
    - 阶段三：`go run cmd/update-tracks/main.go` 严格仅扫描 `~/.config/gpx/` 根目录（自动跳过 `pending/` 子目录），绝不污染正式数据。
  - **人工干预最高优先级 (Human-in-the-Loop Override)**：
    - 新增标准 5 段文件名解析引擎 (`ParseStandardFilename`)：严格按 `{运动类型}-{国家}-{省份}-{路线/地点名称}-{YYYYMMDD}.gpx` 拆解属性。
    - 路线标题纯净提取（去除下划线与多余前缀，彻底解决列表标题出现前缀串的问题），运动分类、省份与国家 100% 严格使用人工确认结果，杜绝被速度或算法重新推算覆盖。

- **山河足迹（FOOTPRINT）多图源抽象层与凭据解耦架构重构 (`web/tracks/`)**：
  - **专业 GIS 四层架构解耦 (Provider / Style / Overlay / Engine)**：
    - 引入 `map-sources.js` 统一图源注册表 (`MapSourceRegistry`)，将底图提供商、具体风格样式、业务叠加层和 MapLibre GL 渲染引擎彻底解耦。
    - **支持多图源生态**：原生接入 **OpenFreeMap**（开源街道/明快风格）、**OpenTopoMap**（全球开放高精度等高线）、**Thunderforest**（暗黑地形、户外等高线、骑行脉络、自然地貌）与 **Esri World Imagery**（全球高分卫星影像）。
    - **静态部署零凭据泄露设计 (`CredentialStore`)**：纯前端将 Thunderforest API Key 等敏感凭据隔离保存在浏览器端 `localStorage`，GitHub Pages 源码不包含任何个人 Key；支持在本地开发代理模式与线上 Token 模式间智能自适应。
    - **底图热插拔与图层保活机制 (Hot Swap)**：切换图源时只替换底层栅格切片源与图层，杜绝调用 `map.setStyle()` 摧毁 GeoJSON 轨迹数据与交互监听，彻底消除图层闪烁与状态重置问题。
    - **独立业务图层控制 (Overlay Control)**：支持在顶部工具栏中自由开启/关闭「全量轨迹底网」、「沿途摄影图钉」与「起终点标记」，状态持久化存储。
    - **图源配置模态框 (Map Settings Modal)**：提供可视化的 API Token 配置、状态检测（已配置/未配置/本地代理）与自定义 XYZ 切片源扩展能力。
  - **单元测试与质量验证 (`test-map-sources.js`)**：全量覆盖 Provider 注册、Style 检索、Auth 校验、URL 解析与 Token 动态注入。

- 新增 **`FOOTPRINT`（山河足迹）** 轨迹数字资产系统与全屏 WebGL 地图页面 (`web/tracks/`)：
  - **摄影作品与户外轨迹时空自动对齐系统 (Photo & Track Synergy)**：
    - 流水线自动扫描 `web/photography/data/photos/*.json` 中的作品元数据（包含 EXIF 拍摄时间、GPS 经纬度、相机型号与镜头参数）
    - 采用“时空双重锚定 + 轨迹点线性插值”算法，将相册照片精准匹配至对应轨迹（如孟克特古道、赛里木湖、夏特古道、喀拉峻等已精准对齐 58+ 张摄影大片）
    - **双模图片 URL 解析与多级回退机制**：本地开发环境直接读取 `/web/photography/gallery_images/` 原图，线上环境无缝走火山引擎 TOS 与 Cloudflare R2 CDN，附带 `onerror` 自动容灾降级
    - **原生大图灯箱预览 (Photo Lightbox)**：点击地图 📷 相机图钉或底部胶片条，可一键呼出沉浸式大图弹窗，查看 4K 原片、尼康机镜 EXIF 参数与拍摄时间，支持 ESC 键与点击关闭
    - **沿途照片胶片轮播栏 (Photo Strip)**：Profile HUD 支持展开沿途作品胶片相册，点击任意照片地图镜头平滑飞至 (`flyTo`) 拍摄经纬度并高亮弹窗
  - **规范化 UI/UX 架构与导航滚动自由重构**：
    - 完全融入全站 Canonical 页面规范（`site-shell-page`、`site-shell-header` 与 `site-shell-main` 栅格对齐）
    - **平滑双向滚动与顶栏菜单随时访问**：去除强制 body 锁死，恢复全局自然垂直滚动能力，无论页面处于何处均可随时向上滑动看到并点击顶部菜单栏切换页面
    - **动态自适应地图高度计算**：根据当前视口可用空间自动计算地图高度 (`adjustWorkspaceHeight` + `window.onresize`)，在桌面大屏上实现一屏沉浸展示，在笔记本与移动端上实现自然滚动
    - 包含标准的 `h1.footprint-title`、`#site-page-anchor` 锚点联动、分类 Tabs 选项卡与数据概要 Strip，支持一键切换全屏沉浸模式
  - 支持 **暗黑地形 (Dark Topo)**、**户外等高线 (Outdoor Topo)** 与 **卫星影像 (Satellite)** 三重底图无缝实时切换，默认采用高对比度暗黑地形，荧光轨迹极为醒目
  - 实现 **轨迹焦点弱化机制 (Focus Isolation & Dimming)**：点击某条轨迹进入详情时，其余所有背景轨迹自动降色至 0.08 透明度与暗灰低调色，选中轨迹以双层呼吸发光高亮展示，彻底消除视觉杂乱
  - 实现双向联动高程剖面 HUD (Elevation Profile)：Canvas 渲染高程渐变图，鼠标在剖面图上滑动时地图光标与海拔/里程/实时心率气泡实时同步移动
  - 完整解析并持久化运动心率数据（兼容 Garmin / Strava / 两步路等各类 GPX 扩展），在总清单、分片、列表卡片与 Profile HUD 中展示平均心率与最大心率 (bpm)
  - 实现全景足迹热力总览、多运动分类过滤（徒步、越野跑、路跑、骑行、自驾、行走）、关键词搜索与轨迹平滑飞行推进 (FlyTo)
  - 新增 Go 轨迹处理流水线与 CLI (`cmd/update-tracks` 与 `internal/track`)：
    - 读取公共源 `~/.config/gpx/`，支持 Garmin、Strava、两步路等各类 GPX 格式
    - 采用 **Douglas-Peucker 算法** 智能抽稀（全景 8m、详情 2.5m 容差），生成高保真轻量分片 JSON (`web/tracks/data/manifest.json` 与 `tracks/{id}.json`)
    - 采用“规范文件名优先 + XML 元数据/物理特征智能兜底”双模推断运动类型，支持离线省份识别与 `--suggest-rename` 规范命名建议
  - 全站 site-shell 导航栏新增 `FOOTPRINT` 入口，并在主页 `index.html` 整合足迹资产链接与中英文双语适配

## 2026-08-12

### 重构

- 摄影页瀑布流布局架构全面重构为 JS 绝对定位流 (`Absolute Positioned Waterfall`)，废弃原有的列容器 (`.waterfall-column`) 架构：
  - 照片 DOM 卡片改为统一在主容器中按时间序列平铺，通过 `transform: translate3d` 计算 `(x, y)` 坐标，完美支持“从左到右，再逐行”的时间顺序排列
  - 移除有毒的列底部 `.waterfall-column-spacer` 空白垫片，彻底消除分片数据追加时产生的“大片白板未加载”问题
  - 优化 Resize/屏幕断点重排性能：窗口尺寸改变时直接基于 GPU 硬件加速重计算坐标，无需摧毁或拔插 DOM 节点
  - 重构滚动加载哨兵节点 (`sentinel`) 定位机制：使其在数据加载中精确贴合当前已渲染照片的真实底端高度，并在全量年份数据加载完毕后动态卸载预估 `min-height`，彻底消除相册末尾的留白区
- 运行 `go run ./cmd/build-photography-assets` 更新前端压缩产物 `web/photography/dist/gallery.bundle.min.js`，并升级 `index.html` 的资源版本控制后缀

## 2026-07-17

### 新功能

- 新增 `MEDIA JOURNAL` 页面，读取 `web/media/data/{book,movie,tv,music,game,podcast}.json` 并按 NeoDB 分类展示书影音封面墙、评分、记录日期和个人评论
- 新增 `cmd/update-neodb` 数据契约约束与 `.github/workflows/neodb-refresh.yml`，支持每日拉取 NeoDB 记录并在数据变化时提交静态 JSON

### 重构

- 将 NeoDB 更新逻辑从 `cmd/update-neodb` 下沉到 `internal/neodb`，命令入口仅保留环境解析与执行编排；Media 卡片改为展示作品发行/出版日期，标记日期收敛到封面 hover 信息
- 将照片管理后台的共享请求/响应类型与分页 cursor 工具拆出到独立文件，降低 `internal/admin` 单文件职责密度
- 抽出 `web/shared/styles/site-shell.css` 与 `web/shared/scripts/site-shell.js` 作为公开页面统一的 `VINCENT CHYU` 基础导航框架
- 将 HOME、PORTFOLIO、SONIC LENS、DEVELOPER TOOLS、ABOUT ME、CONTACT 接入共享导航，SonicLens 原浮动导航降级为页面二级入口

## 2026-04-20

### 重构

- 摄影页 `gallery.js` 拆分为 `gallery.metadata.js`、`gallery.thumbnail.js`、`gallery.data.js` 与主控脚本，保留原有原生 JS 行为同时降低单文件复杂度
- 摄影页继续将 Fancybox、分享链接、深链打开与 URL 同步逻辑拆入 `gallery.lightbox.js`，主控脚本进一步收敛为编排层
- 摄影页继续将 Tocbot 时间线、scroll sync、hover 展开与 section 跳转逻辑拆入 `gallery.timeline.js`，主控脚本进一步集中在数据与布局编排
- 摄影页继续将瀑布流布局、outline heading、卡片渲染与视口锚点恢复逻辑拆入 `gallery.layout.js`，为后续收敛 loader 状态机做准备
- 摄影页谨慎将 `loadGallery / loadShardedGallery / scheduleYearLoad / loadMoreYears / loadYearShard` 收口到 `gallery.loader.js`，主控脚本保留状态与桥接包装，降低加载状态机的扩散面
- 新增 `go run ./cmd/build-photography-assets` 静态构建命令，将摄影页业务脚本输出为单个压缩产物 `web/photography/dist/gallery.bundle.min.js`
- 新增 `go run ./cmd/build-photography-assets --check`、`./run.sh verify` 与 GitHub Actions 校验流程，把摄影页 bundle 新鲜度检查接入发布前流程
- 摄影首页线上入口改为引用单个 gallery bundle，减少业务脚本请求数；本地 `cmd/static` 预览会自动回退为源码脚本顺序加载，继续直接维护源码
- 摄影页 JS 瘦身策略明确为 bundle + minify + 版本参数缓存失效，不默认引入强混淆

## 2026-04-18

### 重构

- 摄影站图片与分片数据发布链路升级为 `R2 + TOS` 双目标发布，并引入统一对象发布器抽象，支持后续扩展新的对象存储提供方
- 摄影站公开 JSON 改为中立对象 key 结构，移除 `path`、`thumbnail`、`cover` 中写死的远端绝对 URL，为运行时切换国内外源做准备
- 新增 `web/photography/data/gallery-source.json` 与后台 `/api/gallery-source` 接口，支持在管理后台查看当前摄影数据源、校验目标源健康并切换 `R2/TOS`
- 管理后台列表接口新增 `source_urls.r2` / `source_urls.tos` 预览地址，详情预览从 R2-only 语义调整为多源资源预览
- 摄影首页运行时改为先读取 `gallery-source.json` 决定当前远端提供方，并兼容旧版绝对 URL JSON
- 摄影首页首屏 `output.css`、`waterfall.css`、`fancybox`、`metadata panel`、`cplayer` 等静态依赖改为站点同源加载，减少中国访问时对 Cloudflare 的首屏依赖

## 2026-04-14

### 重构

- 统一前端目录树，将 `web/` 收敛为主站 canonical 结构，`web/home`、`web/tools`、`web/legacy`、`web/shared` 完成归位，`web/before/` 降级为兼容跳转层
- 后端入口改为显式根目录解析和依赖注入，照片管理服务拆分为应用层与存储组件，方便后续维护与测试
- 管理后台从全量拉取改为 cursor 分页，前端改为分页加载 + 虚拟滚动 + 事件委托 + 增量状态更新
- 管理后台继续优化浏览体验，加入搜索 debounce、页缓存、轻量 LRU、邻页预取和图片预热，减少来回滚动时的加载闪烁
- 管理后台虚拟滚动底层切换为 vendored `@tanstack/virtual-core`，保留现有原生 JS 结构，减少滚动中图片节点重复重建导致的闪烁
- 摄影站改为首屏按需加载最近年份、滚动触发后续年份分片加载，保留分享深链与时间轴跳转，同时为 manifest 与年份分片启用 CDN 友好的缓存策略
- 摄影站移除未使用的 jQuery 依赖，减少首屏额外脚本开销
- 摄影站将 Fancybox 与 metadata panel 资源改为非首屏按需注入，并在空闲时预热，降低 head 阻塞资源体积
- 摄影站将 `Signika` 字体样式表改为非阻塞加载，并将 preconnect 对齐到实际字体资源域名，继续缩短首屏 head 阻塞链
- 摄影站缩略图改为“首屏少量 eager + 近视口懒加载”，并收紧下一年份分片的预取距离，避免刷新即批量请求全部缩略图
- 摄影站将 `output.css` 与 `waterfall.css` 改为 preload + 延后应用，并内联首页与首批图片所需的 critical CSS，进一步降低首屏样式阻塞
- 摄影站将体积极小的 `fade_in.js`、`menu.js` 合并回页面，去掉额外请求，并移除首页对全页图片的重复淡入扫描
- 摄影站时间线改为 Tocbot 驱动的隐藏语义 heading + 固定左侧目录面板，去掉原先手写 scrollspy/active 状态机，并基于 Tocbot 目录结构重绘更简洁的摄影页侧栏样式
- 摄影站在窄屏设备上默认隐藏并跳过时间线初始化，优先保证移动端看图空间与滚动性能
- `run.sh` 与 macOS 启动脚本改为同时管理后台与本地静态预览，支持一键双服务启动/停止
- 摄影站子页面导航保持一致，补齐了与首页相同的 `SONIC LENS` 菜单入口

## 2025-11-22

### 新功能

- 实现全新的摄影画廊，包含基于 Go 的图像处理、R2 存储以及动态前端展示功能

## 2025-09-02

### 重构

- 将摄影作品按年份分离到独立的 HTML 文件中 (`2023.html`, `2025.html`)
- 修改主 `index.html` 文件，通过 JavaScript 动态加载年份内容
- 添加 `loadYears.js` 脚本处理动态内容加载
- 保持原有页面功能和样式不变

### 目的

- 便于未来按年份管理摄影作品
- 提高代码可维护性
- 为后续功能迭代奠定基础
