import { state } from "./state.js";

export const elements = {
  photoGrid: document.getElementById("photoGrid"),
  detailPanel: document.getElementById("detailPanel"),
  rebuildModal: document.getElementById("rebuildModal"),
  rebuildChoicePanel: document.getElementById("rebuildChoicePanel"),
  rebuildProgressPanel: document.getElementById("rebuildProgressPanel"),
  r2Modal: document.getElementById("r2Modal"),
  uploadModal: document.getElementById("uploadModal"),
};

let imageObserver = null;
let virtualGrid = null;
let actions = null;
let gridEventsBound = false;

export function bindViewActions(nextActions) {
  actions = nextActions;
  bindGridEvents();
}

export function renderPhotos(options = {}) {
  const append = Boolean(options.append);

  if (state.filteredPhotos.length === 0) {
    elements.photoGrid.innerHTML = '<div class="loading">没有找到照片</div>';
    if (virtualGrid) {
      virtualGrid.destroy();
      virtualGrid = null;
    }
    elements.photoGrid.classList.remove("virtual-scroll-enabled");
    return;
  }

  // Cursor pagination already keeps the DOM small enough for this admin page.
  // Keeping the regular grid avoids the current virtual layout regression.
  const useVirtualScroll = false;
  if (useVirtualScroll) {
    if (!virtualGrid) {
      elements.photoGrid.classList.add("virtual-scroll-enabled");
      virtualGrid = new window.VirtualPhotoGrid(
        elements.photoGrid,
        state.filteredPhotos,
        {
          selectedPhotos: state.selectedPhotos,
          onInitLazyLoading: initLazyLoading,
        }
      );
    } else {
      virtualGrid.updatePhotos(state.filteredPhotos, { append });
    }
    return;
  }

  if (virtualGrid) {
    virtualGrid.destroy();
    virtualGrid = null;
    elements.photoGrid.classList.remove("virtual-scroll-enabled");
  }

  elements.photoGrid.innerHTML = state.filteredPhotos
    .map(
      (photo) => `
        <div class="photo-card ${photo.is_hidden ? "hidden" : ""} ${
          state.selectedPhotos.has(photo.filename) ? "selected" : ""
        }" data-filename="${photo.filename}">
          <input type="checkbox" class="photo-checkbox" data-filename="${
            photo.filename
          }" ${state.selectedPhotos.has(photo.filename) ? "checked" : ""}>
          <img class="photo-thumbnail lazy"
               loading="lazy"
               decoding="async"
               data-src="/api/images/${photo.year}/${photo.filename}"
               alt="${photo.alt || photo.filename}">
          <div class="photo-info">
            <div class="photo-filename" title="${photo.filename}">${
              photo.filename
            }</div>
            <div class="photo-meta">
              <span>${photo.date}</span>
              <span>${photo.width}×${photo.height}</span>
            </div>
          </div>
          <div class="photo-actions">
            <button class="btn btn-small btn-preview-remote" data-filename="${
              photo.filename
            }">
              预览缩略图
            </button>
          </div>
        </div>
      `
    )
    .join("");

  initLazyLoading();
}

export function showDetail(filename) {
  state.currentPhoto = state.photosByFilename.get(filename) || null;
  if (!state.currentPhoto) return;

  document.getElementById("detailFilename").value = state.currentPhoto.filename;
  document.getElementById("detailDate").value = state.currentPhoto.date;
  document.getElementById("detailSize").value = `${state.currentPhoto.width}×${state.currentPhoto.height}`;
  document.getElementById("detailAlt").value = state.currentPhoto.alt || "";
  document.getElementById("detailTags").value = (state.currentPhoto.Subject || []).join(", ");
  document.getElementById("detailIsHidden").checked = state.currentPhoto.is_hidden;
  document.getElementById("detailImage").src = `/api/images/${state.currentPhoto.year}/${state.currentPhoto.filename}`;

  elements.detailPanel.classList.add("active");
}

export function hideDetail() {
  elements.detailPanel.classList.remove("active");
  state.currentPhoto = null;
}

export function setButtonLoading(btnId, isLoading) {
  const btn = document.getElementById(btnId);
  if (!btn) return;

  if (isLoading) {
    btn.classList.add("btn-loading");
    btn.disabled = true;
    return;
  }

  btn.classList.remove("btn-loading");
  btn.disabled = false;
}

