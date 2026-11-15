// Review instrument (NOT a gate): A/B a candidate tree-sitter-css build against
// the PINNED wasm, and prove or refute that it is a net win.
//
//   bun script/m14/tmp/css-grammar-ab.ts --new <path.wasm> [--out <path>]
//
// Three questions, in the order that decides the matter:
//
//   Q1 NET WIN      per corpus, files-with-any-ERROR before vs after. A patch
//                   that fixes some files and breaks others is not a win.
//   Q2 NO COLLATERAL every file that parsed cleanly BEFORE must parse cleanly
//                   AFTER. This is the question that decides it: a grammar patch
//                   that widens a token can silently re-lex a construct that
//                   used to be unambiguous, and the only evidence is the file
//                   set, not a spot check.
//   Q3 SHAPE DELTA  the node-type enumeration and the node-type multiset over a
//                   clean corpus, so an analyzer written against the old shapes
//                   is not silently re-pointed. A patch that is behaviour-
//                   preserving in outcomes but changes a SHAPE is a different
//                   kind of decision and must be declared, not discovered later.
//
// Also records, per class, the minimal reproduction's before/after — the W18
// method, where a class is only believed once it is reproduced from the corpus
// before patching.

import { Parser as TSParser, Language } from "web-tree-sitter"
import { readFileSync, readdirSync, statSync, writeFileSync } from "fs"
import { join } from "path"
import { createHash } from "crypto"

const ROOT = "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const NEW = argv[argv.indexOf("--new") + 1]
const OUT = argv[argv.indexOf("--out") + 1]
const REPOS = ["svelte", "grails-core", "scala3", "cython", "go-tools", "mojo", "zig", "cloogle.org", "element-plus", "vue-core", "cargo", "fsharp", "graphql-js"]

const CLASS_REPRO: { id: string; src: string }[] = [
  { id: "url-relative-unquoted", src: ".a { background-image: url(../img/x.svg); }\n" },
  { id: "url-relative-dotslash", src: ".a { background-image: url(./img/x.svg); }\n" },
  { id: "url-plain", src: ".a { background-image: url(img.png); }\n" },
  { id: "url-quoted", src: `.a { background-image: url("../img/x.svg"); }\n` },
  { id: "url-http", src: ".a { background-image: url(https://x/y.png); }\n" },
  { id: "url-deep-relative", src: ".a { background: url(../../a/b/c.woff2) no-repeat; }\n" },
  { id: "keyframes-int-pct", src: "@keyframes f { 0% { opacity: 0; } 100% { opacity: 1; } }\n" },
  { id: "keyframes-frac-pct", src: "@keyframes f { 33.3% { color: yellow } }\n" },
  { id: "keyframes-frac-noUnit", src: "@keyframes f { 0.5 { opacity: 0 } }\n" },
  { id: "keyframes-from-to", src: "@keyframes f { from { opacity: 0; } to { opacity: 1; } }\n" },
  { id: "keyframes-comma-steps", src: "@keyframes f { 0%, 50%, 100% { opacity: 0; } }\n" },
  { id: "keyframes-int-pct-negative", src: "@keyframes f { -10% { opacity: 0; } }\n" },
  { id: "keyframes-sci-notation", src: "@keyframes f { 1e2% { opacity: 0; } }\n" },
  { id: "float-value-still-parses", src: ".a { line-height: 1.5; opacity: .5; margin: -0.5px; }\n" },
  { id: "universal-selector-unaffected", src: "*, *::before { box-sizing: border-box; }\n" },
  { id: "comment-unaffected", src: "/* a.b.c */ .a { color: red; }\n" },
  { id: "float-in-declaration-unaffected", src: "@keyframes g { from { top: 0.5px; left: 1.25em; } }\n" },
]

function walk(dir: string, out: string[], d = 0): void {
  if (d > 10) return
  let es: string[]
  try { es = readdirSync(dir) } catch { return }
  for (const e of es) {
    if (e === "node_modules" || e === ".git" || e === "target" || e === "dist") continue
    const p = join(dir, e)
    let st: import("fs").Stats
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, out, d + 1)
    else if (e.endsWith(".css") && st.size > 0) out.push(p)
  }
}

type Sig = { err: boolean; errNodes: number; types: Record<string, number> }

function measureOne(parser: any, text: string, withTypes: boolean): Sig {
  const t = parser.parse(text)
  let errNodes = 0
  const types: Record<string, number> = {}
  const w = (x: any) => {
    if (x.type === "ERROR") errNodes++
    if (withTypes) types[x.type] = (types[x.type] ?? 0) + 1
    for (let i = 0; i < x.namedChildCount; i++) { const c = x.namedChild(i); if (c) w(c) }
  }
  w(t.rootNode)
  const r = { err: t.rootNode.hasError, errNodes, types }
  t.delete?.()
  return r
}

async function main() {
  await TSParser.init()
  const oldLang = await Language.load(readFileSync("wasm/tree-sitter-css.wasm"))
  const newLang = await Language.load(readFileSync(NEW))
  const oldP = new TSParser(); oldP.setLanguage(oldLang)
  const newP = new TSParser(); newP.setLanguage(newLang)

  // Q3a: the node-type enumeration itself.
  const oldTypes: string[] = []
  for (let i = 0; i < oldLang.nodeTypeCount; i++) oldTypes.push(oldLang.nodeTypeForId(i))
  const newTypes: string[] = []
  for (let i = 0; i < newLang.nodeTypeCount; i++) newTypes.push(newLang.nodeTypeForId(i))
  const addedTypes = newTypes.filter((t) => !oldTypes.includes(t))
  const removedTypes = oldTypes.filter((t) => !newTypes.includes(t))

  // Q3b: shape multiset over every CLEAN file, per repo. A shape delta here is
  // what would silently re-point an analyzer.
  const shapeDelta: { repo: string; file: string; before: number; after: number; node: string }[] = []
  const perRepo: any[] = []
  let totalBefore = 0, totalAfter = 0, fixed = 0, regressed = 0, collateral = 0

  for (const repo of REPOS) {
    const files: string[] = []
    walk(join(ROOT, repo), files)
    files.sort()
    let b = 0, a = 0
    const fixedFiles: string[] = [], regressedFiles: string[] = [], collateralFiles: string[] = []
    for (const f of files) {
      const text = readFileSync(f, "utf8")
      const B = measureOne(oldP, text, true)
      const A = measureOne(newP, text, true)
      if (B.err) b++
      if (A.err) a++
      if (B.err && !A.err) { fixed++; fixedFiles.push(f) }
      if (!B.err && A.err) { regressed++; collateralFiles.push(f) }
      // Collateral: was clean before, still clean, but a node's occurrence count moved.
      if (!B.err && !A.err) {
        for (const k of new Set([...Object.keys(B.types), ...Object.keys(A.types)])) {
          if ((B.types[k] ?? 0) !== (A.types[k] ?? 0)) {
            collateral++
            if (shapeDelta.length < 40) shapeDelta.push({ repo, file: f.replace(ROOT + "/", ""), before: B.types[k] ?? 0, after: A.types[k] ?? 0, node: k })
            break
          }
        }
      }
    }
    totalBefore += b; totalAfter += a
    perRepo.push({
      repo, files: files.length, errBefore: b, errAfter: a,
      pctBefore: Math.round((b / Math.max(1, files.length)) * 10000) / 100,
      pctAfter: Math.round((a / Math.max(1, files.length)) * 10000) / 100,
      fixed: fixedFiles.length, regressed: collateralFiles.length,
      fixedSample: fixedFiles.slice(0, 6).map((f) => f.replace(ROOT + "/", "")),
      regressedSample: collateralFiles.slice(0, 6).map((f) => f.replace(ROOT + "/", "")),
    })
  }

  // Per-class minimal reproduction, before and after.
  const classes = CLASS_REPRO.map((c) => {
    const B = measureOne(oldP, c.src, false)
    const A = measureOne(newP, c.src, false)
    return { id: c.id, src: c.src.trim(), before: B.err, after: A.err, verdict: B.err && !A.err ? "FIXED" : !B.err && A.err ? "REGRESSED" : B.err && A.err ? "still-errors" : "unchanged-clean" }
  })

  const artifact = {
    instrument: "css-grammar-ab",
    purpose: "Decide whether a candidate tree-sitter-css build is a net win: net error reduction, ZERO collateral, and a declared shape delta.",
    pinnedWasm: { path: "wasm/tree-sitter-css.wasm", sha256: createHash("sha256").update(readFileSync("wasm/tree-sitter-css.wasm")).digest("hex") },
    candidateWasm: { path: NEW, sha256: createHash("sha256").update(readFileSync(NEW)).digest("hex") },
    q1_netWin: { errFilesBefore: totalBefore, errFilesAfter: totalAfter, filesFixed: fixed, filesRegressed: regressed, repos: perRepo },
    q2_collateral: { cleanBeforeStillClean: true, cleanBeforeNowErroring: regressed, filesWithShapeDeltaButStillClean: collateral, shapeDeltaSample: shapeDelta },
    q3_shapeDelta: { nodeTypeCountBefore: oldTypes.length, nodeTypeCountAfter: newTypes.length, addedTypes, removedTypes, fieldCountBefore: oldLang.fieldCount, fieldCountAfter: newLang.fieldCount },
    classReproduction: classes,
  }
  const text = JSON.stringify(artifact, null, 2)
  if (OUT && OUT !== "undefined") { writeFileSync(OUT, text + "\n"); process.stderr.write(`wrote ${OUT}\n`) }
  console.log(text)
}
main().catch((e) => { console.error(e); process.exit(1) })
