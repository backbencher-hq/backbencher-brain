// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the executable descriptor for bb_index: name, description,
//   input schema, modes, defaults and examples. It is the contract authority for
//   the tool's schema and documentation.
// WHICH TOOL IT SERVES — bb_index (mutability write, requiresIndex false,
//   modes: auto, file, dir, post).
// WHY IT IS SHAPED THIS WAY — the description states the behaviours a caller has to
//   be able to rely on: the project-relative path policy for every mode, the answer
//   vocabulary (indexed / partial / no-op) with the two distinct no-op reasons, the
//   unchanged/declined counters, and the derived-data outcome. A schema field that
//   the handler does not honour would be a promise, so mode=post's `path` is
//   described as what it is checked for: the project root (or a directory inside it),
//   never a file, inside the project after realpath.
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_index.md (generated), docs/data/public-tools.json,
//   validation/tools/bb_index/**; gates: script/m40/verify-a1-post-entry.ts and
//   script/m40/verify-a3-write-parity.ts.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_index/handler.ts,
//   script/tool-docs/curation/bb_index.ts, docs/tools/bb_index.md (generated).
// CONTRACTS IT MUST NOT BREAK — every documented default is executed, every refusal
//   named here has a branch in the handler, declared bounds/absence stay honest, and
//   no new regex is introduced.
// ─────────────────────────────────────────────────────────────────────────────

import type { ToolDescriptor } from "../types"

export const descriptor: ToolDescriptor = {
    name: "bb_index",
    description: "Reindex a file or directory so the index reflects edits immediately (agent-fresh). Accepts a path (file or dir); a file reindexes only that file, a dir runs an incremental index of that dir (changed files only). mode=post re-runs the heavy derived-data phases (relationships/enrichment/gravity/taints/health) WITHOUT re-parsing — the remediation after edits on incremental paths. Every mode requires `path`, and it MUST resolve inside this project: an absolute path elsewhere, a `../` traversal, a foreign directory and a symlink inside the project pointing out of it are all REFUSED, because an out-of-tree file would be stored with a `relative_path` that is not relative to anything and every scoped query, file name and freshness check for it would then be wrong. For mode=post the path must additionally NOT be a file: the phases are project-wide, so pass the project root (or a directory inside it). The report says what happened rather than only how much: `outcome` is `indexed`, `partial` or `no-op`; a no-op carries a `reason` that distinguishes \"nothing changed: the file already matches the index (mtime, size and sha256 agree)\" from \"this file holds nothing the indexer extracts\", and `unchanged`/`declined`/`skipped` say how many files fell into each case. When errors occurred, `errorDetail` names the file and the message beside the `errors` count, and `walCheckpointed` says whether the write WAL was reclaimed after the run. Paths in the report are PROJECT-RELATIVE, so the same request returns the same bytes on any machine. The counts are stable between identical calls; the `ms` fields are measured wall-clock and are expected to vary.",
    inputSchema: {
        type: "object",
        properties: {
            path: {
                type: "string",
                description: "Project-relative file (reindex only that file) or directory (incremental index of changed files); for mode=post, the project root or a directory inside it whose derived phases should be re-run (a file path is refused). REQUIRED in every mode and checked rather than ignored. Must resolve INSIDE the project: both sides are resolved through realpath, so a symlink inside the project pointing out of it is refused too.",
            },
            mode: {
                type: "string",
                enum: ["auto", "file", "dir", "post"],
                description: "auto (default) infers file vs dir from path; file reindexes one file (unchanged files answer no-op instead of being re-parsed); dir runs an incremental directory index; post re-runs derived phases (relationships/taints/health) without re-parsing",
            },
        },
        required: ["path"],
    },
    mutability: "write",
    requiresIndex: false,
    modes: ["auto", "file", "dir", "post"],
    aliases: [],
    deprecated: false,
    documentation: {
        category: "operations",
        summary: "Immediately refresh the index for a just-written/edited file or directory; mode=post re-derives relationships/taints/health without re-parsing.",
        defaults: { mode: "auto" },
        examples: [{ path: "src/new-file.ts" }, { path: "src", mode: "dir" }, { path: ".", mode: "post" }],
    },
}
