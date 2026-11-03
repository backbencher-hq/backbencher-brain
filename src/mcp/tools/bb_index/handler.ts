// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the handler for bb_index: it validates the request, enforces
//   project containment, calls the incremental indexer with the requested scope, and
//   shapes an answer that says what happened (indexed / no-op / partial) and why.
// WHICH TOOL IT SERVES — bb_index (mutability write, requiresIndex false,
//   modes: auto, file, dir, post).
// WHY IT IS SHAPED THIS WAY — a reindex is a WRITE, so every answer must be
//   actionable and honest: counts of changed/unchanged/declined files, the failure
//   message per file, and a reason for a no-op that distinguishes "already current"
//   from "this file holds nothing the indexer extracts". The path policy is enforced
//   on both sides through realpath, because a row keyed by an out-of-tree path is
//   invisible to every scoped query while still counted, and mode=post is checked
//   with the same rule instead of only testing existence.
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_index.md, validation/tools/bb_index/**,
//   gates: script/m40/verify-a1-post-entry.ts, script/m40/verify-a3-write-parity.ts,
//   script/m43/verify-p1-index-lock.ts, script/m22/verify-e1-mcp.ts,
//   script/m43/verify-a1-mcp-auto-refresh.ts, script/m28/verify-index-portability.ts.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_index/descriptor.ts,
//   script/tool-docs/curation/bb_index.ts, docs/tools/bb_index.md (generated), and
//   the gate scripts named above.
// CONTRACTS IT MUST NOT BREAK — project-relative path policy (refuse out-of-tree and
//   symlink-escape paths), declared outcome vocabulary, no-op reason honesty, the
//   index lock's declared refusal (never a crash), and the no-regex policy.
// ─────────────────────────────────────────────────────────────────────────────

import type { ToolHandler } from "../shared"
import { textResult } from "../shared"
import { existsSync, realpathSync, statSync } from "node:fs"
import path from "node:path"
import { reindexFilesParallel } from "../../../ast/parallel-indexer"

const MODES = ["auto", "file", "dir", "post"] as const

/** Is the resolved path the project root itself or a descendant of it? */
function isInsideProject(projectPath: string, absolutePath: string): boolean {
    const rootReal = realpathSync(projectPath)
    const absReal = realpathSync(absolutePath)
    const rel = path.relative(rootReal, absReal)
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))
}

function outsideRefusal(raw: string, absolutePath: string, projectPath: string, where: string): string {
    const rootReal = realpathSync(projectPath)
    const absReal = realpathSync(absolutePath)
    return (
        `bb_index ${where}: refusing a path outside the project. "${raw}" resolves to ${absReal}, which is not inside ${rootReal}. ` +
        `bb_index indexes THIS project's files; an out-of-tree path would be stored with a "project-relative" path that is not relative to anything, and every scoped query, file name and freshness check in the index would then be wrong for it.`
    )
}

/** Shape the file-mode answer so "nothing happened" is never ambiguous. */
function fileOutcome(r: Awaited<ReturnType<typeof reindexFilesParallel>>): { outcome: string; reason?: string } {
    if (r.indexed > 0 || r.deleted > 0 || r.errors > 0) return { outcome: r.errors > 0 ? "partial" : "indexed" }
    if (r.unchanged > 0) {
        return { outcome: "no-op", reason: `nothing changed: ${r.unchanged} file(s) already match the index (mtime, size and sha256 agree)` }
    }
    if (r.declined > 0) {
        return { outcome: "no-op", reason: `${r.declined} file(s) hold nothing the indexer extracts (the extension is not one this indexer parses)` }
    }
    if (r.skipped > 0) {
        return { outcome: "no-op", reason: r.skippedReason ?? `${r.skipped} file(s) hold nothing the indexer extracts` }
    }
    return { outcome: "no-op", reason: "nothing changed: the file's content already matches the index" }
}

