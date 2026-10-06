#!/usr/bin/env tsx
/**
 * CLEAN lane — WHAT THE UNATTACHED TARGETS LOOK LIKE.
 *
 * `clean-store-resolution.mts` measured that 1,681 of 16,246 edges (10.4%) carry a
 * `target_external` and no `target_symbol_id`, and that the other 10,516 decidable edges
 * land in the source file 100.0% of the time. So the whole remaining cost of this lane is
 * the 1,681. This file asks what those target STRINGS are, because the round brief's
 * cause B is exactly the hypothesis that some of them are a spelling mismatch.
 *
 * The classification is by string SHAPE, not by judgement, and each bucket is a shape a
 * correct analyzer could retarget with a one-line change or could not retarget at all:
 *
 *   BARE_IN_SOURCE      the target names a symbol the SOURCE FILE declares -> cause B,
 *                       a format mismatch, and a real fix.
 *   BARE_ELSEWHERE      the target names a symbol SOME OTHER SAMPLE FILE declares ->
 *                       resolvable only if the corpus is indexed together; NOT a
 *                       spelling defect, and not fixable from inside a per-file analyzer.
 *   DOTTED_LAST_BARE    the target has a '.' and its FINAL SEGMENT is a published name
 *                       -> the graphql defect, verbatim.
 *   DOTTED_LAST_UNKNOWN the target has a '.' and its final segment is published nowhere.
 *   COLON_*             the target has a ':' (Clean spells import targets Module:Item).
 *   EMPTY               an empty or whitespace target string.
 *   OTHER               none of the above; printed so the bucket cannot hide a shape.
 *
 * ## Usage
 *
 *   npx tsx script/m14/clean-unattached.mts --files=120 [--corpus=<dir>] [--json=<out>]
 *
 * Same admitted-list rule and same FIRST-N slice as clean-store-resolution.mts, so the two
 * populations are the same and the numbers are comparable.
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

function admitted(): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(CORPUS)) {
    const dir = path.join(CORPUS, e)
    try { if (!fs.statSync(dir).isDirectory()) continue } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"],
        { encoding: "utf8", maxBuffer: 1 << 28 }).split("\0").filter(Boolean)
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
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-clean-una-"))
  const projDir = path.join(workdir, "proj")
  fs.mkdirSync(projDir, { recursive: true })
  const taken = admitted().slice(0, FILES)
  if (!taken.length) { console.error(`no .icl/.dcl under ${CORPUS}`); process.exit(1) }
  for (const f of taken) {
    const dest = path.join(projDir, path.relative(CORPUS, f))
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, fs.readFileSync(f))
  }
  const dataDir = path.join(workdir, "data")
  fs.mkdirSync(dataDir, { recursive: true })
  process.env.BB_DATA_DIR = dataDir

  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
  const pid = getProjectId(projDir) as any
  const stats = await indexProjectParallel(pid, projDir, { onProgress: () => {} })
  console.log(`indexed ${taken.length} files in ${stats.totalWallMs} ms\n`)

  // What every file DECLARES, read through production parseFile — the payload the
  // indexer saw, not the analyzer class.
  const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker.ts"))
  /** relpath -> Set<published name> */
  const declByFile = new Map<string, Set<string>>()
  /** name -> Set<relpath> */
  const declByName = new Map<string, Set<string>>()
  for (const f of taken) {
    const rel = path.relative(projDir, f)
    let r: any
    try { r = await parseFile(f, rel, undefined as any) } catch { continue }
    let names = declByFile.get(rel)
    if (!names) declByFile.set(rel, (names = new Set<string>()))
    for (const s of r?.symbols ?? []) {
      if (typeof s?.name !== "string" || !s.name) continue
      names.add(s.name)
      let files = declByName.get(s.name)
      if (!files) declByName.set(s.name, (files = new Set<string>()))
      files.add(rel)
    }
  }

  const raw: any = await BrainDatabase.getRawInstance(pid)
  const rows = raw.prepare(`
    SELECT r.relationship_type AS t, r.target_external AS tgt, r.target_symbol_id AS tid,
           sf.relative_path AS sfile
      FROM brain_relationship r
      LEFT JOIN brain_symbol s ON s.id = r.source_symbol_id
      LEFT JOIN brain_file sf ON sf.id = s.file_id
     WHERE r.project_id = ? AND r.target_external IS NOT NULL
       AND r.target_symbol_id IS NULL
  `).all(pid) as any[]

  const SHAPES = [
    "EMPTY", "DOTTED_LAST_BARE", "DOTTED_LAST_UNKNOWN",
    "COLON_LAST_BARE", "COLON_LAST_UNKNOWN", "BARE_IN_SOURCE", "BARE_ELSEWHERE", "OTHER",
  ] as const
  type Shape = typeof SHAPES[number]
  const shapeOf = (tgt: string, sfile: string | null): Shape => {
    if (!tgt || !tgt.trim()) return "EMPTY"
    const last = tgt.split(/[.:]/).pop()!
    const dotted = tgt.includes(".")
    const colon = tgt.includes(":")
    const here = sfile ? declByFile.get(sfile)?.has(tgt) : false
    if (here) return "BARE_IN_SOURCE"
    const lastIsName = declByName.has(last)
    if (dotted) return lastIsName ? "DOTTED_LAST_BARE" : "DOTTED_LAST_UNKNOWN"
    if (colon) return lastIsName ? "COLON_LAST_BARE" : "COLON_LAST_UNKNOWN"
    return lastIsName ? "BARE_ELSEWHERE" : "OTHER"
  }

  const buckets: Record<Shape, { n: number; targets: Set<string>; types: Record<string, number> }> =
    {} as any
  for (const s of SHAPES) buckets[s] = { n: 0, targets: new Set<string>(), types: {} }
  const perType: Record<string, Record<string, number>> = {}
  const examples: Record<string, string[]> = {}
  for (const r of rows) {
    const tgt = String(r.tgt ?? "")
    const sh = shapeOf(tgt, r.sfile)
    const b = buckets[sh]
    b.n++
    b.targets.add(tgt)
    b.types[r.t] = (b.types[r.t] ?? 0) + 1
    perType[r.t] ??= {}
    perType[r.t][sh] = (perType[r.t][sh] ?? 0) + 1
    const key = `${sh}/${r.t}`
    examples[key] ??= []
    if (examples[key].length < 8) examples[key].push(`${tgt || "(empty)"}  [${r.sfile ?? "?"}]`)
  }

  console.log(`UNATTACHED edges (target_external set, target_symbol_id NULL): ${rows.length}`)
  console.log(`\nBY SHAPE`)
  console.log(`shape                  edges   distinct   types`)
  console.log(`-`.repeat(78))
  for (const s of SHAPES) {
    const b = buckets[s]
    console.log(`${s.padEnd(22)}${String(b.n).padStart(6)}${String(b.targets.size).padStart(11)}   ${JSON.stringify(b.types)}`)
  }
  console.log(`-`.repeat(78))
  console.log(`${"TOTAL".padEnd(22)}${String(rows.length).padStart(6)}`)

  console.log(`\nBY TYPE x SHAPE`)
  const types = Object.keys(perType).sort()
  console.log(`type            ${SHAPES.map((s) => s.slice(0, 11).padStart(12)).join("")}`)
  for (const t of types) {
    console.log(`${t.padEnd(14)}${SHAPES.map((s) => String(perType[t][s] ?? 0).padStart(12)).join("")}`)
  }

  console.log(`\nEXAMPLES`)
  for (const k of Object.keys(examples).sort()) {
    console.log(`  ${k}`)
    for (const e of examples[k]) console.log(`      ${e}`)
  }

  if (JSON_OUT) {
    const ser: Record<string, any> = {}
    for (const s of SHAPES) {
      ser[s] = { edges: buckets[s].n, distinctTargets: buckets[s].targets.size,
        byType: buckets[s].types, topTargets: [...buckets[s].targets].sort().slice(0, 200) }
    }
    fs.writeFileSync(JSON_OUT, JSON.stringify({
      corpusRoot: CORPUS, files: taken.length, unattached: rows.length,
      byShape: ser, perType,
    }, null, 2))
    console.log(`\nJSON written: ${JSON_OUT}`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })