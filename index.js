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

    if (url.pathname === "/api/db-test") {
      return dbTest(env);
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

async function dbTest(env) {
  if (!env.DB) {
    return json({
      success: false,
      database: false,
      error: "DB_BINDING_MISSING"
    }, 500);
  }

  try {
    const result = await env.DB.prepare("SELECT 1 AS ok").first();

    return json({
      success: true,
      database: true,
      message: "D1 READ OK",
      result
    });
  } catch (error) {
    console.error("D1 error:", error);
    return json({
      success: false,
      database: true,
      error: String(error?.message || error)
    }, 500);
  }
}

async function telegramTest(request, env) {
  const initData = await readInitData(request);

  if (!initData) {
    return json({
      success: false,
      telegram: true,
      initData: false,
      error: "NO_INIT_DATA",
      message: "Open Coin Cove from the Telegram bot."
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
      const contentType = (
        request.headers.get("content-type") || ""
      ).toLowerCase();

      if (contentType.includes("application/json")) {
        const body = await request.json();

        if (body && typeof body.initData === "string") {
          return body.initData.trim();
        }
      }
    } catch (error) {
      console.error("Request body error:", error);
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
  if (!botToken) {
    return {
      ok: false,
      code: "MISSING_BOT_TOKEN",
      message: "BOT_TOKEN secret is missing."
    };
  }

  try {
    const params = new URLSearchParams(initData);
    const receivedHash = params.get("hash");

    if (!receivedHash || !/^[0-9a-fA-F]{64}$/.test(receivedHash)) {
      return {
        ok: false,
        code: "INVALID_HASH",
        message: "Telegram hash is missing or invalid."
      };
    }

    params.delete("hash");

    const entries = Array.from(params.entries()).sort((a, b) => {
      if (a[0] < b[0]) return -1;
      if (a[0] > b[0]) return 1;
      return 0;
    });

    const dataCheckString = entries
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");

    // Telegram Mini Apps validation:
    // secret_key = HMAC-SHA256(key="WebAppData", message=bot_token)
    // hash = HMAC-SHA256(key=secret_key, message=data_check_string)
    const secretKey = await hmacSha256(
      new TextEncoder().encode("WebAppData"),
      botToken
    );

    const calculatedHash = await hmacSha256Hex(
      secretKey,
      dataCheckString
    );

    if (!constantTimeEqual(
      calculatedHash.toLowerCase(),
      receivedHash.toLowerCase()
    )) {
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

    let user;

    try {
      user = JSON.parse(userRaw);
    } catch (error) {
      return {
        ok: false,
        code: "TELEGRAM_USER_INVALID",
        message: "Telegram user data is invalid."
      };
    }

    if (!user || user.id === undefined || user.id === null) {
      return {
        ok: false,
        code: "TELEGRAM_USER_INVALID",
        message: "Telegram user ID is missing."
      };
    }

    return {
      ok: true,
      data: { user }
    };
  } catch (error) {
    console.error("Telegram validation error:", error);

    return {
      ok: false,
      code: "TELEGRAM_VALIDATION_ERROR",
      message: "Unable to validate Telegram authorization."
    };
  }
}

async function hmacSha256(keyBytes, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
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

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;

  let result = 0;

  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
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
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>Coin Cove</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
body{font-family:Arial,sans-serif;text-align:center;padding:40px 20px;background:#f5f7fb;color:#111827}
.card{max-width:500px;margin:auto;background:white;border-radius:20px;padding:30px;box-shadow:0 8px 30px rgba(0,0,0,.08)}
button{padding:14px 24px;border:0;border-radius:12px;font-size:16px;background:#111827;color:white}
pre{text-align:left;white-space:pre-wrap;word-break:break-word;background:#f3f4f6;padding:15px;border-radius:12px}
</style>
</head>
<body>
<div class="card">
<h1>🪙 Coin Cove</h1>
<p id="status">Checking Telegram...</p>
<button id="test">Test Telegram</button>
</div>
<script>
(function(){
  const tg = window.Telegram && window.Telegram.WebApp;
  const status = document.getElementById("status");
  const button = document.getElementById("test");

  if (!tg) {
    status.textContent = "Telegram WebApp API not available.";
    return;
  }

  try {
    tg.ready();
    tg.expand();
  } catch (e) {
    console.error(e);
  }

  async function testTelegram() {
    const initData = typeof tg.initData === "string" ? tg.initData : "";

    status.textContent = "initData length: " + initData.length;

    if (!initData) {
      status.textContent = "NO INIT DATA - open from Telegram bot";
      return;
    }

    try {
      const response = await fetch("/api/telegram-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData })
      });

      const data = await response.json();
      status.innerHTML = "<pre>" + escapeHtml(JSON.stringify(data, null, 2)) + "</pre>";
    } catch (error) {
      status.textContent = "Request error: " + error.message;
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  button.addEventListener("click", testTelegram);
  testTelegram();
})();
</script>
</body>
</html>`;
}
