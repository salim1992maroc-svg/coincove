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
          botConfigured: !!env.BOT_TOKEN
        });
      }

      if (url.pathname === "/api/telegram-test") {
        return telegramTest(request, env);
      }

      if (url.pathname === "/api/me") {
        return apiMe(request, env);
      }

      return new Response(renderApp(), {
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


/* =========================
   TELEGRAM TEST
========================= */

async function telegramTest(request, env) {
  const initData = await readInitData(request);

  if (!initData) {
    return json({
      success: false,
      telegram: false,
      error: "NO_INIT_DATA"
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


/* =========================
   MAIN USER API
========================= */

async function apiMe(request, env) {

  if (request.method !== "POST") {
    return json({
      success: false,
      message: "POST required."
    }, 405);
  }

  if (!env.DB) {
    return json({
      success: false,
      message: "D1 database is not configured."
    }, 500);
  }

  const initData = await readInitData(request);

  if (!initData) {
    return json({
      success: false,
      code: "NO_INIT_DATA",
      message: "Telegram authorization data is missing."
    }, 401);
  }

  const validation = await validateTelegramInitData(
    initData,
    env.BOT_TOKEN
  );

  if (!validation.ok) {
    return json({
      success: false,
      code: validation.code,
      message: validation.message
    }, 401);
  }

  const telegramUser = validation.data.user;

  const telegramId = String(telegramUser.id);

  const now = Math.floor(Date.now() / 1000);

  let user = await env.DB
    .prepare(`
      SELECT *
      FROM users
      WHERE telegram_id = ?
      LIMIT 1
    `)
    .bind(telegramId)
    .first();


  /* CREATE USER */

  if (!user) {

    const referralCode = generateReferralCode();

    await env.DB
      .prepare(`
        INSERT INTO users
        (
          telegram_id,
          username,
          first_name,
          last_name,
          referral_code,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        telegramId,
        telegramUser.username || null,
        telegramUser.first_name || "",
        telegramUser.last_name || null,
        referralCode,
        now,
        now
      )
      .run();

    user = await env.DB
      .prepare(`
        SELECT *
        FROM users
        WHERE telegram_id = ?
        LIMIT 1
      `)
      .bind(telegramId)
      .first();
  }


  /* UPDATE TELEGRAM PROFILE */

  await env.DB
    .prepare(`
      UPDATE users
      SET
        username = ?,
        first_name = ?,
        last_name = ?,
        updated_at = ?
      WHERE telegram_id = ?
    `)
    .bind(
      telegramUser.username || null,
      telegramUser.first_name || "",
      telegramUser.last_name || null,
      now,
      telegramId
    )
    .run();


  /* ENSURE WALLET */

  await env.DB
    .prepare(`
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
    .bind(
      user.id,
      now
    )
    .run();


  /* WALLET */

  const wallet = await env.DB
    .prepare(`
      SELECT
        balance,
        lifetime_earned,
        lifetime_withdrawn
      FROM wallets
      WHERE user_id = ?
      LIMIT 1
    `)
    .bind(user.id)
    .first();


  /* TRANSACTIONS */

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
    .bind(user.id)
    .all();


  /* REFERRALS */

  const referralCount = await env.DB
    .prepare(`
      SELECT COUNT(*) AS count
      FROM referrals
      WHERE referrer_id = ?
    `)
    .bind(user.id)
    .first();


  return json({
    success: true,

    user: {
      id: user.id,
      telegram_id: telegramId,
      username: telegramUser.username || "",
      first_name: telegramUser.first_name || "",
      last_name: telegramUser.last_name || "",
      referral_code: user.referral_code || ""
    },

    wallet: wallet || {
      balance: 0,
      lifetime_earned: 0,
      lifetime_withdrawn: 0
    },

    referrals: {
      count: Number(referralCount?.count || 0)
    },

    transactions: transactions?.results || []
  });
}


/* =========================
   READ INIT DATA
========================= */

async function readInitData(request) {

  const header = request.headers.get(
    "X-Telegram-Init-Data"
  );

  if (header && header.trim()) {
    return header.trim();
  }


  const authorization =
    request.headers.get("Authorization") || "";

  if (
    authorization
      .toLowerCase()
      .startsWith("tma ")
  ) {
    return authorization
      .slice(4)
      .trim();
  }


  if (request.method === "POST") {

    try {

      const contentType =
        (
          request.headers.get("content-type") || ""
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
        "POST initData error:",
        error
      );

    }
  }


  const url =
    new URL(request.url);

  return (
    url.searchParams.get("initData") ||
    url.searchParams.get("tgWebAppData") ||
    ""
  ).trim();
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

    if (!receivedHash) {

      return {
        ok: false,
        code: "MISSING_HASH",
        message: "Telegram hash is missing."
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
          entry =>
            entry[0] +
            "=" +
            entry[1]
        )
        .join("\n");


    /*
      IMPORTANT:
      This is the exact working
      Telegram Mini App validation.
    */

    const secretKey =
      await hmacSha256(
        new TextEncoder().encode(
          "WebAppData"
        ),
        botToken
      );


    const calculatedHash =
      await hmacSha256Hex(
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
        message:
          "Telegram hash mismatch."
      };

    }


    const userRaw =
      params.get("user");


    if (!userRaw) {

      return {
        ok: false,
        code:
          "TELEGRAM_USER_MISSING",
        message:
          "Telegram user data is missing."
      };

    }


    const user =
      JSON.parse(userRaw);


    return {
      ok: true,

      data: {
        user
      }
    };


  } catch (error) {

    console.error(
      "Telegram validation error:",
      error
    );

    return {
      ok: false,
      code:
        "TELEGRAM_VALIDATION_ERROR",
      message:
        "Telegram validation failed."
    };

  }
}


/* =========================
   HMAC
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
    new TextEncoder().encode(
      message
    )
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


  return Array
    .from(
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


/* =========================
   REFERRAL CODE
========================= */

function generateReferralCode() {

  return crypto
    .randomUUID()
    .replace(/-/g, "")
    .substring(0, 12)
    .toUpperCase();
}


/* =========================
   JSON
========================= */

function json(
  data,
  status = 200
) {

  return new Response(
    JSON.stringify(
      data,
      null,
      2
    ),
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
   FRONTEND
========================= */

function renderApp() {

  return `<!doctype html>

<html>

<head>

<meta charset="UTF-8">

<meta
name="viewport"
content="width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover"
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
    var(
      --tg-theme-bg-color,
      #f4f6f9
    );

  color:
    var(
      --tg-theme-text-color,
      #111827
    );

}

.app {

  max-width: 560px;

  margin: auto;

  min-height: 100vh;

  padding:
    22px
    16px
    100px;

}

.header {

  display: flex;

  justify-content:
    space-between;

  align-items: center;

  margin-bottom: 22px;

}

.brand {

  display: flex;

  align-items: center;

  gap: 10px;

}

.logo {

  width: 46px;

  height: 46px;

  border-radius: 15px;

  display: flex;

  align-items: center;

  justify-content: center;

  background: #111827;

  color: white;

  font-size: 24px;

}

.brand-title {

  font-size: 21px;

  font-weight: 800;

}

.brand-subtitle {

  font-size: 12px;

  opacity: .55;

  margin-top: 3px;

}

.avatar {

  width: 42px;

  height: 42px;

  border-radius: 50%;

  background:
    rgba(127,127,127,.15);

  display: flex;

  align-items: center;

  justify-content: center;

  font-weight: 800;

}

.balance {

  background: #111827;

  color: white;

  border-radius: 25px;

  padding: 25px;

  margin-bottom: 18px;

  box-shadow:
    0 12px 30px
    rgba(0,0,0,.15);

}

.balance-small {

  font-size: 13px;

  opacity: .65;

}

.balance-number {

  font-size: 38px;

  font-weight: 900;

  margin-top: 6px;

}

.balance-coins {

  font-size: 13px;

  opacity: .65;

}

.grid {

  display: grid;

  grid-template-columns:
    1fr 1fr;

  gap: 12px;

}

.card {

  border: 0;

  border-radius: 21px;

  padding: 20px 16px;

  text-align: left;

  background:
    var(
      --tg-theme-secondary-bg-color,
      white
    );

  color:
    var(
      --tg-theme-text-color,
      #111827
    );

  box-shadow:
    0 5px 18px
    rgba(0,0,0,.05);

}

.card:active {

  transform: scale(.98);

}

.card-icon {

  font-size: 28px;

  margin-bottom: 12px;

}

.card-title {

  font-size: 15px;

  font-weight: 800;

}

.card-text {

  font-size: 12px;

  opacity: .55;

  margin-top: 5px;

  line-height: 1.4;

}

.section {

  margin-top: 25px;

}

.section-title {

  font-size: 17px;

  font-weight: 800;

  margin-bottom: 12px;

}

.stats {

  display: grid;

  grid-template-columns:
    1fr 1fr;

  gap: 10px;

}

.stat {

  background:
    var(
      --tg-theme-secondary-bg-color,
      white
    );

  border-radius: 18px;

  padding: 17px;

}

.stat-number {

  font-size: 21px;

  font-weight: 800;

}

.stat-label {

  font-size: 11px;

  opacity: .55;

  margin-top: 4px;

}

.activity {

  background:
    var(
      --tg-theme-secondary-bg-color,
      white
    );

  border-radius: 18px;

  padding: 15px;

}

.transaction {

  display: flex;

  justify-content:
    space-between;

  padding: 11px 0;

  border-bottom:
    1px solid
    rgba(127,127,127,.12);

}

.transaction:last-child {

  border-bottom: 0;

}

.transaction-title {

  font-size: 13px;

  font-weight: 700;

}

.transaction-date {

  font-size: 10px;

  opacity: .5;

  margin-top: 3px;

}

.transaction-amount {

  font-weight: 800;

}

.bottom {

  position: fixed;

  left: 0;

  right: 0;

  bottom: 0;

  padding:
    9px 15px
    calc(9px + env(safe-area-inset-bottom));

  background:
    rgba(245,247,251,.92);

  backdrop-filter:
    blur(14px);

}

.bottom-inner {

  max-width: 560px;

  margin: auto;

  display: grid;

  grid-template-columns:
    repeat(4,1fr);

}

.nav {

  border: 0;

  background: transparent;

  color:
    var(
      --tg-theme-hint-color,
      #6b7280
    );

  padding: 8px 2px;

  font-size: 11px;

}

.nav-icon {

  display: block;

  font-size: 20px;

  margin-bottom: 3px;

}

.loading {

  min-height: 100vh;

  display: flex;

  align-items: center;

  justify-content: center;

  opacity: .6;

}

.error {

  padding: 35px 20px;

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

  try {

    tg.ready();

    tg.expand();

  } catch (e) {

    console.error(e);

  }

}


function getInitData() {

  if (
    tg &&
    typeof tg.initData === "string"
  ) {

    return tg.initData.trim();

  }

  return "";

}


async function loadApp() {

  const initData =
    getInitData();


  if (!initData) {

    showError(
      "Please open Coin Cove from Telegram."
    );

    return;

  }


  try {

    const response =
      await fetch(
        "/api/me",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({
              initData
            }),

          cache: "no-store"
        }
      );


    const data =
      await response.json();


    if (
      !response.ok ||
      !data.success
    ) {

      console.error(data);

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


  const initial =
    (
      user.first_name ||
      "C"
    )
      .charAt(0)
      .toUpperCase();


  const transactions =
    Array.isArray(
      data.transactions
    )
      ? data.transactions
      : [];


  let activity = "";


  if (transactions.length) {

    activity =
      transactions
        .map(tx => {

          const amount =
            Number(
              tx.amount || 0
            );


          return \`
            <div class="transaction">

              <div>

                <div class="transaction-title">
                  \${escapeHtml(
                    tx.description ||
                    tx.type ||
                    "Transaction"
                  )}
                </div>

                <div class="transaction-date">
                  \${formatDate(
                    tx.created_at
                  )}
                </div>

              </div>

              <div class="transaction-amount">

                \${amount > 0 ? "+" : ""}
                \${escapeHtml(
                  String(amount)
                )}

              </div>

            </div>
          `;

        })
        .join("");

  } else {

    activity =
      '<div style="text-align:center;opacity:.5;padding:10px">No activity yet</div>';

  }


  document.getElementById(
    "app"
  ).innerHTML = \`

    <div class="app">

      <div class="header">

        <div class="brand">

          <div class="logo">
            🪙
          </div>

          <div>

            <div class="brand-title">
              Coin Cove
            </div>

            <div class="brand-subtitle">
              Earn • Complete • Reward
            </div>

          </div>

        </div>


        <div class="avatar">
          \${escapeHtml(initial)}
        </div>

      </div>


      <div class="balance">

        <div class="balance-small">
          Welcome back,
          \${escapeHtml(
            user.first_name || "there"
          )}
        </div>

        <div class="balance-number">
          \${balance}
        </div>

        <div class="balance-coins">
          Coins
        </div>

      </div>


      <div class="grid">

        <button
          class="card"
          onclick="openOffers()"
        >

          <div class="card-icon">
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

          <div class="card-icon">
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

          <div class="card-icon">
            👥
          </div>

          <div class="card-title">
            Invite Friends
          </div>

          <div class="card-text">
            Invite friends and earn
          </div>

        </button>


        <button
          class="card"
          onclick="comingSoon('Withdraw')"
        >

          <div class="card-icon">
            💸
          </div>

          <div class="card-title">
            Withdraw
          </div>

          <div class="card-text">
            Request your reward
          </div>

        </button>

      </div>


      <div class="section">

        <div class="section-title">
          Your Statistics
        </div>

        <div class="stats">

          <div class="stat">

            <div class="stat-number">
              \${earned}
            </div>

            <div class="stat-label">
              Lifetime Earned
            </div>

          </div>


          <div class="stat">

            <div class="stat-number">
              \${Number(
                referrals.count || 0
              )}
            </div>

            <div class="stat-label">
              Friends Invited
            </div>

          </div>

        </div>

      </div>


      <div class="section">

        <div class="section-title">
          Recent Activity
        </div>

        <div class="activity">

          \${activity}

        </div>

      </div>

    </div>


    <div class="bottom">

      <div class="bottom-inner">

        <button class="nav">

          <span class="nav-icon">
            🏠
          </span>

          Home

        </button>


        <button
          class="nav"
          onclick="openOffers()"
        >

          <span class="nav-icon">
            🎁
          </span>

          Offers

        </button>


        <button
          class="nav"
          onclick="comingSoon('Invite Friends')"
        >

          <span class="nav-icon">
            👥
          </span>

          Invite

        </button>


        <button
          class="nav"
          onclick="comingSoon('Wallet')"
        >

          <span class="nav-icon">
            💰
          </span>

          Wallet

        </button>

      </div>

    </div>

  \`;

}


function openOffers() {

  if (tg) {

    tg.showAlert(
      "Offers will be connected next."
    );

  } else {

    alert(
      "Offers will be connected next."
    );

  }

}


function comingSoon(name) {

  const message =
    name +
    " will be connected next.";


  if (
    tg &&
    typeof tg.showAlert === "function"
  ) {

    tg.showAlert(message);

  } else {

    alert(message);

  }

}


function showError(message) {

  document.getElementById(
    "app"
  ).innerHTML = \`

    <div class="error">

      <div style="font-size:48px">
        🪙
      </div>

      <h2>
        Coin Cove
      </h2>

      <p style="opacity:.6">
        \${escapeHtml(message)}
      </p>

      <button
        onclick="location.reload()"
        style="
          padding:10px 18px;
          border:0;
          border-radius:10px;
        "
      >
        Retry
      </button>

    </div>

  \`;

}


function escapeHtml(value) {

  return String(
    value == null ? "" : value
  )
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

}


function formatDate(timestamp) {

  if (!timestamp) return "";

  return new Date(
    Number(timestamp) * 1000
  ).toLocaleDateString();

}


loadApp();

</script>

</body>

</html>`;

}
