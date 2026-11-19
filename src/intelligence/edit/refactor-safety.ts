// ─────────────────────────────────────────────────────────────────────────────
// refactor-safety.ts — P0-1 helpers for the bb_edit refactor path.
//
// WHY THIS FILE EXISTS. The refactor engine had four independent ways to lose a
// reference site while still reporting success (triage ISSUE-01, verified against
// bettercap and re-measured in script/m71/verify-refactor-safety.ts):
//
//   A. CALLER-SPAN ATTRIBUTION. A cross-file `calls` row's source symbol can be a
//      CONTAINER (bettercap main.go: source = the 12-byte `package main` module
//      symbol, bytes 0–12, because the indexer's first-wins name map resolved the
//      analyzer's `source:"main"` to the module before `func main` at bytes
//      315–2610). The engine renamed inside the source symbol's byte span, so the
//      window was [0,12) and line 47 was outside it.
//   B. QUALIFIED REFERENCES CLASSIFIED AS MEMBER NAMES. `modules.LoadModules` is a
//      Go `selector_expression.field_identifier`; `Log.create` is a TS
//      `member_expression.property_identifier`; both are in MEMBER_NODE_TYPES, so
//      `isReferenceSite` dropped them. They are references when the receiver is a
//      MODULE/NAMESPACE binding (Go package import, TS `import * as`), and member
//      names of a VALUE receiver otherwise.
//   C. SILENT ZERO-SITE DROP. A caller-evidenced file that produced zero sites was
//      skipped with no refusal and no warning.
//   D. NO VERIFICATION. Post-write "validation" was syntax-only, so a rename that
//      left `main.go` calling the old name returned validated:true.
//
// The fixes here are deliberately engine-local: the indexer's attribution (why the
// row says `main:1`) belongs to another lane's file (`src/ast/parallel-indexer.ts`)
// and is NOT touched here. This module RESOLVES AROUND that mis-attribution using
// the evidence the row still carries (its file, its call line) and the imports the
// file actually has; and it makes every refusal/follow-up explicit.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import path from "node:path"
import { EXTENSION_LANGUAGE } from "../../ast/language-detection"

/**
 * The DECLARED contract of a refactor's pre-commit verification.
 *
 * `attempted:false` is not a pass: a plan that could not be checked says so, and
 * `ok` stays null (a skipped checker must never read as verified).
 */
export interface EditVerification {
  /** Every planned file was parsed again after the rename (syntax layer). */
  reparsed: "passed" | "failed"
  /** Module/namespace-aware reference sites of the OLD name still present in a
   *  planned file's `after` content — the unresolved-identifier scan. Empty is the
   *  only passing value; a non-empty list refuses before anything is written. */
  unresolvedReferences: string[]
  /** Bounded build/type check. `attempted:false` + `reason` when no checker
   *  applies (dry run, non-Go files, single-file edit, no go.mod, no `go`), and
   *  `ok:null` in every such case — never `true` without a measured exit 0. */
  build: {
    attempted: boolean
    tool: "go" | null
    command: string | null
    ok: boolean | null
    baseline?: "passed" | "failed" | "skipped"
    outputTail?: string
    reason?: string
  }
}

/** Symbol kinds that are CONTAINERS, not the code AROUND a call. A `calls` row
 *  sourced at one of these has real call evidence (callExpression + line_number)
 *  but a span that is the container's, so a byte-window rename must not trust it. */
export const CONTAINER_SOURCE_TYPES = new Set([
  "module", "package", "namespace", "class", "interface", "struct", "trait", "enum", "object", "type", "impl",
])

/** Language id of a file, from the SAME extension table the indexer routes with. */
export function fileLanguageOf(filePath: string): string {
  const ext = path.extname(filePath).replace(/^\./, "").toLowerCase()
  if (!ext) return ""
  return (EXTENSION_LANGUAGE as Readonly<Record<string, string>>)[ext] ?? ""
}

/** JS/TS family: languages whose namespace import binds a module object. */
export function isJsLikeLanguage(language: string): boolean {
  return language === "typescript" || language === "tsx" || language === "javascript"
}

/** How one index row spells the local binding of a MODULE in a file. */
export type ModuleBinding = { fileId: string; qualifiers: Set<string> }

/**
 * The names bound to a MODULE/NAMESPACE in one file, derived from `brain_import`
 * rows (never from text). The row SHAPES are measured, not assumed:
 *
 *   Go plain import    imported_name=modules  imported_as=''      import_path=<...>/modules
 *   Go aliased import  imported_name=log      imported_as=my_log  import_path=<...>/log
 *                      — the alias is the only spelling valid at the call site.
 *   TS namespace       imported_name=../tool/brain-log (the SPECIFIER)
 *                      imported_as=Log (the namespace binding)
 *                      — a named import carries a symbol in imported_name instead,
 *                      so it is deliberately not a module binding here; its
 *                      unqualified sites are covered by the importer route.
 *
 * A language with no known module-binding shape (e.g. Python's `import mod`) adds
 * nothing, so a qualified site there is reported by the caller (file:line) rather
 * than renamed on a guess.
 */
