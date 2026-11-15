import { parseFile } from "./src/ast/pool-worker"
async function main() {
  const f = process.argv[2]
  const r: any = await parseFile(f)
  const syms = r.symbols ?? []
  const rels = r.relationships ?? []
  console.log("file:", f)
  console.log("symbols:", syms.map((s: any) => `${s.name}:${s.kind}`).join(" | "))
  console.log("relationships:", rels.length)
  for (const x of rels) console.log("  ", JSON.stringify({ t: x.type, from: x.from, to: x.to, ev: x.evidenceClass, conf: x.confidence }))
}
void main()
