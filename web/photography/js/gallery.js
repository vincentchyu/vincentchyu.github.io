/**
 * Gallery Renderer
 * Fetches photos.json and renders the photography portfolio with a timeline layout.
 */

// Flag to prevent URL updates during initial photo load from URL
// This prevents Carousel.change events during initialization from updating URL incorrectly
let isInitializingFromUrl = false;

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
    setupTimelineHover();
});

/**
 * Setup timeline hover show/hide functionality
 */
function setupTimelineHover() {
    const timelineSidebar = document.getElementById("timeline-sidebar");
    const hoverZone = document.getElementById("timeline-hover-zone");

    if (!timelineSidebar || !hoverZone) {
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
            // Only handle timeline-specific elements, don't interfere with other clicks
            if (
                e.target.closest(".timeline-year, .timeline-month, .timeline-marker")
            ) {
                // Keep timeline visible longer after click on mobile
                if (isMobileInteraction) {
                    showTimeline();
                    hideTimeline(true); // Use longer delay
                }
                // Stop propagation only for timeline clicks
                e.stopPropagation();
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
        setTimeout(() => {
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

/**
 * Open Fancybox directly (fallback method)
 */
function openFancyboxDirectly(photoIndex, galleryItems) {
    if (typeof Fancybox === "undefined" || galleryItems.length === 0) {
        return;
    }

    // Check if Fancybox is already open
    const existingInstance = Fancybox.getInstance();
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
        Fancybox.show(galleryItems, {
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
                            const metadataPanel = createMetadataPanel(exif, filename);
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
                                filename
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
        setTimeout(() => {
            // Check if this is a share link by checking query parameter
            const urlParams = new URLSearchParams(window.location.search);
            const isShareLink = urlParams.has("share");

            // Parse query parameter: ?photo=123
            // Use multiple methods to ensure we get the correct parameter even after redirects
            let photoParam = urlParams.get("photo");

            // Fallback: try parsing from full URL string if URLSearchParams didn't work
            // This handles cases where redirects might have affected the query string
            if (!photoParam) {
                const fullUrl = window.location.href;
                const match = fullUrl.match(/[?&]photo=(\d+)/);
                if (match) {
                    photoParam = match[1];
                }
            }

            if (!photoParam) {
                // No photo parameter found, exit silently (normal page load)
                return;
            }

            const photoIndex = parseInt(photoParam, 10);

            // Validate index - be strict about this to prevent opening wrong photo
            if (isNaN(photoIndex)) {
                console.warn("Invalid photo index (NaN) from URL:", photoParam);
                return;
            }

            if (photoIndex < 0) {
                console.warn("Invalid photo index (negative) from URL:", photoIndex);
                return;
            }

            // Check if galleryItems is ready and has enough items
            if (!galleryItems || galleryItems.length === 0) {
                console.warn("Gallery items not ready yet, will retry...");
                // Retry after a short delay
                setTimeout(() => parseAndOpenPhotoFromUrl(galleryItems), 500);
                return;
            }

            if (photoIndex >= galleryItems.length) {
                console.warn(
                    "Photo index out of range:",
                    photoIndex,
                    "max:",
                    galleryItems.length - 1
                );
                return;
            }

            // Check if Fancybox is already open
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
                openFancyboxDirectly(photoIndex, galleryItems);

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
        // const response = await fetch("photos.json");
        const response = await fetch(
            "https://cdn-photography-img-vincent.chyu.org/pages/photos.json"
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
        const galleryItems = [];

        // Clear containers before re-rendering (important for orientation changes)
        timelineContainer.innerHTML = "";
        galleryContainer.innerHTML = "";

        // Render Timeline (Left Sidebar)
        renderTimeline(timelineContainer, albums);

        // Render Gallery (Right Content)
        renderGallery(galleryContainer, albums, galleryItems);

        // Bind Fancybox manually using event delegation
        // This avoids issues with 'trigger' being undefined in initialPage callback
        if (typeof Fancybox !== "undefined") {
            // Unbind any existing bindings to be safe
            Fancybox.unbind("[data-fancybox]");
            Fancybox.unbind("[data-fancybox-trigger]");
            Fancybox.unbind(".gallery-item");

            // Remove existing click listener if we could (but we can't easily without storing the function)
            // So we'll just add a new one and rely on the fact that loadGallery usually runs once or on full reload
            // For safety in SPA-like navigation, we could attach to a persistent container or check a flag

            galleryContainer.addEventListener("click", (e) => {
                const link = e.target.closest(".gallery-item");
                if (link) {
                    e.preventDefault();
                    e.stopPropagation();

                    const index = parseInt(link.dataset.index) || 0;

                    // Check if Fancybox is already open
                    const existingInstance = Fancybox.getInstance();
                    if (existingInstance) {
                        // If already open, just jump to the clicked photo
                        try {
                            existingInstance.carousel.jumpTo(index);
                        } catch (err) {
                            console.error("Failed to jump to photo:", err);
                            // Fallback to show if jumpTo fails
                            Fancybox.show(galleryItems, {
                                startIndex: index,
                                groupAll: true,
                                autoFocus: false,
                                trapFocus: false,
                                placeFocusBack: false,
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
                                                    instance.container.classList.toggle(
                                                        "has-metadata-panel"
                                                    );
                                                }
                                                if (event && event.stopPropagation)
                                                    event.stopPropagation();
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
                                    "Carousel.change": (
                                        fancybox,
                                        carousel,
                                        toIndex,
                                        fromIndex
                                    ) => {
                                        // Update metadata when slide changes
                                        // Use galleryItems as the source of truth to avoid potential sync issues with carousel.slides
                                        const item = galleryItems[toIndex];
                                        if (!item) return;

                                        const exif = item.exif;
                                        const filename = item.filename;

                                        // Log current opened image index (only the actual displayed one)
                                        const total = carousel.slides.length;
                                        console.log(
                                            "Carousel.change: 当前打开的图片索引:",
                                            toIndex
                                        );
                                        console.log(
                                            "Carousel.change: 显示:",
                                            `${toIndex + 1} / ${total}`
                                        );

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

                                        // We need to wait for the container to be ready or just update if it exists
                                        const container = fancybox.container;
                                        if (!container) return;

                                        try {
                                            const existingPanel = container.querySelector(
                                                ".fancybox__metadata"
                                            );
                                            if (existingPanel) existingPanel.remove();

                                            if (exif) {
                                                const metadataPanel = createMetadataPanel(
                                                    exif,
                                                    filename
                                                );
                                                container.appendChild(metadataPanel);
                                            }
                                        } catch (e) {
                                            console.error("Failed to update metadata panel:", e);
                                        }
                                    },
                                    init: (fancybox) => {
                                        // Initial load handling is done via Carousel.change usually,
                                        // but let's ensure the first slide gets processed if change doesn't fire on init
                                        // actually Carousel.change fires on init too usually, but let's be safe
                                        // or use 'reveal' just for the first one?
                                        // actually 'Carousel.change' is reliable for navigation.
                                        // 'reveal' is good for initial load. Let's keep 'reveal' but make sure it doesn't conflict.
                                        // Actually, let's just use 'Carousel.change' and trigger it manually or rely on it.
                                        // Fancybox 4/5 'Carousel.change' fires when index changes.
                                        // Let's also listen to 'reveal' to catch the very first load if change doesn't fire.
                                    },
                                    reveal: (fancybox, slide) => {
                                        // Keep reveal for the initial open, as change might have fired before DOM was ready?
                                        // Or just to be safe.

                                        const current = fancybox.getSlide();

                                        // 只处理当前正在显示的 slide
                                        if (slide.index !== current.index) return;

                                        console.log("reveal: 当前显示:", slide.filename);
                                        const exif = slide.exif;
                                        const filename = slide.filename;
                                        if (!exif) return;

                                        const index = slide.index;
                                        const total = fancybox.carousel.slides.length;
                                        console.log("reveal: 当前索引:", index);
                                        console.log("reveal: 显示:", `${index + 1} / ${total}`);

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
                                                    filename
                                                );
                                                fancybox.container.appendChild(metadataPanel);
                                            }
                                        } catch (e) {
                                            console.error("Failed to update metadata panel:", e);
                                        }
                                    },
                                    done: (fancybox, slide) => {
                                        //  const index = slide.index;
                                        //  const total = fancybox.carousel.slides.length;
                                        //  console.log('done: 当前索引:', index);
                                        //  console.log('done: 显示:', `${index + 1} / ${total}`);
                                        //  console.log("图片 URL:", slide.src);
                                    },
                                    destroy: (fancybox) => {
                                        const current = fancybox.getSlide();
                                        console.log("destroy: 当前显示:", current.filename);
                                        console.log("destroy: 当前索引:", current.index);

                                        const container = fancybox.container;
                                        if (container) {
                                            container.classList.remove("has-metadata-panel");
                                            const metadataPanel = container.querySelector(
                                                ".fancybox__metadata"
                                            );
                                            if (metadataPanel) metadataPanel.remove();
                                        }
                                    },
                                },
                            });
                        }
                        return;
                    }

                    Fancybox.show(galleryItems, {
                        startIndex: index,
                        groupAll: true,
                        autoFocus: false,
                        trapFocus: false,
                        placeFocusBack: false,
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
                                // Update metadata when slide changes
                                // Use galleryItems as the source of truth to avoid potential sync issues with carousel.slides
                                const item = galleryItems[toIndex];
                                if (!item) return;

                                const exif = item.exif;
                                const filename = item.filename;

                                // Log current opened image index (only the actual displayed one)
                                const total = carousel.slides.length;
                                console.log("Carousel.change: 当前打开的图片索引:", toIndex);
                                console.log(
                                    "Carousel.change: 显示:",
                                    `${toIndex + 1} / ${total}`
                                );

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

                                // We need to wait for the container to be ready or just update if it exists
                                const container = fancybox.container;
                                if (!container) return;

                                try {
                                    const existingPanel = container.querySelector(
                                        ".fancybox__metadata"
                                    );
                                    if (existingPanel) existingPanel.remove();

                                    if (exif) {
                                        const metadataPanel = createMetadataPanel(exif, filename);
                                        container.appendChild(metadataPanel);
                                    }
                                } catch (e) {
                                    console.error("Failed to update metadata panel:", e);
                                }
                            },
                            init: (fancybox) => {
                                // Initial load handling is done via Carousel.change usually,
                                // but let's ensure the first slide gets processed if change doesn't fire on init
                                // actually Carousel.change fires on init too usually, but let's be safe
                                // or use 'reveal' just for the first one?
                                // actually 'Carousel.change' is reliable for navigation.
                                // 'reveal' is good for initial load. Let's keep 'reveal' but make sure it doesn't conflict.
                                // Actually, let's just use 'Carousel.change' and trigger it manually or rely on it.
                                // Fancybox 4/5 'Carousel.change' fires when index changes.
                                // Let's also listen to 'reveal' to catch the very first load if change doesn't fire.
                            },
                            reveal: (fancybox, slide) => {
                                // Keep reveal for the initial open, as change might have fired before DOM was ready?
                                // Or just to be safe.

                                const current = fancybox.getSlide();

                                // 只处理当前正在显示的 slide
                                if (slide.index !== current.index) return;

                                console.log("reveal: 当前显示:", slide.filename);
                                const exif = slide.exif;
                                const filename = slide.filename;
                                if (!exif) return;

                                const index = slide.index;
                                const total = fancybox.carousel.slides.length;
                                console.log("reveal: 当前索引:", index);
                                console.log("reveal: 显示:", `${index + 1} / ${total}`);

                                // Only update URL if:
                                // 1. Not initializing from URL parameter (isInitializingFromUrl flag)
                                // This prevents URL from being updated during initialization when fromIndex might be undefined
                                updateUrlQuery(index);

                                try {
                                    const existingPanel = fancybox.container.querySelector(
                                        ".fancybox__metadata"
                                    );
                                    if (existingPanel) {
                                        console.log("existingPanel.remove()");
                                        existingPanel.remove();
                                    }

                                    if (exif) {
                                        const metadataPanel = createMetadataPanel(exif, filename);
                                        fancybox.container.appendChild(metadataPanel);
                                    }
                                } catch (e) {
                                    console.error("Failed to update metadata panel:", e);
                                }
                            },
                            done: (fancybox, slide) => {
                                //  const index = slide.index;
                                //  const total = fancybox.carousel.slides.length;
                                //  console.log('done: 当前索引:', index);
                                //  console.log('done: 显示:', `${index + 1} / ${total}`);
                                //  console.log("图片 URL:", slide.src);
                            },
                            destroy: (fancybox) => {
                                const current = fancybox.getSlide();
                                console.log("destroy: 当前显示:", current.filename);
                                console.log("destroy: 当前索引:", current.index);

                                const container = fancybox.container;
                                if (container) {
                                    container.classList.remove("has-metadata-panel");
                                    const metadataPanel = container.querySelector(
                                        ".fancybox__metadata"
                                    );
                                    if (metadataPanel) metadataPanel.remove();
                                }
                            },
                        },
                    });
                }
            });
        }

        // Bind Image Load Events
        bindImageLoadEvents();

        // Setup Scroll Spy for Timeline
        setupScrollSpy();

        // Set current column count after successful load
        // This prevents unnecessary reloads on initial page load
        if (typeof currentColumnCount !== "undefined") {
            currentColumnCount = getColumnCount();
        }

        // Force layout recalculation to fix flex width issue
        // This solves the problem where images have 0px width on initial load
        requestAnimationFrame(() => {
            const container = document.getElementById("gallery-content");
            if (container) {
                // Force reflow
                void container.offsetHeight;
                // Trigger resize event to recalculate flex layout
                window.dispatchEvent(new Event("resize"));
            }
        });

        // Parse URL hash parameter and open corresponding photo
        parseAndOpenPhotoFromUrl(galleryItems);
    } catch (error) {
        console.error("Error loading gallery:", error);
        galleryContainer.innerHTML =
            '<p class="text-center text-red-500">Failed to load photos.</p>';
    }
}

function renderTimeline(container, albums) {
    const nav = document.createElement("nav");
    nav.className = "relative py-4 px-2";

    // Continuous vertical timeline line
    const line = document.createElement("div");
    line.className =
        "absolute left-6 top-0 bottom-0 w-0.5 bg-gradient-to-b from-gray-200 via-gray-300 to-gray-200 dark:from-gray-700 dark:via-gray-600 dark:to-gray-700";
    nav.appendChild(line);

    albums.forEach((album, albumIndex) => {
        const yearGroup = document.createElement("div");
        yearGroup.className = "mb-6 relative";

        // Year Item Container
        const yearItem = document.createElement("div");
        yearItem.className = "relative flex items-center mb-4 group cursor-pointer";

        // Year Marker (Large Dot with ring effect)
        const yearMarkerWrapper = document.createElement("div");
        yearMarkerWrapper.className =
            "absolute left-0 flex items-center justify-center z-20";

        const yearMarker = document.createElement("div");
        yearMarker.className =
            "w-5 h-5 rounded-full border-2 border-white dark:border-gray-900 bg-gray-300 dark:bg-gray-600 shadow-sm transition-all duration-300 group-hover:scale-125 group-hover:shadow-md timeline-marker";
        yearMarker.dataset.targetMarker = `year-${album.year}`;

        // Active ring effect
        const yearRing = document.createElement("div");
        yearRing.className =
            "absolute w-5 h-5 rounded-full border-2 border-transparent transition-all duration-300";
        yearMarkerWrapper.appendChild(yearRing);
        yearMarkerWrapper.appendChild(yearMarker);
        yearItem.appendChild(yearMarkerWrapper);

        // Year Link with better styling
        const yearLink = document.createElement("a");
        yearLink.href = `#year-${album.year}`;
        yearLink.className =
            "ml-10 text-xl font-bold text-gray-400 hover:text-black dark:hover:text-white transition-all duration-300 timeline-year cursor-pointer select-none";
        yearLink.dataset.target = `year-${album.year}`;
        yearLink.textContent = album.year;

        // Add smooth scroll on click
        yearLink.addEventListener("click", function (e) {
            e.preventDefault();
            e.stopPropagation();
            console.log("Year link clicked:", `year-${album.year}`);
            scrollToSection(`year-${album.year}`);
            // Keep timeline visible after click
            const timelineSidebar = document.getElementById("timeline-sidebar");
            if (timelineSidebar) {
                timelineSidebar.classList.add("show");
            }
        });

        yearItem.appendChild(yearLink);
        yearGroup.appendChild(yearItem);

        // Month Links with improved styling
        const photosByMonth = groupPhotosByMonth(album.photos);
        const months = Object.keys(photosByMonth).sort((a, b) =>
            b.localeCompare(a)
        );

        if (months.length > 0) {
            const monthList = document.createElement("div");
            monthList.className = "flex flex-col space-y-2 mt-1 ml-10";

            months.forEach((month, monthIndex) => {
                const monthItem = document.createElement("div");
                monthItem.className = "relative flex items-center group cursor-pointer";

                // Month Marker (Small Dot with connecting line)
                const monthMarkerWrapper = document.createElement("div");
                monthMarkerWrapper.className =
                    "absolute -left-10 flex items-center justify-center z-10";

                const monthMarker = document.createElement("div");
                monthMarker.className =
                    "w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-500 transition-all duration-300 group-hover:scale-150 group-hover:bg-gray-600 dark:group-hover:bg-gray-300 timeline-marker";
                monthMarker.dataset.targetMarker = `section-${album.year}-${month}`;

                // Connecting line from main timeline to month
                const monthConnector = document.createElement("div");
                monthConnector.className =
                    "absolute left-3 w-8 h-0.5 bg-gray-300 dark:bg-gray-600";
                monthMarkerWrapper.appendChild(monthConnector);
                monthMarkerWrapper.appendChild(monthMarker);
                monthItem.appendChild(monthMarkerWrapper);

                const monthName = new Date(2000, parseInt(month) - 1, 1).toLocaleString(
                    "default",
                    {month: "short"}
                );
                const monthLink = document.createElement("a");
                monthLink.href = `#section-${album.year}-${month}`;
                monthLink.className =
                    "text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-all duration-300 timeline-month cursor-pointer select-none";
                monthLink.dataset.target = `section-${album.year}-${month}`;
                monthLink.textContent = monthName;

                // Add smooth scroll on click
                monthLink.addEventListener("click", function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log("Month link clicked:", `section-${album.year}-${month}`);
                    scrollToSection(`section-${album.year}-${month}`);
                    // Keep timeline visible after click
                    const timelineSidebar = document.getElementById("timeline-sidebar");
                    if (timelineSidebar) {
                        timelineSidebar.classList.add("show");
                    }
                });

                monthItem.appendChild(monthLink);
                monthList.appendChild(monthItem);
            });
            yearGroup.appendChild(monthList);
        }

        nav.appendChild(yearGroup);
    });

    container.appendChild(nav);
}

/**
 * Smooth scroll to a section with offset for sticky header
 */
function scrollToSection(sectionId) {
    const element = document.getElementById(sectionId);
    if (element) {
        const headerOffset = 100; // Offset for sticky header
        const elementPosition = element.getBoundingClientRect().top;
        const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

        console.log("Scrolling to section:", sectionId, "offset:", offsetPosition);
        window.scrollTo({
            top: offsetPosition,
            behavior: "smooth",
        });
    } else {
        console.error("Section not found:", sectionId);
    }
}

function renderGallery(container, albums, galleryItems) {
    const allPhotos = [];

    albums.forEach((album) => {
        const photosByMonth = groupPhotosByMonth(album.photos);
        const months = Object.keys(photosByMonth).sort((a, b) =>
            b.localeCompare(a)
        );

        let isFirstYearPhoto = true;

        months.forEach((month) => {
            const monthPhotos = photosByMonth[month];

            if (monthPhotos.length > 0) {
                // Mark the first photo of the month
                if (!monthPhotos[0].markers) {
                    monthPhotos[0].markers = [];
                }
                monthPhotos[0].markers.push(`section-${album.year}-${month}`);

                // Mark the first photo of the year
                if (isFirstYearPhoto) {
                    monthPhotos[0].markers.push(`year-${album.year}`);
                    isFirstYearPhoto = false;
                }

                // Add all photos to the flat list
                allPhotos.push(...monthPhotos);
            }
        });
    });

    // Render the single unified waterfall
    renderWaterfallLayout(container, allPhotos, null, null, galleryItems);
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
function renderWaterfallLayout(container, photos, year, month, galleryItems) {
    const columnCount = getColumnCount();

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
        });
    });

    const columns = createWaterfallLayout(photos, columnCount);

    // Clear container
    container.innerHTML = "";

    // Create waterfall container
    const waterfallContainer = document.createElement("div");
    waterfallContainer.className = "waterfall-container";

    // Create columns
    columns.forEach((columnPhotos, colIndex) => {
        const columnDiv = document.createElement("div");
        columnDiv.className = "waterfall-column";

        columnPhotos.forEach((photo) => {
            const photoCard = createPhotoCard(photo, year, month);
            columnDiv.appendChild(photoCard);
        });

        waterfallContainer.appendChild(columnDiv);
    });

    container.appendChild(waterfallContainer);
}

