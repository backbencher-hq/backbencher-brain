#!/usr/bin/env bun
/**
 * DERIV_EXPORTS_SWIFT4 — MUTANTS for the swift `exports` emission.
 *
 * WHY THIS FILE EXISTS. A fixture that cannot fail is not evidence
 * (docs/M14-HONESTY-CONTRACT.md §5.4, "test the tests"). Every mutant below is
 * a DELIBERATE defect injected into the real analyzer source, the real fixture
 * runner is executed against it, and the run must FAIL. A surviving mutant is
 * the finding — not a tolerance.
 *
 * NO REGEX. The mutants are made by exact source splicing on unique anchors, and
 * the runner is the shared `script/m14/run-fixtures.ts`, so nothing here decides
 * what "correct" means — the harness does.
 *
 * MECHANISM. The analyzer file is copied to a scratch path, the copy is patched,
 * and the patch is applied to the REAL file in place for the duration of the
 * run and then restored from the copy. In-place is deliberate: the runner
 * resolves the analyzer through `src/ast/real-swift-analyzer.ts`, so a shadow
 * module would not exercise the code path that ships. The original bytes are
 * restored in a `finally`, and the script verifies the restore by hash — a
 * mutant runner that leaves the tree broken is worse than no mutant runner.
 *
 * USAGE
 *   bun validation/m14/fixtures/swift/mutants-exports.mts
 *   KEEP=1 bun validation/m14/fixtures/swift/mutants-exports.mts   # leave the
 *        last mutant in place, for debugging
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, copyFileSync, rmSync, existsSync } from "node:fs"
import { createHash } from "node:crypto"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dir, "..", "..", "..", "..")
const ANALYZER = path.join(ROOT, "src", "ast", "real-swift-analyzer.ts")
const SCRATCH = path.join("/tmp/opencode", "swift-mutant-analyzer.ts")
const FIXTURE_EXPECT = "exports-visibility"

const original = readFileSync(ANALYZER, "utf8")
const originalHash = createHash("sha256").update(original).digest("hex")
copyFileSync(ANALYZER, SCRATCH)

interface Mutant {
  id: string
  /** What the mutant breaks, in one line. */
  defect: string
  /** Exact unique source anchor -> its replacement. */
  from: string
  to: string
  /** A fixture row that MUST start failing. */
  mustBreak: string
}

