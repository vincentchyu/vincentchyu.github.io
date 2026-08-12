window.GalleryLayout = (() => {
    const TIMELINE_SCROLL_OFFSET = 100;
    const EAGER_THUMBNAIL_COUNT = 8;

    let dependencies = {
        refreshTimelineToc: () => {},
        queueThumbnailLoads: () => {},
        bindImageLoadEvents: () => {},
    };

    function configure(overrides = {}) {
        dependencies = {
            ...dependencies,
            ...overrides,
        };
    }

    function createWaterfallState(container) {
        const columnCount = getColumnCount();
        const shell = document.createElement("div");
        shell.className = "gallery-waterfall-shell relative";
        const outlineLayer = document.createElement("div");
        outlineLayer.className = "gallery-outline-layer";
        outlineLayer.setAttribute("aria-hidden", "true");
        const waterfallContainer = document.createElement("div");
        waterfallContainer.className = "waterfall-container relative w-full";

        shell.appendChild(outlineLayer);
        shell.appendChild(waterfallContainer);
        container.appendChild(shell);
        return {
            columnCount,
            shell,
            outlineLayer,
            headingMap: new Map(),
            container: waterfallContainer,
            heights: new Array(columnCount).fill(0),
            renderedCards: [],
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

    function updateWaterfallTotalMinHeight(state, albums) {
        if (!state || !state.container || !Array.isArray(albums) || albums.length === 0) {
            return 0;
        }

        const columnCount = state.columnCount || getColumnCount();
        let totalEstimatedHeight = 0;

        albums.forEach((album) => {
            totalEstimatedHeight += estimateYearHeight(album, columnCount);
        });

        if (totalEstimatedHeight > 0) {
            state.container.style.minHeight = `${Math.ceil(totalEstimatedHeight)}px`;
        }

        return totalEstimatedHeight;
    }

    function buildTimelineOutline(state, albums) {
        if (!state || !state.outlineLayer) {
            return;
        }

        state.outlineLayer.innerHTML = "";
        state.headingMap.clear();

        updateWaterfallTotalMinHeight(state, albums);

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

            let runningPhotoCount = 0;
            const totalYearPhotos = Math.max(
                1,
                Number(album.count) ||
                    monthEntries.reduce((sum, entry) => sum + (Number(entry.count) || 0), 0) ||
                    1
            );
            monthEntries.forEach((entry) => {
                const fraction = runningPhotoCount / totalYearPhotos;
                const monthTop = placeholderTop + Math.floor(fraction * estimatedYearHeight);
                upsertOutlineHeading(state, {
                    id: `section-${album.year}-${entry.month}`,
                    level: 3,
                    label: formatTimelineMonth(entry.month),
                    top: monthTop,
                });
                runningPhotoCount += Number(entry.count) || 1;
            });

            placeholderTop += estimatedYearHeight;
        });
    }

    function estimateMonthHeight(monthEntry, columnCount) {
        const photoCount = Math.max(1, Number(monthEntry?.count) || 1);
        const estimatedRows = Math.max(1, Math.ceil(photoCount / Math.max(columnCount, 1)));
        return estimatedRows * 210;
    }

    function estimateYearHeight(album, columnCount) {
        const cols = Math.max(1, Number(columnCount) || 1);
        let totalCount = 0;

        if (typeof album.count === "number" && album.count > 0) {
            totalCount = album.count;
        } else if (Array.isArray(album.photos) && album.photos.length > 0) {
            totalCount = album.photos.length;
        } else {
            const monthEntries = getAlbumMonthEntries(album);
            totalCount = monthEntries.reduce(
                (sum, entry) => sum + (Number(entry.count) || 0),
                0
            );
        }

        if (totalCount <= 0) {
            return 240;
        }

        const estimatedRows = Math.ceil(totalCount / cols);
        return Math.max(280, estimatedRows * 210 + 40);
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

    function updateOutlineHeadingPositions(state, sectionHeadings, topPos) {
        if (!state || !Array.isArray(sectionHeadings) || sectionHeadings.length === 0 || topPos === undefined) {
            return;
        }

        requestAnimationFrame(() => {
            sectionHeadings.forEach((heading) => {
                upsertOutlineHeading(state, {...heading, top: topPos});
            });
            dependencies.refreshTimelineToc();
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

    function renderGallery(container, albums, galleryItems) {
        const allPhotos = [];
        const waterfallState = createWaterfallState(container);
        buildTimelineOutline(waterfallState, albums);

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

                    allPhotos.push(...monthPhotos);
                }
            });
        });

        renderWaterfallLayout(waterfallState, allPhotos, galleryItems);
        return {
            waterfallState,
            allPhotos,
        };
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

    function renderWaterfallLayout(state, photos, galleryItems) {
        galleryItems.length = 0;
        state.renderedCards = [];
        state.heights = new Array(state.columnCount).fill(0);
        state.container.innerHTML = "";

        photos.forEach((photo) => {
            photo.waterfallIndex = galleryItems.length;
            galleryItems.push({
                src: photo.path,
                thumb: photo.thumbnail,
                caption: photo.alt || "",
                exif: photo.exif,
                filename: photo.filename || "",
                Subject: photo.Subject || [],
            });

            const photoCard = createPhotoCard(photo);
            state.container.appendChild(photoCard);
            state.renderedCards.push({ photo, card: photoCard, sectionHeadings: photo.sectionHeadings });
        });

        reflowAbsoluteWaterfall(state);

        dependencies.queueThumbnailLoads(state.container);
        requestAnimationFrame(() => {
            dependencies.refreshTimelineToc();
        });
    }

    function reflowAbsoluteWaterfall(state) {
        if (!state || !state.container || !state.renderedCards) return;

        state.columnCount = getColumnCount();
        state.heights = new Array(state.columnCount).fill(0);
        
        const containerWidth = state.container.clientWidth;
        if (containerWidth === 0 && state.renderedCards.length > 0) {
            requestAnimationFrame(() => reflowAbsoluteWaterfall(state));
            return;
        }

        const gap = 16;
        const totalGapWidth = gap * (state.columnCount - 1);
        const columnWidth = (containerWidth - totalGapWidth) / state.columnCount;

        state.renderedCards.forEach(({ photo, card, sectionHeadings }) => {
            let minIndex = 0;
            let minHeight = state.heights[0];
            for (let i = 1; i < state.columnCount; i++) {
                if (state.heights[i] < minHeight) {
                    minHeight = state.heights[i];
                    minIndex = i;
                }
            }

            const x = minIndex * (columnWidth + gap);
            const y = minHeight;

            card.style.position = "absolute";
            card.style.width = `${columnWidth}px`;
            card.style.transform = `translate3d(${x}px, ${y}px, 0)`;
            card.style.left = "0";
            card.style.top = "0";

            const photoPhysicalHeight = calculatePhotoHeight(photo, columnWidth);
            state.heights[minIndex] += photoPhysicalHeight + gap;

            if (sectionHeadings && sectionHeadings.length > 0) {
                updateOutlineHeadingPositions(state, sectionHeadings, y);
            }
        });

        const maxHeight = Math.max(...state.heights, 0);
        state.container.style.height = `${maxHeight}px`;
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
                months: entry.months.sort((a, b) =>
                    String(b.month).localeCompare(String(a.month))
                ),
            }));
    }

    function extractYearFromDate(date) {
        if (!date) {
            return "";
        }
        const match = String(date).match(/^(\d{4})/);
        return match ? match[1] : "";
    }

    function createPhotoCard(photo) {
        const wrapper = document.createElement("div");
        wrapper.className = "photo-card relative w-full";
        wrapper.dataset.index = photo.waterfallIndex;

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
    <div class="overflow-hidden absolute inset-0 w-full h-full img-skeleton-bg rounded-lg safari-rounded-fix">
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
          style="aspect-ratio: ${aspectRatio};"
          class="block w-full h-full object-cover object-center opacity-0 animate-fade-in transition duration-300 img-hover-zoom img-loading rounded-lg"
          decoding="async"
          ${thumbnailAttributes}
        />
      </a>
    </div>
  `;

        return wrapper;
    }

    function getColumnCount() {
        if (window.matchMedia("(min-width: 1200px)").matches) {
            return 5;
        }
        if (window.matchMedia("(min-width: 768px)").matches) {
            return 3;
        }
        return 2;
    }

    function calculatePhotoHeight(photo, columnWidth) {
        if (!photo.width || !photo.height) return 200;
        const aspectRatio = photo.width / photo.height;
        return columnWidth / aspectRatio;
    }

    function captureVisiblePhotoAnchor(state) {
        if (!state || !state.container) {
            return null;
        }

        const cards = Array.from(
            state.container.querySelectorAll(".photo-card[data-index]")
        );
        if (cards.length === 0) {
            return null;
        }

        const viewportTop = TIMELINE_SCROLL_OFFSET + 8;
        const viewportBottom = window.innerHeight || document.documentElement.clientHeight || 0;

        const anchorCard =
            cards.find((card) => {
                const rect = card.getBoundingClientRect();
                return rect.bottom > viewportTop && rect.top < viewportBottom;
            }) || cards[0];

        const anchorIndex = Number.parseInt(anchorCard.dataset.index || "", 10);
        if (!Number.isFinite(anchorIndex)) {
            return null;
        }

        return {
            index: anchorIndex,
            top: anchorCard.getBoundingClientRect().top,
        };
    }

    function restoreVisiblePhotoAnchor(state, anchor) {
        if (!anchor || !state || !state.container) {
            return;
        }

        const anchorCard = state.container.querySelector(
            `.photo-card[data-index="${anchor.index}"]`
        );
        if (!anchorCard) {
            return;
        }

        const currentTop = anchorCard.getBoundingClientRect().top;
        const delta = currentTop - anchor.top;
        if (Math.abs(delta) <= 1) {
            return;
        }

        window.scrollTo({
            top: Math.max(0, window.scrollY + delta),
            behavior: "auto",
        });
    }

    // normalizeWaterfallColumnBaselines and createWaterfallLayout removed for absolute positioned waterfall

    return {
        configure,
        createWaterfallState,
        buildTimelineOutline,
        updateWaterfallTotalMinHeight,
        preparePhotosForRender,
        upsertOutlineHeading,
        updateOutlineHeadingPositions,
        renderGallery,
        renderWaterfallLayout,
        reflowAbsoluteWaterfall,
        buildOutlineAlbumsFromLoadedPhotos,
        extractYearFromDate,
        createPhotoCard,
        getColumnCount,
        calculatePhotoHeight,
        captureVisiblePhotoAnchor,
        restoreVisiblePhotoAnchor,
    };
})();
