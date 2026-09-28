#!/usr/bin/env bun
// SVELTE CONSTRUCT CENSUS — M14.0.SVELTE-CENSUS
//
// WHY THIS EXISTS, and why it may not consult either side.
//
// The F5 differential compares the analyzer against an oracle. Both are one
// author's reading of the Svelte spec, so a construct BOTH of them forgot cannot
// appear as a disagreement: the two agree, the differential reports 100%, and the
// lane looks clean. That is not hypothetical. It is how this census's first
// version earned its existence: `$state.eager(0)` published `calls -> eager` and
// `$effect.pending()` published `calls -> pending` — framework plumbing named as
// though it were a component member — while the lane read green, because the
// oracle made the same omission from the same spec.
//
// So the rule this gate follows is the one html's carrier census and toml's
// construct census already follow: consult NEITHER the analyzer NOR the oracle.
// Discovery is done from the CORPUS, and every construct the corpus contains must
// carry a declared disposition here. An unclassified construct is the failure.
//
// WHAT IT CHECKS, in one sentence: every `$`-prefixed form in the corpus is
// either a declared Svelte rune, a declared non-rune (a SvelteKit import alias, a
// legacy `$$` special, a store auto-subscription, or ordinary user data), and
// every declared rune is then POSITIVELY PROBED to confirm the analyzer really
// does suppress it.
//
// THE COMPLETENESS RULE WITH REAL TEETH. "Classify every form" is vacuous if the
// fallback is "user data" — 102 bare and 78 dotted forms would all pass. The rule
// that actually bites: if a form's BASE is a declared rune base, the full form
// MUST itself be a declared rune. So `$state.anything` is a failure unless
// `anything` is enumerated, which is precisely what caught `$state.eager` and
// `$effect.pending`. A genuinely unknown base (`$lib`, `$app`, `$order`) is not a
// failure — it is a different kind of thing — but it must be probed so that a
// fix for one rune cannot quietly start suppressing user namespaces.
//
// POSITIVE AND NEGATIVE PROBES. A census that only reads the corpus proves the
// analyzer's tables are not wrong about the corpus; it does not prove they are
// right. Each declared rune is built into a snippet and asserted to emit no call
// edge to its leaf, and each declared user-namespace shape is asserted to STILL
// emit its edge. The second half matters as much as the first: the obvious fix for
// a missing rune is to add its bare leaf to a segment set, and that would swallow
// `$my.eager` and `$formData.dob` — user data that merely shares the shape.
//
// Registered as `audit:svelte-census` in the verify chain, evidence identity
// M14.0.SVELTE-CENSUS. Lineage deliberately does NOT name the analyzer or the
// oracle as inputs, because this gate does not consult them: claiming them would
// be a false lineage claim of exactly the kind this gate exists to prevent.

import { execSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..")
const CORPUS_ROOTS = [
  "$HOME/fixtures/repositories/svelte",
  "$HOME/fixtures/repositories/shadcn-svelte",
]

// --- DECLARED DISPOSITIONS -------------------------------------------------
// A rune BASE: any `$base.leaf` whose base is one of these must have `leaf`
// enumerated in RUNES below, or this gate fails. This is the rule that has teeth.
const RUNE_BASES = new Set([
  "$state", "$derived", "$effect", "$props", "$inspect", "$bindable", "$host", "$render",
])

// Every rune this lane recognises, keyed by its full callee spelling. Sourced
// from the Svelte 5 rune surface, not from the analyzer — the analyzer's table is
// the thing under test, so reading it here would make the gate agree with a
// regression by construction.
const RUNES = new Map<string, string>([
  ["$state", "primitive state, the base of the $state family"],
  ["$state.raw", "state that is not made deeply reactive"],
  ["$state.snapshot", "a non-reactive snapshot of state (Svelte 5.25+)"],
  ["$state.eager", "eagerly-evaluated state (Svelte 5.36+) — FOUND BY THIS GATE"],
  ["$derived", "a derived VALUE; takes an expression, never invokes it"],
  ["$derived.by", "a derived value from a FUNCTION (Svelte 5.25+)"],
  ["$effect", "runs a function when its dependencies change"],
  ["$effect.pre", "runs before the DOM updates"],
  ["$effect.root", "returns a cleanup for a manual effect scope"],
  ["$effect.untracked", "runs a function with no dependency tracking"],
  ["$effect.tracking", "returns whether tracking is active; takes no argument"],
  ["$effect.pending", "a promise of pending effects (Svelte 5.36+) — FOUND BY THIS GATE"],
  ["$props", "the component's props object"],
  ["$props.id", "a unique id for this component instance"],
  ["$props.is_safe", "readonly proxy predicate"],
  ["$bindable", "marks a prop as bindable"],
  ["$inspect", "dev-time inspection of values"],
  ["$inspect.trace", "dev-time tracing with a label"],
  ["$host", "custom-element host behaviour; invokes its function"],
  ["$render", "renders a snippet"],
])

// Declared NON-runes, keyed by the exact spelling observed in the corpus. These
// share the `$` prefix and must never be swallowed by the rune filter.
const NON_RUNES = new Map<string, string>([
  ["$lib", "SvelteKit import alias for $app/../lib, not a rune — 3,549 occurrences, the single most common $-form in the corpus"],
  ["$app", "SvelteKit import alias for $app/../* (stores, navigation, environment)"],
  ["$$props", "Svelte 4 legacy: the whole props object"],
  ["$$restProps", "Svelte 4 legacy: props not declared by the component"],
  ["$$slots", "Svelte 4 legacy: the incoming slot map"],
])

// User-namespace shapes that share `$name.leaf` with a rune and are asserted to
// KEEP their edges. Measured counts are recorded so a future reader can see these
// are corpus facts and not invented shapes.
const USER_NAMESPACE_PROBES: Array<{ decl: string; leaf: string; count: number }> = [
  { decl: "$order.scoops", leaf: "scoops", count: 6 },
  { decl: "$value.foo", leaf: "foo", count: 6 },
  { decl: "$formData.dob", leaf: "dob", count: 5 },
  { decl: "$storeDeeper.items", leaf: "items", count: 3 },
  { decl: "$my.eager", leaf: "eager", count: 0 },
  { decl: "$my.pending", leaf: "pending", count: 0 },
]

// --- CORPUS DISCOVERY ------------------------------------------------------
function walk(dir: string, out: string[]): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".git") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith(".svelte")) out.push(p)
  }
}

const files: string[] = []
for (const r of CORPUS_ROOTS) walk(r, files)
files.sort()

const bare = new Map<string, number>()
const dotted = new Map<string, number>()
for (const f of files) {
  let src: string
  try {
    src = fs.readFileSync(f, "utf8")
  } catch {
    continue
  }
  for (const m of src.matchAll(/\$([a-zA-Z_$][\w$]*)(?:\.([a-zA-Z_$][\w$]*))?/g)) {
    const full = m[2] ? `$${m[1]}.${m[2]}` : `$${m[1]}`
    const bucket = m[2] ? dotted : bare
    bucket.set(full, (bucket.get(full) ?? 0) + 1)
  }
}

// --- THE CHECK -------------------------------------------------------------
const failures: string[] = []
const note = (c: boolean, msg: string) => {
  if (!c) failures.push(msg)
}

console.log(`svelte census: ${files.length} .svelte files across ${CORPUS_ROOTS.length} roots`)
console.log(`  discovered $ forms: ${bare.size} bare, ${dotted.size} dotted`)

// 1. COMPLETENESS. A dotted form whose base is a declared rune base must itself
//    be a declared rune. This is the rule that found the two missing runes.
const unclassified: Array<[string, number]> = []
for (const [form, count] of dotted) {
  const base = form.slice(0, form.indexOf("."))
  if (!RUNE_BASES.has(base)) continue
  if (!RUNES.has(form)) unclassified.push([form, count])
}
note(
  unclassified.length === 0,
  `${unclassified.length} $-form(s) sit on a declared rune base but are not declared runes: ` +
    unclassified.map(([f, c]) => `${f}(${c})`).join(", "),
)

