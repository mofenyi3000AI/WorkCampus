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
// Set PAYFAST_PASSPHRASE=none if your PayFast account has no passphrase.
const PF_PASS_RAW = (process.env.PAYFAST_PASSPHRASE || "").trim();
const PF_PASSPHRASE = PF_PASS_RAW.toLowerCase() === "none" ? "" : (PF_PASS_RAW || (PF_SANDBOX && !process.env.PAYFAST_MERCHANT_ID ? "jt7NOE43FZPn" : ""));
const PF_HOST = PF_SANDBOX ? "https://sandbox.payfast.co.za" : "https://www.payfast.co.za";
// Automatic monthly renewal (PayFast subscriptions). PayFast only allows this when the account has a passphrase
// and "Recurring Billing" is switched on in PayFast. So it stays off until PAYFAST_RECURRING=true is set.
const PF_RECURRING = process.env.PAYFAST_RECURRING === "true" && !!PF_PASSPHRASE;
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || process.env.ADMIN_EMAIL || "";
// Work@Campus business WhatsApp (international format, no +). Shown as "WhatsApp us" buttons.
// Name shown to members and businesses as their contact person.
const CONTACT_NAME = process.env.CONTACT_NAME || "Koos Becker";
const CONTACT_ROLE = process.env.CONTACT_ROLE || "Operations Manager";
const CONTACT_WHATSAPP = (process.env.CONTACT_WHATSAPP || "27615851542").replace(/\D/g, "");

// Prices live on the server only, so nobody can change the price in their browser.
const PLANS = {
  "poster-1m": { amount: 39, months: 1, plan: "starter", name: "Work@Campus Poster - 1 month" },
  "pro-1m": { amount: 79, months: 1, plan: "premium", name: "Work@Campus Campus Pro - 1 month" },
  // For shops, landlords and employers who want to reach students. Includes featured posts.
  "biz-1m": { amount: 499, months: 1, plan: "business", name: "Work@Campus Business - 1 month" },
  // One-off: put one of your job posts at the top of the list for 7 days.
  "feature-7d": { amount: 29, days: 7, feature: true, name: "Work@Campus Featured post - 7 days" }
};
const SELLER_PLANS = ["premium", "business"];
const GOAL = 300000;
const AMBASSADOR_PCT = 20;       // ambassadors earn this % of what the people they invited pay...
const AMBASSADOR_MONTHS = 12;    // ...for this many months after those people join
const DEFAULT_CAMPUSES = [{ slug: "ul", name: "University of Limpopo", short: "UL" }];
const campuses = () => (db.campuses?.length ? db.campuses : DEFAULT_CAMPUSES);
const campusOf = (slug) => campuses().find(c => c.slug === slug) || null;
const userCampus = (u) => u?.campus || "ul"; // the owner's monthly income goal in rand (shown on the admin desk)
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
app.use(express.static(path.join(__dirname, "public"), { index: false }));

// ---------- Share links with WhatsApp / Facebook previews ----------
// workcampus.onrender.com/ul opens the app for that campus.  /r/CODE is an ambassador's invite link.
const fs = require("fs");
const INDEX_HTML = fs.readFileSync(path.join(__dirname, "public", "index.html"), "utf8");
const escHtml = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function sendIndex(res, campus) {
  const name = campus ? campus.name : "your campus";
  const title = `Work@Campus · ${campus ? campus.short || campus.name : "Student jobs"}`;
  const desc = `Earn money with student jobs, find a study partner, walk home safely, buy and sell, and get a plate of food quietly. Free for ${name} students.`;
  const tags = `<meta property="og:type" content="website" />
  <meta property="og:site_name" content="Work@Campus" />
  <meta property="og:title" content="${escHtml(title)}: jobs, safe walks, market and food bank" />
  <meta property="og:description" content="${escHtml(desc)}" />
  <meta property="og:image" content="${BASE_URL}/assets/friends.jpg" />
  <meta property="og:url" content="${BASE_URL}/${campus ? campus.slug : ""}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="wc-campus" content="${campus ? campus.slug : ""}" />`;
  res.set("Cache-Control", "no-cache").type("html").send(INDEX_HTML.replace("</head>", tags + "\n</head>"));
}

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
// Only the owner can change who has access, add campuses or record ambassador payouts.
function ownerOnly(req, res, next) {
  if (!req.me?.owner) return res.status(403).json({ error: "Only the owner can do this" });
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
  const amb = u.ambassador ? ambassadorSummary(u) : null;
  const ended = u.plan && u.plan !== "free" && activePlan(u) === "free";
  return { ...publicUser(u), owner: !!u.owner, campus: userCampus(u), ambassador: amb, plan_ended: ended ? u.plan : null, sub_status: u.sub_status || null, business_name: u.business_name, phone: u.phone, email: u.email, surname: u.surname, student_number: u.student_number, course: u.course, banned: !!u.banned, plan_until: u.plan_until, verify_status: u.verify_status || "none" };
}

