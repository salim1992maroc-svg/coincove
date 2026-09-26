const APP_NAME = "Coin Cove";
const BUILD_VERSION = "2026-09-26-offerwalls-v9-adswed";
const TAPJOY_SDK_KEY = "277Mt0yeQyuT_sZLoCUE_gEC0KXJGsauFETqGFqtLDz4ZQ0B_sGMBmpWRx1y";
const TAPJOY_PLACEMENT = "coincover";
const POINTS_NAME = "Coins";
const AD_REWARD_COINS = 10;
const DAILY_AD_LIMIT = 10;
const AD_COOLDOWN_SECONDS = 30;
const MINI_APP_SHORT_NAME = "myapp";
const WITHDRAW_MIN_COINS = 200;
const COINS_PER_USD = 2000;
const MONETAG_ZONE_ID = "11766606";

// Offerwall configuration supplied for Coin Cove. Secrets are used only on the server side.
const ADMANTUM_APP_ID = "27938";
const ADMANTUM_SECRET_KEY = "adme973b8e";
const NOTIK_API_KEY = "2eZo0UC1kNfCwjcFCYGpEWGwSDWzXJo9";
const NOTIK_PUB_ID = "sLzA";
const NOTIK_APP_ID = "fggvW50o8Z";
const NOTIK_SECRET_KEY = "h6n79wyyoYgJuiNEqFwfzt5bLGhsgbGn";
const CPIDROID_PLACEMENT = "yxpm-81812-kal5";
const OFFERWALL_GG_PUBLIC_KEY = "4c826098db679c99583194371d0eae1b";
const ADSWED_PUBLIC_KEY = "eJjhGO9M";
// Keep the AdswedMedia secret in the Cloudflare Worker secret named ADSWED_SECRET_KEY.


export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname === "/api/health") {
        return json({
          success: true,
          app: APP_NAME,
          version: BUILD_VERSION,
          database: !!env.DB,
          botConfigured: !!env.BOT_TOKEN,
          offerwallConfigured: !!env.OFFERWALL_SECRET,
          tapjoyConfigured: !!env.TAPJOY_VC_SECRET,
          telegramWebhookConfigured: true,
          time: Date.now()
        });
      }

      if (url.pathname === "/api/me") return apiMe(request, env);
      if (url.pathname === "/api/referral") return apiReferral(request, env);
      if (url.pathname === "/api/reward-ad") return rewardAd(request, env);

      if (url.pathname === "/api/offerwall/postback") return offerwallPostback(request, env);
      if (url.pathname === "/api/offerwall/cpidroid/postback") return cpidroidPostback(request, env);
      if (url.pathname === "/api/offerwall/notik/postback") return notikPostback(request, env);
      if (url.pathname === "/api/offerwall/admantum/postback") return admantumPostback(request, env);
      if (url.pathname === "/api/offerwall/adswed/postback") return adswedPostback(request, env);
      if (url.pathname === "/tapjoy/postback") return tapjoyPostback(request, env);
      if (url.pathname === "/monetag/postback") return monetagPostback(request, env);

      if (url.pathname === "/api/auth/register") return emailRegister(request, env);
      if (url.pathname === "/api/auth/login") return emailLogin(request, env);
      if (url.pathname === "/api/auth/logout") return emailLogout(request, env);
      if (url.pathname === "/api/auth/me") return emailSessionMe(request, env);

      if (url.pathname === "/api/withdraw") return createWithdrawal(request, env);

      if (url.pathname === "/api/admin/login") return adminLogin(request, env);
      if (url.pathname === "/api/admin/logout") return adminLogout(request, env);
      if (url.pathname === "/api/admin/me") return adminMe(request, env);
      if (url.pathname === "/api/admin/users") return adminUsers(request, env);
      if (url.pathname === "/api/admin/withdrawals") return adminWithdrawals(request, env);
      if (url.pathname === "/api/admin/withdrawal") return adminWithdrawalAction(request, env);
      if (url.pathname === "/api/admin/telegram/setup") return telegramSetup(request, env);
      if (url.pathname === "/api/telegram/webhook") return telegramWebhook(request, env);

      // AdswedMedia may be configured with the Worker root URL. Only treat the root as
      // a postback when the expected AdswedMedia parameters are present; normal visitors
      // without those parameters still receive the Coin Cove app.
      if (url.pathname === "/" && ["subId", "transId", "reward", "signature"].every(k => url.searchParams.has(k))) {
        return adswedPostback(request, env);
      }

      if (url.pathname === "/admin") {
        return new Response(renderAdmin(), {
          headers: { "content-type": "text/html;charset=UTF-8", "cache-control": "no-store" }
        });
      }

      return new Response(renderApp(), {
        headers: { "content-type": "text/html;charset=UTF-8", "cache-control": "no-store" }
      });
    } catch (e) {
      console.error("Worker error", e);
      return json({ success: false, message: "Internal server error." }, 500);
    }
  }
};

async function readPostbackParams(request) {
  const u = new URL(request.url);
  const data = new URLSearchParams(u.search);
  if (request.method === "POST") {
    const ct = (request.headers.get("content-type") || "").toLowerCase();
    try {
      if (ct.includes("application/x-www-form-urlencoded")) {
        const body = await request.text();
        const b = new URLSearchParams(body);
        for (const [k,v] of b) data.set(k,v);
      } else if (ct.includes("application/json")) {
        const b = await request.json();
        for (const [k,v] of Object.entries(b || {})) data.set(k, String(v ?? ""));
      }
    } catch {}
  }
  return data;
}

async function cpidroidPostback(request, env) {
  if (!["GET","POST"].includes(request.method)) return new Response("Method not allowed", { status: 405 });
  return processProviderPostback(request, env, "cpidroid", {
    params: await readPostbackParams(request),
    userAliases: ["uid", "user_id", "userid"],
    transactionAliases: ["trans_id", "txn_id", "transaction_id", "txid"],
    amountAliases: ["amount", "payout_vc", "virtual_currency", "reward", "coins"],
    offerIdAliases: ["offer_id", "of_id"],
    offerNameAliases: ["offer_name", "of_name"],
    payoutUsdAliases: ["payout_usd", "payout"]
  });
}

async function notikPostback(request, env) {
  if (!["GET","POST"].includes(request.method)) return new Response("Method not allowed", { status: 405 });
  const params = await readPostbackParams(request);
  return processProviderPostback(request, env, "notik", {
    params,
    requiredSecret: NOTIK_SECRET_KEY,
    userAliases: ["user_id", "userid", "uid", "subid"],
    transactionAliases: ["txn_id", "transaction_id", "trans_id", "txid", "transaction"],
    amountAliases: ["virtual_currency", "payout_vc", "amount", "reward", "coins"],
    offerIdAliases: ["offer_id", "of_id"],
    offerNameAliases: ["offer_name", "of_name"],
    payoutUsdAliases: ["payout_usd", "payout"]
  });
}

async function admantumPostback(request, env) {
  if (!["GET","POST"].includes(request.method)) return new Response("Method not allowed", { status: 405 });
  const q = await readPostbackParams(request);
  if (!env.DB) return new Response("server configuration error", { status: 500 });
  await ensureSchema(env);

  const uid = (q.get("uid") || q.get("user_id") || q.get("userid") || "").trim();
  const ofId = (q.get("of_id") || q.get("offer_id") || "").trim();
  const rawAmount = q.get("virtual_currency") ?? q.get("amount") ?? q.get("payout");
  const status = (q.get("status") || "1").trim();
  const tx = (q.get("transaction_id") || q.get("trans_id") || q.get("txn_id") || "").trim();
  const hash = (q.get("hash") || "").trim().toLowerCase();
  if (!uid || rawAmount === null || !tx) return new Response("bad request", { status: 400 });

  const expectedHash = md5Hex(uid + ofId + String(rawAmount) + ADMANTUM_SECRET_KEY).toLowerCase();
  if (!hash || !constantTimeEqual(hash, expectedHash)) return new Response("invalid hash", { status: 403 });

  const user = await dbUserByDatabaseId(env.DB, uid);
  if (!user) return new Response("unknown user", { status: 404 });
  let amount = Number(rawAmount);
  if (!Number.isFinite(amount)) return new Response("invalid amount", { status: 400 });
  amount = Math.trunc(amount);
  if (status === "0" || status.toLowerCase() === "reversed") amount = -Math.abs(amount);
  if (amount === 0) return new Response("ok", { status: 200 });

  const now = Math.floor(Date.now() / 1000);
  const transactionId = "admantum:" + tx;
  const offerName = q.get("of_name") || q.get("offer_name") || "AdMantum offer";
  const payoutUsd = Number(q.get("payout") || q.get("payout_usd") || 0);

  if (amount > 0) {
    try {
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO offerwall_conversions
          (transaction_id,user_id,amount,status,offer_id,offer_name,goal_id,payout_usd,test,created_at)
          VALUES(?,?,?,?,?,?,?,?,?,?)`)
          .bind(transactionId, user.id, amount, "credited", ofId || null, offerName, q.get("event_id") || null, Number.isFinite(payoutUsd) ? payoutUsd : 0, 0, now),
        env.DB.prepare(`UPDATE wallets SET balance=balance+?,lifetime_earned=lifetime_earned+?,updated_at=? WHERE user_id=?`)
          .bind(amount, amount, now, user.id),
        env.DB.prepare(`INSERT INTO transactions(user_id,type,amount,description,created_at) VALUES(?,?,?,?,?)`)
          .bind(user.id, "admantum_offer_reward", amount, "AdMantum offer reward", now)
      ]);
    } catch (e) {
      const m = String(e?.message || e).toLowerCase();
      if (m.includes("unique") || m.includes("constraint")) return new Response("ok", { status: 200 });
      console.error("AdMantum credit error:", e);
      return new Response("server error", { status: 500 });
    }
    return new Response("OK", { status: 200 });
  }

  // AdMantum uses a new transaction id for reversals, so locate the latest matching credited conversion.
  const original = await env.DB.prepare(`SELECT transaction_id,amount,status FROM offerwall_conversions
    WHERE user_id=? AND status='credited' AND (?='' OR offer_id=?) ORDER BY id DESC LIMIT 1`)
    .bind(user.id, ofId, ofId).first();
  if (!original) return new Response("OK", { status: 200 });

  try {
    await env.DB.batch([
      env.DB.prepare("UPDATE offerwall_conversions SET status='reversed' WHERE transaction_id=?").bind(original.transaction_id),
      env.DB.prepare(`UPDATE wallets SET balance=MAX(0,balance-?),updated_at=? WHERE user_id=?`).bind(Math.abs(Number(original.amount)), now, user.id),
      env.DB.prepare(`INSERT INTO transactions(user_id,type,amount,description,created_at) VALUES(?,?,?,?,?)`)
        .bind(user.id, "admantum_offer_reversal", -Math.abs(Number(original.amount)), "AdMantum offer reversal", now)
    ]);
  } catch (e) {
    console.error("AdMantum reversal error:", e);
    return new Response("server error", { status: 500 });
  }
  return new Response("OK", { status: 200 });
}

async function adswedPostback(request, env) {
  if (!["GET", "POST"].includes(request.method)) return new Response("Method not allowed", { status: 405 });
  if (!env.DB || !env.ADSWED_SECRET_KEY) return new Response("server configuration error", { status: 500 });
  await ensureSchema(env);

  const q = await readPostbackParams(request);
  const subId = (q.get("subId") || "").trim();
  const transId = (q.get("transId") || "").trim();
  const rawReward = q.get("reward");
  const signature = (q.get("signature") || "").trim().toLowerCase();
  const status = (q.get("status") || "1").trim();
  const type = (q.get("type") || "").trim().toLowerCase();

  if (!subId || !transId || rawReward === null || !signature) {
    return new Response("bad request", { status: 400 });
  }

  // AdswedMedia documents: MD5(subId + transId + reward + SECRET_KEY).
  const expected = md5Hex(subId + transId + String(rawReward) + String(env.ADSWED_SECRET_KEY)).toLowerCase();
  if (!constantTimeEqual(signature, expected)) return new Response("invalid signature", { status: 403 });

  // Their testing tool can send type=test. Never credit test callbacks.
  if (type === "test") return new Response("OK", { status: 200 });

  const user = await dbUserByDatabaseId(env.DB, subId);
  if (!user) return new Response("unknown user", { status: 404 });

  const rewardNumber = Number(rawReward);
  if (!Number.isFinite(rewardNumber) || rewardNumber <= 0) return new Response("invalid reward", { status: 400 });
  const reward = Math.trunc(rewardNumber);
  if (reward <= 0) return new Response("OK", { status: 200 });

  const transactionId = "adswed:" + transId;
  const now = Math.floor(Date.now() / 1000);
  const offerId = q.get("offer_id") || null;
  const offerName = q.get("offer_name") || "AdswedMedia offer";
  const payoutRaw = q.get("payout") || "0";
  const payout = Number(payoutRaw);
  const safePayout = Number.isFinite(payout) && payout >= 0 ? payout : 0;

  // Status 2 is a chargeback. It must reference the original transId and must
  // never subtract the same reward twice.
  if (status === "2") {
    const original = await env.DB.prepare(`
      SELECT id,user_id,amount,status FROM offerwall_conversions
      WHERE transaction_id=? LIMIT 1
    `).bind(transactionId).first();

    if (!original) return new Response("OK", { status: 200 });
    if (String(original.status).toLowerCase() === "reversed") return new Response("OK", { status: 200 });

    const reversal = -Math.abs(Number(original.amount));
    try {
      await env.DB.batch([
        env.DB.prepare("UPDATE offerwall_conversions SET status='reversed' WHERE transaction_id=?").bind(transactionId),
        env.DB.prepare(`
          UPDATE wallets SET balance=MAX(0,balance+?),updated_at=? WHERE user_id=?
        `).bind(reversal, now, original.user_id),
        env.DB.prepare(`
          INSERT INTO transactions(user_id,type,amount,description,created_at)
          VALUES(?,?,?,?,?)
        `).bind(original.user_id, "adswed_offer_reversal", reversal, "AdswedMedia offer reversal", now)
      ]);
    } catch (e) {
      console.error("AdswedMedia reversal error:", e);
      return new Response("server error", { status: 500 });
    }
    return new Response("OK", { status: 200 });
  }

  // Only status 1 is a credit event. Other statuses are acknowledged without
  // changing the user's balance.
  if (status !== "1") return new Response("OK", { status: 200 });

  try {
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO offerwall_conversions
        (transaction_id,user_id,amount,status,offer_id,offer_name,goal_id,payout_usd,test,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)
      `).bind(transactionId, user.id, reward, "credited", offerId, offerName, q.get("event_id") || null, safePayout, 0, now),
      env.DB.prepare(`
        UPDATE wallets SET balance=balance+?,lifetime_earned=lifetime_earned+?,updated_at=? WHERE user_id=?
      `).bind(reward, reward, now, user.id),
      env.DB.prepare(`
        INSERT INTO transactions(user_id,type,amount,description,created_at)
        VALUES(?,?,?,?,?)
      `).bind(user.id, "adswed_offer_reward", reward, "AdswedMedia offer reward", now)
    ]);
  } catch (e) {
    const message = String(e?.message || e).toLowerCase();
    // offerwall_conversions.transaction_id is UNIQUE, so a retry of the same
    // transId is safely acknowledged and never credits twice.
    if (message.includes("unique") || message.includes("constraint")) return new Response("DUP", { status: 200 });
    console.error("AdswedMedia credit error:", e);
    return new Response("server error", { status: 500 });
  }

  return new Response("OK", { status: 200 });
}

