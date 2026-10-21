/**
 * JAVASCRIPT — THE TWO-GRAMMARS DIFFERENCE, MEASURED FOR ITS POPULATION CONSEQUENCE.
 *
 * ── THE QUESTION ──────────────────────────────────────────────────────────────────────────────────────
 * Two javascript grammar BUILDS are in this repository:
 *   the POPULATION instrument — script/m14/incoming-gate.ts:1287 → node_modules/tree-sitter-javascript/
 *     tree-sitter-javascript.wasm (sha256 4a378293…, 122 named node types)
 *   the FIXTURE instrument   — script/m14/run-fixtures.ts:58 → wasm/tree-sitter-javascript.wasm
 *     (sha256 63812b9e…, 125 named node types; 3 extra: glimmer_closing_tag, glimmer_opening_tag,
 *     glimmer_template)
 *
 * The Lead's ruling L-2026-10-21-05 makes the census's build THE grammar for a ruling, and that is
 * settled. **THE OPEN QUESTION IS THE OTHER ONE: DOES THE DIFFERENCE COST THE POPULATION ANYTHING?**
 *
 *   If the population grammar ERRORS where the fixture grammar parses, the population is LOSING
 *   edges on those files, and the lane's whole-population numbers are measured on a build that cannot
 *   read its own corpus.
 *   If it does not, the difference is confined to the fixture instrument, the lane's numbers are
 *   unaffected, and the finding is a fact about the harness rather than about the lane.
 *
 * ── THE MEASUREMENT ──────────────────────────────────────────────────────────────────────────────────
 * Every admitted file that the PRODUCTION parser parses WITH AN ERROR NODE is re-parsed with the
 * FIXTURE build, and the two are compared on: the error count, the node count, the Glimmer node
 * count, and whether the FIXTURE build finds any node the PRODUCTION build's grammar declares
 * impossible. A file the production build parses CLEANLY is not re-parsed — the question is about
 * the files the production build could not read.
 *
 *   bun run script/m14/javascript-grammar-difference.ts [--corpus=<dir>]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"

const ROOT = process.cwd()
const arg = (n: string, d: string) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : d
}
const CORPUS = path.resolve(arg("corpus", path.join(ROOT, ".corpus")))
const OUT = path.join(ROOT, "validation/m14/measurements/javascript-grammar-difference.json")

const wts: any = await import("web-tree-sitter")
await (wts.Parser ?? wts.default).init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const P = wts.Parser ?? wts.default
const L = wts.Language ?? wts.default?.Language

const POP_WASM = path.join(ROOT, "node_modules/tree-sitter-javascript/tree-sitter-javascript.wasm")
const FIX_WASM = path.join(ROOT, "wasm/tree-sitter-javascript.wasm")

const popLang = await L.load(readFileSync(POP_WASM))
const fixLang = await L.load(readFileSync(FIX_WASM))
const pop = new P()
pop.setLanguage(popLang)
const fix = new P()
fix.setLanguage(fixLang)

/** Count nodes, errors, and glimmer nodes in a tree. */
function census(tree: any) {
  let nodes = 0
  let errors = 0
  let missing = 0
  const glimmer: Record<string, number> = {}
  const stack = [tree.rootNode]
  while (stack.length) {
    const n = stack.pop()
    nodes++
    if (n.type === "ERROR") errors++
    if (n.isMissing) missing++
    if (n.type.startsWith("glimmer_")) glimmer[n.type] = (glimmer[n.type] ?? 0) + 1
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return { nodes, errors, missing, glimmer }
}

// THE ADMITTED POPULATION — the gate's own rule, copied rule for rule.
const EXTS = [".js", ".mjs", ".cjs", ".jsx"]
const admitted: string[] = []
{
  const repos = execFileSync("ls", ["-1", CORPUS], { encoding: "utf8" }).split("\n").filter(Boolean).sort()
  for (const name of repos) {
    const dir = path.join(CORPUS, name)
    try {
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch {
      continue
    }
    let tracked: string[] = []
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
    } catch {
      continue
    }
    for (const rel of tracked) {
      if (!EXTS.some((x) => rel.toLowerCase().endsWith(x))) continue
      const abs = path.join(dir, rel)
      try {
        if (readFileSync(abs).length > 1024 * 1024) continue
      } catch {
        continue
      }
      admitted.push(abs)
    }
  }
}
console.log(`admitted ${admitted.length} files under ${CORPUS}`)

// THE FILES THE PRODUCTION BUILD CANNOT READ CLEANLY.
const dirty: { file: string; pop: any; fix: any }[] = []
let clean = 0
let failed = 0
for (const f of admitted) {
  let src: string
  try {
    src = readFileSync(f, "utf8")
  } catch {
    failed++
    continue
  }
  let t: any
  try {
    t = pop.parse(src)
  } catch {
    failed++
    continue
  }
  const pc = census(t)
  if (pc.errors === 0 && pc.missing === 0) {
    clean++
    t.delete?.()
    continue
  }
  let t2: any = null
  let fc: any = null
  try {
    t2 = fix.parse(src)
    fc = census(t2)
  } catch {
    fc = null
  }
  dirty.push({ file: path.relative(ROOT, f), pop: pc, fix: fc })
  t.delete?.()
  t2?.delete?.()
}

const fixCleans = dirty.filter((d) => d.fix && d.fix.errors === 0 && d.fix.missing === 0)
const fixDiffers = dirty.filter((d) => d.fix && (d.fix.errors !== d.pop.errors || d.fix.nodes !== d.pop.nodes))
const glimmerAnywhere = dirty.filter((d) => d.fix && Object.keys(d.fix.glimmer).length > 0)

console.log(`\nclean under the PRODUCTION build: ${clean} · with ERROR/MISSING: ${dirty.length} · unreadable: ${failed}`)
console.log(`of the ${dirty.length} dirty files, the FIXTURE build parses CLEANLY: ${fixCleans.length}`)
console.log(`the two builds DIFFER on: ${fixDiffers.length} file(s)`)
console.log(`files where the FIXTURE build finds GLIMMER nodes: ${glimmerAnywhere.length}`)
for (const d of glimmerAnywhere.slice(0, 10)) {
  console.log(`  ${d.file}\n    production: ${JSON.stringify(d.pop)}\n    fixture:    ${JSON.stringify(d.fix)}`)
}

const out = {
  generated: new Date().toISOString(),
  question: "does the population instrument's grammar build cost the population anything the fixture instrument's build would have read?",
  builds: {
    population: { wasm: "node_modules/tree-sitter-javascript/tree-sitter-javascript.wasm", sha256: (await import("node:crypto")).createHash("sha256").update(readFileSync(POP_WASM)).digest("hex") },
    fixture: { wasm: "wasm/tree-sitter-javascript.wasm", sha256: (await import("node:crypto")).createHash("sha256").update(readFileSync(FIX_WASM)).digest("hex") },
  },
  population: { admittedFiles: admitted.length, unreadable: failed },
  verdict: {
    cleanUnderProduction: clean,
    dirtyUnderProduction: dirty.length,
    fixtureBuildCleansThem: fixCleans.length,
    buildsDifferOn: fixDiffers.length,
    glimmerNodesFoundByFixtureBuild: glimmerAnywhere.length,
    conclusion:
      fixCleans.length === 0 && glimmerAnywhere.length === 0
        ? "NO POPULATION CONSEQUENCE — the two builds differ in their INVENTORY, not in what they can read: every file the production build cannot read cleanly, the fixture build cannot read cleanly either, and the fixture build finds no Glimmer node in the admitted population. The difference is confined to the fixture instrument's TYPE INVENTORY, and the lane's whole-population numbers are unaffected."
        : `THE DIFFERENCE HAS A POPULATION CONSEQUENCE — the fixture build reads ${fixCleans.length} file(s) the production build cannot, and finds Glimmer nodes in ${glimmerAnywhere.length}. The lane's whole-population numbers are measured on a build that cannot read ${glimmerAnywhere.length} file(s) of its own corpus.`,
  },
  files: dirty,
}
writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n")
console.log(`\nwrote ${path.relative(ROOT, OUT)}`)
console.log(`VERDICT: ${out.verdict.conclusion}`)