// ---------- Accounts ----------
app.post("/api/auth/register", wrap(async (req, res) => {
  const email = clip(req.body.email, 120).toLowerCase();
  const password = String(req.body.password || "");
  const first_name = clip(req.body.first_name, 60), surname = clip(req.body.surname, 60), student_number = clip(req.body.student_number, 20);
  const isBiz = req.body.account_type === "business";
  const business_name = clip(req.body.business_name, 80), phone = clip(req.body.phone, 20);
  if (isBiz) {
    if (!email || !first_name || !surname || !business_name || !phone) return res.status(400).json({ error: "Fill in your name, business name, phone and email" });
  } else if (!email || !first_name || !surname || !student_number) return res.status(400).json({ error: "Fill in name, surname, email and student number" });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "Enter a valid email" });
  if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
  if (db.users.some(u => u.email === email)) return res.status(400).json({ error: "Email already registered" });
  const user = {
    id: nid(), email, password_hash: bcrypt.hashSync(password, 10), first_name, surname, student_number,
    course: clip(req.body.course, 80), year: clip(req.body.year, 20), stay: clip(req.body.stay, 20), gender: clip(req.body.gender, 20),
    campus: campusOf(String(req.body.campus || "")) ? String(req.body.campus) : "ul",
    referred_by: db.users.find(u => u.ambassador && u.ref_code && u.ref_code === String(req.cookies.ref || "").toUpperCase())?.id,
    role: isBiz ? "business" : "student", business_name: isBiz ? business_name : undefined, phone: phone || undefined,
    plan: "free", verified: false, banned: false, is_admin: false, created_at: now()
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
  // Privacy: once admin has decided, the student card and selfie are deleted. We only keep the result.
  for (const id of [u.card_img, u.selfie_img]) if (id) await store.deleteImage(id).catch(() => {});
  u.card_img = u.selfie_img = undefined;
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
  const campus = campusOf(String(req.query.campus || "")) ? String(req.query.campus) : "ul";
  const list = db.gigs
    .filter(g => g.status !== "removed" && (!cat || g.cat === cat) && (g.campus || "ul") === campus)
    .map(g => {
      const u = db.users.find(x => x.id === g.poster_id) || {};
      const who = u.is_admin ? "Work@Campus team" : u.role === "business" ? `Business · ${u.business_name || ""}` : u.verified ? `Verified ${u.role === "lecturer" ? "lecturer" : "student"}` : "New member (not verified yet)";
      const label = `${who}${u.year ? " · " + u.year : ""}${u.stay ? " · " + u.stay : ""}`;
      const featured = g.status === "open" && ((g.featured_until && new Date(g.featured_until) > new Date()) || (u.role === "business" && activePlan(u) === "business"));
      return { ...g, featured, public_label: isAdmin ? `${u.first_name || ""} ${u.surname || ""}`.trim() : label };
    })
    .sort((a, b) => (b.featured - a.featured) || (b.id - a.id));
  res.json(list);
});

app.post("/api/gigs", auth, wrap(async (req, res) => {
  const cat = clip(req.body.cat, 20) || "other";
  if (req.me.role === "business" && FREE_CATS.includes(cat)) return res.status(400).json({ error: "Walk and study posts are for students" });
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
  const gig = { id: nid(), photo, title, detail: clip(req.body.detail, 1000), pay, cat, where_text: clip(req.body.where_text, 100), when_text: clip(req.body.when_text, 100), poster_id: req.me.id, campus: userCampus(req.me), status: "open", created_at: now() };
  db.gigs.push(gig); await save();
  res.json({ id: gig.id });
}));

