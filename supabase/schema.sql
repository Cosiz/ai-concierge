-- ============================================================
-- AI Concierge – Supabase Schema
-- Run this in: Supabase Dashboard → SQL Editor
-- ============================================================

-- ── Households ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS households (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  phone           TEXT        UNIQUE NOT NULL,   -- E.164 format, e.g. +441234567890
  household_token TEXT        UNIQUE NOT NULL,  -- public-facing magic link token
  name            TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Index for fast phone lookups (incoming webhooks)
CREATE INDEX IF NOT EXISTS idx_households_phone ON households(phone);
-- Index for magic-link token lookups (hub page)
CREATE INDEX IF NOT EXISTS idx_households_token ON households(household_token);

-- ── Webhook Audit Log (WAL) ──────────────────────────────────
-- One row per distinct WhatsApp message_id.
-- Unique constraint enforces idempotency.
CREATE TABLE IF NOT EXISTS webhook_audit_log (
  id           BIGSERIAL PRIMARY KEY,
  message_id   TEXT      UNIQUE NOT NULL,
  payload      JSONB     NOT NULL DEFAULT '{}',
  status       TEXT      NOT NULL DEFAULT 'received'
               CHECK (status IN ('received', 'processing', 'completed', 'failed')),
  error_msg    TEXT,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wal_status    ON webhook_audit_log(status);
CREATE INDEX IF NOT EXISTS idx_wal_created   ON webhook_audit_log(created_at DESC);

-- ── Events ───────────────────────────────────────────────────
-- Each row = one structured event extracted from the AI output.
CREATE TABLE IF NOT EXISTS events (
  id                    BIGSERIAL PRIMARY KEY,
  household_id          UUID      NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  intent                TEXT      NOT NULL,   -- e.g. 'schedule_cleaning'
  event_type           TEXT      NOT NULL,   -- e.g. 'cleaning_scheduled'
  event_data           JSONB     NOT NULL DEFAULT '{}',
  raw_ai_output        JSONB     NOT NULL DEFAULT '{}',
  whatsapp_reply_text  TEXT,
  source_message_id    TEXT,
  created_at           TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_household ON events(household_id);
CREATE INDEX IF NOT EXISTS idx_events_created   ON events(created_at DESC);

-- ── RLS (Row Level Security) ─────────────────────────────────
-- Enable RLS so the anon key can only read (not write) events.
ALTER TABLE households ENABLE ROW LEVEL SECURITY;
ALTER TABLE events    ENABLE ROW LEVEL SECURITY;

-- Households: anyone can read (magic link is public), only service role can write
CREATE POLICY "Households: public read"  ON households FOR SELECT USING (true);
CREATE POLICY "Households: service write" ON households FOR INSERT WITH CHECK (true);  -- service role only

-- Events: public read, service role insert
CREATE POLICY "Events: public read"    ON events FOR SELECT USING (true);
CREATE POLICY "Events: service insert" ON events FOR INSERT WITH CHECK (true);

-- WAL: service role only, no public access
CREATE POLICY "WAL: service only" ON webhook_audit_log FOR ALL USING (true);
