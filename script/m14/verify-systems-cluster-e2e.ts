/**
 * #384 — Systems-cluster e2e gate (M14.0.F9)
 *
 * Indexes a polyglot systems project (c + cpp + rust + go + zig) through the
 * real CLI and asserts:
 * 1. Symbols extracted and persisted per language
 * 2. Imports persisted per language (c/cpp includes, rust use, go import,
 *    zig @import)
 * 3. Cross-language edges (c -> cpp call via extern leaf-name resolution)
 * 4. Relationships (calls/uses/references) persisted per language
 *
 * Mirrors verify-web-cluster-e2e.ts (M14.0.F8) for the systems family.
 * The ledger Matrix-5 Systems row (PENDING -> #384) is closed by this gate.
 *
 * CLI: npx tsx script/m14/verify-systems-cluster-e2e.ts
 */
import * as fs from "fs"
import * as path from "path"
import { execSync } from "child_process"
import { createHash } from "crypto"
import { createRequire } from "module"
const require = createRequire(import.meta.url)
const Database = require("better-sqlite3")

const ROOT = process.cwd()
const TMP = "/tmp/opencode/m14-systems-cluster"

function writeProject() {
  fs.rmSync(TMP, { recursive: true, force: true })
  fs.mkdirSync(path.join(TMP, "src"), { recursive: true })

  // c header + implementation
  fs.writeFileSync(path.join(TMP, "src", "math.h"),
    "#ifndef MATH_H\n#define MATH_H\n\ntypedef struct { int w; int h; } Rect;\nint rect_area(const Rect* r);\n\n#endif\n")
  fs.writeFileSync(path.join(TMP, "src", "math.c"),
    '#include "math.h"\n#include <stdio.h>\n\nint rect_area(const Rect* r) {\n  return r->w * r->h;\n}\n\nextern int run_engine(void);\n\nint main(void) {\n  Rect r = { 3, 4 };\n  printf("%d\\n", rect_area(&r) + run_engine());\n  return 0;\n}\n')

  // cpp — provides run_engine (c-callable) + a class method
  fs.writeFileSync(path.join(TMP, "src", "engine.cpp"),
    '#include <string>\n\nclass Engine {\npublic:\n  int run() { return 7; }\n};\n\nint run_engine(void) {\n  Engine e;\n  return e.run();\n}\n')

  // rust — use import + fn
  fs.writeFileSync(path.join(TMP, "src", "util.rs"),
    "use std::collections::HashMap;\n\npub fn hash_it() -> u32 {\n  let mut m: HashMap<&str, u32> = HashMap::new();\n  m.insert(\"a\", 1);\n  let v = m.get(\"a\").copied().unwrap_or(0);\n  v\n}\n")

  // go — import + struct/method + call
  fs.writeFileSync(path.join(TMP, "src", "calc.go"),
    'package main\n\nimport "fmt"\n\ntype Point struct {\n  X, Y float64\n}\n\nfunc (p Point) Len() float64 {\n  return p.X + p.Y\n}\n\nfunc Sqrt(x float64) float64 {\n  fmt.Println("sqrt")\n  return x\n}\n')

  // zig — @import + struct + fn with std call
  fs.writeFileSync(path.join(TMP, "src", "render.zig"),
    'const std = @import("std");\n\nconst Palette = struct {\n  fg: u8,\n  pub fn bright(self: *const Palette) u8 {\n    return self.fg + 1;\n  }\n};\n\npub fn render() void {\n  const p = Palette{ .fg = 200 };\n  std.debug.print("{d}\\n", .{p.bright()});\n}\n')
}

async function main() {
  writeProject()
  execSync("node bin/bb index " + TMP + " --force", { cwd: ROOT, stdio: "pipe" })

  const sha = createHash("sha1").update(TMP).digest("hex")
  const dbPath = path.join(process.env.HOME ?? "", ".bb", "projects", sha, "brain.db")
  const db = new Database(dbPath, { readonly: true })

  const failures: string[] = []
  const expect = (cond: boolean, msg: string) => { if (!cond) failures.push(msg) }

  // 1. symbols persisted per systems language
  for (const lang of ["c", "cpp", "rust", "go", "zig"]) {
    const c = db.prepare(`SELECT COUNT(*) c FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE f.language=?`).get(lang) as any
    expect(Number(c.c) > 0, `symbols persisted for ${lang} (got ${c.c})`)
  }

  // 2. imports persisted per systems language
  for (const lang of ["c", "cpp", "rust", "go", "zig"]) {
    const c = db.prepare(`SELECT COUNT(*) c FROM brain_import bi JOIN brain_file f ON f.id=bi.file_id WHERE f.language=?`).get(lang) as any
    expect(Number(c.c) > 0, `imports persisted for ${lang} (got ${c.c})`)
  }

  // 3. cross-language edges: c main.c calls run_engine (defined in engine.cpp)
  //    -> leaf-name resolution across files must flag is_cross_language=1.
  const xl = db.prepare(`SELECT COUNT(*) c FROM brain_relationship WHERE is_cross_language = 1`).get() as any
  expect(Number(xl.c) > 0, `cross-language edges exist (c->cpp run_engine) (got ${xl.c})`)

  // 4. relationships persisted per systems language (source symbols carry
  //    the file; external-source edges are excluded from the per-language
  //    count but still exist in the table)
  for (const lang of ["c", "cpp", "rust", "go", "zig"]) {
    const c = db.prepare(`SELECT COUNT(*) c FROM brain_relationship r JOIN brain_symbol s ON s.id=r.source_symbol_id JOIN brain_file f ON f.id=s.file_id WHERE f.language=?`).get(lang) as any
    expect(Number(c.c) > 0, `relationships persisted for ${lang} (got ${c.c})`)
  }

  // evidence
  const { emitEvidence } = await import("./evidence-harness")
  emitEvidence({
    // M49 W8: this gate used to emit `M14.0.F9`, which the ledger's
    // gate-strengthening section and the honesty gate's F9 comment assign to the
    // defect-class probe battery. Two files claiming one identity meant the last
    // runner destroyed the other's evidence, and the systems sign-off cites
    // "M14.0.F9 systems-cluster e2e" — a claim whose evidence kept vanishing.
    // That claim moves to M14.0.SC1 (docs updated in the same wave).
    issueId: "M14.0.SC1",
    title: "Systems-cluster e2e gate",
    claimLevel: "L1",
    layers: ["cluster-e2e"],
    checks: [
      { id: "systems-cluster-e2e", description: "polyglot systems project (c/cpp/rust/go/zig) indexed via real CLI, all assertions pass", status: failures.length ? ("fail" as const) : ("pass" as const) },
    ],
    limitations: [
      { description: "covers systems cluster (c, cpp, rust, go, zig); managed-OO/functional clusters still pending their gates" },
    ],
    data: { failures },
  })

  if (failures.length) {
    console.error("SYSTEMS CLUSTER E2E FAILED:\n" + failures.map(f => "  - " + f).join("\n"))
    process.exit(10)
  }
  console.log("systems-cluster e2e: symbols, imports, cross-language edges verified in brain.db for c/cpp/rust/go/zig")
}

main().catch(e => { console.error(e); process.exit(1) })