// Global state
let allPhotos = [];
let filteredPhotos = [];
let selectedPhotos = new Set();
let currentPhoto = null;
let virtualGrid = null; // Virtual scroll instance

// R2 Preview State
// R2 Preview State
let isZoomLocked = false;
let isZoomed = false; // Visual state
let panOffset = { x: 0, y: 0 };

// DOM elements
const photoGrid = document.getElementById("photoGrid");
const detailPanel = document.getElementById("detailPanel");
const rebuildModal = document.getElementById("rebuildModal");
const r2Modal = document.getElementById("r2Modal");

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  loadPhotos();
  setupEventListeners();
});

// Load photos from API
async function loadPhotos() {
  try {
    const response = await fetch("/api/photos");
    if (!response.ok) throw new Error("Failed to load photos");

    const albums = await response.json();
    allPhotos = [];

    // Flatten albums into single array
    albums.forEach((album) => {
      allPhotos.push(...album.photos);
    });

    filteredPhotos = [...allPhotos];
    renderPhotos();
    updateStats();
    populateYearFilter();
  } catch (error) {
    console.error("Error loading photos:", error);
    photoGrid.innerHTML = '<div class="loading">加载失败，请刷新页面重试</div>';
  }
}

// Render photo grid
function renderPhotos() {
  if (filteredPhotos.length === 0) {
    photoGrid.innerHTML = '<div class="loading">没有找到照片</div>';
    if (virtualGrid) {
      virtualGrid.destroy();
      virtualGrid = null;
    }
    return;
  }

  // Use virtual scrolling for large datasets (>100 photos)
  const useVirtualScroll = filteredPhotos.length > 100;

  if (useVirtualScroll) {
    // Enable virtual scrolling
    if (!virtualGrid) {
      photoGrid.classList.add("virtual-scroll-enabled");
      virtualGrid = new VirtualPhotoGrid(photoGrid, filteredPhotos);
    } else {
      virtualGrid.updatePhotos(filteredPhotos);
    }
  } else {
    // Disable virtual scrolling for small datasets
    if (virtualGrid) {
      virtualGrid.destroy();
      virtualGrid = null;
      photoGrid.classList.remove("virtual-scroll-enabled");
    }

    // Regular rendering
    photoGrid.innerHTML = filteredPhotos
      .map(
        (photo) => `
            <div class="photo-card ${photo.is_hidden ? "hidden" : ""} ${
          selectedPhotos.has(photo.filename) ? "selected" : ""
        }" 
                 data-filename="${photo.filename}">
                <input type="checkbox" class="photo-checkbox" data-filename="${
                  photo.filename
                }" 
                       ${selectedPhotos.has(photo.filename) ? "checked" : ""}>
                <img class="photo-thumbnail lazy" 
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

    // Initialize lazy loading
    initLazyLoading();

    // Add click handlers
    document.querySelectorAll(".photo-card").forEach((card) => {
      card.addEventListener("click", (e) => {
        if (e.target.classList.contains("photo-checkbox")) return;
        if (e.target.classList.contains("btn-preview-r2")) {
          e.stopPropagation();
          showR2Preview(card.dataset.filename, "thumbnail");
          return;
        }
        showDetail(card.dataset.filename);
      });
    });

    document.querySelectorAll(".photo-checkbox").forEach((checkbox) => {
      checkbox.addEventListener("change", (e) => {
        e.stopPropagation();
        toggleSelection(checkbox.dataset.filename, checkbox.checked);
      });
    });
  }
}

// Show detail panel
function showDetail(filename) {
  currentPhoto = allPhotos.find((p) => p.filename === filename);
  if (!currentPhoto) return;

  document.getElementById("detailFilename").value = currentPhoto.filename;
  document.getElementById("detailDate").value = currentPhoto.date;
  document.getElementById(
    "detailSize"
  ).value = `${currentPhoto.width}×${currentPhoto.height}`;
  document.getElementById("detailAlt").value = currentPhoto.alt || "";
  document.getElementById("detailTags").value = (
    currentPhoto.Subject || []
  ).join(", ");
  document.getElementById("detailIsHidden").checked = currentPhoto.is_hidden;
  document.getElementById(
    "detailImage"
  ).src = `/api/images/${currentPhoto.year}/${currentPhoto.filename}`;

  detailPanel.classList.add("active");
}

// Hide detail panel
function hideDetail() {
  detailPanel.classList.remove("active");
  currentPhoto = null;
}

// Helper: Set button loading state
function setButtonLoading(btnId, isLoading) {
  const btn = document.getElementById(btnId);
  if (!btn) return;

  if (isLoading) {
    btn.classList.add("btn-loading");
    btn.disabled = true;
  } else {
    btn.classList.remove("btn-loading");
    btn.disabled = false;
  }
}

// Save photo details
async function saveDetail() {
  if (!currentPhoto) return;

  const updates = {
    alt: document.getElementById("detailAlt").value,
    is_hidden: document.getElementById("detailIsHidden").checked,
    Subject: document
      .getElementById("detailTags")
      .value.split(",")
      .map((t) => t.trim())
      .filter((t) => t),
  };

  const btnId = "saveDetailBtn";
  setButtonLoading(btnId, true);

  try {
    const response = await fetch(`/api/photos/${currentPhoto.filename}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });

    if (!response.ok) throw new Error("Failed to update photo");

    // Update local data
    currentPhoto.alt = updates.alt;
    currentPhoto.is_hidden = updates.is_hidden;
    currentPhoto.Subject = updates.Subject;

    renderPhotos();
    updateStats();
    hideDetail();

    // Success hint could be added here if needed, but UI closes so it's implicit
  } catch (error) {
    console.error("Error saving photo:", error);
    alert("保存失败，请重试");
  } finally {
    setButtonLoading(btnId, false);
  }
}

