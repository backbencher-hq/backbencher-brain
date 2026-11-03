// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the executable contract for bb_annotate: name, description, input schema, modes, defaults and examples.
// WHICH TOOL IT SERVES — bb_annotate (mutability write, requiresIndex false, modes: annotate).
// WHY IT IS SHAPED THIS WAY — the description states the enforced provenance, the
//   measured (joint) meaning of `surfacing.editor`, the in-place re-annotation model and
//   every declared bound, because a contract a caller has to infer from prose elsewhere
//   is a contract that drifts; the schema stays permissive (any symbol name) on purpose —
//   reachability is measured and reported, never enforced by rejection.
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_annotate.md (generated), docs/data/public-tools.json,
//   validation/tools/bb_annotate/** (AUDIT.json, PHASE-A-PROBES.json, LATENCY.json,
//   REAL-CORPUS.json); gates: npx tsx script/m28/verify-annotation-store.ts,
//   npx tsx script/verify-tool-docs.ts --only bb_annotate.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_annotate/handler.ts,
//   script/tool-docs/curation/bb_annotate.ts, docs/tools/bb_annotate.md, and
//   script/m28/verify-annotation-store.ts.
// CONTRACTS IT MUST NOT BREAK — declared defaults/refusals must equal handler behaviour;
//   author_class is never a caller input; no mode/default may be advertised that the
//   handler does not execute; regex policy (this file contains no regex).
// ─────────────────────────────────────────────────────────────────────────────

import type { ToolDescriptor } from "../types"

export const descriptor: ToolDescriptor = {
  name: "bb_annotate",
  description:
    "Attach an agent-authored annotation to a symbol in the shared index. Provenance is enforced: `author_class` is hardcoded 'agent' for tool writes (a tool call cannot write a 'human' note), and the row records the caller's self-declared `toolIdentity` plus timestamps. Re-annotating the same symbol+path updates the note in place and reports the note it replaced — one note per author per location is enforced by a unique index over (project, symbol, author, path). The symbol is not checked against the index; the reply MEASURES whether an editor surface can show the note and says so in `surfacing`. `editor` is the JOINT truth the hover and graph badge use: the name (or qualified name) must be indexed AND declared in the resolved file, so a name indexed only in another file is reported `editor: false` with the reason rather than promised. `path` resolves to the index's own spelling, so `src/a.ts`, `./src/a.ts` and the absolute path are the same note. Declared bounds: body 2000 chars, toolIdentity 200 chars, symbol 500 chars, path 1024 chars — refusals, never truncation. Annotations are opinions layered on evidence, never index facts. On a project with no index, the first write creates that project's annotation store and `surfacing.editor` is false. To change source code use bb_edit; to read notes back use bb_annotations.",
  inputSchema: {
    type: "object",
    properties: {
      symbol: { type: "string", description: "symbol name to annotate, max 500 chars (`target`/`query` are accepted as aliases); it is not required to exist in the index — reachability is measured and reported" },
      body: { type: "string", description: "annotation text, max 2000 chars counted in code points (an astral glyph is one character); empty or whitespace-only is refused" },
      path: { type: "string", description: "optional file path to scope the note to one file's copy of the symbol, max 1024 chars; resolved to the index's own spelling (`brain_file.relative_path`), so `src/a.ts`, `./src/a.ts` and the absolute path all reach the same note" },
      toolIdentity: { type: "string", description: "optional name of the calling agent/tool, max 200 chars (recorded verbatim; line breaks and control characters are refused)" },
    },
    required: ["symbol", "body"],
  },
  mutability: "write",
  requiresIndex: false,
  modes: ["annotate"],
  aliases: [],
  deprecated: false,
  documentation: {
    category: "annotations",
    summary: "Agent note with enforced provenance, stored where the human reads.",
    defaults: {},
    examples: [{ symbol: "handleRequest", body: "Legacy auth path — scheduled for removal in Q3." }],
  },
}
