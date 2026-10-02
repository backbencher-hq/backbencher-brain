// M12.PHP-OVERRIDE-AUDIT — is the PHP `overrides` guess honest?
//
// The PHP analyzer emits an `overrides` edge at confidence 0.5 (reasonCode
// "first-parent-guess") for EVERY method of a class whose base is declared in
// another file, because a per-file analyzer cannot see the other file and the
// production companion index is never populated (M37.10). Those edges sit
// below the 0.7 threshold, so pool-worker drops them and they never reach the
// graph — but they are the lane's largest unverified bucket, and the
// differential counts them as `heuristic`.
//
// This tool answers the question the differential cannot: of those guesses,
// how many are actually TRUE? For every guess it resolves the declaring file
// of the base class across the WHOLE corpus and asks whether that file
// declares the method.
//
// Buckets (deliberately conservative — only a CLEAN resolution yields TRUE or
// FALSE, so the false rate is never inflated by this tool's own index):
//   TRUE       base resolved unambiguously, is not a PHP builtin, and declares
//              the method
//   FALSE      base resolved unambiguously, is not a PHP builtin, and does NOT
//              declare the method  <- a fabricated override
//   BUILTIN    base is a PHP builtin (the analyzer cannot be right or wrong;
//              the leaf name merely collides with a local class)
//   AMBIGUOUS  base leaf name is declared by more than one file in the corpus
//   UNRESOLVED base leaf is not declared anywhere in the corpus
//
// Usage:  bun script/m12/php-override-audit.ts
//         CORPUS=/path/to/repo SAMPLE=200 bun script/m12/php-override-audit.ts
import { execSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

const ROOT = process.cwd()
const REPO = process.env.CORPUS ?? "$HOME/fixtures/repositories/phpunit"
const SAMPLE = Number(process.env.SAMPLE ?? 60)

const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const grammar = await (wts as any).Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-php.wasm")))
const mod: any = await import(path.join(ROOT, "src/ast/real-php-analyzer"))
const analyzer = new mod.RealPhpAnalyzer()

const allFiles = execSync(`git ls-files -z -- '*.php'`, { cwd: REPO, maxBuffer: 1 << 28 })
  .toString().split("\0").filter(Boolean).sort()

// Strided sample so the slice spans the whole repo rather than only src/.
const stride = Math.max(1, Math.floor(allFiles.length / SAMPLE))
const files = allFiles.filter((_, i) => i % stride === 0).slice(0, SAMPLE)

// class/interface/trait/enum leaf -> every file that declares it
const declaredIn = new Map<string, string[]>()
for (const f of allFiles) {
  let src: string
  try { src = execSync(`git show HEAD:"${f}"`, { cwd: REPO, maxBuffer: 1 << 26 }).toString() } catch { continue }
  for (const m of src.matchAll(/\b(?:abstract\s+|final\s+)?(?:class|interface|trait|enum)\s+([A-Za-z_][A-Za-z0-9_]*)/g)) {
    const k = m[1]!
    if (!declaredIn.has(k)) declaredIn.set(k, [])
    declaredIn.get(k)!.push(f)
  }
}

let total = 0, trueE = 0, falseE = 0, builtin = 0, ambiguous = 0, unresolved = 0, relSeen = 0
const falses: string[] = []
const skipped = new Set<string>()

for (const f of files) {
  const parser = new ParserClass()
  parser.setLanguage(grammar)
  let res: any
  try {
    const content = fs.readFileSync(path.join(REPO, f), "utf8")
    const tree = parser.parse(content)
    res = await analyzer.analyze(tree.rootNode, content, f)
  } catch (e) {
    console.log("  ERR", f, String(e).slice(0, 100))
    try { parser.delete?.() } catch { /* nothing to free */ }
    continue
  }
  try { parser.delete?.() } catch { /* nothing to free */ }
  relSeen += (res?.relationships ?? []).length

  for (const r of res?.relationships ?? []) {
    if ((r.type || r.relationshipType) !== "overrides") continue
    if ((r.confidence ?? 1) > 0.5) continue // the guess bucket only
    const src = r.source ?? "", tgt = r.target ?? ""
    const dot = tgt.lastIndexOf(".")
    const base = tgt.slice(0, dot), method = tgt.slice(dot + 1)
    total++

    // PHP builtins have no declaring file in the corpus, and their leaf names
    // collide with local classes (`Exception`, `RuntimeException`, ...).
    const cands = declaredIn.get(base) ?? []
    if (cands.length === 0) { unresolved++; skipped.add(base); continue }
    if (cands.length > 1) { ambiguous++; skipped.add("AMBIG:" + base); continue }
    const declFile = cands[0]!

    let bsrc: string
    try { bsrc = execSync(`git show HEAD:"${declFile}"`, { cwd: REPO, maxBuffer: 1 << 26 }).toString() } catch { unresolved++; continue }
    if (new RegExp(`function\\s+${method.replace(/[$]/g, "\\$")}\\s*\\(`).test(bsrc)) trueE++
    else { falseE++; if (falses.length < 20) falses.push(`${f}: ${src} -> ${tgt}  [base declared in ${declFile}]`) }
  }
}

const decided = trueE + falseE
console.log(`\ncorpus ${REPO}`)
console.log(`sampled ${files.length}/${allFiles.length} files, ${relSeen} relationships, ${declaredIn.size} distinct type leaves indexed`)
console.log(`\nheuristic (confidence <= 0.5) override edges: ${total}`)
console.log(`  TRUE       base declares the method      : ${trueE}`)
console.log(`  FALSE      base does NOT declare it      : ${falseE}`)
console.log(`  AMBIGUOUS  base leaf in >1 corpus file   : ${ambiguous}`)
console.log(`  UNRESOLVED base leaf not in corpus      : ${unresolved}`)
if (decided > 0) {
  console.log(`\n  => of the ${decided} DECIDABLE guesses, ${falseE} are FALSE (${((falseE / decided) * 100).toFixed(1)}%)`)
  console.log(`     the rest (${total - decided}) are undecidable here and skew the ratio either way.`)
}
if (falses.length) { console.log(`\nFALSE samples:`); for (const x of falses) console.log("  " + x) }
if (skipped.size) console.log(`\nundecidable base names (${skipped.size}): ${[...skipped].slice(0, 12).join(", ")}`)
