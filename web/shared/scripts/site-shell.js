(function () {
  let pendingPageAnchorScroll = false;

  const navItems = [
    { id: "home", label: "HOME", href: "index.html" },
    { id: "about", label: "ABOUT ME", href: "web/photography/dist/about_me.html" },
    { id: "contact", label: "CONTACT", href: "web/photography/dist/contact.html" },
    { id: "media", label: "MEDIA", href: "web/media/" },
    { id: "portfolio", label: "PORTFOLIO", href: "web/photography/" },
    { id: "sonic", label: "SONIC LENS", href: "web/sonic-lens/" },
    // { id: "tools", label: "DEVELOPER TOOLS", href: "web/tools/" },
  ];

  function joinRoot(root, href) {
    if (/^https?:\/\//.test(href) || href.startsWith("/")) {
      return href;
    }
    const cleanRoot = root || "/";
    return cleanRoot.endsWith("/") ? cleanRoot + href : cleanRoot + "/" + href;
  }

  function navHref(root, item) {
    const href = joinRoot(root, item.href);
    if (item.id === "home") return href.replace(/#.*$/, "");

    const cleanHref = href.replace(/#.*$/, "");
    const separator = cleanHref.includes("?") ? "&" : "?";
    return `${cleanHref}${separator}site-page-anchor=1`;
  }

  function pageAnchor() {
    return document.getElementById("site-page-anchor")
      || document.querySelector("[data-site-page-anchor]")
      || document.querySelector("main h1")
      || document.querySelector(".container h1")
      || document.querySelector("section h1")
      || document.querySelector("h1");
  }

  function ensurePageAnchor() {
    const anchor = pageAnchor();
    if (!anchor) return null;
    anchor.id = "site-page-anchor";
    anchor.setAttribute("data-site-page-anchor", "");
    return anchor;
  }

  function pageAnchorTop() {
    const anchor = ensurePageAnchor();
    if (!anchor) return 0;
    return anchor.getBoundingClientRect().top + window.scrollY;
  }

  function scrollToPageAnchor(options = {}) {
    const anchor = ensurePageAnchor();
    if (!anchor) return false;
    if (Math.abs(anchor.getBoundingClientRect().top) <= 1) return true;
    const top = pageAnchorTop();
    let maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    if (top > maxScroll + 1) {
      const missingScroll = Math.ceil(top - maxScroll);
      const currentMinHeight = parseFloat(document.body.style.minHeight || "0") || 0;
      const nextMinHeight = Math.max(currentMinHeight, document.body.scrollHeight + missingScroll);
      document.body.style.minHeight = `${nextMinHeight}px`;
      maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      if (top > maxScroll + 1) return false;
    }
    window.scrollTo({
      top,
      left: 0,
      behavior: options.behavior || "auto",
    });
    return true;
  }

  function schedulePageAnchorScroll(options = {}) {
    pendingPageAnchorScroll = true;
    let settled = false;
    [0, 50, 180, 420, 900, 1600, 2600].forEach((delay) => {
      window.setTimeout(() => {
        if (settled) {
          pendingPageAnchorScroll = false;
          return;
        }
        const didScroll = scrollToPageAnchor({ behavior: options.behavior || "auto" });
        const anchor = ensurePageAnchor();
        settled = Boolean(didScroll && anchor && Math.abs(anchor.getBoundingClientRect().top) <= 1);
        if (settled) pendingPageAnchorScroll = false;
        if (options.cleanHash && window.location.hash === "#site-page-anchor") {
          history.replaceState(history.state, "", window.location.pathname + window.location.search);
        }
        if (options.cleanQuery && window.location.search.includes("site-page-anchor=1")) {
          const params = new URLSearchParams(window.location.search);
          params.delete("site-page-anchor");
          const query = params.toString();
          history.replaceState(history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
        }
      }, delay);
    });

    if (document.fonts?.ready) {
      document.fonts.ready.then(() => {
        if (settled) return;
        scrollToPageAnchor({ behavior: options.behavior || "auto" });
      }).catch(() => {});
    }
  }

  function rememberPageAnchorScroll(id) {
    if (!id || id === "home") return;
    try {
      window.sessionStorage.setItem("site-shell-anchor-target", id);
    } catch (error) {
      // Ignore storage failures; direct same-page scrolling still works.
    }
  }

  function consumePageAnchorScroll(active) {
    if (!active || active === "home") return false;
    try {
      const target = window.sessionStorage.getItem("site-shell-anchor-target");
      if (target !== active) return false;
      window.sessionStorage.removeItem("site-shell-anchor-target");
      return true;
    } catch (error) {
      return false;
    }
  }

  function renderShell(target) {
    const root = target.dataset.siteRoot || "/";
    const active = target.dataset.siteActive || "";
    const theme = target.dataset.siteShellTheme || "";

    target.classList.add("site-shell-header");
    if (theme) {
      target.setAttribute("data-site-shell-theme", theme);
    }

    const list = navItems
      .map((item) => {
        const isActive = item.id === active;
        const current = isActive ? ' aria-current="page"' : "";
        const cls = isActive ? ' class="is-active"' : "";
        return `<li><a href="${navHref(root, item)}" data-site-nav-id="${item.id}"${cls}${current}>${item.label}</a></li>`;
      })
      .join("");

    target.innerHTML = `
      <nav class="site-shell-inner" aria-label="Primary">
        <a class="site-shell-brand" href="${joinRoot(root, "index.html")}">VINCENT CHYU</a>
        <button class="site-shell-toggle" type="button" aria-label="Open main menu" aria-expanded="false">
          <span class="site-shell-toggle-line"></span>
          <span class="site-shell-toggle-line"></span>
          <span class="site-shell-toggle-line"></span>
        </button>
        <div class="site-shell-menu">
          <ul>${list}</ul>
        </div>
      </nav>
    `;

    ensurePageAnchor();

    const button = target.querySelector(".site-shell-toggle");
    target.querySelectorAll("[data-site-nav-id]").forEach((link) => {
      const id = link.dataset.siteNavId || "";
      link.addEventListener("click", (event) => {
        if (id === "home") return;
        event.preventDefault();
        rememberPageAnchorScroll(id);

        target.classList.remove("is-open");
        button.setAttribute("aria-expanded", "false");
        if (id !== active) {
          window.location.assign(link.href);
          return;
        }

        schedulePageAnchorScroll({ behavior: "auto" });
      });
    });

    button.addEventListener("click", () => {
      const isOpen = target.classList.toggle("is-open");
      button.setAttribute("aria-expanded", String(isOpen));
    });

    window.addEventListener("resize", () => {
      if (window.innerWidth > 980 && target.classList.contains("is-open")) {
        target.classList.remove("is-open");
        button.setAttribute("aria-expanded", "false");
      }
    });

    const shouldScrollFromStorage = consumePageAnchorScroll(active);
    const shouldScrollToAnchor = shouldScrollFromStorage
      || window.location.search.includes("site-page-anchor=1")
      || window.location.hash === "#site-page-anchor";
    if (shouldScrollToAnchor) {
      ensurePageAnchor();
      schedulePageAnchorScroll({ behavior: "auto", cleanHash: true, cleanQuery: true });
    }
  }

  /* --- System-level Music Player Component --- */
  let cplayerLoaded = false;

  function loadCplayer(callback) {
    if (window.cplayer) {
      if (callback) callback();
      return;
    }
    if (cplayerLoaded) {
      const checkInterval = setInterval(() => {
        if (window.cplayer) {
          clearInterval(checkInterval);
          if (callback) callback();
        }
      }, 50);
      return;
    }
    cplayerLoaded = true;

    const script = document.createElement("script");
    script.src = "/web/photography/dist/cplayer.min.js";
    script.onload = function () {
      if (callback) callback();
    };
    script.onerror = function () {
      console.error("Failed to load cplayer.min.js");
      document.querySelectorAll(".audio-loading").forEach((el) => {
        el.innerHTML = '<span style="color: #999;">音乐播放器加载失败</span>';
      });
    };
    document.body.appendChild(script);
  }

  function initMusicPlayerInContainer(container) {
    if (!container) return;
    const tooltip = container.querySelector(".music-player-tooltip");
    if (!tooltip) return;
    const playerTarget = tooltip.querySelector(".app2-music-player") || tooltip.querySelector("#app2");
    if (!playerTarget) return;

    loadCplayer(() => {
      if (playerTarget.dataset.initialized) return;
      playerTarget.dataset.initialized = "true";

      try {
        const player = new window.cplayer({
          element: playerTarget,
          playlist: [
            {
              src: "/web/photography/src/music/music-02.m4a",
              poster: "/web/photography/src/music/cover-02.jpg",
              name: "Welcome Home, Son",
              artist: "Radical Face",
              lyric: "",
              sublyric: "",
            },
            {
              src: "/web/photography/src/music/music-01.m4a",
              poster: "/web/photography/src/music/cover-01.jpg",
              name: "旅途愉快",
              artist: "寸铁",
              lyric: "",
              sublyric: "",
            },
          ],
        });
        player.mode = "listloop";
        const loading = tooltip.querySelector(".audio-loading");
        if (loading) loading.style.display = "none";
      } catch (err) {
        console.error("Error initializing cplayer:", err);
      }
    });
  }

  function attachMusicPlayerToContainer(container) {
    if (!container || container.dataset.musicPlayerAttached) return;
    container.dataset.musicPlayerAttached = "true";
    if (!container.classList.contains("site-header-music-container") && !container.classList.contains("portfolio-header-container")) {
      container.classList.add("site-header-music-container");
    }

    let tooltip = container.querySelector(".music-player-tooltip");
    if (!tooltip) {
      tooltip = document.createElement("div");
      tooltip.className = "music-player-tooltip";
      tooltip.innerHTML = `
        <div class="audio-loading">
          <span class="dot"></span>
          <span class="dot"></span>
          <span class="dot"></span>
          <span style="margin-left: 0.5rem;">音乐加载中...</span>
        </div>
        <div class="app2-music-player"></div>
      `;
      container.appendChild(tooltip);
    }

    // Hover Event (Desktop)
    container.addEventListener("mouseenter", () => {
      initMusicPlayerInContainer(container);
    });

    // Click Event (Mobile Toggle)
    let isMobileOpen = false;
    container.addEventListener("click", (e) => {
      if (window.innerWidth <= 768) {
        if (e.target.closest(".app2-music-player") || e.target.closest("#app2") || e.target.closest(".audio-loading")) {
          return;
        }
        isMobileOpen = !isMobileOpen;
        if (isMobileOpen) {
          tooltip.classList.add("mobile-show");
          initMusicPlayerInContainer(container);
        } else {
          tooltip.classList.remove("mobile-show");
        }
      }
    });

    document.addEventListener("click", (e) => {
      if (window.innerWidth <= 768 && isMobileOpen) {
        if (!container.contains(e.target)) {
          tooltip.classList.remove("mobile-show");
          isMobileOpen = false;
        }
      }
    });
  }

  function autoAttachHeaderMusicPlayer() {
    const explicitContainers = document.querySelectorAll(".portfolio-header-container, .site-header-music-container, [data-music-player]");
    if (explicitContainers.length > 0) {
      explicitContainers.forEach(attachMusicPlayerToContainer);
    } else {
      const mainTitle = pageAnchor();
      if (mainTitle && mainTitle.tagName === "H1") {
        let parent = mainTitle.parentElement;
        if (!parent.classList.contains("portfolio-header-container") && !parent.classList.contains("site-header-music-container")) {
          if (parent.children.length === 1 && (parent.tagName === "DIV" || parent.tagName === "HEADER")) {
            attachMusicPlayerToContainer(parent);
          } else {
            const wrapper = document.createElement("div");
            wrapper.className = "site-header-music-container";
            mainTitle.parentNode.insertBefore(wrapper, mainTitle);
            wrapper.appendChild(mainTitle);
            attachMusicPlayerToContainer(wrapper);
          }
        } else {
          attachMusicPlayerToContainer(parent);
        }
      }
    }
  }

  window.SiteShell = {
    pageAnchor,
    pageAnchorTop,
    schedulePageAnchorScroll,
    scrollToPageAnchor,
    attachHeaderMusicPlayer: attachMusicPlayerToContainer,
    autoAttachHeaderMusicPlayer,
  };

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-site-shell]").forEach(renderShell);
    autoAttachHeaderMusicPlayer();
  });

  document.addEventListener("site-shell:content-ready", () => {
    autoAttachHeaderMusicPlayer();
    if (!pendingPageAnchorScroll) return;
    schedulePageAnchorScroll({ behavior: "auto" });
  });
})();

