(function () {
  const categories = [
    { id: "music", label: "音乐" },
    { id: "book", label: "书籍" },
    { id: "movie", label: "电影" },
    { id: "tv", label: "剧集" },
    { id: "game", label: "游戏" },
    { id: "podcast", label: "播客" },
  ];

  const state = {
    total: 0,
    loaded: 0,
  };

  function normalizeRecords(value) {
    return Array.isArray(value) ? value : [];
  }

  function normalizeNeoDBURL(url) {
    if (!url) return "https://neodb.social/";
    if (/^https?:\/\//.test(url)) return url;
    return `https://neodb.social/${url.replace(/^\/+/, "")}`;
  }

  function formatDate(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }

  function ratingText(record) {
    const personal = Number(record.rating || 0);
    const itemRating = Number(record.item?.rating || 0);
    if (personal > 0) return `我的评分 ${personal.toLocaleString("zh-CN")}/10`;
    if (itemRating > 0) return `NeoDB ${itemRating.toLocaleString("zh-CN")}/10`;
    return "";
  }

  function fallbackCover(title) {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450">
        <rect width="300" height="450" fill="#f3f4f6"/>
        <text x="30" y="220" font-family="Arial, sans-serif" font-size="24" fill="#111827">${escapeHTML(title || "NeoDB")}</text>
      </svg>
    `;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  }

  function escapeHTML(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function renderCard(record, category) {
    const item = record.item || {};
    const title = item.title || "未命名条目";
    const date = formatDate(record.created_time);
    const rating = ratingText(record);
    const meta = [rating, date].filter(Boolean).join(" · ");
    const comment = record.comment ? `<p class="media-comment">${escapeHTML(record.comment)}</p>` : "";
    const url = normalizeNeoDBURL(item.url);
    const cover = item.cover_image_url || item.cover || fallbackCover(title);

    return `
      <article class="media-card media-card--${category.id}">
        <a class="media-cover-link" href="${url}" target="_blank" rel="noreferrer">
          <img class="media-cover" src="${cover}" alt="${escapeHTML(title)}封面" loading="lazy" />
          <h3 class="media-card-title">${escapeHTML(title)}</h3>
        </a>
        <div class="media-meta">${escapeHTML(meta || item.category || "")}</div>
        ${comment}
      </article>
    `;
  }

  function renderCategory(category, records) {
    const section = document.getElementById(`media-${category.id}`);
    if (!section) return;
    const list = normalizeRecords(records);
    state.total += list.length;
    state.loaded += 1;

    section.querySelector(".media-count").textContent = `${list.length} 条记录`;
    const body = section.querySelector(".media-section-body");
    if (list.length === 0) {
      body.innerHTML = `<div class="media-empty">还没有${category.label}记录。</div>`;
    } else {
      body.innerHTML = `<div class="media-grid">${list.map((record) => renderCard(record, category)).join("")}</div>`;
    }

    if (state.loaded === categories.length) {
      const total = document.getElementById("media-total");
      if (total) total.textContent = `${state.total} 条记录`;
    }
  }

  async function loadCategory(category) {
    try {
      const response = await fetch(`data/${category.id}.json`, { cache: "no-store" });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      renderCategory(category, await response.json());
    } catch (error) {
      const section = document.getElementById(`media-${category.id}`);
      if (!section) return;
      section.querySelector(".media-count").textContent = "加载失败";
      section.querySelector(".media-section-body").innerHTML =
        `<div class="media-error">${category.label}记录加载失败。</div>`;
      state.loaded += 1;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    categories.forEach(loadCategory);
  });
})();
