const JSON_HEADERS = {
  "content-type": "application/json; charset=UTF-8",
  "cache-control": "no-store",
};

const SESSION_COOKIE = "disputr_session";
const SESSION_DAYS = 30;
const WEBHOOK_TOLERANCE_SECONDS = 300;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (
        request.method === "POST" &&
        url.pathname === "/api/billing/create-checkout-session"
      ) {
        return await createCheckoutSession(request, env);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/webhooks/stripe"
      ) {
        return await handleStripeWebhook(request, env);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/auth/request-magic-link"
      ) {
        return await requestMagicLink(request, env);
      }

      if (
        request.method === "GET" &&
        url.pathname === "/api/auth/verify"
      ) {
        return await verifyMagicLink(request, env);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/auth/logout"
      ) {
        return logout();
      }

      if (
        request.method === "GET" &&
        url.pathname === "/api/auth/me"
      ) {
        return await getCurrentUser(request, env);
      }

      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error("Unhandled Worker error:", {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : null,
      });

      if (url.pathname.startsWith("/api/")) {
        return json({ error: "Server error. Check Worker logs." }, 500);
      }

      return new Response("Internal Server Error", { status: 500 });
    }
  },
};

/* -------------------------------------------------------------------------- */
/* Authentication                                                             */
/* -------------------------------------------------------------------------- */

async function requestMagicLink(request, env) {
  requireDatabase(env);

  const body = await readJson(request);

  const email = typeof body?.email === "string"
    ? body.email.trim().toLowerCase()
    : "";

  if (!isValidEmail(email)) {
    return json({ error: "Enter a valid email address." }, 400);
  }

  const user = await env.DB.prepare(
    `
    INSERT INTO users (email, premium, created_at, updated_at)
    VALUES (?, 0, unixepoch(), unixepoch())
    ON CONFLICT(email) DO UPDATE SET
      updated_at = unixepoch()
    RETURNING id, email, premium
    `
  )
    .bind(email)
    .first();

  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const expiresAt = nowSeconds() + (15 * 60);

  await env.DB.prepare(
    `
    INSERT INTO magic_links (
      user_id,
      token_hash,
      expires_at,
      created_at
    )
    VALUES (?, ?, ?, unixepoch())
    `
  )
    .bind(user.id, tokenHash, expiresAt)
    .run();

  const origin = new URL(request.url).origin;
  const verifyUrl = `${origin}/api/auth/verify?token=${encodeURIComponent(token)}`;

  /*
    For production, send verifyUrl using your email provider.
    If EMAIL_WEBHOOK_URL is configured, the Worker POSTs to it.
    If it is not configured, the URL is returned only in development mode.
  */
  if (env.EMAIL_WEBHOOK_URL) {
    const emailResponse = await fetch(env.EMAIL_WEBHOOK_URL, {
      method: "POST",
      headers: {
        authorization: env.EMAIL_WEBHOOK_TOKEN
          ? `Bearer ${env.EMAIL_WEBHOOK_TOKEN}`
          : "",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        to: email,
        subject: "Your Disputr sign-in link",
        text: `Sign in to Disputr: ${verifyUrl}`,
        html: `<p>Sign in to Disputr:</p><p><a href="${verifyUrl}">Sign in securely</a></p>`,
      }),
    });

    if (!emailResponse.ok) {
      console.error("Magic-link email delivery failed", {
        status: emailResponse.status,
      });

      return json(
        { error: "Unable to send sign-in email. Please try again." },
        502
      );
    }

    return json({ ok: true });
  }

  /*
    Do not enable this in production. It exists only so an initial D1-backed
    auth flow can be tested before an email provider is configured.
  */
  if (env.ENVIRONMENT === "development") {
    return json({ ok: true, developmentVerifyUrl: verifyUrl });
  }

  return json(
    {
      error:
        "Email delivery is not configured. Set EMAIL_WEBHOOK_URL before using magic-link sign-in.",
    },
    500
  );
}

