# Disputr V2

This branch contains the staging/production candidate for the Disputr complaint-management service.

## Runtime

Cloudflare Workers serves the application. `wrangler.jsonc` points to `worker-v3.js`, which is the current API/runtime entrypoint on this branch.

The deployed static site is **only** the `public/` directory. Older HTML and JavaScript files that still exist at repository root are legacy material and are not part of the current deployed V2 site.

## Current customer journey

1. Public homepage and free complaint guides.
2. Sign in or create an account when the user wants to save/manage a case.
3. My Disputr dashboard lists cases and reminders.
4. A case can store complaint details, generated draft wording, evidence, timeline events and reminders.
5. Premium checkout uses Stripe and includes the configured free trial.
6. Stripe webhooks update Premium status.

## API

Current routes include authentication, `/api/me`, complaint drafting, complaint CRUD, timeline events, evidence upload/download/delete, reminders, support, Stripe checkout/portal and Stripe webhooks.

## Storage and services

- D1: users, sessions, complaints, case events, evidence metadata, reminders, support, AI usage and subscription state.
- R2: private evidence objects.
- OpenAI Responses API: suggested complaint wording with `store:false`.
- Stripe: subscription checkout, billing portal and webhook state updates.

## Authentication

Passwords are stored as PBKDF2-SHA256 hashes using the maximum 100,000 iterations supported by the current Cloudflare Workers Web Crypto implementation. Session tokens are random 32-byte hexadecimal values; only their SHA-256 hashes are stored in D1. Session cookies are Secure, HttpOnly and SameSite=Lax.

## Environments

The `staging` Wrangler environment uses the staging D1 database and staging evidence R2 bucket. Production must not be promoted from this branch until production R2 and live Stripe configuration are explicitly completed and the staging journey has been tested end to end.

## Migrations

D1 schema files live in `migrations/`. Existing staging schema was provisioned separately, so adding a migration file does not by itself mean it has been applied to the live staging database.
