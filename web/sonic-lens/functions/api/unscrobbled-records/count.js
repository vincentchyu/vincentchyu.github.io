export async function onRequest(context) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=60"
  };

  try {
    const db = context.env.DB;
    // scrobbled = 0 or false
    const { results } = await db.prepare("SELECT COUNT(*) as count FROM track_play_records WHERE scrobbled = 0").first();

    return Response.json({ count: results?.count || 0 }, { headers });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500, headers });
  }
}
