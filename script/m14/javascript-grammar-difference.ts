/**
 * JAVASCRIPT — THE TWO-GRAMMARS DIFFERENCE, MEASURED FOR ITS POPULATION CONSEQUENCE.
 *
 * ── THE QUESTION ──────────────────────────────────────────────────────────────────────────────────────
 * Two javascript grammar BUILDS are in this repository, and **THE LABELS BELOW WERE INVERTED AND
 * ARE NOW MEASURED** (`script/m14/javascript-grammar-binding-probe.ts`, exit 0):
 *   the PRODUCTION build -- the bytes the REGISTRY SERVES and the path the gate's own
 *     `resolveWasmAsset` returns (incoming-gate.ts:1344-1345) -> wasm/tree-sitter-javascript.wasm
 *     (sha256 63812b9e..., 116 distinct named types; 3 extra: glimmer_closing_tag,
 *     glimmer_opening_tag, glimmer_template)
 *   the BUILD SERVED BY NOTHING -- node_modules/tree-sitter-javascript/tree-sitter-javascript.wasm
 *     (sha256 4a378293..., 113 distinct named types). **The engine's LOG prints THIS path, and the
 *     bytes it loads are the other build's -- the log is not a citation (L-20).**
 *
 * The Lead's ruling L-2026-10-21-05 makes the census's build THE grammar for a ruling, and that is
 * settled. **THE OPEN QUESTION IS THE OTHER ONE: DOES THE DIFFERENCE COST THE POPULATION ANYTHING?**
 *
 *   The PRODUCTION build is the one the gate loads and the whole-population numbers are measured on.
 *   If the PRODUCTION build ERRORS where the COMPARATOR build parses, the population is LOSING edges
 *   on those files, and the lane's numbers are measured on a build that cannot read its own corpus.
 *   If it does not, the difference is confined to the COMPARATOR's TYPE INVENTORY, the lane's
 *   whole-population numbers are unaffected, and the finding is a fact about the harness.
 *
 *   The Glimmer question is asked in the direction that matters: the PRODUCTION build is the one
 *   that DECLARES the three glimmer node types, so the census asks where THE PRODUCTION build finds
 *   a glimmer node across the WHOLE admitted population -- not only on the files it could not read.
 *
 * ── THE MEASUREMENT ──────────────────────────────────────────────────────────────────────────────────
 * Every admitted file that the PRODUCTION parser parses WITH AN ERROR NODE is re-parsed with the
 * COMPARATOR build, and the two are compared on: the error count, the node count, and whether the
 * COMPARATOR build finds any node the PRODUCTION build's grammar declares impossible. A file the
 * production build parses CLEANLY is not re-parsed -- the question is about the files the production
 * build could not read. Separately, the PRODUCTION build's glimmer census runs over the WHOLE
 * admitted population, because a glimmer construct that the corpus contains is a population fact
 * whether or not the file also has an ERROR node.
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

// THE PRODUCTION BUILD -- the bytes the REGISTRY SERVES, the path the gate's resolveWasmAsset
// returns. This is the build every whole-population number in the lane is measured on.
const PRODUCTION_WASM = path.join(ROOT, "wasm/tree-sitter-javascript.wasm")
// THE BUILD SERVED BY NOTHING -- the path the engine's LOG prints, and the bytes it does NOT load.
const COMPARATOR_WASM = path.join(ROOT, "node_modules/tree-sitter-javascript/tree-sitter-javascript.wasm")

const prodLang = await L.load(readFileSync(PRODUCTION_WASM))
const compLang = await L.load(readFileSync(COMPARATOR_WASM))
const prod = new P()
prod.setLanguage(prodLang)
const comp = new P()
comp.setLanguage(compLang)

/** Count nodes, errors, missing tokens, and glimmer nodes in a tree. */
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

// PASS 1 -- the whole population under the PRODUCTION build, counting glimmer nodes EVERYWHERE
// (not only on dirty files) and collecting the files the PRODUCTION build cannot read cleanly.
const dirty: { file: string; prod: any; comp: any }[] = []
let clean = 0
let failed = 0
const glimmerFiles: { file: string; glimmer: Record<string, number> }[] = []
const glimmerTotals: Record<string, number> = {}
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
    t = prod.parse(src)
  } catch {
    failed++
    continue
  }
  const pc = census(t)
  if (Object.keys(pc.glimmer).length > 0) {
    glimmerFiles.push({ file: path.relative(ROOT, f), glimmer: pc.glimmer })
    for (const [k, v] of Object.entries(pc.glimmer)) glimmerTotals[k] = (glimmerTotals[k] ?? 0) + v
  }
  if (pc.errors === 0 && pc.missing === 0) {
    clean++
    t.delete?.()
    continue
  }
  // The PRODUCTION build could not read this file cleanly. Can the COMPARATOR?
  let t2: any = null
  let cc: any = null
  try {
    t2 = comp.parse(src)
    cc = census(t2)
  } catch {
    cc = null
  }
  dirty.push({ file: path.relative(ROOT, f), prod: pc, comp: cc })
  t.delete?.()
  t2?.delete?.()
}

