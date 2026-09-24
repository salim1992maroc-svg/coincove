const APP_NAME = "Coin Cove";
const POINTS_NAME = "Coins";
const AD_REWARD_COINS = 10;
const DAILY_AD_LIMIT = 10;
const AD_COOLDOWN_SECONDS = 30;
const MINI_APP_SHORT_NAME = "myapp";
const WITHDRAW_MIN_COINS = 200;
const COINS_PER_USD = 2000;

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname === "/api/health") return json({success:true,app:APP_NAME,database:!!env.DB,botConfigured:!!env.BOT_TOKEN,offerwallConfigured:!!env.OFFERWALL_SECRET,time:Date.now()});
      if (url.pathname === "/api/me") return apiMe(request, env);
      if (url.pathname === "/api/referral") return apiReferral(request, env);
      if (url.pathname === "/api/reward-ad") return rewardAd(request, env);
      if (url.pathname === "/api/offerwall/postback") return offerwallPostback(request, env);
      if (url.pathname === "/api/offerwall/cpidroid/postback") return cpidroidPostback(request, env);
      if (url.pathname === "/api/offerwall/notik/postback") return notikPostback(request, env);
      if (url.pathname === "/api/offerwall/admantum/postback") return admantumPostback(request, env);
      async function cpidroidPostback(request, env) {
  if (request.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  return processProviderPostback(request, env, "cpidroid", {
    userParam: "user_id",
    transactionParam: "txn_id",
    amountParam: "payout_vc",
    offerIdParam: "offer_id",
    offerNameParam: "offer_name",
    payoutUsdParam: "payout_usd"
  });
}

async function notikPostback(request, env) {
  if (request.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  const q = new URL(request.url).searchParams;

  /*
   * Notik automatically supplies its normal postback parameters.
   * We accept the normal names first and a few common aliases so the
   * endpoint remains compatible if the Notik dashboard uses a different
   * generated name.
   */
  const userId =
    (q.get("user_id") ||
     q.get("userid") ||
     q.get("uid") ||
     "").trim();

  const transactionId =
    (q.get("txn_id") ||
     q.get("transaction_id") ||
     q.get("trans_id") ||
     q.get("txid") ||
     "").trim();

  const rawAmount =
    q.get("virtual_currency") ??
    q.get("payout_vc") ??
    q.get("amount") ??
    q.get("reward") ??
    q.get("coins");

  if (!userId || !transactionId || rawAmount === null) {
    return new Response("bad request", { status: 400 });
  }

  return processProviderPostback(request, env, "notik", {
    suppliedUserId: userId,
    suppliedTransactionId: transactionId,
    suppliedAmount: rawAmount,
    userParam: "user_id",
    transactionParam: "txn_id",
    amountParam: "virtual_currency",
    offerIdParam: "offer_id",
    offerNameParam: "offer_name",
    payoutUsdParam: "payout_usd"
  });
}

async function admantumPostback(request, env) {
  if (request.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  return processProviderPostback(request, env, "admantum", {
    userParam: "userid",
    transactionParam: "trans_id",
    amountParam: "amount",
    offerIdParam: "trans_id",
    offerNameParam: "placement",
    payoutUsdParam: "payout_usd"
  });
}

async function processProviderPostback(request, env, provider, config) {
  if (!env.DB || !env.OFFERWALL_SECRET) {
    return new Response("server configuration error", { status: 500 });
  }

  await ensureSchema(env);

  const q = new URL(request.url).searchParams;

  /*
   * Every provider receives the same private Coin Cove secret.
   * The provider callback URL must contain:
   *
   * ?secret=YOUR_OFFERWALL_SECRET
   */
  const receivedSecret = (q.get("secret") || "").trim();

  if (!receivedSecret) {
    return new Response("missing secret", { status: 403 });
  }

  if (!constantTimeEqual(receivedSecret, String(env.OFFERWALL_SECRET))) {
    return new Response("invalid secret", { status: 403 });
  }

  const userId = String(
    config.suppliedUserId ??
    q.get(config.userParam) ??
    ""
  ).trim();

  const transactionId = String(
    config.suppliedTransactionId ??
    q.get(config.transactionParam) ??
    ""
  ).trim();

  const rawAmount =
    config.suppliedAmount ??
    q.get(config.amountParam);

  if (!userId || !transactionId || rawAmount === null || rawAmount === undefined) {
    return new Response("bad request", { status: 400 });
  }

  /*
   * The canonical Coin Cove UID is users.id.
   * This intentionally does NOT use Telegram ID or email address.
   */
  const user = await dbUserByDatabaseId(env.DB, userId);

  if (!user) {
    return new Response("unknown user", { status: 404 });
  }

  let amount = Number(rawAmount);

  if (!Number.isFinite(amount)) {
    return new Response("invalid amount", { status: 400 });
  }

  /*
   * Coins are integers in the existing Coin Cove wallet.
   * Provider virtual-currency amounts therefore have to resolve
   * to a whole number before entering the wallet.
   */
  amount = Math.trunc(amount);

  if (amount === 0) {
    return new Response("ok", { status: 200 });
  }

  const providerTransactionId = provider + ":" + transactionId;

  const now = Math.floor(Date.now() / 1000);

  const offerId =
    q.get(config.offerIdParam || "") ||
    q.get("offer_id") ||
    null;

  const offerName =
    q.get(config.offerNameParam || "") ||
    q.get("offer_name") ||
    q.get("of_name") ||
    null;

  const payoutUsdRaw =
    q.get(config.payoutUsdParam || "") ||
    q.get("payout_usd") ||
    q.get("payoutUsd") ||
    "0";

  const payoutUsd = Number(payoutUsdRaw);

  const safePayoutUsd =
    Number.isFinite(payoutUsd) && payoutUsd >= 0
      ? payoutUsd
      : 0;

  /*
   * Negative provider amounts are treated as reversals.
   * Positive amounts are credits.
   */
  if (amount > 0) {
    try {
      await env.DB.batch([
        env.DB.prepare(`
          INSERT INTO offerwall_conversions
          (
            transaction_id,
            user_id,
            amount,
            status,
            offer_id,
            offer_name,
            goal_id,
            payout_usd,
            test,
            created_at
          )
          VALUES(?,?,?,?,?,?,?,?,?,?)
        `).bind(
          providerTransactionId,
          user.id,
          amount,
          "credited",
          offerId,
          offerName,
          null,
          safePayoutUsd,
          0,
          now
        ),

        env.DB.prepare(`
          UPDATE wallets
          SET
            balance = balance + ?,
            lifetime_earned = lifetime_earned + ?,
            updated_at = ?
          WHERE user_id = ?
        `).bind(
          amount,
          amount,
          now,
          user.id
        ),

        env.DB.prepare(`
          INSERT INTO transactions
          (
            user_id,
            type,
            amount,
            description,
            created_at
          )
          VALUES(?,?,?,?,?)
        `).bind(
          user.id,
          provider + "_offer_reward",
          amount,
          provider.toUpperCase() + " offer reward",
          now
        )
      ]);
    } catch (e) {
      const message = String(e?.message || e).toLowerCase();

      /*
       * Duplicate transaction means the provider retried the same
       * conversion. It must NOT credit the user twice.
       */
      if (
        message.includes("unique") ||
        message.includes("constraint")
      ) {
        return new Response("ok", { status: 200 });
      }

      console.error(provider + " credit error:", e);
      return new Response("server error", { status: 500 });
    }

    return new Response("ok", { status: 200 });
  }

  /*
   * Reversal.
   */
  const original = await env.DB
    .prepare(`
      SELECT amount,status
      FROM offerwall_conversions
      WHERE transaction_id=?
      LIMIT 1
    `)
    .bind(providerTransactionId)
    .first();

  if (!original) {
    return new Response("ok", { status: 200 });
  }

  if (String(original.status).toLowerCase() === "reversed") {
    return new Response("ok", { status: 200 });
  }

  const reversal = -Math.abs(Number(original.amount));

  try {
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE offerwall_conversions
        SET status=?
        WHERE transaction_id=?
      `).bind(
        "reversed",
        providerTransactionId
      ),

      env.DB.prepare(`
        UPDATE wallets
        SET
          balance = MAX(0, balance + ?),
          updated_at = ?
        WHERE user_id = ?
      `).bind(
        reversal,
        now,
        user.id
      ),

      env.DB.prepare(`
        INSERT INTO transactions
        (
          user_id,
          type,
          amount,
          description,
          created_at
        )
        VALUES(?,?,?,?,?)
      `).bind(
        user.id,
        provider + "_offer_reversal",
        reversal,
        provider.toUpperCase() + " offer reversal",
        now
      )
    ]);
  } catch (e) {
    console.error(provider + " reversal error:", e);
    return new Response("server error", { status: 500 });
  }

  return new Response("ok", { status: 200 });
}

async function dbUserByDatabaseId(db, id) {
  const numericId = Number(id);

  if (!Number.isInteger(numericId) || numericId <= 0) {
    return null;
  }

  return db
    .prepare("SELECT * FROM users WHERE id=? LIMIT 1")
    .bind(numericId)
    .first();
}
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
      if (url.pathname === "/admin") return new Response(renderAdmin(), {headers:{"content-type":"text/html;charset=UTF-8","cache-control":"no-store"}});
      return new Response(renderApp(), {headers:{"content-type":"text/html;charset=UTF-8","cache-control":"no-store"}});
    } catch (e) { console.error("Worker error",e); return json({success:false,message:"Internal server error."},500); }
  }
};

async function initSchema(db){
  // The original Coin Cove database already contains the core tables.
  // Never rebuild or replace those tables. Create only missing auxiliary
  // tables, and add the optional email column when necessary.
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

  // Run statements individually. One harmless schema mismatch must not make
  // the entire Telegram /api/me request fail with HTTP 500.
  for (const sql of stmts) {
    try {
      await db.prepare(sql).run();
    } catch (e) {
      const m = String(e?.message || e).toLowerCase();
      if (!m.includes('already exists') && !m.includes('duplicate column')) {
        console.error('Schema statement failed:', sql.slice(0,120), e);
      }
    }
  }

  // Existing deployments created before email support will not have this
  // column. Adding it is safe; duplicate-column is intentionally ignored.
  try {
    await db.prepare("ALTER TABLE users ADD COLUMN email TEXT").run();
  } catch (e) {
    const m = String(e?.message || e).toLowerCase();
    if (!m.includes('duplicate column') && !m.includes('already exists')) {
      console.error('users.email migration:', e);
    }
  }

  // Migrate the existing withdrawals table without replacing it. Older Coin Cove
  // deployments may have a different withdrawal schema (for example amount
  // instead of coins). SQLite CREATE TABLE IF NOT EXISTS does not alter an
  // existing table, so the new withdrawal API must add only missing columns.
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

  // Do not create a partial index here. Email uniqueness is enforced by
  // email_credentials and by the explicit duplicate check in registration.
}

async function ensureColumns(db, table, definitions) {
  const info = await db.prepare("PRAGMA table_info(" + table + ")").all();
  const existing = new Set((info.results || []).map(function (row) { return String(row.name); }));

  for (const [name, definition] of Object.entries(definitions)) {
    if (existing.has(name)) continue;
    try {
      await db.prepare("ALTER TABLE " + table + " ADD COLUMN " + name + " " + definition).run();
    } catch (e) {
      const m = String(e?.message || e).toLowerCase();
      if (!m.includes("duplicate column") && !m.includes("already exists")) {
        console.error("Column migration failed:", table, name, e);
      }
    }
  }
}

async function ensureSchema(env){ if(!env.DB) throw new Error("DB binding missing"); await initSchema(env.DB); }

async function apiMe(request,env){
  try {
    if(request.method!=="GET") return json({success:false,message:"Method not allowed."},405);
    if(!env.DB||!env.BOT_TOKEN) return json({success:false,message:"Server configuration is incomplete."},500);

    // Keep Telegram authentication independent from the optional email/admin
    // features. Schema preparation is deliberately non-fatal for old D1 data.
    await ensureSchema(env);

    const initData=getInitData(request);
    if(!initData) return json({success:false,code:"MISSING_INIT_DATA",message:"Telegram authorization data is missing."},401);

    const td=await validateTelegramInitData(initData,env.BOT_TOKEN);
    if(!td) return json({success:false,code:"INVALID_INIT_DATA",message:"Invalid Telegram authorization."},401);

    const user=await getOrCreateTelegramUser(env.DB,td);
    return userPayload(env.DB,user.id,{auth:"telegram"});
  } catch (e) {
    console.error("apiMe error:", e);
    return json({success:false,code:"API_ME_ERROR",message:"Unable to load your Coin Cove account right now."},500);
  }
}

async function getOrCreateTelegramUser(db,td){
  const u=td.user, now=Math.floor(Date.now()/1000), tid=String(u.id);
  let row=await db.prepare("SELECT * FROM users WHERE telegram_id=? LIMIT 1").bind(tid).first();
  if(!row){
    let referredBy=null;
    if(td.start_param){const r=await db.prepare("SELECT telegram_id FROM users WHERE referral_code=? LIMIT 1").bind(td.start_param).first(); if(r&&String(r.telegram_id)!==tid) referredBy=String(r.telegram_id);}
    await db.prepare(`INSERT INTO users(telegram_id,username,first_name,last_name,referral_code,referred_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`).bind(tid,u.username||null,u.first_name||"",u.last_name||null,generateReferralCode(),referredBy,now,now).run();
    row=await db.prepare("SELECT * FROM users WHERE telegram_id=? LIMIT 1").bind(tid).first();
    await db.prepare("INSERT OR IGNORE INTO wallets(user_id,balance,lifetime_earned,lifetime_withdrawn,updated_at) VALUES(?,0,0,0,?)").bind(row.id,now).run();
    if(referredBy){const r=await db.prepare("SELECT id FROM users WHERE telegram_id=? LIMIT 1").bind(referredBy).first(); if(r) await db.prepare("INSERT OR IGNORE INTO referrals(referrer_id,referred_user_id,reward,created_at) VALUES(?,?,0,?)").bind(r.id,row.id,now).run();}
  }
  await db.prepare("UPDATE users SET username=?,first_name=?,last_name=?,updated_at=? WHERE id=?").bind(u.username||null,u.first_name||"",u.last_name||null,now,row.id).run();
  return db.prepare("SELECT * FROM users WHERE id=?").bind(row.id).first();
}

async function userPayload(db,userId,extra={}){
  const w=await db.prepare("SELECT balance,lifetime_earned,lifetime_withdrawn FROM wallets WHERE user_id=?").bind(userId).first();
  const tx=await db.prepare("SELECT type,amount,description,created_at FROM transactions WHERE user_id=? ORDER BY id DESC LIMIT 10").bind(userId).all();
  const rc=await db.prepare("SELECT COUNT(*) count FROM referrals WHERE referrer_id=?").bind(userId).first();
  const withdrawals=await db.prepare("SELECT id,method,coins,usd_cents,status,created_at,updated_at FROM withdrawals WHERE user_id=? ORDER BY id DESC LIMIT 10").bind(userId).all();
  const user=await db.prepare("SELECT id,telegram_id,username,first_name,last_name,referral_code,email FROM users WHERE id=?").bind(userId).first();
  return json({success:true,user, wallet:w||{balance:0,lifetime_earned:0,lifetime_withdrawn:0},referrals:{count:Number(rc?.count||0)},transactions:tx.results||[],withdrawals:withdrawals.results||[],...extra});
}

async function apiReferral(request,env){
  if(request.method!=="GET") return json({success:false,message:"Method not allowed."},405);
  if(!env.DB||!env.BOT_TOKEN) return json({success:false,message:"Server configuration is incomplete."},500); await ensureSchema(env);
  const td=await validateTelegramInitData(getInitData(request),env.BOT_TOKEN); if(!td) return json({success:false,message:"Invalid Telegram authorization."},401);
  const u=await dbUserByTelegram(env.DB,String(td.user.id)); if(!u) return json({success:false,message:"User account is not ready yet."},404);
  let bot=""; try{const r=await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/getMe`);const d=await r.json();bot=d?.result?.username||"";}catch{}
  if(!bot) return json({success:false,message:"Unable to determine the Telegram bot username."},502);
  const link=`https://t.me/${bot}/${encodeURIComponent(String(env.MINI_APP_SHORT_NAME||MINI_APP_SHORT_NAME))}?startapp=${encodeURIComponent(u.referral_code)}`;
  const c=await env.DB.prepare("SELECT COUNT(*) count FROM referrals WHERE referrer_id=?").bind(u.id).first(); return json({success:true,code:u.referral_code,link,count:Number(c?.count||0)});
}

async function rewardAd(request,env){
  if(request.method!=="POST") return json({success:false,message:"Method not allowed."},405); if(!env.DB||!env.BOT_TOKEN) return json({success:false,message:"Server configuration is incomplete."},500); await ensureSchema(env);
  let b;try{b=await request.json();}catch{return json({success:false,message:"Invalid request body."},400)}
  const td=await validateTelegramInitData(String(b?.initData||""),env.BOT_TOKEN); if(!td) return json({success:false,code:"INVALID_INIT_DATA",message:"Invalid Telegram authorization."},401);
  const u=await dbUserByTelegram(env.DB,String(td.user.id)); if(!u) return json({success:false,message:"User account was not found."},404);
  return json({success:true,rewarded:0,pending:true,message:"Ad completed. Waiting for Monetag server confirmation."});
}

async function monetagPostback(request,env){
  if(request.method!=="GET") return new Response("Method not allowed",{status:405}); if(!env.DB) return new Response("database configuration error",{status:500}); await ensureSchema(env);
  const q=new URL(request.url).searchParams, ymid=(q.get("ymid")||"").trim(), event=(q.get("event")||q.get("event_type")||"").trim().toLowerCase(), rev=(q.get("reward_event_type")||"").trim().toLowerCase(), zone=(q.get("zone_id")||"").trim(), tid=(q.get("telegram_id")||ymid).trim();
  if(!ymid||!zone||!tid) return new Response("bad request",{status:400}); if(zone!=="11766606") return new Response("invalid zone",{status:403});
  const accepted=new Set(["impression","view","viewed","reward","rewarded"]); const revs=new Set(["reward","rewarded","impression","view","viewed"]); if(!(accepted.has(event)||revs.has(rev))||rev!=="valued") return new Response("ignored",{status:200});
  const u=await dbUserByTelegram(env.DB,tid); if(!u) return new Response("unknown user",{status:404});
  const key=await sha256Hex(Array.from(q.entries()).sort((a,b)=>a[0]===b[0]?a[1].localeCompare(b[1]):a[0].localeCompare(b[0])).map(x=>x[0]+"="+x[1]).join("&"));
  if(await env.DB.prepare("SELECT id FROM monetag_postbacks WHERE event_key=?").bind(key).first()) return new Response("ok",{status:200});
  const now=Math.floor(Date.now()/1000),today=new Date().toISOString().slice(0,10); const daily=await env.DB.prepare("SELECT COUNT(*) count FROM monetag_postbacks WHERE telegram_id=? AND reward_date=?").bind(tid,today).first(); if(Number(daily?.count||0)>=DAILY_AD_LIMIT)return new Response("daily limit reached",{status:200});
  const last=await env.DB.prepare("SELECT created_at FROM monetag_postbacks WHERE telegram_id=? ORDER BY id DESC LIMIT 1").bind(tid).first(); if(last&&now-Number(last.created_at)<AD_COOLDOWN_SECONDS)return new Response("cooldown",{status:200});
  const price=q.get("estimated_price"); const ep=price==null||price===""?null:Number(price); if(ep!==null&&(!Number.isFinite(ep)||ep<0))return new Response("invalid estimated_price",{status:400});
  try{await env.DB.batch([
    env.DB.prepare(`INSERT INTO monetag_postbacks(event_key,ymid,telegram_id,user_id,event_type,reward_event_type,zone_id,estimated_price,reward_date,rewarded,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(key,ymid,tid,u.id,event||null,rev||null,zone,ep,today,AD_REWARD_COINS,now),
    env.DB.prepare("UPDATE wallets SET balance=balance+?,lifetime_earned=lifetime_earned+?,updated_at=? WHERE user_id=?").bind(AD_REWARD_COINS,AD_REWARD_COINS,now,u.id),
    env.DB.prepare("INSERT INTO transactions(user_id,type,amount,description,created_at) VALUES(?,?,?,?,?)").bind(u.id,"monetag_ad_reward",AD_REWARD_COINS,"Monetag rewarded ad",now)
  ]);}catch(e){if(String(e?.message).toLowerCase().includes("unique")||String(e?.message).toLowerCase().includes("constraint"))return new Response("ok",{status:200});console.error(e);return new Response("server error",{status:500});}
  return new Response("ok",{status:200});
}

async function offerwallPostback(request,env){
  if(request.method!=="GET")return new Response("Method not allowed",{status:405}); if(!env.DB||!env.OFFERWALL_SECRET)return new Response("server configuration error",{status:500}); await ensureSchema(env);
  const q=new URL(request.url).searchParams,userId=(q.get("user")||"").trim(),tx=(q.get("tx")||"").trim(),raw=q.get("amount"),sig=(q.get("sig")||"").trim(),status=(q.get("status")||"").trim().toLowerCase(),test=q.get("test")||"0";
  if(!userId||!tx||raw===null||!sig)return new Response("bad request",{status:400}); const expected=await hmacHexText(env.OFFERWALL_SECRET,`${userId}:${tx}:${raw}`); if(!constantTimeEqual(expected,sig))return new Response("invalid signature",{status:403}); if(test==="1")return new Response("ok",{status:200}); if(status!=="credited"&&status!=="reversed")return new Response("ok",{status:200});
  const amount=Number(raw); if(!Number.isFinite(amount)||!Number.isInteger(amount)||amount===0)return new Response("ok",{status:200}); const u=await dbUserByAnyId(env.DB,userId); if(!u)return new Response("unknown user",{status:404});
  const now=Math.floor(Date.now()/1000);
  try{
    if(status==="credited"){
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO offerwall_conversions(transaction_id,user_id,amount,status,offer_id,offer_name,goal_id,payout_usd,test,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(tx,u.id,amount,status,q.get("offerId"),q.get("offerName"),q.get("goalId"),Number(q.get("payoutUsd")||0),0,now),
        env.DB.prepare("UPDATE wallets SET balance=balance+?,lifetime_earned=lifetime_earned+?,updated_at=? WHERE user_id=?").bind(amount,amount,now,u.id),
        env.DB.prepare("INSERT INTO transactions(user_id,type,amount,description,created_at) VALUES(?,?,?,?,?)").bind(u.id,"offer_reward",amount,"Offer reward",now)
      ]);
    } else {
      const original=await env.DB.prepare("SELECT amount FROM offerwall_conversions WHERE transaction_id=? LIMIT 1").bind(tx).first();
      if(!original)return new Response("ok",{status:200});
      const reversal=-Math.abs(Number(original.amount));
      await env.DB.batch([
        env.DB.prepare("UPDATE offerwall_conversions SET status=? WHERE transaction_id=?").bind("reversed",tx),
        env.DB.prepare("UPDATE wallets SET balance=MAX(0,balance+?),updated_at=? WHERE user_id=?").bind(reversal,now,u.id),
        env.DB.prepare("INSERT INTO transactions(user_id,type,amount,description,created_at) VALUES(?,?,?,?,?)").bind(u.id,"offer_reversal",reversal,"Offer reversed",now)
      ]);
    }
  }catch(e){if(String(e?.message).toLowerCase().includes("unique")||String(e?.message).toLowerCase().includes("constraint"))return new Response("ok",{status:200});console.error(e);return new Response("server error",{status:500});}
  return new Response("ok",{status:200});
}

async function emailRegister(request,env){
  if(request.method!=="POST")return json({success:false,message:"Method not allowed."},405); await ensureSchema(env); let b;try{b=await request.json()}catch{return json({success:false,message:"Invalid request body."},400)}
  const email=normalizeEmail(b?.email),p=String(b?.password||""),c=String(b?.confirmPassword||""); if(!validEmail(email))return json({success:false,message:"Enter a valid email."},400); if(p.length<8)return json({success:false,message:"Password must be at least 8 characters."},400); if(p!==c)return json({success:false,message:"Passwords do not match."},400);
  if(await env.DB.prepare("SELECT user_id FROM email_credentials WHERE email=?").bind(email).first())return json({success:false,message:"Email is already registered."},409);
  const now=Math.floor(Date.now()/1000),hash=await hashPassword(p);
  // Some existing Coin Cove databases have telegram_id as NOT NULL.
  // Email-only accounts therefore receive a private synthetic identity that
  // can never collide with a real Telegram numeric ID.
  const syntheticTelegramId = "email:" + crypto.randomUUID();
  let user;
  try {
    await env.DB.prepare("INSERT INTO users(telegram_id,email,first_name,referral_code,created_at,updated_at) VALUES(?,?,?,?,?,?)")
      .bind(syntheticTelegramId,email,"",generateReferralCode(),now,now).run();
    user=await env.DB.prepare("SELECT * FROM users WHERE email=? LIMIT 1").bind(email).first();
    if(!user) throw new Error("Email account was not created.");
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO wallets(user_id,balance,lifetime_earned,lifetime_withdrawn,updated_at) VALUES(?,0,0,0,?)").bind(user.id,now),
      env.DB.prepare("INSERT INTO email_credentials(user_id,email,password_hash,password_salt,created_at,updated_at) VALUES(?,?,?,?,?,?)").bind(user.id,email,hash.hash,hash.salt,now,now)
    ]);
  } catch(e) {
    console.error("Email registration error:",e);
    const msg=String(e?.message||e).toLowerCase();
    if(msg.includes("unique")||msg.includes("constraint")) return json({success:false,message:"This email is already registered."},409);
    return json({success:false,message:"Unable to create the account. Please try again."},500);
  }
  const token=await createSession(env.DB,user.id); return userPayload(env.DB,user.id,{auth:"email",sessionCreated:true,token});
}

async function emailLogin(request,env){
  if(request.method!=="POST")return json({success:false,message:"Method not allowed."},405); await ensureSchema(env); let b;try{b=await request.json()}catch{return json({success:false,message:"Invalid request body."},400)} const email=normalizeEmail(b?.email),p=String(b?.password||""); const row=await env.DB.prepare("SELECT * FROM email_credentials WHERE email=? LIMIT 1").bind(email).first(); if(!row)return json({success:false,message:"Invalid email or password."},401); if(!(await verifyPassword(p,row.password_hash,row.password_salt)))return json({success:false,message:"Invalid email or password."},401); const token=await createSession(env.DB,row.user_id); return userPayload(env.DB,row.user_id,{auth:"email",sessionCreated:true,token});
}
async function emailLogout(request,env){if(request.method!=="POST")return json({success:false,message:"Method not allowed."},405);await ensureSchema(env);const token=getBearer(request);if(token)await env.DB.prepare("DELETE FROM email_sessions WHERE token_hash=?").bind(await sha256Hex(token)).run();return json({success:true});}
async function emailSessionMe(request,env){if(request.method!=="GET")return json({success:false,message:"Method not allowed."},405);await ensureSchema(env);const uid=await emailSessionUser(env.DB,request);if(!uid)return json({success:false,message:"Not authenticated."},401);return userPayload(env.DB,uid,{auth:"email"});}

async function createWithdrawal(request,env){
  if(request.method!=="POST")return json({success:false,message:"Method not allowed."},405); await ensureSchema(env); const identity=await resolveUserAuth(request,env); if(!identity)return json({success:false,message:"Please log in."},401); let b;try{b=await request.json()}catch{return json({success:false,message:"Invalid request body."},400)}
  const method=String(b?.method||"").trim().toUpperCase(), destination=String(b?.destination||"").trim(), coins=Number(b?.coins); if(!["USDT_TRC20","BINANCE_ID"].includes(method))return json({success:false,message:"Invalid withdrawal method."},400); if(!destination)return json({success:false,message:"Destination is required."},400); if(!Number.isInteger(coins)||coins<WITHDRAW_MIN_COINS||coins%1!==0)return json({success:false,message:"Minimum withdrawal is 200 Coins ($0.10)."},400); if(coins%200!==0)return json({success:false,message:"Withdrawal amount must be a whole 0.10 USD step (200 Coins)."},400);
  const now=Math.floor(Date.now()/1000),usdCents=Math.floor(coins*100/COINS_PER_USD); if(usdCents<10)return json({success:false,message:"Minimum withdrawal is $0.10."},400);
  let debit; try { debit = await env.DB.prepare("UPDATE wallets SET balance=balance-?,lifetime_withdrawn=lifetime_withdrawn+?,updated_at=? WHERE user_id=? AND balance>=?").bind(coins,coins,now,identity.userId,coins).run(); } catch(e) { console.error(e); return json({success:false,message:"Unable to create withdrawal."},500); }
  if (Number(debit?.meta?.changes||0) !== 1) return json({success:false,message:"Insufficient Coins."},400);
  try {
    await env.DB.prepare("INSERT INTO withdrawals(user_id,method,destination,coins,usd_cents,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").bind(identity.userId,method,destination,coins,usdCents,"pending",now,now).run();
  } catch(e) {
    console.error(e);
    await env.DB.prepare("UPDATE wallets SET balance=balance+?,lifetime_withdrawn=MAX(0,lifetime_withdrawn-?),updated_at=? WHERE user_id=?").bind(coins,coins,now,identity.userId).run();
    return json({success:false,message:"Unable to create withdrawal. Your Coins were restored."},500);
  }
  const w=await env.DB.prepare("SELECT id,status FROM withdrawals WHERE user_id=? ORDER BY id DESC LIMIT 1").bind(identity.userId).first(); return json({success:true,withdrawal:w});
}

async function resolveUserAuth(request,env){const init=getInitData(request);if(init&&env.BOT_TOKEN){const td=await validateTelegramInitData(init,env.BOT_TOKEN);if(td){const u=await dbUserByTelegram(env.DB,String(td.user.id));if(u)return {userId:u.id,auth:"telegram"};}}const uid=await emailSessionUser(env.DB,request);return uid?{userId:uid,auth:"email"}:null;}

async function adminLogin(request,env){if(request.method!=="POST")return json({success:false,message:"Method not allowed."},405);await ensureSchema(env);let b;try{b=await request.json()}catch{return json({success:false,message:"Invalid request body."},400)}const username=String(b?.username||"").trim();const p=String(b?.password||"");if(!username||!p)return json({success:false,message:"Username and password are required."},400);let a=await env.DB.prepare("SELECT * FROM admin_users WHERE username=?").bind(username).first();if(!a){if(env.ADMIN_USERNAME&&env.ADMIN_PASSWORD&&username===env.ADMIN_USERNAME&&p===env.ADMIN_PASSWORD){const h=await hashPassword(p);const now=Math.floor(Date.now()/1000);await env.DB.prepare("INSERT OR IGNORE INTO admin_users(username,password_hash,password_salt,created_at) VALUES(?,?,?,?)").bind(username,h.hash,h.salt,now).run();a=await env.DB.prepare("SELECT * FROM admin_users WHERE username=?").bind(username).first();}else return json({success:false,message:"Invalid admin credentials."},401);}if(!(await verifyPassword(p,a.password_hash,a.password_salt)))return json({success:false,message:"Invalid admin credentials."},401);const token=await createAdminSession(env.DB,a.id);return json({success:true,token});}
async function adminLogout(request,env){if(request.method!=="POST")return json({success:false,message:"Method not allowed."},405);await ensureSchema(env);const t=getBearer(request);if(t)await env.DB.prepare("DELETE FROM admin_sessions WHERE token_hash=?").bind(await sha256Hex(t)).run();return json({success:true});}
async function adminMe(request,env){if(request.method!=="GET")return json({success:false,message:"Method not allowed."},405);await ensureSchema(env);const a=await adminSession(env.DB,request);if(!a)return json({success:false,message:"Not authenticated."},401);return json({success:true,username:a.username});}
async function adminUsers(request,env){if(request.method!=="GET")return json({success:false,message:"Method not allowed."},405);await ensureSchema(env);if(!(await adminSession(env.DB,request)))return json({success:false,message:"Not authenticated."},401);const r=await env.DB.prepare(`SELECT u.id,u.telegram_id,u.email,u.username,u.first_name,w.balance,w.lifetime_earned,w.lifetime_withdrawn FROM users u LEFT JOIN wallets w ON w.user_id=u.id ORDER BY u.id DESC LIMIT 200`).all();return json({success:true,users:r.results||[]});}
async function adminWithdrawals(request,env){if(request.method!=="GET")return json({success:false,message:"Method not allowed."},405);await ensureSchema(env);if(!(await adminSession(env.DB,request)))return json({success:false,message:"Not authenticated."},401);const r=await env.DB.prepare(`SELECT w.*,u.email,u.telegram_id,u.username FROM withdrawals w JOIN users u ON u.id=w.user_id ORDER BY w.id DESC LIMIT 200`).all();return json({success:true,withdrawals:r.results||[]});}
async function adminWithdrawalAction(request,env){if(request.method!=="POST")return json({success:false,message:"Method not allowed."},405);await ensureSchema(env);if(!(await adminSession(env.DB,request)))return json({success:false,message:"Not authenticated."},401);let b;try{b=await request.json()}catch{return json({success:false,message:"Invalid request body."},400)}const id=Number(b?.id),action=String(b?.action||"").toLowerCase(),note=String(b?.note||"");if(!Number.isInteger(id)||!['approve','reject'].includes(action))return json({success:false,message:"Invalid action."},400);const w=await env.DB.prepare("SELECT * FROM withdrawals WHERE id=?").bind(id).first();if(!w||w.status!=="pending")return json({success:false,message:"Withdrawal is not pending."},409);const now=Math.floor(Date.now()/1000);if(action==='approve'){await env.DB.prepare("UPDATE withdrawals SET status='approved',admin_note=?,updated_at=? WHERE id=? AND status='pending'").bind(note,now,id).run();}else{await env.DB.batch([env.DB.prepare("UPDATE withdrawals SET status='rejected',admin_note=?,updated_at=? WHERE id=? AND status='pending'").bind(note,now,id),env.DB.prepare("UPDATE wallets SET balance=balance+?,lifetime_withdrawn=MAX(0,lifetime_withdrawn-?),updated_at=? WHERE user_id=?").bind(w.coins,w.coins,now,w.user_id),env.DB.prepare("INSERT INTO transactions(user_id,type,amount,description,created_at) VALUES(?,?,?,?,?)").bind(w.user_id,"withdrawal_refund",w.coins,"Rejected withdrawal refund",now)]);}return json({success:true});}

async function dbUserByTelegram(db,id){return db.prepare("SELECT * FROM users WHERE telegram_id=? LIMIT 1").bind(String(id)).first();}
async function dbUserByAnyId(db,id){return db.prepare("SELECT * FROM users WHERE telegram_id=? OR CAST(id AS TEXT)=? LIMIT 1").bind(String(id),String(id)).first();}
async function emailSessionUser(db,request){const t=getBearer(request);if(!t)return null;const h=await sha256Hex(t),r=await db.prepare(`SELECT user_id,expires_at FROM email_sessions WHERE token_hash=? LIMIT 1`).bind(h).first();if(!r)return null;if(Number(r.expires_at)<=Math.floor(Date.now()/1000)){await db.prepare("DELETE FROM email_sessions WHERE token_hash=?").bind(h).run();return null;}return Number(r.user_id);}
async function createSession(db,userId){const token=randomToken(),now=Math.floor(Date.now()/1000);await db.prepare("INSERT INTO email_sessions(user_id,token_hash,expires_at,created_at) VALUES(?,?,?,?)").bind(userId,await sha256Hex(token),now+2592000,now).run();return token;}
async function adminSession(db,request){const t=getBearer(request);if(!t)return null;const r=await db.prepare(`SELECT a.id,a.username,s.expires_at FROM admin_sessions s JOIN admin_users a ON a.id=s.admin_id WHERE s.token_hash=? LIMIT 1`).bind(await sha256Hex(t)).first();if(!r)return null;if(Number(r.expires_at)<=Math.floor(Date.now()/1000)){await db.prepare("DELETE FROM admin_sessions WHERE token_hash=?").bind(await sha256Hex(t)).run();return null;}return r;}
async function createAdminSession(db,id){const token=randomToken(),now=Math.floor(Date.now()/1000);await db.prepare("INSERT INTO admin_sessions(admin_id,token_hash,expires_at,created_at) VALUES(?,?,?,?)").bind(id,await sha256Hex(token),now+86400,now).run();return token;}
function getBearer(request){const a=request.headers.get("Authorization")||"";return a.toLowerCase().startsWith("bearer ")?a.slice(7).trim():"";}
function getInitData(request){const h=request.headers.get("X-Telegram-Init-Data");if(h?.trim())return h.trim();const a=request.headers.get("Authorization")||"";if(a.toLowerCase().startsWith("tma "))return a.slice(4).trim();const u=new URL(request.url);return (u.searchParams.get("initData")||u.searchParams.get("tgWebAppData")||"").trim();}
async function validateTelegramInitData(initData,botToken){if(!initData||!botToken)return null;try{const p=new URLSearchParams(initData),received=p.get("hash");if(!received)return null;p.delete("hash");const entries=Array.from(p.entries()).sort((a,b)=>a[0].localeCompare(b[0]));const check=entries.map(x=>`${x[0]}=${x[1]}`).join("\n");const secret=await hmacSha256(new TextEncoder().encode("WebAppData"),botToken);const calculated=await hmacSha256Hex(secret,check);if(!constantTimeEqual(calculated,received)){console.error("Telegram hash mismatch");return null;}const auth=Number(p.get("auth_date")),now=Math.floor(Date.now()/1000);if(!Number.isFinite(auth)||auth<=0||auth>now+300||now-auth>86400)return null;const raw=p.get("user");if(!raw)return null;const user=JSON.parse(raw);if(!user?.id)return null;return {user,start_param:p.get("start_param")||null};}catch(e){console.error("Telegram validation error",e);return null;}}
async function hmacSha256(keyBytes,message){const key=await crypto.subtle.importKey("raw",keyBytes,{name:"HMAC",hash:"SHA-256"},false,["sign"]);return crypto.subtle.sign("HMAC",key,new TextEncoder().encode(message));}
async function hmacSha256Hex(keyBytes,message){const s=await hmacSha256(keyBytes,message);return Array.from(new Uint8Array(s)).map(b=>b.toString(16).padStart(2,"0")).join("");}
async function hmacHexText(secret,message){return hmacSha256Hex(new TextEncoder().encode(secret),message);}
async function sha256Hex(message){const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(message));return Array.from(new Uint8Array(d)).map(b=>b.toString(16).padStart(2,"0")).join("");}
// Cloudflare Workers WebCrypto currently rejects PBKDF2 iteration counts above 100000.
// Keep registration and login on the same supported work factor.
async function hashPassword(password){const salt=randomBytes(16);const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(password),"PBKDF2",false,["deriveBits"]);const bits=await crypto.subtle.deriveBits({name:"PBKDF2",salt,iterations:100000,hash:"SHA-256"},key,256);return {hash:bytesToHex(new Uint8Array(bits)),salt:bytesToHex(salt)};}
async function verifyPassword(password,hash,saltHex){const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(password),"PBKDF2",false,["deriveBits"]);const salt=hexToBytes(saltHex),bits=await crypto.subtle.deriveBits({name:"PBKDF2",salt,iterations:100000,hash:"SHA-256"},key,256);return constantTimeEqual(bytesToHex(new Uint8Array(bits)),hash);}
function randomBytes(n){const a=new Uint8Array(n);crypto.getRandomValues(a);return a;}function bytesToHex(a){return Array.from(a).map(b=>b.toString(16).padStart(2,"0")).join("");}function hexToBytes(h){const a=new Uint8Array(h.length/2);for(let i=0;i<a.length;i++)a[i]=parseInt(h.slice(i*2,i*2+2),16);return a;}function randomToken(){return bytesToHex(randomBytes(32));}
function constantTimeEqual(a,b){if(typeof a!=="string"||typeof b!=="string"||a.length!==b.length)return false;let r=0;for(let i=0;i<a.length;i++)r|=a.charCodeAt(i)^b.charCodeAt(i);return r===0;}
function generateReferralCode(){return crypto.randomUUID().replace(/-/g,"").slice(0,12).toUpperCase();}function normalizeEmail(v){return String(v||"").trim().toLowerCase();}function validEmail(e){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json;charset=UTF-8","cache-control":"no-store"}});}

function renderApp(){return String.raw`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover"><meta name="theme-color" content="#0f172a"><title>Coin Cove</title><script src="https://telegram.org/js/telegram-web-app.js"></script><script src="https://libtl.com/sdk.js" data-zone="11766606" data-sdk="show_11766606"></script><style>
*{box-sizing:border-box}html,body{margin:0;min-height:100%;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;background:#f4f7fb;color:#101828}body{min-height:100vh}.app{width:100%;max-width:980px;margin:0 auto;padding:28px 22px calc(110px + env(safe-area-inset-bottom))}.topbar{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:20px}.brand{display:flex;align-items:center;gap:11px;font-size:24px;font-weight:850;letter-spacing:-.5px}.brand-icon{width:44px;height:44px;border-radius:14px;background:#111827;color:#fff;display:grid;place-items:center;font-size:23px;box-shadow:0 8px 22px #11182722}.pill{display:inline-flex;align-items:center;gap:6px;padding:8px 12px;border-radius:999px;background:#e8edf5;color:#475467;font-size:12px;font-weight:750}.hero{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(280px,.6fr);gap:18px;margin-bottom:18px}.balance{background:linear-gradient(135deg,#111827,#25324a);color:#fff;border-radius:28px;padding:28px;min-height:190px;display:flex;flex-direction:column;justify-content:space-between;box-shadow:0 18px 45px #10182820}.welcome{font-size:15px;opacity:.78}.balance-row{display:flex;align-items:end;justify-content:space-between;gap:18px}.num{font-size:54px;line-height:1;font-weight:900;letter-spacing:-2px}.coins-label{font-size:14px;opacity:.72;margin-top:7px}.account-card{background:#fff;border:1px solid #e7ebf2;border-radius:24px;padding:24px;box-shadow:0 10px 30px #1018280b;display:flex;flex-direction:column;justify-content:center}.account-card h3{margin:0 0 7px;font-size:18px}.account-card p{margin:0;color:#667085;font-size:14px;line-height:1.5}.section-title{font-size:18px;font-weight:850;margin:24px 0 12px}.actions{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}.action{border:1px solid #e4e9f1;background:#fff;border-radius:22px;padding:20px 15px;text-align:left;min-height:112px;cursor:pointer;box-shadow:0 8px 24px #1018280a;transition:.15s}.action:active{transform:scale(.98)}.action-icon{font-size:25px;margin-bottom:12px}.action strong{display:block;font-size:15px}.action span{display:block;color:#667085;font-size:12px;margin-top:5px}.card{background:#fff;border:1px solid #e7ebf2;border-radius:24px;padding:22px;margin-top:16px;box-shadow:0 10px 30px #1018280a}.card h3{margin:0 0 12px;font-size:18px}.activity{display:grid;gap:10px}.activity-item{display:flex;justify-content:space-between;gap:15px;padding:12px 0;border-bottom:1px solid #edf0f4;font-size:14px}.activity-item:last-child{border-bottom:0}.muted{color:#667085;font-size:13px}.positive{font-weight:800}.empty{padding:22px;text-align:center;color:#667085;background:#f8fafc;border-radius:16px}.nav{position:fixed;z-index:20;left:50%;bottom:14px;transform:translateX(-50%);width:min(760px,calc(100% - 24px));background:#111827;color:#fff;border-radius:22px;padding:9px;display:grid;grid-template-columns:repeat(4,1fr);gap:5px;box-shadow:0 16px 45px #10182835}.nav button{border:0;background:transparent;color:#d8dee9;border-radius:15px;padding:11px 6px;font-weight:750;font-size:12px;cursor:pointer}.nav button.active{background:#fff;color:#111827}.btn{width:100%;border:0;border-radius:14px;padding:14px 16px;font-weight:800;background:#111827;color:#fff;cursor:pointer}.btn.secondary{background:#eef2f7;color:#111827}.btn:disabled{opacity:.55;cursor:not-allowed}.input,.select{width:100%;padding:14px 15px;border:1px solid #d9dee8;border-radius:14px;margin:6px 0;background:#fff;font-size:15px;outline:none}.input:focus,.select:focus{border-color:#111827;box-shadow:0 0 0 3px #11182712}.modal{position:fixed;z-index:50;inset:0;background:#10182899;display:flex;align-items:flex-end;padding:12px}.sheet{background:#fff;border-radius:28px 28px 18px 18px;padding:24px;width:100%;max-width:720px;margin:auto;max-height:92vh;overflow:auto;box-shadow:0 -12px 40px #10182825}.sheet h2,.sheet h3{margin-top:0}.close-row{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px}.close{border:0;background:#eef2f7;border-radius:12px;padding:9px 12px;font-weight:800}.auth-page{min-height:calc(100vh - 56px);display:grid;place-items:center;padding:28px 0}.auth-wrap{width:100%;max-width:500px}.auth-logo{text-align:center;margin-bottom:18px}.auth-logo .brand{justify-content:center;font-size:30px}.auth-card{background:#fff;border:1px solid #e5e9f0;border-radius:30px;padding:30px;box-shadow:0 20px 60px #10182812}.auth-card h1{margin:0;font-size:28px;letter-spacing:-.7px}.auth-card .sub{color:#667085;line-height:1.55;margin:8px 0 22px}.tabs{display:grid;grid-template-columns:1fr 1fr;background:#f2f4f7;border-radius:14px;padding:4px;margin-bottom:18px}.tabs button{border:0;background:transparent;padding:11px;border-radius:11px;font-weight:800;color:#667085}.tabs button.active{background:#fff;color:#111827;box-shadow:0 2px 8px #10182812}.auth-note{font-size:12px;color:#667085;text-align:center;margin-top:15px;line-height:1.5}.status{min-height:22px;margin:9px 0;font-size:13px;color:#b42318}.status.ok{color:#067647}.divider{height:1px;background:#edf0f4;margin:20px 0}.email-line{display:flex;align-items:center;gap:8px;color:#667085;font-size:13px;word-break:break-word}.hidden{display:none!important}@media(max-width:760px){.app{padding:18px 14px calc(105px + env(safe-area-inset-bottom))}.hero{grid-template-columns:1fr}.balance{min-height:175px;padding:23px}.num{font-size:46px}.actions{grid-template-columns:1fr 1fr;gap:10px}.action{min-height:100px;padding:17px}.topbar{margin-bottom:14px}.brand{font-size:21px}.brand-icon{width:40px;height:40px}.account-card{padding:19px}.auth-page{padding:12px 0}.auth-card{padding:22px;border-radius:24px}.auth-card h1{font-size:25px}.nav{bottom:9px;width:calc(100% - 16px)}}
</style></head><body><div id="app" class="app">Loading Coin Cove...</div><script>(function(){const tg=window.Telegram&&window.Telegram.WebApp;let user=null;let authMode='';const $=id=>document.getElementById(id);if(tg){try{tg.ready();tg.expand();if(tg.setHeaderColor)tg.setHeaderColor('#f4f7fb');if(tg.setBackgroundColor)tg.setBackgroundColor('#f4f7fb')}catch(e){}}function init(){return tg&&tg.initData?tg.initData:''}function emailToken(){return localStorage.getItem('cc_email_token')||''}async function req(path,opt={}){const et=emailToken();opt.headers=Object.assign({},opt.headers||{},init()?{'X-Telegram-Init-Data':init()}:(!opt.headers?.Authorization&&et?{'Authorization':'Bearer '+et}:{}));const r=await fetch(path,opt);let d;try{d=await r.json()}catch(e){d={success:false,message:'Invalid server response ('+r.status+').'}}return d}async function load(){try{const ti=init(),et=emailToken();let d;if(ti){d=await req('/api/me');authMode='telegram'}else if(et){d=await req('/api/auth/me');authMode='email'}else{showAuth();return}if(!d.success){if(authMode==='email')localStorage.removeItem('cc_email_token');showAuth();return}user=d.user;render(d)}catch(e){console.error('load:',e);showError('Unable to connect. Please try again.')}}function header(email){return '<div class="topbar"><div class="brand"><div class="brand-icon">🪙</div><span>Coin Cove</span></div><div class="pill">'+(email?'✉️ Email account':'✈️ Telegram')+'</div></div>'}function render(d){const w=d.wallet||{},u=d.user||{};const name=u.first_name||u.username||'there';const email=u.email||'';const activity=(d.transactions||[]).slice(0,8).map(function(x){return '<div class="activity-item"><span>'+esc(x.description||x.type||'Activity')+'</span><span class="positive">'+esc(x.amount)+'</span></div>'}).join('')||'<div class="empty">No activity yet.</div>';$('app').innerHTML=header(authMode==='email')+'<div class="hero"><div class="balance"><div class="welcome">Welcome back, <b>'+esc(name)+'</b></div><div class="balance-row"><div><div class="num">'+Number(w.balance||0).toLocaleString()+'</div><div class="coins-label">Coins available</div></div><div style="font-size:38px">💰</div></div></div><div class="account-card"><h3>Your account</h3><p>'+ (email?'<span class="email-line">✉️ '+esc(email)+'</span>':'Connected securely through Telegram') +'</p></div></div><div class="section-title">Earn & manage</div><div class="actions"><button class="action" onclick="offers()"><div class="action-icon">🎁</div><strong>Offers</strong><span>Complete offers and earn</span></button><button class="action" onclick="ad()" '+(authMode==='email'?'disabled':'')+'><div class="action-icon">📺</div><strong>Watch & Earn</strong><span>'+(authMode==='email'?'Telegram only':'Watch ads for Coins')+'</span></button><button class="action" onclick="ref()"><div class="action-icon">👥</div><strong>Invite</strong><span>Share your referral</span></button><button class="action" onclick="withdraw()"><div class="action-icon">💸</div><strong>Withdraw</strong><span>USDT TRC20 / Binance ID</span></button></div><div class="card"><h3>Recent activity</h3><div class="activity">'+activity+'</div></div>'+(authMode==='email'?'<div class="card"><button class="btn secondary" onclick="emailLogout()">Log out of email account</button></div>':'')+'<div class="nav"><button class="active" onclick="load()">🏠<br>Home</button><button onclick="offers()">🎁<br>Offers</button><button onclick="ref()">👥<br>Invite</button><button onclick="withdraw()">💰<br>Wallet</button></div>'}function showAuth(){authMode='email';$('app').innerHTML='<div class="auth-page"><div class="auth-wrap"><div class="auth-logo"><div class="brand"><div class="brand-icon">🪙</div><span>Coin Cove</span></div></div><div class="auth-card"><h1>Welcome to Coin Cove</h1><p class="sub">Use Coin Cove independently from Telegram. Create an account or sign in with your email and password.</p><div class="tabs"><button id="tabLogin" class="active" onclick="switchAuth(\'login\')">Login</button><button id="tabRegister" onclick="switchAuth(\'register\')">Create account</button></div><div id="authFields"></div><div id="authStatus" class="status"></div><button id="authSubmit" class="btn" onclick="submitAuth()">Login</button><div class="auth-note">No email verification is required. Your password is stored as a secure hash.</div></div></div></div>';switchAuth('login')}function switchAuth(mode){window.authTab=mode;const login=mode==='login';$('tabLogin').classList.toggle('active',login);$('tabRegister').classList.toggle('active',!login);$('authFields').innerHTML='<input id="authEmail" class="input" type="email" autocomplete="email" placeholder="Email address">'+'<input id="authPassword" class="input" type="password" autocomplete="'+(login?'current-password':'new-password')+'" placeholder="Password">'+(login?'':'<input id="authConfirm" class="input" type="password" autocomplete="new-password" placeholder="Confirm password">');$('authSubmit').textContent=login?'Login':'Create account';$('authStatus').textContent='';$('authStatus').className='status'}async function submitAuth(){const email=String($('authEmail')?.value||'').trim().toLowerCase(),password=String($('authPassword')?.value||''),confirm=String($('authConfirm')?.value||'');const status=$('authStatus'),btn=$('authSubmit');status.className='status';status.textContent='';if(!email||!email.includes('@')){status.textContent='Enter a valid email address.';return}if(password.length<8){status.textContent='Password must be at least 8 characters.';return}if(window.authTab==='register'&&password!==confirm){status.textContent='Passwords do not match.';return}btn.disabled=true;btn.textContent=window.authTab==='login'?'Signing in...':'Creating account...';try{const path=window.authTab==='login'?'/api/auth/login':'/api/auth/register';const body={email:email,password:password};if(window.authTab==='register')body.confirmPassword=confirm;const d=await req(path,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(body)});if(d.success&&d.token){localStorage.setItem('cc_email_token',d.token);status.className='status ok';status.textContent=window.authTab==='login'?'Login successful.':'Account created successfully.';user=d.user;authMode='email';setTimeout(function(){load()},180);return}status.textContent=d.message||'Authentication failed.'}catch(e){console.error(e);status.textContent='Network error. Please try again.'}finally{btn.disabled=false;btn.textContent=window.authTab==='login'?'Login':'Create account'}}window.emailLogout=async function(){try{await req('/api/auth/logout',{method:'POST'})}catch(e){}localStorage.removeItem('cc_email_token');user=null;showAuth()};window.offers=function(){
  if(!user)return;

  /*
   * IMPORTANT:
   * Coin Cove always uses the internal database user ID.
   * For email accounts this is users.id.
   * For Telegram accounts this is also users.id.
   */
  const uid=encodeURIComponent(String(user.id));

  document.body.insertAdjacentHTML(
    'beforeend',
    '<div id="wall" class="modal">'+
      '<div class="sheet">'+
        '<div class="close-row">'+
          '<h3>🎁 Offers</h3>'+
          '<button class="close" onclick="closeWall()">Close</button>'+
        '</div>'+

        '<div style="display:grid;gap:12px">'+

          '<button class="action" style="width:100%" onclick="openProvider(\'cpidroid\')">'+
            '<div class="action-icon">🎯</div>'+
            '<strong>CPIDroid</strong>'+
            '<span>Complete offers and earn Coins</span>'+
          '</button>'+

          '<button class="action" style="width:100%" onclick="openProvider(\'notik\')">'+
            '<div class="action-icon">🎮</div>'+
            '<strong>Notik</strong>'+
            '<span>Games, tasks and offers</span>'+
          '</button>'+

          '<button class="action" style="width:100%" onclick="openProvider(\'admantum\')">'+
            '<div class="action-icon">💎</div>'+
            '<strong>AdMantum</strong>'+
            '<span>Complete offers and earn Coins</span>'+
          '</button>'+

          '<button class="action" style="width:100%" onclick="openProvider(\'offerwallgg\')">'+
            '<div class="action-icon">🎁</div>'+
            '<strong>Offerwall.GG</strong>'+
            '<span>Complete offers and earn Coins</span>'+
          '</button>'+

        '</div>'+

        '<div id="providerWall" style="margin-top:16px"></div>'+
      '</div>'+
    '</div>'
  );

  window.openProvider=function(provider){

    const box=document.getElementById('providerWall');

    if(!box)return;

    let src='';

    if(provider==='cpidroid'){
      src='https://wall.cpidroid.com/offer/yxpm-81812-kal5?uid='+uid+'&gaid=&idfa=';
    }

    if(provider==='notik'){
      src='https://notik.me/coins?api_key=2eZo0UC1kNfCwjcFCYGpEWGwSDWzXJo9&pub_id=sLzA&app_id=fggvW50o8Z&user_id='+uid;
    }

    if(provider==='admantum'){
      src='https://www.admantum.com/offers?appid=27938&uid='+uid;
    }

    if(provider==='offerwallgg'){
      src='https://offerwall.gg/wall/4c826098db679c99583194371d0eae1b?userId='+uid;
    }

    if(!src)return;

    box.innerHTML=
      '<div class="card" style="padding:10px">'+
        '<div class="close-row">'+
          '<strong>'+esc(provider)+'</strong>'+
          '<button class="close" onclick="document.getElementById(\'providerWall\').innerHTML=\'\'">Back</button>'+
        '</div>'+
        '<iframe '+
          'src="'+src+'" '+
          'style="width:100%;height:65vh;border:0;border-radius:16px;background:#fff" '+
          'allow="clipboard-write" '+
        '></iframe>'+
      '</div>';
  };
};window.closeWall=function(){document.getElementById('wall')?.remove()};window.ad=async function(){if(!tg||!tg.initData)return alert('Watch & Earn is available when the app is opened from Telegram.');if(typeof window.show_11766606!=='function')return alert('Ad service is not ready.');try{await window.show_11766606({ymid:String(user.telegram_id),requestVar:'watch_earn'});const d=await req('/api/reward-ad',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({initData:tg.initData})});alert(d.message||'Completed');setTimeout(load,1500)}catch(e){alert('Ad was not completed.')}};window.ref=async function(){const d=await req('/api/referral');if(!d.success)return alert(d.message||'Referral unavailable');prompt('Referral link',d.link)};window.withdraw=function(){document.body.insertAdjacentHTML('beforeend','<div id="wd" class="modal"><div class="sheet"><div class="close-row"><h3>💸 Withdraw</h3><button class="close" onclick="document.getElementById(\'wd\').remove()">Close</button></div><p class="muted">Minimum: 200 Coins = $0.10. Withdrawals use 200-coin steps.</p><select id="wm" class="select"><option value="USDT_TRC20">USDT TRC20</option><option value="BINANCE_ID">BINANCE ID</option></select><input id="wc" class="input" type="number" min="200" step="200" placeholder="Coins amount"><input id="dest" class="input" placeholder="USDT TRC20 wallet address / Binance ID"><button class="btn" onclick="submitWd()">Submit withdrawal</button></div></div>')};window.submitWd=async function(){const b={method:$('wm').value,coins:Number($('wc').value),destination:$('dest').value.trim()};const d=await req('/api/withdraw',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});alert(d.message||(d.success?'Withdrawal submitted':'Withdrawal failed'));if(d.success){$('wd')?.remove();load()}};function showError(m){$('app').innerHTML='<div class="auth-page"><div class="auth-wrap"><div class="auth-card"><h1>Coin Cove</h1><p class="sub">'+esc(m||'Error')+'</p><button class="btn" onclick="load()">Retry</button></div></div></div>'}function esc(v){return String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;')}window.switchAuth=switchAuth;window.submitAuth=submitAuth;load()})();</script></body></html>`}

function renderAdmin(){return String.raw`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Coin Cove Admin</title><style>body{font-family:Arial;margin:0;background:#f4f6f9;color:#111827}.wrap{max-width:1000px;margin:auto;padding:20px}.card{background:#fff;border-radius:18px;padding:18px;margin:12px 0;overflow:auto}.input,.btn{padding:12px;border-radius:10px;border:1px solid #ddd}.btn{background:#111827;color:#fff;border:0;font-weight:700}table{width:100%;border-collapse:collapse}td,th{padding:9px;border-bottom:1px solid #eee;text-align:left;white-space:nowrap}</style></head><body><div class="wrap"><div id="app">Loading...</div></div><script>let token=localStorage.getItem('cc_admin_token')||'';const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');async function api(p,o={}){o.headers=Object.assign({'Content-Type':'application/json'},o.headers||{},token?{'Authorization':'Bearer '+token}:{});return fetch(p,o).then(r=>r.json())}async function boot(){const m=await api('/api/admin/me');if(!m.success){login();return}dash()}function login(){document.getElementById('app').innerHTML='<div class="card"><h2>Coin Cove Admin</h2><input id="u" class="input" placeholder="Admin Username"><input id="p" class="input" type="password" placeholder="Admin Password"><button class="btn" onclick="doLogin()">Login</button></div>'}async function doLogin(){const d=await api('/api/admin/login',{method:'POST',body:JSON.stringify({username:u.value,password:p.value})});if(!d.success)return alert(d.message);token=d.token;localStorage.setItem('cc_admin_token',token);dash()}async function dash(){const [us,ws]=await Promise.all([api('/api/admin/users'),api('/api/admin/withdrawals')]);document.getElementById('app').innerHTML='<h2>Coin Cove Admin</h2><div class="card"><h3>Users</h3><table><tr><th>ID</th><th>Email</th><th>Telegram</th><th>Balance</th><th>Earned</th></tr>'+(us.users||[]).map(x=>'<tr><td>'+x.id+'</td><td>'+esc(x.email||'')+'</td><td>'+esc(x.telegram_id||'')+'</td><td>'+x.balance+'</td><td>'+x.lifetime_earned+'</td></tr>').join('')+'</table></div><div class="card"><h3>Withdrawals</h3><table><tr><th>ID</th><th>User</th><th>Method</th><th>Coins</th><th>USD</th><th>Status</th><th>Action</th></tr>'+(ws.withdrawals||[]).map(x=>'<tr><td>'+x.id+'</td><td>'+esc(x.email||x.telegram_id||'')+'</td><td>'+x.method+'</td><td>'+x.coins+'</td><td>$'+(x.usd_cents/100).toFixed(2)+'</td><td>'+x.status+'</td><td>'+(x.status==='pending'?'<button class="btn" onclick="act('+x.id+',\'approve\')">Approve</button> <button class="btn" onclick="act('+x.id+',\'reject\')">Reject</button>':'')+'</td></tr>').join('')+'</table></div><button class="btn" onclick="logout()">Logout</button>'}async function act(id,a){const d=await api('/api/admin/withdrawal',{method:'POST',body:JSON.stringify({id,action:a})});alert(d.message||'Done');dash()}async function logout(){await api('/api/admin/logout',{method:'POST'});localStorage.removeItem('cc_admin_token');token='';login()}boot()</script></body></html>`}
