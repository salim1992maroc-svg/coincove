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
const OFFERME_PUBLIC_KEY = "5bXp8NOHWINp4PkGRsKynKJ7Ext3g4";
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
      if (url.pathname === "/api/offerme/postback") return offermePostback(request, env);
      if (url.pathname === "/api/offerme/launch") return offermeLaunch(request, env);
      if (url.pathname === "/postback/gaintwall") return gaintwallPostback(request, env);
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

async function gaintwallPostback(request, env) {
  if (!['GET', 'POST'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
  if (!env.DB || !env.GAINTWALL_POSTBACK_SECRET) return new Response('server configuration error', { status: 500 });
  await ensureSchema(env);

  const q = await readPostbackParams(request);
  // Accept the exact camelCase macros in GaintWall's documented Postback URL,
  // while retaining snake_case aliases for backward compatibility.
  const userId = (q.get('userId') || q.get('user_id') || '').trim();
  const offerId = (q.get('offerId') || q.get('offer_id') || '').trim();
  const transactionIdRaw = (q.get('transactionId') || q.get('transaction_id') || '').trim();
  const status = (q.get('status') || '').trim().toLowerCase();
  const rawReward = q.get('reward');
  const rawPayout = q.get('payout') || '0';
  const hash = (q.get('hash') || '').trim().toLowerCase();

  if (!userId || !offerId || !transactionIdRaw || rawReward === null || !hash) {
    return new Response('bad request', { status: 400 });
  }

  // Gaintwall specification: SHA256(user_id + offer_id + transaction_id + Placement Postback Secret).
  const expected = await sha256Hex(userId + offerId + transactionIdRaw + String(env.GAINTWALL_POSTBACK_SECRET));
  if (!constantTimeEqual(hash, expected)) return new Response('invalid hash', { status: 403 });

  const user = await dbUserByDatabaseId(env.DB, userId);
  if (!user) return new Response('unknown user', { status: 404 });

  const transactionId = 'gaintwall:' + transactionIdRaw;
  const now = Math.floor(Date.now() / 1000);
  const offerName = q.get('offerName') || q.get('offer_name') || 'Gaintwall offer';
  const payout = Number(rawPayout);
  const safePayout = Number.isFinite(payout) && payout >= 0 ? payout : 0;

  if (status === 'approved') {
    const rewardNumber = Number(rawReward);
    if (!Number.isFinite(rewardNumber) || rewardNumber <= 0) return new Response('invalid reward', { status: 400 });
    const reward = Math.trunc(rewardNumber);
    if (reward <= 0) return new Response('OK', { status: 200 });
    try {
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO offerwall_conversions
          (transaction_id,user_id,amount,status,offer_id,offer_name,goal_id,payout_usd,test,created_at)
          VALUES(?,?,?,?,?,?,?,?,?,?)`)
          .bind(transactionId, user.id, reward, 'credited', offerId, offerName, null, safePayout, 0, now),
        env.DB.prepare(`UPDATE wallets SET balance=balance+?,lifetime_earned=lifetime_earned+?,updated_at=? WHERE user_id=?`)
          .bind(reward, reward, now, user.id),
        env.DB.prepare(`INSERT INTO transactions(user_id,type,amount,description,created_at) VALUES(?,?,?,?,?)`)
          .bind(user.id, 'gaintwall_offer_reward', reward, 'Gaintwall offer reward', now)
      ]);
    } catch (e) {
      const message = String(e?.message || e).toLowerCase();
      if (message.includes('unique') || message.includes('constraint')) return new Response('OK', { status: 200 });
      console.error('Gaintwall credit error:', e);
      return new Response('server error', { status: 500 });
    }
    return new Response('OK', { status: 200 });
  }

  if (status === 'rejected') {
    const original = await env.DB.prepare(`SELECT user_id,amount,status FROM offerwall_conversions WHERE transaction_id=? LIMIT 1`)
      .bind(transactionId).first();
    if (!original || String(original.status).toLowerCase() === 'reversed') return new Response('OK', { status: 200 });
    const reversal = -Math.abs(Number(original.amount));
    try {
      await env.DB.batch([
        env.DB.prepare(`UPDATE offerwall_conversions SET status='reversed' WHERE transaction_id=?`).bind(transactionId),
        env.DB.prepare(`UPDATE wallets SET balance=MAX(0,balance+?),updated_at=? WHERE user_id=?`).bind(reversal, now, original.user_id),
        env.DB.prepare(`INSERT INTO transactions(user_id,type,amount,description,created_at) VALUES(?,?,?,?,?)`)
          .bind(original.user_id, 'gaintwall_offer_reversal', reversal, 'Gaintwall offer reversal', now)
      ]);
    } catch (e) {
      console.error('Gaintwall reversal error:', e);
      return new Response('server error', { status: 500 });
    }
  }
  return new Response('OK', { status: 200 });
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

async function offermeLaunch(request, env) {
  if (request.method !== "GET") return json({ success: false, message: "Method not allowed." }, 405);
  if (!env.DB || !env.OFFERME_SECRET_KEY) return json({ success: false, message: "Offerwall.me is not configured." }, 503);
  await ensureSchema(env);
  const identity = await resolveUserAuth(request, env);
  if (!identity) return json({ success: false, message: "Authentication required." }, 401);

  // Offerwall.me's identity signature binds the authenticated database user ID
  // to this placement and expires after one hour. Never accept a user ID from
  // the browser for this URL.
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const message = `offerwall-user-v1\n${OFFERME_PUBLIC_KEY}\n${String(identity.userId)}\n${expires}`;
  const signature = await hmacHexText(String(env.OFFERME_SECRET_KEY), message);
  // Official hosted Offerwall.me path and signed-identity query names.
  // The signed URL is generated only from the authenticated server-side user.
  const target = new URL(`https://offerwall.me/offerwall/${encodeURIComponent(OFFERME_PUBLIC_KEY)}/${encodeURIComponent(String(identity.userId))}`);
  target.searchParams.set("identityExpires", String(expires));
  target.searchParams.set("identitySignature", signature);
  return json({ success: true, url: target.toString() }, 200, { "Cache-Control": "no-store, private" });
}

async function offermePostback(request, env) {
  if (request.method !== "GET" && request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!env.DB || !env.OFFERME_SECRET_KEY) return new Response("server configuration error", { status: 500 });
  await ensureSchema(env);
  const q = await readPostbackParams(request);
  const userId = String(q.get("subId") || q.get("sub_id") || "").trim();
  const tx = String(q.get("transId") || q.get("trans_id") || "").trim();
  const rewardRaw = q.get("reward");
  const sig = String(q.get("signature") || "").trim();
  const status = String(q.get("status") || "1").trim();
  if (!userId || !tx || rewardRaw === null || !sig) return new Response("bad request", { status: 400 });

  const expected = md5Hex(`${userId}${tx}${rewardRaw}${String(env.OFFERME_SECRET_KEY)}`);
  if (!constantTimeEqual(expected.toLowerCase(), sig.toLowerCase())) return new Response("invalid signature", { status: 403 });
  const user = await dbUserByDatabaseId(env.DB, userId);
  if (!user) return new Response("unknown user", { status: 404 });
  const now = Math.floor(Date.now() / 1000);

  try {
    if (status === "1") {
      const reward = Number(rewardRaw);
      if (!Number.isFinite(reward) || reward <= 0) return new Response("ok", { status: 200 });
      const amount = Math.floor(reward);
      if (amount <= 0) return new Response("ok", { status: 200 });
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO offerwall_conversions
          (transaction_id,user_id,amount,status,offer_id,offer_name,goal_id,payout_usd,test,created_at)
          VALUES(?,?,?,?,?,?,?,?,?,?)`)
          .bind(`offerme:${tx}`, user.id, amount, "credited", q.get("offer_id") || null,
            q.get("offer_name") || null, q.get("reward_name") || null,
            Number(q.get("payout") || 0), 0, now),
        env.DB.prepare("UPDATE wallets SET balance=balance+?,lifetime_earned=lifetime_earned+?,updated_at=? WHERE user_id=?")
          .bind(amount, amount, now, user.id),
        env.DB.prepare("INSERT INTO transactions(user_id,type,amount,description,created_at) VALUES(?,?,?,?,?)")
          .bind(user.id, "offerme_reward", amount, "Offerwall.me reward", now)
      ]);
    } else if (status === "2") {
      const original = await env.DB.prepare("SELECT user_id,amount,status FROM offerwall_conversions WHERE transaction_id=? LIMIT 1")
        .bind(`offerme:${tx}`).first();
      if (!original || String(original.status).toLowerCase() === "reversed") return new Response("ok", { status: 200 });
      const reversal = -Math.abs(Number(original.amount));
      await env.DB.batch([
        env.DB.prepare("UPDATE offerwall_conversions SET status='reversed' WHERE transaction_id=?").bind(`offerme:${tx}`),
        env.DB.prepare("UPDATE wallets SET balance=MAX(0,balance+?),updated_at=? WHERE user_id=?").bind(reversal, now, original.user_id),
        env.DB.prepare("INSERT INTO transactions(user_id,type,amount,description,created_at) VALUES(?,?,?,?,?)")
          .bind(original.user_id, "offerme_reversal", reversal, "Offerwall.me reversal", now)
      ]);
    }
  } catch (e) {
    const message = String(e?.message || e).toLowerCase();
    if (message.includes("unique") || message.includes("constraint")) return new Response("ok", { status: 200 });
    console.error("Offerwall.me postback error:", e);
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
  // RFC 1321 MD5, implemented in JavaScript for Cloudflare Workers.
  // MD5 is retained only for compatibility with providers that require it.
  const bytes = new TextEncoder().encode(String(input));
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const data = new Uint8Array(paddedLength);
  data.set(bytes);
  data[bytes.length] = 0x80;

  // Append the original message length as a 64-bit little-endian integer.
  const view = new DataView(data.buffer);
  const low = bitLength >>> 0;
  const high = Math.floor(bitLength / 0x100000000) >>> 0;
  view.setUint32(paddedLength - 8, low, true);
  view.setUint32(paddedLength - 4, high, true);

  const shifts = [
    7,12,17,22, 7,12,17,22, 7,12,17,22, 7,12,17,22,
    5,9,14,20, 5,9,14,20, 5,9,14,20, 5,9,14,20,
    4,11,16,23, 4,11,16,23, 4,11,16,23, 4,11,16,23,
    6,10,15,21, 6,10,15,21, 6,10,15,21, 6,10,15,21
  ];
  const constants = new Int32Array(64);
  for (let i = 0; i < 64; i++) {
    constants[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) | 0;
  }

  let a0 = 0x67452301 | 0;
  let b0 = 0xefcdab89 | 0;
  let c0 = 0x98badcfe | 0;
  let d0 = 0x10325476 | 0;
  const words = new Int32Array(16);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let j = 0; j < 16; j++) words[j] = view.getInt32(offset + j * 4, true);
    let a = a0, b = b0, c = c0, d = d0;

    for (let i = 0; i < 64; i++) {
      let f, g;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const sum = (a + f + constants[i] + words[g]) | 0;
      const shift = shifts[i];
      const rotated = (sum << shift) | (sum >>> (32 - shift));
      const nextB = (b + rotated) | 0;
      a = d;
      d = c;
      c = b;
      b = nextB;
    }
    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }

  const hexWord = (word) => {
    let out = '';
    for (let i = 0; i < 4; i++) out += ((word >>> (i * 8)) & 255).toString(16).padStart(2, '0');
    return out;
  };
  return hexWord(a0) + hexWord(b0) + hexWord(c0) + hexWord(d0);
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
    <meta name="offerwall-verification" content="6ab9a009140ec6c12c76caf8">
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
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#f4f7ff;background:#070b18;color-scheme:dark;--bg:#070b18;--panel:#10182b;--panel2:#151f36;--line:rgba(155,180,255,.14);--muted:#8e9bb8;--cyan:#45f0d0;--blue:#5b8cff;--violet:#9a72ff;--gold:#ffd477}
*{box-sizing:border-box}html{background:var(--bg);scroll-behavior:smooth}body{margin:0;min-height:100vh;background:radial-gradient(ellipse at 10% 0%,rgba(62,93,214,.24),transparent 35%),radial-gradient(ellipse at 100% 25%,rgba(30,204,188,.12),transparent 30%),linear-gradient(160deg,#080d1d 0%,#0a1022 52%,#070b17 100%);background-attachment:fixed;color:#f4f7ff}body:before{content:"";position:fixed;inset:0;pointer-events:none;opacity:.17;background-image:radial-gradient(#8eaaff 0.6px,transparent .6px);background-size:24px 24px;mask-image:linear-gradient(to bottom,black,transparent 70%);z-index:0}
button,input,select{font:inherit}button{cursor:pointer;transition:transform .18s ease,filter .18s ease,box-shadow .18s ease}button:active{transform:scale(.985)}.wrap{position:relative;z-index:1;max-width:760px;margin:auto;padding:22px 16px calc(112px + env(safe-area-inset-bottom))}
.top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:2px 0 24px;padding:4px 2px}.brand{display:flex;align-items:center;gap:10px;font-weight:950;font-size:23px;letter-spacing:-.8px;color:#f7f9ff}.brand:first-letter{color:var(--cyan)}.top .brand{font-size:24px}.top .small{margin-top:5px;font-size:12px;letter-spacing:.3px;color:#8f9cba}.close{background:rgba(255,255,255,.055);color:#e9eeff;border:1px solid var(--line);border-radius:14px;padding:11px 15px;font-weight:750;box-shadow:inset 0 1px 0 rgba(255,255,255,.04)}
.card{position:relative;overflow:hidden;background:linear-gradient(145deg,rgba(19,29,53,.96),rgba(12,19,37,.97));border:1px solid var(--line);border-radius:27px;padding:22px;margin-bottom:17px;box-shadow:0 18px 45px rgba(0,0,0,.22),inset 0 1px 0 rgba(255,255,255,.035);backdrop-filter:blur(16px)}.card h2,.card h3{letter-spacing:-.5px}.wrap>.card:nth-of-type(2){min-height:270px;padding:25px;background:radial-gradient(ellipse at 100% 0%,rgba(69,240,208,.19),transparent 42%),radial-gradient(ellipse at 0% 100%,rgba(91,140,255,.2),transparent 48%),linear-gradient(135deg,#17284a 0%,#121b35 58%,#19162f 100%);border:1px solid rgba(111,207,255,.24);box-shadow:0 24px 60px rgba(0,0,0,.3),inset 0 1px 0 rgba(255,255,255,.08)}.wrap>.card:nth-of-type(2):after{content:"C";position:absolute;right:-10px;top:-65px;font-size:245px;line-height:1;font-weight:1000;color:rgba(255,255,255,.025);pointer-events:none;transform:rotate(-12deg)}.wrap>.card:nth-of-type(2)>.small:first-child{font-size:13px;text-transform:uppercase;letter-spacing:1.8px;font-weight:800;color:#a9badc}.balance{position:relative;font-size:clamp(42px,10vw,61px);font-weight:950;letter-spacing:-2.5px;line-height:1.12;margin:13px 0 10px;background:linear-gradient(100deg,#fff 15%,#b9fff1 72%,#9abaff);-webkit-background-clip:text;background-clip:text;color:transparent;z-index:1}.balance+.small{font-weight:700;color:#a8badc}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.stat{position:relative;padding:16px;border-radius:19px;background:rgba(7,13,29,.42);border:1px solid rgba(180,200,255,.12);backdrop-filter:blur(10px)}.stat .small{font-size:12px;letter-spacing:.2px}.stat b{display:block;font-size:23px;margin-top:7px;color:#f7f9ff;letter-spacing:-.5px}
.title{font-size:20px;font-weight:900;letter-spacing:-.6px;margin-bottom:17px;display:flex;align-items:center;gap:9px}.actions{display:grid;gap:12px}.btn{position:relative;overflow:hidden;border:0;border-radius:17px;padding:16px 18px;font-weight:850;font-size:15px;letter-spacing:.05px;background:linear-gradient(110deg,#36e0c4,#54b8ff 55%,#8a78ff);color:#071427;width:100%;box-shadow:0 8px 24px rgba(72,177,255,.15),inset 0 1px 0 rgba(255,255,255,.28)}.btn:before{content:"";position:absolute;inset:0;background:linear-gradient(110deg,transparent 20%,rgba(255,255,255,.18),transparent 80%);transform:translateX(-100%);transition:transform .5s}.btn:hover:before{transform:translateX(100%)}.btn.secondary{background:linear-gradient(135deg,#1b2947,#182139);color:#e9efff;border:1px solid rgba(151,177,255,.16);box-shadow:none}.btn.good{background:linear-gradient(110deg,#36e0ad,#7ce98e);color:#06251e;box-shadow:0 8px 24px rgba(54,224,173,.12)}.btn.warn{background:linear-gradient(110deg,#ffc86b,#ff9c60);color:#301707}.btn.danger{background:linear-gradient(110deg,#ff7b91,#ef4566);color:#fff}.row{display:flex;gap:12px;align-items:center}.row>*{flex:1}.input,.select{width:100%;background:#0a1224;color:#f4f7ff;border:1px solid rgba(157,181,255,.2);border-radius:15px;padding:15px;outline:none;transition:border .2s,box-shadow .2s}.input:focus,.select:focus{border-color:var(--cyan);box-shadow:0 0 0 3px rgba(69,240,208,.1)}.input::placeholder{color:#71809f}
.modal{position:fixed;inset:0;background:rgba(2,5,14,.78);z-index:20;display:flex;align-items:flex-end;backdrop-filter:blur(8px)}.sheet{width:100%;max-height:90vh;overflow:auto;background:linear-gradient(160deg,#131e36,#0b1122);border:1px solid var(--line);border-bottom:0;border-radius:28px 28px 0 0;padding:22px}.close-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:15px}.offer{padding:19px;border:1px solid rgba(147,173,255,.15);border-radius:20px;background:linear-gradient(135deg,rgba(27,40,69,.9),rgba(15,23,43,.96));color:#f4f7ff;text-align:left;box-shadow:0 8px 20px rgba(0,0,0,.12);transition:transform .2s,border-color .2s}.offer:hover{transform:translateY(-2px);border-color:rgba(69,240,208,.42)}.offer strong{display:block;margin-bottom:7px;font-size:16px}.offer .small{font-size:12px;line-height:1.5}
.nav{position:fixed;left:0;right:0;bottom:0;padding-bottom:env(safe-area-inset-bottom);background:rgba(6,10,22,.88);backdrop-filter:blur(24px);border-top:1px solid rgba(157,181,255,.13);z-index:10;box-shadow:0 -12px 35px rgba(0,0,0,.18)}.navin{max-width:760px;width:100%;margin:auto;display:grid;grid-template-columns:repeat(4,1fr);gap:7px;padding:10px 12px 9px}.nav button{background:transparent;color:#7785a5;border:1px solid transparent;border-radius:17px;padding:10px 4px;font-size:12px;font-weight:800;line-height:1.65}.nav button.active{color:#54f0d2;background:linear-gradient(135deg,rgba(69,240,208,.13),rgba(91,140,255,.1));border-color:rgba(69,240,208,.16);box-shadow:inset 0 1px 0 rgba(255,255,255,.04)}.notice{padding:15px 16px;border-radius:17px;background:rgba(69,240,208,.06);border:1px solid rgba(69,240,208,.13);color:#b7c6e5;font-size:13px;line-height:1.6}.muted{color:var(--muted)}.small{font-size:13px;color:var(--muted);line-height:1.5}.hidden{display:none!important}h2,h3{margin:0 0 12px}.error-card{text-align:center}.error-card h3{margin-top:0}.error-card .btn{margin-top:16px}
@media(min-width:600px){.wrap{padding-top:32px}.wrap>.card:nth-of-type(2){padding:32px}.actions{gap:14px}.navin{padding:12px 18px}}
@media(max-width:430px){.wrap{padding:15px 12px calc(105px + env(safe-area-inset-bottom))}.top{margin-bottom:18px}.brand,.top .brand{font-size:21px}.card{padding:18px;border-radius:23px;margin-bottom:13px}.wrap>.card:nth-of-type(2){padding:21px;min-height:250px}.balance{font-size:39px;letter-spacing:-1.8px}.stat{padding:13px;border-radius:16px}.stat b{font-size:20px}.title{font-size:18px;margin-bottom:15px}.btn{padding:15px 13px;font-size:14px}.navin{gap:4px;padding:8px 8px 7px}.nav button{font-size:11px;border-radius:14px}.offer{padding:16px}}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}
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
 '<button class="offer" onclick="openProvider(\'offerme\')"><strong>🪙 Offerwall.me</strong><span class="small">Open provider wall</span></button>'+
'<button class="offer" onclick="openProvider(\'gaintwall\')"><strong>🌟 Gaintwall</strong><span class="small">Open provider wall</span></button>'+
 '</div></div>';
}
function openOffers(){page='offers';render()}
async function openProvider(name){
 const uid=encodeURIComponent(String(state.user?.id||''));
 if(name==='offerme'){
  try{
   const d=await api('/api/offerme/launch');
   if(!d.success||!d.url)throw new Error(d.message||'Unable to open Offerwall.me');
   // Render the provider's hosted wall inside Coin Cove; its own enabled modules
   // (offers, PTC, video, etc.) are controlled by the Offerwall.me placement.
   const old=document.getElementById('offerme-wall-modal');if(old)old.remove();
   const modal=document.createElement('div');modal.id='offerme-wall-modal';
   modal.style.cssText='position:fixed;inset:0;z-index:99999;background:rgba(3,7,18,.96);display:flex;flex-direction:column;padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom);';
   const bar=document.createElement('div');bar.style.cssText='height:54px;flex:0 0 54px;display:flex;align-items:center;justify-content:space-between;padding:0 16px;background:#0b1224;color:#fff;border-bottom:1px solid rgba(157,181,255,.2);font-weight:800;';
   const label=document.createElement('span');label.textContent='Offerwall.me';
   const close=document.createElement('button');close.type='button';close.textContent='✕ Close';close.style.cssText='border:1px solid #33415f;border-radius:12px;padding:9px 13px;background:#17233b;color:#fff;font-weight:800;';
   close.onclick=()=>modal.remove();bar.append(label,close);
   const frame=document.createElement('iframe');frame.title='Offerwall.me Offers, PTC and Video Ads';frame.src=d.url;frame.setAttribute('allow','clipboard-read; clipboard-write');frame.setAttribute('referrerpolicy','no-referrer');frame.style.cssText='width:100%;height:100%;flex:1;border:0;background:#fff;';
   modal.append(bar,frame);document.body.appendChild(modal);
  }catch(e){alert(e.message||'Unable to open Offerwall.me');}
  return;
 }
 const urls={
  cpidroid:'https://wall.cpidroid.com/offer/yxpm-81812-kal5?uid='+uid+'&gaid=&idfa=',
  notik:'https://notik.me/coins?api_key=2eZo0UC1kNfCwjcFCYGpEWGwSDWzXJo9&pub_id=sLzA&app_id=fggvW50o8Z&user_id='+uid,
  admantum:'https://www.admantum.com/offers?appid=27938&uid='+uid,
  offerwallgg:'https://offerwall.gg/wall/4c826098db679c99583194371d0eae1b?userId='+uid,
  adswed:'https://adswedmedia.com/offer/'+${JSON.stringify(ADSWED_PUBLIC_KEY)}+'/'+uid,
  gaintwall:'https://gaintwall.com/offerwall?apiKey='+encodeURIComponent('Rot6cG2croe92zTp1dsVwkeJTHnKfJza')+'&userId='+uid
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
