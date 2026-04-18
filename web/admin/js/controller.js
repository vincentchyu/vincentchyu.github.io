import {
  batchUpdatePhotos,
  deletePhoto,
  fetchGallerySource,
  fetchPhotoPage,
  fetchRebuildStatus,
  savePhoto,
  startRebuild,
  updateGallerySource,
  uploadPhoto,
} from "./api.js";
import { state } from "./state.js";
import {
  addUploadLog,
  bindViewActions,
  elements,
  hideDetail,
  populateYearFilter,
  renderPhotos,
  renderRebuildStatus,
  resetRebuildModal,
  resetUploadModal,
  setButtonLoading,
  showDetail as renderDetail,
  showLoadError,
  showRebuildProgressPanel,
  showRemotePreview as renderRemotePreview,
  renderGallerySource,
  syncPhotoCards,
  updateBatchButtons,
  updateStats,
  updateUploadProgress,
  updateZoomClass,
} from "./view.js";

const SEARCH_DEBOUNCE_MS = 200;
const PAGE_SIZE = 120;
const LOAD_MORE_THRESHOLD = 600;
const MAX_QUERY_CACHE_ENTRIES = 4;
const IMAGE_PREHEAT_LIMIT = 18;
const WARMED_IMAGE_TTL_MS = 5 * 60 * 1000;

const queryPageCache = new Map();
const warmedImageCache = new Map();
let filterDebounceTimer = null;
let listRequestToken = 0;
let pendingReset = false;

export function initAdminApp() {
  bindViewActions({
    showDetail,
    showRemotePreview,
    toggleSelection,
  });

  loadGallerySource();
  loadPhotos({ reset: true });
  setupEventListeners();
  setupInfiniteScroll();
  setupZoomEvents();
}

async function loadPhotos({ reset = false } = {}) {
  const filters = readFilterState();
  const queryKey = buildQueryKey(filters);

  if (reset && state.isLoadingPhotos) {
    pendingReset = true;
    listRequestToken += 1;
    return;
  }

  if (state.isLoadingPhotos || (!reset && !state.hasMorePhotos)) {
    return;
  }

  if (reset) {
    listRequestToken += 1;
    pendingReset = false;
    resetLoadedPhotos();
    elements.photoGrid.innerHTML = '<div class="loading">加载中...</div>';

    if (restoreCachedQuery(queryKey, filters)) {
      maybeLoadNextPage();
      return;
    }
  }

  const requestToken = listRequestToken;
  state.isLoadingPhotos = true;

  try {
    const cursor = reset ? "" : state.nextCursor;
    const page = await loadPhotoPage(queryKey, cursor, filters);
    rememberLoadedPage(queryKey, cursor, page);

    if (requestToken !== listRequestToken) {
      return;
    }

    const incomingPhotos = page.items.map(preparePhoto);
    if (reset) {
      state.allPhotos = incomingPhotos;
    } else {
      state.allPhotos = state.allPhotos.concat(incomingPhotos);
    }

    state.filteredPhotos = state.allPhotos;
    state.photosByFilename = new Map(
      state.allPhotos.map((photo) => [photo.filename, photo])
    );
    state.totalPhotoCount = page.totalCount;
    state.hiddenPhotoCount = page.hiddenCount;
    state.availableYears = page.years;
    state.nextCursor = page.nextCursor;
    state.hasMorePhotos = page.hasMore;

    renderPhotos({ append: !reset });
    updateStats();
    updateBatchButtons();
    populateYearFilter();

    warmCurrentPageEdges(queryKey, cursor, page);
    scheduleNeighborPrefetch(queryKey, page, filters);

    if (reset) {
      maybeLoadNextPage();
    }
  } catch (error) {
    console.error("Error loading photos:", error);
    showLoadError();
  } finally {
    state.isLoadingPhotos = false;
    if (pendingReset) {
      pendingReset = false;
      loadPhotos({ reset: true });
    }
  }
}

function showDetail(filename) {
  renderDetail(filename);
}

function showRemotePreview(filename, type = "thumbnail", provider = "active") {
  renderRemotePreview(filename, type, provider);
}

