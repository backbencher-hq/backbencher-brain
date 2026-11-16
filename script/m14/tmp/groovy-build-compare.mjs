// Pairwise label comparison between two wasm builds through the REAL analyzer.
// usage: bun groovy-build-compare.mjs <a.wasm> <b.wasm> <labelA> <labelB>
// Reports, over the same controlled sample as the R2 control: files perturbed, and the per-label
// movement (b minus a).
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
const ROOT = "<corpus-root>/mcp/backbencher-brain";
const CORPUS = "<corpus-root>/bb_tests/repositories";
const EXTS = ["groovy", "gvy", "gradle"];
const CAP = 1048576;
const [wasmA, wasmB, nameA, nameB] = process.argv.slice(2);

const wts = await import(ROOT + "/node_modules/web-tree-sitter/tree-sitter.js");
const Parser = wts.Parser ?? wts.default ?? wts;
const Language = wts.Language ?? wts.default?.Language;
await Parser.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") });
const langA = await Language.load(wasmA);
const langB = await Language.load(wasmB);
const { RealGroovyAnalyzer } = await import(ROOT + "/src/ast/real-groovy-analyzer.ts");

const admitted = [];
for (const r of fs.readdirSync(CORPUS).sort()) {
  const d = path.join(CORPUS, r);
  if (!fs.statSync(d).isDirectory()) continue;
  let files = [];
  try {
    files = execSync(`git -C ${JSON.stringify(d)} ls-files`, { maxBuffer: 1 << 28 }).toString().split("\n");
  } catch {
    continue;
  }
  for (const f of files) {
    if (!f || !EXTS.includes(f.split(".").pop().toLowerCase())) continue;
    const p = path.join(d, f);
    try {
      if (fs.statSync(p).size > CAP) continue;
    } catch {
      continue;
    }
    admitted.push(p);
  }
}
admitted.sort();
const fixtures = [];
const fxDir = ROOT + "/validation/m14/fixtures/groovy";
for (const f of fs.readdirSync(fxDir)) if (f.endsWith(".groovy")) fixtures.push(path.join(fxDir, f));
const tail = admitted.slice(7900);
const stride = [];
for (let i = 0; i < admitted.length; i += 47) stride.push(admitted[i]);
const files = [...new Set([...fixtures, ...tail, ...stride])];

const canon = (r) => ({
  syms: (r.symbols ?? []).map((s) => `${s.name}|${s.kind}|${s.ownerName ?? ""}|${s.range?.startLine ?? 0}`).sort(),
  rels: (r.relationships ?? []).map((x) => `${x.type}|${x.source}|${x.target}|${x.line_number ?? 0}`).sort(),
});
const run = (lang, src, f) => {
  const p = new Parser();
  p.setLanguage(lang);
  const tree = p.parse(src);
  const out = new RealGroovyAnalyzer().analyze(tree.rootNode, src, f);
  return { canon: canon(out), hasError: tree.rootNode.hasError };
};

let perturbed = 0;
let errA = 0;
let errB = 0;
let peA = 0;
let peB = 0;
const moves = new Map();
const examples = [];
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  let A, B;
  try {
    A = run(langA, src, f);
  } catch {
    errA++;
    continue;
  }
  try {
    B = run(langB, src, f);
  } catch {
    errB++;
    continue;
  }
  if (A.hasError) peA++;
  if (B.hasError) peB++;
  const sA = new Set([...A.canon.rels]);
  const sB = new Set([...B.canon.rels]);
  const yA = new Set([...A.canon.syms]);
  const yB = new Set([...B.canon.syms]);
  const added = [...sB].filter((x) => !sA.has(x));
  const removed = [...sA].filter((x) => !sB.has(x));
  const sAdded = [...yB].filter((x) => !yA.has(x));
  const sRemoved = [...yA].filter((x) => !yB.has(x));
  if (added.length || removed.length || sAdded.length || sRemoved.length) {
    perturbed++;
    const bump = (k, d) => {
      const e = moves.get(k) ?? { added: 0, removed: 0 };
      e[d]++;
      moves.set(k, e);
    };
    for (const x of added) bump("rel " + x.split("|")[0], "added");
    for (const x of removed) bump("rel " + x.split("|")[0], "removed");
    if (sAdded.length) bump("symbols", "added");
    if (sRemoved.length) bump("symbols", "removed");
    if (examples.length < 5) examples.push({ f: path.relative(CORPUS, f), added, removed, sAdded, sRemoved });
  }
}
console.log(`=== ${nameB} MINUS ${nameA} ===`);
console.log(`sample: ${files.length} files · perturbed: ${perturbed} / ${files.length}`);
console.log(`parse errors: ${nameA} ${peA} · ${nameB} ${peB}`);
console.log(`analyzer exceptions: ${nameA} ${errA} · ${nameB} ${errB}`);
const rows = [...moves.entries()].sort((a, b) => b[1].added + b[1].removed - (a[1].added + a[1].removed));
if (!rows.length) console.log("label movement: NONE");
for (const [k, v] of rows) console.log(`  ${k.padEnd(26)} +${v.added}  -${v.removed}`);
for (const e of examples) {
  console.log(`  eg ${e.f}: +${e.added.length} -${e.removed.length} rel, +${e.sAdded.length} -${e.sRemoved.length} sym`);
  for (const x of e.removed.slice(0, 2)) console.log(`       - ${x}`);
  for (const x of e.added.slice(0, 2)) console.log(`       + ${x}`);
}
