require("dotenv").config();
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const store = require("./store");

const PROD = process.env.NODE_ENV === "production";
const PORT = process.env.PORT || 3000;
const BASE_URL = (process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const JWT_SECRET = process.env.JWT_SECRET || (PROD ? null : "dev-only-secret");
if (!JWT_SECRET) { console.error("JWT_SECRET is not set. Add it in your host's environment settings."); process.exit(1); }

// ---- PayFast settings ----
const PF_SANDBOX = process.env.PAYFAST_SANDBOX !== "false";
const PF_MERCHANT_ID = process.env.PAYFAST_MERCHANT_ID || (PF_SANDBOX ? "10000100" : "");
const PF_MERCHANT_KEY = process.env.PAYFAST_MERCHANT_KEY || (PF_SANDBOX ? "46f0cd694581a" : "");
const PF_PASSPHRASE = process.env.PAYFAST_PASSPHRASE || (PF_SANDBOX && !process.env.PAYFAST_MERCHANT_ID ? "jt7NOE43FZPn" : "");
const PF_HOST = PF_SANDBOX ? "https://sandbox.payfast.co.za" : "https://www.payfast.co.za";

// Prices live on the server only, so nobody can change the price in their browser.
const PLANS = {
  "poster-1m": { amount: 39, months: 1, plan: "starter", name: "Work@Campus Poster - 1 month" },
  "pro-1m": { amount: 79, months: 1, plan: "premium", name: "Work@Campus Campus Pro - 1 month" }
};
const FREE_CATS = ["walk", "study"]; // free members can ask for a walking buddy or study partner

let db;
const nid = () => db.nextId++;
const save = () => store.save(db);
const clip = (v, n = 200) => String(v ?? "").trim().slice(0, n);
const now = () => new Date().toISOString();

function activePlan(u) {
  if (!u) return "free";
  if (u.is_admin) return "premium";
  if (u.plan !== "free" && u.plan_until && new Date(u.plan_until) < new Date()) return "free";
  return u.plan || "free";
}

const app = express();
app.set("trust proxy", 1);
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function auth(req, res, next) {
  const token = req.cookies.token || (req.headers.authorization || "").replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Please log in" });
  try { req.user = jwt.verify(token, JWT_SECRET); }
  catch { return res.status(401).json({ error: "Please log in again" }); }
  req.me = db.users.find(u => u.id === req.user.id);
  if (!req.me) return res.status(401).json({ error: "Please log in again" });
  if (req.me.banned) return res.status(403).json({ error: "Account restricted" });
  next();
}
function adminOnly(req, res, next) {
  if (!req.me?.is_admin) return res.status(403).json({ error: "Admin only" });
  next();
}
// ---------- Photos ----------
// The phone shrinks each photo before sending, so they are small (about 100-300 KB).
function sniff(buf) {
  if (buf[0] === 0xFF && buf[1] === 0xD8) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP") return "image/webp";
  return null;
}
app.post("/api/upload", express.json({ limit: "4mb" }), auth, wrap(async (req, res) => {
  const kind = ["card", "selfie", "post"].includes(req.body.kind) ? req.body.kind : null;
  const m = /^data:image\/[a-z]+;base64,(.+)$/.exec(String(req.body.data || ""));
  if (!kind || !m) return res.status(400).json({ error: "Please choose a photo" });
  const data = Buffer.from(m[1], "base64");
  const mime = sniff(data);
  if (!mime) return res.status(400).json({ error: "That file is not a photo" });
  if (data.length > 2.5 * 1024 * 1024) return res.status(400).json({ error: "Photo too big" });
  const id = crypto.randomBytes(12).toString("hex");
  await store.saveImage({ id, owner: req.me.id, mime, private: kind !== "post", data });
  res.json({ id });
}));

app.get("/api/img/:id", wrap(async (req, res) => {
  const img = await store.getImage(req.params.id);
  if (!img) return res.status(404).end();
  if (img.private) {
    let viewer = null;
    try { viewer = db.users.find(u => u.id === jwt.verify(req.cookies.token || "", JWT_SECRET).id); } catch {}
    if (!viewer || (!viewer.is_admin && viewer.id !== img.owner)) return res.status(403).end();
    res.set("Cache-Control", "private, no-store");
  } else res.set("Cache-Control", "public, max-age=86400");
  res.type(img.mime).send(img.data);
}));

app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false }));

