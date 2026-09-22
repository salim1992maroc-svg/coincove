
const APP_NAME = "Coin Cove";
const POINTS_NAME = "Coins";
const OFFERWALL_URL =
  "https://offerwall.gg/wall/4c826098db679c99583194371d0eae1b?userId={user_id}";

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      if (url.pathname === "/api/health") {
        return json({
          success: true,
          app: APP_NAME,
          database: !!env.DB,
          botConfigured: !!normalizeBotToken(env.BOT_TOKEN),
          offerwallConfigured: !!env.OFFERWALL_SECRET,
          monetagConfigured: !!env.MONETAG_ZONE_ID && !!env.MONETAG_SDK_URL,
          adminConfigured: !!env.ADMIN_TELEGRAM_ID,
          time: Date.now()
        });
      }

      if (url.pathname === "/api/telegram-bot") {
        return await telegramBotInfo(env);
      }

      if (url.pathname === "/api/me") {
        return await apiMe(request, env);
      }

      if (url.pathname === "/api/offers/url") {
        return await offersUrl(request, env);
      }

      if (url.pathname === "/api/offerwall/postback") {
        return await offerwallPostback(request, env);
      }

      if (url.pathname === "/api/ad/start") {
        return await monetagAdStart(request, env);
      }

      if (url.pathname === "/api/ad/status") {
        return await monetagAdStatus(request, env);
      }

      if (url.pathname === "/api/monetag/postback") {
        return await monetagPostback(request, env);
      }

      if (url.pathname === "/api/withdraw") {
        return await createWithdrawal(request, env);
      }

      if (url.pathname === "/api/admin/withdrawals") {
        return await adminWithdrawals(request, env);
      }

      if (url.pathname === "/api/admin/users") {
        return await adminUsers(request, env);
      }

      if (url.pathname === "/api/admin/withdrawal-status") {
        return await adminWithdrawalStatus(request, env);
      }

      if (url.pathname === "/api/admin/balance") {
        return await adminBalance(request, env);
      }

      return new Response(renderApp(env), {
        headers: {
          "content-type": "text/html; charset=UTF-8",
          "cache-control": "no-store"
        }
      });
    } catch (error) {
      console.error("Worker error:", error);
      return json({
        success: false,
        message: "Internal server error."
      }, 500);
    }
  }
};


// =====================================================
// SCHEMA
// =====================================================