async function processProviderPostback(request, env, provider, config) {
  if (!env.DB) return new Response("server configuration error", { status: 500 });
  await ensureSchema(env);

  const q = config.params || await readPostbackParams(request);
  if (config.requiredSecret) {
    const receivedSecret = (q.get("secret") || q.get("secret_key") || q.get("api_secret") || "").trim();
    if (!receivedSecret || !constantTimeEqual(receivedSecret, String(config.requiredSecret))) return new Response("invalid secret", { status: 403 });
  }

  const first = (aliases) => { for (const k of aliases || []) { const v=q.get(k); if (v !== null && String(v).trim() !== "") return String(v).trim(); } return ""; };
  const userId = first(config.userAliases);
  const transactionId = first(config.transactionAliases);
  const rawAmount = first(config.amountAliases);
  if (!userId || !transactionId || rawAmount === null || rawAmount === undefined) return new Response("bad request", { status: 400 });

  const user = await dbUserByDatabaseId(env.DB, userId);
  if (!user) return new Response("unknown user", { status: 404 });

  let amount = Number(rawAmount);
  if (!Number.isFinite(amount)) return new Response("invalid amount", { status: 400 });
  amount = Math.trunc(amount);
  if (amount === 0) return new Response("ok", { status: 200 });

  const providerTransactionId = provider + ":" + transactionId;
  const now = Math.floor(Date.now() / 1000);
  const offerId = first(config.offerIdAliases) || null;
  const offerName = first(config.offerNameAliases) || null;
  const payoutUsdRaw = first(config.payoutUsdAliases) || "0";
  const payoutUsd = Number(payoutUsdRaw);
  const safePayoutUsd = Number.isFinite(payoutUsd) && payoutUsd >= 0 ? payoutUsd : 0;

  if (amount > 0) {
    try {
      await env.DB.batch([
        env.DB.prepare(`
          INSERT INTO offerwall_conversions
          (transaction_id,user_id,amount,status,offer_id,offer_name,goal_id,payout_usd,test,created_at)
          VALUES(?,?,?,?,?,?,?,?,?,?)
        `).bind(providerTransactionId, user.id, amount, "credited", offerId, offerName, null, safePayoutUsd, 0, now),
        env.DB.prepare(`
          UPDATE wallets
          SET balance=balance+?, lifetime_earned=lifetime_earned+?, updated_at=?
          WHERE user_id=?
        `).bind(amount, amount, now, user.id),
        env.DB.prepare(`
          INSERT INTO transactions(user_id,type,amount,description,created_at)
          VALUES(?,?,?,?,?)
        `).bind(user.id, provider + "_offer_reward", amount, provider.toUpperCase() + " offer reward", now)
      ]);
    } catch (e) {
      const message = String(e?.message || e).toLowerCase();
      if (message.includes("unique") || message.includes("constraint")) return new Response("ok", { status: 200 });
      console.error(provider + " credit error:", e);
      return new Response("server error", { status: 500 });
    }
    return new Response("ok", { status: 200 });
  }

  const original = await env.DB.prepare(`
    SELECT amount,status FROM offerwall_conversions
    WHERE transaction_id=? LIMIT 1
  `).bind(providerTransactionId).first();

  if (!original) return new Response("ok", { status: 200 });
  if (String(original.status).toLowerCase() === "reversed") return new Response("ok", { status: 200 });

  const reversal = -Math.abs(Number(original.amount));
  try {
    await env.DB.batch([
      env.DB.prepare("UPDATE offerwall_conversions SET status=? WHERE transaction_id=?")
        .bind("reversed", providerTransactionId),
      env.DB.prepare(`
        UPDATE wallets
        SET balance=MAX(0,balance+?), updated_at=?
        WHERE user_id=?
      `).bind(reversal, now, user.id),
      env.DB.prepare(`
        INSERT INTO transactions(user_id,type,amount,description,created_at)
        VALUES(?,?,?,?,?)
      `).bind(user.id, provider + "_offer_reversal", reversal, provider.toUpperCase() + " offer reversal", now)
    ]);
  } catch (e) {
    console.error(provider + " reversal error:", e);
    return new Response("server error", { status: 500 });
  }

  return new Response("ok", { status: 200 });
}

async function tapjoyPostback(request, env) {
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
  if (!env.DB || !env.TAPJOY_VC_SECRET) return new Response("server configuration error", { status: 500 });
  await ensureSchema(env);

  const q = new URL(request.url).searchParams;
  const snuid = (q.get("snuid") || "").trim();
  const currencyRaw = q.get("currency");
  const rewardId = (q.get("id") || "").trim();
  const verifier = (q.get("verifier") || "").trim().toLowerCase();

  if (!snuid || currencyRaw === null || !rewardId || !verifier) return new Response("bad request", { status: 400 });

  const expected = md5Hex(`${rewardId}:${snuid}:${currencyRaw}:${env.TAPJOY_VC_SECRET}`);
  if (!constantTimeEqual(expected, verifier)) return new Response("invalid verifier", { status: 403 });

  const user = await dbUserByDatabaseId(env.DB, snuid);
  if (!user) return new Response("unknown user", { status: 403 });

  const amountNumber = Number(currencyRaw);
  if (!Number.isFinite(amountNumber)) return new Response("invalid currency", { status: 400 });

  const amount = Math.trunc(amountNumber);
  if (amount === 0) return new Response("ok", { status: 200 });

  const transactionId = "tapjoy:" + rewardId;
  const now = Math.floor(Date.now() / 1000);
  const offerName = q.get("offer_name") || q.get("offer") || "Tapjoy offer";
  const payoutUsdRaw = q.get("payout") || q.get("payout_usd") || "0";
  const payoutUsd = Number(payoutUsdRaw);
  const safePayoutUsd = Number.isFinite(payoutUsd) && payoutUsd >= 0 ? payoutUsd : 0;

  if (amount > 0) {
    try {
      await env.DB.batch([
        env.DB.prepare(`
          INSERT INTO offerwall_conversions
          (transaction_id,user_id,amount,status,offer_id,offer_name,goal_id,payout_usd,test,created_at)
          VALUES(?,?,?,?,?,?,?,?,?,?)
        `).bind(transactionId, user.id, amount, "credited", rewardId, offerName, null, safePayoutUsd, 0, now),
        env.DB.prepare(`
          UPDATE wallets
          SET balance=balance+?, lifetime_earned=lifetime_earned+?, updated_at=?
          WHERE user_id=?
        `).bind(amount, amount, now, user.id),
        env.DB.prepare(`
          INSERT INTO transactions(user_id,type,amount,description,created_at)
          VALUES(?,?,?,?,?)
        `).bind(user.id, "tapjoy_offer_reward", amount, "Tapjoy offer reward", now)
      ]);
    } catch (e) {
      const message = String(e?.message || e).toLowerCase();
      if (message.includes("unique") || message.includes("constraint")) return new Response("ok", { status: 200 });
      console.error("Tapjoy credit error:", e);
      return new Response("server error", { status: 500 });
    }
    return new Response("ok", { status: 200 });
  }

  const original = await env.DB.prepare(`
    SELECT amount,status,user_id FROM offerwall_conversions
    WHERE transaction_id=? LIMIT 1
  `).bind(transactionId).first();

  if (!original) return new Response("ok", { status: 200 });
  if (String(original.status).toLowerCase() === "reversed") return new Response("ok", { status: 200 });

  const reversal = -Math.abs(Number(original.amount));
  try {
    await env.DB.batch([
      env.DB.prepare("UPDATE offerwall_conversions SET status=? WHERE transaction_id=?")
        .bind("reversed", transactionId),
      env.DB.prepare(`
        UPDATE wallets
        SET balance=MAX(0,balance+?), updated_at=?
        WHERE user_id=?
      `).bind(reversal, now, original.user_id),
      env.DB.prepare(`
        INSERT INTO transactions(user_id,type,amount,description,created_at)
        VALUES(?,?,?,?,?)
      `).bind(original.user_id, "tapjoy_offer_reversal", reversal, "Tapjoy offer reversal", now)
    ]);
  } catch (e) {
    console.error("Tapjoy reversal error:", e);
    return new Response("server error", { status: 500 });
  }

  return new Response("ok", { status: 200 });
}

