import { Parser, Language } from "web-tree-sitter"
import * as fs from "fs"
import * as path from "path"
import { deriveRubyEdges } from "../../../script/m14/differential"
await Parser.init()
const ROOT = "/home/sano/ishaq/backbencher-brain"
const lang = await Language.load(path.join(ROOT, "wasm", "tree-sitter-ruby.wasm"))
const parser = new Parser(); parser.setLanguage(lang as any)
const f = "/home/sano/ishaq/bb_tests/repositories/mastodon/app/controllers/admin/accounts_controller.rb"
const src = fs.readFileSync(f, "utf8")
const tree = parser.parse(src)
const edges = deriveRubyEdges(tree.rootNode)
console.log("instantiates edges from the oracle:")
for (const e of edges) if (e.label === "instantiates") console.log("   ->", e.target)
console.log("\n'AccountsController' present as an instantiates target?",
  edges.some((e) => e.label === "instantiates" && e.target === "AccountsController"))
