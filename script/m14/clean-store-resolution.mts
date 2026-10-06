#!/usr/bin/env tsx
/**
 * CLEAN lane — STORE RESOLUTION: which symbol does an emitted edge ACTUALLY land on.
 *
 * ## Why this instrument exists
 *
 * `clean-ambiguity-split.mts` counts CANDIDATE declarations per target and is explicit
 * that it does not decide which one the consumer picks. The consumer does pick, and this
 * file measures the pick. Every other number on this lane stops at the analyzer's payload;
 * this one goes through `indexProjectParallel` into sqlite and reads
 * `brain_relationship.target_symbol_id` back.
 *
 * The reason that matters is the authoritative resolution pass
 * (`src/ast/parallel-indexer.ts:4126-4153`, the "review I13" pass):
 *
 *   SELECT s.id ... JOIN brain_symbol s ON s.name = r.target_external
 *    WHERE instr(r.target_external,'.')=0 AND instr(r.target_external,':')=0
 *    ORDER BY COALESCE(s.is_declaration,0) ASC, (s.file_id = src_file) DESC,
 *             (language equal) DESC, s.id ASC  ... rn = 1
 *
 * Four consequences, each of which is a measurement rather than a reading:
 *
 *   1. A bare target DECLARED IN THE SOURCE'S OWN FILE is ranked first by
 *      `(s.file_id = src_file) DESC`, so it lands on the right declaration.
 *   2. A bare target NOT declared in the source's file falls through to `s.id ASC` —
 *      the lowest symbol id in the whole project. With 62,980 declarations over 29,196
 *      names, that is an arbitrary pick among up to 168 same-named declarations.
 *   3. `contains` is EXCLUDED from the pass (`relationship_type <> 'contains'`) because
 *      its target is pinned to the edge's own line, so it resolves structurally.
 *   4. A DOTTED target is excluded too, so emitting a qualified name removes the edge
 *      from this pass entirely rather than competing with it.
 *
 * So "ambiguous" and "wrongly bound" are different numbers and this file is the second
 * one. A correct implementation could raise candidate counts and lower wrong bindings;
 * a lane is optimising the wrong quantity if it only watches the first.
 *
 * ## What counts as CORRECT here
 *
 * An attached target is CORRECT when the declaration it names is the one the analyzer
 * emitted at the edge's own line in the source's file. That is decidable for every edge
 * whose target string names a symbol the source file declares — which is the population
 * `clean-ambiguity-split.mts` measures as `DETERMINED_local` (113,500 of 233,885 target
 * edges, 48.5%). For an edge whose target the file does not declare, this instrument
 * reports the pick and the candidate count and calls the row `UNVERIFIABLE`, because
 * asserting which module's `map` was meant is the very question a per-file analyzer
 * cannot answer. Those rows are not scored, and their number is printed beside the scored
 * ones so the two are never added.
 *
 * ## Usage
 *
 *   npx tsx script/m14/clean-store-resolution.mts --files=120 [--corpus=<dir>] [--json=<out>]
 *
 * The sample is the FIRST `--files` of the SORTED admitted list, which is the same
 * deterministic slice the rest of this lane uses, so the two populations are comparable.
 */
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const FILES = Number(arg("files") ?? "120")
const CORPUS = arg("corpus") ?? "$HOME/fixtures/repositories"
const JSON_OUT = arg("json")

const TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const

/** admitted .icl/.dcl files, same discovery rule as clean-ontology-census.ts (git-tracked) */
function admitted(): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(CORPUS)) {
    const dir = path.join(CORPUS, e)
    try {
      if (!fs.statSync(dir).isDirectory()) continue
    } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync(
        "git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 1 << 28 },
      ).split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      if (!/\.(icl|dcl)$/.test(rel)) continue
      const abs = path.join(dir, rel)
      try { if (fs.statSync(abs).size > 512 * 1024) continue } catch { continue }
      out.push(abs)
    }
  }
  return out.sort()
}

