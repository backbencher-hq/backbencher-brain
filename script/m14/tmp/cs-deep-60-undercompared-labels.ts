/**
 * 2026-09-29: measure per-label coverage for the csharp labels the oracle DERIVES but the
 * compared-label set does not include.
 *
 * THE GAP THIS MEASURES. csharp's compared set is ["calls","contains","references","uses"].
 * `deriveCSharpEdges` additionally derives `extends`, `implements`, `instantiates` and `overrides`.
 * `overrides` is excluded on BOTH sides with a written justification (C923) and independent
 * evidence, so it is accounted for. The other three are PUSHED INTO TRUTH and then dropped at
 * comparison time by the allowlist — derived at real cost, checked by nothing. A lane reporting
 * "100% covered, MISSING=0" is therefore silent about four of its labels.
 *
 * THE MATCHER IS THE HARNESS'S, and that is the whole point of this file's second half.
 *
 * My first version compared the RAW target. It reported `instantiates` at 107/110, with three
 * "disagreements" that were `new DiagnosticHelper.LocalizableStringWithArguments(...)` against a
 * truth target of `LocalizableStringWithArguments`. I was one commit away from filing that as
 * CS-D11, an analyzer defect with a fixture, a mutant and a commit message.
 *
 * It was not a defect. The harness matches on `label + normTarget(target)`, and `normTarget` is
 * the LAST SEGMENT, so the qualifier is discarded by design. The analyzer keeps the qualified
 * path deliberately — `csharpCleanTypeLeaf` carries the comment "keep qualified paths verbatim, no
 * last-segment collapse" — which is strictly MORE information than the leaf, and the matcher is
 * what reduces it. Both sides were right and my probe was asking a different question.
 *
 * A measurement with a private matcher is worse than no measurement: it manufactures defects that
 * do not exist, and it does so at a cost that makes the finding feel expensive enough to be true.
 * So this probe imports `normTarget` from the harness rather than reimplementing it, and the
 * ordering matters: read the matcher BEFORE believing the two sides disagree.
 */
import * as fs from "fs"
import * as path from "path"
import { Language } from "web-tree-sitter"

const ROOT = process.cwd()
const UNDERSCORE = new Set(["extends", "implements", "instantiates", "overrides"])

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined
}

const wts: any = await import("web-tree-sitter")
const Parser = wts.Parser ?? wts.default ?? wts
await Parser.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-c_sharp.wasm")))
const parser = new Parser()
parser.setLanguage(grammar)

const mod: any = await import(path.join(ROOT, "src/ast/real-csharp-analyzer.ts"))
const analyzer = new mod.RealCSharpAnalyzer()
const diff: any = await import(path.join(ROOT, "script/m14/differential.ts"))
const derive = diff.deriveCSharpEdges
const normTarget: (t: string) => string = diff.normTarget
const strictText: (t: string) => string = diff.strictTargetText

async function main() {
  const listFile = arg("--list")
  if (!listFile) { console.error("usage: cs-deep-60 --list <paths> [--limit N]"); process.exit(2) }
  const limit = Number(arg("--limit") ?? 120)
  const files = fs.readFileSync(listFile, "utf8").split("\n").map((f) => f.trim()).filter(Boolean).slice(0, limit)

  const tot = new Map<string, number>()
  const cov = new Map<string, number>()
  const strictCov = new Map<string, number>()
  const samples = new Map<string, string[]>()
  let filesWithAny = 0

  for (const f of files) {
    let src: string
    try { src = fs.readFileSync(f, "utf8") } catch { continue }
    if (src.length > 1_000_000) continue
    let root: any
    try { root = parser.parse(src)?.rootNode } catch { continue }
    if (!root) continue

    let rels: any[] = []
    try { rels = (await analyzer.analyze(root, f, src))?.relationships ?? [] } catch { continue }

    const have = new Set<string>()        // the harness matcher: last segment
    const haveStrict = new Set<string>()  // the sharper question: target AS WRITTEN
    for (const r of rels) {
      const l = r.type ?? r.label ?? r.relationshipType
      if (!l) continue
      const t = String(r.target ?? "")
      have.add(`${l} ${normTarget(t)}`)
      haveStrict.add(`${l} ${strictText(t)}`)
    }

    let edges: any[] = []
    try { edges = derive(root) } catch { continue }
    let any = false
    for (const e of edges) {
      if (!UNDERSCORE.has(e.label)) continue
      any = true
      tot.set(e.label, (tot.get(e.label) ?? 0) + 1)
      const key = `${e.label} ${normTarget(String(e.target))}`
      if (have.has(key)) {
        cov.set(e.label, (cov.get(e.label) ?? 0) + 1)
        if (haveStrict.has(`${e.label} ${strictText(String(e.target))}`)) {
          strictCov.set(e.label, (strictCov.get(e.label) ?? 0) + 1)
        }
      } else {
        const arr = samples.get(e.label) ?? []
        if (arr.length < 6) arr.push(`    ${path.basename(f)}  ${e.from} -[${e.label}]-> ${e.target}`)
        samples.set(e.label, arr)
      }
    }
    if (any) filesWithAny++
  }

  console.log(`under-compared csharp labels — ${files.length} files, ${filesWithAny} carry at least one\n`)
  console.log("  matched with the HARNESS rule (last segment), and the STRICT rule (as written)\n")
  console.log("  label           truth  covered    pct   strict    pct")
  for (const l of [...UNDERSCORE].sort()) {
    const t = tot.get(l) ?? 0
    const c = cov.get(l) ?? 0
    const s = strictCov.get(l) ?? 0
    const pc = t === 0 ? "n/a" : `${((c / t) * 100).toFixed(1)}%`
    const ps = t === 0 ? "n/a" : `${((s / t) * 100).toFixed(1)}%`
    console.log(`  ${l.padEnd(14)}${String(t).padStart(6)}${String(c).padStart(9)}  ${pc.padStart(6)}   ${String(s).padStart(5)}  ${ps.padStart(6)}`)
  }
  for (const [l, arr] of samples) {
    if (arr.length === 0) continue
    console.log(`\n  ${l} disagreements (${Math.max(0, (tot.get(l) ?? 0) - (cov.get(l) ?? 0))} total):`)
    for (const s of arr) console.log(s)
  }
  const gap = [...UNDERSCORE].some((l) => (strictCov.get(l) ?? 0) !== (cov.get(l) ?? 0))
  if (gap) {
    console.log(`\n  The strict column is LOWER than the harness column, so a truth row is being satisfied`)
    console.log(`  by an edge that merely SHARES A LEAF. That is the known weakness of last-segment`)
    console.log(`  matching, and on these labels it is real rather than hypothetical.`)
  }
  console.log(`\n  A label the compared set omits cannot appear in any published F5 number, whatever its`)
  console.log(`  coverage here. This script is the only thing that has ever asked the question.`)
}

await main()
