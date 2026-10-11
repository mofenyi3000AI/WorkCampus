// Where Work@Campus keeps its data.
// - If DATABASE_URL is set (free Neon Postgres), data and photos live in the database
//   and survive restarts, sleeps and redeploys on Render's free plan.
// - If not set (your own laptop), data lives in data/db.json and photos in data/images/.
const fs = require("fs");
const path = require("path");

const EMPTY = () => ({ users: [], gigs: [], replies: [], market: [], plates: [], payments: [], nextId: 1 });
const DIR = path.join(__dirname, "data");
const FILE = path.join(DIR, "db.json");
const IMG_DIR = path.join(DIR, "images");

let pool = null;
let chain = Promise.resolve();

async function init() {
  if (!process.env.DATABASE_URL) {
    console.log("Storage: local file (data/db.json). Set DATABASE_URL to use a free online database.");
    fs.mkdirSync(IMG_DIR, { recursive: true });
    try { return { ...EMPTY(), ...JSON.parse(fs.readFileSync(FILE, "utf8")) }; }
    catch { return EMPTY(); }
  }
  const { Pool } = require("pg");
  const url = process.env.DATABASE_URL;
  const local = /localhost|127\.0\.0\.1|sslmode=disable/.test(url);
  pool = new Pool({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false }, max: 3 });
  await pool.query(`CREATE TABLE IF NOT EXISTS app_state (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS images (
    id TEXT PRIMARY KEY,
    owner INTEGER NOT NULL,
    mime TEXT NOT NULL,
    private BOOLEAN NOT NULL DEFAULT true,
    data BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const r = await pool.query("SELECT data FROM app_state WHERE id = 'main'");
  console.log("Storage: online database");
  return r.rows[0] ? { ...EMPTY(), ...r.rows[0].data } : EMPTY();
}

// Saves run one after another so a slow save can never overwrite a newer one.
function save(db) {
  const snapshot = JSON.stringify(db);
  const job = chain.then(async () => {
    if (pool) {
      await pool.query(
        `INSERT INTO app_state (id, data, updated_at) VALUES ('main', $1::jsonb, now())
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
        [snapshot]
      );
    } else {
      fs.mkdirSync(DIR, { recursive: true });
      fs.writeFileSync(FILE + ".tmp", snapshot);
      fs.renameSync(FILE + ".tmp", FILE);
    }
  });
  chain = job.catch(err => console.error("Save failed:", err.message));
  return job;
}

// ---- Photos ----
async function saveImage(img) { // { id, owner, mime, private, data: Buffer }
  if (pool) {
    await pool.query("INSERT INTO images (id, owner, mime, private, data) VALUES ($1,$2,$3,$4,$5)",
      [img.id, img.owner, img.mime, img.private, img.data]);
  } else {
    fs.writeFileSync(path.join(IMG_DIR, img.id + ".bin"), img.data);
    fs.writeFileSync(path.join(IMG_DIR, img.id + ".json"), JSON.stringify({ owner: img.owner, mime: img.mime, private: img.private }));
  }
}
async function getImage(id) {
  if (!/^[a-f0-9]{24}$/.test(id)) return null;
  if (pool) {
    const r = await pool.query("SELECT owner, mime, private, data FROM images WHERE id = $1", [id]);
    return r.rows[0] || null;
  }
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(IMG_DIR, id + ".json"), "utf8"));
    return { ...meta, data: fs.readFileSync(path.join(IMG_DIR, id + ".bin")) };
  } catch { return null; }
}

module.exports = { init, save, saveImage, getImage };