async function ensureSchema(db) {
  await db.batch([
    db.prepare(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_id TEXT NOT NULL UNIQUE,
        username TEXT,
        first_name TEXT NOT NULL DEFAULT '',
        last_name TEXT,
        referral_code TEXT NOT NULL UNIQUE,
        referred_by TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS wallets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL UNIQUE,
        balance REAL NOT NULL DEFAULT 0,
        lifetime_earned REAL NOT NULL DEFAULT 0,
        lifetime_withdrawn REAL NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        amount REAL NOT NULL,
        description TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS referrals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        referrer_id INTEGER NOT NULL,
        referred_user_id INTEGER NOT NULL UNIQUE,
        reward REAL NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (referrer_id) REFERENCES users(id),
        FOREIGN KEY (referred_user_id) REFERENCES users(id)
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS offerwall_conversions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transaction_id TEXT NOT NULL,
        event_key TEXT NOT NULL UNIQUE,
        user_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        status TEXT NOT NULL,
        offer_id TEXT,
        offer_name TEXT,
        goal_id TEXT,
        payout_usd REAL DEFAULT 0,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS ad_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ymid TEXT NOT NULL UNIQUE,
        user_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        reward_coins REAL NOT NULL DEFAULT 0,
        reward_event_type TEXT,
        event_type TEXT,
        zone_id TEXT,
        sub_zone_id TEXT,
        request_var TEXT,
        estimated_price REAL DEFAULT 0,
        created_at INTEGER NOT NULL,
        completed_at INTEGER,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS withdrawals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        method TEXT NOT NULL,
        address TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        admin_note TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `)
  ]);
}


// =====================================================
// TELEGRAM AUTH + USER
// =====================================================

async function apiMe(request, env) {
  if (request.method !== "POST") {
    return json({ success: false, message: "POST required." }, 405);
  }

  if (!env.DB) {
    return json({ success: false, code: "DB_MISSING", message: "D1 is not configured." }, 500);
  }

  const botToken = normalizeBotToken(env.BOT_TOKEN);
  if (!botToken) {
    return json({ success: false, code: "BOT_TOKEN_MISSING", message: "BOT_TOKEN is missing." }, 500);
  }

  const initData = await readInitData(request);
  if (!initData) {
    return json({
      success: false,
      code: "NO_INIT_DATA",
      message: "Open Coin Cove from Telegram."
    }, 401);
  }

  const validation = await validateTelegramInitData(initData, botToken);
  if (!validation.ok) {
    return json({
      success: false,
      code: validation.code,
      message: validation.message
    }, 401);
  }

  await ensureSchema(env.DB);

  const tgUser = validation.data.user;
  const telegramId = String(tgUser.id);
  const now = Math.floor(Date.now() / 1000);

  let user = await env.DB
    .prepare("SELECT * FROM users WHERE telegram_id = ? LIMIT 1")
    .bind(telegramId)
    .first();

  let newUser = false;

  if (!user) {
    newUser = true;

    let referralCode = generateReferralCode();
    let referralOwner = await env.DB
      .prepare("SELECT id FROM users WHERE referral_code = ? LIMIT 1")
      .bind(referralCode)
      .first();

    while (referralOwner) {
      referralCode = generateReferralCode();
      referralOwner = await env.DB
        .prepare("SELECT id FROM users WHERE referral_code = ? LIMIT 1")
        .bind(referralCode)
        .first();
    }

    const startParam = validation.data.start_param || null;
    let referredBy = null;

    if (startParam) {
      const referrer = await env.DB
        .prepare("SELECT id, telegram_id FROM users WHERE referral_code = ? LIMIT 1")
        .bind(startParam)
        .first();

      if (referrer && String(referrer.telegram_id) !== telegramId) {
        referredBy = String(referrer.telegram_id);
      }
    }

    await env.DB.prepare(`
      INSERT INTO users
      (telegram_id, username, first_name, last_name, referral_code, referred_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      telegramId,
      tgUser.username || null,
      tgUser.first_name || "",
      tgUser.last_name || null,
      referralCode,
      referredBy,
      now,
      now
    ).run();

    user = await env.DB
      .prepare("SELECT * FROM users WHERE telegram_id = ? LIMIT 1")
      .bind(telegramId)
      .first();

    await env.DB.prepare(`
      INSERT OR IGNORE INTO wallets
      (user_id, balance, lifetime_earned, lifetime_withdrawn, updated_at)
      VALUES (?, 0, 0, 0, ?)
    `).bind(user.id, now).run();

    if (referredBy) {
      const referrer = await env.DB
        .prepare("SELECT id FROM users WHERE telegram_id = ? LIMIT 1")
        .bind(referredBy)
        .first();

      const referralReward = getEnvNumber(env.REFERRAL_REWARD_COINS, 0);

      if (referrer) {
        if (referralReward > 0) {
          await env.DB.batch([
            env.DB.prepare(`
              INSERT OR IGNORE INTO referrals
              (referrer_id, referred_user_id, reward, created_at)
              VALUES (?, ?, ?, ?)
            `).bind(referrer.id, user.id, referralReward, now),

            env.DB.prepare(`
              UPDATE wallets
              SET balance = balance + ?,
                  lifetime_earned = lifetime_earned + ?,
                  updated_at = ?
              WHERE user_id = ?
            `).bind(referralReward, referralReward, now, referrer.id),

            env.DB.prepare(`
              INSERT INTO transactions
              (user_id, type, amount, description, created_at)
              VALUES (?, ?, ?, ?, ?)
            `).bind(
              referrer.id,
              "referral_reward",
              referralReward,
              "Referral reward",
              now
            )
          ]);
        } else {
          await env.DB.prepare(`
            INSERT OR IGNORE INTO referrals
            (referrer_id, referred_user_id, reward, created_at)
            VALUES (?, ?, 0, ?)
          `).bind(referrer.id, user.id, now).run();
        }
      }
    }
  } else {
    await env.DB.prepare(`
      UPDATE users
      SET username = ?, first_name = ?, last_name = ?, updated_at = ?
      WHERE telegram_id = ?
    `).bind(
      tgUser.username || null,
      tgUser.first_name || "",
      tgUser.last_name || null,
      now,
      telegramId
    ).run();

    await env.DB.prepare(`
      INSERT OR IGNORE INTO wallets
      (user_id, balance, lifetime_earned, lifetime_withdrawn, updated_at)
      VALUES (?, 0, 0, 0, ?)
    `).bind(user.id, now).run();
  }

  const wallet = await env.DB
    .prepare(`
      SELECT balance, lifetime_earned, lifetime_withdrawn
      FROM wallets WHERE user_id = ? LIMIT 1
    `)
    .bind(user.id)
    .first();

  const referrals = await env.DB
    .prepare("SELECT COUNT(*) AS count FROM referrals WHERE referrer_id = ?")
    .bind(user.id)
    .first();

  const transactions = await env.DB
    .prepare(`
      SELECT type, amount, description, created_at
      FROM transactions
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT 20
    `)
    .bind(user.id)
    .all();

  const withdrawals = await env.DB
    .prepare(`
      SELECT id, amount, method, address, status, created_at, updated_at, admin_note
      FROM withdrawals
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT 20
    `)
    .bind(user.id)
    .all();

  const adminId = String(env.ADMIN_TELEGRAM_ID || "").trim();

  return json({
    success: true,
    newUser,
    admin: adminId && adminId === telegramId,
    user: {
      id: user.id,
      telegram_id: telegramId,
      username: tgUser.username || "",
      first_name: tgUser.first_name || "",
      last_name: tgUser.last_name || "",
      referral_code: user.referral_code
    },
    wallet: wallet || {
      balance: 0,
      lifetime_earned: 0,
      lifetime_withdrawn: 0
    },
    referrals: {
      count: Number(referrals?.count || 0)
    },
    transactions: transactions.results || [],
    withdrawals: withdrawals.results || [],
    app: {
      offerwallUrl: OFFERWALL_URL,
      monetagConfigured: !!env.MONETAG_ZONE_ID && !!env.MONETAG_SDK_URL,
      referralRewardCoins: getEnvNumber(env.REFERRAL_REWARD_COINS, 0),
      monetagRewardCoins: getEnvNumber(env.MONETAG_REWARD_COINS, 100),
      dailyAdLimit: getEnvNumber(env.DAILY_AD_LIMIT, 10),
      withdrawMinCoins: getEnvNumber(env.WITHDRAW_MIN_COINS, 50000),
      withdrawMethods: parseWithdrawMethods(env.WITHDRAW_METHODS)
    }
  });
}

async function telegramBotInfo(env) {
  const token = normalizeBotToken(env.BOT_TOKEN);
  if (!token) {
    return json({ success: false, code: "BOT_TOKEN_MISSING" }, 500);
  }

  try {
    const response = await fetch(
      "https://api.telegram.org/bot" + token + "/getMe"
    );
    const result = await response.json();

    if (!response.ok || !result.ok) {
      return json({
        success: false,
        code: "TELEGRAM_BOT_TOKEN_INVALID"
      }, 502);
    }

    return json({
      success: true,
      bot: {
        id: result.result?.id ?? null,
        username: result.result?.username || "",
        first_name: result.result?.first_name || ""
      }
    });
  } catch (error) {
    console.error("Telegram getMe error:", error);
    return json({
      success: false,
      code: "TELEGRAM_BOT_CHECK_FAILED"
    }, 502);
  }
}


// =====================================================
// OFFERWALL
// =====================================================

async function offersUrl(request, env) {
  const auth = await authenticateRequest(request, env);
  if (!auth.ok) return json(auth.body, auth.status);

  const userId = encodeURIComponent(String(auth.user.telegram_id));
  return json({
    success: true,
    url: OFFERWALL_URL.replace("{user_id}", userId)
  });
}

async function offerwallPostback(request, env) {
  if (request.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (!env.DB || !env.OFFERWALL_SECRET) {
    return new Response("server configuration error", { status: 500 });
  }

  await ensureSchema(env.DB);

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
    String(env.OFFERWALL_SECRET),
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

  const parsedAmount = Number(amountRaw);
  if (!Number.isFinite(parsedAmount) || parsedAmount === 0) {
    return new Response("ok", { status: 200 });
  }

  const amount =
    status === "reversed"
      ? -Math.abs(parsedAmount)
      : Math.abs(parsedAmount);

  const user = await env.DB
    .prepare("SELECT id FROM users WHERE telegram_id = ? LIMIT 1")
    .bind(String(userId))
    .first();

  if (!user) {
    return new Response("unknown user", { status: 404 });
  }

  const eventKey = `${tx}:${status}:${amountRaw}`;

  const now = Math.floor(Date.now() / 1000);

  try {
    const result = await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO offerwall_conversions
        (transaction_id, event_key, user_id, amount, status, offer_id, offer_name, goal_id, payout_usd, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        tx,
        eventKey,
        user.id,
        amount,
        status,
        q.get("offerId"),
        q.get("offerName"),
        q.get("goalId"),
        Number(q.get("payoutUsd") || 0),
        now
      ),

      env.DB.prepare(`
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
      ),

      env.DB.prepare(`
        INSERT INTO transactions
        (user_id, type, amount, description, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).bind(
        user.id,
        status === "reversed" ? "offer_reversal" : "offer_reward",
        amount,
        status === "reversed" ? "Offer reversed" : "Offer reward",
        now
      )
    ]);

    return new Response("ok", { status: 200 });
  } catch (error) {
    const msg = String(error?.message || "").toLowerCase();

    if (
      msg.includes("unique") ||
      msg.includes("constraint")
    ) {
      return new Response("ok", { status: 200 });
    }

    console.error("Offerwall postback error:", error);
    return new Response("server error", { status: 500 });
  }
}


// =====================================================
// MONETAG REWARDED ADS
// =====================================================

async function monetagAdStart(request, env) {
  const auth = await authenticateRequest(request, env);
  if (!auth.ok) return json(auth.body, auth.status);

  if (!env.DB) {
    return json({ success: false, message: "D1 is not configured." }, 500);
  }

  if (!env.MONETAG_ZONE_ID || !env.MONETAG_SDK_URL) {
    return json({
      success: false,
      code: "MONETAG_NOT_CONFIGURED",
      message: "Monetag SDK is not configured."
    }, 503);
  }

  await ensureSchema(env.DB);

  const userId = auth.user.db_id;
  const now = Math.floor(Date.now() / 1000);

  const limit = Math.max(
    1,
    Math.floor(getEnvNumber(env.DAILY_AD_LIMIT, 10))
  );

  const startOfDay =
    new Date(
      new Date().toISOString().slice(0, 10) + "T00:00:00Z"
    ).getTime() / 1000;

  const count = await env.DB
    .prepare(`
      SELECT COUNT(*) AS count
      FROM ad_events
      WHERE user_id = ?
        AND created_at >= ?
    `)
    .bind(userId, startOfDay)
    .first();

  if (Number(count?.count || 0) >= limit) {
    return json({
      success: false,
      code: "DAILY_AD_LIMIT",
      message: "Daily ad limit reached."
    }, 429);
  }

  const ymid = "cc_ad_" + crypto.randomUUID();

  await env.DB.prepare(`
    INSERT INTO ad_events
    (ymid, user_id, status, reward_coins, created_at)
    VALUES (?, ?, 'pending', ?, ?)
  `).bind(
    ymid,
    userId,
    getEnvNumber(env.MONETAG_REWARD_COINS, 100),
    now
  ).run();

  return json({
    success: true,
    ymid,
    reward_coins: getEnvNumber(env.MONETAG_REWARD_COINS, 100)
  });
}

async function monetagAdStatus(request, env) {
  const auth = await authenticateRequest(request, env);
  if (!auth.ok) return json(auth.body, auth.status);

  const url = new URL(request.url);
  const ymid = url.searchParams.get("ymid") || "";

  if (!ymid) {
    return json({ success: false, message: "ymid is required." }, 400);
  }

  const event = await env.DB
    .prepare(`
      SELECT ymid, status, reward_coins, reward_event_type, created_at, completed_at
      FROM ad_events
      WHERE ymid = ? AND user_id = ?
      LIMIT 1
    `)
    .bind(ymid, auth.user.db_id)
    .first();

  if (!event) {
    return json({ success: false, message: "Ad event not found." }, 404);
  }

  return json({
    success: true,
    event
  });
}

async function monetagPostback(request, env) {
  if (request.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (!env.DB) {
    return new Response("server configuration error", { status: 500 });
  }

  const q = new URL(request.url).searchParams;

  const key = q.get("key") || "";
  const expectedKey = String(env.MONETAG_POSTBACK_KEY || "");

  if (!expectedKey || key !== expectedKey) {
    return new Response("invalid key", { status: 403 });
  }

  await ensureSchema(env.DB);

  const ymid = q.get("ymid") || "";
  const rewardEventType = q.get("value") || q.get("reward_event_type") || "";
  const eventType = q.get("event") || q.get("event_type") || "";
  const zoneId = q.get("zone") || q.get("zone_id") || "";
  const subZoneId = q.get("sub") || q.get("sub_zone_id") || "";
  const requestVar = q.get("source") || q.get("request_var") || "";
  const telegramId = q.get("telegram_id") || "";
  const estimatedPrice = Number(
    q.get("price") || q.get("estimated_price") || 0
  );

  if (!ymid) {
    return new Response("missing ymid", { status: 400 });
  }

  const event = await env.DB
    .prepare(`
      SELECT *
      FROM ad_events
      WHERE ymid = ?
      LIMIT 1
    `)
    .bind(ymid)
    .first();

  if (!event) {
    return new Response("unknown ymid", { status: 404 });
  }

  if (event.status === "rewarded") {
    return new Response("ok", { status: 200 });
  }

  const now = Math.floor(Date.now() / 1000);

  if (rewardEventType !== "valued") {
    await env.DB.prepare(`
      UPDATE ad_events
      SET
        status = 'not_valued',
        reward_event_type = ?,
        event_type = ?,
        zone_id = ?,
        sub_zone_id = ?,
        request_var = ?,
        estimated_price = ?,
        completed_at = ?
      WHERE ymid = ?
        AND status = 'pending'
    `).bind(
      rewardEventType,
      eventType,
      zoneId,
      subZoneId,
      requestVar,
      Number.isFinite(estimatedPrice) ? estimatedPrice : 0,
      now,
      ymid
    ).run();

    return new Response("ok", { status: 200 });
  }

  const reward = Number(event.reward_coins || 0);

  if (!Number.isFinite(reward) || reward <= 0) {
    return new Response("invalid reward", { status: 500 });
  }

  const statements = [
    env.DB.prepare(`
      UPDATE ad_events
      SET
        status = 'rewarded',
        reward_event_type = ?,
        event_type = ?,
        zone_id = ?,
        sub_zone_id = ?,
        request_var = ?,
        estimated_price = ?,
        completed_at = ?
      WHERE ymid = ?
        AND status = 'pending'
    `).bind(
      rewardEventType,
      eventType,
      zoneId,
      subZoneId,
      requestVar,
      Number.isFinite(estimatedPrice) ? estimatedPrice : 0,
      now,
      ymid
    ),

    env.DB.prepare(`
      UPDATE wallets
      SET
        balance = balance + ?,
        lifetime_earned = lifetime_earned + ?,
        updated_at = ?
      WHERE user_id = ?
    `).bind(
      reward,
      reward,
      now,
      event.user_id
    ),

    env.DB.prepare(`
      INSERT INTO transactions
      (user_id, type, amount, description, created_at)
      VALUES (?, 'ad_reward', ?, ?, ?)
    `).bind(
      event.user_id,
      reward,
      "Monetag rewarded ad",
      now
    )
  ];

  try {
    await env.DB.batch(statements);
    return new Response("ok", { status: 200 });
  } catch (error) {
    console.error("Monetag reward error:", error);
    return new Response("server error", { status: 500 });
  }
}


// =====================================================
// WITHDRAWALS
// =====================================================

async function createWithdrawal(request, env) {
  const auth = await authenticateRequest(request, env);
  if (!auth.ok) return json(auth.body, auth.status);

  if (request.method !== "POST") {
    return json({ success: false, message: "POST required." }, 405);
  }

  await ensureSchema(env.DB);

  let body = {};
  try {
    body = await request.json();
  } catch (_) {
    return json({ success: false, message: "Invalid JSON." }, 400);
  }

  const amount = Number(body.amount);
  const method = String(body.method || "").trim();
  const address = String(body.address || "").trim();

  const minCoins = getEnvNumber(env.WITHDRAW_MIN_COINS, 50000);
  const methods = parseWithdrawMethods(env.WITHDRAW_METHODS);

  if (!Number.isFinite(amount) || amount <= 0) {
    return json({ success: false, message: "Invalid amount." }, 400);
  }

  if (amount < minCoins) {
    return json({
      success: false,
      message: `Minimum withdrawal is ${minCoins} Coins.`
    }, 400);
  }

  if (!methods.includes(method)) {
    return json({
      success: false,
      message: "Invalid withdrawal method."
    }, 400);
  }

  if (address.length < 3 || address.length > 200) {
    return json({
      success: false,
      message: "Invalid withdrawal address."
    }, 400);
  }

  const now = Math.floor(Date.now() / 1000);

  try {
    const results = await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO withdrawals
        (user_id, amount, method, address, status, created_at, updated_at)
        SELECT ?, ?, ?, ?, 'pending', ?, ?
        FROM wallets
        WHERE user_id = ?
          AND balance >= ?
      `).bind(
        auth.user.db_id,
        amount,
        method,
        address,
        now,
        now,
        auth.user.db_id,
        amount
      ),

      env.DB.prepare(`
        UPDATE wallets
        SET balance = balance - ?,
            updated_at = ?
        WHERE user_id = ?
          AND balance >= ?
      `).bind(
        amount,
        now,
        auth.user.db_id,
        amount
      )
    ]);

    const insertChanges = Number(results?.[0]?.meta?.changes || 0);
    const updateChanges = Number(results?.[1]?.meta?.changes || 0);

    if (insertChanges !== 1 || updateChanges !== 1) {
      return json({
        success: false,
        message: "Insufficient balance."
      }, 400);
    }

    await env.DB.prepare(`
      INSERT INTO transactions
      (user_id, type, amount, description, created_at)
      VALUES (?, 'withdrawal_request', ?, ?, ?)
    `).bind(
      auth.user.db_id,
      -amount,
      `Withdrawal request: ${method}`,
      now
    ).run();

    return json({
      success: true,
      message: "Withdrawal request submitted."
    });
  } catch (error) {
    console.error("Withdrawal error:", error);
    return json({
      success: false,
      message: "Unable to create withdrawal."
    }, 500);
  }
}


// =====================================================
// ADMIN
// =====================================================

async function adminAuthenticate(request, env) {
  const auth = await authenticateRequest(request, env);

  if (!auth.ok) return auth;

  const adminId = String(env.ADMIN_TELEGRAM_ID || "").trim();

  if (!adminId || auth.user.telegram_id !== adminId) {
    return {
      ok: false,
      status: 403,
      body: {
        success: false,
        message: "Admin access denied."
      }
    };
  }

  return auth;
}

async function adminWithdrawals(request, env) {
  const auth = await adminAuthenticate(request, env);
  if (!auth.ok) return json(auth.body, auth.status);

  await ensureSchema(env.DB);

  const result = await env.DB.prepare(`
    SELECT
      w.id,
      w.amount,
      w.method,
      w.address,
      w.status,
      w.created_at,
      w.updated_at,
      w.admin_note,
      u.telegram_id,
      u.username,
      u.first_name,
      u.last_name
    FROM withdrawals w
    JOIN users u ON u.id = w.user_id
    ORDER BY w.id DESC
    LIMIT 100
  `).all();

  return json({
    success: true,
    withdrawals: result.results || []
  });
}

async function adminUsers(request, env) {
  const auth = await adminAuthenticate(request, env);
  if (!auth.ok) return json(auth.body, auth.status);

  await ensureSchema(env.DB);

  const result = await env.DB.prepare(`
    SELECT
      u.id,
      u.telegram_id,
      u.username,
      u.first_name,
      u.last_name,
      u.referral_code,
      u.created_at,
      w.balance,
      w.lifetime_earned,
      w.lifetime_withdrawn
    FROM users u
    LEFT JOIN wallets w ON w.user_id = u.id
    ORDER BY u.id DESC
    LIMIT 200
  `).all();

  return json({
    success: true,
    users: result.results || []
  });
}

async function adminWithdrawalStatus(request, env) {
  const auth = await adminAuthenticate(request, env);
  if (!auth.ok) return json(auth.body, auth.status);

  let body = {};
  try {
    body = await request.json();
  } catch (_) {
    return json({ success: false, message: "Invalid JSON." }, 400);
  }

  const withdrawalId = Number(body.id);
  const status = String(body.status || "");
  const note = String(body.note || "").trim();

  if (!Number.isInteger(withdrawalId)) {
    return json({ success: false, message: "Invalid withdrawal ID." }, 400);
  }

  if (status !== "paid" && status !== "rejected") {
    return json({ success: false, message: "Invalid status." }, 400);
  }

  const row = await env.DB
    .prepare(`
      SELECT id, user_id, amount, status
      FROM withdrawals
      WHERE id = ?
      LIMIT 1
    `)
    .bind(withdrawalId)
    .first();

  if (!row) {
    return json({ success: false, message: "Withdrawal not found." }, 404);
  }

  if (row.status !== "pending") {
    return json({
      success: false,
      message: "Withdrawal already processed."
    }, 409);
  }

  const now = Math.floor(Date.now() / 1000);

  if (status === "paid") {
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE withdrawals
        SET status = 'paid', updated_at = ?, admin_note = ?
        WHERE id = ? AND status = 'pending'
      `).bind(now, note || null, withdrawalId),

      env.DB.prepare(`
        UPDATE wallets
        SET lifetime_withdrawn = lifetime_withdrawn + ?,
            updated_at = ?
        WHERE user_id = ?
      `).bind(row.amount, now, row.user_id)
    ]);
  } else {
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE withdrawals
        SET status = 'rejected', updated_at = ?, admin_note = ?
        WHERE id = ? AND status = 'pending'
      `).bind(now, note || null, withdrawalId),

      env.DB.prepare(`
        UPDATE wallets
        SET balance = balance + ?,
            updated_at = ?
        WHERE user_id = ?
      `).bind(row.amount, now, row.user_id),

      env.DB.prepare(`
        INSERT INTO transactions
        (user_id, type, amount, description, created_at)
        VALUES (?, 'withdrawal_refund', ?, 'Withdrawal rejected - refunded', ?)
      `).bind(row.user_id, row.amount, now)
    ]);
  }

  return json({
    success: true,
    message: `Withdrawal marked ${status}.`
  });
}

async function adminBalance(request, env) {
  const auth = await adminAuthenticate(request, env);
  if (!auth.ok) return json(auth.body, auth.status);

  let body = {};
  try {
    body = await request.json();
  } catch (_) {
    return json({ success: false, message: "Invalid JSON." }, 400);
  }

  const telegramId = String(body.telegram_id || "").trim();
  const delta = Number(body.amount);
  const reason = String(body.reason || "Admin balance adjustment").trim();

  if (!telegramId || !Number.isFinite(delta) || delta === 0) {
    return json({
      success: false,
      message: "telegram_id and non-zero amount are required."
    }, 400);
  }

  const user = await env.DB
    .prepare("SELECT id FROM users WHERE telegram_id = ? LIMIT 1")
    .bind(telegramId)
    .first();

  if (!user) {
    return json({
      success: false,
      message: "User not found."
    }, 404);
  }

  const wallet = await env.DB
    .prepare("SELECT balance FROM wallets WHERE user_id = ? LIMIT 1")
    .bind(user.id)
    .first();

  if (!wallet || Number(wallet.balance) + delta < 0) {
    return json({
      success: false,
      message: "Balance cannot become negative."
    }, 400);
  }

  const now = Math.floor(Date.now() / 1000);

  await env.DB.batch([
    env.DB.prepare(`
      UPDATE wallets
      SET balance = balance + ?,
          lifetime_earned = CASE
            WHEN ? > 0 THEN lifetime_earned + ?
            ELSE lifetime_earned
          END,
          updated_at = ?
      WHERE user_id = ?
    `).bind(delta, delta, delta, now, user.id),

    env.DB.prepare(`
      INSERT INTO transactions
      (user_id, type, amount, description, created_at)
      VALUES (?, 'admin_adjustment', ?, ?, ?)
    `).bind(user.id, delta, reason, now)
  ]);

  return json({
    success: true,
    message: "Balance updated."
  });
}


// =====================================================
// AUTH HELPERS
// =====================================================

async function authenticateRequest(request, env) {
  if (!env.DB || !env.BOT_TOKEN) {
    return {
      ok: false,
      status: 500,
      body: {
        success: false,
        message: "Server configuration is incomplete."
      }
    };
  }

  const initData = await readInitData(request);

  if (!initData) {
    return {
      ok: false,
      status: 401,
      body: {
        success: false,
        code: "NO_INIT_DATA",
        message: "Telegram authorization is missing."
      }
    };
  }

  const validation = await validateTelegramInitData(
    initData,
    normalizeBotToken(env.BOT_TOKEN)
  );

  if (!validation.ok) {
    return {
      ok: false,
      status: 401,
      body: {
        success: false,
        code: validation.code,
        message: validation.message
      }
    };
  }

  await ensureSchema(env.DB);

  const tgUser = validation.data.user;
  const telegramId = String(tgUser.id);
  const now = Math.floor(Date.now() / 1000);

  let user = await env.DB
    .prepare("SELECT * FROM users WHERE telegram_id = ? LIMIT 1")
    .bind(telegramId)
    .first();

  if (!user) {
    const referralCode = generateUniqueReferralCode();

    await env.DB.prepare(`
      INSERT INTO users
      (telegram_id, username, first_name, last_name, referral_code, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      telegramId,
      tgUser.username || null,
      tgUser.first_name || "",
      tgUser.last_name || null,
      referralCode,
      now,
      now
    ).run();

    user = await env.DB
      .prepare("SELECT * FROM users WHERE telegram_id = ? LIMIT 1")
      .bind(telegramId)
      .first();
  }

  await env.DB.prepare(`
    UPDATE users
    SET username = ?, first_name = ?, last_name = ?, updated_at = ?
    WHERE telegram_id = ?
  `).bind(
    tgUser.username || null,
    tgUser.first_name || "",
    tgUser.last_name || null,
    now,
    telegramId
  ).run();

  await env.DB.prepare(`
    INSERT OR IGNORE INTO wallets
    (user_id, balance, lifetime_earned, lifetime_withdrawn, updated_at)
    VALUES (?, 0, 0, 0, ?)
  `).bind(user.id, now).run();

  return {
    ok: true,
    user: {
      db_id: user.id,
      telegram_id: telegramId,
      username: tgUser.username || "",
      first_name: tgUser.first_name || "",
      last_name: tgUser.last_name || ""
    }
  };
}

