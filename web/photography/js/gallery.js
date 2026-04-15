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

const DEFAULT_REMOTE_GALLERY_DATA_BASE =
    "https://cdn-photography-img-vincent.chyu.org/pages/";
const INITIAL_YEAR_BATCH = 2;
const INITIAL_PHOTO_TARGET = 72;
const YEAR_LOAD_AHEAD_MARGIN = "300px 0px";
const THUMBNAIL_LOAD_AHEAD_MARGIN = "800px 0px";
const EAGER_THUMBNAIL_COUNT = 8;
const FANCYBOX_SCRIPT_URL =
    "https://cdn-photography-img-vincent.chyu.org/static/fancybox.umd.js";
const FANCYBOX_STYLE_URL =
    "https://cdn-photography-img-vincent.chyu.org/static/fancybox.css";
const METADATA_PANEL_STYLE_URL =
    "https://cdn-photography-img-vincent.chyu.org/static/metadata-panel.css?v=3";

let fancyboxAssetsPromise = null;
let fancyboxWarmupScheduled = false;
let thumbnailLoadObserver = null;
let timelineTocInitialized = false;
let timelineScrollHandler = null;
let timelineScrollTicking = false;
let activeTimelineId = "";

const TIMELINE_SCROLL_OFFSET = 100;
const TIMELINE_TOC_SELECTOR = "#timeline-sidebar";
const TIMELINE_CONTENT_SELECTOR = "#gallery-content .gallery-outline-layer";

/**
 * Normalize URL immediately on page load to prevent 308 redirect cache issues
 * This must run as early as possible, before any other code
 */
(function normalizeUrlOnLoad() {
    // Only normalize if there are query parameters
    // Server redirects /web/photography?photo=X to /web/photography/?photo=X (308)
    // So we ensure URL always has trailing slash to match server behavior
    if (window.location.search) {
        let pathname = window.location.pathname;
        // Ensure pathname ends with / to match server's 308 redirect behavior
        if (!pathname.endsWith("/")) {
            pathname = pathname + "/";
            const newUrl =
                window.location.origin +
                pathname +
                window.location.search +
                (window.location.hash || "");
            // Use replaceState immediately to match server behavior and avoid redirect
            if (window.history && window.history.replaceState) {
                window.history.replaceState(null, null, newUrl);
            }
        }
    }
})();

// Also handle pageshow event for browser back/forward cache
window.addEventListener("pageshow", function (event) {
    // If page was loaded from cache (bfcache), normalize URL again
    // Server redirects /web/photography?photo=X to /web/photography/?photo=X (308)
    // So we ensure URL always has trailing slash to match server behavior
    if (event.persisted) {
        if (window.location.search) {
            let pathname = window.location.pathname;
            // Ensure pathname ends with / to match server's 308 redirect behavior
            if (!pathname.endsWith("/")) {
                pathname = pathname + "/";
                const newUrl =
                    window.location.origin +
                    pathname +
                    window.location.search +
                    (window.location.hash || "");
                if (window.history && window.history.replaceState) {
                    window.history.replaceState(null, null, newUrl);
                }
            }
        }
    }
});

document.addEventListener("DOMContentLoaded", function () {
    loadGallery();
    if (isTimelineEnabled()) {
        setupTimelineHover();
    }
    scheduleFancyboxWarmup();
});

function isTimelineEnabled() {
    return window.matchMedia("(min-width: 1181px)").matches;
}

function destroyTimelineToc() {
    if (timelineScrollHandler) {
        window.removeEventListener("scroll", timelineScrollHandler);
        timelineScrollHandler = null;
    }

    if (window.tocbot && timelineTocInitialized) {
        window.tocbot.destroy();
    }

    timelineScrollTicking = false;
    activeTimelineId = "";
    timelineTocInitialized = false;
}

function initTimelineToc() {
    if (!isTimelineEnabled()) {
        destroyTimelineToc();
        return;
    }

    if (!window.tocbot) {
        console.warn("Tocbot is not available");
        return;
    }

    const timelineSidebar = document.querySelector(TIMELINE_TOC_SELECTOR);
    const timelineContent = document.querySelector(TIMELINE_CONTENT_SELECTOR);
    if (!timelineSidebar || !timelineContent) {
        console.warn("Timeline TOC containers are missing", {
            timelineSidebar: Boolean(timelineSidebar),
            timelineContent: Boolean(timelineContent),
        });
        return;
    }

    destroyTimelineToc();
    window.tocbot.init({
        tocSelector: TIMELINE_TOC_SELECTOR,
        contentSelector: TIMELINE_CONTENT_SELECTOR,
        headingSelector: "h2, h3",
        hasInnerContainers: true,
        collapseDepth: 0,
        orderedList: false,
        scrollSmooth: false,
        disableTocScrollSync: true,
        headingsOffset: TIMELINE_SCROLL_OFFSET,
        ignoreHiddenElements: false,
    });
    timelineTocInitialized = true;
    if (!timelineSidebar.querySelector(".toc-list")) {
        console.warn("Tocbot initialized but rendered an empty timeline");
    }
    bindTimelineScrollSync();
    syncTimelineAriaCurrent();
}

function refreshTimelineToc() {
    if (!isTimelineEnabled() || !window.tocbot || !timelineTocInitialized) {
        return;
    }

    window.tocbot.refresh();
    syncTimelineAriaCurrent();
}

function bindTimelineScrollSync() {
    if (timelineScrollHandler) {
        window.removeEventListener("scroll", timelineScrollHandler);
    }

    timelineScrollHandler = () => {
        if (timelineScrollTicking) {
            return;
        }

        timelineScrollTicking = true;
        requestAnimationFrame(() => {
            timelineScrollTicking = false;
            syncTimelineAriaCurrent();
        });
    };

    window.addEventListener("scroll", timelineScrollHandler, {passive: true});
}

function syncTimelineAriaCurrent() {
    const timelineSidebar = document.getElementById("timeline-sidebar");
    if (!timelineSidebar) {
        return;
    }

    const outlineLayer = document.querySelector(TIMELINE_CONTENT_SELECTOR);
    if (!outlineLayer) {
        return;
    }

    const headings = Array.from(
        outlineLayer.querySelectorAll(".gallery-outline-heading[id]")
    )
        .map((heading) => ({
            id: heading.id,
            level: Number(heading.tagName?.replace(/^H/i, "")) || 0,
            top: heading.getBoundingClientRect().top + window.scrollY,
        }))
        .sort((a, b) => a.top - b.top);

    if (headings.length === 0) {
        return;
    }

    const probeTop = window.scrollY + TIMELINE_SCROLL_OFFSET + 24;
    const yearHeadings = headings.filter((heading) => heading.level === 2);
    const monthHeadings = headings.filter((heading) => heading.level === 3);

    let activeYearId = yearHeadings[0]?.id || "";
    for (const heading of yearHeadings) {
        if (heading.top <= probeTop) {
            activeYearId = heading.id;
        } else {
            break;
        }
    }

    const activeYearIndex = yearHeadings.findIndex((heading) => heading.id === activeYearId);
    const activeYearTop = activeYearIndex >= 0 ? yearHeadings[activeYearIndex].top : -Infinity;
    const nextYearTop =
        activeYearIndex >= 0 && activeYearIndex + 1 < yearHeadings.length
            ? yearHeadings[activeYearIndex + 1].top
            : Infinity;

    let activeMonthId = "";
    for (const heading of monthHeadings) {
        if (heading.top < activeYearTop || heading.top >= nextYearTop) {
            continue;
        }

        if (heading.top <= probeTop) {
            activeMonthId = heading.id;
        } else {
            break;
        }
    }

    const nextActiveId = activeMonthId || activeYearId;
    if (nextActiveId !== activeTimelineId) {
        activeTimelineId = nextActiveId;
        applyTimelineActiveState(activeYearId, activeMonthId);
    }
}

function applyTimelineActiveState(yearId, monthId = "") {
    const timelineSidebar = document.getElementById("timeline-sidebar");
    if (!timelineSidebar) {
        return;
    }

    timelineSidebar.querySelectorAll(".toc-link.is-active-link").forEach((link) => {
        link.classList.remove("is-active-link");
        link.removeAttribute("aria-current");
    });
    timelineSidebar.querySelectorAll(".toc-list-item.is-active-li").forEach((item) => {
        item.classList.remove("is-active-li");
    });

    if (yearId) {
        const yearLink = timelineSidebar.querySelector(
            `.toc-link[href="#${CSS.escape(yearId)}"]`
        );
        if (yearLink) {
            yearLink.classList.add("is-active-link");
            const yearItem = yearLink.closest(".toc-list-item");
            if (yearItem) {
                yearItem.classList.add("is-active-li");
            }
        }
    }

    if (monthId) {
        const monthLink = timelineSidebar.querySelector(
            `.toc-link[href="#${CSS.escape(monthId)}"]`
        );
        if (monthLink) {
            monthLink.classList.add("is-active-link");
            monthLink.setAttribute("aria-current", "location");
            const monthItem = monthLink.closest(".toc-list-item");
            if (monthItem) {
                monthItem.classList.add("is-active-li");
            }
        }
    } else if (yearId) {
        const yearLink = timelineSidebar.querySelector(
            `.toc-link[href="#${CSS.escape(yearId)}"]`
        );
        if (yearLink) {
            yearLink.setAttribute("aria-current", "location");
        }
    }
}