const compCleans = dirty.filter((d) => d.comp && d.comp.errors === 0 && d.comp.missing === 0)
const buildsDiffer = dirty.filter((d) => d.comp && (d.comp.errors !== d.prod.errors || d.comp.nodes !== d.prod.nodes))
const compGlimmer = dirty.filter((d) => d.comp && Object.keys(d.comp.glimmer).length > 0)

console.log(`\nclean under the PRODUCTION build: ${clean} · with ERROR/MISSING: ${dirty.length} · unreadable: ${failed}`)
console.log(`of the ${dirty.length} dirty files, the COMPARATOR build parses CLEANLY: ${compCleans.length}`)
console.log(`the two builds DIFFER on: ${buildsDiffer.length} file(s)`)
console.log(`\nGLIMMER CENSUS -- the PRODUCTION build over the WHOLE admitted population:`)
console.log(`  files with a glimmer node: ${glimmerFiles.length}`)
console.log(`  glimmer node totals: ${JSON.stringify(glimmerTotals)}`)
for (const g of glimmerFiles.slice(0, 10)) console.log(`  ${g.file} ${JSON.stringify(g.glimmer)}`)

const out = {
  generated: new Date().toISOString(),
  question: "does the PRODUCTION grammar build -- the bytes the registry serves, the build every whole-population number is measured on -- cost the population anything the build served by nothing would have read?",
  citationRule: "L-20: a grammar citation is the sha256 of the bytes the REGISTRY SERVES, never a path and never a log line.",
  builds: {
    production: {
      wasm: "wasm/tree-sitter-javascript.wasm",
      sha256: (await import("node:crypto")).createHash("sha256").update(readFileSync(PRODUCTION_WASM)).digest("hex"),
      role: "the bytes the REGISTRY SERVES; the path incoming-gate.ts:1344-1345 resolveWasmAsset returns; the build every whole-population number is measured on",
    },
    comparator: {
      wasm: "node_modules/tree-sitter-javascript/tree-sitter-javascript.wasm",
      sha256: (await import("node:crypto")).createHash("sha256").update(readFileSync(COMPARATOR_WASM)).digest("hex"),
      role: "SERVED BY NOTHING -- the path the engine's LOG prints (engine.ts:677 resolveWasm -> require.resolve), while the bytes the engine loads (engine.ts:1205-1216) are the production build's. The log is not a citation.",
    },
  },
  population: { admittedFiles: admitted.length, unreadable: failed },
  verdict: {
    cleanUnderProduction: clean,
    dirtyUnderProduction: dirty.length,
    comparatorBuildCleansThem: compCleans.length,
    buildsDifferOn: buildsDiffer.length,
    glimmerNodesFoundByProductionBuild: glimmerFiles.length,
    glimmerNodeTotals: glimmerTotals,
    conclusion:
      compCleans.length === 0 && glimmerFiles.length === 0
        ? "NO POPULATION CONSEQUENCE -- the two builds differ in their INVENTORY, not in what they can read: every file the PRODUCTION build cannot read cleanly, the COMPARATOR build cannot read cleanly either, and the PRODUCTION build's three glimmer node types find NO glimmer node anywhere in the admitted population. The difference is confined to the COMPARATOR's TYPE INVENTORY, and the lane's whole-population numbers are unaffected."
        : `THE DIFFERENCE HAS A POPULATION CONSEQUENCE -- the COMPARATOR build reads ${compCleans.length} file(s) the PRODUCTION build cannot, and the PRODUCTION build finds a glimmer node in ${glimmerFiles.length} file(s) of the admitted population. The lane's whole-population numbers are measured on a build that cannot read ${compCleans.length} file(s) of its own corpus.`,
  },
  files: dirty,
}
writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n")
console.log(`\nwrote ${path.relative(ROOT, OUT)}`)