async function readInitData(request) {
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
    } catch (_) {}
  }

  const header = request.headers.get("X-Telegram-Init-Data");
  if (header && header.trim()) return header.trim();

  const authorization = request.headers.get("Authorization") || "";
  if (authorization.toLowerCase().startsWith("tma ")) {
    return authorization.slice(4).trim();
  }

  return "";
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

    const entries = Array.from(params.entries()).sort((a, b) => {
      if (a[0] < b[0]) return -1;
      if (a[0] > b[0]) return 1;
      return 0;
    });

    const dataCheckString = entries
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");

    const secretKey = await hmacSha256(
      new TextEncoder().encode(botToken),
      "WebAppData"
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
        user,
        start_param: params.get("start_param") || null
      }
    };
  } catch (error) {
    console.error("Telegram validation error:", error);
    return {
      ok: false,
      code: "TELEGRAM_VALIDATION_ERROR",
      message: "Telegram validation failed."
    };
  }
}


// =====================================================
// CRYPTO / HELPERS
// =====================================================

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

async function hmacHexText(secret, message) {
  return hmacSha256Hex(
    new TextEncoder().encode(String(secret || "")),
    message
  );
}

function normalizeBotToken(value) {
  let token = String(value == null ? "" : value)
    .replace(/^\uFEFF/, "")
    .trim();

  if (token.startsWith("BOT_TOKEN=")) {
    token = token.slice("BOT_TOKEN=".length).trim();
  }

  if (
    token.length >= 2 &&
    (
      (token.startsWith('"') && token.endsWith('"')) ||
      (token.startsWith("'") && token.endsWith("'"))
    )
  ) {
    token = token.slice(1, -1).trim();
  }

  return token;
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
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase();
}