async function verifyMagicLink(request, env) {
  requireDatabase(env);

  const url = new URL(request.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return new Response("Invalid sign-in link.", { status: 400 });
  }

  const tokenHash = await sha256Hex(token);

  const link = await env.DB.prepare(
    `
    SELECT id, user_id
    FROM magic_links
    WHERE token_hash = ?
      AND used_at IS NULL
      AND expires_at > unixepoch()
    LIMIT 1
    `
  )
    .bind(tokenHash)
    .first();

  if (!link) {
    return new Response(
      "This sign-in link is invalid or has expired.",
      { status: 400 }
    );
  }

  const sessionToken = randomToken();
  const sessionHash = await sha256Hex(sessionToken);
  const expiresAt = nowSeconds() + (SESSION_DAYS * 24 * 60 * 60);

  await env.DB.batch([
    env.DB.prepare(
      `
      UPDATE magic_links
      SET used_at = unixepoch()
      WHERE id = ?
      `
    ).bind(link.id),

    env.DB.prepare(
      `
      INSERT INTO sessions (
        user_id,
        token_hash,
        expires_at,
        created_at
      )
      VALUES (?, ?, ?, unixepoch())
      `
    ).bind(link.user_id, sessionHash, expiresAt),
  ]);

  return new Response(null, {
    status: 302,
    headers: {
      location: "/dashboard.html",
      "set-cookie": buildSessionCookie(sessionToken, SESSION_DAYS),
    },
  });
}

async function getCurrentUser(request, env) {
  const user = await requireAuth(request, env);

  return json({
    user: {
      id: user.id,
      email: user.email,
      premium: Boolean(user.premium),
    },
  });
}

async function requireAuth(request, env) {
  requireDatabase(env);

  const cookies = parseCookies(request.headers.get("cookie") || "");
  const token = cookies[SESSION_COOKIE];

  if (!token) {
    return null;
  }

  const tokenHash = await sha256Hex(token);

  return env.DB.prepare(
    `
    SELECT
      users.id,
      users.email,
      users.premium
    FROM sessions
    INNER JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ?
      AND sessions.expires_at > unixepoch()
    LIMIT 1
    `
  )
    .bind(tokenHash)
    .first();
}

