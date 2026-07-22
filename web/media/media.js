(function () {
  const categories = [
    { id: "music", label: "音乐", coverHeightRatio: 1 },
    { id: "book", label: "书籍", coverHeightRatio: 1.5 },
    { id: "movie", label: "电影", coverHeightRatio: 1.5 },
    { id: "tv", label: "剧集", coverHeightRatio: 1.5 },
    { id: "game", label: "游戏", coverHeightRatio: 1.5 },
    { id: "podcast", label: "播客", coverHeightRatio: 1.5 },
  ];

  const GRID_MIN_CARD_WIDTH = 140;
  const MIN_PAGE_ROWS = 1;
  const MAX_PAGE_ROWS = 4;
  const CARD_TEXT_HEIGHT = 56;
  const MOBILE_MEDIA_QUERY = "(max-width: 720px)";
  const GRID_BOTTOM_GAP = 14;

  const state = {
    activeCategoryId: "music",
    categories: {},
    pendingScrollCategoryId: "",
    total: 0,
    loaded: 0,
  };

  function normalizeRecords(value) {
    return Array.isArray(value) ? value : [];
  }

  function categoryById(id) {
    return categories.find((category) => category.id === id);
  }

  function categoryIdFromHash() {
    const hash = window.location.hash.replace(/^#/, "").replace(/^media-/, "");
    return categoryById(hash) ? hash : "music";
  }

  function normalizeNeoDBURL(url) {
    if (!url) return "https://neodb.social/";
    if (/^https?:\/\//.test(url)) return url;
    return `https://neodb.social/${url.replace(/^\/+/, "")}`;
  }

  function formatDate(value) {
    if (!value) return "";
    if (/^\d{4}(?:-\d{2})?$/.test(value)) return value;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }

  function personalRatingText(record) {
    const rating = Number(record.rating_grade || record.rating || 0);
    if (rating <= 0) return "";
    return `${rating.toLocaleString("zh-CN")}/10`;
  }

  function itemRatingText(record) {
    const rating = Number(record.item?.rating || 0);
    if (rating <= 0) return "";
    return `${rating.toLocaleString("zh-CN")}/10`;
  }

  function fallbackCover(title) {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450">
        <rect width="300" height="450" fill="#f3f4f6"/>
        <text x="30" y="220" font-family="Arial, sans-serif" font-size="24" fill="#111827">${escapeHTML(title || "NeoDB")}</text>
      </svg>
    `;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  }

  function escapeHTML(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function renderCard(record, category) {
    const item = record.item || {};
    const title = item.title || "未命名条目";
    const markedDate = formatDate(record.created_time);
    const releaseDate = formatDate(item.release_date);
    const itemRating = itemRatingText(record);
    const personalRating = personalRatingText(record);
    const commentText = record.comment_text || record.comment || "";
    const meta = [
      itemRating ? `<span class="media-rating">${escapeHTML(itemRating)}</span>` : "",
      releaseDate ? `<span class="media-date">${escapeHTML(releaseDate)}</span>` : "",
    ].filter(Boolean).join(" · ");
    const url = normalizeNeoDBURL(item.url);
    const fallback = fallbackCover(title);
    const cover = item.cover_image_url || item.cover || fallback;
    const hoverRows = [
      personalRating ? `<div class="media-hover-row"><span>我的评分</span><strong>${escapeHTML(personalRating)}</strong></div>` : "",
      commentText ? `<p class="media-hover-comment">${escapeHTML(commentText)}</p>` : "",
      markedDate ? `<div class="media-hover-row"><span>标记日期</span><strong>${escapeHTML(markedDate)}</strong></div>` : "",
    ].filter(Boolean).join("");
    const hoverCard = hoverRows
      ? `<div class="media-hover-card" aria-hidden="true">${hoverRows}</div>`
      : "";
    const commentIndicator = commentText
      ? `<span class="media-comment-indicator" title="有我的短评" aria-hidden="true"></span>`
      : "";
    const hasPersonalDetails = Boolean(personalRating || commentText);

    return `
      <article class="media-card media-card--${category.id}"${hasPersonalDetails ? ' data-touch-preview="true"' : ""}>
        <a class="media-cover-link" href="${url}" target="_blank" rel="noreferrer">
          <span class="media-cover-wrap">
            <img class="media-cover" src="${escapeHTML(cover)}" data-fallback-cover="${escapeHTML(fallback)}" alt="${escapeHTML(title)}封面" loading="lazy" />
            ${commentIndicator}
            ${hoverCard}
          </span>
          <h3 class="media-card-title" title="${escapeHTML(title)}">${escapeHTML(title)}</h3>
        </a>
        <div class="media-meta">${meta || escapeHTML(item.category || "")}</div>
      </article>
    `;
  }

  function isTouchPreviewDevice() {
    return window.matchMedia("(hover: none), (pointer: coarse)").matches;
  }

  function clearActiveCards(exceptCard) {
    document.querySelectorAll(".media-card.is-active").forEach((card) => {
      if (card !== exceptCard) card.classList.remove("is-active");
    });
  }

  function handleTouchPreviewClick(event) {
    if (!isTouchPreviewDevice()) return;

    const link = event.target.closest(".media-cover-link");
    if (!link || !event.target.closest(".media-cover-wrap")) {
      clearActiveCards(null);
      return;
    }

    const card = link.closest('.media-card[data-touch-preview="true"]');
    if (!card) return;

    if (!card.classList.contains("is-active")) {
      event.preventDefault();
      clearActiveCards(card);
      card.classList.add("is-active");
    }
  }

  function handleCoverError(event) {
    const image = event.target.closest?.(".media-cover");
    if (!image || image.dataset.fallbackApplied === "true") return;

    image.dataset.fallbackApplied = "true";
    image.src = image.dataset.fallbackCover || fallbackCover(image.alt);
  }

  function renderPagination(category, page, totalPages) {
    if (totalPages <= 1) return "";

    const pageButtons = Array.from({ length: totalPages }, (_, index) => {
      const pageNumber = index + 1;
      return `
        <button
          class="media-page-button${pageNumber === page ? " is-active" : ""}"
          type="button"
          data-media-page="${pageNumber}"
          data-media-category="${category.id}"
          aria-current="${pageNumber === page ? "page" : "false"}"
        >${pageNumber}</button>
      `;
    }).join("");

    return `
      <nav class="media-pagination" aria-label="${escapeHTML(category.label)}分页">
        <button
          class="media-page-button"
          type="button"
          data-media-page="${page - 1}"
          data-media-category="${category.id}"
          ${page === 1 ? "disabled" : ""}
        >上一页</button>
        <div class="media-page-numbers">${pageButtons}</div>
        <button
          class="media-page-button"
          type="button"
          data-media-page="${page + 1}"
          data-media-category="${category.id}"
          ${page === totalPages ? "disabled" : ""}
        >下一页</button>
      </nav>
    `;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function isMobileViewport() {
    return window.matchMedia(MOBILE_MEDIA_QUERY).matches;
  }

  function renderBottomPagination(markup) {
    const slot = document.getElementById("media-pagination-slot");
    if (slot) slot.innerHTML = markup || "";
  }

  function activePageGridHeight(section) {
    const tabs = document.querySelector(".media-tabs");
    const body = section.querySelector(".media-section-body");
    const bottomBar = document.querySelector(".media-bottom-bar");
    if (!tabs || !body) return 0;

    const tabsTop = tabs.getBoundingClientRect().top + window.scrollY;
    const bodyTop = body.getBoundingClientRect().top + window.scrollY;
    const bodyTopAfterScroll = Math.max(0, bodyTop - tabsTop);
    const bottomBarHeight = bottomBar?.getBoundingClientRect().height || 0;
    const bottomBarTop = isMobileViewport()
      ? window.innerHeight
      : window.innerHeight - bottomBarHeight;

    return Math.max(0, bottomBarTop - bodyTopAfterScroll - GRID_BOTTOM_GAP);
  }

  function updateScrollSpacer() {
    const main = document.querySelector(".media-main");
    const tabs = document.querySelector(".media-tabs");
    if (!main || !tabs) return;

    main.style.paddingBottom = "";
    if (isMobileViewport()) return;

    const tabsOffset = tabs.getBoundingClientRect().top + window.scrollY;
    const mainBottom = main.getBoundingClientRect().bottom + window.scrollY;
    const requiredBottom = window.innerHeight + tabsOffset;
    const spacer = Math.max(0, Math.ceil(requiredBottom - mainBottom));
    main.style.paddingBottom = `calc(2rem + ${spacer}px)`;
  }

  function calculatePageSize(category, section) {
    const categoryState = state.categories[category.id];
    if (isMobileViewport() && categoryState) return Math.max(1, categoryState.records.length);

    const body = section.querySelector(".media-section-body");
    const width = body?.clientWidth || section.clientWidth || window.innerWidth;
    const gap = 16;
    const columns = Math.max(1, Math.floor((width + gap) / (GRID_MIN_CARD_WIDTH + gap)));
    const cardWidth = (width - gap * (columns - 1)) / columns;
    const rowHeight = cardWidth * category.coverHeightRatio + CARD_TEXT_HEIGHT;
    const rowGap = 22;
    const availableHeight = Math.max(rowHeight, activePageGridHeight(section));
    const rows = clamp(
      Math.floor((availableHeight + rowGap) / (rowHeight + rowGap)),
      MIN_PAGE_ROWS,
      MAX_PAGE_ROWS,
    );

    return Math.max(1, columns * rows);
  }

  function scrollTabsIntoView() {
    if (isMobileViewport()) return;
    const tabs = document.querySelector(".media-tabs");
    if (!tabs) return;

    const top = tabs.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top, left: 0, behavior: "auto" });
  }

  function renderCategoryPage(category) {
    const section = document.getElementById(`media-${category.id}`);
    const categoryState = state.categories[category.id];
    if (!section || !categoryState) return;

    const body = section.querySelector(".media-section-body");
    const { records } = categoryState;
    const pageSize = calculatePageSize(category, section);
    const totalPages = Math.max(1, Math.ceil(records.length / pageSize));
    const page = clamp(categoryState.page, 1, totalPages);
    const start = (page - 1) * pageSize;
    const pageRecords = records.slice(start, start + pageSize);
    const renderKey = `${page}:${pageSize}:${records.length}`;
    categoryState.page = page;
    categoryState.pageSize = pageSize;

    if (categoryState.renderKey === renderKey && body.querySelector(".media-grid")) {
      renderBottomPagination(renderPagination(category, page, totalPages));
      return;
    }

    categoryState.renderKey = renderKey;
    body.innerHTML = `
      <div class="media-grid">${pageRecords.map((record) => renderCard(record, category)).join("")}</div>
    `;
    renderBottomPagination(renderPagination(category, page, totalPages));
  }

  function renderActiveCategory() {
    const category = categoryById(state.activeCategoryId);
    const categoryState = category ? state.categories[category.id] : null;
    if (!category || !categoryState) return;

    const section = document.getElementById(`media-${category.id}`);
    const body = section?.querySelector(".media-section-body");
    if (!body) return;

    if (categoryState.records.length === 0) {
      if (categoryState.renderKey !== "empty") {
        categoryState.renderKey = "empty";
        body.innerHTML = `<div class="media-empty">还没有${category.label}记录。</div>`;
      }
      renderBottomPagination("");
      return;
    }

    renderCategoryPage(category);
  }

  function syncActiveView(options = {}) {
    renderActiveCategory();
    updateScrollSpacer();

    if (!options.scrollToTabs) return;

    requestAnimationFrame(() => {
      updateScrollSpacer();
      scrollTabsIntoView();
      requestAnimationFrame(scrollTabsIntoView);
    });
  }

  function setActiveCategory(categoryId, options = {}) {
    const category = categoryById(categoryId) || categories[0];
    state.activeCategoryId = category.id;
    clearActiveCards(null);

    categories.forEach((item) => {
      const isActive = item.id === category.id;
      const tab = document.querySelector(`[data-media-tab="${item.id}"]`);
      const section = document.getElementById(`media-${item.id}`);

      if (tab) {
        tab.classList.toggle("is-active", isActive);
        tab.setAttribute("aria-selected", String(isActive));
        tab.tabIndex = isActive ? 0 : -1;
      }

      if (section) section.hidden = !isActive;
    });

    if (options.updateURL) {
      history.pushState({ mediaCategory: category.id }, "", `#${category.id}`);
    }

    if (options.scrollToTabs) {
      state.pendingScrollCategoryId = category.id;
    }

    syncActiveView({ scrollToTabs: options.scrollToTabs });
    if (state.categories[category.id]) state.pendingScrollCategoryId = "";
  }

  function renderCategory(category, records) {
    const section = document.getElementById(`media-${category.id}`);
    if (!section) return;
    const list = normalizeRecords(records);
    state.categories[category.id] = {
      page: 1,
      pageSize: 0,
      renderKey: "",
      records: list,
    };
    state.total += list.length;
    state.loaded += 1;

    section.querySelector(".media-count").textContent = `${list.length} 条记录`;
    const body = section.querySelector(".media-section-body");
    body.innerHTML = "";
    if (category.id === state.activeCategoryId) {
      const shouldScroll = state.pendingScrollCategoryId === category.id;
      syncActiveView({ scrollToTabs: shouldScroll });
      if (shouldScroll) state.pendingScrollCategoryId = "";
    }

    if (state.loaded === categories.length) {
      const total = document.getElementById("media-total");
      if (total) total.textContent = `${state.total} 条记录`;
      updateScrollSpacer();
    }
  }

  function handlePaginationClick(event) {
    const button = event.target.closest("[data-media-page][data-media-category]");
    if (!button) return;

    const categoryId = button.dataset.mediaCategory;
    const categoryState = state.categories[categoryId];
    const category = categories.find((item) => item.id === categoryId);
    if (!categoryState || !category) return;

    const section = document.getElementById(`media-${category.id}`);
    const pageSize = section ? calculatePageSize(category, section) : categoryState.pageSize;
    const totalPages = Math.max(1, Math.ceil(categoryState.records.length / pageSize));
    const nextPage = Number(button.dataset.mediaPage);
    if (!Number.isInteger(nextPage) || nextPage < 1 || nextPage > totalPages) return;

    clearActiveCards(null);
    categoryState.page = nextPage;
    syncActiveView({ scrollToTabs: true });
  }

  function handleTabClick(event) {
    const tab = event.target.closest("[data-media-tab]");
    if (!tab) return;

    setActiveCategory(tab.dataset.mediaTab, { updateURL: true, scrollToTabs: true });
  }

  function handleTabKeydown(event) {
    const tab = event.target.closest("[data-media-tab]");
    if (!tab) return;

    const currentIndex = categories.findIndex((category) => category.id === tab.dataset.mediaTab);
    if (currentIndex < 0) return;

    const keyMap = {
      ArrowLeft: -1,
      ArrowUp: -1,
      ArrowRight: 1,
      ArrowDown: 1,
    };
    const offset = keyMap[event.key];
    if (!offset) return;

    event.preventDefault();
    const nextIndex = (currentIndex + offset + categories.length) % categories.length;
    const nextTab = document.querySelector(`[data-media-tab="${categories[nextIndex].id}"]`);
    nextTab?.focus();
    setActiveCategory(categories[nextIndex].id, { updateURL: true, scrollToTabs: true });
  }

  function handleResize() {
    syncActiveView();
  }

  async function loadCategory(category) {
    try {
      const response = await fetch(`data/${category.id}.json`, { cache: "no-store" });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      renderCategory(category, await response.json());
    } catch (error) {
      const section = document.getElementById(`media-${category.id}`);
      if (!section) return;
      section.querySelector(".media-count").textContent = "加载失败";
      section.querySelector(".media-section-body").innerHTML =
        `<div class="media-error">${category.label}记录加载失败。</div>`;
      state.loaded += 1;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    state.activeCategoryId = categoryIdFromHash();
    setActiveCategory(state.activeCategoryId);
    document.addEventListener("error", handleCoverError, true);
    document.addEventListener("click", handleTouchPreviewClick);
    document.addEventListener("click", handlePaginationClick);
    document.addEventListener("click", handleTabClick);
    document.addEventListener("keydown", handleTabKeydown);
    window.addEventListener("popstate", () => {
      setActiveCategory(categoryIdFromHash(), { scrollToTabs: true });
    });
    window.addEventListener("resize", handleResize);
    categories.forEach(loadCategory);
  });
})();
