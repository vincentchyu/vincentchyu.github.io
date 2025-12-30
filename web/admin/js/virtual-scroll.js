// Virtual scrolling implementation for photo grid
class VirtualPhotoGrid {
  constructor(container, photos, options = {}) {
    this.container = container;
    this.allPhotos = photos;
    this.options = {
      itemHeight: 320, // Approximate height of photo card
      itemsPerRow: this.calculateItemsPerRow(),
      bufferRows: 2, // Render 2 extra rows above and below
      ...options,
    };

    this.visibleStart = 0;
    this.visibleEnd = 0;
    this.scrollTop = 0;
    this.containerHeight = 0;

    this.init();
  }

  calculateItemsPerRow() {
    const containerWidth = window.innerWidth - 40; // Account for padding
    const minItemWidth = 220; // From CSS: minmax(220px, 1fr)
    return Math.max(1, Math.floor(containerWidth / minItemWidth));
  }

  init() {
    // Create scroll container
    this.scrollContainer = document.createElement("div");
    this.scrollContainer.className = "virtual-scroll-container";

    // Create content wrapper
    this.contentWrapper = document.createElement("div");
    this.contentWrapper.className = "virtual-content";

    this.scrollContainer.appendChild(this.contentWrapper);
    this.container.innerHTML = "";
    this.container.appendChild(this.scrollContainer);

    // Calculate total height
    const totalRows = Math.ceil(
      this.allPhotos.length / this.options.itemsPerRow
    );
    this.scrollContainer.style.height = `${
      totalRows * this.options.itemHeight
    }px`;

    // Set up scroll listener
    this.container.addEventListener(
      "scroll",
      this.throttle(() => this.onScroll(), 100)
    );

    // Set up resize listener
    window.addEventListener(
      "resize",
      this.throttle(() => this.onResize(), 200)
    );

    // Initial render
    this.render();
  }

  onScroll() {
    this.scrollTop = this.container.scrollTop;
    this.render();
  }

  onResize() {
    this.options.itemsPerRow = this.calculateItemsPerRow();
    const totalRows = Math.ceil(
      this.allPhotos.length / this.options.itemsPerRow
    );
    this.scrollContainer.style.height = `${
      totalRows * this.options.itemHeight
    }px`;
    this.render();
  }

  render() {
    const containerHeight = this.container.clientHeight;
    const scrollTop = this.container.scrollTop;

    // Calculate visible range
    const startRow =
      Math.floor(scrollTop / this.options.itemHeight) - this.options.bufferRows;
    const endRow =
      Math.ceil((scrollTop + containerHeight) / this.options.itemHeight) +
      this.options.bufferRows;

    const visibleStart = Math.max(0, startRow * this.options.itemsPerRow);
    const visibleEnd = Math.min(
      this.allPhotos.length,
      endRow * this.options.itemsPerRow
    );

    // Only re-render if range changed significantly
    if (visibleStart === this.visibleStart && visibleEnd === this.visibleEnd) {
      return;
    }

    this.visibleStart = visibleStart;
    this.visibleEnd = visibleEnd;

    // Get visible photos
    const visiblePhotos = this.allPhotos.slice(visibleStart, visibleEnd);

    // Calculate offset
    const offsetY =
      Math.floor(visibleStart / this.options.itemsPerRow) *
      this.options.itemHeight;

    // Render photos
    this.contentWrapper.innerHTML = visiblePhotos
      .map((photo, index) => {
        const actualIndex = visibleStart + index;
        return this.renderPhotoCard(photo, actualIndex);
      })
      .join("");

    this.contentWrapper.style.transform = `translateY(${offsetY}px)`;

    // Re-initialize lazy loading for new images (only if there are new lazy images)
    const newLazyImages = this.contentWrapper.querySelectorAll("img.lazy");
    if (newLazyImages.length > 0 && window.initLazyLoading) {
      window.initLazyLoading();
    }

    // Re-attach event listeners
    this.attachEventListeners();
  }

  renderPhotoCard(photo, index) {
    const isSelected = selectedPhotos.has(photo.filename);
    return `
            <div class="photo-card ${photo.is_hidden ? "hidden" : ""} ${
      isSelected ? "selected" : ""
    }" 
                 data-filename="${photo.filename}"
                 data-index="${index}">
                <input type="checkbox" class="photo-checkbox" data-filename="${
                  photo.filename
                }" 
                       ${isSelected ? "checked" : ""}>
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
        `;
  }

  attachEventListeners() {
    // Photo card clicks
    this.contentWrapper.querySelectorAll(".photo-card").forEach((card) => {
      card.addEventListener("click", (e) => {
        if (e.target.classList.contains("photo-checkbox")) return;
        if (e.target.classList.contains("btn-preview-r2")) {
          e.stopPropagation();
          showR2Preview(card.dataset.filename);
          return;
        }
        showDetail(card.dataset.filename);
      });
    });

    // Checkbox changes
    this.contentWrapper
      .querySelectorAll(".photo-checkbox")
      .forEach((checkbox) => {
        checkbox.addEventListener("change", (e) => {
          e.stopPropagation();
          toggleSelection(checkbox.dataset.filename, checkbox.checked);
        });
      });
  }

  throttle(func, wait) {
    let timeout;
    let previous = 0;
    return function () {
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

  updatePhotos(photos) {
    this.allPhotos = photos;
    const totalRows = Math.ceil(
      this.allPhotos.length / this.options.itemsPerRow
    );
    this.scrollContainer.style.height = `${
      totalRows * this.options.itemHeight
    }px`;
    this.render();
  }

  destroy() {
    window.removeEventListener("resize", this.onResize);
    this.container.removeEventListener("scroll", this.onScroll);
  }
}

// Export for use in app.js
window.VirtualPhotoGrid = VirtualPhotoGrid;
