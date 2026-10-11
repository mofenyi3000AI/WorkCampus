(() => {
  const $ = (id) => document.getElementById(id);
  let me = null;
  let view = "home";
  let gigs = [];
  let selectedGig = null;

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
    return `<div class="topbar"><div class="brand"><img src="/assets/logo.jpg" alt="" /><div>${esc(title)}<small>${esc(sub || "University of Limpopo")}</small></div></div><div class="pill live"><span class="dot"></span>Online</div></div>`;
  }

  async function loadMe() { try { me = (await api("/api/me")).user; } catch { me = null; } }
  async function loadGigs(cat) { try { gigs = await api("/api/gigs" + (cat ? "?cat=" + cat : "")); } catch { gigs = []; } }

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
        <button class="btn teal" id="btn-register">Create free account</button>
      </div>`;
  }

  function renderHome() {
    const open = gigs.filter(g => g.status === "open");
    return `
      ${header("Welcome", me ? me.first_name : "Campus")}
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
        <button class="cat move" data-go="gigs"><b>Move & bakkie</b><span>Boxes, lifts</span></button>
        <button class="cat meet" data-go="shop"><b>Plans</b><span>Subscribe to post</span></button>
      </div>
      ${open.slice(0, 4).map(gigCard).join("")}
    `;
  }

  function gigCard(g) {
    return `<article class="card tap" data-open-gig="${g.id}">
      ${g.photo ? `<img src="/api/img/${esc(g.photo)}" alt="" loading="lazy" style="width:100%;max-height:170px;object-fit:cover;border-radius:14px;margin-bottom:10px" />` : ""}
      <div class="between"><span class="tag">${esc(CAT_NAMES[g.cat] || g.cat)}</span><div class="price">${g.pay ? "R" + esc(g.pay) : "Free"}</div></div>
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
      ${!me ? `<p class="tiny">Log in to post or reply.</p>` : !canPost ? `<p class="tiny">Posting paid jobs needs a plan. Finding work is free.</p>` : ""}`;
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
        ${me && !mine ? `<div class="field" style="margin-top:12px"><label>Private message to the poster</label><textarea id="reply-body" placeholder="Hi, I can help..."></textarea></div><button class="btn ghost" id="btn-reply">Send privately</button>` : ""}
        ${me && (me.is_admin || mine) ? `<h3 style="margin-top:14px">Messages</h3><div id="replies" class="tiny">Loading...</div>` : ""}
        ${me && me.is_admin ? `<button class="btn danger" style="margin-top:10px" id="btn-remove">Remove post</button>` : ""}
        ${!me ? `<p class="tiny">Log in to accept or reply.</p>` : ""}
      </div>
      <button class="btn ghost" data-go="${g.cat === "walk" ? "walk" : g.cat === "study" ? "study" : "gigs"}">Back</button>`;
  }

  let postCat = "";
  function renderPost() {
    const free = postCat === "walk" || postCat === "study";
    if (!me) return `${header("Post")}<div class="card"><p>Log in first.</p><button class="btn gold" data-go="login">Log in or join</button></div>`;
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

  function renderHelp() {
    if (!me) return `${header("Food bank")}<div class="card"><p>Need a plate? Log in and ask quietly. Only admin sees your name.</p><button class="btn gold" data-go="login">Log in or join</button></div>`;
    return `${header("Food bank", "Private - only admin sees this")}
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
      <div class="card"><p>Free = find work, walk and study posts. Paid = post jobs and sell on the market.</p>
      ${paid ? `<p class="tiny">Your plan: <b>${esc(me.plan)}</b>${me.plan_until ? " until " + new Date(me.plan_until).toLocaleDateString("en-ZA") : ""}</p>` : ""}</div>
      <div class="plan"><h3>Poster</h3><div class="amt">R39<span class="tiny"> / month</span></div><ul><li>Post paid jobs</li></ul><button class="btn sm gold" data-buy="poster-1m">Pay R39</button></div>
      <div class="plan hot"><h3>Campus Pro</h3><div class="amt">R79<span class="tiny"> / month</span></div><ul><li>Post paid jobs</li><li>Sell on the campus market</li></ul><button class="btn sm gold" data-buy="pro-1m">Pay R79</button></div>
      <p class="tiny">Payments go through PayFast. Your plan switches on once PayFast confirms the payment.</p>`;
  }

  function renderMe() {
    if (!me) return `${header("Me")}<button class="btn gold" data-go="login">Log in or join</button>`;
    return `
      ${header("Your card", me.plan)}
      <div class="card">
        <div class="between"><b>${esc(me.first_name)} ${esc(me.surname)}</b>${verifyBadge()}</div>
        <div class="meta">${[me.course, me.year, me.stay].filter(Boolean).map(esc).join(" · ")}</div>
        <div class="tiny">Plan: ${esc(me.plan)}${me.plan_until ? " until " + new Date(me.plan_until).toLocaleDateString("en-ZA") : ""}</div>
      </div>
      ${!me.verified && me.verify_status !== "pending" && !me.is_admin ? `<div class="card">
        <h3>Get verified</h3>
        <p class="tiny">${me.verify_status === "rejected" ? "Your last photos could not be checked. Please send clearer ones." : "Send the front of your student card and a selfie. Only admin sees them."}</p>
        <div class="grid-2">${photoField("v-card", "Student card (front)", "Clear and readable", "environment")}${photoField("v-selfie", "Selfie", "Your face, good light", "user")}</div>
        <button class="btn teal" id="btn-verify">Send for checking</button></div>` : ""}
      ${me.verify_status === "pending" ? `<div class="card"><p class="tiny">Thanks - admin is checking your photos.</p></div>` : ""}
      <button class="btn gold" data-go="shop">Plans</button>
      <button class="btn ghost" style="margin-top:8px" data-go="terms">House rules</button>
      ${me.is_admin ? `<button class="btn ghost" style="margin-top:8px" data-go="admin">Admin desk</button>` : ""}
      <button class="btn ghost" style="margin-top:8px" id="btn-logout">Log out</button>`;
  }

  function renderAdmin() {
    if (!me || !me.is_admin) return header("Admin") + "<p>Admin only.</p>";
    return `${header("Admin desk")}
      <div class="card"><h3>Students to verify</h3><div id="admin-verify" class="tiny">Loading...</div></div>
      <div class="card"><h3>Food requests</h3><div id="admin-plates" class="tiny">Loading...</div></div>
      <div class="card"><h3>Payments</h3><div id="admin-pay" class="tiny">Loading...</div></div>`;
  }

  function renderTerms() {
    return `${header("House rules")}<div class="card"><p>Names stay with admin. Be honest and kind. Finish the jobs you accept. Meet in public places. No assignment cheating - study help means working together, not doing someone's work. Free members find work and post walk and study requests. Paid members post jobs.</p></div><button class="btn gold" data-go="${me ? "me" : "home"}">Back</button>`;
  }

  const views = { login: renderLogin, home: renderHome, gigs: renderGigs, walk: renderWalk, study: renderStudy, gig: renderGig, post: renderPost, help: renderHelp, shop: renderShop, me: renderMe, admin: renderAdmin, terms: renderTerms };
  const PUBLIC = ["login", "terms", "home", "gigs", "walk", "study", "gig", "help", "shop", "me"];

  function showWelcome(yes) {
    $("welcome").classList.toggle("hidden", !yes);
    $("nav").classList.toggle("hidden", yes);
    document.querySelector("main").style.display = yes ? "none" : "block";
  }

  async function render() {
    if (!me && !PUBLIC.includes(view)) view = "login";
    if (["home", "gigs", "walk", "study", "gig"].includes(view)) await loadGigs();
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
    if (view === "gig" && $("replies")) {
      try {
        const r = await api(`/api/gigs/${selectedGig}/replies`);
        $("replies").innerHTML = r.map(x => `<div class="reply"><b>${esc(x.from)}</b><br/>${esc(x.body)}</div>`).join("") || "No messages yet.";
      } catch { $("replies").textContent = "Could not load messages."; }
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
      const body = { email: $("r-email").value, password: $("r-pass").value, first_name: $("r-first").value, surname: $("r-surname").value, student_number: $("r-num").value, course: $("r-course").value, year: $("r-year").value, stay: $("r-stay").value, gender: $("r-gender").value };
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
    on("btn-reply", async () => { await api(`/api/gigs/${selectedGig}/reply`, { method: "POST", body: JSON.stringify({ body: $("reply-body").value }) }); toast("Sent privately"); $("reply-body").value = ""; });
    on("btn-remove", async () => { await api(`/api/admin/gigs/${selectedGig}/remove`, { method: "POST" }); toast("Removed"); go("gigs"); });
    on("btn-plate", async () => { await api("/api/plates", { method: "POST", body: JSON.stringify({ need: $("h-need").value, note: $("h-note").value }) }); toast("Sent quietly. Admin will contact you."); go("help"); });
    on("btn-logout", async () => { await api("/api/auth/logout", { method: "POST" }); me = null; toast("Logged out"); go("home"); });
    document.querySelectorAll("[data-buy]").forEach(b => b.onclick = act(async () => {
      if (!me) return go("login");
      const d = await api("/api/payfast/checkout", { method: "POST", body: JSON.stringify({ item: b.getAttribute("data-buy") }) });
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
    await loadMe();
    const paid = new URLSearchParams(location.search).get("paid");
    if (paid !== null) history.replaceState(null, "", "/");
    if (paid === "1") { toast("Thank you! Your plan switches on as soon as PayFast confirms."); go("shop"); }
    else if (paid === "0") { toast("Payment cancelled"); go("shop"); }
    else if (me) go("home");
    else showWelcome(true);
  })();
})();
