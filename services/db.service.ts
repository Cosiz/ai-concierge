/**
 * DB Service
 * Supabase client, WAL (Webhook Audit Log) logging, event insertions.
 * Uses NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

// ──────────────────────────────────────────────────────────────
// Client (service role – server-side only)
// ──────────────────────────────────────────────────────────────

let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!_client) {
    const url    = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const secret = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    _client = createClient(url, secret, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _client;
}

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────

export type WalStatus = "received" | "processing" | "completed" | "failed";

export interface WebhookAuditLog {
  id:        number;
  message_id: string;
  payload:   Record<string, unknown>;
  status:    WalStatus;
  error_msg: string | null;
  created_at: string;
  updated_at: string;
}

// ──────────────────────────────────────────────────────────────
// Webhook Audit Log (WAL)
// ──────────────────────────────────────────────────────────────

/**
 * Insert a new WAL entry. Throws if message_id violates the unique constraint.
 */
export async function insertWebhookLog(
  messageId: string,
  payload: Record<string, unknown>,
): Promise<WebhookAuditLog> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("webhook_audit_log")
    .insert({
      message_id: messageId,
      payload:    payload as never,
      status:     "received",
    })
    .select()
    .single();

  if (error) {
    // Unique constraint violation = duplicate webhook
    if (error.code === "23505") {
      const dup = new Error("DUPLICATE_MESSAGE_ID") as Error & { code?: string };
      dup.code = "23505";
      throw dup;
    }
    throw error;
  }

  return data as WebhookAuditLog;
}

/** Update WAL status. */
export async function updateWalStatus(
  messageId: string,
  status: WalStatus,
  errorMsg?: string,
): Promise<void> {
  const supabase = getClient();
  const { error } = await supabase
    .from("webhook_audit_log")
    .update({ status: status, error_msg: errorMsg ?? null })
    .eq("message_id", messageId);

  if (error) console.error("[db] updateWalStatus error:", error.message);
}

/** Get a WAL entry by message_id. */
export async function getWal(messageId: string): Promise<WebhookAuditLog | null> {
  const supabase = getClient();
  const { data } = await supabase
    .from("webhook_audit_log")
    .select("*")
    .eq("message_id", messageId)
    .single();
  return (data as WebhookAuditLog) ?? null;
}

// ──────────────────────────────────────────────────────────────
// Household lookup
// ──────────────────────────────────────────────────────────────

/** Map a phone number (E.164) to a household_id. */
export async function getHouseholdIdByPhone(
  phone: string,
): Promise<string | null> {
  const supabase = getClient();
  const { data } = await supabase
    .from("households")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();

  return (data as { id: string } | null)?.id ?? null;
}

/** Resolve a household_token to a household_id. */
export async function getHouseholdIdByToken(
  token: string,
): Promise<string | null> {
  const supabase = getClient();
  const { data } = await supabase
    .from("households")
    .select("id")
    .eq("household_token", token)
    .maybeSingle();

  return (data as { id: string } | null)?.id ?? null;
}

// ──────────────────────────────────────────────────────────────
// Events
// ──────────────────────────────────────────────────────────────

export interface EventInsert {
  household_id:  string;
  intent:        string;
  event_type:    string;
  event_data:    Record<string, unknown>;
  raw_ai_output: Record<string, unknown>;
  whatsapp_reply_text?: string | null;
  message_id:    string;
}

/** Insert validated events returned by the AI. */
export async function insertEvents(
  events: EventInsert[],
): Promise<void> {
  if (!events.length) return;
  const supabase = getClient();
  const { error } = await supabase.from("events").insert(
    events.map((e) => ({
      household_id:          e.household_id,
      intent:                e.intent,
      event_type:            e.event_type,
      event_data:            e.event_data as never,
      raw_ai_output:         e.raw_ai_output as never,
      whatsapp_reply_text:   e.whatsapp_reply_text ?? null,
      source_message_id:     e.message_id,
    })),
  );
  if (error) throw error;
}

// ──────────────────────────────────────────────────────────────
// Public facing read helpers (used by hub page, not service role)
// ──────────────────────────────────────────────────────────────

/** Fetch events for a given household_token (public anon key OK for reads). */
export async function getEventsByToken(
  token: string,
  limit = 50,
) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  const { data: household } = await supabase
    .from("households")
    .select("id")
    .eq("household_token", token)
    .maybeSingle();

  if (!household) return [];

  const { data } = await supabase
    .from("events")
    .select("*")
    .eq("household_id", (household as { id: string }).id)
    .order("created_at", { ascending: false })
    .limit(limit);

  return data ?? [];
}
