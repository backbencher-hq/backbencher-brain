// M59 (#825) — scala call-site line diagnosis.
//
// #825 records that scala "records the enclosing expression's start line rather
// than the call node's line in multi-line expressions", and that 330 of 7,517
// landed lines fail a source check. This probe measures that directly instead of
// trusting the summary: for every relationship carrying a line_number it asks
// whether the TARGET name actually appears on the claimed line of the source.
//
// Usage: bun script/m59/probe-scala-lines.ts <path-to.scala> [--all]
import { readFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const file = process.argv[2]
const showAll = process.argv.includes("--all")
if (!file) {
  console.error("usage: bun script/m59/probe-scala-lines.ts <path-to.scala> [--all]")
  process.exit(1)
}

async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const src = readFileSync(file, "utf8")
  const lines = src.split("\n")
  const res: any = await ASTEngine.parseFile(file, src)
  const rels: any[] = res?.relationships ?? []
  const withLine = rels.filter((r) => typeof r.line_number === "number" && r.line_number > 0)

  let exact = 0
  let wrongLine = 0
  let unknown = 0
  const wrong: string[] = []

  for (const r of withLine) {
    const tgt = String(r.target ?? r.to ?? "?")
    const claim = r.line_number as number
    const type = r.type ?? r.relationshipType ?? "?"
    // Types whose target is a TYPE name, not a call — the presence check is
    // meaningless there (the name may legitimately appear elsewhere), so they
    // are counted separately rather than scored as failures.
    const isCallish = type === "calls" || type === "references" || type === "instantiates"
    const text = lines[claim - 1] ?? ""
    const leaf = tgt.split(".").pop() ?? tgt
    const present = text.includes(leaf)
    if (!isCallish) {
      unknown++
    } else if (present) {
      exact++
    } else {
      wrongLine++
      wrong.push(`  line ${claim} claims ${type} → ${tgt}\n      source: ${text.trim().slice(0, 90)}`)
    }
  }

  const distinct = new Set(withLine.map((r) => r.line_number as number))
  const mult = new Map<number, number>()
  for (const r of withLine) mult.set(r.line_number, (mult.get(r.line_number) ?? 0) + 1)
  const worst = [...mult.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)

  console.log(`${path.basename(file)}`)
  console.log(`  relationships=${rels.length} withLine=${withLine.length}  distinct lines=${distinct.size}`)
  console.log(`  call-ish lines whose target IS on the claimed line : ${exact}`)
  console.log(`  call-ish lines whose target is NOT on that line    : ${wrongLine}`)
  console.log(`  non-call edges (check n/a)                          : ${unknown}`)
  console.log(`  worst line multiplicity: ${worst.map(([l, n]) => `${n} on line ${l}`).join(", ") || "n/a"}`)
  if (wrong.length) {
    console.log(`\n  claimed lines that fail the source check:`)
    for (const w of (showAll ? wrong : wrong.slice(0, 8))) console.log(w)
    if (!showAll && wrong.length > 8) console.log(`  … ${wrong.length - 8} more (use --all)`)
  }
}

main().catch((e) => {
  console.error("FATAL", e)
  process.exit(1)
})
