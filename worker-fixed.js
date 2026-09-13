import baseWorker from './worker.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
};

const DISCLAIMER = 'Suggested wording only. This draft is based on the information you entered. Check every fact, remove anything inaccurate, and personalise it before using it. Disputr does not provide legal advice or guarantee an outcome.';

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
}

function clean(value, max = 4000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function outputText(payload) {
  return (payload?.output || [])
    .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
    .filter((item) => item?.type === 'output_text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('\n');
}

async function generateComplaint(request, env) {
  if (!env.OPENAI_API_KEY) {
    return json({ error: 'Draft generation is temporarily unavailable. Please try again shortly.' }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Please check the complaint details and try again.' }, 400);
  }

  const category = clean(body.category, 100);
  const company = clean(body.company, 150);
  const issueType = clean(body.issueType, 150);
  const whatHappened = clean(body.whatHappened, 4000);
  const desiredOutcome = clean(body.desiredOutcome, 1500);

  if (!category || !company || !issueType || !whatHappened || !desiredOutcome) {
    return json({ error: 'Please complete the category, company, issue type, what happened, and desired outcome fields.' }, 400);
  }

  const facts = {
    category,
    company,
    issue_type: issueType,
    incident_date: clean(body.incidentDate, 100) || 'Not provided',
    reference_number: clean(body.referenceNumber, 150) || 'Not provided',
    what_happened: whatHappened,
    previous_contact: clean(body.priorContact, 1500) || 'Not provided',
    costs_or_losses: clean(body.costsOrLosses, 1000) || 'Not provided',
    desired_outcome: desiredOutcome,
    preferred_tone: clean(body.tone, 100) || 'Firm but polite'
  };

  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'subject', 'recipient_suggestion', 'draft', 'facts_to_check', 'suggested_attachments', 'suggested_next_step'],
    properties: {
      title: { type: 'string' },
      subject: { type: 'string' },
      recipient_suggestion: { type: 'string' },
      draft: { type: 'string' },
      facts_to_check: { type: 'array', items: { type: 'string' } },
      suggested_attachments: { type: 'array', items: { type: 'string' } },
      suggested_next_step: { type: 'string' }
    }
  };

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL || 'gpt-5.6-luna',
        store: false,
        input: [
          {
            role: 'developer',
            content: 'Write a professional UK-English consumer complaint draft using only the supplied facts. Do not invent facts, laws, rights, deadlines, evidence or outcomes. Do not give legal advice. Be factual, polite and firm. Put missing information in facts_to_check. Return JSON matching the supplied schema.'
          },
          { role: 'user', content: JSON.stringify(facts) }
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'complaint_template',
            strict: true,
            schema
          }
        },
        max_output_tokens: 1800
      })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('Draft generation API failure', response.status, payload?.error?.code || payload?.error?.type || 'unknown');
      return json({ error: 'Draft generation is temporarily unavailable. Please try again shortly.' }, 502);
    }

    const text = outputText(payload);
    if (!text) return json({ error: 'The AI returned no usable draft. Please try again.' }, 502);

    const result = JSON.parse(text);
    return json({ ...result, disclaimer: DISCLAIMER });
  } catch (error) {
    console.error('Draft generation failure', error instanceof Error ? error.message : String(error));
    return json({ error: 'Draft generation is temporarily unavailable. Please try again shortly.' }, 502);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/api/generate-complaint') {
      return generateComplaint(request, env);
    }
    return baseWorker.fetch(request, env, ctx);
  }
};
