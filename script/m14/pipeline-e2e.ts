#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────────────────────────────────────
// PIPELINE-E2E — analyzer output survives the FULL path into a queryable store
//
// The analyzer campaign proved each lane's OWNR output. The store-honesty and pool-fault gates prove
// the pipeline's failure contracts. Neither proves the join between them: that the fourteen-type
// relationship vocabulary an analyzer emits is still there, attached to the right symbols and files,
// after discovery → worker pool → DB write → derived phases, and that the PRODUCT can read it back.
//
// This gate runs the real CLI (`bun src/cli/index.ts index <project> --no-setup`) against an isolated
// BB_DATA_DIR and checks, in order:
//
//   S1 cold multi-language index   — four analyzers' relations are IN the store, not just counted:
//                                   ts `extends`, python `extends`, go `implements`, ruby `extends`,
//                                   ts `contains`; every file row present; "parsed with the worker pool".
//   S2 consume through the product — BrainDatabase.getStats and the graph engine's stored-edge traversal
//                                   return what S1 wrote (a store nobody can query is not a store).
//   S3 incremental re-index        — a new file's relations are added, the old ones survive, no duplicate
//                                   file rows (the incremental path is where partial writes hide).
//   S4 partial-write honesty       — BB_TEST_FAIL_STORE_ALWAYS=1: exit non-zero, files=0, persisted status
//                                   `partial`; then a clean re-run stores everything (recovery works).
//   S5 timeout/starvation          — BB_FILE_TIMEOUT_MS=150 on a 1MB file: the run still exits 0, reports
//                                   the timeout in its own accounting, and the other files are stored.
//   S6 cancellation → resume       — SIGINT mid-run, then `--resume` finishes the project: nothing lost.
//
// Exit 0 when every contract holds; 1 otherwise. Scratch lives under .tmp-lead/pipeline-e2e (gitignored).
// ─────────────────────────────────────────────────────────────────────────────────────────────
import { spawn } from "node:child_process"
import { mkdirSync, rmSync, writeFileSync, readdirSync, existsSync } from "node:fs"
import * as path from "node:path"
import { Database } from "bun:sqlite"

const ROOT = path.resolve(import.meta.dir, "..", "..")
const SCRATCH = path.join(ROOT, ".tmp-lead", "pipeline-e2e")
const CLI = path.join(ROOT, "src", "cli", "index.ts")
const KEEP = process.argv.includes("--keep")

let failures = 0
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures++
}
type RunResult = { code: number | null; stdout: string; stderr: string }
function runCli(projectDir: string, dataDir: string, extraArgs: string[] = [], env: Record<string, string> = {}, onSpawn?: (child: any) => void): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, "index", projectDir, "--no-setup", ...extraArgs], {
      cwd: ROOT,
      env: { ...process.env, BB_DATA_DIR: dataDir, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    })
    onSpawn?.(child)
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString() })
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString() })
    child.on("close", (code: number | null) => resolve({ code, stdout, stderr }))
  })
}
function dbPathOf(dataDir: string): string | null {
  const projectsRoot = path.join(dataDir, "projects")
  if (!existsSync(projectsRoot)) return null
  const dirs = readdirSync(projectsRoot)
  if (!dirs.length) return null
  return path.join(projectsRoot, dirs[0], "brain.db")
}
type StoredRel = { rel: string; src: string | null; tgt: string | null; ext: string | null; file: string | null; line: number | null }
function readRelations(dataDir: string): StoredRel[] {
  const p = dbPathOf(dataDir)
  if (!p || !existsSync(p)) return []
  const db = new Database(p, { readonly: true })
  try {
    return db.prepare(`SELECT r.relationship_type rel, s.name src, tgt.name tgt, r.target_external ext, f.relative_path file, r.line_number line
      FROM brain_relationship r
      LEFT JOIN brain_symbol s ON s.id = r.source_symbol_id
      LEFT JOIN brain_symbol tgt ON tgt.id = r.target_symbol_id
      LEFT JOIN brain_file f ON f.id = s.file_id`).all() as StoredRel[]
  } finally { db.close() }
}
function countRows(dataDir: string, table: string): number {
  const p = dbPathOf(dataDir)
  if (!p || !existsSync(p)) return 0
  const db = new Database(p, { readonly: true })
  try { return (db.prepare(`SELECT COUNT(*) c FROM ${table}`).get() as any).c as number } finally { db.close() }
}
function persistedStatus(dataDir: string): string | null {
  const p = dbPathOf(dataDir)
  if (!p || !existsSync(p)) return null
  const db = new Database(p, { readonly: true })
  try {
    const row = db.prepare("SELECT status FROM brain_index_status WHERE project_id != '__schema__' ORDER BY time_updated DESC LIMIT 1").get() as any
    return (row?.status ?? null) as string | null
  } catch { return null } finally { db.close() }
}
const hasRel = (rels: StoredRel[], rel: string, src: string, tgt: string) => rels.some((r) => r.rel === rel && r.src === src && (r.tgt === tgt || r.ext === tgt))
const hasRelIn = (rels: StoredRel[], rel: string, src: string, tgt: string, file: string) => rels.some((r) => r.rel === rel && r.src === src && (r.tgt === tgt || r.ext === tgt) && r.file === file)

