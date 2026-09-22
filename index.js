const APP_NAME = "Coin Cove";
const POINTS_NAME = "Coins";

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      if (url.pathname === "/api/health") {
        return json({
          success: true,
          app: APP_NAME,
          database: !!env.DB,
          botConfigured: !!env.BOT_TOKEN,
          offerwallConfigured: !!env.OFFERWALL_SECRET,
          time: Date.now()
        });
      }

      if (url.pathname === "/api/me") return await apiMe(request, env);
      if (url.pathname === "/api/offerwall/postback") return await offerwallPostback(request, env);

      return new Response(renderApp(), {
        headers: {
          "content-type": "text/html; charset=UTF-8",
          "cache-control": "no-store"
        }
      });
    } catch (error) {
      console.error("Worker error:", error);
      return json({ success: false, message: "Internal server error." }, 500);
    }
  }
};

async function apiMe(request, env) {
  if (request.method !== "GET") {
    return json({ success: false, message: "Method not allowed." }, 405);
  }

  if (!env.DB) {
    return json({ success: false, message: "Database binding DB is missing." }, 500);
  }

  if (!env.BOT_TOKEN) {
    return json({ success: false, message: "BOT_TOKEN secret is missing." }, 500);
  }

  const initData = getInitData(request);

  if (!initData) {
    return json({
      success: false,
      code: "MISSING_INIT_DATA",
      message: "Telegram authorization data is missing."
    }, 401);
  }

  const telegramData = await validateTelegramInitData(initData, env.BOT_TOKEN);

  if (!telegramData) {
    return json({
      success: false,
      code: "INVALID_INIT_DATA",
      message: "Invalid Telegram authorization."
    }, 401);
  }

  const user = telegramData.user;
  const now = Math.floor(Date.now() / 1000);
  const startParam = telegramData.start_param || null;

  let existing = await env.DB
    .prepare("SELECT * FROM users WHERE telegram_id = ?")
    .bind(String(user.id))
    .first();

  if (!existing) {
    const referralCode = generateReferralCode();
    let referredBy = null;

    if (startParam) {
      const referrer = await env.DB
        .prepare("SELECT id, telegram_id FROM users WHERE referral_code = ?")
        .bind(startParam)
        .first();

      if (referrer && String(referrer.telegram_id) !== String(user.id)) {
        referredBy = String(referrer.telegram_id);
      }
    }

    await env.DB.prepare(`
      INSERT INTO users
      (telegram_id, username, first_name, last_name, referral_code, referred_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      String(user.id),
      user.username || null,
      user.first_name || "",
      user.last_name || null,
      referralCode,
      referredBy,
      now,
      now
    ).run();

    existing = await env.DB
      .prepare("SELECT * FROM users WHERE telegram_id = ?")
      .bind(String(user.id))
      .first();

    await env.DB.prepare(`
      INSERT OR IGNORE INTO wallets
      (user_id, balance, lifetime_earned, lifetime_withdrawn, updated_at)
      VALUES (?, 0, 0, 0, ?)
    `).bind(existing.id, now).run();

    if (referredBy) {
      const referrer = await env.DB
        .prepare("SELECT id FROM users WHERE telegram_id = ?")
        .bind(referredBy)
        .first();

      if (referrer) {
        await env.DB.prepare(`
          INSERT OR IGNORE INTO referrals
          (referrer_id, referred_user_id, reward, created_at)
          VALUES (?, ?, 0, ?)
        `).bind(referrer.id, existing.id, now).run();
      }
    }
  }

  await env.DB.prepare(`
    UPDATE users
    SET username = ?, first_name = ?, last_name = ?, updated_at = ?
    WHERE telegram_id = ?
  `).bind(
    user.username || null,
    user.first_name || "",
    user.last_name || null,
    now,
    String(user.id)
  ).run();

  await env.DB.prepare(`
    INSERT OR IGNORE INTO wallets
    (user_id, balance, lifetime_earned, lifetime_withdrawn, updated_at)
    VALUES (?, 0, 0, 0, ?)
  `).bind(existing.id, now).run();

  const wallet = await env.DB
    .prepare("SELECT balance, lifetime_earned, lifetime_withdrawn FROM wallets WHERE user_id = ?")
    .bind(existing.id)
    .first();

  const transactions = await env.DB
    .prepare(`
      SELECT type, amount, description, created_at
      FROM transactions
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT 10
    `)
    .bind(existing.id)
    .all();

  const referralCount = await env.DB
    .prepare("SELECT COUNT(*) AS count FROM referrals WHERE referrer_id = ?")
    .bind(existing.id)
    .first();

  return json({
    success: true,
    user: {
      id: existing.id,
      telegram_id: String(user.id),
      username: user.username || "",
      first_name: user.first_name || "",
      last_name: user.last_name || "",
      referral_code: existing.referral_code
    },
    wallet: wallet || {
      balance: 0,
      lifetime_earned: 0,
      lifetime_withdrawn: 0
    },
    referrals: {
      count: Number(referralCount?.count || 0)
    },
    transactions: transactions.results || []
  });
}

async function offerwallPostback(request, env) {
  if (request.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (!env.DB || !env.OFFERWALL_SECRET) {
    return new Response("server configuration error", { status: 500 });
  }

  const q = new URL(request.url).searchParams;

  const userId = q.get("user") || "";
  const tx = q.get("tx") || "";
  const amountRaw = q.get("amount");
  const sig = q.get("sig") || "";
  const status = q.get("status") || "";
  const test = q.get("test") || "0";

  if (!userId || !tx || amountRaw === null || !sig) {
    return new Response("bad request", { status: 400 });
  }

  const expected = await hmacHexText(
    env.OFFERWALL_SECRET,
    `${userId}:${tx}:${amountRaw}`
  );

  if (!constantTimeEqual(expected, sig)) {
    return new Response("invalid signature", { status: 403 });
  }

  if (test === "1") {
    return new Response("ok", { status: 200 });
  }

  if (status !== "credited" && status !== "reversed") {
    return new Response("ok", { status: 200 });
  }

  const amount = Number(amountRaw);

  if (!Number.isFinite(amount) || amount === 0) {
    return new Response("ok", { status: 200 });
  }

  const user = await env.DB
    .prepare("SELECT id FROM users WHERE telegram_id = ? OR CAST(id AS TEXT) = ? LIMIT 1")
    .bind(String(userId), String(userId))
    .first();

  if (!user) {
    return new Response("unknown user", { status: 404 });
  }

  await ensureOfferwallTable(env.DB);

  try {
    await env.DB.prepare(`
      INSERT INTO offerwall_conversions
      (transaction_id, user_id, amount, status, offer_id, offer_name, goal_id, payout_usd, test, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      tx,
      user.id,
      amount,
      status,
      q.get("offerId"),
      q.get("offerName"),
      q.get("goalId"),
      Number(q.get("payoutUsd") || 0),
      0,
      Math.floor(Date.now() / 1000)
    ).run();
  } catch (error) {
    const message = String(error?.message || "").toLowerCase();

    if (message.includes("unique") || message.includes("constraint")) {
      return new Response("ok", { status: 200 });
    }

    throw error;
  }

  const now = Math.floor(Date.now() / 1000);

  await env.DB.prepare(`
    UPDATE wallets
    SET
      balance = balance + ?,
      lifetime_earned = CASE
        WHEN ? > 0 THEN lifetime_earned + ?
        ELSE lifetime_earned
      END,
      updated_at = ?
    WHERE user_id = ?
  `).bind(
    amount,
    amount,
    amount,
    now,
    user.id
  ).run();

  await env.DB.prepare(`
    INSERT INTO transactions
    (user_id, type, amount, description, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(
    user.id,
    status === "reversed" ? "offer_reversal" : "offer_reward",
    amount,
    status === "reversed" ? "Offer reversed" : "Offer reward",
    now
  ).run();

  return new Response("ok", { status: 200 });
}

async function ensureOfferwallTable(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS offerwall_conversions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      status TEXT NOT NULL,
      offer_id TEXT,
      offer_name TEXT,
      goal_id TEXT,
      payout_usd REAL DEFAULT 0,
      test INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `).run();
}

function getInitData(request) {
  const directHeader = request.headers.get("X-Telegram-Init-Data");
  if (directHeader && directHeader.trim()) {
    return directHeader.trim();
  }

  const authorization = request.headers.get("Authorization") || "";
  const lower = authorization.toLowerCase();

  if (lower.startsWith("tma ")) {
    return authorization.slice(4).trim();
  }

  const url = new URL(request.url);

  const fromQuery =
    url.searchParams.get("initData") ||
    url.searchParams.get("tgWebAppData") ||
    "";

  return fromQuery.trim();
}

async function validateTelegramInitData(initData, botToken) {
  if (!initData || !botToken) return null;

  try {
    const params = new URLSearchParams(initData);
    const receivedHash = params.get("hash");

    if (!receivedHash) return null;

    params.delete("hash");

    const entries = Array.from(params.entries()).sort((a, b) =>
      a[0].localeCompare(b[0])
    );

    const dataCheckString = entries
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");

    // Telegram Mini App secret key:
    // HMAC-SHA256(key="WebAppData", message=BOT_TOKEN)
    const secretKey = await hmacSha256(
      new TextEncoder().encode("WebAppData"),
      botToken
    );

    const calculatedHash = await hmacSha256Hex(
      secretKey,
      dataCheckString
    );

    if (!constantTimeEqual(calculatedHash, receivedHash)) {
      console.error("Telegram hash mismatch");
      return null;
    }

    const authDate = Number(params.get("auth_date"));
    const now = Math.floor(Date.now() / 1000);

    if (!Number.isFinite(authDate) || authDate <= 0) {
      return null;
    }

    if (authDate > now + 300) {
      return null;
    }

    if (now - authDate > 86400) {
      return null;
    }

    const userRaw = params.get("user");

    if (!userRaw) return null;

    const user = JSON.parse(userRaw);

    if (!user || !user.id) return null;

    return {
      user,
      start_param: params.get("start_param") || null
    };
  } catch (error) {
    console.error("Telegram validation error:", error);
    return null;
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
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacHexText(secret, message) {
  return hmacSha256Hex(
    new TextEncoder().encode(secret),
    message
  );
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

function generateReferralCode() {
  return crypto
    .randomUUID()
    .replace(/-/g, "")
    .substring(0, 12)
    .toUpperCase();
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store"
    }
  });
}

function renderApp() {
  return APP_HTML;
}

const APP_HTML = "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover\">\n<title>Coin Cove</title>\n<script src=\"https://telegram.org/js/telegram-web-app.js\"></script>\n<style>\n*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}\nhtml,body{margin:0;min-height:100%;font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,Arial,sans-serif}\nbody{background:var(--tg-theme-bg-color,#f5f7fb);color:var(--tg-theme-text-color,#111827)}\n.app{max-width:560px;margin:auto;min-height:100vh;padding:calc(18px + env(safe-area-inset-top)) 16px calc(90px + env(safe-area-inset-bottom))}\n.header{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px}\n.brand{display:flex;align-items:center;gap:10px}\n.logo{width:44px;height:44px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:24px;background:#111827;color:#fff}\n.brand-title{font-size:20px;font-weight:800}\n.brand-subtitle{font-size:12px;opacity:.55;margin-top:2px}\n.profile{width:42px;height:42px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(127,127,127,.12);font-weight:700}\n.balance-card{border-radius:24px;padding:24px;background:#111827;color:#fff;margin-bottom:18px;box-shadow:0 12px 30px rgba(0,0,0,.12)}\n.balance-label{font-size:13px;opacity:.65}\n.balance{font-size:38px;font-weight:850;margin-top:6px;letter-spacing:-1px}\n.balance-name{font-size:13px;opacity:.65;margin-top:2px}\n.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}\n.card{border:0;border-radius:20px;padding:20px 16px;text-align:left;background:var(--tg-theme-secondary-bg-color,#fff);color:var(--tg-theme-text-color,#111827);box-shadow:0 5px 18px rgba(0,0,0,.05);cursor:pointer}\n.card:active{transform:scale(.98)}\n.icon{font-size:27px;margin-bottom:12px}\n.card-title{font-size:15px;font-weight:800}\n.card-text{font-size:12px;opacity:.55;margin-top:5px;line-height:1.4}\n.section{margin-top:24px}\n.section-title{font-size:17px;font-weight:800;margin-bottom:12px}\n.stats{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}\n.stat{background:var(--tg-theme-secondary-bg-color,#fff);border-radius:18px;padding:16px}\n.stat-number{font-size:20px;font-weight:800}\n.stat-label{font-size:11px;opacity:.55;margin-top:4px}\n.bottom{position:fixed;left:0;right:0;bottom:0;padding:10px 16px calc(10px + env(safe-area-inset-bottom));background:rgba(245,247,251,.9);backdrop-filter:blur(14px)}\n.bottom-inner{max-width:560px;margin:auto;display:grid;grid-template-columns:repeat(4,1fr);gap:7px}\n.nav{border:0;background:transparent;color:var(--tg-theme-hint-color,#6b7280);padding:8px 2px;border-radius:12px;font-size:11px;cursor:pointer}\n.nav-icon{display:block;font-size:20px;margin-bottom:3px}\n.nav.active{color:var(--tg-theme-text-color,#111827);font-weight:800}\n.loading{min-height:100vh;display:flex;align-items:center;justify-content:center;font-size:14px;opacity:.6}\n.error{padding:30px 20px;text-align:center}\nbutton{font-family:inherit}\n.wall{position:fixed;inset:0;background:var(--tg-theme-bg-color,#f5f7fb);z-index:10;display:flex;flex-direction:column}\n.wall-head{height:54px;display:flex;align-items:center;padding:0 12px;border-bottom:1px solid rgba(127,127,127,.12);flex:none}\n.wall-head button{border:0;background:transparent;font-size:24px;padding:6px}\n.wall-title{font-weight:800;margin-left:4px}\n.wall-frame{width:100%;height:calc(100% - 54px);border:0;flex:1}\n</style>\n</head>\n<body>\n<div id=\"app\"><div class=\"loading\">Loading Coin Cove...</div></div>\n\n<script>\n(function () {\n  const tg = window.Telegram && window.Telegram.WebApp;\n\n  if (tg) {\n    try {\n      tg.ready();\n      tg.expand();\n      if (tg.themeParams && tg.themeParams.bg_color) {\n        tg.setHeaderColor(tg.themeParams.bg_color);\n      }\n    } catch (e) {\n      console.error(\"Telegram WebApp init error:\", e);\n    }\n  }\n\n  let currentUser = null;\n\n  function getInitData() {\n    if (tg && typeof tg.initData === \"string\" && tg.initData.trim()) {\n      return tg.initData.trim();\n    }\n\n    return \"\";\n  }\n\n  async function loadApp() {\n    const initData = getInitData();\n\n    if (!initData) {\n      showError(\n        \"Open Coin Cove from the Telegram bot. Direct browser access does not provide Telegram authorization data.\"\n      );\n      return;\n    }\n\n    try {\n      const response = await fetch(\"/api/me\", {\n        method: \"GET\",\n        headers: {\n          \"X-Telegram-Init-Data\": initData\n        },\n        cache: \"no-store\"\n      });\n\n      const data = await response.json();\n\n      if (!response.ok || !data.success) {\n        console.error(\"API /api/me:\", data);\n        showError(data.message || \"Unable to load your account.\");\n        return;\n      }\n\n      currentUser = data.user;\n      render(data);\n    } catch (error) {\n      console.error(\"loadApp error:\", error);\n      showError(\"Unable to connect to Coin Cove.\");\n    }\n  }\n\n  function render(data) {\n    const user = data.user || {};\n    const wallet = data.wallet || {};\n    const referrals = data.referrals || {};\n\n    const first = escapeHtml(user.first_name || \"there\");\n    const initial = escapeHtml(\n      (user.first_name || \"C\").charAt(0).toUpperCase()\n    );\n\n    const balance = Number(wallet.balance || 0).toLocaleString();\n    const earned = Number(wallet.lifetime_earned || 0).toLocaleString();\n\n    const transactions = Array.isArray(data.transactions)\n      ? data.transactions\n      : [];\n\n    const activity = transactions.length\n      ? transactions.map(function (tx) {\n          const amount = Number(tx.amount || 0);\n\n          return (\n            '<div style=\"display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid rgba(127,127,127,.12)\">' +\n              '<div>' +\n                '<div style=\"font-weight:700;font-size:13px\">' +\n                  escapeHtml(tx.description || tx.type || \"Transaction\") +\n                '</div>' +\n                '<div style=\"font-size:10px;opacity:.5\">' +\n                  formatDate(tx.created_at) +\n                '</div>' +\n              '</div>' +\n              '<div style=\"font-weight:800\">' +\n                (amount > 0 ? \"+\" : \"\") +\n                escapeHtml(String(amount)) +\n              '</div>' +\n            '</div>'\n          );\n        }).join(\"\")\n      : '<div style=\"text-align:center;opacity:.5;padding:15px\">No activity yet</div>';\n\n    document.getElementById(\"app\").innerHTML =\n      '<div class=\"app\">' +\n        '<div class=\"header\">' +\n          '<div class=\"brand\">' +\n            '<div class=\"logo\">🪙</div>' +\n            '<div>' +\n              '<div class=\"brand-title\">Coin Cove</div>' +\n              '<div class=\"brand-subtitle\">Earn • Complete • Reward</div>' +\n            '</div>' +\n          '</div>' +\n          '<div class=\"profile\">' + initial + '</div>' +\n        '</div>' +\n\n        '<div class=\"balance-card\">' +\n          '<div class=\"balance-label\">Welcome back, ' + first + '</div>' +\n          '<div class=\"balance\">' + balance + '</div>' +\n          '<div class=\"balance-name\">Coins</div>' +\n        '</div>' +\n\n        '<div class=\"grid\">' +\n          '<button class=\"card\" onclick=\"openOffers()\">' +\n            '<div class=\"icon\">🎁</div>' +\n            '<div class=\"card-title\">Earn Offers</div>' +\n            '<div class=\"card-text\">Complete offers and earn Coins</div>' +\n          '</button>' +\n\n          '<button class=\"card\" onclick=\"openSection(\\'ads\\')\">' +\n            '<div class=\"icon\">📺</div>' +\n            '<div class=\"card-title\">Watch & Earn</div>' +\n            '<div class=\"card-text\">Watch limited rewarded ads</div>' +\n          '</button>' +\n\n          '<button class=\"card\" onclick=\"openSection(\\'referral\\')\">' +\n            '<div class=\"icon\">👥</div>' +\n            '<div class=\"card-title\">Invite Friends</div>' +\n            '<div class=\"card-text\">Invite friends and earn</div>' +\n          '</button>' +\n\n          '<button class=\"card\" onclick=\"openSection(\\'withdraw\\')\">' +\n            '<div class=\"icon\">💸</div>' +\n            '<div class=\"card-title\">Withdraw</div>' +\n            '<div class=\"card-text\">Request your reward</div>' +\n          '</button>' +\n        '</div>' +\n\n        '<div class=\"section\">' +\n          '<div class=\"section-title\">Your Activity</div>' +\n          '<div class=\"stats\">' +\n            '<div class=\"stat\">' +\n              '<div class=\"stat-number\">' + earned + '</div>' +\n              '<div class=\"stat-label\">Lifetime Earned</div>' +\n            '</div>' +\n            '<div class=\"stat\">' +\n              '<div class=\"stat-number\">' + Number(referrals.count || 0) + '</div>' +\n              '<div class=\"stat-label\">Friends Invited</div>' +\n            '</div>' +\n          '</div>' +\n        '</div>' +\n\n        '<div class=\"section\">' +\n          '<div class=\"section-title\">Recent Activity</div>' +\n          '<div class=\"stat\">' + activity + '</div>' +\n        '</div>' +\n      '</div>' +\n\n      '<div class=\"bottom\">' +\n        '<div class=\"bottom-inner\">' +\n          '<button class=\"nav active\">' +\n            '<span class=\"nav-icon\">🏠</span>Home' +\n          '</button>' +\n          '<button class=\"nav\" onclick=\"openOffers()\">' +\n            '<span class=\"nav-icon\">🎁</span>Offers' +\n          '</button>' +\n          '<button class=\"nav\" onclick=\"openSection(\\'referral\\')\">' +\n            '<span class=\"nav-icon\">👥</span>Invite' +\n          '</button>' +\n          '<button class=\"nav\" onclick=\"openSection(\\'withdraw\\')\">' +\n            '<span class=\"nav-icon\">💰</span>Wallet' +\n          '</button>' +\n        '</div>' +\n      '</div>';\n  }\n\n  window.openOffers = function () {\n    if (!currentUser || !currentUser.telegram_id) {\n      showError(\"User account is not ready.\");\n      return;\n    }\n\n    const uid = encodeURIComponent(String(currentUser.telegram_id));\n\n    const wall =\n      \"https://offerwall.gg/wall/4c826098db679c99583194371d0eae1b?userId=\" +\n      uid;\n\n    const existing = document.getElementById(\"offerWall\");\n    if (existing) existing.remove();\n\n    document.body.insertAdjacentHTML(\n      \"beforeend\",\n      '<div class=\"wall\" id=\"offerWall\">' +\n        '<div class=\"wall-head\">' +\n          '<button onclick=\"closeOffers()\">‹</button>' +\n          '<div class=\"wall-title\">Earn Offers</div>' +\n        '</div>' +\n        '<iframe class=\"wall-frame\" src=\"' + escapeAttribute(wall) + '\" title=\"Coin Cove Offers\"></iframe>' +\n      '</div>'\n    );\n  };\n\n  window.closeOffers = function () {\n    const wall = document.getElementById(\"offerWall\");\n    if (wall) wall.remove();\n  };\n\n  window.openSection = function (section) {\n    const messages = {\n      ads: \"Rewarded ads will be connected in the next stage.\",\n      referral: \"Your referral system is being prepared.\",\n      withdraw: \"Withdrawal options will be added in the next stage.\"\n    };\n\n    const message = messages[section] || \"Coming soon.\";\n\n    if (tg && typeof tg.showAlert === \"function\") {\n      tg.showAlert(message);\n    } else {\n      alert(message);\n    }\n  };\n\n  function showError(message) {\n    document.getElementById(\"app\").innerHTML =\n      '<div class=\"error\">' +\n        '<div style=\"font-size:48px\">🪙</div>' +\n        '<h2>Coin Cove</h2>' +\n        '<p style=\"opacity:.6\">' + escapeHtml(message) + '</p>' +\n        '<button onclick=\"location.reload()\" style=\"padding:10px 16px;border:0;border-radius:10px\">Retry</button>' +\n      '</div>';\n  }\n\n  function escapeHtml(value) {\n    return String(value == null ? \"\" : value)\n      .replaceAll(\"&\", \"&amp;\")\n      .replaceAll(\"<\", \"&lt;\")\n      .replaceAll(\">\", \"&gt;\")\n      .replaceAll('\"', \"&quot;\")\n      .replaceAll(\"'\", \"&#039;\");\n  }\n\n  function escapeAttribute(value) {\n    return escapeHtml(value);\n  }\n\n  function formatDate(timestamp) {\n    if (!timestamp) return \"\";\n    return new Date(Number(timestamp) * 1000).toLocaleDateString();\n  }\n\n  loadApp();\n})();\n</script>\n</body>\n</html>";
