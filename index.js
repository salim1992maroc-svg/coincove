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

      // External Coin Cove admin dashboard. This is intentionally outside
      // Telegram Mini App authentication and is protected by a signed session.
      if (url.pathname === "/admin" || url.pathname === "/admin/") {
        return new Response(renderAdminApp(), {
          headers: {
            "content-type": "text/html; charset=UTF-8",
            "cache-control": "no-store"
          }
        });
      }

      if (url.pathname.startsWith("/admin/api/")) {
        return await handleAdminApi(request, env);
      }

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
    if (!receivedHash) {
      console.error("Telegram validation: hash is missing");
      return null;
    }

    params.delete("hash");

    const entries = [...params.entries()];

    entries.sort((a, b) => {
      if (a[0] < b[0]) return -1;
      if (a[0] > b[0]) return 1;
      return 0;
    });

    const dataCheckString = entries
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");

    /*
     * Telegram Mini App validation:
     *
     * secret_key = HMAC-SHA256(
     *   key = bot token,
     *   data = "WebAppData"
     * )
     */

    const secretKey = await hmacSha256(
      new TextEncoder().encode(String(botToken)),
      "WebAppData"
    );

    const calculatedHash = await hmacSha256Hex(
      secretKey,
      dataCheckString
    );

    if (!constantTimeEqual(
      calculatedHash.toLowerCase(),
      receivedHash.toLowerCase()
    )) {
      console.error("Telegram hash mismatch");
      return null;
    }

    const authDateRaw = params.get("auth_date");
    const authDate = Number(authDateRaw);
    const now = Math.floor(Date.now() / 1000);

    if (!Number.isFinite(authDate) || authDate <= 0) {
      console.error("Telegram validation: invalid auth_date");
      return null;
    }

    /*
     * Reject timestamps from the future.
     */
    if (authDate > now + 300) {
      console.error("Telegram validation: auth_date is in the future");
      return null;
    }

    /*
     * Telegram initData should not be reused indefinitely.
     */
    if (now - authDate > 86400) {
      console.error("Telegram validation: initData expired");
      return null;
    }

    const userRaw = params.get("user");

    if (!userRaw) {
      console.error("Telegram validation: user is missing");
      return null;
    }

    let user;

    try {
      user = JSON.parse(userRaw);
    } catch (error) {
      console.error("Telegram validation: invalid user JSON");
      return null;
    }

    if (!user || !user.id) {
      console.error("Telegram validation: user.id is missing");
      return null;
    }

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

const ADMIN_SESSION_COOKIE = "cc_admin_session";
const ADMIN_SESSION_TTL = 60 * 60 * 12;

async function ensureAdminTables(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS settings (
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
      created_at TEXT NOT NULL,
      processed_at TEXT,
      admin_note TEXT
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      details TEXT,
      created_at INTEGER NOT NULL
    )
  `).run();
}

async function adminSecret(env) {
  if (!env.ADMIN_PANEL_PASSWORD) return null;
  return String(env.ADMIN_PANEL_PASSWORD);
}

async function createAdminSession(env) {
  const password = await adminSecret(env);
  if (!password) return null;
  const secret = String(env.ADMIN_SESSION_SECRET || password);
  const exp = Math.floor(Date.now() / 1000) + ADMIN_SESSION_TTL;
  const payload = `coin-cove-admin:${exp}`;
  const sig = await hmacHexText(secret, payload);
  return `${btoa(payload)}.${sig}`;
}

async function verifyAdminSession(request, env) {
  const password = await adminSecret(env);
  if (!password) return false;
  const secret = String(env.ADMIN_SESSION_SECRET || password);
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(new RegExp(`${ADMIN_SESSION_COOKIE}=([^;]+)`));
  if (!match) return false;
  const token = match[1];
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  let payload;
  try { payload = atob(parts[0]); } catch { return false; }
  const expected = await hmacHexText(secret, payload);
  if (!constantTimeEqual(expected, parts[1])) return false;
  const m = payload.match(/^coin-cove-admin:(\d+)$/);
  if (!m) return false;
  return Number(m[1]) > Math.floor(Date.now() / 1000);
}

function adminCookie(token, maxAge) {
  return `${ADMIN_SESSION_COOKIE}=${token}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

async function adminJson(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store",
      ...headers
    }
  });
}