export const handler: ToolHandler = async (args, { projectId, projectPath }) => {
    const raw = String(args.path ?? "")
    if (!raw) return textResult("bb_index requires path", true)
    const mode = String(args.mode ?? "auto")
    if (!(MODES as readonly string[]).includes(mode)) {
        return textResult(`bb_index: unknown mode: ${mode} (expected ${MODES.join("|")})`, true)
    }

    // mode=post re-runs the heavy derived-data phases (relationships, enrichment,
    // gravity, taints, health) WITHOUT re-parsing. `path` is required by the schema,
    // so it is honoured rather than ignored: it must name this project (or a
    // directory inside it), resolve inside the project, and not be a file — the
    // phases are project-wide, and a file path would be a request the tool cannot
    // answer as spelled.
    if (mode === "post") {
        const postAbs = path.isAbsolute(raw) ? raw : path.resolve(projectPath, raw)
        if (!existsSync(postAbs)) {
            return textResult(
                `bb_index mode=post: no such path: ${postAbs} — mode=post re-derives the phases of THIS project, and the required \`path\` must name it (pass the project root or ".").`,
                true,
            )
        }
        if (!isInsideProject(projectPath, postAbs)) return textResult(outsideRefusal(raw, postAbs, projectPath, "mode=post"), true)
        if (statSync(postAbs).isFile()) {
            return textResult(
                `bb_index mode=post: ${postAbs} is a file — mode=post re-derives the phases of the PROJECT, so \`path\` must be the project root or a directory inside it (pass the project path or ".").`,
                true,
            )
        }
        const { runPostProcessing } = await import("../../../ast/parallel-indexer")
        try {
            const post = await runPostProcessing(projectId as any, { logger: { log: () => {}, write: () => {} } })
            return textResult(JSON.stringify({ mode: "post", path: raw, phases: post.phases, totalMs: post.totalMs, integrityHealth: post.integrityHealth }, null, 2))
        } catch (e: any) {
            return textResult(`bb_index mode=post failed: ${e?.message}`, true)
        }
    }

    const abs = path.isAbsolute(raw) ? raw : path.resolve(projectPath, raw)
    if (!existsSync(abs)) return textResult(`bb_index: no such path: ${abs}`, true)
    if (!isInsideProject(projectPath, abs)) return textResult(outsideRefusal(raw, abs, projectPath, ""), true)

    const isDir = statSync(abs).isDirectory()
    const effective = mode === "auto" ? (isDir ? "dir" : "file") : mode
    if (effective === "file" && isDir) return textResult("bb_index mode=file requires a file path", true)
    if (effective === "dir" && !isDir) return textResult("bb_index mode=dir requires a directory path", true)

    if (effective === "file") {
        try {
            const r = await reindexFilesParallel(projectId as any, projectPath, [{ path: abs, type: "modified" }])
            const { outcome, reason } = fileOutcome(r)
            return textResult(
                JSON.stringify(
                    {
                        mode: "file",
                        path: raw,
                        indexed: r.indexed,
                        deleted: r.deleted,
                        errors: r.errors,
                        unchanged: r.unchanged,
                        declined: r.declined,
                        skipped: r.skipped,
                        ...(r.errors > 0 ? { errorDetail: r.errorDetail ?? [] } : {}),
                        outcome,
                        ...(reason ? { reason } : {}),
                        walCheckpointed: r.walCheckpointed,
                        derived: r.derived ?? { pass: "deferred", phases: [], repairedInEdges: 0, touchedSymbols: 0 },
                    },
                    null,
                    2,
                ),
            )
        } catch (e: any) {
            // Another LIVE indexer holds the project lock: a declared refusal, never
            // a thrown handler crash.
            return textResult(`bb_index mode=file refused: ${e?.message}`, true)
        }
    }

    // Dir mode detects changes under the requested directory but reindexes from the
    // PROJECT ROOT — stored file keys are root-relative and never move, so a subdir
    // index can never re-key rows.
    try {
        const { collectDirChanges } = await import("../../../ast/parallel-indexer")
        const changes = await collectDirChanges(projectId as any, projectPath, abs)
        if (changes.length === 0) {
            return textResult(
                JSON.stringify(
                    {
                        mode: "dir",
                        path: raw,
                        candidates: 0,
                        processed: 0,
                        deleted: 0,
                        errors: 0,
                        unchanged: true,
                        outcome: "no-op",
                        reason: "no change detected under the requested directory (mtime+size comparison; the walk applies the indexer's own skip rules)",
                    },
                    null,
                    2,
                ),
            )
        }
        const r = await reindexFilesParallel(projectId as any, projectPath, changes)
        const outcome = r.errors > 0 ? "partial" : r.indexed > 0 || r.deleted > 0 ? "indexed" : "no-op"
        return textResult(
            JSON.stringify(
                {
                    mode: "dir",
                    path: raw,
                    candidates: changes.length,
                    processed: r.indexed,
                    deleted: r.deleted,
                    errors: r.errors,
                    unchanged: r.unchanged,
                    declined: r.declined,
                    skipped: r.skipped,
                    ...(r.errors > 0 ? { errorDetail: r.errorDetail ?? [] } : {}),
                    outcome,
                    ...(outcome === "no-op" ? { reason: "every candidate was already current in the index" } : {}),
                    walCheckpointed: r.walCheckpointed,
                },
                null,
                2,
            ),
        )
    } catch (e: any) {
        return textResult(`bb_index mode=dir refused: ${e?.message}`, true)
    }
}
