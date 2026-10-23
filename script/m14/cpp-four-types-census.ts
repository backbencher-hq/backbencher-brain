/**
 * CPP FOUR-TYPE NEAR-MISS CENSUS — THE COUNTS THAT MAKE A VERDICT CREDIBLE (L-2026-10-21-20).
 *
 * ## WHY THIS INSTRUMENT EXISTS
 *
 * The four re-opened types (`decorates`, `renders`, `mixes_in`, `part_of`) each need a NEAR MISS
 * NAMED and COUNTED, not a node list. The doctrine's rule (L-17): THE NEAR-MISS CENSUS IS HOW A
 * RULING IS EARNED. A ruling with no count is a claim; a ruling with a count of the sites that
 * LOOKED like the construct and are not is a measurement.
 *
 * For each of the four it counts, over the ADMITTED POPULATION, the AST node types that are the
 * nearest thing C++ HAS:
 *
 *   · `decorates`  — the nearest thing is a STANDARD ATTRIBUTE on a declaration
 *                     (`attribute_specifier` / `attributed_declarator` / `attribute_declaration`).
 *                     The test is csharp's: does the attribute APPLY A CALLABLE, or MARK the
 *                     declaration? Marking is not applying ⇒ the near-miss count is the number of
 *                     MARKING sites, and the answering count is the number of APPLYING sites.
 *   · `renders`    — the nearest thing is a TEMPLATE that produces a type
 *                     (`template_declaration` / `template_instantiation` / `template_type`).
 *                     The test is the contract's: a rendering construct NAMES A COMPONENT. The
 *                     answering count is the number of call sites whose callee names a TYPE
 *                     ARGUMENT, i.e. the C#-lane shape `RenderComponent<Widget>()`.
 *   · `mixes_in`   — the nearest thing is a BASE CLAUSE (`base_class_clause`), which the contract
 *                     says is NOT `mixes_in` (a base clause IS an inheritance clause and C++ has a
 *                     single base). The answering count is the number of sites that COMPOSE SEVERAL
 *                     bases into one chain, which is what `with` does and C++ does not have.
 *   · `part_of`    — the nearest thing is an INCLUDE (`preproc_include`). The contract's test: does
 *                     the target SHARE the including unit's single scope and CANNOT be resolved as
 *                     a separate module? The answering count is the number of include targets that
 *                     RESOLVE AS SEPARATE MODULES (their own file, their own scope).
 *
 * ## WHAT IT DOES NOT CLAIM
 *
 * It does not decide any of the four; it counts the population each decision is made over, and it
 * says which count is the ANSWERING one and which is the NEAR-MISS one, so the verdict that cites
 * it is checkable.
 *
 * ## USAGE
 *
 *   bun run script/m14/cpp-four-types-census.ts --json out.json [--max-files 0]
 */
import { readFileSync, writeFileSync } from "node:fs"
import { extensionsFor } from "./language-extensions"
let admitted: string[] = []
const ADMITTED_FROM = `${process.env.BB_CORPUS_ROOT ?? path.join(process.cwd(), ".corpus")} (git-tracked + extension map + 1 MB cap)`
import * as path from "node:path"
import { execFileSync } from "node:child_process"

const ROOT = process.cwd()
const argOf = (f: string): string | null => {
  const j = process.argv.find((a) => a.startsWith(`${f}=`))
  return j ? j.slice(f.length + 1) : null
}
const JSON_OUT = argOf("--json")
const MAX_FILES = Number(argOf("--max-files") ?? 0)

// ── the admitted population: THE LANE'S OWN RULE, byte-for-byte the denominators script's ──────
// (git-tracked paths + the lane's extension map + the engine's 1 MB per-file cap), so this census
// and the cell's three denominators are over THE SAME population.
import { readdirSync, statSync } from "node:fs"
// ★ THE POPULATION IS THE ONE TABLE'S, NOT THIS FILE'S (2026-10-22, cpp lane).
//
// MEASURED, NOT INHERITED: `bun script/m14/shape-agreement-scan.ts --shape=hand-written-extension-map`
// reports that the ONE TABLE at `script/m14/language-extensions.ts:142` holds ELEVEN cpp spellings
// (.c++ .cc .cpp .cu .cxx .h .hh .hpp .hxx .inl .ipp) while this lane's hand-written list held NINE —
// it OMITTED `.h` and `.hh`. Over the farm root's 31 repos that is 18,370 tracked header files that
// were never in the lane's population, so EVERY count measured before this change — 7,435 admitted
// files, and the four-types census's 2,843 / 51,874 / 310,252 / 4,279 / 1,262 — is a LOWER BOUND over
// the source spellings, NOT a whole-population number.
//
// ⇒ THE INSTRUMENT AND THE DENOMINATOR MUST COUNT THE SAME POPULATION. A table duplicated in two
// places is one table that will diverge, and this one had already diverged.
// ⇒ AND ONE FACT THE RE-MEASUREMENT MUST STATE RATHER THAN ASSUME: `.h` is ALSO claimed by the `c`
// entry of the SAME table, so adopting the eleven makes the population the ROUTER'S assignment rather
// than an extension's, and a `.h` file may be the c lane's by content.
const ADMITTED_EXTS = extensionsFor("cpp").map((e) => (e.startsWith(".") ? e.slice(1) : e))
const SIZE_CAP = 1024 * 1024
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
for (const name of readdirSync(CR).sort()) {
  const dir = path.join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const dot = rel.lastIndexOf(".")
    if (dot < 0) continue
    if (!ADMITTED_EXTS.includes(rel.slice(dot + 1).toLowerCase())) continue
    const abs = path.join(dir, rel)
    let size = 0
    try { size = statSync(abs).size } catch { continue }
    if (size > SIZE_CAP) continue
    admitted.push(abs)
  }
}
if (MAX_FILES > 0) admitted = admitted.slice(0, MAX_FILES)

