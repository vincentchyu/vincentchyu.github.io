export async function onRequest(context) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=300"
  };

  try {
    const db = context.env.DB;
    // 假设 track_play_records 有 source 字段，或者 tracks 有 source 字段
    // 这里使用 tracks 表的 play_count 聚合，因为它是总数
    const { results } = await db.prepare(`
      SELECT source, SUM(play_count) as count 
      FROM tracks 
      GROUP BY source
    `).all();

    const response = {};
    results.forEach(row => {
      // 规范化 source 名称
      let key = row.source || "Unknown";
      if (key.toLowerCase() === "apple music" || key === "applemusic") key = "Apple Music";
      else if (key.toLowerCase() === "audirvana") key = "Audirvana";
      else if (key.toLowerCase() === "roon") key = "Roon";
      
      response[key] = (response[key] || 0) + row.count;
    });

    return Response.json(response, { headers });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500, headers });
  }
}
