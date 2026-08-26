/**
 * Footprint (Tracks) Map & Elevation Profile Controller
 * Powered by MapLibre GL JS & Multi-Source Map Architecture
 */

(function () {
  let map = null;
  let manifestData = null;
  let activeTrackId = null;
  let activeTrackDetail = null;
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
  };

  // 标点与交互光标
  let hoverMarker = null;
  let startMarker = null;
  let endMarker = null;
  let photoMarkers = [];

  // 高饱和度、高对比度的户外荧光色系
  const activityColors = {
    trail_running: "#ff5500", // 燃橙
    hiking: "#10b981",        // 翡翠绿
    running: "#00d2ff",       // 电光蓝
    cycling: "#c084fc",       // 极光紫
    driving: "#fbbf24",       // 琥珀金
    walking: "#38bdf8",       // 浅海蓝
    transit: "#94a3b8",       // 银灰
  };

  const activityLabels = {
    trail_running: "越野跑",
    hiking: "徒步",
    running: "路跑",
    cycling: "骑行",
    driving: "自驾",
    walking: "行走",
    transit: "旅行",
  };

  // 运动场景与推荐底图映射 (全部采用免 Token 的免费开放图源: OpenTopoMap / OpenFreeMap / Esri Satellite)
  const activitySuggestedTheme = {
    all: "opentopomap",           // 全部：开放等高线地形
    hiking: "opentopomap",        // 徒步：OpenTopoMap 开放等高线地形
    trail_running: "opentopomap", // 越野跑：OpenTopoMap 开放等高线地形
    running: "openfreemap",       // 路跑：OpenFreeMap 开源街区路网
    cycling: "openfreemap",       // 骑行：OpenFreeMap 开源公路路网
    walking: "openfreemap",       // 行走：OpenFreeMap 开源街区
    driving: "satellite",         // 自驾：Esri 高清卫星影像
    transit: "satellite",         // 旅行：Esri 高清卫星影像
  };

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
      if (activeTrackDetail) {
        renderSelectedTrackOnMap(activeTrackDetail);
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

    // 插入到 GeoJSON 轨迹图层之下，确保底图在最底层
    const firstTrackLayer = map.getLayer("all-tracks-glow") 
      ? "all-tracks-glow" 
      : (map.getLayer("selected-track-casing") ? "selected-track-casing" : undefined);
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
  }

  function initMapLayers() {
    if (!map) return;

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
          "line-color": activeTrackId ? "#334155" : ["get", "color"],
          "line-width": activeTrackId ? 1.5 : 2.5,
          "line-opacity": activeTrackId ? 0.15 : 0.85,
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
          "line-opacity": 0.65,
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
          "line-color": ["coalesce", ["get", "color"], "#10b981"],
          "line-width": 6,
          "line-opacity": 0.95,
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
          "line-width": 2.5,
          "line-opacity": 0.9,
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

    // 同步 Checkbox 状态
    const chkTracks = document.getElementById("chk_overlay_tracks");
    const chkPhotos = document.getElementById("chk_overlay_photos");
    const chkWaypoints = document.getElementById("chk_overlay_waypoints");

    if (chkTracks) chkTracks.checked = overlayConfig.tracks;
    if (chkPhotos) chkPhotos.checked = overlayConfig.photos;
    if (chkWaypoints) chkWaypoints.checked = overlayConfig.waypoints;

    if (window.CredentialStore) {
      window.CredentialStore.saveOverlayConfig(overlayConfig);
    }
  }

  function getDataUrl(relativePath) {
    const clean = relativePath.replace(/^\/+/, "");
    // 如果当前处于 /web/tracks/ 路由下，使用 /web/tracks/ 前缀防止 404
    if (window.location.pathname.includes("/web/tracks")) {
      return `/web/tracks/${clean}`;
    }
    return clean;
  }

  async function loadManifest() {
    if (window.PhotoSource && typeof window.PhotoSource.ensureSourceConfig === "function") {
      try {
        await window.PhotoSource.ensureSourceConfig();
      } catch (_) {}
    }

    try {
      const res = await fetch(getDataUrl("data/manifest.json"));
      if (!res.ok) throw new Error(`HTTP ${res.status} loading manifest`);
      const data = await res.json();
      manifestData = data;
      updateHUDStats(currentFilterType);
      updateFilterCounts(data.stats);
      renderTrackList();
      renderMapTracks();
    } catch (err) {
      console.error("Error loading tracks manifest:", err);
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
        provinceSet.add(t.province.trim());
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

    ["hiking", "trail_running", "running", "cycling", "driving", "walking", "transit"].forEach((t) => {
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
        (t.province && t.province.includes(searchQuery)) ||
        (t.country && t.country.toLowerCase().includes(searchQuery.toLowerCase()));
      return matchType && matchQuery;
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

    tracks.forEach((t) => {
      const card = document.createElement("div");
      card.className = "track-card" + (t.id === activeTrackId ? " active" : "");
      card.dataset.id = t.id;
      const color = activityColors[t.type] || "#94a3b8";
      card.style.setProperty("--card-color", color);

      const typeLabel = activityLabels[t.type] || t.type;
      const dateStr = t.start_time ? t.start_time.substring(0, 10) : "";
      const hrStr = t.avg_hr > 0 ? `<span>❤️ ${t.avg_hr} bpm</span>` : "";
      const photoStr = t.photo_count > 0 ? `<span>📷 ${t.photo_count}张照片</span>` : "";

      card.innerHTML = `
        <div class="track-card-header">
          <span class="track-card-title" title="${escapeHtml(t.title)}">${escapeHtml(t.title)}</span>
          <span class="track-card-badge" style="color:${color}">${typeLabel}</span>
        </div>
        <div class="track-card-meta">
          <span>📅 ${dateStr}</span>
          <span>📍 ${t.distance_km} km</span>
          <span>▲ ${Math.round(t.elevation_gain_m)} m</span>
          ${hrStr}
          ${photoStr}
        </div>
      `;

      card.addEventListener("click", () => {
        selectTrack(t.id);
      });

      listEl.appendChild(card);
    });
  }

  function renderMapTracks() {
    if (!map || !manifestData || !mapLayersReady) return;
    const source = map.getSource("all-tracks");
    if (!source) return;

    const filtered = getFilteredTracks();
    const features = filtered.map((t) => {
      return {
        type: "Feature",
        properties: {
          id: t.id,
          title: t.title,
          type: t.type,
          color: activityColors[t.type] || "#94a3b8",
        },
        geometry: {
          type: "LineString",
          coordinates: t.coords || [],
        },
      };
    });

    source.setData({
      type: "FeatureCollection",
      features: features,
    });

    if (!activeTrackId && filtered.length > 0) {
      fitAllTracks(filtered);
    }
  }

  function fitAllTracks(tracks) {
    if (!tracks || tracks.length === 0) return;
    let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90;
    tracks.forEach((t) => {
      if (t.bbox) {
        if (t.bbox[0] < minLon) minLon = t.bbox[0];
        if (t.bbox[1] < minLat) minLat = t.bbox[1];
        if (t.bbox[2] > maxLon) maxLon = t.bbox[2];
        if (t.bbox[3] > maxLat) maxLat = t.bbox[3];
      }
    });

    if (minLon <= maxLon && minLat <= maxLat) {
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
    activeTrackId = id;

    document.querySelectorAll(".track-card").forEach((card) => {
      card.classList.toggle("active", card.dataset.id === id);
    });

    const item = manifestData && manifestData.tracks ? manifestData.tracks.find((t) => t.id === id) : null;
    if (item && item.bbox && map) {
      map.fitBounds(
        [[item.bbox[0], item.bbox[1]], [item.bbox[2], item.bbox[3]]],
        { padding: { top: 80, bottom: 200, left: 350, right: 80 }, maxZoom: 15, duration: 1200 }
      );
    }

    applyFocusDimming(true);

    if (window.PhotoSource && typeof window.PhotoSource.ensureSourceConfig === "function") {
      try {
        await window.PhotoSource.ensureSourceConfig();
      } catch (_) {}
    }

    fetch(getDataUrl(`data/tracks/${id}.json`))
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status} loading track ${id}`);
        return res.json();
      })
      .then((detail) => {
        activeTrackDetail = detail;
        renderSelectedTrackOnMap(detail);
        showProfileHUD(detail);
      })
      .catch((err) => console.error("Failed to load track detail:", err));
  }

  function resetTrackSelection() {
    if (!activeTrackId) return;
    activeTrackId = null;
    activeTrackDetail = null;

    hideProfileHUD(false);
    document.querySelectorAll(".track-card").forEach((c) => c.classList.remove("active"));

    if (map && map.getSource("selected-track")) {
      map.getSource("selected-track").setData({ type: "FeatureCollection", features: [] });
    }
    if (startMarker) startMarker.remove();
    if (endMarker) endMarker.remove();
    if (hoverMarker) hoverMarker.remove();
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
    if (!map || !detail || !mapLayersReady) return;
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

    if (startMarker) startMarker.remove();
    if (endMarker) endMarker.remove();

    if (coords.length > 1) {
      const startEl = document.createElement("div");
      startEl.innerHTML = `<div style="width:16px;height:16px;background:#10b981;border:2px solid #fff;border-radius:50%;box-shadow:0 0 10px #10b981;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:bold;color:#fff;">S</div>`;
      startEl.addEventListener("click", (e) => e.stopPropagation());
      startMarker = new maplibregl.Marker({ element: startEl })
        .setLngLat(coords[0]);

      const endEl = document.createElement("div");
      endEl.innerHTML = `<div style="width:16px;height:16px;background:#ef4444;border:2px solid #fff;border-radius:50%;box-shadow:0 0 10px #ef4444;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:bold;color:#fff;">F</div>`;
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
    const chkTracks = document.getElementById("chk_overlay_tracks");
    const chkPhotos = document.getElementById("chk_overlay_photos");
    const chkWaypoints = document.getElementById("chk_overlay_waypoints");

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