// Delete current photo
async function deleteCurrentPhoto() {
  if (!currentPhoto) return;

  if (
    !confirm(
      `确定要删除照片 ${currentPhoto.filename} 吗？\n此操作将删除本地文件和 R2 上的文件，且无法恢复！`
    )
  ) {
    return;
  }

  const btnId = "deletePhotoBtn";
  setButtonLoading(btnId, true);

  try {
    const response = await fetch(`/api/photos/${currentPhoto.filename}`, {
      method: "DELETE",
    });

    if (!response.ok) throw new Error("Failed to delete photo");

    const result = await response.json();

    // Remove from local data
    allPhotos = allPhotos.filter((p) => p.filename !== currentPhoto.filename);
    filteredPhotos = filteredPhotos.filter(
      (p) => p.filename !== currentPhoto.filename
    );
    selectedPhotos.delete(currentPhoto.filename);

    renderPhotos();
    updateStats();
    hideDetail();

    alert("照片已删除");
  } catch (error) {
    console.error("Error deleting photo:", error);
    alert("删除失败，请重试");
  } finally {
    setButtonLoading(btnId, false);
  }
}

// Toggle photo selection
function toggleSelection(filename, selected) {
  if (selected) {
    selectedPhotos.add(filename);
  } else {
    selectedPhotos.delete(filename);
  }
  updateStats();
  updateBatchButtons();
  renderPhotos();
}

// Batch hide/show
async function batchUpdate(isHidden) {
  if (selectedPhotos.size === 0) return;

  // Determine which button to show loading
  const btnId = isHidden ? "batchHideBtn" : "batchShowBtn";
  const otherBtnId = isHidden ? "batchShowBtn" : "batchHideBtn";

  setButtonLoading(btnId, true);
  document.getElementById(otherBtnId).disabled = true; // Disable the other one too

  try {
    const response = await fetch("/api/photos/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filenames: Array.from(selectedPhotos),
        updates: { is_hidden: isHidden },
      }),
    });

    if (!response.ok) throw new Error("Failed to batch update");

    // Update local data
    allPhotos.forEach((photo) => {
      if (selectedPhotos.has(photo.filename)) {
        photo.is_hidden = isHidden;
      }
    });

    selectedPhotos.clear();
    renderPhotos();
    updateStats();
    updateBatchButtons();

    alert(isHidden ? "所需照片已隐藏" : "所需照片已显示");
  } catch (error) {
    console.error("Error batch updating:", error);
    alert("批量操作失败，请重试");
  } finally {
    setButtonLoading(btnId, false);
    // updateBatchButtons will handle re-enabling based on selection state,
    // but since we clear selection on success, they will end up disabled effectively.
    // If failed, we need to re-enable manually or call updateBatchButtons
    updateBatchButtons();
  }
}

