#!/usr/bin/env bun
/**
 * CLEAN lane — WHAT THE MODULE-QUALIFIED IDENTITY WOULD BUY, PRICED AGAINST THE GATE'S OWN DUMP.
 *
 * A Clean module is DECLARED in `.dcl` and IMPLEMENTED in `.icl`, so a module-scope declaration is ONE
 * declaration written in TWO files. The incoming gate's `--binding-collapse` reads the pair as one only
 * when every declaration carries the same NON-EMPTY `qualifiedName` that DIFFERS from the bare name. The
 * analyzer used to publish NO qualifiedName at module scope, so every module-level pair read as a name
 * collision.
 *
 * This instrument answers the question BEFORE the code moves: if every module-level symbol carried
 * `Module.name`, how many of the gate's residual rows would collapse to one declaration?
 *
 *   A  the residual rows, per label (from the gate's dump)
 *   B  the keys whose declarations would collapse: >= 2 declarations, ALL module-level (no `scope`,
 *      not a local), ALL carrying the SAME `Module.name` that differs from the bare name
 *   C  the price: mean rows in B per label
 *
 * THE RULE IS THE GATE'S, RESTATED — and the exclusion is the load-bearing half: a CLASS/INSTANCE
 * MEMBER keeps its `Owner.member` spelling (so it is NOT replaced by `Module.member`; that spelling is
 * what `overrides`/`implements` endpoints are written in), and a MODULE symbol keeps its name (there is
 * nothing above a module, so its only qualified spelling would equal its name and the gate would rightly
 * ignore it).
 *
 * MEASURED 2026-10-29, on the committed 2026-10-28 dump
 * (`validation/m14/measurements/clean/gate-clean-dump-2026-10-28.txt`, 312 files): **797 `references`
 * + 28 `exports`** rows collapse-fixable. The arm AFTER the change moved exactly 797 `references`
 * rows and 28 `exports` rows — the price was exact, which is what makes this an instrument rather
 * than a forecast. (The same 2026-10-28 dump also prices 2 `calls` + 4 `implements` rows, which the
 * 2026-10-28 `--binding-collapse` pass had ALREADY merged; the receipt's TOTAL of 831 includes them,
 * so the two types this round moved are the 797 and the 28.)
 *
 * Usage:
 *   bun validation/m14/fixtures/clean/collapse-price.mts [--dump <gate-dump.txt>] [--json <out>] [--strict]
 * Without --dump it runs the lane's arm and captures the dump.
 */
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { execFileSync } from "node:child_process"
import { parseFile } from "../../../../src/ast/pool-worker"

const argOf = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const CORPUS = argOf("corpus") ?? process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const JSON_OUT = argOf("json")
const DUMP_ARG = argOf("dump")

type Decl = { rel: string; name: string; kind: string; module: string; proposed: string; local: boolean }
const keyspace = new Map<string, Map<string, Decl[]>>()
const files: Array<{ abs: string; repo: string; rel: string }> = []
for (const entry of fs.readdirSync(CORPUS)) {
  const repoRoot = path.join(CORPUS, entry)
  try { if (!fs.statSync(repoRoot).isDirectory()) continue } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", repoRoot, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 1 << 28 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) if (/\.(icl|dcl)$/.test(rel)) files.push({ abs: path.join(repoRoot, rel), repo: entry, rel })
}

let parsed = 0
const moduleMissing: string[] = []
for (const f of files) {
  let r: any
  try { r = await parseFile(f.abs, path.join(CORPUS, f.repo), { projectRoot: path.join(CORPUS, f.repo) } as any) } catch { continue }
  if (!r) continue
  parsed++
  const modSym = (r.symbols ?? []).find((s: any) => String(s?.kind ?? "").toLowerCase() === "module")
  const module = modSym ? String(modSym.name) : ""
  if (!module) moduleMissing.push(f.rel)
  let ks = keyspace.get(f.repo)
  if (!ks) keyspace.set(f.repo, (ks = new Map()))
  for (const s of r.symbols ?? []) {
    const name = String(s?.name ?? "")
    if (!name || String(s?.kind ?? "").toLowerCase() === "module") continue
    const scope = String(s?.scope ?? "")
    const local = String(s?.visibility ?? "") === "local" || s?.metadata?.isLocalDefinition === true
    const storeQ = String(s?.qualifiedName ?? "") || (scope ? `${scope}.${name}` : name)
    // THE PROPOSAL: module-level only. A member keeps `Owner.member`; a local keeps its frame.
    const proposed = scope || local || !module ? storeQ : `${module}.${name}`
    const d: Decl = { rel: f.rel, name, kind: String(s?.kind ?? ""), module, proposed, local }
    const at = ks.get(name)
    if (at) at.push(d); else ks.set(name, [d])
  }
}

