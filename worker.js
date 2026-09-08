const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://disputr.uk",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};

const DISCLAIMER =
  "Suggested wording only. This draft is based on the information you entered. Check every fact, remove anything inaccurate, and personalise it before using it. Disputr does not provide legal advice or guarantee an outcome.";

const WEBHOOK_TOLERANCE_SECONDS = 300;

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      ...extraHeaders
    }
  });
}

function cleanText(value, maxLength = 4000) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function getTextFromAIResponse(result) {
  if (typeof result === "string") return result;
  if (result && typeof result.response === "string") return result.response;
  if (result && typeof result.output_text === "string") return result.output_text;

  if (result && Array.isArray(result.output)) {
    const text = result.output
      .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
      .map((content) => content.text || content.value || "")
      .filter(Boolean)
      .join("\n");

    if (text) return text;
  }

  return "";
}

function removeCodeFences(value) {
  return value
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function makePrompt(data) {
  return `
You are the Disputr Draft Assistant.

Write a clear, factual, professional UK-English suggested complaint template.
Use only the facts supplied below.

You are not a solicitor, claims-management company, regulator, ombudsman, or financial adviser.

Rules:
- Do not invent facts, dates, money amounts, booking references, account numbers, evidence, laws, regulations, deadlines, previous contact, company policies, or outcomes.
- Do not say the customer is legally entitled to compensation, a refund, or any specific remedy.
- Do not say the company has broken the law.
- Do not promise a successful complaint or outcome.
- Do not use threats, insults, accusations, or aggressive language.
- If key information is missing, add it to facts_to_check rather than guessing.
- Keep the letter concise, polite, and firm.
- Return JSON only. Do not use Markdown or code fences.
- facts_to_check and suggested_attachments must be arrays of strings.
- The other fields must be strings.

Return exactly these keys:
- title
- subject
- recipient_suggestion
- draft
- facts_to_check
- suggested_attachments
- suggested_next_step
- disclaimer

Use this exact disclaimer:
"${DISCLAIMER}"

Customer information:
${JSON.stringify(data, null, 2)}
`.trim();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS
      });
    }

    try {
      if (url.pathname === "/api/health") {
        return json({
          ok: true,
          service: "Disputr AI and billing service",
          ai_binding_present: Boolean(env.AI),
          d1_binding_present: Boolean(env.DB),
          stripe_checkout_configured: Boolean(
            env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_ID
          ),
          stripe_webhook_configured: Boolean(env.STRIPE_WEBHOOK_SECRET)
        });
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/generate-complaint"
      ) {
        return await generateComplaint(request, env);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/billing/create-checkout-session"
      ) {
        return await createCheckoutSession(request, env);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/billing/create-portal-session"
      ) {
        return await createPortalSession(request, env);
      }

      if (
        request.method === "GET" &&
        url.pathname === "/api/me"
      ) {
        return await getCurrentUserBilling(request, env);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/webhooks/stripe"
      ) {
        return await handleStripeWebhook(request, env);
      }

      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error("Unhandled Worker error:", {
        path: url.pathname,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : null
      });

      if (url.pathname.startsWith("/api/")) {
        return json(
          { error: "Server error. Check the Cloudflare Worker logs." },
          500
        );
      }

      return new Response("Internal Server Error", { status: 500 });
    }
  }
};

/* -------------------------------------------------------------------------- */
/* Complaint generation                                                       */
/* -------------------------------------------------------------------------- */

