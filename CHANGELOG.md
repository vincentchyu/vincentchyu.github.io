# Changelog

## 2026-08-27

### 新功能 & 界面体验优化

- **山河足迹全场景运动与大交通色彩矩阵升级 (`web/tracks/`)**：
  - **符合全球户外与运动标准的色彩系统**：
    - 🏕️ **徒步 (Hiking)**：探险暖橙 (`#ff7a00`) —— 象征高山帐篷营地、探索与生命力救援（作为全景核心主角高亮）。
    - ⛰️ **越野跑 (Trail Running)**：熔岩烈红 (`#ef4444`) —— 象征心率极限、山径红土与野性竞技。
    - 🏃 **路跑 (Running)**：电光青蓝 (`#00d2ff`) —— 象征公路晨曦、清爽配速与沉稳耐力。
    - 🚲 **骑行 (Cycling)**：穿梭翠绿 (`#10b981`) —— 象征环法绿衫、林道破风与自然流线。
    - 🚶 **行走 (Walking)**：薄荷浅青 (`#14b8a6`) —— 象征生活步履、城市漫游与轻柔放松。
    - 🚙 **驾车 (Driving)**：公路洋红 (`#ec4899`) —— 与徒步暖橙形成 300° 绝对色相差，彻底避免长途公路轨迹压制高山徒步。
    - 🚆 **火车 (Train)**：极光星轨紫 (`#a855f7`) —— 象征铁轨大动脉、时空穿梭与大地图穿透力。
    - ✈️ **飞机 (Flight)**：苍穹冰蓝 (`#38bdf8`) —— 象征云海巡航、高空俯瞰与跨洋大圆航线。
  - **大交通与智能分类解析扩展 (`internal/track/`)**：
    - `ActivityType` 枚举与 `parser.go` 智能推断器支持 `flight` (飞机)、`train` (火车)、`driving` (驾车)。
    - 顶部分类 Tab 与全景底图智能推荐联动，大交通模式下推荐搭配 Esri 高清卫星底图。
  - **后端逆地理编码提取城市/地区属性 (`internal/track/`)**：
    - 扩展 `TrackManifestItem`、`TrackDetail` 与 `OverviewFeatureProps` 数据模型，新增 `City` 字段。
    - 升级全内存 3D KD-Tree 逆地理编码引擎提取规范化城市/地区名称（如 `阿坝州`、`广州`、`拉萨`、`林芝`、`深圳` 等），直辖市自动对齐规范。
    - 运行 `update-tracks` 全量更新 `manifest.json`、`overview.geojson` 与 `tracks/*.json` 分片。
  - **前端卡片右上角信息升维（运动类型 -> 城市/地区徽章）**：
    - 移除了卡片右上角与左侧颜色条、分类 Tab 冗余的运动类型胶囊，替换为清晰的城市/地区标签（如 `阿坝州`、`广州`、`拉萨` 等），悬停提供 `省份 · 城市` 完整信息提示。
    - 侧边栏搜索框深度支持按城市名称（如搜索“阿坝”、“广州”）即时模糊匹配与筛选。
  - **轻量级标准省级行政区划 GeoJSON (`web/tracks/data/provinces.geojson`)**：
    - 引入并抽稀全国 34 个省级行政区划矢量多边形数据（~360KB），包含 `name`、`short_name` 与 `adcode`，与轨迹元数据 `province` 实现精准匹配。
  - **多层地图底图暗化与点亮图层体系**：
    - `province-base-line`：提供全国省份微暗暗色细轮廓基底。
    - `province-dim-fill`（未探索区域压暗遮罩）：针对 OpenTopoMap 等高线底图过于鲜艳导致省份不清晰的问题，对未点亮区域覆盖半透明暗调遮罩（Fog of War 压暗 40%），大幅弱化未点亮区域的刺眼等高线，营造深邃探索对比。
    - `province-highlight-fill`：对点亮省份绘制明亮的主题色微透光晕面（徒步翡翠绿、越野跑燃橙、路跑电光蓝等）。
    - `province-highlight-casing` + `province-highlight-line`（复合高对比度发光边界）：采用 4px 深黑保护边 + 2.2px 荧光发光芯线，彻底杜绝与复杂等高线撞色隐形。
  - **双向独立开关控制与持久化 (Toggle Control & Persistence)**：
    - **顶部 HUD 快捷微胶囊**：点击 `🗺️ 点亮 X 个省份` 即可一键自由开启/关闭省份点亮效果（带悬停与激活态动效）。
    - **图层下拉菜单控制**：在“图层”菜单中增加 `🗺️ 点亮探索省份` 复选框，开关状态自动持久化至本地存储，关闭时呈现 100% 原始纯净底图与等高线细节。
  - **分类切换与 HUD 统计毫秒级时空对齐**：
    - 点击全部、徒步、越野跑、路跑、骑行等分类或搜索时，地图高亮省份与顶部 HUD `🗺️ 点亮 X 个省份` 瞬间动态同步。

