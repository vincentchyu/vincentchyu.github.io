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
    const days = parseInt(url.searchParams.get("days") || "30"); // 暂时未使用 days 过滤 tracks 表，因为 tracks 表只有 created_at/updated_at，没有 play_history

    // 如果要准确支持 days，应该从 track_play_records 聚合
    // 但前端之前的逻辑好像是从 tracks 表读的？
    // 这里我们尝试从 tracks 表读，忽略 days，或者如果 days 很短，可能需要 play records
    // 为了准确性，我们使用 tracks 表的 play_count (总榜)
    // 如果需要近期热门，应该查询 track_play_records
    
    // 检查是否有 track_play_records 表，如果有则使用它来支持 days 参数
    // 我们假设有
    
    let results;
    
    // 如果 days > 3650 (10年)，视作“所有时间”
    if (days > 3650) {
         ({ results } = await db.prepare(`
            SELECT album, artist, SUM(play_count) as play_count 
            FROM tracks 
            GROUP BY album, artist 
            ORDER BY play_count DESC 
            LIMIT ?
        `).bind(limit).all());
    } else {
        // 计算时间范围
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        const startDateStr = startDate.toISOString();

        ({ results } = await db.prepare(`
            SELECT album, album_artist as artist, COUNT(*) as play_count 
            FROM track_play_records 
            WHERE play_time >= ?
            GROUP BY album, album_artist 
            ORDER BY play_count DESC 
            LIMIT ?
        `).bind(startDateStr, limit).all());
    }

    return Response.json(results, { headers });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500, headers });
  }
}
