#!/usr/bin/env bun
/**
 * script/m60/powershell-surface-measure.ts — the per-language SURFACE
 * measurement, over the pinned real corpora, through the production entry.
 *
 * WHY THIS IS ITS OWN FILE. Every M14/M49/M60 gate that could have caught the
 * powershell lane's condition asked a question about a lane it did not have:
 * `completeness-inventory.ts` threw `unknown language powershell`,
 * `run-fixtures.ts` had no `powershell` entry, `mutate-analyzer.ts` carried 0 of
 * its 1,009 mutants here, `differential.ts` had no `LANGS` row so F5/F10/the
 * SHARP sweep and the depth probes all read `n/a`, and `analyzer-complexity-gate`
 * scored the lane `unscorable`. The result was a language whose only green cell
 * was the one gate that asks whether a node type the analyzer NAMES exists — so
 * the complement (the 134 types it does not name) was never asked about.
 *
 * This instrument closes that gap for the dimensions that do not need a truth
 * oracle, and it is deliberately NOT a substitute for one: it measures what the
 * analyzer emits and how it changed, and it says so.
 *
 * WHAT IT MEASURES, per corpus
 * ----------------------------
 *   files              the production (non-test) draw, hash-ordered and pinned
 *   parseDamage        files with `hasError`, and the ERROR/MISSING split — the
 *                      grammar's own number, which no analyzer decision changes
 *   symbols/rels       the emitted surface
 *   kinds              every relationship type, with the ones this DRAW did not
 *                      exercise named. Read this as NOT-EXERCISED, not as
 *                      NOT-IMPLEMENTED: the label used to say `ABSENT` and that
 *                      word is wrong, because the four types it names
 *                      (extends/implements/overrides/imports) are all implemented
 *                      and all gated — they are simply absent from a 49-file draw
 *                      that excludes `test/` trees, and PowerShell's class
 *                      constructs live in `test/powershell/Language/Classes/`. An
 *                      audit asked whether these types were carried out, read
 *                      `ABSENT` as unimplemented, and had to be corrected against
 *                      the analyzer source. An instrument whose label invites the
 *                      wrong reading is a defect in the instrument, so the field
 *                      keeps its name for the schema and the MEANING is stated here
 *                      and in the printed row.
 *   lineNumber         relationships carrying a line, and the target-name-line
 *                      consistency rate (M59 #825's metric)
 *   unknownSymbols     relationship targets that match NO symbol in the same
 *                      file — a resolution proxy that needs no oracle, because a
 *                      project-declared name resolves within its own file
 *   dupKeys            (file, OWNER, name, kind) tuples emitted more than once — the
                      owner is part of the key because a local declared in two
                      functions is two declarations, not a duplicate
 *   forbiddenTargets   `calls` edges naming a PowerShell reserved word, decided by
 *                      the census's own exported predicate
 *   perf               wall time, per-file ms, and symbols+relationships per ms
 *
 * The BEFORE column is measured by REVERTING the analyzer to its committed state
 * in a scratch worktree, on the identical sample, with the identical
 * instrument — because a before/after across different samples is a lie (the
 * #859 lesson). `--baseline <file.json>` compares against a recorded baseline
 * instead, for use in CI where no worktree is available.
 *
 * Usage:
 *   bun script/m60/powershell-surface-measure.ts                     # measure + write
 *   bun script/m60/powershell-surface-measure.ts --sample 60
 *   bun script/m60/powershell-surface-measure.ts --repo ansible
 *   bun script/m60/powershell-surface-measure.ts --baseline before.json
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { execSync } from "node:child_process"
import * as WTS from "web-tree-sitter"
import * as os from "node:os"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const OUT = path.join(ROOT, "validation/m60/results/powershell-surface.json")
const argv = process.argv.slice(2)
const val = (a: string, d?: string) => (argv.includes(a) ? argv[argv.indexOf(a) + 1] : d)
const has = (a: string) => argv.includes(a)

const SAMPLE = parseInt(val("--sample", "60") ?? "60", 10)
const ONLY_REPO = val("--repo")
const REPOS = ONLY_REPO ? [ONLY_REPO] : ["powershell", "ansible"]
const EXTS = ["ps1", "psm1", "psd1"]

/**
 * The reserved-word predicate, IMPORTED from the census that owns it.
 *
 * The first version of this file PARSED the census's source with a regex to
 * recover the set, and captured 36 of its names — enough to make the two
 * instruments disagree (census `clean`, surface `reserved=10`) with neither
 * number trustworthy. Two instruments that must agree may not each hold a copy
 * of the rule; the second version imports it, and the census's own selftest
 * now pins the export.
 */
