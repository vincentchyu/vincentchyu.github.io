export async function onRequest(context) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json"
  };

  return Response.json(
    { 
      success_count: 0, 
      failed_count: 0, 
      message: "Syncing to Last.fm is not supported in the Cloudflare static version. Please use the local Go service." 
    }, 
    { status: 200, headers }
  );
}