app.post("/api/gigs/:id/accept", auth, wrap(async (req, res) => {
  const g = db.gigs.find(x => x.id === Number(req.params.id));
  if (!g || g.status !== "open") return res.status(400).json({ error: "This is no longer available" });
  if (g.poster_id === req.me.id) return res.status(400).json({ error: "You posted this one" });
  if (!req.me.verified && !req.me.is_admin) return res.status(403).json({ error: "Get verified first: send your student card photo and a selfie under Me." });
  g.status = "accepted"; g.accepted_by = req.me.id; g.accepted_at = now();
  db.replies.push({ id: nid(), kind: "gig", gig_id: g.id, from_user_id: req.me.id, to_user_id: g.poster_id,
    body: g.cat === "walk" || g.cat === "study" ? "I'll join you. Let's arrange the details here." : "I've accepted this job. Let's arrange the details here.", created_at: now() });
  await save();
  res.json({ ok: true });
}));

// ---------- Private messages (two-way) ----------
// Each post has one private thread per person who writes to the owner.
// The owner can answer each person; others only ever see their own thread.
// Works for job/walk/study posts (gig) and market items (market).
const KINDS = {
  gig: { list: () => db.gigs, owner: "poster_id" },
  market: { list: () => db.market, owner: "seller_id" }
};
const nameOf = (id) => db.users.find(u => u.id === id)?.first_name || "Student";
function msgRoutes(kind) {
  const K = KINDS[kind];
  const find = (id) => K.list().find(x => x.id === Number(id) && x.status !== "removed");
  const isMsgFor = (r, item) => (r.kind || "gig") === kind && r.gig_id === item.id;
  app.post(`/api/${kind === "gig" ? "gigs" : "market"}/:id/reply`, auth, wrap(async (req, res) => {
    const item = find(req.params.id);
    const body = clip(req.body.body, 1000);
    if (!item) return res.status(404).json({ error: "Not found" });
    if (!body) return res.status(400).json({ error: "Write a message first" });
    const owner = item[K.owner];
    let to = owner;
    if (req.me.id === owner) {
      to = Number(req.body.to);
      const wrote = db.replies.some(r => isMsgFor(r, item) && r.from_user_id === to);
      if (!to || to === owner || !wrote) return res.status(400).json({ error: "Choose who to answer" });
    }
    db.replies.push({ id: nid(), kind, gig_id: item.id, from_user_id: req.me.id, to_user_id: to, body, created_at: now() });
    await save(); res.json({ ok: true });
  }));
  app.get(`/api/${kind === "gig" ? "gigs" : "market"}/:id/replies`, auth, (req, res) => {
    const item = find(req.params.id);
    if (!item) return res.json([]);
    const owner = item[K.owner], seeAll = req.me.is_admin || req.me.id === owner;
    res.json(db.replies.filter(r => isMsgFor(r, item)).map(r => ({ ...r, to_user_id: r.to_user_id || owner }))
      .filter(r => seeAll || r.from_user_id === req.me.id || r.to_user_id === req.me.id)
      .map(r => {
        const other = r.from_user_id === owner ? r.to_user_id : r.from_user_id; // the non-owner in this thread
        const u = db.users.find(x => x.id === r.from_user_id) || {};
        return { id: r.id, body: r.body, created_at: r.created_at, mine: r.from_user_id === req.me.id, thread: other, thread_name: nameOf(other),
          from: req.me.is_admin ? `${u.first_name || ""} ${u.surname || ""}`.trim() : (u.first_name || "Student") };
      }));
  });
}
msgRoutes("gig");
msgRoutes("market");

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
    return { ...p, first_name: u.first_name, surname: u.surname, student_number: u.student_number, email: u.email, phone: u.phone };
  }).sort((a, b) => b.id - a.id));
});

app.post("/api/admin/plates/:id/done", auth, adminOnly, wrap(async (req, res) => {
  const p = db.plates.find(x => x.id === Number(req.params.id));
  if (p) { p.status = "helped"; await save(); }
  res.json({ ok: true });
}));

