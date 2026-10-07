/**
 * KOTLIN R7 ENDPOINT PROBE — does the `Global` / `root` / empty-endpoint class
 * fire on GOOD parses or only on damaged ones?
 *
 * WHY THIS QUESTION DECIDES THE FIX. `Global` is emitted as the SOURCE of a
 * `calls` / `instantiates` / `uses` / `references` edge by
 * `RealKotlinAnalyzer.resolveCallSource` (src/ast/real-kotlin-analyzer.ts:240),
 * `extractDeclaredTypeRefs`'s own resolver (:2806), the uses/annotations
 * resolvers (:3018) and the property/type resolvers (:3018) whenever the walk up
 * the parent chain reaches `source_file` without meeting a declaration.
 *
 * Two possible worlds, and they call for opposite fixes:
 *
 *   A. `Global` fires ONLY on files the analyzer already reports as damaged.
 *      Then the fallback is standing in for a declaration the GRAMMAR failed to
 *      produce, the analyzer already knows it does not know, and the honest
 *      answer is ABSENCE (R7: "when a fallback has nothing truthful to say the
 *      honest state is ABSENCE, not the string \"unknown\"").
 *
 *   B. `Global` fires on ORDINARY, WELL-FORMED kotlin.
 *      Then the fallback is not standing in for a missing declaration at all —
 *      it is a live claim that kotlin has a symbol named `Global`, which is
 *      false, and the fix is different.
 *
 * This file answers which, with a count per world. It is the measurement the
 * ontology workstream's Part 1 q5/R7 question needs and that no existing gate
 * makes: `script/m60/sentinel-census.ts` reads the SOURCE for placeholder
 * literals (kotlin has no registered site at all, so it has nothing to say), and
 * the differential cannot see this class because
 * `script/m14/differential.ts:2044` returns the SAME `"Global"` from the oracle
 * (standing rule R10: a spelling both sides fabricate identically produces
 * agreement).
 *
 * ALSO MEASURED HERE, because the same probe walks the same rows:
 *   - `root` as an `imports` / `references` source, split by whether the file
 *     declares a package and by whether it has a primary top-level type (the two
 *     conditions under which the analyzer substitutes it);
 *   - EMPTY endpoints per label, which is the class the ontology workstream's
 *     definition of done names outright. The strata census found 14 across five
 *     labels; six were `references` and are fixed, so this probe re-counts what
 *     is left rather than assuming the fix was the only one needed.
 *
 * READ-ONLY. Writes nothing. Run: npx tsx script/m14/kotlin-r7-endpoint-probe.ts
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const SAMPLE = parseInt(process.env.BB_PROBE_SAMPLE ?? "1200")
const FALLBACKS = new Set(["Global", "global", "GLOBAL"])

/**
 * SYMBOL names that are placeholders, matched as a PREFIX rather than as a whole
 * word.
 *
 * The relationship-endpoint sweep matches whole names, because an endpoint is a
 * written identifier and `root` is only a placeholder if the file does not also
 * declare one. A SYMBOL name is different: the analyzer GENERATES names, and a
 * generated name is a placeholder whatever else it is made of.
 *
 * This was added because the whole-word pattern missed a real class. When
 * tree-sitter-kotlin cannot parse the body of a top-level `object` it does not
 * produce an `object_declaration` at all — it produces
 *
 *     infix_expression
 *       object_literal "object"
 *       simple_identifier "WithContext"      <-- the REAL name, right there
 *       lambda_literal "{ ... }"
 *
 * and the analyzer recovers by publishing the declaration as `anonymous_object`.
 * Reproduced on a three-line file:
 *
 *     package com.acme.min
 *     object WithContext {
 *         context(ctx: String)
 *         fun a() = 1
 *     }
 *
 * `anonymous_object` matches no whole-word suspect list, so neither the census nor
 * the endpoint sweep above ever counted it. The right test is not "is this name a
 * word someone might declare" but "is this name WRITTEN in this file" — the same
 * test the endpoint sweep already applies, and the one that separates `UNKNOWN`
 * (a real enum constant) from `anonymous_object` (invented).
 */
const GENERATED_NAME_HINT = /^(anonymous|global|root|unknown|unnamed|placeholder|synthetic)/i

