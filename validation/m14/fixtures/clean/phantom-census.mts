#!/usr/bin/env bun
/**
 * CLEAN lane — THE PHANTOM-DECLARATION CENSUS.
 *
 * ## The question
 *
 * `real-clean-analyzer.ts` publishes, for every `instance` declaration, a CONTAINER symbol named
 * after the instance's TARGET TYPE — so `instance UMaybe Int where …` publishes a `class`-kind
 * symbol called `Int`, and `instance UList {.a} where …` publishes one called `.a`. Those symbols
 * are DECLARATIONS of a name in a file that declares no such type: the file only says that the
 * type satisfies a class.
 *
 * A declaration count is what the incoming gate's clause 1 is computed from, so a phantom
 * declaration does not merely add a row — it turns every `references` edge naming `Int` in the
 * same PROJECT from RESOLVED into AMBIGUOUS, and it does so for exactly the names Clean uses most.
 * This probe measures that, because a fix has to be aimed at a number rather than at a suspicion.
 *
 * ## What it reports
 *
 *  1. the container symbols themselves: how many, under which names, in how many files, and how
 *     many of them carry NO start line (a symbol the store cannot insert at all);
 *  2. per residual edge (gate `--dump` rows, read from a file), how many of the target's
 *     declarations in the same project are PHANTOM — and therefore how much of the lane's
 *     ambiguous/unresolved residue is self-inflicted rather than a property of Clean or of the
 *     corpus;
 *  3. the three-way split of the residue that a fix can reach: `onlyPhantom` (the name is declared
 *     ONLY by containers — every edge naming it is unresolvable), `oneRealPlusPhantom` (removing
 *     the phantoms RESOLVES the edge), `twins` (two or more genuine declarations remain — the
 *     `.dcl`/`.icl` half-pair class, which no per-file analyzer can split).
 *
 * ## What it does NOT claim
 *
 * It does not decide whether the container symbol should exist, only what it COSTS. It does not
 * judge an edge's intent. And it reads the residue from the gate's own dump rather than
 * re-classifying: the gate is the arbiter, this probe only asks what is inside its number.
 *
 * Usage:
 *   bun validation/m14/fixtures/clean/phantom-census.mts [--dump=<gate --dump file>] [--json=<out>] [--limit=N]
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { execFileSync } from "node:child_process"
import { parseFile } from "../../../../src/ast/pool-worker"

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const CORPUS = arg("corpus") ?? process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const DUMP = arg("dump") ?? "validation/m14/measurements/clean/gate-clean-dump-2026-10-28.txt"
const JSON_OUT = arg("json")
const LIMIT = Number(arg("limit") ?? "0")
const MAX_BYTES = 1024 * 1024

type FileRec = { abs: string; repo: string; rel: string }
const files: FileRec[] = []
for (const entry of fs.readdirSync(CORPUS)) {
  const repoRoot = path.join(CORPUS, entry)
  try { if (!fs.statSync(repoRoot).isDirectory()) continue } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", repoRoot, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 1 << 28 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    if (!/\.(icl|dcl)$/.test(rel)) continue
    const abs = path.join(repoRoot, rel)
    try { if (fs.statSync(abs).size > MAX_BYTES) continue } catch { continue }
    files.push({ abs, repo: repoRoot, rel })
  }
}
const population = LIMIT > 0 ? files.slice(0, LIMIT) : files

/**
 * A CONTAINER is a symbol the analyzer invented to OWN an instance's members.
 *
 * IT IS RECOGNISED FROM THE SYMBOL'S OWN SOURCE SNIPPET, not from a name shape and not from the
 * analyzer's metadata. The snippet of such a symbol IS the `instance` declaration (`instance Maybe
 * ? a where { … }`), because `processInstance` ranges the container over the whole declaration — so
 * "the declaration this symbol was minted from begins with `instance`" is a fact about the run, not
 * a guess about the language. This is deliberately NOT a name test: the first version of this probe
 * matched only bracket-and-marker names (`.a`, `[a]`, `?`) and therefore MISSED the containers named
 * after an ordinary type (`Int`, `Char`, `File`, `Maybe`), which are the ones that collide with real
 * declarations. A name test could not have found them at all.
 *
 * AND IT IS DELIBERATELY INDEPENDENT OF THE SYMBOL'S KIND, which is what makes the same instrument
 * valid on both sides of the naming fix: the detector reads the DECLARATION, so it finds the
 * container whether it is spelled `Int` (before) or `Int::instance` (after) and whatever kind it
 * carries. The `phantom` flag is then the question the fix answers — a container whose name is NOT
 * namespaced under its target is a declaration of that bare name, which is the phantom.
 *
 * The analyzer DOES stamp `metadata.isTypeClassInstance`, and the pipeline drops `metadata` from
 * every symbol it flattens (`parseFile` returns no `metadata` field at all — measured on
 * `_SystemStrictMaybes.icl`), so the stamp is unavailable here and is reported as such.
 */
