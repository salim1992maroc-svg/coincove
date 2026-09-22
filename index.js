export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/test") {
      const initData = await getInitData(request);

      if (!initData) {
        return json({
          success: false,
          error: "NO_INIT_DATA"
        }, 400);
      }

      const result = await validate(initData, env.BOT_TOKEN);

      return json(result, result.success ? 200 : 401);
    }

    return new Response(`<!doctype html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Coin Cove Hash Test</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
</head>

<body style="font-family:Arial;padding:20px">

<h2>Coin Cove Hash Test</h2>

<div id="result">Testing...</div>

<script>
const tg = window.Telegram.WebApp;

tg.ready();
tg.expand();

fetch("/api/test", {
  headers: {
    "X-Telegram-Init-Data": tg.initData
  },
  cache: "no-store"
})
.then(r => r.json())
.then(data => {
  document.getElementById("result").innerHTML =
    "<pre>" +
    JSON.stringify(data, null, 2) +
    "</pre>";
})
.catch(error => {
  document.getElementById("result").innerHTML =
    "<pre>" + error + "</pre>";
});
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

async function getInitData(request) {
  return request.headers.get("X-Telegram-Init-Data") || "";
}

async function validate(initData, botToken) {
  const token = String(botToken || "").trim();

  if (!token) {
    return {
      success: false,
      error: "BOT_TOKEN_MISSING"
    };
  }

  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");

  if (!receivedHash) {
    return {
      success: false,
      error: "HASH_MISSING"
    };
  }

  params.delete("hash");

  const entries = Array.from(params.entries()).sort((a, b) =>
    a[0].localeCompare(b[0])
  );

  const dataCheckString = entries
    .map(([key, value]) => key + "=" + value)
    .join("\n");

  const secretKey = await hmac(
    new TextEncoder().encode("WebAppData"),
    token
  );

  const calculatedHash = await hmacHex(
    secretKey,
    dataCheckString
  );

  return {
    success: calculatedHash.toLowerCase() === receivedHash.toLowerCase(),
    receivedHash: receivedHash,
    calculatedHash: calculatedHash,
    user: params.get("user") || null
  };
}

async function hmac(keyBytes, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    {
      name: "HMAC",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );

  return crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message)
  );
}

async function hmacHex(keyBytes, message) {
  const signature = await hmac(keyBytes, message);

  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store"
    }
  });
}
