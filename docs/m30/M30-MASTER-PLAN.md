# M30: Embedding Onboarding & Vector Honesty

Status: `open`
GitHub milestone: `30`
Parent program: none (user-demand driven; standalone milestone)
Governing contract: [M14 Honesty Contract](../M14-HONESTY-CONTRACT.md) (vocabulary and
claim-level rules apply to all M30 artifacts) plus the M10 evidence-governance standard.

## Purpose

Users installing Backbencher for the first time do not know what embedding models are,
why they matter, or where to put an API key. Today the engine silently falls back to
50-dimensional local word vectors (`local-word-vectors`) when no embedding config
exists, and if an API call fails mid-index, a process-wide latch (`_apiFailed`)
downgrades every later batch to `tfidf-v1`. The user gets bad vectors and no signal
explaining why `bb_search`/`bb_ask` quality is poor.

M30 ships: a `bb setup` wizard, a TTY-safe first-run hook on `bb index`, pre-save key
validation against real providers, per-batch rate-limit resilience, and honesty docs
that state exactly what the no-key mode gives and what it costs.

## Non-goals / ownership boundary

- No MCP tool surface changes (`src/mcp/` is M21 territory). M30 touches CLI
  (`src/cli/`), config (`src/config/`), and the semantic engine internals
  (`src/brain/semantic/`) only.
- No provider SDK dependencies: HTTP calls use the existing fetch-based client.
- No auto-purchase, no telemetry, no key storage beyond the local config file.

## Issue groups

| Code | Issue | Deliverable |
|------|-------|-------------|
| G1 | Governance | master plan, ledger, closure gate wiring in `npm run verify`, secret-hygiene guard |
| S1 | Setup wizard | `bb setup`: provider menu with prefilled base URL + model, key input, save to `~/.bb/config.json` (mode 0600) |
| S2 | First-run hook | `bb index` prompts when unconfigured AND stdin is a TTY; `--no-setup` escape; one-line notice when non-TTY; never hangs |
| S3 | Key validation | one tiny live `/embeddings` call before saving; 401/429/network errors mapped to actionable messages; mock-server tests for all negative paths + live-key tests |
| Q1 | Rate-limit resilience | replace process-wide `_apiFailed` latch with per-batch fallback + 429 backoff; a 429 storm degrades one batch, not the run |
| H1 | Honesty docs | EMBEDDINGS.md + README state exactly what no-key mode gives (local word vectors, declared weaker), that vectors are model-labeled and never mixed, and that adding a model later requires `bb index --force` |
| X1 | Gate | closure gate: planted mutants + full suite in `npm run verify` |

## Live-key test protocol (S3)

Two free-tier provider keys are used **only** for verification. They are stored in
`.env.local` (gitignored, mode 0600) and are never committed, logged, or written into
evidence. Evidence records a key fingerprint (last 4 characters) only.

- Live tests run only when `BB_M30_LIVE_KEYS=1` and the provider key env vars are set;
  otherwise S3 evidence records those cases as `blocked` with reason, never silently
  skipped.
- Live call budget per verifier run is capped (single validation embed per provider);
  free-tier rate limits are respected with explicit backoff between providers.
- A verifier check fails if any raw key pattern (`sk-or-v1-…`, `nvapi-…`) appears in
  any tracked file.

## Authority order

1. Executable implementation and CLI behavior
2. Versioned machine-readable evidence and the verifier that produced it
3. This master plan
4. Per-feature documentation (EMBEDDINGS.md, README sections)
5. GitHub issue text and human summaries

A lower authority cannot upgrade a higher-authority failure. Documentation may explain
a limitation but cannot turn a failed or missing behavioral check into `verified`.

## Ledger states

- `planned`: no executable evidence yet; never a release claim.
- `verified`: a real check passed on the current commit with a persisted evidence file,
  positive AND negative check counts, current commit, and evidence file recorded.
- `known-gap`: a real check or required environment failed; the limitation remains open.
- `blocked`: required environment (e.g. live keys absent) was unavailable, with reason
  recorded — never silently skipped.

## Protocol (every issue)

1. Verifier first — script under `script/m30/` that CAN FAIL; no auto-pass.
2. Evidence file `validation/m30/results/<CODE>.json`: currentCommit,
   sourceFingerprint, verifierCommand, evidenceFile, generatedAt, passed, failed,
   negativeCases, limitations — machine-emitted, never hand-edited.
3. Non-TTY behavior is a first-class negative test: piped stdin / CI must never hang;
   `--no-setup` must be honored.
4. Missing live keys = `blocked` with reason recorded on the affected S3 cases.
5. Closure comment quotes real run output + evidence path.
6. Ledger: `validation/m30/results/manifest.json`; only closed issues require clean
   evidence.

## Issue order

G1 first (governance prerequisite, M20 #428 pattern). S1 and S2 may proceed in
parallel after G1. S3 requires S1 (it validates what S1 saves). Q1 is independent and
may proceed any time after G1. H1 requires S1+S3 behavior to be final. X1 closes last;
nothing closes without it.

## Completion bar

1. A first-time user running `bb index` in a terminal is guided to a working embedding
   config (or makes an informed skip) without reading any docs.
2. A 429 storm during indexing degrades at most the affected batches, never the whole
   embedding drain.
3. All M30 gates are permanent parts of `npm run verify`.
4. EMBEDDINGS.md and README carry the honesty statements and pass the docs-truth check.
