// PROOF OVER THE RANGE THAT USED TO HANG: every admitted file at sorted indices >= 7900 is parsed and
// analyzed, one file at a time, recording per-file time and any failure. This is the 202-file range
// whose gate slices never completed before the visit-fix.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
const ROOT = "<corpus-root>/mcp/backbencher-brain";
const CORPUS = "<corpus-root>/bb_tests/repositories";
const EXTS = ["groovy", "gvy", "gradle"];
const CAP = 1048576;

const wts = await import(ROOT + "/node_modules/web-tree-sitter/tree-sitter.js");
const Parser = wts.Parser ?? wts.default ?? wts;
const Language = wts.Language ?? wts.default?.Language;
await Parser.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") });
const lang = await Language.load(path.join(ROOT, "wasm/tree-sitter-groovy.wasm"));
const { RealGroovyAnalyzer } = await import(ROOT + "/src/ast/real-groovy-analyzer.ts");

const all = [];
for (const r of fs.readdirSync(CORPUS)) {
  const d = path.join(CORPUS, r);
  if (!fs.statSync(d).isDirectory()) continue;
  let files = [];
  try {
    files = execSync(`git -C ${JSON.stringify(d)} ls-files`, { maxBuffer: 1 << 28 }).toString().split("\n");
  } catch {
    continue;
  }
  for (const f of files) {
    if (!f) continue;
    if (!EXTS.includes(f.split(".").pop().toLowerCase())) continue;
    const p = path.join(d, f);
    try {
      if (fs.statSync(p).size > CAP) continue;
    } catch {
      continue;
    }
    all.push(p);
  }
}
all.sort();
const tail = all.slice(7900);
let maxMs = 0;
let maxFile = "";
let failures = 0;
const t0 = Date.now();
for (const f of tail) {
  const started = Date.now();
  try {
    const src = fs.readFileSync(f, "utf8");
    const p = new Parser();
    p.setLanguage(lang);
    const tree = p.parse(src);
    const r = new RealGroovyAnalyzer().analyze(tree.rootNode, src, f);
    if (!Array.isArray(r.relationships)) throw new Error("no relationships array");
  } catch (e) {
    failures++;
    console.log("FAIL", path.relative(CORPUS, f), String(e).slice(0, 120));
  }
  const ms = Date.now() - started;
  if (ms > maxMs) {
    maxMs = ms;
    maxFile = path.relative(CORPUS, f);
  }
}
console.log(`tail files analyzed: ${tail.length} (admitted total ${all.length})`);
console.log(`failures: ${failures}`);
console.log(`slowest file: ${maxMs} ms  ${maxFile}`);
console.log(`wall: ${((Date.now() - t0) / 1000).toFixed(1)} s for ${tail.length} files`);