const INSTANCE_NAME_SUFFIX = "::instance"
type Sym = {
  name: string
  kind: string
  file: string
  repo: string
  line: number | null
  /** the declaration this symbol was minted from begins with `instance` */
  container: boolean
  /** …and its name is namespaced under the target (`<target>::instance`) rather than being it */
  namespaced: boolean
  /** the snippet starts with `instance` whether or not this is a container — the wider net, reported */
  instanceMinted: boolean
  /** this file also declares a non-container symbol of the same name */
  nameDeclaredInFile: boolean
  qname: string
  snippet: string
}

const symbols: Sym[] = []
const perFileSymbols = new Map<string, Sym[]>()
let parsed = 0
let failed = 0
for (const f of population) {
  let r: any
  try { r = await parseFile(f.abs, f.repo, { projectRoot: f.repo } as any) } catch { failed++; continue }
  if (!r) { failed++; continue }
  parsed++
  const list: Sym[] = []
  for (const s of r.symbols ?? []) {
    const name = String(s?.name ?? "")
    if (!name) continue
    const snippet = String(s?.snippet ?? "").trimStart()
    const kind = String(s?.kind ?? "")
    const sym: Sym = {
      name,
      kind,
      file: f.abs,
      repo: f.repo,
      line: Number(s?.startLine ?? s?.range?.startLine ?? s?.line ?? 0) || null,
      // THE CONTAINER SHAPE, PER EPOCH: a symbol minted from an `instance` declaration whose kind is
      // the one `processInstance` gives it. The kind gate is not decoration — a snippet prefix test
      // alone also catches CLEAN IDENTIFIERS THAT BEGIN WITH `instance` (the corpus function
      // `instance_or_derive_definition`) and instance MEMBERS whose range happens to start on the
      // instance's line; those are counted separately below, because they are a different defect.
      container: (kind === "impl" || kind === "class" || kind === "interface") && snippet.startsWith("instance"),
      namespaced: (kind === "impl" || kind === "class" || kind === "interface") && snippet.startsWith("instance") && name.endsWith(INSTANCE_NAME_SUFFIX),
      instanceMinted: snippet.startsWith("instance"),
      nameDeclaredInFile: false,
      qname: String(s?.qualifiedName ?? ""),
      snippet,
    }
    list.push(sym)
    symbols.push(sym)
  }
  // A container is a PHANTOM DECLARATION when the same file also declares the name for real.
  const realNames = new Set(list.filter((s) => !s.container).map((s) => s.name))
  for (const s of list) if (s.container && realNames.has(s.name)) s.nameDeclaredInFile = true
  perFileSymbols.set(f.abs, list)
}

