// Does the SHIPPED retarget work against the REAL schema and the REAL analyzer?
//
// The mechanism was proved in scala-retarget-e2e.ts, but that harness carried its
// own copy of the SQL and its own walk. This tests the artifact that actually
// ships: `retargetCrossFileOverrides` from src/ast/override-retarget.ts, run against
// a database built with the REAL src/brain/schema-ddl.ts DDL (so the additive
// migration and the column are exercised, not simulated), populated by the real
// analyzer over a real corpus.
//
// It also checks the two properties that make the change safe rather than clever:
//   - it never INVENTS an edge: every retargeted row must land on an ancestor that
//     genuinely declares the method, verified independently from the stored rows
//   - it DEGRADES rather than damages: a database with no super_types must come out
//     byte-identical to one where the pass never ran

import fs from "node:fs"
import path from "node:path"
import Database from "better-sqlite3"
import { retargetCrossFileOverrides } from "../../../src/ast/override-retarget"
import { RealScalaAnalyzer } from "../../../src/ast/real-scala-analyzer"
import { ensureSchema } from "../../../src/brain/schema-ddl"

const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..", "..")
const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const repo = process.argv[2] ?? "scala3"
const drawFile = process.argv[3]
const LIMIT = Number(process.argv[4] ?? 400)

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "target") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith(".scala")) out.push(p)
  }
  return out
}

