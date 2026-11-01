// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the executable descriptor for bb_index: name, description, input schema, modes, defaults and examples.
// WHICH TOOL IT SERVES — bb_index (this file is the contract authority for the tool's schema and documentation).
// WHERE ITS EVIDENCE LIVES — docs/data/public-tools.json, docs/tools/bb_index.md, validation/tools/bb_index/**.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_index/handler.ts, script/tool-docs/curation/bb_index.ts, and docs/tools/bb_index.md (generated).
// CONTRACTS IT MUST NOT BREAK — declared bounds, declared absence, freshness flags,
//   read/write boundary, and the no-regex policy (validation/tools/regex-allowlist.json).
// ─────────────────────────────────────────────────────────────────────────────

import type { ToolDescriptor } from "../types"

export const descriptor: ToolDescriptor = {
    // M22.E1: agent-driven freshness — an agent that just wrote/edited a file
    // can immediately make it (and only it) visible instead of waiting for a
    // full reindex. This is the direct fix for "agent created a function,
    // seconds later it's not in the DB".
    name: "bb_index",
    description: "Reindex a file or directory so the index reflects edits immediately (agent-fresh). Accepts a path (file or dir); a file reindexes only that file, a dir runs an incremental index of that dir (changed files only). mode=post re-runs the heavy derived-data phases (relationships/enrichment/gravity/taints/health) WITHOUT re-parsing — the remediation after edits on incremental paths. The path MUST be inside this project: an absolute path elsewhere, a `../` traversal and a foreign directory are all REFUSED, because an out-of-tree file would be stored with a `relative_path` that is not relative to anything and every scoped query, file name and freshness check for it would then be wrong. The report says what happened rather than only how much: `outcome` is `indexed`, `partial`, `no-op` or `indexed`, and a `no-op` carries a `reason` distinguishing \"nothing changed\" from \"this file holds nothing the indexer extracts\"; when errors occurred, `errorDetail` names the file and the message beside the `errors` count. Paths in the report are PROJECT-RELATIVE, so the same request returns the same bytes on any machine. The counts are stable between identical calls; the `ms` fields are measured wall-clock and are expected to vary.",
    inputSchema: { type: "object", properties: { path: { type: "string", description: "Project-relative file (reindex only that file) or directory (incremental index of changed files); for mode=post, the project whose derived phases should be re-run. REQUIRED in every mode, and for mode=post it is checked rather than ignored. Must resolve INSIDE the project: both sides are resolved through realpath, so a symlink inside the project pointing out of it is refused too." }, mode: { type: "string", enum: ["auto", "file", "dir", "post"], description: "auto (default) infers file vs dir from path; file reindexes one file; dir runs an incremental directory index; post re-runs derived phases (relationships/taints/health) without re-parsing" } }, required: ["path"] },
    mutability: "write",
    requiresIndex: false,
    modes: ["auto", "file", "dir", "post"],
    aliases: [],
    deprecated: false,
    documentation: { category: "operations", summary: "Immediately refresh the index for a just-written/edited file or directory; mode=post re-derives relationships/taints/health without re-parsing.", defaults: { mode: "auto" }, examples: [{ path: "src/new-file.ts" }, { path: "src", mode: "dir" }, { path: "post", mode: "post" }] },
}