const MUTANTS: Mutant[] = [
  {
    id: "SW-EXP-1-internal-also-exports",
    defect: "treat `internal` as an exporting visibility (the absence-of-export is dropped)",
    from: `    if (vis === "public" || vis === "open" || vis === "package") return vis`,
    to: `    if (vis === "public" || vis === "open" || vis === "package" || vis === "internal") return vis`,
    mustBreak: "forbid exports -> Hidden (internal class)",
  },
  {
    id: "SW-EXP-2-private-also-exports",
    defect: "treat `private` as an exporting visibility",
    from: `    if (vis === "public" || vis === "open" || vis === "package") return vis`,
    to: `    if (vis === "public" || vis === "open" || vis === "package" || vis === "private") return vis`,
    mustBreak: "forbid exports -> Secret (private struct)",
  },
  {
    id: "SW-EXP-3-member-also-exports",
    defect: "drop the file-scope gate, so a public MEMBER of an internal type is published as a module export",
    from: `      if (parentSymbol === null && this.isExportingDeclaration(curr)) {`,
    to: `      if (this.isExportingDeclaration(curr)) {`,
    mustBreak: "forbid exports -> notAnExport (public member of an internal class)",
  },
  {
    id: "SW-EXP-4-extension-exports",
    defect: "let a `public extension Array` export `Array` — a fabricated module-level name owned by the stdlib",
    from: `    if (node.type === "class_declaration" && this.hasAnonToken(node, "extension")) return null`,
    to: `    if (false) return null`,
    mustBreak: "forbid exports -> Array",
  },
  {
    id: "SW-EXP-5-reexport-blind",
    defect: "stop recognising `@_exported import` (the underscored re-export form)",
    from: `      else if (this.hasExportedAttribute(node)) reExportForm = "underscored_exported_import"`,
    to: `      else if (false) reExportForm = "underscored_exported_import"`,
    mustBreak: "expect exports -> Utils with meta.exportForm underscored_exported_import",
  },
  {
    id: "SW-EXP-6-public-import-blind",
    defect: "stop recognising `public import` (the SE-0409 re-export form)",
    from: `      if (this.exportingVisibility(node) === "public") reExportForm = "public_import"`,
    to: `      if (false as boolean) reExportForm = "public_import"`,
    mustBreak: "expect exports -> WinSDK with meta.exportForm public_import",
  },
  {
    id: "SW-EXP-7-wrong-source-root",
    defect: "source `exports` at the literal `root`, which is in parallel-indexer's SYMBOL_NAME_DENYLIST and can never bind",
    from: `    const moduleSource = this.moduleLeafName(filePath)`,
    to: `    const moduleSource = "root"`,
    mustBreak: "forbid exports with source root (every expect exports source becomes exports-visibility)",
  },
  {
    id: "SW-EXP-8-wrong-leaf-name",
    defect: "moduleLeafName returns the whole path instead of the leaf (an off-by-one on the separator scan)",
    from: `      if (filePath[i] === "/") { start = i + 1; break }`,
    to: `      if (filePath[i] === "/") { start = i; break }`,
    mustBreak: "every expect exports source (the source becomes the parent directory)",
  },
  {
    id: "SW-EXP-9-mislabelled-form",
    defect: "label a visibility-modifier export with the re-export form (mislabel, the 'labelled right' question)",
    from: `      metadata: { exportForm: "visibility_modifier", accessLevel: vis, swiftExport: true },`,
    to: `      metadata: { exportForm: "public_import", accessLevel: vis, swiftExport: true },`,
    mustBreak: "expect exports -> Shape with meta.exportForm visibility_modifier",
  },
  {
    id: "SW-EXP-10-class-as-struct-kind",
    defect: "read the class-declaration kind off the wrong keyword token, so an exported enum is published as a class",
    from: `        if (this.hasAnonToken(node, "struct")) return ASTEngine.SymbolKind.Struct
        if (this.hasAnonToken(node, "enum")) return ASTEngine.SymbolKind.Enum`,
    to: `        if (this.hasAnonToken(node, "struct")) return ASTEngine.SymbolKind.Struct
        if (false) return ASTEngine.SymbolKind.Enum`,
    mustBreak: "expectExports Mode kind=enum",
  },
  {
    id: "SW-EXP-11-property-name-lost",
    defect: "look for a property's binding in the wrong place, so `public let globalSeed` exports no name",
    from: `      const pat = this.findChildByType(node, "pattern")
      if (pat) {`,
    to: `      const pat = null
      if (pat) {`,
    mustBreak: "expect exports -> globalSeed",
  },
  {
    id: "SW-EXP-12-reexport-evidence-class",
    defect: "label a re-exporting import `structural` instead of `import_based`",
    from: `        md.evidenceClass = md.reExport === true ? "import_based" : "structural"`,
    to: `        md.evidenceClass = "structural"`,
    mustBreak: "expect exports -> WinSDK with meta.evidenceClass import_based",
  },
  {
    id: "SW-EXP-13-declaration-evidence-class",
    defect: "label a visibility-modifier export `import_based` instead of `structural`",
    from: `        md.evidenceClass = md.reExport === true ? "import_based" : "structural"`,
    to: `        md.evidenceClass = "import_based"`,
    mustBreak: "expect exports -> Shape with meta.evidenceClass structural",
  },
  {
    id: "SW-EXP-14-line-stolen-from-enclosing",
    defect: "publish the whole declaration's line instead of the NAME node's line (the M59.A7 line contract)",
    from: `      ...(typeof this.nodeLine(nameNode) === "number" ? { line_number: this.nodeLine(nameNode)! } : {}),
      metadata: { exportForm: "visibility_modifier", accessLevel: vis, swiftExport: true },`,
    to: `      ...(typeof this.nodeLine(node) === "number" ? { line_number: this.nodeLine(node)! } : {}),
      metadata: { exportForm: "visibility_modifier", accessLevel: vis, swiftExport: true },`,
    mustBreak: "the M59 line oracle over the fixture (a decorated/one-line declaration's export line)",
  },
]

function runFixtures(): { code: number; out: string } {
  try {
    const out = execFileSync("bun", ["script/m14/run-fixtures.ts", "--lang", "swift"], {
      cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 600_000,
    })
    return { code: 0, out }
  } catch (e: any) {
    return { code: typeof e.status === "number" ? e.status : 1, out: String(e.stdout ?? "") + String(e.stderr ?? "") }
  }
}

