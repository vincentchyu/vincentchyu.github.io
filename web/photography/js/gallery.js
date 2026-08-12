/**
 * Gallery Renderer
 * Fetches the gallery manifest and year shards, then renders the photography portfolio with a timeline layout.
 */

// Flag to prevent URL updates during initial photo load from URL
// This prevents Carousel.change events during initialization from updating URL incorrectly
let isInitializingFromUrl = false;
let galleryItems = [];
let galleryPhotoRecords = [];
let galleryManifest = null;
let galleryLoadToken = 0;
let galleryWaterfall = null;
let galleryLoadedYears = new Set();
let activeGalleryMode = "legacy";
let galleryPendingYearEntries = [];
let galleryNextYearCursor = 0;
let galleryYearLoadPromise = Promise.resolve();
let galleryLoadMoreObserver = null;
let galleryLoadMoreSentinel = null;

const INITIAL_YEAR_BATCH = 2;
const INITIAL_PHOTO_TARGET = 72;
const YEAR_LOAD_AHEAD_MARGIN = "300px 0px";
const GalleryDataApi = window.GalleryData;
const GalleryLayoutApi = window.GalleryLayout;
const GalleryLightboxApi = window.GalleryLightbox;
const GalleryLoaderApi = window.GalleryLoader;
const GalleryMetadataApi = window.GalleryMetadata;
const GalleryTimelineApi = window.GalleryTimeline;
const GalleryThumbnailApi = window.GalleryThumbnail;

if (!GalleryDataApi || !GalleryLayoutApi || !GalleryLightboxApi || !GalleryLoaderApi || !GalleryMetadataApi || !GalleryTimelineApi || !GalleryThumbnailApi) {
    throw new Error("Gallery modules failed to initialize");
}

GalleryLightboxApi.configure({
    getState: () => ({
        isInitializingFromUrl,
        activeGalleryMode,
        galleryLoadToken,
    }),
    setIsInitializingFromUrl: (value) => {
        isInitializingFromUrl = value;
    },
    scheduleYearLoad: (options) => scheduleYearLoad(options),
    createMetadataPanel: (...args) => GalleryMetadataApi.createMetadataPanel(...args),
});

GalleryTimelineApi.configure({
    getState: () => ({
        activeGalleryMode,
        galleryLoadedYears,
        galleryLoadToken,
    }),
    scheduleYearLoad: (options) => scheduleYearLoad(options),
    extractYearFromSectionId: (sectionId) => extractYearFromSectionId(sectionId),
});

GalleryLayoutApi.configure({
    refreshTimelineToc: () => GalleryTimelineApi.refreshTimelineToc(),
    queueThumbnailLoads: (root) => GalleryThumbnailApi.queueThumbnailLoads(root),
    bindImageLoadEvents: (root) => GalleryThumbnailApi.bindImageLoadEvents(root),
});

GalleryLoaderApi.configure({
    config: {
        initialYearBatch: INITIAL_YEAR_BATCH,
        initialPhotoTarget: INITIAL_PHOTO_TARGET,
        yearLoadAheadMargin: YEAR_LOAD_AHEAD_MARGIN,
    },
    getState: () => ({
        activeGalleryMode,
        galleryItems,
        galleryPhotoRecords,
        galleryManifest,
        galleryLoadToken,
        galleryWaterfall,
        galleryLoadedYears,
        galleryPendingYearEntries,
        galleryNextYearCursor,
        galleryYearLoadPromise,
        galleryLoadMoreObserver,
        galleryLoadMoreSentinel,
    }),
    setState: (updates) => {
        if (Object.prototype.hasOwnProperty.call(updates, "activeGalleryMode")) {
            activeGalleryMode = updates.activeGalleryMode;
        }
        if (Object.prototype.hasOwnProperty.call(updates, "galleryItems")) {
            galleryItems = updates.galleryItems;
        }
        if (Object.prototype.hasOwnProperty.call(updates, "galleryPhotoRecords")) {
            galleryPhotoRecords = updates.galleryPhotoRecords;
        }
        if (Object.prototype.hasOwnProperty.call(updates, "galleryManifest")) {
            galleryManifest = updates.galleryManifest;
        }
        if (Object.prototype.hasOwnProperty.call(updates, "galleryLoadToken")) {
            galleryLoadToken = updates.galleryLoadToken;
        }
        if (Object.prototype.hasOwnProperty.call(updates, "galleryWaterfall")) {
            galleryWaterfall = updates.galleryWaterfall;
        }
        if (Object.prototype.hasOwnProperty.call(updates, "galleryLoadedYears")) {
            galleryLoadedYears = updates.galleryLoadedYears;
        }
        if (Object.prototype.hasOwnProperty.call(updates, "galleryPendingYearEntries")) {
            galleryPendingYearEntries = updates.galleryPendingYearEntries;
        }
        if (Object.prototype.hasOwnProperty.call(updates, "galleryNextYearCursor")) {
            galleryNextYearCursor = updates.galleryNextYearCursor;
        }
        if (Object.prototype.hasOwnProperty.call(updates, "galleryYearLoadPromise")) {
            galleryYearLoadPromise = updates.galleryYearLoadPromise;
        }
        if (Object.prototype.hasOwnProperty.call(updates, "galleryLoadMoreObserver")) {
            galleryLoadMoreObserver = updates.galleryLoadMoreObserver;
        }
        if (Object.prototype.hasOwnProperty.call(updates, "galleryLoadMoreSentinel")) {
            galleryLoadMoreSentinel = updates.galleryLoadMoreSentinel;
        }
    },
    getCurrentColumnCount: () => currentColumnCount,
    setCurrentColumnCount: (value) => {
        currentColumnCount = value;
    },
    dataApi: GalleryDataApi,
    layoutApi: GalleryLayoutApi,
    timelineApi: GalleryTimelineApi,
    lightboxApi: GalleryLightboxApi,
    renderGallery: (container, albums, items) => renderGallery(container, albums, items),
    bindGalleryItemClicks: (container, items) => bindGalleryItemClicks(container, items),
    bindImageLoadEvents: (root) => GalleryThumbnailApi.bindImageLoadEvents(root),
    rerenderCurrentGalleryLayout: () => rerenderCurrentGalleryLayout(),
    appendLoadedPhotos: (photos) => appendLoadedPhotos(photos),
});

