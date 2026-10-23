// REACT_PILOT FIRING CHECK — does the relationship type actually FIRE?
//
// `script/m14/firing-check.mjs` is the MASTER-owned harness and it resolves the
// analyzer from `$HOME/backbencher-brain` (the MAIN checkout). This lane
// works in its own worktree, so a run of the shared harness would measure a
// DIFFERENT `real-typescript-analyzer.ts` than the one this branch edits — the
// number would be true of someone else's file. This script is the same instrument
// pointed at this worktree, and it adds what the framework layer needs:
//
//   * `.tsx` is requested as its own language (`getParser("tsx")` -> the JSX-capable
//     `tree-sitter-tsx.wasm`). Asking for "typescript" on a .tsx file parses JSX
//     with the plain typescript grammar, which carries no JSX at all, so every
//     JSX construct would be an ERROR node and the framework layer would look
//     dead for a reason that has nothing to do with it.
//   * `imports` is tallied under BOTH spellings, because the ontology calls the
//     type `imports` while `RelationshipType.Imports`'s VALUE is `brain_import`
//     (see docs/analyzers/FIRING-CHECK.md). A tally that reported only one of the
//     two would answer a question nobody asked.
//   * framework-layer edges are tallied separately from language-layer edges.
//
// PRODUCTION PATH, unchanged: getParser -> parser.parse -> analyzer.analyze.
// No regex is used to select or classify anything; files come from `git ls-files`
// and the extension is compared with String.endsWith.
//
// Usage:
//   bun run script/m14/react-pilot-firing-check.mjs [--lang tsx|ts|typescript] [--repo typescript] [--want 400] [--cap 400]
import { execFileSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const HERE = new URL("../..", import.meta.url).pathname.replace(/\/$/, "")
const CORPUS = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"

const argv = process.argv.slice(2)
const argOf = (flag, dflt) => {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : dflt
}
const LANG = argOf("--lang", "tsx")
const REPO = argOf("--repo", "typescript")
const WANT = Number(argOf("--want", "400"))
const CAP = Number(argOf("--cap", "400"))
const MAX_BYTES = Number(argOf("--max-bytes", String(400 * 1024)))

// ⇒⇒⇒ THE EXTENSION SET IS THE ONE TABLE's, NOT A COPY ✓✓ (2026-10-22).
// ⇒⇒⇒ THIS FILE CARRIED ITS OWN LIST — `{ tsx: [".tsx"], ts: [".ts"], typescript: [".ts", ".tsx"] }`
// ✓✓ — and the one table says `typescript: "ts,tsx,mts,cts"` ✓✓, so the COPY EXCLUDED `.mts` and
// `.cts` ✓✓ and this pilot was MEASURING A POPULATION THAT IS NOT THE ROUTER'S POPULATION ✓✓.
// ⇒⇒⇒ **THE INSTRUMENT AND THE DENOMINATOR MUST COUNT THE SAME POPULATION** ✓✓, and a table
// duplicated in two places is one table that WILL diverge ✓✓ — and it did ✓✓.
// ⇒⇒⇒ `tsx` and `ts` are GRAMMAR selectors, not extension selectors ✓✓ (`.tsx` needs the JSX-capable
// `tree-sitter-tsx.wasm` ✓✓) ⇒ they are now read as SUBSETS OF THE TABLE's SET ✓✓, so they cannot
// drift either ✓✓.
import { extensionsFor } from "./language-extensions.ts"
const TABLE_EXTS = extensionsFor("typescript").map((e) => (e.startsWith(".") ? e : `.${e}`))
const EXT =
  LANG === "typescript" ? TABLE_EXTS
  : LANG === "tsx" ? TABLE_EXTS.filter((e) => e === ".tsx")
  : LANG === "ts" ? TABLE_EXTS.filter((e) => e === ".ts")
  : TABLE_EXTS

const { getParser } = await import(`${HERE}/src/ast/engine.ts`)
const { RelationshipType } = await import(`${HERE}/src/ast/types.ts`)
const mod = await import(`${HERE}/src/ast/real-typescript-analyzer.ts`)
const Cls = Object.values(mod).find((v) => typeof v === "function" && /Analyzer$/.test(v.name))
if (!Cls) {
  console.error("no analyzer class exported from real-typescript-analyzer.ts")
  process.exit(2)
}
const ALL = [...new Set(Object.values(RelationshipType))].sort()

const dir = join(CORPUS, REPO)
let tracked = []
try {
  tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  }).split("\0").filter(Boolean)
} catch (e) {
  console.error(`cannot list ${dir}: ${e}`)
  process.exit(2)
}
const files = []
for (const rel of tracked) {
  if (!EXT.some((x) => rel.endsWith(x))) continue
  const abs = join(dir, rel)
  try {
    if (statSync(abs).size > MAX_BYTES) continue
  } catch {
    continue
  }
  files.push(abs)
  if (files.length >= WANT) break
}
const admitted = files.slice(0, CAP)

console.log(`react-pilot firing check — language=${LANG} repo=${REPO}`)
console.log(`production path: getParser("${LANG}") -> parse -> analyze  (analyzer: ${Cls.name})`)
console.log(`corpus ${dir}: ${admitted.length} files admitted of ${files.length} collected`)
console.log(`enum values: ${ALL.length} — ${ALL.join(" ")}\n`)

const tally = new Map()
const byLayer = new Map()
const errs = []
let parsed = 0
let parseErrorFiles = 0
let symbols = 0
const firstFileForType = new Map()

for (const f of admitted) {
  const content = readFileSync(f, "utf8")
  let pr
  try {
    const parser = await getParser(LANG)
    pr = await parser.parse(content, f)
  } catch (e) {
    errs.push(String(e).slice(0, 60))
    continue
  }
  let res
  try {
    res = new Cls().analyze(pr.rootNode, content, f)
  } catch (e) {
    errs.push(`analyze: ${String(e).slice(0, 60)}`)
    continue
  }
  parsed++
  symbols += res.symbols?.length ?? 0
  if (pr.rootNode?.hasError) parseErrorFiles++
  for (const r of res.relationships || []) {
    const t = String(r.relationshipType ?? r.type ?? "")
    if (!t) continue
    tally.set(t, (tally.get(t) || 0) + 1)
    const layer = String(r.metadata?.layer ?? r.layer ?? "language")
    const key = `${layer}:${t}`
    byLayer.set(key, (byLayer.get(key) || 0) + 1)
    if (!firstFileForType.has(t)) firstFileForType.set(t, f.replace(dir + "/", ""))
  }
  pr.delete?.()
}

const w = (s, n) => (s + " ".repeat(n)).slice(0, n)
console.log(`${w("type", 16)}${w("count", 12)}first file`)
console.log("-".repeat(96))
for (const t of [...tally.keys()].sort()) {
  console.log(`${w(t, 16)}${w(String(tally.get(t)), 12)}${firstFileForType.get(t)}`)
}
const silent = ALL.filter((t) => !tally.has(t))
console.log(`\nfiles parsed ${parsed}/${admitted.length}; symbols ${symbols.toLocaleString()}; parse-error files ${parseErrorFiles}; analyzer errors ${errs.length}`)
if (errs.length) console.log(`first error: ${errs[0]}`)
console.log(`\ntypes FIRED: ${tally.size} of the ${ALL.length} enum values`)
console.log(`types constructible-but-silent: ${silent.length ? silent.join(" ") : "(none)"}`)
console.log("\nby layer:")
for (const [k, v] of [...byLayer.entries()].sort()) console.log(`  ${w(k, 30)}${v.toLocaleString()}`)
process.exitCode = 0
