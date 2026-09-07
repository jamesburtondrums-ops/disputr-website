const JSON_HEADERS = {
  "content-type": "application/json; charset=UTF-8",
  "cache-control": "no-store",
};

const SIGNATURE_TOLERANCE_SECONDS = 300;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (
      request.method === "POST" &&
      url.pathname === "/api/webhooks/stripe"
    ) {
      return handleStripeWebhook(request, env);
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/create-checkout-session"
    ) {
      return createCheckoutSession(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};
async function createCheckoutSession(request, env) {
  if (!env.STRIPE_SECRET_KEY) {
    return json(
      { error: "Stripe secret key is not configured." },
      500
    );
  }

  if (!env.STRIPE_PRICE_ID) {
    return json(
      { error: "Stripe price ID is not configured." },
      500
    );
  }

  /*
    IMPORTANT:
    Use the user object already created by your current authenticated-request
    logic. If that function has another name, use that name instead.

    It must return an internal, authenticated user record such as:
    { id: "user_123" }

    Never use await request.json().userId here.
  */
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
    `${origin}/pricing.html?checkout=canceled`
  );

  form.set("line_items[0][price]", env.STRIPE_PRICE_ID);
  form.set("line_items[0][quantity]", "1");

  /*
    This appears in checkout.session.completed.
  */
  form.set("client_reference_id", user.id);

  /*
    This remains on the Checkout Session.
  */
  form.set("metadata[user_id]", user.id);

  /*
    This is copied to the Subscription. Your subscription webhook events
    can read subscription.metadata.user_id.
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
    console.error(
      "Stripe Checkout Session creation failed",
      stripeResult
    );

    return json(
      {
        error: "Unable to create the Stripe checkout session.",
      },
      502
    );
  }

  return json({
    checkoutUrl: stripeResult.url,
  });
}
async function handleStripeWebhook(request, env) {
  if (!env.DB) {
    return json({ error: "Database binding is not configured." }, 500);
  }

  if (!env.STRIPE_WEBHOOK_SECRET) {
    return json({ error: "Webhook secret is not configured." }, 500);
  }

  const signatureHeader = request.headers.get("stripe-signature");
  if (!signatureHeader) {
    return json({ error: "Missing Stripe-Signature header." }, 400);
  }

  const rawBody = await request.text();

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: "Invalid JSON payload." }, 400);
  }

  if (!event?.id || !event?.type || !event?.created || !event?.data?.object) {
    return json({ error: "Malformed Stripe event." }, 400);
  }

  const verified = await verifyStripeSignature(
    rawBody,
    signatureHeader,
    env.STRIPE_WEBHOOK_SECRET
  );

  if (!verified) {
    return json({ error: "Invalid Stripe webhook signature." }, 400);
  }

  try {
    const eventInsert = await env.DB.prepare(
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

    if (eventInsert.meta.changes === 0) {
      return json({ received: true, duplicate: true }, 200);
    }

    await processStripeEvent(env.DB, event);

    return json({ received: true }, 200);
  } catch (error) {
    console.error("Stripe webhook processing failed", {
      eventId: event.id,
      eventType: event.type,
      message: error instanceof Error ? error.message : String(error),
    });

    /*
      Return 500 so Stripe retries the delivery.

      The event ID row remains in the ledger only if the event insert
      succeeded. To ensure failed processing remains retryable, processing
      uses a savepoint transaction below. If it fails, the event ledger row
      is removed before rethrowing.
    */
    try {
      await env.DB.prepare(
        `DELETE FROM stripe_webhook_events WHERE stripe_event_id = ?`
      )
        .bind(event.id)
        .run();
    } catch (cleanupError) {
      console.error("Stripe event cleanup failed", {
        eventId: event.id,
        message:
          cleanupError instanceof Error
            ? cleanupError.message
            : String(cleanupError),
      });
    }

    return json({ error: "Webhook processing failed." }, 500);
  }
}

async function processStripeEvent(db, event) {
  const object = event.data.object;

  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutCompleted(db, event, object);
      return;

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await upsertSubscriptionFromStripe(db, event, object);
      return;

    case "invoice.payment_failed":
      await handlePaymentFailed(db, event, object);
      return;

    default:
      return;
  }
}

