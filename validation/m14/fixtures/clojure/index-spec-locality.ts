/**
 * CLOJURE LANE — THE TWO CONTROLS THAT PROVE THE CLOJURE SPEC IS SPEC-LOCAL.
 *
 * The Lead's java precedent, made runnable. A spec-local addition must be able to change NOTHING
 * outside its own lane, and the only way to know that is to MEASURE it rather than assert it.
 *
 * ## CONTROL 1 — THE OTHER LANGUAGES' DIGESTS BYTE-IDENTICAL
 *
 * For every language that has a declaration spec, the index's WHOLE SURFACE is built over a sample
 * of that language's corpus and DIGESTED: `typeKinds`, `typeMembers`, `typeBases`, `symbolNames`,
 * `symbolCounts`, `modules`, `damagedFiles` and the stats. A digest of a whole surface is the only
 * form of "byte-identical" that means anything — a count would not notice a changed KIND.
 *
 * ## CONTROL 2 — THE INDEX'S WHOLE SURFACE, OLD vs NEW, IN ONE PROCESS
 *
 * The Lead's wording: "the answer must be that everything is IDENTICAL except what the new spec is
 * supposed to add". So this control builds every language's surface TWICE IN ONE PROCESS — once
 * with the shared index file AS IT WAS at the base revision, and once with it as it is NOW — and
 * compares the digests. The ten other languages must be identical; the clojure surface must differ
 * ONLY by the names the clojure spec adds, and those names are NAMED, not just counted.
 *
 * **THE OLD FILE IS A REAL FILE, NOT A RECONSTRUCTION.** It is `git show <BASE>:src/ast/
 * project-index.ts` materialised at RUN TIME and imported beside the current one, so the two
 * builders really are two programs in one process. The base is a NAMED REVISION, never `HEAD`:
 * `HEAD` is an ambient pointer, and the moment the Lead commits the shared file, `HEAD` BECOMES
 * the changed file and the "OLD" arm silently measures the NEW one. (The same defect the lane's
 * own BEFORE arm had, and the same rule the Lead put on the record.) The base is overridable with
 * `BB_CLOJURE_INDEX_BASE_REV`, and the script ASSERTS the base is a real one — the old file must
 * not export a clojure spec, and the new one must — so a mis-set base fails loudly instead of
 * comparing a file with itself.
 *
 * ## WHERE THE OLD FILE IS MATERIALISED
 *
 * Under `node_modules/.cache/`, which is gitignored, outside the fixture tree (so the fixture
 * runner never sees it), and still inside the repository — which is what makes `web-tree-sitter`
 * resolvable from it, because a bare specifier resolves by walking UP from the importing file.
 * A file outside the repository would not resolve it, and the control would fail for a reason that
 * has nothing to do with the spec.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import * as path from "node:path"
import { pathToFileURL } from "node:url"
import { emptyProjectIndex, indexTree } from "../../../../src/ast/project-index"
import * as PIDX from "../../../../src/ast/project-index"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const ROOT = path.resolve(import.meta.dir, "..", "..", "..", "..")
const JSON_OUT = (() => { const i = process.argv.indexOf("--json"); return i >= 0 ? process.argv[i + 1] ?? null : null })()

/** THE BASE REVISION — the commit the clojure region was built ON. A NAMED sha, never `HEAD`. */
const BASE = process.env.BB_CLOJURE_INDEX_BASE_REV ?? "a5693870adc07ce2cdca801a1f4e5894a6317bd3"

/** THE LANES AND THEIR SPECS — the ten the Lead named, plus clojure. */
const LANES: { lang: string; wasm: string; exts: string[]; repo?: string }[] = [
  { lang: "python", wasm: "tree-sitter-python.wasm", exts: ["py"] },
  { lang: "typescript", wasm: "tree-sitter-typescript.wasm", exts: ["ts", "tsx"] },
  { lang: "javascript", wasm: "tree-sitter-javascript.wasm", exts: ["js", "jsx", "mjs"] },
  { lang: "ruby", wasm: "tree-sitter-ruby.wasm", exts: ["rb"] },
  { lang: "cpp", wasm: "tree-sitter-cpp.wasm", exts: ["cpp", "cc", "cxx"] },
  { lang: "dart", wasm: "tree-sitter-dart.wasm", exts: ["dart"] },
  { lang: "solidity", wasm: "tree-sitter-solidity.wasm", exts: ["sol"] },
  { lang: "scss", wasm: "tree-sitter-scss.wasm", exts: ["scss"] },
  { lang: "fsharp", wasm: "tree-sitter-fsharp.wasm", exts: ["fs", "fsi"] },
  { lang: "java", wasm: "tree-sitter-java.wasm", exts: ["java"], repo: "grails-core" },
  { lang: "clojure", wasm: "tree-sitter-clojure.wasm", exts: ["clj", "cljs", "cljc", "edn"], repo: "clj-kondo" },
]