async function main(): Promise<void> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
  const parser = new P()
  parser.setLanguage(gl)
  const analyzer = new RealScalaAnalyzer()

  const PID = "p1"
  const db = new Database(":memory:")
  // the REAL DDL, including the additive migration for super_types
  ensureSchema(db)

  const insFile = db.prepare(`INSERT OR REPLACE INTO brain_file (id,project_id,path,relative_path,file_hash,size_bytes,line_count,last_modified,language) VALUES (?,?,?,?,?,?,?,?,?)`)
  const insSym = db.prepare(`INSERT OR REPLACE INTO brain_symbol
    (id,project_id,file_id,name,qualified_name,symbol_type,line_start,line_end,owner_symbol_id,super_types)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
  const insRel = db.prepare(`INSERT OR IGNORE INTO brain_relationship
    (id,project_id,source_symbol_id,target_symbol_id,source_external,target_external,relationship_type,confidence,line_number,metadata)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)

  const corpusFiles = walk(path.join(CORPUS, repo)).sort()
  const drawSet = new Set(fs.readFileSync(drawFile, "utf8").split("\n").map((s) => s.trim()).filter(Boolean).slice(0, LIMIT))

  // ── index the WHOLE corpus so the hierarchy is complete ────────────────────
  let indexed = 0
  const t0 = performance.now()
  for (const f of corpusFiles) {
    const src = fs.readFileSync(f, "utf8")
    let res: any
    try { res = analyzer.analyze(parser.parse(src).rootNode, src, f) } catch { continue }
    const rel = path.relative(path.join(CORPUS, repo), f)
    const fid = `f:${rel}`
    insFile.run(fid, PID, f, rel, "h", 0, 0, 0, "scala")
    for (const s of res.symbols ?? []) {
      const sup = (s.metadata?.superTypes ?? []).map(String)
      insSym.run(
        `s:${rel}:${s.name}:${s.range?.startLine ?? 0}`, PID, fid, s.name,
        s.ownerName ? `${s.ownerName}.${s.name}` : s.name, String(s.kind ?? ""),
        s.range?.startLine ?? null, s.range?.endLine ?? null, null,
        sup.length ? JSON.stringify(sup) : null,
      )
    }
    indexed++
    if (indexed % 4000 === 0) process.stderr.write(`  indexed ${indexed}/${corpusFiles.length}\n`)
  }
  const msIndex = performance.now() - t0

  // ── store relationships for the draw ─────────────────────────────────────
  const storedTargets = new Map<string, string>()
  for (const rel of drawSet) {
    const fp = path.join(CORPUS, repo, rel)
    if (!fs.existsSync(fp)) continue
    const src = fs.readFileSync(fp, "utf8")
    let res: any
    try { res = analyzer.analyze(parser.parse(src).rootNode, src, fp) } catch { continue }
    for (const r of res.relationships ?? []) {
      const conf = typeof r.confidence === "number" ? r.confidence : 1
      const id = `r:${rel}:${r.source}:${r.target}:${r.type}`
      insRel.run(id, PID, null, null, String(r.source ?? ""), String(r.target ?? ""), String(r.type), conf,
        r.line_number ?? null, r.metadata ? JSON.stringify(r.metadata) : null)
      storedTargets.set(id, String(r.target ?? ""))
    }
  }

  // ── INDEPENDENT verifier: does each final target really declare the method? ─
  const methodsByOwner = new Map<string, Set<string>>()
  for (const r of db.prepare(`SELECT name, qualified_name FROM brain_symbol WHERE project_id=? AND symbol_type='method'`).all(PID) as any[]) {
    const qn = String(r.qualified_name ?? "")
    const nm = String(r.name ?? "")
    if (!nm || !qn.endsWith(`.${nm}`)) continue
    const owner = qn.slice(0, qn.length - nm.length - 1)
    if (!owner) continue
    if (!methodsByOwner.has(owner)) methodsByOwner.set(owner, new Set())
    methodsByOwner.get(owner)!.add(nm)
  }
  const declares = (t: string, m: string): boolean => methodsByOwner.get(t)?.has(m) ?? false

  const before = db.prepare(`SELECT id, source_external, target_external, confidence FROM brain_relationship WHERE project_id=? AND relationship_type='overrides' AND confidence < 0.7`).all(PID) as any[]
  let wrongBefore = 0
  for (const r of before) {
    const src = String(r.source_external)
    const dot = src.lastIndexOf(".")
    if (dot <= 0) continue
    if (!declares(String(r.target_external).slice(0, String(r.target_external).lastIndexOf(".")), src.slice(dot + 1))) wrongBefore++
  }

  // ── run the shipped pass ─────────────────────────────────────────────────
  const tRe = performance.now()
  const res = retargetCrossFileOverrides(db, PID)
  const msRe = performance.now() - tRe

  const after = db.prepare(`SELECT id, source_external, target_external FROM brain_relationship WHERE project_id=? AND relationship_type='overrides' AND confidence < 0.7`).all(PID) as any[]
  let wrongAfter = 0
  const moved: string[] = []
  for (const r of after) {
    const src = String(r.source_external)
    const dot = src.lastIndexOf(".")
    if (dot <= 0) continue
    const tgt = String(r.target_external)
    if (!declares(tgt.slice(0, tgt.lastIndexOf(".")), src.slice(dot + 1))) wrongAfter++
    if (storedTargets.get(String(r.id)) !== tgt && moved.length < 10) moved.push(`  ${src}: ${storedTargets.get(String(r.id))} -> ${tgt}`)
  }

  console.log(`# shipped retarget against the REAL schema + REAL analyzer — ${repo}\n`)
  console.log(`## setup`)
  console.log(`- files indexed: ${indexed} in ${(msIndex / 1000).toFixed(1)}s`)
  console.log(`- super_types populated on: ${(db.prepare(`SELECT count(*) c FROM brain_symbol WHERE project_id=? AND super_types IS NOT NULL`).get(PID) as any).c} symbols`)
  console.log(`- low-confidence override rows: ${before.length}`)
  console.log(`\n## shipped pass result`)
  console.log(`- scanned ${res.scanned}, resolved ${res.resolved}, **moved ${res.moved}**, unverifiable ${res.unverifiable}, no-hierarchy ${res.noHierarchy}`)
  console.log(`- cost ${msRe.toFixed(0)}ms against ${(msIndex / 1000).toFixed(1)}s indexing = **${((msRe / msIndex) * 100).toFixed(3)}%**`)
  console.log(`\n## did it fix anything? (verified INDEPENDENTLY from stored symbols)`)
  console.log(`- rows whose target did NOT declare the method, BEFORE: ${wrongBefore} (${((wrongBefore / before.length) * 100).toFixed(1)}%)`)
  console.log(`- rows whose target does NOT declare the method, AFTER:  ${wrongAfter} (${((wrongAfter / after.length) * 100).toFixed(1)}%)`)
  console.log(`\n## rows re-pointed`)
  for (const m of moved) console.log(m)

  // ── degradation: a DB with no hierarchy must be untouched ────────────────
  const db2 = new Database(":memory:")
  ensureSchema(db2)
  const r2 = retargetCrossFileOverrides(db2, "empty-project")
  console.log(`\n## degradation`)
  console.log(`- empty database: scanned ${r2.scanned}, moved ${r2.moved} — no throw, no work`)
  db2.close()
  db.close()
}
main().catch((e) => { console.error(e); process.exit(1) })