// ---------- Market (Campus Pro sellers; admin approves each item) ----------
function marketView(m, viewer) {
  const u = db.users.find(x => x.id === m.seller_id) || {};
  const who = u.is_admin ? "Work@Campus team" : u.verified ? "Verified student" : "New member (not verified yet)";
  return { id: m.id, title: m.title, description: m.description, price: m.price, photo: m.photo || null, status: m.status, created_at: m.created_at,
    seller_id: m.seller_id, mine: !!viewer && viewer.id === m.seller_id,
    public_label: viewer?.is_admin ? `${u.first_name || ""} ${u.surname || ""}`.trim() : `${who}${u.stay ? " · " + u.stay : ""}` };
}
app.get("/api/market", (req, res) => {
  let viewer = null;
  try { viewer = db.users.find(u => u.id === jwt.verify(req.cookies.token || "", JWT_SECRET).id) || null; } catch {}
  res.json(db.market
    .filter(m => (m.campus || "ul") === (campusOf(String(req.query.campus || "")) ? String(req.query.campus) : "ul"))
    .filter(m => m.status === "live" || m.status === "sold" || (viewer && (viewer.is_admin || viewer.id === m.seller_id) && m.status !== "removed"))
    .sort((a, b) => b.id - a.id).map(m => marketView(m, viewer)));
});

app.post("/api/market", auth, wrap(async (req, res) => {
  if (!SELLER_PLANS.includes(activePlan(req.me))) return res.status(403).json({ error: "Selling is part of Campus Pro (R79) or Business (R499)" });
  const title = clip(req.body.title, 100);
  if (!title) return res.status(400).json({ error: "Add a title" });
  const price = Math.round(Number(req.body.price));
  if (!(price >= 1 && price <= 100000)) return res.status(400).json({ error: "Enter the price in rand" });
  let photo = null;
  if (req.body.photo) {
    const img = await store.getImage(String(req.body.photo));
    if (img && img.owner === req.me.id && !img.private) photo = String(req.body.photo);
  }
  const m = { id: nid(), title, description: clip(req.body.description, 1000), price, photo, seller_id: req.me.id, campus: userCampus(req.me),
    status: req.me.is_admin ? "live" : "pending", created_at: now() };
  db.market.push(m); await save(); res.json({ id: m.id, status: m.status });
}));

app.post("/api/market/:id/sold", auth, wrap(async (req, res) => {
  const m = db.market.find(x => x.id === Number(req.params.id));
  if (!m || (m.seller_id !== req.me.id && !req.me.is_admin)) return res.status(404).json({ error: "Not found" });
  m.status = "sold"; await save(); res.json({ ok: true });
}));

app.post("/api/admin/market/:id/:action", auth, adminOnly, wrap(async (req, res) => {
  const m = db.market.find(x => x.id === Number(req.params.id));
  const to = { approve: "live", remove: "removed" }[req.params.action];
  if (!m || !to) return res.status(404).json({ error: "Not found" });
  m.status = to; await save(); res.json({ ok: true });
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
  let ref = `u${req.me.id}-${key}-${Date.now()}`;
  if (plan.feature) {
    const g = db.gigs.find(x => x.id === Number(req.body.gig));
    if (!g || g.poster_id !== req.me.id || g.status !== "open" || FREE_CATS.includes(g.cat)) return res.status(400).json({ error: "You can feature your own open job posts" });
    ref = `u${req.me.id}-${key}-g${g.id}-${Date.now()}`;
  }
  if (!PF_MERCHANT_ID || !PF_MERCHANT_KEY) return res.status(503).json({ error: "Payments are not switched on yet" });
  // Promo code: discount on the first payment only.
  let amount = plan.amount, code = null;
  if (req.body.code) {
    const p = findPromo(req.body.code);
    if (!p) return res.status(400).json({ error: "That code is not valid" });
    if (p.plans?.length && !p.plans.includes(key)) return res.status(400).json({ error: "That code is not for this plan" });
    amount = Math.max(5, Math.round(plan.amount * (100 - p.pct)) / 100); code = p.code;
  }
  const recurring = PF_RECURRING && !!plan.months;
  db.checkouts = Object.fromEntries(Object.entries(db.checkouts || {}).filter(([, c]) => c.used || Date.now() - new Date(c.created_at) < 3 * 864e5));
  db.checkouts[ref] = { user_id: req.me.id, item: key, amount, code, recurring, created_at: now() };
  const pairs = [
    ["merchant_id", PF_MERCHANT_ID],
    ["merchant_key", PF_MERCHANT_KEY],
    ["return_url", `${BASE_URL}/?paid=1`],
    ["cancel_url", `${BASE_URL}/?paid=0`],
    ["notify_url", `${BASE_URL}/api/payfast/notify`],
    ["name_first", pfSafe(req.me.first_name)],
    ["name_last", pfSafe(req.me.surname)],
    ["email_address", pfSafe(req.me.email)],
    ["m_payment_id", ref],
    ["amount", amount.toFixed(2)],
    ["item_name", plan.name],
    // PayFast needs these after the item fields, in this order.
    ...(recurring ? [["subscription_type", "1"], ["recurring_amount", plan.amount.toFixed(2)], ["frequency", "3"], ["cycles", "0"]] : [])
  ].filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== "");
  const params = Object.fromEntries(pairs);
  params.signature = pfSignature(pairs);
  save();
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
    if (data.payment_status === "CANCELLED" && data.token) { // subscription stopped (by the student, admin or PayFast)
      const u = db.users.find(x => x.sub_token === data.token);
      if (u) { u.sub_status = "cancelled"; await save(); }
      return;
    }
    if (data.payment_status !== "COMPLETE") return;
    if (db.payments.some(p => p.pf_payment_id === data.pf_payment_id)) return; // already handled

    await applyPayment(data);
  } catch (e) { console.error("PayFast ITN error:", e.message); }
}));

