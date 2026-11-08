# Work@Campus: notes for Claude

## The owner's goal
The owner wants to build **businesses that make money on their own**, and to personally earn **R300,000 a month**
(R600,000 a month is the stretch goal). Work@Campus is the first of these businesses.
After tax, R300,000 a month take-home needs roughly R500,000 a month profit across their businesses.
The owner wants Work@Campus to become an app that makes **millions**. They are not a developer
("I don't know what I'm doing"), so explain things in plain words, avoid jargon, and give clear next steps.
Judge every suggestion by this question: **does it bring in money, or bring in the students who will pay?**

## How the owner wants Claude to work
- Do the work directly where possible. Where only the owner can act (signatures, banks, SARS, CIPC, DSD), email them
  a step-by-step To-Do list at their Gmail address.
- Outreach emails go out only under the owner's real name, or from a real person's own account with that person's consent.
  Do not send emails signed as someone else (the owner once asked for "Koos Becker" / "Karien van Niekerk, BEE Group").
- Do not sign documents for anyone. Prepare them ready to sign.

## The business behind Work@Campus
- Work@Campus is run by **Be Everything Energy (Pty) Ltd** (CIPC 2022/451663/07), the BEE Group (beegroup.co.za).
  Its bank account is a Standard Bank MyMoBiz account. Never put bank account numbers in this repo.
- The owner does NOT want a separate company or a separate PayFast account (too much admin and cost).
  Work@Campus uses the BEE Group PayFast account. That account has never received a payment, so setting a
  passphrase on it is low-risk; the beegroup.co.za shop's PayFast plugin must get the same passphrase on the same day.
- Team: the owner plus **Puleng** (office admin, made admin on the Admin desk). More students later if work grows.
- The owner will pay for Render Starter (about R130/month) once the first customer pays.
- The plan is many universities, not just UL. Campuses are added on the Admin desk; each gets a short link (/ul, /univen).
- Student calendar matters: exams and closing in late November/December; the big chance is the January registration rush.

## The money today
- Poster plan R39/month (post paid jobs). Campus Pro R79/month (post jobs and sell on the market).
- Business plan R499/month: business accounts (no student number), business name on posts, all their job posts featured at the top, can sell.
- Featured post R29 for 7 days (one-off), for anyone's own open job post.
- Admin desk shows a Money card: income this month, monthly subscriptions, progress bar to R300,000.
- Admin can set a Food bank sponsor ("Plate Fund partner") shown to students.
- Promo codes (admin desk): % off the first payment, optional plan limit and max uses.
- Automatic monthly renewal via PayFast subscriptions: built, OFF until `PAYFAST_RECURRING=true` and a passphrase is set.
  To switch on: set a passphrase on the BEE Group PayFast account AND in the beegroup.co.za shop plugin (same day).
- POPIA: privacy page, ID photos deleted after verification, self-service account deletion.
- Ambassadors earn 20% of what the people they invite pay, for 12 months (`AMBASSADOR_PCT`, `AMBASSADOR_MONTHS` in server.js).
  Invite links are /r/CODE. Admin records payouts on the Admin desk ("I paid R...").
- Share links (/, /ul, /univen ...) show a picture preview in WhatsApp and Facebook.
- Payments go through PayFast. Prices are set in `server.js` (`PLANS`).
- beegroup.co.za uses the same PayFast account. Only change its passphrase together with the shop's plugin setting.

## Rough sums (for honest planning)
- University of Limpopo has roughly 30,000 students. South Africa has about 1 million university students, plus TVET colleges.
- R1 million a year needs about 1,055 Campus Pro subscribers paying every month.
- Becoming a multi-million-rand business means going beyond one campus. So keep the code ready for more than one university.

## Ideas worth testing (best first)
1. **Charge the side that has money.** Students are short of money. Local businesses, landlords, lecturers and
   companies hiring part-time staff can pay more for job posts and featured ads.
2. **CSI sponsorship.** South African companies spend money on socio-economic development (it counts for their
   B-BBEE score). The food bank and the student jobs fit this well. A sponsored "plate fund" can pay for the app.
3. **A small fee on each job**, once payments can go through the app (later; it needs more legal and PayFast work).
4. **Grow campus by campus.** Find one student ambassador per campus, on a small commission.

## The owner's non-profit (for sponsorships)
- Bo-Kgosi Mofenyi Wamathomo Foundation NPC, CIPC reg. 2022/488509/08, registered 16 May 2022, year end December.
- Plan: open its bank account, register with DSD as an NPO, get SARS PBO + section 18A approval and a tax compliance PIN,
  then use it to receive CSI sponsorship (for example a student plate fund).
- Keep the foundation's money separate from Work@Campus (a business). Any payment from the foundation to Work@Campus
  must be at a fair price and approved by the board, or SARS can withdraw PBO status.
- Never store directors' ID numbers or home addresses in this repo.

## Tech facts
- Node/Express app: `server.js` (API), `store.js` (Neon Postgres or a local file), `public/` (one-page phone app).
- All data lives in one JSON document (`app_state`). That is fine for thousands of users. Move to proper tables before
  it reaches roughly 20,000 users or several busy campuses.
- Each user, job and market item has a `campus` (old data without one counts as "ul").
- Hosting: Render free plan plus a free Neon database (see DEPLOY.md).
- Live app: https://workcampus.onrender.com (Render service "WorkCampus", deploys automatically from `main`).
  Merging to `main` puts changes online within a few minutes.
