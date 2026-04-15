export async function onRequest(context) {
  // 设置 CORS 头
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "public, max-age=300" // 缓存5分钟
  };

  try {
    const db = context.env.DB;

    // 并行执行多个查询以提高性能
    const [
      totalPlaysResult,
      totalTracksResult,
      totalArtistsResult,
      topArtistsResult,
      topAlbumsResult,
      recentTracksResult
    ] = await Promise.all([
      // 1. 总播放次数 (基于 tracks 表的 play_count 累加)
      db.prepare("SELECT SUM(play_count) as count FROM tracks").first(),
      
      // 2. 总曲目数
      db.prepare("SELECT COUNT(*) as count FROM tracks").first(),
      
      // 3. 总艺术家数
      db.prepare("SELECT COUNT(DISTINCT artist) as count FROM tracks").first(),
      
      // 4. 热门艺术家 (前 10)
      db.prepare(`
        SELECT artist, SUM(play_count) as count 
        FROM tracks 
        GROUP BY artist 
        ORDER BY count DESC 
        LIMIT 10
      `).all(),
      
      // 5. 热门专辑 (前 10)
      db.prepare(`
        SELECT album, artist, SUM(play_count) as count 
        FROM tracks 
        GROUP BY album 
        ORDER BY count DESC 
        LIMIT 10
      `).all(),
      
      // 6. 最近播放 (基于 updated_at，因为我们没有实时同步 play_records 表，
      //    或者如果有 track_play_records 表，应该用那个)
      //    这里优先使用 track_play_records 如果有数据，否则回退到 tracks (这只是一个演示)
      //    既然我们已经同步了 track_play_records，就使用它
      db.prepare(`
        SELECT artist, track, album, play_time, source 
        FROM track_play_records 
        ORDER BY play_time DESC 
        LIMIT 5
      `).all()
    ]);

    const responseData = {
      summary: {
        total_plays: totalPlaysResult ? totalPlaysResult.count : 0,
        total_tracks: totalTracksResult ? totalTracksResult.count : 0,
        total_artists: totalArtistsResult ? totalArtistsResult.count : 0,
      },
      top_artists: topArtistsResult.results,
      top_albums: topAlbumsResult.results,
      recent_tracks: recentTracksResult.results
    };

    return Response.json(responseData, { headers });

  } catch (err) {
    return Response.json({ error: err.message }, { status: 500, headers });
  }
}
