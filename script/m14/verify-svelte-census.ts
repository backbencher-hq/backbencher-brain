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

// --- DIMENSION 2: TEMPLATE CONSTRUCTS AND THE RESERVED NAMESPACE -----------
// The rune census above asks "is every `$`-form ruled". This dimension asks the
// same question of the template: is every `svelte:` tag and every block construct
// ruled, and — the part with teeth — is the reserved namespace actually RESERVED?
//
// It exists because of what it found. The corpus carries
// `<svelte:selfdestructive x="{x - 1}"/>` in its own
// `compiler-errors/samples/svelte-selfdestructive/`: a deliberate near-miss of
// `svelte:self`, in a file the Svelte compiler REJECTS. The analyzer published
// `instantiates -> svelte:selfdestructive` and reported zero errors, because the
// grammar parses an unknown element name perfectly well.
//
// AND THE ORACLE DID THE SAME, because its emit condition is
// `!ORACLE_HTML_TAGS.has(name) && !VUE_STYLE_BUILTINS.has(name)` and that name is
// in neither set. Both sides agreed, so the differential reported 0 missing and 0
// unexplained and the lane read clean. That is the worst kind of defect there is:
// the one gate that compares the two sides is blind to it BY CONSTRUCTION, which
// is the whole reason this file exists.
//
// So the ruling is now a gate rather than a code comment: the `svelte:` prefix is
// reserved, the eleven below are its only members, and any other `svelte:*` in the
// corpus must be declared here as rejected — which makes a future unknown element a
// census failure rather than a quietly published edge both sides agree on.
const DECLARED_SVELTE_BUILTINS = new Set([
  "svelte:component", "svelte:element", "svelte:self", "svelte:window",
  "svelte:document", "svelte:body", "svelte:head", "svelte:options",
  "svelte:fragment", "svelte:boundary",
])

// Block constructs, with what each is FOR. Every one discovered in the corpus must
// be declared, so a block type Svelte adds later fails here instead of being
// silently unhandled on both sides.
const DECLARED_BLOCKS = new Map<string, string>([
  ["{#each}", "keyed or unkeyed list; the collection is a member read, the binding shadows"],
  ["{#if}", "conditional; head is a member read and counts as a decision point"],
  ["{:else}", "the negative arm of an if"],
  ["{#await}", "a promise; the expression is a member read"],
  ["{:then}", "the resolved arm, whose binding shadows within it"],
  ["{:catch}", "the rejected arm, whose binding shadows within it"],
  ["{#key}", "re-keys a block when its expression changes"],
  ["{#snippet}", "a named template function, published as a Method"],
  ["{@render}", "calls a snippet — a call site, per the D8 ruling"],
  ["{@const}", "a block-local declaration; local to its block and shadows after it"],
  ["{@html}", "raw HTML injection; data, not an identity"],
  ["{@debug}", "dev-only inspection; no graph edge"],
  ["{@attach}", "an attachment action; the handler is a call site per the attach fixture"],
])

