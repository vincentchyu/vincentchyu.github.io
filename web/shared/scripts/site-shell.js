(function () {
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
        return `<li><a href="${joinRoot(root, item.href)}"${cls}${current}>${item.label}</a></li>`;
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

    const button = target.querySelector(".site-shell-toggle");
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
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-site-shell]").forEach(renderShell);
  });
})();