async function adminAudit(db, action, targetType, targetId, details, adminId = "ADMIN") {
  try {
    await db.prepare(`
      INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      adminId,
      action,
      targetType || null,
      targetId == null ? null : String(targetId),
      details ? JSON.stringify(details) : null,
      Math.floor(Date.now() / 1000)
    ).run();
  } catch (e) {
    console.error("admin audit error", e);
  }
}

async function adminStats(db) {
  const users = await db.prepare("SELECT COUNT(*) AS n FROM users").first();
  const wallets = await db.prepare("SELECT COALESCE(SUM(balance),0) AS balance, COALESCE(SUM(lifetime_earned),0) AS earned, COALESCE(SUM(lifetime_withdrawn),0) AS withdrawn FROM wallets").first();
  const today = new Date().toISOString().slice(0, 10);
  const newToday = await db.prepare("SELECT COUNT(*) AS n FROM users WHERE substr(datetime(created_at,'unixepoch'),1,10)=?").bind(today).first().catch(() => ({n:0}));
  let pending = {n:0};
  try { pending = await db.prepare("SELECT COUNT(*) AS n FROM withdrawals WHERE status='Pending'").first(); } catch {}
  let offers = {n:0, amount:0};
  try { offers = await db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS amount FROM offerwall_conversions").first(); } catch {}
  let ads = {n:0, amount:0};
  try { ads = await db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS amount FROM transactions WHERE type='monetag_ad_reward'").first(); } catch {}
  return {
    users: Number(users?.n || 0),
    newToday: Number(newToday?.n || 0),
    balance: Number(wallets?.balance || 0),
    earned: Number(wallets?.earned || 0),
    withdrawn: Number(wallets?.withdrawn || 0),
    pendingWithdrawals: Number(pending?.n || 0),
    offerConversions: Number(offers?.n || 0),
    offerRewards: Number(offers?.amount || 0),
    adRewards: Number(ads?.n || 0),
    adRewardCoins: Number(ads?.amount || 0)
  };
}

async function handleAdminApi(request, env) {
  if (!env.DB) return adminJson({success:false,message:"D1 binding DB is missing."},500);
  const url = new URL(request.url);
  const path = url.pathname;

  try {
    if (path === "/admin/api/login" && request.method === "POST") {
      await ensureAdminTables(env.DB);
      const body = await request.json().catch(() => ({}));
      const adminId = String(body.adminId || "").trim();
      const password = String(body.password || "");
      if (!env.ADMIN_CHAT_ID || adminId !== String(env.ADMIN_CHAT_ID)) {
        return adminJson({success:false,message:"Invalid admin ID."},401);
      }
      if (!env.ADMIN_PANEL_PASSWORD || password !== String(env.ADMIN_PANEL_PASSWORD)) {
        return adminJson({success:false,message:"Invalid admin password."},401);
      }
      const token = await createAdminSession(env);
      return adminJson({success:true},200,{"Set-Cookie":adminCookie(token,ADMIN_SESSION_TTL)});
    }

    if (path === "/admin/api/logout" && request.method === "POST") {
      return adminJson({success:true},200,{"Set-Cookie":adminCookie("",0)});
    }

    if (!(await verifyAdminSession(request, env))) {
      return adminJson({success:false,message:"Unauthorized."},401);
    }

    await ensureAdminTables(env.DB);

    if (path === "/admin/api/me" && request.method === "GET") {
      return adminJson({success:true, app:APP_NAME, adminId:String(env.ADMIN_CHAT_ID || "")});
    }

    if (path === "/admin/api/stats" && request.method === "GET") {
      return adminJson({success:true, stats:await adminStats(env.DB)});
    }

    if (path === "/admin/api/users" && request.method === "GET") {
      const q = (url.searchParams.get("q") || "").trim();
      let result;
      if (q) {
        const like = `%${q}%`;
        result = await env.DB.prepare(`
          SELECT u.id,u.telegram_id,u.username,u.first_name,u.last_name,u.created_at,u.updated_at,
                 COALESCE(w.balance,0) AS balance, COALESCE(w.lifetime_earned,0) AS lifetime_earned,
                 COALESCE(w.lifetime_withdrawn,0) AS lifetime_withdrawn
          FROM users u LEFT JOIN wallets w ON w.user_id=u.id
          WHERE CAST(u.id AS TEXT)=? OR u.telegram_id=? OR COALESCE(u.username,'') LIKE ? OR COALESCE(u.first_name,'') LIKE ? OR COALESCE(u.last_name,'') LIKE ?
          ORDER BY u.id DESC LIMIT 100
        `).bind(q,q,like,like,like).all();
      } else {
        result = await env.DB.prepare(`
          SELECT u.id,u.telegram_id,u.username,u.first_name,u.last_name,u.created_at,u.updated_at,
                 COALESCE(w.balance,0) AS balance, COALESCE(w.lifetime_earned,0) AS lifetime_earned,
                 COALESCE(w.lifetime_withdrawn,0) AS lifetime_withdrawn
          FROM users u LEFT JOIN wallets w ON w.user_id=u.id
          ORDER BY u.id DESC LIMIT 100
        `).all();
      }
      return adminJson({success:true,users:result.results || []});
    }

    if (path === "/admin/api/user" && request.method === "GET") {
      const id = String(url.searchParams.get("id") || "").trim();
      if (!id) return adminJson({success:false,message:"Missing user id."},400);
      const user = await env.DB.prepare(`SELECT * FROM users WHERE CAST(id AS TEXT)=? OR telegram_id=? LIMIT 1`).bind(id,id).first();
      if (!user) return adminJson({success:false,message:"User not found."},404);
      const wallet = await env.DB.prepare("SELECT * FROM wallets WHERE user_id=? LIMIT 1").bind(user.id).first();
      const tx = await env.DB.prepare("SELECT * FROM transactions WHERE user_id=? ORDER BY id DESC LIMIT 50").bind(user.id).all();
      let wd = {results:[]};
      try { wd = await env.DB.prepare("SELECT * FROM withdrawals WHERE user_id=? ORDER BY id DESC LIMIT 50").bind(user.id).all(); } catch {}
      return adminJson({success:true,user,wallet,transactions:tx.results||[],withdrawals:wd.results||[]});
    }

    if (path === "/admin/api/balance" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const userId = String(body.userId || "").trim();
      const mode = String(body.mode || "");
      const amount = Number(body.amount);
      const reason = String(body.reason || "Admin adjustment").trim().slice(0,200);
      if (!userId || !["add","subtract","set"].includes(mode) || !Number.isFinite(amount) || amount < 0) return adminJson({success:false,message:"Invalid balance request."},400);
      const user = await env.DB.prepare("SELECT id FROM users WHERE CAST(id AS TEXT)=? OR telegram_id=? LIMIT 1").bind(userId,userId).first();
      if (!user) return adminJson({success:false,message:"User not found."},404);
      await env.DB.prepare("INSERT OR IGNORE INTO wallets(user_id,balance,lifetime_earned,lifetime_withdrawn,updated_at) VALUES(?,0,0,0,?)").bind(user.id,Math.floor(Date.now()/1000)).run();
      const wallet = await env.DB.prepare("SELECT balance FROM wallets WHERE user_id=?").bind(user.id).first();
      const oldBalance = Number(wallet?.balance || 0);
      let newBalance = oldBalance;
      if (mode === "add") newBalance = oldBalance + amount;
      if (mode === "subtract") newBalance = oldBalance - amount;
      if (mode === "set") newBalance = amount;
      if (newBalance < 0) return adminJson({success:false,message:"Balance cannot become negative."},400);
      const delta = newBalance - oldBalance;
      const now = Math.floor(Date.now()/1000);
      await env.DB.batch([
        env.DB.prepare("UPDATE wallets SET balance=?, lifetime_earned=CASE WHEN ? > 0 THEN lifetime_earned+? ELSE lifetime_earned END, updated_at=? WHERE user_id=?").bind(newBalance,delta,delta,now,user.id),
        env.DB.prepare("INSERT INTO transactions(user_id,type,amount,description,created_at) VALUES(?,?,?,?,?)").bind(user.id,"admin_adjustment",delta,reason,now)
      ]);
      await adminAudit(env.DB,"balance_adjustment","user",user.id,{oldBalance,newBalance,delta,reason},String(env.ADMIN_CHAT_ID));
      return adminJson({success:true,oldBalance,newBalance,delta});
    }

    if (path === "/admin/api/withdrawals" && request.method === "GET") {
      const status = (url.searchParams.get("status") || "all").trim();
      let result;
      const base = `
        SELECT w.*, u.telegram_id, u.username, u.first_name, u.last_name
        FROM withdrawals w LEFT JOIN users u ON u.id=w.user_id
      `;
      if (status !== "all") result = await env.DB.prepare(base + " WHERE w.status=? ORDER BY w.id DESC LIMIT 200").bind(status).all();
      else result = await env.DB.prepare(base + " ORDER BY w.id DESC LIMIT 200").all();
      return adminJson({success:true,withdrawals:result.results||[]});
    }

    if (path === "/admin/api/withdrawal" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const id = Number(body.id);
      const action = String(body.action || "");
      const note = String(body.note || "").trim().slice(0,300);
      if (!Number.isInteger(id) || !["approve","reject"].includes(action)) return adminJson({success:false,message:"Invalid withdrawal action."},400);
      const wd = await env.DB.prepare("SELECT * FROM withdrawals WHERE id=? LIMIT 1").bind(id).first();
      if (!wd) return adminJson({success:false,message:"Withdrawal not found."},404);
      if (String(wd.status).toLowerCase() !== "pending") return adminJson({success:false,message:"This withdrawal is already processed."},409);
      const nowIso = new Date().toISOString();
      const now = Math.floor(Date.now()/1000);
      if (action === "approve") {
        const changed = await env.DB.prepare("UPDATE withdrawals SET status='Completed', processed_at=?, admin_note=? WHERE id=? AND status='Pending'").bind(nowIso,note,id).run();
        if (!changed.meta.changes) return adminJson({success:false,message:"This withdrawal was already processed."},409);
        await env.DB.batch([
          env.DB.prepare("UPDATE wallets SET lifetime_withdrawn=lifetime_withdrawn+?, updated_at=? WHERE user_id=?").bind(Number(wd.amount),now,wd.user_id),
          env.DB.prepare("INSERT INTO transactions(user_id,type,amount,description,created_at) VALUES(?,?,?,?,?)").bind(wd.user_id,"withdrawal_completed",-Number(wd.amount),"Withdrawal completed",now)
        ]);
      } else {
        // A pending withdrawal was already deducted when created in the older Coin Cove flow.
        // Change status first; only the request that wins this conditional update may refund it.
        const changed = await env.DB.prepare("UPDATE withdrawals SET status='Cancelled', processed_at=?, admin_note=? WHERE id=? AND status='Pending'").bind(nowIso,note,id).run();
        if (!changed.meta.changes) return adminJson({success:false,message:"This withdrawal was already processed."},409);
        await env.DB.batch([
          env.DB.prepare("UPDATE wallets SET balance=balance+?, updated_at=? WHERE user_id=?").bind(Number(wd.amount),now,wd.user_id),
          env.DB.prepare("INSERT INTO transactions(user_id,type,amount,description,created_at) VALUES(?,?,?,?,?)").bind(wd.user_id,"withdrawal_refund",Number(wd.amount),"Withdrawal rejected/refunded",now)
        ]);
      }
      await adminAudit(env.DB,action,"withdrawal",id,{amount:Number(wd.amount),userId:wd.user_id,note},String(env.ADMIN_CHAT_ID));
      return adminJson({success:true});
    }

    if (path === "/admin/api/transactions" && request.method === "GET") {
      const result = await env.DB.prepare(`
        SELECT t.*, u.telegram_id, u.username, u.first_name, u.last_name
        FROM transactions t LEFT JOIN users u ON u.id=t.user_id
        ORDER BY t.id DESC LIMIT 250
      `).all();
      return adminJson({success:true,transactions:result.results||[]});
    }

    if (path === "/admin/api/offers" && request.method === "GET") {
      let result = {results:[]};
      try {
        result = await env.DB.prepare(`
          SELECT o.*,u.telegram_id,u.username,u.first_name,u.last_name
          FROM offerwall_conversions o LEFT JOIN users u ON u.id=o.user_id
          ORDER BY o.id DESC LIMIT 250
        `).all();
      } catch (e) { return adminJson({success:false,message:"Offerwall table is not available yet.",offers:[]}); }
      return adminJson({success:true,offers:result.results||[]});
    }

    if (path === "/admin/api/settings" && request.method === "GET") {
      const row = await env.DB.prepare("SELECT value FROM settings WHERE key='app'").first();
      let settings = {};
      try { settings = row ? JSON.parse(row.value) : {}; } catch {}
      return adminJson({success:true,settings});
    }

    if (path === "/admin/api/settings" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const incoming = body.settings || {};
      const row = await env.DB.prepare("SELECT value FROM settings WHERE key='app'").first();
      let old = {};
      try { old = row ? JSON.parse(row.value) : {}; } catch {}
      const settings = {...old};
      for (const key of ["currency","dailyBonusAmount","adRewardAmount","dailyAdLimit","withdrawMethods","adsgramBlockId"]) {
        if (incoming[key] !== undefined) settings[key] = incoming[key];
      }
      await env.DB.prepare("INSERT INTO settings(key,value) VALUES('app',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(settings)).run();
      return adminJson({success:true,settings});
    }

    if (path === "/admin/api/audit" && request.method === "GET") {
      const result = await env.DB.prepare("SELECT * FROM admin_audit_logs ORDER BY id DESC LIMIT 200").all();
      return adminJson({success:true,logs:result.results||[]});
    }

    return adminJson({success:false,message:"Admin endpoint not found."},404);
  } catch (error) {
    console.error("Admin API error:", error);
    return adminJson({success:false,message:"Admin server error.",detail:String(error?.message || error)},500);
  }
}

function renderAdminApp() {
  return ADMIN_HTML;
}

function renderApp() {
  return APP_HTML;
}

const ADMIN_HTML = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Coin Cove Admin</title>
<style>
:root{font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#e8edf7;background:#0b1020}*{box-sizing:border-box}body{margin:0;background:linear-gradient(135deg,#080c18,#10182c);min-height:100vh}button,input,select,textarea{font:inherit}.shell{max-width:1400px;margin:auto;padding:24px}.login{max-width:420px;margin:10vh auto;background:#121a2c;border:1px solid #263454;border-radius:24px;padding:28px;box-shadow:0 20px 60px #0008}.brand{display:flex;gap:12px;align-items:center;margin-bottom:22px}.logo{width:48px;height:48px;border-radius:15px;display:grid;place-items:center;background:#5b7cfa;font-size:24px}.muted{color:#8793ab}.field{margin:12px 0}.field label{display:block;font-size:12px;color:#9aa7bd;margin-bottom:6px}.field input,.field select,.field textarea{width:100%;background:#0b1222;border:1px solid #2b3856;color:#fff;border-radius:12px;padding:12px;outline:none}.btn{border:0;border-radius:12px;padding:11px 15px;cursor:pointer;color:#fff;background:#4f6ff7;font-weight:700}.btn.secondary{background:#202b45}.btn.success{background:#159570}.btn.danger{background:#c84a59}.btn.warn{background:#c58b2a}.row{display:flex;gap:10px;align-items:center}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px}.layout{display:grid;grid-template-columns:220px 1fr;gap:18px}.side,.panel,.stat{background:#121a2c;border:1px solid #253351;border-radius:18px}.side{padding:12px;height:max-content;position:sticky;top:18px}.nav{display:block;width:100%;text-align:left;border:0;background:transparent;color:#aeb9ce;padding:12px;border-radius:10px;cursor:pointer}.nav.active,.nav:hover{background:#1d2942;color:#fff}.content{min-width:0}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.stat{padding:18px}.stat b{font-size:24px;display:block;margin-top:7px}.panel{padding:18px;margin-top:14px}.panel h3{margin:0 0 14px}.tablewrap{overflow:auto}table{width:100%;border-collapse:collapse;min-width:760px}th,td{padding:11px;border-bottom:1px solid #253351;text-align:left;font-size:13px}th{color:#8490a8;font-weight:600}.pill{display:inline-block;padding:4px 8px;border-radius:999px;background:#24314d;font-size:11px}.pill.green{background:#123f36;color:#6be0bc}.pill.red{background:#4a202a;color:#ff8b9a}.pill.yellow{background:#4b391a;color:#ffd77a}.hide{display:none}.toast{position:fixed;right:18px;bottom:18px;background:#17233b;border:1px solid #344363;padding:12px 15px;border-radius:12px;box-shadow:0 10px 30px #0008;z-index:50}.modal{position:fixed;inset:0;background:#0009;display:grid;place-items:center;padding:18px;z-index:40}.modalbox{max-width:520px;width:100%;background:#121a2c;border:1px solid #33425f;border-radius:18px;padding:20px}.cards{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.actions{display:flex;gap:6px;flex-wrap:wrap}@media(max-width:900px){.layout{grid-template-columns:1fr}.side{position:static}.stats{grid-template-columns:repeat(2,1fr)}}@media(max-width:520px){.shell{padding:12px}.stats{grid-template-columns:1fr 1fr}.cards{grid-template-columns:1fr}.top{align-items:flex-start;gap:10px;flex-direction:column}}
</style></head><body><div id="root"></div><script>
const $=id=>document.getElementById(id);let page='dashboard';let toastTimer;
function esc(v){return String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;')}
function money(v){return Number(v||0).toLocaleString(undefined,{maximumFractionDigits:2})}
function toast(m){clearTimeout(toastTimer);$('toast').textContent=m;$('toast').classList.remove('hide');toastTimer=setTimeout(()=>$('toast').classList.add('hide'),3000)}
async function api(path,opt={}){const r=await fetch(path,{...opt,headers:{'Content-Type':'application/json',...(opt.headers||{})}});let d={};try{d=await r.json()}catch{}if(r.status===401){location.reload();throw new Error('Unauthorized')}if(!r.ok||d.success===false)throw new Error(d.message||'Request failed');return d}
function login(){root.innerHTML='<div class="login"><div class="brand"><div class="logo">🪙</div><div><h2 style="margin:0">Coin Cove</h2><div class="muted">Secure Admin Console</div></div></div><div class="field"><label>ADMIN CHAT ID</label><input id="aid" inputmode="numeric" autocomplete="username"></div><div class="field"><label>ADMIN PANEL PASSWORD</label><input id="pwd" type="password" autocomplete="current-password"></div><button class="btn" style="width:100%" onclick="doLogin()">Sign in</button><p class="muted" style="font-size:12px;margin-top:14px">Your password is never stored in the browser.</p></div><div id="toast" class="toast hide"></div>'}
async function doLogin(){try{await api('/admin/api/login',{method:'POST',body:JSON.stringify({adminId:$('aid').value.trim(),password:$('pwd').value})});await boot()}catch(e){toast(e.message)}}
async function boot(){try{await api('/admin/api/me');renderShell();await loadPage()}catch(e){login()}}
function renderShell(){root.innerHTML='<div class="shell"><div class="top"><div class="brand" style="margin:0"><div class="logo">🪙</div><div><h2 style="margin:0">Coin Cove Admin</h2><div class="muted">External management console</div></div></div><button class="btn secondary" onclick="logout()">Logout</button></div><div class="layout"><aside class="side"><button class="nav active" data-p="dashboard" onclick="go(\'dashboard\')">📊 Dashboard</button><button class="nav" data-p="users" onclick="go(\'users\')">👥 Users</button><button class="nav" data-p="withdrawals" onclick="go(\'withdrawals\')">💸 Withdrawals</button><button class="nav" data-p="transactions" onclick="go(\'transactions\')">📜 Transactions</button><button class="nav" data-p="offers" onclick="go(\'offers\')">🎁 Offers</button><button class="nav" data-p="settings" onclick="go(\'settings\')">⚙️ Settings</button><button class="nav" data-p="audit" onclick="go(\'audit\')">🛡️ Audit Log</button></aside><main class="content" id="content"></main></div></div><div id="toast" class="toast hide"></div>'}
function go(p){page=p;document.querySelectorAll('.nav').forEach(n=>n.classList.toggle('active',n.dataset.p===p));loadPage()}
async function loadPage(){try{if(page==='dashboard')return dashboard();if(page==='users')return users();if(page==='withdrawals')return withdrawals();if(page==='transactions')return transactions();if(page==='offers')return offers();if(page==='settings')return settings();if(page==='audit')return audit()}catch(e){$('content').innerHTML='<div class="panel"><b>Error:</b> '+esc(e.message)+'</div>'}}
async function dashboard(){const d=await api('/admin/api/stats');const s=d.stats;content.innerHTML='<div class="stats">'+[['Users',s.users],['New today',s.newToday],['Coins in wallets',money(s.balance)],['Lifetime earned',money(s.earned)],['Withdrawn',money(s.withdrawn)],['Pending withdrawals',s.pendingWithdrawals],['Offer conversions',s.offerConversions],['Ad rewards',money(s.adRewardCoins)]].map(x=>'<div class="stat"><span class="muted">'+x[0]+'</span><b>'+x[1]+'</b></div>').join('')+'</div><div class="panel"><h3>System status</h3><div class="cards"><div>Offer rewards <b>'+money(s.offerRewards)+'</b></div><div>Ad reward events <b>'+s.adRewards+'</b></div></div></div>'}
async function users(){content.innerHTML='<div class="panel"><div class="row"><input id="uq" placeholder="Search ID, Telegram ID, username or name" style="flex:1;background:#0b1222;border:1px solid #2b3856;color:#fff;border-radius:12px;padding:12px"><button class="btn" onclick="loadUsers()">Search</button></div></div><div class="panel"><div class="tablewrap"><table><thead><tr><th>User</th><th>Telegram</th><th>Balance</th><th>Earned</th><th>Withdrawn</th><th>Action</th></tr></thead><tbody id="ut"></tbody></table></div></div>';await loadUsers()}
async function loadUsers(){const q=$('uq')?.value||'';const d=await api('/admin/api/users?q='+encodeURIComponent(q));$('ut').innerHTML=d.users.map(u=>'<tr><td><b>'+esc((u.first_name||'')+' '+(u.last_name||''))+'</b><div class="muted">#'+u.id+' '+esc(u.username?'@'+u.username:'')+'</div></td><td>'+esc(u.telegram_id)+'</td><td>'+money(u.balance)+'</td><td>'+money(u.lifetime_earned)+'</td><td>'+money(u.lifetime_withdrawn)+'</td><td><button class="btn secondary" onclick="editUser(\''+esc(u.id)+'\')">Manage</button></td></tr>').join('')||'<tr><td colspan="6">No users found.</td></tr>'}
async function editUser(id){const d=await api('/admin/api/user?id='+encodeURIComponent(id));const u=d.user,w=d.wallet||{};root.insertAdjacentHTML('beforeend','<div class="modal" id="m"><div class="modalbox"><h3 style="margin-top:0">Manage User</h3><div class="muted">'+esc((u.first_name||'')+' '+(u.last_name||''))+' · '+esc(u.telegram_id)+'</div><div class="panel" style="margin-top:12px"><b>Current balance: '+money(w.balance)+'</b><div class="field"><label>Amount</label><input id="ba" type="number" step="0.01" min="0"></div><div class="field"><label>Reason</label><input id="br" value="Admin adjustment"></div><div class="actions"><button class="btn success" onclick="balance(\''+esc(u.id)+'\',\'add\')">+ Add</button><button class="btn danger" onclick="balance(\''+esc(u.id)+'\',\'subtract\')">− Deduct</button><button class="btn warn" onclick="balance(\''+esc(u.id)+'\',\'set\')">Set</button></div></div><button class="btn secondary" onclick="$(\'m\').remove()">Close</button></div></div>')}
async function balance(id,mode){try{await api('/admin/api/balance',{method:'POST',body:JSON.stringify({userId:id,mode,amount:Number($('ba').value),reason:$('br').value})});toast('Balance updated');$('m').remove();loadUsers()}catch(e){toast(e.message)}}
async function withdrawals(){content.innerHTML='<div class="panel"><div class="row"><select id="ws" onchange="loadWd()"><option>all</option><option>Pending</option><option>Completed</option><option>Cancelled</option></select><button class="btn secondary" onclick="loadWd()">Refresh</button></div></div><div class="panel"><div class="tablewrap"><table><thead><tr><th>User</th><th>Amount</th><th>Method</th><th>Address</th><th>Status</th><th>Action</th></tr></thead><tbody id="wt"></tbody></table></div></div>';await loadWd()}
async function loadWd(){const d=await api('/admin/api/withdrawals?status='+encodeURIComponent($('ws').value));$('wt').innerHTML=d.withdrawals.map(w=>'<tr><td><b>'+esc((w.first_name||'')+' '+(w.last_name||''))+'</b><div class="muted">'+esc(w.telegram_id||w.user_id)+'</div></td><td>'+money(w.amount)+'</td><td>'+esc(w.method)+'</td><td>'+esc(w.address)+'</td><td><span class="pill '+(w.status==='Completed'?'green':w.status==='Cancelled'?'red':'yellow')+'">'+esc(w.status)+'</span></td><td>'+(w.status==='Pending'?'<div class="actions"><button class="btn success" onclick="wd('+w.id+',\'approve\')">Approve</button><button class="btn danger" onclick="wd('+w.id+',\'reject\')">Reject & Refund</button></div>':'—')+'</td></tr>').join('')||'<tr><td colspan="6">No withdrawals.</td></tr>'}
async function wd(id,action){if(!confirm(action==='approve'?'Approve this withdrawal?':'Reject and refund this withdrawal?'))return;try{await api('/admin/api/withdrawal',{method:'POST',body:JSON.stringify({id,action})});toast('Withdrawal updated');loadWd()}catch(e){toast(e.message)}}
async function transactions(){const d=await api('/admin/api/transactions');content.innerHTML='<div class="panel"><h3>Recent Transactions</h3><div class="tablewrap"><table><thead><tr><th>ID</th><th>User</th><th>Type</th><th>Amount</th><th>Description</th><th>Date</th></tr></thead><tbody>'+d.transactions.map(t=>'<tr><td>'+t.id+'</td><td>'+esc(t.telegram_id||t.user_id)+'</td><td>'+esc(t.type)+'</td><td>'+money(t.amount)+'</td><td>'+esc(t.description)+'</td><td>'+new Date(Number(t.created_at)*1000).toLocaleString()+'</td></tr>').join('')+'</tbody></table></div></div>'}
async function offers(){const d=await api('/admin/api/offers');content.innerHTML='<div class="panel"><h3>Offerwall Conversions</h3><div class="tablewrap"><table><thead><tr><th>TX</th><th>User</th><th>Offer</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead><tbody>'+d.offers.map(o=>'<tr><td>'+esc(o.transaction_id)+'</td><td>'+esc(o.telegram_id||o.user_id)+'</td><td>'+esc(o.offer_name||o.offer_id||'—')+'</td><td>'+money(o.amount)+'</td><td>'+esc(o.status)+'</td><td>'+new Date(Number(o.created_at)*1000).toLocaleString()+'</td></tr>').join('')+'</tbody></table></div></div>'}
async function settings(){const d=await api('/admin/api/settings');const s=d.settings||{};content.innerHTML='<div class="panel"><h3>Coin Cove Settings</h3><div class="cards"><div class="field"><label>Currency</label><input id="sc" value="'+esc(s.currency||'BDT')+'"></div><div class="field"><label>Daily bonus</label><input id="sb" type="number" step="0.01" value="'+esc(s.dailyBonusAmount??0)+'"></div><div class="field"><label>Ad reward</label><input id="sa" type="number" step="0.01" value="'+esc(s.adRewardAmount??10)+'"></div><div class="field"><label>Daily ad limit</label><input id="sl" type="number" min="0" value="'+esc(s.dailyAdLimit??10)+'"></div></div><div class="field"><label>Withdraw methods</label><textarea id="sw" rows="3">'+esc(s.withdrawMethods||'bKash:200, Nagad:200, Rocket:200, Binance:5')+'</textarea></div><div class="field"><label>Ads block ID</label><input id="sid" value="'+esc(s.adsgramBlockId||'')+'"></div><button class="btn" onclick="saveSettings()">Save Settings</button></div>'}
async function saveSettings(){try{await api('/admin/api/settings',{method:'POST',body:JSON.stringify({settings:{currency:$('sc').value,dailyBonusAmount:Number($('sb').value),adRewardAmount:Number($('sa').value),dailyAdLimit:Number($('sl').value),withdrawMethods:$('sw').value,adsgramBlockId:$('sid').value}})});toast('Settings saved')}catch(e){toast(e.message)}}
async function audit(){const d=await api('/admin/api/audit');content.innerHTML='<div class="panel"><h3>Audit Log</h3><div class="tablewrap"><table><thead><tr><th>Time</th><th>Action</th><th>Target</th><th>Details</th></tr></thead><tbody>'+d.logs.map(x=>'<tr><td>'+new Date(Number(x.created_at)*1000).toLocaleString()+'</td><td>'+esc(x.action)+'</td><td>'+esc((x.target_type||'')+' '+(x.target_id||''))+'</td><td>'+esc(x.details||'')+'</td></tr>').join('')+'</tbody></table></div></div>'}
async function logout(){await fetch('/admin/api/logout',{method:'POST'});login()}
boot();
</script><div id="toast" class="toast hide"></div></body></html>`;

const APP_HTML = "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover\">\n<title>Coin Cove</title>\n<script src=\"https://telegram.org/js/telegram-web-app.js\"></script>\n<style>\n*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}\nhtml,body{margin:0;min-height:100%;font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,Arial,sans-serif}\nbody{background:var(--tg-theme-bg-color,#f5f7fb);color:var(--tg-theme-text-color,#111827)}\n.app{max-width:560px;margin:auto;min-height:100vh;padding:calc(18px + env(safe-area-inset-top)) 16px calc(90px + env(safe-area-inset-bottom))}\n.header{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px}\n.brand{display:flex;align-items:center;gap:10px}\n.logo{width:44px;height:44px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:24px;background:#111827;color:#fff}\n.brand-title{font-size:20px;font-weight:800}\n.brand-subtitle{font-size:12px;opacity:.55;margin-top:2px}\n.profile{width:42px;height:42px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(127,127,127,.12);font-weight:700}\n.balance-card{border-radius:24px;padding:24px;background:#111827;color:#fff;margin-bottom:18px;box-shadow:0 12px 30px rgba(0,0,0,.12)}\n.balance-label{font-size:13px;opacity:.65}\n.balance{font-size:38px;font-weight:850;margin-top:6px;letter-spacing:-1px}\n.balance-name{font-size:13px;opacity:.65;margin-top:2px}\n.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}\n.card{border:0;border-radius:20px;padding:20px 16px;text-align:left;background:var(--tg-theme-secondary-bg-color,#fff);color:var(--tg-theme-text-color,#111827);box-shadow:0 5px 18px rgba(0,0,0,.05);cursor:pointer}\n.card:active{transform:scale(.98)}\n.icon{font-size:27px;margin-bottom:12px}\n.card-title{font-size:15px;font-weight:800}\n.card-text{font-size:12px;opacity:.55;margin-top:5px;line-height:1.4}\n.section{margin-top:24px}\n.section-title{font-size:17px;font-weight:800;margin-bottom:12px}\n.stats{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}\n.stat{background:var(--tg-theme-secondary-bg-color,#fff);border-radius:18px;padding:16px}\n.stat-number{font-size:20px;font-weight:800}\n.stat-label{font-size:11px;opacity:.55;margin-top:4px}\n.bottom{position:fixed;left:0;right:0;bottom:0;padding:10px 16px calc(10px + env(safe-area-inset-bottom));background:rgba(245,247,251,.9);backdrop-filter:blur(14px)}\n.bottom-inner{max-width:560px;margin:auto;display:grid;grid-template-columns:repeat(4,1fr);gap:7px}\n.nav{border:0;background:transparent;color:var(--tg-theme-hint-color,#6b7280);padding:8px 2px;border-radius:12px;font-size:11px;cursor:pointer}\n.nav-icon{display:block;font-size:20px;margin-bottom:3px}\n.nav.active{color:var(--tg-theme-text-color,#111827);font-weight:800}\n.loading{min-height:100vh;display:flex;align-items:center;justify-content:center;font-size:14px;opacity:.6}\n.error{padding:30px 20px;text-align:center}\nbutton{font-family:inherit}\n.wall{position:fixed;inset:0;background:var(--tg-theme-bg-color,#f5f7fb);z-index:10;display:flex;flex-direction:column}\n.wall-head{height:54px;display:flex;align-items:center;padding:0 12px;border-bottom:1px solid rgba(127,127,127,.12);flex:none}\n.wall-head button{border:0;background:transparent;font-size:24px;padding:6px}\n.wall-title{font-weight:800;margin-left:4px}\n.wall-frame{width:100%;height:calc(100% - 54px);border:0;flex:1}\n</style>\n</head>\n<body>\n<div id=\"app\"><div class=\"loading\">Loading Coin Cove...</div></div>\n\n<script>\n(function () {\n  const tg = window.Telegram && window.Telegram.WebApp;\n\n  if (tg) {\n    try {\n      tg.ready();\n      tg.expand();\n      if (tg.themeParams && tg.themeParams.bg_color) {\n        tg.setHeaderColor(tg.themeParams.bg_color);\n      }\n    } catch (e) {\n      console.error(\"Telegram WebApp init error:\", e);\n    }\n  }\n\n  let currentUser = null;\n\n  function getInitData() {\n    if (tg && typeof tg.initData === \"string\" && tg.initData.trim()) {\n      return tg.initData.trim();\n    }\n\n    return \"\";\n  }\n\n  async function loadApp() {\n    const initData = getInitData();\n\n    if (!initData) {\n      showError(\n        \"Open Coin Cove from the Telegram bot. Direct browser access does not provide Telegram authorization data.\"\n      );\n      return;\n    }\n\n    try {\n      const response = await fetch(\"/api/me\", {\n        method: \"GET\",\n        headers: {\n          \"X-Telegram-Init-Data\": initData\n        },\n        cache: \"no-store\"\n      });\n\n      const data = await response.json();\n\n      if (!response.ok || !data.success) {\n        console.error(\"API /api/me:\", data);\n        showError(data.message || \"Unable to load your account.\");\n        return;\n      }\n\n      currentUser = data.user;\n      render(data);\n    } catch (error) {\n      console.error(\"loadApp error:\", error);\n      showError(\"Unable to connect to Coin Cove.\");\n    }\n  }\n\n  function render(data) {\n    const user = data.user || {};\n    const wallet = data.wallet || {};\n    const referrals = data.referrals || {};\n\n    const first = escapeHtml(user.first_name || \"there\");\n    const initial = escapeHtml(\n      (user.first_name || \"C\").charAt(0).toUpperCase()\n    );\n\n    const balance = Number(wallet.balance || 0).toLocaleString();\n    const earned = Number(wallet.lifetime_earned || 0).toLocaleString();\n\n    const transactions = Array.isArray(data.transactions)\n      ? data.transactions\n      : [];\n\n    const activity = transactions.length\n      ? transactions.map(function (tx) {\n          const amount = Number(tx.amount || 0);\n\n          return (\n            '<div style=\"display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid rgba(127,127,127,.12)\">' +\n              '<div>' +\n                '<div style=\"font-weight:700;font-size:13px\">' +\n                  escapeHtml(tx.description || tx.type || \"Transaction\") +\n                '</div>' +\n                '<div style=\"font-size:10px;opacity:.5\">' +\n                  formatDate(tx.created_at) +\n                '</div>' +\n              '</div>' +\n              '<div style=\"font-weight:800\">' +\n                (amount > 0 ? \"+\" : \"\") +\n                escapeHtml(String(amount)) +\n              '</div>' +\n            '</div>'\n          );\n        }).join(\"\")\n      : '<div style=\"text-align:center;opacity:.5;padding:15px\">No activity yet</div>';\n\n    document.getElementById(\"app\").innerHTML =\n      '<div class=\"app\">' +\n        '<div class=\"header\">' +\n          '<div class=\"brand\">' +\n            '<div class=\"logo\">🪙</div>' +\n            '<div>' +\n              '<div class=\"brand-title\">Coin Cove</div>' +\n              '<div class=\"brand-subtitle\">Earn • Complete • Reward</div>' +\n            '</div>' +\n          '</div>' +\n          '<div class=\"profile\">' + initial + '</div>' +\n        '</div>' +\n\n        '<div class=\"balance-card\">' +\n          '<div class=\"balance-label\">Welcome back, ' + first + '</div>' +\n          '<div class=\"balance\">' + balance + '</div>' +\n          '<div class=\"balance-name\">Coins</div>' +\n        '</div>' +\n\n        '<div class=\"grid\">' +\n          '<button class=\"card\" onclick=\"openOffers()\">' +\n            '<div class=\"icon\">🎁</div>' +\n            '<div class=\"card-title\">Earn Offers</div>' +\n            '<div class=\"card-text\">Complete offers and earn Coins</div>' +\n          '</button>' +\n\n          '<button class=\"card\" onclick=\"openSection(\\'ads\\')\">' +\n            '<div class=\"icon\">📺</div>' +\n            '<div class=\"card-title\">Watch & Earn</div>' +\n            '<div class=\"card-text\">Watch limited rewarded ads</div>' +\n          '</button>' +\n\n          '<button class=\"card\" onclick=\"openSection(\\'referral\\')\">' +\n            '<div class=\"icon\">👥</div>' +\n            '<div class=\"card-title\">Invite Friends</div>' +\n            '<div class=\"card-text\">Invite friends and earn</div>' +\n          '</button>' +\n\n          '<button class=\"card\" onclick=\"openSection(\\'withdraw\\')\">' +\n            '<div class=\"icon\">💸</div>' +\n            '<div class=\"card-title\">Withdraw</div>' +\n            '<div class=\"card-text\">Request your reward</div>' +\n          '</button>' +\n        '</div>' +\n\n        '<div class=\"section\">' +\n          '<div class=\"section-title\">Your Activity</div>' +\n          '<div class=\"stats\">' +\n            '<div class=\"stat\">' +\n              '<div class=\"stat-number\">' + earned + '</div>' +\n              '<div class=\"stat-label\">Lifetime Earned</div>' +\n            '</div>' +\n            '<div class=\"stat\">' +\n              '<div class=\"stat-number\">' + Number(referrals.count || 0) + '</div>' +\n              '<div class=\"stat-label\">Friends Invited</div>' +\n            '</div>' +\n          '</div>' +\n        '</div>' +\n\n        '<div class=\"section\">' +\n          '<div class=\"section-title\">Recent Activity</div>' +\n          '<div class=\"stat\">' + activity + '</div>' +\n        '</div>' +\n      '</div>' +\n\n      '<div class=\"bottom\">' +\n        '<div class=\"bottom-inner\">' +\n          '<button class=\"nav active\">' +\n            '<span class=\"nav-icon\">🏠</span>Home' +\n          '</button>' +\n          '<button class=\"nav\" onclick=\"openOffers()\">' +\n            '<span class=\"nav-icon\">🎁</span>Offers' +\n          '</button>' +\n          '<button class=\"nav\" onclick=\"openSection(\\'referral\\')\">' +\n            '<span class=\"nav-icon\">👥</span>Invite' +\n          '</button>' +\n          '<button class=\"nav\" onclick=\"openSection(\\'withdraw\\')\">' +\n            '<span class=\"nav-icon\">💰</span>Wallet' +\n          '</button>' +\n        '</div>' +\n      '</div>';\n  }\n\n  window.openOffers = function () {\n    if (!currentUser || !currentUser.telegram_id) {\n      showError(\"User account is not ready.\");\n      return;\n    }\n\n    const uid = encodeURIComponent(String(currentUser.telegram_id));\n\n    const wall =\n      \"https://offerwall.gg/wall/4c826098db679c99583194371d0eae1b?userId=\" +\n      uid;\n\n    const existing = document.getElementById(\"offerWall\");\n    if (existing) existing.remove();\n\n    document.body.insertAdjacentHTML(\n      \"beforeend\",\n      '<div class=\"wall\" id=\"offerWall\">' +\n        '<div class=\"wall-head\">' +\n          '<button onclick=\"closeOffers()\">‹</button>' +\n          '<div class=\"wall-title\">Earn Offers</div>' +\n        '</div>' +\n        '<iframe class=\"wall-frame\" src=\"' + escapeAttribute(wall) + '\" title=\"Coin Cove Offers\"></iframe>' +\n      '</div>'\n    );\n  };\n\n  window.closeOffers = function () {\n    const wall = document.getElementById(\"offerWall\");\n    if (wall) wall.remove();\n  };\n\n  window.openSection = function (section) {\n    const messages = {\n      ads: \"Rewarded ads will be connected in the next stage.\",\n      referral: \"Your referral system is being prepared.\",\n      withdraw: \"Withdrawal options will be added in the next stage.\"\n    };\n\n    const message = messages[section] || \"Coming soon.\";\n\n    if (tg && typeof tg.showAlert === \"function\") {\n      tg.showAlert(message);\n    } else {\n      alert(message);\n    }\n  };\n\n  function showError(message) {\n    document.getElementById(\"app\").innerHTML =\n      '<div class=\"error\">' +\n        '<div style=\"font-size:48px\">🪙</div>' +\n        '<h2>Coin Cove</h2>' +\n        '<p style=\"opacity:.6\">' + escapeHtml(message) + '</p>' +\n        '<button onclick=\"location.reload()\" style=\"padding:10px 16px;border:0;border-radius:10px\">Retry</button>' +\n      '</div>';\n  }\n\n  function escapeHtml(value) {\n    return String(value == null ? \"\" : value)\n      .replaceAll(\"&\", \"&amp;\")\n      .replaceAll(\"<\", \"&lt;\")\n      .replaceAll(\">\", \"&gt;\")\n      .replaceAll('\"', \"&quot;\")\n      .replaceAll(\"'\", \"&#039;\");\n  }\n\n  function escapeAttribute(value) {\n    return escapeHtml(value);\n  }\n\n  function formatDate(timestamp) {\n    if (!timestamp) return \"\";\n    return new Date(Number(timestamp) * 1000).toLocaleDateString();\n  }\n\n  loadApp();\n})();\n</script>\n</body>\n</html>";
