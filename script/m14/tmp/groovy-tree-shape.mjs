import fs from "node:fs";
import path from "node:path";
const ROOT = "/home/ishaq2321/mcp/backbencher-brain";
const wts = await import(ROOT + "/node_modules/web-tree-sitter/tree-sitter.js");
const Parser = wts.Parser ?? wts.default ?? wts;
const Language = wts.Language ?? wts.default?.Language;
await Parser.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") });
const lang = await Language.load(path.join(ROOT, "wasm/tree-sitter-groovy.wasm"));
const p = new Parser();
p.setLanguage(lang);
const src = fs.readFileSync(process.argv[2], "utf8");
const tree = p.parse(src);
let nodes = 0;
let maxKids = 0;
let maxType = "";
const stack = [tree.rootNode];
while (stack.length) {
  const n = stack.pop();
  nodes++;
  if (n.namedChildCount > maxKids) {
    maxKids = n.namedChildCount;
    maxType = n.type;
  }
  for (let i = 0; i < n.namedChildCount; i++) stack.push(n.namedChild(i));
}
console.log("total nodes:", nodes, "| max namedChildCount:", maxKids, "on", maxType);
