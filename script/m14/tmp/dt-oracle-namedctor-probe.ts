// script/m14/tmp/dt-oracle-namedctor-probe.ts — why does the ORACLE miss the
// named-constructor call the analyzer publishes?
//
// The full-extent dart-http draw found 27 analyzer-only `instantiates` edges in
// one generated bindings file, every one a `Foo.named(...)` construction whose
// declaration sits in the same file (verified by reading the source). This probe
// replays the oracle's OWN prescan (`dartNamedCtors`, copied verbatim from
// script/m14/differential.ts) and prints, for each constructor signature it
// walks past, the parent chain it resolves to a class — the oracle registers
// `Owner.segment` only when that walk lands on `class_definition`.
//
// Usage: bun script/m14/tmp/dt-oracle-namedctor-probe.ts <file.dart> [Name]
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"

async function main() {
  const file = process.argv[2]
  const only = process.argv[3]
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-dart.wasm")))
  const p = new P(); p.setLanguage(LANG)
  const root: any = p.parse(fs.readFileSync(file, "utf8")).rootNode

  const CTOR = new Set(["constructor_signature", "factory_constructor_signature", "constant_constructor_signature", "redirecting_factory_constructor_signature"])
  const registered: string[] = []
  const unregistered: string[] = []
  const stack: any[] = [root]
  while (stack.length > 0) {
    const pn = stack.pop()!
    if (!pn) continue
    if (CTOR.has(pn.type)) {
      const dids: string[] = []
      for (let k = 0; k < pn.namedChildCount; k++) {
        const c = pn.namedChild(k)
        if (c && (c.type === "identifier" || c.type === "type_identifier")) dids.push(c.text)
      }
      const chain: string[] = []
      let own: any = pn.parent
      let og = 0
      while (own && og++ < 8) {
        chain.push(own.type)
        if (own.type === "class_definition") break
        own = own.parent
      }
      const onm = own && own.type === "class_definition" ? own.childForFieldName?.("name")?.text : null
      const seg = dids.find((id) => id !== onm)
      const line = pn.startPosition?.row + 1
      const rec = `${line}\t${pn.type}\tdids=[${dids.join(",")}]\tonm=${onm}\tseg=${seg}\tchain=${chain.join(">")}`
      if (onm && seg) registered.push(`${onm}.${seg}\t${rec}`)
      else unregistered.push(rec)
    }
    for (let k = pn.namedChildCount - 1; k >= 0; k--) { const c = pn.namedChild(k); if (c) stack.push(c) }
  }
  console.log(`registered ${registered.length} named ctor(s), unregistered ${unregistered.length} constructor signature(s)`)
  const filtered = only ? registered.filter((r) => r.includes(only)) : registered
  console.log(`--- registered (showing ${Math.min(filtered.length, 20)})`)
  for (const r of filtered.slice(0, 20)) console.log("  " + r)
  console.log(`--- unregistered (showing ${Math.min(unregistered.length, 10)})`)
  for (const r of unregistered.slice(0, 10)) console.log("  " + r)
}
main().then(() => process.exit(0))
