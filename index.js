const APP_NAME = "Coin Cove";
const POINTS_NAME = "Coins";
const AD_REWARD_COINS = 10;
const DAILY_AD_LIMIT = 10;
const AD_COOLDOWN_SECONDS = 30;
const MINI_APP_SHORT_NAME = "myapp";

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
      if (url.pathname === "/api/referral") return await apiReferral(request, env);
      if (url.pathname === "/api/reward-ad") return await rewardAd(request, env);
      if (url.pathname === "/monetag/postback") return await monetagPostback(request, env);
      if (url.pathname === "/api/offerwall/postback") return await offerwallPostback(request, env);
      if (url.pathname === "/api/admin") return await adminApi(request, env);
      if (url.pathname === "/api/withdraw") return await withdrawApi(request, env);

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
    transactions: transactions.results || [],
    isAdmin: String(env.ADMIN_CHAT_ID || "") === String(user.id)
  });
}

async function apiReferral(request, env) {
  if (request.method !== "GET") {
    return json({ success: false, message: "Method not allowed." }, 405);
  }

  if (!env.DB || !env.BOT_TOKEN) {
    return json({ success: false, message: "Server configuration is incomplete." }, 500);
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

  const telegramId = String(telegramData.user.id);
  const user = await env.DB
    .prepare("SELECT id, referral_code FROM users WHERE telegram_id = ? LIMIT 1")
    .bind(telegramId)
    .first();

  if (!user || !user.referral_code) {
    return json({ success: false, message: "User account is not ready yet." }, 404);
  }

  let botUsername = "";
  try {
    const response = await fetch("https://api.telegram.org/bot" + env.BOT_TOKEN + "/getMe", {
      method: "GET",
      headers: { "accept": "application/json" }
    });
    const result = await response.json();
    if (result && result.ok && result.result && result.result.username) {
      botUsername = String(result.result.username);
    }
  } catch (error) {
    console.error("Telegram getMe error:", error);
  }

  if (!botUsername) {
    return json({
      success: false,
      message: "Unable to determine the Telegram bot username right now."
    }, 502);
  }

  const shortName = String(env.MINI_APP_SHORT_NAME || MINI_APP_SHORT_NAME).trim();
  if (!shortName) {
    return json({
      success: false,
      message: "MINI_APP_SHORT_NAME is not configured."
    }, 500);
  }

  const link = "https://t.me/" + botUsername + "/" + encodeURIComponent(shortName) + "?startapp=" + encodeURIComponent(String(user.referral_code));

  const referralCount = await env.DB
    .prepare("SELECT COUNT(*) AS count FROM referrals WHERE referrer_id = ?")
    .bind(user.id)
    .first();

  return json({
    success: true,
    code: String(user.referral_code),
    link,
    count: Number(referralCount?.count || 0)
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
  const telegramId = (q.get("telegram_id") || ymid).trim();
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

  // Monetag marks confirmed paid events as `valued`. Never credit an
  // unpaid/non-valued event.
  if (!eventAccepted || rewardEventType !== "valued") {
    return new Response("ignored", { status: 200 });
  }

  await ensureMonetagTable(env.DB);
  await ensureAdRewardTable(env.DB);
  const adminSettings = await getAdminSettings(env.DB);

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
  const reward = Number(adminSettings.adReward || AD_REWARD_COINS);

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

  if (dailyCount >= Number(adminSettings.dailyAdLimit || DAILY_AD_LIMIT)) {
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

async function ensureAdminTables(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS withdrawals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      method TEXT NOT NULL,
      address TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Pending',
      created_at INTEGER NOT NULL,
      processed_at INTEGER
    )
  `).run();

  await db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_withdrawals_user
    ON withdrawals(user_id, id DESC)
  `).run();
}

async function getAdminSettings(db) {
  await ensureAdminTables(db);
  const row = await db.prepare("SELECT value FROM app_settings WHERE key='config'").first();
  const defaults = {
    currency: "Coins",
    adReward: AD_REWARD_COINS,
    dailyAdLimit: DAILY_AD_LIMIT,
    withdrawMethods: "bKash:200, Nagad:200, Rocket:200, Binance:5"
  };
  if (!row) return defaults;
  try { return { ...defaults, ...JSON.parse(row.value) }; }
  catch { return defaults; }
}

async function saveAdminSettings(db, incoming) {
  const current = await getAdminSettings(db);
  const settings = {
    ...current,
    currency: String(incoming.currency || current.currency),
    adReward: Math.max(0, Number(incoming.adReward ?? current.adReward)),
    dailyAdLimit: Math.max(1, Math.floor(Number(incoming.dailyAdLimit ?? current.dailyAdLimit))),
    withdrawMethods: String(incoming.withdrawMethods ?? current.withdrawMethods)
  };
  await db.prepare("INSERT INTO app_settings(key,value) VALUES('config',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .bind(JSON.stringify(settings)).run();
  return settings;
}

async function requireAdmin(env, input) {
  if (!env.DB || !env.BOT_TOKEN || !env.ADMIN_CHAT_ID) return null;
  const initData = typeof input?.initData === "string" ? input.initData.trim() : "";
  const telegramData = await validateTelegramInitData(initData, env.BOT_TOKEN);
  if (!telegramData) return null;
  if (String(telegramData.user.id) !== String(env.ADMIN_CHAT_ID)) return null;
  return telegramData.user;
}

async function adminApi(request, env) {
  if (request.method !== "POST") return json({ success:false, message:"Method not allowed." },405);

  let input = {};
  try { input = await request.json(); }
  catch { return json({ success:false, message:"Invalid JSON." },400); }

  const admin = await requireAdmin(env, input);
  if (!admin) return json({ success:false, message:"Unauthorized admin access." },403);
  if (!env.DB) return json({ success:false, message:"Database binding DB is missing." },500);

  const action = String(input.action || "data");
  await ensureAdminTables(env.DB);

  if (action === "data") {
    const settings = await getAdminSettings(env.DB);

    const users = await env.DB.prepare(`
      SELECT u.id, u.telegram_id, u.username, u.first_name, u.last_name,
             COALESCE(w.balance,0) AS balance,
             COALESCE(w.lifetime_earned,0) AS lifetime_earned,
             COALESCE(w.lifetime_withdrawn,0) AS lifetime_withdrawn
      FROM users u
      LEFT JOIN wallets w ON w.user_id=u.id
      ORDER BY u.id DESC LIMIT 500
    `).all();

    const withdrawals = await env.DB.prepare(`
      SELECT wd.id, wd.user_id, wd.amount, wd.method, wd.address, wd.status,
             wd.created_at, wd.processed_at,
             u.telegram_id, u.username, u.first_name, u.last_name
      FROM withdrawals wd
      JOIN users u ON u.id=wd.user_id
      ORDER BY wd.id DESC LIMIT 200
    `).all();

    const stats = await env.DB.prepare(`
      SELECT
        (SELECT COUNT(*) FROM users) AS users_count,
        (SELECT COALESCE(SUM(balance),0) FROM wallets) AS total_balance,
        (SELECT COALESCE(SUM(lifetime_earned),0) FROM wallets) AS total_earned,
        (SELECT COALESCE(SUM(lifetime_withdrawn),0) FROM wallets) AS total_withdrawn,
        (SELECT COUNT(*) FROM withdrawals WHERE status='Pending') AS pending_withdrawals,
        (SELECT COUNT(*) FROM withdrawals) AS withdrawals_count
    `).first();

    const transactions = await env.DB.prepare(`
      SELECT t.id, t.user_id, t.type, t.amount, t.description, t.created_at,
             u.telegram_id, u.username, u.first_name
      FROM transactions t
      LEFT JOIN users u ON u.id=t.user_id
      ORDER BY t.id DESC LIMIT 300
    `).all();

    return json({
      success:true,
      settings,
      stats: stats || {},
      users: users.results || [],
      withdrawals: withdrawals.results || [],
      transactions: transactions.results || []
    });
  }

  if (action === "balance") {
    const userId = Number(input.user_id);
    const mode = String(input.mode || "set");
    const value = Number(input.value);

    if (!Number.isInteger(userId) || !Number.isFinite(value) || value < 0) {
      return json({success:false,message:"Invalid user or amount."},400);
    }

    const exists = await env.DB.prepare("SELECT id FROM users WHERE id=?").bind(userId).first();
    if (!exists) return json({success:false,message:"User not found."},404);

    const now = Math.floor(Date.now()/1000);
    await env.DB.prepare(
      "INSERT OR IGNORE INTO wallets(user_id,balance,lifetime_earned,lifetime_withdrawn,updated_at) VALUES(?,0,0,0,?)"
    ).bind(userId,now).run();

    const wallet = await env.DB.prepare("SELECT balance FROM wallets WHERE user_id=?").bind(userId).first();
    const oldBalance = Number(wallet?.balance || 0);
    let newBalance;
    let transactionAmount;
    let description;

    if (mode === "add") {
      newBalance = oldBalance + value;
      transactionAmount = value;
      description = "Admin added Coins";
    } else if (mode === "subtract") {
      if (value > oldBalance) return json({success:false,message:"Cannot subtract more than the current balance."},400);
      newBalance = oldBalance - value;
      transactionAmount = -value;
      description = "Admin removed Coins";
    } else if (mode === "set") {
      newBalance = value;
      transactionAmount = value - oldBalance;
      description = "Admin set balance";
    } else {
      return json({success:false,message:"Invalid balance mode."},400);
    }

    await env.DB.batch([
      env.DB.prepare("UPDATE wallets SET balance=?, updated_at=? WHERE user_id=?").bind(newBalance,now,userId),
      env.DB.prepare("INSERT INTO transactions(user_id,type,amount,description,created_at) VALUES(?,?,?,?,?)")
        .bind(userId,"admin_balance",transactionAmount,description,now)
    ]);

    return json({success:true,balance:newBalance});
  }

  if (action === "withdraw_status") {
    const id = Number(input.withdrawal_id);
    const status = String(input.status || "");
    if (!Number.isInteger(id) || !["Completed","Cancelled"].includes(status)) {
      return json({success:false,message:"Invalid withdrawal update."},400);
    }

    const wd = await env.DB.prepare("SELECT * FROM withdrawals WHERE id=?").bind(id).first();
    if (!wd) return json({success:false,message:"Withdrawal not found."},404);
    if (wd.status !== "Pending") return json({success:false,message:"Withdrawal already processed."},400);

    const now = Math.floor(Date.now()/1000);
    const amount = Number(wd.amount || 0);

    if (status === "Cancelled") {
      await env.DB.batch([
        env.DB.prepare("UPDATE withdrawals SET status=?, processed_at=? WHERE id=? AND status='Pending'").bind(status,now,id),
        env.DB.prepare("UPDATE wallets SET balance=balance+?, updated_at=? WHERE user_id=?").bind(amount,now,Number(wd.user_id)),
        env.DB.prepare("INSERT INTO transactions(user_id,type,amount,description,created_at) VALUES(?,?,?,?,?)")
          .bind(Number(wd.user_id),"withdrawal_refund",amount,"Withdrawal cancelled - Coins returned",now)
      ]);
    } else {
      await env.DB.batch([
        env.DB.prepare("UPDATE withdrawals SET status=?, processed_at=? WHERE id=? AND status='Pending'").bind(status,now,id),
        env.DB.prepare("UPDATE wallets SET lifetime_withdrawn=lifetime_withdrawn+?, updated_at=? WHERE user_id=?").bind(amount,now,Number(wd.user_id)),
        env.DB.prepare("INSERT INTO transactions(user_id,type,amount,description,created_at) VALUES(?,?,?,?,?)")
          .bind(Number(wd.user_id),"withdrawal_completed",-amount,"Withdrawal completed",now)
      ]);
    }

    return json({success:true});
  }

  if (action === "settings") {
    const settings = await saveAdminSettings(env.DB, input.settings || {});
    return json({success:true,settings});
  }

  return json({success:false,message:"Unknown admin action."},404);
}

async function withdrawApi(request, env) {
  if (request.method !== "POST") return json({success:false,message:"Method not allowed."},405);
  if (!env.DB || !env.BOT_TOKEN) return json({success:false,message:"Server configuration is incomplete."},500);
  let body;
  try { body = await request.json(); } catch { return json({success:false,message:"Invalid JSON."},400); }
  const initData = typeof body?.initData === "string" ? body.initData.trim() : "";
  const telegramData = await validateTelegramInitData(initData, env.BOT_TOKEN);
  if (!telegramData) return json({success:false,message:"Invalid Telegram authorization."},401);
  const telegramId = String(telegramData.user.id);
  const user = await env.DB.prepare("SELECT id FROM users WHERE telegram_id=? LIMIT 1").bind(telegramId).first();
  if (!user) return json({success:false,message:"User not found."},404);
  await ensureAdminTables(env.DB);
  const settings = await getAdminSettings(env.DB);
  const amount = Number(body.amount);
  const method = String(body.method || "").trim();
  const address = String(body.address || "").trim();
  const parsed = String(settings.withdrawMethods).split(",").map(x=>{const [name,min]=x.split(":");return {name:String(name||"").trim(),min:Number(min||0)}});
  const selected = parsed.find(x=>x.name===method);
  if (!Number.isFinite(amount) || amount<=0 || !selected || !address) return json({success:false,message:"Invalid withdrawal request."},400);
  if (amount < selected.min) return json({success:false,message:`Minimum withdrawal is ${selected.min}.`},400);
  const now = Math.floor(Date.now()/1000);
  const updated = await env.DB.prepare("UPDATE wallets SET balance=balance-?, updated_at=? WHERE user_id=? AND balance>=?").bind(amount,now,user.id,amount).run();
  if (Number(updated?.meta?.changes||0)!==1) return json({success:false,message:"Insufficient balance."},400);
  await env.DB.prepare("INSERT INTO withdrawals(user_id,amount,method,address,status,created_at) VALUES(?,?,?,?,?,?)").bind(user.id,amount,method,address,"Pending",now).run();
  return json({success:true,message:"Withdrawal request submitted."});
}

function renderApp() {
  return APP_HTML;
}

const APP_HTML = String.raw`<!doctype html>
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
.referral-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:30;display:flex;align-items:flex-end;justify-content:center;padding:16px}
.referral-modal{width:100%;max-width:560px;background:var(--tg-theme-bg-color,#fff);color:var(--tg-theme-text-color,#111827);border-radius:24px;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.25)}
.referral-modal h3{margin:0 0 7px;font-size:20px}
.referral-modal p{margin:0 0 15px;font-size:13px;opacity:.65;line-height:1.45}
.referral-code{padding:12px 14px;border-radius:14px;background:rgba(127,127,127,.1);font-weight:800;letter-spacing:1px;text-align:center;margin-bottom:10px}
.referral-link{font-size:11px;line-height:1.4;word-break:break-all;padding:11px 12px;border-radius:12px;background:rgba(127,127,127,.07);opacity:.75;margin-bottom:14px}
.referral-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.referral-actions button{border:0;border-radius:14px;padding:13px;font-weight:800;cursor:pointer;background:#111827;color:#fff}
.referral-actions .secondary{background:rgba(127,127,127,.12);color:inherit}
.wall{position:fixed;inset:0;background:var(--tg-theme-bg-color,#f5f7fb);z-index:10;display:flex;flex-direction:column}
.wall-head{height:54px;display:flex;align-items:center;padding:0 12px;border-bottom:1px solid rgba(127,127,127,.12);flex:none}
.wall-head button{border:0;background:transparent;font-size:24px;padding:6px}
.wall-title{font-weight:800;margin-left:4px}
.wall-frame{width:100%;height:calc(100% - 54px);border:0;flex:1}
.admin-fab{position:fixed;right:16px;bottom:82px;z-index:20;border:0;border-radius:16px;padding:10px 13px;background:#111827;color:#fff;font-weight:800;box-shadow:0 8px 20px rgba(0,0,0,.2)}
.admin-overlay{position:fixed;inset:0;background:var(--tg-theme-bg-color,#f5f7fb);z-index:50;overflow:auto;padding:calc(18px + env(safe-area-inset-top)) 16px calc(40px + env(safe-area-inset-bottom))}
.admin-box{max-width:720px;margin:0 auto}
.admin-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;position:sticky;top:0;background:var(--tg-theme-bg-color,#f5f7fb);padding:6px 0 12px;z-index:2}
.admin-head strong{font-size:20px}
.admin-head button{border:0;background:rgba(127,127,127,.12);width:40px;height:40px;border-radius:12px;font-size:26px;color:inherit}
.admin-section{background:var(--tg-theme-secondary-bg-color,#fff);border-radius:18px;padding:16px;margin-bottom:14px}
.admin-section h3{font-size:17px}
.admin-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
.admin-stat{background:rgba(127,127,127,.08);border-radius:14px;padding:13px}
.admin-stat-number{font-size:20px;font-weight:850}
.admin-stat-label{font-size:11px;opacity:.55;margin-top:3px}
.admin-row{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid rgba(127,127,127,.12)}
.admin-row:last-child{border-bottom:0}
.admin-user-main{min-width:0;flex:1}.admin-user-name{font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.admin-muted{font-size:11px;opacity:.55;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.admin-actions{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
.admin-input{width:100%;padding:11px 12px;border:1px solid rgba(127,127,127,.2);border-radius:11px;background:transparent;color:inherit;font-size:14px}
.admin-btn{border:0;border-radius:10px;padding:9px 12px;font-weight:750;cursor:pointer}
.admin-btn.ok{background:#16a34a;color:#fff}.admin-btn.no{background:#dc2626;color:#fff}.admin-btn.primary{background:#111827;color:#fff}.admin-btn.secondary{background:rgba(127,127,127,.12);color:inherit}
.admin-search{margin:10px 0}.admin-pill{display:inline-block;border-radius:999px;padding:4px 8px;font-size:10px;font-weight:800;background:rgba(127,127,127,.12)}
.admin-table-note{font-size:11px;opacity:.55;margin-top:8px}.admin-empty{text-align:center;padding:18px;opacity:.55}
.admin-tx{display:flex;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px solid rgba(127,127,127,.12)}
@media(min-width:650px){.admin-grid{grid-template-columns:repeat(3,1fr)}}
</style>
</head>
<body>
<div id="app"><div class="loading">Loading Coin Cove...</div></div>
<button id="adminFab" class="admin-fab" style="display:none" onclick="openAdmin()">🛡️ Admin</button>

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
  let IS_ADMIN = false;

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
      IS_ADMIN = data.isAdmin === true;
      render(data);
      const adminFab = document.getElementById("adminFab");
      if (adminFab) adminFab.style.display = IS_ADMIN ? "block" : "none";
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

  window.openAdmin = async function () {
    if (!IS_ADMIN) return showAlert("Admin access denied.");
    const old = document.getElementById("adminOverlay");
    if (old) old.remove();

    document.body.insertAdjacentHTML("beforeend",
      '<div class="admin-overlay" id="adminOverlay">' +
        '<div class="admin-box">' +
          '<div class="admin-head"><strong>🛡️ Coin Cove Admin</strong><button onclick="closeAdmin()">×</button></div>' +
          '<div class="admin-section"><h3 style="margin:0 0 12px">📊 Dashboard</h3><div class="admin-grid" id="adminStats"><div class="admin-stat"><div class="admin-stat-number">…</div><div class="admin-stat-label">Users</div></div></div></div>' +
          '<div class="admin-section">' +
            '<h3 style="margin:0 0 12px">⚙️ Settings</h3>' +
            '<input class="admin-input" id="admCurrency" placeholder="Currency name" style="margin-bottom:8px">' +
            '<input class="admin-input" id="admReward" type="number" min="0" placeholder="Ad reward" style="margin-bottom:8px">' +
            '<input class="admin-input" id="admLimit" type="number" min="1" placeholder="Daily ad limit" style="margin-bottom:8px">' +
            '<input class="admin-input" id="admMethods" placeholder="bKash:200, Nagad:200" style="margin-bottom:8px">' +
            '<button class="admin-btn primary" onclick="saveAdminSettings()">Save settings</button>' +
          '</div>' +
          '<div class="admin-section"><h3 style="margin:0 0 8px">👥 Users</h3><input class="admin-input admin-search" id="adminUserSearch" placeholder="Search name, username or Telegram ID" oninput="filterAdminUsers()"><div id="adminUsers">Loading...</div></div>' +
          '<div class="admin-section"><h3 style="margin:0 0 8px">💸 Withdrawals</h3><div id="adminWithdrawals">Loading...</div></div>' +
          '<div class="admin-section"><h3 style="margin:0 0 8px">📜 Transactions</h3><div id="adminTransactions">Loading...</div></div>' +
        '</div>' +
      '</div>');

    await refreshAdmin();
  };

  window.closeAdmin = function () {
    const el = document.getElementById("adminOverlay");
    if (el) el.remove();
  };

  let ADMIN_CACHE = {users:[], withdrawals:[], transactions:[], stats:{}, settings:{}};

  async function adminRequest(action, extra) {
    const initData = getInitData();
    const response = await fetch("/api/admin", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify(Object.assign({action:action, initData:initData}, extra || {})),
      cache: "no-store"
    });
    let data;
    try { data = await response.json(); }
    catch { return {success:false,message:"Invalid server response."}; }
    if (!response.ok && !data.message) data.message = "Admin request failed.";
    return data;
  }

  function adminStat(label, value) {
    return '<div class="admin-stat"><div class="admin-stat-number">' + escapeHtml(String(value)) + '</div><div class="admin-stat-label">' + escapeHtml(label) + '</div></div>';
  }

  function renderAdminUsers(users) {
    const el = document.getElementById("adminUsers");
    if (!el) return;
    if (!users.length) { el.innerHTML = '<div class="admin-empty">No users found</div>'; return; }

    el.innerHTML = users.map(function(u) {
      const name = [u.first_name || "", u.last_name || ""].join(" ").trim() || "User";
      const username = u.username ? "@" + u.username : "No username";
      return '<div class="admin-row">' +
        '<div class="admin-user-main"><div class="admin-user-name">' + escapeHtml(name) + '</div><div class="admin-muted">' + escapeHtml(username) + ' · TG: ' + escapeHtml(u.telegram_id) + '</div><div class="admin-muted">Earned: ' + Number(u.lifetime_earned || 0) + ' · Withdrawn: ' + Number(u.lifetime_withdrawn || 0) + '</div></div>' +
        '<div style="text-align:right"><div style="font-weight:850;margin-bottom:6px">' + Number(u.balance || 0) + ' Coins</div><div class="admin-actions"><button class="admin-btn primary" onclick="editAdminBalance(' + Number(u.id) + ',' + Number(u.balance || 0) + ')">Set</button><button class="admin-btn secondary" onclick="adjustAdminBalance(' + Number(u.id) + ',\'add\')">+ Add</button><button class="admin-btn secondary" onclick="adjustAdminBalance(' + Number(u.id) + ',\'subtract\')">− Remove</button></div></div>' +
      '</div>';
    }).join("");
  }

  window.filterAdminUsers = function () {
    const q = String(document.getElementById("adminUserSearch")?.value || "").trim().toLowerCase();
    const filtered = ADMIN_CACHE.users.filter(function(u) {
      return [u.first_name,u.last_name,u.username,u.telegram_id].join(" ").toLowerCase().includes(q);
    });
    renderAdminUsers(filtered);
  };

  function renderAdminWithdrawals(rows) {
    const el = document.getElementById("adminWithdrawals");
    if (!el) return;
    if (!rows.length) { el.innerHTML = '<div class="admin-empty">No withdrawal requests</div>'; return; }

    el.innerHTML = rows.map(function(w) {
      const name = [w.first_name || "", w.last_name || ""].join(" ").trim() || "User";
      const buttons = w.status === "Pending" ?
        '<div class="admin-actions"><button class="admin-btn ok" onclick="setWithdraw(' + Number(w.id) + ',\'Completed\')">✓ Approve</button><button class="admin-btn no" onclick="setWithdraw(' + Number(w.id) + ',\'Cancelled\')">× Reject</button></div>' :
        '<span class="admin-pill">' + escapeHtml(w.status) + '</span>';
      return '<div class="admin-row"><div class="admin-user-main"><div class="admin-user-name">#' + Number(w.id) + ' · ' + escapeHtml(name) + '</div><div class="admin-muted">' + escapeHtml(w.method) + ' · ' + escapeHtml(w.address) + '</div><div class="admin-muted">' + formatDate(w.created_at) + ' · Telegram: ' + escapeHtml(w.telegram_id) + '</div></div><div style="text-align:right"><div style="font-weight:850;margin-bottom:6px">' + Number(w.amount || 0) + ' Coins</div>' + buttons + '</div></div>';
    }).join("");
  }

  function renderAdminTransactions(rows) {
    const el = document.getElementById("adminTransactions");
    if (!el) return;
    if (!rows.length) { el.innerHTML = '<div class="admin-empty">No transactions</div>'; return; }
    el.innerHTML = rows.slice(0,100).map(function(t) {
      const name = [t.first_name || "", t.username ? "@" + t.username : ""].join(" ").trim() || "User";
      const amount = Number(t.amount || 0);
      return '<div class="admin-tx"><div><div style="font-weight:700;font-size:12px">' + escapeHtml(t.description || t.type || "Transaction") + '</div><div class="admin-muted">' + escapeHtml(name) + ' · ' + formatDate(t.created_at) + '</div></div><div style="font-weight:850">' + (amount > 0 ? "+" : "") + amount + '</div></div>';
    }).join("");
  }

  async function refreshAdmin() {
    const data = await adminRequest("data");
    if (!data.success) { showAlert(data.message || "Admin error"); return; }
    ADMIN_CACHE = data;

    const stats = data.stats || {};
    const statsEl = document.getElementById("adminStats");
    if (statsEl) {
      statsEl.innerHTML =
        adminStat("Users", Number(stats.users_count || 0)) +
        adminStat("Total Coins", Number(stats.total_balance || 0)) +
        adminStat("Lifetime Earned", Number(stats.total_earned || 0)) +
        adminStat("Withdrawn", Number(stats.total_withdrawn || 0)) +
        adminStat("Pending Withdrawals", Number(stats.pending_withdrawals || 0)) +
        adminStat("All Withdrawals", Number(stats.withdrawals_count || 0));
    }

    const settings = data.settings || {};
    document.getElementById("admCurrency").value = settings.currency || "Coins";
    document.getElementById("admReward").value = settings.adReward ?? 10;
    document.getElementById("admLimit").value = settings.dailyAdLimit ?? 10;
    document.getElementById("admMethods").value = settings.withdrawMethods || "";

    renderAdminUsers(data.users || []);
    renderAdminWithdrawals(data.withdrawals || []);
    renderAdminTransactions(data.transactions || []);
  }

  window.editAdminBalance = async function (userId, current) {
    const value = prompt("Set new balance:", String(current));
    if (value === null) return;
    const balance = Number(value);
    if (!Number.isFinite(balance) || balance < 0) return showAlert("Invalid balance.");
    const d = await adminRequest("balance", {user_id:userId, mode:"set", value:balance});
    showAlert(d.success ? "Balance updated." : (d.message || "Update failed."));
    if (d.success) { await refreshAdmin(); await loadApp(); }
  };

  window.adjustAdminBalance = async function (userId, mode) {
    const label = mode === "add" ? "Coins to add:" : "Coins to remove:";
    const value = prompt(label, "10");
    if (value === null) return;
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) return showAlert("Enter a valid amount greater than 0.");
    const d = await adminRequest("balance", {user_id:userId, mode:mode, value:amount});
    showAlert(d.success ? "Balance updated." : (d.message || "Update failed."));
    if (d.success) { await refreshAdmin(); await loadApp(); }
  };

  window.setWithdraw = async function (withdrawalId, status) {
    const text = status === "Completed" ? "Approve this withdrawal?" : "Reject this withdrawal and return the Coins to the user?";
    if (!confirm(text)) return;
    const d = await adminRequest("withdraw_status", {withdrawal_id:withdrawalId,status:status});
    showAlert(d.success ? (status === "Completed" ? "Withdrawal approved." : "Withdrawal rejected and Coins returned.") : (d.message || "Update failed."));
    if (d.success) { await refreshAdmin(); await loadApp(); }
  };

  window.saveAdminSettings = async function () {
    const settings = {
      currency: document.getElementById("admCurrency").value.trim() || "Coins",
      adReward: Number(document.getElementById("admReward").value),
      dailyAdLimit: Number(document.getElementById("admLimit").value),
      withdrawMethods: document.getElementById("admMethods").value.trim()
    };
    const d = await adminRequest("settings", {settings:settings});
    showAlert(d.success ? "Settings saved." : (d.message || "Save failed."));
    if (d.success) await refreshAdmin();
  };

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
      await window.show_11766606({
        ymid: String(currentUser.telegram_id),
        requestVar: "watch_earn"
      });

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

      showAlert("✅ Ad completed. Waiting for Monetag confirmation...\nYour Coins will appear automatically after confirmation.");
      await loadApp();
      await waitForMonetagReward();
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
    if (section === "referral") {
      openReferral();
      return;
    }

    if (section === "withdraw") {
      showAlert("Withdrawal options will be added in the next stage.");
      return;
    }

    showAlert("Coming soon.");
  };

  async function openReferral() {
    const existing = document.getElementById("referralOverlay");
    if (existing) existing.remove();

    document.body.insertAdjacentHTML(
      "beforeend",
      '<div class="referral-overlay" id="referralOverlay" onclick="closeReferral(event)">' +
        '<div class="referral-modal" onclick="event.stopPropagation()">' +
          '<h3>👥 Invite Friends</h3>' +
          '<p>Share your personal link. New users who open Coin Cove through your link are recorded as your referrals.</p>' +
          '<div id="referralContent" style="text-align:center;opacity:.65;padding:14px 0">Loading your referral link...</div>' +
        '</div>' +
      '</div>'
    );

    try {
      const initData = getInitData();
      const response = await fetch("/api/referral", {
        method: "GET",
        headers: { "X-Telegram-Init-Data": initData },
        cache: "no-store"
      });

      const data = await response.json();
      const content = document.getElementById("referralContent");
      if (!content) return;

      if (!response.ok || !data.success) {
        content.innerHTML = '<div style="padding:8px 0">' + escapeHtml(data.message || "Unable to create your referral link.") + '</div>';
        return;
      }

      const link = String(data.link || "");
      const code = String(data.code || "");
      const count = Number(data.count || 0);

      content.innerHTML =
        '<div style="font-size:12px;opacity:.6;margin-bottom:7px">Your referral code</div>' +
        '<div class="referral-code">' + escapeHtml(code) + '</div>' +
        '<div style="font-size:12px;opacity:.6;margin:9px 0 6px">Your invite link</div>' +
        '<div class="referral-link">' + escapeHtml(link) + '</div>' +
        '<div style="font-size:12px;margin-bottom:14px"><b>' + count + '</b> friends invited</div>' +
        '<div class="referral-actions">' +
          '<button class="secondary" onclick="copyReferralLink()">📋 Copy Link</button>' +
          '<button onclick="shareReferralLink()">📤 Share</button>' +
        '</div>';

      window.__coinCoveReferralLink = link;
    } catch (error) {
      console.error("Referral error:", error);
      const content = document.getElementById("referralContent");
      if (content) content.textContent = "Unable to load your referral link. Please try again.";
    }
  }

  window.closeReferral = function (event) {
    if (event && event.target && event.target.id !== "referralOverlay") return;
    const overlay = document.getElementById("referralOverlay");
    if (overlay) overlay.remove();
  };

  window.copyReferralLink = async function () {
    const link = window.__coinCoveReferralLink || "";
    if (!link) return;

    try {
      await navigator.clipboard.writeText(link);
      showAlert("Referral link copied.");
    } catch (error) {
      showAlert(link);
    }
  };

  window.shareReferralLink = function () {
    const link = window.__coinCoveReferralLink || "";
    if (!link) return;

    const text = "Join Coin Cove and earn Coins with me!";
    const shareUrl = "https://t.me/share/url?url=" + encodeURIComponent(link) + "&text=" + encodeURIComponent(text);

    try {
      if (tg && typeof tg.openTelegramLink === "function") {
        tg.openTelegramLink(shareUrl);
        return;
      }
    } catch (error) {
      console.error("Telegram share error:", error);
    }

    window.open(shareUrl, "_blank");
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
