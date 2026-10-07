/**
 * VB FIRING CHECK — a lane-local mirror of `script/m14/firing-check-v2.mjs` that
 * measures THIS WORKTREE.
 *
 * ## Why this file exists rather than the shared script
 *
 * `script/m14/firing-check-v2.mjs:36` hardcodes
 *
 *     const REPO = "$HOME/backbencher-brain"
 *
 * and every module it loads is resolved against that constant, so the instrument
 * ALWAYS measures the main checkout and can never measure a lane worktree. That is
 * not a cosmetic limit for this workstream: a lane's whole job is to change its
 * analyzer and then report the number the change produced, and the only supported
 * way to get that number out of the shared instrument is to merge to main — which
 * the branch layout forbids ("Nothing merges to main from this workstream"). Two
 * consequences, both measured on this lane:
 *
 *   - the documented command for this lane
 *     `NFILES=200 bun script/m14/firing-check-v2.mjs VERIFY_VB10`
 *     exits 2 with "no lane matches", because `resolveLane` matches a token
 *     against a lane key as a PREFIX (line 195) and the whole name against a key as
 *     a PREFIX (line 202), while the programme's lane naming `VERIFY_<LANG><N>`
 *     fits neither: the language token carries its digit (`VB10`, not `VB`) and
 *     `VERIFY` is a prefix of the name rather than of any key;
 *   - passing the bare key `VB` works, and gives the MAIN checkout's number. Before
 *     this lane's change, that number is 7/10. After the change, this file is what
 *     reports the new one.
 *
 * Both are defects in `script/m14/**`, which the master owns, and neither is edited
 * here.
 *
 * ## What is deliberately IDENTICAL to firing-check-v2
 *
 * The measurement is only comparable if the instrument is the same, so every one
 * of these is copied rather than improved:
 *
 *   - the production vocabulary is derived from `engine.ts`'s `ASTEngine.RelationshipType`
 *     (the enum the analyzers reference), and `types.ts`'s vocabulary is printed
 *     alongside so the divergence is reported rather than hidden;
 *   - files are sampled by a code-bearing SIGNAL per extension, and `BB_BLIND=1`
 *     restores the blind walk so the sampling defect can be re-measured;
 *   - the two channels are reported SEPARATELY — relationships from
 *     `res.relationships`, imports from `res.imports` — because `ParseResult`
 *     carries them apart (src/ast/types.ts:206-216) and `parallel-indexer` writes
 *     imports to the `brain_import` TABLE, never to `brain_relationship` rows;
 *   - the sample population is PRINTED with every count, per the honesty
 *     contract's "an instrument must declare the population it covered" rule, and
 *     here it is DERIVED by walking the corpus directory rather than by taking the
 *     first N in walk order, which is the defect that moved Ruby's score by 8
 *     points at NFILES=25.
 *
 * ## No regex in the instrumentation
 *
 * `firing-check-v2.mjs` contains regexes; those are the shared script's business
 * and are not reproduced here. This file uses `endsWith` and `indexOf`.
 */

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"

const REPO = resolve(import.meta.dir, "../..")
const CORPUS = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const NFILES = Number(process.env.NFILES ?? 200)
const BLIND = process.env.BB_BLIND === "1"

const LANES: Record<string, [string, string, string, string[]]> = {
  VB: ["vb", "real-vb-analyzer", "roslyn-vb", [".vb"]],
}

/** The same code-bearing signals firing-check-v2 uses for `.vb`, copied verbatim. */
const SIGNAL_VB = ["Function ", "Class ", "Sub ", "Dim ", "Public "]

function hasSuffix(s: string, suffix: string): boolean {
  return s.length >= suffix.length && s.lastIndexOf(suffix) === s.length - suffix.length
}

function derive(dir: string, exts: string[], want: number): { files: string[]; scanned: number } {
  const sigs = BLIND ? null : SIGNAL_VB
  const out: string[] = []
  let scanned = 0
  const walk = (d: string, depth: number): void => {
    if (out.length >= want || depth > 20) return
    let ents: import("node:fs").Dirent[]
    try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (out.length >= want) return
      if (e.name === "node_modules" || e.name === ".git") continue
      const p = join(d, e.name)
      if (e.isDirectory()) { walk(p, depth + 1); continue }
      if (!exts.some((x) => hasSuffix(e.name, x))) continue
      scanned++
      try {
        if (statSync(p).size >= 400_000) continue
        if (sigs) {
          const src = readFileSync(p, "utf8")
          let hit = false
          for (const s of sigs) if (src.includes(s)) { hit = true; break }
          if (!hit) continue
        }
        out.push(p)
      } catch {}
    }
  }
  walk(dir, 0)
  return { files: out, scanned }
}