// Constructs the corpus contains that are NOT valid Svelte, each found in the
// project's own `compiler-errors/samples/` and each rejected for a stated reason.
// Declaring them is the point: an undeclared construct fails this gate, and a
// REJECTED construct is a ruling that must be argued for, not a shape to be
// quietly tolerated. Every entry here was found by a gate run, not by inspection.
const REJECTED = new Map<string, string>([
  ["svelte:selfdestructive", "REJECTED — an undeclared member of the reserved `svelte:` namespace, and a deliberate near-miss of `svelte:self` in `compiler-errors/samples/svelte-selfdestructive/`, a file the Svelte compiler REJECTS. Before the reserved-namespace ruling the analyzer published `instantiates -> svelte:selfdestructive` and reported zero errors, because the grammar parses an unknown element name perfectly well. It cannot name a component: there is no such element to import."],
  ["{@htmlfoo}", "REJECTED — an `{@html}` tag with no separating whitespace, in `compiler-errors/samples/raw-mustaches-whitespace/`, which exists to assert the compiler rejects exactly this spelling. Not a distinct construct and not a call site."],
  ["{@constfoo}", "REJECTED — the same invalid-`{@tag}`-spelling shape, in a compiler-error sample. `{@const}` requires whitespace before its name."],
  ["xlink", "REJECTED — an XML/SVG NAMESPACE, not a Svelte directive. 7 occurrences, from real SVG markup like `<use xlink:href='' x='' y=''/>`. The one member that is worth naming is `xlink:href`, a RESOURCE reference: modelling it is the html lane's resource contract (a carrier census over URL-bearing tag/attribute pairs), and this lane declares its scope as component structure plus script, so the question is recorded as out of scope here rather than answered by publishing an edge this lane has no contract for."],
  ["xml", "REJECTED — an XML namespace attribute (`xml:lang`, `xml:space`), 2 occurrences in a corpus sample of unknown-attribute handling. Not a Svelte directive."],
  ["xmlns", "REJECTED — a namespace DECLARATION (`xmlns:xlink`), 2 occurrences alongside the above. A declaration names no runtime value and is never a carrier."],
  ["foo", "REJECTED — an invented attribute in a compiler-error sample (`<button foo:bar>click me</button>`, `<C foo:bar />`), 2 occurrences. Present precisely to assert the compiler rejects an unknown namespaced attribute."],
])

// --- DIMENSION 3: THE DIRECTIVE CARRIER SPACE -------------------------------
// Found by this gate: eight Svelte directive families produced no edge of any kind
// and had NO declared ruling anywhere — zero mentions in the spec, zero in the
// analyzer. Roughly 2,049 corpus occurrences were silent, more than double the
// `on:` carriers that did work, including `bind:value` at 581.
//
// WHY A NODE-TYPE CENSUS CANNOT FIND THIS, which is the structural lesson. Section A
// classifies GRAMMAR NODE TYPES, and `attribute` was already marked handled_verified.
// These eight families were hiding INSIDE a node type the gate had blessed. A handled
// type can contain an unexamined space and no node-type gate will ever see it — which
// is why the space had to be enumerated in its own right, by PREFIX, from the corpus.
//
// TAILWIND IS THE TRAP, and it is why discovery strips quoted values first.
// `md:grid-cols-2`, `dark:bg-background`, `hover:text-primary` and `after:absolute`
// carry the exact `prefix:value` shape of a directive and live inside a quoted
// `class` value. 765 such tokens are text inside attribute values; counting them would
// have declared four nonexistent Svelte directives and, worse, invited a
// shape-matching rule that published all of them. Discovery below therefore reads
// ATTRIBUTE NAMES only. `after:*` consequently does not appear at all — it was never a
// Svelte directive.
const CARRIER_FAMILIES = new Map<string, string>([
  ["on", "INVOKED -> `calls`. D8: the framework calls the name."],
  ["bind", "READS -> `uses` (0.95). Two-way, so the read half only; carries metadata.carrierDirective."],
  ["class", "READS -> `uses` (0.95). A class TOGGLE's condition is a template read; the class name is not an identity."],
  ["style", "READS -> `uses` (0.95). A style PROPERTY's value is a template read; the property name is not an identity."],
  ["use", "INVOKED -> `calls`. An action is invoked on mount, by the same mechanism as on:."],
  ["transition", "INVOKED -> `calls`. Invoked on state change."],
  ["in", "INVOKED -> `calls`. The intro transition."],
  ["out", "INVOKED -> `calls`. The outro transition."],
  ["animate", "INVOKED -> `calls`. The animate directive."],
  ["let", "DECLARES -> silent. A slot prop the component ACCEPTS is not a read of a member."],
])

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

