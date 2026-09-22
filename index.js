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
          offerwallConfigured: !!env.OFFERWALL_SECRET
        });
      }

      if (url.pathname === "/api/me") {
        return await apiMe(request, env);
      }

      if (url.pathname === "/api/offerwall/postback") {
        return await offerwallPostback(request, env);
      }

      return new Response(renderApp(), {
        headers: {
          "content-type": "text/html; charset=UTF-8",
          "cache-control": "no-store"
        }
      });

    } catch (error) {
      console.error(error);

      return json({
        success: false,
        message: "Internal server error."
      }, 500);
    }
  }
};


/* =========================
   TELEGRAM USER
========================= */

async function apiMe(request, env) {

  if (!env.DB) {
    return json({
      success: false,
      code: "DATABASE_MISSING",
      message: "D1 database is not configured."
    }, 500);
  }

  const botToken = normalizeBotToken(env.BOT_TOKEN);

  if (!botToken) {
    return json({
      success: false,
      code: "BOT_TOKEN_MISSING",
      message: "BOT_TOKEN is missing."
    }, 500);
  }

  const initData = await readInitData(request);

  if (!initData) {
    return json({
      success: false,
      code: "MISSING_INIT_DATA",
      message: "Open Coin Cove from Telegram."
    }, 401);
  }

  const validation = await validateTelegramInitData(
    initData,
    botToken
  );

  if (!validation.ok) {
    return json({
      success: false,
      code: validation.code,
      message: validation.message
    }, 401);
  }

  const user = validation.data.user;
  const startParam = validation.data.start_param;

  const now = Math.floor(Date.now() / 1000);

  await createTables(env.DB);

  let existing = await env.DB
    .prepare(
      "SELECT * FROM users WHERE telegram_id = ?"
    )
    .bind(String(user.id))
    .first();

  if (!existing) {

    const referralCode = generateReferralCode();

    let referredBy = null;

    if (startParam) {

      const referrer = await env.DB
        .prepare(
          "SELECT telegram_id FROM users WHERE referral_code = ?"
        )
        .bind(startParam)
        .first();

      if (
        referrer &&
        String(referrer.telegram_id) !== String(user.id)
      ) {
        referredBy = String(referrer.telegram_id);
      }
    }

    await env.DB.prepare(`
      INSERT INTO users
      (
        telegram_id,
        username,
        first_name,
        last_name,
        referral_code,
        referred_by,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      String(user.id),
      user.username || null,
      user.first_name || "",
      user.last_name || null,
      referralCode,
      referredBy,
      now,
      now
    )
    .run();

    existing = await env.DB
      .prepare(
        "SELECT * FROM users WHERE telegram_id = ?"
      )
      .bind(String(user.id))
      .first();

    await env.DB.prepare(`
      INSERT OR IGNORE INTO wallets
      (
        user_id,
        balance,
        lifetime_earned,
        lifetime_withdrawn,
        updated_at
      )
      VALUES (?, 0, 0, 0, ?)
    `)
    .bind(existing.id, now)
    .run();

    if (referredBy) {

      const referrer = await env.DB
        .prepare(
          "SELECT id FROM users WHERE telegram_id = ?"
        )
        .bind(referredBy)
        .first();

      if (referrer) {

        await env.DB.prepare(`
          INSERT OR IGNORE INTO referrals
          (
            referrer_id,
            referred_user_id,
            reward,
            created_at
          )
          VALUES (?, ?, 0, ?)
        `)
        .bind(
          referrer.id,
          existing.id,
          now
        )
        .run();
      }
    }
  }

  await env.DB.prepare(`
    UPDATE users
    SET
      username = ?,
      first_name = ?,
      last_name = ?,
      updated_at = ?
    WHERE telegram_id = ?
  `)
  .bind(
    user.username || null,
    user.first_name || "",
    user.last_name || null,
    now,
    String(user.id)
  )
  .run();

  await env.DB.prepare(`
    INSERT OR IGNORE INTO wallets
    (
      user_id,
      balance,
      lifetime_earned,
      lifetime_withdrawn,
      updated_at
    )
    VALUES (?, 0, 0, 0, ?)
  `)
  .bind(existing.id, now)
  .run();

  const wallet = await env.DB
    .prepare(`
      SELECT
        balance,
        lifetime_earned,
        lifetime_withdrawn
      FROM wallets
      WHERE user_id = ?
    `)
    .bind(existing.id)
    .first();

  const referrals = await env.DB
    .prepare(`
      SELECT COUNT(*) AS count
      FROM referrals
      WHERE referrer_id = ?
    `)
    .bind(existing.id)
    .first();

  const transactions = await env.DB
    .prepare(`
      SELECT
        type,
        amount,
        description,
        created_at
      FROM transactions
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT 10
    `)
    .bind(existing.id)
    .all();

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
      count: Number(referrals?.count || 0)
    },

    transactions: transactions.results || []
  });
}


/* =========================
   DATABASE
========================= */

async function createTables(db) {

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id TEXT NOT NULL UNIQUE,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      referral_code TEXT NOT NULL UNIQUE,
      referred_by TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS wallets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      balance REAL NOT NULL DEFAULT 0,
      lifetime_earned REAL NOT NULL DEFAULT 0,
      lifetime_withdrawn REAL NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT,
      created_at INTEGER NOT NULL
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS referrals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referrer_id INTEGER NOT NULL,
      referred_user_id INTEGER NOT NULL UNIQUE,
      reward REAL NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `).run();

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
      created_at INTEGER NOT NULL
    )
  `).run();
}


/* =========================
   OFFERWALL POSTBACK
========================= */

async function offerwallPostback(request, env) {

  if (request.method !== "GET") {
    return new Response("Method not allowed", {
      status: 405
    });
  }

  if (!env.DB || !env.OFFERWALL_SECRET) {
    return new Response(
      "server configuration error",
      { status: 500 }
    );
  }

  const q = new URL(request.url).searchParams;

  const userId = q.get("user") || "";
  const tx = q.get("tx") || "";
  const amountRaw = q.get("amount");
  const sig = q.get("sig") || "";
  const status = q.get("status") || "";

  if (!userId || !tx || amountRaw === null || !sig) {
    return new Response("bad request", {
      status: 400
    });
  }

  const expected = await hmacHexText(
    env.OFFERWALL_SECRET,
    `${userId}:${tx}:${amountRaw}`
  );

  if (!constantTimeEqual(expected, sig)) {
    return new Response("invalid signature", {
      status: 403
    });
  }

  if (
    status !== "credited" &&
    status !== "reversed"
  ) {
    return new Response("ok");
  }

  const amount = Number(amountRaw);

  if (!Number.isFinite(amount) || amount === 0) {
    return new Response("ok");
  }

  const user = await env.DB
    .prepare(`
      SELECT id
      FROM users
      WHERE telegram_id = ?
      LIMIT 1
    `)
    .bind(String(userId))
    .first();

  if (!user) {
    return new Response("unknown user", {
      status: 404
    });
  }

  try {

    await env.DB.prepare(`
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
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      tx,
      user.id,
      amount,
      status,
      q.get("offerId"),
      q.get("offerName"),
      q.get("goalId"),
      Number(q.get("payoutUsd") || 0),
      Math.floor(Date.now() / 1000)
    )
    .run();

  } catch (error) {

    const message =
      String(error?.message || "").toLowerCase();

    if (
      message.includes("unique") ||
      message.includes("constraint")
    ) {
      return new Response("ok");
    }

    throw error;
  }

  const now = Math.floor(Date.now() / 1000);

  const walletAmount =
    status === "reversed"
      ? -Math.abs(amount)
      : Math.abs(amount);

  await env.DB.prepare(`
    UPDATE wallets
    SET
      balance = balance + ?,
      lifetime_earned =
        CASE
          WHEN ? > 0
          THEN lifetime_earned + ?
          ELSE lifetime_earned
        END,
      updated_at = ?
    WHERE user_id = ?
  `)
  .bind(
    walletAmount,
    walletAmount,
    walletAmount,
    now,
    user.id
  )
  .run();

  await env.DB.prepare(`
    INSERT INTO transactions
    (
      user_id,
      type,
      amount,
      description,
      created_at
    )
    VALUES (?, ?, ?, ?, ?)
  `)
  .bind(
    user.id,
    status === "reversed"
      ? "offer_reversal"
      : "offer_reward",
    walletAmount,
    status === "reversed"
      ? "Offer reversed"
      : "Offer reward",
    now
  )
  .run();

  return new Response("ok");
}


