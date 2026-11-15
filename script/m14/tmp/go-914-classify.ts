// go #914 — classify EVERY analyzer-vs-oracle `implements` disagreement in one
// file, so each remaining row is either an ANALYZER gap or an ORACLE over-claim
// with a named cause. No guessing: method-by-method, with signatures.
//
// Run: bun script/m14/tmp/go-914-classify.ts <file.go>
import * as fs from "node:fs"
import { ASTEngine } from "../../../src/ast/engine"
import { RealGoAnalyzer } from "../../../src/ast/real-go-analyzer"
import { deriveGoImplements } from "../differential"

const file = process.argv[2]
const src = fs.readFileSync(file, "utf8")
const parser = await ASTEngine.getParser("go" as any)
const tree = parser.parse(src)
const analyzer: any = new RealGoAnalyzer()
const res: any = await analyzer.analyze(tree.rootNode, src, file)
const symbols: any[] = res.symbols ?? []

const sig = (m: any) => analyzer.buildGoMethodSignature(m)
const kinds = new Map<string, string>() // name -> declared kind in this file
for (const s of symbols) {
  if (["struct", "interface", "type", "class"].includes(String(s.kind))) {
    kinds.set(s.name, String(s.metadata?.isInterface ? "interface" : String(s.kind)))
  }
}

// Promoted method set, mirroring the analyzer's own promotion map.
const embeddedOf: Record<string, string[]> = {}
for (const r of res.relationships ?? []) {
  if (String(r.type) === "extends" && r.metadata?.relationshipType === "go_struct_embedding") {
    const s = String(r.source), t = String(r.target)
    if (s && t) (embeddedOf[s] ??= []).push(t)
  }
}
const methods = symbols.filter((s) => String(s.kind) === "method")
const promotedFor = (name: string) =>
  analyzer.collectGoPromotedMethods(name, methods, symbols, embeddedOf, new Set()) as any[]

const aRows = new Set<string>()
for (const r of res.relationships ?? []) {
  if (String(r.type) === "implements") aRows.add(`${r.source}->${r.target}`)
}
const oRows = deriveGoImplements(tree.rootNode)

console.log(`=== ${file}`)
const onlyOracle = oRows.filter((e) => !aRows.has(`${e.from}->${e.target}`))
const onlyAnalyzer = [...aRows].filter((k) => !oRows.some((e) => `${e.from}->${e.target}` === k))

const ifaceMethodsOf = (iface: string) => {
  const direct = methods.filter((m) => m.ownerName === iface)
  const inherited = analyzer.getGoInterfaceMethods(
    symbols.find((s) => s.name === iface && s.metadata?.isInterface) ?? { name: iface },
    symbols,
  ) as any[]
  return { direct, inherited, names: new Set(inherited.map((m: any) => m.name)) }
}
const implMethodsOf = (type: string) => [
  ...methods.filter((m) => m.ownerName === type),
  ...promotedFor(type),
]

console.log(`--- ORACLE-ONLY (${onlyOracle.length}) ---`)
for (const e of onlyOracle) {
  const { direct, inherited, names } = ifaceMethodsOf(e.target)
  const declared = kinds.get(e.from)
  const impl = implMethodsOf(e.from)
  let cause: string
  if (!declared) cause = `RECEIVER-ONLY implementor (no same-file type decl for \`${e.from}\`)`
  else if (direct.length === 0 && inherited.length === 0)
    cause = `INTERFACE METHODS UNSEEN (${e.target}: alias/embedded-only decl)`
  else {
    const bad: string[] = []
    const unseen: string[] = []
    for (const im of inherited) {
      const cand = impl.filter((s) => s.name === im.name)
      if (cand.length === 0) { unseen.push(im.name); continue }
      if (!cand.some((c) => sig(c) === im.signature)) bad.push(`${im.name}: iface[${im.signature}] impl[${cand.map(sig).join(" | ")}]`)
    }
    if (bad.length) cause = `SIGNATURE MISMATCH → oracle over-claim\n      ${bad.join("\n      ")}`
    else if (unseen.length) cause = `NAME SET MISMATCH (oracle-only names)\n      ${unseen.join(", ")}`
    else cause = `UNKNOWN — signatures all match, analyzer should have emitted it`
  }
  console.log(`  ${e.from} -> ${e.target}`)
  console.log(`      decl=${declared ?? "none"} ifaceMethods=${[...names].join(",") || "none"} implMethods=${impl.map((m: any) => m.name).join(",") || "none"}`)
  console.log(`      CAUSE: ${cause}`)
}
console.log(`--- ANALYZER-ONLY (${onlyAnalyzer.length}) ---`)
for (const k of onlyAnalyzer) console.log(`  ${k}`)