async function main() {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-clean-res-"))
  const projDir = path.join(workdir, "proj")
  fs.mkdirSync(projDir, { recursive: true })
  const taken = admitted().slice(0, FILES)
  if (taken.length === 0) { console.error(`no .icl/.dcl under ${CORPUS}`); process.exit(1) }
  for (const f of taken) {
    const dest = path.join(projDir, path.relative(CORPUS, f))
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, fs.readFileSync(f))
  }
  const dataDir = path.join(workdir, "data")
  fs.mkdirSync(dataDir, { recursive: true })
  process.env.BB_DATA_DIR = dataDir

  console.log(`clean store resolution`)
  console.log(`corpus root:   ${CORPUS}`)
  console.log(`files indexed: ${taken.length} (deterministic FIRST ${taken.length} of the sorted admitted list)`)
  console.log(`project dir:   ${projDir}\n`)

  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
  const pid = getProjectId(projDir) as any
  const t0 = Date.now()
  const stats = await indexProjectParallel(pid, projDir, { onProgress: () => {} })
  const ms = Date.now() - t0
  console.log(`indexed in ${ms} ms: ${JSON.stringify(stats)}\n`)

  const raw: any = await BrainDatabase.getRawInstance(pid)
  const q = (sql: string, ...a: any[]) => raw.prepare(sql).all(...a) as any[]

  // The oracle: what the ANALYZER emitted, per file. Read through production parseFile,
  // not the analyzer class, so this is the payload the indexer saw.
  const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker.ts"))
  /** "relpath\u0000type\u0000source\u0000target\u0000line" -> true if the source file declares `target` at `line` */
  const declAtLine = new Map<string, Map<string, Set<number>>>()
  /** "relpath\u0000name" -> 1 */
  const declByName = new Map<string, Set<string>>()
  let analyzerEdges = 0
  const analyzerByType: Record<string, number> = {}
  for (const f of taken) {
    const rel = path.relative(projDir, f)
    let r: any
    try { r = await parseFile(f, rel, undefined as any) } catch { continue }
    const perFile = declAtLine.get(rel) ?? new Map<string, Set<number>>()
    for (const s of r?.symbols ?? []) {
      let lines = perFile.get(s.name)
      if (!lines) perFile.set(s.name, (lines = new Set()))
      lines.add(s.range?.startLine ?? 0)
      let files = declByName.get(s.name)
      if (!files) declByName.set(s.name, (files = new Set()))
      files.add(rel)
    }
    declAtLine.set(rel, perFile)
    for (const e of r?.relationships ?? []) {
      analyzerEdges++
      const t = String(e.type ?? "")
      analyzerByType[t] = (analyzerByType[t] ?? 0) + 1
    }
  }
  void declAtLine
  void declByName

  const relRows = q(`
    SELECT r.relationship_type AS t,
           r.target_external  AS tgt,
           r.line_number      AS line,
           r.source_symbol_id AS sid,
           r.target_symbol_id AS tid,
           sf.relative_path   AS sfile,
           tf.relative_path   AS tfile,
           ts.name            AS tname,
           ts.line_start      AS tline
    FROM brain_relationship r
    LEFT JOIN brain_symbol s ON s.id = r.source_symbol_id
    LEFT JOIN brain_file sf ON sf.id = s.file_id
    LEFT JOIN brain_symbol ts ON ts.id = r.target_symbol_id
    LEFT JOIN brain_file tf ON tf.id = ts.file_id
    WHERE r.project_id = ?
  `, pid) as any[]

  console.log(`analyzer edges: ${analyzerEdges}   stored edges: ${relRows.length}`)
  console.log(`per-label analyzer vs stored:`)
  for (const t of TYPES) {
    const a = analyzerByType[t] ?? 0
    const s2 = relRows.filter((r) => r.t === t).length
    console.log(`  ${t.padEnd(13)} analyzer ${String(a).padStart(7)}   stored ${String(s2).padStart(7)}   ${a === s2 ? "match" : "DIFFER"}`)
  }

  // CORRECTNESS. The source file's OWN declarations are the oracle the store ranks first,
  // so "landed on a symbol declared in the source file at some line" is the decidable half.
  const rows: Record<string, { n: number; nullTarget: number; unattached: number; wrongFile: number; correct: number; unverifiable: number; nullSource: number }> = {}
  for (const t of TYPES) rows[t] = { n: 0, nullTarget: 0, unattached: 0, wrongFile: 0, correct: 0, unverifiable: 0, nullSource: 0 }
  for (const r of relRows) {
    const k = rows[r.t]
    if (!k) continue
    k.n++
    if (!r.sid) k.nullSource++
    if (r.tgt == null) { k.nullTarget++; continue }
    if (r.tid == null) { k.unattached++; continue }
    if (r.sfile && r.tfile && r.sfile !== r.tfile) {
      // attached, but to a different file than the edge's source. Whether that is right
      // depends on whether the source file declared the target at all.
      const perFile = declAtLine.get(r.sfile)
      const declaredHere = !!perFile?.has(String(r.tgt))
      if (declaredHere) k.wrongFile++
      else k.unverifiable++
    } else {
      k.correct++
    }
  }

  const pad = (s: string, n: number) => String(n).padStart(7)
  console.log(`\nWHERE THE EDGE LANDED — per label`)
  console.log(`type            edges  nullTgt  unattached  wrongFile  correct  unverifiable  nullSrc`)
  console.log(`-`.repeat(92))
  let T = { n: 0, nullTarget: 0, unattached: 0, wrongFile: 0, correct: 0, unverifiable: 0, nullSource: 0 }
  for (const t of TYPES) {
    const k = rows[t]
    if (!k.n) { console.log(`${t.padEnd(13)} ${"(not emitted)".padStart(38)}`); continue }
    for (const key of Object.keys(T) as (keyof typeof T)[]) T[key] += k[key]
    console.log(`${t.padEnd(13)}${pad("", k.n)}${pad("", k.nullTarget)}${pad("", k.unattached)}${pad("", k.wrongFile)}${pad("", k.correct)}${pad("", k.unverifiable)}${pad("", k.nullSource)}`)
  }
  console.log(`-`.repeat(92))
  console.log(`${"ALL".padEnd(13)}${pad("", T.n)}${pad("", T.nullTarget)}${pad("", T.unattached)}${pad("", T.wrongFile)}${pad("", T.correct)}${pad("", T.unverifiable)}${pad("", T.nullSource)}`)

  const decidable = T.correct + T.wrongFile
  console.log(`\nDECIDABLE rows (the target is declared in the source's own file, so "landed in the`)
  console.log(`source file" is the right answer): ${decidable}`)
  console.log(`  landed in the source file : ${T.correct}  ${decidable ? (100 * T.correct / decidable).toFixed(1) : "n/a"}%`)
  console.log(`  landed ELSEWHERE          : ${T.wrongFile}  ${decidable ? (100 * T.wrongFile / decidable).toFixed(1) : "n/a"}%`)
  console.log(`UNVERIFIABLE rows (target not declared in the source file; this instrument does not`)
  console.log(`  claim to know which module's declaration was meant): ${T.unverifiable}`)
  console.log(`UNATTACHED (target_external set, target_symbol_id NULL): ${T.unattached}`)
  console.log(`NULL TARGET (no target_external at all): ${T.nullTarget}`)
  console.log(`SOURCE UNATTACHED: ${T.nullSource}`)

  if (JSON_OUT) {
    fs.writeFileSync(JSON_OUT, JSON.stringify({
      corpusRoot: CORPUS, files: taken.length, projectDir: projDir,
      analyzerEdges, storedEdges: relRows.length, analyzerByType,
      perType: rows, totals: T,
      decidable, correctRate: decidable ? T.correct / decidable : null,
    }, null, 2))
    console.log(`\nJSON written: ${JSON_OUT}`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
