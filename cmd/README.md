# 🛠️ 个人网站 CLI 工具集使用指南 (Command-Line Tools)

本目录（`cmd/`）包含了全站数据处理、GPX 轨迹分析与融合、相册构建、本地预览和管理后台的核心 Go 工具链。

---

## 🧭 一、 山河足迹（FOOTPRINT）轨迹工具链

用于处理正式包（`~/.config/gpx/`）与预备包（`~/.config/gpx/pending/`）的轨迹时空冲突检测、双向经纬度弥补与心率插值合并、以及全站数据生成。

```
                    ┌─────────────────────────┐
                    │ 预备包 gpx/pending/*.gpx │ (Apple Watch / 运动分段)
                    └───────────┬─────────────┘
                                │
                      [cmd/scan-tracks]  ──► 生成 conflicts-manifest.json & 报告
                                │
                      [cmd/merge-tracks] ──► 双向弥补盲区 + 心率插值
                                │
                    ┌───────────▼─────────────┐
                    │  正式包 gpx/*.gpx       │ (融合后高保真 GPX，备份 .bak)
                    └───────────┬─────────────┘
                                │
                      [cmd/update-tracks] ──► 生成 overview.geojson & tracks/*.json
                                │
                    ┌───────────▼─────────────┐
                    │   山河足迹 WebGL 地图   │
                    └─────────────────────────┘
```

---

### 1. `cmd/scan-tracks`：时空冲突与重叠扫描工具

比对正式包与预备包，基于**时间重叠比例 + 空间包围盒 BoundingBox** 算法，自动识别 `EXACT_MATCH`（1对1重复记录）、`SUB_TRACK`（1对N多日大线覆盖单日分段）和 `PARTIAL_OVERLAP`（部分重叠）。

#### 💡 常用命令示例

```bash
# 1. 全量扫描所有运动类型，生成冲突清单与 Markdown 报告
go run cmd/scan-tracks/main.go

# 2. 仅扫描指定运动类型（推荐使用便捷 Flag）
go run cmd/scan-tracks/main.go --hiking         # 仅扫描徒步
go run cmd/scan-tracks/main.go --running        # 仅扫描路跑
go run cmd/scan-tracks/main.go --cycling        # 仅扫描骑行
go run cmd/scan-tracks/main.go --walking        # 仅扫描城市行走
go run cmd/scan-tracks/main.go --trail-running  # 仅扫描越野跑
go run cmd/scan-tracks/main.go --driving        # 仅扫描自驾

# 3. 使用通用 -type 参数过滤
go run cmd/scan-tracks/main.go -type hiking

# 4. 自定义输入输出路径
go run cmd/scan-tracks/main.go -active ~/.config/gpx -pending ~/.config/gpx/pending -output ~/my-manifest.json -md ~/my-report.md
```

#### 📋 输出产物
- **结构化清单**：`~/.config/gpx/conflicts-manifest.json`（每个冲突组分配唯一 `group_id`）
- **Markdown 详尽报告**：`~/.config/gpx/conflicts-report.md`

---

### 2. `cmd/merge-tracks`：高保真双向融合与心率插值合并工具

针对两步路（路线大线）与 Apple Watch（分段高精/带心率）的特征：
- **经纬度相互弥补（Gap Filling）**：当主轨迹信号中断/盲区（$\Delta t > 15s$），自动提取副轨迹高精点位无缝补入；
- **心率连续插值（Heart Rate Interpolation）**：在 5 分钟可信时间窗内运用**线性时空插值算法**注入心率；
- **安全与归档**：自动备份原正式包文件（`.bak`），并将合并成功的预备包移动到 `archive/`。

#### 💡 常用命令示例

```bash
# 1. 查看所有可合并的冲突组清单 (不执行合并)
go run cmd/merge-tracks/main.go -list
go run cmd/merge-tracks/main.go --hiking -list   # 仅查看徒步类型

# 2. 按运动类型批量合并（先演练，再合并）
go run cmd/merge-tracks/main.go --hiking -dry-run  # 徒步演练模式（不写文件）
go run cmd/merge-tracks/main.go --hiking          # 正式执行徒步合并
go run cmd/merge-tracks/main.go --running         # 批量合并路跑

# 3. 🍎 苹果高精优先模式 (--prefer-apple / --apple-primary) [强力推荐]
# 使用 Apple Watch 1Hz 双频高精点位作为真正的主骨架，多日分段之间的间隙由两步路无缝桥接缝合，保留主文件名与地名
go run cmd/merge-tracks/main.go -name 五台山顺朝台 --prefer-apple
go run cmd/merge-tracks/main.go --hiking --prefer-apple      # 徒步全量按苹果高精合并

# 4. 按名称关键词合并（支持模糊匹配）
go run cmd/merge-tracks/main.go -name 五台山顺朝台 -dry-run  # 演练
go run cmd/merge-tracks/main.go -name 五台山顺朝台          # 正式合并
go run cmd/merge-tracks/main.go -name 喀拉峻

# 5. 按指定组 ID 合并（ID 来自 scan-tracks 导出的清单）
go run cmd/merge-tracks/main.go -id grp_20241002_五台山顺朝台

# 6. 一键合并清单中的全部冲突组
go run cmd/merge-tracks/main.go -all -dry-run
go run cmd/merge-tracks/main.go -all

# 7. 不自动归档 pending 文件（保留在原位）
go run cmd/merge-tracks/main.go --hiking -archive=false
```

---

### 3. `cmd/concat-tracks`：多日分段时序串联工具 (首尾相连拼接大环线)

将按天记录的多个单日/分段 GPX 轨迹（如喀拉峻 D1、D2、D3，或环湖 D1、D2），按照日期与时间戳严格**首尾相连拼接为一个完整的大路线 GPX**。
- **平滑衔接**：自动按开始时间升序排列（D1 -> D2 -> D3），无缝拼接所有经纬度、高程、心率与时间戳；
- **智能转场测距**：自动识别跨天营地夜间停顿，不将过夜产生的跳跃计算为运动里程；
- **自动归档**：合并完成后自动将被合并的单日分段移动至 `archive/`，避免全站总里程与大环线双重统计。

#### 💡 常用命令示例

```bash
# 1. 按关键词匹配多天分段并串联合并（例如喀拉峻 D1/D2/D3）
go run cmd/concat-tracks/main.go -pattern "喀拉峻" -title "喀拉峻全景大环线"

# 2. 模拟演练模式 (不写文件)
go run cmd/concat-tracks/main.go -pattern "喀拉峻" -dry-run

# 3. 自定义输出文件名
go run cmd/concat-tracks/main.go -pattern "喀拉峻" -out "hiking-中国-新疆-喀拉峻全景大环线-20260608.gpx"

# 4. 直接传入多个 GPX 文件路径
go run cmd/concat-tracks/main.go D1.gpx D2.gpx D3.gpx -title "贡嘎大环线"
```

---

### 4. `cmd/update-tracks`：足迹数据生成与流水线

扫描 `~/.config/gpx/` 下的所有正式 GPX 文件：
- 提取高程 Profile、计算爬升下降与均速；
- 执行 **Douglas-Peucker 算法抽稀**（生成 WebGL 极速渲染的轻量全景底网 `overview.geojson`）；
- 结合拍摄时间戳执行**摄影作品时空对齐（Spatio-Temporal Photo Alignment）**；
- 落实短途跑步行走隐私规则（`<10km` 仅保留统计指标，剥离坐标）；
- 生成 `web/tracks/data/manifest.json` 与 `web/tracks/data/tracks/*.json`。

#### 💡 常用命令示例

```bash
# 执行轨迹更新与摄影作品关联对齐
go run cmd/update-tracks/main.go
```

---

## 📷 二、 摄影站点与管理后台工具链

### 1. `cmd/update-photos`：照片扫描与上传流水线
扫描 `web/photography/gallery_images/` 目录下的照片，提取 EXIF 拍摄参数、生成 WebP 缩略图、上传至 Cloudflare R2，并生成分片索引文件。

```bash
go run cmd/update-photos/main.go
```

### 2. `cmd/admin`：照片管理后台服务
启动本地管理后台（默认监听 `http://localhost:3002`），提供分页照片列表、EXIF 查看与批量编辑。

```bash
go run cmd/admin/main.go
```

### 3. `cmd/static`：本地静态预览服务
启动本地静态网页预览服务（默认监听 `http://localhost:3000`），支持直接调试全站页面与本地瓦片代理。

```bash
go run cmd/static/main.go
```

### 4. `cmd/update-neodb`：书影音数据同步
同步 NeoDB 标记的书影音记录到本地数据源。

```bash
go run cmd/update-neodb/main.go
```

---

## 🚀 三、 推荐端到端工作流 (End-to-End Workflow)

当您在户外记录了一条两步路轨迹，同时 Apple Watch 也记录了若干段运动时：

1. **导入预备包**：将 Apple Watch 导出的 GPX 放入 `~/.config/gpx/pending/`；将两步路完整路线放入 `~/.config/gpx/`；
2. **扫描冲突**：
   ```bash
   go run cmd/scan-tracks/main.go --hiking
   ```
3. **执行融合合并**：
   ```bash
   go run cmd/merge-tracks/main.go --hiking
   ```
   *（经纬度盲区自动弥补，Apple Watch 心率完整插值注入主轨迹，预备包自动移入 `archive/` 归档）*
4. **刷新全站足迹数据**：
   ```bash
   go run cmd/update-tracks/main.go
   ```
5. **本地预览**：
   ```bash
   go run cmd/static/main.go
   ```
   打开 `http://localhost:3000/web/tracks/` 即可看到拥有完整大路线、高保真三层发光轨迹与高清心率剖面的全新足迹！
