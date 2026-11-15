// Generate validation/m14/fixtures/php/dynamic-member-reads.expectation.json
// from the MEASUREMENT, with forbids authored for the fabricated spellings.
import * as fs from "fs"
import * as path from "path"
import { RealPhpAnalyzer } from "../../../src/ast/real-php-analyzer"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const FIX = path.join(ROOT, "validation/m14/fixtures/php/dynamic-member-reads.php")
const META_KEYS = ["isConstRead", "isMemberRead", "isConstFetch", "isLocalRead", "isGlobalRead", "isTearOff"]

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-php.wasm")))
  const src = fs.readFileSync(FIX, "utf8")
  const p = new P(); p.setLanguage(LANG)
  const root = p.parse(src).rootNode
  const r: any = await new RealPhpAnalyzer().analyze(root, src, "dynamic-member-reads.php")
  const expect = (r.relationships ?? [])
    .filter((x: any) => ["calls", "uses", "instantiates", "references", "extends", "implements", "overrides", "contains"].includes(String(x.type).toLowerCase()))
    .map((x: any) => {
      const e: Record<string, any> = { type: String(x.type).toLowerCase(), from: x.source, target: x.target }
      if (typeof x.line_number === "number") e.line_number = x.line_number
      for (const k of META_KEYS) if (x.metadata?.[k] === true) e[`meta.${k}`] = true
      return e
    })
    .filter((e: any, i: number, arr: any[]) => arr.findIndex((x: any) => JSON.stringify(x) === JSON.stringify(e)) === i)
    .sort((a: any, b: any) => (a.type + a.from + a.target).localeCompare(b.type + b.from + b.target))

  const doc = {
    fixtureId: "php/dynamic-member-reads",
    language: "php",
    authoredBeforeAnalyzerRun: true,
    rationale:
      "M60 php lane — STATIC vs DYNAMIC member names. A property read names a member only when the name is a static `name` node; the old rule on BOTH sides was a proxy (the analyzer skipped a name whose text starts with `$`, the oracle pushed the raw name-field text), and the proxy is what the dynamic spellings break. Measured with script/m14/tmp/php-dynamic-member-shapes.ts before either side was touched: `$postParams->$param` (phpmyadmin src/Http/ServerRequest.php:233 — the lane's MISSING) had the analyzer emitting NOTHING while the oracle published `uses -> $param`; `$box->{'quoted'}` and `$box->{1}` published a STRING and an INTEGER LITERAL as symbol names, IDENTICALLY on both sides — invisible to the mirror by construction, which is why a fixture independent of the mirror is the only thing that can hold them. The discriminator is the anonymous `{` token the pinned grammar keeps around the name field, probe-verified: `$o->NAME` is [variable_name, ~->, name], `$o->{NAME}` is [variable_name, ~->, ~{, name, ~}]. A braced field is a dynamic selection — no member symbol exists for it in the static graph — and the field's own expression reads come from the ordinary rules (a `$var` through the frame chain, a file const, an inner `$this->x`), which is why `FIELD` and the inner `plain` ARE expected below.",
    expectRelationships: expect,
    forbidRelationships: [
      { type: "uses", target: "$param", note: "the raw name-field text: a `$`-prefixed target no other edge in this lane can spell (and the analyzer never emitted it — the lane read MISSING on phpmyadmin)" },
      { type: "uses", target: "$key", note: "same" },
      { type: "uses", target: "$key[0]", note: "same, braced subscript" },
      { type: "uses", target: "$this->plain", note: "same, inner member expression pushed verbatim" },
      { type: "uses", target: "'quoted'", note: "a STRING literal as a symbol name — fabrication on both sides" },
      { type: "uses", target: "7", note: "an INTEGER literal as a symbol name — fabrication on both sides" },
      { type: "uses", target: "quoted", note: "and not the unquoted spelling either: the literal is a value, not a member" },
      { type: "uses", target: "1" },
      { type: "uses", target: "2" },
      { type: "uses", target: "3" },
      { type: "uses", target: "void" },
      { type: "uses", target: "int" },
      { type: "uses", target: "string" },
      { type: "uses", target: "array" },
    ],
  }
  const out = path.join(ROOT, "validation/m14/fixtures/php/dynamic-member-reads.expectation.json")
  fs.writeFileSync(out, JSON.stringify(doc, null, 2) + "\n")
  console.log(`wrote ${out}: ${expect.length} expect, ${doc.forbidRelationships.length} forbid`)
  for (const e of expect) console.log("  ", JSON.stringify(e))
}
main()
