// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the curated reference text for bb_annotate (returns, errors, limitations, performance, safety, evidence).
// WHICH TOOL IT SERVES — bb_annotate (rendered into docs/tools/bb_annotate.md and docs/data/public-tools.json).
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_annotate.md, docs/data/public-tools.json, website/src/data/tools.generated.ts.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_annotate/descriptor.ts, src/mcp/tools/bb_annotate/handler.ts, and script/verify-tool-docs.ts (generator).
// CONTRACTS IT MUST NOT BREAK — declared bounds, declared absence, freshness flags,
//   read/write boundary, and the no-regex policy (validation/tools/regex-allowlist.json).
// ─────────────────────────────────────────────────────────────────────────────

import type { CuratedToolDocumentation } from "../types"

export const curation: CuratedToolDocumentation = {
    returns: [
      "Stored annotation row with its enforced provenance (author class `agent`, never spoofable) and the calling tool identity, recorded verbatim",
      "`surfacing` — whether an editor surface can actually show this note, MEASURED against the index rather than promised: `editor` (bool, the AND of `nameMatched` and `pathMatched` — the editor needs BOTH), `nameMatched`, `pathMatched`, `matchedAs` (`name` and/or `qualifiedName`), `matchedNames`, and a `statement` saying what is and is not true. The name matching is necessary but not sufficient: a note on a symbol the index holds, written against a path it has never seen, can never be selected by a file-scoped hover, and is reported `editor: false` with the reason. This replaced a `surfaces` field that claimed the note \"renders in the editor hover section and graph badge\" for every note; measured on a real corpus, 100% of notes written under a symbol's qualified name matched no symbol name at all, so that claim was false exactly where it sounded most confident",
      "The path handling: `surfacing.pathNote` when a path was resolved to the index's own spelling, `surfacing.pathWarning` when no indexed file matches the given path (stored under that spelling, no editor surface will scope it to a file), and a name-level note statement when no path was given",
    ],
    // Honesty: this tool does NOT require the symbol to exist in the index. It is
    // a free-form note store — an agent may annotate before a symbol is indexed, or
    // a name the analyzer did not classify — so `unknown symbol` is a declared
    // ACCEPTANCE with `surfacing.editor: false`, not a refusal. The previous claim
    // ("Missing or unknown symbol") was a doc-truth lie: the handler only ever
    // refused a blank symbol, and a symbol absent from brain_symbol stored with
    // stored:true.
    errors: [
      "Missing or blank symbol",
      "Empty body (a refusal, not a silent no-op)",
      "Body exceeds the declared 2000-char limit, counted in characters (an astral glyph is one character, not two UTF-16 units)",
      "toolIdentity exceeds the declared 200-char limit — refused, never truncated",
      "toolIdentity containing a control character or line break — a label is a name, not a document. Refused, because a newline in that field rendered (measured, through the real renderer) as a SECOND provenance line that could claim to be a human note",
    ],
    limitations: [
      "Annotations are opinions layered on index evidence, never index truth",
      "Annotation store semantics are owned by the M28 workstream",
      "Any symbol name is accepted. Reachability is reported, not enforced: a name no indexed symbol carries is stored and declared `surfacing.editor: false`",
      "The note is keyed on the name as given. A name that matches several indexed symbols (a name is one symbol per file/line — `force` in 8 files of a real corpus) is one note shown wherever that name appears, unless `path` scopes it to a file",
      "`path` is resolved to the index's own spelling (`brain_file.relative_path`), so `src/a.ts`, `./src/a.ts` and the absolute path are the SAME note. A path matching no indexed file is stored verbatim and declared",
      "`toolIdentity` is the caller's own label. It is recorded verbatim and never verified — `author_class` is the enforced field",
      "The editor renderer escapes EVERY interpolated field, not only the body: `author_class`, `tool_identity` and `body` all go through the escaper, and a line break in any of them is flattened to a space. Markup escaping alone is not enough — a newline is what turns one annotation into two in a markdown list, which is how a caller's own label once forged a line reading 'human note by the-review-team'. So a row that already carries such a value — written before the guard, or by any other writer — still renders as exactly one line",
      "One note is kept per location, so a second agent annotating the same symbol+path REPLACES the first note. The replacement is reported in `replaced` with the previous body, but the previous note does not survive in the store. Annotating a DIFFERENT path (or no path) keeps a separate note per location",
    ],
    performance: "Constant-time store write bounded by the 2000-char body limit. `surfacing` adds two indexed lookups (name, qualified name) plus one file-row lookup for the path.",
    safety: "Write-capable against the annotation store only. It never modifies source files.",
    evidence: "Annotations carry provenance (toolIdentity, time) and are stored in brain_annotation. `author_class` is constrained to {agent, human} by a storage-level trigger, so a row cannot carry a third claim that every reader would then render verbatim.",
}

/** Cross-reference rendered into the `Relationship to other tools` section. */
export const relation: string = "To change source code use `bb_edit`; this tool stores provenance-enforced notes on symbols."
