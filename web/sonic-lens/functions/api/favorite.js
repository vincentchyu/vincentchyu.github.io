export async function onRequest(context) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json"
  };

  return Response.json(
    { 
      apple_music: false, 
      lastfm: false,
      message: "Favorite/Love action is not persistent in the Cloudflare static version." 
    }, 
    { status: 200, headers }
  );
}
