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
    if (/^\d{4}(?:-\d{2})?$/.test(value)) return value;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }

  function personalRatingText(record) {
    const rating = Number(record.rating_grade || record.rating || 0);
    if (rating <= 0) return "";
    return `${rating.toLocaleString("zh-CN")}/10`;
  }

  function itemRatingText(record) {
    const rating = Number(record.item?.rating || 0);
    if (rating <= 0) return "";
    return `${rating.toLocaleString("zh-CN")}/10`;
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
    const markedDate = formatDate(record.created_time);
    const releaseDate = formatDate(item.release_date);
    const itemRating = itemRatingText(record);
    const personalRating = personalRatingText(record);
    const commentText = record.comment_text || record.comment || "";
    const meta = [
      itemRating ? `<span class="media-rating">${escapeHTML(itemRating)}</span>` : "",
      releaseDate ? `<span class="media-date">${escapeHTML(releaseDate)}</span>` : "",
    ].filter(Boolean).join(" · ");
    const url = normalizeNeoDBURL(item.url);
    const cover = item.cover_image_url || item.cover || fallbackCover(title);
    const hoverRows = [
      personalRating ? `<div class="media-hover-row"><span>我的评分</span><strong>${escapeHTML(personalRating)}</strong></div>` : "",
      commentText ? `<p class="media-hover-comment">${escapeHTML(commentText)}</p>` : "",
      markedDate ? `<div class="media-hover-row"><span>标记日期</span><strong>${escapeHTML(markedDate)}</strong></div>` : "",
    ].filter(Boolean).join("");
    const hoverCard = hoverRows
      ? `<div class="media-hover-card" aria-hidden="true">${hoverRows}</div>`
      : "";

    return `
      <article class="media-card media-card--${category.id}">
        <a class="media-cover-link" href="${url}" target="_blank" rel="noreferrer">
          <span class="media-cover-wrap">
            <img class="media-cover" src="${cover}" alt="${escapeHTML(title)}封面" loading="lazy" />
            ${hoverCard}
          </span>
          <h3 class="media-card-title" title="${escapeHTML(title)}">${escapeHTML(title)}</h3>
        </a>
        <div class="media-meta">${meta || escapeHTML(item.category || "")}</div>
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