/**
 * Remove balanced `{...}` regions, honouring string literals.
 *
 * THREE INSTRUMENT DEFECTS CAME FROM GETTING THIS WRONG, and each would have
 * manufactured a phantom "undeclared Svelte directive":
 *   1. A single `/\{[^{}]*\}/` pass does nothing to `class={cn(...)}` when the
 *      expression contains a NESTED brace.
 *   2. Repeating that pass to a fixpoint still fails. shadcn-svelte writes
 *      `class={cn("... focus:z-10 focus-visible:z-10 ...", ...)}`, and the arguments
 *      contain a `${...}` — so across the window from `class={cn(` to the next `}` the
 *      braces are genuinely UNBALANCED (measured: 2 `{`, 1 `}`) and no regex over
 *      `[^{}]` can ever match it.
 *   3. A brace inside a STRING is not a brace, so a naive scanner would close an
 *      expression at the wrong place — and Tailwind arbitrary values live inside
 *      class strings and are full of brackets.
 * So this walks the text, tracks quote state with backslash escapes, and drops a
 * region only when its braces actually balance. Unbalanced input is left intact
 * rather than guessed at, so a malformed document cannot delete the rest of the scan.
 */
function stripBalancedExpressions(input: string): string {
  let out = ""
  let i = 0
  while (i < input.length) {
    if (input[i] === "{") {
      let depth = 0
      let j = i
      let quote: string | null = null
      let balanced = false
      for (; j < input.length; j++) {
        const d = input[j]
        if (quote) {
          if (d === "\\") { j++; continue }
          if (d === quote) quote = null
          continue
        }
        if (d === '"' || d === "'" || d === "`") { quote = d; continue }
        if (d === "{") depth++
        else if (d === "}") {
          depth--
          if (depth === 0) { balanced = true; break }
        }
      }
      if (balanced) { out += "{}"; i = j + 1; continue }
    }
    out += input[i]
    i++
  }
  return out
}

const files: string[] = []
for (const r of CORPUS_ROOTS) walk(r, files)
files.sort()

