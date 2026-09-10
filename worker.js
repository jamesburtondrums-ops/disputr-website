const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://disputr.uk",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};

const DISCLAIMER = "Suggested wording only. This draft is based on the information you entered. Check every fact, remove anything inaccurate, and personalise it before using it. Disputr does not provide legal advice or guarantee an outcome.";
const WEBHOOK_TOLERANCE_SECONDS = 300;

const OPENAI_COMPLAINT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "title",
    "subject",
    "recipient_suggestion",
    "draft",
    "facts_to_check",
    "suggested_attachments",
    "suggested_next_step"
  ],
  properties: {
    title: { type: "string" },
    subject: { type: "string" },
    recipient_suggestion: { type: "string" },
    draft: { type: "string" },
    facts_to_check: {
      type: "array",
      items: { type: "string" }
    },
    suggested_attachments: {
      type: "array",
      items: { type: "string" }
    },
    suggested_next_step: { type: "string" }
  }
};

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
- Keep the letter professional, factual, polite and firm.
- Where the supplied facts support it, make the draft substantive and clearly structured.
- Aim for 350 to 500 words in the draft, using 5 to 7 short paragraphs.
- Use the supplied facts to cover: the reason for writing, a date-order summary of what happened, any relevant impact or costs, any previous contact, the requested outcome, and a request for a written response.
- Do not pad the draft, repeat points, or add information that was not supplied.
- If the submitted information is brief, write only what the facts support and add missing details to facts_to_check.
- Use 2 to 4 short items in facts_to_check.
- Use 1 to 4 short items in suggested_attachments.
- Keep title, subject, recipient_suggestion and suggested_next_step concise.

Customer information:
${JSON.stringify(data, null, 2)}
`.trim();
}

function getOpenAIOutputText(payload) {
  if (!Array.isArray(payload?.output)) {
    return "";
  }

  return payload.output
    .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
    .filter((content) => content?.type === "output_text")
    .map((content) => typeof content?.text === "string" ? content.text : "")
    .filter(Boolean)
    .join("\n");
}

async function generateComplaintWithOpenAI(complaintData, env) {
  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-5.4-mini",
      input: [
        {
          role: "developer",
          content: [
            {
              type: "input_text",
              text: `
Create a clear, neutral, factual and professional UK-English suggested consumer-complaint template.

Use only the information supplied in the submitted form. Do not invent facts, dates, money amounts, references, evidence, policies, previous contact, deadlines, laws, regulations, rights, or outcomes.

Do not give legal advice or legal analysis. Do not make legal conclusions. Do not use threats, accusations, aggressive language, promises, guarantees, or statements that the company must provide a particular remedy.

Write an editable suggested template, not a claim made on the user's behalf. Make the draft professional, factual, polite and firm.

Where the submitted facts support it, aim for 350 to 500 words in 5 to 7 short paragraphs. Structure the draft to cover the reason for writing, a clear date-order account, relevant impact or evidenced costs, previous contact where supplied, the requested outcome, and a request for a written response.

Use short, readable paragraphs rather than a wall of text. Do not use headings inside the draft unless the user supplied a reason to do so.

Finish the draft with a clear request for the company to investigate and provide a written response. Do not add a deadline unless the user supplied one.

Do not pad the letter, repeat points, or invent missing facts. If the user has supplied only limited information, write only what the facts support and identify missing details in facts_to_check.

Where the submitted facts support it, aim for 350 to 500 words in 5 to 7 short paragraphs. Structure the draft to cover the reason for writing, a clear date-order account, relevant impact or evidenced costs, previous contact where supplied, the requested outcome, and a request for a written response.

Do not pad the letter, repeat points, or invent missing facts. If the user has supplied only limited information, write only what the facts support and identify missing details in facts_to_check.

Provide 2 to 4 short facts_to_check items and 1 to 4 short suggested_attachments items. If relevant attachments were not mentioned, suggest ordinary factual records the user can check before sending.