document.addEventListener("DOMContentLoaded", function () {
    loadGallery();
    if (GalleryTimelineApi.isTimelineEnabled()) {
        GalleryTimelineApi.setupTimelineHover();
    }
    GalleryLightboxApi.scheduleFancyboxWarmup();
});

async function loadGallery() {
    return GalleryLoaderApi.loadGallery();
}

async function loadShardedGallery(manifest, timelineContainer, galleryContainer) {
    return GalleryLoaderApi.loadShardedGallery(
        manifest,
        timelineContainer,
        galleryContainer
    );
}


function calculateInitialYearBatch(yearEntries) {
    return GalleryLoaderApi.calculateInitialYearBatch(yearEntries);
}

function scheduleYearLoad({
    token,
    minYears = 1,
    targetPhotoIndex = null,
    targetYear = "",
} = {}) {
    return GalleryLoaderApi.scheduleYearLoad({
        token,
        minYears,
        targetPhotoIndex,
        targetYear,
    });
}

async function loadMoreYears({
    token,
    minYears = 1,
    targetPhotoIndex = null,
    targetYear = "",
} = {}) {
    return GalleryLoaderApi.loadMoreYears({
        token,
        minYears,
        targetPhotoIndex,
        targetYear,
    });
}

function ensureGalleryLoadMoreSentinel(container) {
    return GalleryLoaderApi.ensureGalleryLoadMoreSentinel(container);
}

function disconnectGalleryLoadMoreObserver() {
    return GalleryLoaderApi.disconnectGalleryLoadMoreObserver();
}

function setupGalleryLoadMoreObserver(token) {
    return GalleryLoaderApi.setupGalleryLoadMoreObserver(token);
}

function updateGalleryLoadMoreSentinel() {
    return GalleryLoaderApi.updateGalleryLoadMoreSentinel();
}

async function loadYearShard(entry, token) {
    return GalleryLoaderApi.loadYearShard(entry, token);
}

function appendLoadedPhotos(photos) {
    if (!galleryWaterfall || !Array.isArray(photos) || photos.length === 0) {
        return;
    }

    photos.forEach((photo) => {
        galleryPhotoRecords.push(photo);
        photo.waterfallIndex = galleryItems.length;
        galleryItems.push({
            src: photo.path,
            thumb: photo.thumbnail,
            caption: photo.alt || "",
            exif: photo.exif,
            filename: photo.filename || "",
            Subject: photo.Subject || [],
        });

        const card = GalleryLayoutApi.createPhotoCard(photo);
        galleryWaterfall.container.appendChild(card);
        galleryWaterfall.renderedCards.push({ photo, card, sectionHeadings: photo.sectionHeadings });

        GalleryThumbnailApi.queueThumbnailLoads(card);
        GalleryThumbnailApi.bindImageLoadEvents(card);
    });

    GalleryLayoutApi.reflowAbsoluteWaterfall(galleryWaterfall);

    requestAnimationFrame(() => {
        GalleryTimelineApi.refreshTimelineToc();
    });
}

