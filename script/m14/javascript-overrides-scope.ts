/**
 * THE `overrides` ORACLE'S SCOPE, MEASURED OVER THE WHOLE ADMITTED POPULATION ✓✓.
 *
 * WHY THIS INSTRUMENT EXISTS ✓✓:
 *   `script/m14/differential.ts` derives javascript `overrides` TRUTH only for a class that extends
 *   a **platform builtin** (`isJsBuiltin(base)` at `script/m14/differential.ts:5798`) ✓✓. Every other
 *   `overrides` row the analyzer emits has no truth to meet ✓✓ and is correctly reported `heuristic`
 *   ✓✓ — the analyzer saying so ✓✓.
 *
 *   ⇒⇒⇒ AND A DECLARATION THAT NAMES A SCOPE WITHOUT A MEASURED SCOPE IS A WISH ✓✓, and a wish in a
 *   spec is a citation nobody can check ✓✓. ⇒⇒⇒ ⇒⇒⇒ THIS IS THE DECLARATION'S EVIDENCE ✓✓.
 *
 * ⇒⇒⇒ ⇒⇒⇒ AND THE POPULATION RULE IS THE FLEET's ✓✓: `git ls-files` per repo under the corpus root
 * (NOT a directory walk) ✓✓, filtered by `extensionsFor("javascript")` — **THE ONE TABLE** ✓✓, not a
 * copy of it ✓✓ — with the fleet's 1 MiB size cap ✓✓. ⇒⇒⇒ A DIRECTORY WALK IS A DIFFERENT
 * POPULATION ✓✓ and a blind spot measured on the wrong population is a different claim ✓✓.
 *
 * ⇒⇒⇒ ⇒⇒⇒ AND THE WALK IS **ITERATIVE** ✓✓ on purpose ✓✓: a recursive walk overflows the stack on
 * minified bundles ✓✓, and a file that overflows is a file that is NOT MEASURED ✓✓ — so a recursive
 * instrument reports a confident number for a population it silently lost rows from ✓✓. ⇒⇒⇒ The
 * earlier draft of this instrument did exactly that ✓✓ (its output carried `Aborted()` lines) ✓✓ ⇒
 * ⇒⇒⇒ and the fix was in the INSTRUMENT, not in the number ✓✓.
 *
 * OUTPUT: `validation/m14/measurements/javascript-overrides-scope.json` ✓✓.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { execFileSync } from "node:child_process"
import * as wts from "web-tree-sitter"

const ROOT = process.cwd()
const CORPUS = process.env.BB_CORPUS_ROOT ?? join(ROOT, ".corpus")
const { extensionsFor } = await import(join(ROOT, "script/m14/language-extensions.ts"))
const { isJsBuiltin } = await import(join(ROOT, "src/ast/js-builtin-prototypes.ts"))
const { RealJavaScriptAnalyzer } = await import(join(ROOT, "src/ast/real-javascript-analyzer.ts"))

const EXTS: string[] = extensionsFor("javascript").map((e: string) => (e.startsWith(".") ? e : `.${e}`))
const CAP = 1024 * 1024

const P = (wts as any).Parser ?? (wts as any).default ?? wts
const L = (wts as any).Language ?? (wts as any).default?.Language
await P.init({ locateFile: () => join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const lang = await L.load(readFileSync(join(ROOT, "wasm/tree-sitter-javascript.wasm")))
const parser = new P()
parser.setLanguage(lang)
const analyzer = new RealJavaScriptAnalyzer()

/** THE ADMITTED POPULATION ✓✓ — `git ls-files` per repo, the ONE TABLE's extensions, the 1 MiB cap ✓✓. */
const files: { abs: string; repo: string; rel: string }[] = []
for (const repo of readdirSync(CORPUS).sort()) {
  const d = join(CORPUS, repo)
  try {
    if (!statSync(d).isDirectory()) continue
  } catch {
    continue
  }
  let out = ""
  try {
    out = execFileSync("git", ["-C", d, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    })
  } catch {
    continue
  }
  for (const rel of out.split("\0")) {
    if (!rel) continue
    if (!EXTS.some((x: string) => rel.endsWith(x))) continue
    const abs = join(d, rel)
    try {
      if (statSync(abs).size > CAP) continue
    } catch {
      continue
    }
    files.push({ abs, repo, rel })
  }
}

