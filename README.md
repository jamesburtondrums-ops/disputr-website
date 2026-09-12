# Disputr V3

This branch contains the current V3 staging/production candidate for the Disputr complaint-management service.

## Runtime

Cloudflare Workers serves the application. `wrangler.jsonc` points to `worker-v3.js`, the current API/runtime entrypoint. The deployed static site is **only** the `public/` directory. Older root-level HTML/JavaScript is legacy source and is not served by V3.

## Customer journey

1. Public homepage, How it works, pricing and complaint guides remain accessible whether signed in or not.
2. Signing in directly lands on **My Disputr** (`/dashboard.html`). If sign-in was required for a specific safe same-origin destination, the user returns to that destination.
3. Signed-in navigation to public pages does not end the session. The header changes to **My Disputr** and complaint CTAs route back into the authenticated dashboard.
4. Browser Back/Forward navigation does not sign the user out. Restored pages refresh their authentication UI from `/api/me`.
5. The only customer action that destroys the session is the explicit **Sign out** control.
6. My Disputr lists cases and reminders. A case stores complaint details, generated draft wording, evidence, timeline events and reminders.
7. Premium checkout uses Stripe and includes the configured free trial. Stripe webhooks update Premium entitlement state.

## Navigation invariants

- The Disputr wordmark always provides a predictable route to the public homepage.
- Public navigation never redirects an authenticated user to login.
- Protected pages redirect to login only when the API positively reports that authentication is required; transient API failures are shown as errors rather than treated as logout.
- Login `next` destinations are restricted to safe same-origin paths and cannot point back to the login page, preventing redirect loops.
- No customer navigation intentionally opens duplicate browser tabs/windows.

## API and storage

Routes cover authentication, `/api/me`, complaint drafting, complaint CRUD, timeline events, evidence upload/download/delete, reminders, support, Stripe checkout/portal and Stripe webhooks.

- D1: users, sessions, complaints, case events, evidence metadata, reminders, support, AI usage and subscription state.
- R2: private evidence objects.
- OpenAI Responses API: suggested complaint wording with `store:false`.
- Stripe: subscription checkout, billing portal and webhook state updates.

## Authentication

Passwords are stored as PBKDF2-SHA256 hashes using 100,000 iterations for compatibility with the current deployed account format. Session tokens are random 32-byte hexadecimal values; only SHA-256 token hashes are stored in D1. Session cookies are Secure, HttpOnly and SameSite=Lax with a 30-day lifetime.

## Environments

The `staging` Wrangler environment uses the staging D1 database and staging evidence R2 bucket. Production must not be promoted until the V3 staging journey has passed end-to-end testing and production R2/live Stripe configuration are explicitly ready.

## Migrations

D1 schema files live in `migrations/`. Adding a migration file does not itself mean it has been applied to a deployed D1 database.