function bindGalleryItemClicks(galleryContainer, items) {
    if (!galleryContainer || galleryContainer.dataset.galleryClicksBound === "true") {
        return;
    }

    galleryContainer.dataset.galleryClicksBound = "true";
    galleryContainer.addEventListener("click", (e) => {
        const link = e.target.closest(".gallery-item");
        if (!link) return;

        e.preventDefault();
        e.stopPropagation();

        const index = parseInt(link.dataset.index, 10) || 0;
        void GalleryLightboxApi.openFancyboxDirectly(index, items);
    });
}
function extractYearFromSectionId(sectionId) {
    if (!sectionId) {
        return "";
    }

    const match = String(sectionId).match(/(?:year|section)-(\d{4})/);
    return match ? match[1] : "";
}

function renderGallery(container, albums, galleryItems) {
    const {waterfallState, allPhotos} = GalleryLayoutApi.renderGallery(
        container,
        albums,
        galleryItems
    );
    galleryWaterfall = waterfallState;
    galleryPhotoRecords = allPhotos;
}

function buildOutlineAlbumsFromLoadedPhotos(photos) {
    const years = new Map();

    photos.forEach((photo) => {
        const year = String(photo.year || extractYearFromDate(photo.date) || "");
        const month = String(photo.month || "").padStart(2, "0");
        if (!year || !month) {
            return;
        }

        if (!years.has(year)) {
            years.set(year, {year, months: []});
        }

        const entry = years.get(year);
        if (!entry.months.some((item) => item.month === month)) {
            entry.months.push({month, count: 0});
        }
    });

    return Array.from(years.values())
        .sort((a, b) => String(b.year).localeCompare(String(a.year)))
        .map((entry) => ({
            year: entry.year,
            months: entry.months.sort((a, b) => String(b.month).localeCompare(String(a.month))),
        }));
}

function extractYearFromDate(date) {
    if (!date) {
        return "";
    }
    const match = String(date).match(/^(\d{4})/);
    return match ? match[1] : "";
}

function rerenderCurrentGalleryLayout() {
    const galleryContainer = document.getElementById("gallery-content");
    if (!galleryContainer || !Array.isArray(galleryPhotoRecords) || galleryPhotoRecords.length === 0) {
        return false;
    }

    if (activeGalleryMode === "sharded") {
        disconnectGalleryLoadMoreObserver();
    }

    galleryContainer.innerHTML = "";
    galleryWaterfall = GalleryLayoutApi.createWaterfallState(galleryContainer);

    if (activeGalleryMode === "sharded" && galleryManifest && Array.isArray(galleryManifest.years)) {
        GalleryLayoutApi.buildTimelineOutline(galleryWaterfall, galleryManifest.years);
    } else {
        GalleryLayoutApi.buildTimelineOutline(
            galleryWaterfall,
            GalleryLayoutApi.buildOutlineAlbumsFromLoadedPhotos(galleryPhotoRecords)
        );
    }

    GalleryLayoutApi.renderWaterfallLayout(galleryWaterfall, galleryPhotoRecords, galleryItems);
    bindGalleryItemClicks(galleryContainer, galleryItems);
    GalleryThumbnailApi.bindImageLoadEvents(galleryContainer);
    if (GalleryTimelineApi.isTimelineEnabled()) {
        GalleryTimelineApi.initTimelineToc();
    } else {
        GalleryTimelineApi.destroyTimelineToc();
    }

    if (activeGalleryMode === "sharded") {
        ensureGalleryLoadMoreSentinel(galleryContainer);
        setupGalleryLoadMoreObserver(galleryLoadToken);
    }

    return true;
}

/**
 * Debounce function
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Handle layout changes (orientation change or significant resize)
 */
let currentColumnCount = null; // Will be set after first gallery load
let lastWindowWidth = typeof window !== "undefined" ? window.innerWidth : 0;

function handleLayoutChange() {
    const newWidth = window.innerWidth;
    const newColumnCount = GalleryLayoutApi.getColumnCount();

    if (currentColumnCount === null) {
        currentColumnCount = newColumnCount;
        lastWindowWidth = newWidth;
        return;
    }

    if (newWidth !== lastWindowWidth) {
        lastWindowWidth = newWidth;
        currentColumnCount = newColumnCount;
        
        if (galleryWaterfall && galleryWaterfall.container) {
            GalleryLayoutApi.reflowAbsoluteWaterfall(galleryWaterfall);
        } else {
            loadGallery();
        }
    }
}

// 统一绑定 resize 和 orientationchange 事件，通过宽度及列数断点防止非必要的布局重绘
window.addEventListener("resize", debounce(handleLayoutChange, 300));
if ("onorientationchange" in window) {
    window.addEventListener(
        "orientationchange",
        debounce(handleLayoutChange, 300)
    );
}

/**
 * Extract tags from EXIF data
 */
