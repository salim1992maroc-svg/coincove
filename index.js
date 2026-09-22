const APP_NAME = "Coin Cove";
const POINTS_NAME = "Coins";
const AD_REWARD_COINS = 10;
const DAILY_AD_LIMIT = 10;
const AD_COOLDOWN_SECONDS = 30;

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
      if (url.pathname === "/api/reward-ad") return await rewardAd(request, env);
      if (url.pathname === "/monetag/postback") return await monetagPostback(request, env);
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

async function rewardAd(request, env) {
  // IMPORTANT:
  // This endpoint does NOT credit Coins.
  // Monetag server-side postback is the only source that credits rewarded ads.
  if (request.method !== "POST") {
    return json({ success: false, message: "Method not allowed." }, 405);
  }

  if (!env.DB || !env.BOT_TOKEN) {
    return json({ success: false, message: "Server configuration is incomplete." }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch (error) {
    return json({
      success: false,
      code: "INVALID_JSON",
      message: "Invalid request body."
    }, 400);
  }

  const initData = typeof body?.initData === "string"
    ? body.initData.trim()
    : "";

  if (!initData) {
    return json({
      success: false,
      code: "MISSING_INIT_DATA",
      message: "Telegram authorization data is missing."
    }, 401);
  }

  const telegramData = await validateTelegramInitData(
    initData,
    env.BOT_TOKEN
  );

  if (!telegramData) {
    return json({
      success: false,
      code: "INVALID_INIT_DATA",
      message: "Invalid Telegram authorization."
    }, 401);
  }

  await ensureAdRewardTable(env.DB);

  const telegramId = String(telegramData.user.id);

  const user = await env.DB
    .prepare("SELECT id FROM users WHERE telegram_id = ? LIMIT 1")
    .bind(telegramId)
    .first();

  if (!user) {
    return json({
      success: false,
      code: "USER_NOT_FOUND",
      message: "User account was not found."
    }, 404);
  }

  return json({
    success: true,
    rewarded: 0,
    pending: true,
    message: "Ad completed. Waiting for Monetag server confirmation."
  });
}

async function monetagPostback(request, env) {
  if (request.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (!env.DB) {
    return new Response("database configuration error", { status: 500 });
  }

  const q = new URL(request.url).searchParams;

  // Support both the macro names documented by Monetag and the
  // event_type/reward_event_type names configured for this zone.
  const ymid = (q.get("ymid") || "").trim();
  const event = (q.get("event") || q.get("event_type") || "").trim().toLowerCase();
  const rewardEventType = (q.get("reward_event_type") || "").trim().toLowerCase();
  const zoneId = (q.get("zone_id") || "").trim();
  const telegramId = (q.get("telegram_id") || "").trim();
  const estimatedPriceRaw = q.get("estimated_price");

  if (!ymid || !zoneId || !telegramId) {
    return new Response("bad request", { status: 400 });
  }

  // Only accept callbacks from our Monetag zone.
  if (zoneId !== "11766606") {
    return new Response("invalid zone", { status: 403 });
  }

  // Monetag postbacks can be sent for different event types.
  // The configured rewarded-ad postback should use an impression/view event.
  // We accept the common impression/view names and also a reward_event_type
  // when Monetag explicitly marks the callback as a reward event.
  const acceptedEvents = new Set([
    "impression",
    "view",
    "viewed",
    "reward",
    "rewarded"
  ]);

  const acceptedRewardEvents = new Set([
    "reward",
    "rewarded",
    "impression",
    "view",
    "viewed"
  ]);

  const eventAccepted =
    acceptedEvents.has(event) ||
    (!event && acceptedRewardEvents.has(rewardEventType)) ||
    acceptedRewardEvents.has(rewardEventType);

  if (!eventAccepted) {
    // Do not reward click-only/unknown callbacks.
    return new Response("ignored", { status: 200 });
  }

  await ensureMonetagTable(env.DB);
  await ensureAdRewardTable(env.DB);

  const user = await env.DB
    .prepare("SELECT id FROM users WHERE telegram_id = ? LIMIT 1")
    .bind(telegramId)
    .first();

  if (!user) {
    return new Response("unknown user", { status: 404 });
  }

  // ymid identifies the Monetag user/session in the postback; it is not
  // necessarily unique per ad impression. Build an event fingerprint from
  // the complete normalized query string so an exact retry is idempotent
  // while the same user can still earn from later ads.
  const eventKey = await sha256Hex(
    Array.from(q.entries())
      .sort(function (a, b) {
        if (a[0] === b[0]) return a[1].localeCompare(b[1]);
        return a[0].localeCompare(b[0]);
      })
      .map(function (entry) {
        return entry[0] + "=" + entry[1];
      })
      .join("&")
  );

  const existing = await env.DB
    .prepare("SELECT id FROM monetag_postbacks WHERE event_key = ? LIMIT 1")
    .bind(eventKey)
    .first();

  if (existing) {
    return new Response("ok", { status: 200 });
  }

  const now = Math.floor(Date.now() / 1000);
  const today = new Date().toISOString().slice(0, 10);
  const reward = AD_REWARD_COINS;

  const estimatedPrice =
    estimatedPriceRaw === null || estimatedPriceRaw === ""
      ? null
      : Number(estimatedPriceRaw);

  if (
    estimatedPrice !== null &&
    (!Number.isFinite(estimatedPrice) || estimatedPrice < 0)
  ) {
    return new Response("invalid estimated_price", { status: 400 });
  }

  // Enforce the same daily limit and cooldown on the server.
  const daily = await env.DB
    .prepare(
      "SELECT COUNT(*) AS count FROM monetag_postbacks WHERE telegram_id = ? AND reward_date = ?"
    )
    .bind(telegramId, today)
    .first();

  const dailyCount = Number(daily?.count || 0);

  if (dailyCount >= DAILY_AD_LIMIT) {
    return new Response("daily limit reached", { status: 200 });
  }

  const last = await env.DB
    .prepare(
      "SELECT created_at FROM monetag_postbacks WHERE telegram_id = ? ORDER BY id DESC LIMIT 1"
    )
    .bind(telegramId)
    .first();

  const lastCreated = Number(last?.created_at || 0);

  if (lastCreated && now - lastCreated < AD_COOLDOWN_SECONDS) {
    return new Response("cooldown", { status: 200 });
  }

  try {
    // Insert the postback and credit the wallet in one D1 batch.
    // If any statement fails, the batch is not considered successful.
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO monetag_postbacks
        (event_key, ymid, telegram_id, user_id, event_type, reward_event_type,
         zone_id, estimated_price, reward_date, rewarded, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        eventKey,
        ymid,
        telegramId,
        user.id,
        event || null,
        rewardEventType || null,
        zoneId,
        estimatedPrice,
        today,
        reward,
        now
      ),

      env.DB.prepare(`
        UPDATE wallets
        SET
          balance = balance + ?,
          lifetime_earned = lifetime_earned + ?,
          updated_at = ?
        WHERE user_id = ?
      `).bind(reward, reward, now, user.id),

      env.DB.prepare(`
        INSERT INTO transactions
        (user_id, type, amount, description, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).bind(
        user.id,
        "monetag_ad_reward",
        reward,
        "Monetag rewarded ad",
        now
      )
    ]);

    return new Response("ok", { status: 200 });
  } catch (error) {
    const message = String(error?.message || "").toLowerCase();

    // A duplicate ymid can happen if Monetag retries the same postback.
    // It is already safely credited or being processed, so acknowledge it.
    if (message.includes("unique") || message.includes("constraint")) {
      return new Response("ok", { status: 200 });
    }

    console.error("Monetag postback error:", error);
    return new Response("server error", { status: 500 });
  }
}

async function ensureMonetagTable(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS monetag_postbacks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_key TEXT NOT NULL UNIQUE,
      ymid TEXT NOT NULL,
      telegram_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      event_type TEXT,
      reward_event_type TEXT,
      zone_id TEXT NOT NULL,
      estimated_price REAL,
      reward_date TEXT NOT NULL,
      rewarded INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )
  `).run();

  await db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_monetag_postbacks_user_date
    ON monetag_postbacks(telegram_id, reward_date)
  `).run();
}

async function ensureAdRewardTable(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS ad_rewards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reward_id TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      reward_date TEXT NOT NULL,
      amount REAL NOT NULL,
      created_at INTEGER NOT NULL
    )
  `).run();

  await db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_ad_rewards_user_date
    ON ad_rewards(user_id, reward_date)
  `).run();

  await db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_ad_rewards_user_created
    ON ad_rewards(user_id, created_at)
  `).run();
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

async function sha256Hex(message) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(message)
  );

  return Array.from(new Uint8Array(digest))
    .map(function (byte) {
      return byte.toString(16).padStart(2, "0");
    })
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

const APP_HTML = String.raw`"<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover">
<title>Coin Cove</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<script src="https://libtl.com/sdk.js" data-zone="11766606" data-sdk="show_11766606"></script>
<style>
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;min-height:100%;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}
body{background:var(--tg-theme-bg-color,#f5f7fb);color:var(--tg-theme-text-color,#111827)}
.app{max-width:560px;margin:auto;min-height:100vh;padding:calc(18px + env(safe-area-inset-top)) 16px calc(90px + env(safe-area-inset-bottom))}
.header{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px}
.brand{display:flex;align-items:center;gap:10px}
.logo{width:44px;height:44px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:24px;background:#111827;color:#fff}
.brand-title{font-size:20px;font-weight:800}
.brand-subtitle{font-size:12px;opacity:.55;margin-top:2px}
.profile{width:42px;height:42px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(127,127,127,.12);font-weight:700}
.balance-card{border-radius:24px;padding:24px;background:#111827;color:#fff;margin-bottom:18px;box-shadow:0 12px 30px rgba(0,0,0,.12)}
.balance-label{font-size:13px;opacity:.65}
.balance{font-size:38px;font-weight:850;margin-top:6px;letter-spacing:-1px}
.balance-name{font-size:13px;opacity:.65;margin-top:2px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.card{border:0;border-radius:20px;padding:20px 16px;text-align:left;background:var(--tg-theme-secondary-bg-color,#fff);color:var(--tg-theme-text-color,#111827);box-shadow:0 5px 18px rgba(0,0,0,.05);cursor:pointer}
.card:active{transform:scale(.98)}
.icon{font-size:27px;margin-bottom:12px}
.card-title{font-size:15px;font-weight:800}
.card-text{font-size:12px;opacity:.55;margin-top:5px;line-height:1.4}
.section{margin-top:24px}
.section-title{font-size:17px;font-weight:800;margin-bottom:12px}
.stats{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
.stat{background:var(--tg-theme-secondary-bg-color,#fff);border-radius:18px;padding:16px}
.stat-number{font-size:20px;font-weight:800}
.stat-label{font-size:11px;opacity:.55;margin-top:4px}
.bottom{position:fixed;left:0;right:0;bottom:0;padding:10px 16px calc(10px + env(safe-area-inset-bottom));background:rgba(245,247,251,.9);backdrop-filter:blur(14px)}
.bottom-inner{max-width:560px;margin:auto;display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
.nav{border:0;background:transparent;color:var(--tg-theme-hint-color,#6b7280);padding:8px 2px;border-radius:12px;font-size:11px;cursor:pointer}
.nav-icon{display:block;font-size:20px;margin-bottom:3px}
.nav.active{color:var(--tg-theme-text-color,#111827);font-weight:800}
.loading{min-height:100vh;display:flex;align-items:center;justify-content:center;font-size:14px;opacity:.6}
.error{padding:30px 20px;text-align:center}
button{font-family:inherit}
.wall{position:fixed;inset:0;background:var(--tg-theme-bg-color,#f5f7fb);z-index:10;display:flex;flex-direction:column}
.wall-head{height:54px;display:flex;align-items:center;padding:0 12px;border-bottom:1px solid rgba(127,127,127,.12);flex:none}
.wall-head button{border:0;background:transparent;font-size:24px;padding:6px}
.wall-title{font-weight:800;margin-left:4px}
.wall-frame{width:100%;height:calc(100% - 54px);border:0;flex:1}
</style>
</head>
<body>
<div id="app"><div class="loading">Loading Coin Cove...</div></div>

<script>
(function () {
  const tg = window.Telegram && window.Telegram.WebApp;

  if (tg) {
    try {
      tg.ready();
      tg.expand();
      if (tg.themeParams && tg.themeParams.bg_color) {
        tg.setHeaderColor(tg.themeParams.bg_color);
      }
    } catch (e) {
      console.error("Telegram WebApp init error:", e);
    }
  }

  let currentUser = null;

  function getInitData() {
    if (tg && typeof tg.initData === "string" && tg.initData.trim()) {
      return tg.initData.trim();
    }

    return "";
  }

  async function loadApp() {
    const initData = getInitData();

    if (!initData) {
      showError(
        "Open Coin Cove from the Telegram bot. Direct browser access does not provide Telegram authorization data."
      );
      return;
    }

    try {
      const response = await fetch("/api/me", {
        method: "GET",
        headers: {
          "X-Telegram-Init-Data": initData
        },
        cache: "no-store"
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        console.error("API /api/me:", data);
        showError(data.message || "Unable to load your account.");
        return;
      }

      currentUser = data.user;
      render(data);
    } catch (error) {
      console.error("loadApp error:", error);
      showError("Unable to connect to Coin Cove.");
    }
  }

  function render(data) {
    const user = data.user || {};
    const wallet = data.wallet || {};
    const referrals = data.referrals || {};

    const first = escapeHtml(user.first_name || "there");
    const initial = escapeHtml(
      (user.first_name || "C").charAt(0).toUpperCase()
    );

    const balance = Number(wallet.balance || 0).toLocaleString();
    const earned = Number(wallet.lifetime_earned || 0).toLocaleString();

    const transactions = Array.isArray(data.transactions)
      ? data.transactions
      : [];

    const activity = transactions.length
      ? transactions.map(function (tx) {
          const amount = Number(tx.amount || 0);

          return (
            '<div style="display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid rgba(127,127,127,.12)">' +
              '<div>' +
                '<div style="font-weight:700;font-size:13px">' +
                  escapeHtml(tx.description || tx.type || "Transaction") +
                '</div>' +
                '<div style="font-size:10px;opacity:.5">' +
                  formatDate(tx.created_at) +
                '</div>' +
              '</div>' +
              '<div style="font-weight:800">' +
                (amount > 0 ? "+" : "") +
                escapeHtml(String(amount)) +
              '</div>' +
            '</div>'
          );
        }).join("")
      : '<div style="text-align:center;opacity:.5;padding:15px">No activity yet</div>';

    document.getElementById("app").innerHTML =
      '<div class="app">' +
        '<div class="header">' +
          '<div class="brand">' +
            '<div class="logo">🪙</div>' +
            '<div>' +
              '<div class="brand-title">Coin Cove</div>' +
              '<div class="brand-subtitle">Earn • Complete • Reward</div>' +
            '</div>' +
          '</div>' +
          '<div class="profile">' + initial + '</div>' +
        '</div>' +

        '<div class="balance-card">' +
          '<div class="balance-label">Welcome back, ' + first + '</div>' +
          '<div class="balance">' + balance + '</div>' +
          '<div class="balance-name">Coins</div>' +
        '</div>' +

        '<div class="grid">' +
          '<button class="card" onclick="openOffers()">' +
            '<div class="icon">🎁</div>' +
            '<div class="card-title">Earn Offers</div>' +
            '<div class="card-text">Complete offers and earn Coins</div>' +
          '</button>' +

          '<button class="card" onclick="watchAd()">' +
            '<div class="icon">📺</div>' +
            '<div class="card-title">Watch & Earn</div>' +
            '<div class="card-text">Watch limited rewarded ads</div>' +
          '</button>' +

          '<button class="card" onclick="openSection(\'referral\')">' +
            '<div class="icon">👥</div>' +
            '<div class="card-title">Invite Friends</div>' +
            '<div class="card-text">Invite friends and earn</div>' +
          '</button>' +

          '<button class="card" onclick="openSection(\'withdraw\')">' +
            '<div class="icon">💸</div>' +
            '<div class="card-title">Withdraw</div>' +
            '<div class="card-text">Request your reward</div>' +
          '</button>' +
        '</div>' +

        '<div class="section">' +
          '<div class="section-title">Your Activity</div>' +
          '<div class="stats">' +
            '<div class="stat">' +
              '<div class="stat-number">' + earned + '</div>' +
              '<div class="stat-label">Lifetime Earned</div>' +
            '</div>' +
            '<div class="stat">' +
              '<div class="stat-number">' + Number(referrals.count || 0) + '</div>' +
              '<div class="stat-label">Friends Invited</div>' +
            '</div>' +
          '</div>' +
        '</div>' +

        '<div class="section">' +
          '<div class="section-title">Recent Activity</div>' +
          '<div class="stat">' + activity + '</div>' +
        '</div>' +
      '</div>' +

      '<div class="bottom">' +
        '<div class="bottom-inner">' +
          '<button class="nav active">' +
            '<span class="nav-icon">🏠</span>Home' +
          '</button>' +
          '<button class="nav" onclick="openOffers()">' +
            '<span class="nav-icon">🎁</span>Offers' +
          '</button>' +
          '<button class="nav" onclick="openSection(\'referral\')">' +
            '<span class="nav-icon">👥</span>Invite' +
          '</button>' +
          '<button class="nav" onclick="openSection(\'withdraw\')">' +
            '<span class="nav-icon">💰</span>Wallet' +
          '</button>' +
        '</div>' +
      '</div>';
  }

  window.openOffers = function () {
    if (!currentUser || !currentUser.telegram_id) {
      showError("User account is not ready.");
      return;
    }

    const uid = encodeURIComponent(String(currentUser.telegram_id));

    const wall =
      "https://offerwall.gg/wall/4c826098db679c99583194371d0eae1b?userId=" +
      uid;

    const existing = document.getElementById("offerWall");
    if (existing) existing.remove();

    document.body.insertAdjacentHTML(
      "beforeend",
      '<div class="wall" id="offerWall">' +
        '<div class="wall-head">' +
          '<button onclick="closeOffers()">‹</button>' +
          '<div class="wall-title">Earn Offers</div>' +
        '</div>' +
        '<iframe class="wall-frame" src="' + escapeAttribute(wall) + '" title="Coin Cove Offers"></iframe>' +
      '</div>'
    );
  };

  window.closeOffers = function () {
    const wall = document.getElementById("offerWall");
    if (wall) wall.remove();
  };

  let adBusy = false;

  window.watchAd = async function () {
    if (adBusy) return;

    if (!tg || !tg.initData) {
      showAlert("Open Coin Cove from Telegram to watch rewarded ads.");
      return;
    }

    if (typeof window.show_11766606 !== "function") {
      showAlert("The ad service is not ready yet. Please try again in a moment.");
      return;
    }

    adBusy = true;

    try {
      await window.show_11766606();

      const response = await fetch("/api/reward-ad", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache"
        },
        body: JSON.stringify({ initData: tg.initData }),
        cache: "no-store"
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        showAlert(data.message || "The ad was completed, but the reward could not be added.");
        return;
      }

      showAlert("🎉 +" + data.rewarded + " Coins added!\
Today: " + data.daily_count + "/" + data.daily_limit);
      await loadApp();
    } catch (error) {
      console.error("Monetag rewarded ad error:", error);
      showAlert("The ad was not completed. No Coins were added.");
    } finally {
      adBusy = false;
    }
  };

  async function waitForMonetagReward() {
    // The server-side Monetag postback is asynchronous.
    // Refresh the account a few times so the user sees the reward when it arrives.
    for (let i = 0; i < 6; i++) {
      await new Promise(function (resolve) {
        setTimeout(resolve, i === 0 ? 2000 : 3000);
      });

      try {
        const initData = getInitData();
        const response = await fetch("/api/me", {
          method: "GET",
          headers: {
            "X-Telegram-Init-Data": initData
          },
          cache: "no-store"
        });

        const data = await response.json();

        if (response.ok && data.success) {
          render(data);
        }
      } catch (error) {
        console.error("Reward refresh error:", error);
      }
    }
  }

  function showAlert(message) {
    if (tg && typeof tg.showAlert === "function") {
      tg.showAlert(message);
    } else {
      alert(message);
    }
  }

  window.openSection = function (section) {
    const messages = {
      referral: "Your referral system is being prepared.",
      withdraw: "Withdrawal options will be added in the next stage."
    };

    const message = messages[section] || "Coming soon.";

    if (tg && typeof tg.showAlert === "function") {
      tg.showAlert(message);
    } else {
      alert(message);
    }
  };

  function showError(message) {
    document.getElementById("app").innerHTML =
      '<div class="error">' +
        '<div style="font-size:48px">🪙</div>' +
        '<h2>Coin Cove</h2>' +
        '<p style="opacity:.6">' + escapeHtml(message) + '</p>' +
        '<button onclick="location.reload()" style="padding:10px 16px;border:0;border-radius:10px">Retry</button>' +
      '</div>';
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value);
  }

  function formatDate(timestamp) {
    if (!timestamp) return "";
    return new Date(Number(timestamp) * 1000).toLocaleDateString();
  }

  loadApp();
})();
</script>
</body>
</html>`;
