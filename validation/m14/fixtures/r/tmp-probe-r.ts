/**
 * SCRATCH PROBE — one file, one question: what does production `parseFile` publish for it?
 *
 * Kept because it is the check that produced the `undeclared-probe.ts` lead and the evidence that
 * `Matrix/R/HBMM.R`'s `scan1 <- function(...)` (:85) is a NESTED definition, not a top-level
 * declaration the analyzer dropped. It is not part of any gate and writes nothing.
 *
 * `bun run validation/m14/fixtures/r/tmp-probe-r.ts <repo-relative .r path>`
 */
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
const CR = "/home/ishaq2321/bb_tests/repositories"
const f = process.argv[2]!
const repo = path.join(CR, f.split("/")[0])
const r: any = await parseFile(path.join(CR, f), repo, { projectRoot: repo } as any)
console.log("symbols", r.symbols.length, "rels", r.relationships.length)
console.log("sample symbols:", r.symbols.slice(0, 12).map((s: any) => `${s.name}[${s.kind}]q=${s.qualifiedName ?? ""}`))
const contains = r.relationships.filter((x: any) => x.type === "contains")
console.log("contains:", contains.length, contains.slice(0, 8).map((x: any) => `${x.source ?? x.from}->${x.target}`))
const names = new Set(r.symbols.map((s: any) => s.name))
const miss = contains.filter((x: any) => !names.has(x.target)).slice(0, 10).map((x: any) => x.target)
console.log("contains targets NOT in this file's own symbols:", miss)
console.log("FIRST SYMBOL KEYS:", JSON.stringify(r.symbols[0]))
const c0 = contains[0]
console.log("FIRST CONTAINS REL KEYS:", Object.keys(c0), "line_number=", c0.line_number, "line=", c0.line, "range=", JSON.stringify(c0.range))
