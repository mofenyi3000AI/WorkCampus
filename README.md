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

## Run on a laptop
```bash
npm install
cp .env.example .env   # then edit ADMIN_PASSWORD
npm start
```
Open http://localhost:3000
