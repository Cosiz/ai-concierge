
/**
 * Magic Link UI – Hub Timeline
 *
 * Server Component that:
 *   1. Fetches events from Supabase matching household_token
 *   2. Renders a luxury vertical timeline
 *
 * Colour palette:
 *   Background   bg-zinc-950   (Onyx black)
 *   Primary text text-stone-100 (Alabaster)
 *   Accent       text-amber-400 / border-amber-700
 */

import { getEventsByToken } from "@/services/db.service";
import { cn } from "@/lib/utils";

interface HubPageProps {
  params: Promise<{ household_token: string }>;
}

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────

interface Event {
  id:               string;
  household_id:     string;
  intent:           string;
  event_type:       string;
  event_data:       Record<string, unknown>;
  raw_ai_output:    Record<string, unknown>;
  whatsapp_reply_text: string | null;
  source_message_id: string;
  created_at:       string;
}

// ──────────────────────────────────────────────────────────────
// Timeline card
// ──────────────────────────────────────────────────────────────

function EventCard({ event, index }: { event: Event; index: number }) {
  const timeAgo = _timeAgo(new Date(event.created_at));
  const reply  = event.whatsapp_reply_text ?? "";

  return (
    <div className={cn(
      "relative pl-10 sm:pl-14",
      // connector line (hidden on last item)
      index !== 0 && "mt-6",
    )}>
      {/* Timeline dot */}
      <div className={cn(
        "absolute left-0 top-1.5 w-5 h-5 rounded-full",
        "bg-amber-600 border-2 border-amber-400",
        "shadow-[0_0_12px_rgba(245,158,11,0.4)]",
      )} />

      {/* Connector line (vertical) – only if not last */}
      {index !== 0 && (
        <div className="absolute left-[9px] top-[-24px] w-px h-6 bg-zinc-700" />
      )}

      {/* Card */}
      <div className={cn(
        "rounded-xl border border-zinc-800",
        "bg-zinc-900/60 backdrop-blur-sm",
        "p-4 sm:p-5",
        "transition-colors duration-200",
        "hover:border-zinc-700",
      )}>
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-2">
          <span className={cn(
            "inline-flex items-center gap-1.5",
            "px-2.5 py-0.5 rounded-full text-xs font-medium",
            "bg-amber-900/30 text-amber-400",
            "border border-amber-800",
          )}>
            {event.event_type}
          </span>
          <time className="text-xs text-zinc-500 shrink-0">{timeAgo}</time>
        </div>

        {/* Intent label */}
        <p className="text-sm font-semibold text-stone-200 mb-1">
          {event.intent}
        </p>

        {/* Reply sent to user */}
        {reply && (
          <p className="text-sm text-stone-400 leading-relaxed italic">
            &ldquo;{reply}&rdquo;
          </p>
        )}

        {/* Event data preview (if any) */}
        {Object.keys(event.event_data).length > 0 && (
          <div className="mt-3 pt-3 border-t border-zinc-800">
            <details className="group">
              <summary className="text-xs text-zinc-500 cursor-pointer hover:text-zinc-400 select-none">
                Event details
              </summary>
              <pre className="mt-2 p-3 rounded-lg bg-zinc-950 text-xs text-zinc-400 overflow-x-auto">
                {JSON.stringify(event.event_data, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Empty state
// ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-16 h-16 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-6">
        <svg className="w-8 h-8 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      </div>
      <h2 className="text-xl font-semibold text-stone-200 mb-2">All Quiet</h2>
      <p className="text-sm text-zinc-500 max-w-xs">
        No household events yet. Send a message to your WhatsApp concierge to get started.
      </p>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────────────────

export default async function HubPage({ params }: HubPageProps) {
  const { household_token } = await params;
  const rawEvents = await getEventsByToken(household_token, 50);
  const events    = (rawEvents as Event[]) ?? [];

  return (
    <main className="min-h-screen bg-zinc-950 text-stone-100">

      {/* ── Hero header ───────────────────────────────────── */}
      <header className="border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-5">
          <div className="flex items-center gap-3">
            {/* Logo mark */}
            <div className="w-9 h-9 rounded-xl bg-amber-600 flex items-center justify-center shadow-lg">
              <svg className="w-5 h-5 text-amber-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-semibold text-stone-100">Household Hub</h1>
              <p className="text-xs text-zinc-500">AI Concierge · Event Timeline</p>
            </div>
          </div>
        </div>
      </header>

      {/* ── Timeline content ───────────────────────────────── */}
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10">
        {events.length === 0 ? (
          <EmptyState />
        ) : (
          <section>
            <div className="flex items-center gap-3 mb-8">
              <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-widest">
                Recent Activity
              </h2>
              <div className="flex-1 h-px bg-zinc-800" />
              <span className="text-xs text-zinc-600">{events.length} events</span>
            </div>

            <div className="relative">
              {events.map((event, index) => (
                <EventCard key={event.id} event={event} index={index} />
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

// ──────────────────────────────────────────────────────────────
// Utility
// ──────────────────────────────────────────────────────────────

function _timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60)          return "just now";
  if (seconds < 3600)        return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400)       return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800)      return `${Math.floor(seconds / 86400)}d ago`;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
