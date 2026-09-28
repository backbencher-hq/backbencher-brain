// script/m52/verify-v1-parity-latency.ts — M52.V1 (#723)
//
// Proves the M52 latency fixes deliver THE SAME DATA in A FRACTION OF THE
// TIME, on the real index, through the real surfaces — and that the gate
// itself can fail:
//
//   PARITY (legacy SQL vs M52 implementation, byte-equal after JSON
//   normalization — on the real 2,681-file / 158k-embedding index):
//     P1. modelRows (model, count, dims) — legacy GROUP_CONCAT vs covering-index plan
//     P2. embeddedEntities — legacy COUNT(DISTINCT) vs SUM-of-groups plan
//     P3. languageRows — legacy joined GROUP BY vs split queries (incl.
//         zero-symbol languages preserved, null language, ordering)
//   LATENCY:
//     L1. Covering index exists on the real DB (created by P1's every-open ensure).
//     L2. EXPLAIN QUERY PLAN: the modelRows query uses brain_embed_health_idx.
//     L3. Warm default bb_health over REAL MCP stdio < 2000ms (user probe pattern;
//         child runs from src via tsx — no build needed).
//   MUTATION (gate can fail):
//     M1. On a bounded DB copy (40k embedding rows) with the index dropped:
//         EXPLAIN shows NO covering index (predicate proves detectability);
//         with the index restored: EXPLAIN shows it again.
//
// Records before/after timings as the permanent latency receipt.

// No BB_DATA_DIR override here: the parent resolves the REAL data dir so
// getDbPath(realPid) hits the real index (the thing we're measuring).
process.env.BB_LOG_LEVEL = "3"

import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawn } from "node:child_process"
import { execFileSync } from "node:child_process"

const ROOT = join(import.meta.dirname ?? ".", "../..")

let checks = 0, passed = 0, failed = 0
function check(name: string, cond: boolean, detail: string) {
  checks++
  if (cond) { passed++; console.log(`  ok  ${name} (${detail})`) }
  else { failed++; console.log(`  FAIL ${name} (${detail})`) }
}

const norm = (v: unknown) => JSON.stringify(v, (_k, x) => (x === null ? "(null)" : typeof x === "number" ? String(x) : x))

// The exact queries, legacy and M52, shared by parity and mutation worlds.
const LEGACY = {
  modelRows: (db: any, pid: string) => db.prepare(
    "SELECT embedding_model AS model, COUNT(*) c, GROUP_CONCAT(DISTINCT vector_dimension) dims FROM brain_semantic_embedding WHERE project_id=? GROUP BY embedding_model ORDER BY c DESC"
  ).all(pid),
  entities: (db: any, pid: string) => (db.prepare(
    "SELECT COUNT(DISTINCT entity_id) c FROM brain_semantic_embedding WHERE project_id=?"
  ).get(pid) as any)?.c ?? 0,
  languageRows: (db: any, pid: string) => db.prepare(
    "SELECT f.language AS language, COUNT(DISTINCT f.id) files, COUNT(DISTINCT s.id) symbols " +
    "FROM brain_file f LEFT JOIN brain_symbol s ON s.file_id = f.id AND s.project_id = ? " +
    "WHERE f.project_id = ? GROUP BY f.language ORDER BY files DESC"
  ).all(pid, pid),
}
const M52 = {
  modelRows: (db: any, pid: string) => db.prepare(
    "SELECT embedding_model AS model, COUNT(*) c, GROUP_CONCAT(DISTINCT vector_dimension) dims FROM brain_semantic_embedding INDEXED BY brain_embed_health_idx WHERE project_id=? GROUP BY embedding_model ORDER BY c DESC"
  ).all(pid),
  entities: (db: any, pid: string) => {
    const rows = db.prepare(
      "SELECT embedding_model, COUNT(DISTINCT entity_id) c FROM brain_semantic_embedding INDEXED BY brain_embed_health_idx WHERE project_id=? GROUP BY embedding_model"
    ).all(pid) as any[]
    return rows.reduce((s, r) => s + Number(r.c ?? 0), 0)
  },
  languageRows: (db: any, pid: string) => {
    const fileLangRows = db.prepare(
      "SELECT language, COUNT(DISTINCT id) AS files FROM brain_file WHERE project_id = ? GROUP BY language"
    ).all(pid) as any[]
    const symLangRows = db.prepare(
      "SELECT f.language AS language, COUNT(*) AS symbols FROM brain_symbol s " +
      "JOIN brain_file f ON f.id = s.file_id AND f.project_id = ? " +
      "WHERE s.project_id = ? GROUP BY f.language"
    ).all(pid, pid) as any[]
    const m = new Map<string, any>()
    for (const fr of fileLangRows) m.set(String(fr.language), { language: fr.language, files: Number(fr.files), symbols: 0 })
    for (const sr of symLangRows) { const b = m.get(String(sr.language)); if (b) b.symbols = Number(sr.symbols) }
    // Total order mirroring legacy's observable SQLite ordering: files DESC,
    // then language ASC (GROUP BY tie order), NULL first — order parity, not
    // just set parity. Mirrors health-provider.ts exactly.
    return [...m.values()].sort((a: any, b: any) => {
      if (b.files !== a.files) return b.files - a.files
      if (a.language === b.language) return 0
      if (a.language == null) return -1
      if (b.language == null) return 1
      return String(a.language) < String(b.language) ? -1 : 1
    })
  },
}

