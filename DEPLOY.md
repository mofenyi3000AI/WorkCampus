# Get Work@Campus live for R0 a month

You need three free accounts: **GitHub**, **Neon** (the database) and **Render** (the app).
No bank card is needed for Neon. Do it on a laptop if you can — about 20 minutes.

## Why two services?
Render's free plan wipes its own files every time the app sleeps or restarts.
So the app keeps everything (students, posts, payments) in a free **Neon** database instead.
Neon's free plan does not expire and does not need a card.

---

## Step 1 — Free database on Neon
1. Go to https://neon.com and sign up (use "Sign up with GitHub" or Google).
2. Create a project. Name: `workcampus`. Region: pick the closest one offered (Europe is fine).
3. On the project dashboard, click **Connect**.
4. Copy the connection string. It looks like:
   `postgresql://neondb_owner:xxxx@ep-xxxx.eu-central-1.aws.neon.tech/neondb?sslmode=require`
5. Keep it somewhere private. It is a password — never post it in a group or put it in the code.

The app creates its own table the first time it starts. You do not have to set anything up in Neon.

## Step 2 — Put the code on GitHub
1. Sign in at https://github.com.
2. Click **New repository**, name it `workcampus`, choose **Private**, click **Create**.
3. Click **uploading an existing file**, drag in everything inside this folder
   (not the `node_modules` or `data` folders if you see them), then click **Commit changes**.

## Step 3 — Run the app on Render
1. Go to https://render.com and sign up with your GitHub account.
2. Click **New** → **Web Service** → choose your `workcampus` repository.
3. Instance type: **Free**. Leave Build command `npm install` and Start command `node server.js`.
4. Under **Environment Variables**, add:

   | Name | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `DATABASE_URL` | the Neon string from Step 1 |
   | `JWT_SECRET` | any long random text, e.g. 40 random letters and numbers |
   | `ADMIN_EMAIL` | the email you will log in with as admin |
   | `ADMIN_PASSWORD` | a strong password you choose |
   | `PAYFAST_SANDBOX` | `true` (test mode for now) |

5. Click **Create Web Service**. After a few minutes you get a link like
   `https://workcampus.onrender.com`. That is your app.

## Step 4 — Test it
1. Open the link on your phone. Create a student account. Post a "Walk together" request.
2. In Render, click **Manual Deploy → Restart service**. Open the link again.
   Your account and post should still be there. That proves the database is working.
3. Log in with your admin email and password. Open **Me → Admin desk**.
4. New students send a photo of their student card and a selfie. You see them under
   **Admin desk → Students to verify**. Tap **Approve** or **Reject**. Only you can see these photos.

## Step 5 — Switch on real payments (when ready)
Follow **PAYFAST-SETUP.md** (in this folder). It uses the PayFast account you already have for beegroup.co.za, without touching the website.

---

## What the free plan means in practice
- The app **sleeps after 15 minutes** with no visitors. The next person waits about a minute while it wakes up. After that it is fast.
- Render gives **750 free hours a month** — enough for one app running all month.
- Neon free: **1 GB of data** — that is tens of thousands of students and posts.

## When to start paying
Once paying students come in and the one-minute wake-up starts losing you users:
- Render **Starter** plan (about US$7 a month) — the app never sleeps.
- Keep Neon free until you near 1 GB, then move to its paid plan.
Nothing in the code has to change. You just change the plan in each dashboard.

## Forgot the admin password?
Change `ADMIN_PASSWORD` in Render's environment settings and restart. The new password works straight away.

## Own web address later
In Render → **Settings → Custom Domains**, add e.g. `campus.beegroup.co.za` and follow the
two DNS steps it shows (your web developer can do this in 5 minutes).
Then add an environment variable `BASE_URL` = `https://campus.beegroup.co.za`.