- **山河足迹轨迹列表 UI 精品化与运动强度梯度色彩系统 (`web/tracks/`)**：
  - **视觉降噪与标准文字颜色统一**：
    - 全面剔除轨迹卡片内冗余杂乱的 Emoji 表情（📅、📍、▲、❤️、📷 等），消除视觉干扰。
    - 标题、日期、爬升、照片计数统一使用沉稳的中性字体颜色（严格适配日间浅色模式与夜间深色模式）。
    - 运动类型 Badge 转为低调克制的中性胶囊设计，聚焦核心运动数据。
  - **多运动类型里程与平均心率强度梯度系统 (Tier 0 ~ Tier 6)**：
    - **跑步 (Running)**：
      - 公里数：$f(n) = 10 \times (n + 1)$（10KM \ 20KM \ 30KM \ 40KM \ 50KM \ 60KM）
      - 平均心率：[120, 140, 170, 180] bpm
    - **徒步 (Hiking)**：
      - 公里数：$f(a) = 5 \times (a + 2) \times (a + 1)$（10KM \ 30KM \ 60KM \ 100KM \ 150KM \ 210KM）
      - 平均心率：[120, 140, 170, 180] bpm
    - **越野跑 (Trail Running)**：
      - 公里数：$f(a) = 10 \times (a + 2) \times (a + 1)$（20KM \ 60KM \ 120KM \ 200KM \ 300KM \ 420KM）
      - 平均心率：[120, 140, 170, 180] bpm
  - **日间与夜间微胶囊高对比度色彩适配**：
    - 为 Tier 0 至 Tier 6 配置两套语义化 CSS 变量（`--tier-0-color` 至 `--tier-6-color` 及配套微透背景与边框），在白昼底色和暗黑夜间底色下均具备极佳辨识度与阅读舒适度。

- **基于离线逆地理空间属性的智能运动类型判定引擎 (`internal/track`)**：
  - **城市生活区与野外空间语义多维融合**：
    - 结合全内存 3D KD-Tree 逆地理编码引擎提供的 `FeatureClass`（`P`: 城镇居民点 / `T`: 山峰山地 / `L`: 风景区）及到城镇中心的物理大圆距离（`DistanceKm`），实现经纬度空间语义环境判定。
  - **城市环境散步/行走抗漂移优化**：
    - 处于城市/城镇生活区（`DistanceKm <= 5km` 且非山脉）时，自动放宽平地散步的爬升与坡度容差（爬升 $< 350\text{m}$ 且 坡度 $\le 45\text{m/km}$ 均判定为 `walking`），有效过滤因城市过街天桥、平缓起伏以及高原/开阔地区 GPS 气压高度计漂移带来的虚假爬升误判。
    - 仅当城市内部登山爬坡（爬升 $\ge 350\text{m}$ 且 坡度 $> 45\text{m/km}$）或处于野外/荒野环境且具备爬升时，才判定为 `hiking`（徒步/登山）。