async function main() {
  const { getProjectId } = await import(join(ROOT, "src/cli/index"))
  const { BrainDatabase } = await import(join(ROOT, "src/brain/database"))

  const realPid = getProjectId(ROOT) as any
  const realDbPath = BrainDatabase.getDbPath(realPid as any)
  check("real index exists (latency test rig)", statSync(realDbPath).size > 100_000_000,
    `${(statSync(realDbPath).size / 1e9).toFixed(2)}GB`)

  // Point THIS process at the real DB explicitly (parent env has no BB_DATA_DIR
  // override, so getDbPath resolves the real data dir).
  BrainDatabase.registerPath(realPid as any, realDbPath)
  const raw = await BrainDatabase.getRawInstance(realPid as any)
  const pid = String(realPid)

  // L1: covering index exists (P1's every-open ensure created it on first open).
  const idx = raw.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='brain_embed_health_idx'").get()
  check("L1: brain_embed_health_idx exists on the real DB", !!idx, idx ? "present" : "missing")

  // L2: the plan uses the covering index (no BLOB heap scan).
  const plan = (raw.prepare("EXPLAIN QUERY PLAN SELECT embedding_model, COUNT(*), GROUP_CONCAT(DISTINCT vector_dimension) FROM brain_semantic_embedding WHERE project_id=? GROUP BY embedding_model").get(pid) as any)
  const planText = JSON.stringify(plan)
  check("L2: query plan uses the covering index", typeof plan?.detail === "string" && plan.detail.includes("brain_embed_health_idx"), plan?.detail ?? planText)

  // PARITY — legacy vs M52, on the real index, with timings recorded.
  let tL = Date.now(); const legacyModels = LEGACY.modelRows(raw, pid); const legacyModelsMs = Date.now() - tL
  tL = Date.now(); const m52Models = M52.modelRows(raw, pid); const m52ModelsMs = Date.now() - tL
  check("P1: modelRows byte-equal (legacy vs covering-index)", norm(legacyModels) === norm(m52Models),
    `legacy=${legacyModelsMs}ms m52=${m52ModelsMs}ms`)

  tL = Date.now(); const legacyEntities = LEGACY.entities(raw, pid); const legacyEntitiesMs = Date.now() - tL
  tL = Date.now(); const m52Entities = M52.entities(raw, pid); const m52EntitiesMs = Date.now() - tL
  check("P2: embeddedEntities byte-equal (legacy vs sum-of-groups)", norm(legacyEntities) === norm(m52Entities),
    `legacy=${legacyEntitiesMs}ms m52=${m52EntitiesMs}ms value=${m52Entities}`)

  tL = Date.now(); const legacyLangs = LEGACY.languageRows(raw, pid); const legacyLangsMs = Date.now() - tL
  tL = Date.now(); const m52Langs = M52.languageRows(raw, pid); const m52LangsMs = Date.now() - tL
  // Byte-parity for languageRows is proven on the row MULTISET (both sides
  // normalized under the same total order). Row ORDER is separately proven
  // against the only ordering the legacy query guarantees (files DESC);
  // ties were left to SQLite's unspecified sorter in legacy and are now
  // DEFINED by M52 (language ASC, NULL first) — see docs/m52/PLAN.md.
  const byTotal = (x: any, y: any) => {
    if (y.files !== x.files) return x.files - y.files
    if (x.language === y.language) return 0
    if (x.language == null) return -1
    if (y.language == null) return 1
    return String(x.language) < String(y.language) ? -1 : 1
  }
  const langsMultisetEqual = norm([...legacyLangs].sort(byTotal)) === norm([...m52Langs].sort(byTotal))
  const langsOrderedLegacy = legacyLangs.every((r: any, i: number) => i === 0 || Number(legacyLangs[i - 1].files) >= Number(r.files))
  const langsOrderedM52 = m52Langs.every((r: any, i: number) => i === 0 || Number(m52Langs[i - 1].files) >= Number(r.files))
  check("P3: languageRows multiset byte-equal (legacy joined vs split; zero-symbol langs preserved)", langsMultisetEqual,
    `legacy=${legacyLangsMs}ms m52=${m52LangsMs}ms rows=${m52Langs.length}`)
  check("P3b: languageRows ordering contract holds (files DESC on both sides)", langsOrderedLegacy && langsOrderedM52,
    `legacyOrdered=${langsOrderedLegacy} m52Ordered=${langsOrderedM52}`)

  // L3: warm default bb_health over REAL MCP stdio < 2000ms.
  // Child runs from src under BUN (the production runtime — bin/bb runs
  // compiled output under node, but the stdio server requires a runtime that
  // keeps its event loop alive; node/tsx drains and exits 13 before the
  // handshake). Child must see the REAL data dir, so no BB_DATA_DIR override.
  const childEnv: Record<string, string | undefined> = { ...process.env }
  delete childEnv.BB_DATA_DIR
  const srv = spawn("bun", [join(ROOT, "src/cli/index.ts"), "mcp", "--dir", ROOT],
    { cwd: ROOT, env: childEnv, stdio: ["pipe", "pipe", "ignore"] })
  let buf = ""
  const pending = new Map<number, (v: any) => void>()
  let msgId = 0
  srv.stdout.on("data", (d) => {
    buf += d.toString()
    const lines = buf.split("\n"); buf = lines.pop()!
    for (const l of lines) {
      if (!l.trim()) continue
      try { const m = JSON.parse(l); if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id) } } catch {}
    }
  })
  const send = (method: string, params: any) => new Promise<any>((res) => {
    const myId = ++msgId
    pending.set(myId, res)
    srv.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: myId, method, params }) + "\n")
  })
  // A dead child must FAIL the checks, not end the gate silently (exit 0 with
  // checks missing is a gate defect — found live: node/tsx children exit 13).
  let childDied = false
  srv.on("error", () => { childDied = true; for (const r of pending.values()) r(null); pending.clear() })
  srv.on("close", () => { childDied = true; for (const r of pending.values()) r(null); pending.clear() })
  const tInit = Date.now()
  await send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "m52-v1", version: "0" } })
  srv.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n")
  const initMs = Date.now() - tInit
  const tCold = Date.now()
  const coldResp = await send("tools/call", { name: "bb_health", arguments: {} })
  const coldMs = Date.now() - tCold
  const coldText = coldResp?.result?.content?.[0]?.text ?? ""
  check("cold bb_health answered with real data", coldText.includes("symbols"), `init=${initMs}ms cold=${coldMs}ms`)
  const tWarm = Date.now()
  await send("tools/call", { name: "bb_health", arguments: {} })
  const warmMs = Date.now() - tWarm
  check("L3: warm default bb_health < 2000ms over real MCP stdio", !childDied && warmMs < 2000, `warm=${warmMs}ms (was ~37,000ms) childDied=${childDied}`)
  srv.kill()
  // Snapshot the rig facts BEFORE closing the handle (prepare-after-close throws).
  const rigFiles = (raw.prepare("SELECT COUNT(*) c FROM brain_file WHERE project_id=?").get(String(realPid)) as any)?.c
  // Checkpoint + close so the mutation copy below sees every committed row.
  raw.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get()
  BrainDatabase.close(realPid as any)

  // MUTATION — bounded copy (40k embedding rows), index dropped: plan must
  // lose the covering index; restored: plan must regain it. Proves L2's
  // predicate detects the exact regression this milestone guards against.
  const mutDir = mkdtempSync(join(tmpdir(), "bb-m52-mut-"))
  const mutPath = join(mutDir, "brain.db")
  copyFileSync(realDbPath, mutPath) // WAL was checkpointed by close above
  const pidMut = ("m52mut" + String(realPid).slice(6)) as any
  BrainDatabase.registerPath(pidMut as any, mutPath)
  try {
    const mut = await BrainDatabase.getRawInstance(pidMut as any)
    mut.exec("PRAGMA foreign_keys = OFF")
    mut.exec("DELETE FROM brain_semantic_embedding WHERE rowid NOT IN (SELECT rowid FROM brain_semantic_embedding LIMIT 40000)")
    // The copied rows keep the ORIGINAL project_id — query by it.
    mut.exec("DROP INDEX IF EXISTS brain_embed_health_idx")
    const droppedPlan = (mut.prepare("EXPLAIN QUERY PLAN SELECT embedding_model, COUNT(*), GROUP_CONCAT(DISTINCT vector_dimension) FROM brain_semantic_embedding WHERE project_id=? GROUP BY embedding_model").get(String(realPid)) as any)
    const coveringGone = !(droppedPlan?.detail ?? "").includes("brain_embed_health_idx")
    mut.exec("CREATE INDEX brain_embed_health_idx ON brain_semantic_embedding(project_id, embedding_model, entity_id, vector_dimension)")
    const restoredPlan = (mut.prepare("EXPLAIN QUERY PLAN SELECT embedding_model, COUNT(*), GROUP_CONCAT(DISTINCT vector_dimension) FROM brain_semantic_embedding WHERE project_id=? GROUP BY embedding_model").get(String(realPid)) as any)
    const coveringBack = (restoredPlan?.detail ?? "").includes("brain_embed_health_idx")
    check("M1: mutation is detectable (index dropped → covering plan gone → restored → back)",
      coveringGone && coveringBack, `dropped=${coveringGone} restored=${coveringBack}`)
    BrainDatabase.close(pidMut as any)
  } finally {
    BrainDatabase.clearPathOverrides()
    rmSync(mutDir, { recursive: true, force: true })
  }

  const evidence = {
    gate: "M52.V1", issue: 723, at: new Date().toISOString(),
    commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT }).toString().trim(),
    rig: { dbPath: realDbPath, dbBytes: statSync(realDbPath).size, files: rigFiles },
    parity: {
      modelRows: { legacyMs: legacyModelsMs, m52Ms: m52ModelsMs, equal: norm(legacyModels) === norm(m52Models) },
      entities: { legacyMs: legacyEntitiesMs, m52Ms: m52EntitiesMs, equal: norm(legacyEntities) === norm(m52Entities), value: m52Entities },
      languageRows: { legacyMs: legacyLangsMs, m52Ms: m52LangsMs, multisetEqual: langsMultisetEqual, orderContract: langsOrderedLegacy && langsOrderedM52, rows: m52Langs.length },
    },
    latency: { initMs, coldMs, warmMs, budgetMs: 2000, baselineMs: 37000 },
    checks: { total: checks, passed, failed },
  }
  mkdirSync(join(ROOT, "validation/m52/results"), { recursive: true })
  writeFileSync(join(ROOT, "validation/m52/results/V1.json"), JSON.stringify(evidence, null, 2))
  console.log(`\nV1: ${passed}/${checks} passed, ${failed} failed → validation/m52/results/V1.json`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
