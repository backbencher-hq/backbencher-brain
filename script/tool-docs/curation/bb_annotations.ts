// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the curated reference text for bb_annotations (returns, errors, limitations, performance, safety, evidence).
// WHICH TOOL IT SERVES — bb_annotations (rendered into docs/tools/bb_annotations.md and docs/data/public-tools.json).
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_annotations.md, docs/data/public-tools.json, website/src/data/tools.generated.ts.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_annotations/descriptor.ts, src/mcp/tools/bb_annotations/handler.ts, and script/verify-tool-docs.ts (generator).
// CONTRACTS IT MUST NOT BREAK — declared bounds, declared absence, freshness flags,
//   read/write boundary, and the no-regex policy (validation/tools/regex-allowlist.json).
// ─────────────────────────────────────────────────────────────────────────────

import type { CuratedToolDocumentation } from "../types"

export const curation: CuratedToolDocumentation = {
    returns: [
      "Typed annotations for a symbol or the whole project, with full provenance on every row (author class, tool identity, timestamps)",
      "`count` (the page size), `totalCountIfKnown` (the true number of matching annotations) and `truncated` with a `truncationReason` naming the fix — a bounded read declares its bound, like bb_search and bb_graph. This door used to return only `count`, so a project with 300 notes and the default limit answered a flat `count: 50` with no way to know 250 more existed",
      "Declared-absent result when none exist — absence is never an error",
    ],
    errors: ["limit outside the declared 1-200 range"],
    limitations: [
      "Reads only stored annotations; absence is declared, not inferred",
      "Annotation store semantics are owned by the M28 workstream",
      "Without `path`, a symbol that lives in several files returns every file's notes together; pass `path` (or read each row's symbol_path) to separate them",
      "A `symbol` filter also matches notes written under a symbol's QUALIFIED name, because that is one of the two name forms the editor accepts. This is the same predicate `surfacing` reports, so a reader and the editor always agree on which notes exist",
      "`path` is resolved to the index's own spelling before filtering, so a reader passing `./src/a.ts` finds the note a writer stored as `src/a.ts`",
      "A `path` filter WITHOUT a `symbol` returns that file's own notes only. It used to also return every NAME-LEVEL note in the project, because a name-level note does apply wherever its name appears — but that made a narrow question answer mostly-global: measured on a real corpus, a path read returned 2 notes for the file and 48 name-level notes from the whole project, and the file's own notes were nearly cut off by the default limit. Pass `includeNameLevel: true` for the broader set. With a `symbol` AND a `path`, name-level notes about THAT symbol are still included, because they are about the symbol you asked for",
    ],
    performance: "Indexed lookup by project and symbol (brain_annotation_project_symbol_idx). The declared total is a second COUNT over the same predicate, so `totalCountIfKnown` costs one indexed count.",
    safety: "Read-only. It does not modify source files, index data, or annotations.",
    evidence: "Rows come from brain_annotation with provenance fields preserved.",
}

/** Cross-reference rendered into the `Relationship to other tools` section. */
export const relation: string = "To write a note use `bb_annotate`; this tool reads stored annotations and declares absence."