function toggleSelection(filename, selected) {
  const isSelected = state.selectedPhotos.has(filename);
  if (isSelected === selected) {
    return;
  }

  if (selected) {
    state.selectedPhotos.add(filename);
  } else {
    state.selectedPhotos.delete(filename);
  }

  updateStats();
  updateBatchButtons();
  syncPhotoCards(filename);
}

async function saveDetail() {
  if (!state.currentPhoto) return;

  const updates = {
    alt: document.getElementById("detailAlt").value,
    is_hidden: document.getElementById("detailIsHidden").checked,
    Subject: document
      .getElementById("detailTags")
      .value.split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag),
  };

  const btnId = "saveDetailBtn";
  setButtonLoading(btnId, true);

  try {
    const previousHidden = state.currentPhoto.is_hidden;

    await savePhoto(state.currentPhoto, updates);
    clearPhotoPageCache();

    state.currentPhoto.alt = updates.alt;
    state.currentPhoto.is_hidden = updates.is_hidden;
    state.currentPhoto.Subject = updates.Subject;

    if (hasStatusFilter() && previousHidden !== updates.is_hidden) {
      await loadPhotos({ reset: true });
    } else {
      if (previousHidden !== updates.is_hidden) {
        state.hiddenPhotoCount += updates.is_hidden ? 1 : -1;
      }
      syncPhotoCards(state.currentPhoto.filename);
      updateStats();
    }

    hideDetail();
  } catch (error) {
    console.error("Error saving photo:", error);
    alert("保存失败，请重试");
  } finally {
    setButtonLoading(btnId, false);
  }
}

async function deleteCurrentPhoto() {
  if (!state.currentPhoto) return;

  if (
    !confirm(
      `确定要删除照片 ${state.currentPhoto.filename} 吗？\n此操作将删除本地文件和远端对象存储中的文件，且无法恢复！`
    )
  ) {
    return;
  }

  const btnId = "deletePhotoBtn";
  setButtonLoading(btnId, true);

  try {
    await deletePhoto(state.currentPhoto);
    clearPhotoPageCache();

    if (state.currentPhoto.is_hidden) {
      state.hiddenPhotoCount -= 1;
    }

    state.totalPhotoCount = Math.max(0, state.totalPhotoCount - 1);
    state.allPhotos = state.allPhotos.filter(
      (photo) => photo.filename !== state.currentPhoto.filename
    );
    state.filteredPhotos = state.allPhotos;
    state.photosByFilename.delete(state.currentPhoto.filename);
    state.selectedPhotos.delete(state.currentPhoto.filename);

    renderPhotos();
    updateStats();
    updateBatchButtons();
    hideDetail();

    if (state.hasMorePhotos) {
      maybeLoadNextPage();
    }

    alert("照片已删除");
  } catch (error) {
    console.error("Error deleting photo:", error);
    alert("删除失败，请重试");
  } finally {
    setButtonLoading(btnId, false);
  }
}

async function batchUpdate(isHidden) {
  if (state.selectedPhotos.size === 0) return;

  const btnId = isHidden ? "batchHideBtn" : "batchShowBtn";
  const otherBtnId = isHidden ? "batchShowBtn" : "batchHideBtn";

  setButtonLoading(btnId, true);
  document.getElementById(otherBtnId).disabled = true;

  try {
    await batchUpdatePhotos(Array.from(state.selectedPhotos), {
      is_hidden: isHidden,
    });
    clearPhotoPageCache();

    const filenamesToSync = new Set();
    let hiddenDelta = 0;

    state.allPhotos.forEach((photo) => {
      if (!state.selectedPhotos.has(photo.filename)) {
        return;
      }

      if (photo.is_hidden !== isHidden) {
        hiddenDelta += isHidden ? 1 : -1;
      }

      photo.is_hidden = isHidden;
      filenamesToSync.add(photo.filename);
    });

    state.selectedPhotos.clear();

    if (hasStatusFilter()) {
      await loadPhotos({ reset: true });
    } else {
      state.hiddenPhotoCount += hiddenDelta;
      syncPhotoCards(Array.from(filenamesToSync));
      updateStats();
      updateBatchButtons();
    }

    alert(isHidden ? "所需照片已隐藏" : "所需照片已显示");
  } catch (error) {
    console.error("Error batch updating:", error);
    alert("批量操作失败，请重试");
  } finally {
    setButtonLoading(btnId, false);
    updateBatchButtons();
  }
}