async function dbUserByDatabaseId(db, id) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) return null;
  return db.prepare("SELECT * FROM users WHERE id=? LIMIT 1").bind(numericId).first();
}

async function initSchema(db) {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id TEXT UNIQUE, username TEXT, first_name TEXT, last_name TEXT, referral_code TEXT UNIQUE, referred_by TEXT, email TEXT UNIQUE, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS wallets (user_id INTEGER PRIMARY KEY, balance INTEGER NOT NULL DEFAULT 0, lifetime_earned INTEGER NOT NULL DEFAULT 0, lifetime_withdrawn INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS referrals (id INTEGER PRIMARY KEY AUTOINCREMENT, referrer_id INTEGER NOT NULL, referred_user_id INTEGER NOT NULL UNIQUE, reward INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, type TEXT NOT NULL, amount INTEGER NOT NULL, description TEXT, created_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS email_credentials (user_id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS email_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS admin_users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, created_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS admin_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_id INTEGER NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS withdrawals (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, method TEXT NOT NULL, destination TEXT NOT NULL, coins INTEGER NOT NULL, usd_cents INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, admin_note TEXT)`,
    `CREATE TABLE IF NOT EXISTS offerwall_conversions (id INTEGER PRIMARY KEY AUTOINCREMENT, transaction_id TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL, amount INTEGER NOT NULL, status TEXT NOT NULL, offer_id TEXT, offer_name TEXT, goal_id TEXT, payout_usd REAL DEFAULT 0, test INTEGER DEFAULT 0, created_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS monetag_postbacks (id INTEGER PRIMARY KEY AUTOINCREMENT, event_key TEXT NOT NULL UNIQUE, ymid TEXT NOT NULL, telegram_id TEXT NOT NULL, user_id INTEGER NOT NULL, event_type TEXT, reward_event_type TEXT, zone_id TEXT NOT NULL, estimated_price REAL, reward_date TEXT NOT NULL, rewarded INTEGER NOT NULL, created_at INTEGER NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS idx_email_sessions_token ON email_sessions(token_hash)`,
    `CREATE INDEX IF NOT EXISTS idx_admin_sessions_token ON admin_sessions(token_hash)`,
    `CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals(user_id,created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_monetag_user_date ON monetag_postbacks(telegram_id,reward_date)`
  ];

  for (const sql of stmts) {
    try {
      await db.prepare(sql).run();
    } catch (e) {
      const m = String(e?.message || e).toLowerCase();
      if (!m.includes("already exists") && !m.includes("duplicate column")) {
        console.error("Schema statement failed:", sql.slice(0, 120), e);
      }
    }
  }

  try {
    await db.prepare("ALTER TABLE users ADD COLUMN email TEXT").run();
  } catch (e) {
    const m = String(e?.message || e).toLowerCase();
    if (!m.includes("duplicate column") && !m.includes("already exists")) console.error("users.email migration:", e);
  }

  await ensureColumns(db, "withdrawals", {
    method: "TEXT",
    destination: "TEXT",
    coins: "INTEGER",
    usd_cents: "INTEGER",
    status: "TEXT DEFAULT 'pending'",
    created_at: "INTEGER",
    updated_at: "INTEGER",
    admin_note: "TEXT"
  });
}

async function ensureColumns(db, table, definitions) {
  const info = await db.prepare("PRAGMA table_info(" + table + ")").all();
  const existing = new Set((info.results || []).map(row => String(row.name)));
  for (const [name, definition] of Object.entries(definitions)) {
    if (existing.has(name)) continue;
    try {
      await db.prepare("ALTER TABLE " + table + " ADD COLUMN " + name + " " + definition).run();
    } catch (e) {
      const m = String(e?.message || e).toLowerCase();
      if (!m.includes("duplicate column") && !m.includes("already exists")) console.error("Column migration failed:", table, name, e);
    }
  }
}

async function ensureSchema(env) {
  if (!env.DB) throw new Error("DB binding missing");
  await initSchema(env.DB);
}

async function apiMe(request, env) {
  try {
    if (request.method !== "GET") return json({ success: false, message: "Method not allowed." }, 405);
    if (!env.DB || !env.BOT_TOKEN) return json({ success: false, message: "Server configuration is incomplete." }, 500);
    await ensureSchema(env);

    const initData = getInitData(request);
    if (!initData) return json({ success: false, code: "MISSING_INIT_DATA", message: "Telegram authorization data is missing." }, 401);

    const td = await validateTelegramInitData(initData, env.BOT_TOKEN);
    if (!td) return json({ success: false, code: "INVALID_INIT_DATA", message: "Invalid Telegram authorization." }, 401);

    const user = await getOrCreateTelegramUser(env.DB, td);
    return userPayload(env.DB, user.id, { auth: "telegram" });
  } catch (e) {
    console.error("apiMe error:", e);
    return json({ success: false, code: "API_ME_ERROR", message: "Unable to load your Coin Cove account right now." }, 500);
  }
}

async function getOrCreateTelegramUser(db, td) {
  const u = td.user;
  const now = Math.floor(Date.now() / 1000);
  const tid = String(u.id);
  let row = await db.prepare("SELECT * FROM users WHERE telegram_id=? LIMIT 1").bind(tid).first();

  if (!row) {
    let referredBy = null;
    if (td.start_param) {
      const r = await db.prepare("SELECT telegram_id FROM users WHERE referral_code=? LIMIT 1").bind(td.start_param).first();
      if (r && String(r.telegram_id) !== tid) referredBy = String(r.telegram_id);
    }

    await db.prepare(`
      INSERT INTO users(telegram_id,username,first_name,last_name,referral_code,referred_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?)
    `).bind(
      tid, u.username || null, u.first_name || "", u.last_name || null,
      generateReferralCode(), referredBy, now, now
    ).run();

    row = await db.prepare("SELECT * FROM users WHERE telegram_id=? LIMIT 1").bind(tid).first();
    await db.prepare(`
      INSERT OR IGNORE INTO wallets(user_id,balance,lifetime_earned,lifetime_withdrawn,updated_at)
      VALUES(?,0,0,0,?)
    `).bind(row.id, now).run();

    if (referredBy) {
      const r = await db.prepare("SELECT id FROM users WHERE telegram_id=? LIMIT 1").bind(referredBy).first();
      if (r) {
        await db.prepare(`
          INSERT OR IGNORE INTO referrals(referrer_id,referred_user_id,reward,created_at)
          VALUES(?,?,0,?)
        `).bind(r.id, row.id, now).run();
      }
    }
  }

  await db.prepare(`
    UPDATE users SET username=?,first_name=?,last_name=?,updated_at=? WHERE id=?
  `).bind(u.username || null, u.first_name || "", u.last_name || null, now, row.id).run();

  return db.prepare("SELECT * FROM users WHERE id=?").bind(row.id).first();
}

async function userPayload(db, userId, extra = {}) {
  await db.prepare(`INSERT OR IGNORE INTO wallets(user_id,balance,lifetime_earned,lifetime_withdrawn,updated_at) VALUES(?,0,0,0,?)`).bind(userId, Math.floor(Date.now()/1000)).run();
  const w = await db.prepare("SELECT balance,lifetime_earned,lifetime_withdrawn FROM wallets WHERE user_id=?").bind(userId).first();
  const tx = await db.prepare(`
    SELECT type,amount,description,created_at FROM transactions
    WHERE user_id=? ORDER BY id DESC LIMIT 10
  `).bind(userId).all();
  const rc = await db.prepare("SELECT COUNT(*) count FROM referrals WHERE referrer_id=?").bind(userId).first();
  const withdrawals = await db.prepare(`
    SELECT id,method,coins,usd_cents,status,created_at,updated_at
    FROM withdrawals WHERE user_id=? ORDER BY id DESC LIMIT 10
  `).bind(userId).all();
  const user = await db.prepare(`
    SELECT id,telegram_id,username,first_name,last_name,referral_code,email
    FROM users WHERE id=?
  `).bind(userId).first();

  return json({
    success: true,
    user,
    wallet: w || { balance: 0, lifetime_earned: 0, lifetime_withdrawn: 0 },
    referrals: { count: Number(rc?.count || 0) },
    transactions: tx.results || [],
    withdrawals: withdrawals.results || [],
    ...extra
  });
}

async function apiReferral(request, env) {
  if (request.method !== "GET") return json({ success: false, message: "Method not allowed." }, 405);
  if (!env.DB || !env.BOT_TOKEN) return json({ success: false, message: "Server configuration is incomplete." }, 500);
  await ensureSchema(env);

  const td = await validateTelegramInitData(getInitData(request), env.BOT_TOKEN);
  if (!td) return json({ success: false, message: "Invalid Telegram authorization." }, 401);

  const u = await dbUserByTelegram(env.DB, String(td.user.id));
  if (!u) return json({ success: false, message: "User account is not ready yet." }, 404);

  let bot = "";
  try {
    const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/getMe`);
    const d = await r.json();
    bot = d?.result?.username || "";
  } catch {}

  if (!bot) return json({ success: false, message: "Unable to determine the Telegram bot username." }, 502);

  const link = `https://t.me/${bot}/${encodeURIComponent(String(env.MINI_APP_SHORT_NAME || MINI_APP_SHORT_NAME))}?startapp=${encodeURIComponent(u.referral_code)}`;
  const c = await env.DB.prepare("SELECT COUNT(*) count FROM referrals WHERE referrer_id=?").bind(u.id).first();
  return json({ success: true, code: u.referral_code, link, count: Number(c?.count || 0) });
}

async function rewardAd(request, env) {
  if (request.method !== "POST") return json({ success: false, message: "Method not allowed." }, 405);
  if (!env.DB || !env.BOT_TOKEN) return json({ success: false, message: "Server configuration is incomplete." }, 500);
  await ensureSchema(env);

  let b;
  try { b = await request.json(); } catch { return json({ success: false, message: "Invalid request body." }, 400); }

  const td = await validateTelegramInitData(String(b?.initData || ""), env.BOT_TOKEN);
  if (!td) return json({ success: false, code: "INVALID_INIT_DATA", message: "Invalid Telegram authorization." }, 401);

  const u = await dbUserByTelegram(env.DB, String(td.user.id));
  if (!u) return json({ success: false, message: "User account was not found." }, 404);

  return json({ success: true, rewarded: 0, pending: true, message: "Ad completed. Waiting for Monetag server confirmation." });
}

async function monetagPostback(request, env) {
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
  if (!env.DB) return new Response("database configuration error", { status: 500 });
  await ensureSchema(env);

  const q = new URL(request.url).searchParams;
  const ymid = (q.get("ymid") || "").trim();
  const event = (q.get("event") || q.get("event_type") || "").trim().toLowerCase();
  const rev = (q.get("reward_event_type") || "").trim().toLowerCase();
  const zone = (q.get("zone_id") || "").trim();
  const tid = (q.get("telegram_id") || ymid).trim();

  if (!ymid || !zone || !tid) return new Response("bad request", { status: 400 });
  if (zone !== MONETAG_ZONE_ID) return new Response("invalid zone", { status: 403 });

  const accepted = new Set(["impression", "view", "viewed", "reward", "rewarded"]);
  const revs = new Set(["reward", "rewarded", "impression", "view", "viewed"]);
  if (!(accepted.has(event) || revs.has(rev)) || rev !== "valued") return new Response("ignored", { status: 200 });

  const u = await dbUserByTelegram(env.DB, tid);
  if (!u) return new Response("unknown user", { status: 404 });

  const key = await sha256Hex(
    Array.from(q.entries())
      .sort((a, b) => a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0]))
      .map(x => x[0] + "=" + x[1]).join("&")
  );

  if (await env.DB.prepare("SELECT id FROM monetag_postbacks WHERE event_key=?").bind(key).first()) {
    return new Response("ok", { status: 200 });
  }

  const now = Math.floor(Date.now() / 1000);
  const today = new Date().toISOString().slice(0, 10);
  const daily = await env.DB.prepare(`
    SELECT COUNT(*) count FROM monetag_postbacks WHERE telegram_id=? AND reward_date=?
  `).bind(tid, today).first();

  if (Number(daily?.count || 0) >= DAILY_AD_LIMIT) return new Response("daily limit reached", { status: 200 });

  const last = await env.DB.prepare(`
    SELECT created_at FROM monetag_postbacks WHERE telegram_id=? ORDER BY id DESC LIMIT 1
  `).bind(tid).first();

  if (last && now - Number(last.created_at) < AD_COOLDOWN_SECONDS) return new Response("cooldown", { status: 200 });

  const price = q.get("estimated_price");
  const ep = price == null || price === "" ? null : Number(price);
  if (ep !== null && (!Number.isFinite(ep) || ep < 0)) return new Response("invalid estimated_price", { status: 400 });

  try {
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO monetag_postbacks
        (event_key,ymid,telegram_id,user_id,event_type,reward_event_type,zone_id,estimated_price,reward_date,rewarded,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)
      `).bind(key, ymid, tid, u.id, event || null, rev || null, zone, ep, today, AD_REWARD_COINS, now),
      env.DB.prepare(`
        UPDATE wallets SET balance=balance+?,lifetime_earned=lifetime_earned+?,updated_at=? WHERE user_id=?
      `).bind(AD_REWARD_COINS, AD_REWARD_COINS, now, u.id),
      env.DB.prepare(`
        INSERT INTO transactions(user_id,type,amount,description,created_at)
        VALUES(?,?,?,?,?)
      `).bind(u.id, "monetag_ad_reward", AD_REWARD_COINS, "Monetag rewarded ad", now)
    ]);
  } catch (e) {
    const message = String(e?.message || e).toLowerCase();
    if (message.includes("unique") || message.includes("constraint")) return new Response("ok", { status: 200 });
    console.error("Monetag postback error:", e);
    return new Response("server error", { status: 500 });
  }

  return new Response("ok", { status: 200 });
}

async function offerwallPostback(request, env) {
  if (request.method !== "GET" && request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const secret = env.OFFERWALL_GG_SECRET || env.OFFERWALL_SECRET;
  if (!env.DB || !secret) return new Response("server configuration error", { status: 500 });
  await ensureSchema(env);

  const q = await readPostbackParams(request);
  const userId = (q.get("user") || q.get("userId") || q.get("user_id") || "").trim();
  const tx = (q.get("tx") || q.get("transactionId") || q.get("txid") || q.get("trans_id") || "").trim();
  const raw = q.get("amount") ?? q.get("currencyAmount") ?? q.get("points") ?? q.get("reward");
  const sig = (q.get("sig") || q.get("signature") || q.get("hash") || "").trim();
  const status = (q.get("status") || "").trim().toLowerCase();
  const test = q.get("test") || "0";

  if (!userId || !tx || raw === null || !sig) return new Response("bad request", { status: 400 });

  const expected = await hmacHexText(secret, `${userId}:${tx}:${raw}`);
  if (!constantTimeEqual(expected, sig)) return new Response("invalid signature", { status: 403 });
  if (test === "1") return new Response("ok", { status: 200 });
  if (status !== "credited" && status !== "reversed") return new Response("ok", { status: 200 });

  const amountRaw = Number(raw);
  if (!Number.isFinite(amountRaw) || amountRaw === 0) return new Response("ok", { status: 200 });
  // Coin Cove stores Coins as whole units. Offerwall.GG may send fractional
  // currency amounts, so truncate once on credit and use the stored amount
  // for the matching reversal to keep the ledger symmetric.
  const amount = amountRaw < 0 ? Math.ceil(amountRaw) : Math.floor(amountRaw);
  if (!amount) return new Response("ok", { status: 200 });

  const u = await dbUserByDatabaseId(env.DB, userId);
  if (!u) return new Response("unknown user", { status: 404 });

  const now = Math.floor(Date.now() / 1000);
  try {
    if (status === "credited") {
      await env.DB.batch([
        env.DB.prepare(`
          INSERT INTO offerwall_conversions
          (transaction_id,user_id,amount,status,offer_id,offer_name,goal_id,payout_usd,test,created_at)
          VALUES(?,?,?,?,?,?,?,?,?,?)
        `).bind(tx, u.id, amount, status, q.get("offerId") || q.get("offer_id"), q.get("offerName") || q.get("offer_name"), q.get("goalId") || q.get("goal_id"), Number(q.get("payoutUsd") || q.get("payout_usd") || 0), test === "1" ? 1 : 0, now),
        env.DB.prepare(`
          UPDATE wallets SET balance=balance+?,lifetime_earned=lifetime_earned+?,updated_at=? WHERE user_id=?
        `).bind(amount, amount, now, u.id),
        env.DB.prepare(`
          INSERT INTO transactions(user_id,type,amount,description,created_at)
          VALUES(?,?,?,?,?)
        `).bind(u.id, "offer_reward", amount, "Offer reward", now)
      ]);
    } else {
      const original = await env.DB.prepare(`
        SELECT amount,status FROM offerwall_conversions WHERE transaction_id=? LIMIT 1
      `).bind(tx).first();

      if (!original) return new Response("ok", { status: 200 });
      if (String(original.status).toLowerCase() === "reversed") return new Response("ok", { status: 200 });

      const reversal = -Math.abs(Number(original.amount));
      await env.DB.batch([
        env.DB.prepare("UPDATE offerwall_conversions SET status=? WHERE transaction_id=?").bind("reversed", tx),
        env.DB.prepare(`
          UPDATE wallets SET balance=MAX(0,balance+?),updated_at=? WHERE user_id=?
        `).bind(reversal, now, u.id),
        env.DB.prepare(`
          INSERT INTO transactions(user_id,type,amount,description,created_at)
          VALUES(?,?,?,?,?)
        `).bind(u.id, "offer_reversal", reversal, "Offer reversed", now)
      ]);
    }
  } catch (e) {
    const message = String(e?.message || e).toLowerCase();
    if (message.includes("unique") || message.includes("constraint")) return new Response("ok", { status: 200 });
    console.error("Offerwall postback error:", e);
    return new Response("server error", { status: 500 });
  }

  return new Response("ok", { status: 200 });
}

async function emailRegister(request, env) {
  if (request.method !== "POST") return json({ success: false, message: "Method not allowed." }, 405);
  await ensureSchema(env);

  let b;
  try { b = await request.json(); } catch { return json({ success: false, message: "Invalid request body." }, 400); }

  const email = normalizeEmail(b?.email);
  const p = String(b?.password || "");
  const c = String(b?.confirmPassword || "");

  if (!validEmail(email)) return json({ success: false, message: "Enter a valid email." }, 400);
  if (p.length < 8) return json({ success: false, message: "Password must be at least 8 characters." }, 400);
  if (p !== c) return json({ success: false, message: "Passwords do not match." }, 400);
  const existingCredential = await env.DB.prepare("SELECT user_id FROM email_credentials WHERE email=? LIMIT 1").bind(email).first();
  if (existingCredential) return json({ success: false, message: "Email is already registered." }, 409);

  const now = Math.floor(Date.now() / 1000);
  const hash = await hashPassword(p);
  const syntheticTelegramId = "email:" + crypto.randomUUID();

  let user = await env.DB.prepare("SELECT * FROM users WHERE email=? LIMIT 1").bind(email).first();
  try {
    if (!user) {
      await env.DB.prepare(`
        INSERT INTO users(telegram_id,email,first_name,referral_code,created_at,updated_at)
        VALUES(?,?,?,?,?,?)
      `).bind(syntheticTelegramId, email, "", generateReferralCode(), now, now).run();
      user = await env.DB.prepare("SELECT * FROM users WHERE email=? LIMIT 1").bind(email).first();
    }
    if (!user) throw new Error("Email account was not created.");

    await env.DB.batch([
      env.DB.prepare(`
        INSERT OR IGNORE INTO wallets(user_id,balance,lifetime_earned,lifetime_withdrawn,updated_at)
        VALUES(?,0,0,0,?)
      `).bind(user.id, now),
      env.DB.prepare(`
        INSERT INTO email_credentials(user_id,email,password_hash,password_salt,created_at,updated_at)
        VALUES(?,?,?,?,?,?)
      `).bind(user.id, email, hash.hash, hash.salt, now, now)
    ]);
  } catch (e) {
    console.error("Email registration error:", e);
    const msg = String(e?.message || e).toLowerCase();
    if (msg.includes("unique") || msg.includes("constraint")) return json({ success: false, message: "This email is already registered." }, 409);
    return json({ success: false, message: "Unable to create the account. Please try again." }, 500);
  }

  const token = await createSession(env.DB, user.id);
  return userPayload(env.DB, user.id, { auth: "email", sessionCreated: true, token });
}

async function emailLogin(request, env) {
  if (request.method !== "POST") return json({ success: false, message: "Method not allowed." }, 405);
  await ensureSchema(env);

  let b;
  try { b = await request.json(); } catch { return json({ success: false, message: "Invalid request body." }, 400); }

  const email = normalizeEmail(b?.email);
  const p = String(b?.password || "");
  const row = await env.DB.prepare("SELECT * FROM email_credentials WHERE email=? LIMIT 1").bind(email).first();

  if (!row) return json({ success: false, message: "Invalid email or password." }, 401);
  if (!(await verifyPassword(p, row.password_hash, row.password_salt))) {
    return json({ success: false, message: "Invalid email or password." }, 401);
  }

  const token = await createSession(env.DB, row.user_id);
  return userPayload(env.DB, row.user_id, { auth: "email", sessionCreated: true, token });
}

async function emailLogout(request, env) {
  if (request.method !== "POST") return json({ success: false, message: "Method not allowed." }, 405);
  await ensureSchema(env);
  const token = getBearer(request);
  if (token) await env.DB.prepare("DELETE FROM email_sessions WHERE token_hash=?").bind(await sha256Hex(token)).run();
  return json({ success: true });
}

async function emailSessionMe(request, env) {
  if (request.method !== "GET") return json({ success: false, message: "Method not allowed." }, 405);
  await ensureSchema(env);
  const uid = await emailSessionUser(env.DB, request);
  if (!uid) return json({ success: false, message: "Not authenticated." }, 401);
  return userPayload(env.DB, uid, { auth: "email" });
}

async function createWithdrawal(request, env) {
  if (request.method !== "POST") return json({ success: false, message: "Method not allowed." }, 405);
  await ensureSchema(env);

  const identity = await resolveUserAuth(request, env);
  if (!identity) return json({ success: false, message: "Please log in." }, 401);

  let b;
  try { b = await request.json(); } catch { return json({ success: false, message: "Invalid request body." }, 400); }

  const method = String(b?.method || "").trim().toUpperCase();
  const destination = String(b?.destination || "").trim();
  const coins = Number(b?.coins);

  if (!["USDT_TRC20", "BINANCE_ID"].includes(method)) return json({ success: false, message: "Invalid withdrawal method." }, 400);
  if (!destination) return json({ success: false, message: "Destination is required." }, 400);
  if (!Number.isInteger(coins) || coins < WITHDRAW_MIN_COINS) return json({ success: false, message: "Minimum withdrawal is 200 Coins ($0.10)." }, 400);
  if (coins % 200 !== 0) return json({ success: false, message: "Withdrawal amount must be a whole $0.10 step (200 Coins)." }, 400);

  const now = Math.floor(Date.now() / 1000);
  const usdCents = Math.floor(coins * 100 / COINS_PER_USD);
  if (usdCents < 10) return json({ success: false, message: "Minimum withdrawal is $0.10." }, 400);

  let debit;
  try {
    debit = await env.DB.prepare(`
      UPDATE wallets
      SET balance=balance-?,lifetime_withdrawn=lifetime_withdrawn+?,updated_at=?
      WHERE user_id=? AND balance>=?
    `).bind(coins, coins, now, identity.userId, coins).run();
  } catch (e) {
    console.error("Withdrawal debit error:", e);
    return json({ success: false, message: "Unable to create withdrawal." }, 500);
  }

  if (Number(debit?.meta?.changes || 0) !== 1) return json({ success: false, message: "Insufficient Coins." }, 400);

  try {
    await env.DB.prepare(`
      INSERT INTO withdrawals(user_id,method,destination,coins,usd_cents,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?)
    `).bind(identity.userId, method, destination, coins, usdCents, "pending", now, now).run();
  } catch (e) {
    console.error("Withdrawal insert error:", e);
    await env.DB.prepare(`
      UPDATE wallets
      SET balance=balance+?,lifetime_withdrawn=MAX(0,lifetime_withdrawn-?),updated_at=?
      WHERE user_id=?
    `).bind(coins, coins, now, identity.userId).run();
    return json({ success: false, message: "Unable to create withdrawal. Your Coins were restored." }, 500);
  }

  const w = await env.DB.prepare(`
    SELECT id,status FROM withdrawals WHERE user_id=? ORDER BY id DESC LIMIT 1
  `).bind(identity.userId).first();

  return json({ success: true, withdrawal: w });
}

async function resolveUserAuth(request, env) {
  const init = getInitData(request);
  // Keep Telegram and website authentication strictly separate.
  // If Telegram initData is present, an invalid Telegram session must never
  // fall back to an email session from the same browser.
  if (init) {
    if (!env.BOT_TOKEN) return null;
    const td = await validateTelegramInitData(init, env.BOT_TOKEN);
    if (!td) return null;
    const u = await dbUserByTelegram(env.DB, String(td.user.id));
    return u ? { userId: u.id, auth: "telegram" } : null;
  }
  const uid = await emailSessionUser(env.DB, request);
  return uid ? { userId: uid, auth: "email" } : null;
}

async function telegramSetup(request, env) {
  if (request.method !== "POST") return json({ success: false, message: "Method not allowed." }, 405);
  await ensureSchema(env);
  if (!(await adminSession(env.DB, request))) return json({ success: false, message: "Not authenticated." }, 401);
  if (!env.BOT_TOKEN) return json({ success: false, message: "BOT_TOKEN is not configured." }, 500);

  const origin = new URL(request.url).origin;
  const webhookUrl = String(env.TELEGRAM_WEBHOOK_URL || (origin + "/api/telegram/webhook"));
  const webhookSecret = String(env.TELEGRAM_WEBHOOK_SECRET || ("cc_" + await sha256Hex(env.BOT_TOKEN + "|telegram-webhook")));
  const body = { url: webhookUrl, drop_pending_updates: false, secret_token: webhookSecret };

  try {
    const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/setWebhook`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
    });
    const d = await r.json();
    if (!d?.ok) return json({ success: false, message: d?.description || "Telegram webhook setup failed." }, 502);
    return json({ success: true, webhook: webhookUrl, description: d.description || "Webhook was set." });
  } catch (e) {
    console.error("Telegram webhook setup error:", e);
    return json({ success: false, message: "Unable to contact Telegram right now." }, 502);
  }
}