export function moduleBindingsForFile(
  raw: any,
  projectId: string,
  fileId: string,
  filePath: string,
  cache: Map<string, ModuleBinding>,
): ModuleBinding {
  const hit = cache.get(fileId)
  if (hit) return hit
  const language = fileLanguageOf(filePath)
  const qualifiers = new Set<string>()
  try {
    const rows = raw
      .prepare(
        "SELECT imported_name AS name, imported_as AS alias, import_path AS spec FROM brain_import WHERE project_id = ? AND file_id = ?",
      )
      .all(projectId, fileId) as Array<{ name: string | null; alias: string | null; spec: string | null }>
    for (const row of rows) {
      const name = String(row.name ?? "")
      const alias = String(row.alias ?? "")
      const spec = String(row.spec ?? "")
      if (language === "go") {
        if (alias) qualifiers.add(alias)
        else if (name) qualifiers.add(name)
      } else if (isJsLikeLanguage(language)) {
        if (alias && (name === spec || name === "*" || name === "")) qualifiers.add(alias)
      }
    }
  } catch {
    // An unreadable import table leaves the set empty: conservative (nothing is
    // renamed blind), and every unexplained site is reported/refused downstream.
  }
  const binding = { fileId, qualifiers }
  cache.set(fileId, binding)
  return binding
}

/** The Go module path from the PROJECT ROOT's go.mod, or null. Bounded: one read,
 *  no upward walk — a refactor is rooted at the project it edits, and a go.mod
 *  above that root belongs to a parent module whose packages this edit does not own. */
export function goModulePathOf(projectPath: string): string | null {
  try {
    const gomod = readFileSync(path.join(projectPath, "go.mod"), "utf8")
    const match = /^module\s+(\S+)/m.exec(gomod)
    return match ? match[1] : null
  } catch {
    return null
  }
}

/**
 * Files that import the DECLARATION MODULE itself — with no symbol named in the
 * import, which is exactly the shape the existing `imported_name = <symbol>` route
 * cannot see:
 *
 *   Go    `import "<module>/modules"` then `modules.LoadModules()` — Go imports a
 *         PACKAGE; no symbol name appears in the import at all. Matched by the
 *         module path from go.mod + the declaration file's directory, so an
 *         unrelated module whose last segment happens to match is NOT included.
 *   TS/JS `import * as m from './a'` then `m.target()` — analyzer records the
 *         SPECIFIER as imported_name and the namespace as imported_as; matched by
 *         the existing relative-specifier resolver.
 *
 * Each returned file is then scanned for qualified reference sites through its own
 * measured module bindings (moduleBindingsForFile), so the rename is operand-aware
 * rather than a text substitution.
 */
export function discoverModuleImporters(
  raw: any,
  projectId: string,
  declRelPath: string,
  declFileId: string,
  projectPath: string,
  resolveSpecifier: (importerRelPath: string, spec: string, declRelPath: string) => boolean,
): Map<string, { fileId: string }> {
  const out = new Map<string, { fileId: string }>()
  const declDir = path.posix.dirname(declRelPath)
  const goModulePath = goModulePathOf(projectPath)
  const expectedGoPackage = goModulePath && declDir && declDir !== "." ? `${goModulePath}/${declDir.replace(/\\/g, "/")}` : null
  let rows: Array<{ fileId: string; path: string; relPath: string; name: string | null; alias: string | null; spec: string | null; isExternal: number | null }>
  try {
    rows = raw
      .prepare(
        "SELECT i.file_id AS fileId, f.path AS path, f.relative_path AS relPath, i.imported_name AS name, " +
          "       i.imported_as AS alias, i.import_path AS spec, i.is_external AS isExternal " +
          "FROM brain_import i JOIN brain_file f ON f.id = i.file_id WHERE i.project_id = ? AND i.file_id <> ?",
      )
      .all(projectId, declFileId)
  } catch {
    return out
  }
  for (const row of rows) {
    if (!row.path) continue
    const language = fileLanguageOf(row.path)
    const spec = String(row.spec ?? "")
    const alias = String(row.alias ?? "")
    const name = String(row.name ?? "")
    if (language === "go") {
      // Go import identity is a module PATH; the declaration file's directory is
      // its package. Same-module imports are is_external=1 in the current index
      // (triage ISSUE-03), which is exactly why the flag is NOT consulted here:
      // the evidence is the path, not a flag that is known-wrong for Go.
      if (expectedGoPackage && spec === expectedGoPackage) out.set(row.path, { fileId: row.fileId })
    } else if (isJsLikeLanguage(language)) {
      if (Number(row.isExternal) !== 0) continue
      if (!alias) continue
      const namespaceShaped = name === spec || name === "*" || name === ""
      if (!namespaceShaped) continue
      if (!resolveSpecifier(String(row.relPath ?? ""), spec, declRelPath)) continue
      out.set(row.path, { fileId: row.fileId })
    }
  }
  return out
}

