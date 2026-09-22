const APP_NAME = "Coin Cove";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") return json({ success:true, app:APP_NAME, database:!!env.DB, botConfigured:!!env.BOT_TOKEN });
    if (url.pathname === "/api/db-test") return dbTest(env);
    if (url.pathname === "/api/me") return apiMe(request, env);
    return new Response(renderApp(), {headers:{"content-type":"text/html; charset=UTF-8","cache-control":"no-store"}});
  }
};

async function dbTest(env) {
  if (!env.DB) return json({success:false,database:false},500);
  try { const result=await env.DB.prepare("SELECT 1 AS ok").first(); return json({success:true,database:true,message:"D1 READ OK",result}); }
  catch(e){ return json({success:false,database:true,error:String(e.message||e)},500); }
}

async function apiMe(request, env) {
  if (!env.DB) return json({success:false,code:"DB_MISSING"},500);
  if (!env.BOT_TOKEN) return json({success:false,code:"BOT_TOKEN_MISSING"},500);
  const initData=await readInitData(request);
  if (!initData) return json({success:false,code:"NO_INIT_DATA",message:"Open Coin Cove from Telegram."},401);
  const validation=await validateTelegramInitData(initData,env.BOT_TOKEN);
  if (!validation.ok) return json({success:false,code:validation.code,message:validation.message},401);
  const user=validation.data.user;
  const now=Math.floor(Date.now()/1000);
  const telegramId=String(user.id);
  let dbUser=await env.DB.prepare("SELECT * FROM users WHERE telegram_id = ? LIMIT 1").bind(telegramId).first();
  if (!dbUser) {
    await env.DB.prepare(`INSERT INTO users (telegram_id,username,first_name,last_name,referral_code,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`).bind(telegramId,user.username||null,user.first_name||"",user.last_name||null,generateReferralCode(),now,now).run();
    dbUser=await env.DB.prepare("SELECT * FROM users WHERE telegram_id = ? LIMIT 1").bind(telegramId).first();
  } else {
    await env.DB.prepare(`UPDATE users SET username=?,first_name=?,last_name=?,updated_at=? WHERE telegram_id=?`).bind(user.username||null,user.first_name||"",user.last_name||null,now,telegramId).run();
  }
  await env.DB.prepare(`INSERT OR IGNORE INTO wallets (user_id,balance,lifetime_earned,lifetime_withdrawn,updated_at) VALUES (?,0,0,0,?)`).bind(dbUser.id,now).run();
  const wallet=await env.DB.prepare(`SELECT balance,lifetime_earned,lifetime_withdrawn FROM wallets WHERE user_id=? LIMIT 1`).bind(dbUser.id).first();
  return json({success:true,message:"Telegram user and wallet OK",user:{id:dbUser.id,telegram_id:telegramId,username:user.username||"",first_name:user.first_name||"",last_name:user.last_name||"",referral_code:dbUser.referral_code},wallet:wallet||{balance:0,lifetime_earned:0,lifetime_withdrawn:0}});
}

async function readInitData(request) {
  if (request.method === "POST") { try { const ct=(request.headers.get("content-type")||"").toLowerCase(); if(ct.includes("application/json")){const body=await request.json(); if(body&&typeof body.initData==="string") return body.initData.trim();}} catch(_){} }
  const header=request.headers.get("X-Telegram-Init-Data"); if(header&&header.trim()) return header.trim();
  const auth=request.headers.get("Authorization")||""; if(auth.toLowerCase().startsWith("tma ")) return auth.slice(4).trim();
  const url=new URL(request.url); return (url.searchParams.get("initData")||url.searchParams.get("tgWebAppData")||"").trim();
}

async function validateTelegramInitData(initData,botToken) {
  try {
    const params=new URLSearchParams(initData), receivedHash=params.get("hash");
    if(!receivedHash) return {ok:false,code:"MISSING_HASH",message:"Telegram hash is missing."};
    params.delete("hash");
    const entries=Array.from(params.entries()).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
    const dataCheckString=entries.map(e=>e[0]+"="+e[1]).join("\n");
    const secretKey=await hmacSha256(new TextEncoder().encode(botToken),"WebAppData");
    const calculatedHash=await hmacSha256Hex(secretKey,dataCheckString);
    if(calculatedHash.toLowerCase()!==receivedHash.toLowerCase()) return {ok:false,code:"TELEGRAM_HASH_MISMATCH",message:"Telegram hash mismatch."};
    const userRaw=params.get("user"); if(!userRaw) return {ok:false,code:"TELEGRAM_USER_MISSING",message:"Telegram user data is missing."};
    const user=JSON.parse(userRaw); if(!user||user.id===undefined||user.id===null) return {ok:false,code:"TELEGRAM_USER_INVALID",message:"Telegram user data is invalid."};
    return {ok:true,data:{user}};
  } catch(e){ console.error(e); return {ok:false,code:"TELEGRAM_VALIDATION_ERROR",message:"Telegram validation failed."}; }
}

async function hmacSha256(keyBytes,message){const key=await crypto.subtle.importKey("raw",keyBytes,{name:"HMAC",hash:"SHA-256"},false,["sign"]);return crypto.subtle.sign("HMAC",key,new TextEncoder().encode(message));}
async function hmacSha256Hex(keyBytes,message){const s=await hmacSha256(keyBytes,message);return Array.from(new Uint8Array(s)).map(b=>b.toString(16).padStart(2,"0")).join("");}
function generateReferralCode(){return crypto.randomUUID().replace(/-/g,"").slice(0,12).toUpperCase();}
function json(data,status=200){return new Response(JSON.stringify(data,null,2),{status,headers:{"content-type":"application/json; charset=UTF-8","cache-control":"no-store"}});}

function renderApp(){return `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><title>Coin Cove</title><script src="https://telegram.org/js/telegram-web-app.js"></script><style>body{font-family:Arial,sans-serif;text-align:center;padding:30px 20px}.card{max-width:500px;margin:auto;padding:22px;border-radius:18px;background:#f3f4f6}.balance{font-size:42px;font-weight:800;margin:15px}pre{text-align:left;white-space:pre-wrap;word-break:break-word}</style></head><body><div class="card"><h1>🪙 Coin Cove</h1><p id="status">Checking Telegram...</p><div id="result"></div></div><script>
const tg=window.Telegram&&window.Telegram.WebApp;if(!tg){document.getElementById("status").textContent="Open Coin Cove from Telegram."}else{tg.ready();tg.expand();loadAccount()}
async function loadAccount(){const status=document.getElementById("status"),result=document.getElementById("result"),initData=tg.initData||"";status.textContent="initData length: "+initData.length;if(!initData){status.textContent="❌ NO INIT DATA";return}try{const response=await fetch("/api/me",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({initData})}),data=await response.json();if(!data.success){status.textContent="❌ Authentication failed";result.innerHTML="<pre>"+escapeHtml(JSON.stringify(data,null,2))+"</pre>";return}status.textContent="✅ Telegram + D1 OK";result.innerHTML="<div class='balance'>"+Number(data.wallet.balance||0).toLocaleString()+"</div><div>Coins</div><p>Welcome, "+escapeHtml(data.user.first_name)+"</p><pre>"+escapeHtml(JSON.stringify(data,null,2))+"</pre>"}catch(e){status.textContent="❌ Connection error";result.textContent=String(e)}}
function escapeHtml(v){return String(v==null?"":v).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;")}
</script></body></html>`;}
`;
