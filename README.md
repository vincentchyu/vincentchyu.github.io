# Vincent's Personal Website & Blog

<p align="center">
  <img alt="Logo" src="web/before/img/logo1.jpg" width="100">
</p>

<p align="center">
  <strong>程序员 & 尼康摄影师</strong>
</p>

<p align="center">
  <a href="https://blog-vincent.chyu.org">🌐 访问网站</a>
</p>

## 项目概述

这是一个静态生成的个人网站，托管于 GitHub Pages。它不仅是我的技术博客，也是我的摄影作品集展示平台。

主要包含以下部分：
- **Blog**: 技术文章与生活随笔。
- **Photography**: 摄影作品画廊，支持按年份归档、EXIF 信息展示和沉浸式预览。
- **Timeline**: 个人时间轴。

## 技术栈

- **前端**: 原生 HTML/CSS/JavaScript (无重型框架依赖)
- **样式**: Material Design Lite (MDL) + 自定义 CSS
- **交互**: jQuery, Fancybox (画廊), LazyLoad (懒加载)
- **评论**: Valine
- **自动化**: Go (用于照片处理和数据生成)
- **存储**: Cloudflare R2 (图片 CDN)

## 摄影工作流 (Photography Workflow)

摄影板块采用了自动化的工作流来管理大量高画质照片：

1.  **本地管理**: 照片按年份存放在 `web/photography/gallery_images/` 目录。
2.  **自动化处理**: 使用 Go 脚本 (`scripts/update_photos.go`) 扫描目录。
    -   自动提取 EXIF 元数据（光圈、快门、ISO 等）。
    -   自动生成 WebP 格式的高效缩略图。
    -   自动上传原图和缩略图到 Cloudflare R2 对象存储。
3.  **数据驱动**: 脚本生成 `photos.json`，前端通过 JavaScript 动态渲染画廊，无需手动修改 HTML。

### 管理后台 (Admin Panel)

为了更高效地管理照片库，我们开发了一个基于 Web 的本地管理后台：

-   **高性能浏览**: 引入 **虚拟滚动 (Virtual Scrolling)** 技术，轻松流畅地管理数千张照片，大幅降低内存占用。
-   **沉浸式预览**: 支持 R2 原图预览，集成 **平移与缩放 (Pan & Zoom)** 功能，方便检查细节。
-   **实时重建**: 可视化的重建进度与实时日志输出。

详细的脚本使用文档请参考：[scripts/README.md](scripts/README.md)

## 本地开发

### 依赖

- Node.js & npm
- Go (用于运行自动化脚本)
- `exiftool` (用于提取照片元数据 - 脚本会自动尝试安装，或使用 `brew install exiftool` 手动安装)

### 运行

#### 1. 静态网站预览 (Static Site Preview)

运行静态文件服务器，预览网站效果：

```bash
go run cmd/static/main.go
```

访问 `http://localhost:3003` 即可预览。

#### 2. 照片管理后台 (Photo Admin Panel)

运行管理后台，用于上传、管理照片和重建数据：

```bash
go run cmd/admin/main.go
```

访问 `http://localhost:3002` 进入管理后台。

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

-   `init`: 初始化环境。编译二进制文件并生成 macOS 的 LaunchAgent 配置文件，注册到系统服务。
-   `start`: 启动服务。通过 `launchctl` 加载并启动后台服务。
-   `stop`: 停止服务。卸载并停止后台服务。
-   `update`: 手动运行照片库更新逻辑 (执行 `cmd/update-photos`)。

### 目录结构 (`shell/`)

-   `shell/script/`: 包含构建、启动和停止的具体实现脚本。
-   `shell/launch/`: 存放 LaunchAgent 配置文件模板。
-   `shell/bin/`: 存放编译后的二进制文件 (已添加到 `.gitignore`)。

## License

Apache License 2.0
