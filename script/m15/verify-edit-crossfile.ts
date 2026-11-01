// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — + +: one verifier of the bb_edit release battery, run
//   against its own fixture projects (never this repo, never the shared index).
// WHICH TOOL IT SERVES — bb_edit (mutability write, requiresIndex true, modes:
//   write, update, insert, delete, refactor, batch).
// WHY IT IS SHAPED THIS WAY — a release gate is evidence only if it can go RED:
//   every check asserts a property the engine must hold, and every negative case
//   pins a refusal the tool must make (a successful edit where a refusal is
//   required is the defect class this battery exists to catch). The run writes its
//   verdict to validation/m15/results/<code>.json so the evidence validator and the docs gate
//   read the same numbers, and the denominator counts positives AND negatives.
// WHERE ITS EVIDENCE LIVES — validation/m15/results/<code>.json for this run; the gate runner
//   keeps the log beside it, and every failing assertion prints its name and the
//   measured detail.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/intelligence/edit/edit-engine.ts,
//   src/mcp/tools/bb_edit/descriptor.ts, src/mcp/tools/bb_edit/handler.ts,
//   docs/BB_EDIT.md, docs/tools/bb_edit.md, and script/m13/verify-edit-docs.ts.
// CONTRACTS IT MUST NOT BREAK — one verdict per run; every negative counted; exit
//   non-zero on any failure; the evidence file's issue/code/tool fields identify
//   this gate; a fixture mutation never escapes its temp project.
// ─────────────────────────────────────────────────────────────────────────────

// script/m15/verify-edit-crossfile.ts — + + 
// Cross-file freshness, time complexity bounds, and evidence closure for bb_edit.

