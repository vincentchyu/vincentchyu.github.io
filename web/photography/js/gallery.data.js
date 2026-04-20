window.GalleryData = (() => {
    const DEFAULT_GALLERY_SOURCES = {
        tos: {
            public_base: "https://photography.tos-cn-guangzhou.volces.com",
        },
        r2: {
            public_base: "https://cdn-photography-img-vincent.chyu.org",
        },
    };
    const GALLERY_SOURCE_CONFIG_KEY = "pages/gallery-source.json";
    const GALLERY_MANIFEST_KEY = "pages/photos-manifest.json";

    let gallerySourceConfig = null;

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

    function getLocalGalleryBase() {
        return "/web/photography/";
    }

    function getConfiguredSources() {
        const configured = window.__PHOTO_GALLERY_SOURCES__;
        if (!configured || typeof configured !== "object") {
            return DEFAULT_GALLERY_SOURCES;
        }

        return {
            tos: {
                public_base:
                    configured.tos?.public_base || DEFAULT_GALLERY_SOURCES.tos.public_base,
            },
            r2: {
                public_base:
                    configured.r2?.public_base || DEFAULT_GALLERY_SOURCES.r2.public_base,
            },
        };
    }

    function joinPublicUrl(base, key) {
        const normalizedBase = String(base || "").replace(/\/+$/, "");
        const normalizedKey = String(key || "").replace(/^\/+/, "");
        if (!normalizedBase) {
            return normalizedKey;
        }
        if (!normalizedKey) {
            return normalizedBase;
        }
        return `${normalizedBase}/${normalizedKey}`;
    }

    function isAbsoluteUrl(value) {
        if (typeof value !== "string" || !value) {
            return false;
        }

        try {
            return new URL(value).protocol.startsWith("http");
        } catch (error) {
            return false;
        }
    }

    function getRemoteGallerySourceConfigUrls() {
        const sources = getConfiguredSources();
        return [
            joinPublicUrl(sources.tos.public_base, GALLERY_SOURCE_CONFIG_KEY),
            joinPublicUrl(sources.r2.public_base, GALLERY_SOURCE_CONFIG_KEY),
        ];
    }

    async function ensureRemoteGallerySourceConfig() {
        if (getGalleryDataMode() === "local") {
            gallerySourceConfig = null;
            return null;
        }

        for (const url of getRemoteGallerySourceConfigUrls()) {
            try {
                const response = await fetch(url, getGalleryFetchOptions());
                if (!response.ok) {
                    continue;
                }

                const config = await response.json();
                if (!config || typeof config !== "object") {
                    continue;
                }
                gallerySourceConfig = config;
                return gallerySourceConfig;
            } catch (error) {
                console.warn("Failed to load gallery source config from", url, error);
            }
        }

        gallerySourceConfig = {
            version: "1",
            active_source: "tos",
            sources: getConfiguredSources(),
        };
        return gallerySourceConfig;
    }

    function getActiveRemoteSource() {
        const source = gallerySourceConfig?.active_source;
        if (source === "r2" || source === "tos") {
            return source;
        }
        return "tos";
    }

    function getRemotePublicBase(source = getActiveRemoteSource()) {
        const configuredSources = getConfiguredSources();
        const configSources = gallerySourceConfig?.sources || {};
        const sourceConfig = configSources[source] || configuredSources[source] || {};
        return sourceConfig.public_base || configuredSources[source]?.public_base || "";
    }

    function resolveGalleryManifestUrl() {
        if (getGalleryDataMode() === "local") {
            return new URL(
                "data/photos-manifest.json",
                window.location.origin + getLocalGalleryBase()
            ).toString();
        }

        return joinPublicUrl(getRemotePublicBase(), GALLERY_MANIFEST_KEY);
    }

    function resolveGalleryShardUrl(year) {
        if (getGalleryDataMode() === "local") {
            return new URL(
                `data/photos/${year}.json`,
                window.location.origin + getLocalGalleryBase()
            ).toString();
        }

        return joinPublicUrl(getRemotePublicBase(), `pages/photos/${year}.json`);
    }

    function resolveRemoteAssetUrl(asset) {
        if (isAbsoluteUrl(asset)) {
            return asset;
        }
        return joinPublicUrl(getRemotePublicBase(), asset);
    }

    function resolveLocalOriginalUrl(photo) {
        return new URL(
            `gallery_images/${photo.year}/${photo.filename}`,
            window.location.origin + getLocalGalleryBase()
        ).toString();
    }

    function normalizeGalleryPhoto(photo) {
        if (!photo || typeof photo !== "object") {
            return photo;
        }

        const normalized = {...photo};
        if (getGalleryDataMode() === "local") {
            normalized.path = resolveLocalOriginalUrl(normalized);
            normalized.thumbnail = normalized.path;
            return normalized;
        }

        normalized.path = resolveRemoteAssetUrl(normalized.path);
        normalized.thumbnail = resolveRemoteAssetUrl(normalized.thumbnail);
        return normalized;
    }

    function getGalleryFetchOptions() {
        if (getGalleryDataMode() === "local") {
            return {cache: "no-cache"};
        }
        return {};
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

    return {
        getGalleryDataMode,
        getLocalGalleryBase,
        getConfiguredSources,
        joinPublicUrl,
        isAbsoluteUrl,
        getRemoteGallerySourceConfigUrls,
        ensureRemoteGallerySourceConfig,
        getActiveRemoteSource,
        getRemotePublicBase,
        resolveGalleryManifestUrl,
        resolveGalleryShardUrl,
        resolveRemoteAssetUrl,
        resolveLocalOriginalUrl,
        normalizeGalleryPhoto,
        getGalleryFetchOptions,
        fetchGalleryManifest,
    };
})();
