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
    const type = context.params.type; // 'plays' or 'tracks'

    let query = "";
    if (type === "tracks") {
      query = `
        SELECT artist, COUNT(*) as track_count 
        FROM tracks 
        GROUP BY artist 
        ORDER BY track_count DESC 
        LIMIT ?
      `;
    } else {
      // default to plays
      query = `
        SELECT artist, SUM(play_count) as play_count 
        FROM tracks 
        GROUP BY artist 
        ORDER BY play_count DESC 
        LIMIT ?
      `;
    }

    const { results } = await db.prepare(query).bind(limit).all();

    return Response.json(results, { headers });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500, headers });
  }
}