const { Parser, Language } = await import("web-tree-sitter")
await Parser.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const wasm = readFileSync(path.join(ROOT, "wasm/tree-sitter-cpp.wasm"))
const lang: any = await Language.load(wasm as any)
const parser = new Parser()
parser.setLanguage(lang)

/** Count every named node of the given types, and the answering predicate over the same tree. */
const NEAR_MISS: Record<string, string[]> = {
  decorates: ["attribute_specifier", "attribute_declaration", "attributed_declarator", "attributed_statement", "attribute"],
  renders: ["template_declaration", "template_instantiation", "template_type", "template_method", "template_function", "template_argument_list"],
  mixes_in: ["base_class_clause"],
  part_of: ["preproc_include"],
}
const counts: Record<string, number> = {}
for (const k of Object.keys(NEAR_MISS)) counts[k] = 0
let answering = { decoratesApplies: 0, rendersNamesComponent: 0, mixesComposes: 0, partSharesScope: 0 }
let filesRead = 0
let filesFailed = 0
let includeTargetsSeparateModule = 0
let includeTargetsTotal = 0

const walk = (n: any, visit: (x: any) => void): void => {
  visit(n)
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c) walk(c, visit)
  }
}

for (const file of admitted) {
  let src = ""
  try { src = readFileSync(file, "utf8") } catch { filesFailed++; continue }
  let tree: any
  try { tree = parser.parse(src) } catch { filesFailed++; continue }
  filesRead++
  walk(tree.rootNode, (n: any) => {
    for (const [k, types] of Object.entries(NEAR_MISS)) {
      if (types.includes(n.type)) counts[k]++
    }
    // `renders`: a call whose callee names a TYPE ARGUMENT — the C#-lane shape, in C++ spelling.
    if (n.type === "call_expression") {
      const fn = n.childForFieldName?.("function")
      const args = n.childForFieldName?.("arguments")
      if (fn && args) {
        const targs = args.namedChildren?.filter((a: any) => a.type === "template_type" || a.type === "type_identifier") ?? []
        if (targs.length > 0) answering.rendersNamesComponent++
      }
    }
    // `mixes_in`: SEVERAL bases composed into ONE chain (the `with` shape), not one base.
    if (n.type === "base_class_clause") {
      const specs = n.namedChildren?.filter((c: any) => c.type === "access_specifier" || c.type === "type_identifier" || c.type === "qualified_identifier" || c.type === "template_type") ?? []
      if (specs.length > 1) answering.mixesComposes++
    }
    // `part_of`: the include's target — does it resolve as a SEPARATE module (its own file)?
    if (n.type === "preproc_include") {
      includeTargetsTotal++
      const p = n.childForFieldName?.("path")
      const raw = String(p?.text ?? "").replace(/^[<"]|[>"]$/g, "").trim()
      if (raw) {
        // a quoted include is a FILE of the same unit (textually included ⇒ shares the unit's scope);
        // an angle-bracket include is a SEPARATE module's header (its own scope, its own module).
        if (p?.text?.startsWith('"')) answering.partSharesScope++
        else includeTargetsSeparateModule++
      }
    }
    // `decorates`: an attribute that APPLIES A CALLABLE — the attribute's argument is a call, not
    // a marker word. `[[nodiscard]]` marks; `[[gnu::always_inline]]` marks; `[[test::foo(1)]]`
    // APPLIES. The distinction is whether the attribute carries an ARGUMENT LIST.
    if (n.type === "attribute_specifier" || n.type === "attribute") {
      const hasArgs = n.namedChildren?.some((c: any) => c.type === "argument_list") ?? false
      if (hasArgs) answering.decoratesApplies++
    }
  })
  // ★ THE WASM MODULE GROWS WITH EVERY PARSE AND ABORTS AT ~7,600 (Lead-measured, 2026-10-22):
  // WITHOUT THIS DELETE the module dies part-way through the population and every later file is
  // counted as a `filesFailed`. That is exactly what this instrument's first run over the TRUE
  // population did: 8,014 read and 15,223 failed of 23,237 — and the 15,223 were the INSTRUMENT's
  // leaked trees, not the files. The 7,435-file population fitted UNDER the abort point, which is
  // why the defect was invisible until the population was reconciled to the ONE extension table.
  tree.delete()
}

const out = {
  instrument: "script/m14/cpp-four-types-census.ts",
  population: { source: ADMITTED_FROM, filesAdmitted: admitted.length, filesRead, filesFailed },
  nearMissCounts: counts,
  answeringCounts: answering,
  includeTargets: { total: includeTargetsTotal, separateModule: includeTargetsSeparateModule, sharesUnitScope: answering.partSharesScope },
  reading: {
    decorates: "the NEAR MISS is the attribute site; the ANSWERING count is the attribute that CARRIES AN ARGUMENT LIST (applies a callable) — a marker attribute carries none",
    renders: "the NEAR MISS is the template site; the ANSWERING count is a call whose callee NAMES A TYPE ARGUMENT (the C#-lane shape)",
    mixes_in: "the NEAR MISS is the base clause; the ANSWERING count is a clause COMPOSING SEVERAL bases into one chain (the `with` shape C++ does not have)",
    part_of: "the NEAR MISS is the include; the ANSWERING count is the quoted include (a fragment sharing the unit's scope) vs the angle-bracket include (a separate module's header)",
  },
}
console.log(JSON.stringify(out, null, 2))
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(out, null, 2))
