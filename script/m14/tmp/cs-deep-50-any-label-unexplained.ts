// CS-DEEP-50 — the 1 unexplained analyzer edge on aspnetcore, found by any label.
//
// cs-deep-37 does this for `uses` only. F5 reports unexplained per LABEL, so a row in `calls`,
// `contains`, `extends`, `implements`, `overrides`, `references` or `instantiates` would be
// invisible to that probe. This one is label-agnostic by construction: it asks the two sides for
// the same key shape the gate uses — label + target — and prints every key exactly one side has.
//
// Why target-only and not source: the gate matches label+target, and the two sides name the
// SOURCE differently (the analyzer qualifies it, the oracle does not), so a source-sensitive
// comparison reports the convention difference as a fabrication. That difference is invisible to
// F5 and is NOT the thing to chase here.
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined
}

async function main() {
  const listFile = arg("--list")
  const repo = arg("--repo") ?? "aspnetcore"
  if (!listFile) { console.error("usage: cs-deep-50-any-label-unexplained.ts --list <paths> [--repo NAME] [--limit N]"); process.exit(2) }
  const limit = Number(arg("--limit") ?? 120)

  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c_sharp.wasm")))
  const parser = new P()
  parser.setLanguage(grammar)
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const mod: any = await import(path.join(ROOT, "script/m14/differential.ts"))

  // the same corpus interface companion the harness builds, so the oracle's kind precedence sees
  // the same evidence the analyzer saw
  const files = fs.readFileSync(listFile, "utf8").split("\n").map((f) => f.trim()).filter(Boolean).slice(0, limit)
  const corpusInterfaces = new Set<string>()
  const re = /\binterface\s+([A-Za-z_][A-Za-z0-9_]*)/g
  for (const f of files) {
    let s: string
    try { s = fs.readFileSync(f, "utf8") } catch { continue }
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(s))) if (m[1]) corpusInterfaces.add(m[1])
  }

  let unexp = 0
  let miss = 0
  const rows: string[] = []
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    let res: any
    let root: any
    try { res = await ASTEngine.parseFile(f, src); root = parser.parse(src).rootNode } catch { continue }
    if (!root) continue
    const COMPARED = new Set(["calls", "contains", "references", "uses"])
    const truth = new Set<string>()
    for (const e of mod.deriveCSharpEdges(root, corpusInterfaces) ?? []) {
      if (e.label === "overrides") continue   // C923: excluded from csharp's comparison
      truth.add(`${e.label}:${e.target}`)
    }
    for (const e of mod.deriveCSharpContains(root) ?? []) truth.add(`${e.label}:${e.target}`)
    for (const e of mod.deriveCSharpDeclaredTypeEdges(root) ?? []) truth.add(`${e.label}:${e.target}`)
    for (const e of mod.deriveCSharpUsingReferences(root) ?? []) truth.add(`${e.label}:${e.target}`)
    for (const e of mod.deriveCSharpFieldAccessUses(root) ?? []) truth.add(`${e.label}:${e.target}`)
    for (const e of mod.deriveCSharpBareUses(root, res.symbols ?? []) ?? []) truth.add(`${e.label}:${e.target}`)

    const an = new Set<string>()
    const byKey = new Map<string, any>()
    // Apply csharp's COMPARED set, or the probe reports `overrides` as unexplained 16 times. That
    // label is excluded from csharp's comparison on the ANALYZER side by the C923 rule (the truth
    // derives member-level interface contracts and would read every TRUE edge as MISSING), so
    // rows in it are outside the gate by design. The first cut of this probe did not apply the
    // allowlist and duly reported 16 "fabrications" that are the exclusion working as intended —
    // which is the mirror of the mistake this whole round has been about: reporting a
    // manufactured red and calling it a finding.
    for (const r of res.relationships ?? []) {
      const l = r.type ?? r.relationshipType
      if (typeof l !== "string") continue
      if (!COMPARED.has(l)) continue
      const k = `${l}:${r.target}`
      an.add(k)
      if (!byKey.has(k)) byKey.set(k, r)
    }
    for (const k of an) {
      if (truth.has(k)) continue
      unexp++
      if (rows.length < 20) {
        const r = byKey.get(k)!
        const ln = Number(r.line_number)
        rows.push(`  ${path.basename(f)}\n     ANALYZER-only  ${k}  source=${r.source} line=${ln}\n        | ${(src.split("\n")[ln - 1] ?? "?").trim().slice(0, 100)}`)
      }
    }
    for (const k of truth) if (!an.has(k)) miss++
  }
  console.log(`  ${repo}: ${files.length} files   ANALYZER-only (unexplained): ${unexp}   TRUTH-only (missing): ${miss}`)
  for (const r of rows) console.log(r)
}

if (import.meta.main) await main()