/**
 * Did the run report the fixture as FAILING?
 *
 * NOT the exit code, and this is not a shortcut — it is a measurement.
 * `script/m14/run-fixtures.ts` exits **0** with `FAIL` rows printed and
 * `1 fixture(s) FAIL — these are honest defect findings, not harness errors` on
 * stdout. Verified directly: with the analyzer deliberately broken
 * (`moduleSource = "root"`), `bun script/m14/run-fixtures.ts --lang swift` gave
 * EXIT=0 and nine `expected relationship not found` rows for
 * swift/exports-visibility.
 *
 * So a mutant harness that keys on the exit code reports a clean run for every
 * mutant it injects, which is precisely the shape of a lie-catching instrument
 * that catches nothing. This file's first version did exactly that and scored
 * 0/14 killed with exit 0 on all fourteen — every one of them a live defect.
 * The runner's own header records the same hazard from the other end: a scoped
 * run prints "fixture baseline gate: no regressions" and writes no evidence,
 * so neither the code nor the baseline line is a verdict in scoped mode. The
 * verdict is the printed FAIL row.
 */
function reportsFixtureFailure(out: string): boolean {
  for (const line of out.split("\n")) {
    if (!line.startsWith("FAIL")) continue
    if (line.indexOf(FIXTURE_EXPECT) !== -1) return true
  }
  // The shared exports-family invariant is not a per-fixture row; it is printed
  // under whichever fixture triggered it, so a whole-run scan is the honest
  // second source.
  return out.indexOf("export invariant violated") !== -1
}

function restore() {
  const back = readFileSync(ANALYZER, "utf8")
  writeFileSync(ANALYZER, original)
  const now = createHash("sha256").update(readFileSync(ANALYZER, "utf8")).digest("hex")
  if (now !== originalHash) {
    throw new Error(`RESTORE FAILED — the analyzer no longer hashes to ${originalHash}. Tree left BROKEN on purpose.`)
  }
  void back
}

console.log("DERIV_EXPORTS_SWIFT4 — exports mutants")
console.log(`analyzer: ${path.relative(ROOT, ANALYZER)}`)
console.log(`fixture:  swift/${FIXTURE_EXPECT} (plus the other 16 swift fixtures, which must stay passing)`)
console.log(`original sha256: ${originalHash}\n`)
console.log("Each mutant is a DELIBERATE defect injected into the real analyzer source. The runner")
console.log("must FAIL on it. A surviving mutant is the finding.\n")

const rows: Array<{ id: string; broke: boolean; detail: string }> = []
let restoreNeeded = false
try {
  for (const m of MUTANTS) {
    const occurrences = original.split(m.from).length - 1
    if (occurrences !== 1) {
      rows.push({ id: m.id, broke: false, detail: `ANCHOR NOT UNIQUE (${occurrences} matches) — mutant not run, this is a harness defect` })
      continue
    }
    writeFileSync(ANALYZER, original.split(m.from).join(m.to))
    restoreNeeded = true
    const r = runFixtures()
    const sawFail = reportsFixtureFailure(r.out)
    const failLines = r.out.split("\n").filter((l) => l.startsWith("FAIL")).map((l) => l.trim())
    rows.push({
      id: m.id, broke: sawFail,
      detail: `exit ${r.code}, FAIL rows: ${failLines.length ? failLines.join(" / ") : "(none)"}; expected: ${m.mustBreak}`,
    })
    restore()
    restoreNeeded = false
    console.log(`${sawFail ? "KILLED  " : "SURVIVED"} ${m.id.padEnd(38)} ${m.defect}`)
    if (!sawFail) console.log(`         expected break: ${m.mustBreak}`)
  }
} finally {
  if (restoreNeeded) restore()
}

console.log(`\nanalyzer restored: sha256 ${createHash("sha256").update(readFileSync(ANALYZER, "utf8")).digest("hex") === originalHash}`)
const survivors = rows.filter((r) => !r.broke)
console.log(`mutants: ${rows.length - survivors.length}/${rows.length} killed, ${survivors.length} survived`)
if (survivors.length) {
  console.log("\n>>> THIS SCRIPT FAILS. These mutants are alive:")
  for (const s of survivors) console.log(`    ${s.id} — ${s.detail}`)
  process.exitCode = 1
}
if (existsSync(SCRATCH)) rmSync(SCRATCH)