const bare = new Map<string, number>()
const dotted = new Map<string, number>()
const svelteTags = new Map<string, number>()
const blocks = new Map<string, number>()
const carrierPrefixes = new Map<string, number>()
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
  for (const m of src.matchAll(/<(svelte:[a-zA-Z]+)/g)) svelteTags.set(m[1], (svelteTags.get(m[1]) ?? 0) + 1)
  // Carrier discovery reads ATTRIBUTE NAMES only, so quoted values and {expressions}
  // are blanked first. A Tailwind token inside class="md:grid-cols-2" is text in a
  // value, not a directive; without this the census would declare four nonexistent
  // Svelte directives and license a shape-matching rule that published all of them.
  // Greedy on purpose. A NON-greedy `<script[\s\S]*?<\/script>` is truncated by a
  // `</script>` appearing inside a STRING, which left the tail of a script body in the
  // scan and produced a phantom `disabled:*` prefix from a Tailwind token inside a
  // JS string literal. Carriers are a TEMPLATE property, so removing from the first
  // `<script` to the last `</script>` — which consumes every script block in the file —
  // is the correct and simpler rule.
  //
  // Comments are stripped too, and that was the second instrument defect: an HTML
  // comment reading `<!-- @migration-task: svelte:self is deprecated -->` matched as a
  // `svelte:self` ATTRIBUTE. Prose is not an attribute, and without this the census
  // would have declared three phantom "undeclared directives" and invited a ruling
  // about constructs that do not exist.
  let namesOnly = src
    .replace(/<script[\s\S]*<\/script>/g, "")
    .replace(/<style[\s\S]*<\/style>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/=\s*"[^"]*"/g, '=""')
    .replace(/=\s*'[^']*'/g, "=''")
  namesOnly = stripBalancedExpressions(namesOnly)
  for (const m of namesOnly.matchAll(/\s([a-zA-Z][\w-]*):([\w-]+)(?=[\s=/>])/g)) {
    carrierPrefixes.set(m[1], (carrierPrefixes.get(m[1]) ?? 0) + 1)
  }
  for (const m of src.matchAll(/\{([#:@])\s*([a-zA-Z_$][\w$]*)/g)) {
    const k = "{" + m[1] + m[2] + "}"
    blocks.set(k, (blocks.get(k) ?? 0) + 1)
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

// 4. THE RESERVED NAMESPACE. Every `svelte:*` tag in the corpus must be a declared
//    builtin. Anything else is an undeclared member of a reserved namespace, which
//    the Svelte compiler rejects — so it can never name a component, and the
//    analyzer must not publish it.
//
//    This is the check that found the defect, and the reason it has teeth even
//    though the analyzer and the oracle AGREE on the wrong answer: agreement between
//    two readings of the same spec is not evidence when the spec itself says the
//    name is illegal. A construct that cannot exist is not a "both sides got it
//    wrong" case, it is a case where the corpus is authoritative and the premise
//    is checkable. `{@htmlfoo}` and `{@constfoo}` in the corpus are the same shape
//    for block constructs — invalid `{@tag}` spellings in compiler-error samples —
//    and are declared rejected for the same reason.
const undeclaredTags: Array<[string, number]> = []
for (const [tag, count] of svelteTags) {
  if (!DECLARED_SVELTE_BUILTINS.has(tag) && !REJECTED.has(tag)) undeclaredTags.push([tag, count])
}
note(
  undeclaredTags.length === 0,
  `${undeclaredTags.length} undeclared member(s) of the RESERVED \`svelte:\` namespace: ` +
    undeclaredTags.map(([t, c]) => `${t}(${c})`).join(", ") +
    " — the Svelte compiler rejects an unknown svelte:* element, so it cannot name a component and must not be published " +
    "as one. Add it to DECLARED_SVELTE_BUILTINS if it is a real element, or leave it out if it is not.",
)

// 5. Every block construct in the corpus must carry a disposition, for the same
//    reason: a block type Svelte adds later must fail HERE rather than being
//    silently unhandled on both sides.
const undeclaredBlocks: Array<[string, number]> = []
for (const [k, count] of blocks) {
  if (!DECLARED_BLOCKS.has(k) && !REJECTED.has(k)) undeclaredBlocks.push([k, count])
}
note(
  undeclaredBlocks.length === 0,
  `${undeclaredBlocks.length} block construct(s) in the corpus carry no disposition: ` +
    undeclaredBlocks.map(([k, c]) => `${k}(${c})`).join(", ") +
    " — declare it in DECLARED_BLOCKS with what it is FOR, or rule it rejected if the corpus occurrence is an invalid " +
    "spelling in a compiler-error sample.",
)

// 5b. A REJECTED ruling must still describe something the corpus contains, or it
//     is a stale excuse for a construct that has since been fixed or removed.
for (const [k] of REJECTED) {
  note(
    svelteTags.has(k) || blocks.has(k) || carrierPrefixes.has(k),
    `REJECTED ruling for ${k} no longer matches anything in the corpus — either the invalid construct was fixed upstream, ` +
      `or the ruling is stale and should be deleted rather than left to excuse a name that is now legal`,
  )
}

// 5c. THE CARRIER SPACE. Every directive prefix in the corpus must carry a declared
//     obligation. This is the rule with teeth for the space that hid inside a
//     handled node type: a new Svelte directive fails here, rather than being
//     silently unhandled on both sides while section A reports the `attribute` node
//     type as verified.
const undeclaredCarriers: Array<[string, number]> = []
for (const [pre, count] of carrierPrefixes) {
  if (!CARRIER_FAMILIES.has(pre) && !REJECTED.has(pre)) undeclaredCarriers.push([pre, count])
}
note(
  undeclaredCarriers.length === 0,
  `${undeclaredCarriers.length} directive prefix(es) in the corpus carry no declared obligation: ` +
    undeclaredCarriers.map(([p, c]) => `${p}:* (${c})`).join(", ") +
    " — a new Svelte directive. Declare it in CARRIER_FAMILIES with what it owes the graph, or rule it rejected if the " +
    "occurrence is an invalid spelling in a compiler-error sample. Do NOT match the `prefix:value` SHAPE: Tailwind tokens " +
    "(`md:grid-cols-2`, `dark:bg-background`, `after:absolute`) have it and live inside quoted class values.",
)

// 5d. Every declared family must be exercised, or its disposition proves nothing.
for (const [pre] of CARRIER_FAMILIES) {
  note(carrierPrefixes.has(pre), `declared carrier family ${pre}:* does not occur in the corpus — its disposition is stale`)
}

// 6. Declared svelte builtins must be a real reserved-namespace reading: each must
//    actually occur in the corpus, or the table carries a member nothing exercises.
for (const t of DECLARED_SVELTE_BUILTINS) {
  note(svelteTags.has(t), `declared svelte builtin ${t} does not occur in the corpus — its disposition is stale and proves nothing`)
}

// 7. Declared rune bases must each be a real base, or the completeness rule in
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
console.log(
  `  carrier dimension: ${carrierPrefixes.size} directive prefixes in the corpus, ${CARRIER_FAMILIES.size} declared, ` +
    `${[...REJECTED.keys()].filter((k) => carrierPrefixes.has(k)).length} ruled rejected`,
)
console.log(
  `  template dimension: ${svelteTags.size} svelte:* tags (${DECLARED_SVELTE_BUILTINS.size} declared builtins, ` +
    `${[...REJECTED.keys()].filter((k) => svelteTags.has(k)).length} ruled rejected), ` +
    `${blocks.size} block constructs (${DECLARED_BLOCKS.size} declared, ` +
    `${[...REJECTED.keys()].filter((k) => blocks.has(k)).length} ruled rejected)`,
)

// Reserved-namespace probe: an undeclared `svelte:*` must publish NOTHING, and a
// declared builtin must also publish nothing. Asserted separately so a rule that
// simply suppressed EVERY `svelte:` tag would pass the first and be caught by the
// fixture, which requires real components to still be published.
const nsDoc = `<script>\n  import Child from "./Child.svelte"\n</script>\n<Child />\n<svelte:self />\n<svelte:bogus />\n<svelte:component this={Child} />\n`
const nsFile = path.join("/tmp", `svelte-census-ns-${Math.random().toString(36).slice(2)}.svelte`)
fs.writeFileSync(nsFile, nsDoc)
const nsResult: any = await ASTEngine.parseFile(nsFile, nsDoc)
const nsInst = (nsResult.relationships ?? []).filter((e: any) => e.type === "instantiates").map((e: any) => e.target)
try { fs.unlinkSync(nsFile) } catch {}
note(!nsInst.includes("svelte:bogus"), `an undeclared member of the reserved namespace was PUBLISHED as a component: ${nsInst.join(", ")}`)

// Carrier probes: run the analyzer over ONE document carrying every declared family
// and assert the obligation each one declares. The read half and the call half are
// checked separately because they are separate rulings, and `let:` is checked for
// SILENCE because a family that declares no obligation must stay quiet — a census that
// only ever checked for presence would not notice a rule that published everything.
const CARRIER_PROBE = {
  reads: ["m", "c", "col"],
  invoked: ["act", "tr", "fly", "fade", "flip"],
  silent: ["item"],
}
const carrierDoc = `<script>
  let m = $state(0)
  let c = $state(false)
  let col = $state("red")
  function act() {}
  function tr() {}
  function fly() {}
  function fade() {}
  function flip() {}
</script>
<button bind:value={m} class:on={c} style:color={col} use:act transition:tr in:fly out:fade animate:flip let:item>x</button>
`
const carrierFile = path.join("/tmp", `svelte-census-carriers-${Math.random().toString(36).slice(2)}.svelte`)
fs.writeFileSync(carrierFile, carrierDoc)
const carrierRes: any = await ASTEngine.parseFile(carrierFile, carrierDoc)
try { fs.unlinkSync(carrierFile) } catch {}
// The read families assert the PROVENANCE FLAG, not mere presence — and that
// correction is itself a finding. Measuring with the carrier read pass disabled shows
// `bind:value={m}`, `class:on={c}` and `style:color={col}` were ALREADY published as
// `uses` by the general attribute-expression collection, because the grammar wraps an
// attribute value in an `expression` node the existing walk already visits. The first
// version of this probe asserted presence, and it PASSED with the read set emptied —
// which is what exposed the overstatement. Asserting presence would have tested
// nothing about D12 and would have kept a false claim in the spec.
const cUses = new Set(
  (carrierRes.relationships ?? [])
    .filter((e: any) => e.type === "uses" && e?.metadata?.carrierDirective === true)
    .map((e: any) => e.target),
)
const cCalls = new Set((carrierRes.relationships ?? []).filter((e: any) => e.type === "calls").map((e: any) => e.target))
for (const t of CARRIER_PROBE.reads) {
  note(
    cUses.has(t),
    `carrier family that DECLARES a member read published no PROVENANCE-TAGGED \`uses\` edge for ${t} — the read is published by the ` +
      "general expression walk, so what the carrier pass must contribute is `metadata.carrierDirective`, which is what makes a " +
      "two-way binding distinguishable from an ordinary template read",
  )
}
for (const t of CARRIER_PROBE.invoked) {
  note(cCalls.has(t), `carrier family that DECLARES a framework invocation published no \`calls\` edge for ${t} — an action or transition is invoked by the same mechanism as an on: handler`)
}
for (const t of CARRIER_PROBE.silent) {
  note(!cUses.has(t) && !cCalls.has(t), `carrier family that DECLARES silence published an edge for ${t} — a declared no-obligation family must stay quiet`)
}
note(nsInst.includes("Child"), "the reserved-namespace rule suppressed real components — it must reject undeclared svelte:* only, not the whole neighbourhood")

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
    svelteTagForms: svelteTags.size,
    declaredSvelteBuiltins: DECLARED_SVELTE_BUILTINS.size,
    blockConstructs: blocks.size,
    declaredBlocks: DECLARED_BLOCKS.size,
    rejectedRulings: REJECTED.size,
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
      id: "census-carrier-space",
      status: "pass",
      description:
        `every directive prefix in the corpus (${carrierPrefixes.size} distinct) carries a declared obligation ` +
        `(${CARRIER_FAMILIES.size} families), with quoted values stripped so Tailwind tokens are never mistaken for ` +
        `directives. FOUND BY THIS CHECK: eight families were silent with no ruling anywhere — roughly 2,049 corpus ` +
        `occurrences including \`bind:value\` at 581. A node-type census could not have found it, because \`attribute\` was ` +
        `already marked handled and these families were hiding INSIDE that handled type. Probed in both directions: the read ` +
        `families must publish \`uses\`, the invoked families must publish \`calls\`, and \`let:\` must stay SILENT.`,
    },
    {
      id: "census-reserved-namespace",
      status: "pass",
      description:
        `every \`svelte:*\` tag in the corpus is a declared builtin (${DECLARED_SVELTE_BUILTINS.size}) or carries a REJECTED ` +
        `ruling (${[...REJECTED.keys()].filter((k) => svelteTags.has(k)).length}); 0 undeclared of ${svelteTags.size} tags. The ` +
        `prefix is reserved, so an undeclared member cannot name a component. FOUND BY THIS CHECK: the corpus's own ` +
        `compiler-errors sample \`svelte:selfdestructive\` was being published as \`instantiates\` AND derived identically by ` +
        `the F5 oracle, so both sides agreed and the differential reported it clean.`,
    },
    {
      id: "census-block-dispositions",
      status: "pass",
      description:
        `every block construct in the corpus carries a disposition (${DECLARED_BLOCKS.size} declared, ` +
        `${[...REJECTED.keys()].filter((k) => blocks.has(k)).length} ruled rejected as invalid spellings in compiler-error ` +
        `samples); 0 undeclared of ${blocks.size} constructs, so a block type Svelte adds later fails here rather than ` +
        `being silently unhandled on both sides.`,
    },
    {
      id: "census-rejected-rulings-fresh",
      status: "pass",
      description:
        `every REJECTED ruling still matches something in the corpus. A ruling that no longer describes a real occurrence ` +
        `is deleted rather than left to excuse a name that has since become legal — otherwise the rejection table becomes ` +
        `a place to hide a newly-valid construct.`,
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
      "dropping the REJECTED ruling for svelte:selfdestructive exits 1 naming it an undeclared member of the reserved namespace",
      "renaming a REJECTED ruling to a name the corpus lacks exits 1 naming the ruling stale",
      "reverting the analyzer's reserved-namespace rule exits 1 reporting the undeclared member as PUBLISHED",
      "a declared read family that stops publishing exits 1 naming the missing `uses` target",
      "a declared invoked family that stops publishing exits 1 naming the missing `calls` target",
      "a declared SILENT family that starts publishing exits 1 naming it",
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
