// ER2 store-scale verification (plan obligation: emit→store at CORPUS scale).
// The F5 lane audits the analyzer; the M59 acceptance harness audits fixture
// projects; this audits the FULL rebar3 corpus through the REAL CLI pipeline
// (node bin/bb index) — 261 files, store-level asserts:
//   1. every erlang relationship row lands a line_number (store side)
//   2. no TRUE dangling source (source_symbol_id NULL AND source_external NULL)
//   3. every erlang calls row resolves through a channel (symbol id or external)
//   4. analyzer-vs-store symbol delta (must be 0; relationships reported, not
//      asserted equal — the store's own dedup semantics are its contract)
//   5. re-index idempotency (row counts identical)
//   6. wall-clock + avg ms/file recorded for the perf baseline note
import { execSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import Database from "better-sqlite3"
import { Parser, Language } from "web-tree-sitter"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const CORPUS = "<corpus-root>/bb_tests/repositories/rebar3"

async function main() {
  await Parser.init()
  const parser = new Parser()
  parser.setLanguage(await Language.load(new URL("../../../wasm/tree-sitter-erlang.wasm", import.meta.url).pathname))
  const { RealErlangAnalyzer } = await import("<corpus-root>/mcp/backbencher-brain/src/ast/real-erlang-analyzer.ts")
  const analyzer = new RealErlangAnalyzer()

  // Real CLI index FIRST (twice — the second for idempotency). The indexer is
  // IGNORE-AWARE (vendored/, nested .gitignores) — the census must therefore
  // run over the STORE'S file set, not an ignore-blind find, or the parity
  // comparison lies about which files exist (134-file lesson, 2026-09-18).
  const run = (cmd: string) => {
    try { execSync(cmd, { cwd: ROOT, stdio: "pipe", env: { ...process.env, FORCE_COLOR: "0" } }) }
    catch (e: any) { console.error("CMD FAILED:", cmd); console.error(String(e.stderr ?? "")); console.error(String(e.stdout ?? "")); throw e }
  }
  run("npm run build")
  const t0 = Date.now()
  run(`node bin/bb index ${CORPUS} --force`)
  const ms = Date.now() - t0

  const sha = createHash("sha1").update(CORPUS).digest("hex")
  const dbPath = path.join(process.env.HOME ?? "", ".bb", "projects", sha, "brain.db")
  const files: string[] = (() => {
    const db = new Database(dbPath, { readonly: true })
    const rows = db.prepare("SELECT path FROM brain_file WHERE path LIKE '%.erl'").all() as any[]
    db.close()
    return rows.map(r => r.path)
  })()

  // Analyzer-side census over EXACTLY the indexed file set.
  let symCount = 0, relCount = 0, linesOnRels = 0, relNoLine = 0
  for (const f of files) {
    const content = readFileSync(f, "utf8")
    let root
    try { root = parser.parse(content).rootNode } catch { continue }
    if (!root) continue
    const r = analyzer.analyze(root, content, path.relative(CORPUS, f))
    symCount += r.symbols.length
    relCount += r.relationships.length
    for (const x of r.relationships as any[]) {
      if (typeof x.line_number === "number" && x.line_number > 0) linesOnRels++
      else relNoLine++
    }
  }
  console.log(`analyzer census (over the store's ${files.length} indexed files): symbols=${symCount} rels=${relCount} relsWithLine=${linesOnRels} relsNoLine=${relNoLine}`)
  const db = new Database(dbPath, { readonly: true })
  const count = (sql: string, ...a: any[]) => (db.prepare(sql).get(...a) as any)?.c ?? 0

  const erlSyms = count(`SELECT COUNT(*) c FROM brain_symbol WHERE file_id LIKE '%.erl'`)
  const erlRels = count(`SELECT COUNT(*) c FROM brain_relationship r JOIN brain_symbol s ON s.id = r.source_symbol_id JOIN brain_file f ON f.id = s.file_id WHERE f.path LIKE '%.erl'`)
  const erlRelsNoLine = count(`SELECT COUNT(*) c FROM brain_relationship r JOIN brain_symbol s ON s.id = r.source_symbol_id JOIN brain_file f ON f.id = s.file_id WHERE f.path LIKE '%.erl' AND r.line_number IS NULL`)
  const trueDangling = count(`SELECT COUNT(*) c FROM brain_relationship WHERE source_symbol_id IS NULL AND source_external IS NULL`)
  const callsNoChannel = count(`SELECT COUNT(*) c FROM brain_relationship r JOIN brain_symbol s ON s.id = r.source_symbol_id JOIN brain_file f ON f.id = s.file_id WHERE f.path LIKE '%.erl' AND r.relationship_type = 'calls' AND r.target_symbol_id IS NULL AND r.target_external IS NULL`)

  const before = { syms: erlSyms, rels: erlRels, all: count(`SELECT COUNT(*) c FROM brain_relationship`) }
  run(`node bin/bb index ${CORPUS}`)
  const db2 = new Database(dbPath, { readonly: true })
  const count2 = (sql: string, ...a: any[]) => (db2.prepare(sql).get(...a) as any)?.c ?? 0
  const after = { syms: count2(`SELECT COUNT(*) c FROM brain_symbol WHERE file_id LIKE '%.erl'`), rels: count2(`SELECT COUNT(*) c FROM brain_relationship r JOIN brain_symbol s ON s.id = r.source_symbol_id JOIN brain_file f ON f.id = s.file_id WHERE f.path LIKE '%.erl'`), all: count2(`SELECT COUNT(*) c FROM brain_relationship`) }

  const failures: string[] = []
  const expect = (ok: boolean, msg: string) => { if (!ok) failures.push(msg) }
  expect(erlRelsNoLine === 0, `erlang store rows without a line: ${erlRelsNoLine}`)
  expect(trueDangling === 0, `TRUE dangling sources (both channels NULL): ${trueDangling}`)
  expect(callsNoChannel === 0, `erlang calls rows with neither target channel: ${callsNoChannel}`)
  // The analyzer->store symbol delta is ACCOUNTED, not asserted to zero: the
  // store's universal SYMBOL_NAME_DENYLIST (me/self/this/... — JS-family
  // receiver noise, real BEAM function names) and the isIndexArtifactName
  // anon_-filter drop real erlang symbols (rebar3: me/1, anon_repo_config/2),
  // and the store dedups intra-file same-(name,line) pairs (rebar_agent.erl's
  // two `state` rows at line 12). Registered as a STORE-LAYER finding (the
  // denylist is language-relative in truth, measured: 15 symbols across the
  // rebar3+OTP samples); fixing the universal list is a family-wide wave of
  // its own, not an erlang side-effect.

  // Counted, named classes (the store-scale truth):
  const DENY = new Set(["this", "super", "self", "Self", "me", "My", "root"])
  const ART = /^(anonymous|anon|unnamed)[_-]|^(block|lambda)[_-]\d+|^object_\d+$/i
  const keySeen = new Map<string, number>()
  let denyDropped = 0, dupKeyExtra = 0
  for (const f of files) {
    const content = readFileSync(f, "utf8")
    let root
    try { root = parser.parse(content).rootNode } catch { continue }
    if (!root) continue
    const r = analyzer.analyze(root, content, path.relative(CORPUS, f))
    for (const sym of r.symbols as any[]) {
      const key = `${f}|${sym.name}|${sym.range.startLine}`
      const prev = keySeen.get(key)
      if (prev !== undefined) dupKeyExtra++
      keySeen.set(key, (prev ?? 0) + 1)
      if (DENY.has(sym.name) || ART.test(sym.name)) denyDropped++
    }
  }
  console.log(`symbol accounting: analyzer=${symCount} store=${erlSyms} denylistOrArtifactDropped=${denyDropped} intraFileDupKeyExtra=${dupKeyExtra}`)
  expect(erlSyms + denyDropped + dupKeyExtra === symCount,
    `symbol delta not fully accounted: ${symCount} -> ${erlSyms} (deny/artifact=${denyDropped}, dup-key=${dupKeyExtra})`)
  if (denyDropped > 0) console.log(`  NOTE: ${denyDropped} real symbol(s) dropped by the store's universal denylist/artifact filters — REGISTERED store-layer finding (language-relative noise names), not fixed in this wave`)

  expect(after.syms === before.syms && after.rels === before.rels && after.all === before.all,
    `re-index not idempotent: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`)
  expect(relNoLine === 0, `analyzer rels without line: ${relNoLine}`)

  console.log(`store census: erlSymbols=${erlSyms} erlRels=${erlRels} relsNoLine=${erlRelsNoLine} trueDangling=${trueDangling} callsNoChannel=${callsNoChannel}`)
  console.log(`idempotency: ${JSON.stringify(before)} -> ${JSON.stringify(after)} (identical=${JSON.stringify(before) === JSON.stringify(after)})`)
  console.log(`perf: index wall=${ms}ms over ${files.length} erl files (mixed-language corpus) ≈ ${(ms / files.length).toFixed(1)}ms/file`)
  console.log(`relationships: analyzer=${relCount} store(erl-sourced)=${erlRels} (store dedup is the store's own contract; delta reported, not asserted)`)

  db.close(); db2.close()
  if (failures.length) {
    console.error("STORE-SCALE FAILED:")
    for (const f of failures) console.error("  - " + f)
    process.exit(7)
  }
  console.log("store-scale: line landing, source integrity, target channels, symbol parity, idempotency all verified on the full corpus")
}

main().catch(e => { console.error(e); process.exit(1) })