function setCookie(res, token) {
  res.cookie("token", token, { httpOnly: true, sameSite: "lax", secure: PROD, maxAge: 30 * 24 * 3600 * 1000 });
}

function publicUser(u) {
  if (!u) return null;
  return { id: u.id, first_name: u.first_name, year: u.year, stay: u.stay, gender: u.gender, role: u.role, plan: activePlan(u), verified: !!u.verified, is_admin: !!u.is_admin };
}
function fullUser(u) {
  return { ...publicUser(u), email: u.email, surname: u.surname, student_number: u.student_number, course: u.course, banned: !!u.banned, plan_until: u.plan_until, verify_status: u.verify_status || "none" };
}

// ---------- Accounts ----------
app.post("/api/auth/register", wrap(async (req, res) => {
  const email = clip(req.body.email, 120).toLowerCase();
  const password = String(req.body.password || "");
  const first_name = clip(req.body.first_name, 60), surname = clip(req.body.surname, 60), student_number = clip(req.body.student_number, 20);
  if (!email || !first_name || !surname || !student_number) return res.status(400).json({ error: "Fill in name, surname, email and student number" });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "Enter a valid email" });
  if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
  if (db.users.some(u => u.email === email)) return res.status(400).json({ error: "Email already registered" });
  const user = {
    id: nid(), email, password_hash: bcrypt.hashSync(password, 10), first_name, surname, student_number,
    course: clip(req.body.course, 80), year: clip(req.body.year, 20), stay: clip(req.body.stay, 20), gender: clip(req.body.gender, 20),
    role: "student", plan: "free", verified: false, banned: false, is_admin: false, created_at: now()
  };
  db.users.push(user); await save();
  const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: "30d" });
  setCookie(res, token);
  res.json({ user: fullUser(user) });
}));

app.post("/api/auth/login", (req, res) => {
  const email = clip(req.body.email, 120).toLowerCase();
  const user = db.users.find(u => u.email === email);
  if (!user || !bcrypt.compareSync(String(req.body.password || ""), user.password_hash)) return res.status(401).json({ error: "Wrong email or password" });
  setCookie(res, jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: "30d" }));
  res.json({ user: fullUser(user) });
});

app.post("/api/auth/logout", (req, res) => { res.clearCookie("token"); res.json({ ok: true }); });
app.get("/api/me", auth, (req, res) => res.json({ user: fullUser(req.me) }));

// Student sends the front of the student card + a selfie. Admin checks and approves.
app.post("/api/me/verify", auth, wrap(async (req, res) => {
  const card = String(req.body.card || ""), selfie = String(req.body.selfie || "");
  for (const id of [card, selfie]) {
    const img = await store.getImage(id);
    if (!img || img.owner !== req.me.id) return res.status(400).json({ error: "Add both photos" });
  }
  Object.assign(req.me, { card_img: card, selfie_img: selfie, verify_status: "pending", verify_sent: now() });
  await save(); res.json({ user: fullUser(req.me) });
}));

app.get("/api/admin/verify", auth, adminOnly, (req, res) => {
  res.json(db.users.filter(u => u.verify_status === "pending").map(u => ({
    id: u.id, name: `${u.first_name} ${u.surname}`, student_number: u.student_number, course: u.course, year: u.year,
    card_img: u.card_img, selfie_img: u.selfie_img, sent: u.verify_sent
  })));
});

app.post("/api/admin/verify/:id", auth, adminOnly, wrap(async (req, res) => {
  const u = db.users.find(x => x.id === Number(req.params.id));
  if (!u) return res.status(404).json({ error: "Not found" });
  const ok = req.body.approve === true;
  u.verified = ok; u.verify_status = ok ? "approved" : "rejected"; u.verify_note = clip(req.body.note, 200);
  await save(); res.json({ ok: true });
}));

