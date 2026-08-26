# 🌲 山河足迹（FOOTPRINT）数字资产地图全栈设计与实施方案

## 1. 目标与定位 (Vision & Core Architecture)

将个人所有户外与出行轨迹（徒步、越野跑、路跑、骑行、自驾、行走、旅行等）转化为高质量的个人**数字足迹资产（Footprint Digital Assets）**，并与全站摄影作品完成时空闭环联动。

### 核心决策与已落地特性
1. **两阶段轨迹管理流水线 (Two-Stage Workflow)**：
   - **待整理池 (`~/.config/gpx/pending/`)**：`go run cmd/update-tracks/main.go --suggest-rename [--run]` 自动扫描，联动本地 `photools geodata` 3D KD-Tree 逆地理编码引擎反查省市并执行预重命名；
   - **人工审核与移动**：用户微调后移动至正式目录 `~/.config/gpx/`；
   - **正式目录独立扫描**：`go run cmd/update-tracks/main.go` 严格仅扫描 `~/.config/gpx/` 根目录（跳过 `pending/`），杜绝脏数据污染。
2. **标准 5 段文件名精准拆解与人工干预优先 (Human-in-the-Loop Override)**：
   - 严格按 `{运动类型}-{国家}-{省份}-{路线/地点名称}-{YYYYMMDD}.gpx` 拆解属性；
   - 提取纯净路线标题（去除下划线与多余前缀），运动类型与省份 100% 严格使用人工确认结果，杜绝被速度或算法重新推算覆盖。
3. **全底图多图源抽象层与凭据解耦 (`map-sources.js`)**：
   - 专业 GIS 四层架构解耦 (Provider / Style / Overlay / Engine)；
   - 原生接入 **OpenFreeMap**（开源街道/明快风格）、**OpenTopoMap**（全球开放高精度等高线）、**Thunderforest**（暗黑地形、户外等高线、骑行脉络、自然地貌）与 **Esri World Imagery**（全球高分卫星影像）；
   - **静态部署零凭据泄露设计 (`CredentialStore`)**：纯前端将 Thunderforest API Key 等敏感凭据隔离保存在浏览器端 `localStorage`，GitHub Pages 源码不包含任何个人 Key；
   - **底图热插拔与图层保活机制 (Hot Swap)**：切换图源时只替换底层栅格切片源与图层，杜绝调用 `map.setStyle()` 摧毁 GeoJSON 轨迹数据与交互监听，彻底消除图层闪烁与状态重置问题。
4. **全底图自适应高对比度三层复合轨迹渲染体系**：
   - **底层高对比度描边 (`selected-track-casing`)**：9px 深黑半透明轮廓（`#090d16`），在任何浅色、白色等高线底图上构建坚固边缘，彻底根除白底撞色隐形问题；
   - **中层运动主题色立体光晕 (`selected-track-glow`)**：6px 运动分类专属高饱和荧光色（徒步翡翠绿、骑行极光紫、自驾琥珀金、越野跑燃橙）；
   - **顶层立体芯线 (`selected-track-core`)**：2.5px 亮白发光芯线，形成立体通透的激光脉络质感。
5. **全站统一摄影数据源公共组件 (`web/shared/scripts/photo-source.js`)**：
   - 全站解耦 TOS/R2 域名硬编码，根据 `gallery-source.json` 动态决定活跃主源（`active_source: "r2" | "tos"`）与对应 Public Base URL；
   - 预览场景优先拉取 WebP 压缩缩略图（`pages/thumbnails/*.webp`，约 100KB 毫秒级秒开），大图灯箱（Lightbox）按需加载 4K 原片，提供双 CDN 互相容灾降级（Fallback）。
6. **路线详情 HUD 折叠收起与悬浮唤起重构**：
   - 点击底部高程剖面 HUD 右上角 `✕` 时，保留当前轨迹高亮图层、沿途相机图钉与地图焦点；
   - 底部浮现悬浮唤起按钮（`📊 路线名称`），点击随时重新滑出展开高程剖面、运动指标与胶片相册。
7. **全屏沉浸模式与 ESC 快捷键**：
   - `!important` 样式强覆盖动态计算行内高度，彻底清除全屏黑边与底部死区；
   - 键盘按下 `ESC` 键即可退出全屏并自动重算视口高度。
8. **日间/夜间双模 UI 与动态统计联动**：
   - 浅色日间（Light Mode）与深色夜间（Dark Mode）自适应毛玻璃主题；
   - 顶部统计条随运动分类 Tab 实时动态聚合计算。