function filterPhotos() {
  loadPhotos({ reset: true });
}

function openRebuildChooser() {
  resetRebuildModal();
}

async function executeRebuild(force) {
  showRebuildProgressPanel(force);

  try {
    await startRebuild(force);
    pollRebuildStatus();
  } catch (error) {
    console.error("Error starting rebuild:", error);
    alert("启动重建失败，请重试");
    elements.rebuildModal.classList.remove("active");
  }
}

async function pollRebuildStatus() {
  try {
    const status = await fetchRebuildStatus();
    renderRebuildStatus(status);

    if (status.status === "running") {
      setTimeout(pollRebuildStatus, 1000);
      return;
    }

    if (status.status === "completed") {
      setTimeout(() => {
        elements.rebuildModal.classList.remove("active");
        clearPhotoPageCache();
        loadGallerySource();
        loadPhotos({ reset: true });
      }, 2000);
      return;
    }

    if (status.status === "failed") {
      alert("重建失败，请查看日志");
    }
  } catch (error) {
    console.error("Error polling rebuild status:", error);
  }
}

async function handlePhotoUpload(event) {
  const files = Array.from(event.target.files);
  if (files.length === 0) return;

  resetUploadModal(files.length);

  let uploaded = 0;
  let failed = 0;

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];

    try {
      addUploadLog(`📤 正在上传: ${file.name}`);
      const result = await uploadPhoto(file);
      uploaded += 1;
      addUploadLog(`✅ 成功: ${file.name} → ${result.year || "未知年份"}`);
    } catch (error) {
      failed += 1;
      addUploadLog(`❌ 错误: ${file.name} - ${error.message}`);
    }

    const progress = Math.round(((index + 1) / files.length) * 100);
    updateUploadProgress(progress, index + 1, files.length, uploaded, failed);
  }

  addUploadLog(`\n🎉 上传完成！成功: ${uploaded}, 失败: ${failed}`);

  if (uploaded > 0) {
    addUploadLog("🔄 开始自动重建...");
    clearPhotoPageCache();
    setTimeout(async () => {
      elements.uploadModal.classList.remove("active");
      await executeRebuild(false);
    }, 2000);
  }

  event.target.value = "";
}

async function loadGallerySource() {
  try {
    const response = await fetchGallerySource();
    renderGallerySource(response);
  } catch (error) {
    console.error("Error loading gallery source:", error);
  }
}

async function switchGallerySource(activeSource) {
  const btnId = activeSource === "tos" ? "switchToTosBtn" : "switchToR2Btn";
  setButtonLoading(btnId, true);

  try {
    const response = await updateGallerySource(activeSource);
    renderGallerySource(response);
    clearPhotoPageCache();
    await loadPhotos({ reset: true });
  } catch (error) {
    console.error("Error switching gallery source:", error);
    alert(`切换数据源失败: ${error.message}`);
  } finally {
    setButtonLoading(btnId, false);
  }
}