// ---------------------------------------------------------------------------
// 1 · the containers
// ---------------------------------------------------------------------------
const containers = symbols.filter((s) => s.container)
// THE PHANTOM DECLARATIONS. A container that is NOT namespaced under its target publishes the bare
// name of the type it implements, so it counts as a DECLARATION of that name in the project's name
// space. That — not the container itself — is what turns other files' `references` rows ambiguous.
const bareNamed = containers.filter((s) => !s.namespaced)
const namespacedContainers = containers.filter((s) => s.namespaced)
const containerNames = new Map<string, number>()
for (const s of bareNamed) containerNames.set(s.name, (containerNames.get(s.name) ?? 0) + 1)
const containerFiles = new Set(containers.map((s) => s.file))
const shadowing = bareNamed.filter((s) => s.nameDeclaredInFile).length
const nonIdentifier = bareNamed.filter((s) => !/^[A-Za-z_][A-Za-z0-9_']*$/.test(s.name)).length

// ---------------------------------------------------------------------------
// 2 · the residue, read from the gate's own dump
// ---------------------------------------------------------------------------
type Row = { label: string; outcome: string; tgt: string; file: string; claim: string }
const rows: Row[] = []
if (fs.existsSync(DUMP)) {
  for (const line of fs.readFileSync(DUMP, "utf8").split("\n")) {
    if (!line.startsWith("DUMP\t")) continue
    const p = line.split("\t")
    const outcome = p[2] ?? ""
    if (outcome === "externalVerified" || outcome === "resolved" || outcome === "bindingVerified") continue
    rows.push({ label: p[1] ?? "", outcome, tgt: p[3] ?? "", file: p[4] ?? "", claim: p[5] ?? "" })
  }
}

/** project -> key -> { declarations, of which phantom } */
const phantomSet = new Set(bareNamed)
const decls = new Map<string, Map<string, { real: number; phantom: number }>>()
for (const s of symbols) {
  let m = decls.get(s.repo)
  if (!m) decls.set(s.repo, (m = new Map()))
  const isPhantom = phantomSet.has(s)
  for (const key of s.qname && s.qname !== s.name ? [s.name, s.qname] : [s.name]) {
    const rec = m.get(key) ?? { real: 0, phantom: 0 }
    if (isPhantom) rec.phantom++
    else rec.real++
    m.set(key, rec)
  }
}

const repoOf = (abs: string): string => {
  const i = abs.indexOf("/repositories/")
  if (i < 0) return ""
  const rest = abs.slice(i + "/repositories/".length)
  const seg = rest.indexOf("/")
  return seg < 0 ? "" : path.join(abs.slice(0, i + "/repositories/".length), rest.slice(0, seg))
}

const class3 = { onlyPhantom: 0, oneRealPlusPhantom: 0, twins: 0, clean: 0, notFound: 0 }
const byLabel = new Map<string, typeof class3>()
const examples = new Map<string, string[]>()
for (const r of rows) {
  const repo = repoOf(r.file)
  const rec = decls.get(repo)?.get(r.tgt)
  const bucket = byLabel.get(r.label) ?? { onlyPhantom: 0, oneRealPlusPhantom: 0, twins: 0, clean: 0, notFound: 0 }
  let verdict: keyof typeof class3
  if (!rec) verdict = "notFound"
  else if (rec.real === 0 && rec.phantom > 0) verdict = "onlyPhantom"
  else if (rec.real === 1 && rec.phantom > 0) verdict = "oneRealPlusPhantom"
  else if (rec.real >= 2) verdict = "twins"
  else verdict = "clean"
  class3[verdict]++
  bucket[verdict]++
  byLabel.set(r.label, bucket)
  if (verdict === "oneRealPlusPhantom" || verdict === "onlyPhantom") {
    const list = examples.get(`${r.label}|${verdict}`) ?? []
    if (list.length < 6) list.push(`${r.tgt} @ ${r.file.replace(CORPUS + "/", "")}`)
    examples.set(`${r.label}|${verdict}`, list)
  }
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------
const pct = (n: number, d: number): string => `${((100 * n) / Math.max(1, d)).toFixed(1)}%`
console.log(`population: ${parsed} parsed of ${population.length} sampled (failed ${failed})`)
console.log(`symbols: ${symbols.length}`)
console.log(`containers: ${containers.length} in ${containerFiles.size} files (no start line: ${containers.filter((s) => s.line === null).length})`)
console.log(`  NAMESPACED under their target ('<target>::instance'): ${namespacedContainers.length}`)
console.log(`  BARE-NAMED (a declaration of the target type — THE PHANTOM): ${bareNamed.length}`)
console.log(`  of which shadow a name the SAME file declares for real: ${shadowing}`)
console.log(`  of which are not an identifier at all ('.a', '[a]', '?'): ${nonIdentifier}`)
// THE WIDER NET, reported rather than judged: symbols minted from an `instance` declaration that are
// NOT containers. Measured on the 312-file population: 8, of which 3 carry the instance's TARGET as
// their NAME (`Int`, `Real`, `a` in clean-stdlib/_SystemArray.icl, all three `code { … }` bodies) and
// the rest are members whose RANGE starts on the instance line. A different defect from the phantom
// declaration — it does not invent a declaration of anyone's type — and it is left standing here.
const nonContainerInstanceMinted = symbols.filter((s) => s.instanceMinted && !s.container)
console.log(`instance-minted symbols that are NOT containers: ${nonContainerInstanceMinted.length}` + (nonContainerInstanceMinted.length ? ` (${[...new Set(nonContainerInstanceMinted.map((s) => s.name))].sort().join(" · ")})` : ""))
console.log(`phantom container names: ${containerNames.size}`)
const top = [...containerNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)
console.log(`top phantom container names: ${top.map(([n, c]) => `${n} ${c}`).join(" · ")}`)
console.log("")
console.log(`residual rows read from ${DUMP}: ${rows.length}`)
console.log("")
console.log("by label:")
for (const [label, b] of [...byLabel.entries()].sort((a, b) => (b[1].onlyPhantom + b[1].oneRealPlusPhantom + b[1].twins) - (a[1].onlyPhantom + a[1].oneRealPlusPhantom + a[1].twins))) {
  const total = b.onlyPhantom + b.oneRealPlusPhantom + b.twins + b.clean + b.notFound
  console.log(
    `  ${label.padEnd(12)} ${String(total).padStart(5)}  onlyPhantom ${String(b.onlyPhantom).padStart(4)}  ` +
    `oneReal+Phantom ${String(b.oneRealPlusPhantom).padStart(4)}  twins ${String(b.twins).padStart(4)}  ` +
    `clean ${String(b.clean).padStart(3)}  notFound ${String(b.notFound).padStart(4)}`,
  )
}
console.log("")
console.log("TOTAL: " + JSON.stringify(class3))
const totals = rows.length
console.log(
  `  reachable by deleting phantom declarations alone: ${class3.onlyPhantom} (onlyPhantom) + ` +
  `${class3.oneRealPlusPhantom} (oneReal+Phantom) = ${class3.onlyPhantom + class3.oneRealPlusPhantom} ` +
  `of ${totals} (${pct(class3.onlyPhantom + class3.oneRealPlusPhantom, totals)})`,
)
for (const [k, list] of examples) console.log(`  e.g. ${k}: ${list.join(" | ")}`)

if (JSON_OUT) {
  fs.writeFileSync(JSON_OUT, JSON.stringify({
    measuredAt: new Date().toISOString(),
    population: { parsed, sampled: population.length, failed },
    symbols: symbols.length,
    containers: {
      total: containers.length,
      files: containerFiles.size,
      namespaced: namespacedContainers.length,
      bareNamed: bareNamed.length,
      instanceMintedNonContainer: nonContainerInstanceMinted.map((s) => `${s.name} @ ${path.relative(CORPUS, s.file)}:${s.line}`),
      shadowing,
      nonIdentifier,
      names: Object.fromEntries(top),
    },
    residual: { rows: rows.length, class3, byLabel: Object.fromEntries(byLabel) },
  }, null, 2) + "\n")
  console.log(`\nwrote ${JSON_OUT}`)
}