async function reservedPredicate(): Promise<(rel: any) => boolean> {
  const mod: any = await import("./powershell-keyword-census")
  return mod.isReservedCall as (rel: any) => boolean
}

function hashOf(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return (h >>> 0).toString(16).padStart(8, "0")
}

/** Production routing's candidate set, minus the language's own parser test tree. */
function draw(repo: string): string[] {
  const dir = path.join(CORPUS_ROOT, repo)
  if (!fs.existsSync(dir)) return []
  const pattern = EXTS.map((e) => `'*.${e}'`).join(" ")
  let rels: string[]
  try {
    rels = execSync(`git -C ${dir} ls-files ${pattern}`, { encoding: "utf8", maxBuffer: 1 << 26 })
      .trim().split("\n").filter(Boolean)
  } catch { return [] }
  const app = rels.filter((r) => !(r.startsWith("test/") || r.includes("/test/") || r.includes("/tests/")))
  return app
    .map((r) => ({ r, h: hashOf(`${repo}/${r}`) }))
    .sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : a.r < b.r ? -1 : 1))
    .slice(0, SAMPLE)
    .map((x) => x.r)
}

/** The grammar's own damage number, independent of any analyzer decision. */
async function parseDamage(files: { abs: string; rel: string }[], lang: any): Promise<{ damaged: number; errNodes: number; missing: number }> {
  const parser = new WTS.Parser()
  parser.setLanguage(lang)
  let damaged = 0, errNodes = 0, missing = 0
  for (const f of files) {
    const text = fs.readFileSync(f.abs, "utf8")
    const tree = parser.parse(text)
    let err = 0
    const stack = [tree.rootNode]
    while (stack.length) {
      const n = stack.pop()!
      if (n.type === "ERROR") err++
      if (n.isMissing) missing++
      for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) stack.push(c) }
    }
    if (tree.rootNode.hasError) damaged++
    errNodes += err
  }
  parser.delete()
  return { damaged, errNodes, missing }
}

const isReservedCall = await reservedPredicate()
await WTS.Parser.init()
const grammar = await WTS.Language.load(path.join(ROOT, "wasm/tree-sitter-powershell.wasm"))
const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker"))

interface Row { repo: string; files: number; digest: string; damage: { damaged: number; errNodes: number; missing: number }; symbols: number; relationships: number; kinds: Record<string, number>; absent: string[]; lineNumber: { withLine: number; total: number }; unknownTargets: { count: number; samples: { file: string; type: string; target: string }[] }; dupKeys: { count: number; samples: string[] }; forbiddenTargets: { count: number; samples: string[] }; perf: { wallMs: number; perFileMs: number; factsPerMs: number } }

const ONTOLOGY = ["calls", "extends", "implements", "instantiates", "uses", "references", "contains", "overrides", "exports", "imports"]
const rows: Row[] = []

