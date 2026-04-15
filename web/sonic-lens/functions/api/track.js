export async function onRequest(context) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=3600" // 详细信息缓存久一点
  };

  try {
    const db = context.env.DB;
    const url = new URL(context.request.url);
    const artist = url.searchParams.get("artist");
    const album = url.searchParams.get("album");
    const trackName = url.searchParams.get("trackName");

    if (!artist || !trackName) {
         return Response.json({ error: "Missing parameters" }, { status: 400, headers });
    }

    const track = await db.prepare(`
      SELECT * FROM tracks 
      WHERE artist = ? AND track = ? 
      LIMIT 1
    `).bind(artist, trackName).first();

    if (!track) {
         return Response.json({ error: "Track not found" }, { status: 404, headers });
    }

    return Response.json(track, { headers });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500, headers });
  }
}
