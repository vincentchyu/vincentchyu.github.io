import {
  Virtualizer,
  elementScroll,
  observeElementOffset,
  observeElementRect,
} from "./vendor/tanstack-virtual-core/index.js";

class VirtualPhotoGrid {
  constructor(container, photos, options = {}) {
    this.container = container;
    this.allPhotos = photos;
    this.options = {
      itemHeight: 320,
      itemsPerRow: 1,
      bufferRows: 2,
      minItemWidth: 220,
      gap: 20,
      selectedPhotos:
        options.selectedPhotos || window.selectedPhotos || new Set(),
      onInitLazyLoading: options.onInitLazyLoading || window.initLazyLoading,
      ...options,
    };

    this.itemWidth = this.options.minItemWidth;
    this.renderedCards = new Map();
    this.renderRafId = null;
    this.layoutObserver = null;
    this.unmountVirtualizer = null;
    this.resizeHandler = this.throttle(() => this.handleLayoutChange(), 150);
    this.handleVirtualizerChange = () => this.queueRender();

    this.init();
  }

  init() {
    this.scrollContainer = document.createElement("div");
    this.scrollContainer.className = "virtual-scroll-container";

    this.contentWrapper = document.createElement("div");
    this.contentWrapper.className = "virtual-content";

    this.scrollContainer.appendChild(this.contentWrapper);
    this.container.innerHTML = "";
    this.container.appendChild(this.scrollContainer);

    this.virtualizer = new Virtualizer({
      count: this.allPhotos.length,
      getScrollElement: () => this.container,
      estimateSize: () => this.options.itemHeight,
      getItemKey: (index) => this.getPhotoKey(this.allPhotos[index], index),
      overscan: this.getOverscan(),
      lanes: this.calculateItemsPerRow(),
      gap: this.options.gap,
      observeElementRect,
      observeElementOffset,
      scrollToFn: elementScroll,
      onChange: this.handleVirtualizerChange,
    });

    this.unmountVirtualizer = this.virtualizer._didMount();
    this.bindLayoutObserver();
    this.syncVirtualizerOptions();
    this.render();
  }

  bindLayoutObserver() {
    if (window.ResizeObserver) {
      this.layoutObserver = new window.ResizeObserver(() => {
        this.handleLayoutChange();
      });
      this.layoutObserver.observe(this.container);
      return;
    }

    window.addEventListener("resize", this.resizeHandler);
  }

  handleLayoutChange() {
    this.syncVirtualizerOptions();
    this.queueRender();
  }

  calculateItemsPerRow() {
    const containerWidth = this.container.clientWidth || window.innerWidth - 40;
    const laneWidth = this.options.minItemWidth + this.options.gap;
    return Math.max(1, Math.floor((containerWidth + this.options.gap) / laneWidth));
  }

  calculateItemWidth(itemsPerRow) {
    const containerWidth = this.container.clientWidth || window.innerWidth - 40;
    const totalGap = this.options.gap * Math.max(0, itemsPerRow - 1);
    return Math.max(
      this.options.minItemWidth,
      (containerWidth - totalGap) / Math.max(1, itemsPerRow)
    );
  }

  getOverscan() {
    return Math.max(1, this.options.itemsPerRow * this.options.bufferRows);
  }

  syncVirtualizerOptions() {
    const itemsPerRow = this.calculateItemsPerRow();
    this.options.itemsPerRow = itemsPerRow;
    this.itemWidth = this.calculateItemWidth(itemsPerRow);

    this.virtualizer.setOptions({
      ...this.virtualizer.options,
      count: this.allPhotos.length,
      getScrollElement: () => this.container,
      estimateSize: () => this.options.itemHeight,
      getItemKey: (index) => this.getPhotoKey(this.allPhotos[index], index),
      overscan: this.getOverscan(),
      lanes: itemsPerRow,
      gap: this.options.gap,
      observeElementRect,
      observeElementOffset,
      scrollToFn: elementScroll,
      onChange: this.handleVirtualizerChange,
    });
    this.virtualizer._willUpdate();
  }

  queueRender() {
    if (this.renderRafId) {
      return;
    }

    this.renderRafId = window.requestAnimationFrame(() => {
      this.renderRafId = null;
      this.render();
    });
  }

