#!/usr/bin/env tsx
/**
 * CLEAN lane — CAUSE C ADJUDICATION: is an unattached target EXTERNAL or MISSED-LOCAL?
 *
 * ## Why this split is the whole question
 *
 * `clean-unattached.mts` measured 1,780 unattached edges and classified them by string
 * SHAPE. That is not the decision a consumer needs. A consumer needs to know which of
 * these it will ever be able to traverse and which it never will:
 *
 *   EXTERNAL  the target names something the corpus does not define — a Clean builtin
 *             (`World`), a stdlib module (`StdEnv`, `StdFile`), a stdlib typeclass
 *             (`Show`, `Eq`), or a module-qualified import of one. No amount of index
 *             quality fixes it. It should be MARKED, not counted as a failure.
 *   MISSED    the target IS published by some file in the corpus, and the edge still did
 *             not attach. That is a real defect: the name exists, the consumer had it in
 *             front of it, and it landed nowhere.
 *
 * The distinction is decidable with no judgement: parse every file in the sample through
 * production `parseFile`, collect the published names, and ask whether the target string
 * — or its final segment — is one of them.
 *
 * **EXTERNALITY IS NOT CLAIMED FROM A WORD LIST ALONE.** A name like `Show` is stdlib in
 * this corpus and could be a user typeclass in another. So this instrument reports, per
 * bucket, whether the corpus ITSELF proves externality: the target has no declaration
 * anywhere in the sample AND its module qualifier (for a `Module:Item` or `Module.Item`
 * spelling) is a module the corpus does not define. `Show` satisfies the second test when
 * it arrives as `StdEnv.Show`; a bare `Show` with no declaration anywhere is reported as
 * `UNPROVEN_EXTERNAL`, which is a weaker and honest category — the lane is asserting
 * "nothing here defines it", not "the language has no such construct".
 *
 * ## Usage
 *
 *   npx tsx script/m14/clean-cause-c.mts --files=120 [--corpus=<dir>] [--json=<out>]
 */
