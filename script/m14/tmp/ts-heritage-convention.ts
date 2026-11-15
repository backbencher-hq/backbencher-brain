/**
 * M60 oracle-sharpness spin-off: the typescript lane's heritage-target SPELLING,
 * per owner kind. The sharpness sweep found 4 SOFT rows on 1,474 files, all one
 * shape — `interface CSSProperties extends CSS.Properties<string | number>` — where
 * the truth spells `CSS.Properties` and the analyzer publishes `Properties`. The
 * interface path strips to the leaf by documented contract (TSD3, real-typescript-
 * analyzer.ts ~5060). reviews/javascript/master-review.md records that TS strips
 * while JS keeps `Lib.Base` dotted, and calls it an owner ruling, not a code change.
 *
 * What has never been measured is whether TS is consistent with ITSELF: the CLASS
 * heritage path (extractClassHeritage) pushes `type.text` with no leaf-strip. If the
 * two paths disagree, the lane publishes two spellings for one relationship kind and
 * the documented contract is only half-applied — a different, smaller question than
 * the cross-family one.
 */
import { RealTypeScriptAnalyzer } from "../../../src/ast/real-typescript-analyzer"

const SRC = [
  "class A extends CSS.Properties<number> {}",
  "class B extends ns.Base {}",
  "class C implements ns.Iface<number> {}",
  "interface D extends CSS.Properties<number> {}",
  "interface E extends ns.Base {}",
  "interface F extends Readable<T> {}",
].join("\n")

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const fs = await import("fs")
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-typescript.wasm"))
  const parser = new P()
  parser.setLanguage(lang)
  const az = new RealTypeScriptAnalyzer()
  const s: any = az.analyze(parser.parse(SRC).rootNode, SRC, "probe.ts")
  for (const r of s.relationships ?? []) {
    if (["extends", "implements"].includes(String(r.type))) {
      console.log(`${String(r.type).padEnd(11)} ${String(r.source).padEnd(3)} -> ${JSON.stringify(r.target)}`)
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