function createPhotoCard(photo, year, month) {
    const wrapper = document.createElement("div");
    wrapper.className = "photo-card relative"; // Ensure relative positioning for anchors
    wrapper.dataset.index = photo.waterfallIndex;

    // Calculate aspect ratio for placeholder
    // Default to 3:2 (1.5) if missing
    const width = photo.width || 300;
    const height = photo.height || 200;
    const aspectRatio = `${width} / ${height}`;

    wrapper.style.aspectRatio = aspectRatio;

    const exifData = photo.exif ? JSON.stringify(photo.exif) : "";
    const filename = photo.filename || "";

    // Generate hidden anchors if markers exist
    let anchorsHtml = "";
    if (photo.markers && photo.markers.length > 0) {
        anchorsHtml = photo.markers
            .map(
                (markerId) =>
                    `<div id="${markerId}" class="absolute -top-24 left-0 w-full h-0 pointer-events-none invisible"></div>`
            )
            .join("");
    }

    wrapper.innerHTML = `
    ${anchorsHtml}
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
          src="${photo.thumbnail}"
        />
      </a>
    </div>
  `;

    return wrapper;
}

function bindImageLoadEvents() {
    const checkAllImages = () => {
        document.querySelectorAll("img.img-loading").forEach(function (img) {
            // Check if already processed to avoid redundant work
            if (img.dataset.loaded === "true") return;

            let isLoaded = false;

            function hideSkeleton() {
                if (isLoaded) return;
                isLoaded = true;
                img.dataset.loaded = "true"; // Mark as processed

                let parent = img.closest(".img-skeleton-bg");
                let skeleton = parent ? parent.querySelector(".img-skeleton") : null;

                // Force reflow
                void img.offsetWidth;

                requestAnimationFrame(() => {
                    // Remove transition temporarily to force immediate render if needed
                    // img.style.transition = 'none';

                    img.classList.remove("img-loading");
                    img.classList.remove("opacity-0");

                    // Force styles directly
                    img.style.opacity = "1";
                    img.style.visibility = "visible";

                    if (skeleton) {
                        skeleton.remove();
                    }
                });
            }

            function checkImageLoaded() {
                // More lenient check: if complete and has dimensions, it's loaded
                if (img.complete) {
                    if (img.naturalWidth > 0 || img.naturalHeight > 0) {
                        hideSkeleton();
                        return true;
                    }
                }
                return false;
            }

            // Immediate check
            if (checkImageLoaded()) return;

            // Event listeners
            img.addEventListener("load", hideSkeleton, {once: true});
            img.addEventListener(
                "error",
                () => {
                    console.warn("Image failed to load:", img.src);
                    hideSkeleton(); // Even on error, remove skeleton to avoid permanent loading state
                },
                {once: true}
            );
        });
    };

    // Use requestAnimationFrame to ensure DOM is ready before first check
    requestAnimationFrame(() => {
        checkAllImages();
    });

    // More frequent polling, NO limit on checks (will be stopped by window.load)
    const interval = setInterval(checkAllImages, 50);

    // Stop polling and do final check after window load
    window.addEventListener(
        "load",
        () => {
            setTimeout(() => {
                checkAllImages();
                clearInterval(interval);
            }, 100);
        },
        {once: true}
    );

    // Re-check on visibility change (fixes tab switch issue)
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
            checkAllImages();
        }
    });

    // Re-check on page show (fixes back/forward cache issues)
    window.addEventListener("pageshow", () => {
        checkAllImages();
    });
}