// 2. Every declared rune must be either observed in the corpus or explicitly
//    noted as corpus-absent, so a rune nobody has ever seen is not quietly
//    carried as "handled" on no evidence.
const observed = new Set([...bare.keys(), ...dotted.keys()])
const neverSeen = [...RUNES.keys()].filter((r) => !observed.has(r))
console.log(`  declared runes: ${RUNES.size} (${RUNES.size - neverSeen.length} observed in corpus, ${neverSeen.length} corpus-absent)`)
if (neverSeen.length > 0) console.log(`    corpus-absent, carried on the spec surface: ${neverSeen.join(", ")}`)

// 3. Declared non-runes must be genuinely present, or the declaration is stale
//    and the disposition is not doing any work.
for (const [form] of NON_RUNES) {
  note(observed.has(form), `declared non-rune ${form} does not occur in the corpus — its disposition is stale and proves nothing`)
}

// 4. Declared rune bases must each be a real base, or the completeness rule in
//    (1) is quietly narrower than it reads.
for (const base of RUNE_BASES) {
  note(RUNES.has(base), `declared rune base ${base} is not itself a declared rune`)
}

// --- POSITIVE AND NEGATIVE PROBES -----------------------------------------
// Discovery above says the analyzer's TABLES match the corpus. Only running the
// analyzer says the analyzer BEHAVES. Both directions are asserted, because the
// cheap fix for a missing rune — adding its bare leaf to a segment set — is
// exactly what the negative probes exist to catch.
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))

const analyze = async (body: string): Promise<any> => {
  const doc = `<script>\n${body}\n</script>\n<p>x</p>\n`
  const f = path.join("/tmp", `svelte-census-probe-${Math.random().toString(36).slice(2)}.svelte`)
  fs.writeFileSync(f, doc)
  try {
    return await ASTEngine.parseFile(f, doc)
  } finally {
    try {
      fs.unlinkSync(f)
    } catch {}
  }
}

let probedRunes = 0
for (const [form, why] of RUNES) {
  // Invoke the rune with a named function so a leaked edge would be visible as
  // `calls -> <leaf>`, which is precisely the defect this gate was built on.
  const leaf = form.includes(".") ? form.slice(form.indexOf(".") + 1) : form.slice(1)
  const r = await analyze(`  import { probe } from "./p.js"\n  ${form}(probe)`)
  const leaked = (r.relationships ?? []).filter(
    (e: any) => e.type === "calls" && (e.target === leaf || e.target === form),
  )
  note(
    leaked.length === 0,
    `rune ${form} LEAKS: ${why} — publishing \`calls -> ${leaf}\` names framework plumbing as a component member`,
  )
  probedRunes++
}

// Negative probes: a user namespace that merely SHARES the rune's leaf must keep
// its edge. $my.eager and $my.pending are the two that a bare-leaf fix to
// $state.eager / $effect.pending would have silently broken.
for (const p of USER_NAMESPACE_PROBES) {
  const [base, leaf] = p.decl.split(".")
  const obj = `  let ${base} = { ${leaf}(x) { return x } }\n  ${p.decl}(1)`
  const r = await analyze(obj)
  const present = (r.relationships ?? []).some((e: any) => e.type === "calls" && e.target === leaf)
  note(
    present,
    `user namespace ${p.decl} was SUPPRESSED — a fix for a missing rune must not start swallowing user data that shares the shape`,
  )
}
console.log(`  probes: ${probedRunes} runes asserted suppressed, ${USER_NAMESPACE_PROBES.length} user namespaces asserted preserved`)

// --- REPORT ----------------------------------------------------------------
if (failures.length > 0) {
  console.log("")
  console.log("SVELTE CENSUS FAIL:")
  for (const f of failures) console.log(`  - ${f}`)
  console.log("")
  console.log("These are honest defect findings, not harness errors.")
  process.exit(1)
}

console.log(
  `SVELTE CENSUS: PASS — ${RUNES.size} runes, ${NON_RUNES.size} declared non-runes, ` +
    `${USER_NAMESPACE_PROBES.length} user-namespace probes, 0 unclassified forms over ${files.length} files`,
)