// Runs only after PayFast has confirmed a payment. Switches on the plan or the featured post.
async function applyPayment(data) {
  const ref = data.m_payment_id || "";
  const f = /^u(\d+)-(feature-7d)-g(\d+)-\d+$/.exec(ref);
  const m = f || /^u(\d+)-([a-z0-9-]+?)-\d+$/.exec(ref);
  const plan = m && PLANS[m[2]];
  const user = m && db.users.find(u => u.id === Number(m[1]));
  if (!plan || !user) return console.warn("PayFast ITN: unknown user or plan", ref);
  // First payment must match what we asked for at checkout (may include a promo discount).
  // Later automatic renewals reuse the same reference and must be the full price.
  const checkout = db.checkouts?.[ref];
  const renewal = db.payments.some(p => p.ref === ref);
  const expected = renewal || !checkout ? plan.amount : checkout.amount;
  if (Math.abs(parseFloat(data.amount_gross) - expected) > 0.01) return console.warn("PayFast ITN: amount mismatch");
  if (checkout && !renewal) {
    checkout.used = true;
    if (checkout.code) { const p = findPromo(checkout.code, true); if (p) p.uses = (p.uses || 0) + 1; }
  }
  if (data.token && plan.months) { user.sub_token = data.token; user.sub_status = "active"; user.sub_item = m[2]; }
  if (plan.feature) {
    const g = db.gigs.find(x => x.id === Number(f[3]) && x.poster_id === user.id);
    if (!g) return console.warn("PayFast ITN: post not found for feature", ref);
    const from = g.featured_until && new Date(g.featured_until) > new Date() ? new Date(g.featured_until) : new Date();
    g.featured_until = new Date(from.getTime() + plan.days * 864e5).toISOString();
  } else {
    // Keep paid-up time when renewing the same plan; switching plans starts a fresh month.
    const same = user.plan === plan.plan && user.plan_until && new Date(user.plan_until) > new Date();
    const start = same ? new Date(user.plan_until) : new Date();
    start.setMonth(start.getMonth() + plan.months);
    user.plan = plan.plan; user.plan_until = start.toISOString();
  }
  db.payments.push({ id: nid(), user_id: user.id, pf_payment_id: data.pf_payment_id, ref, amount: expected, item: m[2], renewal, code: (!renewal && checkout?.code) || undefined, status: "COMPLETE", created_at: now() });
  const amb = user.referred_by && db.users.find(u => u.id === user.referred_by && u.ambassador);
  if (amb && Date.now() - new Date(user.created_at) < AMBASSADOR_MONTHS * 31 * 864e5) {
    db.commissions = db.commissions || [];
    db.commissions.push({ id: nid(), ambassador_id: amb.id, user_id: user.id, pf_payment_id: data.pf_payment_id, amount: Math.round(expected * AMBASSADOR_PCT) / 100, created_at: now() });
  }
  await save();
  console.log(`PayFast: user ${user.id} paid for ${m[2]}`);
}
// Test-only shortcut to simulate a confirmed payment. Never set WC_TEST_HOOKS on a real server.
if (process.env.WC_TEST_HOOKS === "1" && !PROD) app.post("/api/test/paid", wrap(async (req, res) => { await applyPayment(req.body); res.json({ ok: true }); }));