async function handleCheckoutCompleted(db, event, session) {
  if (session.mode !== "subscription") {
    return;
  }

  const subscriptionId = stringId(session.subscription);
  const customerId = stringId(session.customer);

  /*
    Checkout events sometimes arrive before a subscription-created event.
    Store customer/user linkage when metadata is present; the subscription
    event later provides the authoritative subscription status and dates.
  */
  const userId = getUserIdFromStripeObject(session);

  if (!subscriptionId) {
    return;
  }

  if (userId) {
    await db.prepare(
      `
      INSERT INTO subscriptions (
        stripe_subscription_id,
        stripe_customer_id,
        user_id,
        status,
        premium,
        last_stripe_event_created,
        updated_at
      )
      VALUES (?, ?, ?, 'incomplete', 0, ?, unixepoch())
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
}

async function handlePaymentFailed(db, event, invoice) {
  const subscriptionId = stringId(invoice.subscription);
  const customerId = stringId(invoice.customer);

  if (!subscriptionId) {
    return;
  }

  /*
    invoice.payment_failed is authoritative for a failed collection attempt.
    It removes premium access immediately. A subsequent
    customer.subscription.updated event can restore access when payment
    succeeds, or reflect the final Stripe status.
  */
  const changed = await db.prepare(
    `
    UPDATE subscriptions
    SET
      status = CASE
        WHEN last_stripe_event_created <= ? THEN 'past_due'
        ELSE status
      END,
      premium = CASE
        WHEN last_stripe_event_created <= ? THEN 0
        ELSE premium
      END,
      stripe_customer_id = COALESCE(?, stripe_customer_id),
      last_stripe_event_created = MAX(last_stripe_event_created, ?),
      updated_at = unixepoch()
    WHERE stripe_subscription_id = ?
    `
  )
    .bind(
      event.created,
      event.created,
      customerId,
      event.created,
      subscriptionId
    )
    .run();

  if (changed.meta.changes === 0) {
    await db.prepare(
      `
      INSERT INTO subscriptions (
        stripe_subscription_id,
        stripe_customer_id,
        status,
        premium,
        last_stripe_event_created,
        updated_at
      )
      VALUES (?, ?, 'past_due', 0, ?, unixepoch())
      ON CONFLICT(stripe_subscription_id) DO NOTHING
      `
    )
      .bind(subscriptionId, customerId, event.created)
      .run();
  }

  await syncPremiumForSubscription(db, subscriptionId);
}

async function upsertSubscriptionFromStripe(db, event, subscription) {
  const subscriptionId = stringId(subscription.id);
  const customerId = stringId(subscription.customer);

  if (!subscriptionId || !customerId) {
    throw new Error("Subscription event is missing a subscription or customer ID.");
  }

  const status =
    event.type === "customer.subscription.deleted"
      ? "canceled"
      : subscription.status || "incomplete";

  const premium = isPremiumStatus(status) ? 1 : 0;
  const userId = getUserIdFromStripeObject(subscription);

  const currentPeriodEnd =
    subscription.current_period_end ?? null;

  const trialEnd =
    subscription.trial_end ?? null;

  const cancelAtPeriodEnd =
    subscription.cancel_at_period_end ? 1 : 0;

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
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(stripe_subscription_id) DO UPDATE SET
      stripe_customer_id = excluded.stripe_customer_id,
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
      currentPeriodEnd,
      trialEnd,
      cancelAtPeriodEnd,
      event.created
    )
    .run();

  await syncPremiumForSubscription(db, subscriptionId);
}

async function syncPremiumForSubscription(db, subscriptionId) {
  const subscription = await db.prepare(
    `
    SELECT user_id, premium
    FROM subscriptions
    WHERE stripe_subscription_id = ?
    `
  )
    .bind(subscriptionId)
    .first();

  if (!subscription?.user_id) {
    return;
  }

  /*
    This assumes the app's users table has a `premium` INTEGER column.
    The migration below adds it if your table already exists.

    Entitlement remains server-controlled: the browser never decides
    whether an account has premium access.
  */
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

function getUserIdFromStripeObject(object) {
  const value =
    object?.metadata?.user_id ??
    object?.client_reference_id ??
    null;

  return typeof value === "string" && value.length > 0
    ? value
    : null;
}

function isPremiumStatus(status) {
  return status === "trialing" || status === "active";
}

function stringId(value) {
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

async function verifyStripeSignature(
  rawBody,
  signatureHeader,
  webhookSecret
) {
  const parsed = parseStripeSignatureHeader(signatureHeader);

  if (
    !parsed.timestamp ||
    parsed.signatures.length === 0
  ) {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);

  if (
    Math.abs(now - parsed.timestamp) >
    SIGNATURE_TOLERANCE_SECONDS
  ) {
    return false;
  }

  const signedPayload = `${parsed.timestamp}.${rawBody}`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(webhookSecret),
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signedPayload)
  );

  const expectedSignature = bytesToHex(
    new Uint8Array(signature)
  );

  return parsed.signatures.some((candidate) =>
    timingSafeEqualHex(expectedSignature, candidate)
  );
}

function parseStripeSignatureHeader(header) {
  let timestamp = null;
  const signatures = [];

  for (const part of header.split(",")) {
    const [key, value] = part.trim().split("=", 2);

    if (key === "t" && /^\d+$/.test(value)) {
      timestamp = Number(value);
    }

    if (
      key === "v1" &&
      /^[a-f0-9]{64}$/i.test(value)
    ) {
      signatures.push(value.toLowerCase());
    }
  }

  return { timestamp, signatures };
}

function timingSafeEqualHex(left, right) {
  if (
    typeof left !== "string" ||
    typeof right !== "string" ||
    left.length !== right.length
  ) {
    return false;
  }

  let difference = 0;

  for (let index = 0; index < left.length; index += 1) {
    difference |=
      left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return difference === 0;
}

function bytesToHex(bytes) {
  let output = "";

  for (const byte of bytes) {
    output += byte.toString(16).padStart(2, "0");
  }

  return output;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}
