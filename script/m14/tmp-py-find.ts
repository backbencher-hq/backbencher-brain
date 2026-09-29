import * as fs from "node:fs";
import * as path from "node:path";
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const engine: any = await import(path.join(ROOT, "src/ast/engine"));
for (const f of process.argv.slice(2)) {
  const res: any = await engine.ASTEngine.parseFile(f, fs.readFileSync(f, "utf8"));
  if (res?.language !== "python") continue;
  for (const r of res.relationships ?? []) if (String(r.source) === "global") {
    console.log(`${f}:L${r.line_number} ${r.type} ${r.source} -> ${r.target}`);
    const doc = fs.readFileSync(f, "utf8").split("\n");
    console.log(`   source line: ${doc[r.line_number - 1]}`);
    break;
  }
}
