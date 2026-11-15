/**
 * `dump-dtd.mts` — the grammar shape the public-identifier fix rests on, printable.
 *
 * Run it on a file whose internal DTD subset carries the two ExternalID shapes and the
 * difference is visible without reading any prose:
 *
 *   npx tsx validation/m14/fixtures/xml/dump-dtd.mts \
 *     /home/ishaq2321/bb_tests/repositories/libxslt/tests/general/bug-52.xml
 *
 *   GEDecl        <!ENTITY graphic SYSTEM "graphic.gif" NDATA GIF>
 *     ExternalID  SYSTEM "graphic.gif"
 *       SystemLiteral  "graphic.gif"      <- a PATH; this is the only shape that imports
 *
 *   NotationDecl  <!NOTATION GIF PUBLIC "GIF">
 *     PublicID     PUBLIC "GIF"
 *       PubidLiteral   "GIF"              <- a CATALOGUE NAME; names no file
 *
 * `tree-sitter-xml` gives the two forms DIFFERENT node types, and the analyzer's old read
 * (`ExternalID || (isNotation ? PublicID : null)`, then `SystemLiteral || PubidLiteral`)
 * collapsed them. That is the whole defect: `PublicID` has no `SystemLiteral` child, so a
 * read that falls back to `PubidLiteral` is not reading a file at all.
 *
 * It prints the `doctypedecl` subtree to depth 4 and nothing else, and takes one path
 * argument. No regular expression: the node-type comparisons are `===` on grammar
 * constants and the depth bound is an integer.
 */
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default
const L = wts.Language ?? wts.default?.Language
const path = await import("node:path")
const HERE = import.meta.dirname
await P.init({ locateFile: () => path.join(HERE, "../../../../node_modules/web-tree-sitter/tree-sitter.wasm") })
const fs = await import("node:fs")
const p = new P()
p.setLanguage(await L.load(fs.readFileSync(path.join(HERE, "../../../../wasm/tree-sitter-xml.wasm"))))
const f = process.argv[2]!
const t = p.parse(fs.readFileSync(f, "utf8"))
const dump = (n: any, d: number) => {
  if (d > 4) return
  console.log(`${"  ".repeat(d)}${n.type} named=${n.isNamed} ${JSON.stringify(n.text.slice(0, 70))}`)
  for (let i = 0; i < n.childCount; i++) dump(n.child(i), d + 1)
}
const find = (n: any): any => {
  if (n.type === "doctypedecl") return n
  for (let i = 0; i < n.childCount; i++) {
    const r = find(n.child(i))
    if (r) return r
  }
  return null
}
const dt = find(t.rootNode)
dump(dt, 0)
