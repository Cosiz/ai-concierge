
/**
 * WhatsApp Webhook Handler
 *
 * GET  – Meta hub.challenge verification
 * POST – Idempotent webhook receiver
 *
 * Design:
 *   1. Parse body, extract message_id.
 *   2. insertWebhookLog() → unique constraint throws on duplicate → return 200 OK.
 *   3. Fire processPayloadInBackground() WITHOUT await, immediately return 200.
 */

import { NextRequest, NextResponse } from "next/server";
import { insertWebhookLog } from "@/services/db.service";
import { processPayloadInBackground } from "./processor";

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN!;

// ──────────────────────────────────────────────────────────────
// GET  /api/webhook/whatsapp  →  hub.challenge verification
// ──────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const mode     = searchParams.get("hub.mode");
  const token    = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode !== "subscribe" || token !== VERIFY_TOKEN) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  return new NextResponse(challenge ?? "ok", { status: 200 });
}

// ──────────────────────────────────────────────────────────────
// POST  /api/webhook/whatsapp  →  receive event
// ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Step 1: parse body ──────────────────────────────────────
  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return new NextResponse("Bad Request", { status: 400 });
  }

  // ── Step 2: extract message_id ───────────────────────────────
  const messageId = _extractMessageId(payload);
  if (!messageId) {
    return new NextResponse("No message_id found", { status: 422 });
  }

  // ── Step 3: idempotent WAL insert ───────────────────────────
  try {
    await insertWebhookLog(messageId, payload);
  } catch (err) {
    const error = err as Error & { code?: string };
    if (error?.code === "23505") {
      // Duplicate – already processed, acknowledge gracefully
      return new NextResponse("OK", { status: 200 });
    }
    // Real DB error
    console.error("[webhook] WAL insert error:", error.message);
    return new NextResponse("Internal Server Error", { status: 500 });
  }

  // ── Step 4: fire-and-forget background processor ────────────
  // DO NOT await – Meta requires a fast 200 to avoid retries
  processPayloadInBackground(messageId, payload).catch((bgErr) => {
    console.error("[webhook] Background processor threw:", bgErr);
  });

  return new NextResponse("OK", { status: 200 });
}

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

/** Walk the WhatsApp payload and pull out the unique message id. */
function _extractMessageId(payload: Record<string, unknown>): string | null {
  try {
    const entry    = ((payload.entry as Array<Record<string, unknown>>) ?? [])[0];
    const changes  = ((entry?.changes as Array<Record<string, unknown>>) ?? [])[0];
    const value    = changes?.value as Record<string, unknown>;
    const messages = ((value?.messages as Array<Record<string, unknown>>) ?? []);
    return (messages[0]?.id as string) ?? null;
  } catch { return null; }
}