/* =========================
   TELEGRAM VALIDATION
========================= */

async function validateTelegramInitData(
  initData,
  botToken
) {

  try {

    const params =
      new URLSearchParams(initData);

    const receivedHash =
      params.get("hash");

    if (
      !receivedHash ||
      !/^[0-9a-fA-F]{64}$/.test(receivedHash)
    ) {
      return {
        ok: false,
        code: "INVALID_HASH_FORMAT",
        message: "Telegram hash is invalid."
      };
    }

    params.delete("hash");

    const entries =
      Array.from(params.entries())
        .sort((a, b) => {
          if (a[0] < b[0]) return -1;
          if (a[0] > b[0]) return 1;
          return 0;
        });

    const dataCheckString =
      entries
        .map(
          ([key, value]) =>
            key + "=" + value
        )
        .join("\n");

    const secretKey =
      await hmacSha256(
        new TextEncoder().encode(botToken),
        "WebAppData"
      );

    const calculatedHash =
      await hmacSha256Hex(
        secretKey,
        dataCheckString
      );

    if (
      !constantTimeEqual(
        calculatedHash.toLowerCase(),
        receivedHash.toLowerCase()
      )
    ) {
      return {
        ok: false,
        code: "TELEGRAM_HASH_MISMATCH",
        message: "Telegram hash mismatch."
      };
    }

    const userRaw =
      params.get("user");

    if (!userRaw) {
      return {
        ok: false,
        code: "TELEGRAM_USER_MISSING",
        message: "Telegram user is missing."
      };
    }

    const user =
      JSON.parse(userRaw);

    if (
      !user ||
      user.id === undefined ||
      user.id === null
    ) {
      return {
        ok: false,
        code: "TELEGRAM_USER_INVALID",
        message: "Telegram user is invalid."
      };
    }

    return {
      ok: true,
      data: {
        user,
        start_param:
          params.get("start_param") || null
      }
    };

  } catch (error) {

    console.error(
      "Telegram validation error:",
      error
    );

    return {
      ok: false,
      code: "TELEGRAM_VALIDATION_ERROR",
      message: "Unable to validate Telegram data."
    };
  }
}