async function generateComplaint(request, env) {
  if (!env.AI) {
    return json(
      {
        error:
          "Workers AI is not available to this Worker. Check that the Workers AI binding is named AI."
      },
      503
    );
  }

  try {
    const body = await request.json();

    const category = cleanText(body.category, 100);
    const company = cleanText(body.company, 150);
    const issueType = cleanText(body.issueType, 150);
    const incidentDate = cleanText(body.incidentDate, 100);
    const referenceNumber = cleanText(body.referenceNumber, 150);
    const whatHappened = cleanText(body.whatHappened, 4000);
    const priorContact = cleanText(body.priorContact, 1500);
    const costsOrLosses = cleanText(body.costsOrLosses, 1000);
    const desiredOutcome = cleanText(body.desiredOutcome, 1500);
    const tone = cleanText(body.tone, 100) || "Firm but polite";

    if (
      !category ||
      !company ||
      !issueType ||
      !whatHappened ||
      !desiredOutcome
    ) {
      return json(
        {
          error:
            "Please complete the category, company, issue type, what happened, and desired outcome fields."
        },
        400
      );
    }

    const complaintData = {
      category,
      company,
      issue_type: issueType,
      incident_date: incidentDate || "Not provided",
      reference_number: referenceNumber || "Not provided",
      what_happened: whatHappened,
      previous_contact: priorContact || "Not provided",
      costs_or_losses: costsOrLosses || "Not provided",
      desired_outcome: desiredOutcome,
      preferred_tone: tone
    };

    const aiResponse = await env.AI.run(
      "@cf/meta/llama-3.1-8b-instruct-fast",
      {
        messages: [
          {
            role: "system",
            content:
              "Return only a valid JSON object. Never use Markdown code fences."
          },
          {
            role: "user",
            content: makePrompt(complaintData)
          }
        ],
        response_format: {
          type: "json_object"
        }
      }
    );

    const text = removeCodeFences(getTextFromAIResponse(aiResponse));

    if (!text) {
      console.error("Workers AI returned no usable text:", aiResponse);
      return json(
        { error: "The AI did not return a draft. Please try again." },
        502
      );
    }

    let result;

    try {
      result = JSON.parse(text);
    } catch (error) {
      console.error("Workers AI returned invalid JSON:", {
        message: error instanceof Error ? error.message : String(error),
        text
      });

      return json(
        {
          error:
            "The AI response could not be processed safely. Please try again."
        },
        502
      );
    }

    const requiredKeys = [
      "title",
      "subject",
      "recipient_suggestion",
      "draft",
      "facts_to_check",
      "suggested_attachments",
      "suggested_next_step",
      "disclaimer"
    ];

    for (const key of requiredKeys) {
      if (!(key in result)) {
        console.error("Workers AI response missing key:", { key, result });

        return json(
          { error: "The AI response was incomplete. Please try again." },
          502
        );
      }
    }

    result.title = String(result.title || "Suggested complaint");
    result.subject = String(result.subject || "");
    result.recipient_suggestion = String(result.recipient_suggestion || "");
    result.draft = String(result.draft || "");
    result.facts_to_check = Array.isArray(result.facts_to_check)
      ? result.facts_to_check.map(String)
      : [];
    result.suggested_attachments = Array.isArray(result.suggested_attachments)
      ? result.suggested_attachments.map(String)
      : [];
    result.suggested_next_step = String(result.suggested_next_step || "");
    result.disclaimer = DISCLAIMER;

    return json(result);
  } catch (error) {
    console.error("Complaint generation failed:", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null
    });

    return json(
      {
        error: "We could not create your draft right now. Please try again."
      },
      500
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Billing: authentication lookup                                             */
/* -------------------------------------------------------------------------- */

/*
  This assumes your existing authentication worker stores the signed-in user's
  session token in a cookie named "disputr_session", and D1 contains:

  sessions:
  - token
  - user_id
  - expires_at

  users:
  - id
  - email
  - premium

  If your session cookie/table/column names differ, change only this function.
*/
async function requireAuth(request, env) {
  requireDatabase(env);

  const cookies = parseCookies(request.headers.get("cookie") || "");
  const sessionToken = cookies.disputr_session;

  if (!sessionToken) {
    return null;
  }

  const user = await env.DB.prepare(
    `
    SELECT
      users.id,
      users.email,
      users.premium
    FROM sessions
    INNER JOIN users ON users.id = sessions.user_id
    WHERE sessions.token = ?
      AND sessions.expires_at > unixepoch()
    LIMIT 1
    `
  )
    .bind(sessionToken)
    .first();

  return user || null;
}

async function getCurrentUserBilling(request, env) {
  const user = await requireAuth(request, env);

  if (!user) {
    return json({ authenticated: false }, 401);
  }

  const subscription = await env.DB.prepare(
    `
    SELECT
      status,
      premium,
      trial_end,
      current_period_end,
      cancel_at_period_end
    FROM subscriptions
    WHERE user_id = ?
    ORDER BY updated_at DESC
    LIMIT 1
    `
  )
    .bind(user.id)
    .first();

  return json({
    authenticated: true,
    user: {
      id: user.id,
      email: user.email,
      premium: Boolean(user.premium)
    },
    subscription: subscription
      ? {
          status: subscription.status,
          premium: Boolean(subscription.premium),
          trial_end: unixSecondsToIso(subscription.trial_end),
          current_period_end: unixSecondsToIso(
            subscription.current_period_end
          ),
          cancel_at_period_end: Boolean(
            subscription.cancel_at_period_end
          )
        }
      : null
  });
}

/* -------------------------------------------------------------------------- */
/* Billing: Stripe Checkout                                                   */
/* -------------------------------------------------------------------------- */

async function createCheckoutSession(request, env) {
  requireDatabase(env);

  if (!env.STRIPE_SECRET_KEY) {
    return json(
      { error: "STRIPE_SECRET_KEY is not configured." },
      500
    );
  }

  if (!env.STRIPE_PRICE_ID) {
    return json(
      { error: "STRIPE_PRICE_ID is not configured." },
      500
    );
  }

  const user = await requireAuth(request, env);

  if (!user?.id) {
    return json({ error: "You must sign in first." }, 401);
  }

  const existingSubscription = await env.DB.prepare(
    `
    SELECT stripe_customer_id, status
    FROM subscriptions
    WHERE user_id = ?
      AND stripe_customer_id IS NOT NULL
      AND status IN ('trialing', 'active', 'past_due')
    ORDER BY updated_at DESC
    LIMIT 1
    `
  )
    .bind(user.id)
    .first();

  if (existingSubscription) {
    return json(
      {
        error:
          "You already have a subscription. Use Manage payment or cancel instead."
      },
      409
    );
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

  form.set("line_items[price]", env.STRIPE_PRICE_ID);[0]
  form.set("line_items[quantity]", "1");[0]

  /*
    Optional 14-day trial. Set STRIPE_TRIAL_DAYS to 14 in Cloudflare Variables.
    Omit the variable if your Stripe Price/Product already manages the trial.
  */
  const trialDays = Number(env.STRIPE_TRIAL_DAYS || 0);

  if (Number.isInteger(trialDays) && trialDays > 0) {
    form.set(
      "subscription_data[trial_period_days]",
      String(trialDays)
    );
  }

  /*
    Do not trust a browser-supplied user ID. These values originate from the
    authenticated D1 user record returned by requireAuth().
  */
  form.set("client_reference_id", user.id);
  form.set("metadata[user_id]", user.id);
  form.set("subscription_data[metadata][user_id]", user.id);

  const stripeResponse = await fetch(
    "https://api.stripe.com/v1/checkout/sessions",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "content-type": "application/x-www-form-urlencoded"
      },
      body: form.toString()
    }
  );

  const stripeResult = await readStripeJson(stripeResponse);

  if (!stripeResponse.ok) {
    console.error("Stripe Checkout Session creation failed:", {
      status: stripeResponse.status,
      response: stripeResult
    });

    return json(
      {
        error:
          stripeResult?.error?.message ||
          "Stripe rejected the Checkout request."
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

  return json({
    checkoutUrl: stripeResult.url
  });
}

/* -------------------------------------------------------------------------- */
/* Billing: Stripe Billing Portal                                             */
/* -------------------------------------------------------------------------- */

async function createPortalSession(request, env) {
  requireDatabase(env);

  if (!env.STRIPE_SECRET_KEY) {
    return json(
      { error: "STRIPE_SECRET_KEY is not configured." },
      500
    );
  }

  const user = await requireAuth(request, env);

  if (!user?.id) {
    return json({ error: "You must sign in first." }, 401);
  }

  const subscription = await env.DB.prepare(
    `
    SELECT stripe_customer_id
    FROM subscriptions
    WHERE user_id = ?
      AND stripe_customer_id IS NOT NULL
    ORDER BY updated_at DESC
    LIMIT 1
    `
  )
    .bind(user.id)
    .first();

  if (!subscription?.stripe_customer_id) {
    return json(
      { error: "No Stripe billing account was found for this user." },
      404
    );
  }

  const origin = new URL(request.url).origin;
  const form = new URLSearchParams();

  form.set("customer", subscription.stripe_customer_id);
  form.set(
    "return_url",
    `${origin}/subscription-and-billing.html`
  );

  const stripeResponse = await fetch(
    "https://api.stripe.com/v1/billing_portal/sessions",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "content-type": "application/x-www-form-urlencoded"
      },
      body: form.toString()
    }
  );

  const stripeResult = await readStripeJson(stripeResponse);

  if (!stripeResponse.ok) {
    console.error("Stripe Billing Portal creation failed:", {
      status: stripeResponse.status,
      response: stripeResult
    });

    return json(
      {
        error:
          stripeResult?.error?.message ||
          "Stripe rejected the Billing Portal request."
      },
      502
    );
  }

  if (!stripeResult?.url) {
    return json(
      { error: "Stripe did not return a Billing Portal URL." },
      502
    );
  }

  return json({
    url: stripeResult.url
  });
}

/* -------------------------------------------------------------------------- */
/* Billing: Stripe webhooks                                                   */
/* -------------------------------------------------------------------------- */

async function handleStripeWebhook(request, env) {
  requireDatabase(env);

  if (!env.STRIPE_WEBHOOK_SECRET) {
    return json(
      { error: "STRIPE_WEBHOOK_SECRET is not configured." },
      500
    );
  }

  const signatureHeader = request.headers.get("stripe-signature");

  if (!signatureHeader) {
    return json(
      { error: "Missing Stripe-Signature header." },
      400
    );
  }

  /*
    Keep the request body raw for signature verification. Never call
    request.json() before request.text() in this endpoint.
  */
  const rawBody = await request.text();

  const signatureValid = await verifyStripeSignature(
    rawBody,
    signatureHeader,
    env.STRIPE_WEBHOOK_SECRET
  );

  if (!signatureValid) {
    return json(
      { error: "Invalid Stripe webhook signature." },
      400
    );
  }

  let event;

  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: "Invalid Stripe event JSON." }, 400);
  }

  if (!event?.id || !event?.type || !event?.data?.object) {
    return json({ error: "Malformed Stripe event." }, 400);
  }

  /*
    Insert first: the primary key on stripe_event_id prevents duplicate
    changes when Stripe retries delivery of the same event.
  */
  const insertEvent = await env.DB.prepare(
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
    .bind(
      event.id,
      event.type,
      Number(event.created || 0)
    )
    .run();

  if (insertEvent.meta.changes === 0) {
    return json({ received: true, duplicate: true });
  }

  try {
    await processStripeEvent(env.DB, event);
  } catch (error) {
    /*
      Allow Stripe to retry a failed event. If processing fails, remove the
      event ledger entry before returning a 500.
    */
    await env.DB.prepare(
      "DELETE FROM stripe_webhook_events WHERE stripe_event_id = ?"
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
      await recordCheckoutSession(db, event, object);
      return;

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await upsertSubscription(db, event, object);
      return;

    case "invoice.payment_failed":
      await recordPaymentFailure(db, event, object);
      return;

    default:
      return;
  }
}

async function recordCheckoutSession(db, event, session) {
  if (session.mode !== "subscription") {
    return;
  }

  const subscriptionId = stripeId(session.subscription);
  const customerId = stripeId(session.customer);
  const userId = getInternalUserId(session);

  /*
    The subscription event is authoritative for final status and dates.
    This simply keeps the user/customer linkage if checkout arrives first.
  */
  if (!subscriptionId || !userId) {
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
      stripe_customer_id = COALESCE(
        excluded.stripe_customer_id,
        subscriptions.stripe_customer_id
      ),
      user_id = COALESCE(excluded.user_id, subscriptions.user_id),
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
      Number(event.created || 0)
    )
    .run();
}

async function upsertSubscription(db, event, subscription) {
  const subscriptionId = stripeId(subscription.id);
  const customerId = stripeId(subscription.customer);

  if (!subscriptionId) {
    throw new Error("Stripe subscription event has no subscription ID.");
  }

  const status =
    event.type === "customer.subscription.deleted"
      ? "canceled"
      : cleanText(subscription.status, 50) || "incomplete";

  const premium = isPremiumStatus(status) ? 1 : 0;
  const userId = getInternalUserId(subscription);
  const eventCreated = Number(event.created || 0);

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
      stripe_customer_id = COALESCE(
        excluded.stripe_customer_id,
        subscriptions.stripe_customer_id
      ),
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
      Number(subscription.current_period_end || 0) || null,
      Number(subscription.trial_end || 0) || null,
      subscription.cancel_at_period_end ? 1 : 0,
      eventCreated
    )
    .run();

  await syncPremiumStatus(db, subscriptionId);
}