// ---------- Gigs (jobs, walks, study) ----------
function viewerIsAdmin(req) {
  try { const id = jwt.verify(req.cookies.token || "", JWT_SECRET).id; return !!db.users.find(u => u.id === id)?.is_admin; }
  catch { return false; }
}

app.get("/api/gigs", (req, res) => {
  const isAdmin = viewerIsAdmin(req);
  const cat = req.query.cat ? String(req.query.cat) : null;
  const list = db.gigs
    .filter(g => g.status !== "removed" && (!cat || g.cat === cat))
    .map(g => {
      const u = db.users.find(x => x.id === g.poster_id) || {};
      const who = u.is_admin ? "Work@Campus team" : u.verified ? `Verified ${u.role === "lecturer" ? "lecturer" : "student"}` : "New member (not verified yet)";
      const label = `${who}${u.year ? " · " + u.year : ""}${u.stay ? " · " + u.stay : ""}`;
      return { ...g, public_label: isAdmin ? `${u.first_name || ""} ${u.surname || ""}`.trim() : label };
    })
    .sort((a, b) => b.id - a.id);
  res.json(list);
});

app.post("/api/gigs", auth, wrap(async (req, res) => {
  const cat = clip(req.body.cat, 20) || "other";
  const isFreeCat = FREE_CATS.includes(cat);
  if (activePlan(req.me) === "free" && !isFreeCat) return res.status(403).json({ error: "Subscribe to post paid jobs" });
  const title = clip(req.body.title, 100);
  const pay = Math.max(0, Math.round(Number(req.body.pay) || 0));
  if (!title) return res.status(400).json({ error: "Say what you need" });
  if (!isFreeCat && pay < 1) return res.status(400).json({ error: "Enter the pay in rand" });
  let photo = null;
  if (req.body.photo) {
    const img = await store.getImage(String(req.body.photo));
    if (img && img.owner === req.me.id && !img.private) photo = String(req.body.photo);
  }
  if (cat === "walk" && !req.me.verified && !req.me.is_admin) return res.status(403).json({ error: "For safety, walk requests are for verified students. Send your student card photo under Me." });
  const gig = { id: nid(), photo, title, detail: clip(req.body.detail, 1000), pay, cat, where_text: clip(req.body.where_text, 100), when_text: clip(req.body.when_text, 100), poster_id: req.me.id, status: "open", created_at: now() };
  db.gigs.push(gig); await save();
  res.json({ id: gig.id });
}));

app.post("/api/gigs/:id/accept", auth, wrap(async (req, res) => {
  const g = db.gigs.find(x => x.id === Number(req.params.id));
  if (!g || g.status !== "open") return res.status(400).json({ error: "This is no longer available" });
  if (g.poster_id === req.me.id) return res.status(400).json({ error: "You posted this one" });
  if (!req.me.verified && !req.me.is_admin) return res.status(403).json({ error: "Get verified first: send your student card photo and a selfie under Me." });
  g.status = "accepted"; g.accepted_by = req.me.id; g.accepted_at = now(); await save();
  res.json({ ok: true });
}));

app.post("/api/gigs/:id/reply", auth, wrap(async (req, res) => {
  const g = db.gigs.find(x => x.id === Number(req.params.id));
  const body = clip(req.body.body, 1000);
  if (!g) return res.status(404).json({ error: "Not found" });
  if (!body) return res.status(400).json({ error: "Write a message first" });
  db.replies.push({ id: nid(), gig_id: g.id, from_user_id: req.me.id, body, created_at: now() });
  await save(); res.json({ ok: true });
}));

app.get("/api/gigs/:id/replies", auth, (req, res) => {
  const g = db.gigs.find(x => x.id === Number(req.params.id));
  if (!g || (!req.me.is_admin && g.poster_id !== req.me.id)) return res.json([]);
  res.json(db.replies.filter(r => r.gig_id === g.id).map(r => {
    const u = db.users.find(x => x.id === r.from_user_id) || {};
    return { id: r.id, body: r.body, created_at: r.created_at, from: req.me.is_admin ? `${u.first_name} ${u.surname}` : `${u.first_name || "Student"}` };
  }));
});

