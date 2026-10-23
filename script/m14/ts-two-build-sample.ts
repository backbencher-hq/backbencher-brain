// TYPESCRIPT LANE — THE TWO-BUILD PER-LABEL DELTA ON A CONTROLLED SAMPLE.
//
// ⇒⇒⇒ THE QUESTION THIS ANSWERS, AND WHY IT IS NOT THE ARM: a grammar swap changes the PARSER for
// EVERY file, so "`part_of` appeared" is only half the claim. The other half is **did anything else
// move** — and the Lead's condition 4 is that a swap which perturbs other labels is a DIFFERENT
// decision, made with numbers. A full second arm over 17,689 files costs another ~40 minutes of a
// shared 8-CPU machine; this instrument answers the same question at a scale that is affordable and
// states exactly what it measured.
//
// THE SAMPLE IS NOT A STRIDE AND THE DIFFERENCE MATTERS: the sample is EVERY admitted file that
// contains a triple-slash reference directive (the only files the patch can legitimately change)
// PLUS a stride over the rest, so the "nothing else moved" half is measured on files that exercise
// ordinary code and the "`part_of` appeared" half is measured on files where it can.
//
// THE ANALYZER IS THE REAL ONE, unchanged. This instrument only chooses the PARSER: it loads each
// build directly through `web-tree-sitter` and hands the resulting tree to
// `RealTypeScriptAnalyzer.analyze(rootNode, content, filePath)`, which is the same entry point the
// engine uses. ⇒ So a difference here is a difference in the PARSE, which is what a grammar swap is.
//
// Usage: bun run script/m14/ts-two-build-sample.ts [--files=N] [--json=<path>]
import { readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { admitCorpusCached, extensionsFor, strideSample } from "./ts-corpus"

const REPO = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const CORPUS = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const argv = process.argv.slice(2)
const want = Number(argv.find((a) => a.startsWith("--files="))?.slice("--files=".length) ?? 300)
const jsonOut = argv.find((a) => a.startsWith("--json="))?.slice("--json=".length)

// ⇒ THE BASELINE IS THE BYTES THE RESOLVER ACTUALLY HANDS THE PARSER, not a path someone believes is
// served: `getParser("typescript")` logs node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm
// (778025db…), and `wasm/` is NOT in the serving path for this language in this checkout.
const SERVED = argv.find((a) => a.startsWith("--served="))?.slice("--served=".length)
  ?? join(REPO, "node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm")
const PATCHED = argv.find((a) => a.startsWith("--patched="))?.slice("--patched=".length)
  ?? join(REPO, "wasm/tree-sitter-typescript.wasm")

const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex")
const servedSha = sha(SERVED)
const patchedSha = sha(PATCHED)
if (servedSha === patchedSha) {
  console.error("REFUSED: the two paths hold the SAME build, so a delta between them is zero by construction.")
  process.exit(3)
}

const analyzerMod: any = await import(join(REPO, "src/ast/real-typescript-analyzer.ts"))
const Cls: any = Object.values(analyzerMod).find((v: any) => typeof v === "function" && String(v.name).endsWith("Analyzer"))
if (!Cls) { console.error("NO ANALYZER CLASS EXPORTED"); process.exit(4) }

const mod: any = await import("web-tree-sitter")
const ParserCls = mod.Parser ?? mod.default?.Parser ?? mod.default
await ParserCls.init({ locateFile: () => join(REPO, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const servedLang = await mod.Language.load(SERVED)
const patchedLang = await mod.Language.load(PATCHED)

const exts = extensionsFor("typescript")
const admitted = admitCorpusCached(CORPUS, exts, join(REPO, ".tmp-ts/admitted-typescript.json"))

// THE SAMPLE: every file carrying a directive, then a stride over the rest.
const REF = /^\s*\/\/\/\s*<reference\s/m
const withDirective: string[] = []
const rest: string[] = []
for (const f of admitted.files) {
  let t = ""
  try { t = readFileSync(f, "utf8") } catch { continue }
  if (REF.test(t)) withDirective.push(f)
  else rest.push(f)
}
const stride = strideSample(rest, Math.max(0, want - withDirective.length))
// ⇒⇒⇒ THE SAMPLE EXCLUDES JSX FILES, AND THE REASON IS THE INSTRUMENT'S OWN LIMIT RATHER THAN A
// CONVENIENCE. The two builds compared here are both the TYPESCRIPT grammar; a `.tsx` file needs the
// TSX grammar, so parsing one with either build is a parse neither build is meant to do — and any
// difference in such a file is an artefact of THIS INSTRUMENT, not of the grammar swap. Left in, a
// single `.tsx` file with a parse difference reported as "a non-`part_of` label moved", which is how
// this instrument once accused a clean patch of moving five labels. ⇒ A COMPARISON THAT CANNOT BE
// MADE ON A SUBSET MUST NOT BE MADE AND THEN REPORTED AS A RESULT.
const sample = [...withDirective, ...stride]
  .filter((f) => !f.toLowerCase().endsWith(".tsx") && !f.toLowerCase().endsWith(".jsx"))
  .sort()

const counts = (lang: any, f: string, content: string): Record<string, number> | null => {
  const parser = new ParserCls()
  parser.setLanguage(lang)
  let tree: any
  try { tree = parser.parse(content, f) } catch { return null }
  if (!tree) return null
  const res: any = new Cls().analyze(tree.rootNode, content, f)
  const out: Record<string, number> = {}
  for (const r of res.relationships ?? []) {
    const t = String(r.relationshipType ?? r.type ?? "")
    if (t) out[t] = (out[t] ?? 0) + 1
  }
  parser.delete?.()
  return out
}

const labels = new Set<string>()
const perFile: { file: string; served: Record<string, number>; patched: Record<string, number> }[] = []
let failed = 0
for (let i = 0; i < sample.length; i++) {
  const f = sample[i]
  const content = readFileSync(f, "utf8")
  const served = counts(servedLang, f, content)
  const patched = counts(patchedLang, f, content)
  if (!served || !patched) { failed++; continue }
  for (const k of Object.keys(served)) labels.add(k)
  for (const k of Object.keys(patched)) labels.add(k)
  perFile.push({ file: f, served, patched })
  if ((i + 1) % 50 === 0 || i + 1 === sample.length) {
    process.stderr.write(`[delta] ${i + 1}/${sample.length} files\n`)
  }
}

const totals = { served: {} as Record<string, number>, patched: {} as Record<string, number> }
for (const row of perFile) {
  for (const [k, v] of Object.entries(row.served)) totals.served[k] = (totals.served[k] ?? 0) + v
  for (const [k, v] of Object.entries(row.patched)) totals.patched[k] = (totals.patched[k] ?? 0) + v
}
const movedFiles = perFile.filter((r) => {
  const keys = new Set([...Object.keys(r.served), ...Object.keys(r.patched)])
  for (const k of keys) if ((r.served[k] ?? 0) !== (r.patched[k] ?? 0)) return true
  return false
})

console.log(`SERVED  ${servedSha}  (${SERVED.replace(`${REPO}/`, "")})`)
console.log(`PATCHED ${patchedSha}  (${PATCHED.replace(`${REPO}/`, "")})`)
console.log(`population ${admitted.files.length} files, digest ${admitted.digest.slice(0, 16)}`)
console.log(`sample ${sample.length} files = ${withDirective.length} carrying a reference directive + ${stride.length} stride over the rest${failed ? ` (${failed} unparseable, excluded)` : ""}`)
console.log()
console.log("PER-LABEL TOTALS OVER THE SAMPLE:")
console.log("label".padEnd(16) + "served".padStart(9) + "patched".padStart(9) + "delta".padStart(8))
let anyMoved = false
for (const k of [...labels].sort()) {
  const a = totals.served[k] ?? 0
  const b = totals.patched[k] ?? 0
  const d = b - a
  if (d !== 0) anyMoved = true
  console.log(k.padEnd(16) + String(a).padStart(9) + String(b).padStart(9) + String(d === 0 ? "·" : d > 0 ? `+${d}` : d).padStart(8))
}
console.log()
console.log(`files whose per-label profile changed: ${movedFiles.length} of ${perFile.length}`)
for (const r of movedFiles.slice(0, 10)) {
  const k = [...new Set([...Object.keys(r.served), ...Object.keys(r.patched)])]
    .filter((x) => (r.served[x] ?? 0) !== (r.patched[x] ?? 0))
    .map((x) => `${x} ${r.served[x] ?? 0}→${r.patched[x] ?? 0}`).join(" · ")
  console.log(`  ${r.file.replace(`${REPO}/`, "")}: ${k}`)
}
console.log()
const nonPartOf = movedFiles.filter((r) => {
  for (const x of new Set([...Object.keys(r.served), ...Object.keys(r.patched)])) {
    if (x !== "part_of" && (r.served[x] ?? 0) !== (r.patched[x] ?? 0)) return true
  }
  return false
})
if (nonPartOf.length === 0) {
  console.log("VERDICT: ONLY `part_of` MOVED. Over this sample the swap extended the lane and did not change it.")
} else {
  console.log(`*** STOP — ${nonPartOf.length} file(s) moved a label OTHER THAN part_of. ***`)
  console.log("The Lead's condition 4: a swap that perturbs other labels is a different decision, made with numbers.")
}
if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify({
    servedSha, patchedSha,
    population: { files: admitted.files.length, digest: admitted.digest },
    sample: { files: sample.length, carryingDirective: withDirective.length, stride: stride.length, unparseable: failed },
    totals, movedFiles: movedFiles.length, nonPartOfMovedFiles: nonPartOf.length,
    perFile,
  }, null, 2))
  console.log(`WROTE ${jsonOut}`)
}
process.exit(nonPartOf.length === 0 ? 0 : 6)
