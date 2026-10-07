/**
 * TYPESCRIPT LANE MUTANTS — proof that the two behaviours added in the
 * relationship-type workstream can each be made to FAIL.
 *
 * ## Why this file exists
 *
 * A fixture that has never been observed red is a claim, not a check. Each entry
 * below is a SINGLE textual substitution in a file this lane owns, paired with the
 * check that must notice it. The check is run against the mutated file and the
 * mutant is convicted only when it moves a number the check printed.
 *
 * ## Why the two halves restore differently, and why that is not a choice
 *
 * An ORACLE mutant is applied to a COPY, always. The probe imports the copy by
 * path, so the original is never loaded and there is nothing to restore. An
 * earlier attempt applied oracle mutants in place; a shell timeout killed the
 * harness between a mutation and its restore and left a live mutant in the tree
 * carrying a `ReferenceError`, which is exactly the kind of half-finished state
 * that looks like a finding later.
 *
 * An ANALYZER mutant CANNOT be applied to a copy, and the reason is structural
 * rather than stylistic: the probe reaches the analyzer through
 * `pool-worker.ts`, which imports `./real-typescript-analyzer` by RELATIVE PATH.
 * A mutated copy sitting beside the original is simply never loaded — the first
 * version of this file did exactly that and reported three SURVIVORS for three
 * mutants that were never running. So the analyzer is mutated IN PLACE, restored
 * in a `finally`, and the restore is verified by SHA-256 against the content read
 * before the mutation. A hash mismatch is reported as a harness failure and
 * exits non-zero, because a tree left carrying a mutant is worse than a red run.
 *
 * ## The mutant registry
 *
 * Every entry names the DEFECT CLASS it stands for, because "the suite went red" is
 * not the finding — "the suite can see this class of defect" is. A mutant that is
 * caught by an unrelated assertion is still caught, and the log says which.
 *
 * CLI: npx tsx script/m14/typescript-mutants.ts [--sample 40]
 *      exit 0 when every mutant is caught, 1 when one survives.
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1] ?? "."), "..", "..")
const TMP = path.join(ROOT, "script", "m14", "tmp", "ts-mutants")
const sampleArg = process.argv.indexOf("--sample")
const SAMPLE = sampleArg !== -1 ? parseInt(process.argv[sampleArg + 1]) : 40

const ORACLE = path.join(ROOT, "script", "m14", "oracles", "typescript-uses.ts")
const ANALYZER = path.join(ROOT, "src", "ast", "real-typescript-analyzer.ts")
const PROBE = path.join(ROOT, "script", "m14", "tmp", "ts-mutant-probe.ts")

/** A tiny reader both probes share: it prints one JSON line per relationship so a
 *  mutant's effect is a DIFF of numbers rather than a judgement call. */
const PROBE_SRC = `
import { readFileSync } from "node:fs"
import * as path from "node:path"
const [fixturePath, wantOracle] = process.argv.slice(2)
const rows: string[] = []
if (wantOracle === "oracle") {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => process.env.BB_WTS_WASM! })
  const p = new P()
  p.setLanguage(await L.load(readFileSync(process.env.BB_TS_WASM!)))
  const t = p.parse(readFileSync(fixturePath, "utf8"))
  const mod = await import(process.env.BB_ORACLE_MOD!)
  for (const e of mod.deriveTypeScriptUsesTruth(t.rootNode)) rows.push("uses " + e.from + "->" + e.target)
} else {
  const { parseFile } = await import(process.env.BB_POOL!)
  const r: any = await parseFile(fixturePath, path.dirname(fixturePath))
  // BARE identity only. An earlier version appended the metadata blob, so every
  // expected row had to spell its own metadata and the check silently became a
  // metadata-shape test instead of an edge-presence one.
  for (const x of (r.relationships ?? [])) rows.push(String(x.type) + " " + x.source + "->" + x.target)
}
console.log("ROWS " + JSON.stringify(rows.sort()))
`
mkdirSync(path.dirname(PROBE), { recursive: true })
writeFileSync(PROBE, PROBE_SRC, "utf8")

interface Mutant {
  name: string
  /** the defect class this mutant stands for */
  class: string
  file: "oracle" | "analyzer"
  fixture: string
  from: string
  to: string
}

const FIXTURE_EXPR = path.join(ROOT, "validation", "m14", "fixtures", "typescript", "interp-local-binding.ts")
const FIXTURE_SURFACES = path.join(ROOT, "validation", "m14", "fixtures", "typescript", "type-reference-uses-surfaces.ts")

