import * as fs from "node:fs";
import * as path from "node:path";
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const engine: any = await import(path.join(ROOT, "src/ast/engine"));
for (const f of process.argv.slice(2)) {
  const res: any = await engine.ASTEngine.parseFile(f, fs.readFileSync(f, "utf8"));
  if (res?.language !== "python") continue;
  console.log(`--- ${path.basename(f)}`);
  for (const s of (res.symbols ?? []).slice(0, 12))
    console.log(`  name="${s.name}" qualifiedName="${s.qualifiedName}" ownerName="${s.ownerName ?? "-"}" kind=${s.kind}`);
  for (const r of (res.relationships ?? []).filter((x: any) => x.type === "overrides").slice(0, 3))
    console.log(`  R overrides ${r.source} -> ${r.target} @L${r.line_number}`);
}