app.post("/api/admin/gigs/:id/remove", auth, adminOnly, wrap(async (req, res) => {
  const g = db.gigs.find(x => x.id === Number(req.params.id));
  if (g) { g.status = "removed"; await save(); }
  res.json({ ok: true });
}));

// ---------- Food bank (quiet plates) ----------
app.post("/api/plates", auth, wrap(async (req, res) => {
  const p = { id: nid(), need: clip(req.body.need, 100), note: clip(req.body.note, 500), user_id: req.me.id, status: "open", created_at: now() };
  db.plates.push(p); await save(); res.json({ id: p.id });
}));

app.get("/api/plates/mine", auth, (req, res) => {
  res.json(db.plates.filter(p => p.user_id === req.me.id).map(p => ({ id: p.id, need: p.need, status: p.status, created_at: p.created_at })));
});

app.get("/api/admin/plates", auth, adminOnly, (req, res) => {
  res.json(db.plates.map(p => {
    const u = db.users.find(x => x.id === p.user_id) || {};
    return { ...p, first_name: u.first_name, surname: u.surname, student_number: u.student_number };
  }).sort((a, b) => b.id - a.id));
});

app.post("/api/admin/plates/:id/done", auth, adminOnly, wrap(async (req, res) => {
  const p = db.plates.find(x => x.id === Number(req.params.id));
  if (p) { p.status = "helped"; await save(); }
  res.json({ ok: true });
}));

// ---------- Market ----------
app.get("/api/market", (req, res) => res.json(db.market.filter(m => m.status === "live")));

app.post("/api/market", auth, wrap(async (req, res) => {
  if (activePlan(req.me) === "free") return res.status(403).json({ error: "Subscribe to sell" });
  const title = clip(req.body.title, 100);
  if (!title) return res.status(400).json({ error: "Add a title" });
  const m = { id: nid(), title, description: clip(req.body.description, 1000), price: Math.max(0, Number(req.body.price) || 0), seller_id: req.me.id, status: "pending", created_at: now() };
  db.market.push(m); await save(); res.json({ id: m.id });
}));

app.post("/api/admin/market/:id/approve", auth, adminOnly, wrap(async (req, res) => {
  const m = db.market.find(x => x.id === Number(req.params.id));
  if (m) { m.status = "live"; await save(); }
  res.json({ ok: true });
}));

