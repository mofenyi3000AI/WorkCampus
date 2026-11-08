# Work@Campus: notes for Claude

## The owner's goal
The owner wants Work@Campus to become an app that makes **millions**. They are not a developer
("I don't know what I'm doing"), so explain things in plain words, avoid jargon, and give clear next steps.
Judge every suggestion by this question: **does it bring in money, or bring in the students who will pay?**

## The money today
- Poster plan R39/month (post paid jobs). Campus Pro R79/month (post jobs and sell on the market).
- Payments go through PayFast. Prices are set in `server.js` (`PLANS`).
- The owner's other business is beegroup.co.za, which uses the same PayFast account. Never change the PayFast passphrase.

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

## Tech facts
- Node/Express app: `server.js` (API), `store.js` (Neon Postgres or a local file), `public/` (one-page phone app).
- All data lives in one JSON document (`app_state`). That is fine for thousands of users. Move to proper tables before multi-campus growth.
- Hosting: Render free plan plus a free Neon database (see DEPLOY.md).