- **GPX 轨迹时空冲突检测与高保真双向融合插值引擎 (`internal/track`, `cmd/scan-tracks`, `cmd/merge-tracks`)**：
  - **时空冲突扫描与结构化清单生成 (`cmd/scan-tracks`)**：
    - 基于时空包围盒与时间交集比例算法，智能检测正式包（`~/.config/gpx/`）与预备包（`pending/`）之间的重叠关联，自动识别 `EXACT_MATCH`（1对1重复）、`SUB_TRACK`（1对N多日大线覆盖单日分段）与 `PARTIAL_OVERLAP`。
    - 自动输出结构化清单 `conflicts-manifest.json` 与 Markdown 详尽对比报告 `conflicts-report.md`。
  - **双向经纬度互补与心率线性时空插值合并 (`cmd/merge-tracks`)**：
    - **经纬度相互弥补**：对两份或多份重合轨迹按时间戳融合，以主轨迹为空间骨架，自动识别信号中断盲区平滑补入点位，杜绝乒乓抖动与虚假里程。
    - **🍎 苹果高精优先模式 (`--prefer-apple` / `--apple-primary`)**：支持使用 Apple Watch 的 1Hz 双频高精点位与原生心率作为绝对主骨架，多日/多次锻炼之间的间隙由两步路点位无缝桥接缝合，保留大活动名称与地名。
    - **心率连续插值**：在 5 分钟可信时间窗口内运用线性时空插值算法（Linear Time Interpolation）将瞬时心率连续注入到每个轨迹点中。
    - **指定与批量合并**：支持 `--hiking`、`--running`、`-id <GroupID>`、`-name <Keyword>`、`-all`、`-dry-run`，并自动对原文件备份（`.bak`）且将被合并的预备包归档至 `archive/`。

## 2026-08-26

### 新功能 & 架构重构

- **山河足迹全景渐进式分层加载与首屏性能架构重构 (`internal/track` & `web/tracks/`)**：
  - **三层渐进式加载架构 (Three-Tier Progressive Loading Pipeline)**：
    - **第 1 层（首屏秒开，~40KB）**：`manifest.json` 彻底剔除大体积坐标数组，转为极轻量纯元数据清单，包含 ID、标题、类型、里程、心率、时长与 BBox，实现左侧列表与顶部 HUD 统计瞬间毫秒级秒开呈现。
    - **第 2 层（全景底网异步加载，~140KB）**：单独生成 `web/tracks/data/overview.geojson`，由 Go 工具链聚合所有具备轨迹的活动骨架线段；前端首屏渲染后异步非阻塞拉取，丝滑浮现全国山河足迹脉络。
    - **第 3 层（单条高保真按需加载）**：点击卡片时才按需请求 `tracks/{id}.json`，获取 2.5 米高精度点位、等距高程心率剖面与沿途摄影作品。
  - **动态联动过滤与自适应视野**：
    - 切换运动分类或搜索路线时，前端基于 `overview.geojson` 内存数据即刻同步过滤底网线段并自适应缩放地图视野，无需发起额外网络请求。

- **短途跑步与行走隐私保护与轻量化统计重构 (`internal/track` & `web/tracks/`)**：
  - **家庭周边隐私安全防护机制 (Privacy-Preserving Track Policy)**：
    - 针对跑步（`running` 低于 10km）与城市行走（`walking` 低于 5km）的短途记录，主动剥离经纬度点位、抽稀坐标和详细高程剖面，杜绝暴露起终点及家庭住址周边轨迹路线。
    - 达到阈值（跑步 ≥ 10km、行走 ≥ 5km）或山野户外类型（如越野跑、徒步、登山、骑行、自驾）完整解析并展示 WebGL 轨迹与高程剖面。
  - **统一 `has_track` 标志与数据契约**：
    - `TrackManifestItem` 与 `TrackDetail` 新增 `has_track: bool` 标识。
    - 短途隐私记录 `has_track: false`，不生成冗余详情分片 JSON 文件（节约磁盘与网络开销 80%+），起终点与 BoundingBox 安全置零。
  - **总里程与分类里程 100% 统计无损保留**：
    - 隐私保护记录仍完整保留总公里数（`distance_km`）、平均心率（`avg_hr`）、最大心率（`max_hr`）、总时长（`duration_s`）与均速。
    - 该里程与活动次数完整计入对应运动类型（`running`/`walking`）及全站足迹总公里数。
  - **前端差异化状态渲染与不可点击约束 (`web/tracks/tracks.js` & `tracks.css`)**：
    - 轨迹列表针对 `has_track: false` 卡片渲染浅灰「仅统计」徽章，光标呈现默认状态并禁用点击查看轨迹与地图定位，防止误触。
    - 全景底图（`all-tracks`）自动过滤无轨迹数据，自适应包围盒（`fitAllTracks`）智能排除 0 坐标干扰。