// ---------- Stop automatic renewal ----------
// PayFast API signature: all header and body values plus the passphrase, sorted by name.
function pfApiSignature(fields) {
  const all = { ...fields, passphrase: PF_PASSPHRASE };
  return crypto.createHash("md5").update(Object.keys(all).sort().map(k => `${k}=${encodeURIComponent(String(all[k]).trim()).replace(/%20/g, "+")}`).join("&")).digest("hex");
}
app.post("/api/me/stop-renewal", auth, wrap(async (req, res) => {
  if (!req.me.sub_token || req.me.sub_status !== "active") return res.status(400).json({ error: "You have no automatic renewal" });
  const headers = { "merchant-id": PF_MERCHANT_ID, version: "v1", timestamp: new Date().toISOString().replace(/\.\d+Z$/, "") };
  headers.signature = pfApiSignature(headers);
  const r = await fetch(`https://api.payfast.co.za/subscriptions/${encodeURIComponent(req.me.sub_token)}/cancel${PF_SANDBOX ? "?testing=true" : ""}`, { method: "PUT", headers });
  if (!r.ok) { console.warn("PayFast cancel failed:", r.status, await r.text().catch(() => "")); return res.status(502).json({ error: "Could not stop it right now. Please try again later or contact admin." }); }
  req.me.sub_status = "cancelled"; await save();
  res.json({ user: fullUser(req.me) });
}));

// ---------- Campuses ----------
app.get("/api/campuses", (req, res) => res.json(campuses()));
app.post("/api/admin/campuses", auth, ownerOnly, wrap(async (req, res) => {
  const slug = clip(req.body.slug, 12).toLowerCase().replace(/[^a-z0-9]/g, ""), name = clip(req.body.name, 80), short = clip(req.body.short, 12);
  if (!slug || !name) return res.status(400).json({ error: "Enter a short link name (e.g. univen) and the full name" });
  if (RESERVED.includes(slug)) return res.status(400).json({ error: "Choose another short name" });
  db.campuses = campuses().slice();
  if (db.campuses.some(c => c.slug === slug)) return res.status(400).json({ error: "That campus already exists" });
  db.campuses.push({ slug, name, short: short || slug.toUpperCase() });
  await save(); res.json(db.campuses);
}));

// ---------- Team: extra admins (office admin) and ambassadors ----------
function ambassadorSummary(u) {
  const invited = db.users.filter(x => x.referred_by === u.id);
  const earned = (db.commissions || []).filter(c => c.ambassador_id === u.id).reduce((a, c) => a + c.amount, 0);
  const paid = (db.payouts || []).filter(p => p.ambassador_id === u.id).reduce((a, p) => a + p.amount, 0);
  return { code: u.ref_code, link: `${BASE_URL}/r/${u.ref_code}`, invited: invited.length,
    paying: invited.filter(x => activePlan(x) !== "free").length, earned: Math.round(earned * 100) / 100, paid, owed: Math.round((earned - paid) * 100) / 100, pct: AMBASSADOR_PCT };
}
function makeRefCode(u) {
  const base = String(u.first_name || "AMB").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 8) || "AMB";
  let code; do { code = base + Math.floor(100 + Math.random() * 900); } while (db.users.some(x => x.ref_code === code));
  return code;
}
app.get("/api/admin/team", auth, adminOnly, (req, res) => {
  res.json(db.users.filter(u => (u.is_admin || u.ambassador) && !u.deleted_at).map(u => ({
    id: u.id, name: `${u.first_name} ${u.surname || ""}`.trim(), email: u.email, campus: userCampus(u), owner: !!u.owner,
    admin: !!u.is_admin, ambassador: u.ambassador ? ambassadorSummary(u) : null })));
});
app.post("/api/admin/team", auth, ownerOnly, wrap(async (req, res) => {
  const u = db.users.find(x => x.email === clip(req.body.email, 120).toLowerCase() && !x.deleted_at);
  if (!u) return res.status(404).json({ error: "No account with that email. Ask them to join first." });
  const role = String(req.body.role || "");
  if (u.owner && role !== "ambassador") return res.status(400).json({ error: "The owner account cannot be changed" });
  if (role === "admin") { u.is_admin = true; u.verified = true; }
  else if (role === "ambassador") { u.ambassador = true; u.ref_code = u.ref_code || makeRefCode(u); }
  else if (role === "remove-admin") { if (u.id === req.me.id) return res.status(400).json({ error: "You cannot remove yourself" }); u.is_admin = false; }
  else if (role === "remove-ambassador") u.ambassador = false;
  else return res.status(400).json({ error: "Unknown role" });
  await save(); res.json({ ok: true });
}));
// Record that an ambassador's commission was paid out (e.g. by EFT).
app.post("/api/admin/team/:id/paid", auth, ownerOnly, wrap(async (req, res) => {
  const u = db.users.find(x => x.id === Number(req.params.id) && x.ambassador);
  if (!u) return res.status(404).json({ error: "Not found" });
  const owed = ambassadorSummary(u).owed;
  if (owed <= 0) return res.status(400).json({ error: "Nothing owed" });
  db.payouts = db.payouts || [];
  db.payouts.push({ id: nid(), ambassador_id: u.id, amount: owed, by: req.me.id, created_at: now() });
  await save(); res.json({ ok: true, paid: owed });
}));