function logout() {
  return json(
    { ok: true },
    200,
    {
      "set-cookie": `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
    }
  );
}

/* -------------------------------------------------------------------------- */
/* Stripe Checkout                                                            */
/* -------------------------------------------------------------------------- */

async function createCheckoutSession(request, env) {
  requireDatabase(env);
  requireStripeCheckoutConfig(env);

  const user = await requireAuth(request, env);

  if (!user?.id) {
    return json({ error: "You must sign in first." }, 401);
  }

  const origin = new URL(request.url).origin;
  const form = new URLSearchParams();

  form.set("mode", "subscription");
  form.set(
    "success_url",
    `${origin}/subscription-and-billing.html?checkout=success`
  );
  form.set(
    "cancel_url",
    `${origin}/subscription-and-billing.html?checkout=canceled`
  );

  form.set("line_items[0][price]", env.STRIPE_PRICE_ID);
  form.set("line_items[0][quantity]", "1");

  /*
    User linkage for checkout.session.completed.
  */
  form.set("client_reference_id", user.id);
  form.set("metadata[user_id]", user.id);

  /*
    User linkage for customer.subscription.* webhooks.
  */
  form.set("subscription_data[metadata][user_id]", user.id);

  const stripeResponse = await fetch(
    "https://api.stripe.com/v1/checkout/sessions",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    }
  );

  const stripeResult = await stripeResponse.json();

  if (!stripeResponse.ok) {
    console.error("Stripe Checkout Session creation failed", {
      status: stripeResponse.status,
      error: stripeResult?.error?.message || stripeResult,
    });

    return json(
      {
        error:
          stripeResult?.error?.message ||
          "Stripe rejected the checkout request.",
      },
      502
    );
  }

  if (!stripeResult?.url) {
    return json(
      { error: "Stripe did not return a Checkout URL." },
      502
    );
  }

  return json({ checkoutUrl: stripeResult.url });
}

/* -------------------------------------------------------------------------- */
/* Stripe webhook                                                             */
/* -------------------------------------------------------------------------- */

async function handleStripeWebhook(request, env) {
  requireDatabase(env);

  if (!env.STRIPE_WEBHOOK_SECRET) {
    return json({ error: "Webhook secret is not configured." }, 500);
  }

  const signatureHeader = request.headers.get("stripe-signature");

  if (!signatureHeader) {
    return json({ error: "Missing Stripe-Signature header." }, 400);
  }

  /*
    Signature verification must use the exact raw body. Do not call
    request.json() before request.text().
  */
  const rawBody = await request.text();

  const valid = await verifyStripeSignature(
    rawBody,
    signatureHeader,
    env.STRIPE_WEBHOOK_SECRET
  );

  if (!valid) {
    return json({ error: "Invalid Stripe webhook signature." }, 400);
  }

  let event;

  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: "Invalid Stripe event payload." }, 400);
  }

  if (!event?.id || !event?.type || !event?.created || !event?.data?.object) {
    return json({ error: "Malformed Stripe event." }, 400);
  }

  /*
    Insert into the event ledger first. The primary key guarantees a Stripe
    retry of the same evt_ ID cannot reapply entitlement changes.
  */
  const ledger = await env.DB.prepare(
    `
    INSERT INTO stripe_webhook_events (
      stripe_event_id,
      event_type,
      event_created_at,
      received_at
    )
    VALUES (?, ?, ?, unixepoch())
    ON CONFLICT(stripe_event_id) DO NOTHING
    `
  )
    .bind(event.id, event.type, event.created)
    .run();

  if (ledger.meta.changes === 0) {
    return json({ received: true, duplicate: true });
  }

  try {
    await processStripeEvent(env.DB, event);
  } catch (error) {
    /*
      Delete the ledger entry so Stripe's retry can safely retry this event.
    */
    await env.DB.prepare(
      `DELETE FROM stripe_webhook_events WHERE stripe_event_id = ?`
    )
      .bind(event.id)
      .run();

    throw error;
  }

  return json({ received: true });
}

async function processStripeEvent(db, event) {
  const object = event.data.object;

  switch (event.type) {
    case "checkout.session.completed":
      await recordCheckoutLink(db, event, object);
      return;

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await upsertStripeSubscription(db, event, object);
      return;

    case "invoice.payment_failed":
      await recordPaymentFailure(db, event, object);
      return;

    default:
      return;
  }
}

async function recordCheckoutLink(db, event, session) {
  if (session.mode !== "subscription") {
    return;
  }

  const subscriptionId = stripeId(session.subscription);

  if (!subscriptionId) {
    return;
  }

  const userId = getUserId(session);
  const customerId = stripeId(session.customer);

  if (!userId) {
    return;
  }

  await db.prepare(
    `
    INSERT INTO subscriptions (
      stripe_subscription_id,
      stripe_customer_id,
      user_id,
      status,
      premium,
      last_stripe_event_created,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, 'incomplete', 0, ?, unixepoch(), unixepoch())
    ON CONFLICT(stripe_subscription_id) DO UPDATE SET
      stripe_customer_id = COALESCE(excluded.stripe_customer_id, subscriptions.stripe_customer_id),
      user_id = COALESCE(excluded.user_id, subscriptions.user_id),
      last_stripe_event_created = MAX(
        subscriptions.last_stripe_event_created,
        excluded.last_stripe_event_created
      ),
      updated_at = unixepoch()
    `
  )
    .bind(subscriptionId, customerId, userId, event.created)
    .run();
}

async function upsertStripeSubscription(db, event, subscription) {
  const subscriptionId = stripeId(subscription.id);
  const customerId = stripeId(subscription.customer);

  if (!subscriptionId) {
    throw new Error("Stripe subscription event has no subscription ID.");
  }

  const status =
    event.type === "customer.subscription.deleted"
      ? "canceled"
      : typeof subscription.status === "string"
        ? subscription.status
        : "incomplete";

  const premium = isPremiumStatus(status) ? 1 : 0;
  const userId = getUserId(subscription);

  await db.prepare(
    `
    INSERT INTO subscriptions (
      stripe_subscription_id,
      stripe_customer_id,
      user_id,
      status,
      premium,
      current_period_end,
      trial_end,
      cancel_at_period_end,
      last_stripe_event_created,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())
    ON CONFLICT(stripe_subscription_id) DO UPDATE SET
      stripe_customer_id = COALESCE(excluded.stripe_customer_id, subscriptions.stripe_customer_id),
      user_id = COALESCE(excluded.user_id, subscriptions.user_id),
      status = CASE
        WHEN excluded.last_stripe_event_created >= subscriptions.last_stripe_event_created
          THEN excluded.status
        ELSE subscriptions.status
      END,
      premium = CASE
        WHEN excluded.last_stripe_event_created >= subscriptions.last_stripe_event_created
          THEN excluded.premium
        ELSE subscriptions.premium
      END,
      current_period_end = CASE
        WHEN excluded.last_stripe_event_created >= subscriptions.last_stripe_event_created
          THEN excluded.current_period_end
        ELSE subscriptions.current_period_end
      END,
      trial_end = CASE
        WHEN excluded.last_stripe_event_created >= subscriptions.last_stripe_event_created
          THEN excluded.trial_end
        ELSE subscriptions.trial_end
      END,
      cancel_at_period_end = CASE
        WHEN excluded.last_stripe_event_created >= subscriptions.last_stripe_event_created
          THEN excluded.cancel_at_period_end
        ELSE subscriptions.cancel_at_period_end
      END,
      last_stripe_event_created = MAX(
        subscriptions.last_stripe_event_created,
        excluded.last_stripe_event_created
      ),
      updated_at = unixepoch()
    `
  )
    .bind(
      subscriptionId,
      customerId,
      userId,
      status,
      premium,
      subscription.current_period_end ?? null,
      subscription.trial_end ?? null,
      subscription.cancel_at_period_end ? 1 : 0,
      event.created
    )
    .run();

  await syncPremiumEntitlement(db, subscriptionId);
}

async function recordPaymentFailure(db, event, invoice) {
  const subscriptionId = stripeId(invoice.subscription);

  if (!subscriptionId) {
    return;
  }

  await db.prepare(
    `
    UPDATE subscriptions
    SET
      status = CASE
        WHEN ? >= last_stripe_event_created THEN 'past_due'
        ELSE status
      END,
      premium = CASE
        WHEN ? >= last_stripe_event_created THEN 0
        ELSE premium
      END,
      last_stripe_event_created = MAX(last_stripe_event_created, ?),
      updated_at = unixepoch()
    WHERE stripe_subscription_id = ?
    `
  )
    .bind(event.created, event.created, event.created, subscriptionId)
    .run();

  await syncPremiumEntitlement(db, subscriptionId);
}

async function syncPremiumEntitlement(db, subscriptionId) {
  const subscription = await db.prepare(
    `
    SELECT user_id, premium
    FROM subscriptions
    WHERE stripe_subscription_id = ?
    LIMIT 1
    `
  )
    .bind(subscriptionId)
    .first();

  if (!subscription?.user_id) {
    return;
  }

  await db.prepare(
    `
    UPDATE users
    SET
      premium = ?,
      updated_at = unixepoch()
    WHERE id = ?
    `
  )
    .bind(subscription.premium, subscription.user_id)
    .run();
}

/* -------------------------------------------------------------------------- */
/* Stripe HMAC verification                                                   */
/* -------------------------------------------------------------------------- */

async function verifyStripeSignature(rawBody, header, secret) {
  const parsed = parseStripeSignature(header);

  if (!parsed.timestamp || parsed.v1.length === 0) {
    return false;
  }

  if (
    Math.abs(nowSeconds() - parsed.timestamp) >
    WEBHOOK_TOLERANCE_SECONDS
  ) {
    return false;
  }

  const signedPayload = `${parsed.timestamp}.${rawBody}`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signedPayload)
  );

  const expected = bytesToHex(new Uint8Array(signature));

  return parsed.v1.some((received) =>
    timingSafeEqualHex(expected, received)
  );
}

function parseStripeSignature(header) {
  let timestamp = null;
  const v1 = [];

  for (const part of header.split(",")) {
    const separator = part.indexOf("=");

    if (separator === -1) {
      continue;
    }

    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();

    if (key === "t" && /^\d+$/.test(value)) {
      timestamp = Number(value);
    }

    if (key === "v1" && /^[a-f0-9]{64}$/i.test(value)) {
      v1.push(value.toLowerCase());
    }
  }

  return { timestamp, v1 };
}

function timingSafeEqualHex(left, right) {
  if (
    typeof left !== "string" ||
    typeof right !== "string" ||
    left.length !== right.length
  ) {
    return false;
  }

  let mismatch = 0;

  for (let i = 0; i < left.length; i += 1) {
    mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }

  return mismatch === 0;
}

/* -------------------------------------------------------------------------- */
/* Utilities                                                                  */
/* -------------------------------------------------------------------------- */

function requireDatabase(env) {
  if (!env.DB) {
    throw new Error(
      "Missing D1 binding DB. Configure a valid D1 database binding."
    );
  }
}

function requireStripeCheckoutConfig(env) {
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error("Missing STRIPE_SECRET_KEY Worker secret.");
  }

  if (!env.STRIPE_PRICE_ID) {
    throw new Error("Missing STRIPE_PRICE_ID Worker secret.");
  }
}

function getUserId(object) {
  const value =
    object?.metadata?.user_id ??
    object?.client_reference_id ??
    null;

  return typeof value === "string" && value.length > 0
    ? value
    : null;
}

function stripeId(value) {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (
    value &&
    typeof value === "object" &&
    typeof value.id === "string" &&
    value.id.length > 0
  ) {
    return value.id;
  }

  return null;
}

function isPremiumStatus(status) {
  return status === "trialing" || status === "active";
}

function parseCookies(header) {
  const result = {};

  for (const part of header.split(";")) {
    const index = part.indexOf("=");

    if (index === -1) {
      continue;
    }

    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();

    if (key) {
      result[key] = decodeURIComponent(value);
    }
  }

  return result;
}

function buildSessionCookie(token, days) {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    `Max-Age=${days * 24 * 60 * 60}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));

  return Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );

  return bytesToHex(new Uint8Array(digest));
}

function bytesToHex(bytes) {
  let hex = "";

  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }

  return hex;
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...extraHeaders,
    },
  });
}
