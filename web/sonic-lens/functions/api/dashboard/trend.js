export async function onRequest(context) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=60"
  };

  try {
    const db = context.env.DB;
    const url = new URL(context.request.url);
    const range = parseInt(url.searchParams.get("range") || "30");

    // 计算起始日期
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - range);
    const startDateStr = startDate.toISOString();

    // 查询每天每小时的播放量
    // 聚合 track_play_records
    const { results } = await db.prepare(`
      SELECT 
        strftime('%Y-%m-%d', play_time) as date,
        strftime('%H', play_time) as hour,
        COUNT(*) as count
      FROM track_play_records
      WHERE play_time >= ?
      GROUP BY date, hour
      ORDER BY date, hour
    `).bind(startDateStr).all();

    // 格式化为前端需要的格式
    // data.hourly[date] = { total: 0, hourly: { "00": 0, "01": 0... } }
    const hourlyData = {};

    results.forEach(row => {
      const date = row.date;
      const hour = row.hour;
      const count = row.count;

      if (!hourlyData[date]) {
        hourlyData[date] = { total: 0, hourly: {} };
        // 初始化 0-23 小时
        for (let i = 0; i < 24; i++) {
          hourlyData[date].hourly[i.toString().padStart(2, '0')] = 0;
        }
      }

      hourlyData[date].hourly[hour] = count;
      hourlyData[date].total += count;
    });

    return Response.json({
      hourly: hourlyData
    }, { headers });

  } catch (err) {
    return Response.json({ error: err.message }, { status: 500, headers });
  }
}