/** the keys that would collapse to ONE declaration under the proposal */
const collapses = new Set<string>()
for (const [project, ks] of keyspace) {
  for (const [name, ds] of ks) {
    if (ds.length < 2) continue
    const quals = new Set<string>()
    for (const d of ds) quals.add(d.proposed && d.proposed !== name ? d.proposed : "")
    if (quals.size === 1 && !quals.has("")) collapses.add(`${project}\0${name}`)
  }
}

let dumpPath = DUMP_ARG
let temp: string | null = null
if (!dumpPath) {
  temp = path.join(os.tmpdir(), `clean-collapse-price-${process.pid}.txt`)
  // THE GATE EXITS 1 WHEN THE VERDICT IS FAIL, WHICH IS THE LANE'S NORMAL STATE — the non-zero exit is
  // caught and its STDOUT is the dump.
  let out = ""
  try {
    out = execFileSync("bun", ["run", "script/m14/incoming-gate.ts", "clean", "icl,dcl", "0", "--binding-collapse", "--dump"], {
      encoding: "utf8", maxBuffer: 1 << 30,
      env: { ...process.env, BB_DUMP_LIMIT: "2000000" },
    })
  } catch (e: any) {
    out = String(e?.stdout ?? "")
    if (!out) throw e
  }
  fs.writeFileSync(temp, out)
  dumpPath = temp
  process.stderr.write(`ran the arm; dump at ${temp}\n`)
}

const rows = fs.readFileSync(dumpPath, "utf8").split("\n").filter((l) => l.startsWith("DUMP\t")).map((l) => l.split("\t"))
const tally = new Map<string, { residual: number; collapse: number; rest: number; examples: string[] }>()
let rowsChecked = 0
for (const [, type, outcome, target, loc] of rows) {
  if (!["ambDeclOnly", "ambBoth", "unresolved"].includes(outcome)) continue
  rowsChecked++
  const project = /\/repositories\/([^/]+)\//.exec(loc)?.[1] ?? ""
  const row = tally.get(type) ?? { residual: 0, collapse: 0, rest: 0, examples: [] }
  row.residual++
  if (collapses.has(`${project}\0${target}`)) {
    row.collapse++
    if (row.examples.length < 8) row.examples.push(`${outcome} ${target} @ ${loc.replace(CORPUS, "")}`)
  } else row.rest++
  tally.set(type, row)
}

console.log(`CLEAN collapse price — ${parsed} parsed of ${files.length} admitted · ${collapses.size} key(s) would collapse · ${rowsChecked} residual rows priced`)
if (moduleMissing.length) console.log(`files without a module declaration (their symbols cannot be qualified): ${moduleMissing.length}`)
for (const [type, r] of tally) {
  console.log(`\n${type}: residual ${r.residual} · collapse-fixable ${r.collapse} · rest ${r.rest}`)
  for (const e of r.examples) console.log(`   ${e}`)
}
const total = [...tally.values()].reduce((s, r) => s + r.collapse, 0)
console.log(`\nTOTAL collapse-fixable: ${total}`)

if (JSON_OUT) {
  fs.writeFileSync(JSON_OUT, JSON.stringify({
    corpus: CORPUS, dump: dumpPath, parsed, admitted: files.length, moduleMissing,
    collapseKeys: collapses.size, rowsChecked,
    perType: Object.fromEntries([...tally].map(([t, r]) => [t, { residual: r.residual, collapse: r.collapse, rest: r.rest, examples: r.examples }])),
    total,
  }, null, 2))
}
if (temp) fs.unlinkSync(temp)
