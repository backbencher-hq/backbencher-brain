// M49 W15: re-derive web findings #813 / #814 live at HEAD (the W13 probes were
// cleaned up after the wave; the docs record the claims but a doc is not a probe).
//   #813 one private member has two names in the graph — symbol stored STRIPPED,
//        reading edges carry '#'.
//   #814 JS and TS disagree on the SOURCE of a `this.x` read — JS -> enclosing
//        TYPE, TS -> enclosing METHOD, identical source shape.
import * as fs from "fs"
import * as path from "path"
import * as WTS from "web-tree-sitter"

import { fileURLToPath } from "node:url"
const __dirname = fileURLToPath(new URL(".", import.meta.url)).replace(/[\\/]+$/, "")

const ROOT = path.resolve(import.meta.dir ?? __dirname, "..", "..", "..")
const WASM_DIR = path.join(ROOT, "wasm")

const SRC = [
  "class Store {",
  "  count = 0;",
  "  #hidden = 1;",
  "  read() {",
  "    return this.count;",
  "  }",
  "  peek() {",
  "    return this.#hidden;",
  "  }",
  "}",
].join("\n")

async function analyze(lang: "javascript" | "typescript") {
  const cfg =
    lang === "javascript"
      ? { wasm: "tree-sitter-javascript.wasm", file: "real-javascript-analyzer", cls: "RealJavaScriptAnalyzer", ext: "js" }
      : { wasm: "tree-sitter-typescript.wasm", file: "real-typescript-analyzer", cls: "RealTypeScriptAnalyzer", ext: "ts" }
  const wts: any = WTS
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const language = await L.load(fs.readFileSync(path.join(WASM_DIR, cfg.wasm)))
  const parser = new P()
  parser.setLanguage(language)
  const src = lang === "typescript" ? SRC + "\n" : SRC
  const tree = parser.parse(src)
  if (tree.rootNode.hasError) throw new Error(`probe snippet has parse errors for ${lang}`)
  const mod = await import(`../../../src/ast/${cfg.file}`)
  const analyzer = new mod[cfg.cls]()
  return await analyzer.analyze(tree.rootNode, src, `probe.${cfg.ext}`)
}

function show(label: string, r: any) {
  console.log(`\n=== ${label} ===`)
  console.log("-- symbols (private member names as stored) --")
  for (const s of r.symbols ?? []) {
    const name = s.name ?? s.symbolName ?? "?"
    if (String(name).includes("hidden") || String(name).includes("count") || String(name).includes("Store")) {
      console.log(`   symbol ${JSON.stringify(name)}  kind=${s.kind ?? "?"}  owner=${s.ownerName ?? s.owner ?? "-"}`)
    }
  }
  console.log("-- edges touching hidden/count --")
  for (const e of r.relationships ?? r.edges ?? []) {
    const t = String(e.target ?? e.to ?? "")
    const f = String(e.from ?? e.source ?? "")
    if (/hidden|count/.test(t) || /hidden|count/.test(f)) {
      console.log(`   ${JSON.stringify(e)}`)
    }
  }
}

const js = await analyze("javascript")
show("javascript", js)
const ts = await analyze("typescript")
show("typescript", ts)
console.log("\ndone")
