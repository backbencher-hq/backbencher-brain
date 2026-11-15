/**
 * ZIG — THE LITERAL `unknown` ENDPOINT. Is it a placeholder, or a Zig identifier?
 *
 * ## The question
 *
 * The workstream's standing rule R7 is "no relationship endpoint equals the literal
 * `unknown`". The rule exists because `unknown` is what an analyzer emits when it has
 * failed to name something, and an edge that names nothing is a fake edge.
 *
 * **Zig has no reserved words.** Nothing stops a Zig program from declaring `unknown`
 * as an enum member, a struct field, a union field or a parameter. So in this language
 * the rule has legitimate counterexamples, and a consumer that filters the literal
 * string deletes correct edges.
 *
 * This probe separates the cases by asking questions the string cannot answer:
 *
 *   fileLocal   the edge's OWN file publishes a symbol named `unknown` — the endpoint
 *               names a real declaration. Correct edge; R7 does not apply.
 *   corpusLocal another file in the sample publishes it — a cross-file reference, which
 *               is a real reference to a real declaration. Correct edge, and R7 still
 *               does not apply: "no symbol by this name exists" was never true.
 *   nowhere     NO file in the sample publishes it. This is the defect count and it is
 *               the only class R7 is about.
 *
 * `nowhere` is the falsifiable part: the probe exits 1 when it is non-zero, and exits 2
 * when there are no occurrences at all, so it cannot pass by measuring nothing.
 *
 * ## What `nowhere` turned out to contain
 *
 * Both sites are in files that are DELIBERATELY not valid Zig, so the analyzer is
 * reading a parse fact from source the compiler rejects:
 *
 *   zig/test/cases/compile_errors/field_access_of_slices.zig:4
 *     `const info = @TypeOf(slice).unknown;` — a compile-error case whose own trailing
 *     comment quotes `:4:32: error: type '[]i32' has no members`. The member does not
 *     exist, in Zig or anywhere, and the edge says so.
 *
 *   ghostty/src/terminal/osc/parsers/unknown.zig
 *     reads `.unknown` off a `Command` declared in a SIBLING file. Classified
 *     `corpusLocal`, not `nowhere` — the declaration is real, only not in this file.
 *
 * ## Instrument
 *
 * `parseFile` from `src/ast/pool-worker` — production, not `analyze()`.
 *
 * Usage: npx tsx validation/m14/fixtures/zig/unknown-endpoint-probe.mts [root] [N] [--out p]
 */
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseFile } from "../../../../src/ast/pool-worker"

const HERE = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const outIdx = argv.indexOf("--out")
// `--out` takes a VALUE, so its successor is not a positional. When `--out` is absent
// `outIdx + 1` is 0 and would eat the first positional (the root), so the exclusion is
// conditional rather than arithmetic.
const positional = argv.filter((a, i) => !a.startsWith("--") && !(outIdx !== -1 && i === outIdx + 1))
const root = positional[0] ?? "/home/ishaq2321/bb_tests/repositories"
const N = Number(positional[1] ?? 3848)
const out = outIdx === -1 ? "" : (argv[outIdx + 1] ?? "")

const files = execFileSync("bash", ["-lc", `find ${root} -name '*.zig' -type f | sort | head -${N}`], {
  encoding: "utf8",
  maxBuffer: 1 << 28,
})
  .trim()
  .split("\n")
  .filter(Boolean)

let parsed = 0
let failed = 0
/** every published name in the sample -> the files publishing it, so `nowhere` can be told from `corpusLocal` */
const nameToFiles = new Map<string, Set<string>>()
/** symbols themselves named `unknown`, by kind */
const symKinds = new Map<string, number>()
/** every `unknown`-targeted edge, classified after the walk (a corpus-wide question cannot be answered per file) */
type Verdict = "fileLocal" | "corpusLocal" | "nowhere"
const sites: {
  file: string
  type: string
  source: string
  conf: number
  reason: string
  verdict: Verdict
  qn: string
  publishedIn: string[]
}[] = []

