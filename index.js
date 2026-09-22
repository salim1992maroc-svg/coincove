export default {
  async fetch(request, env) {
    const tg = "https://telegram.org/js/telegram-web-app.js";

    return new Response(`<!doctype html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Telegram Test</title>
  <script src="${tg}"></script>
</head>
<body style="font-family:Arial;padding:20px">
  <h2>Coin Cove - Telegram Test</h2>

  <div id="result">Testing...</div>

  <script>
    const tg = window.Telegram && window.Telegram.WebApp;
    const result = document.getElementById("result");

    if (!tg) {
      result.innerHTML = "<b>Telegram: NO</b>";
    } else {
      tg.ready();
      tg.expand();

      const hasInitData =
        typeof tg.initData === "string" &&
        tg.initData.length > 0;

      const user =
        tg.initDataUnsafe &&
        tg.initDataUnsafe.user;

      result.innerHTML =
        "<p><b>Telegram:</b> YES</p>" +
        "<p><b>initData:</b> " +
        (hasInitData ? "YES" : "NO") +
        "</p>" +
        "<p><b>initData length:</b> " +
        (tg.initData ? tg.initData.length : 0) +
        "</p>" +
        "<p><b>User:</b> " +
        (user
          ? user.first_name + " / ID " + user.id
          : "NO USER") +
        "</p>";
    }
  </script>
</body>
</html>`, {
      headers: {
        "content-type": "text/html; charset=UTF-8",
        "cache-control": "no-store"
      }
    });
  }
};
