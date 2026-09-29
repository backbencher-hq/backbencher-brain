import * as fs from "node:fs";
import * as path from "node:path";
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const engine: any = await import(path.join(ROOT, "src/ast/engine"));
const f = process.argv[2];
const res: any = await engine.ASTEngine.parseFile(f, fs.readFileSync(f, "utf8"));
const byType = new Map<string, Set<string>>();
for (const r of res.relationships ?? []) {
  const t = String(r.type);
  if (!byType.has(t)) byType.set(t, new Set());
  byType.get(t)!.add(String(r.source));
}
console.log(`module file: ${path.basename(f)}`);
for (const [t, srcs] of byType) console.log(`  ${t.padEnd(12)} sources: ${[...srcs].slice(0, 5).map(s => `"${s}"`).join(", ")}`);
