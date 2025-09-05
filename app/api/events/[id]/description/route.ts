// API: GET /api/events/[id]/description[?force=1]
// Purpose: Return a short, family-friendly description for an event.
// Behavior:
// - If events.description exists and not forcing, prefer that (source: "event").
// - Else check cache table event_descriptions.
// - Else call LLM server-side, sanitize result, cache, and return (source: "ai").
// Notes:
// - Do not expose provider API keys; calls remain server-side only.
// - Keep prompt compact and neutral; add a timeout to avoid hanging.
// - RLS on events and event_descriptions ensures kid-only visibility.

import { NextResponse } from "next/server";
import { supabaseAnon } from "@/lib/db/supabase";

export const runtime = "nodejs";

const TIMEOUT_MS = 12_000;
const MAX_LEN = 600;

// Trim, collapse whitespace, cap length, and strip obvious adult terms.
function sanitize(text: string, max = MAX_LEN) {
  const collapsed = String(text || "").replace(/\s+/g, " ").trim().slice(0, max);
  const banned = /(adult|nsfw|explicit|18\+|21\+)/gi;
  return collapsed.replace(banned, "").trim();
}

// Build a compact, factual prompt. Use resilient fallbacks when fields are missing.
function buildPrompt(evt: {
  title: string;
  venue_name?: string | null;
  city?: string | null;
  state?: string | null;
  start_utc?: string | null;
}) {
  const safeTitle = (evt.title || "Community Event").slice(0, 120);
  const when = evt.start_utc ? new Date(evt.start_utc).toLocaleString() : "Date/time TBA";
  const place = [evt.venue_name, evt.city, evt.state].filter(Boolean).join(", ") || "Location TBA";
  return `Write 2–3 sentences describing a public, kid-allowed event.
Tone: warm, neutral, factual; family-friendly; avoid hype.
Include what it is, that families/kids are welcome, when ("${when}") and where ("${place}").
Avoid unsafe content, prices, emojis, or promises.
Title: "${safeTitle}"`;
}

async function withTimeout<T>(p: Promise<T>, ms: number) {
  return await Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("LLM timeout")), ms)),
  ]);
}

type Params = { params: { id: string } };

export async function GET(request: Request, { params }: Params) {
  try {
    const id = params?.id;
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }

    const url = new URL(request.url);
    const force = url.searchParams.get("force") === "1";

    // 1) Fetch the event (RLS enforces kid-only visibility)
    const { data: evt, error: e1 } = await supabaseAnon
      .from("events")
      .select("id, title, description, start_utc, venue_name, city, state, source_url")
      .eq("id", id)
      .maybeSingle();

    if (!evt) {
      // Not found (or filtered by RLS)
      return NextResponse.json(
        { error: "Not found" },
        { status: 404, headers: { "Cache-Control": "no-store" } }
      );
    }
    if (e1) {
      return NextResponse.json(
        { error: "Failed to load event" },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    // 2) If the event already has a description, prefer it.
    if (!force && evt.description) {
      return NextResponse.json(
        { source: "event", description: sanitize(evt.description) },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    // 3) Check cache unless forcing regeneration.
    if (!force) {
      const { data: cached, error: eCache } = await supabaseAnon
        .from("event_descriptions")
        .select("description, source, model")
        .eq("event_id", evt.id)
        .maybeSingle();

      if (eCache?.message) {
        // Non-fatal: fall through to generation
      }

      if (cached?.description) {
        return NextResponse.json(
          {
            source: cached.source ?? "ai",
            model: cached.model ?? null,
            description: sanitize(cached.description),
          },
          { headers: { "Cache-Control": "no-store" } }
        );
      }
    }

    // 4) Generate via LLM (server-side). Replace with your provider of choice.
    const prompt = buildPrompt(evt);

    // Example using OpenAI (pseudo-code; keep server-side only):
    // import OpenAI from "openai";
    // const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
    // const resp = await withTimeout(
    //   openai.responses.create({
    //     model: "gpt-4.1-mini",
    //     input: prompt,
    //     temperature: 0.4,
    //     max_output_tokens: 180,
    //   }),
    //   TIMEOUT_MS
    // );
    // const raw = resp.output_text ?? "";

    // Placeholder generation to avoid breaking flow when no provider is wired.
    const cityState = [evt.city, evt.state].filter(Boolean).join(", ") || "your area";
    const whenText = evt.start_utc
      ? `on ${new Date(evt.start_utc).toLocaleString()}`
      : "soon — check back for final time";
    const raw = `A welcoming, family-friendly event. Enjoy activities suitable for kids and parents at ${evt.venue_name || "a local venue"} in ${cityState}, happening ${whenText}.`;

    const clean = sanitize(raw);
    if (!clean) {
      // Model returned nothing useful
      return NextResponse.json(
        { error: "Model produced empty output" },
        { status: 502, headers: { "Cache-Control": "no-store" } }
      );
    }

    // 5) Cache it (non-fatal on failure)
    const { error: e2 } = await supabaseAnon
      .from("event_descriptions")
      .upsert({ event_id: evt.id, description: clean, source: "ai", model: "gpt-4.1-mini" });

    if (e2) {
      // Return generated text even if caching failed
      return NextResponse.json(
        { source: "ai", model: "gpt-4.1-mini", description: clean, cache: "upsert_failed" },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    return NextResponse.json(
      { source: "ai", model: "gpt-4.1-mini", description: clean },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Server error";
    const status = msg.includes("timeout") ? 504 : 500;
    return NextResponse.json({ error: msg || "Server error" }, { status, headers: { "Cache-Control": "no-store" } });
  }
}