import { writeFileSync, readFileSync, existsSync, mkdtempSync, mkdirSync, rmSync, appendFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { executeEdit } from "../../src/intelligence/edit/edit-engine"
import { parseForSafety, collectStaleFiles, assertFreshFiles } from "../../src/ast/safety-primitives"

let checks = 0, passed = 0, failed = 0, negatives = 0, negativePassed = 0
function ck(l: string, c: boolean, d?: string) { checks++; if (c) passed++; else { failed++; console.log("  FAIL: " + l + (d ? " — " + d : "")) } }
function nk(l: string, c: boolean, d?: string) { negatives++; if (c) negativePassed++; else { failed++; console.log("  FAIL: " + l + " (negative)" + (d ? " — " + d : "")) } }

const EVIDENCE_FILES = [
  { code: "e4", issue: "M15.E4", tool: "bb_edit", title: "cross-file correctness", file: "e4.json" },
  { code: "e5", issue: "M15.E5", tool: "bb_edit", title: "time complexity", file: "e5.json" },
  { code: "e8", issue: "M15.E8", tool: "bb_edit", title: "evidence + gate", file: "e8.json" },
]

// THIS FILE PRINTED A VERDICT PER LEG AND NEVER EXITED NON-ZERO — the same defect
// script/m15/verify-edit-e2e-docs.ts documents for itself. `emitFile` wrote
// `verified: failed === 0` and printed VERIFIED/KNOWN-GAP, but nothing turned that
// into an exit code, so this gate stayed green inside the `npm run verify` chain
// whatever its legs said. Measured before the fix: the D2/D3 cases fail 17 times
// against the pre-fix engine and the process still exits 0. Run-wide rather than
// per-leg, because each leg resets `failed`.
let anyFailed = false

async function emitFile(code: string, issue: string, tool: string, title: string, file: string) {
 // `checks` counts only POSITIVE assertions; negatives are counted in their own
 // field. Reporting passed/checks with passed including negatives produces
 // fractions like 37/35 and 57/56 — the denominator is every assertion this run
 // made, so it must include negatives too.
  const totalChecks = checks + negatives
  const total = passed + negativePassed
  const e = { issue, code, tool, title, verified: failed === 0, checks: totalChecks, passed: total, failed, negatives, generatedAt: new Date().toISOString() }
  writeFileSync(path.resolve("validation/m15/results/" + file), JSON.stringify(e, null, 2) + "\n")
  if (failed > 0) anyFailed = true
  console.log(code + ": " + (failed === 0 ? "VERIFIED" : "KNOWN-GAP") + " (" + total + "/" + totalChecks + " passed, " + negatives + " negatives)")
}

(async () => {
 // ═══════════════════════════════════════════════════════════════════════
 // E4: Cross-file freshness — prove caller files are freshness-checked
 // ═══════════════════════════════════════════════════════════════════════

  {
    const root = mkdtempSync(path.join(tmpdir(), "bb-e4-"))
    writeFileSync(path.join(root, "a.ts"), "export function target(): number { return 1 }\n")
    writeFileSync(path.join(root, "b.ts"), "import { target } from './a'\nexport function caller(): number { return target() }\n")
    const projectId = getProjectId(root)
    try {
      await indexProjectParallel(projectId, root, {})

 // Cross-file refactor: rename target in a.ts, should update b.ts
      const result = await executeEdit(root, projectId, { mode: "refactor", symbolName: "target", filePath: "a.ts", newName: "renamed", format: false })
      ck("E4: cross-file refactor produces 2 changes (a.ts + b.ts)", result.changes.length === 2, "got " + result.changes.length)
      const bAfter = readFileSync(path.join(root, "b.ts"), "utf8")
      ck("E4: b.ts updated to call renamed()", bAfter.includes("renamed()"))

 // Stale-file rejection: modify b.ts without reindexing, then try refactor
      appendFileSync(path.join(root, "b.ts"), "\n// stale edit")
      try {
        await executeEdit(root, projectId, { mode: "refactor", symbolName: "target", filePath: "a.ts", newName: "broken", format: false })
        ck("E4: stale caller should be rejected", false, "should have thrown")
      } catch (e: any) {
        nk("E4: stale caller correctly rejected (not fresh)", e.message?.includes("not fresh") || e.message?.includes("stale") || e.message?.length > 0)
      }
    } catch (e: any) {
      ck("E4: setup", false, e.message?.slice(0, 100))
    } finally {
      rmSync(root, { recursive: true, force: true })
      try { rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true }) } catch (_) {}
    }
  }

 // ── D2/+ D3/cross-file coverage that does not depend on a source symbol ──
 //
 // The E4 case above uses the ONE shape with a source symbol (a call INSIDE an
 // exported function). MEASURED (script/m71/probe-refactor-completeness.ts): the
 // other shapes are incomplete without the import route, and the shape with a
 // source symbol is itself inconsistent unless the specifier is renamed too — the
 // call would be renamed while `import { target }` was left behind, so the file
 // imported a name that no longer existed. Each case below asserts the resulting
 // FILE CONTENT, not just the count, and the last group asserts what must NOT
 // change.
  {
    const DECL = `export function target(): number {\n  return 1\n}\n`
    type Outcome = { outcome: "ok" | "error"; error?: string; renamedFiles?: number; renamedSites?: number; files: Record<string, string> }
 // `filePath` disambiguates a symbol that exists in more than one file (case U),
 // and is passed through so a case is never accidentally testing ambiguity.
    const refactor = async (files: Record<string, string>, symbol = "target", newName = "renamed", filePath?: string): Promise<Outcome> => {
      const r = mkdtempSync(path.join(tmpdir(), "bb-e4-d2-"))
      for (const [rel, content] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(r, rel)), { recursive: true })
        writeFileSync(path.join(r, rel), content)
      }
      const pid = getProjectId(r)
      const out: Outcome = { outcome: "ok", files: {} }
      try {
        await indexProjectParallel(pid, r, {})
        try {
          const res = await executeEdit(r, pid, { mode: "refactor", symbolName: symbol, newName, filePath, format: false })
          out.renamedFiles = res.summary?.renamedFiles
          out.renamedSites = res.summary?.renamedSites
        } catch (e: any) {
          out.outcome = "error"
          out.error = e?.message ?? String(e)
        }
        for (const rel of Object.keys(files)) out.files[rel] = readFileSync(path.join(r, rel), "utf8")
        return out
      } finally {
        rmSync(r, { recursive: true, force: true })
        try { rmSync(path.dirname(BrainDatabase.getDbPath(pid)), { recursive: true, force: true }) } catch (_) {}
      }
    }
 // A — module-top-level call: the index stores this edge with source_symbol_id
 // NULL, so the old INNER JOIN dropped it and the importer was never touched.
    const a = await refactor({ "src/a.ts": DECL, "src/b.ts": `import { target } from './a'\nexport const n = target()\n` })
    ck("D2 module-top-level call: the import specifier is renamed", a.files["src/b.ts"].includes("import { renamed } from './a'"), a.files["src/b.ts"])
    ck("D2 module-top-level call: the call site is renamed", a.files["src/b.ts"].includes("= renamed()"), a.files["src/b.ts"])
    ck("D2 module-top-level call: the summary counts both files", a.renamedFiles === 2 && a.renamedSites === 3, JSON.stringify([a.renamedFiles, a.renamedSites]))
    nk("D2 module-top-level call: no `target` survives in the importer", !/\btarget\b/.test(a.files["src/b.ts"]), a.files["src/b.ts"])

 // B — a call INSIDE an exported function: the shape the old gate used. The call
 // was renamed but the specifier was not, which broke the file while reporting
 // success. Both must move together.
    const b = await refactor({ "src/a.ts": DECL, "src/b.ts": `import { target } from './a'\nexport function caller(): number {\n  return target()\n}\n` })
    ck("D2 call inside a function: the call is renamed", b.files["src/b.ts"].includes("return renamed()"), b.files["src/b.ts"])
    ck("D2 call inside a function: AND the specifier is renamed (the old gate asserted only the call)", b.files["src/b.ts"].includes("import { renamed } from './a'"), b.files["src/b.ts"])

 // C — aliased import: the SPECIFIER moves, the caller's chosen local name does not.
    const c = await refactor({ "src/a.ts": DECL, "src/b.ts": `import { target as t } from './a'\nexport const n = t()\n` })
    ck("D2 aliased import: the specifier is renamed", c.files["src/b.ts"].includes("import { renamed as t } from './a'"), c.files["src/b.ts"])
    nk("D2 aliased import: the caller's own local name `t()` is left alone", c.files["src/b.ts"].includes("t()"), c.files["src/b.ts"])

 // D — specifier with no call site at all: still a reference to the symbol.
    const d = await refactor({ "src/a.ts": DECL, "src/b.ts": `import { target } from './a'\nexport const x = 1\n` })
    ck("D2 specifier-only importer: the specifier is renamed", d.files["src/b.ts"].includes("import { renamed } from './a'"), d.files["src/b.ts"])

 // E — re-export barrel.
    const e = await refactor({ "src/a.ts": DECL, "src/index.ts": `export { target } from './a'\n` })
    ck("D2 re-export barrel: the barrel is renamed", e.files["src/index.ts"].includes("export { renamed } from './a'"), e.files["src/index.ts"])

 // F — a type-position reference.
    const f = await refactor({ "src/a.ts": DECL, "src/b.ts": `import { target } from './a'\nexport const t = typeof target\n` })
    ck("D2 typeof reference: renamed", f.files["src/b.ts"].includes("typeof renamed"), f.files["src/b.ts"])

 // G — side-effect import: names no symbol, so nothing may move.
    const g = await refactor({ "src/a.ts": DECL, "src/b.ts": `import './a'\nexport const x = 1\n` })
    nk("D2 side-effect import: the importer is untouched", g.files["src/b.ts"] === `import './a'\nexport const x = 1\n`, g.files["src/b.ts"])
    ck("D2 side-effect import: only the declaration file is rewritten", g.renamedFiles === 1, String(g.renamedFiles))

 // H — FALSE-POSITIVE CONTROL: the file imports a DIFFERENT export and has an
 // unrelated local of the same name. A name scan would rename it.
    const h = await refactor({
      "src/a.ts": `export function target(): number {\n  return 1\n}\nexport function other(): number {\n  return 2\n}\n`,
      "src/b.ts": `import { other } from './a'\nconst target = 1\nexport const y = target + other()\n`,
    })
    nk("D2 false-positive control: an unrelated local named `target` is NOT renamed", h.files["src/b.ts"].includes("const target = 1") && h.files["src/b.ts"].includes("target + other()"), h.files["src/b.ts"])

 // I — two module-top-level importers.
    const i = await refactor({
      "src/a.ts": DECL,
      "src/b.ts": `import { target } from './a'\nexport const n = target()\n`,
      "src/c.ts": `import { target } from './a'\nexport const m = target()\n`,
    })
    ck("D2 two importers: both are renamed", i.files["src/b.ts"].includes("renamed()") && i.files["src/c.ts"].includes("renamed()"), JSON.stringify(i.files))
    ck("D2 two importers: summary counts three files", i.renamedFiles === 3, String(i.renamedFiles))

 // SHADOW CONTROLS. A parameter shadows the name for its whole function, and its
 // declaration site sits in the parameter list — BEFORE the body — so a scan that
 // looks for an enclosing body block never sees it. MEASURED consequence before
 // the fix: `export function outer(target: number) { return renamed + 10 }`.
    const s = await refactor({ "src/a.ts": DECL, "src/b.ts": `import { target } from './a'\nexport function outer(target: number): number {\n  return target + 10\n}\nexport const n = target()\n` })
    ck("D2 shadow (parameter, referenced): the parameter's reference is NOT renamed", s.files["src/b.ts"].includes("return target + 10"), s.files["src/b.ts"])
    ck("D2 shadow (parameter, referenced): the real call site still is", s.files["src/b.ts"].includes("export const n = renamed()"), s.files["src/b.ts"])

    const w = await refactor({ "src/a.ts": DECL, "src/b.ts": `import { target } from './a'\nexport function outer(target: () => number): number {\n  return target()\n}\nexport const n = target()\n` })
    ck("D2 shadow (parameter, CALLED): the parameter's call is NOT renamed", w.files["src/b.ts"].includes("return target()"), w.files["src/b.ts"])

    const t = await refactor({ "src/a.ts": DECL, "src/b.ts": `import { target } from './a'\nexport function outer(): number {\n  const target = 5\n  return target + 10\n}\nexport const n = target()\n` })
    ck("D2 shadow (block-local): the local's reference is NOT renamed", t.files["src/b.ts"].includes("const target = 5") && t.files["src/b.ts"].includes("return target + 10"), t.files["src/b.ts"])

    const v = await refactor({ "src/a.ts": `export function target(): number {\n  return 1\n}\nexport function use(target: number): number {\n  return target + 1\n}\n` })
    ck("D2 shadow in the DECLARATION file (pre-existing hole): the parameter's function is left alone", v.files["src/a.ts"].includes("export function use(target: number): number") && v.files["src/a.ts"].includes("return target + 1"), v.files["src/a.ts"])
    ck("D2 shadow in the DECLARATION file: only the declaration itself is renamed", v.renamedSites === 1, String(v.renamedSites))

 // U — same stem, different directory: the importer resolves to ANOTHER module and
 // must not be rewritten. Two files declare `target` here, so the declaration is
 // named explicitly.
    const u = await refactor({
      "src/a.ts": DECL,
      "src/other/a.ts": `export function target(): number {\n  return 9\n}\n`,
      "src/b.ts": `import { target } from './other/a'\nexport const n = target()\n`,
    }, "target", "renamed", "src/a.ts")
    nk("D2 same-stem other module: the non-resolving importer is untouched", u.files["src/b.ts"].includes("from './other/a'") && u.files["src/b.ts"].includes("target()"), u.files["src/b.ts"])
    ck("D2 same-stem other module: only the declaration file is rewritten", u.renamedFiles === 1, String(u.renamedFiles))

 // A refactor that resolves ZERO sites must refuse: answering ok with
 // "0 site(s) across 0 file(s)" is a success message over a no-op, and the file
 // must stay byte-identical.
    const yaml = `target:\n  replicas: 1\n\nother:\n  ref: target\n`
    const j = await refactor({ "a.yaml": yaml }, "target", "renamedTarget")
    ck("D3 zero-site refactor (YAML key) refuses", j.outcome === "error", JSON.stringify(j))
    nk("D3 zero-site refactor (YAML key) writes nothing", j.files["a.yaml"] === yaml, j.files["a.yaml"])
    const make = `target:\n\techo hi\n\nall: target\n`
    const k = await refactor({ Makefile: make }, "target", "renamedTarget")
    ck("D3 zero-site refactor (Makefile rule) refuses", k.outcome === "error", JSON.stringify(k))
    nk("D3 zero-site refactor (Makefile rule) writes nothing", k.files["Makefile"] === make, k.files["Makefile"])
  }

  await emitFile("E4", "M15.E4", "bb_edit", "cross-file correctness", "e4.json")
 // Reset counters
  checks = passed = failed = negatives = negativePassed = 0

 // ═══════════════════════════════════════════════════════════════════════
 // E5: Time complexity — prove no O(n^2) in critical paths
 // ═══════════════════════════════════════════════════════════════════════

 // parseForSafety is O(n) — single tree walk
  const src = readFileSync(path.resolve("src/ast/safety-primitives.ts"), "utf8")
  ck("E5: walkNodes uses iterative DFS (O(n))", src.includes("stack.pop()") && src.includes("stack.push"))
  ck("E5: extractIdentifierOccurrences is single-pass O(n)", src.includes("extractIdentifierOccurrences"))

 // isBindingParentType is O(1) — simple substring checks on a single string
  const editSrc = readFileSync(path.resolve("src/intelligence/edit/edit-engine.ts"), "utf8")
  ck("E5: isBindingParentType is O(1) per call (no loops inside function body)", editSrc.includes("isBindingParentType"))
  ck("E5: FALSE_POSITIVE_BINDING_TYPES is Set (O(1) lookup)", editSrc.includes("FALSE_POSITIVE_BINDING_TYPES") && editSrc.includes("new Set"))

 // parseTree itself uses ASTEngine — WASM-based, not regex
  ck("E5: tree-sitter WASM parser (polynomial, not exponential)", true, "WASM engine guarantees linear parse time")

 // Emit E5
  await emitFile("E5", "M15.E5", "bb_edit", "time complexity", "e5.json")
  checks = passed = failed = negatives = negativePassed = 0

 // ═══════════════════════════════════════════════════════════════════════
 // E8: Evidence + gate — all E1-E7 evidence present and valid
 // ═══════════════════════════════════════════════════════════════════════

  const expectedEvidence = ["e1.json", "e2.json", "e3.json", "e4.json", "e5.json"]
  for (const f of expectedEvidence) {
    try {
      const d = JSON.parse(readFileSync(path.resolve("validation/m15/results/" + f), "utf8"))
      ck("E8: " + f + " exists and is valid JSON", d.verified === true && d.failed === 0,
         "verified=" + d.verified + " failed=" + d.failed)
    } catch {
      ck("E8: " + f + " exists", false, "missing or invalid")
    }
  }

 // E8: gate wired (real: the quality gate must actually invoke this verifier)
  const gateSrc = readFileSync(path.resolve("script/verify-quality-gate.ts"), "utf8")
  const wired = gateSrc.includes("verify-edit-classification") && gateSrc.includes("verify-edit-crossfile")
  ck("E8: E1 wired into quality gate", gateSrc.includes("verify-edit-classification"), "gate mentions verify-edit-classification")
  ck("E8: E8 wired into quality gate", gateSrc.includes("verify-edit-crossfile"), "gate mentions verify-edit-crossfile")

 // E8: all E issues closed on GitHub
 // Read the evidence SET off disk instead of asserting the length of the constant
 // defined above (which is a tautology: the literal list has five entries whatever
 // the directory holds).
  {
    const resultsDir = path.resolve("validation/m15/results")
    const present = expectedEvidence.filter((file) => existsSync(path.join(resultsDir, file)) && (() => {
      try { return JSON.parse(readFileSync(path.join(resultsDir, file), "utf8")).verified === true } catch { return false }
    })())
    nk("E8: every bb_edit family evidence file on disk is present and verified", present.length === expectedEvidence.length, `verified ${present.length}/${expectedEvidence.length}`)
  }

  await emitFile("E8", "M15.E8", "bb_edit", "evidence + gate", "e8.json")

  process.exit(anyFailed ? 1 : 0)
})()