const { getParser, ASTEngine } = await import(join(REPO, "src/ast/engine.ts"))
const PROD = [...new Set(Object.values((ASTEngine as any).RelationshipType))]
let ALL: string[] = []
try {
  const typesMod = await import(join(REPO, "src/ast/types.ts"))
  ALL = [...new Set(Object.values((typesMod as any).RelationshipType))]
} catch {}

console.log("VB FIRING CHECK — lane-local mirror of firing-check-v2, repo root resolved from this file")
console.log(`repo root (THIS WORKTREE): ${REPO}`)
console.log(`corpus: ${CORPUS}   NFILES=${NFILES}   sampling=${BLIND ? "BLIND (firing-check-v2 defect 1 active)" : "code-bearing"}`)
console.log(`production vocabulary (${PROD.length}): ${PROD.join(" ")}`)
if (ALL.length > 0) {
  console.log(`types.ts vocabulary (${ALL.length}): ${ALL.join(" ")}`)
  console.log(`in types.ts but NOT produced: ${ALL.filter((t) => !PROD.includes(t)).join(" ") || "(none)"}`)
  console.log(`produced but NOT in types.ts: ${PROD.filter((t) => !ALL.includes(t)).join(" ") || "(none)"}`)
}
console.log("")

const laneKey = process.argv[2] ?? "VB"
const spec = LANES[laneKey]
if (!spec) {
  console.error(`no such lane: ${laneKey}. Known: ${Object.keys(LANES).join(" ")}`)
  process.exit(2)
}
const [lang, mod, corpusDir, exts] = spec
const dir = join(CORPUS, corpusDir)
const { files, scanned } = derive(dir, exts, NFILES)
console.log(`population DERIVED by directory walk under ${corpusDir}: ${scanned} ${exts[0]} files offered, ${files.length} admitted by the code-bearing filter`)
if (files.length === 0) { console.error("NO CORPUS — refusing to report a score over zero files"); process.exit(2) }

const { default: Cls } = await import(join(REPO, `src/ast/${mod}.ts`))

const relTally = new Map<string, number>()
let imports = 0
let parsed = 0
let filesWithImports = 0
let failed = 0
const seenFiles: string[] = []
for (const f of files) {
  try {
    const content = readFileSync(f, "utf8")
    const parser = await getParser(lang)
    const pr = await parser.parse(content, f)
    const res: any = new (Cls as any)().analyze(pr.rootNode, content, f)
    parsed++
    const imps = res.imports ?? []
    imports += imps.length
    if (imps.length > 0) filesWithImports++
    if (seenFiles.length < 3) seenFiles.push(f.slice(dir.length + 1))
    for (const r of res.relationships ?? []) {
      const t = r.relationshipType ?? r.type
      if (t) relTally.set(t, (relTally.get(t) ?? 0) + 1)
    }
  } catch { failed++ }
}

const fired = PROD.filter((t) => relTally.has(t))
const silent = PROD.filter((t) => !relTally.has(t))
const offEnum = [...relTally.keys()].filter((t) => !PROD.includes(t))

console.log(`parsed ${parsed}/${files.length}   failed ${failed}`)
console.log(`imports[] (the SEPARATE channel): ${imports} in ${filesWithImports} files`)
console.log("")
console.log(`${String(fired.length).padStart(2)}/10  ${laneKey}`)
console.log(`  fired:  ${fired.join(" ") || "(none)"}`)
if (silent.length) console.log(`  silent: ${silent.join(" ")}`)
if (offEnum.length) console.log(`  OFF-ENUM (not a production relationship type): ${offEnum.join(" ")}`)
console.log(`  e.g. ${seenFiles.join("  ")}`)
const top = [...relTally.entries()].sort((a, b) => b[1] - a[1])
console.log(`  counts: ${top.map(([t, n]) => `${t}:${n}`).join("  ")}`)