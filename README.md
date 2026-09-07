# Disputr AI complaint builder pages

Upload these three files to the root of `jamesburtondrums-ops/disputr-website`, replacing the existing versions:

- finance-complaint-builder.html
- travel-complaint-builder.html
- home-utilities-complaint-builder.html

These pages make POST requests to `/api/generate-complaint`. They require your Cloudflare Worker to be deployed with the AI binding and the `worker.js` API code already in place.

They also require `assets/styles.css` to remain in the repository.