const files: { repo: string; dir: string; rel: string; abs: string }[] = []
for (const e of readdirSync(CR)) {
  if (e !== "kotlin") continue
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > 512 * 1024) continue } catch { continue }
    if (detectLanguageFromPath(abs) !== "kotlin") continue
    files.push({ repo: e, dir, rel, abs })
  }
}
files.sort((a, b) => (a.rel < b.rel ? -1 : 1))
// Every Nth file, so the draw spans the whole corpus rather than one subtree.
// This is the bias the strata census measured and fixed; a probe that reintroduces
// it would measure `analysis/` and call it kotlin.
const step = Math.max(1, Math.floor(files.length / SAMPLE))
const admitted = files.filter((_, i) => i % step === 0).slice(0, SAMPLE)

type Cell = { edges: number; files: number }
const worldA: Record<string, Cell> = {}   // fallback in a file WITH a parse error
const worldB: Record<string, Cell> = {}   // fallback in a file WITHOUT one
const emptyByLabel: Record<string, Cell> = {}
const rootByPkg: Record<string, Cell> = {}
const bump = (m: Record<string, Cell>, k: string) => {
  const c = m[k] ?? { edges: 0, files: 0 }
  c.edges++
  m[k] = c
}
const bumpFile = (m: Record<string, Cell>, k: string) => {
  const c = m[k] ?? { edges: 0, files: 0 }
  c.files++
  m[k] = c
}

/** Generated symbol names, split by whether the file WRITES the name. */
const genNames = new Map<string, { n: number; written: number; ex: string[] }>()
let idx = 0
let parsed = 0
let threw = 0
let damagedFiles = 0
let cleanFiles = 0
const examples: Record<string, string[]> = {}

async function worker(): Promise<void> {
  while (true) {
    const i = idx++
    if (i >= admitted.length) return
    const f = admitted[i]
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { threw++; continue }
    parsed++
    const damaged = ((r.errors ?? []).length ?? 0) > 0
    if (damaged) damagedFiles++
    else cleanFiles++
    const label = `${f.repo}/${f.rel}`
    const raw = readFileSync(f.abs, "utf8")
    const pkg = /^\s*package\s+\S/m.test(raw.slice(0, 4000))
    for (const sym of r.symbols ?? []) {
      const nm = String(sym?.name ?? "")
      if (!nm || !GENERATED_NAME_HINT.test(nm)) continue
      const esc = nm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      const isWritten = new RegExp("\\b" + esc + "\\b").test(raw)
      const c = genNames.get(nm) ?? { n: 0, written: 0, ex: [] }
      c.n++
      if (isWritten) c.written++
      if (c.ex.length < 2) c.ex.push(`${label}:${sym?.range?.startLine ?? "?"} kind=${sym?.kind} writtenInFile=${isWritten}`)
      genNames.set(nm, c)
    }
    for (const rel of r.relationships ?? []) {
      const t = String(rel.type ?? rel.relationshipType ?? "").toLowerCase()
      const src = String(rel.source ?? rel.from ?? "")
      const tgt = String(rel.target ?? rel.to ?? "")
      if (!src || !tgt) {
        const k = `${t}:${!src && !tgt ? "both" : !src ? "source" : "target"}`
        bump(emptyByLabel, k); bumpFile(emptyByLabel, k)
        ;(examples[`EMPTY ${k}`] ??= []).push(`${label} ${k}`)
        continue
      }
      if (FALLBACKS.has(src)) {
        const k = t
        const ext = f.rel.slice(f.rel.lastIndexOf("."))
        bump(damaged ? worldA : worldB, k); bumpFile(damaged ? worldA : worldB, k)
        // Extension attribution, because `.kts` and `.kt` are two different
        // situations wearing one defect name. A `.kts` script's top-level
        // statements genuinely have no enclosing declaration — that is what a
        // script IS — whereas a `.kt` file always has one and the fallback is
        // standing in for a declaration the analyzer failed to recognise.
        bump(damaged ? worldA : worldB, `${k} [${ext}]`)
        bumpFile(damaged ? worldA : worldB, `${k} [${ext}]`)
        ;(examples[`${damaged ? "A" : "B"} ${k}`] ??= []).push(`${label}:${rel.line_number ?? "?"} source=Global`)
        ;(examples[`${damaged ? "A" : "B"} ${k} [${ext}]`] ??= []).push(`${label}:${rel.line_number ?? "?"} source=Global`)
        continue
      }
      if (src === "root") {
        const k = `${t} [${pkg ? "has-package" : "NO-package"}]`
        bump(rootByPkg, k); bumpFile(rootByPkg, k)
      }
    }
  }
}
await Promise.all(Array.from({ length: 8 }, () => worker()))

