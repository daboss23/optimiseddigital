// Single source of truth for the Claude models the platform runs on.
//
// Three tiers, matching the architecture in CLAUDE.md / SYSTEM_DESIGN.md:
//
// - ORCHESTRATOR_MODEL — OPUS, the Master Strategist. Multi-step reasoning over
//   retrieved evidence and the tool-use loop. Runs on Claude Fable 5, the most
//   capable model for long-horizon agentic work. Notes: thinking is always on
//   (never send a `thinking` param), sampling params (temperature/top_p/top_k)
//   are rejected, and safety classifiers can decline a request with
//   stop_reason "refusal" — the reactor route opts into the server-side
//   fallback so declined requests are transparently re-served on Opus 4.8.
// - ORCHESTRATOR_FALLBACK_MODEL — Opus 4.8. Three jobs: the server-side safety
//   fallback for Fable 5 refusals, the client-side fallback when the org can't
//   run Fable 5 at all (e.g. the 30-day data-retention requirement isn't met —
//   every request 400s), and the model for single-shot latency-sensitive
//   strategy calls (suggest/intelligence) where Fable's always-on thinking
//   would slow the typing-time UX for no strategic gain.
// - INTELLIGENCE_MODEL — the cheaper tier the consultable layers
//   (ATLAS/NOVA/SPARK/ECHO/ORACLE), the NEURO pre-test, and bulk/single-shot
//   copy run on. Structured, high-volume work.
//
// Bumping a model is a one-line change here. Everything else imports these.
export const ORCHESTRATOR_MODEL = 'claude-fable-5'
export const ORCHESTRATOR_FALLBACK_MODEL = 'claude-opus-4-8'
export const INTELLIGENCE_MODEL = 'claude-sonnet-5'

// VISION_MODEL — SPARK's design read of an uploaded ad. This one runs once per
// ingest, and everything downstream (the stored pattern, the production brief,
// the cloned render) inherits whatever it gets wrong, so it is worth the
// stronger tier: reading a dense contact sheet and transcribing on-ad copy
// exactly is precision work, not bulk work.
export const VISION_MODEL = ORCHESTRATOR_FALLBACK_MODEL

// Messages API beta that lets a Fable 5 request name substitute models — a
// safety-classifier decline is re-served by the fallback model inside the same
// call instead of failing the run.
export const SERVER_SIDE_FALLBACK_BETA = 'server-side-fallback-2026-06-01'
