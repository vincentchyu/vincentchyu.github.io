# Changelog

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