/** THE SPEC EACH LANE USES, BY NAME, IN EITHER VERSION OF THE FILE. The clojure lane's OLD spec is
 *  the gate's FALLBACK — `incoming-gate.ts` returns ZERO indexes for a language with no
 *  `INDEX_SPECS` entry, and the fallback for an entry with no loader is `SOLIDITY_DECLARATION_SPEC`
 *  (measured for protobuf: 0 names, 0 types over 847 files). So the OLD clojure surface is the
 *  SOLIDITY spec's, and that is what the "new spec adds" delta is measured against. */
const SPEC_NAME: Record<string, string> = {
  python: "PYTHON_DECLARATION_SPEC",
  typescript: "TYPESCRIPT_DECLARATION_SPEC",
  javascript: "JAVASCRIPT_DECLARATION_SPEC",
  ruby: "RUBY_DECLARATION_SPEC",
  cpp: "CPP_DECLARATION_SPEC",
  dart: "DART_DECLARATION_SPEC",
  solidity: "SOLIDITY_DECLARATION_SPEC",
  scss: "SCSS_DECLARATION_SPEC",
  fsharp: "FSHARP_DECLARATION_SPEC",
  java: "JAVA_DECLARATION_SPEC",
  clojure: "SOLIDITY_DECLARATION_SPEC", // ← the OLD clojure surface: the gate's fallback
}

const SAMPLE = 40

/** A CANONICAL SERIALISATION OF THE WHOLE SURFACE — sorted, so the digest does not depend on a
 *  Map's iteration order. A digest of a SURFACE is what "byte-identical" has to mean: a count
 *  would not notice a changed kind or a changed member set. */
