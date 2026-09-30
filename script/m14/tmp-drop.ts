import * as fs from "node:fs"; import * as path from "node:path";
import * as wts from "web-tree-sitter";
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const wdir = path.join(ROOT, "node_modules/web-tree-sitter");
await wts.Parser.init({ locateFile: () => ["tree-sitter.wasm","web-tree-sitter.wasm"].map(f=>path.join(wdir,f)).find(f=>fs.existsSync(f))! });
const p = new wts.Parser();
p.setLanguage(await wts.Language.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-python.wasm"))));
const engine: any = await import(path.join(ROOT, "src/ast/engine"));
const isUpper1 = (s: string) => s.length > 0 && s[0] === s[0].toUpperCase() && s[0] !== s[0].toLowerCase();
let files = 0, upperTotal = 0, upperInFile = 0, upperDropped = 0, droppedImported = 0;
const ex: string[] = [];
for (const f of process.argv.slice(2)) {
  const doc = fs.readFileSync(f, "utf8");
  const res: any = await engine.ASTEngine.parseFile(f, doc);
  if (res?.language !== "python") continue;
  files++;
  const declared = new Set<string>();
  for (const s of res.symbols ?? []) if (["class","enum"].includes(String(s.kind))) declared.add(String(s.name));
  // every `Name(` and `Name.attr(` in the source tree
  const t = p.parse(doc).rootNode; const st = [t];
  const imported = new Set<string>();
  for (const r of res.relationships ?? []) if (String(r.type) === "imports") {
    const tg = String(r.target); const it = tg.includes(":") ? tg.slice(tg.lastIndexOf(":")+1) : tg;
    if (it && it !== "*") imported.add(it);
  }
  const have = new Set<string>();
  for (const r of res.relationships ?? []) { have.add(String(r.type)+"|"+String(r.source)+"|"+String(r.target)) }
  while (st.length) {
    const n = st.pop();
    if (n.type === "call") {
      const fn = n.childForFieldName("function");
      if (fn) {
        const txt = fn.text.trim(); const cut = txt.search(/[(]/); const head = cut === -1 ? txt : txt.slice(0, cut);
        const dot = head.lastIndexOf("."); const leaf = (dot === -1 ? head : head.slice(dot+1)).trim();
        if (isUpper1(leaf)) {
          upperTotal++;
          if (declared.has(leaf)) upperInFile++;
          else { upperDropped++; if (imported.has(leaf)) droppedImported++; if (ex.length < 8) ex.push(`${path.basename(f)} -> ${leaf}${imported.has(leaf) ? " (IMPORTED in this file)" : ""}`) }
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) st.push(n.namedChild(i));
  }
}
console.log(`files=${files}`);
console.log(`  uppercase callees in the source        : ${upperTotal}`);
console.log(`  -> became \`instantiates\` (in-file cls): ${upperInFile}`);
console.log(`  -> produced NO relationship at all   : ${upperDropped}  (${((upperDropped/Math.max(1,upperTotal))*100).toFixed(1)}%)`);
console.log(`     of which the class is IMPORTED here: ${droppedImported}`);
for (const e of ex) console.log(`     dropped: ${e}`);
