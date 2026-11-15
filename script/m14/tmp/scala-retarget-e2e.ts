// Prove the cross-file `overrides` retarget END-TO-END before changing production.
//
// SDJ-8 measured the prize (459 of 677 blind guesses resolvable project-wide; 308
// demonstrably wrong) and measured that the existing post-index pass cannot do it,
// because it resolves targets BY NAME and brain_symbol persists no hierarchy.
//
// This harness tests the proposed mechanism against a real SQLite database using
// the repo's own insert shapes, so "it should work" becomes a measurement:
//
//   1. create brain_symbol WITH the proposed `super_types` column
//   2. analyze a corpus draw with the real analyzer and store symbols/relationships
//      exactly as parallel-indexer.ts does (same columns, same confidence, same
//      metadata), plus the one new field
//   3. run the proposed retarget step: for `overrides` rows below the confidence
//      floor, walk the project-wide hierarchy and re-point the row at the nearest
//      ancestor that actually declares the method
//   4. score it against the analyzer-only baseline
//
// It reports how many rows moved, how many landed on an ancestor that really
// declares the method, and what the pass costs in wall time — because a correctness
// fix that doubles indexing time is a different decision from one that does not.

import fs from "node:fs"
import path from "node:path"
import Database from "better-sqlite3"
import { RealScalaAnalyzer } from "../../../src/ast/real-scala-analyzer"