Follow the supplied JSON Schema exactly.
              `.trim()
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: makePrompt(complaintData)
            }
          ]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "complaint_template",
          strict: true,
          schema: OPENAI_COMPLAINT_SCHEMA
        }
      },
      max_output_tokens: 1800
    })
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    console.error("OpenAI request failed:", {
      status: response.status,
      message: payload?.error?.message || null,
      type: payload?.error?.type || null,
      code: payload?.error?.code || null
    });

    throw new Error(
      payload?.error?.message ||
      `OpenAI request failed with HTTP ${response.status}.`
    );
  }

  if (payload?.status === "incomplete") {
    console.error("OpenAI response incomplete:", {
      id: payload?.id || null,
      reason: payload?.incomplete_details?.reason || null
    });
    throw new Error("OpenAI could not complete the draft.");
  }

  if (payload?.status !== "completed") {
    console.error("OpenAI response did not complete:", {
      id: payload?.id || null,
      status: payload?.status || null
    });
    throw new Error("OpenAI did not complete the draft.");
  }

  const outputText = getOpenAIOutputText(payload);

  if (!outputText.trim()) {
    console.error("OpenAI returned no extractable output text:", {
      id: payload?.id || null,
      status: payload?.status || null,
      outputTypes: Array.isArray(payload?.output)
        ? payload.output.map((item) => item?.type || null)
        : [],
      contentTypes: Array.isArray(payload?.output)
        ? payload.output.flatMap((item) =>
            Array.isArray(item?.content)
              ? item.content.map((content) => content?.type || null)
              : []
          )
        : []
    });
    throw new Error("OpenAI returned no usable draft.");
  }

  try {
    return JSON.parse(outputText);
  } catch (error) {
    console.error("OpenAI structured output was not valid JSON:", {
      id: payload?.id || null,
      message: error instanceof Error ? error.message : String(error)
    });
    throw new Error("OpenAI returned an unexpected response format.");
  }
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
          openai_configured: Boolean(env.OPENAI_API_KEY),
          assets_binding_present: Boolean(env.ASSETS),
          d1_binding_present: Boolean(env.DB),
          stripe_checkout_configured: Boolean(
            env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_ID
          ),
          stripe_webhook_configured: Boolean(env.STRIPE_WEBHOOK_SECRET)
        });
      }

      if (request.method === "POST" && url.pathname === "/api/generate-complaint") {
        return await generateComplaint(request, env);
      }

      if (request.method === "POST" && url.pathname === "/api/billing/create-checkout-session") {
        return await createCheckoutSession(request, env);
      }

      if (request.method === "POST" && url.pathname === "/api/billing/create-portal-session") {
        return await createPortalSession(request, env);
      }

      if (request.method === "GET" && url.pathname === "/api/me") {
        return await getCurrentUserBilling(request, env);
      }

      if (request.method === "POST" && url.pathname === "/api/webhooks/stripe") {
        return await handleStripeWebhook(request, env);
      }

      if (url.pathname.startsWith("/api/")) {
        return json({ error: "API route not found." }, 404);
      }

      if (!env.ASSETS || typeof env.ASSETS.fetch !== "function") {
        console.error("ASSETS binding is unavailable:", { path: url.pathname });
        return new Response("Static assets are not attached to this Worker deployment.", {
          status: 503,
          headers: {
            "content-type": "text/plain; charset=UTF-8",
            "cache-control": "no-store"
          }
        });
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

async function generateComplaint(request, env) {
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

    if (!category || !company || !issueType || !whatHappened || !desiredOutcome) {
      return json(
        {
          error: "Please complete the category, company, issue type, what happened, and desired outcome fields."
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

    let result;

    try {
      result = await generateComplaintWithOpenAI(complaintData, env);
    } catch (error) {
      console.error("OpenAI complaint generation failed:", {
        message: error instanceof Error ? error.message : String(error)
      });

      return json(
        {
          error: "Draft generation is temporarily unavailable. Please try again shortly."
        },
        502
      );
    }

    if (!result || typeof result !== "object" || Array.isArray(result)) {
      console.error("OpenAI returned an unexpected result type:", {
        type: typeof result
      });
      return json(
        { error: "The AI returned a draft in an unexpected format. Please try again." },
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
      "suggested_next_step"
    ];

    for (const key of requiredKeys) {
      if (!(key in result)) {
        console.error("OpenAI response missing key:", { key });
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
  ).bind(sessionToken).first();

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
  ).bind(user.id).first();

  return json({
    authenticated: true,
    user: {
      id: user.id,
      email: user.email,
      premium: Boolean(user.premium)
    },
    subscription: subscription ? {
      status: subscription.status,
      premium: Boolean(subscription.premium),
      trial_end: unixSecondsToIso(subscription.trial_end),
      current_period_end: unixSecondsToIso(subscription.current_period_end),
      cancel_at_period_end: Boolean(subscription.cancel_at_period_end)
    } : null
  });
}

async function createCheckoutSession(request, env) {
  requireDatabase(env);

  if (!env.STRIPE_SECRET_KEY) {
    return json({ error: "STRIPE_SECRET_KEY is not configured." }, 500);
  }

  if (!env.STRIPE_PRICE_ID) {
    return json({ error: "STRIPE_PRICE_ID is not configured." }, 500);
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
  ).bind(user.id).first();

  if (existingSubscription) {
    return json(
      {
        error: "You already have a subscription. Use Manage payment or cancel instead."
      },
      409
    );
  }

  const origin = new URL(request.url).origin;
  const form = new URLSearchParams();
  form.set("mode", "subscription");
  form.set("success_url", `${origin}/subscription-and-billing.html?checkout=success`);
  form.set("cancel_url", `${origin}/pricing.html?checkout=canceled`);
  form.set("line_items[price]", env.STRIPE_PRICE_ID);
  form.set("line_items[quantity]", "1");

  const trialDays = Number(env.STRIPE_TRIAL_DAYS || 0);
  if (Number.isInteger(trialDays) && trialDays > 0) {
    form.set("subscription_data[trial_period_days]", String(trialDays));
  }

  form.set("client_reference_id", user.id);
  form.set("metadata[user_id]", user.id);
  form.set("subscription_data[metadata][user_id]", user.id);

  const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: form.toString()
  });

  const stripeResult = await readStripeJson(stripeResponse);

  if (!stripeResponse.ok) {
    console.error("Stripe Checkout Session creation failed:", {
      status: stripeResponse.status,
      response: stripeResult
    });

    return json(
      {
        error: stripeResult?.error?.message || "Stripe rejected the Checkout request."
      },
      502
    );
  }

  if (!stripeResult?.url) {
    return json({ error: "Stripe did not return a Checkout URL." }, 502);
  }

  return json({ checkoutUrl: stripeResult.url });
}

async function createPortalSession(request, env) {
  requireDatabase(env);

  if (!env.STRIPE_SECRET_KEY) {
    return json({ error: "STRIPE_SECRET_KEY is not configured." }, 500);
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
  ).bind(user.id).first();

  if (!subscription?.stripe_customer_id) {
    return json(
      { error: "No Stripe billing account was found for this user." },
      404
    );
  }

  const origin = new URL(request.url).origin;
  const form = new URLSearchParams();
  form.set("customer", subscription.stripe_customer_id);
  form.set("return_url", `${origin}/subscription-and-billing.html`);

  const stripeResponse = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: form.toString()
  });

  const stripeResult = await readStripeJson(stripeResponse);

  if (!stripeResponse.ok) {
    console.error("Stripe Billing Portal creation failed:", {
      status: stripeResponse.status,
      response: stripeResult
    });

    return json(
      {
        error: stripeResult?.error?.message || "Stripe rejected the Billing Portal request."
      },
      502
    );
  }

  if (!stripeResult?.url) {
    return json({ error: "Stripe did not return a Billing Portal URL." }, 502);
  }

  return json({ url: stripeResult.url });
}

async function handleStripeWebhook(request, env) {
  requireDatabase(env);

  if (!env.STRIPE_WEBHOOK_SECRET) {
    return json({ error: "STRIPE_WEBHOOK_SECRET is not configured." }, 500);
  }

  const signatureHeader = request.headers.get("stripe-signature");
  if (!signatureHeader) {
    return json({ error: "Missing Stripe-Signature header." }, 400);
  }

  const rawBody = await request.text();
  const signatureValid = await verifyStripeSignature(
    rawBody,
    signatureHeader,
    env.STRIPE_WEBHOOK_SECRET
  );

  if (!signatureValid) {
    return json({ error: "Invalid Stripe webhook signature." }, 400);
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
  ).bind(event.id, event.type, Number(event.created || 0)).run();

  if (insertEvent.meta.changes === 0) {
    return json({ received: true, duplicate: true });
  }

  try {
    await processStripeEvent(env.DB, event);
  } catch (error) {
    await env.DB.prepare(
      "DELETE FROM stripe_webhook_events WHERE stripe_event_id = ?"
    ).bind(event.id).run();
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
  ).bind(subscriptionId, customerId, userId, Number(event.created || 0)).run();
}

async function upsertSubscription(db, event, subscription) {
  const subscriptionId = stripeId(subscription.id);
  const customerId = stripeId(subscription.customer);

  if (!subscriptionId) {
    throw new Error("Stripe subscription event has no subscription ID.");
  }

  const status = event.type === "customer.subscription.deleted"
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
  ).bind(
    subscriptionId,
    customerId,
    userId,
    status,
    premium,
    Number(subscription.current_period_end || 0) || null,
    Number(subscription.trial_end || 0) || null,
    subscription.cancel_at_period_end ? 1 : 0,
    eventCreated
  ).run();

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
  ).bind(eventCreated, eventCreated, eventCreated, subscriptionId).run();

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
  ).bind(subscriptionId).first();

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
  ).bind(subscription.premium, subscription.user_id).run();
}

async function verifyStripeSignature(rawBody, signatureHeader, secret) {
  const parsed = parseStripeSignatureHeader(signatureHeader);

  if (!parsed.timestamp || parsed.v1Signatures.length === 0) {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parsed.timestamp) > WEBHOOK_TOLERANCE_SECONDS) {
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

  const expectedSignature = bytesToHex(new Uint8Array(signatureBuffer));

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

  return { timestamp, v1Signatures };
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
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return difference === 0;
}

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
      try {
        cookies[key] = decodeURIComponent(value);
      } catch {
        cookies[key] = value;
      }
    }
  }

  return cookies;
}

function getInternalUserId(object) {
  const value = object?.metadata?.user_id || object?.client_reference_id || null;
  return typeof value === "string" && value.length > 0 ? value : null;
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