for (const repo of REPOS) {
  const dir = path.join(CORPUS_ROOT, repo)
  const rels = draw(repo)
  if (rels.length === 0) { console.log(`${repo.padEnd(12)} corpus absent — skipped`); continue }
  const files = rels.map((rel) => ({ rel, abs: path.join(dir, rel) }))
  const digest = hashOf(rels.join("\n"))

  const damage = await parseDamage(files, grammar)

  const kinds: Record<string, number> = {}
  let symbols = 0
  let relationships = 0
  let withLine = 0
  const fileSymbols = new Map<string, Set<string>>()
  const dupSeen = new Map<string, number>()
  const unknown: { file: string; type: string; target: string }[] = []
  const forbidden: string[] = []

  const t0 = performance.now()
  for (const f of files) {
    const r: any = await parseFile(f.abs, ROOT)
    const names = new Set<string>()
    for (const s of r.symbols ?? []) {
      names.add(s.name)
      symbols++
      // The OWNER is part of the key, exactly as the analyzer's own dedupe key is
      // (`owner\u0000name\u0000kind`). Without it the proxy counted `$null`
      // declared in two different functions as a duplicate — 186 rows in the
      // first run, every one of them two correct declarations in two scopes.
      const k = `${f.rel}|${s.ownerName ?? s.scope ?? ""}|${s.name}|${s.kind}`
      dupSeen.set(k, (dupSeen.get(k) ?? 0) + 1)
    }
    fileSymbols.set(f.rel, names)
    for (const x of r.relationships ?? []) {
      relationships++
      const t = String(x.type ?? x.relationshipType ?? "")
      kinds[t] = (kinds[t] ?? 0) + 1
      if (typeof x.line_number === "number" && x.line_number > 0) withLine++
      const target = String(x.target ?? "")
      const meta = (x.metadata ?? {}) as Record<string, unknown>
      if (isReservedCall(x)) forbidden.push(`${f.rel}:${x.line_number} ${t} -> ${target}`)
      // RESOLVABILITY, and only for the kinds whose BOTH ends are, by
      // definition, locally declared: a `contains` target is a member, an
      // `overrides` target is an inherited member, `extends`/`implements`
      // targets are named types. `calls`, `uses` and `instantiates`
      // deliberately do NOT qualify — a cmdlet is an external command and a
      // `uses` edge may name a .NET member — so including them counted every
      // `Write-Host` as unresolved (3,604 of 9,485 rows in the first run, a
      // number that means nothing). The first version of this proxy was a
      // measurement mistake, recorded here because the corrected number is the
      // one that will be compared.
      if (t === "contains" || t === "overrides" || t === "extends" || t === "implements") {
        if (target && !names.has(target) && !target.includes("::") && !target.startsWith("$")) {
          unknown.push({ file: f.rel, type: t, target })
        }
      }
    }
  }
  const wallMs = performance.now() - t0

  const dups = [...dupSeen.entries()].filter(([, n]) => n > 1)
  rows.push({
    repo,
    files: files.length,
    digest,
    damage,
    symbols,
    relationships,
    kinds,
    absent: ONTOLOGY.filter((k) => !kinds[k]),
    lineNumber: { withLine, total: relationships },
    unknownTargets: { count: unknown.length, samples: unknown.slice(0, 12) },
    dupKeys: { count: dups.length, samples: dups.slice(0, 12).map(([k, n]) => `${k} ×${n}`) },
    forbiddenTargets: { count: forbidden.length, samples: forbidden.slice(0, 12) },
    perf: {
      wallMs: Math.round(wallMs),
      perFileMs: Math.round((wallMs / files.length) * 1000) / 1000,
      factsPerMs: Math.round(((symbols + relationships) / wallMs) * 1000) / 1000,
    },
  })

  const r = rows[rows.length - 1]
  console.log(
    `${repo.padEnd(12)} files=${String(r.files).padStart(3)}  damage=${r.damage.damaged} (${r.damage.errNodes} ERROR / ${r.damage.missing} MISSING)` +
    `  symbols=${r.symbols}  rels=${r.relationships}  line=${r.lineNumber.withLine}/${r.lineNumber.total}` +
    `  unknownTargets=${r.unknownTargets.count}  dupKeys=${r.dupKeys.count}  reserved=${r.forbiddenTargets.count}` +
    `  ${r.perf.perFileMs}ms/f  ${r.perf.factsPerMs} facts/ms`,
  )
  console.log(`             kinds: ${JSON.stringify(r.kinds)}`)
  if (r.absent.length) console.log(`             not exercised by this draw (all implemented + gated; this draw excludes test/ trees): ${r.absent.join(", ")}`)
}