const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..", "..")
const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const repo = process.argv[2] ?? "scala3"
const drawFile = process.argv[3]
const LIMIT = Number(process.argv[4] ?? 400)
const CONF_FLOOR = 0.7
const MAX_DEPTH = 16

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

  const db = new Database(":memory:")
  db.pragma("journal_mode = OFF")
  db.exec(`
    CREATE TABLE brain_file (id TEXT PRIMARY KEY, project_id TEXT, path TEXT, relative_path TEXT, language TEXT);
    CREATE TABLE brain_symbol (
      id TEXT PRIMARY KEY, project_id TEXT, file_id TEXT, name TEXT, qualified_name TEXT,
      symbol_type TEXT NOT NULL, line_start INTEGER, line_end INTEGER, visibility TEXT,
      parameters TEXT, return_type TEXT, docstring TEXT, owner_symbol_id TEXT,
      super_types TEXT, is_abstract INTEGER
    );
    CREATE TABLE brain_relationship (
      id TEXT PRIMARY KEY, project_id TEXT, source_symbol_id TEXT, target_symbol_id TEXT,
      source_external TEXT, target_external TEXT, relationship_type TEXT NOT NULL,
      confidence REAL NOT NULL, line_number INTEGER, metadata TEXT
    );
    CREATE INDEX ix_sym_qname ON brain_symbol(project_id, qualified_name);
    CREATE INDEX ix_sym_name ON brain_symbol(project_id, name);
  `)
  const PID = "p1"

  const insFile = db.prepare(`INSERT OR REPLACE INTO brain_file (id,project_id,path,relative_path,language) VALUES (?,?,?,?,?)`)
  const insSym = db.prepare(`INSERT OR REPLACE INTO brain_symbol
    (id,project_id,file_id,name,qualified_name,symbol_type,line_start,line_end,visibility,parameters,return_type,docstring,owner_symbol_id,super_types,is_abstract)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  const insRel = db.prepare(`INSERT OR IGNORE INTO brain_relationship
    (id,project_id,source_symbol_id,target_symbol_id,source_external,target_external,relationship_type,confidence,line_number,metadata)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)

  // ── the index-wide corpus, so the hierarchy is complete ────────────────────
  const corpusFiles = walk(path.join(CORPUS, repo)).sort()
  const drawSet = new Set(fs.readFileSync(drawFile, "utf8").split("\n").map((s) => s.trim()).filter(Boolean).slice(0, LIMIT))

  // pass 1 — index every file (symbols only), so the hierarchy covers the project
  const tIndex0 = performance.now()
  let indexed = 0
  for (const f of corpusFiles) {
    const src = fs.readFileSync(f, "utf8")
    let res: any
    try { res = analyzer.analyze(parser.parse(src).rootNode, src, f) } catch { continue }
    const rel = path.relative(path.join(CORPUS, repo), f)
    const fid = `f:${rel}`
    insFile.run(fid, PID, f, rel, "scala")
    for (const s of res.symbols ?? []) {
      const owner = s.ownerName ?? ""
      const sup = (s.metadata?.superTypes ?? []).map(String)
      insSym.run(
        `s:${rel}:${s.name}:${s.range?.startLine ?? 0}:${owner}`, PID, fid, s.name,
        owner ? `${owner}.${s.name}` : s.name, String(s.kind ?? ""),
        s.range?.startLine ?? null, s.range?.endLine ?? null, s.visibility ?? null,
        s.signature ?? null, (s as any).returnType ?? null, (s.metadata?.scaladoc ?? s.metadata?.doc) ?? null,
        null, sup.length ? JSON.stringify(sup) : null, s.metadata?.isAbstract ? 1 : 0,
      )
    }
    indexed++
    if (indexed % 3000 === 0) process.stderr.write(`  indexed ${indexed}/${corpusFiles.length}\n`)
  }
  const msIndex = performance.now() - tIndex0
  const symCount = (db.prepare(`SELECT count(*) c FROM brain_symbol WHERE project_id=?`).get(PID) as any).c

  // ── build the project-wide hierarchy, as the retarget step will ────────────
  const tBuild0 = performance.now()
  const supertypes = new Map<string, string[]>()
  const methodsByOwner = new Map<string, Set<string>>()
  for (const r of db.prepare(`SELECT name, owner_symbol_id, super_types, symbol_type FROM brain_symbol WHERE project_id=?`).all(PID) as any[]) {
    if (r.super_types) {
      let arr: string[] = []
      try { arr = JSON.parse(r.super_types) } catch {}
      if (arr.length) supertypes.set(r.name, [...new Set([...(supertypes.get(r.name) ?? []), ...arr])])
    }
    if (r.symbol_type === "method" && r.name) {
      const owner = String(r.name).slice(0, 0) // placeholder; owner comes from qualified_name below
    }
  }
  for (const r of db.prepare(`SELECT name, qualified_name, symbol_type FROM brain_symbol WHERE project_id=?`).all(PID) as any[]) {
    if (r.symbol_type !== "method" || !r.qualified_name) continue
    const owner = String(r.qualified_name).slice(0, String(r.qualified_name).length - String(r.name).length - 1)
    if (!owner) continue
    if (!methodsByOwner.has(owner)) methodsByOwner.set(owner, new Set())
    methodsByOwner.get(owner)!.add(r.name)
  }
  const msBuild = performance.now() - tBuild0

  // ── pass 2 — store relationships for the DRAW only, as the indexer would ──
  let relStored = 0
  let guesses = 0
  for (const rel of drawSet) {
    const fp = path.join(CORPUS, repo, rel)
    if (!fs.existsSync(fp)) continue
    const src = fs.readFileSync(fp, "utf8")
    let res: any
    try { res = analyzer.analyze(parser.parse(src).rootNode, src, fp) } catch { continue }
    for (const r of res.relationships ?? []) {
      const conf = typeof r.confidence === "number" ? r.confidence : 1
      const isGuess = String(r.type) === "overrides" && conf < CONF_FLOOR
      if (isGuess) guesses++
      insRel.run(
        `r:${rel}:${r.source}:${r.target}:${r.type}`, PID, null, null,
        String(r.source ?? ""), String(r.target ?? ""), String(r.type), conf,
        r.line_number ?? null, r.metadata ? JSON.stringify(r.metadata) : null,
      )
      relStored++
    }
  }

  // ── the proposed retarget step ────────────────────────────────────────────
  const tRe0 = performance.now()
  const rows = db.prepare(
    `SELECT id, source_external, target_external FROM brain_relationship
     WHERE project_id=? AND relationship_type='overrides' AND confidence < ?`,
  ).all(PID, CONF_FLOOR) as any[]
  const upd = db.prepare(`UPDATE brain_relationship SET target_external=? WHERE id=?`)
  const declares = (t: string, m: string): boolean => methodsByOwner.get(t)?.has(m) ?? false
  const hier = (t: string): string[] => supertypes.get(t) ?? []
  let moved = 0
  let resolved = 0
  let stillWrong = 0
  let noDeclaring = 0
  const byDepth = new Map<number, number>()
  const sample: string[] = []
  for (const row of rows) {
    const src = String(row.source_external)
    const dot = src.lastIndexOf(".")
    if (dot <= 0) continue
    const owner = src.slice(0, dot)
    const method = src.slice(dot + 1)
    const parents = supertypes.get(owner) ?? []
    if (!parents.length) continue
    const seen = new Set<string>()
    let frontier = [...parents]
    let found = ""
    let d = 0
    while (frontier.length && d < MAX_DEPTH && !found) {
      const next: string[] = []
      for (const t of frontier) {
        if (!t || seen.has(t)) continue
        seen.add(t)
        if (declares(t, method)) { found = t; break }
        next.push(...hier(t))
      }
      frontier = [...new Set(next)]
      d++
    }
    if (!found) { noDeclaring++; continue }
    resolved++
    byDepth.set(d, (byDepth.get(d) ?? 0) + 1)
    const target = `${found}.${method}`
    if (target !== String(row.target_external)) {
      upd.run(target, row.id)
      moved++
      if (sample.length < 10) sample.push(`  ${src}: ${row.target_external} -> ${target} (depth ${d})`)
    } else stillWrong++
  }
  const msRe = performance.now() - tRe0

  console.log(`# end-to-end proof of the cross-file overrides retarget — ${repo}\n`)
  console.log(`## index`)
  console.log(`- files indexed: ${indexed}/${corpusFiles.length} in ${(msIndex / 1000).toFixed(1)}s (${(msIndex / Math.max(1, indexed)).toFixed(2)} ms/file)`)
  console.log(`- symbols stored: ${symCount.toLocaleString()} — including ${supertypes.size.toLocaleString()} types carrying supertypes`)
  console.log(`- hierarchy load: ${msBuild.toFixed(0)}ms`)
  console.log(`\n## relationships for the ${drawSet.size}-file draw`)
  console.log(`- stored: ${relStored.toLocaleString()}, of which low-confidence \`overrides\` guesses: ${guesses}`)
  console.log(`\n## retarget step`)
  console.log(`- rows examined: ${rows.length.toLocaleString()} in ${msRe.toFixed(0)}ms`)
  console.log(`- **resolved to an ancestor that verifiably declares the method: ${resolved} (${((resolved / Math.max(1, rows.length)) * 100).toFixed(1)}%)**`)
  console.log(`- **re-targeted (row moved): ${moved}**`)
  console.log(`- no declaring ancestor anywhere in the project: ${noDeclaring}`)
  console.log(`- already pointed at the declaring ancestor: ${resolved - moved}`)
  console.log(`- winning-ancestor depth: ${[...byDepth].sort((a, b) => a[0] - b[0]).map(([d, n]) => `d${d}=${n}`).join(" ") || "—"}`)
  console.log(`\n## cost of the step, against the index cost`)
  console.log(`- retarget pass: ${msRe.toFixed(0)}ms vs ${(msIndex / 1000).toFixed(1)}s to build the index = **${((msRe / msIndex) * 100).toFixed(2)}% of index time**`)
  console.log(`\n## rows re-pointed`)
  for (const s of sample) console.log(s)
  db.close()
}
main().catch((e) => { console.error(e); process.exit(1) })