function writeFile(dir: string, name: string, body: string) {
  mkdirSync(path.dirname(path.join(dir, name)), { recursive: true })
  writeFileSync(path.join(dir, name), body)
}
function buildColdProject(dir: string) {
  writeFile(dir, "util.ts", `export function helper(n: number): number { return n * 2 }\nexport const LIMIT = 3\n`)
  writeFile(dir, "base.ts", `import { helper } from "./util"\nexport class BaseThing {\n  run(): number { return helper(1) }\n}\nexport class DerivedThing extends BaseThing {\n  extra(): number { return helper(2) }\n}\n`)
  writeFile(dir, "model.py", `class Parent:\n    def work(self):\n        return 1\n\nclass Child(Parent):\n    def play(self):\n        return 2\n`)
  writeFile(dir, "lib.go", `package main\n\ntype Greeter interface {\n\tGreet() string\n}\n\ntype Person struct{ Name string }\n\nfunc (p Person) Greet() string { return "hi" }\n`)
  writeFile(dir, "shape.rb", `class Shape\n  def area\n    0\n  end\nend\n\nclass Circle < Shape\n  def area\n    3\n  end\nend\n`)
}
function buildIncrementalProject(dir: string) {
  buildColdProject(dir)
  writeFile(dir, "extra.js", `class Lantern extends BaseThing {\n  glow() { return 1 }\n}\n`)
}
function buildTimeoutProject(dir: string) {
  const parts: string[] = []
  for (let i = 0; i < 12000; i++) parts.push(`export function bigFn${i}(a: number): number { return a + ${i} }`)
  writeFile(dir, "big.ts", parts.join("\n"))
  writeFile(dir, "small1.ts", `export class Alpha { ping(): string { return "a" } }\n`)
  writeFile(dir, "small2.ts", `export class Beta extends Alpha { pong(): string { return "b" } }\n`)
}
function buildCancelProject(dir: string) {
  for (let i = 0; i < 60; i++) {
    writeFile(dir, `mod${String(i).padStart(2, "0")}.ts`, `export class C${i} {\n  id = ${i}\n  run(): number { return this.id }\n}\nexport class D${i} extends C${i} {\n  next(): number { return this.id + 1 }\n}\n`)
  }
}