function digestIndex(index: any): string {
  const parts: string[] = []
  parts.push(`files=${index.stats.files} damaged=${index.stats.damaged}`)
  for (const k of [...index.typeKinds.keys()].sort()) parts.push(`typeKind ${k}=${index.typeKinds.get(k)}`)
  for (const k of [...index.typeMembers.keys()].sort()) parts.push(`typeMembers ${k}=[${[...index.typeMembers.get(k)!].sort().join(",")}]`)
  for (const k of [...index.typeBases.keys()].sort()) parts.push(`typeBases ${k}=[${[...index.typeBases.get(k)!].sort().join(",")}]`)
  for (const k of [...index.symbolNames].sort()) parts.push(`name ${k}`)
  for (const k of [...index.symbolCounts.keys()].sort()) parts.push(`count ${k}=${index.symbolCounts.get(k)}`)
  for (const k of [...index.modules].sort()) parts.push(`module ${k}`)
  for (const k of [...index.damagedFiles].sort()) parts.push(`damaged ${k}`)
  const text = parts.join("\n")
  // FNV-1a, 64-bit, hex — a digest that needs no dependency and no crypto import.
  let h1 = 0x811c9dc5, h2 = 0x01000193
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 + c + i, 0x85ebca6b) >>> 0
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`
}

const WTS = await import("web-tree-sitter")
await WTS.Parser.init()

/** A SAMPLE OF A LANE'S FILES, from the corpus, by the lane's own extension. */
function sampleFiles(lane: { exts: string[]; repo?: string }): string[] {
  const roots = lane.repo ? [path.join(CR, lane.repo)] : readdirSync(CR).map((r) => path.join(CR, r))
  const out: string[] = []
  for (const root of roots) {
    if (!existsSync(root)) continue
    const stack = [root]
    while (stack.length > 0 && out.length < SAMPLE * 3) {
      const dir = stack.pop()!
      let entries: string[] = []
      try { entries = readdirSync(dir) } catch { continue }
      for (const e of entries) {
        const p = path.join(dir, e)
        let st: any
        try { st = statSync(p) } catch { continue }
        if (st.isDirectory()) { if (e !== ".git" && e !== "node_modules") stack.push(p); continue }
        const ext = e.split(".").pop()?.toLowerCase() ?? ""
        if (!lane.exts.includes(ext)) continue
        if (st.size > 1024 * 1024) continue
        out.push(p)
        if (out.length >= SAMPLE * 3) break
      }
    }
    if (out.length >= SAMPLE) break
  }
  return out.slice(0, SAMPLE)
}

/** BUILD A LANE'S INDEX SURFACE, with a given version of the builder and a given spec. */
async function buildSurface(lane: { lang: string; wasm: string; exts: string[]; repo?: string }, mod: any, spec: any) {
  const language = await (WTS as any).Language.load(readFileSync(path.join(ROOT, "wasm", lane.wasm)))
  const parser = new WTS.Parser()
  parser.setLanguage(language)
  const files = sampleFiles(lane)
  const index = mod.emptyProjectIndex()
  for (const f of files) {
    const tree = parser.parse(readFileSync(f, "utf8"))
    if (tree === null) continue
    index.stats.files++
    index.modules.add(f)
    const base = f.split(/[\\/]/).pop() ?? ""
    if (base !== "") { index.modules.add(base); const stem = base.replace(/\.[^.]+$/, ""); if (stem !== "") index.modules.add(stem) }
    if (tree.rootNode.hasError) { index.stats.damaged++; index.damagedFiles.add(f) }
    mod.indexTree(tree.rootNode as any, index, spec, f)
  }
  return { index, digest: digestIndex(index), files: files.length }
}

// ── THE OLD FILE, MATERIALISED FROM A NAMED REVISION ────────────────────────────────────────────
const CACHE_DIR = path.join(ROOT, "node_modules", ".cache", "bb-clojure-lane")
const OLD_PATH = path.join(CACHE_DIR, "project-index.OLD.ts")
mkdirSync(CACHE_DIR, { recursive: true })
let oldSource = ""
try {
  oldSource = execFileSync("git", ["show", `${BASE}:src/ast/project-index.ts`], { cwd: ROOT, encoding: "utf8" })
} catch (e) {
  console.error(`THE BASE REVISION ${BASE} DOES NOT EXIST OR DOES NOT CARRY src/ast/project-index.ts.`)
  console.error(`Set BB_CLOJURE_INDEX_BASE_REV to the commit the clojure region was built ON.`)
  process.exit(2)
}
writeFileSync(OLD_PATH, oldSource)
const OLD = await import(pathToFileURL(OLD_PATH).href)

// THE BASE MUST BE A REAL ONE — the old file must NOT carry a clojure spec, and the new one MUST.
// A mis-set base (HEAD, after the Lead commits the shared file) would compare a file with itself,
// and the control would report "IDENTICAL" for a reason that is not the spec's locality.
const oldHasClojure = Object.keys(OLD).some((k) => k === "CLOJURE_DECLARATION_SPEC")
const newHasClojure = Object.keys(PIDX).some((k) => k === "CLOJURE_DECLARATION_SPEC")
if (oldHasClojure || !newHasClojure) {
  console.error(`THE BASE REVISION IS WRONG: the old file exports a clojure spec: ${oldHasClojure}; the new file does: ${newHasClojure}.`)
  console.error(`The base must be a commit BEFORE the clojure region landed. Set BB_CLOJURE_INDEX_BASE_REV.`)
  process.exit(2)
}

// ── CONTROL 1, PART 1: THE SOURCE ASSERTION ──────────────────────────────────────────────────────
function gitDiff(args: string[]): string {
  try { return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }) } catch { return "" }
}
const sharedDiff = gitDiff(["diff", BASE, "--", "src/ast/project-index.ts"])
const removedLines = sharedDiff.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---"))
const addedLines = sharedDiff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++"))
// A PURELY ADDITIVE change to the shared file is the strongest form of "spec-local" there is: every
// pre-existing statement is byte-identical, so the ten other lanes' behaviour cannot change.
const purelyAdditive = removedLines.length === 0
console.log("CONTROL 1 — THE OTHER LANGUAGES' DIGESTS BYTE-IDENTICAL")
console.log(`  THE CORPUS ROOT: ${CR}`)
console.log(`  the shared file src/ast/project-index.ts, base ${BASE.slice(0, 12)} -> working tree: ${addedLines.length} line(s) added, ${removedLines.length} removed`)
console.log(`  the change is PURELY ADDITIVE (no pre-existing statement altered): ${purelyAdditive}`)
if (!purelyAdditive) console.log(removedLines.slice(0, 20).join("\n"))
const analyzerDiff = gitDiff(["diff", "HEAD", "--", "src/ast/real-clojure-analyzer.ts"])
const analyzerHunks = (analyzerDiff.match(/^@@/gm) ?? []).length
console.log(`  the analyzer's diff is ${analyzerHunks} hunk(s), and the shared builder and the ten other specs are not among them: ${purelyAdditive}`)
console.log("")