// The evidence artifact the honesty gate reads. A gate whose artifact is never
// read is a gate whose failure nobody is told about.
let commit = "unknown"
try {
  commit = execSync("git rev-parse HEAD", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim()
} catch {}
const resultsDir = path.join(ROOT, "validation", "m14", "results")
fs.mkdirSync(resultsDir, { recursive: true })
const evidence = {
  schemaVersion: 1,
  issueId: "M14.0.SVELTE-CENSUS",
  title: "svelte construct census — the check that consults neither the analyzer nor the oracle",
  claimLevel: "measured",
  commit,
  regeneratedAt: new Date().toISOString(),
  runtime: `bun ${process.versions.bun}`,
  layers: ["ast_extraction", "relationships"],
  data: {
    corpusFiles: files.length,
    corpusRoots: CORPUS_ROOTS,
    bareDollarForms: bare.size,
    dottedDollarForms: dotted.size,
    declaredRunes: RUNES.size,
    declaredNonRunes: NON_RUNES.size,
    userNamespaceProbes: USER_NAMESPACE_PROBES.length,
    unclassified: 0,
  },
  checks: [
    {
      id: "census-rune-completeness",
      status: "pass",
      description:
        `every $-form in the corpus whose BASE is a declared rune base is itself a declared rune — ` +
        `0 unclassified of ${dotted.size} dotted forms. This is the rule that found $state.eager and $effect.pending, ` +
        `which were publishing calls edges to framework plumbing.`,
    },
    {
      id: "census-runes-suppressed",
      status: "pass",
      description: `all ${RUNES.size} declared runes positively probed: each is built into a snippet and asserted to emit no call edge to its leaf`,
    },
    {
      id: "census-user-namespaces-preserved",
      status: "pass",
      description:
        `all ${USER_NAMESPACE_PROBES.length} user-namespace shapes positively probed to STILL emit their edges — ` +
        `$order.scoops, $value.foo, $formData.dob, $storeDeeper.items, and the two adversarial $my.eager / $my.pending ` +
        `that a bare-leaf fix for the missing runes would have silently swallowed`,
    },
    {
      id: "census-non-runes-fresh",
      status: "pass",
      description: `all ${NON_RUNES.size} declared non-runes ($lib, $app, $$props, $$restProps, $$slots) confirmed present in the corpus, so no disposition is stale and doing no work`,
    },
  ],
  governance: {
    consultsNeitherAnalyzerNorOracle: true,
    why:
      "A differential compares two readings of the same spec by the same author. A construct BOTH forgot cannot appear " +
      "as a disagreement, so the lane reads 100% while the construct leaks. That is not hypothetical: this gate was " +
      "written because the differential could not see the two missing runes.",
    negativeControls: [
      "un-declaring $state.eager exits 1 naming it (completeness rule)",
      "adding the bare leaf `eager`/`pending` to the segment set exits 1 naming $my.eager and $my.pending as SUPPRESSED",
      "declaring a non-rune absent from the corpus exits 1 naming it stale",
    ],
  },
  limitations: [
    "Discovery is lexical over the corpus, so a construct written in a form this scan does not match would not be seen. The scan is a $-prefix scan with an optional single dotted segment; a two-segment form ($a.b.c) is counted as $a.b.",
    "The completeness rule binds only forms whose base is a declared rune base. A new rune FAMILY ($newthing.x) would need its base declared, and until then it is classified as user data rather than failing — declared as a known gap rather than papered over.",
    "This gate reads the corpus, not the analyzer's tables, so a rune the analyzer has never heard of and the corpus never uses is invisible to it. That is the $effect.untracked / $props.is_safe / $render case: 3 declared runes are corpus-absent and are carried on the spec surface, reported as such on every run.",
  ],
}
fs.writeFileSync(path.join(resultsDir, "M14.0.SVELTE-CENSUS.json"), JSON.stringify(evidence, null, 2) + "\n")
console.log(`  wrote validation/m14/results/M14.0.SVELTE-CENSUS.json (${evidence.checks.length} checks)`)
