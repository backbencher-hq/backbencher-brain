#!/usr/bin/env tsx
/**
 * CLEAN lane — RECONCILE the two unattached numbers.
 *
 * Two committed measurements disagree and both are correct about different things:
 *
 *   store-resolution-120    1,681 of 16,246 edges (10.4%) have target_external set and
 *                           target_symbol_id NULL.
 *   cause-c-full-2181         816 of 233,885 edges ( 0.3%) name a symbol NO file in the
 *                           2,181-file corpus publishes.
 *
 * They measure different populations (a 120-file slice vs the whole corpus) and different
 * predicates (did not ATTACH vs names nothing). The gap is the store's eligibility rule,
 * and it is worth naming precisely because "unattached" is the number a reader will quote:
 *
 *   src/ast/parallel-indexer.ts:4126-4153, the authoritative pass, selects
 *     WHERE instr(r.target_external,'.')=0 AND instr(r.target_external,':')=0
 *   so a target carrying a '.' or a ':' is EXCLUDED from attachment entirely. It stays
 *   NULL no matter how many files publish that name.
 *
 * Clean spells a qualified name `Module:Item` and a dotted module path `Module.Item`, so
 * this lane emits a large share of its targets in a shape the pass cannot attach. That
 * is not an analyzer defect and it is not fixable from inside the analyzer — it is the
 * resolution pass's eligibility rule, which is shared machinery.
 *
 * So every unattached edge falls into exactly one of four buckets, and this file prints
 * the count for each rather than one total:
 *
 *   BARE_PUBLISHED_HERE   no '.' or ':', and the source file publishes the name. The pass
 *                         SHOULD have attached it. A real miss.
 *   BARE_PUBLISHED_ELSE   no '.' or ':', another sample file publishes the name. The pass
 *                         attaches it to the lowest symbol id, which is an arbitrary pick
 *                         among same-named declarations — measured as 100% landing in the
 *                         source file by store-resolution-120, so this bucket is not a
 *                         wrong-binding bucket.
 *   QUALIFIED            the target carries a '.' or ':'. Ineligible for the pass by
 *                         construction. Counted, not scored.
 *   UNPUBLISHED          no sample file publishes the target or its final segment.
 *
 * ## Usage
 *
 *   npx tsx script/m14/clean-unattached-reconcile.mts --files=120 [--json <out>]
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
const lastSeg = (t: string) => t.split(/[.:]/).pop()!

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
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-clean-rec-"))
  const projDir = path.join(workdir, "proj")
  fs.mkdirSync(projDir, { recursive: true })
  const taken = admitted().slice(0, FILES)
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
  await indexProjectParallel(pid, projDir, { onProgress: () => {} })

  const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker.ts"))
  const byFile = new Map<string, Set<string>>()
  const byName = new Map<string, Set<string>>()
  for (const f of taken) {
    const rel = path.relative(projDir, f)
    let r: any
    try { r = await parseFile(f, rel, undefined as any) } catch { continue }
    let set = byFile.get(rel)
    if (!set) byFile.set(rel, (set = new Set<string>()))
    for (const s of r?.symbols ?? []) {
      if (typeof s?.name !== "string" || !s.name) continue
      set.add(s.name)
      let files = byName.get(s.name)
      if (!files) byName.set(s.name, (files = new Set<string>()))
      files.add(rel)
    }
  }

  const raw: any = await BrainDatabase.getRawInstance(pid)
  const rows = raw.prepare(`
    SELECT r.relationship_type AS t, r.target_external AS tgt, sf.relative_path AS sfile
      FROM brain_relationship r
      LEFT JOIN brain_symbol s ON s.id = r.source_symbol_id
      LEFT JOIN brain_file sf ON sf.id = s.file_id
     WHERE r.project_id = ? AND r.target_external IS NOT NULL AND r.target_symbol_id IS NULL
  `).all(pid) as any[]

  type B = "BARE_PUBLISHED_HERE" | "BARE_PUBLISHED_ELSE" | "QUALIFIED" | "UNPUBLISHED"
  const buckets: Record<B, { n: number; targets: Set<string>; byType: Record<string, number> }> = {
    BARE_PUBLISHED_HERE: { n: 0, targets: new Set(), byType: {} },
    BARE_PUBLISHED_ELSE: { n: 0, targets: new Set(), byType: {} },
    QUALIFIED: { n: 0, targets: new Set(), byType: {} },
    UNPUBLISHED: { n: 0, targets: new Set(), byType: {} },
  }
  for (const r of rows) {
    const tgt = String(r.tgt ?? "")
    const qualified = tgt.includes(".") || tgt.includes(":")
    let b: B
    if (qualified) b = "QUALIFIED"
    else if (byFile.get(r.sfile ?? "")?.has(tgt)) b = "BARE_PUBLISHED_HERE"
    else if (byName.has(tgt)) b = "BARE_PUBLISHED_ELSE"
    else if (byName.has(lastSeg(tgt))) b = "QUALIFIED"
    else b = "UNPUBLISHED"
    const k = buckets[b]
    k.n++
    k.targets.add(tgt)
    k.byType[r.t] = (k.byType[r.t] ?? 0) + 1
  }

  const ORDER: B[] = ["BARE_PUBLISHED_HERE", "BARE_PUBLISHED_ELSE", "QUALIFIED", "UNPUBLISHED"]
  console.log(`UNATTACHED RECONCILIATION — ${rows.length} unattached edges over ${taken.length} files`)
  console.log(`the store's pass attaches a target only when it has no '.' and no ':'\n`)
  console.log(`bucket                   edges   share   distinct   types`)
  console.log(`-`.repeat(92))
  for (const b of ORDER) {
    const k = buckets[b]
    console.log(`${b.padEnd(24)}${String(k.n).padStart(6)}${`${(100 * k.n / rows.length).toFixed(1)}%`.padStart(9)}${String(k.targets.size).padStart(11)}   ${JSON.stringify(k.byType)}`)
  }
  console.log(`-`.repeat(92))

  const realMiss = buckets.BARE_PUBLISHED_HERE
  console.log(`\nBARE_PUBLISHED_HERE = ${realMiss.n}: bare target, published by the SOURCE file,`)
  console.log(`and still unattached. These are the only unattached edges this analyzer could`)
  console.log(`have got right and did not. Distinct targets:`)
  for (const t of [...realMiss.targets].sort()) {
    console.log(`  ${t}  declared in ${(byName.get(t)?.size ?? 0)} file(s)`)
  }

  const q = buckets.QUALIFIED
  console.log(`\nQUALIFIED = ${q.n}: the target carries a '.' or ':'.`)
  console.log(`Clean's qualified spellings are Module:Item (import) and Module.Item (module path).`)
  console.log(`These are excluded from the store's pass by its own WHERE clause, so no`)
  console.log(`resolution quality can change their number. Top 15 by frequency:`)
  const qf = new Map<string, number>()
  for (const r of rows) {
    const tgt = String(r.tgt ?? "")
    if (buckets.QUALIFIED.targets.has(tgt)) qf.set(tgt, (qf.get(tgt) ?? 0) + 1)
  }
  for (const [t, n] of [...qf.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${String(n).padStart(5)}  ${t}`)

  if (JSON_OUT) {
    const ser: Record<string, any> = {}
    for (const b of ORDER) ser[b] = { edges: buckets[b].n, distinctTargets: buckets[b].targets.size,
      byType: buckets[b].byType, targets: [...buckets[b].targets].sort() }
    fs.writeFileSync(JSON_OUT, JSON.stringify({
      corpusRoot: CORPUS, files: taken.length, unattached: rows.length, byBucket: ser,
    }, null, 2))
    console.log(`\nJSON written: ${JSON_OUT}`)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })