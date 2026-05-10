
/**
 * Background Payload Processor
 *
 * Implements Objective 3:
 *   1. Update WAL → "processing"
 *   2. Extract text/image from payload
 *   3. Call AI service (text or image)
 *   4. Map phone → household_id, insert events
 *   5. Send whatsapp_reply_text back
 *   6. Update WAL → "completed" | "failed"
 */

import { updateWalStatus, getHouseholdIdByPhone, insertEvents } from "@/services/db.service";
import { sendWhatsAppText } from "@/services/whatsapp.service";
import { inferFromText, inferFromImage } from "@/services/ai.service";
import { extractSenderPhone, extractMessageText, extractImageInfo, fetchMediaAsBase64 } from "@/services/whatsapp.service";

export async function processPayloadInBackground(
  messageId: string,
  payload:   Record<string, unknown>,
): Promise<void> {
  // ── 1. Mark as processing ──────────────────────────────────
  await updateWalStatus(messageId, "processing");

  try {
    // ── 2. Extract sender phone ───────────────────────────────
    const senderPhone = extractSenderPhone(payload);
    if (!senderPhone) throw new Error("Could not extract sender phone");

    // ── 3. Resolve to household_id ───────────────────────────
    const householdId = await getHouseholdIdByPhone(senderPhone);
    if (!householdId) {
      // Unknown sender – reply with a polite message and bail
      await updateWalStatus(messageId, "failed", "Unknown sender phone");
      await sendWhatsAppText(
        senderPhone,
        "Good day! I'm afraid I don't recognise your household. " +
        "Please contact your household administrator."
      );
      return;
    }

    // ── 4. Check for image ───────────────────────────────────
    const imageInfo = extractImageInfo(payload);
    let imageBase64: string | null = null;

    if (imageInfo) {
      // Resolve media ID → actual CDN URL via Meta media endpoint
      // The extractImageInfo returns the mediaId; fetchMediaAsBase64 resolves it
      imageBase64 = await fetchMediaAsBase64(imageInfo.mediaId).catch((err) => {
        console.warn("[processor] Image fetch failed:", err);
        return null;
      });
    }

    // ── 5. Extract text ──────────────────────────────────────
    const text = extractMessageText(payload) ?? imageInfo?.caption ?? "";
    if (!text && !imageBase64) {
      // Non-text, non-image message (e.g. a read receipt) – acknowledge and exit
      await updateWalStatus(messageId, "completed");
      return;
    }

    // ── 6. AI inference ──────────────────────────────────────
    let aiResult: { intent: string; events: Array<{ event_type: string; event_data: Record<string, unknown> }>; whatsapp_reply_text: string; raw: Record<string, unknown> } | null = null;

    if (imageBase64) {
      aiResult = await inferFromImage(text || "Please analyse this image.", imageBase64, messageId);
    } else {
      aiResult = await inferFromText(text, messageId);
    }

    let replyText: string;
    if (!aiResult) {
      replyText = "I apologise – I encountered a spot of bother processing your request. Please try again in a moment.";
      await updateWalStatus(messageId, "failed", "AI inference returned null");
      await sendWhatsAppText(senderPhone, replyText);
      return;
    }

    replyText = aiResult.whatsapp_reply_text;

    // ── 7. Insert events into Supabase ───────────────────────
    if (aiResult.events.length > 0) {
      const eventInserts = aiResult.events.map((evt) => ({
        household_id:          householdId,
        intent:                aiResult!.intent,
        event_type:            evt.event_type,
        event_data:            evt.event_data,
        raw_ai_output:         aiResult!.raw,
        whatsapp_reply_text:   replyText,
        message_id:            messageId,
      }));
      await insertEvents(eventInserts);
    }

    // ── 8. Send WhatsApp reply ───────────────────────────────
    await sendWhatsAppText(senderPhone, replyText);

    // ── 9. Mark completed ────────────────────────────────────
    await updateWalStatus(messageId, "completed");
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[processor] Unhandled error:", errorMsg);
    await updateWalStatus(messageId, "failed", errorMsg);

    // Attempt to notify the user of failure
    const senderPhone = extractSenderPhone(payload);
    if (senderPhone) {
      await sendWhatsAppText(
        senderPhone,
        "I apologise – something went wrong on my end. The household manager has been alerted."
      ).catch(() => {});
    }
  }
}