// Rebuild photos
async function rebuild() {
  rebuildModal.classList.add("active");
  document.getElementById("progressFill").style.width = "0%";
  document.getElementById("rebuildMessage").textContent = "准备中...";
  document.getElementById("rebuildLogs").innerHTML = "";

  try {
    const response = await fetch("/api/rebuild", { method: "POST" });
    if (!response.ok) throw new Error("Failed to start rebuild");

    // Poll for status
    pollRebuildStatus();
  } catch (error) {
    console.error("Error starting rebuild:", error);
    alert("启动重建失败，请重试");
    rebuildModal.classList.remove("active");
  }
}

// Poll rebuild status
async function pollRebuildStatus() {
  try {
    const response = await fetch("/api/rebuild/status");
    const status = await response.json();

    document.getElementById("progressFill").style.width = `${status.progress}%`;
    document.getElementById("rebuildMessage").textContent = status.message;

    const logsDiv = document.getElementById("rebuildLogs");
    logsDiv.innerHTML = status.logs.map((log) => `<div>${log}</div>`).join("");
    logsDiv.scrollTop = logsDiv.scrollHeight;

    if (status.status === "running") {
      setTimeout(pollRebuildStatus, 1000);
    } else if (status.status === "completed") {
      setTimeout(() => {
        rebuildModal.classList.remove("active");
        loadPhotos(); // Reload photos
      }, 2000);
    } else if (status.status === "failed") {
      alert("重建失败，请查看日志");
    }
  } catch (error) {
    console.error("Error polling rebuild status:", error);
  }
}

// Show R2 preview
function showR2Preview(filename, type = "thumbnail") {
  const photo = allPhotos.find((p) => p.filename === filename);
  if (!photo) return;

  const url = type === "original" ? photo.path : photo.thumbnail;
  const title = type === "original" ? "R2 原图" : "R2 缩略图";
  const proxyUrl = `/api/proxy?url=${encodeURIComponent(url)}`;

  document.getElementById(
    "r2ModalTitle"
  ).textContent = `${title} - ${filename}`;
  document.getElementById("r2PreviewImage").src = proxyUrl;
  document.getElementById("r2Url").innerHTML = `
        <strong>URL:</strong> <a href="${url}" target="_blank" style="color: var(--accent-primary); word-break: break-all;">${url}</a>
    `;

  // Reset zoom state
  isZoomLocked = false;
  isZoomed = false;
  panOffset = { x: 0, y: 0 };
  updateZoomClass();

  // Clear transform
  const img = document.getElementById("r2PreviewImage");
  img.style.transform = "";

  r2Modal.classList.add("active");
}

function updateZoomClass() {
  const container = document.getElementById("r2PreviewContainer");
  if (isZoomed) {
    container.classList.add("zoomed");
    if (isZoomLocked) container.classList.add("zoomed-locked");
    else container.classList.remove("zoomed-locked");
  } else {
    container.classList.remove("zoomed");
    container.classList.remove("zoomed-locked");
  }
}

// Removed old updateZoomState

// Filter photos
function filterPhotos() {
  const searchTerm = document.getElementById("searchInput").value.toLowerCase();
  const yearFilter = document.getElementById("yearFilter").value;
  const statusFilter = document.getElementById("statusFilter").value;

  filteredPhotos = allPhotos.filter((photo) => {
    const matchesSearch = photo.filename.toLowerCase().includes(searchTerm);
    const matchesYear = !yearFilter || photo.year === yearFilter;
    const matchesStatus =
      !statusFilter ||
      (statusFilter === "hidden" && photo.is_hidden) ||
      (statusFilter === "visible" && !photo.is_hidden);

    return matchesSearch && matchesYear && matchesStatus;
  });

  renderPhotos();
}

