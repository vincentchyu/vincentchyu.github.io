/**
 * Map Sources & Credential Store for Footprint (山河足迹)
 * GIS / Web Mapping Abstraction Layer
 * Supports: OpenFreeMap, Thunderforest, OpenTopoMap, Esri World Imagery, Custom XYZ
 */

(function (global) {
  "use strict";

  /**
   * 1. 凭据存储器 (Credential Store)
   * 纯前端保存在用户浏览器的 localStorage，保证 GitHub Pages 源码零 Token 泄露
   */
  const CredentialStore = {
    KEYS: {
      THUNDERFOREST: "map-token-thunderforest",
      STADIA: "map-token-stadia",
      MAPBOX: "map-token-mapbox",
      CUSTOM_SOURCES: "map-custom-sources",
      ACTIVE_THEME: "map-active-theme",
      OVERLAYS_CONFIG: "map-overlays-config",
    },

    get(key) {
      try {
        return localStorage.getItem(key) || "";
      } catch (_) {
        return "";
      }
    },

    set(key, value) {
      try {
        if (value) {
          localStorage.setItem(key, value.trim());
        } else {
          localStorage.removeItem(key);
        }
      } catch (_) {}
    },

    remove(key) {
      try {
        localStorage.removeItem(key);
      } catch (_) {}
    },

    getCustomSources() {
      try {
        const raw = localStorage.getItem(this.KEYS.CUSTOM_SOURCES);
        return raw ? JSON.parse(raw) : [];
      } catch (_) {
        return [];
      }
    },

    saveCustomSource(source) {
      try {
        const list = this.getCustomSources().filter((s) => s.id !== source.id);
        list.push(source);
        localStorage.setItem(this.KEYS.CUSTOM_SOURCES, JSON.stringify(list));
      } catch (_) {}
    },

    removeCustomSource(id) {
      try {
        const list = this.getCustomSources().filter((s) => s.id !== id);
        localStorage.setItem(this.KEYS.CUSTOM_SOURCES, JSON.stringify(list));
      } catch (_) {}
    },

    getOverlayConfig() {
      try {
        const raw = localStorage.getItem(this.KEYS.OVERLAYS_CONFIG);
        const parsed = raw ? JSON.parse(raw) : null;
        return {
          tracks: parsed && typeof parsed.tracks === "boolean" ? parsed.tracks : true,
          photos: parsed && typeof parsed.photos === "boolean" ? parsed.photos : true,
          waypoints: parsed && typeof parsed.waypoints === "boolean" ? parsed.waypoints : true,
          provinces: parsed && typeof parsed.provinces === "boolean" ? parsed.provinces : true,
        };
      } catch (_) {
        return { tracks: true, photos: true, waypoints: true, provinces: true };
      }
    },

    saveOverlayConfig(config) {
      try {
        localStorage.setItem(this.KEYS.OVERLAYS_CONFIG, JSON.stringify(config));
      } catch (_) {}
    },
  };

  /**
   * 判断是否本地开发环境
   */
  function isLocalHost() {
    const h = window.location.hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "::1" || h.endsWith(".local");
  }

  /**
   * 2. 内置 Map Providers 注册表
   */
  const BuiltinProviders = {
    // 1. Thunderforest 专业户外地图源 (需 API Token 或走本地代理)
    thunderforest: {
      id: "thunderforest",
      name: "Thunderforest",
      auth: {
        type: "api-key",
        storageKey: CredentialStore.KEYS.THUNDERFOREST,
        paramName: "apikey",
        helpUrl: "https://www.thunderforest.com/docs/apikeys/",
        placeholder: "输入 Thunderforest API Key...",
      },
      styles: [
        {
          id: "dark-topo",
          alias: "tf-dark-topo",
          name: "暗黑地形",
          providerId: "thunderforest",
          icon: "🌙",
          type: "raster",
          category: "outdoor",
          tiles: ["https://tile.thunderforest.com/transport-dark/{z}/{x}/{y}@2x.png?apikey={apikey}"],
          localProxyTiles: ["/api/tiles/transport-dark/{z}/{x}/{y}@2x.png"],
          attribution:
            '&copy; <a href="https://www.thunderforest.com/" target="_blank">Thunderforest</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
          paint: {
            "raster-brightness-max": 0.95,
            "raster-contrast": 0.15,
            "raster-saturation": -0.05,
          },
        },
        {
          id: "outdoor-topo",
          alias: "tf-outdoor-topo",
          name: "等高线",
          providerId: "thunderforest",
          icon: "⛰️",
          type: "raster",
          category: "outdoor",
          tiles: ["https://tile.thunderforest.com/outdoors/{z}/{x}/{y}@2x.png?apikey={apikey}"],
          localProxyTiles: ["/api/tiles/outdoors/{z}/{x}/{y}@2x.png"],
          attribution:
            '&copy; <a href="https://www.thunderforest.com/" target="_blank">Thunderforest</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
          paint: {
            "raster-brightness-max": 0.95,
            "raster-contrast": 0.1,
            "raster-saturation": 0.05,
          },
        },
        {
          id: "cycling",
          alias: "tf-cycling",
          name: "骑行脉络",
          providerId: "thunderforest",
          icon: "🚲",
          type: "raster",
          category: "cycling",
          tiles: ["https://tile.thunderforest.com/cycle/{z}/{x}/{y}@2x.png?apikey={apikey}"],
          localProxyTiles: ["/api/tiles/cycle/{z}/{x}/{y}@2x.png"],
          attribution:
            '&copy; <a href="https://www.thunderforest.com/" target="_blank">Thunderforest</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
          paint: {
            "raster-brightness-max": 0.95,
            "raster-contrast": 0.1,
            "raster-saturation": 0.0,
          },
        },
        {
          id: "landscape",
          alias: "tf-landscape",
          name: "自然地貌",
          providerId: "thunderforest",
          icon: "🌲",
          type: "raster",
          category: "outdoor",
          tiles: ["https://tile.thunderforest.com/landscape/{z}/{x}/{y}@2x.png?apikey={apikey}"],
          localProxyTiles: ["/api/tiles/landscape/{z}/{x}/{y}@2x.png"],
          attribution:
            '&copy; <a href="https://www.thunderforest.com/" target="_blank">Thunderforest</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
          paint: {
            "raster-brightness-max": 0.95,
            "raster-contrast": 0.1,
            "raster-saturation": 0.05,
          },
        },
      ],
    },

    // 2. OpenFreeMap 开源免费地图源 (无需 Token)
    openfreemap: {
      id: "openfreemap",
      name: "OpenFreeMap",
      auth: null,
      styles: [
        {
          id: "openfreemap",
          alias: "ofm-liberty",
          name: "OpenFreeMap",
          providerId: "openfreemap",
          icon: "🗺️",
          type: "raster",
          category: "street",
          tiles: [
            "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
          ],
          attribution:
            '&copy; <a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
          paint: {
            "raster-brightness-max": 0.95,
            "raster-contrast": 0.08,
            "raster-saturation": 0.05,
          },
        },
      ],
    },

    // 3. OpenTopoMap 全球开放地形等高线地图源 (无需 Token)
    opentopomap: {
      id: "opentopomap",
      name: "OpenTopoMap",
      auth: null,
      styles: [
        {
          id: "opentopomap",
          alias: "otm-topo",
          name: "OpenTopoMap",
          providerId: "opentopomap",
          icon: "🏔️",
          type: "raster",
          category: "topographic",
          tiles: [
            "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
            "https://b.tile.opentopomap.org/{z}/{x}/{y}.png",
            "https://c.tile.opentopomap.org/{z}/{x}/{y}.png",
          ],
          maxzoom: 17,
          attribution:
            'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, SRTM | Style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
          paint: {
            "raster-brightness-max": 0.95,
            "raster-contrast": 0.12,
            "raster-saturation": 0.08,
          },
        },
      ],
    },

    // 4. Esri 高清全球卫星影像 (无需 Token)
    esri: {
      id: "esri",
      name: "Esri Satellite",
      auth: null,
      styles: [
        {
          id: "satellite",
          alias: "esri-satellite",
          name: "卫星影像",
          providerId: "esri",
          icon: "🛰️",
          type: "raster",
          category: "satellite",
          tiles: [
            "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          ],
          attribution:
            '&copy; <a href="https://www.esri.com/" target="_blank">Esri</a>, Earthstar Geographics',
          paint: {
            "raster-brightness-max": 0.85,
            "raster-contrast": 0.15,
            "raster-saturation": 0.1,
          },
        },
      ],
    },
  };

  /**
   * 3. MapSourceRegistry 控制器
   */
  const MapSourceRegistry = {
    providers: BuiltinProviders,

    getAllProviders() {
      return Object.values(this.providers);
    },

    getProvider(providerId) {
      return this.providers[providerId] || null;
    },

    getAllStyles() {
      const styles = [];
      Object.values(this.providers).forEach((p) => {
        if (p.styles) {
          styles.push(...p.styles);
        }
      });

      // 追加自定义 XYZ 源
      const customs = CredentialStore.getCustomSources();
      customs.forEach((c) => {
        styles.push({
          id: c.id,
          name: c.name,
          providerId: "custom",
          icon: "🌐",
          type: "raster",
          category: "custom",
          tiles: [c.url],
          attribution: c.attribution || "Custom Tile Layer",
          paint: {
            "raster-brightness-max": 0.95,
            "raster-contrast": 0.1,
          },
        });
      });

      return styles;
    },

    getStyle(styleId) {
      if (!styleId) return null;
      for (const p of Object.values(this.providers)) {
        if (!p.styles) continue;
        const found = p.styles.find((s) => s.id === styleId || s.alias === styleId);
        if (found) return found;
      }

      // 检查自定义源
      const customs = CredentialStore.getCustomSources();
      const customFound = customs.find((c) => c.id === styleId);
      if (customFound) {
        return {
          id: customFound.id,
          name: customFound.name,
          providerId: "custom",
          icon: "🌐",
          type: "raster",
          category: "custom",
          tiles: [customFound.url],
          attribution: customFound.attribution || "Custom Tile Layer",
          paint: {
            "raster-brightness-max": 0.95,
            "raster-contrast": 0.1,
          },
        };
      }

      return null;
    },

    /**
     * 解析最终可用的瓦片 URLs 列表，处理 Token 注入与本地代理回退
     */
    resolveTiles(style) {
      if (!style) return [];

      // 1. 如果是本地环境，且该源配置了 localProxyTiles
      if (isLocalHost() && style.localProxyTiles && style.localProxyTiles.length > 0) {
        return style.localProxyTiles;
      }

      const provider = this.getProvider(style.providerId);
      let apikey = "";
      if (provider && provider.auth && provider.auth.storageKey) {
        apikey = CredentialStore.get(provider.auth.storageKey);
      }

      return style.tiles.map((url) => {
        if (url.includes("{apikey}")) {
          // 如果没有 apikey，则保留原串或者去除参数
          return url.replace("{apikey}", encodeURIComponent(apikey || ""));
        }
        return url;
      });
    },

    /**
     * 校验某个 Style 当前是否具备访问凭据（或无需凭据）
     */
    hasValidAuth(style) {
      if (!style) return false;
      const provider = this.getProvider(style.providerId);
      if (!provider || !provider.auth) return true; // 无需 Token

      if (isLocalHost() && style.localProxyTiles) return true; // 本地代理可用

      const token = CredentialStore.get(provider.auth.storageKey);
      return Boolean(token && token.length > 0);
    },

    /**
     * 默认首选底图计算规则：
     * 1. 优先读取 localStorage 中的上次选择；
     * 2. 若当前为本地开发环境，使用 dark-topo；
     * 3. 若在生产静态 GitHub Pages 环境且未配置 Thunderforest Token，则平滑首选无需 Token 的 openfreemap 或 opentopomap；
     * 4. 否则默认 dark-topo。
     */
    getDefaultThemeId() {
      const saved = CredentialStore.get(CredentialStore.KEYS.ACTIVE_THEME);
      if (saved && this.getStyle(saved)) {
        return saved;
      }

      if (isLocalHost()) {
        return "dark-topo";
      }

      const hasTfToken = CredentialStore.get(CredentialStore.KEYS.THUNDERFOREST);
      if (hasTfToken) {
        return "dark-topo";
      }

      // 生产环境无 Token 时首选开放地形或开源地图
      return "opentopomap";
    },

    /**
     * 判断是否为本地环境
     */
    isLocalHost() {
      return isLocalHost();
    },

    /**
     * 注册/覆盖 Provider
     */
    registerProvider(provider) {
      if (!provider || !provider.id) return;
      this.providers[provider.id] = provider;
    },
  };

  // 挂载到全局 window 对象
  global.CredentialStore = CredentialStore;
  global.MapSourceRegistry = MapSourceRegistry;
})(typeof window !== "undefined" ? window : globalThis);
