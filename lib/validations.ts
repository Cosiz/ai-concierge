/**
 * Zod validation schemas for AI output and external APIs.
 */

import { z } from "zod";

// ──────────────────────────────────────────────────────────────
// AI Output Schema
// ──────────────────────────────────────────────────────────────

/**
 * Strict Zod schema for what the LLM must return.
 *
 * intent:           High-level intent label (e.g. "schedule_cleaning", "create_reminder")
 * events:           Array of structured event objects to persist
 * whatsapp_reply_text: Plain-text reply sent back to the user via WhatsApp
 */
export const AiOutputSchema = z.object({
  intent: z.string().min(1),
  events: z.array(
    z.object({
      event_type: z.string().min(1),
      event_data: z.record(z.string(), z.unknown()),
    })
  ),
  whatsapp_reply_text: z.string(),
});

export type AiOutput = z.infer<typeof AiOutputSchema>;

// ──────────────────────────────────────────────────────────────
// WhatsApp payload helpers (runtime type guard)
// ──────────────────────────────────────────────────────────────

export function isWhatsAppPayload(obj: unknown): obj is Record<string, unknown> {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "entry" in obj
  );
}