// Update stats
function updateStats() {
  document.getElementById("totalPhotos").textContent = allPhotos.length;
  document.getElementById("hiddenPhotos").textContent = allPhotos.filter(
    (p) => p.is_hidden
  ).length;
  document.getElementById("selectedPhotos").textContent = selectedPhotos.size;
}

// Update batch buttons
function updateBatchButtons() {
  const hasSelection = selectedPhotos.size > 0;
  document.getElementById("batchHideBtn").disabled = !hasSelection;
  document.getElementById("batchShowBtn").disabled = !hasSelection;
}

// Populate year filter
function populateYearFilter() {
  const years = [...new Set(allPhotos.map((p) => p.year))].sort().reverse();
  const yearFilter = document.getElementById("yearFilter");
  yearFilter.innerHTML =
    '<option value="">所有年份</option>' +
    years.map((year) => `<option value="${year}">${year}</option>`).join("");
}

// Setup event listeners
function setupEventListeners() {
  // Detail panel
  document
    .getElementById("closeDetailBtn")
    .addEventListener("click", hideDetail);
  document
    .getElementById("saveDetailBtn")
    .addEventListener("click", saveDetail);
  document
    .getElementById("cancelDetailBtn")
    .addEventListener("click", hideDetail);

  // R2 preview buttons in detail panel
  document.getElementById("viewR2ThumbBtn").addEventListener("click", () => {
    if (currentPhoto) {
      showR2Preview(currentPhoto.filename, "thumbnail");
    }
  });

  document.getElementById("viewR2OriginalBtn").addEventListener("click", () => {
    if (currentPhoto) {
      showR2Preview(currentPhoto.filename, "original");
    }
  });

  // Delete photo
  document
    .getElementById("deletePhotoBtn")
    .addEventListener("click", deleteCurrentPhoto);

  // Rebuild
  document.getElementById("rebuildBtn").addEventListener("click", rebuild);
  document.getElementById("closeRebuildBtn").addEventListener("click", () => {
    rebuildModal.classList.remove("active");
  });

  // R2 modal
  document.getElementById("closeR2Btn").addEventListener("click", () => {
    r2Modal.classList.remove("active");
  });

  // Zoom events
  setupZoomEvents();

  // Upload modal
  document.getElementById("closeUploadBtn").addEventListener("click", () => {
    uploadModal.classList.remove("active");
  });

  // Import photos
  document.getElementById("importBtn").addEventListener("click", () => {
    document.getElementById("photoUpload").click();
  });

  document
    .getElementById("photoUpload")
    .addEventListener("change", handlePhotoUpload);

  // Batch actions
  document
    .getElementById("batchHideBtn")
    .addEventListener("click", () => batchUpdate(true));
  document
    .getElementById("batchShowBtn")
    .addEventListener("click", () => batchUpdate(false));

  // Filters
  document
    .getElementById("searchInput")
    .addEventListener("input", filterPhotos);
  document
    .getElementById("yearFilter")
    .addEventListener("change", filterPhotos);
  document
    .getElementById("statusFilter")
    .addEventListener("change", filterPhotos);

  // Close modals on background click
  [rebuildModal, r2Modal, uploadModal].forEach((modal) => {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        modal.classList.remove("active");
      }
    });
  });
}

// Lazy loading with Intersection Observer
let imageObserver = null;

function initLazyLoading() {
  // Disconnect previous observer if exists
  if (imageObserver) {
    imageObserver.disconnect();
  }

  // Create new observer
  imageObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const img = entry.target;

        // Control animation based on visibility
        if (entry.isIntersecting) {
          // Resume animation when entering viewport
          img.style.animationPlayState = "running";

          const src = img.dataset.src;
          if (src) {
            img.src = src;
            img.classList.remove("lazy");
            img.classList.add("loaded");
            imageObserver.unobserve(img);
          }
        } else {
          // Pause animation when leaving viewport to reduce GPU load
          img.style.animationPlayState = "paused";
        }
      });
    },
    {
      rootMargin: "50px", // Start loading 50px before entering viewport
    }
  );

  // Observe all lazy images
  document.querySelectorAll("img.lazy").forEach((img) => {
    imageObserver.observe(img);
  });
}

