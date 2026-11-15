// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the deterministic fixture project the bb_visualize door
//   probe and its option matrix index and call the tool against.
// WHICH TOOL IT SERVES — bb_visualize (mutability read, requiresIndex true,
//   modes: project, file, module, symbol, feature).
// WHY IT IS SHAPED THIS WAY — the matrix has to exercise every declared option
//   against real indexed data: several scopes and targets, a symbol whose name
//   is reachable in more than one way, a directory with an underscore and a
//   sibling whose name extends it, a stored call chain for the edge filter, two
//   languages for the language filter, a class with member-level call rows for
//   the owner-cascade fold, plus the four noise categories the projection
//   reports (vendor segment, build suffix, test source, build directory). A
//   fixture that only holds one file cannot falsify a filter that does nothing.
// WHERE ITS EVIDENCE LIVES — validation/tools/bb_visualize/results/*.json.
// EDIT TOGETHER WHEN THIS CHANGES — probe.ts (the cases assume these names),
//   docs/BB_VISUALIZE.md (its examples name some of them).
// CONTRACTS IT MUST NOT BREAK — writes only under
//   validation/tools/bb_visualize/{work,bbdata}; deterministic bytes, so a
//   failed assertion is about the tool and not about a drifting fixture.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"

export const VISUALIZE_DIR = path.resolve(import.meta.dirname ?? ".", "..")
export const WORK_DIR = path.join(VISUALIZE_DIR, "work")
export const FIXTURE_DIR = path.join(WORK_DIR, "fixture")
export const DATA_DIR = path.join(VISUALIZE_DIR, "bbdata")
export const RESULTS_DIR = path.join(VISUALIZE_DIR, "results")

/** The fixture files, as bytes. Every name here is referenced by a probe case. */
export const FIXTURE_FILES: Record<string, string> = {
  // The call chain: top -> mid -> leaf, so `calls` edges exist in both directions.
  "src/core/leaf.ts": [
    "export function leaf(): number { return 1 }",
    "",
  ].join("\n"),
  "src/core/mid.ts": [
    "import { leaf } from './leaf'",
    "",
    "export function mid(): number { return leaf() }",
    "",
  ].join("\n"),
  "src/core/top.ts": [
    "import { mid } from './mid'",
    "",
    "export function top(): number { return mid() }",
    "",
  ].join("\n"),
  // A class whose members carry the call rows: the owner-cascade fold.
  "src/core/api.ts": [
    "import { leaf } from './leaf'",
    "",
    "export class Api {",
    "  handle(): number { return this.respond() }",
    "  respond(): number { return leaf() }",
    "}",
    "",
    "export function handleRequest(): number { return new Api().handle() }",
    "",
  ].join("\n"),
  // A directory with an underscore, and a sibling directory whose name starts
  // with the same letters: `src/my_mod` must match `src/my_mod/x.ts` and never
  // `src/my_modular/x.ts`.
  "src/my_mod/deep_lookup.ts": [
    "export function deep_lookup(): string { return 'mod' }",
    "",
  ].join("\n"),
  "src/my_modular/other.ts": [
    "export function modular_other(): string { return 'modular' }",
    "",
  ].join("\n"),
  // Second language, for the language filter and the language census.
  "src/py/service.py": [
    "def py_service():",
    "    return 42",
    "",
    "def py_caller():",
    "    return py_service()",
    "",
  ].join("\n"),
  // Third language and a second source root.
  "src/go/main.go": [
    "package main",
    "",
    "func GoEntry() int { return 7 }",
    "",
  ].join("\n"),
  // The noise categories the projection must count and attribute.
  "vendor/lib.ts": "export function vendored(): number { return 0 }\n",
  "src/bundle.d.ts": "export declare function bundleDecl(): void\n",
  "src/c.min.js": "export function minified(){return 1}\n",
  "dist/out.ts": "export function builtOutput(): number { return 2 }\n",
  "test/app.test.ts": [
    "import { top } from '../src/core/top'",
    "",
    "export function testHelper(): number { return top() }",
    "",
  ].join("\n"),
  // A symbol that exists only so a symbol-scope lookup can be paged.
  "src/extra/pages.ts": Array.from({ length: 24 }, (_, i) => `export function page_${String(i).padStart(2, "0")}(): number { return ${i} }`).join("\n") + "\n",
}

/** Write the fixture tree. Returns the project root. */
export function writeFixture(reindex = false): string {
  if (reindex && existsSync(FIXTURE_DIR)) rmSync(FIXTURE_DIR, { recursive: true, force: true })
  for (const [relative, content] of Object.entries(FIXTURE_FILES)) {
    const target = path.join(FIXTURE_DIR, relative)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
  mkdirSync(RESULTS_DIR, { recursive: true })
  return FIXTURE_DIR
}

/** Seed the annotation overlay: one note whose path matches a returned symbol and
 *  one whose path does not, so the overlay's match-by-name-and-path rule is
 *  observable in the answer instead of being taken on faith. */
export async function seedAnnotations(projectId: string): Promise<void> {
  const { BrainDatabase } = await import("../../../../src/brain/database")
  const { annotationId } = await import("../../../../src/brain/annotation-store")
  const raw = await BrainDatabase.getRawInstance(projectId as any)
  const note = (symbol: string, symbolPath: string | null, body: string) => ({
    id: annotationId({ projectId, symbol, path: symbolPath, authorClass: "agent" }),
    symbol,
    symbolPath,
    body,
  })
  const now = Date.now()
  const rows = [
    note("deep_lookup", "src/my_mod/deep_lookup.ts", "the module entry point"),
    note("top", "src/nowhere/other.ts", "a note on a name that exists at another path"),
  ]
  for (const row of rows) {
    raw.prepare(
      `INSERT INTO brain_annotation (id, project_id, symbol_name, symbol_path, author_class, tool_identity, body, time_created, time_updated)
       VALUES (?, ?, ?, ?, 'agent', 'bb_visualize-probe', ?, ?, ?)
       ON CONFLICT(project_id, symbol_name, author_class, COALESCE(symbol_path, '')) DO UPDATE SET body = excluded.body, time_updated = excluded.time_updated`,
    ).run(row.id, projectId, row.symbol, row.symbolPath, row.body, now, now)
  }
}

/** The tool context every probe call uses, matching what the MCP server builds. */
export async function fixtureContext(root = FIXTURE_DIR, reindex = false): Promise<{ root: string; projectId: string }> {
  // The data dir must be set before the database layer is imported anywhere.
  process.env.BB_DATA_DIR = DATA_DIR
  process.env.BB_NO_AUTO_REFRESH = "1"
  const { getProjectId } = await import("../../../../src/util/project-id")
  const { indexProjectParallel } = await import("../../../../src/ast/parallel-indexer")
  writeFixture(reindex)
  const projectId = getProjectId(root)
  const dbPath = path.join(DATA_DIR, "projects", projectId, "brain.db")
  if (reindex || !existsSync(dbPath)) {
    await indexProjectParallel(projectId, root, {})
  }
  return { root, projectId }
}