async function recordPaymentFailure(db, event, invoice) {
  const subscriptionId = stripeId(invoice.subscription);

  if (!subscriptionId) {
    return;
  }

  const eventCreated = Number(event.created || 0);

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
      last_stripe_event_created = MAX(
        last_stripe_event_created,
        ?
      ),
      updated_at = unixepoch()
    WHERE stripe_subscription_id = ?
    `
  )
    .bind(
      eventCreated,
      eventCreated,
      eventCreated,
      subscriptionId
    )
    .run();

  await syncPremiumStatus(db, subscriptionId);
}

async function syncPremiumStatus(db, subscriptionId) {
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
/* Stripe HMAC signature verification                                         */
/* -------------------------------------------------------------------------- */

async function verifyStripeSignature(rawBody, signatureHeader, secret) {
  const parsed = parseStripeSignatureHeader(signatureHeader);

  if (!parsed.timestamp || parsed.v1Signatures.length === 0) {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);

  if (
    Math.abs(now - parsed.timestamp) >
    WEBHOOK_TOLERANCE_SECONDS
  ) {
    return false;
  }

  const signedPayload = `${parsed.timestamp}.${rawBody}`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );

  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signedPayload)
  );

  const expectedSignature = bytesToHex(
    new Uint8Array(signatureBuffer)
  );

  return parsed.v1Signatures.some((receivedSignature) =>
    timingSafeEqualHex(expectedSignature, receivedSignature)
  );
}

function parseStripeSignatureHeader(header) {
  let timestamp = null;
  const v1Signatures = [];

  for (const item of header.split(",")) {
    const separator = item.indexOf("=");

    if (separator < 1) {
      continue;
    }

    const key = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();

    if (key === "t" && /^\d+$/.test(value)) {
      timestamp = Number(value);
    }

    if (key === "v1" && /^[a-f0-9]{64}$/i.test(value)) {
      v1Signatures.push(value.toLowerCase());
    }
  }

  return {
    timestamp,
    v1Signatures
  };
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

/* -------------------------------------------------------------------------- */
/* Utility functions                                                          */
/* -------------------------------------------------------------------------- */

function requireDatabase(env) {
  if (!env.DB) {
    throw new Error(
      "D1 binding DB is missing. Configure a valid D1 database binding."
    );
  }
}

function parseCookies(cookieHeader) {
  const cookies = {};

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");

    if (separator < 1) {
      continue;
    }

    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();

    if (key) {
      cookies[key] = decodeURIComponent(value);
    }
  }

  return cookies;
}

function getInternalUserId(object) {
  const value =
    object?.metadata?.user_id ||
    object?.client_reference_id ||
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

function unixSecondsToIso(value) {
  const seconds = Number(value || 0);

  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }

  return new Date(seconds * 1000).toISOString();
}

async function readStripeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function bytesToHex(bytes) {
  let output = "";

  for (const byte of bytes) {
    output += byte.toString(16).padStart(2, "0");
  }

  return output;
}