- **山河足迹全底图自适应三层复合轨迹渲染体系 (`web/tracks/tracks.js`)**：
  - **三层高保真立体渲染架构 (Casing + Glow + Core)**：
    - 底层高对比度描边 (`selected-track-casing`，9px 深黑半透明轮廓 `#090d16`)：构建坚固轮廓边界，彻底根除在浅色等高线（OpenTopoMap）或浅白街道（OpenFreeMap）底图上因纯白核心线导致的撞色隐形问题。
    - 中层运动专属高饱和发光晕 (`selected-track-glow`，6px 荧光绿/燃橙/极光紫/琥珀金)。
    - 顶层立体发光芯线 (`selected-track-core`，2.5px 纯白高亮光芯)，形成激光脉络般的立体视觉穿透力。
  - **底图层级硬隔离 (`switchTheme`)**：底图栅格瓦片严格插入在所有 GeoJSON 轨迹图层之下，杜绝底图热切换时遮挡轨迹线条。

- **路线详情 HUD 收起折叠与悬浮呼出重构 (`web/tracks/`)**：
  - **收起不销毁轨迹焦点**：点击底部高程剖面 HUD 的 `✕` 时，保留当前轨迹高亮图层、沿途相机图钉与地图焦点。
  - **悬浮唤起按钮 (`.profile-toggle-btn`)**：收起后在底部浮现类似轨迹列表的悬浮按钮（如 `📊 孟克特古道`），点击随时重新滑出展开高程剖面、运动指标与胶片相册。

- **全屏沉浸模式与视口自适应修复**：
  - **样式权重强覆盖**：为 `.footprint-workspace.is-fullscreen` 赋予强约束 `!important`，彻底消除动态计算行内高度造成的屏幕底部黑边死区，实现真正的 100% 满屏 WebGL 渲染。
  - **生命周期状态机与 ESC 支持**：重构 `setFullscreenMode`，退出全屏自动恢复垂直滚动并重算视口高度，支持按下 `ESC` 键快捷退出。

- **全站统一摄影数据源与媒体 URL 解析公共组件 (`web/shared/scripts/photo-source.js`)**：
  - **动态数据源联动 (Dynamic Source Resolution)**：彻底消除在业务页面硬编码火山引擎 TOS 或 Cloudflare R2 域名的做法，根据线上 `pages/gallery-source.json`（或本地 `web/photography/data/gallery-source.json`）动态确定当前活跃源（`active_source: "r2" | "tos"`）与对应 Public Base URL。
  - **缩略图极速分级加载规范 (WebP Thumbnail First)**：针对地图弹窗、胶片轮播栏等预览场景，一律优先拉取高压缩比的 WebP 缩略图（`pages/thumbnails/*.webp`，约 100KB 毫秒级秒开），大图灯箱（Lightbox）按需加载 4K 原片，提供双 CDN 互相容灾降级（Fallback）。
  - **生命周期就绪保障**：`loadManifest` 与 `selectTrack` 显式 `await ensureSourceConfig()`，确保渲染前活跃源 100% 就绪；`getDataUrl` 绝对路径加固防止路由末尾缺斜杠导致 404。
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