function setupEventListeners() {
  document.getElementById("closeDetailBtn").addEventListener("click", hideDetail);
  document.getElementById("saveDetailBtn").addEventListener("click", saveDetail);
  document.getElementById("cancelDetailBtn").addEventListener("click", hideDetail);
  document.getElementById("deletePhotoBtn").addEventListener("click", deleteCurrentPhoto);

  document.getElementById("viewThumbBtn").addEventListener("click", () => {
    if (state.currentPhoto) {
      showRemotePreview(state.currentPhoto.filename, "thumbnail");
    }
  });

  document.getElementById("viewOriginalBtn").addEventListener("click", () => {
    if (state.currentPhoto) {
      showRemotePreview(state.currentPhoto.filename, "original");
    }
  });

  document
    .getElementById("switchToTosBtn")
    .addEventListener("click", () => switchGallerySource("tos"));
  document
    .getElementById("switchToR2Btn")
    .addEventListener("click", () => switchGallerySource("r2"));

  document.getElementById("rebuildBtn").addEventListener("click", openRebuildChooser);
  document.getElementById("rebuildNormalBtn").addEventListener("click", () => {
    executeRebuild(false);
  });
  document.getElementById("rebuildForceBtn").addEventListener("click", () => {
    executeRebuild(true);
  });
  document.getElementById("closeRebuildBtn").addEventListener("click", () => {
    elements.rebuildModal.classList.remove("active");
  });

  document.getElementById("closeR2Btn").addEventListener("click", () => {
    elements.r2Modal.classList.remove("active");
  });

  document.getElementById("closeUploadBtn").addEventListener("click", () => {
    elements.uploadModal.classList.remove("active");
  });

  document.getElementById("importBtn").addEventListener("click", () => {
    document.getElementById("photoUpload").click();
  });
  document
    .getElementById("photoUpload")
    .addEventListener("change", handlePhotoUpload);

  document
    .getElementById("batchHideBtn")
    .addEventListener("click", () => batchUpdate(true));
  document
    .getElementById("batchShowBtn")
    .addEventListener("click", () => batchUpdate(false));

  document
    .getElementById("searchInput")
    .addEventListener("input", scheduleFilterPhotos);
  document.getElementById("yearFilter").addEventListener("change", filterPhotos);
  document
    .getElementById("statusFilter")
    .addEventListener("change", filterPhotos);

  [elements.rebuildModal, elements.r2Modal, elements.uploadModal].forEach(
    (modal) => {
      modal.addEventListener("click", (event) => {
        if (event.target === modal) {
          modal.classList.remove("active");
        }
      });
    }
  );
}

function setupInfiniteScroll() {
  const onScroll = throttle(() => {
    maybeLoadNextPage();
  }, 150);

  window.addEventListener("scroll", onScroll, { passive: true });
  elements.photoGrid.addEventListener("scroll", onScroll, { passive: true });
}

function maybeLoadNextPage() {
  if (state.isLoadingPhotos || !state.hasMorePhotos) {
    return;
  }

  if (!isNearBottom()) {
    return;
  }

  loadPhotos();
}

function isNearBottom() {
  if (elements.photoGrid.classList.contains("virtual-scroll-enabled")) {
    return (
      elements.photoGrid.scrollTop + elements.photoGrid.clientHeight >=
      elements.photoGrid.scrollHeight - LOAD_MORE_THRESHOLD
    );
  }

  const rect = elements.photoGrid.getBoundingClientRect();
  return rect.bottom - window.innerHeight < LOAD_MORE_THRESHOLD;
}

function scheduleFilterPhotos() {
  if (filterDebounceTimer) {
    clearTimeout(filterDebounceTimer);
  }

  filterDebounceTimer = setTimeout(() => {
    filterDebounceTimer = null;
    filterPhotos();
  }, SEARCH_DEBOUNCE_MS);
}

function readFilterState() {
  return {
    searchTerm: document.getElementById("searchInput").value.trim(),
    yearFilter: document.getElementById("yearFilter").value,
    statusFilter: document.getElementById("statusFilter").value,
  };
}

function hasStatusFilter() {
  return readFilterState().statusFilter !== "";
}

function resetLoadedPhotos() {
  state.allPhotos = [];
  state.filteredPhotos = [];
  state.photosByFilename = new Map();
  state.selectedPhotos.clear();
  state.currentPhoto = null;
  state.nextCursor = "";
  state.hasMorePhotos = true;
  hideDetail();
  elements.photoGrid.scrollTop = 0;
  window.scrollTo(0, 0);
}

function buildQueryKey(filters) {
  return JSON.stringify({
    search: filters.searchTerm,
    year: filters.yearFilter,
    status: filters.statusFilter,
    limit: PAGE_SIZE,
  });
}