function generateUniqueReferralCode() {
  return generateReferralCode();
}

function getEnvNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseWithdrawMethods(value) {
  const raw = String(
    value || "USDT TRC20,Binance"
  );

  return raw
    .split(",")
    .map(v => v.trim())
    .filter(Boolean);
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


// =====================================================
// FRONTEND
// =====================================================

function renderApp(env) {
  let html = APP_HTML.replace(
    "__MONETAG_SDK__",
    buildMonetagScript(env)
  );

  return html.replace(
    "__APP_DEFAULTS__",
    JSON.stringify({
      monetagConfigured: !!env.MONETAG_ZONE_ID && !!env.MONETAG_SDK_URL
    })
  );
}

function buildMonetagScript(env) {
  const zone = String(env.MONETAG_ZONE_ID || "").trim();
  const sdk = String(env.MONETAG_SDK_URL || "").trim();

  if (!zone || !sdk) return "";

  return `<script src="${escapeHtmlAttribute(sdk)}" data-zone="${escapeHtmlAttribute(zone)}" data-sdk="show_${escapeHtmlAttribute(zone)}"></script>`;
}

function escapeHtmlAttribute(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

const APP_HTML = "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover\">\n<title>Coin Cove</title>\n<script src=\"https://telegram.org/js/telegram-web-app.js\"></script>\n__MONETAG_SDK__\n<style>\n*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}\nhtml,body{margin:0;min-height:100%;font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,Arial,sans-serif}\nbody{background:var(--tg-theme-bg-color,#f5f7fb);color:var(--tg-theme-text-color,#111827)}\n.app{max-width:560px;margin:auto;min-height:100vh;padding:20px 16px 105px}\n.header{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px}\n.brand{display:flex;align-items:center;gap:10px}.logo{width:46px;height:46px;border-radius:15px;display:flex;align-items:center;justify-content:center;background:#111827;color:#fff;font-size:24px}\n.title{font-size:21px;font-weight:800}.subtitle{font-size:12px;opacity:.55;margin-top:3px}.avatar{width:42px;height:42px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(127,127,127,.15);font-weight:800}\n.balance{background:#111827;color:#fff;border-radius:25px;padding:25px;margin-bottom:18px;box-shadow:0 12px 30px rgba(0,0,0,.15)}\n.balance-small{font-size:13px;opacity:.65}.balance-number{font-size:38px;font-weight:900;margin-top:5px}.balance-coins{font-size:13px;opacity:.65}\n.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.card{border:0;border-radius:21px;padding:19px 16px;text-align:left;background:var(--tg-theme-secondary-bg-color,#fff);color:var(--tg-theme-text-color,#111827);box-shadow:0 5px 18px rgba(0,0,0,.05);cursor:pointer}.card:active{transform:scale(.98)}\n.icon{font-size:28px;margin-bottom:10px}.card-title{font-size:15px;font-weight:800}.card-text{font-size:12px;opacity:.55;margin-top:5px;line-height:1.35}\n.section{margin-top:24px}.section-title{font-size:17px;font-weight:800;margin-bottom:11px}\n.stats{display:grid;grid-template-columns:1fr 1fr;gap:10px}.stat,.activity{background:var(--tg-theme-secondary-bg-color,#fff);border-radius:18px;padding:16px}.stat-number{font-size:21px;font-weight:800}.stat-label{font-size:11px;opacity:.55;margin-top:4px}\n.transaction{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid rgba(127,127,127,.12)}.transaction:last-child{border-bottom:0}.transaction-title{font-size:13px;font-weight:700}.transaction-date{font-size:10px;opacity:.5;margin-top:3px}.transaction-amount{font-weight:800}\n.bottom{position:fixed;left:0;right:0;bottom:0;padding:9px 15px calc(9px + env(safe-area-inset-bottom));background:rgba(245,247,251,.92);backdrop-filter:blur(14px);z-index:5}.bottom-inner{max-width:560px;margin:auto;display:grid;grid-template-columns:repeat(4,1fr)}.nav{border:0;background:transparent;color:var(--tg-theme-hint-color,#6b7280);padding:8px 2px;font-size:11px;cursor:pointer}.nav-icon{display:block;font-size:20px;margin-bottom:3px}\n.loading,.error{min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:30px}\n.modal{position:fixed;inset:0;background:var(--tg-theme-bg-color,#f5f7fb);z-index:20;overflow:auto;padding:18px 16px 90px}.modal-head{display:flex;align-items:center;gap:8px;margin-bottom:14px}.back{border:0;background:transparent;font-size:28px}.modal-title{font-weight:800;font-size:18px}\n.row{background:var(--tg-theme-secondary-bg-color,#fff);border-radius:16px;padding:14px;margin-bottom:10px}\n.input,.select{width:100%;padding:12px;border:1px solid rgba(127,127,127,.18);border-radius:12px;background:transparent;color:inherit;margin-top:7px}\n.primary{border:0;border-radius:13px;padding:13px 16px;font-weight:800;width:100%;margin-top:10px}.notice{font-size:12px;opacity:.6;line-height:1.45}\n.wall{position:fixed;inset:0;background:var(--tg-theme-bg-color,#f5f7fb);z-index:30;display:flex;flex-direction:column}.wall-head{height:54px;display:flex;align-items:center;gap:8px;padding:0 12px;border-bottom:1px solid rgba(127,127,127,.12)}.wall-head button{border:0;background:transparent;font-size:25px}.wall-frame{width:100%;height:calc(100% - 54px);border:0;flex:1}\n.small{font-size:11px;opacity:.55}.ok{padding:10px;background:rgba(0,180,80,.1);border-radius:12px}.warn{padding:10px;background:rgba(200,140,0,.1);border-radius:12px}\n</style>\n</head>\n<body>\n<div id=\"app\"><div class=\"loading\">Loading Coin Cove...</div></div>\n<script>\n(function(){\n  const tg = window.Telegram && window.Telegram.WebApp;\n  const DEFAULTS = __APP_DEFAULTS__;\n  let appData = null;\n\n  if (tg) {\n    try { tg.ready(); tg.expand(); } catch(e) {}\n  }\n\n  function initData() {\n    return tg && typeof tg.initData === \"string\" ? tg.initData.trim() : \"\";\n  }\n\n  async function api(path, options) {\n    options = options || {};\n    const headers = Object.assign({}, options.headers || {});\n    headers[\"Content-Type\"] = \"application/json\";\n    return fetch(path, Object.assign({}, options, {\n      headers,\n      cache: \"no-store\"\n    }));\n  }\n\n  async function loadApp() {\n    if (!tg || !initData()) {\n      showError(\"Please open Coin Cove using Open App inside Telegram.\");\n      return;\n    }\n\n    try {\n      const response = await api(\"/api/me\", {\n        method: \"POST\",\n        body: JSON.stringify({ initData: initData() })\n      });\n      const data = await response.json();\n\n      if (!response.ok || !data.success) {\n        showError(data.message || \"Unable to load Coin Cove.\");\n        return;\n      }\n\n      appData = data;\n      window.currentTelegramId = data.user.telegram_id;\n      renderHome();\n    } catch (error) {\n      console.error(error);\n      showError(\"Unable to connect to Coin Cove.\");\n    }\n  }\n\n  function renderHome() {\n    const d = appData;\n    const user = d.user || {};\n    const wallet = d.wallet || {};\n    const referrals = d.referrals || {};\n    const transactions = Array.isArray(d.transactions) ? d.transactions : [];\n    const initial = escapeHtml((user.first_name || \"C\").charAt(0).toUpperCase());\n\n    const activity = transactions.length\n      ? transactions.map(function(tx){\n          const amount = Number(tx.amount || 0);\n          return '<div class=\"transaction\">' +\n            '<div><div class=\"transaction-title\">' +\n            escapeHtml(tx.description || tx.type || \"Transaction\") +\n            '</div><div class=\"transaction-date\">' +\n            formatDate(tx.created_at) +\n            '</div></div><div class=\"transaction-amount\">' +\n            (amount > 0 ? \"+\" : \"\") + escapeHtml(String(amount)) +\n            '</div></div>';\n        }).join(\"\")\n      : '<div class=\"small\">No activity yet.</div>';\n\n    document.getElementById(\"app\").innerHTML =\n      '<div class=\"app\">' +\n        '<div class=\"header\">' +\n          '<div class=\"brand\"><div class=\"logo\">🪙</div><div>' +\n            '<div class=\"title\">Coin Cove</div>' +\n            '<div class=\"subtitle\">Earn • Complete • Reward</div>' +\n          '</div></div>' +\n          '<div class=\"avatar\">' + initial + '</div>' +\n        '</div>' +\n\n        '<div class=\"balance\">' +\n          '<div class=\"balance-small\">Welcome back, ' + escapeHtml(user.first_name || \"there\") + '</div>' +\n          '<div class=\"balance-number\">' + Number(wallet.balance || 0).toLocaleString() + '</div>' +\n          '<div class=\"balance-coins\">Coins</div>' +\n        '</div>' +\n\n        '<div class=\"grid\">' +\n          card(\"🎁\",\"Earn Offers\",\"Complete offers and earn Coins\",\"openOffers()\") +\n          card(\"📺\",\"Watch & Earn\",\"Rewarded Monetag ads\",\"openAds()\") +\n          card(\"👥\",\"Invite Friends\",\"Your referrals: \" + Number(referrals.count || 0),\"openReferrals()\") +\n          card(\"💸\",\"Withdraw\",\"Request a payout\",\"openWallet()\") +\n        '</div>' +\n\n        (d.admin ? '<div class=\"section\"><button class=\"primary\" onclick=\"openAdmin()\">🔐 Admin Panel</button></div>' : '') +\n\n        '<div class=\"section\"><div class=\"section-title\">Your Statistics</div>' +\n          '<div class=\"stats\">' +\n            '<div class=\"stat\"><div class=\"stat-number\">' + Number(wallet.lifetime_earned || 0).toLocaleString() + '</div><div class=\"stat-label\">Lifetime Earned</div></div>' +\n            '<div class=\"stat\"><div class=\"stat-number\">' + Number(referrals.count || 0).toLocaleString() + '</div><div class=\"stat-label\">Friends Invited</div></div>' +\n          '</div>' +\n        '</div>' +\n\n        '<div class=\"section\"><div class=\"section-title\">Recent Activity</div><div class=\"activity\">' + activity + '</div></div>' +\n      '</div>' +\n\n      '<div class=\"bottom\"><div class=\"bottom-inner\">' +\n        '<button class=\"nav\" onclick=\"renderHome()\"><span class=\"nav-icon\">🏠</span>Home</button>' +\n        '<button class=\"nav\" onclick=\"openOffers()\"><span class=\"nav-icon\">🎁</span>Offers</button>' +\n        '<button class=\"nav\" onclick=\"openReferrals()\"><span class=\"nav-icon\">👥</span>Invite</button>' +\n        '<button class=\"nav\" onclick=\"openWallet()\"><span class=\"nav-icon\">💰</span>Wallet</button>' +\n      '</div></div>';\n  }\n\n  function card(icon, title, text, action) {\n    return '<button class=\"card\" onclick=\"' + action + '\">' +\n      '<div class=\"icon\">' + icon + '</div>' +\n      '<div class=\"card-title\">' + title + '</div>' +\n      '<div class=\"card-text\">' + text + '</div>' +\n      '</button>';\n  }\n\n  window.openOffers = async function(){\n    const response = await api(\"/api/offers/url\", {\n      method: \"POST\",\n      body: JSON.stringify({ initData: initData() })\n    });\n    const data = await response.json();\n\n    if (!data.success) {\n      alert(data.message || \"Unable to open offers.\");\n      return;\n    }\n\n    const existing = document.getElementById(\"offerWall\");\n    if (existing) existing.remove();\n\n    document.body.insertAdjacentHTML(\"beforeend\",\n      '<div class=\"wall\" id=\"offerWall\">' +\n        '<div class=\"wall-head\"><button onclick=\"closeOffers()\">‹</button><b>Earn Offers</b></div>' +\n        '<iframe class=\"wall-frame\" src=\"' + escapeAttribute(data.url) + '\" title=\"Coin Cove Offers\"></iframe>' +\n      '</div>'\n    );\n  };\n\n  window.closeOffers = function(){\n    const el = document.getElementById(\"offerWall\");\n    if (el) el.remove();\n  };\n\n  window.openAds = async function(){\n    await showModal(\"Watch & Earn\", renderAdsPage);\n  };\n\n  function renderAdsPage(container) {\n    const configured = !!DEFAULTS.monetagConfigured;\n    const reward = Number(appData.app?.monetagRewardCoins || 100);\n    const limit = Number(appData.app?.dailyAdLimit || 10);\n\n    container.innerHTML =\n      '<div class=\"notice\">Watch a Monetag Rewarded Interstitial. A reward is credited only after a confirmed Monetag valued postback.</div>' +\n      '<div class=\"row\"><b>Reward:</b> ' + reward.toLocaleString() + ' Coins</div>' +\n      '<div class=\"row\"><b>Daily limit:</b> ' + limit + '</div>' +\n      (configured\n        ? '<button class=\"primary\" onclick=\"watchAd()\">📺 Watch & Earn</button>'\n        : '<div class=\"warn\">Monetag SDK is not configured yet. Add MONETAG_ZONE_ID and MONETAG_SDK_URL in Cloudflare.</div>');\n  }\n\n  window.watchAd = async function(){\n    if (!DEFAULTS.monetagConfigured) return;\n\n    const start = await api(\"/api/ad/start\", {\n      method: \"POST\",\n      body: JSON.stringify({ initData: initData() })\n    });\n    const startData = await start.json();\n\n    if (!start.ok || !startData.success) {\n      alert(startData.message || \"Unable to start ad.\");\n      return;\n    }\n\n    const ymid = startData.ymid;\n    const zone = getMonetagZoneFunction();\n\n    if (!zone) {\n      alert(\"Monetag SDK is not ready. Try again in a moment.\");\n      return;\n    }\n\n    try {\n      const result = await zone({\n        type: \"end\",\n        ymid: ymid,\n        requestVar: \"watch_earn\"\n      });\n\n      if (result && result.reward_event_type === \"non_valued\") {\n        alert(\"This ad was not valued. No reward was added.\");\n        return;\n      }\n\n      alert(\"Ad completed. Waiting for reward confirmation...\");\n\n      for (let i = 0; i < 12; i++) {\n        await sleep(1500);\n\n        const statusResponse = await api(\n          \"/api/ad/status?ymid=\" + encodeURIComponent(ymid),\n          {\n            method: \"GET\",\n            headers: {\n              \"X-Telegram-Init-Data\": initData()\n            }\n          }\n        );\n\n        const statusData = await statusResponse.json();\n\n        if (statusData.success && statusData.event.status === \"rewarded\") {\n          alert(\"Reward credited: \" + Number(statusData.event.reward_coins).toLocaleString() + \" Coins\");\n          await loadApp();\n          return;\n        }\n\n        if (statusData.success && statusData.event.status === \"not_valued\") {\n          alert(\"The ad was completed but was not valued. No reward was added.\");\n          return;\n        }\n      }\n\n      alert(\"Ad completed. The reward is still being confirmed.\");\n    } catch (error) {\n      console.error(error);\n      alert(\"Ad failed or was closed.\");\n    }\n  };\n\n  function getMonetagZoneFunction() {\n    const zoneIds = Object.keys(window).filter(function(key){\n      return /^show_\\d+$/.test(key) && typeof window[key] === \"function\";\n    });\n\n    if (!zoneIds.length) return null;\n    return window[zoneIds[0]];\n  }\n\n  window.openReferrals = async function(){\n    await showModal(\"Invite Friends\", renderReferralPage);\n  };\n\n  function renderReferralPage(container) {\n    const code = appData.user.referral_code;\n    const link = \"https://t.me/Covecoinbot?startapp=\" + encodeURIComponent(code);\n    const reward = Number(appData.app?.referralRewardCoins || 0);\n\n    container.innerHTML =\n      '<div class=\"row\"><b>Your referral code</b><div style=\"margin-top:7px;font-size:20px;font-weight:800\">' +\n      escapeHtml(code) +\n      '</div></div>' +\n      '<div class=\"row\"><b>Your invite link</b><input class=\"input\" value=\"' + escapeAttribute(link) + '\" readonly></div>' +\n      '<div class=\"row\">Current referral reward: ' + reward.toLocaleString() + ' Coins</div>' +\n      '<button class=\"primary\" onclick=\"copyReferral()\">Copy Invite Link</button>';\n  }\n\n  window.copyReferral = async function(){\n    const code = appData.user.referral_code;\n    const link = \"https://t.me/Covecoinbot?startapp=\" + encodeURIComponent(code);\n    try {\n      await navigator.clipboard.writeText(link);\n      alert(\"Invite link copied.\");\n    } catch (_) {\n      alert(link);\n    }\n  };\n\n  window.openWallet = async function(){\n    await showModal(\"Wallet\", renderWalletPage);\n  };\n\n  function renderWalletPage(container) {\n    const methods = appData.app?.withdrawMethods || [];\n    const min = Number(appData.app?.withdrawMinCoins || 50000);\n\n    container.innerHTML =\n      '<div class=\"row\"><b>Balance:</b> ' +\n      Number(appData.wallet.balance || 0).toLocaleString() +\n      ' Coins</div>' +\n      '<div class=\"row\"><b>Minimum withdrawal:</b> ' + min.toLocaleString() + ' Coins</div>' +\n      '<div class=\"row\">' +\n        '<label>Amount</label>' +\n        '<input class=\"input\" id=\"withdrawAmount\" type=\"number\" min=\"1\" step=\"1\" placeholder=\"Coins\">' +\n        '<label style=\"display:block;margin-top:12px\">Method</label>' +\n        '<select class=\"select\" id=\"withdrawMethod\">' +\n          methods.map(function(m){ return '<option value=\"' + escapeAttribute(m) + '\">' + escapeHtml(m) + '</option>'; }).join(\"\") +\n        '</select>' +\n        '<label style=\"display:block;margin-top:12px\">Wallet / Address</label>' +\n        '<input class=\"input\" id=\"withdrawAddress\" maxlength=\"200\" placeholder=\"Enter payout address\">' +\n        '<button class=\"primary\" onclick=\"submitWithdrawal()\">Request Withdrawal</button>' +\n      '</div>' +\n      '<div class=\"row\"><b>Recent Withdrawals</b>' + renderWithdrawals() + '</div>';\n  }\n\n  function renderWithdrawals() {\n    const rows = Array.isArray(appData.withdrawals) ? appData.withdrawals : [];\n    if (!rows.length) return '<div class=\"small\" style=\"margin-top:8px\">No withdrawals yet.</div>';\n\n    return rows.map(function(w){\n      return '<div style=\"margin-top:10px;padding-top:10px;border-top:1px solid rgba(127,127,127,.12)\">' +\n        '<b>' + Number(w.amount).toLocaleString() + ' Coins</b> · ' +\n        escapeHtml(w.method) + ' · ' +\n        escapeHtml(w.status) +\n        '<div class=\"small\">' + formatDate(w.created_at) + '</div>' +\n      '</div>';\n    }).join(\"\");\n  }\n\n  window.submitWithdrawal = async function(){\n    const amount = Number(document.getElementById(\"withdrawAmount\").value);\n    const method = document.getElementById(\"withdrawMethod\").value;\n    const address = document.getElementById(\"withdrawAddress\").value.trim();\n\n    const response = await api(\"/api/withdraw\", {\n      method: \"POST\",\n      body: JSON.stringify({\n        initData: initData(),\n        amount,\n        method,\n        address\n      })\n    });\n\n    const data = await response.json();\n\n    if (!response.ok || !data.success) {\n      alert(data.message || \"Withdrawal failed.\");\n      return;\n    }\n\n    alert(\"Withdrawal request submitted.\");\n    await loadApp();\n    await openWallet();\n  };\n\n  window.openAdmin = async function(){\n    if (!appData.admin) {\n      alert(\"Admin access is disabled.\");\n      return;\n    }\n\n    await showModal(\"Admin\", renderAdminPage);\n  };\n\n  async function renderAdminPage(container) {\n    container.innerHTML = '<div class=\"row\">Loading admin data...</div>';\n\n    const [uRes, wRes] = await Promise.all([\n      api(\"/api/admin/users\", {\n        method: \"GET\",\n        headers: { \"X-Telegram-Init-Data\": initData() }\n      }),\n      api(\"/api/admin/withdrawals\", {\n        method: \"GET\",\n        headers: { \"X-Telegram-Init-Data\": initData() }\n      })\n    ]);\n\n    const users = await uRes.json();\n    const withdrawals = await wRes.json();\n\n    let html =\n      '<div class=\"row\"><b>Users</b><div class=\"small\">' +\n      Number(users.users?.length || 0) + ' shown</div></div>';\n\n    (withdrawals.withdrawals || []).slice(0, 30).forEach(function(w){\n      html += '<div class=\"row\">' +\n        '<b>#' + w.id + '</b> · ' + Number(w.amount).toLocaleString() + ' Coins<br>' +\n        escapeHtml(w.first_name || \"\") + ' · ' + escapeHtml(w.method) +\n        '<div class=\"small\">' + escapeHtml(w.address) + '</div>' +\n        '<div style=\"display:flex;gap:8px;margin-top:8px\">' +\n        \"<button onclick=\\\"adminSetWithdrawal(\" + w.id + \", 'paid')\\\" style=\\\"padding:9px;border:0;border-radius:10px\\\">Mark Paid</button>\" +\n        \"<button onclick=\\\"adminSetWithdrawal(\" + w.id + \", 'rejected')\\\" style=\\\"padding:9px;border:0;border-radius:10px\\\">Reject</button>\" +\n        '</div></div>';\n    });\n\n    html +=\n      '<div class=\"row\"><b>Balance Adjustment</b>' +\n      '<input class=\"input\" id=\"adminTelegramId\" placeholder=\"Telegram ID\">' +\n      '<input class=\"input\" id=\"adminDelta\" type=\"number\" placeholder=\"Coins (+/-)\">' +\n      '<input class=\"input\" id=\"adminReason\" placeholder=\"Reason\">' +\n      '<button class=\"primary\" onclick=\"adminAdjustBalance()\">Update Balance</button>' +\n      '</div>';\n\n    html +=\n      '<div class=\"row notice\">Set ADMIN_TELEGRAM_ID in Cloudflare to the Telegram ID of your admin account.</div>';\n\n    container.innerHTML = html;\n  }\n\n  window.adminSetWithdrawal = async function(id, status){\n    const response = await api(\"/api/admin/withdrawal-status\", {\n      method: \"POST\",\n      body: JSON.stringify({\n        initData: initData(),\n        id,\n        status\n      })\n    });\n\n    const data = await response.json();\n    if (!response.ok || !data.success) {\n      alert(data.message || \"Admin action failed.\");\n      return;\n    }\n\n    alert(\"Updated.\");\n    await loadApp();\n    await openAdmin();\n  };\n\n  window.adminAdjustBalance = async function(){\n    const telegram_id = document.getElementById(\"adminTelegramId\").value.trim();\n    const amount = Number(document.getElementById(\"adminDelta\").value);\n    const reason = document.getElementById(\"adminReason\").value.trim();\n\n    const response = await api(\"/api/admin/balance\", {\n      method: \"POST\",\n      body: JSON.stringify({\n        initData: initData(),\n        telegram_id,\n        amount,\n        reason\n      })\n    });\n\n    const data = await response.json();\n\n    if (!response.ok || !data.success) {\n      alert(data.message || \"Balance update failed.\");\n      return;\n    }\n\n    alert(\"Balance updated.\");\n  };\n\n  async function showModal(title, renderer) {\n    const existing = document.getElementById(\"modal\");\n    if (existing) existing.remove();\n\n    document.body.insertAdjacentHTML(\n      \"beforeend\",\n      '<div class=\"modal\" id=\"modal\">' +\n        '<div class=\"modal-head\"><button class=\"back\" onclick=\"closeModal()\">‹</button><div class=\"modal-title\">' + escapeHtml(title) + '</div></div>' +\n        '<div id=\"modalContent\"></div>' +\n      '</div>'\n    );\n\n    await renderer(document.getElementById(\"modalContent\"));\n  }\n\n  window.closeModal = function(){\n    const el = document.getElementById(\"modal\");\n    if (el) el.remove();\n  };\n\n  function showError(message) {\n    document.getElementById(\"app\").innerHTML =\n      '<div class=\"error\"><div><div style=\"font-size:50px\">🪙</div>' +\n      '<h2>Coin Cove</h2><p style=\"opacity:.6\">' +\n      escapeHtml(message) +\n      '</p><button onclick=\"location.reload()\" style=\"padding:11px 18px;border:0;border-radius:10px\">Retry</button></div></div>';\n  }\n\n  function sleep(ms) {\n    return new Promise(resolve => setTimeout(resolve, ms));\n  }\n\n  function formatDate(ts) {\n    if (!ts) return \"\";\n    return new Date(Number(ts) * 1000).toLocaleDateString();\n  }\n\n  function escapeHtml(value) {\n    return String(value == null ? \"\" : value)\n      .replaceAll(\"&\", \"&amp;\")\n      .replaceAll(\"<\", \"&lt;\")\n      .replaceAll(\">\", \"&gt;\")\n      .replaceAll('\"', \"&quot;\")\n      .replaceAll(\"'\", \"&#039;\");\n  }\n\n  function escapeAttribute(value) {\n    return escapeHtml(value);\n  }\n\n  loadApp();\n})();\n</script>\n</body>\n</html>";
