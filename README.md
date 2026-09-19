# Disputr

Disputr is a Cloudflare Worker and static web app for preparing UK consumer complaint drafts, finding official company complaint routes and managing a Premium subscription.

## Runtime

- Cloudflare Worker with static assets
- D1 database for accounts, sessions, support messages and subscription state
- Workers AI with an OpenAI fallback for draft generation
- Stripe Checkout, Billing Portal and signed webhooks for Premium

## Billing configuration

The repository contains no secret values. Configure these as encrypted Worker secrets:

- `STRIPE_SECRET_KEY` — preferably a restricted key with only the required Checkout, Customer, Subscription and Billing Portal permissions
- `STRIPE_WEBHOOK_SECRET` — signing secret for `https://disputr.uk/api/billing/webhook`

`STRIPE_PRICE_ID` is a non-secret Worker variable. The checked-in value belongs to the connected DisputrUK sandbox and must be replaced with the live £5 monthly Price ID before live-mode launch.

## Checks

```bash
node tests/smoke.mjs
npx wrangler deploy --dry-run
```