/* =========================
   INIT DATA
========================= */

async function readInitData(request) {

  if (request.method === "POST") {

    try {

      const contentType =
        (
          request.headers.get(
            "content-type"
          ) || ""
        ).toLowerCase();

      if (
        contentType.includes(
          "application/json"
        )
      ) {

        const body =
          await request.json();

        if (
          body &&
          typeof body.initData === "string"
        ) {
          return body.initData.trim();
        }
      }

    } catch (error) {

      console.error(
        "InitData read error:",
        error
      );
    }
  }

  const header =
    request.headers.get(
      "X-Telegram-Init-Data"
    );

  if (header) {
    return header.trim();
  }

  const authorization =
    request.headers.get(
      "Authorization"
    ) || "";

  if (
    authorization
      .toLowerCase()
      .startsWith("tma ")
  ) {
    return authorization
      .slice(4)
      .trim();
  }

  return "";
}


/* =========================
   CRYPTO
========================= */

async function hmacSha256(
  keyBytes,
  message
) {

  const key =
    await crypto.subtle.importKey(
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

async function hmacSha256Hex(
  keyBytes,
  message
) {

  const signature =
    await hmacSha256(
      keyBytes,
      message
    );

  return Array.from(
    new Uint8Array(signature)
  )
    .map(
      byte =>
        byte
          .toString(16)
          .padStart(2, "0")
    )
    .join("");
}

async function hmacHexText(
  secret,
  message
) {

  return hmacSha256Hex(
    new TextEncoder().encode(
      String(secret || "")
    ),
    message
  );
}


/* =========================
   HELPERS
========================= */

function normalizeBotToken(value) {

  let token =
    String(
      value == null
        ? ""
        : value
    );

  token =
    token
      .replace(/^\uFEFF/, "")
      .trim();

  if (
    token.startsWith("BOT_TOKEN=")
  ) {
    token =
      token
        .slice("BOT_TOKEN=".length)
        .trim();
  }

  if (
    token.length >= 2 &&
    (
      (
        token.startsWith('"') &&
        token.endsWith('"')
      ) ||
      (
        token.startsWith("'") &&
        token.endsWith("'")
      )
    )
  ) {
    token =
      token
        .slice(1, -1)
        .trim();
  }

  return token;
}

function constantTimeEqual(a, b) {

  if (
    typeof a !== "string" ||
    typeof b !== "string"
  ) {
    return false;
  }

  if (a.length !== b.length) {
    return false;
  }

  let result = 0;

  for (
    let i = 0;
    i < a.length;
    i++
  ) {
    result |=
      a.charCodeAt(i) ^
      b.charCodeAt(i);
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

  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "content-type":
          "application/json; charset=UTF-8",
        "cache-control":
          "no-store"
      }
    }
  );
}