function getQueryCache(queryKey) {
  if (queryPageCache.has(queryKey)) {
    const existing = queryPageCache.get(queryKey);
    queryPageCache.delete(queryKey);
    queryPageCache.set(queryKey, existing);
    return existing;
  }

  const cache = {
    pagesByCursor: new Map(),
    loadedPageOrder: [],
    pendingRequests: new Map(),
    totalCount: 0,
    hiddenCount: 0,
    availableYears: [],
    nextCursor: "",
    hasMore: true,
  };

  queryPageCache.set(queryKey, cache);
  trimQueryCache();
  return cache;
}

function trimQueryCache() {
  while (queryPageCache.size > MAX_QUERY_CACHE_ENTRIES) {
    const oldestKey = queryPageCache.keys().next().value;
    if (typeof oldestKey === "undefined") {
      break;
    }

    queryPageCache.delete(oldestKey);
  }
}

function touchQueryCache(queryKey) {
  if (!queryPageCache.has(queryKey)) {
    return;
  }

  const cache = queryPageCache.get(queryKey);
  queryPageCache.delete(queryKey);
  queryPageCache.set(queryKey, cache);
}

function getCachedPage(queryKey, cursorKey) {
  const cache = queryPageCache.get(queryKey);
  if (!cache) {
    return null;
  }

  const page = cache.pagesByCursor.get(cursorKey || "");
  if (page) {
    touchQueryCache(queryKey);
  }
  return page || null;
}

function setCachedPage(queryKey, cursorKey, page) {
  const cache = getQueryCache(queryKey);
  const normalizedCursor = cursorKey || "";

  cache.pagesByCursor.set(normalizedCursor, page);
  if (!cache.loadedPageOrder.includes(normalizedCursor)) {
    cache.loadedPageOrder.push(normalizedCursor);
  }

  cache.totalCount = page.totalCount;
  cache.hiddenCount = page.hiddenCount;
  cache.availableYears = page.years;
  cache.nextCursor = page.nextCursor;
  cache.hasMore = page.hasMore;
  touchQueryCache(queryKey);
}

function getQueryCacheEntry(queryKey) {
  return queryPageCache.get(queryKey) || null;
}

function getPreviousCachedPage(queryKey, cursorKey) {
  const cache = getQueryCacheEntry(queryKey);
  if (!cache || cache.loadedPageOrder.length < 2) {
    return null;
  }

  const currentIndex = cache.loadedPageOrder.indexOf(cursorKey || "");
  if (currentIndex <= 0) {
    return null;
  }

  const prevCursor = cache.loadedPageOrder[currentIndex - 1];
  return prevCursor ? cache.pagesByCursor.get(prevCursor) || null : null;
}

function warmCurrentPageEdges(queryKey, cursorKey, page) {
  warmPhotoPageImages(page.items, "tail");

  const previousPage = getPreviousCachedPage(queryKey, cursorKey);
  if (previousPage) {
    warmPhotoPageImages(previousPage.items, "tail");
  }
}

function warmPhotoPageImages(photos, edge = "head") {
  if (!Array.isArray(photos) || photos.length === 0) {
    return;
  }

  const slice =
    edge === "tail"
      ? photos.slice(Math.max(0, photos.length - IMAGE_PREHEAT_LIMIT))
      : photos.slice(0, IMAGE_PREHEAT_LIMIT);

  slice.forEach((photo) => warmImageUrl(buildImageUrl(photo)));
}

function warmImageUrl(url) {
  if (!url) {
    return;
  }

  const now = Date.now();
  const lastWarmedAt = warmedImageCache.get(url);
  if (lastWarmedAt && now - lastWarmedAt < WARMED_IMAGE_TTL_MS) {
    touchWarmedImage(url, now);
    return;
  }

  warmedImageCache.set(url, now);
  trimWarmedImageCache();

  const image = new Image();
  image.decoding = "async";
  image.src = url;
}

function touchWarmedImage(url, timestamp = Date.now()) {
  if (!warmedImageCache.has(url)) {
    return;
  }

  warmedImageCache.delete(url);
  warmedImageCache.set(url, timestamp);
}

function trimWarmedImageCache() {
  while (warmedImageCache.size > 300) {
    const oldestKey = warmedImageCache.keys().next().value;
    if (typeof oldestKey === "undefined") {
      break;
    }

    warmedImageCache.delete(oldestKey);
  }
}