/**
 * The byte window a `calls` row authorises, made honest about its source symbol.
 *
 * When the row carries a call line, the ENCLOSING function/method at that line is
 * the real rename window — the row's own source symbol may be a container
 * (`main.go:main:1`, bytes 0–12) or a stale/other-file attribution, and either way
 * the call sits inside the enclosing function. Only when no enclosing symbol can be
 * found does the row fall back to (a) its stored span, or (b) a LINE-SCOPED window
 * (`lineOnly`), which cannot widen to unrelated code the file contains.
 *
 * A container-sourced row with no call line returns null: the engine refuses to
 * guess a window and the plan reports/refuses the file as unexplained evidence.
 */
export function resolveCallerWindow(
  raw: any,
  projectId: string,
  row: {
    fileId: string | null
    byteStart: number | null
    byteEnd: number | null
    sourceType: string | null
    callLine: number | null
  },
): { start: number; end: number; line: number | null; lineOnly: boolean } | null {
  if (!row.fileId) return null
  const line = typeof row.callLine === "number" && row.callLine > 0 ? row.callLine : null
  const sourceType = String(row.sourceType ?? "")
  const containerSourced = !sourceType || CONTAINER_SOURCE_TYPES.has(sourceType)
  if (line != null) {
    try {
      const enclosing = raw
        .prepare(
          "SELECT byte_start AS start, byte_end AS end FROM brain_symbol " +
            "WHERE file_id = ? AND symbol_type IN ('function','method','constructor') " +
            "AND line_start <= ? AND line_end >= ? ORDER BY (line_end - line_start) ASC LIMIT 1",
        )
        .get(row.fileId, line, line) as { start: number | null; end: number | null } | undefined
      if (enclosing && typeof enclosing.start === "number" && typeof enclosing.end === "number" && enclosing.end > enclosing.start) {
        return { start: enclosing.start, end: enclosing.end, line, lineOnly: false }
      }
    } catch {
      /* fall through to the stored span */
    }
  }
  if (row.byteStart != null && row.byteEnd != null && row.byteEnd > row.byteStart) {
    return { start: row.byteStart, end: row.byteEnd, line, lineOnly: containerSourced && line == null }
  }
  if (line != null) return { start: 0, end: Number.MAX_SAFE_INTEGER, line, lineOnly: true }
  if (containerSourced) return null
  return { start: 0, end: Number.MAX_SAFE_INTEGER, line: null, lineOnly: false }
}

/** A cheap, bounded Go build gate: only for a MULTI-FILE Go-only refactor whose
 *  project root has a go.mod and whose machine has a working `go`. Anything else
 *  returns null, and the caller declares `attempted:false` + the reason. */
export function goBuildContext(projectPath: string, changes: Array<{ path: string }>): { dir: string; command: string } | null {
  if (changes.length < 2) return null
  if (!changes.every((change) => path.extname(change.path).toLowerCase() === ".go")) return null
  if (goModulePathOf(projectPath) === null) return null
  const probe = spawnSync("go", ["version"], { timeout: 3000, encoding: "utf8" })
  if (probe.error || probe.status !== 0) return null
  return { dir: projectPath, command: "go build ./..." }
}

/** Run the bounded build in an owned, writable cache. The sandbox's default
 *  ~/.cache/go-build is read-only (a measured failure of the first gate run), so
 *  GOCACHE is set explicitly and GOPROXY is off: a verification gate must not
 *  download anything to answer "does this tree compile". */
export function runGoBuild(dir: string): { ok: boolean; outputTail: string } {
  const result = spawnSync("go", ["build", "./..."], {
    cwd: dir,
    encoding: "utf8",
    timeout: 120_000,
    env: {
      ...process.env,
      GOCACHE: process.env.BB_EDIT_GOCACHE ?? path.join(tmpdir(), "bb-edit-go-build-cache"),
      GOFLAGS: process.env.BB_EDIT_GOFLAGS ?? "-mod=mod",
      GOPROXY: "off",
    },
  })
  const output = `${result.stderr ?? ""}${result.stdout ?? ""}`.trim()
  return { ok: result.status === 0, outputTail: output.slice(0, 4000) }
}
