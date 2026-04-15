export async function onRequest(context) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=60"
  };

  try {
    const db = context.env.DB;
    const url = new URL(context.request.url);
    const limit = parseInt(url.searchParams.get("limit") || "10");
    const offset = parseInt(url.searchParams.get("offset") || "0");

    const { results } = await db.prepare(`
        SELECT * FROM track_play_records 
        WHERE scrobbled = 0 
        ORDER BY play_time DESC 
        LIMIT ? OFFSET ?
    `).bind(limit, offset).all();

    return Response.json(results, { headers });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500, headers });
  }
}