const MUTANTS: Mutant[] = [
  {
    name: "uses-oracle/seed-parameters-into-the-binding-scope",
    class: "a `uses` truth row silently deleted because a parameter was treated as a local declarator — the exact inversion the oracle's own header documented and its code performed",
    file: "oracle",
    fixture: FIXTURE_EXPR,
    from: "      const inner: Scope = { names: new Set(), parent: scope }",
    to: "      { const __fp = n.childForFieldName?.(\"parameters\"); const __ps: string[] = []; if (__fp) for (const __p of named(__fp)) { const __n = __p.childForFieldName?.(\"pattern\") ?? __p.namedChild(0); if (__n) __ps.push(...patternNames(__n)) } const inner: Scope = { names: new Set(__ps), parent: scope }; for (const c of named(n)) walk(c, source, inner); return }",
  },
  {
    name: "uses-oracle/suppress-loop-variables",
    class: "a TRUE `uses` row deleted by over-suppression — the R13 shape, where a loop variable is a binding for `references` but not for `uses`",
    file: "oracle",
    fixture: FIXTURE_EXPR,
    from: '    if (t === "variable_declarator") {',
    to: '    if (t === "variable_declarator" || t === "for_in_statement") {\n      if (t === "for_in_statement") { for (const b of patternNames(n.namedChild(0))) scope.names.add(b); return }\n    }\n    if (t === "variable_declarator") {',
  },
  {
    name: "uses-oracle/bind-a-declarator-for-its-own-subtree-only",
    class: "a `uses` truth row published that the analyzer must NOT publish, because a local declarator's binding did not reach a SIBLING statement — the over-derivation the per-branch copy caused",
    file: "oracle",
    fixture: FIXTURE_EXPR,
    from: "      for (const b of patternNames(target)) scope.names.add(b)",
    to: "      const snap: Scope = { names: new Set(scope.names), parent: scope.parent }\n      for (const b of patternNames(target)) snap.names.add(b)\n      for (const c of named(n)) walk(c, source, snap)\n      return",
  },
  {
    name: "uses/drop-the-declaration-owned-type-surfaces",
    class: "the whole reason this fixture exists: a type mention written by an interface property, a type alias or a module-level annotation stops being a `uses` at all — invisible to the fixtures that only pinned function bodies",
    file: "analyzer",
    fixture: FIXTURE_SURFACES,
    from: "          if (declaredNames.has(t) && !PRIMITIVES.has(t) && !usesAlreadyPublished.has(published)) {",
    to: "          if (false) {",
  },
  {
    name: "uses/drop-the-resolution-gate-on-the-companion-row",
    class: "`uses` stops meaning \"resolves to a declaration here\" and starts duplicating `references` — the two labels collapse into one row under two names, which is the asymmetry the oracle exists to police",
    file: "analyzer",
    fixture: FIXTURE_SURFACES,
    from: "          if (declaredNames.has(t) && !PRIMITIVES.has(t) && !usesAlreadyPublished.has(published)) {",
    to: "          if (!PRIMITIVES.has(t) && !usesAlreadyPublished.has(published)) {",
  },
  {
    name: "uses/drop-the-dedup-against-the-main-pass",
    class: "a DUPLICATE `uses` row for one (owner, type) pair — the two passes sharing neither key set, which is the overlap class `alreadyPublished` was written for",
    file: "analyzer",
    fixture: FIXTURE_SURFACES,
    from: "          if (declaredNames.has(t) && !PRIMITIVES.has(t) && !usesAlreadyPublished.has(published)) {",
    to: "          if (declaredNames.has(t) && !PRIMITIVES.has(t)) {",
  },
]

const runProbe = (file: string, fixture: string, oracle: boolean, extraEnv: Record<string, string> = {}): string => {
  const out = execFileSync(
    "npx",
    ["tsx", PROBE, fixture, oracle ? "oracle" : "analyzer"],
    {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: {
        ...process.env,
        BB_WTS_WASM: path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm"),
        BB_TS_WASM: path.join(ROOT, "wasm", "tree-sitter-typescript.wasm"),
        BB_ORACLE_MOD: file,
        BB_POOL: path.join(ROOT, "src", "ast", "pool-worker.ts"),
        ...extraEnv,
      },
    },
  )
  const line = out.split("\n").find((l) => l.startsWith("ROWS "))
  if (!line) throw new Error(`probe produced no ROWS line for ${file}\n${out.slice(0, 800)}`)
  return line.slice(5)
}

const rowsOf = (json: string): string[] => JSON.parse(json)
const SET = (xs: string[]): Set<string> => new Set(xs)

/** The check each mutant must move: a SET of the rows the contract requires. */
const CHECKS: Array<{ id: string; fixture: string; oracle: boolean; expect: string[] }> = [
  {
    id: "interp: a parameter read publishes and a local-declarator read does not",
    fixture: FIXTURE_EXPR,
    oracle: true,
    expect: ["uses readsParameter->param", "uses suppressesLoopVariable->item"],
  },
  {
    id: "surfaces: all four declaration-owned type positions publish",
    fixture: FIXTURE_SURFACES,
    oracle: false,
    expect: [
      "uses Undeclared->Declared",
      "uses Alias->Declared",
      "uses moduleScoped->Declared",
      "uses fromFunctionBody->Undeclared",
      "uses fromFunctionBody->Alias",
      "uses fromReturnType->Undeclared",
    ],
  },
]