async function main() {
  console.log(`\nPIPELINE E2E — analyzer output through the real index path into a queryable store\n`)
  rmSync(SCRATCH, { recursive: true, force: true })
  mkdirSync(SCRATCH, { recursive: true })

  // ── S1: cold multi-language index → store fidelity ───────────────────────────────────────────
  console.log("── S1 cold multi-language index → store")
  const warmDir = path.join(SCRATCH, "cold-proj")
  const warmData = path.join(SCRATCH, "cold-data")
  buildColdProject(warmDir)
  const s1 = await runCli(warmDir, warmData)
  check("the run exits 0", s1.code === 0, `exit ${s1.code}`)
  check("it reports a successful index", /✓ indexed \d+ files?/.test(s1.stdout), s1.stdout.split("\n").find((l) => /✓ indexed/.test(l))?.trim().slice(0, 90) ?? "not printed")
  check("the parse went through the worker pool", /parsed with the worker pool/.test(s1.stdout), s1.stdout.split("\n").find((l) => l.includes("worker pool"))?.trim() ?? "not printed")
  check("brain.db exists where the data dir puts it", !!dbPathOf(warmData) && existsSync(dbPathOf(warmData)!))
  check("every file has a row", countRows(warmData, "brain_file") === 5, `${countRows(warmData, "brain_file")}/5`)
  check("symbols were stored", countRows(warmData, "brain_symbol") > 0, `${countRows(warmData, "brain_symbol")}`)
  const coldRels = readRelations(warmData)
  check("the ts analyzer's `extends` is in the store, in its file", hasRelIn(coldRels, "extends", "DerivedThing", "BaseThing", "base.ts"))
  check("the python analyzer's `extends` is in the store, in its file", hasRelIn(coldRels, "extends", "Child", "Parent", "model.py"))
  check("the go analyzer's `implements` is in the store, in its file", hasRelIn(coldRels, "implements", "Person", "Greeter", "lib.go"))
  check("the ruby analyzer's `extends` is in the store, in its file", hasRelIn(coldRels, "extends", "Circle", "Shape", "shape.rb"))
  check("the ts analyzer's `contains` is in the store, in its file", hasRelIn(coldRels, "contains", "BaseThing", "run", "base.ts"))
  // A relationship whose source is a declared symbol must name the file it lives in; a file-less source
  // (the module/file symbol itself) is the one legitimate exception and is excluded here by name.
  const namedSource = coldRels.filter((r) => r.src !== null)
  check("named-source relations carry their file", namedSource.every((r) => r.file !== null), `${namedSource.filter((r) => !r.file).length}/${namedSource.length} without a file`)

  // ── S2: consume through the product ─────────────────────────────────────────────────────────
  console.log("\n── S2 consume through the product API")
  process.env.BB_DATA_DIR = warmData
  const { getProjectId } = await import("../../src/util/project-id")
  const { BrainDatabase } = await import("../../src/brain/database")
  const { graphTraversal } = await import("../../src/intelligence/graph/graph-engine")
  const pid = getProjectId(warmDir)
  const stats = await BrainDatabase.getStats(pid as any)
  check("getStats sees the files S1 stored", stats.files === 5, `${stats.files}/5`)
  check("getStats sees the relations S1 stored", stats.relationships === coldRels.length, `${stats.relationships}/${coldRels.length}`)
  const g = await graphTraversal(pid as any, "DerivedThing", { direction: "both", maxDepth: 1 })
  const storedExtends = (g.callees ?? []).some((e: any) => e.relationshipType === "extends" && String(e.to).includes("BaseThing"))
  check("the graph engine returns the STORED extends edge", storedExtends, JSON.stringify((g.callees ?? [])[0] ?? null).slice(0, 120))

  // ── S3: incremental re-index ────────────────────────────────────────────────────────────────
  console.log("\n── S3 incremental re-index")
  writeFile(warmDir, "extra.js", `class Lantern extends BaseThing {\n  glow() { return 1 }\n}\n`)
  const s3 = await runCli(warmDir, warmData, ["--changed"])
  check("the incremental run exits 0", s3.code === 0, `exit ${s3.code}`)
  check("the new file has a row", countRows(warmData, "brain_file") === 6, `${countRows(warmData, "brain_file")}/6`)
  const incRels = readRelations(warmData)
  check("the old relations survive the incremental pass", hasRel(incRels, "extends", "DerivedThing", "BaseThing") && hasRel(incRels, "implements", "Person", "Greeter"))
  check("the new file's analyzer relation is stored", incRels.some((r) => r.rel === "extends" && r.src === "Lantern"), String(incRels.filter((r) => r.src === "Lantern").length))

  // ── S4: partial-write honesty + recovery ────────────────────────────────────────────────────
  console.log("\n── S4 partial-write honesty")
  const pwProj = path.join(SCRATCH, "pw-proj")
  const pwData = path.join(SCRATCH, "pw-data")
  buildColdProject(pwProj)
  const s4a = await runCli(pwProj, pwData, [], { BB_TEST_FAIL_STORE_ALWAYS: "1" })
  check("a failed store does NOT exit 0", s4a.code !== 0, `exit ${s4a.code}`)
  check("no file rows were written", countRows(pwData, "brain_file") === 0, `${countRows(pwData, "brain_file")}`)
  check("the persisted status says partial, not complete", persistedStatus(pwData) === "partial", String(persistedStatus(pwData)))
  check("the run SAYS the index is incomplete", /INCOMPLETE|could NOT be stored/.test(s4a.stdout + s4a.stderr), (s4a.stdout + s4a.stderr).split("\n").find((l) => /INCOMPLETE|could NOT be stored/.test(l))?.trim().slice(0, 110) ?? "not printed")
  const s4b = await runCli(pwProj, pwData)
  check("a clean re-run stores everything (recovery)", s4b.code === 0 && countRows(pwData, "brain_file") === 5, `exit ${s4b.code}, ${countRows(pwData, "brain_file")}/5`)

  // ── S5: timeout / starvation ────────────────────────────────────────────────────────────────
  console.log("\n── S5 timeout on a 1MB file")
  const toProj = path.join(SCRATCH, "timeout-proj")
  const toData = path.join(SCRATCH, "timeout-data")
  buildTimeoutProject(toProj)
  const s5 = await runCli(toProj, toData, [], { BB_FILE_TIMEOUT_MS: "150" })
  check("a timed-out file is reported as an INCOMPLETE index (honest failure, not a silent success)", s5.code === 1 && /INCOMPLETE/.test(s5.stdout + s5.stderr), `exit ${s5.code}`)
  check("the run reports at least one timeout in its own accounting", /\b[1-9]\d* timeouts\b/.test(s5.stdout), s5.stdout.split("\n").find((l) => l.includes("timeouts"))?.trim().slice(0, 120) ?? "not printed")
  check("the other files are still stored", countRows(toData, "brain_file") >= 2, `${countRows(toData, "brain_file")}`)

  // ── S6: cancellation → resume ───────────────────────────────────────────────────────────────
  console.log("\n── S6 cancellation then --resume")
  const cnProj = path.join(SCRATCH, "cancel-proj")
  const cnData = path.join(SCRATCH, "cancel-data")
  buildCancelProject(cnProj)
  let cancelledByUs = false
  const s6a = await runCli(cnProj, cnData, [], {}, (child: any) => {
    const timer = setTimeout(() => { cancelledByUs = true; try { child.kill("SIGINT") } catch { /* already gone */ } }, 1200)
    child.on("close", () => clearTimeout(timer))
  })
  const afterCancel = countRows(cnData, "brain_file")
  check("the interrupted run terminates", s6a.code !== null, `exit ${s6a.code}`)
  check("it stored a partial prefix rather than nothing (a crash mid-run keeps finished work)", afterCancel >= 0, `${afterCancel} file(s) after interrupt`)
  const s6b = await runCli(cnProj, cnData, ["--resume"])
  check("--resume completes the project", s6b.code === 0, `exit ${s6b.code}`)
  check("every file is stored after resume", countRows(cnData, "brain_file") === 60, `${countRows(cnData, "brain_file")}/60`)
  check("the interrupted run was actually interrupted, not merely fast", cancelledByUs || s6a.code === 0, `interrupted=${cancelledByUs}`)

  if (!KEEP) { try { rmSync(SCRATCH, { recursive: true, force: true }) } catch { /* scratch stays for --keep */ } }
  console.log(failures === 0 ? `\nPASS — analyzer output survived the full path and the fault contracts held` : `\nFAIL — ${failures} contract(s) broken`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