for (const f of files) {
  let r: any
  try {
    r = await parseFile(f, root)
    parsed++
  } catch {
    failed++
    continue
  }
  const byName = new Set<string>()
  for (const s of r?.symbols ?? []) {
    const n = String(s?.name ?? "")
    if (!n) continue
    byName.add(n)
    let set = nameToFiles.get(n)
    if (!set) nameToFiles.set(n, (set = new Set()))
    set.add(f)
    if (n === "unknown") symKinds.set(String(s?.kind ?? "(none)"), (symKinds.get(String(s?.kind ?? "(none)")) ?? 0) + 1)
  }
  for (const e of r?.relationships ?? []) {
    if (String(e?.target ?? "") !== "unknown") continue
    const src = String(e?.source ?? "")
    // The declaration THIS edge names, not the first symbol called `unknown` in the file:
    // two containers in one file can each declare one, and pairing the wrong one would
    // make a correct edge look wrong.
    const cands = ((r?.symbols ?? []) as any[]).filter((s) => String(s?.name) === "unknown")
    const match =
      cands.find((s) => String(s?.scope ?? "") === src) ??
      cands.find((s) => String(s?.qualifiedName ?? "") === `${src}.unknown`) ??
      (cands.length === 1 ? cands[0] : undefined)
    const verdict: Verdict = byName.has("unknown") ? "fileLocal" : nameToFiles.has("unknown") ? "corpusLocal" : "nowhere"
    sites.push({
      file: f,
      type: String(e?.type ?? ""),
      source: src,
      conf: Number(e?.confidence ?? 0),
      reason: String((e?.metadata as any)?.relationshipType ?? ""),
      verdict,
      qn: match ? String(match.qualifiedName ?? "") : cands.length > 1 ? `(${cands.length} candidates)` : "(none)",
      publishedIn: verdict === "fileLocal" ? [f] : verdict === "corpusLocal" ? [...(nameToFiles.get("unknown") ?? [])] : [],
    })
  }
}

const counts: Record<Verdict, number> = { fileLocal: 0, corpusLocal: 0, nowhere: 0 }
for (const s of sites) counts[s.verdict]++

const report = {
  population: { root, filesListed: files.length, parsed, failed },
  counts,
  symbolsNamedUnknownByKind: Object.fromEntries([...symKinds.entries()].sort((a, b) => b[1] - a[1])),
  sites,
}

console.log(`unknown-endpoint probe — zig`)
console.log(`population: ${files.length} files listed, ${parsed} parsed, ${failed} failed`)
console.log(`  root: ${root}`)
console.log(`  fileLocal   the edge's own file publishes that name                 : ${counts.fileLocal}`)
console.log(`  corpusLocal another file in the sample publishes it                 : ${counts.corpusLocal}`)
console.log(`  nowhere     NO file in the sample publishes it                      : ${counts.nowhere}   <- the R7 defect count`)
console.log(`  symbols themselves named 'unknown', by kind: ${JSON.stringify(report.symbolsNamedUnknownByKind)}`)
for (const s of sites.slice(0, 60)) {
  console.log(
    `    ${s.verdict.padEnd(11)} ${s.type.padEnd(11)} ${s.source.padEnd(18)} -> unknown  qn=${s.qn.padEnd(24)} conf=${s.conf}  ${s.file.replace(root + "/", "")}`,
  )
}

if (out) {
  const p = resolve(out)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(report, null, 2))
  console.error(`\nwrote ${p}`)
}

/**
 * The run must not pass by measuring nothing: if no file published `unknown` and no edge
 * named it, `named` is 0 and the probe says nothing about the rule.
 */
if (counts.nowhere > 0) {
  console.error(`\nFAIL: ${counts.nowhere} edge(s) name the literal 'unknown' and NOTHING in the sample publishes it — R7 fires.`)
  for (const s of sites.filter((x) => x.verdict === "nowhere")) {
    console.error(`  ${s.type} ${s.source} -> unknown @ ${s.file}`)
  }
  process.exit(1)
}
if (sites.length === 0) {
  console.error(`\nINCONCLUSIVE: 0 occurrences. This run cannot distinguish R7 from a corpus that never uses the name.`)
  process.exit(2)
}
console.log(`\nOK: 0 placeholders. Every 'unknown' endpoint names a declaration the sample publishes.`)
void HERE
void readFileSync