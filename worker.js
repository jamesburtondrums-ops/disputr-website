const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://disputr.uk",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8"
};

const DISCLAIMER =
  "Suggested wording only. This draft is based on the information you entered. Check every fact, remove anything inaccurate, and personalise it before using it. Disputr does not provide legal advice or guarantee an outcome.";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: CORS_HEADERS
  });
}

function cleanText(value, maxLength = 4000) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function getTextFromAIResponse(result) {
  if (typeof result === "string") return result.trim();

  if (result && typeof result.response === "string") {
    return result.response.trim();
  }

  if (result && typeof result.output_text === "string") {
    return result.output_text.trim();
  }

  if (result && Array.isArray(result.output)) {
    const text = result.output
      .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
      .map((content) => content.text || content.value || "")
      .filter(Boolean)
      .join("\n")
      .trim();

    if (text) return text;
  }

  return "";
}

function makePrompt(data) {
  return `
You are the Disputr Draft Assistant.

Create a detailed, factual, professional UK-English suggested complaint letter based
only on the customer information provided below. This is editable suggested wording,
not legal advice.

Write approximately 500 to 700 words only where the supplied information supports
that level of detail. Do not pad the letter with generic statements, assumptions, or
invented facts. If limited detail was provided, keep the letter shorter and include
neutral square-bracket placeholders only where needed.

Write the letter in a calm, clear, firm, and respectful tone that reflects the
customer's preferred tone.

Use the following structure naturally in the letter. Do not add headings or numbered
sections unless they make the letter easier to read.

Opening:
- Begin with "Dear Complaints Team,".
- State that the writer is making a formal complaint.
- Identify the company and the issue.
- Include an account, booking, order, agreement, or complaint reference only if one
  was supplied.

What happened:
- Give a concise factual overview of the complaint.
- Explain the events in a clear and logical order.
- Use dates only where the customer supplied dates.
- Describe why the customer is dissatisfied, using only the facts supplied.
- Mention any previous contact with the company only where it was supplied.
- Mention costs or losses only where supplied. Do not calculate, estimate, or add
  monetary figures.

What the customer asks for:
- Clearly state the customer’s requested outcome.
- Ask the company to investigate the concerns and review the relevant information.
- Ask it to provide a clear written response through its normal complaints process.
- Do not state that the customer is legally entitled to compensation, a refund, or
  any specific remedy.

Closing:
- Ask the company to confirm receipt of the complaint.
- Ask for a written response.
- End with:

Yours faithfully,

[Your name]

You are not a solicitor, claims-management company, regulator, ombudsman, or
financial adviser.

Mandatory rules:
- Use only the facts supplied in the customer information.
- Do not invent facts, dates, money amounts, account numbers, booking references,
  evidence, witnesses, legislation, regulations, deadlines, company policies,
  previous contact, admissions, or outcomes.
- Do not claim or imply that the company has broken the law or breached a regulation.
- Do not say that the customer is legally entitled to compensation, a refund, or any
  particular outcome.
- Do not threaten, accuse, insult, or use aggressive language.
- Do not promise escalation, a successful result, compensation, or payment.
- If a material detail is absent, use a neutral placeholder such as "[add date]",
  "[add reference]", "[add details of previous contact]", or "[add relevant detail]".
- Do not add a legal disclaimer; Disputr displays this separately.
- Return only the finished complaint letter.
- Do not return JSON, Markdown, code fences, a title, a subject line, checklists,
  explanatory notes, or any text before or after the letter.

Customer information:
${JSON.stringify(data, null, 2)}
`.trim();
}

function buildSubject(company, issueType) {
  return `Complaint regarding ${issueType} — ${company}`;
}

function buildFactsToCheck(data) {
  const items = [];

  if (data.incident_date === "Not provided") {
    items.push("Date or dates of the issue");
  }

  if (data.reference_number === "Not provided") {
    items.push("Relevant account, booking, order, or complaint reference");
  }

  if (data.previous_contact === "Not provided") {
    items.push(
      "Whether you previously contacted the company and any response received"
    );
  }

  if (data.costs_or_losses === "Not provided") {
    items.push("Any direct costs or losses, if relevant");
  }

  return items;
}

function buildSuggestedAttachments(data) {
  const attachments = [
    "Copies of relevant correspondence with the company"
  ];

  if (data.reference_number !== "Not provided") {
    attachments.push("A document showing the relevant reference number");
  }

  if (data.costs_or_losses !== "Not provided") {
    attachments.push(
      "Receipts, invoices, or statements supporting any costs or losses"
    );
  }

  return attachments;
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
        service: "Disputr AI complaint service",
        ai_binding_present: Boolean(env.AI)
      });
    }

    if (url.pathname === "/api/generate-complaint") {
      if (request.method !== "POST") {
        return json({ error: "Method not allowed" }, 405);
      }

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
                  "Write only the requested complaint letter in UK English. Do not return JSON or Markdown."
              },
              {
                role: "user",
                content: makePrompt(complaintData)
              }
            ],
            max_tokens: 2600,
            temperature: 0.2
          }
        );

        const draft = getTextFromAIResponse(aiResponse);

        if (!draft) {
          console.error("Workers AI returned no usable text:", aiResponse);

          return json(
            { error: "The AI did not return a draft. Please try again." },
            502
          );
        }

        return json({
          title: "Suggested complaint",
          subject: buildSubject(company, issueType),
          recipient_suggestion: `The complaints team at ${company}`,
          draft,
          facts_to_check: buildFactsToCheck(complaintData),
          suggested_attachments: buildSuggestedAttachments(complaintData),
          suggested_next_step:
            "Check every fact, add any missing information, and send the complaint through the company’s official complaints channel.",
          disclaimer: DISCLAIMER
        });
      } catch (error) {
        console.error("Complaint generation failed:", error);

        return json(
          {
            error: "We could not create your draft right now. Please try again."
          },
          500
        );
      }
    }

    return env.ASSETS.fetch(request);
  }
};
