/**
 * 单元测试: PhotoSource 数据源与媒体 URL 解析引擎
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

// 模拟 DOM window 环境
global.window = {
  location: { hostname: "vincentchyu.github.io" },
  __PHOTO_GALLERY_DATA_MODE__: "remote",
};

// 加载 photo-source.js
const code = fs.readFileSync(path.join(__dirname, "photo-source.js"), "utf8");
eval(code);

const PhotoSource = global.window.PhotoSource;

console.log("=== 开始测试 PhotoSource 统一摄影数据源组件 ===");

// 1. 测试对象导出
assert.ok(PhotoSource, "PhotoSource 模块应当被正确导出挂载");
assert.strictEqual(typeof PhotoSource.resolvePhotoUrls, "function", "resolvePhotoUrls 必须是函数");
console.log("✅ PASS: PhotoSource 导出结构正确");

// 2. 模拟相片数据
const testPhoto = {
  filename: "DSC_2026-06-10_8849.jpg",
  thumbnail: "pages/thumbnails/a1b2c3d4.webp",
  original: "pages/originals/2026/DSC_2026-06-10_8849.jpg",
  time: "2026-06-10 14:30:00",
};

// 3. 测试解析
const urls = PhotoSource.resolvePhotoUrls(testPhoto);
assert.ok(urls.thumb.includes("pages/thumbnails/a1b2c3d4.webp"), "缩略图必须使用 WebP 缩略图路径");
assert.ok(urls.full.includes("pages/originals/2026/DSC_2026-06-10_8849.jpg"), "大图必须使用原图路径");
assert.ok(urls.fallbackThumb.length > 0, "必须提供容灾备用缩略图");
assert.ok(urls.fallbackFull.length > 0, "必须提供容灾备用大图");
console.log("✅ PASS: resolvePhotoUrls 成功根据动态源构建 thumb 与 full URL:", urls.thumb);

// 4. 测试本地模式
global.window.__PHOTO_GALLERY_DATA_MODE__ = "local";
const localUrls = PhotoSource.resolvePhotoUrls(testPhoto);
assert.ok(localUrls.full.includes("/web/photography/gallery_images/2026/DSC_2026-06-10_8849.jpg"), "本地模式大图必须使用本地路径");
console.log("✅ PASS: 本地模式下 resolvePhotoUrls 正确优先使用本地画廊路径");

console.log("\n🎉 PhotoSource 所有单元测试均已成功通过！");