// ── CONTROLS 1 AND 2: THE MEASURED DIGESTS, OLD vs NEW, IN ONE PROCESS ──────────────────────────
console.log("CONTROL 2 — THE INDEX'S WHOLE SURFACE, OLD vs NEW, IN ONE PROCESS")
console.log(`  (OLD = the shared file at ${BASE.slice(0, 12)}; NEW = the working tree. Both loaded in THIS process.)`)
console.log("")
const results: any[] = []
for (const lane of LANES) {
  const specName = SPEC_NAME[lane.lang]
  const newSpec = lane.lang === "clojure" ? (PIDX as any).CLOJURE_DECLARATION_SPEC : (PIDX as any)[specName]
  const oldSpec = (OLD as any)[specName]
  const withSpec = await buildSurface(lane, PIDX, newSpec)
  const withoutSpec = await buildSurface(lane, OLD, oldSpec)
  const same = withSpec.digest === withoutSpec.digest
  const newNames = [...withSpec.index.symbolNames].sort()
  const oldNames = new Set([...withoutSpec.index.symbolNames])
  const added = newNames.filter((n) => !oldNames.has(n))
  results.push({
    lang: lane.lang, files: withSpec.files, new: withSpec.digest, old: withoutSpec.digest, identical: same,
    newNames: newNames.length, oldNames: oldNames.size, addedNames: added.length, addedSample: added.slice(0, 6),
  })
  const note = lane.lang === "clojure"
    ? "  <- EXPECTED TO DIFFER: this is what the new spec adds"
    : (same ? "  <- IDENTICAL" : "  *** NOT IDENTICAL ***")
  console.log(`  ${lane.lang.padEnd(12)} ${String(withSpec.files).padStart(3)} files  NEW ${withSpec.digest}  OLD ${withoutSpec.digest}  ${same ? "identical" : "DIFFERENT"}${note}`)
}
console.log("")
const others = results.filter((r) => r.lang !== "clojure")
const othersIdentical = others.every((r) => r.identical)
const clj = results.find((r) => r.lang === "clojure")!
const clojureDiffers = !clj.identical
console.log(`  THE TEN OTHER LANES: ${othersIdentical ? "ALL IDENTICAL" : "*** NOT ALL IDENTICAL ***"}`)
console.log(`  THE CLOJURE SURFACE: ${clojureDiffers ? "DIFFERS — and that is what the new spec adds" : "*** DID NOT DIFFER — the spec adds nothing ***"}`)
console.log(`  THE CLOJURE NAMES: OLD ${clj.oldNames} -> NEW ${clj.newNames} (+${clj.addedNames})`)
console.log(`  A SAMPLE OF THE NAMES THE CLOJURE SPEC ADDS: ${clj.addedSample.map((n: string) => JSON.stringify(n)).join(", ")}`)
console.log(`  AND THE GATE-LEVEL FACT: before the wiring, \`incoming-gate.ts\` had NO clojure entry in`)
console.log(`  INDEX_SPECS, and its lookup returns ZERO indexes for a language with no entry — so every`)
console.log(`  recorded clojure arm was a NO-INDEX arm, not a fallback-spec arm.`)
console.log("")

if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify({
    base: BASE,
    control1: { purelyAdditive, addedLines: addedLines.length, removedLines: removedLines.length },
    control2: { othersIdentical, clojureDiffers, lanes: results },
  }, null, 2) + "\n")
  console.log(`JSON: ${JSON_OUT}`)
}
if (!othersIdentical || !clojureDiffers || !purelyAdditive) process.exit(1)
