import * as fs from "node:fs";
import * as path from "node:path";
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const engine: any = await import(path.join(ROOT, "src/ast/engine"));
const want = new Set(process.argv[2].split(","));
const ex = new Map<string, string[]>();
const srcForms = new Map<string, Map<string, number>>();
for (const f of process.argv.slice(3)) {
  const res: any = await engine.ASTEngine.parseFile(f, fs.readFileSync(f, "utf8"));
  if (res?.language !== "python") continue;
  const names = new Set((res.symbols ?? []).map((s: any) => String(s.name)));
  const qnames = new Set((res.symbols ?? []).map((s: any) => String(s.qualifiedName ?? s.name)));
  for (const r of res.relationships ?? []) {
    const t = String(r.type);
    if (!want.has(t)) continue;
    const s = String(r.source);
    if (names.has(s)) continue;
    // classify the source shape
    const form = names.has(s) ? "name" : qnames.has(s) ? "qualifiedName" : s.includes(".") ? "dotted-not-declared" : s.includes("->") ? "arrow-form" : "bare-not-declared";
    if (!srcForms.has(t)) srcForms.set(t, new Map());
    const m = srcForms.get(t)!; m.set(form, (m.get(form) ?? 0) + 1);
    if (!ex.has(t)) ex.set(t, []);
    if (ex.get(t)!.length < 4) ex.get(t)!.push(`${path.basename(f)}:L${r.line_number} ${r.type} ${s} -> ${r.target}`);
  }
}
for (const [t, m] of srcForms) {
  console.log(`${t}: unresolvable source shapes ${[...m].map(([k, v]) => `${k}=${v}`).join(" ")}`);
  for (const e of ex.get(t)!) console.log(`    ${e}`);
}
