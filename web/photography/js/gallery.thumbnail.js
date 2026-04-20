window.GalleryThumbnail = (() => {
    const THUMBNAIL_LOAD_AHEAD_MARGIN = "800px 0px";

    let thumbnailLoadObserver = null;

    function isImageLoaded(img) {
        if (!img) return false;
        if (img.complete && (img.naturalWidth > 0 || img.naturalHeight > 0)) {
            return true;
        }
        if (img.dataset.loaded === "true") {
            return true;
        }
        return false;
    }

    function waitForImageLoad(img, timeout = 10000) {
        return new Promise((resolve) => {
            if (isImageLoaded(img)) {
                resolve(true);
                return;
            }

            const timeoutId = setTimeout(() => {
                resolve(false);
            }, timeout);

            const loadHandler = () => {
                clearTimeout(timeoutId);
                resolve(true);
            };

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

    return {
        isImageLoaded,
        waitForImageLoad,
        ensureThumbnailLoadObserver,
        bindThumbnailLoad,
        hydrateThumbnailImage,
        queueThumbnailLoads,
        bindImageLoadEvents,
    };
})();