export function showRemotePreview(filename, type = "thumbnail", provider = "active") {
  const photo = state.photosByFilename.get(filename);
  if (!photo) return;

  const sourceKey = provider === "r2" ? "r2" : provider === "tos" ? "tos" : "";
  const urls = sourceKey ? photo.source_urls?.[sourceKey] : null;
  const url = urls
    ? type === "original"
      ? urls.path
      : urls.thumbnail
    : type === "original"
      ? photo.path
      : photo.thumbnail;
  if (!url) {
    return;
  }
  const title = type === "original" ? "原图预览" : "缩略图预览";
  const proxyUrl = `/api/proxy?url=${encodeURIComponent(url)}`;

  document.getElementById("r2ModalTitle").textContent = `${title} - ${filename}`;
  document.getElementById("r2PreviewImage").src = proxyUrl;
  document.getElementById("r2Url").innerHTML =
    `<strong>URL:</strong> <a href="${url}" target="_blank" style="color: var(--accent-primary); word-break: break-all;">${url}</a>`;

  state.isZoomLocked = false;
  state.isZoomed = false;
  state.panOffset = { x: 0, y: 0 };
  updateZoomClass();

  document.getElementById("r2PreviewImage").style.transform = "";
  elements.r2Modal.classList.add("active");
}

