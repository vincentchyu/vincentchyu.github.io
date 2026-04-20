window.GalleryLightbox = (() => {
    const FANCYBOX_SCRIPT_URL = "/web/photography/dist/fancybox.umd.js";
    const FANCYBOX_STYLE_URL = "/web/photography/dist/fancybox.css";
    const METADATA_PANEL_STYLE_URL = "/web/photography/css/metadata-panel.css?v=3";

    let fancyboxAssetsPromise = null;
    let fancyboxWarmupScheduled = false;
    let dependencies = {
        getState: () => ({
            isInitializingFromUrl: false,
            activeGalleryMode: "legacy",
            galleryLoadToken: 0,
        }),
        setIsInitializingFromUrl: () => {},
        scheduleYearLoad: () => Promise.resolve(),
        createMetadataPanel: (...args) =>
            window.GalleryMetadata.createMetadataPanel(...args),
    };

    (function normalizeUrlOnLoad() {
        if (window.location.search) {
            let pathname = window.location.pathname;
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
    })();

    window.addEventListener("pageshow", function (event) {
        if (event.persisted) {
            if (window.location.search) {
                let pathname = window.location.pathname;
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

    function configure(overrides = {}) {
        dependencies = {
            ...dependencies,
            ...overrides,
        };
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
            ])
                .then(() => {
                    if (typeof Fancybox === "undefined") {
                        throw new Error("Fancybox did not initialize");
                    }
                    return Fancybox;
                })
                .catch((error) => {
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

        let pathname = window.location.pathname;
        if (!pathname.endsWith("/")) {
            pathname = pathname + "/";
        }
        const baseUrl = window.location.origin + pathname;
        const shareUrl = `${baseUrl}?photo=${photoIndex}&share`;

        copyToClipboard(shareUrl);
    }

    function copyToClipboard(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard
                .writeText(text)
                .then(() => {
                    showCopyNotification("链接已复制到剪贴板");
                })
                .catch((err) => {
                    console.error("Failed to copy using Clipboard API:", err);
                    fallbackCopyToClipboard(text);
                });
        } else {
            fallbackCopyToClipboard(text);
        }
    }

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

    function showCopyNotification(message, isError = false) {
        const existing = document.getElementById("share-notification");
        if (existing) {
            existing.remove();
        }

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

        setTimeout(() => {
            notification.style.animation = "slideOut 0.3s ease-out";
            setTimeout(async () => {
                if (notification.parentNode) {
                    notification.remove();
                }
            }, 300);
        }, 3000);
    }

    function releaseFocusWithin(container) {
        if (!container || !(document.activeElement instanceof HTMLElement)) {
            return;
        }

        const activeElement = document.activeElement;
        if (container.contains(activeElement)) {
            activeElement.blur();
        }
    }

    async function openFancyboxDirectly(photoIndex, galleryItems) {
        if (galleryItems.length === 0) {
            return;
        }

        const FancyboxApi = await ensureFancyboxAssets();

        const existingInstance = FancyboxApi.getInstance();
        if (existingInstance) {
            try {
                existingInstance.carousel.jumpTo(photoIndex);
                return;
            } catch (e) {
                console.error("Failed to jump to photo in existing instance:", e);
                releaseFocusWithin(existingInstance.container);
                existingInstance.destroy();
            }
        }

        try {
            FancyboxApi.show(galleryItems, {
                startIndex: photoIndex,
                groupAll: true,
                autoFocus: false,
                trapFocus: false,
                placeFocusBack: false,
                Hash: false,
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
                        const state = dependencies.getState();

                        if (
                            !state.isInitializingFromUrl &&
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
                                const metadataPanel = dependencies.createMetadataPanel(
                                    exif,
                                    filename,
                                    item.Subject,
                                    item.caption
                                );
                                container.appendChild(metadataPanel);
                            }
                        } catch (e) {
                            console.error("Failed to update metadata panel:", e);
                        }
                    },
                    reveal: (fancybox, slide) => {
                        const state = dependencies.getState();
                        if (state.isInitializingFromUrl && slide.index === photoIndex) {
                            setTimeout(() => {
                                updateUrlQuery(photoIndex);
                                dependencies.setIsInitializingFromUrl(false);
                            }, 100);
                        }

                        const current = fancybox.getSlide();
                        if (slide.index !== current.index) return;

                        const exif = slide.exif;
                        const filename = slide.filename;
                        if (!exif) return;

                        try {
                            const existingPanel = fancybox.container.querySelector(
                                ".fancybox__metadata"
                            );
                            if (existingPanel) {
                                existingPanel.remove();
                            }

                            const metadataPanel = dependencies.createMetadataPanel(
                                exif,
                                filename,
                                slide.Subject,
                                slide.caption
                            );
                            fancybox.container.appendChild(metadataPanel);
                        } catch (e) {
                            console.error("Failed to update metadata panel:", e);
                        }
                    },
                    shouldClose: (fancybox) => {
                        releaseFocusWithin(fancybox.container);
                    },
                    close: (fancybox) => {
                        releaseFocusWithin(fancybox.container);
                    },
                    destroy: (fancybox) => {
                        releaseFocusWithin(fancybox.container);
                    },
                },
            });
        } catch (e) {
            console.error("Failed to open Fancybox directly:", e);
        }
    }

    function normalizeUrl() {
        if (window.location.search) {
            let pathname = window.location.pathname;
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

    function parseAndOpenPhotoFromUrl(galleryItems) {
        normalizeUrl();

        requestAnimationFrame(() => {
            setTimeout(async () => {
                const photoIndex = getRequestedPhotoIndexFromUrl();

                if (photoIndex === null) {
                    return;
                }

                const state = dependencies.getState();

                if (!galleryItems || galleryItems.length === 0) {
                    console.warn("Gallery items not ready yet, will retry...");
                    if (state.activeGalleryMode === "sharded") {
                        void dependencies.scheduleYearLoad({
                            token: state.galleryLoadToken,
                            minYears: 0,
                            targetPhotoIndex: photoIndex,
                        });
                    }
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
                    if (state.activeGalleryMode === "sharded") {
                        void dependencies.scheduleYearLoad({
                            token: state.galleryLoadToken,
                            minYears: 0,
                            targetPhotoIndex: photoIndex,
                        });
                    }
                    setTimeout(() => parseAndOpenPhotoFromUrl(galleryItems), 500);
                    return;
                }

                await ensureFancyboxAssets();
                const existingInstance = Fancybox.getInstance();
                if (existingInstance) {
                    try {
                        dependencies.setIsInitializingFromUrl(true);
                        existingInstance.carousel.jumpTo(photoIndex);
                        setTimeout(() => {
                            updateUrlQuery(photoIndex);
                            dependencies.setIsInitializingFromUrl(false);
                        }, 100);
                    } catch (e) {
                        console.error("Failed to jump to photo:", e);
                        dependencies.setIsInitializingFromUrl(false);
                    }
                    return;
                }

                dependencies.setIsInitializingFromUrl(true);

                try {
                    await openFancyboxDirectly(photoIndex, galleryItems);

                    setTimeout(() => {
                        const latestState = dependencies.getState();
                        if (latestState.isInitializingFromUrl) {
                            updateUrlQuery(photoIndex);
                            dependencies.setIsInitializingFromUrl(false);
                        }
                    }, 1000);
                } catch (e) {
                    console.error("Failed to open Fancybox:", e);
                    dependencies.setIsInitializingFromUrl(false);
                }
            }, 100);
        });
    }

    function updateUrlQuery(photoIndex) {
        let pathname = window.location.pathname;
        if (!pathname.endsWith("/")) {
            pathname = pathname + "/";
        }
        const baseUrl = window.location.origin + pathname;
        const urlParams = new URLSearchParams(window.location.search);
        const hasShare = urlParams.has("share");
        const newUrl = hasShare
            ? `${baseUrl}?photo=${photoIndex}&share`
            : `${baseUrl}?photo=${photoIndex}`;

        if (window.history && window.history.replaceState) {
            window.history.replaceState(null, null, newUrl);
        } else {
            window.location.href = newUrl;
        }
    }

    return {
        configure,
        scheduleFancyboxWarmup,
        getRequestedPhotoIndexFromUrl,
        openFancyboxDirectly,
        parseAndOpenPhotoFromUrl,
        updateUrlQuery,
    };
})();
