window.GalleryTimeline = (() => {
    const TIMELINE_SCROLL_OFFSET = 100;
    const TIMELINE_TOC_SELECTOR = "#timeline-sidebar";
    const TIMELINE_CONTENT_SELECTOR = "#gallery-content .gallery-outline-layer";

    let timelineTocInitialized = false;
    let timelineScrollHandler = null;
    let timelineScrollTicking = false;
    let activeTimelineId = "";
    let dependencies = {
        getState: () => ({
            activeGalleryMode: "legacy",
            galleryLoadedYears: new Set(),
            galleryLoadToken: 0,
        }),
        scheduleYearLoad: () => Promise.resolve(),
        extractYearFromSectionId: () => "",
    };

    function configure(overrides = {}) {
        dependencies = {
            ...dependencies,
            ...overrides,
        };
    }

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
        const HIDE_DELAY = 300;
        const MOBILE_HIDE_DELAY = 1500;
        let isMobileInteraction = false;

        function showTimeline() {
            if (hideTimeout) {
                clearTimeout(hideTimeout);
                hideTimeout = null;
            }
            timelineSidebar.classList.add("show");
            hoverZone.style.pointerEvents = "none";
        }

        function hideTimeline(useLongDelay = false) {
            const delay = useLongDelay ? MOBILE_HIDE_DELAY : HIDE_DELAY;
            hideTimeout = setTimeout(() => {
                timelineSidebar.classList.remove("show");
                hoverZone.style.pointerEvents = "auto";
                isMobileInteraction = false;
            }, delay);
        }

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

        hoverZone.addEventListener(
            "touchstart",
            () => {
                isMobileInteraction = true;
                showTimeline();
            },
            {passive: true}
        );

        timelineSidebar.addEventListener(
            "touchstart",
            () => {
                isMobileInteraction = true;
                showTimeline();
            },
            {passive: true}
        );

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

        document.addEventListener(
            "touchstart",
            (e) => {
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

    async function scrollToSection(sectionId) {
        const targetYear = dependencies.extractYearFromSectionId(sectionId);
        const state = dependencies.getState();
        if (
            state.activeGalleryMode === "sharded" &&
            targetYear &&
            !state.galleryLoadedYears.has(targetYear)
        ) {
            await dependencies.scheduleYearLoad({
                token: state.galleryLoadToken,
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

    return {
        configure,
        isTimelineEnabled,
        destroyTimelineToc,
        initTimelineToc,
        refreshTimelineToc,
        setupTimelineHover,
        scrollToSection,
    };
})();
