// script/m51/verify-a1-owner-integrity.ts — M51.A1 (#716)
//
// Proves the storeable-reference guard on a REAL index built by the REAL
// indexer over a real fixture:
//   1. Zero symbol rows carry owner_symbol_id ending ':0' (the phantom
//      file-module ids the pre-M51 indexer wrote — 134,045 on this repo).
//   2. Zero orphan owners of ANY shape (no reference to a row that was not
//      stored).
//   3. Containment for STORED parents is preserved (method → class owner
//      resolves to a real row; contains edges survive).
//   4. MUTATION: with the guard patched out (child probe), phantoms REAPPEAR
//      — proving the clean assertions can fail. A gate that cannot fail is
//      not a gate.
//
// No auto-pass: every check is a predicate over rows the indexer actually
// wrote this run.

process.env.BB_DATA_DIR = mkdtempSync(join(tmpdir(), "bb-m51-a1-"))
process.env.BB_LOG_LEVEL = "3"

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFileSync } from "node:child_process"

const ROOT = join(import.meta.dirname ?? ".", "../..")

let checks = 0, passed = 0, failed = 0
function check(name: string, cond: boolean, detail: string) {
  checks++
  if (cond) { passed++; console.log(`  ok  ${name} (${detail})`) }
  else { failed++; console.log(`  FAIL ${name} (${detail})`) }
}

async function main() {
  const { getProjectId } = await import(join(ROOT, "src/cli/index"))
  const { indexProjectParallel } = await import(join(ROOT, "src/ast/parallel-indexer"))
  const { BrainDatabase } = await import(join(ROOT, "src/brain/database"))

  const fixture = mkdtempSync(join(tmpdir(), "bb-m51-a1-fixture-"))
  mkdirSync(join(fixture, "src"), { recursive: true })
  writeFileSync(join(fixture, "package.json"), JSON.stringify({
    name: "m51-fixture", version: "1.0.0",
    scripts: { build: "tsc -p ." },
    dependencies: { leftpad: "^1.3.0" },
  }, null, 2))
  writeFileSync(join(fixture, "config.yaml"), "service:\n  name: m51\n  port: 8080\n")
  // Top-level declarations are exactly the population that pointed at the
  // phantom `<file>:<file-stem>:0` module owner pre-M51.
  writeFileSync(join(fixture, "src", "user.ts"), [
    "export interface User { id: string; name: string }",
    "export type UserMap = Record<string, User>",
    "export const DEFAULT_NAME = 'anon'",
    "export function createUser(name: string): User {",
    "  return { id: '1', name }",
    "}",
    "export class UserService {",
    "  getUser(id: string): User | null {",
    "    return null",
    "  }",
    "  boot(): User {",
    "    return createUser(DEFAULT_NAME)", // same-file call → loop-2 same-file edge
    "  }",
    "}",
  ].join("\n") + "\n")

  const pid = getProjectId(fixture)
  const t0 = Date.now()
  await indexProjectParallel(pid as any, fixture)
  const indexMs = Date.now() - t0

  const raw = await BrainDatabase.getRawInstance(pid as any)
  const syms = raw.prepare("SELECT id, name, symbol_type, owner_symbol_id FROM brain_symbol").all() as any[]
  const rels = raw.prepare("SELECT id, source_symbol_id, target_symbol_id, relationship_type FROM brain_relationship").all() as any[]

  check("fixture produced a real index", syms.length >= 10 && rels.length >= 1, `${syms.length} symbols, ${rels.length} rels, ${indexMs}ms`)

  // 1. The phantom shape is gone.
  const colonZero = syms.filter((s) => typeof s.owner_symbol_id === "string" && s.owner_symbol_id.endsWith(":0"))
  check("no owner_symbol_id ends in ':0'", colonZero.length === 0, `${colonZero.length} rows (pre-M51 this fixture shape produced them)`)

  // 2. No orphan owners at all.
  const ids = new Set(syms.map((s) => s.id))
  const orphans = syms.filter((s) => s.owner_symbol_id && !ids.has(s.owner_symbol_id))
  check("zero orphan owner references", orphans.length === 0,
    orphans.length === 0 ? "all owners resolve" : `e.g. ${orphans[0].id} → ${orphans[0].owner_symbol_id}`)

  // 3. Containment for STORED parents preserved: method getUser owned by class UserService.
  const cls = syms.find((s) => s.name === "UserService" && s.symbol_type === "class")
  const method = syms.find((s) => s.name === "getUser")
  check("class UserService stored", !!cls, cls ? cls.id.slice(-40) : "missing")
  check("method's owner resolves to the class row",
    !!cls && !!method && method.owner_symbol_id === cls.id,
    method ? `owner=${String(method.owner_symbol_id).slice(-40)}` : "method missing")
  const containsEdges = rels.filter((r) => r.relationship_type === "contains")
  check("contains edges still emitted", containsEdges.length >= 1, `${containsEdges.length} contains edges`)
  const containsDangling = containsEdges.filter((r) => !ids.has(r.source_symbol_id) || !ids.has(r.target_symbol_id))
  check("every contains edge resolves to stored rows", containsDangling.length === 0, `${containsDangling.length} dangling`)

  // Meta (JSON/YAML) children previously owned by `package.exports:0`-style
  // ids: after the fix they either resolve to a stored container row or carry
  // NULL — never a ghost.
  const metaSyms = syms.filter((s) => s.id.includes("package.json") || s.id.includes("config.yaml"))
  const metaOrphans = metaSyms.filter((s) => s.owner_symbol_id && !ids.has(s.owner_symbol_id))
  check("meta children carry no ghost owners", metaOrphans.length === 0, `${metaSyms.length} meta symbols checked`)

  // 4. MUTATION — patch the guard out, re-index a fresh copy, expect ghosts.
  console.log("\n  [mutation] removing the storeable-replica guard via child probe…")
  const mutantOut = JSON.parse(execFileSync("npx", ["tsx", join(ROOT, "script/m51/probe-a1-mutant.ts")], {
    cwd: ROOT, encoding: "utf8", timeout: 300_000,
  }).trim().split("\n").pop()!)
  check("mutation proves the gate can fail: guard removal reintroduces ':0' phantoms",
    mutantOut.colonZero > 0, `mutant produced ${mutantOut.colonZero} phantom-owner rows`)
  check("mutation restores the source byte-identically", mutantOut.restored === true, `restored=${mutantOut.restored}`)

  raw.close?.()
  rmSync(fixture, { recursive: true, force: true })
  rmSync(process.env.BB_DATA_DIR!, { recursive: true, force: true })

  const evidence = {
    gate: "M51.A1", issue: 716, at: new Date().toISOString(),
    commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT }).toString().trim(),
    fixture: { files: 4, symbols: syms.length, relationships: rels.length, indexMs },
    clean: { colonZero: colonZero.length, orphans: orphans.length, containsEdges: containsEdges.length, containsDangling: containsDangling.length },
    mutation: mutantOut,
    checks: { total: checks, passed, failed },
  }
  const { writeFileSync: wf, mkdirSync: ms } = await import("node:fs")
  ms(join(ROOT, "validation/m51/results"), { recursive: true })
  wf(join(ROOT, "validation/m51/results/A1.json"), JSON.stringify(evidence, null, 2))
  console.log(`\nA1: ${passed}/${checks} passed, ${failed} failed → validation/m51/results/A1.json`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
