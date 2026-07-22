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

  window.SiteShell = {
    pageAnchor,
    pageAnchorTop,
    schedulePageAnchorScroll,
    scrollToPageAnchor,
  };

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-site-shell]").forEach(renderShell);
  });

  document.addEventListener("site-shell:content-ready", () => {
    if (!pendingPageAnchorScroll) return;
    schedulePageAnchorScroll({ behavior: "auto" });
  });
})();