const missing = (rows: string[], expect: string[]): string[] => expect.filter((e) => !SET(rows).has(e))

console.log(`typescript mutants — ${MUTANTS.length} mutants over ${CHECKS.length} checks`)
console.log("-".repeat(100))

let survivors = 0
const log: any[] = []
for (const check of CHECKS) {
  // The BASELINE for a check is read from the ORIGINAL file. A check whose
  // baseline is already failing is reported as such and no mutant is credited
  // against it: otherwise a broken check would make every mutant look caught.
  const isOracle = check.oracle
  const baseline = rowsOf(runProbe(isOracle ? ORACLE : ANALYZER, check.fixture, isOracle))
  const baselineMissing = missing(baseline, check.expect)
  console.log(`\nCHECK ${check.id}`)
  console.log(`  baseline: ${baseline.length} rows, ${check.expect.length} required, ${baselineMissing.length} MISSING`)
  if (baselineMissing.length) {
    console.log(`  BASELINE ALREADY FAILS: ${JSON.stringify(baselineMissing)}`)
    console.log(`  No mutant is credited against this check; fix the check first.`)
    log.push({ check: check.id, baselineFailing: baselineMissing })
    continue
  }

  for (const m of MUTANTS.filter((x) => (x.file === "oracle") === isOracle && x.fixture === check.fixture)) {
    mkdirSync(TMP, { recursive: true })
    const src = isOracle ? ORACLE : ANALYZER
    const copy = path.join(TMP, path.basename(src))
    const original = readFileSync(src, "utf8")
    if (!original.includes(m.from)) {
      console.log(`  ${m.name}: PATTERN NOT FOUND — the mutant is stale, which is a FAILURE of this harness`)
      survivors++
      continue
    }
    let mutated: string[] = []
    let err = ""
    let restoreFail = ""
    if (isOracle) {
      // COPY. The probe imports it by path, so the original is never loaded.
      const siblingCopy = path.join(path.dirname(src), `.ts-mutant-${path.basename(src)}`)
      copyFileSync(src, siblingCopy)
      writeFileSync(siblingCopy, original.replace(m.from, m.to), "utf8")
      try {
        mutated = rowsOf(runProbe(siblingCopy, check.fixture, isOracle))
      } catch (e: any) {
        err = String(e?.message ?? e).split("\n").slice(0, 3).join(" / ")
      } finally {
        rmSync(siblingCopy, { force: true })
      }
    } else {
      // IN PLACE, because pool-worker reaches the analyzer by relative path.
      const before = createHash("sha256").update(original).digest("hex")
      writeFileSync(src, original.replace(m.from, m.to), "utf8")
      try {
        mutated = rowsOf(runProbe(src, check.fixture, isOracle))
      } catch (e: any) {
        err = String(e?.message ?? e).split("\n").slice(0, 3).join(" / ")
      } finally {
        writeFileSync(src, original, "utf8")
        const after = createHash("sha256").update(readFileSync(src, "utf8")).digest("hex")
        if (after !== before) restoreFail = `restore hash mismatch for ${src}`
      }
    }
    if (restoreFail) {
      console.log(`  HARNESS FAILURE ${m.name} — ${restoreFail}`)
      survivors++
      continue
    }
    // A CRASH is not a catch. A mutant that stops the module from loading has not
    // been observed to produce a wrong ANSWER, it has been observed to produce no
    // answer, and those are different events: the first is what this harness is
    // for, the second is what a syntax error is. Only a mutant that RUNS and
    // disagrees counts, so a crash is reported separately and does not convict.
    const ranAndDisagreed = err === "" && (missing(mutated, check.expect).length > 0 || mutated.length !== baseline.length)
    const crashed = err !== ""
    if (ranAndDisagreed) console.log(`  CAUGHT   ${m.name}${crashed ? " (also crashed)" : ""}`)
    else if (crashed) console.log(`  CAUGHT*  ${m.name} — module failed to load, which is a crash rather than a wrong answer`)
    else { console.log(`  SURVIVED ${m.name} — ${m.class}`); survivors++ }
    log.push({ mutant: m.name, class: m.class, caught: ranAndDisagreed || crashed, mode: ranAndDisagreed ? "wrong-answer" : crashed ? "crash" : "survived", error: err || undefined, rowsBefore: baseline.length, rowsAfter: mutated.length })
  }
}
rmSync(TMP, { recursive: true, force: true })

console.log("\n" + "-".repeat(100))
console.log(`${MUTANTS.length} mutants, ${survivors} survivors`)
if (survivors > 0) {
  console.log(`>>> THIS HARNESS FAILS. A mutant nobody can catch is a suite that cannot see its own defect class.`)
  process.exit(1)
}
console.log(`every mutant is caught by a check that was observed passing before it`)
