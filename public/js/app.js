(() => {
  const $ = (id) => document.getElementById(id);
  let me = null;
  let view = "home";
  let gigs = [];
  let selectedGig = null;
  let market = [];
  let settings = {};
  // Which campus this phone is looking at. Set by short links like /ul, saved on the phone, and by the account.
  let campuses = [{ slug: "ul", name: "University of Limpopo", short: "UL" }];
  let campus = localStorage.getItem("campus") || "ul";
  const campusName = () => (campuses.find(c => c.slug === campus) || campuses[0]).name;
  const campusSelect = (id) => `<div class="field"><label>Campus</label><select id="${id}">${campuses.map(c => `<option value="${esc(c.slug)}" ${c.slug === campus ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>`;
  const shareLink = () => location.origin + "/" + campus;
  async function share(url, text) {
    if (navigator.share) { try { await navigator.share({ title: "Work@Campus", text, url }); return; } catch { return; } }
    try { await navigator.clipboard.writeText(text + " " + url); toast("Link copied. Paste it in WhatsApp."); } catch { prompt("Copy this link:", url); }
  }
  let selectedItem = null;

  // Stops anyone from sneaking code into a post (every user text goes through this).
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const CAT_NAMES = { chores: "Chores", move: "Moving", bakkie: "Bakkie", assign: "Assignment help", walk: "Walk together", study: "Study partner", other: "Other" };

  async function api(path, opts = {}) {
    const res = await fetch(path, { credentials: "include", ...opts, headers: { "Content-Type": "application/json", ...(opts.headers || {}) } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Something went wrong");
    return data;
  }

  function toast(msg) {
    const el = $("toast");
    el.textContent = msg;
    el.classList.add("on");
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove("on"), 2800);
  }

  // Wraps a button action so errors show as a message instead of failing silently.
  const act = (fn) => async () => { try { await fn(); } catch (e) { toast(e.message); } };

  function go(name) { view = name; render(); window.scrollTo(0, 0); }

  function header(title, sub) {
    return `<div class="topbar"><div class="brand"><img src="/assets/logo.jpg" alt="" /><div>${esc(title)}<small>${esc(sub || campusName())}</small></div></div><div class="pill live"><span class="dot"></span>Online</div></div>`;
  }

  async function loadMe() {
    try { me = (await api("/api/me")).user; } catch { me = null; }
    if (me && me.campus) { campus = me.campus; localStorage.setItem("campus", campus); }
  }
  async function loadGigs() { try { gigs = await api("/api/gigs?campus=" + encodeURIComponent(campus)); } catch { gigs = []; } }

  const isPaid = () => me && me.plan !== "free";

  // ---- Photos: shrink on the phone, then send ----
  function shrink(file, max = 1280) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type)) return reject(new Error("Please choose a photo"));
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL("image/jpeg", 0.75));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not open that photo")); };
      img.src = url;
    });
  }
  const picked = {};
  async function upload(kind, inputId) {
    const f = $(inputId)?.files?.[0];
    if (!f) return null;
    const data = picked[inputId] || await shrink(f);
    return (await api("/api/upload", { method: "POST", body: JSON.stringify({ kind, data }) })).id;
  }
  function photoField(id, label, hint, capture) {
    return `<div class="field"><label>${label}</label>
      <label class="shot" for="${id}"><span id="${id}-prev"><b>Tap to add photo</b><br/><small>${hint}</small></span></label>
      <input id="${id}" type="file" accept="image/*" ${capture ? `capture="${capture}"` : ""} class="hidden" data-photo /></div>`;
  }
  const verifyBadge = () => !me ? "" : me.verified ? `<span class="tag green">Verified</span>` :
    me.verify_status === "pending" ? `<span class="tag sky">Checking your photos</span>` : `<span class="tag coral">Not verified</span>`;
  const placeTime = (g) => [g.where_text, g.when_text].filter(Boolean).map(esc).join(" · ");

  // Reminds members before their plan runs out (unless it renews automatically).
  function renewBanner() {
    if (!me || me.is_admin) return "";
    const date = (d) => new Date(d).toLocaleDateString("en-ZA");
    if (me.plan_ended) return `<div class="card" style="background:#FFF1E6"><b>Your ${esc(me.plan_ended === "premium" ? "Campus Pro" : me.plan_ended === "business" ? "Business" : "Poster")} plan has ended.</b><p class="tiny">Renew to keep posting jobs${me.plan_ended === "starter" ? "" : " and selling"}.</p><button class="btn sm gold" data-go="shop">Renew now</button></div>`;
    if (me.plan !== "free" && me.plan_until && me.sub_status !== "active" && new Date(me.plan_until) - Date.now() < 5 * 864e5)
      return `<div class="card" style="background:#FFF6DB"><b>Your plan ends on ${date(me.plan_until)}.</b><p class="tiny">Renew now so your posts keep working.</p><button class="btn sm gold" data-go="shop">Renew</button></div>`;
    return "";
  }

  function renderLogin() {
    return `
      ${header("Join or log in", "UL students")}
      <div class="card">
        <h3>Log in</h3>
        <div class="field"><label>Email</label><input id="l-email" type="email" autocomplete="email" /></div>
        <div class="field"><label>Password</label><input id="l-pass" type="password" autocomplete="current-password" /></div>
        <button class="btn gold" id="btn-login">Log in</button>
      </div>
      <div class="card">
        <h3>Join free</h3>
        <p class="tiny">Your name and student number stay with admin only. Others see "Verified student".</p>
        <div class="grid-2">
          <div class="field"><label>Name</label><input id="r-first" /></div>
          <div class="field"><label>Surname</label><input id="r-surname" /></div>
        </div>
        <div class="field"><label>Email</label><input id="r-email" type="email" autocomplete="email" /></div>
        <div class="field"><label>Password (6+ characters)</label><input id="r-pass" type="password" autocomplete="new-password" /></div>
        ${campusSelect("r-campus")}
        <div class="field"><label>Student number</label><input id="r-num" inputmode="numeric" /></div>
        <div class="field"><label>Course</label><input id="r-course" /></div>
        <div class="grid-2">
          <div class="field"><label>Year</label><select id="r-year"><option>1st year</option><option>2nd year</option><option>3rd year</option><option>4th year</option><option>Postgrad</option></select></div>
          <div class="field"><label>Stay</label><select id="r-stay"><option>On campus</option><option>Off campus</option></select></div>
        </div>
        <div class="field"><label>Gender</label><select id="r-gender"><option>Female</option><option>Male</option><option>Prefer not to say</option></select></div>
        <h3 style="margin-top:6px">Get verified</h3>
        <p class="tiny">Verified students can accept jobs and join walks. Only admin sees these photos. You can also do this later under Me.</p>
        <div class="grid-2">
          ${photoField("r-card", "Front of student card", "Name and photo must be clear", "environment")}
          ${photoField("r-selfie", "Selfie", "Your face, good light", "user")}
        </div>
        <p class="tiny">By joining you agree to the <a href="#" data-go="terms">House rules</a> and <a href="#" data-go="privacy">Privacy policy</a>.</p>
        <button class="btn teal" id="btn-register">Create free account</button>
      </div>
      <div class="card">
        <h3>Business or employer?</h3>
        <p class="tiny">Shops, landlords, restaurants and companies: post jobs to UL students. Your posts show your business name and go to the top.</p>
        <div class="grid-2">
          <div class="field"><label>Your name</label><input id="b-first" /></div>
          <div class="field"><label>Surname</label><input id="b-surname" /></div>
        </div>
        <div class="field"><label>Business name</label><input id="b-name" maxlength="80" /></div>
        <div class="field"><label>Phone</label><input id="b-phone" type="tel" inputmode="tel" /></div>
        ${campusSelect("b-campus")}
        <div class="field"><label>Email</label><input id="b-email" type="email" autocomplete="email" /></div>
        <div class="field"><label>Password (6+ characters)</label><input id="b-pass" type="password" autocomplete="new-password" /></div>
        <p class="tiny">By joining you agree to the <a href="#" data-go="terms">House rules</a> and <a href="#" data-go="privacy">Privacy policy</a>.</p>
        <button class="btn gold" id="btn-register-biz">Create business account</button>
      </div>`;
  }

  function renderHome() {
    const open = gigs.filter(g => g.status === "open");
    return `
      ${header("Welcome", me ? me.first_name : "Campus")}
      ${renewBanner()}
      <div class="hero">
        <h1>Solutions for student life.</h1>
        <p>Earn a little extra. Use the food bank when you need a plate. Build friendships that walk you home.</p>
        <div class="row"><span class="pill gold">${open.length} open post${open.length === 1 ? "" : "s"}</span>${me ? `<span class="pill">${esc(me.plan)}</span>` : ""}</div>
      </div>
      <div class="cats">
        <button class="cat gigs" data-go="gigs"><b>Earn a little</b><span>Jobs from R30</span></button>
        <button class="cat walk" data-go="walk"><b>Walk together</b><span>Library or home</span></button>
        <button class="cat study" data-go="study"><b>Study help</b><span>Find a partner</span></button>
        <button class="cat plate" data-go="help"><b>Food bank</b><span>Quiet plate</span></button>
        <button class="cat move" data-go="market"><b>Market</b><span>Buy from students</span></button>
        <button class="cat meet" data-go="shop"><b>Plans</b><span>Subscribe to post</span></button>
      </div>
      ${open.slice(0, 4).map(gigCard).join("")}
    `;
  }

  function gigCard(g) {
    return `<article class="card tap" data-open-gig="${g.id}" ${g.featured ? `style="border:2px solid #C7A941"` : ""}>
      ${g.photo ? `<img src="/api/img/${esc(g.photo)}" alt="" loading="lazy" style="width:100%;max-height:170px;object-fit:cover;border-radius:14px;margin-bottom:10px" />` : ""}
      <div class="between"><span>${g.featured ? `<span class="tag" style="background:#C7A941;color:#1B2642">★ Featured</span> ` : ""}<span class="tag">${esc(CAT_NAMES[g.cat] || g.cat)}</span></span><div class="price">${g.pay ? "R" + esc(g.pay) : "Free"}</div></div>
      <h3>${esc(g.title)}</h3>
      <div class="meta">${placeTime(g)}</div>
      <div class="meta">${esc(g.public_label || "Verified student")}${g.status !== "open" ? ` · <span class="status">${esc(g.status)}</span>` : ""}</div>
    </article>`;
  }

  function listView(title, list, postCat, emptyMsg) {
    const canPost = me && (isPaid() || postCat === "walk" || postCat === "study");
    return `${header(title)}
      ${list.map(gigCard).join("") || `<p class="list-empty">${emptyMsg}</p>`}
      <button class="fab" data-post="${postCat || ""}" aria-label="Post">+</button>
      ${!me ? `<p class="tiny">Log in to post or reply.</p>` : !canPost ? `<p class="tiny">Posting paid jobs needs a plan. Finding work is free.</p>` : ""}
      ${!postCat && (!me || me.role === "business") && !(me && me.plan === "business") ? `<p class="tiny"><b>Hiring students?</b> Businesses post with their name at the top. <a href="#" data-go="${me ? "shop" : "login"}">See the Business plan</a></p>` : ""}`;
  }

  const renderGigs = () => listView("Campus gigs", gigs.filter(g => g.cat !== "walk" && g.cat !== "study"), "", "No gigs yet. Be the first to post.");
  const renderWalk = () => listView("Walk together", gigs.filter(g => g.cat === "walk"), "walk", "No walk requests yet. Post one free: \"Library to Mankweng gate, 21:00\".");
  const renderStudy = () => listView("Study partners", gigs.filter(g => g.cat === "study"), "study", "No study posts yet. Post one free: \"Need a partner for STAT 1541\".");

  function renderGig() {
    const g = gigs.find(x => x.id == selectedGig);
    if (!g) return header("Post") + `<p>Not found.</p><button class="btn ghost" data-go="gigs">Back</button>`;
    const mine = me && g.poster_id === me.id;
    return `
      ${header(CAT_NAMES[g.cat] || "Post")}
      <div class="card">
        <div class="between"><span class="tag">${esc(CAT_NAMES[g.cat] || g.cat)}</span><div class="price">${g.pay ? "R" + esc(g.pay) : "Free"}</div></div>
        <h2>${esc(g.title)}</h2>
        ${g.photo ? `<img src="/api/img/${esc(g.photo)}" alt="" style="width:100%;border-radius:14px;margin:6px 0" />` : ""}
        <p>${esc(g.detail)}</p>
        <p class="meta">${placeTime(g)}</p>
        <p class="meta">${esc(g.public_label)} · <span class="status">${esc(g.status)}</span></p>
        ${g.status === "open" && me && !mine ? `<button class="btn gold" id="btn-accept">${g.cat === "walk" || g.cat === "study" ? "I'll join" : "Accept this job"}</button>` : ""}
        ${mine && g.status === "open" && !g.featured && g.cat !== "walk" && g.cat !== "study" ? `<div class="reply" style="margin-top:10px"><b>Get more replies</b><br/>Put this post at the top for 7 days.<br/><button class="btn sm gold" style="margin-top:6px" data-buy="feature-7d" data-gig="${g.id}">Feature for R29</button></div>` : ""}
        ${mine && g.featured ? `<p class="tiny">★ This post is featured${g.featured_until ? " until " + new Date(g.featured_until).toLocaleDateString("en-ZA") : ""}.</p>` : ""}
        ${me ? `<h3 style="margin-top:14px">${mine ? "Messages from students" : "Private chat with the poster"}</h3><div id="threads" class="tiny">Loading...</div>` : ""}
        ${me && me.is_admin ? `<button class="btn danger" style="margin-top:10px" id="btn-remove">Remove post</button>` : ""}
        ${!me ? `<p class="tiny">Log in to accept or reply.</p>` : ""}
      </div>
      <button class="btn ghost" data-go="${g.cat === "walk" ? "walk" : g.cat === "study" ? "study" : "gigs"}">Back</button>`;
  }

  let postCat = "";
  function renderPost() {
    const free = postCat === "walk" || postCat === "study";
    if (!me) return `${header("Post")}<div class="card"><p>Log in first.</p><button class="btn gold" data-go="login">Log in or join</button></div>`;
    if (free && me.role === "business") return `${header("Post")}<div class="card"><p>Walk and study posts are for students.</p><button class="btn gold" data-go="gigs">Post a job instead</button></div>`;
    if (!isPaid() && !free) return `${header("Subscribe to post")}<div class="card"><p>Free accounts find work, and can post walk and study requests. Posting paid jobs needs a plan.</p><button class="btn gold" data-go="shop">See plans</button></div>`;
    const cats = free ? [[postCat, CAT_NAMES[postCat]]] : [["chores", "Chores"], ["move", "Moving"], ["bakkie", "Bakkie"], ["assign", "Assignment help"], ["other", "Other"]];
    return `
      ${header(free ? CAT_NAMES[postCat] : "Post a job")}
      <div class="card">
        <div class="field"><label>${free ? "What do you need?" : "What job needs doing?"}</label><input id="p-title" maxlength="100" /></div>
        <div class="field"><label>Details</label><textarea id="p-detail" maxlength="1000"></textarea></div>
        ${free ? `<input id="p-pay" type="hidden" value="0" />` : `<div class="field"><label>Pay (R)</label><input id="p-pay" type="number" min="1" value="100" inputmode="numeric" /></div>`}
        <div class="field"><label>Type</label><select id="p-cat">${cats.map(([v, n]) => `<option value="${v}">${n}</option>`).join("")}</select></div>
        <div class="field"><label>Where</label><input id="p-where" maxlength="100" placeholder="e.g. Main library" /></div>
        <div class="field"><label>When</label><input id="p-when" maxlength="100" placeholder="e.g. Today 18:00" /></div>
        ${free ? "" : photoField("p-photo", "Photo (optional)", "e.g. the boxes to move", "environment")}
        <button class="btn gold" id="btn-post">Post</button>
        ${free ? `<p class="tiny">Safety: meet in busy, well-lit places. Tell a friend where you are going.</p>` : ""}
      </div>`;
  }

  // ---- Market ----
  function itemCard(m) {
    return `<article class="card tap" data-open-item="${m.id}">
      ${m.photo ? `<img src="/api/img/${esc(m.photo)}" alt="" loading="lazy" style="width:100%;max-height:170px;object-fit:cover;border-radius:14px;margin-bottom:10px" />` : ""}
      <div class="between"><span class="tag ${m.status === "live" ? "teal" : "muted"}">${m.status === "live" ? "For sale" : esc(m.status === "pending" ? "Waiting for admin" : m.status)}</span><div class="price">R${esc(m.price)}</div></div>
      <h3>${esc(m.title)}</h3>
      <div class="meta">${esc(m.public_label)}</div>
    </article>`;
  }
  function renderMarket() {
    const live = market.filter(m => m.status === "live"), mine = market.filter(m => m.mine || (me && me.is_admin && m.status === "pending"));
    const canSell = me && (me.plan === "premium" || me.plan === "business");
    return `${header("Campus market", "Buy and sell with students")}
      ${mine.filter(m => m.status === "pending").length ? `<p class="tiny">Waiting for admin: ${mine.filter(m => m.status === "pending").map(m => esc(m.title)).join(", ")}</p>` : ""}
      ${live.map(itemCard).join("") || `<p class="list-empty">Nothing for sale yet. Textbooks, kettles, fridges, calculators - sell yours with Campus Pro.</p>`}
      ${market.filter(m => m.status === "sold").slice(0, 3).map(itemCard).join("")}
      <button class="fab" id="btn-sell-open" aria-label="Sell">+</button>
      ${!me ? `<p class="tiny">Log in to message a seller.</p>` : !canSell ? `<p class="tiny">Buying is free. Selling is part of Campus Pro (R79 / month).</p>` : ""}`;
  }
  function renderItem() {
    const m = market.find(x => x.id == selectedItem);
    if (!m) return header("Market") + `<p>Not found.</p><button class="btn ghost" data-go="market">Back</button>`;
    return `${header("Market")}
      <div class="card">
        <div class="between"><span class="tag ${m.status === "live" ? "teal" : "muted"}">${esc(m.status === "live" ? "For sale" : m.status)}</span><div class="price">R${esc(m.price)}</div></div>
        <h2>${esc(m.title)}</h2>
        ${m.photo ? `<img src="/api/img/${esc(m.photo)}" alt="" style="width:100%;border-radius:14px;margin:6px 0" />` : ""}
        <p>${esc(m.description)}</p>
        <p class="meta">${esc(m.public_label)}</p>
        ${m.mine && m.status === "live" ? `<button class="btn ghost" id="btn-sold">Mark as sold</button>` : ""}
        ${me && me.is_admin && m.status === "pending" ? `<div class="btns"><button class="btn sm teal" data-mkt="${m.id}" data-act="approve">Approve</button><button class="btn sm danger" data-mkt="${m.id}" data-act="remove">Remove</button></div>` : ""}
        ${me && me.is_admin && m.status !== "pending" ? `<button class="btn danger" style="margin-top:10px" data-mkt="${m.id}" data-act="remove">Remove item</button>` : ""}
        ${me && (m.status === "live" || m.mine) ? `<h3 style="margin-top:14px">${m.mine ? "Messages from buyers" : "Private chat with the seller"}</h3><div id="threads" class="tiny">Loading...</div>` : ""}
        ${!me ? `<p class="tiny">Log in to message the seller.</p>` : ""}
        <p class="tiny">Safety: meet in a busy place on campus. Check the item before you pay.</p>
      </div>
      <button class="btn ghost" data-go="market">Back</button>`;
  }
  function renderSell() {
    if (!me) return `${header("Sell")}<div class="card"><p>Log in first.</p><button class="btn gold" data-go="login">Log in or join</button></div>`;
    if (me.plan !== "premium" && me.plan !== "business") return `${header("Sell on the market")}<div class="card"><p>Selling is part of Campus Pro. Buying is always free.</p><button class="btn gold" data-go="shop">See plans</button></div>`;
    return `${header("Sell something")}
      <div class="card">
        <div class="field"><label>What are you selling?</label><input id="s-title" maxlength="100" placeholder="e.g. Casio fx-82 calculator" /></div>
        <div class="field"><label>Details</label><textarea id="s-desc" maxlength="1000" placeholder="Condition, where to collect..."></textarea></div>
        <div class="field"><label>Price (R)</label><input id="s-price" type="number" min="1" inputmode="numeric" /></div>
        ${photoField("s-photo", "Photo", "A clear photo sells faster", "environment")}
        <button class="btn gold" id="btn-sell">Send for approval</button>
        <p class="tiny">Admin checks each item before it goes live.</p>
      </div>`;
  }

  // Private conversations under a post. Owner sees one thread per person and can answer each.
  async function loadThreads(kind, id, ownerIsMe) {
    const box = $("threads"); if (!box) return;
    const base = kind === "gig" ? "/api/gigs/" : "/api/market/";
    let msgs;
    try { msgs = await api(base + id + "/replies"); } catch { box.textContent = "Could not load messages."; return; }
    const threads = {};
    msgs.forEach(m => (threads[m.thread] = threads[m.thread] || { name: m.thread_name, list: [] }).list.push(m));
    const bubble = (m) => `<div class="reply" style="${m.mine ? "background:#E6F4F1;margin-left:18%" : "margin-right:18%"}"><b>${m.mine ? "You" : esc(m.from)}</b><br/>${esc(m.body)}</div>`;
    const input = (to) => `<div class="field" style="margin-top:6px"><textarea data-msg-box="${to}" placeholder="${ownerIsMe ? "Answer privately..." : "Hi, I can help..."}"></textarea></div><button class="btn sm ghost" data-msg-send="${to}">Send privately</button>`;
    if (me.is_admin && !ownerIsMe) {
      box.innerHTML = Object.values(threads).map(t => `<div style="margin-bottom:10px"><b>With ${esc(t.name)}</b>${t.list.map(bubble).join("")}</div>`).join("") || "No messages yet.";
    } else if (ownerIsMe) {
      box.innerHTML = Object.entries(threads).map(([to, t]) => `<div class="card" style="padding:10px"><b>${esc(t.name)}</b>${t.list.map(bubble).join("")}${input(to)}</div>`).join("") || "No messages yet. When someone writes or accepts, it shows here.";
    } else {
      const mineT = Object.values(threads)[0];
      box.innerHTML = (mineT ? mineT.list.map(bubble).join("") : "") + input("");
    }
    box.querySelectorAll("[data-msg-send]").forEach(b => b.onclick = act(async () => {
      const to = b.dataset.msgSend, ta = box.querySelector(`[data-msg-box="${to}"]`);
      await api(base + id + "/reply", { method: "POST", body: JSON.stringify({ body: ta.value, to: to ? Number(to) : undefined }) });
      toast("Sent privately"); loadThreads(kind, id, ownerIsMe);
    }));
  }

  function renderHelp() {
    if (!me) return `${header("Food bank")}<div class="card"><p>Need a plate? Log in and ask quietly. Only admin sees your name.</p><button class="btn gold" data-go="login">Log in or join</button></div>`;
    return `${header("Food bank", "Private - only admin sees this")}
      ${settings.sponsor ? `<div class="card" style="background:#FFF6DB"><span class="tag" style="background:#C7A941;color:#1B2642">Plate Fund partner</span><h3 style="margin-top:6px">${esc(settings.sponsor.name)}</h3>${settings.sponsor.line ? `<p class="tiny">${esc(settings.sponsor.line)}</p>` : ""}</div>` : ""}
      <div class="card">
        <h3>Ask for a plate quietly</h3>
        <p class="tiny">No one else sees your request. Admin will contact you.</p>
        <div class="field"><label>What do you need?</label><select id="h-need"><option>A meal today</option><option>Groceries for the week</option><option>Toiletries</option><option>Other</option></select></div>
        <div class="field"><label>Anything else? (optional)</label><textarea id="h-note" maxlength="500"></textarea></div>
        <button class="btn coral" id="btn-plate">Send quietly</button>
      </div>
      <div class="card"><h3>Your requests</h3><div id="my-plates" class="tiny">Loading...</div></div>`;
  }

  function renderShop() {
    const paid = isPaid();
    return `
      ${header("Plans")}
      <div class="card"><p>Free = find work, buy on the market, walk and study posts. Poster = post paid jobs. Campus Pro = post jobs and sell on the market.</p>
      ${paid ? `<p class="tiny">Your plan: <b>${esc(me.plan)}</b>${me.plan_until ? (me.sub_status === "active" ? " · renews automatically on " : " until ") + new Date(me.plan_until).toLocaleDateString("en-ZA") : ""}</p>` : ""}
      <div class="field" style="margin-top:8px"><label>Promo code (optional)</label><input id="promo" maxlength="20" autocapitalize="characters" placeholder="e.g. LAUNCH50" /></div>
      ${settings.recurring ? `<p class="tiny">Plans renew automatically every month through PayFast. Stop any time under Me.</p>` : ""}</div>
      <div class="plan"><h3>Poster</h3><div class="amt">R39<span class="tiny"> / month</span></div><ul><li>Post paid jobs</li></ul><button class="btn sm gold" data-buy="poster-1m">Pay R39</button></div>
      <div class="plan hot"><h3>Campus Pro</h3><div class="amt">R79<span class="tiny"> / month</span></div><ul><li>Post paid jobs</li><li>Sell on the campus market</li></ul><button class="btn sm gold" data-buy="pro-1m">Pay R79</button></div>
      <div class="plan"><h3>Business</h3><div class="amt">R499<span class="tiny"> / month</span></div><ul><li>For shops, landlords and employers</li><li>Your business name on every post</li><li>All your job posts featured at the top</li><li>Sell on the campus market</li></ul><button class="btn sm gold" data-buy="biz-1m">Pay R499</button></div>
      <p class="tiny">Already posting? Feature one job at the top for 7 days for R29 (open your post and tap Feature).</p>
      <p class="tiny">Payments go through PayFast. Your plan switches on once PayFast confirms the payment.</p>`;
  }

  function renderMe() {
    if (!me) return `${header("Me")}<button class="btn gold" data-go="login">Log in or join</button>`;
    return `
      ${header("Your card", me.plan)}
      <div class="card">
        <div class="between"><b>${esc(me.first_name)} ${esc(me.surname)}</b>${me.role === "business" ? `<span class="tag teal">Business</span>` : verifyBadge()}</div>
        ${me.business_name ? `<div class="meta">${esc(me.business_name)}</div>` : ""}
        <div class="meta">${[me.course, me.year, me.stay].filter(Boolean).map(esc).join(" · ")}</div>
        <div class="tiny">Plan: ${esc(me.plan)}${me.plan_until && me.plan !== "free" ? (me.sub_status === "active" ? " · renews automatically on " : " until ") + new Date(me.plan_until).toLocaleDateString("en-ZA") : ""}</div>
        ${me.sub_status === "active" ? `<button class="btn sm ghost" style="margin-top:8px" id="btn-stop-renew">Stop automatic renewal</button>` : ""}
      </div>
      ${renewBanner()}
      ${!me.verified && me.verify_status !== "pending" && !me.is_admin && me.role !== "business" ? `<div class="card">
        <h3>Get verified</h3>
        <p class="tiny">${me.verify_status === "rejected" ? "Your last photos could not be checked. Please send clearer ones." : "Send the front of your student card and a selfie. Only admin sees them."}</p>
        <div class="grid-2">${photoField("v-card", "Student card (front)", "Clear and readable", "environment")}${photoField("v-selfie", "Selfie", "Your face, good light", "user")}</div>
        <button class="btn teal" id="btn-verify">Send for checking</button></div>` : ""}
      ${me.verify_status === "pending" ? `<div class="card"><p class="tiny">Thanks - admin is checking your photos.</p></div>` : ""}
      ${me.ambassador ? `<div class="card" style="background:#EEF7F5"><h3>Ambassador</h3>
        <p class="tiny">Share your link. You earn ${esc(me.ambassador.pct)}% of everything the people you invite pay for their first 12 months.</p>
        <div class="reply" style="word-break:break-all"><b>${esc(me.ambassador.link)}</b></div>
        <button class="btn sm gold" id="btn-share-amb">Share my link</button>
        <div class="tiny" style="margin-top:8px">Joined with your link: <b>${esc(me.ambassador.invited)}</b> · Paying now: <b>${esc(me.ambassador.paying)}</b><br/>Earned: <b>R${esc(me.ambassador.earned)}</b> · Paid to you: R${esc(me.ambassador.paid)} · Still owed: <b>R${esc(me.ambassador.owed)}</b></div></div>` : ""}
      <button class="btn gold" data-go="shop">Plans</button>
      <button class="btn ghost" style="margin-top:8px" id="btn-share">Invite friends to Work@Campus</button>
      <button class="btn ghost" style="margin-top:8px" data-go="terms">House rules</button>
      ${me.is_admin ? `<button class="btn ghost" style="margin-top:8px" data-go="admin">Admin desk</button>` : ""}
      <button class="btn ghost" style="margin-top:8px" data-go="privacy">Privacy policy</button>
      <button class="btn ghost" style="margin-top:8px" id="btn-logout">Log out</button>
      ${me.is_admin ? "" : `<details style="margin-top:18px"><summary class="tiny">Delete my account</summary>
        <div class="card" style="margin-top:8px"><p class="tiny">This removes your name, student number, photos and open posts. It cannot be undone. Paid time left on a plan is lost.</p>
        <div class="field"><label>Type your password to confirm</label><input id="del-pass" type="password" autocomplete="current-password" /></div>
        <button class="btn danger" id="btn-delete">Delete my account</button></div></details>`}`;
  }

  function renderAdmin() {
    if (!me || !me.is_admin) return header("Admin") + "<p>Admin only.</p>";
    return `${header("Admin desk")}
      <div class="card"><h3>Money</h3><div id="admin-stats" class="tiny">Loading...</div></div>
      <div class="card"><h3>Students to verify</h3><div id="admin-verify" class="tiny">Loading...</div></div>
      <div class="card"><h3>Market items to approve</h3><div id="admin-market" class="tiny">Loading...</div></div>
      <div class="card"><h3>Food requests</h3><div id="admin-plates" class="tiny">Loading...</div></div>
      <div class="card"><h3>Payments</h3><div id="admin-pay" class="tiny">Loading...</div></div>
      <div class="card"><h3>Links to share</h3><p class="tiny">Post these in WhatsApp and Facebook groups. Each opens the app for that campus with a picture preview.</p>
        ${campuses.map(c => `<div class="reply" style="word-break:break-all"><b>${esc(c.short)}</b>: ${esc(location.origin + "/" + c.slug)}</div>`).join("")}</div>
      <div class="card"><h3>Team</h3><p class="tiny">Make someone an admin (e.g. office admin) or an ambassador. They must join the app first.</p>
        <div id="admin-team" class="tiny">Loading...</div>
        <div class="field"><label>Their email</label><input id="tm-email" type="email" /></div>
        <div class="field"><label>Make them</label><select id="tm-role"><option value="ambassador">Ambassador (earns ${20}% commission)</option><option value="admin">Admin (full Admin desk access)</option><option value="remove-ambassador">Remove ambassador</option><option value="remove-admin">Remove admin</option></select></div>
        <button class="btn sm gold" id="btn-team">Save</button></div>
      <div class="card"><h3>Campuses</h3><div id="admin-campuses" class="tiny">${campuses.map(c => esc(c.name) + " (/" + esc(c.slug) + ")").join("<br/>")}</div>
        <div class="grid-2"><div class="field"><label>Short link name</label><input id="cp-slug" maxlength="12" placeholder="univen" /></div><div class="field"><label>Short name</label><input id="cp-short" maxlength="12" placeholder="Univen" /></div></div>
        <div class="field"><label>Full name</label><input id="cp-name" maxlength="80" placeholder="University of Venda" /></div>
        <button class="btn sm gold" id="btn-campus">Add campus</button></div>
      <div class="card"><h3>Promo codes</h3><p class="tiny">A discount on the first payment only. Example: LAUNCH50 = 50% off the first month.</p>
        <div id="admin-promos" class="tiny">Loading...</div>
        <div class="grid-2"><div class="field"><label>Code</label><input id="pr-code" maxlength="20" placeholder="LAUNCH50" /></div><div class="field"><label>% off</label><input id="pr-pct" type="number" min="1" max="90" value="50" /></div></div>
        <div class="grid-2"><div class="field"><label>Max uses (0 = no limit)</label><input id="pr-max" type="number" min="0" value="0" /></div>
        <div class="field"><label>For</label><select id="pr-plan"><option value="">All plans</option><option value="biz-1m">Business only</option><option value="pro-1m">Campus Pro only</option><option value="poster-1m">Poster only</option></select></div></div>
        <button class="btn sm gold" id="btn-promo">Create code</button></div>
      <div class="card"><h3>Food bank sponsor</h3><p class="tiny">Shown to students on the Food bank screen. Leave the name empty to hide it.</p>
        <div class="field"><label>Sponsor name</label><input id="sp-name" maxlength="80" value="${esc(settings.sponsor?.name || "")}" /></div>
        <div class="field"><label>Short line (optional)</label><input id="sp-line" maxlength="140" value="${esc(settings.sponsor?.line || "")}" placeholder="e.g. Feeding UL students every month" /></div>
        <button class="btn sm gold" id="btn-sponsor">Save sponsor</button></div>`;
  }

  function renderTerms() {
    return `${header("House rules")}<div class="card"><p>Names stay with admin. Be honest and kind. Finish the jobs you accept. Meet in public places. No assignment cheating - study help means working together, not doing someone's work. Free members find work and post walk and study requests. Paid members post jobs.</p></div><button class="btn gold" data-go="${me ? "me" : "home"}">Back</button>`;
  }

  function renderPrivacy() {
    return `${header("Privacy policy")}<div class="card">
      <p><b>Who we are.</b> Work@Campus is a student jobs and support app, run by Be Everything Energy (Pty) Ltd (registration 2022/451663/07), South Africa. ${settings.contact ? `Questions about your information: <b>${esc(settings.contact)}</b>.` : "Questions about your information: contact admin."}</p>
      <p><b>What we collect.</b> Your name, surname, email, password (stored scrambled, never readable), student number, course, year, where you stay and gender. Businesses: business name and phone. Your posts, messages and food bank requests. For verification: a photo of your student card and a selfie.</p>
      <p><b>Why.</b> To run your account, to keep students safe (only verified students can accept jobs and join walks), to stop fake accounts, and to take payments.</p>
      <p><b>Who can see it.</b> Other students only see your first name and "Verified student". Admin sees your full details so they can verify you and keep the app safe. Food bank requests are seen by admin only. We never sell your information.</p>
      <p><b>Your ID photos.</b> Your student card photo and selfie can only be opened by you and admin. They are deleted as soon as admin has checked them. We only keep whether you were verified.</p>
      <p><b>Payments.</b> PayFast handles all card and bank details. Work@Campus never sees or stores your card number.</p>
      <p><b>Where it is kept.</b> On secure online servers (Render and Neon), which may be outside South Africa.</p>
      <p><b>Your rights.</b> Under POPIA you may ask to see, correct or delete your information. You can delete your account yourself under Me → Delete my account. You may also complain to the Information Regulator (inforegulator.org.za).</p>
    </div><button class="btn gold" data-go="${me ? "me" : "home"}">Back</button>`;
  }

  const views = { login: renderLogin, home: renderHome, gigs: renderGigs, walk: renderWalk, study: renderStudy, gig: renderGig, post: renderPost, help: renderHelp, shop: renderShop, me: renderMe, admin: renderAdmin, terms: renderTerms, market: renderMarket, item: renderItem, sell: renderSell, privacy: renderPrivacy };
  const PUBLIC = ["login", "terms", "home", "gigs", "walk", "study", "gig", "help", "shop", "me", "market", "item", "sell", "privacy"];

  function showWelcome(yes) {
    $("welcome").classList.toggle("hidden", !yes);
    $("nav").classList.toggle("hidden", yes);
    document.querySelector("main").style.display = yes ? "none" : "block";
  }

  async function render() {
    if (!me && !PUBLIC.includes(view)) view = "login";
    if (["home", "gigs", "walk", "study", "gig"].includes(view)) await loadGigs();
    if (["help", "admin", "shop", "me", "privacy", "home"].includes(view)) { try { settings = await api("/api/settings"); } catch { settings = {}; } }
    if (["market", "item", "admin"].includes(view)) { try { market = await api("/api/market?campus=" + encodeURIComponent(campus)); } catch { market = []; } }
    showWelcome(false);
    Object.keys(views).forEach(k => {
      const el = $("view-" + k);
      if (!el) return;
      if (k === view) { el.classList.add("on"); el.innerHTML = views[k](); }
      else { el.classList.remove("on"); el.innerHTML = ""; }
    });
    document.querySelectorAll(".nav button").forEach(b => b.classList.toggle("on", b.getAttribute("data-go") === view));
    bind();
    afterRender();
  }

  async function afterRender() {
    if (view === "gig" && me) {
      const g = gigs.find(x => x.id == selectedGig);
      if (g) loadThreads("gig", g.id, g.poster_id === me.id);
    }
    if (view === "item" && me) {
      const m = market.find(x => x.id == selectedItem);
      if (m) loadThreads("market", m.id, m.mine);
    }
    if (view === "admin" && $("admin-stats")) {
      try {
        const st = await api("/api/admin/stats"), R = (n) => "R" + Math.round(n).toLocaleString("en-ZA");
        const pct = Math.min(100, (st.monthly_subscriptions / st.goal) * 100);
        $("admin-stats").innerHTML = `<div class="between"><span>Paid this month</span><b>${R(st.this_month)}</b></div>
          <div class="between"><span>Last month</span><b>${R(st.last_month)}</b></div>
          <div class="between"><span>Monthly subscriptions now</span><b>${R(st.monthly_subscriptions)}</b></div>
          <div style="margin:8px 0 2px">Goal: ${R(st.goal)} a month</div>
          <div style="background:#EEE;border-radius:8px;height:12px;overflow:hidden"><div style="width:${pct.toFixed(1)}%;min-width:2px;height:100%;background:#C7A941"></div></div>
          <div style="margin-top:8px">Subscribers: ${st.subs.starter} Poster · ${st.subs.premium} Campus Pro · ${st.subs.business} Business</div>
          <div>Students: ${st.students} (${st.verified} verified) · Businesses: ${st.businesses}</div>`;
      } catch (e) { $("admin-stats").textContent = e.message; }
    }
    if (view === "admin" && $("admin-team")) {
      try {
        const t = await api("/api/admin/team");
        $("admin-team").innerHTML = t.map(u => `<div class="reply"><b>${esc(u.name)}</b> · ${esc(u.email)}${u.owner ? " · owner" : ""}${u.admin ? " · admin" : ""}
          ${u.ambassador ? `<br/>Ambassador ${esc(u.ambassador.code)} · invited ${esc(u.ambassador.invited)} · paying ${esc(u.ambassador.paying)} · earned R${esc(u.ambassador.earned)} · <b>owed R${esc(u.ambassador.owed)}</b>
          ${u.ambassador.owed > 0 ? `<br/><button class="btn sm teal" data-payout="${u.id}">I paid R${esc(u.ambassador.owed)}</button>` : ""}` : ""}</div>`).join("") || "Just you so far.";
        document.querySelectorAll("[data-payout]").forEach(b => b.onclick = act(async () => {
          if (!confirm("Did you pay this amount to the ambassador (e.g. by EFT)?")) return;
          await api(`/api/admin/team/${b.dataset.payout}/paid`, { method: "POST" }); toast("Recorded"); go("admin");
        }));
      } catch (e) { $("admin-team").textContent = e.message; }
    }
    if (view === "admin" && $("admin-promos")) {
      try {
        const ps = await api("/api/admin/promos");
        $("admin-promos").innerHTML = ps.map(p => `<div class="reply"><b>${esc(p.code)}</b> · ${esc(p.pct)}% off · used ${esc(p.uses || 0)}${p.max ? " of " + esc(p.max) : ""}${p.plans?.length ? " · " + esc(p.plans.join(", ")) : ""} · ${p.active ? "on" : "off"} <button class="btn sm ghost" data-promo="${esc(p.code)}">${p.active ? "Switch off" : "Switch on"}</button></div>`).join("") || "No codes yet.";
        document.querySelectorAll("[data-promo]").forEach(b => b.onclick = act(async () => { await api(`/api/admin/promos/${b.dataset.promo}/toggle`, { method: "POST" }); go("admin"); }));
      } catch (e) { $("admin-promos").textContent = e.message; }
    }
    if (view === "admin" && $("admin-market")) {
      const pend = market.filter(m => m.status === "pending");
      $("admin-market").innerHTML = pend.map(m => `<div class="reply"><b>${esc(m.title)}</b> · R${esc(m.price)} · ${esc(m.public_label)}<br/>${esc(m.description)}
        ${m.photo ? `<img src="/api/img/${esc(m.photo)}" alt="" style="width:100%;border-radius:10px;margin-top:6px" />` : ""}
        <div class="btns"><button class="btn sm teal" data-mkt="${m.id}" data-act="approve">Approve</button><button class="btn sm danger" data-mkt="${m.id}" data-act="remove">Remove</button></div></div>`).join("") || "Nothing waiting.";
      bindMarketAdmin();
    }
    if (view === "help" && $("my-plates")) {
      try {
        const r = await api("/api/plates/mine");
        $("my-plates").innerHTML = r.map(p => `<div class="reply">${esc(p.need)} · <span class="status">${esc(p.status)}</span></div>`).join("") || "None yet.";
      } catch { $("my-plates").textContent = ""; }
    }
    if (view === "admin" && $("admin-plates")) {
      try {
        const plates = await api("/api/admin/plates");
        $("admin-plates").innerHTML = plates.map(p => `<div class="admin-secret" style="margin-bottom:8px">${esc(p.first_name)} ${esc(p.surname)} · ${esc(p.student_number)}<br/>${esc(p.need)}<br/>${esc(p.note)}<br/>Status: ${esc(p.status)} ${p.status === "open" ? `<button class="btn sm gold" data-plate-done="${p.id}">Mark helped</button>` : ""}</div>`).join("") || "None";
        const vs = await api("/api/admin/verify");
        $("admin-verify").innerHTML = vs.map(v => `<div class="reply"><b>${esc(v.name)}</b> · ${esc(v.student_number)} · ${esc(v.course)} ${esc(v.year)}
          <div class="grid-2" style="margin:8px 0"><a href="/api/img/${esc(v.card_img)}" target="_blank"><img src="/api/img/${esc(v.card_img)}" style="width:100%;border-radius:10px" alt="card"/></a><a href="/api/img/${esc(v.selfie_img)}" target="_blank"><img src="/api/img/${esc(v.selfie_img)}" style="width:100%;border-radius:10px" alt="selfie"/></a></div>
          <div class="btns"><button class="btn sm teal" data-ver="${v.id}" data-ok="1">Approve</button><button class="btn sm danger" data-ver="${v.id}" data-ok="0">Reject</button></div></div>`).join("") || "Nobody waiting.";
        document.querySelectorAll("[data-ver]").forEach(b => b.onclick = act(async () => {
          await api(`/api/admin/verify/${b.dataset.ver}`, { method: "POST", body: JSON.stringify({ approve: b.dataset.ok === "1" }) });
          toast(b.dataset.ok === "1" ? "Approved" : "Rejected"); go("admin");
        }));
        const pays = await api("/api/admin/payments");
        $("admin-pay").innerHTML = pays.map(p => `<div class="reply">R${esc(p.amount)} · ${esc(p.item)} · user ${esc(p.user_id)} · ${new Date(p.created_at).toLocaleDateString("en-ZA")}</div>`).join("") || "No payments yet.";
        document.querySelectorAll("[data-plate-done]").forEach(b => b.onclick = act(async () => { await api(`/api/admin/plates/${b.getAttribute("data-plate-done")}/done`, { method: "POST" }); toast("Marked as helped"); go("admin"); }));
      } catch (e) { $("admin-plates").textContent = e.message; }
    }
  }

  function bindMarketAdmin() {
    document.querySelectorAll("[data-mkt]").forEach(b => b.onclick = act(async () => {
      await api(`/api/admin/market/${b.dataset.mkt}/${b.dataset.act}`, { method: "POST" });
      toast(b.dataset.act === "approve" ? "Item is live" : "Removed"); go(view === "item" ? "market" : view);
    }));
  }

  function payfastRedirect(url, params) {
    const f = document.createElement("form");
    f.method = "POST"; f.action = url;
    Object.entries(params).forEach(([k, v]) => { const i = document.createElement("input"); i.type = "hidden"; i.name = k; i.value = v; f.appendChild(i); });
    document.body.appendChild(f); f.submit();
  }

  function bind() {
    document.querySelectorAll("main [data-go], #nav [data-go]").forEach(b => b.onclick = () => go(b.getAttribute("data-go")));
    document.querySelectorAll("[data-open-gig]").forEach(b => b.onclick = () => { selectedGig = b.getAttribute("data-open-gig"); go("gig"); });
    document.querySelectorAll("[data-post]").forEach(b => b.onclick = () => {
      postCat = b.getAttribute("data-post");
      if (!me) return go("login");
      go("post");
    });
    const on = (id, fn) => { const el = $(id); if (el) el.onclick = act(fn); };
    document.querySelectorAll("[data-photo]").forEach(inp => inp.onchange = act(async () => {
      const f = inp.files[0]; if (!f) return;
      $(inp.id + "-prev").innerHTML = "<small>Getting photo ready...</small>";
      picked[inp.id] = await shrink(f);
      $(inp.id + "-prev").innerHTML = `<img src="${picked[inp.id]}" alt="" />`;
    }));
    async function sendVerify(cardId, selfieId) {
      if (!$(cardId)?.files?.[0] || !$(selfieId)?.files?.[0]) return false;
      const card = await upload("card", cardId), selfie = await upload("selfie", selfieId);
      me = (await api("/api/me/verify", { method: "POST", body: JSON.stringify({ card, selfie }) })).user;
      return true;
    }
    on("btn-verify", async () => {
      if (!(await sendVerify("v-card", "v-selfie"))) return toast("Add both photos");
      toast("Sent. Admin will check soon."); go("me");
    });

    on("btn-login", async () => {
      await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email: $("l-email").value, password: $("l-pass").value }) });
      await loadMe(); toast("Welcome back"); go("home");
    });
    on("btn-register", async () => {
      const body = { email: $("r-email").value, password: $("r-pass").value, first_name: $("r-first").value, surname: $("r-surname").value, student_number: $("r-num").value, campus: $("r-campus").value, course: $("r-course").value, year: $("r-year").value, stay: $("r-stay").value, gender: $("r-gender").value };
      await api("/api/auth/register", { method: "POST", body: JSON.stringify(body) });
      await loadMe();
      let sent = false;
      try { sent = await sendVerify("r-card", "r-selfie"); } catch (e) { toast("Account created, but photos failed: " + e.message); }
      toast(sent ? "Account created. Admin will check your photos." : "Account created. Get verified under Me.");
      go("home");
    });
    on("btn-accept", async () => { await api(`/api/gigs/${selectedGig}/accept`, { method: "POST" }); toast("Done - message the poster to arrange"); go("gig"); });
    on("btn-post", async () => {
      const photo = await upload("post", "p-photo");
      await api("/api/gigs", { method: "POST", body: JSON.stringify({ photo, title: $("p-title").value, detail: $("p-detail").value, pay: Number($("p-pay").value), cat: $("p-cat").value, where_text: $("p-where").value, when_text: $("p-when").value }) });
      toast("Posted"); go(postCat || "gigs");
    });
    document.querySelectorAll("[data-open-item]").forEach(b => b.onclick = () => { selectedItem = b.getAttribute("data-open-item"); go("item"); });
    on("btn-sell-open", async () => go(me ? "sell" : "login"));
    on("btn-sell", async () => {
      const photo = await upload("post", "s-photo");
      const r = await api("/api/market", { method: "POST", body: JSON.stringify({ title: $("s-title").value, description: $("s-desc").value, price: Number($("s-price").value), photo }) });
      toast(r.status === "live" ? "Item is live" : "Sent. Admin will approve it soon."); go("market");
    });
    on("btn-register-biz", async () => {
      const body = { account_type: "business", email: $("b-email").value, password: $("b-pass").value, first_name: $("b-first").value, surname: $("b-surname").value, business_name: $("b-name").value, phone: $("b-phone").value, campus: $("b-campus").value };
      await api("/api/auth/register", { method: "POST", body: JSON.stringify(body) });
      await loadMe(); toast("Business account created"); go("shop");
    });
    on("btn-team", async () => {
      await api("/api/admin/team", { method: "POST", body: JSON.stringify({ email: $("tm-email").value.trim(), role: $("tm-role").value }) });
      toast("Saved"); go("admin");
    });
    on("btn-campus", async () => {
      campuses = await api("/api/admin/campuses", { method: "POST", body: JSON.stringify({ slug: $("cp-slug").value, short: $("cp-short").value, name: $("cp-name").value }) });
      toast("Campus added"); go("admin");
    });
    on("btn-share", () => share(shareLink(), `Earn money, find a study partner, walk home safely and get help with food. Join Work@Campus free (${campusName()}):`));
    on("btn-share-amb", () => share(me.ambassador.link, `Join Work@Campus free: student jobs, safe walks, market and food bank.`));
    on("btn-promo", async () => {
      const plan = $("pr-plan").value;
      await api("/api/admin/promos", { method: "POST", body: JSON.stringify({ code: $("pr-code").value, pct: Number($("pr-pct").value), max: Number($("pr-max").value), plans: plan ? [plan] : [] }) });
      toast("Code created"); go("admin");
    });
    on("btn-stop-renew", async () => {
      if (!confirm("Stop automatic renewal? Your plan stays on until the end of the month you paid for.")) return;
      me = (await api("/api/me/stop-renewal", { method: "POST" })).user; toast("Automatic renewal stopped"); go("me");
    });
    on("btn-delete", async () => {
      if (!confirm("Delete your account for good?")) return;
      await api("/api/me/delete", { method: "POST", body: JSON.stringify({ password: $("del-pass").value }) });
      me = null; toast("Your account was deleted"); go("home");
    });
    on("btn-sponsor", async () => {
      await api("/api/admin/settings", { method: "POST", body: JSON.stringify({ sponsor_name: $("sp-name").value, sponsor_line: $("sp-line").value }) });
      toast("Saved"); go("admin");
    });
    on("btn-sold", async () => { await api(`/api/market/${selectedItem}/sold`, { method: "POST" }); toast("Marked as sold"); go("market"); });
    bindMarketAdmin();
    on("btn-remove", async () => { await api(`/api/admin/gigs/${selectedGig}/remove`, { method: "POST" }); toast("Removed"); go("gigs"); });
    on("btn-plate", async () => { await api("/api/plates", { method: "POST", body: JSON.stringify({ need: $("h-need").value, note: $("h-note").value }) }); toast("Sent quietly. Admin will contact you."); go("help"); });
    on("btn-logout", async () => { await api("/api/auth/logout", { method: "POST" }); me = null; toast("Logged out"); go("home"); });
    document.querySelectorAll("[data-buy]").forEach(b => b.onclick = act(async () => {
      if (!me) return go("login");
      const d = await api("/api/payfast/checkout", { method: "POST", body: JSON.stringify({ item: b.getAttribute("data-buy"), gig: b.getAttribute("data-gig"), code: $("promo")?.value.trim() || undefined }) });
      toast("Opening PayFast...");
      payfastRedirect(d.url, d.params);
    }));
  }

  document.addEventListener("click", e => {
    const g = e.target.closest("#welcome [data-go]");
    if (g) go(g.getAttribute("data-go"));
  });

  window.addEventListener("offline", () => $("offline-banner").classList.remove("hidden"));
  window.addEventListener("online", () => $("offline-banner").classList.add("hidden"));

  (async () => {
    try { campuses = await api("/api/campuses"); } catch {}
    const fromLink = document.querySelector('meta[name="wc-campus"]')?.content || location.pathname.split("/")[1];
    if (fromLink && campuses.some(c => c.slug === fromLink)) { campus = fromLink; localStorage.setItem("campus", campus); }
    if (!campuses.some(c => c.slug === campus)) campus = campuses[0].slug;
    if (location.pathname !== "/") history.replaceState(null, "", "/" + location.search);
    await loadMe();
    const wc = document.getElementById("welcome-campus"); if (wc) wc.textContent = campusName().toUpperCase();
    document.title = "Work@Campus · " + campusName();
    const paid = new URLSearchParams(location.search).get("paid");
    if (paid !== null) history.replaceState(null, "", "/");
    if (paid === "1") { toast("Thank you! Your plan switches on as soon as PayFast confirms."); go("shop"); }
    else if (paid === "0") { toast("Payment cancelled"); go("shop"); }
    else if (me) go("home");
    else showWelcome(true);
  })();
})();
