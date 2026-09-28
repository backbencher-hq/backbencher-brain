// script/m54/probe-fk-store-soak.ts — the soak M54's PLAN called for.
// Tests store-phase FK enforcement against the never-reproduced claim that
// kept FK OFF inside storeResults ("compiled binary's SQLite can spuriously
// reject valid data").
//
// Method (no source patching — BB_FK_ENFORCE is the built-in lever):
//   run A (legacy):  BB_FK_ENFORCE=0  → open AND store run FK-OFF
//   run B (M54):     BB_FK_ENFORCE unset → open AND store run FK-ON
// Both runs index the SAME corpus directory (same projectId → ids embed the
// same prefix → inventories are byte-comparable) into separate data dirs.
// Compare file/symbol/relationship/import inventories byte-for-byte, require
// non-empty inventories (a parity pass on two empty DBs is void), and scan
// stderr for FK rejections under the M54 posture.

import { spawnSync } from "node:child_process"
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import path from "node:path"
import os from "node:os"

const ROOT = "$HOME/mcp/backbencher-brain"

let pass = 0, fail = 0
const failures: string[] = []
const check = (name: string, ok: boolean, detail: string) => {
  if (ok) { pass++; console.log(`✅ ${name}: ${detail}`) }
  else { fail++; failures.push(`${name}: ${detail}`); console.log(`❌ ${name}: ${detail}`) }
}

function makeCorpus(dir: string) {
  mkdirSync(path.join(dir, "src"), { recursive: true })
  mkdirSync(path.join(dir, "py"), { recursive: true })
  mkdirSync(path.join(dir, "go"), { recursive: true })
  mkdirSync(path.join(dir, "rs"), { recursive: true })
  writeFileSync(path.join(dir, "src", "app.ts"), [
    'import { Store } from "./store"',
    'export interface Config { retries: number; url: string }',
    'export class App {',
    '  private store = new Store()',
    '  run(cfg: Config): boolean {',
    '    for (let i = 0; i < cfg.retries; i++) { if (this.store.save(String(i))) return true }',
    '    return false',
    '  }',
    '}',
  ].join("\n") + "\n")
  writeFileSync(path.join(dir, "src", "store.ts"), [
    'export class Store {',
    '  private items: string[] = []',
    '  save(v: string): boolean { this.items.push(v); return this.items.length > 0 }',
    '  count(): number { return this.items.length }',
    '}',
  ].join("\n") + "\n")
  writeFileSync(path.join(dir, "py", "worker.py"), [
    'import json',
    'class Worker:',
    '    def __init__(self, name):',
    '        self.name = name',
    '    def process(self, payload):',
    '        return json.dumps({"worker": self.name, "data": payload})',
    'def run_all(workers):',
    '    return [w.process(w.name) for w in workers]',
  ].join("\n") + "\n")
  writeFileSync(path.join(dir, "go", "main.go"), [
    'package main',
    '',
    'import "fmt"',
    '',
    'type Greeter struct{ Name string }',
    'func (g Greeter) Greet() string { return fmt.Sprintf("hi %s", g.Name) }',
    'func main() { g := Greeter{"x"}; fmt.Println(g.Greet()) }',
  ].join("\n") + "\n")
  writeFileSync(path.join(dir, "rs", "lib.rs"), [
    'pub struct Counter { value: u32 }',
    'impl Counter {',
    '    pub fn new() -> Self { Counter { value: 0 } }',
    '    pub fn bump(&mut self) { self.value += 1 }',
    '}',
  ].join("\n") + "\n")
  writeFileSync(path.join(dir, "README.md"), "# corpus\n")
}