// Invite link: remembers who invited this person for 60 days, then opens their campus.
app.get("/r/:code", (req, res) => {
  const amb = db.users.find(u => u.ambassador && u.ref_code === String(req.params.code).toUpperCase());
  if (amb) res.cookie("ref", amb.ref_code, { httpOnly: true, sameSite: "lax", secure: PROD, maxAge: 60 * 864e5 });
  sendIndex(res, campusOf(userCampus(amb)) || campuses()[0]);
});

// ---------- Forgotten password: admin makes a temporary one and sends it to the member ----------
app.post("/api/admin/reset-password", auth, adminOnly, wrap(async (req, res) => {
  const u = db.users.find(x => x.email === clip(req.body.email, 120).toLowerCase() && !x.deleted_at);
  if (!u) return res.status(404).json({ error: "No account with that email" });
  if ((u.is_admin || u.owner) && !req.me.owner) return res.status(403).json({ error: "Only the owner can reset an admin's password" });
  const temp = "wc-" + crypto.randomBytes(4).toString("hex");
  u.password_hash = bcrypt.hashSync(temp, 10); await save();
  res.json({ name: `${u.first_name} ${u.surname || ""}`.trim(), temp });
}));
app.post("/api/me/password", auth, wrap(async (req, res) => {
  if (!bcrypt.compareSync(String(req.body.old || ""), req.me.password_hash)) return res.status(400).json({ error: "Your current password is wrong" });
  if (String(req.body.password || "").length < 6) return res.status(400).json({ error: "New password must be at least 6 characters" });
  req.me.password_hash = bcrypt.hashSync(String(req.body.password), 10); await save(); res.json({ ok: true });
}));

// ---------- Promo codes (e.g. LAUNCH50 = 50% off the first payment) ----------
function findPromo(code, any) {
  const c = String(code || "").trim().toUpperCase();
  return (db.promos || []).find(p => p.code === c && (any || (p.active && (!p.max || (p.uses || 0) < p.max))));
}
app.get("/api/admin/promos", auth, ownerOnly, (req, res) => res.json(db.promos || []));
app.post("/api/admin/promos", auth, ownerOnly, wrap(async (req, res) => {
  const code = clip(req.body.code, 20).toUpperCase().replace(/[^A-Z0-9]/g, "");
  const pct = Math.round(Number(req.body.pct));
  if (!code || !(pct >= 1 && pct <= 90)) return res.status(400).json({ error: "Enter a code and a discount from 1 to 90%" });
  db.promos = db.promos || [];
  if (db.promos.some(p => p.code === code)) return res.status(400).json({ error: "That code already exists" });
  const plans = Array.isArray(req.body.plans) ? req.body.plans.filter(k => PLANS[k]) : [];
  db.promos.push({ code, pct, max: Math.max(0, Math.round(Number(req.body.max) || 0)), plans, uses: 0, active: true, created_at: now() });
  await save(); res.json(db.promos);
}));
app.post("/api/admin/promos/:code/toggle", auth, ownerOnly, wrap(async (req, res) => {
  const p = findPromo(req.params.code, true);
  if (!p) return res.status(404).json({ error: "Not found" });
  p.active = !p.active; await save(); res.json(db.promos);
}));