async function telegramWebhook(request, env) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!env.BOT_TOKEN) return new Response("bot not configured", { status: 500 });
  const expectedSecret = String(env.TELEGRAM_WEBHOOK_SECRET || ("cc_" + await sha256Hex(env.BOT_TOKEN + "|telegram-webhook")));
  const gotSecret = request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
  if (!constantTimeEqual(gotSecret, expectedSecret)) return new Response("forbidden", { status: 403 });

  let update;
  try { update = await request.json(); } catch { return new Response("bad request", { status: 400 }); }
  const msg = update?.message;
  const chatId = msg?.chat?.id;
  const text = String(msg?.text || "").trim();
  if (!chatId) return new Response("ok", { status: 200 });

  const botUrl = String(env.TELEGRAM_WEBAPP_URL || new URL(request.url).origin);
  let reply = "🌊 Coin Cove\n\nOpen Coin Cove to earn Coins and manage your account.";
  if (/^\/(start|help)\b/i.test(text) || text === "") {
    reply = "🌊 Welcome to Coin Cove!\n\nTap the button below to open Coin Cove with your Telegram account.";
  }

  try {
    await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId, text: reply,
        reply_markup: { inline_keyboard: [[{ text: "🌊 Open Coin Cove", web_app: { url: botUrl } }]] }
      })
    });
  } catch (e) { console.error("Telegram webhook sendMessage error:", e); }
  return new Response("ok", { status: 200 });
}

