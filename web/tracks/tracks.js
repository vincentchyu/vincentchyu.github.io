/**
 * Footprint (Tracks) Map & Elevation Profile Controller
 * Powered by MapLibre GL JS & Multi-Source Map Architecture
 */

(function () {
  let map = null;
  let manifestData = null;
  let overviewGeoJSON = null;
  let activeTrackId = null;
  let activeTrackDetail = null;
    let pendingSelectedTrackDetail = null;
  let currentFilterType = "all";
  let searchQuery = "";
  let is3D = false;
  let isPlaying = false;
  let isFullscreen = false;
  let playAnimationId = null;
  let currentTheme = "dark-topo";
  let mapLayersReady = false;

  // 图层显隐状态配置
  let overlayConfig = {
    tracks: true,
    photos: true,
    waypoints: true,
    provinces: true,
  };

  // 省级行政边界数据
  let provincesGeoJSON = null;

  // 标点与交互光标
  let hoverMarker = null;
  let startMarker = null;
  let endMarker = null;
  let photoMarkers = [];

  // 高饱和度、高对比度的户外荧光色系 (符合全球户外运动标准最佳实践)
  const activityColors = {
    hiking: "#ff7a00",        // 徒步：探险暖橙 (核心主角)
    trail_running: "#ef4444", // 越野跑：熔岩烈红
    running: "#00d2ff",       // 路跑：电光青蓝
    cycling: "#10b981",       // 骑行：穿梭翠绿
    walking: "#14b8a6",       // 行走：薄荷浅青
    driving: "#ec4899",       // 驾车：公路洋红 (与徒步暖橙高对比拉开)
    train: "#a855f7",         // 火车：极光星轨紫
    flight: "#38bdf8",        // 飞机：苍穹冰蓝
    transit: "#a855f7",       // 兼容历史旅行
  };

  const activityLabels = {
    hiking: "徒步",
    trail_running: "越野跑",
    running: "路跑",
    cycling: "骑行",
    walking: "行走",
    driving: "驾车",
    train: "火车",
    flight: "飞机",
    transit: "旅行",
  };

  // 运动与交通场景推荐底图映射
  const activitySuggestedTheme = {
    all: "opentopomap",           // 全部：开放等高线地形
    hiking: "opentopomap",        // 徒步：OpenTopoMap 开放等高线地形
    trail_running: "opentopomap", // 越野跑：OpenTopoMap 开放等高线地形
    running: "openfreemap",       // 路跑：OpenFreeMap 开源街区路网
    cycling: "openfreemap",       // 骑行：OpenFreeMap 开源公路路网
    walking: "openfreemap",       // 行走：OpenFreeMap 开源街区
    driving: "satellite",         // 驾车：Esri 高清卫星影像
    train: "satellite",           // 火车：Esri 高清卫星影像
    flight: "satellite",          // 飞机：Esri 高清卫星影像
    transit: "satellite",         // 兼容旅行：Esri 高清卫星影像
  };

  function normalizeProvince(p) {
    if (!p || typeof p !== "string") return "";
    return p.replace(/(省|市|特别行政区|回族自治区|维吾尔自治区|壮族自治区|自治区)$/, "").trim();
  }

  function getActiveProvinceColor(type = currentFilterType) {
    const isDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (type && activityColors[type]) {
      return activityColors[type];
    }
    return isDark ? "#00d2ff" : "#2563eb";
  }

  function init() {
    // 读取持久化的图层显隐配置
    if (window.CredentialStore) {
      overlayConfig = window.CredentialStore.getOverlayConfig();
      currentTheme = window.MapSourceRegistry.getDefaultThemeId();
    }

    initMap();
    updateActiveBasemapUI(currentTheme);
    bindUIEvents();
    bindSettingsEvents();
    loadManifest();
    loadProvinceBoundaries();
    adjustWorkspaceHeight();
  }

  function adjustWorkspaceHeight() {
    const workspace = document.getElementById("footprint_workspace");
    if (!workspace) return;

    if (workspace.classList.contains("is-fullscreen")) {
      workspace.style.height = "";
      if (map) map.resize();
      return;
    }

    const rect = workspace.getBoundingClientRect();
    const bottomPadding = 20; // 底部安全留白
    const calculatedHeight = Math.max(300, window.innerHeight - rect.top - bottomPadding);
    workspace.style.height = `${calculatedHeight}px`;

    if (map) {
      map.resize();
    }
  }

  function getMapStyleForTheme(themeKey) {
    const style = window.MapSourceRegistry ? window.MapSourceRegistry.getStyle(themeKey) : null;
    const tiles = style && window.MapSourceRegistry ? window.MapSourceRegistry.resolveTiles(style) : ["/api/tiles/transport-dark/{z}/{x}/{y}@2x.png"];
    const attribution = style ? style.attribution : "";
    const paint = style && style.paint ? style.paint : { "raster-brightness-max": 0.95 };

    return {
      version: 8,
      sources: {
        "base-raster-tiles": {
          type: "raster",
          tiles: tiles,
          tileSize: style && style.tileSize ? style.tileSize : 256,
          maxzoom: style && style.maxzoom ? style.maxzoom : 18,
          attribution: attribution,
        },
      },
      layers: [
        {
          id: "base-raster-layer",
          type: "raster",
          source: "base-raster-tiles",
          minzoom: 0,
          maxzoom: 20,
          paint: paint,
        },
      ],
    };
  }

  function initMap() {
    map = new maplibregl.Map({
      container: "map",
      style: getMapStyleForTheme(currentTheme),
      center: [105.0, 35.0],
      zoom: 4,
      pitch: 0,
      bearing: 0,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");

    // 初始样式加载完毕后，创建 GeoJSON 图层并灌入已有数据
    map.on("style.load", () => {
      initMapLayers();
      mapLayersReady = true;
      renderMapTracks();
      applyOverlayVisibility();
        if (activeTrackDetail || pendingSelectedTrackDetail) {
            const detailToRender = activeTrackDetail || pendingSelectedTrackDetail;
            renderSelectedTrackOnMap(detailToRender);
        applyFocusDimming(true);
      }
    });

    // 点击事件代理
    map.on("click", (e) => {
      if (!map.getLayer("all-tracks-core")) return;
      try {
        const features = map.queryRenderedFeatures(e.point, { layers: ["all-tracks-core", "selected-track-core"] });
        if (features && features.length > 0) {
          const id = features[0].properties.id;
          if (id) selectTrack(id);
        } else {
          resetTrackSelection();
        }
      } catch (_) {}
    });

    map.on("mousemove", (e) => {
      if (!map.getLayer("all-tracks-core")) return;
      try {
        const features = map.queryRenderedFeatures(e.point, { layers: ["all-tracks-core"] });
        map.getCanvas().style.cursor = features && features.length > 0 ? "pointer" : "";
      } catch (_) {}
    });
  }

  function updateActiveBasemapUI(themeKey) {
    if (!window.MapSourceRegistry) return;
    const style = window.MapSourceRegistry.getStyle(themeKey);
    if (!style) return;

    // 1. 同步顶层底图切换按钮上的图标与名称
    const iconEl = document.getElementById("active_basemap_icon");
    const nameEl = document.getElementById("active_basemap_name");
    if (iconEl) iconEl.textContent = style.icon || "🗺️";
    if (nameEl) nameEl.textContent = style.name || themeKey;

    // 2. 同步下拉菜单所有项的选中激活状态与勾选标记
    document.querySelectorAll(".theme-btn").forEach((btn) => {
      const isActive = btn.dataset.theme === themeKey || btn.dataset.theme === style.alias;
      btn.classList.toggle("active", isActive);
    });
  }

  function switchTheme(themeKey, promptForAuth = true) {
    if (!window.MapSourceRegistry) return;
    const style = window.MapSourceRegistry.getStyle(themeKey);
    if (!style) return;

    // 检查 Token 授权状态
    const hasAuth = window.MapSourceRegistry.hasValidAuth(style);
    if (!hasAuth && promptForAuth) {
      const provider = window.MapSourceRegistry.getProvider(style.providerId);
      const providerName = provider ? provider.name : style.providerId;
      const proceed = confirm(`图源「${style.name}」需要配置 ${providerName} API Key。\n\n点击“确定”打开图源设置面板进行配置，点击“取消”继续尝试加载。`);
      if (proceed) {
        openMapSettingsModal();
        return;
      }
    }

    currentTheme = themeKey;
    updateActiveBasemapUI(themeKey);

    // 持久化当前选中的主题
    if (window.CredentialStore) {
      window.CredentialStore.set(window.CredentialStore.KEYS.ACTIVE_THEME, themeKey);
    }

    const tiles = window.MapSourceRegistry.resolveTiles(style);

    // 仅替换底层栅格瓦片，不使用 setStyle（保护 GeoJSON 图层与监听器）
    if (map.getLayer("base-raster-layer")) {
      map.removeLayer("base-raster-layer");
    }
    if (map.getSource("base-raster-tiles")) {
      map.removeSource("base-raster-tiles");
    }

    map.addSource("base-raster-tiles", {
      type: "raster",
      tiles: tiles,
      tileSize: style.tileSize || 256,
      maxzoom: style.maxzoom || 18,
      attribution: style.attribution,
    });

      // 找到当前地图中第一个存在的矢量业务图层作为 beforeId，保证 base-raster-layer 永远在最底层
      const businessLayers = [
          "province-base-line",
          "province-dim-fill",
          "province-highlight-fill",
          "province-highlight-casing",
          "province-highlight-line",
          "all-tracks-glow",
          "all-tracks-core",
          "selected-track-casing",
          "selected-track-glow",
          "selected-track-core"
      ];
      let firstTrackLayer = undefined;
      for (let i = 0; i < businessLayers.length; i++) {
          if (map.getLayer(businessLayers[i])) {
              firstTrackLayer = businessLayers[i];
              break;
          }
      }

    map.addLayer(
      {
        id: "base-raster-layer",
        type: "raster",
        source: "base-raster-tiles",
        minzoom: 0,
        maxzoom: 20,
        paint: style.paint || { "raster-brightness-max": 0.95 },
      },
      firstTrackLayer
    );

      // 切换主题后，若当前有选中的轨迹，确保重新渲染高亮与压暗状态
      if (activeTrackDetail) {
          renderSelectedTrackOnMap(activeTrackDetail);
          applyFocusDimming(true);
      }
  }

  async function loadProvinceBoundaries() {
    try {
        const data = await fetchJsonSafe(getDataUrl("data/provinces.geojson"), "data/provinces.geojson");
        provincesGeoJSON = data;
        if (map && map.getSource("china-provinces")) {
            map.getSource("china-provinces").setData(provincesGeoJSON);
        }
        updateHighlightedProvinces();
    } catch (err) {
      console.warn("Failed to load china provinces geojson:", err);
    }
  }

  function initMapLayers() {
    if (!map) return;

    // 0. 省级行政区划与点亮高亮图层组 (位于底图之上，轨迹线之下)
    if (!map.getSource("china-provinces")) {
      map.addSource("china-provinces", {
        type: "geojson",
        data: provincesGeoJSON || { type: "FeatureCollection", features: [] },
      });
    }

    const isDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    const provinceVis = overlayConfig.provinces ? "visible" : "none";

    // 0.1 全国省份基底细轮廓线
    if (!map.getLayer("province-base-line")) {
      map.addLayer({
        id: "province-base-line",
        type: "line",
        source: "china-provinces",
        layout: { "line-join": "round", "line-cap": "round", "visibility": provinceVis },
        paint: {
          "line-color": isDark ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.15)",
          "line-width": 1,
        },
      });
    }

    // 0.2 未点亮省份暗色压暗遮罩层 (Fog of War: 压暗弱化未点亮区域过于鲜艳的等高线底图，凸显点亮省份)
    if (!map.getLayer("province-dim-fill")) {
      map.addLayer({
        id: "province-dim-fill",
        type: "fill",
        source: "china-provinces",
        filter: ["==", ["get", "short_name"], "__none__"],
        layout: { "visibility": provinceVis },
        paint: {
          "fill-color": "#090d16",
          "fill-opacity": isDark ? 0.38 : 0.42,
        },
      });
    }

    // 0.3 点亮省份高光光晕面填充
    if (!map.getLayer("province-highlight-fill")) {
      map.addLayer({
        id: "province-highlight-fill",
        type: "fill",
        source: "china-provinces",
        filter: ["==", ["get", "short_name"], "__none__"],
        layout: { "visibility": provinceVis },
        paint: {
          "fill-color": getActiveProvinceColor(currentFilterType),
          "fill-opacity": isDark ? 0.26 : 0.22,
        },
      });
    }

      // 0.4 点亮省份深色外轮廓描边 (Casing 保护边: 隔绝杂乱底图，防止撞色隐形)
    if (!map.getLayer("province-highlight-casing")) {
      map.addLayer({
        id: "province-highlight-casing",
        type: "line",
        source: "china-provinces",
        filter: ["==", ["get", "short_name"], "__none__"],
        layout: { "line-join": "round", "line-cap": "round", "visibility": provinceVis },
        paint: {
          "line-color": "#000000",
            "line-width": 3,
            "line-opacity": 0.4,
            "line-blur": 1,
        },
      });
    }

      // 0.5 点亮省份鲜艳发光轮廓线 (Core Line: 采用行政边界虚线，清晰与实线运动轨迹区分，防止误认)
    if (!map.getLayer("province-highlight-line")) {
      map.addLayer({
        id: "province-highlight-line",
        type: "line",
        source: "china-provinces",
        filter: ["==", ["get", "short_name"], "__none__"],
        layout: { "line-join": "round", "line-cap": "round", "visibility": provinceVis },
        paint: {
          "line-color": getActiveProvinceColor(currentFilterType),
            "line-width": 1.8,
            "line-opacity": 0.8,
            "line-dasharray": [3, 2],
        },
      });
    }

    // 1. 全局轨迹底图 Source
    if (!map.getSource("all-tracks")) {
      map.addSource("all-tracks", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
    }

    if (!map.getLayer("all-tracks-glow")) {
      map.addLayer({
        id: "all-tracks-glow",
        type: "line",
        source: "all-tracks",
        layout: {
          "line-join": "round",
          "line-cap": "round",
          "visibility": overlayConfig.tracks ? "visible" : "none",
        },
        paint: {
          "line-color": ["get", "color"],
          "line-width": 6,
          "line-opacity": activeTrackId ? 0 : 0.4,
          "line-blur": 3,
        },
      });
    }

    if (!map.getLayer("all-tracks-core")) {
      map.addLayer({
        id: "all-tracks-core",
        type: "line",
        source: "all-tracks",
        layout: {
          "line-join": "round",
          "line-cap": "round",
          "visibility": overlayConfig.tracks ? "visible" : "none",
        },
        paint: {
            "line-color": activeTrackId ? "#475569" : ["get", "color"],
          "line-width": activeTrackId ? 1.5 : 2.5,
            "line-opacity": activeTrackId ? 0.2 : 0.85,
        },
      });
    }

    // 2. 选中单条轨迹高保真发光与高对比度三层图层体系 (兼容暗黑、等高线、街道、卫星全底图)
    if (!map.getSource("selected-track")) {
      map.addSource("selected-track", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
    }

    // 2.1 底层高对比度轮廓描边 (深色保护边，解决等高线等浅色底图撞色隐形问题)
    if (!map.getLayer("selected-track-casing")) {
      map.addLayer({
        id: "selected-track-casing",
        type: "line",
        source: "selected-track",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#090d16",
          "line-width": 9,
            "line-opacity": 0.8,
          "line-blur": 2,
        },
      });
    }

    // 2.2 中层运动类型鲜艳主题色光晕
    if (!map.getLayer("selected-track-glow")) {
      map.addLayer({
        id: "selected-track-glow",
        type: "line",
        source: "selected-track",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
            "line-color": ["coalesce", ["get", "color"], "#ff7a00"],
          "line-width": 6,
            "line-opacity": 1.0,
        },
      });
    }

    // 2.3 顶层纯白立体发光芯线
    if (!map.getLayer("selected-track-core")) {
      map.addLayer({
        id: "selected-track-core",
        type: "line",
        source: "selected-track",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#ffffff",
            "line-width": 2.8,
            "line-opacity": 0.95,
        },
      });
    }
  }

  function applyOverlayVisibility() {
    if (!map || !mapLayersReady) return;

    // 1. 轨迹底网显隐
    const trackVis = overlayConfig.tracks ? "visible" : "none";
    if (map.getLayer("all-tracks-glow")) {
      map.setLayoutProperty("all-tracks-glow", "visibility", trackVis);
    }
    if (map.getLayer("all-tracks-core")) {
      map.setLayoutProperty("all-tracks-core", "visibility", trackVis);
    }

    // 2. 照片图钉显隐
    photoMarkers.forEach((marker) => {
      if (overlayConfig.photos) {
        if (!marker._map) marker.addTo(map);
      } else {
        marker.remove();
      }
    });

    // 3. 起终点标记显隐
    if (startMarker) {
      if (overlayConfig.waypoints) {
        if (!startMarker._map) startMarker.addTo(map);
      } else {
        startMarker.remove();
      }
    }
    if (endMarker) {
      if (overlayConfig.waypoints) {
        if (!endMarker._map) endMarker.addTo(map);
      } else {
        endMarker.remove();
      }
    }

    // 4. 省份点亮与遮罩显隐
    const provinceVis = overlayConfig.provinces ? "visible" : "none";
    ["province-base-line", "province-dim-fill", "province-highlight-fill", "province-highlight-casing", "province-highlight-line"].forEach((layerId) => {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, "visibility", provinceVis);
      }
    });

    // 同步 Checkbox 状态
    const chkProvinces = document.getElementById("chk_overlay_provinces");
    const chkTracks = document.getElementById("chk_overlay_tracks");
    const chkPhotos = document.getElementById("chk_overlay_photos");
    const chkWaypoints = document.getElementById("chk_overlay_waypoints");

    if (chkProvinces) chkProvinces.checked = !!overlayConfig.provinces;
    if (chkTracks) chkTracks.checked = overlayConfig.tracks;
    if (chkPhotos) chkPhotos.checked = overlayConfig.photos;
    if (chkWaypoints) chkWaypoints.checked = overlayConfig.waypoints;

    // 同步顶部 HUD 点亮省份胶囊按钮状态
    const btnHudProvinces = document.getElementById("btn_toggle_provinces_hud");
    if (btnHudProvinces) {
      btnHudProvinces.classList.toggle("is-active", !!overlayConfig.provinces);
      btnHudProvinces.setAttribute("aria-pressed", overlayConfig.provinces ? "true" : "false");
      btnHudProvinces.title = overlayConfig.provinces ? "点击隐藏省份点亮" : "点击开启省份点亮";
    }

    if (window.CredentialStore) {
      window.CredentialStore.saveOverlayConfig(overlayConfig);
    }
  }

  function getDataUrl(relativePath) {
    const clean = relativePath.replace(/^\/+/, "");
      const pathname = window.location.pathname || "";
      // 若当前路径已包含 /web/tracks，基于当前路径精准推导前缀
      if (pathname.includes("/web/tracks")) {
          const idx = pathname.indexOf("/web/tracks");
          const prefix = pathname.substring(0, idx + "/web/tracks".length);
          return `${prefix}/${clean}`;
      }
      // 默认补齐全站 canonical 目录树前缀
      return `/web/tracks/${clean}`;
  }

    async function fetchJsonSafe(url, fallbackRelativePath) {
        let res = null;
        let primaryUrl = url;
        try {
            res = await fetch(primaryUrl);
        } catch (_) {
            res = null;
        }

        // 若主路径请求失败或返回非 200，尝试纯相对路径作为备选降级
        if ((!res || !res.ok) && fallbackRelativePath) {
            const fallbackUrl = fallbackRelativePath.replace(/^\/+/, "");
            if (fallbackUrl !== primaryUrl) {
                try {
                    const fallbackRes = await fetch(fallbackUrl);
                    if (fallbackRes && fallbackRes.ok) {
                        res = fallbackRes;
                    }
                } catch (_) {
                }
            }
        }

        if (!res || !res.ok) {
            throw new Error(`HTTP ${res ? res.status : "network_error"} loading ${url}`);
        }

        const text = await res.text();
        // 防御非 JSON 响应（如 404 HTML 或 SPA 回落页面）
        if (text.trim().startsWith("<")) {
            throw new Error(`Invalid JSON response (received HTML document) from ${url}`);
        }

        return JSON.parse(text);
  }

  async function loadManifest() {
    if (window.PhotoSource && typeof window.PhotoSource.ensureSourceConfig === "function") {
      try {
        await window.PhotoSource.ensureSourceConfig();
      } catch (_) {}
    }

    try {
        const data = await fetchJsonSafe(getDataUrl("data/manifest.json"), "data/manifest.json");
      manifestData = data;
      updateHUDStats(currentFilterType);
      updateFilterCounts(data.stats);
      renderTrackList();
      // 异步非阻塞加载全景骨架底网
      loadOverviewTracks();
    } catch (err) {
      console.error("Error loading tracks manifest:", err);
    }
  }

  async function loadOverviewTracks() {
    try {
        const data = await fetchJsonSafe(getDataUrl("data/overview.geojson"), "data/overview.geojson");
      overviewGeoJSON = data;
      // 始终触发渲染：消费可能在加载期间排队的待渲染标记
      renderMapTracks();
    } catch (err) {
      console.warn("Failed to load overview tracks:", err);
      // 即使加载失败，也清除待渲染标记避免永久挂起
      pendingMapRender = false;
    }
  }

  function updateHighlightedProvinces(targetTracks) {
    if (!map || !mapLayersReady || !map.getSource("china-provinces")) return;

    const tracks = targetTracks || getFilteredTracks();
    const provinceSet = new Set();
    tracks.forEach((t) => {
      if (t.province && t.province.trim()) {
        const norm = normalizeProvince(t.province);
        if (norm) {
          provinceSet.add(norm);
        }
      }
    });

    const activeList = Array.from(provinceSet);
    const color = getActiveProvinceColor(currentFilterType);
    const isDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;

    // 1. 点亮省份匹配表达式 (同时支持 short_name 和 name)
    const highlightFilter = activeList.length > 0
      ? [
          "any",
          ["in", ["get", "short_name"], ["literal", activeList]],
          ["in", ["get", "name"], ["literal", activeList]],
        ]
      : ["==", ["get", "short_name"], "__none__"];

    // 2. 未点亮省份匹配表达式 (用于压暗未探索区域，防止鲜艳等高线喧宾夺主)
    const dimFilter = activeList.length > 0
      ? [
          "all",
          ["!", ["in", ["get", "short_name"], ["literal", activeList]]],
          ["!", ["in", ["get", "name"], ["literal", activeList]]],
        ]
      : ["!=", ["get", "short_name"], "__none__"];

    // 更新未点亮省份暗色遮罩
    if (map.getLayer("province-dim-fill")) {
      map.setFilter("province-dim-fill", dimFilter);
      map.setPaintProperty("province-dim-fill", "fill-opacity", isDark ? 0.38 : 0.42);
    }

    // 更新点亮省份高光面
    if (map.getLayer("province-highlight-fill")) {
      map.setFilter("province-highlight-fill", highlightFilter);
      map.setPaintProperty("province-highlight-fill", "fill-color", color);
      map.setPaintProperty("province-highlight-fill", "fill-opacity", isDark ? 0.26 : 0.22);
    }

    // 更新点亮省份深色外轮廓描边
    if (map.getLayer("province-highlight-casing")) {
      map.setFilter("province-highlight-casing", highlightFilter);
    }

    // 更新点亮省份鲜艳发光轮廓线
    if (map.getLayer("province-highlight-line")) {
      map.setFilter("province-highlight-line", highlightFilter);
      map.setPaintProperty("province-highlight-line", "line-color", color);
      map.setPaintProperty("province-highlight-line", "line-opacity", 0.95);
    }
  }

  function updateHUDStats(filterType = currentFilterType) {
    if (!manifestData || !Array.isArray(manifestData.tracks)) return;

    let targetTracks = manifestData.tracks;
    if (filterType && filterType !== "all") {
      targetTracks = manifestData.tracks.filter((t) => t.type === filterType);
    }

    const totalDist = targetTracks.reduce((sum, t) => sum + (Number(t.distance_km) || 0), 0);
    const totalEle = targetTracks.reduce((sum, t) => sum + (Number(t.elevation_gain_m) || 0), 0);
    const totalCount = targetTracks.length;

    const provinceSet = new Set();
    targetTracks.forEach((t) => {
      if (t.province && t.province.trim()) {
        const norm = normalizeProvince(t.province);
        if (norm) {
          provinceSet.add(norm);
        }
      }
    });
    const provincesCount = provinceSet.size;

    const elDist = document.getElementById("stat_total_dist");
    const elEle = document.getElementById("stat_total_ele");
    const elCount = document.getElementById("stat_total_count");
    const elProvinces = document.getElementById("stat_total_provinces");

    if (elDist) elDist.textContent = totalDist.toFixed(1);
    if (elEle) elEle.textContent = Math.round(totalEle).toLocaleString();
    if (elCount) elCount.textContent = totalCount;
    if (elProvinces) elProvinces.textContent = provincesCount;

    updateHighlightedProvinces(targetTracks);
  }

  function updateFilterCounts(stats) {
    const counts = {};
    if (manifestData && Array.isArray(manifestData.tracks)) {
      manifestData.tracks.forEach((t) => {
        counts[t.type] = (counts[t.type] || 0) + 1;
      });
    } else if (stats && stats.type_counts) {
      Object.assign(counts, stats.type_counts);
    }

    const total = manifestData && Array.isArray(manifestData.tracks)
      ? manifestData.tracks.length
      : (stats ? stats.total_activities : 0);

    const countAllEl = document.getElementById("count_all");
    if (countAllEl) countAllEl.textContent = total || 0;

    ["hiking", "trail_running", "running", "cycling", "walking", "driving", "train", "flight", "transit"].forEach((t) => {
      const el = document.getElementById("count_" + t);
      if (el) el.textContent = counts[t] || 0;
    });
  }

  function getFilteredTracks() {
    if (!manifestData || !manifestData.tracks) return [];
    return manifestData.tracks.filter((t) => {
      const matchType = currentFilterType === "all" || t.type === currentFilterType;
      const matchQuery =
        !searchQuery ||
        t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (t.city && t.city.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (t.province && t.province.includes(searchQuery)) ||
        (t.country && t.country.toLowerCase().includes(searchQuery.toLowerCase()));
      return matchType && matchQuery;
    });
  }

  // 运动类型强度梯度配置 (公里数与心率)
  // 跑步：公里数（10KM \ 20KM \ 30KM \ 40KM \ 50KM \ 60KM）f: 10 * (n + 1), 平均心率（120 \ 140 \ 170 \ 180）
  // 徒步：公里数（10KM \ 30KM \ 60KM \ 100KM \ 150KM \ 210KM）f: 5 * (a + 2) * (a + 1), 平均心率（120 \ 140 \ 170 \ 180）
  // 越野跑：公里数（20KM \ 60KM \ 120KM \ 200KM \ 300KM \ 420KM）f: 10 * (a + 2) * (a + 1), 平均心率（120 \ 140 \ 170 \ 180）
  const metricThresholdConfig = {
    running: {
      distance: [10, 20, 30, 40, 50, 60],
      hr: [120, 140, 170, 180],
    },
    hiking: {
      distance: [10, 30, 60, 100, 150, 210],
      hr: [120, 140, 170, 180],
    },
    trail_running: {
      distance: [20, 60, 120, 200, 300, 420],
      hr: [120, 140, 170, 180],
    },
    cycling: {
      distance: [30, 60, 100, 150, 200, 300],
      hr: [120, 140, 170, 180],
    },
    walking: {
      distance: [5, 10, 15, 20, 30, 40],
      hr: [90, 110, 130, 150],
    },
    driving: {
      distance: [100, 300, 600, 1000, 1500, 2500],
      hr: [80, 100, 120, 140],
    },
    train: {
      distance: [100, 300, 600, 1200, 2000, 3000],
      hr: [80, 100, 120, 140],
    },
    flight: {
      distance: [500, 1000, 2000, 5000, 8000, 12000],
      hr: [80, 100, 120, 140],
    },
    default: {
      distance: [10, 30, 60, 100, 150, 210],
      hr: [120, 140, 170, 180],
    },
  };

  function getMetricTier(value, thresholds) {
    if (value === undefined || value === null || isNaN(value) || value <= 0) return 0;
    if (!thresholds || !thresholds.length) return 0;
    for (let i = thresholds.length - 1; i >= 0; i--) {
      if (value >= thresholds[i]) {
        return i + 1;
      }
    }
    return 0;
  }

  function getDistanceTier(distanceKm, activityType) {
    const cfg = metricThresholdConfig[activityType] || metricThresholdConfig.default;
    return getMetricTier(Number(distanceKm), cfg.distance);
  }

  function getHrTier(avgHr, activityType) {
    const cfg = metricThresholdConfig[activityType] || metricThresholdConfig.default;
    return getMetricTier(Number(avgHr), cfg.hr);
  }

  let isStatOnlyExpanded = false;

  function createTrackCard(t) {
    const card = document.createElement("div");
    const hasTrack = t.has_track !== false;
    const isCardActive = hasTrack && t.id === activeTrackId;
    card.className = "track-card" + (isCardActive ? " active" : "") + (!hasTrack ? " is-no-track" : "");
    card.dataset.id = t.id;
    const color = activityColors[t.type] || "#94a3b8";
    card.style.setProperty("--card-color", color);

    const typeLabel = activityLabels[t.type] || t.type;
    const dateStr = t.start_time ? t.start_time.substring(0, 10) : "";

    // 城市/地区信息（优先展示城市，如阿坝州、广州、拉萨等；无城市时降级展示省份）
    const cityOrRegion = t.city || t.province || "";
    const cityTooltip = t.province && t.city && t.province !== t.city
      ? `${t.province} · ${t.city}`
      : (cityOrRegion || "中国");

    // 计算公里数与心率的梯度等级
    const distTier = getDistanceTier(t.distance_km, t.type);
    const distStr = `<span class="track-metric metric-dist tier-${distTier}" title="${typeLabel}里程阶梯 Tier ${distTier}">${t.distance_km} km</span>`;

    let hrStr = "";
    if (t.avg_hr > 0) {
      const hrTier = getHrTier(t.avg_hr, t.type);
      hrStr = `<span class="track-metric metric-hr tier-${hrTier}" title="${typeLabel}心率阶梯 Tier ${hrTier}">${t.avg_hr} bpm</span>`;
    }

    const gainStr = t.elevation_gain_m > 0 ? `<span class="track-meta-item">+${Math.round(t.elevation_gain_m)} m</span>` : "";
    const photoStr = t.photo_count > 0 ? `<span class="track-meta-item">${t.photo_count} 张照片</span>` : "";
    const privacyBadge = !hasTrack ? `<span class="track-card-badge is-muted" title="短途隐私保护，仅展示统计数据">仅统计</span>` : "";
    const cityBadge = cityOrRegion ? `<span class="track-card-badge" title="${escapeHtml(cityTooltip)}">${escapeHtml(cityOrRegion)}</span>` : "";

    card.innerHTML = `
      <div class="track-card-header">
        <span class="track-card-title" title="${escapeHtml(t.title)}">${escapeHtml(t.title)}</span>
        <div class="track-card-badges">
          ${privacyBadge}
          ${cityBadge}
        </div>
      </div>
      <div class="track-card-meta">
        ${distStr}
        ${hrStr}
        <span class="track-meta-item">${dateStr}</span>
        ${gainStr}
        ${photoStr}
      </div>
    `;

    if (hasTrack) {
      card.addEventListener("click", () => {
        selectTrack(t.id);
      });
    }

    return card;
  }

  function renderTrackList() {
    const listEl = document.getElementById("track_list");
    listEl.innerHTML = "";

    const tracks = getFilteredTracks();
    if (tracks.length === 0) {
      listEl.innerHTML = `<div style="text-align:center; padding: 25px 15px; color: var(--hud-subtext); font-size: 12px;">暂无匹配的足迹记录</div>`;
      return;
    }

    const activeTracks = tracks.filter((t) => t.has_track !== false);
    const statOnlyTracks = tracks.filter((t) => t.has_track === false);

    // 1. 优先在最顶部渲染仅统计轨迹折叠分组（默认收起，可展开）
    if (statOnlyTracks.length > 0) {
      const groupEl = document.createElement("div");
      groupEl.className = "stat-group-container" + (isStatOnlyExpanded ? " is-expanded" : "");

      const headerEl = document.createElement("div");
      headerEl.className = "stat-group-header";
      headerEl.setAttribute("role", "button");
      headerEl.setAttribute("aria-expanded", isStatOnlyExpanded ? "true" : "false");
      headerEl.innerHTML = `
        <div class="stat-group-title-wrap">
          <span class="stat-group-title">仅统计记录</span>
          <span class="stat-group-count">${statOnlyTracks.length}</span>
        </div>
        <span class="stat-group-chevron">▾</span>
      `;

      const bodyEl = document.createElement("div");
      bodyEl.className = "stat-group-body";

      statOnlyTracks.forEach((t) => {
        bodyEl.appendChild(createTrackCard(t));
      });

      headerEl.addEventListener("click", () => {
        isStatOnlyExpanded = !isStatOnlyExpanded;
        groupEl.classList.toggle("is-expanded", isStatOnlyExpanded);
        headerEl.setAttribute("aria-expanded", isStatOnlyExpanded ? "true" : "false");
      });

      groupEl.appendChild(headerEl);
      groupEl.appendChild(bodyEl);
      listEl.appendChild(groupEl);
    }

    // 2. 渲染非仅统计轨迹（有详细路线）
    if (activeTracks.length > 0) {
      activeTracks.forEach((t) => {
        listEl.appendChild(createTrackCard(t));
      });
    } else if (statOnlyTracks.length > 0) {
      const emptyTip = document.createElement("div");
      emptyTip.className = "track-list-empty-tip";
      emptyTip.textContent = "当前分类下暂无完整轨迹";
      listEl.appendChild(emptyTip);
    }
  }

  // 标记是否有待执行的地图渲染（在 overviewGeoJSON 尚未加载完成时排队）
  let pendingMapRender = false;

  function renderMapTracks() {
    if (!map || !mapLayersReady) return;
    if (!overviewGeoJSON) {
      // overview 数据尚未加载完成，标记待渲染，等数据到达后自动触发
      pendingMapRender = true;
      return;
    }
    pendingMapRender = false;

    const source = map.getSource("all-tracks");
    if (!source) return;

    const filteredTracks = getFilteredTracks().filter((t) => t.has_track !== false);
    const validTrackIds = new Set(filteredTracks.map((t) => t.id));

    const filteredFeatures = (overviewGeoJSON.features || [])
      .filter((f) => f.properties && validTrackIds.has(f.properties.id))
      .map((f) => {
        const type = f.properties.type;
        return {
          type: "Feature",
          properties: {
            ...f.properties,
            color: activityColors[type] || "#94a3b8",
          },
          geometry: f.geometry,
        };
      });

    source.setData({
      type: "FeatureCollection",
      features: filteredFeatures,
    });

    updateHighlightedProvinces();

    if (!activeTrackId && filteredTracks.length > 0) {
      fitAllTracks(filteredTracks);
    }
  }

  function fitAllTracks(tracks) {
    if (!tracks || tracks.length === 0) return;
    let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90;
    let validCount = 0;
    tracks.forEach((t) => {
      if (
        t.has_track !== false &&
        t.bbox &&
        (t.bbox[0] !== 0 || t.bbox[1] !== 0 || t.bbox[2] !== 0 || t.bbox[3] !== 0)
      ) {
        if (t.bbox[0] < minLon) minLon = t.bbox[0];
        if (t.bbox[1] < minLat) minLat = t.bbox[1];
        if (t.bbox[2] > maxLon) maxLon = t.bbox[2];
        if (t.bbox[3] > maxLat) maxLat = t.bbox[3];
        validCount++;
      }
    });

    if (validCount > 0 && minLon <= maxLon && minLat <= maxLat) {
      map.fitBounds(
        [[minLon, minLat], [maxLon, maxLat]],
        { padding: { top: 60, bottom: 60, left: 340, right: 60 }, maxZoom: 14, duration: 1400 }
      );
    }
  }

  function applyFocusDimming(isFocused) {
    if (!map || !map.getStyle() || !map.getLayer("all-tracks-core") || !map.getLayer("all-tracks-glow")) return;

    try {
      if (isFocused) {
        map.setPaintProperty("all-tracks-core", "line-opacity", 0.15);
        map.setPaintProperty("all-tracks-core", "line-width", 1.5);
        map.setPaintProperty("all-tracks-core", "line-color", "#475569");
        map.setPaintProperty("all-tracks-glow", "line-opacity", 0);
      } else {
        map.setPaintProperty("all-tracks-core", "line-opacity", 0.85);
        map.setPaintProperty("all-tracks-core", "line-width", 2.5);
        map.setPaintProperty("all-tracks-core", "line-color", ["get", "color"]);
        map.setPaintProperty("all-tracks-glow", "line-opacity", 0.4);
      }
    } catch (_) {}
  }

  async function selectTrack(id) {
    if (activeTrackId === id) return;
    const item = manifestData && manifestData.tracks ? manifestData.tracks.find((t) => t.id === id) : null;
    if (item && item.has_track === false) {
      // 保护隐私或无轨迹记录，不允许进入轨迹详情
      return;
    }
    activeTrackId = id;

    document.querySelectorAll(".track-card").forEach((card) => {
      card.classList.toggle("active", card.dataset.id === id);
    });

    if (item && item.bbox && map) {
      map.fitBounds(
        [[item.bbox[0], item.bbox[1]], [item.bbox[2], item.bbox[3]]],
        { padding: { top: 80, bottom: 200, left: 350, right: 80 }, maxZoom: 15, duration: 1200 }
      );
    }

    // 注意：不在此处调用 applyFocusDimming(true)
    // 延迟到 fetch 成功并确认渲染后再淡化底网，防止 fetch 失败时地图呈现空白

    if (window.PhotoSource && typeof window.PhotoSource.ensureSourceConfig === "function") {
      try {
        await window.PhotoSource.ensureSourceConfig();
      } catch (_) {}
    }

    try {
        const detail = await fetchJsonSafe(getDataUrl(`data/tracks/${id}.json`), `data/tracks/${id}.json`);
      // 防止在 fetch 期间用户已切换到其他轨迹或取消选择
      if (activeTrackId !== id) return;
      activeTrackDetail = detail;
      renderSelectedTrackOnMap(detail);
      applyFocusDimming(true);
      showProfileHUD(detail);
    } catch (err) {
      console.error("Failed to load track detail:", err);
      // fetch 失败时恢复状态，不留下空白地图
      if (activeTrackId === id) {
        activeTrackId = null;
        activeTrackDetail = null;
          pendingSelectedTrackDetail = null;
        document.querySelectorAll(".track-card").forEach((c) => c.classList.remove("active"));
        applyFocusDimming(false);
        if (map && map.getSource("selected-track")) {
          map.getSource("selected-track").setData({ type: "FeatureCollection", features: [] });
        }
      }
    }
  }

  function resetTrackSelection() {
    if (!activeTrackId) return;
    activeTrackId = null;
    activeTrackDetail = null;
      pendingSelectedTrackDetail = null;

    hideProfileHUD(false);
    document.querySelectorAll(".track-card").forEach((c) => c.classList.remove("active"));

    if (map && map.getSource("selected-track")) {
      map.getSource("selected-track").setData({ type: "FeatureCollection", features: [] });
    }
      if (startMarker) {
          startMarker.remove();
          startMarker = null;
      }
      if (endMarker) {
          endMarker.remove();
          endMarker = null;
      }
      if (hoverMarker) {
          hoverMarker.remove();
          hoverMarker = null;
      }
    clearPhotoMarkers();

    const photoStrip = document.getElementById("photo_strip");
    if (photoStrip) {
      photoStrip.innerHTML = "";
      photoStrip.classList.remove("visible");
    }

    applyFocusDimming(false);
  }

  function clearPhotoMarkers() {
    photoMarkers.forEach((m) => m.remove());
    photoMarkers = [];
  }

  function getPhotoUrls(photo) {
    if (window.PhotoSource && typeof window.PhotoSource.resolvePhotoUrls === "function") {
      return window.PhotoSource.resolvePhotoUrls(photo);
    }

    // 基础离线兜底
    const year = photo.time ? photo.time.substring(0, 4) : "2026";
    const localOriginal = `/web/photography/gallery_images/${year}/${photo.filename}`;
    const thumbKey = photo.thumbnail || photo.original || "";
    const origKey = photo.original || photo.thumbnail || "";
    const base = "https://cdn-photography-img-vincent.chyu.org";
    const thumb = thumbKey ? `${base}/${thumbKey}` : localOriginal;
    const full = origKey ? `${base}/${origKey}` : localOriginal;

    return {
      thumb,
      full,
      fallbackThumb: localOriginal,
      fallbackFull: localOriginal,
    };
  }

  function openPhotoLightbox(photo) {
    const modal = document.getElementById("photo_lightbox");
    if (!modal) return;

    const urls = getPhotoUrls(photo);
    const imgEl = document.getElementById("lightbox_img");
    imgEl.src = urls.full;
    imgEl.onerror = function () {
      if (this.src !== urls.fallbackFull) {
        this.src = urls.fallbackFull;
      }
    };

    document.getElementById("lightbox_title").textContent = photo.filename;
    document.getElementById("lightbox_exif").textContent = [photo.camera, photo.lens, photo.params].filter(Boolean).join(" · ");
    document.getElementById("lightbox_time").textContent = `📅 拍摄时间: ${photo.time}`;

    modal.style.display = "flex";
  }

  function closePhotoLightbox() {
    const modal = document.getElementById("photo_lightbox");
    if (modal) modal.style.display = "none";
  }

  function renderPhotoMarkers(photos) {
    clearPhotoMarkers();
    if (!photos || photos.length === 0 || !map) return;

    photos.forEach((p, idx) => {
      const el = document.createElement("div");
      el.className = "photo-marker-pin";
      el.innerHTML = "📷";
      el.title = p.filename;

      // 阻止图钉点击事件冒泡至地图 canvas，防止触发 map.click 的重置选择逻辑
      el.addEventListener("click", (e) => {
        e.stopPropagation();
      });

      const urls = getPhotoUrls(p);

      const popupHtml = `
        <div class="photo-popup-card">
          <img src="${escapeHtml(urls.thumb)}" class="photo-popup-img" alt="${escapeHtml(p.filename)}" onerror="this.onerror=null; this.src='${escapeHtml(urls.fallbackThumb)}';" style="cursor: pointer;" />
          <div class="photo-popup-info">
            <div class="photo-popup-time">📅 ${escapeHtml(p.time)}</div>
            <div class="photo-popup-params">${escapeHtml(p.camera || '')} · ${escapeHtml(p.params || '')}</div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:6px;">
              <a href="javascript:void(0)" class="photo-popup-link photo-preview-btn">🔍 查看大图</a>
              <a href="/web/photography/" class="photo-popup-link" target="_blank">📷 摄影画廊 →</a>
            </div>
          </div>
        </div>
      `;

      const popup = new maplibregl.Popup({ offset: 18, closeButton: true, maxWidth: "280px" })
        .setHTML(popupHtml);

      popup.on("open", () => {
        const popupEl = popup.getElement();
        if (popupEl) {
          popupEl.addEventListener("click", (e) => e.stopPropagation());
          const img = popupEl.querySelector(".photo-popup-img");
          const btn = popupEl.querySelector(".photo-preview-btn");
          if (img) img.addEventListener("click", () => openPhotoLightbox(p));
          if (btn) btn.addEventListener("click", () => openPhotoLightbox(p));
        }
      });

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat(p.coord)
        .setPopup(popup);

      if (overlayConfig.photos) {
        marker.addTo(map);
      }

      photoMarkers.push(marker);
    });
  }

  function renderPhotoStrip(photos) {
    const stripEl = document.getElementById("photo_strip");
    if (!stripEl) return;
    stripEl.innerHTML = "";

    if (!photos || photos.length === 0) {
      stripEl.classList.remove("visible");
      return;
    }

    photos.forEach((p, idx) => {
      const urls = getPhotoUrls(p);
      const item = document.createElement("div");
      item.className = "photo-strip-item";
      item.title = `${p.time} (${p.camera || ''}) - 点击定位并预览`;
      item.innerHTML = `<img src="${escapeHtml(urls.thumb)}" alt="${escapeHtml(p.filename)}" onerror="this.onerror=null; this.src='${escapeHtml(urls.fallbackThumb)}';" />`;

      item.addEventListener("click", () => {
        map.flyTo({ center: p.coord, zoom: 16, duration: 1000 });
        if (photoMarkers[idx]) {
          photoMarkers[idx].togglePopup();
        }
      });

      item.addEventListener("dblclick", () => {
        openPhotoLightbox(p);
      });

      stripEl.appendChild(item);
    });
  }

  function renderSelectedTrackOnMap(detail) {
      if (!map || !detail) return;

      // 自愈检查：若图层尚未创建，尝试立即初始化图层
      if (!map.getSource("selected-track") || !map.getLayer("selected-track-core")) {
          if (typeof map.isStyleLoaded === "function" && map.isStyleLoaded()) {
              initMapLayers();
              mapLayersReady = true;
          } else {
              // 样式仍在加载中，排队等待 style.load 触发时自动渲染
              pendingSelectedTrackDetail = detail;
              return;
          }
      }
      pendingSelectedTrackDetail = null;

    const source = map.getSource("selected-track");
    if (!source) return;

    const coords = (detail.coordinates || []).map((p) => [p[0], p[1]]);
    const color = activityColors[detail.type] || "#00d2ff";

    source.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { id: detail.id, color: color },
          geometry: { type: "LineString", coordinates: coords },
        },
      ],
    });

      if (startMarker) {
          startMarker.remove();
          startMarker = null;
      }
      if (endMarker) {
          endMarker.remove();
          endMarker = null;
      }

    if (coords.length > 1) {
      const startEl = document.createElement("div");
        startEl.className = "track-waypoint-marker start";
        startEl.style.cssText = "width:18px;height:18px;background:#10b981;border:2px solid #ffffff;border-radius:50%;box-shadow:0 0 10px rgba(16,185,129,0.8);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:bold;color:#ffffff;cursor:default;user-select:none;";
        startEl.textContent = "S";
      startEl.addEventListener("click", (e) => e.stopPropagation());
      startMarker = new maplibregl.Marker({ element: startEl })
        .setLngLat(coords[0]);

      const endEl = document.createElement("div");
        endEl.className = "track-waypoint-marker end";
        endEl.style.cssText = "width:18px;height:18px;background:#ef4444;border:2px solid #ffffff;border-radius:50%;box-shadow:0 0 10px rgba(239,68,68,0.8);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:bold;color:#ffffff;cursor:default;user-select:none;";
        endEl.textContent = "F";
      endEl.addEventListener("click", (e) => e.stopPropagation());
      endMarker = new maplibregl.Marker({ element: endEl })
        .setLngLat(coords[coords.length - 1]);

      if (overlayConfig.waypoints) {
        startMarker.addTo(map);
        endMarker.addTo(map);
      }
    }

    // 渲染摄影照片 Markers
    if (detail.photos && detail.photos.length > 0) {
      renderPhotoMarkers(detail.photos);
      renderPhotoStrip(detail.photos);
    } else {
      clearPhotoMarkers();
      renderPhotoStrip([]);
    }
  }

  function showProfileHUD(detail) {
    const hud = document.getElementById("profile_hud");
    const toggleBtn = document.getElementById("profile_toggle_btn");
    if (hud) hud.classList.add("visible");
    if (toggleBtn) toggleBtn.classList.remove("visible");

    const toggleTitle = document.getElementById("profile_toggle_title");
    if (toggleTitle) toggleTitle.textContent = detail.title || "路线详情";

    const typeLabel = activityLabels[detail.type] || "徒步";
    const color = activityColors[detail.type] || "#00d2ff";

    const badge = document.getElementById("profile_track_type_badge");
    badge.textContent = typeLabel;
    badge.style.color = color;

    document.getElementById("profile_track_title").textContent = detail.title;
    document.getElementById("profile_stat_dist").textContent = detail.distance_km;
    document.getElementById("profile_stat_gain").textContent = Math.round(detail.elevation_gain_m);
    document.getElementById("profile_stat_max_ele").textContent = Math.round(detail.max_elevation_m);
    document.getElementById("profile_stat_duration").textContent = formatDuration(detail.duration_s);
    document.getElementById("profile_stat_speed").textContent = detail.avg_speed_kmh;

    const hrWrapper = document.getElementById("profile_hr_wrapper");
    const hrStat = document.getElementById("profile_stat_hr");
    if (detail.avg_hr > 0) {
      hrWrapper.style.display = "block";
      hrStat.textContent = detail.max_hr > detail.avg_hr ? `${detail.avg_hr} (最高 ${detail.max_hr})` : `${detail.avg_hr}`;
    } else {
      hrWrapper.style.display = "none";
    }

    // 照片按钮控制
    const btnPhotos = document.getElementById("btn_toggle_photos");
    const photoCountText = document.getElementById("photo_count_btn_text");
    if (detail.photos && detail.photos.length > 0) {
      btnPhotos.style.display = "inline-flex";
      photoCountText.textContent = `沿途作品 (${detail.photos.length})`;
    } else {
      btnPhotos.style.display = "none";
    }

    drawElevationProfile(detail);
  }

  function hideProfileHUD(retainSelection = true) {
    const hud = document.getElementById("profile_hud");
    const toggleBtn = document.getElementById("profile_toggle_btn");
    if (hud) hud.classList.remove("visible");

    if (retainSelection && activeTrackDetail && toggleBtn) {
      toggleBtn.classList.add("visible");
    } else if (toggleBtn) {
      toggleBtn.classList.remove("visible");
    }
  }

  function drawElevationProfile(detail, highlightIdx = -1) {
    const canvas = document.getElementById("elevation_canvas");
    if (!canvas || !detail.profile || detail.profile.length === 0) return;

    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const padX = 8;
    const padY = 10;

    ctx.clearRect(0, 0, w, h);

    const profile = detail.profile;
    const maxEle = Math.max(...profile.map((p) => p.e), 100);
    const minEle = Math.min(...profile.map((p) => p.e), 0);
    const eleRange = Math.max(maxEle - minEle, 50);
    const totalDist = detail.distance_km || 1;

    const color = activityColors[detail.type] || "#00d2ff";
    const gradient = ctx.createLinearGradient(0, padY, 0, h - padY);
    gradient.addColorStop(0, color + "aa");
    gradient.addColorStop(1, color + "11");

    // 高程填充区域
    ctx.beginPath();
    profile.forEach((p, idx) => {
      const x = padX + (p.d / totalDist) * (w - padX * 2);
      const y = h - padY - ((p.e - minEle) / eleRange) * (h - padY * 2);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    ctx.lineTo(w - padX, h - padY);
    ctx.lineTo(padX, h - padY);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // 折线顶边
    ctx.beginPath();
    profile.forEach((p, idx) => {
      const x = padX + (p.d / totalDist) * (w - padX * 2);
      const y = h - padY - ((p.e - minEle) / eleRange) * (h - padY * 2);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Hover 垂直线与指示圆点
    if (highlightIdx >= 0 && highlightIdx < profile.length) {
      const isDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
      const hp = profile[highlightIdx];
      const hx = padX + (hp.d / totalDist) * (w - padX * 2);
      const hy = h - padY - ((hp.e - minEle) / eleRange) * (h - padY * 2);

      ctx.beginPath();
      ctx.moveTo(hx, padY);
      ctx.lineTo(hx, h - padY);
      ctx.strokeStyle = isDark ? "rgba(255, 255, 255, 0.75)" : "rgba(15, 23, 42, 0.5)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.arc(hx, hy, 5, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.shadowColor = color;
      ctx.shadowBlur = 10;
      ctx.fill();

      // Tooltip
      ctx.font = "11px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillStyle = isDark ? "#ffffff" : "#0f172a";
      ctx.textAlign = hx > w - 120 ? "right" : "left";
      const hrText = hp.hr > 0 ? ` | ❤️ ${hp.hr} bpm` : "";
      const text = `${hp.d} km | ${Math.round(hp.e)} m${hrText}`;
      const textX = hx > w - 120 ? hx - 8 : hx + 8;
      ctx.fillText(text, textX, padY + 12);
    }
  }

  function bindUIEvents() {
    // 1. 底图下拉菜单与主题切换
    const btnToggleBasemap = document.getElementById("btn_toggle_basemap");
    const basemapDropdown = document.getElementById("basemap_dropdown");

    if (btnToggleBasemap && basemapDropdown) {
      btnToggleBasemap.addEventListener("click", (e) => {
        e.stopPropagation();
        const isHidden = basemapDropdown.style.display === "none";
        basemapDropdown.style.display = isHidden ? "flex" : "none";
        if (overlaysDropdown) overlaysDropdown.style.display = "none";
      });
    }

    document.querySelectorAll(".theme-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        switchTheme(btn.dataset.theme, true);
        if (basemapDropdown) basemapDropdown.style.display = "none";
      });
    });

    // 2. 图层显隐下拉菜单
    const btnToggleOverlays = document.getElementById("btn_toggle_overlays");
    const overlaysDropdown = document.getElementById("overlays_dropdown");

    if (btnToggleOverlays && overlaysDropdown) {
      btnToggleOverlays.addEventListener("click", (e) => {
        e.stopPropagation();
        const isHidden = overlaysDropdown.style.display === "none";
        overlaysDropdown.style.display = isHidden ? "flex" : "none";
        if (basemapDropdown) basemapDropdown.style.display = "none";
      });
    }

    // 全局点击空白处关闭所有下拉浮层
    document.addEventListener("click", (e) => {
      if (basemapDropdown && !basemapDropdown.contains(e.target) && e.target !== btnToggleBasemap) {
        basemapDropdown.style.display = "none";
      }
      if (overlaysDropdown && !overlaysDropdown.contains(e.target) && e.target !== btnToggleOverlays) {
        overlaysDropdown.style.display = "none";
      }
    });

    // 3. 图层选项开关事件
    const chkProvinces = document.getElementById("chk_overlay_provinces");
    const chkTracks = document.getElementById("chk_overlay_tracks");
    const chkPhotos = document.getElementById("chk_overlay_photos");
    const chkWaypoints = document.getElementById("chk_overlay_waypoints");

    if (chkProvinces) {
      chkProvinces.addEventListener("change", () => {
        overlayConfig.provinces = chkProvinces.checked;
        applyOverlayVisibility();
      });
    }

    // 顶部 HUD 点亮省份徽章快捷一键切换
    const btnHudProvinces = document.getElementById("btn_toggle_provinces_hud");
    if (btnHudProvinces) {
      btnHudProvinces.addEventListener("click", () => {
        overlayConfig.provinces = !overlayConfig.provinces;
        applyOverlayVisibility();
      });
    }

    if (chkTracks) {
      chkTracks.addEventListener("change", () => {
        overlayConfig.tracks = chkTracks.checked;
        applyOverlayVisibility();
      });
    }

    if (chkPhotos) {
      chkPhotos.addEventListener("change", () => {
        overlayConfig.photos = chkPhotos.checked;
        applyOverlayVisibility();
      });
    }

    if (chkWaypoints) {
      chkWaypoints.addEventListener("change", () => {
        overlayConfig.waypoints = chkWaypoints.checked;
        applyOverlayVisibility();
      });
    }

    // 4. 全屏沉浸模式切换
    const btnFullscreen = document.getElementById("btn_toggle_fullscreen");
    const workspace = document.getElementById("footprint_workspace");
    const fullscreenIcon = document.getElementById("fullscreen_icon");

    function setFullscreenMode(enable) {
      isFullscreen = !!enable;
      if (!workspace) return;

      if (isFullscreen) {
        workspace.style.height = "";
        workspace.classList.add("is-fullscreen");
        document.body.style.overflow = "hidden";
      } else {
        workspace.classList.remove("is-fullscreen");
        document.body.style.overflow = "";
        adjustWorkspaceHeight();
      }

      if (fullscreenIcon) {
        fullscreenIcon.textContent = isFullscreen ? "🗗" : "⛶";
      }

      setTimeout(() => {
        if (map) map.resize();
      }, 50);
      setTimeout(() => {
        if (map) map.resize();
      }, 250);
    }

    if (btnFullscreen && workspace) {
      btnFullscreen.addEventListener("click", () => {
        setFullscreenMode(!isFullscreen);
      });
    }

    // ESC 键退出全屏
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && isFullscreen) {
        setFullscreenMode(false);
      }
    });

    // 5. 分类 Tabs
    const filterTabs = document.getElementById("filter_tabs");
    if (filterTabs) {
      filterTabs.addEventListener("click", (e) => {
        const btn = e.target.closest(".footprint-tab");
        if (!btn) return;
        filterTabs.querySelectorAll(".footprint-tab").forEach((t) => t.classList.remove("is-active"));
        btn.classList.add("is-active");
        currentFilterType = btn.dataset.type;

        // 根据运动场景智能建议底图（仅当推荐底图具备有效凭据时智能联动）
        const suggestedTheme = activitySuggestedTheme[currentFilterType];
        if (suggestedTheme && suggestedTheme !== currentTheme) {
          const style = window.MapSourceRegistry ? window.MapSourceRegistry.getStyle(suggestedTheme) : null;
          if (style && window.MapSourceRegistry.hasValidAuth(style)) {
            switchTheme(suggestedTheme, false);
          }
        }

        updateHUDStats(currentFilterType);
        renderTrackList();
        renderMapTracks();
      });
    }

    // 6. 侧边栏折叠/展开
    const sidebar = document.getElementById("sidebar");
    const closeBtn = document.getElementById("sidebar_close_btn");
    const toggleBtn = document.getElementById("sidebar_toggle_btn");

    if (closeBtn) {
      closeBtn.addEventListener("click", () => {
        sidebar.classList.add("collapsed");
        toggleBtn.classList.add("visible");
      });
    }
    if (toggleBtn) {
      toggleBtn.addEventListener("click", () => {
        sidebar.classList.remove("collapsed");
        toggleBtn.classList.remove("visible");
      });
    }

    // 7. 搜索框
    const searchInput = document.getElementById("search_input");
    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        searchQuery = e.target.value.trim();
        renderTrackList();
        renderMapTracks();
      });
    }

    // 8. 照片胶片条切换
    const btnPhotos = document.getElementById("btn_toggle_photos");
    const photoStrip = document.getElementById("photo_strip");
    if (btnPhotos && photoStrip) {
      btnPhotos.addEventListener("click", () => {
        photoStrip.classList.toggle("visible");
        btnPhotos.classList.toggle("active", photoStrip.classList.contains("visible"));
      });
    }

    // 9. 关闭/折叠剖面 HUD
    const btnCloseProfile = document.getElementById("btn_close_profile");
    if (btnCloseProfile) {
      btnCloseProfile.addEventListener("click", () => {
        hideProfileHUD(true);
      });
    }

    // 9.1 重新展开路线详情按钮
    const btnProfileToggle = document.getElementById("profile_toggle_btn");
    if (btnProfileToggle) {
      btnProfileToggle.addEventListener("click", () => {
        if (activeTrackDetail) {
          showProfileHUD(activeTrackDetail);
        }
      });
    }

    // 10. 3D 视角切换
    const btn3D = document.getElementById("btn_toggle_3d");
    if (btn3D) {
      btn3D.addEventListener("click", () => {
        is3D = !is3D;
        btn3D.classList.toggle("active", is3D);
        map.easeTo({
          pitch: is3D ? 58 : 0,
          bearing: is3D ? 25 : 0,
          duration: 1000,
        });
      });
    }

    // 11. 轨迹巡航动画
    const btnPlay = document.getElementById("btn_play_track");
    if (btnPlay) {
      btnPlay.addEventListener("click", () => {
        if (!activeTrackDetail || !activeTrackDetail.coordinates) return;
        toggleTrackFlyAnimation();
      });
    }

    // 12. 高程 Canvas Hover 联动
    const canvas = document.getElementById("elevation_canvas");
    if (canvas) {
      canvas.addEventListener("mousemove", onCanvasHover);
      canvas.addEventListener("mouseleave", () => {
        if (activeTrackDetail) drawElevationProfile(activeTrackDetail, -1);
        if (hoverMarker) hoverMarker.remove();
      });
    }

    // 13. 照片大图预览 Lightbox 事件
    const lightbox = document.getElementById("photo_lightbox");
    const lightboxClose = document.getElementById("lightbox_close");
    if (lightboxClose) {
      lightboxClose.addEventListener("click", closePhotoLightbox);
    }
    if (lightbox) {
      lightbox.addEventListener("click", (e) => {
        if (e.target === lightbox) closePhotoLightbox();
      });
    }
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closePhotoLightbox();
        closeMapSettingsModal();
      }
    });

    window.addEventListener("resize", () => {
      adjustWorkspaceHeight();
      if (activeTrackDetail) drawElevationProfile(activeTrackDetail);
    });
  }

  function isLocalEnv() {
    if (window.MapSourceRegistry && typeof window.MapSourceRegistry.isLocalHost === "function") {
      return window.MapSourceRegistry.isLocalHost();
    }
    const h = window.location.hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "::1" || h.endsWith(".local");
  }

  /**
   * 图源设置模态框交互逻辑
   */
  function bindSettingsEvents() {
    const modal = document.getElementById("map_settings_modal");
    const btnOpen = document.getElementById("btn_open_map_settings");
    const btnClose = document.getElementById("btn_close_settings");
    const btnDone = document.getElementById("btn_done_settings");
    const backdrop = document.getElementById("map_settings_backdrop");

    if (btnOpen) {
      btnOpen.addEventListener("click", openMapSettingsModal);
    }
    if (btnClose) {
      btnClose.addEventListener("click", closeMapSettingsModal);
    }
    if (btnDone) {
      btnDone.addEventListener("click", closeMapSettingsModal);
    }
    if (backdrop) {
      backdrop.addEventListener("click", closeMapSettingsModal);
    }

    // 支持 ESC 键关闭弹窗
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modal && modal.style.display === "flex") {
        closeMapSettingsModal();
      }
    });

    // Thunderforest Token 保存与清除
    const inputTf = document.getElementById("input_token_thunderforest");
    const btnSaveTf = document.getElementById("btn_save_tf_token");
    const btnClearTf = document.getElementById("btn_clear_tf_token");

    if (btnSaveTf && inputTf) {
      btnSaveTf.addEventListener("click", () => {
        const val = inputTf.value.trim();
        if (window.CredentialStore) {
          window.CredentialStore.set(window.CredentialStore.KEYS.THUNDERFOREST, val);
          updateSettingsStatusUI();
          // 如果当前正好使用的是 Thunderforest 主题，刷新底图
          if (currentTheme.startsWith("dark") || currentTheme.startsWith("outdoor") || currentTheme.startsWith("cycling") || currentTheme.startsWith("landscape")) {
            switchTheme(currentTheme, false);
          }
        }
      });
    }

    if (btnClearTf && inputTf) {
      btnClearTf.addEventListener("click", () => {
        inputTf.value = "";
        if (window.CredentialStore) {
          window.CredentialStore.remove(window.CredentialStore.KEYS.THUNDERFOREST);
          updateSettingsStatusUI();
        }
      });
    }

    // 自定义 XYZ 图源添加 (预留)
    const btnAddCustom = document.getElementById("btn_add_custom_source");
    const inputCustomName = document.getElementById("input_custom_source_name");
    const inputCustomUrl = document.getElementById("input_custom_source_url");

    if (btnAddCustom && inputCustomName && inputCustomUrl) {
      btnAddCustom.addEventListener("click", () => {
        const name = inputCustomName.value.trim();
        const url = inputCustomUrl.value.trim();
        if (!name || !url) {
          alert("请输入图源名称和有效的切片 URL 模板 (必须包含 {z}/{x}/{y})");
          return;
        }
        if (!url.includes("{z}") || !url.includes("{x}") || !url.includes("{y}")) {
          alert("瓦片 URL 模板必须包含 {z}, {x}, {y} 占位符");
          return;
        }

        const id = "custom_" + Date.now();
        if (window.CredentialStore) {
          window.CredentialStore.saveCustomSource({ id, name, url });
          inputCustomName.value = "";
          inputCustomUrl.value = "";
          renderCustomSourcesList();
        }
      });
    }
  }

  function openMapSettingsModal() {
    const modal = document.getElementById("map_settings_modal");
    if (!modal) return;

    try {
      // 回显 Token
      const inputTf = document.getElementById("input_token_thunderforest");
      if (inputTf && window.CredentialStore) {
        inputTf.value = window.CredentialStore.get(window.CredentialStore.KEYS.THUNDERFOREST);
      }

      updateSettingsStatusUI();
      renderCustomSourcesList();
    } catch (err) {
      console.warn("更新设置面板状态异常:", err);
    }
    modal.style.display = "flex";
  }

  function closeMapSettingsModal() {
    const modal = document.getElementById("map_settings_modal");
    if (modal) modal.style.display = "none";
  }

  function updateSettingsStatusUI() {
    const tipEl = document.getElementById("tf_token_status");
    if (!tipEl || !window.CredentialStore) return;

    const token = window.CredentialStore.get(window.CredentialStore.KEYS.THUNDERFOREST);
    if (token) {
      tipEl.className = "status-tip success";
      tipEl.textContent = `✓ 已配置 API Key (${token.substring(0, 4)}••••••••)`;
    } else if (isLocalEnv()) {
      tipEl.className = "status-tip success";
      tipEl.textContent = `⚡ 本地开发环境：使用本地代理 /api/tiles/* 免配置运行`;
    } else {
      tipEl.className = "status-tip warning";
      tipEl.textContent = `⚠️ 未配置 Token：生产静态环境访问 Thunderforest 时需要此 Key`;
    }
  }

  function renderCustomSourcesList() {
    const listEl = document.getElementById("custom_sources_list");
    if (!listEl || !window.CredentialStore) return;

    const customs = window.CredentialStore.getCustomSources();
    listEl.innerHTML = "";

    if (customs.length === 0) {
      listEl.innerHTML = `<div style="font-size: 11px; color: var(--hud-subtext);">暂无自定义图源</div>`;
      return;
    }

    customs.forEach((c) => {
      const item = document.createElement("div");
      item.className = "custom-source-item";
      item.innerHTML = `
        <div>
          <b>${escapeHtml(c.name)}</b>
          <div style="color: var(--hud-subtext); font-size: 10px; word-break: break-all;">${escapeHtml(c.url)}</div>
        </div>
        <button type="button" class="btn-secondary" style="padding: 2px 8px; font-size: 10px; margin-left: 8px;">删除</button>
      `;

      const delBtn = item.querySelector("button");
      if (delBtn) {
        delBtn.addEventListener("click", () => {
          window.CredentialStore.removeCustomSource(c.id);
          renderCustomSourcesList();
        });
      }

      listEl.appendChild(item);
    });
  }

  function onCanvasHover(e) {
    if (!activeTrackDetail || !activeTrackDetail.profile) return;
    const canvas = document.getElementById("elevation_canvas");
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const padX = 8;
    const w = rect.width;

    const ratio = Math.max(0, Math.min(1, (mouseX - padX) / (w - padX * 2)));
    const targetDist = ratio * activeTrackDetail.distance_km;

    let closestIdx = 0;
    let minDiff = 99999;
    activeTrackDetail.profile.forEach((p, idx) => {
      const diff = Math.abs(p.d - targetDist);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = idx;
      }
    });

    drawElevationProfile(activeTrackDetail, closestIdx);

    const pointIdx = activeTrackDetail.profile[closestIdx].i;
    if (activeTrackDetail.coordinates[pointIdx]) {
      const coord = activeTrackDetail.coordinates[pointIdx];
      const lngLat = [coord[0], coord[1]];

      if (!hoverMarker) {
        const el = document.createElement("div");
        el.className = "map-hover-marker";
        hoverMarker = new maplibregl.Marker({ element: el }).setLngLat(lngLat).addTo(map);
      } else {
        hoverMarker.setLngLat(lngLat);
        if (!hoverMarker._map) hoverMarker.addTo(map);
      }
    }
  }

  function toggleTrackFlyAnimation() {
    const btnPlay = document.getElementById("btn_play_track");
    if (isPlaying) {
      isPlaying = false;
      cancelAnimationFrame(playAnimationId);
      btnPlay.classList.remove("active");
      return;
    }

    isPlaying = true;
    btnPlay.classList.add("active");

    const coords = activeTrackDetail.coordinates;
    let step = 0;
    const totalSteps = coords.length;

    function frame() {
      if (!isPlaying) return;
      if (step >= totalSteps) {
        isPlaying = false;
        btnPlay.classList.remove("active");
        return;
      }

      const p = coords[step];
      map.setCenter([p[0], p[1]]);
      step += Math.max(1, Math.floor(totalSteps / 300));
      playAnimationId = requestAnimationFrame(frame);
    }

    map.setZoom(15);
    map.setPitch(60);
    frame();
  }

  function formatDuration(s) {
    if (!s) return "0分钟";
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0) return `${h}小时 ${m}分`;
    return `${m}分钟`;
  }

  function escapeHtml(str) {
    if (!str) return "";
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  document.addEventListener("DOMContentLoaded", init);
})();