  render() {
    if (!this.virtualizer) {
      return;
    }

    const virtualItems = this.virtualizer.getVirtualItems();
    const totalSize = Math.max(
      Math.ceil(this.virtualizer.getTotalSize()),
      this.container.clientHeight
    );

    this.scrollContainer.style.height = `${totalSize}px`;
    this.contentWrapper.style.height = `${totalSize}px`;

    const fragment = document.createDocumentFragment();
    const nextRenderedCards = new Map();

    virtualItems.forEach((virtualItem) => {
      const photo = this.allPhotos[virtualItem.index];
      if (!photo) {
        return;
      }

      const photoKey = this.getPhotoKey(photo, virtualItem.index);
      let card = this.renderedCards.get(photoKey);
      if (!card) {
        card = this.createPhotoCardElement(photo, virtualItem.index);
      }

      this.updatePhotoCardElement(card, photo, virtualItem.index);
      this.applyCardLayout(card, virtualItem);
      nextRenderedCards.set(photoKey, card);
      fragment.appendChild(card);
    });

    this.contentWrapper.replaceChildren(fragment);
    this.renderedCards = nextRenderedCards;

    this.virtualizer.measureElement(null);
    nextRenderedCards.forEach((card) => {
      this.virtualizer.measureElement(card);
    });

    if (
      this.contentWrapper.querySelector("img.lazy") &&
      this.options.onInitLazyLoading
    ) {
      this.options.onInitLazyLoading();
    }
  }

  applyCardLayout(card, virtualItem) {
    const left = virtualItem.lane * (this.itemWidth + this.options.gap);
    card.style.width = `${this.itemWidth}px`;
    card.style.left = `${left}px`;
    card.style.top = `${virtualItem.start}px`;
  }

  renderPhotoCard(photo, index) {
    const isSelected =
      this.options.selectedPhotos &&
      typeof this.options.selectedPhotos.has === "function" &&
      this.options.selectedPhotos.has(photo.filename);

    return `
      <div class="photo-card ${photo.is_hidden ? "hidden" : ""} ${
      isSelected ? "selected" : ""
    }" data-filename="${photo.filename}" data-index="${index}">
        <input type="checkbox" class="photo-checkbox" data-filename="${
          photo.filename
        }" ${isSelected ? "checked" : ""}>
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
    `;
  }

  getPhotoKey(photo, index) {
    if (photo && photo.year && photo.filename) {
      return `${photo.year}:${photo.filename}`;
    }

    return `index:${index}`;
  }

  createPhotoCardElement(photo, index) {
    const template = document.createElement("template");
    template.innerHTML = this.renderPhotoCard(photo, index).trim();
    return template.content.firstElementChild;
  }

  updatePhotoCardElement(card, photo, index) {
    if (!card || !photo) {
      return;
    }

    const isSelected =
      this.options.selectedPhotos &&
      typeof this.options.selectedPhotos.has === "function" &&
      this.options.selectedPhotos.has(photo.filename);

    card.dataset.filename = photo.filename;
    card.dataset.index = index;
    card.classList.toggle("hidden", Boolean(photo.is_hidden));
    card.classList.toggle("selected", isSelected);

    const checkbox = card.querySelector(".photo-checkbox");
    if (checkbox) {
      checkbox.dataset.filename = photo.filename;
      checkbox.checked = isSelected;
    }

    const thumbnail = card.querySelector(".photo-thumbnail");
    if (thumbnail) {
      thumbnail.dataset.src = `/api/images/${photo.year}/${photo.filename}`;
      thumbnail.alt = photo.alt || photo.filename;
    }

    const filenameEl = card.querySelector(".photo-filename");
    if (filenameEl) {
      filenameEl.textContent = photo.filename;
      filenameEl.title = photo.filename;
    }

    const metaParts = card.querySelectorAll(".photo-meta span");
    if (metaParts[0]) {
      metaParts[0].textContent = photo.date;
    }
    if (metaParts[1]) {
      metaParts[1].textContent = `${photo.width}×${photo.height}`;
    }

    const previewButton = card.querySelector(".btn-preview-remote");
    if (previewButton) {
      previewButton.dataset.filename = photo.filename;
    }
  }

  throttle(func, wait) {
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

  updatePhotos(photos) {
    this.allPhotos = photos;
    if (!this.options.selectedPhotos && window.selectedPhotos) {
      this.options.selectedPhotos = window.selectedPhotos;
    }
    this.syncVirtualizerOptions();
    this.queueRender();
  }

  destroy() {
    if (this.renderRafId) {
      window.cancelAnimationFrame(this.renderRafId);
      this.renderRafId = null;
    }

    if (this.layoutObserver) {
      this.layoutObserver.disconnect();
      this.layoutObserver = null;
    } else {
      window.removeEventListener("resize", this.resizeHandler);
    }

    if (typeof this.unmountVirtualizer === "function") {
      this.unmountVirtualizer();
      this.unmountVirtualizer = null;
    }

    this.renderedCards.clear();
  }
}

window.VirtualPhotoGrid = VirtualPhotoGrid;
