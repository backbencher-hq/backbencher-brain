// CS-DEEP-51 — D10b verification on the exact file that produced the MISSING row.
//
//   internal sealed record Dachshund(string Name) : Beast(Name);
//
// The question is narrow and worth a narrow probe: does the truth now publish `Beast` as the
// base, and has the paren-named `Beast(Name)` gone? Compared on label+target, the way the gate
// does, with csharp's compared set applied (C923 excludes `overrides` from this lane).
import * as fs from "fs"
import * as path from "path"
const ROOT = process.cwd()
const f = "/home/sano/ishaq/bb_tests/repositories/aspnetcore/src/OpenApi/test/Microsoft.AspNetCore.OpenApi.Tests/Shared/SharedTypes.Unions.cs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c_sharp.wasm")))
const p = new P(); p.setLanguage(g)
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const mod: any = await import(path.join(ROOT, "script/m14/differential.ts"))
const src = fs.readFileSync(f, "utf8")
const res: any = await ASTEngine.parseFile(f, src)
const truth = (mod.deriveCSharpEdges(p.parse(src).rootNode, new Set<string>()) ?? [])
  .filter((e: any) => e.label !== "overrides" && (e.label === "extends" || e.label === "implements"))
const an = (res.relationships ?? []).filter((r: any) => (r.type ?? r.relationshipType) === "extends" || (r.type ?? r.relationshipType) === "implements")
console.log(`  ${path.basename(f)}`)
console.log(`     truth extends/implements:`)
for (const e of truth) console.log(`        ${e.label} ${e.from} -> ${e.target}`)
const paren = truth.filter((e: any) => /[(]/.test(e.target))
console.log(`     ANALYZER extends/implements:`)
for (const r of an) console.log(`        ${r.type ?? r.relationshipType} ${r.source} -> ${r.target}`)
const tKeys = new Set(truth.map((e: any) => `${e.label}:${e.target}`))
const aKeys = new Set(an.map((r: any) => `${r.type ?? r.relationshipType}:${r.target}`))
console.log(`\n     paren-named bases remaining: ${paren.length}${paren.length ? "  " + paren.map((e: any) => e.target).join(" ") : ""}`)
console.log(`     TRUTH-only: ${[...tKeys].filter((k) => !aKeys.has(k)).length}   ANALYZER-only: ${[...aKeys].filter((k) => !tKeys.has(k)).length}`)
