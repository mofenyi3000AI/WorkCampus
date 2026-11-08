# Work@Campus

University of Limpopo student app: paid gigs, walking buddies, study partners, a quiet food bank, and paid plans through PayFast.

**To put it online for free, follow DEPLOY.md.**

## What was fixed (Oct 2026)
- **Data no longer disappears.** It used to save to a file that Render's free plan wipes. It now saves to a free Neon database (`DATABASE_URL`). On a laptop with no database set, it uses a local file.
- **Payments can't be faked.** Before, anyone could send a fake "payment complete" message and get a free plan. Now every payment is checked with PayFast's signature, confirmed with PayFast's server, and the amount must match.
- **Prices are set on the server** (R39 Poster, R79 Campus Pro), so they can't be changed in the browser.
- **Checkout now works with PayFast** (signed form post, not a link).
- **Posts are safe to display.** Text that students type can no longer run code on other students' phones.
- **Photos.** Students send the front of their student card and a selfie when they join (or later under Me). Admin approves them. Only verified students can accept jobs and join or post walks. Job posts can have a photo. Card photos and selfies are private - only the student and admin can open them.
- **Walk, Study and Food bank screens now work.** These buttons used to open blank pages. Walk and study requests are free to post. Food requests are seen by admin only.
- **Plans expire** after the paid month unless renewed.
- **Admin desk** shows food requests (with a "Mark helped" button) and payments. Admin can remove bad posts.
- The admin password is no longer printed in the logs. Changing `ADMIN_PASSWORD` in the host resets it.

## What was fixed (Nov 2026)
- **Students can now talk both ways.** Before, a student could message a job poster, but the poster could not reply. So no job could actually be arranged. Now each post has a private chat with each student, and accepting a job opens the chat automatically.
- **The market now exists.** Campus Pro (R79) was sold as "sell on the campus market", but there was no market screen. There is now a Market screen (on the Home page) where Campus Pro members can sell, any student can buy and message the seller, and admin approves each item.

- **Business plan (R499 a month).** Shops, landlords and employers can sign up without a student number. Their posts show their business name and sit at the top of the jobs list.
- **Featured posts (R29 for 7 days).** Anyone can pay to move their job post to the top.
- **Money card on the Admin desk.** Shows what came in this month, monthly subscriptions, and progress towards R300,000 a month.
- **Food bank sponsor.** Admin can name a "Plate Fund partner" that students see on the Food bank screen. This is what you offer to sponsors.

- **Automatic monthly renewal (ready, switched off).** PayFast can charge members every month by itself. See PAYFAST-SETUP.md to switch it on safely. Members can stop it under Me.
- **Renewal reminders.** Members see a reminder 5 days before their plan ends, and a "Renew now" message once it has ended.
- **Promo codes.** On the Admin desk, create codes like LAUNCH50 (50% off the first payment). You can limit them to one plan and a number of uses.
- **Privacy (POPIA).** There is a Privacy policy page. Student card photos and selfies are deleted as soon as admin has checked them. Members can delete their own account under Me.

- **More than one university.** Add campuses on the Admin desk. Each gets its own short link (e.g. /ul, /univen), and students only see posts from their own campus.
- **Office admin.** On the Admin desk → Team, make Puleng (or anyone with an account) an admin.
- **Ambassadors.** Make a student an ambassador on the Admin desk. They get an invite link and earn 20% of what the people they invite pay, for 12 months. You record payouts on the Admin desk.
- **Share links with previews.** workcampus.onrender.com/ul shows a picture and description when posted in WhatsApp or Facebook.

## Run on a laptop
```bash
npm install
cp .env.example .env   # then edit ADMIN_PASSWORD
npm start
```
Open http://localhost:3000
