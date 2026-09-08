function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store"
    }
  });
}

function removeCodeFences(value) {
  return String(value || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function getTextFromOpenAI(result) {
  if (typeof result?.output_text === "string") {
    return result.output_text.trim();
  }

  if (!Array.isArray(result?.output)) {
    return "";
  }

  return result.output
    .flatMap((item) =>
      Array.isArray(item.content) ? item.content : []
    )
    .filter((content) => content.type === "output_text")
    .map((content) => content.text || "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

function makePrompt(data) {
  return `
Create a professional UK consumer-complaint draft based only on the information supplied.

Do not give legal advice. Do not claim a guaranteed outcome.
Do not invent dates, amounts, evidence, policies, statutes, events, or contact details.

Return only valid JSON with exactly these keys:
"title",
"subject",
"recipient_suggestion",
"draft",
"facts_to_check",
"suggested_attachments",
"suggested_next_step",
"disclaimer"

Complaint details:
${JSON.stringify(data)}
`.trim();
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.OPENAI_API_KEY) {
    return json(
      {
        error:
          "The AI service is not configured yet. Please try again later."
      },
      503
    );
  }

  let complaintData;

  try {
    complaintData = await request.json();
  } catch {
    return json(
      {
        error: "Please submit the complaint form again."
      },
      400
    );
  }

  if (!complaintData || typeof complaintData !== "object") {
    return json(
      {
        error: "The complaint details are missing or invalid."
      },
      400
    );
  }

  const openaiResponse = await fetch(
    "https://api.openai.com/v1/responses",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-5.4-mini",
        input: [
          {
            role: "system",
            content:
              "You produce safe, professional consumer-complaint drafting suggestions. Return only the requested JSON."
          },
          {
            role: "user",
            content: makePrompt(complaintData)
          }
        ],
        text: {
          format: {
            type: "json_object"
          }
        }
      })
    }
  );

  let aiResponse;

  try {
    aiResponse = await openaiResponse.json();
  } catch {
    return json(
      {
        error: "The AI service returned an unreadable response. Please try again."
      },
      502
    );
  }

  if (!openaiResponse.ok) {
    console.error("OpenAI API error:", {
      status: openaiResponse.status,
      error: aiResponse?.error
    });

    return json(
      {
        error:
          aiResponse?.error?.message ||
          "The AI service could not prepare a draft. Please try again."
      },
      502
    );
  }

  const text = removeCodeFences(getTextFromOpenAI(aiResponse));

  if (!text) {
    console.error("OpenAI returned no output text:", aiResponse);

    return json(
      {
        error: "The AI service did not return a complaint draft. Please try again."
      },
      502
    );
  }

  let result;

  try {
    result = JSON.parse(text);
  } catch {
    console.error("OpenAI returned invalid JSON:", text);

    return json(
      {
        error: "The AI draft could not be processed. Please try again."
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

  const missingKeys = requiredKeys.filter(
    (key) => typeof result?.[key] !== "string" && !Array.isArray(result?.[key])
  );

  if (missingKeys.length) {
    console.error("OpenAI draft is missing required fields:", {
      missingKeys,
      result
    });

    return json(
      {
        error: "The AI returned an incomplete draft. Please try again."
      },
      502
    );
  }

  return json(result);
}
