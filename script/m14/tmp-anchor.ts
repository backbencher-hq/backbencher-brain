import * as fs from "node:fs";
import * as path from "node:path";
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const engine: any = await import(path.join(ROOT, "src/ast/engine"));
let files = 0, resolved = 0, undefined_ = 0, uses = 0, contains = 0;
let usesNoSymbolTarget = 0, usesNoLine = 0, usesNoClass = 0, anchorTgtLineMiss = 0;
for (const f of process.argv.slice(2)) {
  const res: any = await engine.ASTEngine.parseFile(f, fs.readFileSync(f, "utf8"));
  if (res?.language !== "markdown") continue;
  files++;
  const byName = new Map<string, number[]>();
  for (const s of res.symbols ?? []) byName.set(String(s.name), [...(byName.get(String(s.name)) ?? []), s.range?.startLine ?? -1]);
  for (const r of res.relationships ?? []) {
    if (r.type === "contains") { contains++; continue; }
    uses++;
    const isAnchor = r.metadata?.linkForm === "internal_anchor";
    if (isAnchor) resolved++;
    const line = r.line_number;
    if (typeof line !== "number" || line <= 0) usesNoLine++;
    if (!r.metadata?.evidenceClass) usesNoClass++;
    if (!isAnchor) continue;             // external refs are external BY DESIGN
    if (!byName.has(String(r.target))) { usesNoSymbolTarget++; continue; }
    if (!byName.get(String(r.target))!.includes(line)) anchorTgtLineMiss++;
  }
  for (const p of (res.metadata?.patterns ?? [])) {
    const m = p.match(/^Markdown undefined internal anchors: (\d+)$/);
    if (m) undefined_ += Number(m[1]);
  }
}
console.log(`files=${files} contains=${contains} uses=${uses}`);
console.log(`  internal-anchor edges published : ${resolved}`);
console.log(`  undefined fragments suppressed  : ${undefined_}`);
console.log(`  anchor edges w/o line_number    : ${usesNoLine}`);
console.log(`  anchor edges w/o evidenceClass  : ${usesNoClass}`);
console.log(`  anchor target names NO symbol   : ${usesNoSymbolTarget}`);
console.log(`  anchor target line != symbol line: ${anchorTgtLineMiss}`);
