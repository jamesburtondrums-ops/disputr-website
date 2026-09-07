const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://disputr.uk",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: CORS_HEADERS
  });
}

function cleanText(value, maxLength = 4000) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, maxLength);
}

function getTextFromAIResponse(result) {
  if (typeof result === "string") {
    return result;
  }

  if (result && typeof result.response === "string") {
    return result.response;
  }

  if (result && typeof result.output_text === "string") {
    return result.output_text;
  }

  return "";
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

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        service: "Disputr AI complaint service"
      });
    }

    if (url.pathname === "/api/generate-complaint") {
      if (request.method !== "POST") {
        return json({
          error: "Method not allowed"
        }, 405);
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
          return json({
            error: "Please complete the category, company, issue type, what happened, and desired outcome fields."
          }, 400);
        }

        const prompt = `
You are the Disputr Draft Assistant.

Write a clear, factual, professional UK-English SUGGESTED complaint template.
Use only the facts supplied below.

You are not a solicitor, claims-management company, regulator, ombudsman, or financial adviser.

Rules:
- Do not invent facts, dates, money amounts, booking references, account numbers, evidence, laws, regulations, deadlines, previous contact, company policies, or outcomes.
- Do not say the customer is legally entitled to compensation, a refund, or any specific remedy.
- Do not say the company has broken the law.
- Do not promise a successful complaint or outcome.
- Do not use threats, insults, accusations, or aggressive language.
- If key information is missing, place it in a separate facts-to-check list rather than guessing.
- Keep the letter concise, polite and firm.
- Return ONLY valid JSON with exactly these fields:
  title, subject, recipient_suggestion, draft, facts_to_check,
  suggested_attachments, suggested_next_step, disclaimer.

Use this exact disclaimer:
"Suggested wording only. This draft is based on the information you entered. Check every fact, remove anything inaccurate, and personalise it before using it. Disputr does not provide legal advice or guarantee an outcome."

Customer information:
${JSON.stringify({
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
}, null, 2)}
`;

        const aiResponse = await env.AI.run(
          "openai/gpt-5.4-mini",
          {
            messages: [
              {
                role: "user",
                content: prompt
              }
            ]
          }
        );

        const text = getTextFromAIResponse(aiResponse);

        if (!text) {
          return json({
            error: "The AI did not return a draft. Please try again."
          }, 502);
        }

        let result;

        try {
          result = JSON.parse(text);
        } catch {
          return json({
            error: "The AI response could not be processed safely. Please try again."
          }, 502);
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
            return json({
              error: "The AI response was incomplete. Please try again."
            }, 502);
          }
        }

        result.disclaimer =
          "Suggested wording only. This draft is based on the information you entered. Check every fact, remove anything inaccurate, and personalise it before using it. Disputr does not provide legal advice or guarantee an outcome.";

        return json(result);

      } catch (error) {
        console.error(error);

        return json({
          error: "We could not create your draft right now. Please try again."
        }, 500);
      }
    }

    return env.ASSETS.fetch(request);
  }
};
