/* ============================================================
   TBD Hardware B2B AI System V1.1 —— 云端同步服务端
   存储策略：
     - 若设置了 DATABASE_URL（云端部署），数据存到 Postgres（持久、重启不丢）
     - 否则回退到本地文件 data/snapshot.json（本地开发用）
   前端任何改动都会 POST 全量快照；任何设备打开都 GET 全量快照。
   ============================================================ */
const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8787;
app.use(express.json({ limit: "60mb" })); // 产品图片以 base64 内嵌，需放宽体积

/* ---------- 存储后端 ---------- */
let pool = null;
if (process.env.DATABASE_URL) {
  const { Pool } = require("pg");
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  pool
    .query(
      `CREATE TABLE IF NOT EXISTS tbd_state(
         id text primary key,
         data jsonb,
         updated_at timestamptz default now()
       )`
    )
    .then(() => console.log("[DB] tbd_state 表已就绪"))
    .catch((e) => console.error("[DB] 初始化失败：", e.message));
}

const DATA_FILE = path.join(__dirname, "data", "snapshot.json");
fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });

async function readStore() {
  if (pool) {
    const r = await pool.query("SELECT data FROM tbd_state WHERE id='main'");
    return r.rows[0]?.data || { factories: [], products: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch (e) {
    return { factories: [], products: [] };
  }
}
async function writeStore(d) {
  if (pool) {
    await pool.query(
      `INSERT INTO tbd_state(id, data) VALUES('main', $1)
       ON CONFLICT(id) DO UPDATE SET data=$1, updated_at=now()`,
      [JSON.stringify(d)]
    );
    return;
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2));
}

/* ---------- 接口 ---------- */
app.get("/api/snapshot", async (req, res) => {
  try { res.json(await readStore()); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post("/api/snapshot", async (req, res) => {
  const d = req.body;
  if (!d || !Array.isArray(d.factories) || !Array.isArray(d.products)) {
    return res.status(400).json({ error: "invalid payload" });
  }
  try { await writeStore(d); res.json({ ok: true, at: new Date().toISOString() }); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`TBD Hardware B2B server running: http://localhost:${PORT}`);
  console.log(pool ? "[存储] Postgres 云数据库" : "[存储] 本地文件（data/snapshot.json）");
});
