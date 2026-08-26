/**
 * PhotoSource - 个人全站统一摄影数据源与媒体 URL 解析引擎
 * 适用于摄影画廊 (Photography)、山河足迹 (Tracks)、管理后台及全站任何消费照片的模块
 */
window.PhotoSource = (() => {
  const DEFAULT_SOURCES = {
    r2: {
      public_base: "https://cdn-photography-img-vincent.chyu.org",
    },
    tos: {
      public_base: "https://photography.tos-cn-guangzhou.volces.com",
    },
  };

  const SOURCE_CONFIG_KEY = "pages/gallery-source.json";
  const LOCAL_CONFIG_PATH = "/web/photography/data/gallery-source.json";

  let sourceConfig = null;
  let configPromise = null;

  // 判断是否为本地环境
  function isLocalHost() {
    const h = window.location.hostname;
    return (
      h === "localhost" ||
      h === "127.0.0.1" ||
      h === "::1" ||
      h.endsWith(".local")
    );
  }

  // 获取数据模式: 'local' 或 'remote'
  function getDataMode() {
    if (window.__PHOTO_GALLERY_DATA_MODE__) {
      return window.__PHOTO_GALLERY_DATA_MODE__;
    }
    return isLocalHost() ? "local" : "remote";
  }

  function joinPublicUrl(base, key) {
    const normalizedBase = String(base || "").replace(/\/+$/, "");
    const normalizedKey = String(key || "").replace(/^\/+/, "");
    if (!normalizedBase) return normalizedKey;
    if (!normalizedKey) return normalizedBase;
    return `${normalizedBase}/${normalizedKey}`;
  }

  function isAbsoluteUrl(value) {
    if (typeof value !== "string" || !value) return false;
    try {
      return new URL(value).protocol.startsWith("http");
    } catch (_) {
      return false;
    }
  }

  // 异步加载数据源配置 (动态根据 JSON 决定当前使用 r2 还是 tos)
  async function ensureSourceConfig() {
    if (sourceConfig) return sourceConfig;
    if (configPromise) return configPromise;

    configPromise = (async () => {
      // 1. 如果在本地开发模式，优先尝试读取本地 /web/photography/data/gallery-source.json
      if (getDataMode() === "local") {
        try {
          const res = await fetch(LOCAL_CONFIG_PATH);
          if (res.ok) {
            const data = await res.json();
            if (data && typeof data === "object" && data.sources) {
              sourceConfig = data;
              return sourceConfig;
            }
          }
        } catch (_) {}
      }

      // 2. 线上模式遍历各候选 Provider 拉取最新源配置
      const candidates = [
        joinPublicUrl(DEFAULT_SOURCES.r2.public_base, SOURCE_CONFIG_KEY),
        joinPublicUrl(DEFAULT_SOURCES.tos.public_base, SOURCE_CONFIG_KEY),
      ];

      for (const url of candidates) {
        try {
          const res = await fetch(url);
          if (res.ok) {
            const data = await res.json();
            if (data && typeof data === "object" && data.sources) {
              sourceConfig = data;
              return sourceConfig;
            }
          }
        } catch (_) {}
      }

      // 3. 兜底默认配置
      sourceConfig = {
        version: "1",
        active_source: "r2",
        sources: DEFAULT_SOURCES,
      };
      return sourceConfig;
    })();

    return configPromise;
  }

  // 获取当前活跃的主源名称 ('r2' 或 'tos')
  function getActiveSourceName() {
    return sourceConfig?.active_source || "r2";
  }

  // 获取指定或活跃源的 Public Base URL
  function getPublicBase(sourceName = getActiveSourceName()) {
    const sources = sourceConfig?.sources || DEFAULT_SOURCES;
    return sources[sourceName]?.public_base || DEFAULT_SOURCES[sourceName]?.public_base || "";
  }

  // 获取备用源名称
  function getBackupSourceName(activeName = getActiveSourceName()) {
    return activeName === "r2" ? "tos" : "r2";
  }

  /**
   * 统一解析照片的缩略图和大图 URL
   * @param {Object} photo 照片对象，支持以下任意字段结构:
   *   - photo.thumbnail: "pages/thumbnails/xxx.webp"
   *   - photo.original / photo.path: "pages/originals/xxx.jpg"
   *   - photo.filename: "DSC_1234.jpg"
   *   - photo.time / photo.date: "2026-06-10 12:00:00"
   * @returns {{ thumb: string, full: string, fallbackThumb: string, fallbackFull: string }}
   */
  function resolvePhotoUrls(photo) {
    if (!photo || typeof photo !== "object") {
      return { thumb: "", full: "", fallbackThumb: "", fallbackFull: "" };
    }

    const year = (photo.time || photo.date || "").substring(0, 4) || "2026";
    const filename = photo.filename || "";

    const activeSource = getActiveSourceName();
    const backupSource = getBackupSourceName(activeSource);

    const activeBase = getPublicBase(activeSource);
    const backupBase = getPublicBase(backupSource);

    const thumbKey = photo.thumbnail || photo.original || photo.path || "";
    const origKey = photo.original || photo.path || photo.thumbnail || "";

    // 本地原图
    const localOriginal = filename ? `/web/photography/gallery_images/${year}/${filename}` : "";

    // 活跃 CDN 源路径
    const remoteActiveThumb = thumbKey ? (isAbsoluteUrl(thumbKey) ? thumbKey : joinPublicUrl(activeBase, thumbKey)) : "";
    const remoteActiveFull = origKey ? (isAbsoluteUrl(origKey) ? origKey : joinPublicUrl(activeBase, origKey)) : "";

    // 备用 CDN 源路径 (容灾)
    const remoteBackupThumb = thumbKey ? (isAbsoluteUrl(thumbKey) ? thumbKey : joinPublicUrl(backupBase, thumbKey)) : "";
    const remoteBackupFull = origKey ? (isAbsoluteUrl(origKey) ? origKey : joinPublicUrl(backupBase, origKey)) : "";

    // 缩略图决策：
    // 无论本地还是线上，预览一律优先使用高效压缩的 WebP 缩略图（~100KB 毫秒级秒开），若无云端则降级到本地
    const thumb = remoteActiveThumb || remoteBackupThumb || localOriginal;
    const fallbackThumb = remoteBackupThumb || localOriginal || remoteActiveThumb;

    // 大图决策：本地开发优先使用本地原图，线上优先使用活跃 CDN 原图
    const full = getDataMode() === "local" && localOriginal ? localOriginal : (remoteActiveFull || remoteBackupFull || localOriginal);
    const fallbackFull = remoteBackupFull || remoteActiveFull || localOriginal;

    return {
      thumb,
      full,
      fallbackThumb,
      fallbackFull,
    };
  }

  // 初始化时自动静默预加载配置
  ensureSourceConfig().catch(() => {});

  return {
    isLocalHost,
    getDataMode,
    ensureSourceConfig,
    getActiveSourceName,
    getPublicBase,
    getBackupSourceName,
    resolvePhotoUrls,
    joinPublicUrl,
    isAbsoluteUrl,
  };
})();
