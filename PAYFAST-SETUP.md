# PayFast - what to do (step by step)

You already have a PayFast account (your beegroup.co.za shop uses it).
Work@Campus can use the **same account**. You do not need a second one.

> **Important:** do NOT change anything in PayFast that the beegroup.co.za shop uses -
> especially the passphrase. If you change it, the shop's payments will stop working.

## 1. Check your account can receive money
1. Log in at https://payfast.io (or payfast.co.za).
2. Check that your account is **verified** - your ID, business documents and bank account
   must be approved. If PayFast asks for documents, upload them first.
3. Check which bank account payouts go to (look under **Settings** for payout or bank details).
   That is where student payments will land.

## 2. Copy three things
1. Go to **Settings → Developer settings**.
2. Copy your **Merchant ID** and **Merchant Key** (shown on that page).
3. Look at the **passphrase** (also called salt passphrase or security passphrase):
   - **If one is already set:** don't change it. Ask Tayyab for it - he set up the shop.
   - **If none is set:** ask Tayyab before setting one. Setting a new one can break the shop
     if the shop isn't set up for it.

## 3. Put them into Work@Campus
In Render → your `workcampus` service → **Environment**, add:

| Name | Value |
|---|---|
| `PAYFAST_MERCHANT_ID` | your Merchant ID |
| `PAYFAST_MERCHANT_KEY` | your Merchant Key |
| `PAYFAST_PASSPHRASE` | the passphrase (leave out if your account has none) |
| `PAYFAST_SANDBOX` | `false` |

Click **Save**. Render restarts the app (about 2 minutes).

## 4. Test with real money
1. Open Work@Campus on your phone and create a normal student account (not admin).
2. Go to **Plans** and pay **R39** with your own card.
3. Within a minute, the account's plan should show **starter** under **Me**.
4. In PayFast you will see the R39 payment. That is your proof it works.

If the plan does not switch on: in Render, open **Logs** and look for a line starting with
`PayFast ITN:`. It says what went wrong - send it to Claude.

## What you do NOT need
- **PayPal** - not needed. South African students pay with card or Instant EFT through PayFast.
- Any change on beegroup.co.za.
- Any code changes. Prices (R39 and R79) are in the app already.

## Fees
PayFast takes a small fee from each payment. Check the current fees on PayFast's pricing page
so you know what lands in your bank from each R39 and R79.

---

# Automatic monthly renewal (switch on later)

The app can charge students and businesses **every month by itself**, so they don't have to come back and pay.
It is **off** until you switch it on, because PayFast has two rules:

1. **The PayFast account must have a passphrase.** Your beegroup.co.za shop uses the same account,
   and changing its passphrase can break the shop.
2. **Recurring Billing must be switched on** in PayFast.

## The safe way: a separate PayFast account for Work@Campus
1. Ask PayFast (support or your account page) to open a **second merchant account** for Work@Campus,
   or open a new one in the name of the Work@Campus business.
2. On that account only: **Settings → Developer settings → set a passphrase.** Choose a long one and keep it private.
3. On that account: switch on **Recurring Billing** (also called Subscriptions) in Settings.
   If you can't find it, ask PayFast support to switch it on.
4. In Render → WorkCampus → **Environment**, update:

| Name | Value |
|---|---|
| `PAYFAST_MERCHANT_ID` | the new account's Merchant ID |
| `PAYFAST_MERCHANT_KEY` | the new account's Merchant Key |
| `PAYFAST_PASSPHRASE` | the passphrase you set in step 2 |
| `PAYFAST_RECURRING` | `true` |

5. Save. Render restarts the app. The Plans page now says "Plans renew automatically every month".
6. Test: buy the R39 plan with your own card. Under **Me** it should say "renews automatically on ...".
   Tap **Stop automatic renewal** to check that it stops, and look in PayFast to confirm the subscription is cancelled.

If something goes wrong, set `PAYFAST_RECURRING` to `false`. Payments go back to one month at a time.