function setupScrollSpy() {
    const observerOptions = {
        root: null,
        rootMargin: "-20% 0px -60% 0px", // Active when element is in the middle-ish
        threshold: 0,
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                const id = entry.target.id;
                activateTimelineItem(id);
            }
        });
    }, observerOptions);

    // Observe all year and month sections
    document
        .querySelectorAll('[id^="year-"], [id^="section-"]')
        .forEach((section) => {
            observer.observe(section);
        });
}

function activateTimelineItem(id) {
    // Reset all year texts
    document.querySelectorAll(".timeline-year").forEach((el) => {
        el.classList.remove(
            "text-black",
            "dark:text-white",
            "text-gray-800",
            "dark:text-gray-200"
        );
        el.classList.add("text-gray-400");
    });

    // Reset all month texts
    document.querySelectorAll(".timeline-month").forEach((el) => {
        el.classList.remove(
            "text-gray-700",
            "dark:text-gray-200",
            "text-black",
            "dark:text-white",
            "font-semibold"
        );
        el.classList.add("text-gray-500", "dark:text-gray-400");
    });

    // Reset all year markers
    document.querySelectorAll(".timeline-marker").forEach((el) => {
        if (
            el.closest('[data-target-marker^="year-"]') ||
            el.dataset.targetMarker?.startsWith("year-")
        ) {
            el.classList.remove(
                "bg-black",
                "dark:bg-white",
                "scale-125",
                "ring-2",
                "ring-black",
                "dark:ring-white",
                "shadow-lg"
            );
            el.classList.add("bg-gray-300", "dark:bg-gray-600");
        } else {
            el.classList.remove(
                "bg-black",
                "dark:bg-white",
                "scale-150",
                "ring-2",
                "ring-black",
                "dark:ring-white"
            );
            el.classList.add("bg-gray-400", "dark:bg-gray-500");
        }
    });

    // Activate current item
    const activeLink = document.querySelector(`[data-target="${id}"]`);
    if (activeLink) {
        if (id.startsWith("year-")) {
            activeLink.classList.remove("text-gray-400");
            activeLink.classList.add("text-black", "dark:text-white");
        } else {
            activeLink.classList.remove("text-gray-500", "dark:text-gray-400");
            activeLink.classList.add(
                "text-gray-700",
                "dark:text-gray-200",
                "font-semibold"
            );
        }
    }

    // Activate current marker with enhanced styling
    const activeMarker = document.querySelector(`[data-target-marker="${id}"]`);
    if (activeMarker) {
        if (id.startsWith("year-")) {
            activeMarker.classList.remove("bg-gray-300", "dark:bg-gray-600");
            activeMarker.classList.add(
                "bg-black",
                "dark:bg-white",
                "scale-125",
                "ring-2",
                "ring-black",
                "dark:ring-white",
                "shadow-lg"
            );
        } else {
            activeMarker.classList.remove("bg-gray-400", "dark:bg-gray-500");
            activeMarker.classList.add(
                "bg-black",
                "dark:bg-white",
                "scale-150",
                "ring-2",
                "ring-black",
                "dark:ring-white"
            );
        }
    }

    // If it's a month, also highlight the parent year (subtly)
    if (id.startsWith("section-")) {
        const year = id.split("-")[1];
        const yearLink = document.querySelector(`[data-target="year-${year}"]`);
        const yearMarker = document.querySelector(
            `[data-target-marker="year-${year}"]`
        );

        if (yearLink) {
            yearLink.classList.remove("text-gray-400");
            yearLink.classList.add("text-gray-800", "dark:text-gray-200");
        }
        if (yearMarker) {
            yearMarker.classList.remove("bg-gray-300", "dark:bg-gray-600");
            yearMarker.classList.add("bg-gray-500", "dark:bg-gray-400", "scale-110");
        }
    }
}

/**
 * Create metadata panel HTML from EXIF data
 */
function createMetadataPanel(exif, filename) {
    console.log("Creating metadata panel for:", filename, exif);
    const panel = document.createElement("div");
    panel.className = "fancybox__metadata";

    // Extract key EXIF values
    const rating = exif.Rating || 0;
    const tags = extractTags(exif);
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
 * Generate mapping from Timeline keys to global photo indices
 */
function generateTimelineMapping(albums) {
    const mapping = {};
    let globalIndex = 0;

    albums.forEach((album) => {
        const photosByMonth = groupPhotosByMonth(album.photos);
        const months = Object.keys(photosByMonth).sort((a, b) =>
            b.localeCompare(a)
        );

        months.forEach((month) => {
            const key = `${album.year}-${month}`;
            mapping[key] = globalIndex;
            globalIndex += photosByMonth[month].length;
        });
    });

    return mapping;
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
        loadGallery();
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
function extractTags(exif) {
    const tags = [];

    // Try different tag fields
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
        value: "© 2025 VINCENT CHYU PHOTOGRAPHY - ALL RIGHT RESERVED",
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
