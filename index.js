const APP_NAME = "Coin Cove";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return new Response(JSON.stringify({
        success: true,
        app: APP_NAME,
        database: !!env.DB
      }), {
        headers: {
          "content-type": "application/json"
        }
      });
    }

    return new Response(`<!doctype html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Coin Cove</title>
</head>
<body>

<div style="text-align:center;margin-top:50px;font-family:Arial">
  <h1>🪙 Coin Cove</h1>
  <p>Deploy OK</p>
  <p>Telegram test page</p>
</div>

</body>
</html>`, {
      headers: {
        "content-type": "text/html; charset=UTF-8"
      }
    });
  }
};