/**
 * Setup timeline hover show/hide functionality
 */
function setupTimelineHover() {
    const timelineSidebar = document.getElementById("timeline-sidebar");
    const hoverZone = document.getElementById("timeline-hover-zone");

    if (!timelineSidebar) {
        return;
    }

    if (!isTimelineEnabled()) {
        timelineSidebar.hidden = true;
        if (hoverZone) {
            hoverZone.hidden = true;
        }
        return;
    }

    if (timelineSidebar.classList.contains("timeline-static")) {
        timelineSidebar.classList.add("show");
        if (hoverZone) {
            hoverZone.hidden = true;
        }
        return;
    }

    if (!hoverZone) {
        return;
    }

    let hideTimeout = null;
    const HIDE_DELAY = 300; // Delay before hiding (ms)
    const MOBILE_HIDE_DELAY = 1500; // Longer delay on mobile after click
    let isMobileInteraction = false;

    // Show timeline when mouse enters hover zone or timeline itself
    function showTimeline() {
        if (hideTimeout) {
            clearTimeout(hideTimeout);
            hideTimeout = null;
        }
        timelineSidebar.classList.add("show");
        // Disable pointer events on hover zone when timeline is shown
        hoverZone.style.pointerEvents = "none";
    }

    // Hide timeline when mouse leaves
    function hideTimeline(useLongDelay = false) {
        const delay = useLongDelay ? MOBILE_HIDE_DELAY : HIDE_DELAY;
        hideTimeout = setTimeout(() => {
            timelineSidebar.classList.remove("show");
            // Re-enable pointer events on hover zone when timeline is hidden
            hoverZone.style.pointerEvents = "auto";
            isMobileInteraction = false;
        }, delay);
    }

    // Mouse events for desktop
    hoverZone.addEventListener("mouseenter", showTimeline);
    hoverZone.addEventListener("mouseleave", () => {
        if (!isMobileInteraction) {
            hideTimeline();
        }
    });

    timelineSidebar.addEventListener("mouseenter", showTimeline);
    timelineSidebar.addEventListener("mouseleave", () => {
        if (!isMobileInteraction) {
            hideTimeline();
        }
    });

    // Touch events for mobile
    hoverZone.addEventListener(
        "touchstart",
        (e) => {
            isMobileInteraction = true;
            showTimeline();
        },
        {passive: true}
    );

    timelineSidebar.addEventListener(
        "touchstart",
        (e) => {
            isMobileInteraction = true;
            showTimeline();
        },
        {passive: true}
    );

    // Handle clicks on timeline links
    timelineSidebar.addEventListener(
        "click",
        function (e) {
            const timelineLink = e.target.closest(".toc-link");
            if (!timelineLink) {
                return;
            }

            const sectionId = timelineLink.getAttribute("href")?.replace(/^#/, "");
            if (!sectionId) {
                return;
            }

            e.preventDefault();
            e.stopPropagation();
            void scrollToSection(sectionId);

            if (isMobileInteraction) {
                showTimeline();
                hideTimeline(true);
            } else {
                showTimeline();
            }
        },
        true
    );

    // Hide timeline when clicking outside on mobile
    document.addEventListener(
        "touchstart",
        (e) => {
            // Don't interfere with Fancybox
            if (e.target.closest(".fancybox__container")) {
                return;
            }

            if (
                isMobileInteraction &&
                !timelineSidebar.contains(e.target) &&
                !hoverZone.contains(e.target)
            ) {
                hideTimeline();
            }
        },
        {passive: true}
    );
}

function getGalleryDataMode() {
    const configuredMode = window.__PHOTO_GALLERY_DATA_MODE__;
    if (configuredMode === "local" || configuredMode === "remote") {
        return configuredMode;
    }

    const hostname = window.location.hostname;
    if (
        hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname === "::1" ||
        hostname.endsWith(".local")
    ) {
        return "local";
    }

    return "remote";
}

function getRemoteGalleryDataBase() {
    const configuredBase = window.__PHOTO_GALLERY_REMOTE_DATA_BASE__;
    if (typeof configuredBase === "string" && configuredBase.trim()) {
        return configuredBase.endsWith("/")
            ? configuredBase
            : `${configuredBase}/`;
    }

    return DEFAULT_REMOTE_GALLERY_DATA_BASE;
}

function getLocalGalleryBase() {
    return "/web/photography/";
}

function resolveGalleryManifestUrl() {
    if (getGalleryDataMode() === "local") {
        return new URL("data/photos-manifest.json", window.location.origin + getLocalGalleryBase()).toString();
    }

    return new URL("photos-manifest.json", getRemoteGalleryDataBase()).toString();
}

function resolveGalleryShardUrl(year) {
    if (getGalleryDataMode() === "local") {
        return new URL(`data/photos/${year}.json`, window.location.origin + getLocalGalleryBase()).toString();
    }

    return new URL(`photos/${year}.json`, getRemoteGalleryDataBase()).toString();
}

function ensureStylesheetLoaded(href) {
    return new Promise((resolve, reject) => {
        const absoluteHref = new URL(href, window.location.href).toString();
        const existing = Array.from(
            document.querySelectorAll('link[rel="stylesheet"]')
        ).find((link) => link.href === absoluteHref);

        if (existing) {
            resolve(existing);
            return;
        }

        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = href;
        link.onload = () => resolve(link);
        link.onerror = () =>
            reject(new Error(`Failed to load stylesheet: ${href}`));
        document.head.appendChild(link);
    });
}

function ensureScriptLoaded(src) {
    return new Promise((resolve, reject) => {
        const absoluteSrc = new URL(src, window.location.href).toString();
        const existing = Array.from(document.querySelectorAll("script")).find(
            (script) => script.src === absoluteSrc
        );

        if (existing) {
            if (existing.dataset.loaded === "true") {
                resolve(existing);
                return;
            }
            existing.addEventListener("load", () => resolve(existing), {once: true});
            existing.addEventListener(
                "error",
                () => reject(new Error(`Failed to load script: ${src}`)),
                {once: true}
            );
            return;
        }

        const script = document.createElement("script");
        script.src = src;
        script.async = true;
        script.onload = () => {
            script.dataset.loaded = "true";
            resolve(script);
        };
        script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
        document.head.appendChild(script);
    });
}

function ensureFancyboxAssets() {
    if (typeof Fancybox !== "undefined") {
        return Promise.resolve(Fancybox);
    }

    if (!fancyboxAssetsPromise) {
        fancyboxAssetsPromise = Promise.all([
            ensureStylesheetLoaded(FANCYBOX_STYLE_URL),
            ensureStylesheetLoaded(METADATA_PANEL_STYLE_URL),
            ensureScriptLoaded(FANCYBOX_SCRIPT_URL),
        ]).then(() => {
            if (typeof Fancybox === "undefined") {
                throw new Error("Fancybox did not initialize");
            }
            return Fancybox;
        }).catch((error) => {
            fancyboxAssetsPromise = null;
            throw error;
        });
    }

    return fancyboxAssetsPromise;
}

function scheduleFancyboxWarmup() {
    if (fancyboxWarmupScheduled || typeof window === "undefined") {
        return;
    }

    fancyboxWarmupScheduled = true;
    const warmup = () => {
        void ensureFancyboxAssets().catch((error) => {
            console.warn("Deferred Fancybox warmup failed:", error);
        });
    };

    if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(warmup, {timeout: 2500});
        return;
    }

    window.setTimeout(warmup, 2000);
}

function getGalleryFetchOptions() {
    if (getGalleryDataMode() === "local") {
        return {cache: "no-cache"};
    }
    return {};
}

function getRequestedPhotoIndexFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    let photoParam = urlParams.get("photo");

    if (!photoParam) {
        const fullUrl = window.location.href;
        const match = fullUrl.match(/[?&]photo=(\d+)/);
        if (match) {
            photoParam = match[1];
        }
    }

    if (!photoParam) {
        return null;
    }

    const photoIndex = parseInt(photoParam, 10);
    if (isNaN(photoIndex) || photoIndex < 0) {
        return null;
    }

    return photoIndex;
}

/**
 * Handle share button click - copy URL with photo index to clipboard
 */
function handleShareClick(event, galleryItems) {
    if (event && event.stopPropagation) {
        event.stopPropagation();
    }

    const instance = Fancybox.getInstance();
    if (!instance) {
        console.warn("Fancybox instance not found");
        return;
    }

    const currentSlide = instance.getSlide();
    if (!currentSlide) {
        console.warn("Current slide not found");
        return;
    }

    const photoIndex = currentSlide.index;
    if (
        photoIndex === undefined ||
        photoIndex < 0 ||
        photoIndex >= galleryItems.length
    ) {
        console.warn("Invalid photo index:", photoIndex);
        return;
    }

    // Generate share URL with query parameter: /web/photography/?photo=X&share
    // Using query parameter because /share path doesn't exist on server
    let pathname = window.location.pathname;
    // Ensure pathname ends with / to match server's 308 redirect behavior
    if (!pathname.endsWith("/")) {
        pathname = pathname + "/";
    }
    const baseUrl = window.location.origin + pathname;
    // Add share parameter to indicate this is a share link
    const shareUrl = `${baseUrl}?photo=${photoIndex}&share`;

    // Copy to clipboard
    copyToClipboard(shareUrl);
}

/**
 * Copy text to clipboard with fallback support
 */
function copyToClipboard(text) {
    // Try modern Clipboard API first
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard
            .writeText(text)
            .then(() => {
                showCopyNotification("链接已复制到剪贴板");
            })
            .catch((err) => {
                console.error("Failed to copy using Clipboard API:", err);
                // Fallback to execCommand
                fallbackCopyToClipboard(text);
            });
    } else {
        // Fallback for older browsers
        fallbackCopyToClipboard(text);
    }
}

/**
 * Fallback copy method using execCommand
 */
function fallbackCopyToClipboard(text) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-999999px";
    textArea.style.top = "-999999px";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
        const successful = document.execCommand("copy");
        if (successful) {
            showCopyNotification("链接已复制到剪贴板");
        } else {
            showCopyNotification("复制失败，请手动复制链接", true);
        }
    } catch (err) {
        console.error("Fallback copy failed:", err);
        showCopyNotification("复制失败，请手动复制链接", true);
    } finally {
        document.body.removeChild(textArea);
    }
}

/**
 * Show copy notification toast
 */