/* =========================
   APP
========================= */

function renderApp() {

  return `<!doctype html>
<html>
<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width,initial-scale=1,maximum-scale=1"
>

<title>Coin Cove</title>

<script src="https://telegram.org/js/telegram-web-app.js"></script>

<style>

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family:
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    Arial,
    sans-serif;
  background:
    var(--tg-theme-bg-color, #f5f7fb);
  color:
    var(--tg-theme-text-color, #111827);
}

.app {
  max-width: 560px;
  margin: auto;
  padding: 20px 16px 100px;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.logo {
  width: 45px;
  height: 45px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #111827;
  color: white;
  font-size: 24px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.title {
  font-size: 20px;
  font-weight: 800;
}

.subtitle {
  font-size: 12px;
  opacity: .55;
}

.balance {
  background: #111827;
  color: white;
  border-radius: 24px;
  padding: 24px;
  margin-bottom: 18px;
}

.balance-label {
  opacity: .65;
  font-size: 13px;
}

.balance-number {
  font-size: 40px;
  font-weight: 850;
  margin-top: 5px;
}

.balance-name {
  opacity: .65;
  font-size: 13px;
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.card {
  border: 0;
  border-radius: 20px;
  padding: 20px 16px;
  text-align: left;
  background:
    var(--tg-theme-secondary-bg-color, white);
  color:
    var(--tg-theme-text-color, #111827);
  box-shadow:
    0 5px 18px rgba(0,0,0,.05);
}

.icon {
  font-size: 28px;
  margin-bottom: 12px;
}

.card-title {
  font-weight: 800;
}

.card-text {
  font-size: 12px;
  opacity: .55;
  margin-top: 5px;
}

.section {
  margin-top: 24px;
}

.section-title {
  font-size: 17px;
  font-weight: 800;
  margin-bottom: 10px;
}

.stat {
  background:
    var(--tg-theme-secondary-bg-color, white);
  border-radius: 18px;
  padding: 16px;
}

.loading,
.error {
  padding: 40px 20px;
  text-align: center;
}

</style>

</head>

<body>

<div id="app">
  <div class="loading">
    Loading Coin Cove...
  </div>
</div>

<script>

const tg =
  window.Telegram &&
  window.Telegram.WebApp;

if (tg) {

  tg.ready();
  tg.expand();

}

async function start() {

  if (!tg || !tg.initData) {

    showError(
      "Please open Coin Cove using Open App inside Telegram."
    );

    return;
  }

  try {

    const response =
      await fetch("/api/me", {

        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify({
            initData:
              tg.initData
          }),

        cache:
          "no-store"

      });

    const data =
      await response.json();

    if (
      !response.ok ||
      !data.success
    ) {

      showError(
        data.message ||
        "Unable to load account."
      );

      return;
    }

    render(data);

  } catch (error) {

    console.error(error);

    showError(
      "Unable to connect to Coin Cove."
    );
  }
}


function render(data) {

  const user =
    data.user || {};

  const wallet =
    data.wallet || {};

  const referrals =
    data.referrals || {};

  const balance =
    Number(
      wallet.balance || 0
    ).toLocaleString();

  const earned =
    Number(
      wallet.lifetime_earned || 0
    ).toLocaleString();

  document.getElementById(
    "app"
  ).innerHTML = `

    <div class="app">

      <div class="header">

        <div class="brand">

          <div class="logo">
            🪙
          </div>

          <div>

            <div class="title">
              Coin Cove
            </div>

            <div class="subtitle">
              Earn • Complete • Reward
            </div>

          </div>

        </div>

      </div>


      <div class="balance">

        <div class="balance-label">
          Welcome back,
          ${escapeHtml(
            user.first_name || "there"
          )}
        </div>

        <div class="balance-number">
          ${balance}
        </div>

        <div class="balance-name">
          ${POINTS_NAME}
        </div>

      </div>


      <div class="grid">

        <button
          class="card"
          onclick="openOffers()"
        >

          <div class="icon">
            🎁
          </div>

          <div class="card-title">
            Earn Offers
          </div>

          <div class="card-text">
            Complete offers and earn Coins
          </div>

        </button>


        <button
          class="card"
          onclick="comingSoon('Watch & Earn')"
        >

          <div class="icon">
            📺
          </div>

          <div class="card-title">
            Watch & Earn
          </div>

          <div class="card-text">
            Rewarded ads
          </div>

        </button>


        <button
          class="card"
          onclick="comingSoon('Invite Friends')"
        >

          <div class="icon">
            👥
          </div>

          <div class="card-title">
            Invite Friends
          </div>

          <div class="card-text">
            Friends:
            ${Number(
              referrals.count || 0
            )}
          </div>

        </button>


        <button
          class="card"
          onclick="comingSoon('Withdraw')"
        >

          <div class="icon">
            💸
          </div>

          <div class="card-title">
            Withdraw
          </div>

          <div class="card-text">
            Coming soon
          </div>

        </button>

      </div>


      <div class="section">

        <div class="section-title">
          Your Activity
        </div>

        <div class="stat">

          <b>
            ${earned}
          </b>

          <div style="opacity:.55;font-size:12px;margin-top:5px">
            Lifetime Earned
          </div>

        </div>

      </div>

    </div>
  `;
}


function openOffers() {

  if (
    !window.currentUser
  ) {

    /*
      User ID is loaded again from Telegram.
    */

  }

  const uid =
    encodeURIComponent(
      String(
        window.currentTelegramId || ""
      )
    );

  if (!uid) {

    showError(
      "User information is not ready."
    );

    return;
  }

  const wall =
    "https://offerwall.gg/wall/4c826098db679c99583194371d0eae1b?userId=" +
    uid;

  location.href = wall;
}


function comingSoon(name) {

  if (
    tg &&
    typeof tg.showAlert === "function"
  ) {

    tg.showAlert(
      name + " will be added next."
    );

  } else {

    alert(
      name + " will be added next."
    );
  }
}


function showError(message) {

  document.getElementById(
    "app"
  ).innerHTML = `

    <div class="error">

      <div style="font-size:50px">
        🪙
      </div>

      <h2>
        Coin Cove
      </h2>

      <p style="opacity:.6">
        ${escapeHtml(message)}
      </p>

    </div>
  `;
}


function escapeHtml(value) {

  return String(
    value == null
      ? ""
      : value
  )
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");
}


start();

</script>

</body>
</html>`;
}
