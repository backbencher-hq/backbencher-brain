// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the curated reference text for bb_annotations (returns,
// errors, limitations, performance, safety, evidence).
// WHICH TOOL IT SERVES — bb_annotations (rendered into docs/tools/bb_annotations.md
//   and docs/data/public-tools.json).
// WHY IT IS SHAPED THIS WAY — the curated text may only state what the handler is
//   measured to do: a read writes nothing, both name forms match, a path filter is
//   scoped to the file unless widened, and the declared bound carries a true
//   total. Where a claim has a boundary (the path shapes scan the project's
//   annotation rows; the registry's mode vocabulary has one nominal name) the
//   boundary is written down rather than left implicit.
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_annotations.md, docs/data/
//   public-tools.json, website/src/data/tools.generated.ts,
//   validation/tools/bb_annotations/** (audit, contract matrix, real corpus,
//   latency, query plans); gates: npx tsx script/verify-tool-docs.ts --only
//   bb_annotations, npx tsx script/verify-tool-page-claims.ts,
//   npx tsx validation/tools/bb_annotations/verify-read-door.ts.
// EDIT TOGETHER WHEN THIS FILE CHANGES — descriptor.ts, handler.ts, the generated
//   page, and the read-door gate.
// CONTRACTS IT MUST NOT BREAK — declared bounds, declared absence, the read/write
//   boundary, and the no-regex policy (validation/tools/regex-allowlist.json).
// ─────────────────────────────────────────────────────────────────────────────

import type { CuratedToolDocumentation } from "../types"

export const curation: CuratedToolDocumentation = {
  returns: [
    "Typed annotations for a symbol, a file, or the whole project, with full provenance on every row (author class, tool identity, timestamps)",
    "`count` (the page size), `totalCountIfKnown` (the true number of matching annotations) and `truncated` with a `truncationReason` naming an action the caller can take — at the declared cap the reason asks for a narrower filter instead of a limit raise it cannot honour",
    "`includeNameLevel` echoes the accepted flag and `nameLevelIncluded` states the filter actually applied (a symbol request always includes name-level notes about that symbol)",
    "`symbolIndexed` says whether the requested spelling named an indexed symbol; a spelling the index does not publish falls back to the literal stored name, so a note written under an arbitrary name is still findable",
    "`storeAbsent` is true when the project has no annotation store yet: the answer is a declared absence and the read created nothing",
    "Declared-absent result when none exist — absence is never an error",
  ],
  errors: [
    "limit outside the declared 1-200 range (0, negative, above 200, fractional, or not a number) is refused with the rule named",
    "an option the tool does not accept is refused with the accepted option set named, and a conflicting alias/canonical pair is refused rather than silently resolved",
  ],
  limitations: [
    "Reads only stored annotations, and does not create, migrate or repair the store while reading; absence is declared, not inferred",
    "Without `path`, a symbol that lives in several files returns every file's notes together; pass `path` (or read each row's `symbol_path`) to separate them",
    "A `symbol` resolves to the simple name AND the qualified name of every symbol it names, the same pair the editor hover matches, so a note written under either form is found from either spelling. This is the editor's predicate, not a prose promise",
    "A `path` is resolved to the index's own spelling before filtering, so a reader passing `./src/a.ts` finds the note a writer stored as `src/a.ts`; a path the index does not know is used as given",
    "A `path` filter WITHOUT a `symbol` returns that file's own notes only and excludes the project's name-level notes by default; pass `includeNameLevel: true` for the broader set. With a `symbol` AND a `path`, name-level notes about THAT symbol are always included",
    "The registry declares one nominal action name for the store (`annotate`); the tool takes no `mode` option — every call is a read and a request carrying `mode` is refused as an unknown option",
  ],
  performance:
    "A symbol read and its declared total are indexed lookups by project and symbol name (`brain_annotation_location_idx`; the earlier `brain_annotation_project_symbol_idx` is superseded by it). The project-wide shapes seek by project and then sort the matched rows (`ORDER BY time_updated DESC, id`), and a path-only read scans the project's annotation rows because the store has no index on `symbol_path` — the cost is proportional to the number of notes in the project, not to the number of files. On a 206-note fixture the path scan measures 0.14 ms and the project-wide page 0.34 ms.",
  safety:
    "Read-only, measured: the store is opened byte-read-only, so a read does not create a database for an unindexed project, does not recreate a missing annotation table in a legacy store, and does not move the write-ahead log. It does not modify source files, index data, or annotations.",
  evidence: "Rows come from brain_annotation with provenance fields preserved.",
}

/** Cross-reference rendered into the `Relationship to other tools` section. */
export const relation: string = "To write a note use `bb_annotate`; this tool reads stored annotations, declares absence, and opens the store without writing it."