```mermaid
graph TD
    subgraph 轨迹整理与构建流水线 (Go Pipeline)
        A1["待整理池 ~/.config/gpx/pending/"] -->|--suggest-rename| B1["photools geodata<br/>3D KD-Tree 逆地理编码"]
        B1 -->|预重命名建议| A1
        A1 -->|人工微调后移动| A2["正式库 ~/.config/gpx/"]
        A2 -->|标准5段文件名拆解| P1["cmd/update-tracks"]
        PH["摄影库 web/photography/data/photos/*.json"] -->|时空双重锚定| P1
        P1 -->|Douglas-Peucker 抽稀| OUT["生成分片<br/>manifest.json & tracks/{id}.json"]
    end

    subgraph 前端渲染与交互 (MapLibre GL & Web)
        OUT --> MAP["MapLibre GL WebGL 地图"]
        SRC["map-sources.js<br/>(OpenFreeMap / OpenTopoMap / Thunderforest / Esri)"] --> MAP
        PHOTO["photo-source.js<br/>(动态 CDN 决策 & WebP 缩略图优先)"] --> MAP
        MAP --> RENDER["三层高对比度轨迹 (Casing + Glow + Core)"]
        RENDER --> UI["双向联动 HUD (高程/心率) + 📷 胶片条 & 大图灯箱"]
    end
```

---

## 2. 数据流水线与规范契约 (Pipeline Architecture)

### 2.1 存储与文件命名规范
- **待整理池**：`~/.config/gpx/pending/`
- **正式 GPX 存放目录**：`~/.config/gpx/`（仅根目录，不递归扫描子文件夹）
- **标准 5 段命名格式**：
  ```
  {运动类型}-{国家}-{省份}-{路线/地点名称}-{YYYYMMDD}.gpx
  ```
  *示例：`徒步-中国-新疆-孟克特古道-20260614.gpx`*
- **相册元数据输入路径**：`web/photography/data/photos/*.json`
- **分片产物输出目录**：`web/tracks/data/manifest.json` 与 `web/tracks/data/tracks/{id}.json`

### 2.2 核心算法与数据模型
- **Haversine 大圆距离**：计算累计里程与瞬时距离。
- **Douglas-Peucker 智能抽稀**：
  - 全景底图（Manifest）：8 米容差，将整体数据量压缩 80% 以上，保证全景首屏秒开；
  - 详情分片（TrackDetail）：2.5 米容差，完整保留山野细节、高程与逐点心率。
- **摄影时空匹配引擎 (`photo_matcher.go`)**：
  - 提取照片 EXIF 时间戳与 DMS 经纬度；
  - 若照片无 GPS，根据时间在轨迹坐标中做线性插值计算经纬度；
  - 接入全站公共 `PhotoSource` 组件实现动态 CDN 解析与多级回退。

---

## 3. 前端架构与视觉规范 (UI/UX Specification)

### 3.1 模块与文件组成
- `web/tracks/index.html`：山河足迹页面骨架与 UI 组件；
- `web/tracks/tracks.css`：日间/夜间双模自适应毛玻璃设计系统；
- `web/tracks/tracks.js`：MapLibre 地图控制器、高程 Canvas HUD、图层控制与交互状态机；
- `web/tracks/map-sources.js`：多图源注册表（`MapSourceRegistry`）与客户端凭据隔离管理（`CredentialStore`）；
- `web/tracks/test-map-sources.js`：图源注册、解析与凭据管理单元测试套件；
- `web/shared/scripts/photo-source.js`：全站统一摄影数据源与媒体 URL 解析引擎；
- `web/shared/scripts/test-photo-source.js`：摄影数据源动态解析单元测试套件。

### 3.2 交互规范
- **全底图高对比度渲染**：9px 深黑描边 + 6px 运动主题色 + 2.5px 纯白发光芯线，在暗黑、等高线、明快街道和卫星图下均清晰立体；
- **HUD 折叠与悬浮唤起**：关闭按钮 `✕` 保留高亮与图钉，底部浮现悬浮呼出按钮，随时一键重新展开；
- **双向联动高程 HUD**：Canvas 渐变图与地图光标实时同步，支持展开沿途作品胶片相册；
- **原生大图灯箱预览**：点击地图相机图钉或胶片条可呼出大图弹窗，支持 EXIF 参数查看与 ESC 快捷退出。