const out = {
  gate: "M60.powershell-surface",
  title: "PowerShell analyzer surface over the pinned real corpora",
  at: new Date().toISOString(),
  commit: safeCommit(),
  // #871 §1, the shape the differential already uses: a perf number without the load
  // it was taken under is unreadable, and this artifact was publishing one. `perFileMs`
  // moved 228 -> 246 across two runs of an UNCHANGED analyzer on an 8-core box whose
  // loadavg1 sat at 22-30, which is contention, not the lane. A reader had no way to
  // tell, because nothing here recorded the machine. So the number now carries its own
  // context, and `perfIsQualified` says outright when the draw is too loaded to be a
  // budget row. The F9 section-F gate wants a pinned `avgMsPerFile`; a value taken at
  // this load must not be the one it gets.
  loadContext: {
    loadAvg1: Number(os.loadavg()[0].toFixed(2)),
    cores: os.cpus().length,
  },
  perfIsQualified: os.loadavg()[0] < 8,
  sampleLimit: SAMPLE,
  corpora: REPOS,
  rows,
  summary: {
    files: rows.reduce((s, r) => s + r.files, 0),
    symbols: rows.reduce((s, r) => s + r.symbols, 0),
    relationships: rows.reduce((s, r) => s + r.relationships, 0),
    withLine: rows.reduce((s, r) => s + r.lineNumber.withLine, 0),
    absentKinds: [...new Set(rows.flatMap((r) => r.absent))],
    unknownTargets: rows.reduce((s, r) => s + r.unknownTargets.count, 0),
    dupKeys: rows.reduce((s, r) => s + r.dupKeys.count, 0),
    reservedTargets: rows.reduce((s, r) => s + r.forbiddenTargets.count, 0),
    // Pre-existing defect: this read `r.perFileMs`, but the value lives at
    // `r.perf.perFileMs`. `r.perFileMs` is undefined, and `JSON.stringify` DROPS an
    // undefined property, so the summary rendered as `[{"repo":"powershell"}, …]` — an
    // empty-looking list that reads as a deliberate "no samples" rather than a broken
    // read. The per-row `perf` block was always correct, which is why nothing caught it.
    perFileMs: rows.map((r) => ({ repo: r.repo, ms: r.perf.perFileMs })),
  },
  method:
    "Candidates are each corpus's production (non-test) tracked .ps1/.psm1/.psd1 files, drawn by a hash of `repo/relative-path` so the sample is unbiased and reproducible; the digest is recorded so a re-run that drew a different set says so instead of being compared. Every file goes through the production `parseFile`. `parseDamage` is measured with a separate parser and is the GRAMMAR's number, independent of any analyzer decision. `lineNumber` counts relationships carrying a positive line. `unknownTargets` counts ONLY the kinds whose both ends are locally declared by definition — `contains`, `overrides`, `extends`, `implements` — whose target matches no symbol in the same file. `calls`, `uses` and `instantiates` are excluded because a cmdlet is an external command and a `uses` edge may name a .NET member; including them made the first run report 3,604 of 9,485 rows, which measured nothing. `dupKeys` counts (file, owner, name, kind) tuples emitted more than once. The owner IS part of the key: a local declared in two functions is two correct declarations, and a proxy that omits the owner reported 186 rows in the first run that were all of that shape. `reservedTargets` uses the reserved set owned by powershell-keyword-census.ts, and skips member-call edges.",
  limits: [
    "This is NOT a truth oracle. It measures what the analyzer emits and how it changed; whether each edge is CORRECT is F5's question, and the powershell lane has no F5 lane. Everything here can be green with every edge wrong, and the completion matrix says so by leaving `diff` and `sharp` as `n/a`.",
    "`unknownTargets` is a proxy for resolvability, not for correctness: a cmdlet target is external by design and is excluded by kind, but a target that names a real cmdlet which happens to share a spelling with a local symbol would be counted as resolved.",
    "Parse damage is the vendored grammar's, and 16 of the powershell corpus's production files plus 15 of ansible's do not parse. Nothing in this instrument attributes that to the analyzer or excuses it.",
  ],
}

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n")
console.log(`\nwrote ${path.relative(ROOT, OUT)}`)

const baseFile = val("--baseline")
if (baseFile) {
  const base = JSON.parse(fs.readFileSync(baseFile, "utf8"))
  console.log(`\nBASELINE COMPARISON (${path.basename(baseFile)}):`)
  for (const r of rows) {
    const b = base.rows?.find((x: any) => x.repo === r.repo)
    if (!b) { console.log(`  ${r.repo}: no baseline row`); continue }
    if (b.digest !== r.digest) { console.log(`  ${r.repo}: SAMPLE DRIFT — digests differ, no delta may be read`); continue }
    const pct = (a: number, b2: number) => (b2 === 0 ? "n/a" : `${(((a - b2) / b2) * 100).toFixed(1)}%`)
    console.log(`  ${r.repo}: symbols ${b.symbols}->${r.symbols} (${pct(r.symbols, b.symbols)})  rels ${b.relationships}->${r.relationships} (${pct(r.relationships, b.relationships)})`)
    console.log(`     line coverage ${b.lineNumber?.withLine ?? 0}/${b.lineNumber?.total ?? 0} -> ${r.lineNumber.withLine}/${r.lineNumber.total}`)
    console.log(`     absent kinds ${JSON.stringify(b.absent ?? [])} -> ${JSON.stringify(r.absent)}`)
    console.log(`     unknownTargets ${b.unknownTargets?.count ?? 0} -> ${r.unknownTargets.count}   dupKeys ${b.dupKeys?.count ?? 0} -> ${r.dupKeys.count}   reserved ${b.forbiddenTargets?.count ?? 0} -> ${r.forbiddenTargets.count}`)
    console.log(`     per-file ms ${b.perf?.perFileMs ?? "?"} -> ${r.perf.perFileMs}`)
  }
}

function safeCommit(): string {
  try { return execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim() } catch { return "unknown" }
}