// Photo upload functionality
const uploadModal = document.getElementById("uploadModal");

async function handlePhotoUpload(e) {
  const files = Array.from(e.target.files);
  if (files.length === 0) return;

  // Show upload modal
  uploadModal.classList.add("active");
  document.getElementById("uploadProgressFill").style.width = "0%";
  document.getElementById(
    "uploadMessage"
  ).textContent = `准备上传 ${files.length} 张照片...`;
  document.getElementById("uploadLogs").innerHTML = "";

  let uploaded = 0;
  let failed = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const formData = new FormData();
    formData.append("photo", file);

    try {
      addUploadLog(`📤 正在上传: ${file.name}`);

      const response = await fetch("/api/photos/upload", {
        method: "POST",
        body: formData,
      });

      if (response.ok) {
        const result = await response.json();
        uploaded++;
        addUploadLog(`✅ 成功: ${file.name} → ${result.year || "未知年份"}`);
      } else {
        failed++;
        addUploadLog(`❌ 失败: ${file.name}`);
      }
    } catch (error) {
      failed++;
      addUploadLog(`❌ 错误: ${file.name} - ${error.message}`);
    }

    // Update progress
    const progress = Math.round(((i + 1) / files.length) * 100);
    document.getElementById("uploadProgressFill").style.width = `${progress}%`;
    document.getElementById("uploadMessage").textContent = `已上传 ${i + 1}/${
      files.length
    } (成功: ${uploaded}, 失败: ${failed})`;
  }

  // Upload complete
  addUploadLog(`\n🎉 上传完成！成功: ${uploaded}, 失败: ${failed}`);

  if (uploaded > 0) {
    addUploadLog("🔄 开始自动重建...");

    // Auto rebuild
    setTimeout(async () => {
      uploadModal.classList.remove("active");
      await rebuild();
    }, 2000);
  }

  // Reset file input
  e.target.value = "";
}

function addUploadLog(message) {
  const logsDiv = document.getElementById("uploadLogs");
  const logEntry = document.createElement("div");
  logEntry.textContent = message;
  logsDiv.appendChild(logEntry);
  logsDiv.scrollTop = logsDiv.scrollHeight;
}