async function adminLogin(request, env) {
  if (request.method !== "POST") return json({ success: false, message: "Method not allowed." }, 405);
  await ensureSchema(env);

  let b;
  try { b = await request.json(); } catch { return json({ success: false, message: "Invalid request body." }, 400); }

  const username = String(b?.username || "").trim();
  const p = String(b?.password || "");
  if (!username || !p) return json({ success: false, message: "Username and password are required." }, 400);

  let a = await env.DB.prepare("SELECT * FROM admin_users WHERE username=?").bind(username).first();
  if (!a) {
    if (env.ADMIN_USERNAME && env.ADMIN_PASSWORD && username === env.ADMIN_USERNAME && p === env.ADMIN_PASSWORD) {
      const h = await hashPassword(p);
      const now = Math.floor(Date.now() / 1000);
      await env.DB.prepare(`
        INSERT OR IGNORE INTO admin_users(username,password_hash,password_salt,created_at)
        VALUES(?,?,?,?)
      `).bind(username, h.hash, h.salt, now).run();
      a = await env.DB.prepare("SELECT * FROM admin_users WHERE username=?").bind(username).first();
    } else {
      return json({ success: false, message: "Invalid admin credentials." }, 401);
    }
  }

  if (!(await verifyPassword(p, a.password_hash, a.password_salt))) {
    return json({ success: false, message: "Invalid admin credentials." }, 401);
  }

  const token = await createAdminSession(env.DB, a.id);
  return json({ success: true, token });
}

async function adminLogout(request, env) {
  if (request.method !== "POST") return json({ success: false, message: "Method not allowed." }, 405);
  await ensureSchema(env);
  const t = getBearer(request);
  if (t) await env.DB.prepare("DELETE FROM admin_sessions WHERE token_hash=?").bind(await sha256Hex(t)).run();
  return json({ success: true });
}

async function adminMe(request, env) {
  if (request.method !== "GET") return json({ success: false, message: "Method not allowed." }, 405);
  await ensureSchema(env);
  const a = await adminSession(env.DB, request);
  if (!a) return json({ success: false, message: "Not authenticated." }, 401);
  return json({ success: true, username: a.username });
}

async function adminUsers(request, env) {
  if (request.method !== "GET") return json({ success: false, message: "Method not allowed." }, 405);
  await ensureSchema(env);
  if (!(await adminSession(env.DB, request))) return json({ success: false, message: "Not authenticated." }, 401);

  const r = await env.DB.prepare(`
    SELECT u.id,u.telegram_id,u.email,u.username,u.first_name,
           COALESCE(w.balance,0) balance,
           COALESCE(w.lifetime_earned,0) lifetime_earned,
           COALESCE(w.lifetime_withdrawn,0) lifetime_withdrawn
    FROM users u
    LEFT JOIN wallets w ON w.user_id=u.id
    ORDER BY u.id DESC LIMIT 200
  `).all();

  return json({ success: true, users: r.results || [] });
}

async function adminWithdrawals(request, env) {
  if (request.method !== "GET") return json({ success: false, message: "Method not allowed." }, 405);
  await ensureSchema(env);
  if (!(await adminSession(env.DB, request))) return json({ success: false, message: "Not authenticated." }, 401);

  const r = await env.DB.prepare(`
    SELECT w.*,u.email,u.telegram_id,u.username
    FROM withdrawals w JOIN users u ON u.id=w.user_id
    ORDER BY w.id DESC LIMIT 200
  `).all();

  return json({ success: true, withdrawals: r.results || [] });
}

async function adminWithdrawalAction(request, env) {
  if (request.method !== "POST") return json({ success: false, message: "Method not allowed." }, 405);
  await ensureSchema(env);
  if (!(await adminSession(env.DB, request))) return json({ success: false, message: "Not authenticated." }, 401);

  let b;
  try { b = await request.json(); } catch { return json({ success: false, message: "Invalid request body." }, 400); }

  const id = Number(b?.id);
  const action = String(b?.action || "").toLowerCase();
  const note = String(b?.note || "");

  if (!Number.isInteger(id) || !["approve", "reject"].includes(action)) {
    return json({ success: false, message: "Invalid action." }, 400);
  }

  const w = await env.DB.prepare("SELECT * FROM withdrawals WHERE id=?").bind(id).first();
  if (!w || w.status !== "pending") return json({ success: false, message: "Withdrawal is not pending." }, 409);

  const now = Math.floor(Date.now() / 1000);

  if (action === "approve") {
    const result = await env.DB.prepare(`
      UPDATE withdrawals SET status='approved',admin_note=?,updated_at=?
      WHERE id=? AND status='pending'
    `).bind(note, now, id).run();

    if (Number(result?.meta?.changes || 0) !== 1) return json({ success: false, message: "Withdrawal was already processed." }, 409);
  } else {
    const result = await env.DB.prepare(`
      UPDATE withdrawals SET status='rejected',admin_note=?,updated_at=?
      WHERE id=? AND status='pending'
    `).bind(note, now, id).run();

    if (Number(result?.meta?.changes || 0) !== 1) return json({ success: false, message: "Withdrawal was already processed." }, 409);

    await env.DB.batch([
      env.DB.prepare(`
        UPDATE wallets
        SET balance=balance+?,lifetime_withdrawn=MAX(0,lifetime_withdrawn-?),updated_at=?
        WHERE user_id=?
      `).bind(w.coins, w.coins, now, w.user_id),
      env.DB.prepare(`
        INSERT INTO transactions(user_id,type,amount,description,created_at)
        VALUES(?,?,?,?,?)
      `).bind(w.user_id, "withdrawal_refund", w.coins, "Rejected withdrawal refund", now)
    ]);
  }

  return json({ success: true });
}

async function dbUserByTelegram(db, id) {
  return db.prepare("SELECT * FROM users WHERE telegram_id=? LIMIT 1").bind(String(id)).first();
}

async function dbUserByAnyId(db, id) {
  return db.prepare(`
    SELECT * FROM users WHERE telegram_id=? OR CAST(id AS TEXT)=? LIMIT 1
  `).bind(String(id), String(id)).first();
}

async function emailSessionUser(db, request) {
  const t = getBearer(request);
  if (!t) return null;

  const h = await sha256Hex(t);
  const r = await db.prepare(`
    SELECT user_id,expires_at FROM email_sessions WHERE token_hash=? LIMIT 1
  `).bind(h).first();

  if (!r) return null;

  if (Number(r.expires_at) <= Math.floor(Date.now() / 1000)) {
    await db.prepare("DELETE FROM email_sessions WHERE token_hash=?").bind(h).run();
    return null;
  }

  return Number(r.user_id);
}

async function createSession(db, userId) {
  const token = randomToken();
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(`
    INSERT INTO email_sessions(user_id,token_hash,expires_at,created_at)
    VALUES(?,?,?,?)
  `).bind(userId, await sha256Hex(token), now + 2592000, now).run();
  return token;
}