export function renderGallerySource(response) {
  state.gallerySourceConfig = response?.config || null;
  state.gallerySourceStatuses = response?.statuses || [];

  const activeLabel = document.getElementById("gallerySourceActive");
  const updatedLabel = document.getElementById("gallerySourceUpdated");
  const statusList = document.getElementById("gallerySourceStatusList");
  const switchToTosBtn = document.getElementById("switchToTosBtn");
  const switchToR2Btn = document.getElementById("switchToR2Btn");

  if (!activeLabel || !updatedLabel || !statusList) {
    return;
  }

  const activeSource = response?.config?.active_source || "tos";
  activeLabel.textContent = activeSource.toUpperCase();
  updatedLabel.textContent = `最近切换时间: ${response?.config?.updated_at || "-"}`;

  if (switchToTosBtn) {
    switchToTosBtn.disabled = activeSource === "tos";
  }
  if (switchToR2Btn) {
    switchToR2Btn.disabled = activeSource === "r2";
  }

  statusList.innerHTML = (response?.statuses || [])
    .map((status) => {
      const stateClass = status.configured
        ? status.healthy
          ? "healthy"
          : "unhealthy"
        : "unconfigured";
      const badge = status.healthy ? "可用" : status.configured ? "异常" : "未配置";
      const tooltipLines = [
        `${String(status.provider || "").toUpperCase()} 数据源`,
        `访问地址: ${status.public_base || "-"}`,
        status.error ? `检查结果: ${status.error}` : "检查结果: 正常",
      ];
      const tooltip = tooltipLines.join("\n").replace(/"/g, "&quot;");
      return `
        <article class="source-status-card ${stateClass}" title="${tooltip}" aria-label="${tooltip}">
          <span class="source-status-dot" aria-hidden="true"></span>
          <strong class="source-status-name">${String(status.provider || "").toUpperCase()}</strong>
          <span class="source-status-badge">${badge}</span>
        </article>
      `;
    })
    .join("");
}

export function updateZoomClass() {
  const container = document.getElementById("r2PreviewContainer");
  if (!container) return;

  if (state.isZoomed) {
    container.classList.add("zoomed");
    if (state.isZoomLocked) {
      container.classList.add("zoomed-locked");
    } else {
      container.classList.remove("zoomed-locked");
    }
    return;
  }

  container.classList.remove("zoomed");
  container.classList.remove("zoomed-locked");
}

export function updateStats() {
  document.getElementById("totalPhotos").textContent = state.totalPhotoCount;
  document.getElementById("hiddenPhotos").textContent = state.hiddenPhotoCount;
  document.getElementById("selectedPhotos").textContent = state.selectedPhotos.size;
}

export function updateBatchButtons() {
  const hasSelection = state.selectedPhotos.size > 0;
  document.getElementById("batchHideBtn").disabled = !hasSelection;
  document.getElementById("batchShowBtn").disabled = !hasSelection;
}

export function populateYearFilter() {
  const yearFilter = document.getElementById("yearFilter");
  const currentValue = yearFilter.value;
  const years = [...state.availableYears];
  yearFilter.innerHTML =
    '<option value="">所有年份</option>' +
    years.map((year) => `<option value="${year}">${year}</option>`).join("");

  if (currentValue && years.includes(currentValue)) {
    yearFilter.value = currentValue;
  }
}

export function showLoadError() {
  if (virtualGrid) {
    virtualGrid.destroy();
    virtualGrid = null;
  }
  elements.photoGrid.classList.remove("virtual-scroll-enabled");
  elements.photoGrid.innerHTML = '<div class="loading">加载失败，请刷新页面重试</div>';
}

export function resetRebuildModal() {
  elements.rebuildModal.classList.add("active");
  showRebuildChoicePanel();
  document.getElementById("rebuildModalTitle").textContent = "重建方式";
  document.getElementById("progressFill").style.width = "0%";
  document.getElementById("rebuildMessage").textContent = "准备中...";
  document.getElementById("rebuildLogs").innerHTML = "";
  document.getElementById("rebuildModeBadge").textContent = "普通重建";
}

export function showRebuildProgressPanel(force) {
  elements.rebuildModal.classList.add("active");
  hideRebuildChoicePanel();
  elements.rebuildProgressPanel.classList.remove("is-hidden");
  document.getElementById("rebuildModalTitle").textContent = "重建进度";
  document.getElementById("rebuildModeBadge").textContent = force ? "强制重建" : "普通重建";
}

export function showRebuildChoicePanel() {
  if (elements.rebuildChoicePanel) {
    elements.rebuildChoicePanel.classList.remove("is-hidden");
  }
  if (elements.rebuildProgressPanel) {
    elements.rebuildProgressPanel.classList.add("is-hidden");
  }
}

export function hideRebuildChoicePanel() {
  if (elements.rebuildChoicePanel) {
    elements.rebuildChoicePanel.classList.add("is-hidden");
  }
}

export function renderRebuildStatus(status) {
  document.getElementById("progressFill").style.width = `${status.progress}%`;
  document.getElementById("rebuildMessage").textContent = status.message;

  const logsDiv = document.getElementById("rebuildLogs");
  logsDiv.innerHTML = status.logs.map((log) => `<div>${log}</div>`).join("");
  logsDiv.scrollTop = logsDiv.scrollHeight;
}

export function resetUploadModal(totalFiles) {
  elements.uploadModal.classList.add("active");
  document.getElementById("uploadProgressFill").style.width = "0%";
  document.getElementById("uploadMessage").textContent = `准备上传 ${totalFiles} 张照片...`;
  document.getElementById("uploadLogs").innerHTML = "";
}

export function updateUploadProgress(progress, processed, total, uploaded, failed) {
  document.getElementById("uploadProgressFill").style.width = `${progress}%`;
  document.getElementById("uploadMessage").textContent =
    `已上传 ${processed}/${total} (成功: ${uploaded}, 失败: ${failed})`;
}

export function addUploadLog(message) {
  const logsDiv = document.getElementById("uploadLogs");
  const logEntry = document.createElement("div");
  logEntry.textContent = message;
  logsDiv.appendChild(logEntry);
  logsDiv.scrollTop = logsDiv.scrollHeight;
}

export function syncPhotoCards(filenames) {
  const targets = new Set(Array.isArray(filenames) ? filenames : [filenames]);
  if (targets.size === 0) {
    return;
  }

  elements.photoGrid.querySelectorAll(".photo-card").forEach((card) => {
    const filename = card.dataset.filename;
    if (!targets.has(filename)) {
      return;
    }
    applyPhotoStateToCard(card, state.photosByFilename.get(filename));
  });
}

function bindGridEvents() {
  if (gridEventsBound || !elements.photoGrid) {
    return;
  }

  elements.photoGrid.addEventListener("click", (event) => {
    const previewButton = event.target.closest(".btn-preview-remote");
    if (previewButton) {
      event.stopPropagation();
      actions?.showRemotePreview(previewButton.dataset.filename, "thumbnail");
      return;
    }

    if (event.target.closest(".photo-checkbox")) {
      return;
    }

    const card = event.target.closest(".photo-card");
    if (!card || !elements.photoGrid.contains(card)) {
      return;
    }

    actions?.showDetail(card.dataset.filename);
  });

  elements.photoGrid.addEventListener("change", (event) => {
    const checkbox = event.target.closest(".photo-checkbox");
    if (!checkbox) {
      return;
    }

    event.stopPropagation();
    actions?.toggleSelection(checkbox.dataset.filename, checkbox.checked);
  });

  gridEventsBound = true;
}

function initLazyLoading() {
  ensureImageObserver();

  elements.photoGrid.querySelectorAll("img.lazy").forEach((img) => {
    if (img.dataset.observing === "true") {
      return;
    }

    img.dataset.observing = "true";
    imageObserver.observe(img);
  });
}

function ensureImageObserver() {
  if (imageObserver) {
    return;
  }

  imageObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const img = entry.target;
        if (entry.isIntersecting) {
          img.style.animationPlayState = "running";
          const src = img.dataset.src;
          if (src) {
            img.src = src;
            img.classList.remove("lazy");
            img.classList.add("loaded");
            img.dataset.observing = "false";
            imageObserver.unobserve(img);
          }
          return;
        }

        img.style.animationPlayState = "paused";
      });
    },
    { rootMargin: "100px" }
  );
}

function applyPhotoStateToCard(card, photo) {
  if (!photo) {
    return;
  }

  const isSelected = state.selectedPhotos.has(photo.filename);
  card.classList.toggle("hidden", Boolean(photo.is_hidden));
  card.classList.toggle("selected", isSelected);

  const checkbox = card.querySelector(".photo-checkbox");
  if (checkbox) {
    checkbox.checked = isSelected;
  }

  const thumbnail = card.querySelector(".photo-thumbnail");
  if (thumbnail) {
    thumbnail.alt = photo.alt || photo.filename;
  }
}