// Pan Logic
// Pan & Zoom Logic
// Pan & Zoom Logic
function setupZoomEvents() {
  const container = document.getElementById("r2PreviewContainer");
  const img = document.getElementById("r2PreviewImage");
  if (!container || !img) return; // Safety check

  let panStart = { x: 0, y: 0 };
  let isDragging = false;
  let didDrag = false; // To distinguish click vs drag

  // Helper: Calculate transform to keep point under cursor fixed
  function updateLensTransform(e) {
    const rect = container.getBoundingClientRect();
    // Mouse position relative to container
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Container dimensions
    const cW = rect.width;
    const cH = rect.height;

    // Native dimensions
    const nW = img.naturalWidth || cW;
    const nH = img.naturalHeight || cH;
    if (nW === 0 || nH === 0) return;

    // Calculated Displayed Dimensions (object-fit: contain)
    const ratio = Math.min(cW / nW, cH / nH);
    const dW = nW * ratio;
    const dH = nH * ratio;

    // Offsets (Black bars)
    const offX = (cW - dW) / 2;
    const offY = (cH - dH) / 2;

    // Mouse position relative to the *Displayed Image*
    // Clamp to image area to avoid jumping when hovering black bars
    let imgMouseX = mouseX - offX;
    let imgMouseY = mouseY - offY;

    imgMouseX = Math.max(0, Math.min(imgMouseX, dW));
    imgMouseY = Math.max(0, Math.min(imgMouseY, dH));

    // Calculate the point on the original image (0.0 - 1.0)
    const relX = imgMouseX / dW;
    const relY = imgMouseY / dH;

    // Point on native image (in pixels)
    const pX = relX * nW;
    const pY = relY * nH;

    // We want: MousePos = Transform + PointOnNative
    // So: Transform = MousePos - PointOnNative
    // Note: We use the raw mouseX/Y (relative to container) as the anchor
    const tx = mouseX - pX;
    const ty = mouseY - pY;

    img.style.transform = `translate(${tx}px, ${ty}px)`;

    // Update panOffset so if we switch to drag mode, we start from here
    panOffset = { x: tx, y: ty };
  }

  // Mouse Move - Only process if modal is active
  container.addEventListener("mousemove", (e) => {
    // CRITICAL FIX: Only process events when modal is actually visible
    if (!r2Modal.classList.contains("active")) {
      return;
    }

    // 1. Check CMD/Meta Zoom (only if not locked)
    if (!isZoomLocked) {
      const metaPressed = e.metaKey || e.ctrlKey;
      if (metaPressed !== isZoomed) {
        isZoomed = metaPressed;
        updateZoomClass();
        if (!isZoomed) img.style.transform = "";
      }
    }

    if (!isZoomed) return;

    // 2. Handle Interactions
    if (isZoomLocked) {
      // Locked Mode: Drag
      if (isDragging) {
        e.preventDefault();
        const dx = e.clientX - panStart.x;
        const dy = e.clientY - panStart.y;

        panOffset = {
          x: panOffset.x + dx,
          y: panOffset.y + dy,
        };
        panStart = { x: e.clientX, y: e.clientY };

        img.style.transform = `translate(${panOffset.x}px, ${panOffset.y}px)`;
        didDrag = true;
      }
    } else {
      // Cmd Mode: Lens Effect (Follow Cursor)
      updateLensTransform(e);
    }
  });

  // Mousedown: Start Drag or Interact
  container.addEventListener("mousedown", (e) => {
    // Only process if modal is active
    if (!r2Modal.classList.contains("active")) {
      return;
    }

    // Prevent default selection highlight
    e.preventDefault();

    if (isZoomLocked && isZoomed) {
      isDragging = true;
      didDrag = false;
      panStart = { x: e.clientX, y: e.clientY };
      container.style.cursor = "grabbing";
    }
  });

  // Mouseup: Stop Drag
  window.addEventListener("mouseup", () => {
    // Only process if modal is active
    if (!r2Modal.classList.contains("active")) {
      return;
    }

    isDragging = false;
    if (isZoomLocked && isZoomed) container.style.cursor = "grab";
  });

  // Click: Toggle Lock (if not dragged)
  container.addEventListener("click", (e) => {
    // Only process if modal is active
    if (!r2Modal.classList.contains("active")) {
      return;
    }

    if (didDrag) {
      didDrag = false;
      return; // It was a drag, ignore toggle
    }

    // Toggle Lock
    isZoomLocked = !isZoomLocked;
    isZoomed = isZoomLocked; // Force State
    updateZoomClass();

    if (isZoomLocked) {
      // Initial Zoom Position at cursor (Lens effect)
      updateLensTransform(e);
    } else {
      img.style.transform = "";
    }
  });

  // Key Events
  window.addEventListener("keydown", (e) => {
    // Only process if modal is active
    if (!r2Modal.classList.contains("active")) {
      return;
    }

    // If holding CMD we enter transient zoom (if not locked)
    if ((e.key === "Meta" || e.key === "Control") && !isZoomLocked) {
      // We can trigger zoom, but we can't update position until mouse moves.
      // Just enable the state.
      if (!isZoomed) {
        isZoomed = true;
        updateZoomClass();
      }
    }
  });
  window.addEventListener("keyup", (e) => {
    // Only process if modal is active
    if (!r2Modal.classList.contains("active")) {
      return;
    }

    if ((e.key === "Meta" || e.key === "Control") && !isZoomLocked) {
      isZoomed = false;
      updateZoomClass();
      img.style.transform = "";
    }
  });
}
