export async function onRequest(context) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=300"
  };

  try {
    const db = context.env.DB;
    const url = new URL(context.request.url);
    const limit = parseInt(url.searchParams.get("limit") || "10");

    // 从 genres 表查询
    const { results } = await db.prepare(`
      SELECT name as track_genre_name, name_zh as genre_name_zh, play_count as track_genre_count
      FROM genres
      ORDER BY play_count DESC
      LIMIT ?
    `).bind(limit).all();

    return Response.json(results, { headers });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500, headers });
  }
}