async function adminSession(db, request) {
  const t = getBearer(request);
  if (!t) return null;

  const h = await sha256Hex(t);
  const r = await db.prepare(`
    SELECT a.id,a.username,s.expires_at
    FROM admin_sessions s JOIN admin_users a ON a.id=s.admin_id
    WHERE s.token_hash=? LIMIT 1
  `).bind(h).first();

  if (!r) return null;

  if (Number(r.expires_at) <= Math.floor(Date.now() / 1000)) {
    await db.prepare("DELETE FROM admin_sessions WHERE token_hash=?").bind(h).run();
    return null;
  }

  return r;
}

async function createAdminSession(db, id) {
  const token = randomToken();
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(`
    INSERT INTO admin_sessions(admin_id,token_hash,expires_at,created_at)
    VALUES(?,?,?,?)
  `).bind(id, await sha256Hex(token), now + 86400, now).run();
  return token;
}

function getBearer(request) {
  const a = request.headers.get("Authorization") || "";
  return a.toLowerCase().startsWith("bearer ") ? a.slice(7).trim() : "";
}

function getInitData(request) {
  const h = request.headers.get("X-Telegram-Init-Data");
  if (h?.trim()) return h.trim();

  const a = request.headers.get("Authorization") || "";
  if (a.toLowerCase().startsWith("tma ")) return a.slice(4).trim();

  const u = new URL(request.url);
  return (u.searchParams.get("initData") || u.searchParams.get("tgWebAppData") || "").trim();
}

async function validateTelegramInitData(initData, botToken) {
  if (!initData || !botToken) return null;

  try {
    const p = new URLSearchParams(initData);
    const received = p.get("hash");
    if (!received) return null;

    p.delete("hash");
    const entries = Array.from(p.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    const check = entries.map(x => `${x[0]}=${x[1]}`).join("\n");

    const secret = await hmacSha256(new TextEncoder().encode("WebAppData"), botToken);
    const calculated = await hmacSha256Hex(secret, check);

    if (!constantTimeEqual(calculated, received)) {
      console.error("Telegram hash mismatch");
      return null;
    }

    const auth = Number(p.get("auth_date"));
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(auth) || auth <= 0 || auth > now + 300 || now - auth > 86400) return null;

    const raw = p.get("user");
    if (!raw) return null;

    const user = JSON.parse(raw);
    if (!user?.id) return null;

    return { user, start_param: p.get("start_param") || null };
  } catch (e) {
    console.error("Telegram validation error", e);
    return null;
  }
}

async function hmacSha256(keyBytes, message) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
}

async function hmacSha256Hex(keyBytes, message) {
  const s = await hmacSha256(keyBytes, message);
  return Array.from(new Uint8Array(s)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function hmacHexText(secret, message) {
  return hmacSha256Hex(new TextEncoder().encode(secret), message);
}

async function sha256Hex(message) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(message));
  return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, "0")).join("");
}

/* WebCrypto in Cloudflare Workers does not provide MD5, but Tapjoy's
   legacy self-managed-currency callback requires MD5(id:snuid:currency:secret). */
function md5Hex(input) {
  function cmn(q,a,b,x,s,t){a=(a+q+x+t)|0;return (((a<<s)|(a>>>(32-s)))+b)|0;}
  function ff(a,b,c,d,x,s,t){return cmn((b&c)|((~b)&d),a,b,x,s,t);}
  function gg(a,b,c,d,x,s,t){return cmn((b&d)|(c&(~d)),a,b,x,s,t);}
  function hh(a,b,c,d,x,s,t){return cmn(b^c^d,a,b,x,s,t);}
  function ii(a,b,c,d,x,s,t){return cmn(c^(b|(~d)),a,b,x,s,t);}
  const bytes = new TextEncoder().encode(input);
  const len = bytes.length;
  const n = (((len + 8) >>> 6) + 1) * 16;
  const x = new Array(n).fill(0);

  for (let i=0;i<len;i++) x[i>>2] |= bytes[i] << ((i%4)*8);
  x[len>>2] |= 0x80 << ((len%4)*8);
  x[n-2] = (len * 8) >>> 0;
  x[n-1] = Math.floor(len / 0x20000000);

  let a=0x67452301,b=0xefcdab89,c=0x98badcfe,d=0x10325476;

  for (let i=0;i<n;i+=16) {
    const oa=a,ob=b,oc=c,od=d;
    a=ff(a,b,c,d,x[i+0],7,-680876936); d=ff(d,a,b,c,x[i+1],12,-389564586); c=ff(c,d,a,b,x[i+2],17,606105819); b=ff(b,c,d,a,x[i+3],22,-1044525330);
    a=ff(a,b,c,d,x[i+4],7,-176418897); d=ff(d,a,b,c,x[i+5],12,1200080426); c=ff(c,d,a,b,x[i+6],17,-1473231341); b=ff(b,c,d,a,x[i+7],22,-45705983);
    a=ff(a,b,c,d,x[i+8],7,1770035416); d=ff(d,a,b,c,x[i+9],12,-1958414417); c=ff(c,d,a,b,x[i+10],17,-42063); b=ff(b,c,d,a,x[i+11],22,-1990404162);
    a=ff(a,b,c,d,x[i+12],7,1804603682); d=ff(d,a,b,c,x[i+13],12,-40341101); c=ff(c,d,a,b,x[i+14],17,-1502002290); b=ff(b,c,d,a,x[i+15],22,1236535329);

    a=gg(a,b,c,d,x[i+1],5,-165796510); d=gg(d,a,b,c,x[i+6],9,-1069501632); c=gg(c,d,a,b,x[i+11],14,643717713); b=gg(b,c,d,a,x[i+0],20,-373897302);
    a=gg(a,b,c,d,x[i+5],5,-701558691); d=gg(d,a,b,c,x[i+10],9,38016083); c=gg(c,d,a,b,x[i+15],14,-660478335); b=gg(b,c,d,a,x[i+4],20,-405537848);
    a=gg(a,b,c,d,x[i+9],5,568446438); d=gg(d,a,b,c,x[i+14],9,-1019803690); c=gg(c,d,a,b,x[i+3],14,-187363961); b=gg(b,c,d,a,x[i+8],20,1163531501);
    a=gg(a,b,c,d,x[i+13],5,-1444681467); d=gg(d,a,b,c,x[i+2],9,-51403784); c=gg(c,d,a,b,x[i+7],14,1735328473); b=gg(b,c,d,a,x[i+12],20,-1926607734);

    a=hh(a,b,c,d,x[i+5],4,-378558); d=hh(d,a,b,c,x[i+8],11,-2022574463); c=hh(c,d,a,b,x[i+11],16,1839030562); b=hh(b,c,d,a,x[i+14],23,-35309556);
    a=hh(a,b,c,d,x[i+1],4,-1530992060); d=hh(d,a,b,c,x[i+4],11,1272893353); c=hh(c,d,a,b,x[i+7],16,-155497632); b=hh(b,c,d,a,x[i+10],23,-1094730640);
    a=hh(a,b,c,d,x[i+13],4,681279174); d=hh(d,a,b,c,x[i+0],11,-358537222); c=hh(c,d,a,b,x[i+3],16,-722521979); b=hh(b,c,d,a,x[i+6],23,76029189);
    a=hh(a,b,c,d,x[i+9],4,-640364487); d=hh(d,a,b,c,x[i+12],11,-421815835); c=hh(c,d,a,b,x[i+15],16,530742520); b=hh(b,c,d,a,x[i+2],23,-995338651);

    a=ii(a,b,c,d,x[i+0],6,-198630844); d=ii(d,a,b,c,x[i+7],10,1126891415); c=ii(c,d,a,b,x[i+14],15,-1416354905); b=ii(b,c,d,a,x[i+5],21,-57434055);
    a=ii(a,b,c,d,x[i+12],6,1700485571); d=ii(d,a,b,c,x[i+3],10,-189414153); c=ii(c,d,a,b,x[i+10],15,-1051523); b=ii(b,c,d,a,x[i+1],21,-2054922799);
    a=ii(a,b,c,d,x[i+8],6,1873313359); d=ii(d,a,b,c,x[i+15],10,-30611744); c=ii(c,d,a,b,x[i+6],15,-1560198380); b=ii(b,c,d,a,x[i+13],21,1309151649);
    a=ii(a,b,c,d,x[i+4],6,-145523070); d=ii(d,a,b,c,x[i+11],10,-1120210379); c=ii(c,d,a,b,x[i+2],15,718787259); b=ii(b,c,d,a,x[i+9],21,-343485551);

    a=(a+oa)|0; b=(b+ob)|0; c=(c+oc)|0; d=(d+od)|0;
  }

  function hex(v) {
    let s="";
    for(let i=0;i<4;i++) s += ((v >>> (i*8)) & 255).toString(16).padStart(2,"0");
    return s;
  }
  return hex(a)+hex(b)+hex(c)+hex(d);
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    key, 256
  );
  return { hash: bytesToHex(new Uint8Array(bits)), salt: bytesToHex(salt) };
}

async function verifyPassword(password, hash, saltHex) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const salt = hexToBytes(saltHex);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    key, 256
  );
  return constantTimeEqual(bytesToHex(new Uint8Array(bits)), hash);
}

function randomBytes(n) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return a;
}

function bytesToHex(a) {
  return Array.from(a).map(b => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(h) {
  const a = new Uint8Array(h.length / 2);
  for (let i=0;i<a.length;i++) a[i] = parseInt(h.slice(i*2,i*2+2),16);
  return a;
}

function randomToken() {
  return bytesToHex(randomBytes(32));
}

function constantTimeEqual(a,b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r=0;
  for(let i=0;i<a.length;i++) r |= a.charCodeAt(i)^b.charCodeAt(i);
  return r===0;
}

function generateReferralCode() {
  return crypto.randomUUID().replace(/-/g,"").slice(0,12).toUpperCase();
}

function normalizeEmail(v) {
  return String(v || "").trim().toLowerCase();
}

function validEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

function json(data,status=200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json;charset=UTF-8", "cache-control": "no-store" }
  });
}

