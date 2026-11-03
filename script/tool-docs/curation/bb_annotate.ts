// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the curated reference text for bb_annotate (returns, errors, limitations, performance, safety, evidence), rendered into the generated page.
// WHICH TOOL IT SERVES — bb_annotate (mutability write, requiresIndex false, modes: annotate).
// WHY IT IS SHAPED THIS WAY — every claim here is a MEASURED behaviour: the reachability
//   rule is the joint name+file predicate the hover and graph badge apply, the bounds are
//   the handler's enforced limits, and the performance figures come from the recorded
//   latency run rather than an adjective. A curated page that promises more than the
//   handler honours is worse than no page.
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_annotate.md (generated), docs/tools/bb_annotations.md,
//   validation/tools/bb_annotate/{AUDIT,PHASE-A-PROBES,LATENCY,REAL-CORPUS}.json; gates:
//   npx tsx script/m28/verify-annotation-store.ts, npx tsx script/verify-tool-docs.ts --only bb_annotate.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_annotate/descriptor.ts,
//   src/mcp/tools/bb_annotate/handler.ts, and docs/tools/bb_annotate.md.
// CONTRACTS IT MUST NOT BREAK — no claim outside the measured behaviour; declared bounds
//   and refusals must equal the handler's; regex policy (this file contains no regex).
// ─────────────────────────────────────────────────────────────────────────────

import type { CuratedToolDocumentation } from "../types"

export const curation: CuratedToolDocumentation = {
  returns: [
    "The stored annotation row with its enforced provenance (`author_class` is always `agent` for tool writes) and the caller's self-declared `toolIdentity`, recorded verbatim with `time_created`/`time_updated`",
    "`replaced` — present only when this location already held a different note: the previous author class, tool identity, body and timestamps, so the second writer can merge instead of clobbering. The previous note does not survive in the store",
    "`surfacing` — a MEASUREMENT against the index, not a promise: `editor` (bool, the JOINT truth — the name or qualified name must be indexed AND declared in the resolved file), `nameMatched`, `pathMatched`, `fileMatched` (`true`/`false` when a path was given, `null` for a name-level note), `matchedAs` (`name` and/or `qualifiedName`), `matchedNames`, and a `statement` saying what is and is not true. A name that is indexed only in a DIFFERENT file than the one the path resolves to is reported `editor: false` with that reason — the hover and graph badge select notes by the file under the cursor, so those two individually-true halves would render nowhere",
    "The path handling: `surfacing.pathNote` when a path was resolved to the index's own spelling, `surfacing.pathWarning` when no indexed file matches the given path (stored under that spelling, no editor surface will scope it to a file), and a name-level note statement when no path was given",
  ],
  errors: [
    "Missing or blank symbol",
    "Symbol longer than the declared 500-char limit — refused, never truncated",
    "Empty or whitespace-only body (a refusal, not a silent no-op)",
    "Body longer than the declared 2000-char limit, counted in characters (an astral glyph is one character, not two UTF-16 units)",
    "Path longer than the declared 1024-char limit — refused, never truncated",
    "toolIdentity longer than the declared 200-char limit — refused, never truncated",
    "toolIdentity containing a control character or line break — a label is a name, not a document. Refused, because a line break in that field is exactly what once rendered as a SECOND provenance line that could claim to be a human note",
    "Unknown options (including `author_class`/`authorClass`) are rejected by name with the accepted option list — provenance is not a caller input",
  ],
  limitations: [
    "Annotations are opinions layered on index evidence, never index truth",
    "Any symbol name is accepted. Reachability is reported, not enforced: a name no indexed symbol carries is stored and declared `surfacing.editor: false`",
    "The note is keyed on the name as given. A name that matches several indexed symbols is one name-level note shown wherever that name appears, unless `path` scopes it to a file",
    "`surfacing.editor` is the joint rule the editors apply: the symbol must be declared in the file the path resolves to (or the note must be name-level). A name match plus a path match for a different file is reported `editor: false`",
    "`path` is resolved to the index's own spelling (`brain_file.relative_path`), so `src/a.ts`, `./src/a.ts` and the absolute path are the SAME note. A path matching no indexed file is stored verbatim and declared",
    "`toolIdentity` is the caller's own label. It is recorded verbatim and never verified — `author_class` is the enforced field",
    "The editor renderer escapes EVERY interpolated field, not only the body: `author_class`, `tool_identity` and `body` all go through the escaper, and a line break in any of them is flattened to a space, so one stored row always renders as one line. Markup escaping alone is not enough — a newline is what turns one annotation into two in a markdown list",
    "One note is kept per author per location, so a second agent annotating the same symbol+path REPLACES the first note. The replacement is reported in `replaced` with the previous body, but the previous note does not survive in the store. Annotating a DIFFERENT path (or no path) keeps a separate note per location",
    "On a project that has never been indexed, the first write creates that project's annotation store; the reply still reports `surfacing.editor: false` because no symbol can be matched yet",
    "This tool does not report per-file index staleness and does not auto-refresh: output reflects the index as of the last index run",
  ],
  performance:
    "Measured through the real MCP stdio door on isolated indexes, five warm runs per tier (validation/tools/bb_annotate/LATENCY.json): p50 83.4 / p95 96.1 ms on the 5-file polyglot fixture; p50 5.8 / p95 12.1 ms on the 97-file n100 fixture; p50 5.7 / p95 17.9 ms on the 564-file graphql-js corpus; p50 3.5 / p95 5.1 ms on the 109-file rake corpus; p50 3.8 / p95 5.8 ms on the 6,452-file / 310,423-symbol reference index. The first call in a fresh server process opens the project index read-write and runs its additive migrations, measured at 1.8 s on the reference-index snapshot. The write itself is three indexed lookups (name, qualified name, file row) plus the location upsert.",
  safety:
    "Write-capable against the annotation store only. It never modifies source files. It opens the project index read-write the way every write door does, so the additive schema migrations may apply on the first call; index content outside brain_annotation is not written.",
  evidence:
    "Provenance is enforced three ways: the write hardcodes 'agent', the column is NOT NULL, and a storage trigger constrains `author_class` to {agent, human} — so a row cannot carry a third claim that every reader would render verbatim. `toolIdentity` and timestamps are recorded, and the toolIdentity claim is a label, not evidence. Reachability is measured against the same predicates the readers use: `brain_symbol.name`/`qualified_name` for the name, `brain_file.relative_path` for the file.",
}

/** Cross-reference rendered into the `Relationship to other tools` section. */
export const relation: string = "To change source code use `bb_edit`; this tool stores provenance-enforced notes on symbols. Read them back with `bb_annotations`."
