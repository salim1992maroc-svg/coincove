const APP_NAME = "Coin Cove";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({
        success: true,
        app: APP_NAME,
        database: !!env.DB,
        botConfigured: !!env.BOT_TOKEN
      });
    }

    if (url.pathname === "/api/telegram-test") {
      return telegramTest(request, env);
    }

    return new Response(renderApp(), {
      headers: {
        "content-type": "text/html; charset=UTF-8",
        "cache-control": "no-store"
      }
    });
  }
};

async function telegramTest(request, env) {
  const initData = await readInitData(request);

  if (!initData) {
    return json({
      success: false,
      telegram: false,
      error: "NO_INIT_DATA"
    }, 401);
  }

  const validation = await validateTelegramInitData(
    initData,
    env.BOT_TOKEN
  );

  if (!validation.ok) {
    return json({
      success: false,
      telegram: true,
      initData: true,
      error: validation.code,
      message: validation.message
    }, 401);
  }

  return json({
    success: true,
    telegram: true,
    initData: true,
    message: "Telegram authentication OK",
    user: validation.data.user
  });
}

async function readInitData(request) {
  const header = request.headers.get("X-Telegram-Init-Data");

  if (header && header.trim()) {
    return header.trim();
  }

  const authorization = request.headers.get("Authorization") || "";

  if (authorization.toLowerCase().startsWith("tma ")) {
    return authorization.slice(4).trim();
  }

  if (request.method === "POST") {
    try {
      const contentType =
        (request.headers.get("content-type") || "").toLowerCase();

      if (contentType.includes("application/json")) {
        const body = await request.json();

        if (body && typeof body.initData === "string") {
          return body.initData.trim();
        }
      }
    } catch (e) {
      return "";
    }
  }

  const url = new URL(request.url);

  return (
    url.searchParams.get("initData") ||
    url.searchParams.get("tgWebAppData") ||
    ""
  ).trim();
}

async function validateTelegramInitData(initData, botToken) {
  try {
    const params = new URLSearchParams(initData);

    const receivedHash = params.get("hash");

    if (!receivedHash) {
      return {
        ok: false,
        code: "MISSING_HASH",
        message: "Telegram hash is missing."
      };
    }

    params.delete("hash");

    const entries = Array.from(params.entries())
      .sort((a, b) => {
        if (a[0] < b[0]) return -1;
        if (a[0] > b[0]) return 1;
        return 0;
      });

    const dataCheckString = entries
      .map(entry => entry[0] + "=" + entry[1])
      .join("\n");

    const secretKey = await hmacSha256(
      new TextEncoder().encode("WebAppData"),
      botToken
    );

    const calculatedHash = await hmacSha256Hex(
      secretKey,
      dataCheckString
    );

    if (
      calculatedHash.toLowerCase() !==
      receivedHash.toLowerCase()
    ) {
      return {
        ok: false,
        code: "TELEGRAM_HASH_MISMATCH",
        message: "Telegram hash mismatch."
      };
    }

    const userRaw = params.get("user");

    if (!userRaw) {
      return {
        ok: false,
        code: "TELEGRAM_USER_MISSING",
        message: "Telegram user data is missing."
      };
    }

    const user = JSON.parse(userRaw);

    return {
      ok: true,
      data: {
        user
      }
    };

  } catch (error) {
    console.error(error);

    return {
      ok: false,
      code: "TELEGRAM_VALIDATION_ERROR",
      message: "Telegram validation failed."
    };
  }
}

async function hmacSha256(keyBytes, message) {
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

async function hmacSha256Hex(keyBytes, message) {
  const signature = await hmacSha256(keyBytes, message);

  return Array.from(new Uint8Array(signature))
    .map(byte => byte.toString(16).padStart(2, "0"))
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

function renderApp() {
  return `<!doctype html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport"
content="width=device-width,initial-scale=1,maximum-scale=1">

<title>Coin Cove</title>

<script src="https://telegram.org/js/telegram-web-app.js"></script>

<style>
body {
  font-family: Arial, sans-serif;
  text-align: center;
  padding: 40px 20px;
}

button {
  padding: 14px 24px;
  border: 0;
  border-radius: 12px;
  font-size: 16px;
}
</style>

</head>

<body>

<h1>🪙 Coin Cove</h1>

<p id="status">Checking Telegram...</p>

<button onclick="testTelegram()">
Test Telegram
</button>

<script>

const tg = window.Telegram.WebApp;

tg.ready();
tg.expand();

async function testTelegram() {

  const initData = tg.initData;

  document.getElementById("status").innerText =
    "initData length: " + initData.length;

  if (!initData) {
    document.getElementById("status").innerText =
      "❌ NO INIT DATA";
    return;
  }

  const response = await fetch("/api/telegram-test", {
    method: "POST",

    headers: {
      "Content-Type": "application/json"
    },

    body: JSON.stringify({
      initData: initData
    })
  });

  const data = await response.json();

  document.getElementById("status").innerText =
    JSON.stringify(data, null, 2);
}

testTelegram();

</script>

</body>
</html>`;
}
