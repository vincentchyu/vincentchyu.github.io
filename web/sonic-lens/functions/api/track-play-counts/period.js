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
    const offset = parseInt(url.searchParams.get("offset") || "0");
    const period = url.searchParams.get("period") || "week";

    let days = 7;
    if (period === "month") days = 30;
    else if (period === "year") days = 365;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString();

    // 周期榜：查 track_play_records 聚合
    const { results } = await db.prepare(`
      SELECT artist, album, track, COUNT(*) as play_count
      FROM track_play_records
      WHERE play_time >= ?
      GROUP BY artist, album, track
      ORDER BY play_count DESC
      LIMIT ? OFFSET ?
    `).bind(startDateStr, limit, offset).all();

    return Response.json(results, { headers });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500, headers });
  }
}