/**
 * Sum the LABEL rows only.
 *
 * The `[.kt]` / `[.kts]` rows are an ATTRIBUTION of the same edges, not extra
 * edges, and they live in the same map — so summing every value counted each edge
 * twice and reported World A as 1,864 when the label rows say 936. A total that
 * disagrees with the rows printed directly above it is the kind of number that
 * gets quoted, so the exclusion is explicit and the two are printed side by side.
 */
const sum = (m: Record<string, Cell>): number =>
  Object.entries(m).filter(([k]) => !/\[[a-z.]+\]$/.test(k)).reduce((a, [, c]) => a + c.edges, 0)
const show = (title: string, m: Record<string, Cell>) => {
  console.log(`\n${title}`)
  if (Object.keys(m).length === 0) { console.log("  (none)"); return }
  for (const [k, c] of Object.entries(m).sort((a, b) => b[1].edges - a[1].edges)) {
    console.log(`  ${String(c.edges).padStart(6)} edges / ${String(c.files).padStart(5)} files   ${k}`)
    // Examples are keyed by the LABEL row, so an `[ext]` row has no example of its
    // own; showing the label row's example under an extension row would read as if
    // that file had that extension, which is how the first version of this
    // instrument managed to print a `.kts` example under `[.kt]`.
    if (/\[[a-z.]+\]$/.test(k)) continue
    for (const e of (examples[`${title.startsWith("WORLD A") ? "A" : title.startsWith("WORLD B") ? "B" : ""} ${k}`] ?? []).slice(0, 2)) {
      console.log(`           e.g. ${e}`)
    }
  }
}

console.log(`kotlin R7 endpoint probe — ${parsed}/${admitted.length} files parsed (${threw} threw)`)
console.log(`draw: every ${step}th tracked file of fixtures/repositories/kotlin (${files.length} tracked)`)
console.log(`damaged files (analyzer reported >=1 parse error): ${damagedFiles}`)
console.log(`clean files: ${cleanFiles}`)

show("WORLD A — `Global` source in a file the analyzer reported as DAMAGED", worldA)
show("WORLD B — `Global` source in a CLEAN file (the live-fabrication world)", worldB)

console.log(`\nEMPTY endpoints by label (the definition-of-done class)`)
if (Object.keys(emptyByLabel).length === 0) console.log("  (none)")
for (const [k, c] of Object.entries(emptyByLabel).sort((a, b) => b[1].edges - a[1].edges)) {
  console.log(`  ${String(c.edges).padStart(5)} edges / ${String(c.files).padStart(4)} files   ${k}`)
  for (const e of (examples[`EMPTY ${k}`] ?? []).slice(0, 3)) console.log(`           e.g. ${e}`)
}

console.log("\nGENERATED symbol names matching " + GENERATED_NAME_HINT.source)
if (genNames.size === 0) console.log("  (none)")
for (const [nm, c] of [...genNames.entries()].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`  ${String(c.n).padStart(6)} symbols, ${String(c.n - c.written).padStart(6)} of them NOT written in their own file   ${nm}`)
  for (const e of c.ex.slice(0, 2)) console.log(`           e.g. ${e}`)
}
console.log("\n`root` source by package presence")
show("(root sources)", rootByPkg)

console.log(`\n--- verdict inputs ---`)
console.log(`A (damaged only) : ${sum(worldA)} edges`)
console.log(`B (clean files)  : ${sum(worldB)} edges`)
for (const [nm, c] of genNames) {
  if (c.n - c.written > 0) { console.log(`GENERATED-UNWRITTEN ${nm}: ${c.n - c.written}`); break }
}
console.log(`B is ${sum(worldB) === 0 ? "ZERO — the fallback only ever stands in for a declaration the grammar did not produce" : "NON-ZERO — the fallback fires on well-formed kotlin and is a live fabrication"}`)
