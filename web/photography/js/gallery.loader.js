window.GalleryLoader = (() => {
    let dependencies = {
        config: {
            initialYearBatch: 2,
            initialPhotoTarget: 72,
            yearLoadAheadMargin: "300px 0px",
        },
        getState: () => ({}),
        setState: () => {},
        getCurrentColumnCount: () => null,
        setCurrentColumnCount: () => {},
        dataApi: null,
        layoutApi: null,
        timelineApi: null,
        lightboxApi: null,
        renderGallery: () => {},
        bindGalleryItemClicks: () => {},
        bindImageLoadEvents: () => {},
        rerenderCurrentGalleryLayout: () => false,
    };

    function configure(overrides = {}) {
        dependencies = {
            ...dependencies,
            ...overrides,
            config: {
                ...dependencies.config,
                ...(overrides.config || {}),
            },
        };
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
            if (
                yearCount >= dependencies.config.initialYearBatch ||
                photoCount >= dependencies.config.initialPhotoTarget
            ) {
                break;
            }
        }

        return yearCount;
    }

    async function loadGallery() {
        const timelineContainer = document.getElementById("timeline-sidebar");
        const galleryContainer = document.getElementById("gallery-content");

        if (!timelineContainer || !galleryContainer) {
            console.error("Containers not found");
            return;
        }

        try {
            dependencies.timelineApi.destroyTimelineToc();
            disconnectGalleryLoadMoreObserver();

            const activeGalleryMode = dependencies.dataApi.getGalleryDataMode();
            dependencies.setState({
                activeGalleryMode,
                galleryItems: [],
                galleryPhotoRecords: [],
                galleryManifest: null,
            });

            if (activeGalleryMode !== "local") {
                await dependencies.dataApi.ensureRemoteGallerySourceConfig();
            }

            const manifest = await dependencies.dataApi.fetchGalleryManifest();
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

            const response = await fetch(
                new URL(
                    "photos.json",
                    window.location.origin + dependencies.dataApi.getLocalGalleryBase()
                ).toString()
            );
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const albumsData = await response.json();

            const albums = albumsData.map((album) => {
                if (album.photos) {
                    return {
                        ...album,
                        photos: album.photos
                            .filter((photo) => !photo.is_hidden)
                            .map((photo) => dependencies.dataApi.normalizeGalleryPhoto(photo)),
                    };
                }
                return album;
            });

            timelineContainer.innerHTML = "";
            galleryContainer.innerHTML = "";

            const stateBeforeRender = dependencies.getState();
            dependencies.renderGallery(
                galleryContainer,
                albums,
                stateBeforeRender.galleryItems
            );

            const stateAfterRender = dependencies.getState();
            dependencies.bindGalleryItemClicks(
                galleryContainer,
                stateAfterRender.galleryItems
            );
            dependencies.bindImageLoadEvents();
            dependencies.setCurrentColumnCount(dependencies.layoutApi.getColumnCount());
            dependencies.timelineApi.initTimelineToc();
            dependencies.lightboxApi.parseAndOpenPhotoFromUrl(
                stateAfterRender.galleryItems
            );
        } catch (error) {
            console.error("Error loading gallery:", error);
            galleryContainer.innerHTML =
                '<p class="text-center text-red-500">Failed to load photos.</p>';
        }
    }

    async function loadShardedGallery(manifest, timelineContainer, galleryContainer) {
        const state = dependencies.getState();
        const token = (state.galleryLoadToken || 0) + 1;

        dependencies.setState({
            galleryLoadToken: token,
            activeGalleryMode: "sharded",
            galleryManifest: manifest,
            galleryItems: [],
            galleryPhotoRecords: [],
            galleryLoadedYears: new Set(),
            galleryPendingYearEntries: Array.isArray(manifest.years)
                ? [...manifest.years]
                : [],
            galleryNextYearCursor: 0,
            galleryYearLoadPromise: Promise.resolve(),
        });

        dependencies.timelineApi.destroyTimelineToc();
        disconnectGalleryLoadMoreObserver();
        timelineContainer.innerHTML = "";
        galleryContainer.innerHTML = "";

        const waterfallState = dependencies.layoutApi.createWaterfallState(galleryContainer);
        dependencies.layoutApi.buildTimelineOutline(waterfallState, manifest.years);
        dependencies.setState({
            galleryWaterfall: waterfallState,
        });
        dependencies.setCurrentColumnCount(waterfallState.columnCount);

        ensureGalleryLoadMoreSentinel(galleryContainer);
        const currentState = dependencies.getState();
        dependencies.bindGalleryItemClicks(galleryContainer, currentState.galleryItems);
        dependencies.bindImageLoadEvents();
        dependencies.timelineApi.initTimelineToc();

        setupGalleryLoadMoreObserver(token);
        await scheduleYearLoad({
            token,
            minYears: calculateInitialYearBatch(manifest.years),
            targetPhotoIndex: dependencies.lightboxApi.getRequestedPhotoIndexFromUrl(),
        });

        dependencies.lightboxApi.parseAndOpenPhotoFromUrl(
            dependencies.getState().galleryItems
        );
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

        const state = dependencies.getState();
        const promise = (state.galleryYearLoadPromise || Promise.resolve()).then(job, job);
        dependencies.setState({
            galleryYearLoadPromise: promise,
        });
        return promise;
    }

    async function loadMoreYears({
        token,
        minYears = 1,
        targetPhotoIndex = null,
        targetYear = "",
    } = {}) {
        const initialState = dependencies.getState();
        if (token !== initialState.galleryLoadToken) {
            return;
        }

        let loadedYears = 0;
        while (true) {
            const state = dependencies.getState();
            if (state.galleryNextYearCursor >= state.galleryPendingYearEntries.length) {
                break;
            }

            const enoughYearsLoaded = loadedYears >= minYears;
            const targetPhotoSatisfied =
                targetPhotoIndex === null || state.galleryItems.length > targetPhotoIndex;
            const targetYearSatisfied =
                !targetYear || state.galleryLoadedYears.has(targetYear);

            if (enoughYearsLoaded && targetPhotoSatisfied && targetYearSatisfied) {
                break;
            }

            const entry = state.galleryPendingYearEntries[state.galleryNextYearCursor];
            dependencies.setState({
                galleryNextYearCursor: state.galleryNextYearCursor + 1,
            });

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

        const sentinel = document.createElement("div");
        sentinel.id = "gallery-load-more-sentinel";
        sentinel.setAttribute("aria-hidden", "true");
        sentinel.style.width = "100%";
        sentinel.style.height = "1px";
        sentinel.style.pointerEvents = "none";
        sentinel.style.overflowAnchor = "none";
        container.appendChild(sentinel);

        dependencies.setState({
            galleryLoadMoreSentinel: sentinel,
        });
    }

    function disconnectGalleryLoadMoreObserver() {
        const state = dependencies.getState();
        if (state.galleryLoadMoreObserver) {
            state.galleryLoadMoreObserver.disconnect();
        }
        dependencies.setState({
            galleryLoadMoreObserver: null,
            galleryLoadMoreSentinel: null,
        });
    }

    function setupGalleryLoadMoreObserver(token) {
        const state = dependencies.getState();
        if (!state.galleryLoadMoreSentinel) {
            return;
        }

        const observer = new IntersectionObserver(
            (entries) => {
                if (!entries.some((entry) => entry.isIntersecting)) {
                    return;
                }
                void scheduleYearLoad({token, minYears: 1});
            },
            {
                root: null,
                rootMargin: dependencies.config.yearLoadAheadMargin,
                threshold: 0,
            }
        );
        observer.observe(state.galleryLoadMoreSentinel);
        dependencies.setState({
            galleryLoadMoreObserver: observer,
        });
        updateGalleryLoadMoreSentinel();
    }

    function updateGalleryLoadMoreSentinel() {
        const state = dependencies.getState();
        if (!state.galleryLoadMoreSentinel) {
            return;
        }

        const hasMoreYears = state.galleryNextYearCursor < state.galleryPendingYearEntries.length;
        state.galleryLoadMoreSentinel.style.display = hasMoreYears ? "block" : "none";
    }

    async function loadYearShard(entry, token) {
        const state = dependencies.getState();
        if (!entry || !entry.year || state.galleryLoadedYears.has(entry.year)) {
            return;
        }

        const shardUrl = dependencies.dataApi.resolveGalleryShardUrl(entry.year);
        try {
            const response = await fetch(
                shardUrl,
                dependencies.dataApi.getGalleryFetchOptions()
            );
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const album = await response.json();
            const latestState = dependencies.getState();
            if (token !== latestState.galleryLoadToken) {
                return;
            }

            const visiblePhotos = (album.photos || [])
                .filter((photo) => !photo.is_hidden)
                .map((photo) => dependencies.dataApi.normalizeGalleryPhoto(photo));

            if (visiblePhotos.length === 0) {
                if (latestState.galleryWaterfall && latestState.galleryWaterfall.outlineLayer) {
                    const currentBottom = latestState.galleryWaterfall.container.offsetHeight;
                    dependencies.layoutApi.upsertOutlineHeading(latestState.galleryWaterfall, {
                        id: `year-${entry.year}`,
                        level: 2,
                        label: String(entry.year),
                        top: currentBottom,
                    });
                }

                const loadedYears = new Set(latestState.galleryLoadedYears);
                loadedYears.add(entry.year);
                dependencies.setState({
                    galleryLoadedYears: loadedYears,
                });
                return;
            }

            const preparedPhotos = dependencies.layoutApi.preparePhotosForRender(
                entry.year,
                visiblePhotos
            );
            const viewportAnchor = dependencies.layoutApi.captureVisiblePhotoAnchor(
                latestState.galleryWaterfall
            );

            dependencies.setState({
                galleryPhotoRecords: [
                    ...latestState.galleryPhotoRecords,
                    ...preparedPhotos,
                ],
            });

            dependencies.rerenderCurrentGalleryLayout();

            const afterRenderState = dependencies.getState();
            const loadedYears = new Set(afterRenderState.galleryLoadedYears);
            loadedYears.add(entry.year);
            dependencies.setState({
                galleryLoadedYears: loadedYears,
            });

            requestAnimationFrame(() => {
                const currentState = dependencies.getState();
                dependencies.layoutApi.restoreVisiblePhotoAnchor(
                    currentState.galleryWaterfall,
                    viewportAnchor
                );
                requestAnimationFrame(() => {
                    const laterState = dependencies.getState();
                    dependencies.layoutApi.restoreVisiblePhotoAnchor(
                        laterState.galleryWaterfall,
                        viewportAnchor
                    );
                });
            });

            dependencies.lightboxApi.parseAndOpenPhotoFromUrl(
                dependencies.getState().galleryItems
            );
        } catch (error) {
            console.warn(`Failed to load shard ${entry.year}:`, error);
        }
    }

    return {
        configure,
        loadGallery,
        loadShardedGallery,
        calculateInitialYearBatch,
        scheduleYearLoad,
        loadMoreYears,
        ensureGalleryLoadMoreSentinel,
        disconnectGalleryLoadMoreObserver,
        setupGalleryLoadMoreObserver,
        updateGalleryLoadMoreSentinel,
        loadYearShard,
    };
})();
