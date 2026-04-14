import { state } from "./state.js";

export const elements = {
  photoGrid: document.getElementById("photoGrid"),
  detailPanel: document.getElementById("detailPanel"),
  rebuildModal: document.getElementById("rebuildModal"),
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

  const useVirtualScroll = state.filteredPhotos.length > 100;
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
            <button class="btn btn-small btn-preview-r2" data-filename="${
              photo.filename
            }">
              预览 R2
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

export function showR2Preview(filename, type = "thumbnail") {
  const photo = state.photosByFilename.get(filename);
  if (!photo) return;

  const url = type === "original" ? photo.path : photo.thumbnail;
  const title = type === "original" ? "R2 原图" : "R2 缩略图";
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
  document.getElementById("progressFill").style.width = "0%";
  document.getElementById("rebuildMessage").textContent = "准备中...";
  document.getElementById("rebuildLogs").innerHTML = "";
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
    const previewButton = event.target.closest(".btn-preview-r2");
    if (previewButton) {
      event.stopPropagation();
      actions?.showR2Preview(previewButton.dataset.filename, "thumbnail");
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