// ---------- PayFast ----------
// Encoding follows PayFast's own Node.js example. For names we strip unusual characters
// so the signature is the same however PayFast encodes them.
const pfEncode = (v, strict) => {
  let out = encodeURIComponent(String(v).trim());
  if (strict) out = out.replace(/[!'()*~]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  return out.replace(/%20/g, "+");
};
const pfSafe = v => String(v || "").replace(/[^A-Za-z0-9 .@_+-]/g, "").trim();
function pfParamString(pairs, strict) {
  return pairs.filter(([k, v]) => k !== "signature" && v !== undefined && v !== null && String(v) !== "")
    .map(([k, v]) => `${k}=${pfEncode(v, strict)}`).join("&");
}
function pfSignature(pairs, strict) {
  let s = pfParamString(pairs, strict);
  if (PF_PASSPHRASE) s += `&passphrase=${pfEncode(PF_PASSPHRASE, strict)}`;
  return crypto.createHash("md5").update(s).digest("hex");
}

app.post("/api/payfast/checkout", auth, (req, res) => {
  const key = String(req.body.item || "");
  const plan = PLANS[key];
  if (!plan) return res.status(400).json({ error: "Unknown plan" });
  if (!PF_MERCHANT_ID || !PF_MERCHANT_KEY) return res.status(503).json({ error: "Payments are not switched on yet" });
  const pairs = [
    ["merchant_id", PF_MERCHANT_ID],
    ["merchant_key", PF_MERCHANT_KEY],
    ["return_url", `${BASE_URL}/?paid=1`],
    ["cancel_url", `${BASE_URL}/?paid=0`],
    ["notify_url", `${BASE_URL}/api/payfast/notify`],
    ["name_first", pfSafe(req.me.first_name)],
    ["name_last", pfSafe(req.me.surname)],
    ["email_address", pfSafe(req.me.email)],
    ["m_payment_id", `u${req.me.id}-${key}-${Date.now()}`],
    ["amount", plan.amount.toFixed(2)],
    ["item_name", plan.name]
  ].filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== "");
  const params = Object.fromEntries(pairs);
  params.signature = pfSignature(pairs);
  res.json({ url: `${PF_HOST}/eng/process`, params });
});

// PayFast tells the server when a payment really went through (ITN).
// We check the signature, ask PayFast to confirm, and check the amount before upgrading anyone.
app.post("/api/payfast/notify", wrap(async (req, res) => {
  res.status(200).send("OK"); // PayFast needs a quick 200
  const pairs = Object.entries(req.body || {});
  const data = Object.fromEntries(pairs);
  try {
    if (data.signature !== pfSignature(pairs) && data.signature !== pfSignature(pairs, true)) return console.warn("PayFast ITN: bad signature");
    if (data.merchant_id !== PF_MERCHANT_ID) return console.warn("PayFast ITN: wrong merchant");
    const check = await fetch(`${PF_HOST}/eng/query/validate`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: pfParamString(pairs)
    });
    if ((await check.text()).trim() !== "VALID") return console.warn("PayFast ITN: PayFast did not confirm");
    if (data.payment_status !== "COMPLETE") return;
    if (db.payments.some(p => p.pf_payment_id === data.pf_payment_id)) return; // already handled

    const m = /^u(\d+)-([a-z0-9-]+?)-\d+$/.exec(data.m_payment_id || "");
    const plan = m && PLANS[m[2]];
    const user = m && db.users.find(u => u.id === Number(m[1]));
    if (!plan || !user) return console.warn("PayFast ITN: unknown user or plan", data.m_payment_id);
    if (Math.abs(parseFloat(data.amount_gross) - plan.amount) > 0.01) return console.warn("PayFast ITN: amount mismatch");

    const start = user.plan_until && new Date(user.plan_until) > new Date() ? new Date(user.plan_until) : new Date();
    start.setMonth(start.getMonth() + plan.months);
    user.plan = plan.plan; user.plan_until = start.toISOString();
    db.payments.push({ id: nid(), user_id: user.id, pf_payment_id: data.pf_payment_id, amount: plan.amount, item: m[2], status: "COMPLETE", created_at: now() });
    await save();
    console.log(`PayFast: user ${user.id} upgraded to ${plan.plan} until ${user.plan_until}`);
  } catch (e) { console.error("PayFast ITN error:", e.message); }
}));

app.get("/api/admin/payments", auth, adminOnly, (req, res) => res.json(db.payments.slice().reverse()));
app.get("/api/health", (req, res) => res.json({ ok: true }));

app.use((err, req, res, next) => {
  console.error(err);
  if (!res.headersSent) res.status(500).json({ error: "Something went wrong. Please try again." });
});

(async () => {
  db = await store.init();
  const adminEmail = (process.env.ADMIN_EMAIL || "admin@ul.ac.za").toLowerCase();
  let admin = db.users.find(u => u.is_admin);
  if (!admin) {
    if (PROD && !process.env.ADMIN_PASSWORD) console.warn("ADMIN_PASSWORD is not set - using a temporary password. Set it in your host settings.");
    admin = { id: nid(), email: adminEmail, first_name: "Admin", surname: "Desk", role: "admin", is_admin: true, verified: true, plan: "premium", banned: false, created_at: now() };
    db.users.push(admin);
  }
  // Setting ADMIN_PASSWORD in the host always resets the admin password - handy if you forget it.
  if (process.env.ADMIN_PASSWORD || !admin.password_hash) {
    admin.email = adminEmail;
    admin.password_hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD || "admin123", 10);
  }
  await save();
  app.listen(PORT, () => console.log(`Work@Campus running on ${BASE_URL} (PayFast ${PF_SANDBOX ? "sandbox/test" : "LIVE"})`));
})().catch(e => { console.error("Could not start:", e.message); process.exit(1); });
