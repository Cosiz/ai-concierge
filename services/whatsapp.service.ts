/**
 * WhatsApp Service
 * API calls to Meta /messages, media fetch → Base64.
 * Uses WHATSAPP_ACCESS_TOKEN.
 */

const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID!;
const WHATSAPP_ACCESS_TOKEN    = process.env.WHATSAPP_ACCESS_TOKEN!;
const WHATSAPP_API_VERSION     = process.env.WHATSAPP_API_VERSION ?? "v21.0";

const META_BASE = `https://graph.facebook.com/${WHATSAPP_API_VERSION}`;

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────

export interface SendMessageResult {
  success: boolean;
  message_id?: string;
  error?:   string;
}

// ──────────────────────────────────────────────────────────────
// Core: send text / image
// ──────────────────────────────────────────────────────────────

export async function sendWhatsAppText(
  recipientPhone: string,
  body: string,
): Promise<SendMessageResult> {
  return _postMessage({
    messaging_product: "whatsapp",
    to:                recipientPhone,
    type:              "text",
    text:              { body },
  });
}

export async function sendWhatsAppImage(
  recipientPhone: string,
  imageBase64: string,
  caption?: string,
): Promise<SendMessageResult> {
  return _postMessage({
    messaging_product: "whatsapp",
    to:                recipientPhone,
    type:              "image",
    image:             { base64: imageBase64, caption },
  });
}

async function _postMessage(payload: Record<string, unknown>): Promise<SendMessageResult> {
  const url = `${META_BASE}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

  let res: Response;
  try {
    res = await fetch(url, {
      method:  "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return { success: false, error: String(err) };
  }

  const data = await res.json().catch(() => ({})) as Record<string, unknown>;

  if (!res.ok) {
    return { success: false, error: (data?.error as Record<string, unknown>)?.message as string ?? `HTTP ${res.status}` };
  }

  const messages = data?.messages as Array<Record<string, unknown>>;
  return { success: true, message_id: messages?.[0]?.id as string };
}

// ──────────────────────────────────────────────────────────────
// Media: fetch WhatsApp CDN file → base64 data-URI
// ──────────────────────────────────────────────────────────────

/**
 * Download a media file from Meta's CDN and return as a base64 data URI.
 * @param mediaIdOrUrl  Media ID (from webhook) or full CDN URL.
 */
export async function fetchMediaAsBase64(mediaIdOrUrl: string): Promise<string> {
  let mediaUrl = mediaIdOrUrl;

  // If it looks like a raw media ID (no scheme), resolve via media endpoint
  if (!mediaUrl.startsWith("http")) {
    mediaUrl = `${META_BASE}/${mediaIdOrUrl}`;
  }

  const res = await fetch(mediaUrl, {
    headers: { Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}` },
  });

  if (!res.ok) {
    throw new Error(`Media fetch failed: HTTP ${res.status}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const contentType = res.headers.get("Content-Type") ?? "application/octet-stream";
  const mime        = contentType.split(";")[0].trim();
  const b64         = Buffer.from(arrayBuffer).toString("base64");

  return `data:${mime};base64,${b64}`;
}

// ──────────────────────────────────────────────────────────────
// Payload helpers
// ──────────────────────────────────────────────────────────────

/** Walk the WhatsApp webhook payload tree and return the sender\'s wa_id. */
export function extractSenderPhone(payload: Record<string, unknown>): string | null {
  try {
    const entry   = ((payload.entry as Array<Record<string, unknown>>) ?? [])[0];
    const changes = ((entry?.changes as Array<Record<string, unknown>>) ?? [])[0];
    const value   = changes?.value as Record<string, unknown>;
    const contacts = ((value?.contacts as Array<Record<string, unknown>>) ?? []);
    const contact  = contacts[0] as Record<string, unknown>;
    return (contact?.wa_id as string) ?? null;
  } catch { return null; }
}

/** Walk the WhatsApp payload and return the message text. */
export function extractMessageText(payload: Record<string, unknown>): string | null {
  try {
    const entry    = ((payload.entry as Array<Record<string, unknown>>) ?? [])[0];
    const changes  = ((entry?.changes as Array<Record<string, unknown>>) ?? [])[0];
    const value    = changes?.value as Record<string, unknown>;
    const messages = ((value?.messages as Array<Record<string, unknown>>) ?? []);
    const msg      = messages[0] as Record<string, unknown>;
    const text     = msg?.text as Record<string, unknown>;
    return (text?.body as string) ?? null;
  } catch { return null; }
}

/**
 * Walk the payload and return image metadata if the message contains an image.
 * The caller should call fetchMediaAsBase64(mediaUrl) to get the actual bytes.
 */
export function extractImageInfo(
  payload: Record<string, unknown>,
): { mediaId: string; mimeType: string; caption?: string } | null {
  try {
    const entry    = ((payload.entry as Array<Record<string, unknown>>) ?? [])[0];
    const changes  = ((entry?.changes as Array<Record<string, unknown>>) ?? [])[0];
    const value    = changes?.value as Record<string, unknown>;
    const messages = ((value?.messages as Array<Record<string, unknown>>) ?? []);
    const msg      = messages[0] as Record<string, unknown>;
    const image    = msg?.image as Record<string, unknown>;
    if (!image?.id) return null;
    return {
      mediaId:  image.id as string,
      mimeType: (image.mime_type as string) ?? "image/jpeg",
      caption:  image.caption as string | undefined,
    };
  } catch { return null; }
}
