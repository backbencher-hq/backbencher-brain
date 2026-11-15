// CS-DEEP-24 — does the new `contains` truth AGREE with the analyzer, and where not?
//
// Same discipline as cs-deep-21 (the `uses` dry run): a new truth is not correct because it
// compiles. Derive it for a corpus, compare against the analyzer's OWN `contains` rows, and
// print every row on either side that has no twin — so the remaining gap is a measured number
// with named shapes in it.
//
// THE COMPARISON IS WEAKER THAN IT LOOKS, and the weakness is stated up front because it
// bounds what a green result here can mean. The F5 matcher is site-agnostically label+target: it
// asks "does an analyzer `contains` row exist with this TARGET?", never "with this OWNER?". So
// this instrument DOES compare the owner (`from`) — which the gate cannot — and its zero is a
// STRONGER claim than the gate's. What neither can catch is a containment edge whose target is
// right and whose owner is wrong, unless the wrong owner produces a target nobody declared.
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined
}

async function main() {
  const listFile = arg("--list")
  if (!listFile) { console.error("usage: cs-deep-24-contains-reconcile.ts --list <paths> [limit]"); process.exit(2) }
  const limit = Number(arg("--limit") ?? 200)
  const files = fs.readFileSync(listFile, "utf8").split("\n").map((f) => f.trim()).filter(Boolean).slice(0, limit)

  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c_sharp.wasm")))
  const parser = new P()
  parser.setLanguage(grammar)
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const mod: any = await import(path.join(ROOT, "script/m14/tmp/cs-deep-23-contains-truth.ts"))

  let truthN = 0
  let lanN = 0
  let truthOnly = 0
  let lanOnly = 0
  let ownerMismatch = 0
  let targetOnlyMismatch = 0
  const toRows: string[] = []
  const loRows: string[] = []
  const ownerRows: string[] = []

  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    let res: any
    try { res = await ASTEngine.parseFile(f, src) } catch { continue }
    const truth = mod.deriveCSharpContains(parser.parse(src).rootNode)
    if (truth.length === 0) continue
    const tOwner = new Set(truth.map((t: any) => `${t.from}|${t.target}`))
    const tTarget = new Set(truth.map((t: any) => `${t.target}`))
    const lan = new Set<string>()
    const lanTarget = new Set<string>()
    for (const r of res.relationships ?? []) {
      if ((r.type ?? r.relationshipType) !== "contains") continue
      lan.add(`${r.source}|${r.target}`)
      lanTarget.add(String(r.target))
    }
    truthN += truth.length
    lanN += lan.size
    for (const t of truth) {
      if (!lan.has(`${t.from}|${t.target}`)) {
        truthOnly++
        if (toRows.length < 18) toRows.push(`${path.basename(f)}  TRUTH-only(owner)  ${t.from} -> ${t.target}`)
      } else if (!lan.has(`${t.from}|${t.target}`)) ownerMismatch++
    }
    // the gate's own comparison: target-only
    for (const t of truth) if (!lanTarget.has(String(t.target))) targetOnlyMismatch++
    for (const k of lan) {
      if (!tOwner.has(k)) {
        lanOnly++
        if (loRows.length < 18) loRows.push(`${path.basename(f)}  ANALYZER-only      ${k.replace("|", " -> ")}`)
      }
    }
    if (toRows.length < 6 && lanOnly > 0) {
      for (const k of lan) if (!tOwner.has(k) && ownerRows.length < 8) ownerRows.push(`${path.basename(f)}  ${k.replace("|", " -> ")}`)
    }
  }

  console.log(`files: ${files.length}`)
  console.log(`\ncontains edges — truth: ${truthN}   analyzer: ${lanN}`)
  console.log(`   ANALYZER-only (the analyzer contains, the truth does not derive): ${lanOnly}`)
  console.log(`   TRUTH-only    (the truth derives, the analyzer does not contain): ${truthOnly}`)
  console.log(`\nthe GATE's comparison is target-only, so its verdict is:`)
  console.log(`   truth rows whose TARGET no analyzer contains row names: ${targetOnlyMismatch}`)
  if (toRows.length) { console.log(`\nTRUTH-only rows:`); for (const r of toRows) console.log(`   ${r}`) }
  if (loRows.length) { console.log(`\nANALYZER-only rows:`); for (const r of loRows) console.log(`   ${r}`) }
  console.log(`\nVERDICT: ${lanOnly === 0 && truthOnly === 0 ? "RECONCILED on (owner, target) — stronger than the gate's own target-only match" : "NOT reconciled — adjudicate the rows above before wiring"}`)
}

if (import.meta.main) await main()
