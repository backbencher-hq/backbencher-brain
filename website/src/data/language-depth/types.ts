// The per-language depth record — the shared type every language surface reads.
//
// WHY THIS EXISTS
// ---------------
// The website's language surfaces could only say four things about a language:
// its display name, its file extensions, its registry ids, and the one-line
// `extracts` string in brain-languages.ts. That is a directory listing wearing
// the costume of a reference page. A reader landing on "Elixir" learned the
// file extension and nothing about what bb actually does to their .ex files.
//
// This type is the missing layer. It is deliberately *editorial*, not
// factual: every registry-owned fact (extensions, ids, tier, what the analyzer
// records) already lives in brain-languages.ts and is rendered from there. This
// record only answers the question a reader actually arrives with —
//   "what does indexing this language buy me, and what does it not?"
//
// HONESTY RULES (this codebase treats invented capability as a defect)
// ------------------------------------------------------------------------
// 1. Every entry must be justifiable by reading the family's own analyzer:
//    `src/ast/real-<lang>-analyzer.ts` in this repo. Open it. If you cannot
//    see the claim in the analyzer, the claim does not go in the file.
// 2. **Every language has a dedicated analyzer.** All 48 `real-*-analyzer.ts`
//    modules are wired into `getAnalyzer`; `GenericAnalyzer` is its unreachable
//    `default:` branch. An earlier version of this file told authors that
//    TOML, Protobuf, Nim and Visual Basic had "NO dedicated analyzer" and that
//    their symbols "come from the generic traversal pass". That was false — it
//    came from a stale `tier` field on the website's own dataset — and it put
//    "no call graph is resolved" onto four pages that in fact resolve 5 to 8
//    relationship types each. The tier is gone. Read the analyzer.
// 3. A missing relationship type is a fact about the FORMAT, not about the
//    analyzer's quality. `calls` is absent for Markdown, TOML, JSON, YAML,
//    GraphQL, HCL and XML because those formats have no invocation syntax —
//    a heading cannot call anything. Write that as the limitation it is. Do
//    NOT write "the analyzer cannot resolve calls" for a language that has no
//    call syntax, and do not write it for one that does.
// 4. `agentAsks` are things an agent can RETRIEVE, not things bb can decide.
//    "Which functions call this one?" is an ask. "Does this code have a bug?"
//    is not — do not write it.
// 5. `limitations` must be specific to THAT family AND must be checkable. A
//    line that would read identically for every language is a wasted line; a
//    line you cannot point at a construct for is a decoration. The repo's own
//    bar (script/m14/ontology-coverage-gate.ts) is that a ruled-out capability
//    needs a corpus measurement proving the construct never occurs.
// 6. Never invent a benchmark, a latency number, an accuracy percentage, or a
//    language-support claim that is not already registry-owned. Where a
//    measured number exists in validation/**, name the artifact in a note to
//    the master agent rather than asserting it here.
// 7. `docs/M14-HONESTY-CONTRACT.md` §1 bans these words in anything you write:
//    perfect, complete, fully done, production-ready, bulletproof,
//    rock-solid, battle-tested, extensively tested, thoroughly reviewed,
//    should work, expected to pass, and unscoped "100% coverage". A claim is
//    scoped or it is false.

export type LanguageDepth = {
  /** One sentence, plain language: what indexing this family buys you. */
  headline: string
  /**
   * 3–4 concrete things an agent can retrieve here, phrased as the question a
   * developer would ask. Keep each under ~90 characters.
   */
  agentAsks: string[]
  /**
   * 2–3 real limitations — what is genuinely not resolved for this family,
   * named against a specific construct. These are the most valuable lines on
   * the page. Rendered under the heading "Limitations". Never pad them, never
   * soften them, and never blame the analyzer for something the format cannot
   * express.
   */
  limitations: string[]
  /**
   * A tiny snippet in this family's own syntax, small enough to read at a
   * glance. It must contain at least one symbol kind this family's analyzer
   * actually records (see `extracts` in brain-languages.ts).
   */
  sample: { caption: string; code: string }
  /**
   * 1–3 short notes on where this family actually lives in a real repository
   * (file layout, framework conventions). General, verifiable engineering
   * knowledge only — no claims about this project's behaviour.
   */
  whereItShowsUp: string[]
}