function indexCorpus(dir: string, tag: string, mode: "legacy" | "m54") {
  const childScript = path.join(os.tmpdir(), `m54-soak-child-${tag}.mjs`)
  writeFileSync(childScript, `
    const { getProjectId } = await import(${JSON.stringify(path.join(ROOT, "src/cli/index.ts"))})
    const { indexProjectParallel } = await import(${JSON.stringify(path.join(ROOT, "src/ast/parallel-indexer.ts"))})
    const { BrainDatabase } = await import(${JSON.stringify(path.join(ROOT, "src/brain/database.ts"))})
    const dir = process.argv[2]
    const pid = getProjectId(dir)
    const stats = await indexProjectParallel(pid, dir, {})
    const db = await BrainDatabase.getRawInstance(pid)
    const inv = {
      files: db.prepare("SELECT id, path, language FROM brain_file ORDER BY id").all(),
      symbols: db.prepare("SELECT id, name, owner_symbol_id, line_start FROM brain_symbol ORDER BY id").all(),
      relationships: db.prepare("SELECT id, source_symbol_id, target_symbol_id, relationship_type FROM brain_relationship ORDER BY id").all(),
      imports: db.prepare("SELECT id, imported_name, import_path FROM brain_import ORDER BY id").all(),
    }
    db.close?.()
    console.log("INVENTORY:" + JSON.stringify(Object.fromEntries(Object.entries(inv).map(([k, v]) => [k, JSON.stringify(v)]))))
    process.exit(0)
  `)
  const dataDir = mkdtempSync(path.join(os.tmpdir(), `m54-soak-data-${tag}-`))
  const env: NodeJS.ProcessEnv = { ...process.env, BB_DATA_DIR: dataDir }
  if (mode === "legacy") env.BB_FK_ENFORCE = "0"
  else delete env.BB_FK_ENFORCE
  const r = spawnSync("bun", ["run", childScript, dir], { encoding: "utf8", timeout: 420_000, env })
  rmSync(childScript, { force: true })
  const stderr = r.stderr ?? ""
  const fkErrors = (stderr.match(/FOREIGN KEY constraint failed/g) ?? []).length
  let inv: Record<string, string> | null = null
  const line = (r.stdout ?? "").split("\n").find(l => l.startsWith("INVENTORY:"))
  try { inv = JSON.parse(line!.slice("INVENTORY:".length)) } catch {}
  rmSync(dataDir, { recursive: true, force: true })
  return { inv, fkErrors, exit: r.status, stderrTail: stderr.slice(-300) }
}

const corpus = mkdtempSync(path.join(os.tmpdir(), "m54-soak-corpus-"))
makeCorpus(corpus)

const legacy = indexCorpus(corpus, "legacy", "legacy")
const m54 = indexCorpus(corpus, "m54", "m54")
rmSync(corpus, { recursive: true, force: true })

check("soak.both-ran", !!legacy.inv && !!m54.inv && legacy.exit === 0 && m54.exit === 0,
  `legacy exit=${legacy.exit} inv=${legacy.inv ? "ok" : "MISSING"} | m54 exit=${m54.exit} inv=${m54.inv ? "ok" : "MISSING"}`)

if (legacy.inv && m54.inv) {
  const legacySyms = JSON.parse(legacy.inv.symbols).length
  const m54Syms = JSON.parse(m54.inv.symbols).length
  // Non-vacuity: the corpus must produce a real inventory, or parity is void.
  check("soak.non-vacuity", legacySyms >= 10 && m54Syms >= 10 && JSON.parse(m54.inv.files).length >= 4 && JSON.parse(m54.inv.relationships).length > 0,
    `legacy symbols=${legacySyms}, m54 symbols=${m54Syms}, m54 files=${JSON.parse(m54.inv.files).length}, m54 relationships=${JSON.parse(m54.inv.relationships).length}`)
  for (const k of ["files", "symbols", "relationships", "imports"] as const) {
    const eq = legacy.inv[k] === m54.inv[k]
    check(`soak.parity-${k}`, eq, eq
      ? `${k}: byte-equal (${m54.inv[k].length} chars)`
      : `${k}: DIVERGED (legacy ${legacy.inv[k].length} vs m54 ${m54.inv[k].length} chars)`)
  }
}

check("soak.no-spurious-fk-rejection", m54.fkErrors === 0, m54.fkErrors === 0
  ? "zero 'FOREIGN KEY constraint failed' occurrences under store-phase FK ON (the historical claim stays unreproduced)"
  : `${m54.fkErrors} FK rejections — the historical claim is TRUE and store-phase enforcement must be reverted`)

console.log(`\n=== SOAK RESULT: ${pass} pass, ${fail} fail ===`)
// Evidence stamp (post-closure hardening receipt)
{
  const { execFileSync, spawnSync: ss } = await import("node:child_process")
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  const { mkdirSync: mk, writeFileSync: wr } = await import("node:fs")
  mk(path.join(ROOT, "validation/m54/results"), { recursive: true })
  wr(path.join(ROOT, "validation/m54/results/SOAK.json"), JSON.stringify({
    probe: "M54.soak-fk-store", milestone: "M54", at: new Date().toISOString(), commit,
    checks: pass + fail, passed: pass, failed: fail,
    verifierCommand: "npx tsx script/m54/probe-fk-store-soak.ts",
    status: fail === 0 ? "verified" : "known-gap",
    method: "same corpus dir indexed twice: BB_FK_ENFORCE=0 (legacy) vs default (M54, store-phase FK ON)",
    verdict: fail === 0 ? "store-phase FK enforcement loses no data; 'spurious rejection' claim unreproduced" : "SOAK FAILED — see failures",
  }, null, 2) + "\n")
}
process.exit(fail > 0 ? 1 : 0)
