export async function onRequest(context) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "public, max-age=60" // 缓存1分钟
  };

  try {
    const db = context.env.DB;
    const url = new URL(context.request.url);
    
    // 分页参数
    const page = parseInt(url.searchParams.get("page") || "1");
    const limit = parseInt(url.searchParams.get("limit") || "20");
    const offset = (page - 1) * limit;

    // 查询最近播放记录
    const { results } = await db.prepare(`
      SELECT 
        artist, 
        track, 
        album, 
        album_artist,
        duration,
        play_time, 
        source 
      FROM track_play_records 
      ORDER BY play_time DESC 
      LIMIT ? OFFSET ?
    `).bind(limit, offset).all();

    return Response.json({
      page,
      limit,
      data: results
    }, { headers });

  } catch (err) {
    return Response.json({ error: err.message }, { status: 500, headers });
  }
}
