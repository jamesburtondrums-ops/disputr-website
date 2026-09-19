import assert from "node:assert/strict";
import worker from "../worker.js";

const complaint = {
  category: "Finance complaint",
  company: "Example Bank",
  issueType: "Card payment dispute",
  incidentDate: "1 September 2026",
  referenceNumber: "TEST-123",
  whatHappened: "A duplicate card payment appeared on the account.",
  priorContact: "Secure chat on 2 September 2026.",
  costsOrLosses: "£20 duplicate payment.",
  desiredOutcome: "Investigate and provide a written response.",
  tone: "Firm but polite"
};

function request(path, init = {}) {
  return new Request(`https://disputr.uk${path}`, init);
}

const assets = {
  fetch: async () => new Response("<h1>ok</h1>", { headers: { "Content-Type": "text/html" } })
};

const aiResult = {
  title: "Suggested complaint",
  subject: "Card payment dispute",
  recipient_suggestion: "Example Bank Complaints Team",
  draft: "Dear Complaints Team,\n\nPlease investigate the duplicate payment.",
  facts_to_check: ["Check the transaction date."],
  suggested_attachments: ["Statement"],
  suggested_next_step: "Review and send through the official route."
};

{
  const response = await worker.fetch(request("/api/health"), { ASSETS: assets });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    service: "disputr",
    accounts_configured: false,
    stripe_checkout_configured: false,
    stripe_webhook_configured: false
  });
}

{
  const response = await worker.fetch(request("/api/generate-complaint", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://disputr.uk" },
    body: JSON.stringify(complaint)
  }), {
    ASSETS: assets,
    AI: { run: async () => ({ response: JSON.stringify(aiResult) }) }
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).subject, "Card payment dispute");
}

{
  const response = await worker.fetch(request("/api/generate-complaint", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(complaint)
  }), { ASSETS: assets, AI: { run: async () => { throw new Error("offline"); } } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-disputr-draft-mode"), "template");
  assert.match((await response.json()).draft, /duplicate card payment/i);
}

{
  const response = await worker.fetch(request("/api/generate-complaint", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
    body: JSON.stringify(complaint)
  }), { ASSETS: assets });
  assert.equal(response.status, 403);
}

{
  const response = await worker.fetch(request("/"), { ASSETS: assets });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
}

console.log("Disputr Worker smoke tests passed.");