// ---------- Delete my account (POPIA: students can ask for their information to be removed) ----------
app.post("/api/me/delete", auth, wrap(async (req, res) => {
  const u = req.me;
  if (u.is_admin) return res.status(400).json({ error: "The admin account cannot be deleted" });
  if (!bcrypt.compareSync(String(req.body.password || ""), u.password_hash)) return res.status(400).json({ error: "Wrong password" });
  for (const id of [u.card_img, u.selfie_img]) if (id) await store.deleteImage(id).catch(() => {});
  db.gigs.forEach(g => { if (g.poster_id === u.id && g.status === "open") g.status = "removed"; });
  db.market.forEach(m => { if (m.seller_id === u.id && m.status !== "sold") m.status = "removed"; });
  for (const k of ["surname", "student_number", "course", "year", "stay", "gender", "phone", "business_name", "card_img", "selfie_img", "sub_token"]) delete u[k];
  Object.assign(u, { first_name: "Deleted user", email: `deleted-${u.id}@deleted.invalid`, password_hash: "!", banned: true, deleted_at: now() });
  await save(); res.clearCookie("token"); res.json({ ok: true });
}));

app.get("/api/admin/payments", auth, adminOnly, (req, res) => res.json(db.payments.slice().reverse()));

// Money dashboard for the owner: income this month, monthly subscriptions, progress to the goal.
app.get("/api/admin/stats", auth, ownerOnly, (req, res) => {
  const d = new Date(), monthStart = new Date(d.getFullYear(), d.getMonth(), 1), lastStart = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  const sum = (from, to) => db.payments.filter(p => { const t = new Date(p.created_at); return t >= from && t < to; }).reduce((a, p) => a + p.amount, 0);
  const price = { starter: 39, premium: 79, business: 499 };
  const subs = { starter: 0, premium: 0, business: 0 };
  db.users.forEach(u => { if (!u.is_admin && subs[activePlan(u)] !== undefined) subs[activePlan(u)]++; });
  const monthly = Object.entries(subs).reduce((a, [k, n]) => a + n * price[k], 0);
  res.json({ this_month: sum(monthStart, new Date(8.64e15)), last_month: sum(lastStart, monthStart), monthly_subscriptions: monthly, subs,
    students: db.users.filter(u => u.role === "student").length, verified: db.users.filter(u => u.role === "student" && u.verified).length,
    businesses: db.users.filter(u => u.role === "business").length, goal: GOAL });
});

// Food bank sponsor ("Plate Fund partner") shown to students. Admin sets it.
app.get("/api/settings", (req, res) => res.json({ sponsor: db.settings?.sponsor || null, recurring: PF_RECURRING, contact: CONTACT_EMAIL, whatsapp: CONTACT_WHATSAPP, contact_name: CONTACT_NAME, contact_role: CONTACT_ROLE }));
app.post("/api/admin/settings", auth, adminOnly, wrap(async (req, res) => {
  const name = clip(req.body.sponsor_name, 80);
  db.settings = { ...(db.settings || {}), sponsor: name ? { name, line: clip(req.body.sponsor_line, 140) } : null };
  await save(); res.json({ ok: true, sponsor: db.settings.sponsor });
}));
app.get("/api/health", (req, res) => res.json({ ok: true }));

const RESERVED = ["api", "r", "assets", "css", "js", "admin"];
app.get("/", (req, res) => sendIndex(res, null));
app.get("/:slug", (req, res, next) => {
  const c = campusOf(String(req.params.slug).toLowerCase());
  if (!c) return next();
  sendIndex(res, c);
});

app.use((err, req, res, next) => {
  console.error(err);
  if (!res.headersSent) res.status(500).json({ error: "Something went wrong. Please try again." });
});

(async () => {
  db = await store.init();
  const adminEmail = (process.env.ADMIN_EMAIL || "admin@ul.ac.za").toLowerCase();
  // The owner is the first admin. Extra admins (e.g. office admin) are added on the Admin desk.
  let admin = db.users.find(u => u.owner) || db.users.find(u => u.is_admin);
  if (admin) admin.owner = true;
  if (!admin) {
    if (PROD && !process.env.ADMIN_PASSWORD) console.warn("ADMIN_PASSWORD is not set - using a temporary password. Set it in your host settings.");
    admin = { id: nid(), email: adminEmail, first_name: "Admin", surname: "Desk", role: "admin", is_admin: true, owner: true, verified: true, plan: "premium", banned: false, created_at: now() };
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
