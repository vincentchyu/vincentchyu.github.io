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
  // 世界陆地板块边界数据 (用于仅在未探索陆地覆盖战争迷雾，保留深邃大洋)
  let worldLandGeoJSON = null;
  // 世界地理大洲与主要国家注记数据与标记集 (宏观浮雕注记)
  let worldLabelsGeoJSON = null;
  let worldLabelMarkers = [];

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
    skateboarding: "#eab308", // 滑板：陆冲暖黄
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
    skateboarding: "滑板",
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
    skateboarding: "openfreemap", // 滑板：OpenFreeMap 开源街区
    driving: "satellite",         // 驾车：Esri 高清卫星影像
    train: "satellite",           // 火车：Esri 高清卫星影像
    flight: "satellite",          // 飞机：Esri 高清卫星影像
    transit: "satellite",         // 兼容旅行：Esri 高清卫星影像
  };

  function normalizeProvince(p) {
    if (!p || typeof p !== "string") return "";
    const clean = p.replace(/(省|市|特别行政区|回族自治区|维吾尔自治区|壮族自治区|自治区)$/, "").trim();
    if (clean === "尖沙咀" || clean === "旺角" || clean === "中西区") return "香港";
    return clean;
  }

  function getActiveProvinceColor(type = currentFilterType) {
    const isDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (type && activityColors[type]) {
      return activityColors[type];
    }
    return isDark ? "#00d2ff" : "#2563eb";
  }

  function buildLandFogGeoJSON() {
    if (worldLandGeoJSON && Array.isArray(worldLandGeoJSON.features) && worldLandGeoJSON.features.length > 0) {
      return worldLandGeoJSON;
    }
    return { type: "FeatureCollection", features: [] };
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
    initLayoutObserver();
    loadManifest();
    loadProvinceBoundaries();
    loadWorldLandBoundaries();
    loadWorldLabels();
    adjustWorkspaceHeight();
  }

  function initLayoutObserver() {
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      adjustWorkspaceHeight();
    });
    const mainEl = document.querySelector(".footprint-main");
    if (mainEl) {
      const hero = mainEl.querySelector(".footprint-hero");
      const tabs = mainEl.querySelector(".footprint-tabs");
      const intro = mainEl.querySelector(".footprint-intro-row");
      if (hero) observer.observe(hero);
      if (tabs) observer.observe(tabs);
      if (intro) observer.observe(intro);
    }
  }

  function adjustWorkspaceHeight() {
    const workspace = document.getElementById("footprint_workspace");
    if (!workspace) return;

    if (workspace.classList.contains("is-fullscreen")) {
      workspace.style.height = "";
      if (map) map.resize();
      return;
    }

    // 主动清除外部残留的 body.style.minHeight 垫高，防止任何累计黑边
    if (document.body && document.body.style.minHeight) {
      document.body.style.minHeight = "";
    }

    // 锚点元素 (页面置顶时的视口顶端参考基准)
    const anchor = document.getElementById("site-page-anchor") || document.querySelector(".footprint-title");
    let headerOffset = 130; // 默认合理间距兜底

    if (anchor) {
      const anchorRect = anchor.getBoundingClientRect();
      const workspaceRect = workspace.getBoundingClientRect();
      // 使用文档绝对坐标差值，与当前页面滚动位置完全解耦
      const anchorTopInDoc = anchorRect.top + window.scrollY;
      const workspaceTopInDoc = workspaceRect.top + window.scrollY;
      headerOffset = Math.max(0, workspaceTopInDoc - anchorTopInDoc);
    }

    // 获取 footprint-main 的底部 padding (通常为 1rem 即 16px)
    const mainEl = document.querySelector(".footprint-main");
    let bottomGap = 16;
    if (mainEl) {
      const computedPadding = parseFloat(window.getComputedStyle(mainEl).paddingBottom);
      if (!Number.isNaN(computedPadding) && computedPadding > 0) {
        bottomGap = computedPadding;
      }
    }

    // 置顶状态下，视口内剩余给地图工作区的完美高度 (向上取整确保高度充足，绝不触发 missingScroll 垫高产生黑边)
    const targetHeight = Math.max(360, Math.ceil(window.innerHeight - headerOffset - bottomGap));
    workspace.style.height = `${targetHeight}px`;

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

  // 全球宏观世界版图视野边界 (展示各大洲与四大洋完整的魔兽战争迷雾总览)
  const WORLD_VIEW_BOUNDS = [
    [-170.0, -58.0],
    [175.0, 72.0],
  ];

  function fitWorldView(animated = false) {
    if (!map) return;
    const isMobile = window.innerWidth <= 768;
    const leftPad = isMobile ? 20 : 340;
    map.fitBounds(WORLD_VIEW_BOUNDS, {
      padding: { top: 40, bottom: 40, left: leftPad, right: 40 },
      maxZoom: 2.2,
      duration: animated ? 1200 : 0,
    });
  }

  function initMap() {
    map = new maplibregl.Map({
      container: "map",
      style: getMapStyleForTheme(currentTheme),
      center: [20.0, 15.0],
      zoom: 1.5,
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
      renderWorldLabels();
        if (activeTrackDetail || pendingSelectedTrackDetail) {
            const detailToRender = activeTrackDetail || pendingSelectedTrackDetail;
            renderSelectedTrackOnMap(detailToRender);
        applyFocusDimming(true);
      } else if (currentFilterType === "all" && !searchQuery) {
        fitWorldView(false);
      }
    });

    // 缩放级别变化时实时更新大洲与国家注记的层级显隐
    map.on("zoom", updateWorldLabelsVisibility);

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
          "world-land-fog",
          "world-land-fog-cloud",
          "world-land-fog-casing",
          "world-fog-mask",
          "province-unexplored-fill",
          "province-unexplored-cloud",
          "province-base-line",
          "province-dim-fill",
          "province-highlight-fill",
          "province-glow-outer",
          "province-glow-middle",
          "province-glow-core",
          "province-highlight-casing",
          "province-highlight-line",
          "all-tracks-glow",
          "all-tracks-core",
          "selected-track-casing",
          "selected-track-glow",
          "selected-track-core",
          "selected-track-transfer-casing",
          "selected-track-transfer-glow",
          "selected-track-transfer-core"
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

  async function loadWorldLandBoundaries() {
    try {
      const data = await fetchJsonSafe(getDataUrl("data/world-land.geojson"), "data/world-land.geojson");
      worldLandGeoJSON = data;
      if (map && map.getSource("world-land-fog")) {
        map.getSource("world-land-fog").setData(worldLandGeoJSON);
      }
      updateHighlightedProvinces();
    } catch (err) {
      console.warn("Failed to load world land geojson:", err);
    }
  }

  async function loadWorldLabels() {
    try {
      const data = await fetchJsonSafe(getDataUrl("data/world-labels.geojson"), "data/world-labels.geojson");
      worldLabelsGeoJSON = data;
      renderWorldLabels();
    } catch (err) {
      console.warn("Failed to load world labels geojson:", err);
    }
  }

  function renderWorldLabels() {
    if (!map || !worldLabelsGeoJSON || !worldLabelsGeoJSON.features) return;

    // 清理旧有的 Marker 实例
    worldLabelMarkers.forEach(({ marker }) => {
      try {
        marker.remove();
      } catch (_) {}
    });
    worldLabelMarkers = [];

    worldLabelsGeoJSON.features.forEach((feature) => {
      const props = feature.properties || {};
      const coords = feature.geometry && feature.geometry.coordinates;
      if (!coords || coords.length < 2) return;

      const el = document.createElement("div");
      el.className = `world-geo-label ${props.type || "country"}`;
      el.textContent = props.label || props.name || "";

      const marker = new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat(coords)
        .addTo(map);

      worldLabelMarkers.push({
        marker,
        el,
        props,
      });
    });

    updateWorldLabelsVisibility();
  }

  function updateWorldLabelsVisibility() {
    if (!map || worldLabelMarkers.length === 0) return;

    const zoom = map.getZoom();
    const isProvincesVisible = !!overlayConfig.provinces;
    const isDetailFocused = !!activeTrackId;

    worldLabelMarkers.forEach(({ el, props }) => {
      // 1. 若探索迷雾图层关闭，或当前进入了单条轨迹聚焦详情模式，全部淡出隐藏
      if (!isProvincesVisible || isDetailFocused) {
        el.classList.add("dimmed");
        return;
      }

      // 2. 深度放大至城市/街道尺度（zoom > 5.5）时自动隐藏宏观大洲与国家注记
      if (zoom > 5.5) {
        el.classList.add("dimmed");
        return;
      }

      const minzoom = props.minzoom !== undefined ? props.minzoom : 0;
      const maxzoom = props.maxzoom !== undefined ? props.maxzoom : 20;

      if (zoom >= minzoom && zoom <= maxzoom) {
        el.classList.remove("dimmed");
      } else {
        el.classList.add("dimmed");
      }
    });
  }

  // 预加载《文明VI》大地图风格的无缝深邃云雾迷雾贴图 (fog-cloud.png)
  let cloudFogImageLoaded = false;
  let cloudFogImg = null;

  function initCloudFogLoader() {
    if (cloudFogImg) return;
    try {
      cloudFogImg = new Image();
      cloudFogImg.onload = () => {
        cloudFogImageLoaded = true;
        applyCloudFogPatternToMap();
      };
      cloudFogImg.onerror = (err) => {
        console.warn("Failed to load fog-cloud.png:", err);
      };
      cloudFogImg.src = getDataUrl("images/fog-cloud.png?v=4");
    } catch (_) {}
  }

  function applyCloudFogPatternToMap() {
    if (!map || !cloudFogImageLoaded || !cloudFogImg) return;
    try {
      if (!map.hasImage("cloud-fog-pattern")) {
        map.addImage("cloud-fog-pattern", cloudFogImg);
      }
      const vis = overlayConfig.provinces ? "visible" : "none";
      if (map.getLayer("world-land-fog-cloud")) {
        map.setPaintProperty("world-land-fog-cloud", "fill-pattern", "cloud-fog-pattern");
        map.setLayoutProperty("world-land-fog-cloud", "visibility", vis);
      }
      if (map.getLayer("province-unexplored-cloud")) {
        map.setPaintProperty("province-unexplored-cloud", "fill-pattern", "cloud-fog-pattern");
        map.setLayoutProperty("province-unexplored-cloud", "visibility", vis);
      }
    } catch (e) {
      console.warn("Failed to apply cloud fog pattern to map:", e);
    }
  }

  function initMapLayers() {
    if (!map) return;

    initCloudFogLoader();
    applyCloudFogPatternToMap();

    // 0.0 世界各大洲未探索陆地战争迷雾 Source (仅覆盖未涉足海外陆地，彻底解放深邃大洋)
    if (!map.getSource("world-land-fog")) {
      map.addSource("world-land-fog", {
        type: "geojson",
        data: worldLandGeoJSON || { type: "FeatureCollection", features: [] },
      });
    }

    const isDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    const provinceVis = overlayConfig.provinces ? "visible" : "none";

    // 0.05 悬浮云层向大洋投下的自然深色柔和阴影 (消灭贴纸感)
    if (!map.getLayer("world-land-fog-shadow")) {
      map.addLayer({
        id: "world-land-fog-shadow",
        type: "line",
        source: "world-land-fog",
        layout: { "line-join": "round", "line-cap": "round", "visibility": provinceVis },
        paint: {
          "line-color": "#01040a",
          "line-width": 14,
          "line-blur": 8,
          "line-opacity": activeTrackId ? 0 : 0.65,
        },
      });
    }

    // 0.1 未探索各大洲海岸线深暗保护描边
    if (!map.getLayer("world-land-fog-casing")) {
      map.addLayer({
        id: "world-land-fog-casing",
        type: "line",
        source: "world-land-fog",
        layout: { "visibility": provinceVis },
        paint: {
          "line-color": "#03060c",
          "line-width": 1.2,
          "line-opacity": isDark ? 0.75 : 0.65,
        },
      });
    }

    // 0.2 未探索陆地战争迷雾底色面 (实体深黑夜幕底色，覆盖海外未涉足国家板块，绝对零漏光)
    if (!map.getLayer("world-land-fog")) {
      map.addLayer({
        id: "world-land-fog",
        type: "fill",
        source: "world-land-fog",
        layout: { "visibility": provinceVis },
        paint: {
          "fill-color": "#040711",
          "fill-opacity": activeTrackId ? 0 : 0.98,
        },
      });
    }

    // 0.21 未探索陆地卷云纹理层 (呈现深邃乌云密布翻滚烟云)
    if (!map.getLayer("world-land-fog-cloud")) {
      const cloudLayerDef = {
        id: "world-land-fog-cloud",
        type: "fill",
        source: "world-land-fog",
        layout: { "visibility": map.hasImage("cloud-fog-pattern") && overlayConfig.provinces ? "visible" : "none" },
        paint: {
          "fill-opacity": activeTrackId ? 0 : 0.95,
        },
      };
      if (map.hasImage("cloud-fog-pattern")) {
        cloudLayerDef.paint["fill-pattern"] = "cloud-fog-pattern";
      }
      map.addLayer(cloudLayerDef);
    }

    // 0.3 省级行政区划与点亮高亮图层组 (位于底图之上，轨迹线之下)
    if (!map.getSource("china-provinces")) {
      map.addSource("china-provinces", {
        type: "geojson",
        data: provincesGeoJSON || { type: "FeatureCollection", features: [] },
      });
    }

    // 0.4 全国省份未探索战争迷雾底色面 (实体深黑夜幕底色，绝对零漏光)
    if (!map.getLayer("province-unexplored-fill")) {
      map.addLayer({
        id: "province-unexplored-fill",
        type: "fill",
        source: "china-provinces",
        filter: ["!=", ["get", "short_name"], "__none__"],
        layout: { "visibility": provinceVis },
        paint: {
          "fill-color": "#040711",
          "fill-opacity": activeTrackId ? 0 : 0.98,
        },
      });
    }

    // 0.41 全国省份未探索卷云纹理层 (浮于深黑底色之上)
    if (!map.getLayer("province-unexplored-cloud")) {
      const provCloudLayerDef = {
        id: "province-unexplored-cloud",
        type: "fill",
        source: "china-provinces",
        filter: ["!=", ["get", "short_name"], "__none__"],
        layout: { "visibility": map.hasImage("cloud-fog-pattern") && overlayConfig.provinces ? "visible" : "none" },
        paint: {
          "fill-opacity": activeTrackId ? 0 : 0.95,
        },
      };
      if (map.hasImage("cloud-fog-pattern")) {
        provCloudLayerDef.paint["fill-pattern"] = "cloud-fog-pattern";
      }
      map.addLayer(provCloudLayerDef);
    }

    // 0.5 全国省份基底细轮廓线
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

    // 0.6 【方案 A：暗黑石板微光调 Dark Slate Noir】点亮省份遮罩面 (压暗白底刺眼街道，极致凸显细线轨迹)
    if (!map.getLayer("province-highlight-fill")) {
      map.addLayer({
        id: "province-highlight-fill",
        type: "fill",
        source: "china-provinces",
        filter: ["==", ["get", "short_name"], "__none__"],
        layout: { "visibility": provinceVis },
        paint: {
          "fill-color": "#0b1322",
          "fill-opacity": activeTrackId ? 0 : 0.52,
        },
      });
    }

    // 0.6 【魔兽极光结界 1 - 外层大漫射晕染】超宽幅漫射光晕
    if (!map.getLayer("province-glow-outer")) {
      map.addLayer({
        id: "province-glow-outer",
        type: "line",
        source: "china-provinces",
        filter: ["==", ["get", "short_name"], "__none__"],
        layout: { "line-join": "round", "line-cap": "round", "visibility": provinceVis },
        paint: {
          "line-color": getActiveProvinceColor(currentFilterType),
          "line-width": 18,
          "line-blur": 12,
          "line-opacity": isDark ? 0.55 : 0.45,
        },
      });
    }

    // 0.7 【魔兽极光结界 2 - 中层高光辉光】高饱和度发光带
    if (!map.getLayer("province-glow-middle")) {
      map.addLayer({
        id: "province-glow-middle",
        type: "line",
        source: "china-provinces",
        filter: ["==", ["get", "short_name"], "__none__"],
        layout: { "line-join": "round", "line-cap": "round", "visibility": provinceVis },
        paint: {
          "line-color": getActiveProvinceColor(currentFilterType),
          "line-width": 7.5,
          "line-blur": 3.0,
          "line-opacity": isDark ? 0.85 : 0.75,
        },
      });
    }

    // 0.8 【魔兽极光结界 3 - 内层极细电光芯线】高亮白绿能量核心线
    if (!map.getLayer("province-glow-core")) {
      map.addLayer({
        id: "province-glow-core",
        type: "line",
        source: "china-provinces",
        filter: ["==", ["get", "short_name"], "__none__"],
        layout: { "line-join": "round", "line-cap": "round", "visibility": provinceVis },
        paint: {
          "line-color": "#f0fdf4",
          "line-width": 1.8,
          "line-opacity": 0.95,
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
          "line-width": 8.5,
          "line-opacity": 0.95,
          "line-blur": 0.5,
        },
      });
    }

    // 2.2 中层运动类型鲜艳主题色光晕 (微光过渡)
    if (!map.getLayer("selected-track-glow")) {
      map.addLayer({
        id: "selected-track-glow",
        type: "line",
        source: "selected-track",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": ["coalesce", ["get", "color"], "#ff7a00"],
          "line-width": 6.5,
          "line-opacity": 0.8,
          "line-blur": 1.5,
        },
      });
    }

    // 2.3 顶层高饱和实体主题色核心主线 (方案一：实心主色彻底解决浅色底图发虚)
    if (!map.getLayer("selected-track-core")) {
      map.addLayer({
        id: "selected-track-core",
        type: "line",
        source: "selected-track",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": ["coalesce", ["get", "color"], "#ff7a00"],
          "line-width": 4.5,
          "line-opacity": 1.0,
        },
      });
    }

    // 2.4 非徒步转场连接单独渲染为虚线，避免与真实采样轨迹混淆。
    if (!map.getSource("selected-track-transfer")) {
      map.addSource("selected-track-transfer", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
    }

    if (!map.getLayer("selected-track-transfer-casing")) {
      map.addLayer({
        id: "selected-track-transfer-casing",
        type: "line",
        source: "selected-track-transfer",
        layout: { "line-join": "round", "line-cap": "butt" },
        paint: {
          "line-color": "#090d16",
          "line-width": 8.5,
          "line-opacity": 0.9,
          "line-dasharray": [2, 1.5],
        },
      });
    }

    if (!map.getLayer("selected-track-transfer-glow")) {
      map.addLayer({
        id: "selected-track-transfer-glow",
        type: "line",
        source: "selected-track-transfer",
        layout: { "line-join": "round", "line-cap": "butt" },
        paint: {
          "line-color": ["coalesce", ["get", "color"], "#ff7a00"],
          "line-width": 6.5,
          "line-opacity": 0.65,
          "line-blur": 1,
          "line-dasharray": [2, 1.5],
        },
      });
    }

    if (!map.getLayer("selected-track-transfer-core")) {
      map.addLayer({
        id: "selected-track-transfer-core",
        type: "line",
        source: "selected-track-transfer",
        layout: { "line-join": "round", "line-cap": "butt" },
        paint: {
          "line-color": ["coalesce", ["get", "color"], "#ff7a00"],
          "line-width": 4.5,
          "line-opacity": 0.95,
          "line-dasharray": [2, 1.5],
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

    // 4. 世界陆地战争迷雾与极光结界显隐
    const provinceVis = overlayConfig.provinces ? "visible" : "none";
    [
      "world-land-fog-shadow",
      "world-land-fog",
      "world-land-fog-cloud",
      "world-land-fog-casing",
      "province-unexplored-fill",
      "province-unexplored-cloud",
      "province-base-line",
      "province-highlight-fill",
      "province-glow-outer",
      "province-glow-middle",
      "province-glow-core"
    ].forEach((layerId) => {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, "visibility", provinceVis);
      }
    });

    // 5. 同步世界宏观大洲与主要国家注记显隐
    updateWorldLabelsVisibility();

    // 同步 Checkbox 状态
    const chkProvinces = document.getElementById("chk_overlay_provinces");
    const chkTracks = document.getElementById("chk_overlay_tracks");
    const chkPhotos = document.getElementById("chk_overlay_photos");
    const chkWaypoints = document.getElementById("chk_overlay_waypoints");

    if (chkProvinces) chkProvinces.checked = !!overlayConfig.provinces;
    if (chkTracks) chkTracks.checked = overlayConfig.tracks;
    if (chkPhotos) chkPhotos.checked = overlayConfig.photos;
    if (chkWaypoints) chkWaypoints.checked = overlayConfig.waypoints;

    // 同步工具栏点亮探索/迷雾按钮状态
    const btnToolbarProvinces = document.getElementById("btn_toggle_provinces");
    if (btnToolbarProvinces) {
      btnToolbarProvinces.classList.toggle("active", !!overlayConfig.provinces);
      btnToolbarProvinces.setAttribute("aria-pressed", overlayConfig.provinces ? "true" : "false");
      btnToolbarProvinces.title = overlayConfig.provinces ? "点击隐藏探索迷雾" : "点击开启探索迷雾";
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
      renderQuickFilterChips();
      renderTrackList();
      adjustWorkspaceHeight();
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
      if (t.country === "香港") {
        provinceSet.add("香港");
      }
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

    // 0. 刷新世界各大洲未探索陆地战争迷雾 (只覆盖海外未去过陆地，完全露出各大洋深蓝通透水体)
    try {
      if (map.getSource("world-land-fog")) {
        const fogGeoJSON = buildLandFogGeoJSON();
        map.getSource("world-land-fog").setData(fogGeoJSON);
      }
    } catch (e) {
      console.warn("Failed to update world land fog:", e);
    }

    // 1. 点亮省份匹配表达式 (同时支持 short_name 和 name)
    const highlightFilter = activeList.length > 0
      ? [
          "any",
          ["in", ["get", "short_name"], ["literal", activeList]],
          ["in", ["get", "name"], ["literal", activeList]],
        ]
      : ["==", ["get", "short_name"], "__none__"];

    // 1.1 未探索省份匹配表达式 (非点亮省份)
    const unexploredFilter = activeList.length > 0
      ? ["!", highlightFilter]
      : ["!=", ["get", "short_name"], "__none__"];

    // 2. 更新全国未探索省份战争迷雾底色面 (实体深黑夜幕，绝对零漏光)
    if (map.getLayer("province-unexplored-fill")) {
      map.setFilter("province-unexplored-fill", unexploredFilter);
      map.setPaintProperty("province-unexplored-fill", "fill-opacity", activeTrackId ? 0 : 0.98);
    }

    // 2.1 更新全国未探索省份卷云纹理层
    if (map.getLayer("province-unexplored-cloud")) {
      map.setFilter("province-unexplored-cloud", unexploredFilter);
      map.setPaintProperty("province-unexplored-cloud", "fill-opacity", activeTrackId ? 0 : 0.70);
    }

    // 3. 更新方案 A：已解锁省份暗黑石板微光调 (Dark Slate Noir，#0b1322，0.52 压暗白底街道并凸显轨迹)
    if (map.getLayer("province-highlight-fill")) {
      map.setFilter("province-highlight-fill", highlightFilter);
      map.setPaintProperty("province-highlight-fill", "fill-color", "#0b1322");
      map.setPaintProperty("province-highlight-fill", "fill-opacity", activeTrackId ? 0 : 0.52);
    }

    // 4. 【魔兽极光结界 1 - 外层大漫射晕染】更新光晕颜色
    if (map.getLayer("province-glow-outer")) {
      map.setFilter("province-glow-outer", highlightFilter);
      map.setPaintProperty("province-glow-outer", "line-color", color);
      map.setPaintProperty("province-glow-outer", "line-opacity", activeTrackId ? 0 : (isDark ? 0.55 : 0.45));
    }

    // 5. 【魔兽极光结界 2 - 中层高光辉光】更新发光带
    if (map.getLayer("province-glow-middle")) {
      map.setFilter("province-glow-middle", highlightFilter);
      map.setPaintProperty("province-glow-middle", "line-color", color);
      map.setPaintProperty("province-glow-middle", "line-opacity", activeTrackId ? 0 : (isDark ? 0.85 : 0.75));
    }

    // 6. 【魔兽极光结界 3 - 内层极细电光芯线】更新核心线
    if (map.getLayer("province-glow-core")) {
      map.setFilter("province-glow-core", highlightFilter);
      map.setPaintProperty("province-glow-core", "line-opacity", activeTrackId ? 0 : 0.95);
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
      if (t.country === "香港") {
        provinceSet.add("香港");
      }
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

    ["hiking", "trail_running", "running", "cycling", "walking", "skateboarding", "driving", "train", "flight", "transit"].forEach((t) => {
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
    skateboarding: {
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

  // 渲染城市/省份快捷过滤胶囊标签 (Quick Filter Chips)
  function renderQuickFilterChips() {
    const chipsContainer = document.getElementById("quick_filter_chips");
    if (!chipsContainer || !manifestData || !Array.isArray(manifestData.tracks)) return;

    // 统计当前分类轨迹下的城市和省份频次
    const currentTracks = currentFilterType === "all"
      ? manifestData.tracks
      : manifestData.tracks.filter((t) => t.type === currentFilterType);

    const locationMap = new Map();
    currentTracks.forEach((t) => {
      if (t.city && typeof t.city === "string") {
        const city = t.city.trim();
        if (city && city !== "0" && city !== "未知" && city !== "中国") {
          locationMap.set(city, (locationMap.get(city) || 0) + 1);
        }
      } else if (t.province && typeof t.province === "string") {
        const prov = normalizeProvince(t.province) || t.province.trim();
        if (prov && prov !== "0" && prov !== "未知") {
          locationMap.set(prov, (locationMap.get(prov) || 0) + 1);
        }
      }
    });

    const sortedLocations = Array.from(locationMap.entries())
      .sort((a, b) => b[1] - a[1]);

    chipsContainer.innerHTML = "";

    // 1. 全部 Chip
    const allChip = document.createElement("button");
    allChip.className = "filter-chip" + (!searchQuery ? " is-active" : "");
    allChip.type = "button";
    allChip.dataset.query = "";
    allChip.innerHTML = `<span>全部</span><sub>${currentTracks.length}</sub>`;
    allChip.addEventListener("click", () => {
      const searchInput = document.getElementById("search_input");
      const clearBtn = document.getElementById("search_clear_btn");
      if (searchInput) searchInput.value = "";
      if (clearBtn) clearBtn.style.display = "none";
      searchQuery = "";
      resetTrackSelection();
      updateQuickFilterChipsActiveState();
      renderTrackList();
      renderMapTracks();
    });
    chipsContainer.appendChild(allChip);

    // 2. 各城市/省份 Chips
    sortedLocations.forEach(([name, count]) => {
      const chip = document.createElement("button");
      const isActive = searchQuery && searchQuery.toLowerCase() === name.toLowerCase();
      chip.className = "filter-chip" + (isActive ? " is-active" : "");
      chip.type = "button";
      chip.dataset.query = name;
      chip.innerHTML = `<span>${escapeHtml(name)}</span><sub>${count}</sub>`;
      chip.addEventListener("click", () => {
        const searchInput = document.getElementById("search_input");
        const clearBtn = document.getElementById("search_clear_btn");
        if (searchQuery && searchQuery.toLowerCase() === name.toLowerCase()) {
          searchQuery = "";
          if (searchInput) searchInput.value = "";
          if (clearBtn) clearBtn.style.display = "none";
        } else {
          searchQuery = name;
          if (searchInput) searchInput.value = name;
          if (clearBtn) clearBtn.style.display = "flex";
        }
        resetTrackSelection();
        updateQuickFilterChipsActiveState();
        renderTrackList();
        renderMapTracks();
      });
      chipsContainer.appendChild(chip);
    });
  }

  function updateQuickFilterChipsActiveState() {
    const chipsContainer = document.getElementById("quick_filter_chips");
    if (!chipsContainer) return;
    const chips = chipsContainer.querySelectorAll(".filter-chip");
    chips.forEach((chip) => {
      const q = chip.dataset.query;
      if (!searchQuery) {
        if (q === "") {
          chip.classList.add("is-active");
        } else {
          chip.classList.remove("is-active");
        }
      } else {
        if (q && q.toLowerCase() === searchQuery.toLowerCase()) {
          chip.classList.add("is-active");
        } else {
          chip.classList.remove("is-active");
        }
      }
    });
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

    if (!activeTrackId) {
      if (currentFilterType === "all" && !searchQuery) {
        fitWorldView(true);
      } else if (filteredTracks.length > 0) {
        fitAllTracks(filteredTracks);
      }
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
      const isDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
      if (isFocused) {
        map.setPaintProperty("all-tracks-core", "line-opacity", 0.15);
        map.setPaintProperty("all-tracks-core", "line-width", 1.5);
        map.setPaintProperty("all-tracks-core", "line-color", "#475569");
        map.setPaintProperty("all-tracks-glow", "line-opacity", 0);

        // 聚焦单轨详情：平滑淡化陆地战争迷雾与暗黑石板微光，完整呈现真实地形与等高线/街道/卫星影像原貌
        if (map.getLayer("world-land-fog-shadow")) {
          map.setPaintProperty("world-land-fog-shadow", "line-opacity", 0);
        }
        if (map.getLayer("world-land-fog")) {
          map.setPaintProperty("world-land-fog", "fill-opacity", 0);
        }
        if (map.getLayer("world-land-fog-cloud")) {
          map.setPaintProperty("world-land-fog-cloud", "fill-opacity", 0);
        }
        if (map.getLayer("world-land-fog-casing")) {
          map.setPaintProperty("world-land-fog-casing", "line-opacity", 0);
        }
        if (map.getLayer("province-unexplored-fill")) {
          map.setPaintProperty("province-unexplored-fill", "fill-opacity", 0);
        }
        if (map.getLayer("province-unexplored-cloud")) {
          map.setPaintProperty("province-unexplored-cloud", "fill-opacity", 0);
        }
        if (map.getLayer("province-highlight-fill")) {
          map.setPaintProperty("province-highlight-fill", "fill-opacity", 0);
        }
        if (map.getLayer("province-glow-outer")) {
          map.setPaintProperty("province-glow-outer", "line-opacity", 0);
        }
        if (map.getLayer("province-glow-middle")) {
          map.setPaintProperty("province-glow-middle", "line-opacity", 0);
        }
        if (map.getLayer("province-glow-core")) {
          map.setPaintProperty("province-glow-core", "line-opacity", 0);
        }
      } else {
        map.setPaintProperty("all-tracks-core", "line-opacity", 0.85);
        map.setPaintProperty("all-tracks-core", "line-width", 2.5);
        map.setPaintProperty("all-tracks-core", "line-color", ["get", "color"]);
        map.setPaintProperty("all-tracks-glow", "line-opacity", 0.4);

        // 退出聚焦恢复全景：平滑恢复陆地卷云迷雾与暗黑石板微光遮罩，凸显全景轨迹线
        const provVisible = overlayConfig.provinces;
        if (map.getLayer("world-land-fog-shadow")) {
          map.setPaintProperty("world-land-fog-shadow", "line-opacity", provVisible ? 0.65 : 0);
        }
        if (map.getLayer("world-land-fog")) {
          map.setPaintProperty("world-land-fog", "fill-opacity", provVisible ? 0.98 : 0);
        }
        if (map.getLayer("world-land-fog-cloud")) {
          map.setPaintProperty("world-land-fog-cloud", "fill-opacity", provVisible ? 0.95 : 0);
        }
        if (map.getLayer("world-land-fog-casing")) {
          map.setPaintProperty("world-land-fog-casing", "line-opacity", provVisible ? (isDark ? 0.75 : 0.65) : 0);
        }
        if (map.getLayer("province-unexplored-fill")) {
          map.setPaintProperty("province-unexplored-fill", "fill-opacity", provVisible ? 0.98 : 0);
        }
        if (map.getLayer("province-unexplored-cloud")) {
          map.setPaintProperty("province-unexplored-cloud", "fill-opacity", provVisible ? 0.95 : 0);
        }
        if (map.getLayer("province-highlight-fill")) {
          map.setPaintProperty("province-highlight-fill", "fill-opacity", provVisible ? 0.52 : 0);
        }
        if (map.getLayer("province-glow-outer")) {
          map.setPaintProperty("province-glow-outer", "line-opacity", provVisible ? (isDark ? 0.55 : 0.45) : 0);
        }
        if (map.getLayer("province-glow-middle")) {
          map.setPaintProperty("province-glow-middle", "line-opacity", provVisible ? (isDark ? 0.85 : 0.75) : 0);
        }
        if (map.getLayer("province-glow-core")) {
          map.setPaintProperty("province-glow-core", "line-opacity", provVisible ? 0.95 : 0);
        }
      }

      // 同步大洲与国家宏观注记的显隐（单轨聚焦时平滑淡出，退出恢复）
      updateWorldLabelsVisibility();
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
      const isMobile = window.innerWidth <= 768;
      const fitPadding = isMobile
        ? { top: 60, bottom: 170, left: 24, right: 24 }
        : { top: 80, bottom: 200, left: 350, right: 80 };
      map.fitBounds(
        [[item.bbox[0], item.bbox[1]], [item.bbox[2], item.bbox[3]]],
        { padding: fitPadding, maxZoom: 15, duration: 1200 }
      );
    }

    // 移动端选中轨迹后，自动收起底部抽屉与遮罩，展示高亮路线与路线详情
    if (window.innerWidth <= 768) {
      const sidebar = document.getElementById("sidebar");
      const toggleBtn = document.getElementById("sidebar_toggle_btn");
      const sidebarBackdrop = document.getElementById("sidebar_backdrop");
      if (sidebar) sidebar.classList.add("collapsed");
      if (toggleBtn) toggleBtn.classList.add("visible");
      if (sidebarBackdrop) sidebarBackdrop.style.display = "none";
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
        if (map && map.getSource("selected-track-transfer")) {
          map.getSource("selected-track-transfer").setData({ type: "FeatureCollection", features: [] });
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
    if (map && map.getSource("selected-track-transfer")) {
      map.getSource("selected-track-transfer").setData({ type: "FeatureCollection", features: [] });
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
    if (currentFilterType === "all" && !searchQuery) {
      fitWorldView(true);
    }
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
    if (imgEl) {
      imgEl.src = urls.full;
      imgEl.onerror = function () {
        if (this.src !== urls.fallbackFull) {
          this.src = urls.fallbackFull;
        }
      };
    }

    const titleEl = document.getElementById("lightbox_title");
    if (titleEl) titleEl.textContent = photo.filename || "";

    const exifEl = document.getElementById("lightbox_exif");
    if (exifEl) exifEl.textContent = [photo.camera, photo.lens, photo.params].filter(Boolean).join(" · ");

    const timeEl = document.getElementById("lightbox_time");
    if (timeEl) timeEl.textContent = photo.time ? `📅 拍摄时间: ${photo.time}` : "";

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

  function transferSpeedLimitKmh(activityType) {
    if (activityType === "hiking" || activityType === "walking") return 15;
    if (activityType === "running" || activityType === "trail_running") return 25;
    return Infinity;
  }

  function haversineDistanceKm(a, b) {
    const earthRadiusKm = 6371;
    const toRadians = (degrees) => (degrees * Math.PI) / 180;
    const dLat = toRadians(b[1] - a[1]);
    const dLon = toRadians(b[0] - a[0]);
    const lat1 = toRadians(a[1]);
    const lat2 = toRadians(b[1]);
    const arc = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return earthRadiusKm * 2 * Math.atan2(Math.sqrt(arc), Math.sqrt(1 - arc));
  }

  function isTransferConnection(previous, current, activityType) {
    const previousTime = Number(previous[3]);
    const currentTime = Number(current[3]);
    if (!Number.isFinite(previousTime) || !Number.isFinite(currentTime) || currentTime <= previousTime) return false;

    const distanceKm = haversineDistanceKm(previous, current);
    const elapsedHours = (currentTime - previousTime) / 3600;
    if (elapsedHours <= 0) return false;

    const speedKmh = distanceKm / elapsedHours;
    if (speedKmh > transferSpeedLimitKmh(activityType)) return true;

    // 相隔至少 1.5 km、且中间断采样 10 分钟以上的直连没有真实路径可供呈现。
    // 即使慢速乘车未越过运动速度阈值，也应明确标为转场虚线。
    return distanceKm >= 1.5 && elapsedHours >= (10 / 60);
  }

  function splitRecordedAndTransferSegments(rawCoords, activityType) {
    const recordedSegments = [];
    const transferSegments = [];
    if (!rawCoords.length) return { recordedSegments, transferSegments };

    let recordedSegment = [[rawCoords[0][0], rawCoords[0][1]]];
    for (let index = 1; index < rawCoords.length; index++) {
      const previous = rawCoords[index - 1];
      const current = rawCoords[index];
      const currentCoord = [current[0], current[1]];

      if (isTransferConnection(previous, current, activityType)) {
        if (recordedSegment.length > 1) recordedSegments.push(recordedSegment);
        transferSegments.push([[previous[0], previous[1]], currentCoord]);
        recordedSegment = [currentCoord];
      } else {
        recordedSegment.push(currentCoord);
      }
    }
    if (recordedSegment.length > 1) recordedSegments.push(recordedSegment);

    return { recordedSegments, transferSegments };
  }

  function renderSelectedTrackOnMap(detail) {
      if (!map || !detail) return;

      // 自愈检查：若图层尚未创建，尝试立即初始化图层
      if (!map.getSource("selected-track") || !map.getSource("selected-track-transfer") || !map.getLayer("selected-track-core")) {
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
    const transferSource = map.getSource("selected-track-transfer");
    if (!source || !transferSource) return;

    const rawCoords = detail.coordinates || [];
    const coords = rawCoords.map((p) => [p[0], p[1]]);
    const color = activityColors[detail.type] || "#00d2ff";
    const { recordedSegments, transferSegments } = splitRecordedAndTransferSegments(rawCoords, detail.type);

    source.setData({
      type: "FeatureCollection",
      features: recordedSegments.map((coordinates) => ({
        type: "Feature",
        properties: { id: detail.id, color: color },
        geometry: { type: "LineString", coordinates },
      })),
    });

    transferSource.setData({
      type: "FeatureCollection",
      features: transferSegments.map((coordinates) => ({
        type: "Feature",
        properties: { id: detail.id, color: color },
        geometry: { type: "LineString", coordinates },
      })),
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
    if (!detail) return;
    const hud = document.getElementById("profile_hud");
    const toggleBtn = document.getElementById("profile_toggle_btn");
    if (hud) hud.classList.add("visible");
    if (toggleBtn) toggleBtn.classList.remove("visible");

    // 移动端：路线详情展开时隐藏列表唤起按钮，避免底部堆叠重叠
    const sidebarToggleBtn = document.getElementById("sidebar_toggle_btn");
    if (sidebarToggleBtn && window.innerWidth <= 768) {
      sidebarToggleBtn.classList.remove("visible");
    }

    const toggleTitle = document.getElementById("profile_toggle_title");
    if (toggleTitle) toggleTitle.textContent = detail.title || "路线详情";

    const typeLabel = activityLabels[detail.type] || "徒步";
    const color = activityColors[detail.type] || "#00d2ff";

    const badge = document.getElementById("profile_track_type_badge");
    if (badge) {
      badge.textContent = typeLabel;
      badge.style.color = color;
    }

    const titleEl = document.getElementById("profile_track_title");
    if (titleEl) titleEl.textContent = detail.title || "--";

    const distEl = document.getElementById("profile_stat_dist");
    if (distEl) distEl.textContent = detail.distance_km != null ? detail.distance_km : "--";

    const gainEl = document.getElementById("profile_stat_gain");
    if (gainEl) gainEl.textContent = detail.elevation_gain_m != null ? Math.round(detail.elevation_gain_m) : "--";

    const maxEleEl = document.getElementById("profile_stat_max_ele");
    if (maxEleEl) maxEleEl.textContent = detail.max_elevation_m != null ? Math.round(detail.max_elevation_m) : "--";

    const durationEl = document.getElementById("profile_stat_duration");
    if (durationEl) durationEl.textContent = formatDuration(detail.duration_s);
    
    const speedLabel = document.getElementById("profile_speed_label");
    const speedStat = document.getElementById("profile_stat_speed");
    const speedUnit = document.getElementById("profile_speed_unit");
    
    if (speedLabel && speedStat && speedUnit) {
      if (detail.type === "running" || detail.type === "trail_running") {
        speedLabel.textContent = "配速";
        speedStat.textContent = formatPace(detail.avg_speed_kmh);
        speedUnit.textContent = "/KM";
      } else {
        speedLabel.textContent = "均速";
        speedStat.textContent = detail.avg_speed_kmh != null ? detail.avg_speed_kmh : "--";
        speedUnit.textContent = "km/h";
      }
    }

    const hrWrapper = document.getElementById("profile_hr_wrapper");
    const hrStat = document.getElementById("profile_stat_hr");
    if (hrWrapper && hrStat) {
      if (detail.avg_hr > 0) {
        hrWrapper.style.display = "block";
        hrStat.textContent = detail.max_hr > detail.avg_hr ? `${detail.avg_hr} (最高 ${detail.max_hr})` : `${detail.avg_hr}`;
      } else {
        hrWrapper.style.display = "none";
      }
    }

    // 照片按钮控制
    const btnPhotos = document.getElementById("btn_toggle_photos");
    const photoCountText = document.getElementById("photo_count_btn_text");
    if (btnPhotos) {
      if (detail.photos && detail.photos.length > 0) {
        btnPhotos.style.display = "inline-flex";
        if (photoCountText) photoCountText.textContent = `沿途作品 (${detail.photos.length})`;
      } else {
        btnPhotos.style.display = "none";
      }
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

    // 移动端：若彻底退出路线详情，且侧边栏处于收起态，恢复左下角列表唤起按钮
    if (window.innerWidth <= 768 && (!retainSelection || !activeTrackDetail)) {
      const sidebar = document.getElementById("sidebar");
      const sidebarToggleBtn = document.getElementById("sidebar_toggle_btn");
      if (sidebar && sidebar.classList.contains("collapsed") && sidebarToggleBtn) {
        sidebarToggleBtn.classList.add("visible");
      }
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
    const rawElevations = profile.map((p) => p.e);
    const rawMax = Math.max(...rawElevations);
    const rawMin = Math.min(...rawElevations);
    const rawSpan = rawMax - rawMin;

    // 动态自适应高程缩放：上下保留缓冲留白，同时设置最小视觉跨度避免平路/操场微小 GPS 抖动被过度放大
    const minVisualSpan = 30;
    const padding = Math.max(rawSpan * 0.12, 10);
    let minEle = Math.floor(rawMin - padding);
    let maxEle = Math.ceil(rawMax + padding);

    if (rawMin >= 0 && minEle < 0) {
      minEle = 0; // 非负海拔地区底部不低于海平面 0m
    }

    if (maxEle - minEle < minVisualSpan) {
      const mid = (rawMax + rawMin) / 2;
      minEle = rawMin >= 0 ? Math.max(0, Math.floor(mid - minVisualSpan / 2)) : Math.floor(mid - minVisualSpan / 2);
      maxEle = Math.ceil(minEle + minVisualSpan);
    }

    const eleRange = Math.max(maxEle - minEle, 1);
    const totalDist = detail.distance_km || 1;

    const color = activityColors[detail.type] || "#00d2ff";
    const gradient = ctx.createLinearGradient(0, padY, 0, h - padY);
    gradient.addColorStop(0, color + "aa");
    gradient.addColorStop(1, color + "11");

    // 高程填充区域
    ctx.beginPath();
    let lastX = w - padX;
    profile.forEach((p, idx) => {
      const ratio = Math.min(Math.max(p.d / totalDist, 0), 1);
      const x = padX + ratio * (w - padX * 2);
      const y = h - padY - ((p.e - minEle) / eleRange) * (h - padY * 2);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      lastX = x;
    });

    ctx.lineTo(lastX, h - padY);
    ctx.lineTo(padX, h - padY);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // 折线顶边
    ctx.beginPath();
    profile.forEach((p, idx) => {
      const ratio = Math.min(Math.max(p.d / totalDist, 0), 1);
      const x = padX + ratio * (w - padX * 2);
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
      const hRatio = Math.min(Math.max(hp.d / totalDist, 0), 1);
      const hx = padX + hRatio * (w - padX * 2);
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

    // 工具栏世界全景复位按钮
    const btnResetWorldView = document.getElementById("btn_reset_world_view");
    if (btnResetWorldView) {
      btnResetWorldView.addEventListener("click", () => {
        if (activeTrackId) {
          resetTrackSelection();
        }
        fitWorldView(true);
      });
    }

    // 工具栏探索迷雾快捷切换
    const btnToolbarProvinces = document.getElementById("btn_toggle_provinces");
    if (btnToolbarProvinces) {
      btnToolbarProvinces.addEventListener("click", () => {
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
        if (typeof btn.scrollIntoView === "function") {
          btn.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
        }
        currentFilterType = btn.dataset.type;

        // 切换分类时清空搜索条件，确保新分类从全景开始
        searchQuery = "";
        const searchInput = document.getElementById("search_input");
        const searchClearBtn = document.getElementById("search_clear_btn");
        if (searchInput) searchInput.value = "";
        if (searchClearBtn) searchClearBtn.style.display = "none";

        // 取消当前选中的轨迹详情，恢复全景底网
        resetTrackSelection();

        // 根据运动场景智能建议底图（仅当推荐底图具备有效凭据时智能联动）
        const suggestedTheme = activitySuggestedTheme[currentFilterType];
        if (suggestedTheme && suggestedTheme !== currentTheme) {
          const style = window.MapSourceRegistry ? window.MapSourceRegistry.getStyle(suggestedTheme) : null;
          if (style && window.MapSourceRegistry.hasValidAuth(style)) {
            switchTheme(suggestedTheme, false);
          }
        }

        updateHUDStats(currentFilterType);
        renderQuickFilterChips();
        renderTrackList();
        renderMapTracks();
      });
    }

    // 6. 侧边栏折叠/展开与移动端底部抽屉联动
    const sidebar = document.getElementById("sidebar");
    const closeBtn = document.getElementById("sidebar_close_btn");
    const toggleBtn = document.getElementById("sidebar_toggle_btn");
    const sidebarBackdrop = document.getElementById("sidebar_backdrop");

    function closeSidebar() {
      if (sidebar) sidebar.classList.add("collapsed");
      if (toggleBtn) toggleBtn.classList.add("visible");
      if (sidebarBackdrop) sidebarBackdrop.style.display = "none";
    }

    function openSidebar() {
      if (sidebar) sidebar.classList.remove("collapsed");
      if (toggleBtn) toggleBtn.classList.remove("visible");
      if (sidebarBackdrop && window.innerWidth <= 768) {
        sidebarBackdrop.style.display = "block";
      }
    }

    if (closeBtn) closeBtn.addEventListener("click", closeSidebar);
    if (toggleBtn) toggleBtn.addEventListener("click", openSidebar);
    if (sidebarBackdrop) sidebarBackdrop.addEventListener("click", closeSidebar);

    // 移动端初始加载：默认收起抽屉，展示开阔的全景地图
    if (window.innerWidth <= 768) {
      closeSidebar();
    }

    // 7. 搜索框与快捷过滤联动
    const searchInput = document.getElementById("search_input");
    const searchClearBtn = document.getElementById("search_clear_btn");
    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        searchQuery = e.target.value.trim();
        if (searchClearBtn) {
          searchClearBtn.style.display = searchQuery ? "flex" : "none";
        }
        resetTrackSelection();
        updateQuickFilterChipsActiveState();
        renderTrackList();
        renderMapTracks();
      });
    }

    if (searchClearBtn) {
      searchClearBtn.addEventListener("click", () => {
        if (searchInput) {
          searchInput.value = "";
          searchInput.focus();
        }
        searchClearBtn.style.display = "none";
        searchQuery = "";
        resetTrackSelection();
        updateQuickFilterChipsActiveState();
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

    // 12. 高程 Canvas Hover 与移动端 Touch 联动
    const canvas = document.getElementById("elevation_canvas");
    if (canvas) {
      canvas.addEventListener("mousemove", onCanvasHover);
      canvas.addEventListener("mouseleave", () => {
        if (activeTrackDetail) drawElevationProfile(activeTrackDetail, -1);
        if (hoverMarker) hoverMarker.remove();
      });

      canvas.addEventListener("touchstart", (e) => {
        onCanvasHover(e);
      }, { passive: true });

      canvas.addEventListener("touchmove", (e) => {
        onCanvasHover(e);
      }, { passive: true });

      canvas.addEventListener("touchend", () => {
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

    const btnOpenMobile = document.getElementById("btn_open_map_settings_mobile");
    if (btnOpen) {
      btnOpen.addEventListener("click", openMapSettingsModal);
    }
    if (btnOpenMobile) {
      btnOpenMobile.addEventListener("click", () => {
        const overlaysDropdown = document.getElementById("overlays_dropdown");
        if (overlaysDropdown) overlaysDropdown.style.display = "none";
        openMapSettingsModal();
      });
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
    const clientX = (e.touches && e.touches.length > 0)
      ? e.touches[0].clientX
      : (e.changedTouches && e.changedTouches.length > 0 ? e.changedTouches[0].clientX : e.clientX);
    const mouseX = clientX - rect.left;
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

  function formatPace(speedKmh) {
    if (!speedKmh || speedKmh <= 0) return "0'00''";
    const paceMinDec = 60 / speedKmh;
    let mins = Math.floor(paceMinDec);
    let secs = Math.round((paceMinDec - mins) * 60);
    if (secs === 60) {
      mins += 1;
      secs = 0;
    }
    return `${mins}'${secs.toString().padStart(2, '0')}''`;
  }

  function escapeHtml(str) {
    if (!str) return "";
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  document.addEventListener("DOMContentLoaded", init);
})();
