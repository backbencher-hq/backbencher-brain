// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the curated reference text for bb_ask: returns, errors,
//   limitations, performance, safety and evidence semantics that the generated page
//   and the website tool data render.
// WHICH TOOL IT SERVES — bb_ask (rendered into docs/tools/bb_ask.md and
//   docs/data/public-tools.json).
// WHY IT IS SHAPED THIS WAY — each sentence states a measured behaviour that a gate
//   can contradict: the route list matches quick-answer.ts, the page-size rule matches
//   the door's refusal, and the safety line states the ask-time provider transmission
//   instead of claiming everything is local.
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_ask.md, docs/BB_ASK.md,
//   validation/tools/bb_ask/**, validation/m18/results/Q3.json.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_ask/{descriptor,handler}.ts,
//   src/intelligence/search/quick-answer.ts, docs/BB_ASK.md, and
//   npx tsx script/verify-tool-docs.ts --only bb_ask --write.
// CONTRACTS IT MUST NOT BREAK — no mode or bound the code does not honour; no claim of
//   similarity where none was computed; no claim of read-local behaviour when the
//   configured provider receives the question.
// ─────────────────────────────────────────────────────────────────────────────

import type { CuratedToolDocumentation } from "../types"

export const curation: CuratedToolDocumentation = {
    returns: [
      "Exact aggregates over the indexed snapshot — symbol counts by kind (functions count both `function`- and `method`-kind symbols), relationships, imports, files (optionally by language), the largest file and the most complex function — each answer carrying the index snapshot's timestamp",
      "An exact symbol-name lookup when the query is a symbol name, with its neighbours listed and explicitly labelled as neighbours rather than better matches",
      "Ranked semantic matches with real cosine similarities when stored embeddings allow it, each answer naming the compared model, the symbols comparable in that model space, the library-wide coverage, the scan bounds, and per-source `[STALE — file changed since index]` / `[MISSING — file no longer on disk]` markers",
      "Lexical matches when embeddings are unavailable or nothing clears the similarity floor — with NO similarity number printed, because none was computed, and the fallback reason named",
      "Declared bounds on every answer: `returned`, `totalMatches` (or an explicit unknown), `truncated` and `truncationReason`; plus a confidence kind: exact aggregate, exact name lookup, mean of returned similarities (bounded 0.2–0.85), declared floor, or none when the ranking is declared non-discriminative",
    ],
    errors: [
      "Empty or whitespace-only query",
      "`limit` outside 1..100 (0 included) — refused rather than clamped, because a clamped page looks like the page the caller asked for",
      "Unknown option, or a mode that exists only in `plannedModes` (`explain`, `feature`)",
      "No index for the project, or an index that cannot be read — answered as a declared unknown with zero sources, never a fabricated count",
    ],
    limitations: [
      "Semantic similarity discovers candidates; it does not prove behaviour, ownership or architecture, and the answer says so",
      "Local word vectors are a 205-word programming vocabulary plus the project's own vocabulary hashed into 50 dimensions. Their cosines are not comparable with a model embedding's, and an identifier-shaped query whose tokens are all absent produces a zero vector, reported as `reason=degenerate-query-vector`",
      "Coverage is per comparison space. On a mixed-model index the symbols comparable in the query model's space can be far fewer than the library-wide number; both numbers are reported and labelled",
      "When the configured embedding provider does not answer within the tool's wait ceiling (2 s, or `BB_EMBEDDING_TIMEOUT_MS` when lower) the question is embedded with the local word-vector model, the answer declares the timeout, and the ranking is limited to that model's space",
      "A verified aggregate is exact about the indexed snapshot, not the working tree: files changed after the last index write are not reflected, and the answer reports the snapshot time so the reader can judge the gap",
      "The dense candidate scan is capped at `BB_VECTOR_SCAN_CAP` rows (default 20,000). When the cap is reached the answer declares `truncated=true`, and the candidates are a deterministic prefix of the embedding table ordered by entity id",
      "A non-discriminative ranking (several candidates within the 0.05 margin of the best) publishes no numeric confidence: the answer says the scores do not separate candidates instead of printing a number it calls unreliable",
    ],
    performance:
      "Warm default-argument latency on the 3.6 GB reference index (6,452 files / 310,423 symbols) is p50 ≈ 1.8 s and p95 ≈ 2.1 s with the configured embedding provider; the first call in a cold process takes 9–10 s because the scan loads up to 20,000 vectors (≈164 MB at 2048 dimensions). The exact symbol-name route with `limit: 1` skips the dense scan and answers in milliseconds. The page size bounds both the payload and the work budget, and the candidate scan cap bounds memory independently of index size.",
    safety:
      "Read-only. Every index open is byte-read-only: the tool does not create a database, run migrations, heal indexes or promote embeddings, and it never writes source or rebuilds embeddings behind the caller's back. When embeddings are configured, the natural-language question itself is sent to that embedding provider to compute the query vector; with local word vectors the whole call stays offline.",
    evidence:
      "Treat matched symbols and resolvable source locations as evidence; treat similarity scores as candidate ranking, not proof. A non-discriminative ranking is not evidence and is labelled as such. A verified aggregate is a fact about the indexed snapshot, with that snapshot's timestamp reported.",
}

/** Cross-reference rendered into the `Relationship to other tools` section. */
export const relation: string = "For exact symbol/content/file retrieval use `bb_search`; this tool answers natural-language questions with citations."