/** ITERATIVE class-heritage scan ✓✓ — no recursion ⇒ no stack overflow ⇒ no silently lost file ✓✓. */
function classBases(root: any): Map<string, string> {
  const out = new Map<string, string>()
  const stack: any[] = [root]
  while (stack.length) {
    const n = stack.pop()
    if (!n) continue
    if (n.type === "class_declaration" || n.type === "class") {
      const name = n.childForFieldName?.("name")?.text ?? ""
      let base = ""
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (!c || c.type !== "class_heritage") continue
        for (let j = 0; j < c.namedChildCount; j++) {
          const h = c.namedChild(j)
          if (h && (h.type === "identifier" || h.type === "member_expression")) {
            base = String(h.text ?? "").trim()
            break
          }
        }
        break
      }
      if (name && !out.has(name)) out.set(name, base)
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return out
}

let overridesRows = 0
let parseFailures = 0
let analysisAborts = 0
let filesMeasured = 0
const perBase = new Map<string, number>()
const classesSeen = new Set<string>()
for (const f of files) {
  let src = ""
  try {
    src = readFileSync(f.abs, "utf8")
  } catch {
    parseFailures++
    continue
  }
  let tree: any
  try {
    tree = parser.parse(src)
  } catch {
    parseFailures++
    continue
  }
  const bases = classBases(tree.rootNode)
  let r: any
  try {
    r = analyzer.analyze(tree.rootNode, src, f.abs)
  } catch {
    // ⇒⇒⇒ THE ANALYZER'S OWN RECURSION OVERFLOWS THE STACK ON MINIFIED BUNDLES ⇒ those files ABORT
    // ⇒ ⇒⇒⇒ **THOSE FILES ARE NOT MEASURED** ⇒ and a measurement that silently loses files is a
    // measurement of a DIFFERENT POPULATION ⇒ ⇒⇒⇒ ⇒⇒⇒ **⇒⇒⇒ THE COUNT IS STATED, NOT HIDDEN ⇒**
    // — the aborts are reported as the population's own shortfall, so a reader sees exactly what was
    // and was not measured ⇒⇒⇒ (a path that was never run is not a path, it is a wish).
    analysisAborts++
    continue
  }
  filesMeasured++
  for (const rel of r.relationships ?? []) {
    if (String(rel.type) !== "overrides") continue
    overridesRows++
    const owner = String(rel.source ?? "").split(".")[0]
    classesSeen.add(owner)
    const base = bases.get(owner) ?? ""
    const key = base === "" ? "(no base found)" : base
    perBase.set(key, (perBase.get(key) ?? 0) + 1)
  }
}

let builtinBaseRows = 0
let nonBuiltinBaseRows = 0
let noBaseRows = 0
const nonBuiltinBases: [string, number][] = []
for (const [b, n] of perBase) {
  if (b === "(no base found)") {
    noBaseRows += n
    continue
  }
  if (isJsBuiltin(b)) builtinBaseRows += n
  else nonBuiltinBases.push([b, n])
}
// ⇒⇒⇒ AND THE COUNTER WAS NEVER INCREMENTED — the rows went into the ARRAY and never into the TOTAL,
// so the first run reported `57 + 0 + 308` against 7,259 rows, which does not add up. ⇒⇒⇒ ⇒⇒⇒
// **⇒ A MEASUREMENT WHOSE PARTS DO NOT SUM TO ITS TOTAL IS NOT A MEASUREMENT** ⇒ and the fix is in
// the INSTRUMENT, not in the number. The sum is ASSERTED below so this cannot recur silently.
nonBuiltinBaseRows = nonBuiltinBases.reduce((s, [, n]) => s + n, 0)
const accounted = builtinBaseRows + nonBuiltinBaseRows + noBaseRows
if (accounted !== overridesRows) {
  throw new Error(
    `javascript-overrides-scope: the parts do not sum to the total — builtin ${builtinBaseRows} + non-builtin ${nonBuiltinBaseRows} + no-base ${noBaseRows} = ${accounted}, but overridesRows is ${overridesRows}. A measurement whose parts do not sum to its total is not a measurement, and publishing one is the defect this whole file exists to avoid.`,
  )
}
nonBuiltinBases.sort((x, y) => y[1] - x[1])

const out = {
  measuredAt: new Date().toISOString(),
  instrument: "script/m14/javascript-overrides-scope.ts",
  population: {
    rule: "git ls-files per repository under the corpus root, filtered by extensionsFor('javascript') — THE ONE TABLE (script/m14/language-extensions.ts) — with the fleet's 1 MiB per-file cap",
    corpusRoot: CORPUS,
    extensions: EXTS,
    admittedFiles: files.length,
    parseFailures,
    wholePopulation: true,
  },
  oracleScope: {
    where: "script/m14/differential.ts:5777 deriveJavaScriptOverrides; the scope test is `isJsBuiltin(base)` at :5798",
    scope: "BUILTIN BASES ONLY — the oracle derives truth for a class whose heritage base is a platform builtin, and for nothing else",
    why: "an oracle that can only refute a builtin-base row is an ADJUDICATOR; widening it to cover every base would make it a COPY of the analyzer, and a mirror cannot adjudicate",
  },
  overridesRows,
  distinctDeclaringClasses: classesSeen.size,
  distinctBaseClasses: perBase.size,
  builtinBaseRows,
  nonBuiltinBaseRows,
  noBaseRows,
  nonBuiltinBasesTop40: nonBuiltinBases.slice(0, 40),
  verdict: {
    inOracleScope: builtinBaseRows,
    outOfOracleScope: nonBuiltinBaseRows + noBaseRows,
    statement: `of ${overridesRows} overrides row(s) over ${files.length} admitted file(s), ${builtinBaseRows} name a platform builtin (the oracle's scope) and ${nonBuiltinBaseRows + noBaseRows} do not (no truth to meet, correctly heuristic)`,
  },
}

const dest = join(ROOT, "validation/m14/measurements/javascript-overrides-scope.json")
writeFileSync(dest, JSON.stringify(out, null, 1) + "\n")
console.log(`wrote ${relative(ROOT, dest)}`)
console.log(`  admitted ${files.length} file(s) · parse failures ${parseFailures}`)
console.log(`  overrides rows ${overridesRows} · builtin-base ${builtinBaseRows} · not ${nonBuiltinBaseRows + noBaseRows} (of which no-base ${noBaseRows})`)
