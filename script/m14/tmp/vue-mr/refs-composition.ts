// The `references` oracle gap, scoped. Before writing an oracle I need the FULL
// composition of what actually emits this label, decomposed by the metadata the
// producers set — otherwise the oracle is written against a guess and the
// differential reports the difference as MISSING.
import * as fs from "fs"
import { vue, rels } from "./harness"

const CORPUS = "/home/ishaq2321/bb_tests/repositories"

function under(root: string, limit: number) {
  const out: string[] = []
  const walk = (d: string) => {
    if (out.length >= limit) return
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (out.length >= limit) return
      if (e.name === ".git" || e.name === "node_modules" || e.name === "dist") continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith(".vue")) out.push(p)
    }
  }
  walk(root)
  return out.sort()
}
import * as path from "path"

async function main() {
  const files = [...under(`${CORPUS}/element-plus`, 400), ...under(`${CORPUS}/vue-element-admin`, 200)]
  // every references edge, keyed by WHAT produced it
  const byKind = new Map<string, { n: number; conf: Set<number>; ex: string[]; mdKeys: Set<string> }>()
  let total = 0
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    const r = await vue(src, f)
    for (const rel of rels(r, "references")) {
      total++
      const md: any = rel.metadata ?? {}
      // the discriminator is the producer's own marker, in priority order
      const kind = md.isPropContract ? "F12 prop contract"
        : md.isEmitContract ? "F12 emit contract"
        : md.isProvideContract ? "F2 provide"
        : md.isInjectContract ? "F2 inject"
        : md.isDecorator ? "JS decorator"
        : md.relationshipType === "instanceof_check" ? "JS instanceof"
        : md.relationshipType === "type_argument" ? "TS type argument"
        : md.isTypeReference ? "TS type reference"
        : md.sourceKind ? `TS sourceKind=${md.sourceKind}`
        : "(unmarked)"
      const e = byKind.get(kind) ?? { n: 0, conf: new Set<number>(), ex: [], mdKeys: new Set<string>() }
      e.n++
      if (typeof rel.confidence === "number") e.conf.add(rel.confidence)
      for (const k of Object.keys(md)) e.mdKeys.add(k)
      if (e.ex.length < 3) e.ex.push(`${path.relative(CORPUS, f)}  ${rel.source} -> ${rel.target} @${(rel as any).line_number}`)
      byKind.set(kind, e)
    }
  }
  console.log(`=== references composition over ${files.length} corpus files ===`)
  console.log(`  total references edges: ${total}`)
  for (const [k, e] of [...byKind.entries()].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`\n  ${k}: ${e.n}  conf=[${[...e.conf].join(",")}]`)
    console.log(`    metadata keys: ${[...e.mdKeys].join(" ")}`)
    for (const x of e.ex) console.log(`    ${x}`)
  }
}
main()