function buildImageUrl(photo) {
  if (!photo || !photo.year || !photo.filename) {
    return "";
  }

  return `/api/images/${photo.year}/${photo.filename}`;
}

async function loadPhotoPage(queryKey, cursor, filters) {
  const cache = getQueryCache(queryKey);
  const cursorKey = cursor || "";

  if (cache.pagesByCursor.has(cursorKey)) {
    touchQueryCache(queryKey);
    return cache.pagesByCursor.get(cursorKey);
  }

  if (cache.pendingRequests.has(cursorKey)) {
    return cache.pendingRequests.get(cursorKey);
  }

  const request = fetchPhotoPage({
    cursor: cursorKey,
    limit: PAGE_SIZE,
    search: filters.searchTerm,
    year: filters.yearFilter,
    status: filters.statusFilter,
  }).then((page) => {
    setCachedPage(queryKey, cursorKey, page);
    cache.pendingRequests.delete(cursorKey);
    return page;
  }).catch((error) => {
    cache.pendingRequests.delete(cursorKey);
    throw error;
  });

  cache.pendingRequests.set(cursorKey, request);
  return request;
}

function rememberLoadedPage(queryKey, cursor, page) {
  setCachedPage(queryKey, cursor, page);
}

function restoreCachedQuery(queryKey, filters) {
  const cache = getQueryCacheEntry(queryKey);
  if (!cache || cache.loadedPageOrder.length === 0) {
    return false;
  }

  const restoredPhotos = [];
  for (const cursor of cache.loadedPageOrder) {
    const page = cache.pagesByCursor.get(cursor);
    if (page && Array.isArray(page.items)) {
      restoredPhotos.push(...page.items);
    }
  }

  if (restoredPhotos.length === 0) {
    return false;
  }

  state.allPhotos = restoredPhotos;
  state.filteredPhotos = restoredPhotos;
  state.photosByFilename = new Map(
    restoredPhotos.map((photo) => [photo.filename, photo])
  );
  state.totalPhotoCount = cache.totalCount;
  state.hiddenPhotoCount = cache.hiddenCount;
  state.availableYears = cache.availableYears;
  state.nextCursor = cache.nextCursor;
  state.hasMorePhotos = cache.hasMore;

  renderPhotos();
  updateStats();
  updateBatchButtons();
  populateYearFilter();

  const currentCursor = cache.loadedPageOrder[cache.loadedPageOrder.length - 1];
  const currentPage = currentCursor ? cache.pagesByCursor.get(currentCursor) : null;
  if (currentPage) {
    warmCurrentPageEdges(queryKey, currentCursor, currentPage);
  }

  if (cache.hasMore && cache.nextCursor) {
    scheduleNeighborPrefetch(queryKey, cache, filters);
  }

  return true;
}

function scheduleNeighborPrefetch(queryKey, page, filters) {
  if (!page.hasMore || !page.nextCursor) {
    return;
  }

  const cache = getQueryCache(queryKey);
  const nextCursor = page.nextCursor;

  if (cache.pagesByCursor.has(nextCursor) || cache.pendingRequests.has(nextCursor)) {
    return;
  }

  const request = fetchPhotoPage({
    cursor: nextCursor,
    limit: PAGE_SIZE,
    search: filters.searchTerm,
    year: filters.yearFilter,
    status: filters.statusFilter,
  }).then((nextPage) => {
    setCachedPage(queryKey, nextCursor, nextPage);
    cache.pendingRequests.delete(nextCursor);
    warmPhotoPageImages(nextPage.items, "head");
    return nextPage;
  }).catch((error) => {
    cache.pendingRequests.delete(nextCursor);
    return null;
  });

  cache.pendingRequests.set(nextCursor, request);
}

function clearPhotoPageCache() {
  queryPageCache.clear();
  warmedImageCache.clear();
}

function preparePhoto(photo) {
  return photo;
}

function throttle(func, wait) {
  let timeout = null;
  let previous = 0;

  return function throttled() {
    const now = Date.now();
    const remaining = wait - (now - previous);
    const context = this;
    const args = arguments;

    if (remaining <= 0 || remaining > wait) {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      previous = now;
      func.apply(context, args);
    } else if (!timeout) {
      timeout = setTimeout(() => {
        previous = Date.now();
        timeout = null;
        func.apply(context, args);
      }, remaining);
    }
  };
}