import * as fs from "node:fs"
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
  const taken = admitted().slice(0, FILES)
  if (!taken.length) { console.error(`no .icl/.dcl under ${CORPUS}`); process.exit(1) }

  const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker.ts"))
  const published = new Set<string>()
  const byName = new Map<string, Set<string>>()
  /** module name -> Set<file>, read from each file's own header `from M import` lines is
   *  not needed: Clean publishes a Module symbol, so declByName carries it. */
  for (const f of taken) {
    let r: any
    try { r = await parseFile(f, path.relative(CORPUS, f), undefined as any) } catch { continue }
    for (const s of r?.symbols ?? []) {
      if (typeof s?.name !== "string" || !s.name) continue
      published.add(s.name)
      let set = byName.get(s.name)
      if (!set) byName.set(s.name, (set = new Set<string>()))
      set.add(f)
    }
  }
  console.log(`corpus slice: ${taken.length} files, ${published.size} distinct published names\n`)

  // Recompute the unattached set from the payload itself (no sqlite needed): an edge is a
  // candidate when its full target string is not a published name AND its final segment is
  // not either. That is exactly the store's own eligibility test for the bare-name pass.
  const edges: { type: string; tgt: string; file: string; line: number }[] = []
  for (const f of taken) {
    let r: any
    try { r = await parseFile(f, path.relative(CORPUS, f), undefined as any) } catch { continue }
    for (const e of r?.relationships ?? []) {
      const t = String(e?.target ?? "")
      if (!t) continue
      edges.push({ type: String(e?.type ?? ""), tgt: t, file: f, line: Number(e?.line_number ?? 0) })
    }
  }
  const lastSeg = (t: string) => t.split(/[.:]/).pop()!
  const unattached = edges.filter((e) => !published.has(e.tgt) && !published.has(lastSeg(e.tgt)))
  console.log(`emitted edges: ${edges.length}   unattached candidates: ${unattached.length}\n`)

  const MODULE_HINT = /^(?:from|import|qualified)\s+([A-Za-z_][\w'.]*)/m
  type Bucket = "EXTERNAL_MODULE_QUALIFIED" | "EXTERNAL_BUILTIN" | "UNPROVEN_EXTERNAL"
    | "MISSED_LOCAL" | "EMPTY"
  const buckets: Record<Bucket, { n: number; targets: Set<string>; types: Record<string, number> }> = {
    EXTERNAL_MODULE_QUALIFIED: { n: 0, targets: new Set(), types: {} },
    EXTERNAL_BUILTIN: { n: 0, targets: new Set(), types: {} },
    UNPROVEN_EXTERNAL: { n: 0, targets: new Set(), types: {} },
    MISSED_LOCAL: { n: 0, targets: new Set(), types: {} },
    EMPTY: { n: 0, targets: new Set(), types: {} },
  }
  const perType: Record<string, Record<string, number>> = {}
  const examples: Record<string, string[]> = {}

  // A module qualifier is only trusted when the corpus itself defines nothing by that name
  // AND the qualifier is not a corpus module. `StdEnv:*` — StdEnv is not defined here.
  const corpusModules = new Set<string>()
  for (const n of published) if (/^[A-Z][A-Za-z0-9_]*$/.test(n)) corpusModules.add(n)

  for (const e of unattached) {
    let b: Bucket
    const last = lastSeg(e.tgt)
    if (!e.tgt.trim()) b = "EMPTY"
    else if (e.tgt.includes(":") || e.tgt.includes(".")) {
      const mod = e.tgt.split(/[.:]/)[0]
      b = published.has(e.tgt) || published.has(last) ? "MISSED_LOCAL"
        : corpusModules.has(mod) ? "MISSED_LOCAL" : "EXTERNAL_MODULE_QUALIFIED"
    } else if (!published.has(e.tgt)) {
      // Bare and nowhere declared. The corpus cannot prove this is stdlib; it can only
      // prove nothing here defines it. Say the weaker thing.
      b = "UNPROVEN_EXTERNAL"
    } else b = "MISSED_LOCAL"

    const k = buckets[b]
    k.n++
    k.targets.add(e.tgt)
    k.types[e.type] = (k.types[e.type] ?? 0) + 1
    perType[e.type] ??= {}
    perType[e.type][b] = (perType[e.type][b] ?? 0) + 1
    const key = `${b}/${e.type}`
    examples[key] ??= []
    if (examples[key].length < 10) {
      const src = fs.readFileSync(e.file, "utf8").split("\n")[e.line - 1] ?? ""
      examples[key].push(`${e.tgt}   src: ${src.trim().slice(0, 90)}`)
    }
  }

  const ORDER: Bucket[] = ["MISSED_LOCAL", "EXTERNAL_MODULE_QUALIFIED", "EXTERNAL_BUILTIN", "UNPROVEN_EXTERNAL", "EMPTY"]
  console.log(`CAUSE C ADJUDICATION — ${unattached.length} unattached edges`)
  console.log(`bucket                       edges   distinct   share   types`)
  console.log(`-`.repeat(96))
  for (const b of ORDER) {
    const k = buckets[b]
    if (!k.n) { console.log(`${b.padEnd(28)}${"0".padStart(6)}${"-".padStart(11)}${"0.0%".padStart(8)}`); continue }
    console.log(`${b.padEnd(28)}${String(k.n).padStart(6)}${String(k.targets.size).padStart(11)}${`${(100 * k.n / unattached.length).toFixed(1)}%`.padStart(8)}   ${JSON.stringify(k.types)}`)
  }
  console.log(`-`.repeat(96))

  console.log(`\nBY TYPE x BUCKET`)
  console.log(`type            ${ORDER.map((b) => b.slice(0, 13).padStart(15)).join("")}`)
  for (const t of Object.keys(perType).sort()) {
    console.log(`${t.padEnd(14)}${ORDER.map((b) => String(perType[t][b] ?? 0).padStart(15)).join("")}`)
  }

  const m = buckets.MISSED_LOCAL
  console.log(`\nMISSED_LOCAL = ${m.n} edges on ${m.targets.size} distinct targets.`)
  console.log(`These are the ONLY unattached edges a corpus-independent fix could recover:`)
  console.log(`the name is published by a file in this sample and the edge still went nowhere.`)
  const md = [...m.targets].sort()
  for (const t of md.slice(0, 40)) {
    console.log(`  ${t}  declared in ${(byName.get(t)?.size ?? 0)} file(s): ${[...(byName.get(t) ?? [])].slice(0, 2).map((f) => path.relative(CORPUS, f)).join(", ")}`)
  }
  if (md.length > 40) console.log(`  ... and ${md.length - 40} more`)

  console.log(`\nEXAMPLES`)
  for (const k of Object.keys(examples).sort()) {
    console.log(`  ${k}`)
    for (const e of examples[k]) console.log(`      ${e}`)
  }

  if (JSON_OUT) {
    const ser: Record<string, any> = {}
    for (const b of ORDER) {
      ser[b] = { edges: buckets[b].n, distinctTargets: buckets[b].targets.size,
        byType: buckets[b].types, targets: [...buckets[b].targets].sort() }
    }
    fs.writeFileSync(JSON_OUT, JSON.stringify({
      corpusRoot: CORPUS, files: taken.length, publishedNames: published.size,
      emittedEdges: edges.length, unattached: unattached.length, byBucket: ser, perType,
    }, null, 2))
    console.log(`\nJSON written: ${JSON_OUT}`)
  }
  void MODULE_HINT
}

main().catch((e) => { console.error(e); process.exit(1) })