function renderApp() {
  return String.raw`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0f172a">
<title>Coin Cove</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<script>
(function(){var t=document,a=window,p='https://rewards.unity.com/owp/web/sdk/latest',j='Tapjoy',o,y;
if(typeof a[j]==='function'){a[j]('activator-reinitialized');}
else{a[j]=function(){(a[j].q=a[j].q||[]).push(arguments)};a[j].l=1*new Date();o=t.createElement('script');y=t.getElementsByTagName('script')[0];o.async=1;o.src=p;y.parentNode.insertBefore(o,y);}})();
</script>
<script src="https://libtl.com/sdk.js" data-zone="${MONETAG_ZONE_ID}" data-sdk="show_${MONETAG_ZONE_ID}"></script>
<style>
:root{font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#e5e7eb;background:#07111f}
*{box-sizing:border-box}body{margin:0;background:linear-gradient(180deg,#07111f,#0b1220 55%,#111827);min-height:100vh}
button,input,select{font:inherit}button{cursor:pointer}.wrap{max-width:720px;margin:auto;padding:16px 14px 90px}
.top{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}.brand{font-weight:900;font-size:21px}.muted{color:#94a3b8}
.card{background:rgba(15,23,42,.92);border:1px solid rgba(148,163,184,.16);border-radius:22px;padding:18px;box-shadow:0 12px 35px rgba(0,0,0,.2);margin-bottom:14px}
.balance{font-size:42px;font-weight:900;margin:5px 0}.small{font-size:13px;color:#94a3b8}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.stat{padding:14px;border-radius:17px;background:#111c30}.stat b{display:block;font-size:19px;margin-top:4px}
.btn{border:0;border-radius:14px;padding:13px 15px;font-weight:800;background:#2563eb;color:#fff;width:100%}
.btn.secondary{background:#1e293b}.btn.good{background:#16a34a}.btn.warn{background:#b45309}.btn.danger{background:#dc2626}
.actions{display:grid;gap:10px}.row{display:flex;gap:9px;align-items:center}.row>*{flex:1}
.input,.select{width:100%;background:#0b1629;color:#fff;border:1px solid #334155;border-radius:13px;padding:13px;outline:none}
.modal{position:fixed;inset:0;background:rgba(0,0,0,.68);z-index:20;display:flex;align-items:flex-end}.sheet{width:100%;max-height:90vh;overflow:auto;background:#0b1220;border-radius:24px 24px 0 0;padding:18px}
.close{background:#1e293b;color:#fff;border:0;border-radius:10px;padding:9px 12px}.close-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.offer{padding:15px;border:1px solid #26354d;border-radius:17px;background:#0f1a2d;text-align:left}.offer strong{display:block;margin-bottom:5px}
.nav{position:fixed;left:0;right:0;bottom:0;background:rgba(7,17,31,.94);backdrop-filter:blur(10px);border-top:1px solid #26354d;display:flex;justify-content:center;z-index:10}.navin{max-width:720px;width:100%;display:grid;grid-template-columns:repeat(4,1fr);gap:5px;padding:8px}
.nav button{background:transparent;color:#94a3b8;border:0;padding:8px 4px;font-size:12px}.nav button.active{color:#fff}
.notice{padding:12px 14px;border-radius:13px;background:#0f1f38;color:#cbd5e1;font-size:13px}
.hidden{display:none!important}h2,h3{margin:0 0 10px}.title{font-size:17px;font-weight:900;margin-bottom:8px}
@media(max-width:430px){.balance{font-size:35px}.wrap{padding-left:11px;padding-right:11px}.card{padding:15px}}
.error-card{text-align:center}.error-card h3{margin-top:0}.error-card .btn{margin-top:16px}
</style>
</head>
<body>
<div id="app"><div class="wrap"><div class="card" style="margin-top:8vh"><div class="brand">🌊 Coin Cove</div><p class="muted">Sign in to earn Coins and request withdrawals.</p><div class="notice">Website accounts use <b>email + password</b>. Telegram Mini App accounts use <b>Telegram authorization</b>.</div><div class="actions" style="margin-top:14px"><input id="le" class="input" type="email" placeholder="Email" autocomplete="email"><input id="lp" class="input" type="password" placeholder="Password" autocomplete="current-password"><button class="btn" onclick="doLogin()">Login</button><button class="btn secondary" onclick="showRegister()">Create account</button></div></div></div></div>
<script>
const TAPJOY_SDK_KEY=${JSON.stringify(TAPJOY_SDK_KEY)};
const TAPJOY_PLACEMENT=${JSON.stringify(TAPJOY_PLACEMENT)};
const tg=window.Telegram&&window.Telegram.WebApp;
const storage={
  get(k){try{return window.localStorage.getItem(k)||''}catch(e){console.warn('Storage read failed:',e);return ''}},
  set(k,v){try{window.localStorage.setItem(k,v)}catch(e){console.warn('Storage write failed:',e)}},
  remove(k){try{window.localStorage.removeItem(k)}catch(e){console.warn('Storage remove failed:',e)}}
};
let user=null,state=null,emailToken=storage.get('cc_email_token'),page='home';

function esc(v){return String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;")}
async function api(path,opt={}){
  const headers=Object.assign({'Content-Type':'application/json'},opt.headers||{});
  if(!tg?.initData && emailToken)headers.Authorization='Bearer '+emailToken;
  if(tg?.initData)headers['X-Telegram-Init-Data']=tg.initData;
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),15000);
  try{
    const r=await fetch(path,Object.assign({},opt,{headers,signal:controller.signal}));
    let d;try{d=await r.json()}catch{d={success:false,message:'Server response was invalid.'}}
    if(!r.ok && !d.message)d.message='Request failed ('+r.status+').';
    return d;
  }catch(e){
    console.error('API request failed:',path,e);
    return {success:false,code:e?.name==='AbortError'?'TIMEOUT':'NETWORK_ERROR',message:e?.name==='AbortError'?'The server took too long to respond.':'Unable to connect to the server.'};
  }finally{clearTimeout(timeout)}
}
function initTapjoy(){
  if(!user||typeof window.Tapjoy!=='function')return;
  try{
    window.Tapjoy('init',{sdkKey:TAPJOY_SDK_KEY,publisherUserId:String(user.id),eventName:TAPJOY_PLACEMENT,preload:true});
  }catch(e){console.error('Tapjoy init error',e)}
}
function showTapjoy(){
  if(!user)return;
  if(typeof window.Tapjoy!=='function'){alert('Tapjoy is still loading. Please try again.');return}
  try{
    window.Tapjoy('init',{sdkKey:TAPJOY_SDK_KEY,publisherUserId:String(user.id),eventName:TAPJOY_PLACEMENT,preload:true});
    window.Tapjoy('showOfferwall',{});
  }catch(e){console.error(e);alert('Tapjoy could not be opened.')}
}
function closeWall(){document.getElementById('wall')?.remove()}
function nav(p){page=p;render()}
function money(){return (Number(state?.wallet?.balance||0)/${COINS_PER_USD}).toFixed(2)}
function render(){
  if(!state){loginScreen();return}
  const w=state.wallet||{},balance=Number(w.balance||0);
  document.getElementById('app').innerHTML=
  '<div class="wrap">'+
    '<div class="top"><div><div class="brand">🌊 Coin Cove</div><div class="small">Earn Coins and withdraw</div></div><button class="close" onclick="logout()">Log out</button></div>'+
    (page==='home'?homePage(balance):page==='offers'?offersPage():page==='withdraw'?withdrawPage(balance):accountPage())+
  '</div>'+
  '<div class="nav"><div class="navin">'+
    '<button class="'+(page==='home'?'active':'')+'" onclick="nav(\'home\')">🏠<br>Home</button>'+
    '<button class="'+(page==='offers'?'active':'')+'" onclick="nav(\'offers\')">🎁<br>Offers</button>'+
    '<button class="'+(page==='withdraw'?'active':'')+'" onclick="nav(\'withdraw\')">💸<br>Withdraw</button>'+
    '<button class="'+(page==='account'?'active':'')+'" onclick="nav(\'account\')">👤<br>Account</button>'+
  '</div></div>';
}
function homePage(balance){
 return '<div class="card"><div class="small">Your balance</div><div class="balance">'+balance.toLocaleString()+' Coins</div><div class="small">≈ $'+money()+'</div><div class="grid" style="margin-top:15px">'+
 '<div class="stat"><span class="small">Lifetime earned</span><b>'+Number(state.wallet.lifetime_earned||0).toLocaleString()+'</b></div>'+
 '<div class="stat"><span class="small">Referrals</span><b>'+Number(state.referrals?.count||0)+'</b></div></div></div>'+
 '<div class="card"><div class="title">Earn more</div><div class="actions">'+
 '<button class="btn" onclick="showTapjoy()">⚡ Tapjoy Offerwall</button>'+
 '<button class="btn secondary" onclick="openOffers()">🎁 Other Offerwalls</button>'+
 '<button class="btn good" onclick="watchAd()">▶ Watch rewarded ad</button>'+
 '</div></div>'+
 '<div class="card"><div class="title">Recent activity</div>'+txHtml()+'</div>';
}
function txHtml(){
 const tx=state.transactions||[];
 if(!tx.length)return '<div class="muted">No activity yet.</div>';
 return tx.map(x=>'<div class="row" style="padding:9px 0;border-bottom:1px solid #1e293b"><div><b>'+esc(x.description||x.type)+'</b><div class="small">'+new Date(Number(x.created_at)*1000).toLocaleString()+'</div></div><strong>'+((Number(x.amount)>=0?'+':'')+Number(x.amount).toLocaleString())+'</strong></div>').join('');
}
function offersPage(){
 return '<div class="card"><h2>Offerwalls</h2><div class="notice">Complete eligible offers. Rewards are credited by each provider after its server callback is received.</div></div>'+
 '<div class="card"><div class="actions">'+
 '<button class="offer" onclick="showTapjoy()"><strong>⚡ Tapjoy</strong><span class="small">Open Tapjoy Web Offerwall</span></button>'+
 '<button class="offer" onclick="openProvider(\'cpidroid\')"><strong>🎯 CPIDroid</strong><span class="small">Open provider wall</span></button>'+
 '<button class="offer" onclick="openProvider(\'notik\')"><strong>🎮 Notik</strong><span class="small">Open provider wall</span></button>'+
 '<button class="offer" onclick="openProvider(\'admantum\')"><strong>🚀 AdMantum</strong><span class="small">Open provider wall</span></button>'+
 '<button class="offer" onclick="openProvider(\'offerwallgg\')"><strong>💎 Offerwall.GG</strong><span class="small">Open provider wall</span></button>'+
 '<button class="offer" onclick="openProvider(\'adswed\')"><strong>🟢 AdswedMedia</strong><span class="small">Open provider wall</span></button>'+
 '</div></div>';
}
function openOffers(){page='offers';render()}
function openProvider(name){
 const uid=encodeURIComponent(String(state.user?.id||''));
 const urls={
  cpidroid:'https://wall.cpidroid.com/offer/yxpm-81812-kal5?uid='+uid+'&gaid=&idfa=',
  notik:'https://notik.me/coins?api_key=2eZo0UC1kNfCwjcFCYGpEWGwSDWzXJo9&pub_id=sLzA&app_id=fggvW50o8Z&user_id='+uid,
  admantum:'https://www.admantum.com/offers?appid=27938&uid='+uid,
  offerwallgg:'https://offerwall.gg/wall/4c826098db679c99583194371d0eae1b?userId='+uid,
  adswed:'https://adswedmedia.com/offer/'+${JSON.stringify(ADSWED_PUBLIC_KEY)}+'/'+uid
 };
 if(!urls[name]){alert('This provider is not configured yet.');return}
 window.open(urls[name],'_blank','noopener,noreferrer');
}
function withdrawPage(balance){
 return '<div class="card"><h2>Withdraw</h2><div class="small">Available: '+balance.toLocaleString()+' Coins ≈ $'+money()+'</div></div>'+
 '<div class="card"><div class="actions">'+
 '<select id="wm" class="select"><option value="USDT_TRC20">USDT TRC20</option><option value="BINANCE_ID">Binance ID</option></select>'+
 '<input id="wd" class="input" placeholder="Wallet / Binance ID">'+
 '<input id="wc" class="input" type="number" min="200" step="200" placeholder="Coins (200, 400, 600...)">'+
 '<button class="btn" onclick="withdraw()">Submit withdrawal</button></div>'+
 '<div class="small" style="margin-top:10px">Minimum 200 Coins ($0.10). Amounts use 200-coin steps.</div></div>'+
 '<div class="card"><div class="title">Withdrawal history</div>'+withdrawalsHtml()+'</div>';
}
function withdrawalsHtml(){
 const ws=state.withdrawals||[];
 if(!ws.length)return '<div class="muted">No withdrawals yet.</div>';
 return ws.map(x=>'<div class="row" style="padding:9px 0;border-bottom:1px solid #1e293b"><div><b>'+Number(x.coins).toLocaleString()+' Coins</b><div class="small">'+esc(x.method)+' · '+new Date(Number(x.created_at)*1000).toLocaleString()+'</div></div><strong>'+esc(x.status)+'</strong></div>').join('');
}
function accountPage(){
 return '<div class="card"><h2>Account</h2><div class="notice"><b>ID:</b> '+esc(state.user?.id)+'<br><b>Email:</b> '+esc(state.user?.email||'Telegram account')+'</div></div>'+
 '<div class="card"><div class="title">Referral</div><div class="small">Your referral code: '+esc(state.user?.referral_code||'')+'</div><button class="btn secondary" style="margin-top:10px" onclick="loadReferral()">Get referral link</button></div>';
}
async function loadReferral(){
 const d=await api('/api/referral');if(!d.success){alert(d.message||'Unable to load referral link');return}
 prompt('Copy your referral link:',d.link);
}
async function withdraw(){
 const coins=Number(document.getElementById('wc').value);
 const method=document.getElementById('wm').value;
 const destination=document.getElementById('wd').value.trim();
 if(!destination||!Number.isInteger(coins)){alert('Enter a valid destination and coin amount.');return}
 const d=await api('/api/withdraw',{method:'POST',body:JSON.stringify({method,destination,coins})});
 if(!d.success){alert(d.message||'Withdrawal failed.');return}
 await reload();alert('Withdrawal submitted.');page='withdraw';render();
}
async function watchAd(){
 if(!tg||!tg.initData){alert('Rewarded ads are available inside Telegram.');return}
 if(typeof window['show_${MONETAG_ZONE_ID}']!=='function'){alert('Ad is still loading. Please try again.');return}
 try{
   await window['show_${MONETAG_ZONE_ID}']({ymid:String(user.id),requestVar:'watch_earn'});
   const d=await api('/api/reward-ad',{method:'POST',body:JSON.stringify({initData:tg.initData})});
   alert(d.message||'Ad completed. Reward will be confirmed by the ad network.');
 }catch(e){alert('The ad was not completed.')}
}
async function reload(){
 let d;
 if(emailToken)d=await api('/api/auth/me');
 else d=await api('/api/me');
 if(!d.success){state=null;user=null;loginScreen();return}
 state=d;user=d.user;initTapjoy();
}
function loginScreen(){
 const app=document.getElementById('app');
 if(tg&&tg.initData){
   app.innerHTML='<div class="wrap"><div class="card" style="margin-top:8vh"><div class="brand">🌊 Coin Cove</div><h2>Telegram account</h2><p class="muted">This Mini App uses your Telegram account. Email/password login is disabled here.</p><div class="notice">If Telegram authorization is unavailable, close and reopen Coin Cove from <b>@Covecoinbot</b>.</div><button class="btn" style="margin-top:12px" onclick="location.reload()">Retry Telegram login</button></div></div>';
   return;
 }
 app.innerHTML='<div class="wrap"><div class="card" style="margin-top:12vh"><div class="brand">🌊 Coin Cove</div><p class="muted">Sign in to earn Coins and request withdrawals.</p><div id="authbox"><div class="actions"><input id="le" class="input" type="email" placeholder="Email" autocomplete="email"><input id="lp" class="input" type="password" placeholder="Password" autocomplete="current-password"><button class="btn" onclick="doLogin()">Login</button><button class="btn secondary" onclick="showRegister()">Create account</button></div></div></div></div>';
}
function showRegister(){
 document.getElementById('authbox').innerHTML='<div class="actions"><input id="re" class="input" type="email" placeholder="Email"><input id="rp" class="input" type="password" placeholder="Password (8+ characters)"><input id="rc" class="input" type="password" placeholder="Confirm password"><button class="btn" onclick="doRegister()">Create account</button><button class="btn secondary" onclick="loginScreen()">Back to login</button></div>';
}
async function doLogin(){
 if(tg&&tg.initData){loginScreen();return}
 const email=document.getElementById('le')?.value.trim()||'';
 const password=document.getElementById('lp')?.value||'';
 if(!email||!password){alert('Enter your email and password.');return}
 const d=await api('/api/auth/login',{method:'POST',body:JSON.stringify({email,password})});
 if(!d.success){alert(d.message||'Login failed.');return}
 emailToken=d.token||'';storage.set('cc_email_token',emailToken);state=d;user=d.user;page='home';initTapjoy();render();
}
async function doRegister(){
 if(tg&&tg.initData){loginScreen();return}
 const email=document.getElementById('re')?.value.trim()||'';
 const password=document.getElementById('rp')?.value||'';
 const confirmPassword=document.getElementById('rc')?.value||'';
 if(!email||!password||!confirmPassword){alert('Complete all fields.');return}
 const d=await api('/api/auth/register',{method:'POST',body:JSON.stringify({email,password,confirmPassword})});
 if(!d.success){alert(d.message||'Registration failed.');return}
 emailToken=d.token||'';if(emailToken)storage.set('cc_email_token',emailToken);state=d;user=d.user;page='home';initTapjoy();render();
}
async function logout(){
 if(emailToken)await api('/api/auth/logout',{method:'POST'});
 emailToken='';storage.remove('cc_email_token');state=null;user=null;loginScreen();
}
async function boot(){
 const app=document.getElementById('app');
 try{
   if(tg){try{tg.ready();tg.expand()}catch(e){console.warn('Telegram WebApp init warning:',e)}}
   // Telegram Mini App: Telegram auth ONLY.
   if(tg&&tg.initData){
     const d=await api('/api/me');
     if(d.success){state=d;user=d.user;initTapjoy();render();return}
     console.warn('Telegram authentication failed:',d);
     loginScreen();
     return;
   }
   // Normal website: email/password auth ONLY.
   if(emailToken){
     const d=await api('/api/auth/me');
     if(d.success){state=d;user=d.user;initTapjoy();render();return}
     emailToken='';storage.remove('cc_email_token');
   }
   loginScreen();
 }catch(e){
   console.error('Boot error:',e);
   if(app)app.innerHTML='<div class="wrap"><div class="card error-card"><h3>Unable to load Coin Cove</h3><div class="small">'+esc(e?.message||'Unexpected error.')+'</div><button class="btn" onclick="location.reload()">Retry</button></div></div>';
 }
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
</script>
</body></html>`;
}