function setupZoomEvents() {
  const container = document.getElementById("r2PreviewContainer");
  const img = document.getElementById("r2PreviewImage");
  if (!container || !img) return;

  let panStart = { x: 0, y: 0 };
  let isDragging = false;
  let didDrag = false;

  function updateLensTransform(event) {
    const rect = container.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    const cW = rect.width;
    const cH = rect.height;
    const nW = img.naturalWidth || cW;
    const nH = img.naturalHeight || cH;
    if (nW === 0 || nH === 0) return;

    const ratio = Math.min(cW / nW, cH / nH);
    const dW = nW * ratio;
    const dH = nH * ratio;
    const offX = (cW - dW) / 2;
    const offY = (cH - dH) / 2;

    let imgMouseX = mouseX - offX;
    let imgMouseY = mouseY - offY;
    imgMouseX = Math.max(0, Math.min(imgMouseX, dW));
    imgMouseY = Math.max(0, Math.min(imgMouseY, dH));

    const relX = imgMouseX / dW;
    const relY = imgMouseY / dH;
    const pX = relX * nW;
    const pY = relY * nH;

    const tx = mouseX - pX;
    const ty = mouseY - pY;

    img.style.transform = `translate(${tx}px, ${ty}px)`;
    state.panOffset = { x: tx, y: ty };
  }

  container.addEventListener("mousemove", (event) => {
    if (!elements.r2Modal.classList.contains("active")) return;

    if (!state.isZoomLocked) {
      const metaPressed = event.metaKey || event.ctrlKey;
      if (metaPressed !== state.isZoomed) {
        state.isZoomed = metaPressed;
        updateZoomClass();
        if (!state.isZoomed) img.style.transform = "";
      }
    }

    if (!state.isZoomed) return;

    if (state.isZoomLocked) {
      if (isDragging) {
        event.preventDefault();
        const dx = event.clientX - panStart.x;
        const dy = event.clientY - panStart.y;

        state.panOffset = {
          x: state.panOffset.x + dx,
          y: state.panOffset.y + dy,
        };
        panStart = { x: event.clientX, y: event.clientY };
        img.style.transform = `translate(${state.panOffset.x}px, ${state.panOffset.y}px)`;
        didDrag = true;
      }
      return;
    }

    updateLensTransform(event);
  });

  container.addEventListener("mousedown", (event) => {
    if (!elements.r2Modal.classList.contains("active")) return;
    event.preventDefault();

    if (state.isZoomLocked && state.isZoomed) {
      isDragging = true;
      didDrag = false;
      panStart = { x: event.clientX, y: event.clientY };
      container.style.cursor = "grabbing";
    }
  });

  window.addEventListener("mouseup", () => {
    if (!elements.r2Modal.classList.contains("active")) return;
    isDragging = false;
    if (state.isZoomLocked && state.isZoomed) {
      container.style.cursor = "grab";
    }
  });

  container.addEventListener("click", (event) => {
    if (!elements.r2Modal.classList.contains("active")) return;
    if (didDrag) {
      didDrag = false;
      return;
    }

    state.isZoomLocked = !state.isZoomLocked;
    state.isZoomed = state.isZoomLocked;
    updateZoomClass();

    if (state.isZoomLocked) {
      updateLensTransform(event);
      return;
    }

    img.style.transform = "";
  });

  window.addEventListener("keydown", (event) => {
    if (!elements.r2Modal.classList.contains("active")) return;
    if (
      (event.key === "Meta" || event.key === "Control") &&
      !state.isZoomLocked &&
      !state.isZoomed
    ) {
      state.isZoomed = true;
      updateZoomClass();
    }
  });

  window.addEventListener("keyup", (event) => {
    if (!elements.r2Modal.classList.contains("active")) return;
    if ((event.key === "Meta" || event.key === "Control") && !state.isZoomLocked) {
      state.isZoomed = false;
      updateZoomClass();
      img.style.transform = "";
    }
  });
}
