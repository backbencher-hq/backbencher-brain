// PROOF THAT THE VISIT-FIX IS OUTPUT-PRESERVING: run the pre-fix analyzer and the fixed one over
// the same corpus files and compare canonicalized symbols + relationships. The fix removed
// duplicate tree visits, and `emit` dedupes, so every row must be identical.
import fs from "node:fs";
import path from "node:path";
const ROOT = "/home/ishaq2321/mcp/backbencher-brain";
const wts = await import(ROOT + "/node_modules/web-tree-sitter/tree-sitter.js");
const Parser = wts.Parser ?? wts.default ?? wts;
const Language = wts.Language ?? wts.default?.Language;
await Parser.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") });
const lang = await Language.load(path.join(ROOT, "wasm/tree-sitter-groovy.wasm"));
const { RealGroovyAnalyzer } = await import(ROOT + "/src/ast/real-groovy-analyzer.ts");
const { RealGroovyAnalyzerPreFix } = await import(ROOT + "/src/ast/real-groovy-analyzer-prefixcheck.ts");

const files = process.argv.slice(2);
const canon = (r) => {
  const syms = (r.symbols ?? [])
    .map((s) => `${s.name}|${s.kind}|${s.ownerName ?? ""}|${s.range?.startLine ?? 0}`)
    .sort();
  const rels = (r.relationships ?? [])
    .map((x) => `${x.type}|${x.source}|${x.target}|${x.line_number ?? 0}|${JSON.stringify(x.metadata ?? {})}`)
    .sort();
  return { syms, rels };
};
let same = 0;
let diff = 0;
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  const p1 = new Parser();
  p1.setLanguage(lang);
  const t1 = p1.parse(src);
  const a = canon(new RealGroovyAnalyzer().analyze(t1.rootNode, src, f));
  const p2 = new Parser();
  p2.setLanguage(lang);
  const t2 = p2.parse(src);
  const b = canon(new RealGroovyAnalyzerPreFix().analyze(t2.rootNode, src, f));
  const okS = JSON.stringify(a.syms) === JSON.stringify(b.syms);
  const okR = JSON.stringify(a.rels) === JSON.stringify(b.rels);
  if (okS && okR) same++;
  else {
    diff++;
    console.log("DIFF", path.basename(f), "syms", okS, "rels", okR, "n", a.syms.length, b.syms.length, a.rels.length, b.rels.length);
  }
}
console.log(`IDENTICAL ${same}/${same + diff} files (symbols AND relationships, order-insensitive)`);
