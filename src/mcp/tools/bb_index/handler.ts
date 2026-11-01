// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the handler for bb_index — the adapter that parses arguments, calls the owning engine, and shapes the tool result.
// WHICH TOOL IT SERVES — bb_index (see src/mcp/tools/bb_index/descriptor.ts for mutability, modes and schema).
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_index.md, docs/BB_*.md for its guide page, validation/tools/bb_index/**, and the gate scripts named in its task.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_index/descriptor.ts (schema/defaults), the owning engine modules it calls, docs/tools/bb_index.md, and its gate scripts.
// CONTRACTS IT MUST NOT BREAK — declared bounds, declared absence, freshness flags,
//   read/write boundary, and the no-regex policy (validation/tools/regex-allowlist.json).
// ─────────────────────────────────────────────────────────────────────────────

import type { ToolHandler, ToolContext, ToolResult, ToolArguments } from "../shared"
import { derivedStaleness, SECURITY_FINDINGS_WINDOW, SECURITY_SUSPICIOUS_WINDOW, SECURITY_SCAN_CAP, SECURITY_RECORD_RUN_CENSUS_CAP, ANALYZE_GRAPH_WALK_CEILING_MS, textResult, autoRefreshFile, readSnippet, resolveProjectPath, ensureWithinProject, resolveSafeReadPath, readIndexedFile, describeUnknownFilters, canonicalImpactReport } from "../shared"
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { BrainDatabase } from "../../../brain/database"
import { annotationId, annotationReachability, canonicalFilePath } from "../../../brain/annotation-store"
import { BrainTools, PatternBrainTools } from "../../../ast/tools"
import { quickAnswer } from "../../../intelligence/search/quick-answer"
import { detectOrphans } from "../../../intelligence/patterns/orphans"
import { ASTEngine } from "../../../ast/engine"
import { checkResultsFreshness, fileUnchangedSince, resolveRowsFreshnessDetailed, buildStalenessEnvelope, FRESHNESS_REMEDIATION, FRESHNESS_REMEDIATION_MANUAL_ONLY, type FreshnessSummary } from "../../../brain/freshness"
import { CrossLanguageSecurityAnalysis } from "../../../security/cross-language-security"
import { DependencyGraphVisualizer } from "../../../ast/dependency-graph-visualizer"
import { CrossLanguageIntelligence } from "../../../ast/cross-language-intelligence"
import { CrossLanguageMigrationAssistant } from "../../../ast/cross-language-migration-assistant"
import { indexProjectParallel, reindexFilesParallel, wipeProjectData } from "../../../ast/parallel-indexer"
import { collectStaleFiles, maybeAutoRefresh, autoRefreshLine } from "../../../ast/auto-refresh"
import { TOOL_DESCRIPTORS } from "../../tool-registry"
import { testQuality } from "../../../intelligence/testing/quality"
import { executeEdit, type EditRequest } from "../../../intelligence/edit/edit-engine"
import { getUnifiedHealth, formatUnifiedHealth } from "../../../intelligence/health/health-provider"
import { getAnalysisHistory, executeAnalysis } from "../../../intelligence/analysis/run-history"
import { generateDocumentation, formatDocumentation, type DocRequest } from "../../../intelligence/documentation/doc-engine"
import { visualizeProject, formatVisualization, renderVisualizationStudio, type VisualizationRequest, type VisualizationScope, type VisualizationLayout } from "../../../intelligence/visualization/visualization-engine"
import { generateMigrationPlans, formatMigrationPlans } from "../../../intelligence/migration/migration-engine"
import { graphTraversal } from "../../../intelligence/graph/graph-engine"
// M28.T1 (issue #624): the agent door reuses the EXACT components the IDE
// door uses — one truth, two doors (M28 decision D-1). No reimplementation.
// M48.P1 (#696): bb_analyze impact aggregates the SAME canonical calculator
// (computeImpact + its declared budget) so the two doors cannot disagree.
import { computeImpact, IMPACT_BUDGET } from "../../../lsp/impact"
// M55.T5 / §15.1: the ONE owner of the evidence-tier vocabulary and derivation.
// The agent door CALLS it. It used to carry a drifted copy of the rule — see the
// `tierFor` delegation in bb_graph below and docs/m63/CL1.md for the shape of
// defect a copy-projection is.
import { classifyTier } from "../../../lsp/evidence_tier"
import { tierForCrossLanguageEdge, factsFromRows, storedCrossLanguageRows, storedCrossLanguageFactsByName, CROSS_LANGUAGE_DEFAULT_LIMIT, CROSS_LANGUAGE_MAX_LIMIT } from "../../../lsp/cross_language_hover"
import { getProjectStats } from "../../../intelligence/analysis/project-stats"
import { getFileDependencies, dependencyProvenance, dependencyPageProvenance, normalizeScopePath, scopeFileCount } from "../../../intelligence/analysis/dependencies"
import { analyzeComplexity } from "../../../intelligence/analysis/complexity"
import { testMapping, testGaps, testImpact } from "../../../intelligence/testing/test-intel"
import { makeProvenance } from "../../../intelligence/evidence"
import type { AnalysisFindingInput } from "../../../intelligence/contracts"

  // M22.E1: agent-fresh. A file reindexes only itself; a dir runs an
  // incremental index (changed files only) so an agent that just wrote a
  // function can make it visible immediately without a full reindex.
export const handler: ToolHandler = async (args, { projectId, projectPath }) => {
    const raw = String(args.path ?? "")
    if (!raw) return textResult("bb_index requires path", true)
    const mode = String(args.mode ?? "auto")
    // M48.C2 (#700): unknown modes are refused, never silently treated as
    // another mode — the old fall-through executed a full dir index for ANY
    // unrecognized mode string.
    if (!["auto", "file", "dir", "post"].includes(mode)) return textResult(`bb_index: unknown mode: ${mode} (expected auto|file|dir|post)`, true)
    // M40.A1: mode=post — re-run the heavy derived-data phases (relationships,
    // enrichment, gravity, taints, health) WITHOUT re-parsing. The remediation
    // for stale derived data after agent edits or incremental indexing.
    if (mode === "post") {
      // `path` is REQUIRED by the schema and the registry describes it as "the
      // project whose derived phases should be re-run". It was then ignored
      // entirely: `mode=post` with `path: "no/such/path/at/all"` re-derived all
      // eight phases and reported success. A required parameter that is not
      // read is a requirement that teaches a caller the wrong lesson.
      const postAbs = path.isAbsolute(raw) ? raw : path.resolve(projectPath, raw)
      if (!existsSync(postAbs)) {
        return textResult(`bb_index mode=post: no such path: ${postAbs} — mode=post re-derives the phases of THIS project, and the required \`path\` must name it.`, true)
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
    // The path must be INSIDE the project.
    //
    // `path.resolve(projectPath, raw)` happily walks out: `bb_index path: "../x.ts"`
    // and an absolute path to any file on the machine both resolved and indexed.
    // Measured on a scratch project, all three of these were accepted with
    // `indexed: 1`:
    //
    //   an absolute path to a file in another directory
    //   a relative `../other-dir/file.ts`
    //   `mode: "dir"` on a whole directory OUTSIDE the project
    //
    // and the row it wrote has a "project-relative" path that is not one — the
    // absolute path with its leading `/` stripped:
    //
    //   Users/…/secrets-cOJXSq/credentials.ts
    //
    // `relative_path` is the key for `bb_analyze filePath` scoping, for every
    // file the graph modes name, and for freshness resolution by path, so those
    // rows are invisible to scoped queries while still counted in `stats.files`
    // (measured: a 2-file project reporting 3). It is a write tool, so the
    // pollution persists. And the file is then discoverable by name through the
    // read tools, with its out-of-tree location printed.
    //
    // The registry already says "Project-relative file (reindex only that
    // file)"; this is the check that makes that sentence true. Both sides are
    // resolved through `realpath` so a symlink inside the project pointing out
    // of it is refused too — a lexical check alone would wave it through.
    const rootReal = realpathSync(projectPath)
    const absReal = realpathSync(abs)
    const relToRoot = path.relative(rootReal, absReal)
    // `relToRoot === ""` is the project root ITSELF, which is in bounds and is
    // the documented way to reindex a whole project — `mode: auto` on a
    // directory runs a dir index. Refusing it was my own bug on the first
    // version of this guard, caught by the suite immediately.
    const outsideRoot = relToRoot === "" ? false : relToRoot.startsWith("..") || path.isAbsolute(relToRoot)
    if (outsideRoot) {
      return textResult(
        `bb_index: refusing a path outside the project. "${raw}" resolves to ${absReal}, which is not inside ${rootReal}. ` +
          `bb_index indexes THIS project's files; an out-of-tree path would be stored with a "project-relative" path that is not relative to anything, and every scoped query, file name and freshness check in the index would then be wrong for it.`,
        true,
      )
    }
    const isDir = statSync(abs).isDirectory()
    const effective = mode === "auto" ? (isDir ? "dir" : "file") : mode
    if (effective === "file" && isDir) return textResult("bb_index mode=file requires a file path", true)
    if (effective === "dir" && !isDir) return textResult("bb_index mode=dir requires a directory path", true)
    if (effective === "file") {
      try {
        const r = await reindexFilesParallel(projectId as any, projectPath, [{ path: abs, type: "modified" }])
        // M40.A3: derived-data telemetry surfaced — an agent can see whether
        // relationships/gravity were re-derived for the touched file, and how
        // many caller edges were repaired, without inspecting logs.
        // `indexed: 0, deleted: 0, errors: 0` reads as "nothing happened and
        // nothing failed", and those are three different situations: the file
        // was already current, the file is not indexable (a binary, say), or
        // the indexer declined it for some other reason. Measured on a binary
        // file: exactly that answer, with no way to tell it from a no-op.
        // So when nothing happened, say which of the two it was.
        const didNothing = r.indexed === 0 && r.deleted === 0 && r.errors === 0
        const note = didNothing
          ? {
              outcome: "no-op",
              skipped: r.skipped ?? 0,
              reason:
                r.skippedReason ??
                (r.skipped
                  ? `${r.skipped} file(s) hold nothing the indexer extracts`
                  : "nothing changed: the file's content already matches the index"),
            }
          : { outcome: r.errors > 0 ? "partial" : "indexed" }
        return textResult(
          JSON.stringify(
            {
              mode: "file",
              path: raw,
              indexed: r.indexed,
              deleted: r.deleted,
              errors: r.errors,
              // Which files failed and why, when any did. `errors` alone is a
              // count, and a count is not something a caller can act on.
              ...(r.errors > 0 ? { errorDetail: r.errorDetail ?? [] } : {}),
              ...note,
              derived: r.derived ?? { pass: "deferred", phases: [], repairedInEdges: 0, touchedSymbols: 0 },
            },
            null,
            2,
          ),
        )
      } catch (e: any) {
        // M43.P1: another indexer holds the project lock — declared refusal,
        // never a thrown handler crash.
        return textResult(`bb_index mode=file refused: ${e?.message}`, true)
      }
    }
    // M48.C2 (#700): dir-mode detects changes under the requested directory
    // but reindexes from the PROJECT ROOT — file keys are root-relative and
    // never move, so a subdir index can no longer corrupt the index.
    try {
      const { collectDirChanges } = await import("../../../ast/parallel-indexer")
      const changes = await collectDirChanges(projectId as any, projectPath, abs)
      if (changes.length === 0) {
        return textResult(JSON.stringify({ mode: "dir", path: raw, candidates: 0, processed: 0, deleted: 0, errors: 0, unchanged: true }, null, 2))
      }
      const r = await reindexFilesParallel(projectId as any, projectPath, changes)
      return textResult(
        JSON.stringify(
          {
            mode: "dir",
            path: raw,
            candidates: changes.length,
            processed: r.indexed,
            deleted: r.deleted,
            errors: r.errors,
            ...(r.errors > 0 ? { errorDetail: r.errorDetail ?? [] } : {}),
            skipped: r.skipped ?? 0,
          },
          null,
          2,
        ),
      )
    } catch (e: any) {
      return textResult(`bb_index mode=dir refused: ${e?.message}`, true)
    }
}
