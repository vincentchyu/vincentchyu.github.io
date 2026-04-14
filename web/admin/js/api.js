function buildPhotoResourcePath(photoOrYear, filename) {
  if (typeof photoOrYear === "object" && photoOrYear !== null) {
    return photoOrYear.year
      ? `/api/photos/${photoOrYear.year}/${photoOrYear.filename}`
      : `/api/photos/${photoOrYear.filename}`;
  }
  return photoOrYear ? `/api/photos/${photoOrYear}/${filename}` : `/api/photos/${filename}`;
}

async function parseJSON(response, fallbackMessage) {
  if (!response.ok) {
    throw new Error(fallbackMessage);
  }
  return response.json();
}

export async function fetchPhotoPage({
  cursor = "",
  limit = 120,
  search = "",
  year = "",
  status = "",
} = {}) {
  const params = new URLSearchParams({
    format: "page",
    limit: String(limit),
  });

  if (cursor) params.set("cursor", cursor);
  if (search) params.set("search", search);
  if (year) params.set("year", year);
  if (status) params.set("status", status);

  const response = await fetch(`/api/photos?${params.toString()}`);
  const data = await parseJSON(response, "Failed to load photos");
  return {
    items: data.items || [],
    nextCursor: data.next_cursor || "",
    hasMore: Boolean(data.has_more),
    totalCount: data.total_count || 0,
    hiddenCount: data.hidden_count || 0,
    years: data.years || [],
  };
}

export async function savePhoto(photo, updates) {
  const response = await fetch(buildPhotoResourcePath(photo), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  return parseJSON(response, "Failed to update photo");
}

export async function deletePhoto(photo) {
  const response = await fetch(buildPhotoResourcePath(photo), {
    method: "DELETE",
  });
  return parseJSON(response, "Failed to delete photo");
}

export async function batchUpdatePhotos(filenames, updates) {
  const response = await fetch("/api/photos/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filenames, updates }),
  });
  return parseJSON(response, "Failed to batch update");
}

export async function startRebuild() {
  const response = await fetch("/api/rebuild", { method: "POST" });
  return parseJSON(response, "Failed to start rebuild");
}

export async function fetchRebuildStatus() {
  const response = await fetch("/api/rebuild/status");
  return parseJSON(response, "Failed to fetch rebuild status");
}

export async function uploadPhoto(file) {
  const formData = new FormData();
  formData.append("photo", file);

  const response = await fetch("/api/photos/upload", {
    method: "POST",
    body: formData,
  });
  return parseJSON(response, "Failed to upload photo");
}
