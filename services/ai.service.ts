/**
 * AI Service
 * DashScope Qwen-Plus inference via OpenAI-compatible SDK.
 * Validates the LLM output against Zod schema.
 */

import OpenAI from "openai";
import { AiOutputSchema, AiOutput } from "@/lib/validations";

const DASHSCOPE_BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
const MODEL_NAME         = "qwen-plus";

let _openai: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({
      baseURL:     DASHSCOPE_BASE_URL,
      apiKey:      process.env.DASHSCOPE_API_KEY!,
      dangerouslyAllowBrowser: false,
    });
  }
  return _openai;
}

const SYSTEM_PROMPT = `You are a high-end British household manager.
Analyze the user\\'s message (and image if provided) and respond STRICTLY with valid JSON.
Do NOT include any text outside the JSON object.
Your response must conform exactly to this schema:
{
  "intent": "<string – a short lowercase intent label, e.g. 'schedule_cleaning' or 'create_reminder'>",
  "events": [
    {
      "event_type": "<string – e.g. 'cleaning_scheduled', 'reminder_created', 'task_added'>",
      "event_data": { <any additional structured fields> }
    }
  ],
  "whatsapp_reply_text": "<string – polite, concise reply sent back to the user on WhatsApp>"
}
Only output the JSON. No markdown fences, no commentary.`;

// ──────────────────────────────────────────────────────────────
// Text-only inference
// ──────────────────────────────────────────────────────────────

export interface AiInferenceResult {
  intent:              string;
  events:              Array<{ event_type: string; event_data: Record<string, unknown> }>;
  whatsapp_reply_text: string;
  raw:                 Record<string, unknown>;
}

/**
 * Send a text message to Qwen-Plus and return validated AiInferenceResult.
 * On validation failure, returns null.
 */
export async function inferFromText(
  text: string,
  messageId: string,
): Promise<AiInferenceResult | null> {
  const client = getClient();

  const response = await client.chat.completions.create({
    model:      MODEL_NAME,
    messages:   [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user",   content: text },
    ],
    temperature: 0.3,
    max_tokens:  1024,
  });

  const rawContent = response.choices[0]?.message?.content ?? "";

  return _parseAndValidate(rawContent, messageId);
}

// ──────────────────────────────────────────────────────────────
// Image inference (base64 data URI)
// ──────────────────────────────────────────────────────────────

/**
 * Send a text + image to Qwen-Plus and return validated AiInferenceResult.
 * imageBase64 must be a data URI, e.g. "data:image/jpeg;base64,...".
 */
export async function inferFromImage(
  text:        string,
  imageBase64: string,
  messageId:   string,
): Promise<AiInferenceResult | null> {
  const client = getClient();

  // Determine MIME type from the data URI prefix
  const mimeMatch = imageBase64.match(/^data:([^;]+);base64,/);
  const mime      = mimeMatch ? mimeMatch[1] : "image/jpeg";

  const response = await client.chat.completions.create({
    model: MODEL_NAME,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text",     text },
          {
            type: "image_url",
            image_url: {
              url:    imageBase64,
              detail: "high",
            },
          },
        ],
      },
    ],
    temperature: 0.3,
    max_tokens:  2048,
  });

  const rawContent = response.choices[0]?.message?.content ?? "";

  return _parseAndValidate(rawContent, messageId);
}

// ──────────────────────────────────────────────────────────────
// Shared parse + validate
// ──────────────────────────────────────────────────────────────

/**
 * Strip markdown fences if present, parse JSON, validate with Zod.
 * Imports db.service to update WAL status on failure.
 */
async function _parseAndValidate(
  rawContent: string,
  messageId:  string,
): Promise<AiInferenceResult | null> {
  // Strip markdown code fences
  let cleaned = rawContent.trim();
  if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
  else if (cleaned.startsWith("```"))  cleaned = cleaned.slice(3);
  if (cleaned.endsWith("```"))         cleaned = cleaned.slice(0, -3);
  cleaned = cleaned.trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    console.error("[ai] JSON parse error:", cleaned.slice(0, 200));
    await _markFailed(messageId, "JSON parse error");
    return null;
  }

  const zodResult = AiOutputSchema.safeParse(parsed);
  if (!zodResult.success) {
    console.error("[ai] Zod validation error:", zodResult.error.message);
    await _markFailed(messageId, `Zod error: ${zodResult.error.message}`);
    return null;
  }

  const valid = zodResult.data as AiOutput;
  return {
    intent:              valid.intent,
    events:              valid.events,
    whatsapp_reply_text: valid.whatsapp_reply_text,
    raw:                 parsed,
  };
}

async function _markFailed(messageId: string, errorMsg: string): Promise<void> {
  try {
    const { updateWalStatus } = await import("@/services/db.service");
    await updateWalStatus(messageId, "failed", errorMsg);
  } catch { /* non-fatal */ }
}