function renderAdmin() {
  return String.raw`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Coin Cove Admin</title>
<style>body{font-family:Arial;margin:0;background:#f4f6f9;color:#111827}.wrap{max-width:1100px;margin:auto;padding:20px}.card{background:#fff;border-radius:18px;padding:18px;margin:12px 0;overflow:auto;box-shadow:0 5px 18px rgba(0,0,0,.05)}.input,.btn{padding:12px;border-radius:10px;border:1px solid #ddd}.btn{background:#111827;color:#fff;border:0;font-weight:700}.danger{background:#b91c1c}table{width:100%;border-collapse:collapse}td,th{padding:9px;border-bottom:1px solid #eee;text-align:left;white-space:nowrap}</style></head><body><div class="wrap"><div id="app"><div class="card"><h2>Coin Cove Admin</h2><p>Admin login</p><input id="adminUser" class="input" placeholder="Admin Username" autocomplete="username"><input id="adminPass" class="input" type="password" placeholder="Admin Password" autocomplete="current-password"><button class="btn" style="margin-top:10px" onclick="doLogin()">Login</button><p class="small" style="margin-top:10px">Build 2026-09-24-auth-fix-v5</p></div></div></div>
<script>
const storage={
 get(k){try{return window.localStorage.getItem(k)||''}catch(e){console.warn('Storage read failed:',e);return ''}},
 set(k,v){try{window.localStorage.setItem(k,v)}catch(e){console.warn('Storage write failed:',e)}},
 remove(k){try{window.localStorage.removeItem(k)}catch(e){console.warn('Storage remove failed:',e)}}
};
let token=storage.get('cc_admin_token');
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
async function api(p,o={}){
 const headers=Object.assign({'Content-Type':'application/json'},o.headers||{},token?{'Authorization':'Bearer '+token}:{});
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),15000);
 try{
   const r=await fetch(p,Object.assign({},o,{headers,signal:controller.signal}));
   let d;try{d=await r.json()}catch{d={success:false,message:'Server response was invalid.'}}
   if(!r.ok&&!d.message)d.message='Request failed ('+r.status+').';
   return d;
 }catch(e){
   return {success:false,code:e?.name==='AbortError'?'TIMEOUT':'NETWORK_ERROR',message:e?.name==='AbortError'?'The server took too long to respond.':'Unable to connect to the server.'};
 }finally{clearTimeout(timeout)}
}
async function boot(){
 try{
   const m=await api('/api/admin/me');
   if(!m.success){login();return}
   dash();
 }catch(e){
   document.getElementById('app').innerHTML='<div class="card"><h2>Unable to load Admin</h2><p>'+esc(e?.message||'Unexpected error.')+'</p><button class="btn" onclick="location.reload()">Retry</button></div>';
 }
}
function login(){document.getElementById('app').innerHTML='<div class="card"><h2>Coin Cove Admin</h2><input id="adminUser" class="input" placeholder="Admin Username" autocomplete="username"><input id="adminPass" class="input" type="password" placeholder="Admin Password" autocomplete="current-password"><button class="btn" style="margin-top:10px" onclick="doLogin()">Login</button></div>'}
async function doLogin(){const username=document.getElementById('adminUser')?.value.trim()||'';const password=document.getElementById('adminPass')?.value||'';if(!username||!password){alert('Enter admin username and password.');return}const d=await api('/api/admin/login',{method:'POST',body:JSON.stringify({username,password})});if(!d.success)return alert(d.message||'Admin login failed.');token=d.token;storage.set('cc_admin_token',token);dash()}
async function dash(){const [us,ws]=await Promise.all([api('/api/admin/users'),api('/api/admin/withdrawals')]);if(!us.success||!ws.success){document.getElementById('app').innerHTML='<div class="card"><h2>Admin data could not be loaded</h2><p>'+esc(us.message||ws.message||'Please try again.')+'</p><button class="btn" onclick="dash()">Retry</button><button class="btn secondary" style="margin-top:8px" onclick="logout()">Back to login</button></div>';return}document.getElementById('app').innerHTML='<h2>Coin Cove Admin</h2><div class="card"><h3>Telegram Bot</h3><p>Connect the bot webhook so /start opens Coin Cove in Telegram.</p><button class="btn" onclick="setupTelegram()">Connect Telegram Bot</button><span id="tgSetupStatus" class="small" style="margin-left:8px"></span></div><div class="card"><h3>Users</h3><table><tr><th>ID</th><th>Email</th><th>Telegram</th><th>Balance</th><th>Earned</th></tr>'+(us.users||[]).map(x=>'<tr><td>'+x.id+'</td><td>'+esc(x.email||'')+'</td><td>'+esc(x.telegram_id||'')+'</td><td>'+x.balance+'</td><td>'+x.lifetime_earned+'</td></tr>').join('')+'</table></div><div class="card"><h3>Withdrawals</h3><table><tr><th>ID</th><th>User</th><th>Method</th><th>Coins</th><th>USD</th><th>Status</th><th>Action</th></tr>'+(ws.withdrawals||[]).map(x=>'<tr><td>'+x.id+'</td><td>'+esc(x.email||x.telegram_id||'')+'</td><td>'+x.method+'</td><td>'+x.coins+'</td><td>$'+(Number(x.usd_cents||0)/100).toFixed(2)+'</td><td>'+x.status+'</td><td>'+(x.status==='pending'?'<button class="btn" onclick="act('+x.id+',\'approve\')">Approve</button> <button class="btn danger" onclick="act('+x.id+',\'reject\')">Reject</button>':'')+'</td></tr>').join('')+'</table></div><button class="btn" onclick="logout()">Logout</button>'}
async function setupTelegram(){const el=document.getElementById('tgSetupStatus');if(el)el.textContent='Connecting...';const d=await api('/api/admin/telegram/setup',{method:'POST'});if(el)el.textContent=d.success?'Connected':'Failed';alert(d.message||d.description||(d.success?'Telegram webhook connected.':'Telegram setup failed.'));}
async function act(id,a){const d=await api('/api/admin/withdrawal',{method:'POST',body:JSON.stringify({id,action:a})});alert(d.message||'Done');dash()}
async function logout(){await api('/api/admin/logout',{method:'POST'});storage.remove('cc_admin_token');token='';login()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
</script></body></html>`;
}
