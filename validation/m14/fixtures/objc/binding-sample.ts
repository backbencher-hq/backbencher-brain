/**
 * OBJC — THE HAND-READ SAMPLE for `OBJC-FIX.md` Step 5.
 *
 * Prints a DETERMINISTIC stride sample of the edges the binding pass claims, each with the source
 * line the read sits on, the emitted target, and the declaration the leaf resolves to INSIDE ITS
 * OWN FILE (the parameter/local declaration list of the enclosing callable). The point of the
 * sample is that a reader can open `file:line` and say what the code MEANS — so the read site and
 * the declaration sites are printed side by side rather than summarised.
 *
 * Run:  bun run validation/m14/fixtures/objc/binding-sample.ts [stride]
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const POP = path.join(import.meta.dir, "measurements", "population-objc-400.txt")
const STRIDE = Number(process.argv[2] ?? 700)
const COUNT = Number(process.argv[3] ?? 10)

const files = fs.readFileSync(POP, "utf8").split("\n")
  .filter((l) => l.startsWith("BB_LIST_FILES_FILE:"))
  .map((l) => l.slice("BB_LIST_FILES_FILE:".length).trim())

const claimed: Array<{ file: string; line: number | null; source: string; target: string; leaf: string; text: string; decls: string }> = []
for (const f of files) {
  const repo = path.join(CR, f.slice(CR.length + 1).split(path.sep)[0])
  const r: any = await parseFile(f, repo, { projectRoot: repo } as any)
  if (!r) continue
  const lines = fs.readFileSync(f, "utf8").split("\n")
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    const md: any = rel?.metadata ?? {}
    if (md.localBinding !== true) continue
    const target = String(rel?.target ?? "")
    const leaf = target.includes("\u0000") ? target.slice(target.lastIndexOf("\u0000") + 1) : target
    const line = Number(rel?.line_number ?? 0) || null
    // the declarations of THAT name in this file, and the enclosing callable's own parameter list
    const decls = (Array.isArray(r.symbols) ? r.symbols : [])
      .filter((s: any) => String(s?.name) === leaf)
      .map((s: any) => `${s.kind}@${s.range?.startLine ?? "?"}${s.ownerName ? `(${s.ownerName})` : ""}`)
    claimed.push({
      file: f.slice(CR.length + 1), line, source: String(rel?.source ?? ""), target, leaf,
      text: line ? (lines[line - 1] ?? "").trim() : "", decls: decls.join(",") || "(none)",
    })
  }
}
console.log(`claimed edges: ${claimed.length} over ${files.length} file(s); stride ${STRIDE}`)
for (let i = 0; i < claimed.length && i / STRIDE < COUNT; i += STRIDE) {
  const e = claimed[i]
  console.log(`\n[${i}] ${e.file}:${e.line}`)
  console.log(`     source line : ${e.text}`)
  console.log(`     emits       : uses ${JSON.stringify(e.source)} -> ${JSON.stringify(e.target)}`)
  console.log(`     leaf        : ${JSON.stringify(e.leaf)} — declarations of that name in THIS file: ${e.decls}`)
}
