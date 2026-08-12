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

    function updateOutlineHeadingPositions(state, sectionHeadings, card) {
        if (!state || !Array.isArray(sectionHeadings) || sectionHeadings.length === 0 || !card) {
            return;
        }

        requestAnimationFrame(() => {
            const cardTop = card.offsetTop;
            sectionHeadings.forEach((heading) => {
                upsertOutlineHeading(state, {...heading, top: cardTop});
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
        });

        const columns = createWaterfallLayout(photos, state.columnCount);

        columns.forEach((columnPhotos, colIndex) => {
            const columnDiv = state.columns[colIndex];

            columnPhotos.forEach((photo) => {
                const photoCard = createPhotoCard(photo);
                columnDiv.appendChild(photoCard);
                updateOutlineHeadingPositions(state, photo.sectionHeadings, photoCard);
            });
        });

        dependencies.queueThumbnailLoads(state.container);
        requestAnimationFrame(() => {
            dependencies.refreshTimelineToc();
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

    function normalizeWaterfallColumnBaselines(state) {
        if (!state || !Array.isArray(state.columns) || state.columns.length === 0) {
            return [];
        }

        const measuredHeights = state.columns.map((column) => column.offsetHeight || 0);
        const baselineHeight = Math.max(...measuredHeights, 0);
        const normalizedHeights = measuredHeights.map(() => baselineHeight);

        state.columns.forEach((column, index) => {
            const gap = baselineHeight - measuredHeights[index];
            if (gap <= 1) {
                return;
            }

            const spacer = document.createElement("div");
            spacer.className = "waterfall-column-spacer";
            spacer.setAttribute("aria-hidden", "true");
            spacer.style.height = `${gap}px`;
            column.appendChild(spacer);
        });

        return normalizedHeights;
    }

    function createWaterfallLayout(photos, columnCount) {
        const columnHeights = new Array(columnCount).fill(0);
        const columns = Array.from({length: columnCount}, () => []);
        const gap = 8;

        photos.forEach((photo) => {
            let minHeight = columnHeights[0];
            let minIndex = 0;

            for (let i = 1; i < columnCount; i++) {
                if (columnHeights[i] < minHeight) {
                    minHeight = columnHeights[i];
                    minIndex = i;
                }
            }

            columns[minIndex].push(photo);

            const aspectRatio =
                photo.width && photo.height ? photo.width / photo.height : 1.5;
            const relativeHeight = 1000 / aspectRatio;
            columnHeights[minIndex] += relativeHeight + gap;
        });

        return columns;
    }

    return {
        configure,
        createWaterfallState,
        buildTimelineOutline,
        preparePhotosForRender,
        upsertOutlineHeading,
        updateOutlineHeadingPositions,
        renderGallery,
        renderWaterfallLayout,
        buildOutlineAlbumsFromLoadedPhotos,
        extractYearFromDate,
        createPhotoCard,
        getColumnCount,
        calculatePhotoHeight,
        captureVisiblePhotoAnchor,
        restoreVisiblePhotoAnchor,
        normalizeWaterfallColumnBaselines,
    };
})();
