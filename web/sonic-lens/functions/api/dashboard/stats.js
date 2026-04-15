export async function onRequest(context) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET",
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=300" 
  };

  try {
    const db = context.env.DB;

    const [
      totalPlays,
      totalTracks,
      totalArtists,
      totalAlbums
    ] = await Promise.all([
      db.prepare("SELECT SUM(play_count) as count FROM tracks").first(),
      db.prepare("SELECT COUNT(*) as count FROM tracks").first(),
      db.prepare("SELECT COUNT(DISTINCT artist) as count FROM tracks").first(),
      db.prepare("SELECT COUNT(DISTINCT album) as count FROM tracks").first()
    ]);

    return Response.json({
      totalPlays: totalPlays?.count || 0,
      totalTracks: totalTracks?.count || 0,
      totalArtists: totalArtists?.count || 0,
      totalAlbums: totalAlbums?.count || 0
    }, { headers });

  } catch (err) {
    return Response.json({ error: err.message }, { status: 500, headers });
  }
}