function showCopyNotification(message, isError = false) {
    // Remove existing notification if any
    const existing = document.getElementById("share-notification");
    if (existing) {
        existing.remove();
    }

    // Create notification element
    const notification = document.createElement("div");
    notification.id = "share-notification";
    notification.textContent = message;
    notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${isError ? "#ef4444" : "#10b981"};
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    z-index: 10000;
    font-size: 14px;
    font-weight: 500;
    animation: slideIn 0.3s ease-out;
    pointer-events: none;
  `;

    // Add animation keyframes if not already added
    if (!document.getElementById("share-notification-styles")) {
        const style = document.createElement("style");
        style.id = "share-notification-styles";
        style.textContent = `
      @keyframes slideIn {
        from {
          transform: translateX(100%);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
      @keyframes slideOut {
        from {
          transform: translateX(0);
          opacity: 1;
        }
        to {
          transform: translateX(100%);
          opacity: 0;
        }
      }
    `;
        document.head.appendChild(style);
    }

    document.body.appendChild(notification);

    // Remove after 3 seconds
    setTimeout(() => {
        notification.style.animation = "slideOut 0.3s ease-out";
        setTimeout(async () => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 300);
    }, 3000);
}

/**
 * Check if an image is loaded (cached or loaded)
 */
function isImageLoaded(img) {
    if (!img) return false;
    // Check if image is complete and has dimensions
    if (img.complete && (img.naturalWidth > 0 || img.naturalHeight > 0)) {
        return true;
    }
    // Also check data-loaded attribute (set by bindImageLoadEvents)
    if (img.dataset.loaded === "true") {
        return true;
    }
    return false;
}

/**
 * Wait for image to load with timeout
 */
function waitForImageLoad(img, timeout = 10000) {
    return new Promise((resolve) => {
        // If already loaded, resolve immediately
        if (isImageLoaded(img)) {
            resolve(true);
            return;
        }

        // Set timeout
        const timeoutId = setTimeout(() => {
            resolve(false); // Timeout - image not loaded yet
        }, timeout);

        // Listen for load event
        const loadHandler = () => {
            clearTimeout(timeoutId);
            resolve(true);
        };

        // Listen for error event (also resolve, but image failed)
        const errorHandler = () => {
            clearTimeout(timeoutId);
            resolve(false);
        };

        img.addEventListener("load", loadHandler, {once: true});
        img.addEventListener("error", errorHandler, {once: true});
    });
}

function ensureThumbnailLoadObserver() {
    if (thumbnailLoadObserver || typeof window === "undefined") {
        return thumbnailLoadObserver;
    }

    if (typeof IntersectionObserver !== "function") {
        return null;
    }

    thumbnailLoadObserver = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) {
                    return;
                }

                hydrateThumbnailImage(entry.target);
                thumbnailLoadObserver.unobserve(entry.target);
            });
        },
        {
            root: null,
            rootMargin: THUMBNAIL_LOAD_AHEAD_MARGIN,
            threshold: 0.01,
        }
    );

    return thumbnailLoadObserver;
}

function bindThumbnailLoad(img) {
    if (!img || img.dataset.thumbnailQueued === "true") {
        return;
    }

    const observer = ensureThumbnailLoadObserver();
    img.dataset.thumbnailQueued = "true";

    if (!observer) {
        hydrateThumbnailImage(img);
        return;
    }

    observer.observe(img);
}

function hydrateThumbnailImage(img) {
    if (!img || img.dataset.thumbLoaded === "true") {
        return;
    }

    const src = img.dataset.src;
    if (!src) {
        return;
    }

    img.dataset.thumbLoaded = "true";
    img.removeAttribute("data-src");
    img.src = src;
    bindImageLoadEvents(img);
}

function queueThumbnailLoads(root = document) {
    const scope =
        root && typeof root.querySelectorAll === "function" ? root : document;

    if (root && root.tagName === "IMG") {
        bindThumbnailLoad(root);
        return;
    }

    scope.querySelectorAll("img[data-src]").forEach((img) => {
        bindThumbnailLoad(img);
    });
}

/**
 * Open Fancybox directly (fallback method)
 */
async function openFancyboxDirectly(photoIndex, galleryItems) {
    if (galleryItems.length === 0) {
        return;
    }

    const FancyboxApi = await ensureFancyboxAssets();

    // Check if Fancybox is already open
    const existingInstance = FancyboxApi.getInstance();
    if (existingInstance) {
        // If already open, just jump to the photo
        try {
            existingInstance.carousel.jumpTo(photoIndex);
            // Successfully jumped, return early
            return;
        } catch (e) {
            console.error("Failed to jump to photo in existing instance:", e);
            // Fallback: close and reopen
            existingInstance.destroy();
            // Continue to show new instance below
        }
    }

    try {
        FancyboxApi.show(galleryItems, {
            startIndex: photoIndex,
            groupAll: true,
            autoFocus: false,
            trapFocus: false,
            placeFocusBack: false,
            Hash: false, // Disable built-in hash module to prevent conflict with custom URL handling
            Image: {
                crossOrigin: "anonymous",
            },
            Toolbar: {
                display: {
                    left: ["infobar"],
                    middle: [],
                    right: [
                        "info",
                        "share",
                        "zoom",
                        "slideshow",
                        "fullscreen",
                        "thumbs",
                        "close",
                    ],
                },
                items: {
                    info: {
                        tpl: `<button class="f-button" type="button" title="显示/隐藏照片信息" data-fancybox-info>
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <circle cx="12" cy="12" r="10"></circle>
                      <line x1="12" y1="16" x2="12" y2="12"></line>
                      <line x1="12" y1="8" x2="12.01" y2="8"></line>
                    </svg>
                  </button>`,
                        click: (event) => {
                            const instance = Fancybox.getInstance();
                            if (instance && instance.container) {
                                instance.container.classList.toggle("has-metadata-panel");
                            }
                            if (event && event.stopPropagation) event.stopPropagation();
                        },
                    },
                    share: {
                        tpl: `<button class="f-button" type="button" title="分享" data-fancybox-share>
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <circle cx="18" cy="5" r="3"></circle>
                      <circle cx="6" cy="12" r="3"></circle>
                      <circle cx="18" cy="19" r="3"></circle>
                      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
                    </svg>
                  </button>`,
                        click: (event) => {
                            handleShareClick(event, galleryItems);
                        },
                    },
                },
            },
            on: {
                "Carousel.change": (fancybox, carousel, toIndex, fromIndex) => {
                    const item = galleryItems[toIndex];
                    if (!item) return;

                    const exif = item.exif;
                    const filename = item.filename;

                    // Only update URL if:
                    // 1. Not initializing from URL parameter (isInitializingFromUrl flag)
                    // 2. This is a real navigation (fromIndex is a valid number >= 0)
                    // This prevents URL from being updated during initialization when fromIndex might be undefined
                    if (
                        !isInitializingFromUrl &&
                        typeof fromIndex === "number" &&
                        fromIndex >= 0
                    ) {
                        updateUrlQuery(toIndex);
                    }

                    const container = fancybox.container;
                    if (!container) return;

                    try {
                        const existingPanel = container.querySelector(
                            ".fancybox__metadata"
                        );
                        if (existingPanel) existingPanel.remove();

                        if (exif) {
                            const metadataPanel = createMetadataPanel(exif, filename, item.Subject, item.caption);
                            container.appendChild(metadataPanel);
                        }
                    } catch (e) {
                        console.error("Failed to update metadata panel:", e);
                    }
                },
                reveal: (fancybox, slide) => { 
                  // When initializing from URL, clear the flag when the correct slide is revealed
                    if (isInitializingFromUrl && slide.index === photoIndex) {
                        // Small delay to ensure everything is ready
                        setTimeout(() => {
                            updateUrlQuery(photoIndex);
                            isInitializingFromUrl = false;
                        }, 100);
                    }
                    // Keep reveal for the initial open, as change might have fired before DOM was ready?
                    // Or just to be safe.

                    const current = fancybox.getSlide();

                    // 只处理当前正在显示的 slide
                    if (slide.index !== current.index) return;

                    

                    console.log("openFancyboxDirectly reveal: 当前显示:", slide.filename);
                    const exif = slide.exif;
                    const filename = slide.filename;
                    if (!exif) return;

                    const index = slide.index;
                    const total = fancybox.carousel.slides.length;
                    console.log("openFancyboxDirectly reveal: 当前索引:", index);
                    console.log("openFancyboxDirectly reveal: 显示:", `${index + 1} / ${total}`);

                    try {
                        const existingPanel = fancybox.container.querySelector(
                            ".fancybox__metadata"
                        );
                        if (existingPanel) {
                            console.log("existingPanel.remove()");
                            existingPanel.remove();
                        }

                        if (exif) {
                            const metadataPanel = createMetadataPanel(
                                exif,
                                filename,
                                slide.Subject,
                                slide.caption
                            );
                            fancybox.container.appendChild(metadataPanel);
                        }
                    } catch (e) {
                        console.error("Failed to update metadata panel:", e);
                    }
                },
            },
        });
    } catch (e) {
        console.error("Failed to open Fancybox directly:", e);
    }
}

/**
 * Normalize URL by ensuring trailing slash to match server's 308 redirect behavior
 * Server redirects /web/photography?photo=X to /web/photography/?photo=X (308)
 */
function normalizeUrl() {
    // Only normalize if there are query parameters
    if (window.location.search) {
        let pathname = window.location.pathname;
        // Ensure pathname ends with / to match server's 308 redirect behavior
        if (!pathname.endsWith("/")) {
            pathname = pathname + "/";
            const newUrl =
                window.location.origin +
                pathname +
                window.location.search +
                (window.location.hash || "");
            // Use replaceState to avoid creating new history entry
            if (window.history && window.history.replaceState) {
                window.history.replaceState(null, null, newUrl);
            }
        }
    }
}

/**
 * Parse URL query parameter and open corresponding photo
 * Supports both formats:
 * - /web/photography/?photo=X&share (share link with share parameter)
 * - /web/photography/?photo=X (normal navigation)
 */
function parseAndOpenPhotoFromUrl(galleryItems) {
    // Normalize URL first (ensure trailing slash to match server's 308 redirect behavior)
    normalizeUrl();

    // Wait for DOM to be ready
    requestAnimationFrame(() => {
        setTimeout(async () => {
            // Check if this is a share link by checking query parameter
            const urlParams = new URLSearchParams(window.location.search);
            const isShareLink = urlParams.has("share");

            // Parse query parameter: ?photo=123
            // Use multiple methods to ensure we get the correct parameter even after redirects
            const photoIndex = getRequestedPhotoIndexFromUrl();

            if (photoIndex === null) {
                // No photo parameter found, exit silently (normal page load)
                return;
            }

            // Check if galleryItems is ready and has enough items
            if (!galleryItems || galleryItems.length === 0) {
                console.warn("Gallery items not ready yet, will retry...");
                if (activeGalleryMode === "sharded") {
                    void scheduleYearLoad({
                        token: galleryLoadToken,
                        minYears: 0,
                        targetPhotoIndex: photoIndex,
                    });
                }
                // Retry after a short delay
                setTimeout(() => parseAndOpenPhotoFromUrl(galleryItems), 500);
                return;
            }

            if (photoIndex >= galleryItems.length) {
                console.warn(
                    "Photo index out of range for current load, will retry:",
                    photoIndex,
                    "max:",
                    galleryItems.length - 1
                );
                if (activeGalleryMode === "sharded") {
                    void scheduleYearLoad({
                        token: galleryLoadToken,
                        minYears: 0,
                        targetPhotoIndex: photoIndex,
                    });
                }
                setTimeout(() => parseAndOpenPhotoFromUrl(galleryItems), 500);
                return;
            }

            // Check if Fancybox is already open
            await ensureFancyboxAssets();
            const existingInstance = Fancybox.getInstance();
            if (existingInstance) {
                // If already open, just navigate to the photo
                try {
                    isInitializingFromUrl = true;
                    existingInstance.carousel.jumpTo(photoIndex);
                    // Update URL to reflect current photo after a short delay
                    setTimeout(() => {
                        updateUrlQuery(photoIndex);
                        isInitializingFromUrl = false;
                    }, 100);
                } catch (e) {
                    console.error("Failed to jump to photo:", e);
                    isInitializingFromUrl = false;
                }
                return;
            }

            // Set flag to prevent URL updates during initial load
            isInitializingFromUrl = true;

            // Direct open without waiting for image load
            // Fancybox handles loading state internally
            // The isInitializingFromUrl flag will be cleared by the reveal event in openFancyboxDirectly
            try {
                await openFancyboxDirectly(photoIndex, galleryItems);

                // Fallback: clear flag after a longer delay in case reveal event doesn't fire
                setTimeout(() => {
                    if (isInitializingFromUrl) {
                        updateUrlQuery(photoIndex);
                        isInitializingFromUrl = false;
                    }
                }, 1000);
            } catch (e) {
                console.error("Failed to open Fancybox:", e);
                isInitializingFromUrl = false;
            }
        }, 100);
    });
}

/**
 * Update URL query parameter with current photo index
 */
function updateUrlQuery(photoIndex) {
    // Keep trailing slash to match server behavior (308 redirect adds slash)
    let pathname = window.location.pathname;
    // Ensure pathname ends with / to match server's 308 redirect behavior
    if (!pathname.endsWith("/")) {
        pathname = pathname + "/";
    }
    const baseUrl = window.location.origin + pathname;
    // Check if current URL has 'share' parameter, preserve it if exists
    const urlParams = new URLSearchParams(window.location.search);
    const hasShare = urlParams.has("share");
    const newUrl = hasShare
        ? `${baseUrl}?photo=${photoIndex}&share`
        : `${baseUrl}?photo=${photoIndex}`;

    // Use replaceState to avoid creating new history entry
    if (window.history && window.history.replaceState) {
        window.history.replaceState(null, null, newUrl);
    } else {
        // Fallback for older browsers
        window.location.href = newUrl;
    }
}

async function loadGallery() {
    const timelineContainer = document.getElementById("timeline-sidebar");
    const galleryContainer = document.getElementById("gallery-content");

    if (!timelineContainer || !galleryContainer) {
        console.error("Containers not found");
        return;
    }

    try {
        destroyTimelineToc();
        disconnectGalleryLoadMoreObserver();
        activeGalleryMode = getGalleryDataMode();
        galleryItems = [];
        galleryPhotoRecords = [];
        galleryManifest = null;
        const manifest = await fetchGalleryManifest();
        if (manifest && manifest.years && manifest.years.length > 0) {
            await loadShardedGallery(
                manifest,
                timelineContainer,
                galleryContainer
            );
            return;
        }

        if (activeGalleryMode !== "local") {
            throw new Error("Remote gallery manifest is unavailable");
        }

        // Legacy fallback: single large photos.json
        const response = await fetch(
            new URL("photos.json", window.location.origin + getLocalGalleryBase()).toString()
        );
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const albumsData = await response.json();

        // Filter out hidden photos
        const albums = albumsData.map((album) => {
            if (album.photos) {
                return {
                    ...album,
                    photos: album.photos.filter((photo) => !photo.is_hidden),
                };
            }
            return album;
        });

        // Global gallery state
        // Clear containers before re-rendering (important for orientation changes)
        timelineContainer.innerHTML = "";
        galleryContainer.innerHTML = "";

        // Render Gallery (Right Content)
        renderGallery(galleryContainer, albums, galleryItems);

        bindGalleryItemClicks(galleryContainer, galleryItems);

        // Bind Image Load Events
        bindImageLoadEvents();
        initTimelineToc();

        // Set current column count after successful load
        // This prevents unnecessary reloads on initial page load
        if (typeof currentColumnCount !== "undefined") {
            currentColumnCount = getColumnCount();
        }

        // Parse URL hash parameter and open corresponding photo
        parseAndOpenPhotoFromUrl(galleryItems);
    } catch (error) {
        console.error("Error loading gallery:", error);
        galleryContainer.innerHTML =
            '<p class="text-center text-red-500">Failed to load photos.</p>';
    }
}

async function fetchGalleryManifest() {
    try {
        const response = await fetch(
            resolveGalleryManifestUrl(),
            getGalleryFetchOptions()
        );
        if (!response.ok) {
            return null;
        }

        const manifest = await response.json();
        if (!manifest || !Array.isArray(manifest.years)) {
            return null;
        }
        return manifest;
    } catch (error) {
        console.warn("Failed to load manifest:", error);
        return null;
    }
}

async function loadShardedGallery(manifest, timelineContainer, galleryContainer) {
    const token = ++galleryLoadToken;
    activeGalleryMode = "sharded";
    galleryManifest = manifest;
    galleryItems = [];
    galleryPhotoRecords = [];
    galleryLoadedYears = new Set();
    galleryPendingYearEntries = Array.isArray(manifest.years)
        ? [...manifest.years]
        : [];
    galleryNextYearCursor = 0;
    galleryYearLoadPromise = Promise.resolve();

    destroyTimelineToc();
    disconnectGalleryLoadMoreObserver();
    timelineContainer.innerHTML = "";
    galleryContainer.innerHTML = "";

    galleryWaterfall = createWaterfallState(galleryContainer);
    buildTimelineOutline(galleryWaterfall, manifest.years);
    currentColumnCount = galleryWaterfall.columnCount;
    ensureGalleryLoadMoreSentinel(galleryContainer);
    bindGalleryItemClicks(galleryContainer, galleryItems);
    bindImageLoadEvents();
    initTimelineToc();

    setupGalleryLoadMoreObserver(token);
    await scheduleYearLoad({
        token,
        minYears: calculateInitialYearBatch(manifest.years),
        targetPhotoIndex: getRequestedPhotoIndexFromUrl(),
    });
    parseAndOpenPhotoFromUrl(galleryItems);
}

function createWaterfallState(container) {
    const columnCount = getColumnCount();
    const shell = document.createElement("div");
    shell.className = "gallery-waterfall-shell relative";
    const outlineLayer = document.createElement("div");
    outlineLayer.className = "gallery-outline-layer";
    outlineLayer.setAttribute("aria-hidden", "true");
    const waterfallContainer = document.createElement("div");
    waterfallContainer.className = "waterfall-container";

    const columns = [];
    const heights = new Array(columnCount).fill(0);
    for (let i = 0; i < columnCount; i++) {
        const column = document.createElement("div");
        column.className = "waterfall-column";
        waterfallContainer.appendChild(column);
        columns.push(column);
    }

    shell.appendChild(outlineLayer);
    shell.appendChild(waterfallContainer);
    container.appendChild(shell);
    return {
        columnCount,
        shell,
        outlineLayer,
        headingMap: new Map(),
        container: waterfallContainer,
        columns,
        heights,
    };
}

function getAlbumMonthEntries(album) {
    if (Array.isArray(album.months) && album.months.length > 0) {
        return album.months
            .map((month) =>
                typeof month === "string"
                    ? {month, count: 0}
                    : {month: month.month, count: Number(month.count) || 0}
            )
            .filter((month) => month.month)
            .sort((a, b) => b.month.localeCompare(a.month));
    }

    return Object.entries(groupPhotosByMonth(album.photos || []))
        .map(([month, photos]) => ({month, count: photos.length}))
        .sort((a, b) => b.month.localeCompare(a.month));
}

function getAlbumMonths(album) {
    return getAlbumMonthEntries(album).map((entry) => entry.month);
}

function formatTimelineMonth(month) {
    return new Date(2000, parseInt(month, 10) - 1, 1).toLocaleString("default", {
        month: "short",
    });
}

function buildTimelineOutline(state, albums) {
    if (!state || !state.outlineLayer) {
        return;
    }

    state.outlineLayer.innerHTML = "";
    state.headingMap.clear();

    let placeholderTop = 0;
    albums.forEach((album) => {
        const monthEntries = getAlbumMonthEntries(album);
        const estimatedYearHeight = estimateYearHeight(album, state.columnCount);
        upsertOutlineHeading(state, {
            id: `year-${album.year}`,
            level: 2,
            label: String(album.year),
            top: placeholderTop,
        });

        let monthOffset = 48;
        monthEntries.forEach((entry) => {
            const estimatedMonthHeight = estimateMonthHeight(entry, state.columnCount);
            upsertOutlineHeading(state, {
                id: `section-${album.year}-${entry.month}`,
                level: 3,
                label: formatTimelineMonth(entry.month),
                top: placeholderTop + monthOffset,
            });
            monthOffset += estimatedMonthHeight;
        });

        placeholderTop += estimatedYearHeight;
    });
}

function estimateMonthHeight(monthEntry, columnCount) {
    const photoCount = Math.max(1, Number(monthEntry?.count) || 1);
    const estimatedRows = Math.max(1, Math.ceil(photoCount / Math.max(columnCount, 1)));
    return estimatedRows * 220;
}

function estimateYearHeight(album, columnCount) {
    const monthEntries = getAlbumMonthEntries(album);
    if (monthEntries.length === 0) {
        return 240;
    }

    const monthHeights = monthEntries.reduce(
        (sum, monthEntry) => sum + estimateMonthHeight(monthEntry, columnCount),
        0
    );
    return Math.max(320, monthHeights + 80);
}

function upsertOutlineHeading(state, {id, level, label, top}) {
    if (!state || !state.outlineLayer || !id || !level || !label) {
        return;
    }

    let heading = state.headingMap.get(id);
    if (!heading) {
        heading = document.createElement(`h${level}`);
        heading.id = id;
        heading.className = `gallery-outline-heading gallery-outline-heading-${level}`;
        heading.textContent = label;
        state.headingMap.set(id, heading);
        state.outlineLayer.appendChild(heading);
    }

    if (typeof top === "number") {
        heading.style.top = `${top}px`;
    }
}

function updateOutlineHeadingPositions(state, sectionHeadings, card) {
    if (!state || !Array.isArray(sectionHeadings) || sectionHeadings.length === 0 || !card) {
        return;
    }

    requestAnimationFrame(() => {
        const cardTop = card.offsetTop;
        sectionHeadings.forEach((heading) => {
            upsertOutlineHeading(state, {...heading, top: cardTop});
        });
        syncTimelineAriaCurrent();
    });
}

function sortPhotosForRender(photos) {
    return photos.sort((a, b) => {
        if (a.date !== b.date) {
            return String(b.date || "").localeCompare(String(a.date || ""));
        }
        if ((a.timestamp || 0) !== (b.timestamp || 0)) {
            return (b.timestamp || 0) - (a.timestamp || 0);
        }
        return String(b.filename || "").localeCompare(String(a.filename || ""));
    });
}

function preparePhotosForRender(year, photos) {
    const sortedPhotos = sortPhotosForRender([...photos]);
    const photosByMonth = groupPhotosByMonth(sortedPhotos);
    const months = Object.keys(photosByMonth).sort((a, b) => b.localeCompare(a));
    let isFirstYearPhoto = true;
    const orderedPhotos = [];

    months.forEach((month) => {
        const monthPhotos = photosByMonth[month];
        if (!monthPhotos || monthPhotos.length === 0) {
            return;
        }

        if (!Array.isArray(monthPhotos[0].sectionHeadings)) {
            monthPhotos[0].sectionHeadings = [];
        }

        if (isFirstYearPhoto) {
            monthPhotos[0].sectionHeadings.push({
                id: `year-${year}`,
                level: 2,
                label: String(year),
            });
            isFirstYearPhoto = false;
        }

        monthPhotos[0].sectionHeadings.push({
            id: `section-${year}-${month}`,
            level: 3,
            label: formatTimelineMonth(month),
        });

        orderedPhotos.push(...monthPhotos);
    });

    return orderedPhotos;
}

function calculateInitialYearBatch(yearEntries) {
    if (!Array.isArray(yearEntries) || yearEntries.length === 0) {
        return 0;
    }

    let yearCount = 0;
    let photoCount = 0;
    for (const entry of yearEntries) {
        yearCount += 1;
        photoCount += Number(entry && entry.count) || 0;
        if (yearCount >= INITIAL_YEAR_BATCH || photoCount >= INITIAL_PHOTO_TARGET) {
            break;
        }
    }

    return yearCount;
}

function scheduleYearLoad({
    token,
    minYears = 1,
    targetPhotoIndex = null,
    targetYear = "",
} = {}) {
    const job = () =>
        loadMoreYears({
            token,
            minYears,
            targetPhotoIndex,
            targetYear,
        });
    galleryYearLoadPromise = galleryYearLoadPromise.then(job, job);
    return galleryYearLoadPromise;
}

async function loadMoreYears({
    token,
    minYears = 1,
    targetPhotoIndex = null,
    targetYear = "",
} = {}) {
    if (token !== galleryLoadToken) {
        return;
    }

    let loadedYears = 0;
    while (galleryNextYearCursor < galleryPendingYearEntries.length) {
        const enoughYearsLoaded = loadedYears >= minYears;
        const targetPhotoSatisfied =
            targetPhotoIndex === null || galleryItems.length > targetPhotoIndex;
        const targetYearSatisfied =
            !targetYear || galleryLoadedYears.has(targetYear);

        if (enoughYearsLoaded && targetPhotoSatisfied && targetYearSatisfied) {
            break;
        }

        const entry = galleryPendingYearEntries[galleryNextYearCursor++];
        await loadYearShard(entry, token);
        loadedYears += 1;
        await new Promise((resolve) => requestAnimationFrame(resolve));
    }

    updateGalleryLoadMoreSentinel();
}

function ensureGalleryLoadMoreSentinel(container) {
    if (!container) {
        return;
    }

    galleryLoadMoreSentinel = document.createElement("div");
    galleryLoadMoreSentinel.id = "gallery-load-more-sentinel";
    galleryLoadMoreSentinel.setAttribute("aria-hidden", "true");
    galleryLoadMoreSentinel.style.width = "100%";
    galleryLoadMoreSentinel.style.height = "1px";
    galleryLoadMoreSentinel.style.pointerEvents = "none";
    container.appendChild(galleryLoadMoreSentinel);
}

function disconnectGalleryLoadMoreObserver() {
    if (galleryLoadMoreObserver) {
        galleryLoadMoreObserver.disconnect();
        galleryLoadMoreObserver = null;
    }
    galleryLoadMoreSentinel = null;
}

function setupGalleryLoadMoreObserver(token) {
    if (!galleryLoadMoreSentinel) {
        return;
    }

    galleryLoadMoreObserver = new IntersectionObserver(
        (entries) => {
            if (!entries.some((entry) => entry.isIntersecting)) {
                return;
            }
            void scheduleYearLoad({token, minYears: 1});
        },
        {
            root: null,
            rootMargin: YEAR_LOAD_AHEAD_MARGIN,
            threshold: 0,
        }
    );
    galleryLoadMoreObserver.observe(galleryLoadMoreSentinel);
    updateGalleryLoadMoreSentinel();
}

function updateGalleryLoadMoreSentinel() {
    if (!galleryLoadMoreSentinel) {
        return;
    }

    const hasMoreYears = galleryNextYearCursor < galleryPendingYearEntries.length;
    galleryLoadMoreSentinel.style.display = hasMoreYears ? "block" : "none";
}

async function loadYearShard(entry, token) {
    if (!entry || !entry.year || galleryLoadedYears.has(entry.year)) {
        return;
    }

    const shardUrl = resolveGalleryShardUrl(entry.year);
    try {
        const response = await fetch(shardUrl, getGalleryFetchOptions());
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const album = await response.json();
        if (token !== galleryLoadToken) {
            return;
        }

        const visiblePhotos = (album.photos || []).filter((photo) => !photo.is_hidden);
        if (visiblePhotos.length === 0) {
            if (galleryWaterfall && galleryWaterfall.outlineLayer) {
                const currentBottom = galleryWaterfall.container.offsetHeight;
                upsertOutlineHeading(galleryWaterfall, {
                    id: `year-${entry.year}`,
                    level: 2,
                    label: String(entry.year),
                    top: currentBottom,
                });
            }
            galleryLoadedYears.add(entry.year);
            return;
        }

        const preparedPhotos = preparePhotosForRender(entry.year, visiblePhotos);
        appendLoadedPhotos(preparedPhotos);
        galleryLoadedYears.add(entry.year);
        bindImageLoadEvents();
        parseAndOpenPhotoFromUrl(galleryItems);
    } catch (error) {
        console.warn(`Failed to load shard ${entry.year}:`, error);
    }
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

        const columnCount = galleryWaterfall.columnCount;
        let minIndex = 0;
        for (let i = 1; i < columnCount; i++) {
            if (galleryWaterfall.heights[i] < galleryWaterfall.heights[minIndex]) {
                minIndex = i;
            }
        }

        const card = createPhotoCard(photo);
        galleryWaterfall.columns[minIndex].appendChild(card);
        updateOutlineHeadingPositions(galleryWaterfall, photo.sectionHeadings, card);
        queueThumbnailLoads(card);
        bindImageLoadEvents(card);

        const aspectRatio =
            photo.width && photo.height ? photo.width / photo.height : 1.5;
        const relativeHeight = 1000 / aspectRatio;
        galleryWaterfall.heights[minIndex] += relativeHeight + 8;
    });

    requestAnimationFrame(() => {
        refreshTimelineToc();
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
        void openFancyboxDirectly(index, items);
    });
}
/**
 * Smooth scroll to a section with offset for sticky header
 */
async function scrollToSection(sectionId) {
    const targetYear = extractYearFromSectionId(sectionId);
    if (
        activeGalleryMode === "sharded" &&
        targetYear &&
        !galleryLoadedYears.has(targetYear)
    ) {
        await scheduleYearLoad({
            token: galleryLoadToken,
            minYears: 0,
            targetYear,
        });
    }

    const element = document.getElementById(sectionId);
    if (element) {
        performScrollToSectionElement(sectionId, element);
        return;
    }

    console.error("Section not found:", sectionId);
}

function performScrollToSectionElement(sectionId, element) {
    const headerOffset = TIMELINE_SCROLL_OFFSET;
    const elementPosition = element.getBoundingClientRect().top;
    const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

    console.log("Scrolling to section:", sectionId, "offset:", offsetPosition);
    window.scrollTo({
        top: offsetPosition,
        behavior: "smooth",
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
    const allPhotos = [];
    galleryWaterfall = createWaterfallState(container);
    buildTimelineOutline(galleryWaterfall, albums);

    albums.forEach((album) => {
        const photosByMonth = groupPhotosByMonth(album.photos);
        const months = Object.keys(photosByMonth).sort((a, b) =>
            b.localeCompare(a)
        );

        let isFirstYearPhoto = true;

        months.forEach((month) => {
            const monthPhotos = photosByMonth[month];

            if (monthPhotos.length > 0) {
                if (!Array.isArray(monthPhotos[0].sectionHeadings)) {
                    monthPhotos[0].sectionHeadings = [];
                }

                if (isFirstYearPhoto) {
                    monthPhotos[0].sectionHeadings.push({
                        id: `year-${album.year}`,
                        level: 2,
                        label: String(album.year),
                    });
                    isFirstYearPhoto = false;
                }

                monthPhotos[0].sectionHeadings.push({
                    id: `section-${album.year}-${month}`,
                    level: 3,
                    label: formatTimelineMonth(month),
                });

                // Add all photos to the flat list
                allPhotos.push(...monthPhotos);
            }
        });
    });

    galleryPhotoRecords = allPhotos;
    // Render the single unified waterfall
    renderWaterfallLayout(galleryWaterfall, allPhotos, galleryItems);
}

function groupPhotosByMonth(photos) {
    const groups = {};
    photos.forEach((photo) => {
        const month = photo.month || "01";
        if (!groups[month]) {
            groups[month] = [];
        }
        groups[month].push(photo);
    });
    return groups;
}

// ... createPhotoCard is fine as is, but we need to update renderWaterfallLayout ...

// --- Waterfall Layout Implementation ---

// ... getColumnCount, calculatePhotoHeight, createWaterfallLayout are fine ...

/**
 * Render waterfall layout to container
 */
function renderWaterfallLayout(state, photos, galleryItems) {
    galleryItems.length = 0;

    // Populate galleryItems and assign global indices BEFORE creating layout
    photos.forEach((photo) => {
        // Assign global index
        photo.waterfallIndex = galleryItems.length;

        // Add to global items list for Fancybox
        galleryItems.push({
            src: photo.path,
            thumb: photo.thumbnail,
            caption: photo.alt || "",
            exif: photo.exif, // Store full EXIF object
            filename: photo.filename || "",
            Subject: photo.Subject || [], // Store root Subject
        });
    });

    const columns = createWaterfallLayout(photos, state.columnCount);

    // Create columns
    columns.forEach((columnPhotos, colIndex) => {
        const columnDiv = state.columns[colIndex];

        columnPhotos.forEach((photo) => {
            const photoCard = createPhotoCard(photo);
            columnDiv.appendChild(photoCard);
            updateOutlineHeadingPositions(state, photo.sectionHeadings, photoCard);
        });
    });

    queueThumbnailLoads(state.container);
    requestAnimationFrame(() => {
        refreshTimelineToc();
    });
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

    galleryContainer.innerHTML = "";
    galleryWaterfall = createWaterfallState(galleryContainer);

    if (activeGalleryMode === "sharded" && galleryManifest && Array.isArray(galleryManifest.years)) {
        buildTimelineOutline(galleryWaterfall, galleryManifest.years);
    } else {
        buildTimelineOutline(
            galleryWaterfall,
            buildOutlineAlbumsFromLoadedPhotos(galleryPhotoRecords)
        );
    }

    renderWaterfallLayout(galleryWaterfall, galleryPhotoRecords, galleryItems);
    bindGalleryItemClicks(galleryContainer, galleryItems);
    bindImageLoadEvents(galleryContainer);
    if (isTimelineEnabled()) {
        initTimelineToc();
    } else {
        destroyTimelineToc();
    }

    return true;
}

function createPhotoCard(photo) {
    const wrapper = document.createElement("div");
    wrapper.className = "photo-card relative";
    wrapper.dataset.index = photo.waterfallIndex;

    // Calculate aspect ratio for placeholder
    // Default to 3:2 (1.5) if missing
    const width = photo.width || 300;
    const height = photo.height || 200;
    const aspectRatio = `${width} / ${height}`;

    wrapper.style.aspectRatio = aspectRatio;

    const exifData = photo.exif ? JSON.stringify(photo.exif) : "";
    const filename = photo.filename || "";
    const shouldEagerLoad = photo.waterfallIndex < EAGER_THUMBNAIL_COUNT;
    const thumbnailAttributes = shouldEagerLoad
        ? `src="${photo.thumbnail}" data-thumb-loaded="true" loading="eager" fetchpriority="high"`
        : `data-src="${photo.thumbnail}" loading="lazy" fetchpriority="low"`;

    wrapper.innerHTML = `
    <div class="overflow-hidden w-full h-full relative img-skeleton-bg rounded-lg safari-rounded-fix">
      <div class="img-skeleton absolute inset-0 z-10">
        <span class="dot"></span>
        <span class="dot"></span>
        <span class="dot"></span>
      </div>
      <a href="javascript:;" 
         data-src="${photo.path}"
         data-index="${photo.waterfallIndex}"
         data-exif='${exifData.replace(/'/g, "&apos;")}'
         data-filename="${filename}"
         class="block w-full h-full gallery-item">
        <img
          alt="${photo.alt || ""}"
          width="${width}"
          height="${height}"
          class="block w-full h-full object-cover object-center opacity-0 animate-fade-in transition duration-300 img-hover-zoom img-loading rounded-lg"
          decoding="async"
          ${thumbnailAttributes}
        />
      </a>
    </div>
  `;

    return wrapper;
}

function bindImageLoadEvents(root = document) {
    const images =
        root && root.tagName === "IMG"
            ? [root]
            : Array.from(
                  (root && typeof root.querySelectorAll === "function"
                      ? root
                      : document
                  ).querySelectorAll("img.img-loading")
              );

    images.forEach((img) => {
        if (img.dataset.loaded === "true" || img.dataset.loadBound === "true") {
            return;
        }
        if (!img.currentSrc && !img.getAttribute("src")) {
            return;
        }

        const hideSkeleton = () => {
            if (img.dataset.loaded === "true") {
                return;
            }

            img.dataset.loaded = "true";
            img.dataset.loadBound = "true";

            const parent = img.closest(".img-skeleton-bg");
            const skeleton = parent ? parent.querySelector(".img-skeleton") : null;

            img.classList.remove("img-loading");
            img.classList.remove("opacity-0");
            img.style.opacity = "1";
            img.style.visibility = "visible";

            if (skeleton) {
                skeleton.remove();
            }
        };

        if (img.complete && (img.naturalWidth > 0 || img.naturalHeight > 0)) {
            hideSkeleton();
            return;
        }

        img.dataset.loadBound = "true";
        img.addEventListener("load", hideSkeleton, {once: true});
        img.addEventListener("error", hideSkeleton, {once: true});
    });
}

/**
 * Create metadata panel HTML from EXIF data
 */
function createMetadataPanel(exif, filename, rootSubject, alt) {
    console.log("Creating metadata panel for:", filename, exif);
    const panel = document.createElement("div");
    panel.className = "fancybox__metadata";

    // Extract key EXIF values
    const rating = exif.Rating || 0;
    const tags = extractTags(exif, rootSubject);
    const shootingParams = extractShootingParams(exif);
    const deviceInfo = extractDeviceInfo(exif);
    const shootingMode = extractShootingMode(exif);
    const gpsLocation = extractGPSLocation(exif);

    panel.innerHTML = `
    <!-- Header -->
    <div class="metadata-header">
      <div class="metadata-filename">${filename
        .replace(".jpg", "")
        .replace(".JPG", "")
        .replace("_ps", "")
        .replace("_nx", "")
        .replace("_edit", "")}</div>
      
      ${
        rating > 0
            ? `
      <div class="metadata-rating">
        <span class="metadata-rating-label">评分</span>
        <span class="metadata-stars">
          ${renderStarRating(rating)}
        </span>
      </div>
      `
            : ""
    }
      
      ${
        tags.length > 0
            ? `
      <div class="metadata-tags">
        <span class="metadata-tags-label">标签</span>
        <span class="metadata-tags-content">
          ${tags
                .map((tag) => `<span class="metadata-tag">${tag}</span>`)
                .join("")}
        </span>
      </div>
      `
            : ""
    }

      ${
        alt
            ? `
      <div class="metadata-alt">
        <span class="metadata-alt-label">作者注释</span>
        <div class="metadata-alt-content">${alt}</div>
      </div>
      `
            : ""
    }
    </div>

     <!-- GPS Location -->
    ${
        gpsLocation.length > 0
            ? `
    <div class="metadata-section">
      <div class="metadata-section-title">
        位置信息
      </div>
      ${gpsLocation
                .map(
                    (loc) => `
        <div class="metadata-row">
          <span class="metadata-row-label">${loc.label}</span>
          <span class="metadata-row-value">${loc.value}</span>
        </div>
      `
                )
                .join("")}
    </div>
    `
            : ""
    }
    
    <!-- Shooting Parameters -->
    ${
        shootingParams.length > 0
            ? `
    <div class="metadata-section">
      <div class="metadata-section-title">
        拍摄参数
      </div>
      ${shootingParams
                .map(
                    (param) => `
        <div class="metadata-row">
          <span class="metadata-row-label">${param.label}</span>
          <span class="metadata-row-value">${param.value}</span>
        </div>
      `
                )
                .join("")}
    </div>
    `
            : ""
    }
    
    <!-- Device Info -->
    ${
        deviceInfo.length > 0
            ? `
    <div class="metadata-section">
      <div class="metadata-section-title">
        设备信息
      </div>
      ${deviceInfo
                .map(
                    (info) => `
        <div class="metadata-row">
          <span class="metadata-row-label">${info.label}</span>
          <span class="metadata-row-value">${info.value}</span>
        </div>
      `
                )
                .join("")}
    </div>
    `
            : ""
    }
    
    <!-- Shooting Mode -->
    ${
        shootingMode.length > 0
            ? `
    <div class="metadata-section">
      <div class="metadata-section-title">
        拍摄模式
      </div>
      ${shootingMode
                .map(
                    (mode) => `
        <div class="metadata-row">
          <span class="metadata-row-label">${mode.label}</span>
          <span class="metadata-row-value">${mode.value}</span>
        </div>
      `
                )
                .join("")}
    </div>
    `
            : ""
    }
  `;

    return panel;
}

/**
 * Render star rating HTML
 */
function renderStarRating(rating) {
    const maxStars = 5;
    let stars = "";
    for (let i = 1; i <= maxStars; i++) {
        if (i <= rating) {
            stars += '<span class="metadata-star">★</span>';
        } else {
            stars += '<span class="metadata-star empty">★</span>';
        }
    }
    return stars;
}

// --- Waterfall Layout Implementation ---

/**
 * Get column count based on media queries (more accurate than width checks)
 */
function getColumnCount() {
    // Use matchMedia to match the same breakpoints as Tailwind/CSS
    // This is more reliable than checking window.innerWidth
    if (window.matchMedia("(min-width: 1200px)").matches) {
        return 5; // Desktop
    }
    if (window.matchMedia("(min-width: 768px)").matches) {
        return 3; // Tablet
    }
    return 2; // Mobile
}

/**
 * Calculate photo height based on column width (optional, for estimation)
 */
function calculatePhotoHeight(photo, columnWidth) {
    if (!photo.width || !photo.height) return 200; // Default fallback
    const aspectRatio = photo.width / photo.height;
    return columnWidth / aspectRatio;
}

/**
 * Create waterfall layout data structure
 * @param {Array} photos - Array of photo objects
 * @param {number} columnCount - Number of columns
 * @returns {Array} columns - Array of arrays, where each inner array contains photos for that column
 */
function createWaterfallLayout(photos, columnCount) {
    const columnHeights = new Array(columnCount).fill(0);
    const columns = Array.from({length: columnCount}, () => []);
    const gap = 8; // 0.5rem = 8px

    photos.forEach((photo) => {
        // Find the shortest column
        let minHeight = columnHeights[0];
        let minIndex = 0;

        for (let i = 1; i < columnCount; i++) {
            if (columnHeights[i] < minHeight) {
                minHeight = columnHeights[i];
                minIndex = i;
            }
        }

        // Add photo to the shortest column
        columns[minIndex].push(photo);

        // Update column height using aspect ratio
        // Since all photos in a column have the same width (flex: 1),
        // we use the inverse of aspect ratio as the relative height weight.
        // This ensures the estimated relative heights match actual CSS rendering.
        const aspectRatio =
            photo.width && photo.height ? photo.width / photo.height : 1.5;
        // Height relative to width: if width is W, height is W / aspectRatio
        // We use a normalized value (1000) for better precision
        const relativeHeight = 1000 / aspectRatio;
        columnHeights[minIndex] += relativeHeight + gap;
    });

    return columns;
}

/**
 * Scroll to timeline section
 */
function scrollToTimelineSection(year, month) {
    const sectionId = `section-${year}-${month}`;
    scrollToSection(sectionId);
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

function handleLayoutChange() {
    const newColumnCount = getColumnCount();

    // Skip if this is the first time (currentColumnCount not yet set)
    if (currentColumnCount === null) {
        currentColumnCount = newColumnCount;
        return;
    }

    if (newColumnCount !== currentColumnCount) {
        currentColumnCount = newColumnCount;
        if (!rerenderCurrentGalleryLayout()) {
            loadGallery();
        }
    }
}

// Use orientationchange for mobile devices (more reliable than resize)
// This only fires when device is actually rotated, not when scrolling
if ("onorientationchange" in window) {
    window.addEventListener(
        "orientationchange",
        debounce(handleLayoutChange, 300)
    );
} else {
    // Fallback to resize for desktop
    window.addEventListener("resize", debounce(handleLayoutChange, 300));
}

/**
 * Extract tags from EXIF data
 */
function extractTags(exif, rootSubject) {
    const tags = [];

    // Prioritize rootSubject (manual tags)
    if (rootSubject && Array.isArray(rootSubject) && rootSubject.length > 0) {
        return rootSubject.filter((tag) => tag && tag.trim());
    }

    // Fallback to EXIF tags
    if (exif.Keywords) {
        if (Array.isArray(exif.Keywords)) {
            tags.push(...exif.Keywords);
        } else {
            tags.push(exif.Keywords);
        }
    }

    if (exif.Subject && !tags.includes(exif.Subject)) {
        if (Array.isArray(exif.Subject)) {
            tags.push(...exif.Subject);
        } else {
            tags.push(exif.Subject);
        }
    }
        
    return tags.filter((tag) => tag && tag.trim());
}

/**
 * Extract shooting parameters from EXIF
 */
function extractShootingParams(exif) {
    const params = [];

    if (exif.FocalLength) {
        params.push({
            label: "焦距",
            value: exif.FocalLength,
        });
    }

    if (exif.FNumber || exif.Aperture) {
        const aperture = exif.FNumber || exif.Aperture;
        params.push({
            label: "光圈",
            value: `f/${aperture}`,
        });
    }

    if (exif.ExposureTime || exif.ShutterSpeed) {
        const shutter = exif.ExposureTime || exif.ShutterSpeed;
        params.push({
            label: "曝光时间",
            value: shutter,
        });
    }

    if (exif.ISO) {
        params.push({
            label: "ISO",
            value: exif.ISO,
        });
    }

    return params;
}

/**
 * Extract device information from EXIF
 */
function extractDeviceInfo(exif) {
    const info = [];

    if (exif.Make && exif.Model) {
        info.push({
            label: "相机",
            value: `${exif.Make} ${exif.Model}`,
        });
    } else if (exif.Model) {
        info.push({
            label: "相机",
            value: exif.Model,
        });
    }

    if (exif.LensModel || exif.Lens) {
        info.push({
            label: "镜头",
            value: exif.LensModel || exif.Lens,
        });
    }

    if (exif.FocalLengthIn35mmFormat) {
        info.push({
            label: "35mm等效",
            value: `${exif.FocalLengthIn35mmFormat} mm`,
        });
    }

    info.push({
        label: "版权信息",
        value: "© 2026 VINCENT CHYU PHOTOGRAPHY - ALL RIGHT RESERVED",
    });

    return info;
}

/**
 * Extract shooting mode information from EXIF
 */
function extractShootingMode(exif) {
    const modes = [];

    if (exif.WhiteBalance) {
        modes.push({
            label: "白平衡",
            value: exif.WhiteBalance,
        });
    }

    if (exif.ExposureProgram) {
        modes.push({
            label: "曝光程序",
            value: exif.ExposureProgram,
        });
    }

    if (exif.ExposureMode) {
        modes.push({
            label: "曝光模式",
            value: exif.ExposureMode,
        });
    }

    if (exif.MeteringMode) {
        modes.push({
            label: "测光模式",
            value: exif.MeteringMode,
        });
    }

    if (exif.Flash) {
        modes.push({
            label: "闪光灯",
            value: exif.Flash,
        });
    }

    if (exif.SceneCaptureType) {
        modes.push({
            label: "场景捕捉类型",
            value: exif.SceneCaptureType,
        });
    }

    return modes;
}

/**
 * Extract GPS location information from EXIF
 */
function extractGPSLocation(exif) {
    const location = [];

    // GPS Latitude and Longitude
    if (exif.GPSLatitude && exif.GPSLongitude) {
        const latRef = exif.GPSLatitudeRef || "N";
        const lonRef = exif.GPSLongitudeRef || "E";

        // Format coordinates
        const lat = formatGPSCoordinate(exif.GPSLatitude, latRef);
        const lon = formatGPSCoordinate(exif.GPSLongitude, lonRef);

        location.push({
            label: "经纬度",
            value: `${lat}, ${lon}`,
        });
    }

    // GPS Altitude
    if (exif.GPSAltitude) {
        // Parse altitude - it might be in format like "123.45 m" or just a number
        let altitude = exif.GPSAltitude;
        if (typeof altitude === "string") {
            // Extract numeric value if it's a string with units
            const match = altitude.match(/([\d.]+)/);
            if (match) {
                altitude = parseFloat(match[1]);
            }
        }

        location.push({
            label: "海拔",
            value: `${altitude} m`,
        });
    }

    return location;
}

/**
 * Format GPS coordinate from EXIF format to decimal degrees
 * @param {string} coord - GPS coordinate in EXIF format (e.g., "39 deg 54' 26.69\"")
 * @param {string} ref - Reference direction (N/S for latitude, E/W for longitude)
 * @returns {string} Formatted coordinate
 */
function formatGPSCoordinate(coord, ref) {
    // If already in decimal format, just add reference
    if (typeof coord === "number") {
        return `${coord.toFixed(6)}° ${ref}`;
    }

    // Parse DMS format: "39 deg 54' 26.69\""
    const dmsPattern = /([\d.]+)\s*deg\s*([\d.]+)'\s*([\d.]+)"/;
    const match = coord.match(dmsPattern);

    if (match) {
        const degrees = parseFloat(match[1]);
        const minutes = parseFloat(match[2]);
        const seconds = parseFloat(match[3]);

        // Convert to decimal degrees
        const decimal = degrees + minutes / 60 + seconds / 3600;
        return `${decimal.toFixed(6)}° ${ref}`;
    }

    // If format is not recognized, return as-is with reference
    return `${coord} ${ref}`;
}
