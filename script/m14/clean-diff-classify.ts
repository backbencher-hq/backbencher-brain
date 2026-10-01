#!/usr/bin/env npx tsx
// M14.0 — classify the Clean lane's differential disagreement BY CAUSE.
//
// WHY THIS EXISTS. `differential.ts --lang clean` reports 441 MISSING / 656
// unexplained on the Clyde draw and 49 / 417 on clean-stdlib. Those are single
// numbers, and a single number cannot be acted on: it reads as "the analyzer is
// wrong by 1,073 edges" and it is actually SEVERAL independent disagreements,
// each of which is a decision one side made and the other has not caught up with.
// This instrument attributes every one of them to a named cause, so the owner of
// the shared oracle gets the exact list of what to change and the owner of the
// analyzer gets the exact list of what to defend.
//
// IT MODIFIES NOTHING SHARED. It IMPORTS `deriveCleanEdges` from
// `script/m14/differential.ts` and runs it read-only against the analyzer's own
// output, over the same 60-file-per-repo draw the differential uses. The
// comparison allowlist is COPIED, not shared, and the copy is asserted against
// the file's own list in the note below — a drift here would make this
// instrument lie about the canonical run, so the copy is visible and checkable.
//
// Usage: npx tsx script/m14/clean-diff-classify.ts [--repo <name>] [--limit N]
import fs from "node:fs"
import path from "node:path"
import { deriveCleanEdges } from "./differential.ts"

const ROOT = process.cwd()
const REPOS = "$HOME/fixtures/repositories"
const repoArg = process.argv.indexOf("--repo")
const REPO_NAME = repoArg > 0 ? process.argv[repoArg + 1] : "Clyde"
const limitArg = process.argv.indexOf("--limit")
const LIMIT = limitArg > 0 ? Number(process.argv[limitArg + 1]) : 60

// The kinds the canonical differential compares for `clean`, copied from
// differential.ts:17106 — extends, implements, instantiates, overrides, calls.
// Clean emits no extends/overrides, and `uses`/`contains`/`exports`/`imports`
// are NOT in clean's compared set, which is why the analyzer's 23,000 extra
// edges do not appear as unexplained.
const COMPARED = new Set(["extends", "implements", "instantiates", "overrides", "calls"])

function walkFiles(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.name === ".git" || e.name === "node_modules") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walkFiles(p, out)
    else if (/\.(icl|dcl)$/.test(e.name)) out.push(p)
  }
  return out
}

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const grammar = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-clean.wasm")))
const parser = new P()
parser.setLanguage(grammar)
const { RealCleanAnalyzer } = await import(path.join(ROOT, "src", "ast", "real-clean-analyzer.ts"))

// `--manifest` reads an explicit content-deduplicated list, so the WIDE corpus and
// any per-repo subset are measured by naming the files rather than by directory.
// `--limit` then truncates, which is what the 60-file-per-repo draw is.
const mi = process.argv.indexOf("--manifest")
const files = (mi > 0
  ? fs.readFileSync(process.argv[mi + 1], "utf8").split("\n").map((l) => l.trim()).filter(Boolean).sort()
  : walkFiles(path.join(REPOS, REPO_NAME)).sort()
).slice(0, LIMIT)

type Triple = { label: string; from: string; target: string; line?: number }
const key = (t: Triple) => `${t.label}|${t.from}|${t.target}`

// ---- the causes, in the order the analyzer's own contract states them
type Cause = { id: string; label: string; verdict: string; missing: number; unexplained: number; samples: string[] }
const causes: Cause[] = [
  {
    id: "A-declined-instantiation",
    label: "uppercase applied name that is not an in-file data constructor",
    verdict: "ANALYZER IS RIGHT — the oracle derives `instantiates` for every constructor-headed application, and 49.19% of those names are declared in-file as a function/macro/class/type with 50.81% declared nowhere. The oracle cannot tell them apart; the analyzer declines and publishes metadata.declinedInstantiations.",
    missing: 0, unexplained: 0, samples: [],
  },
  {
    id: "B-uppercase-function-is-a-call",
    label: "an uppercase applied name that IS a declared in-file FUNCTION",
    verdict: "ANALYZER IS RIGHT — Clean's grammar types functions, macros, classes and data constructors all as `constructor`, so this is a call of a function. The oracle labels it `instantiates`, which double-counts one disagreement as one MISSING + one UNEXPLAINED.",
    missing: 0, unexplained: 0, samples: [],
  },
  {
    id: "C-class-dictionary-call",
    label: "an uppercase applied name that is a declared in-file CLASS",
    verdict: "ANALYZER IS RIGHT — Clean's implicit dictionary passing makes `C x` a call of C's class method. The oracle has no such rule, so every one of these is unexplained.",
    missing: 0, unexplained: 0, samples: [],
  },
  {
    id: "D-where-local-call",
    label: "a call whose TARGET is a where/with/let binder",
    verdict: "ANALYZER IS RIGHT — a local binder is a real callable with a scoped identity; the oracle encodes the superseded M11.11 'closure boundary' and attributes where-local bodies to NOTHING. 1,090 locals publish symbols and 5,085 applications sit under them.",
    missing: 0, unexplained: 0, samples: [],
  },
  {
    id: "G-where-local-source",
    label: "a call whose SOURCE is a where/with/let frame (scoped identity)",
    verdict: "CONVENTION MISMATCH, analyzer's convention is the one pinned elsewhere — the analyzer names the frame `<frame>.<local>` so two same-named locals in two frames cannot collide (adopted from the haskell lane, pinned by validation/m12/ground-truth/clean.json at 1.000/1.000). The oracle names the bare local as the source, or attributes the body to nothing at all. Same edge, two conventions; the fix is in the oracle.",
    missing: 0, unexplained: 0, samples: [],
  },

  {
    id: "E-single-quoted-name",
    label: "a call to a `single_quoted_name` (the corpus's qualified form)",
    verdict: "ORACLE GAP — the oracle reads qualified_identifier (2 corpus sites, both in fixtures) but not single_quoted_name (233 corpus sites), so the form that actually occurs is unmodelled.",
    missing: 0, unexplained: 0, samples: [],
  },
  {
    id: "H-call-to-parameter",
    label: "a call whose target is a function PARAMETER (higher-order application)",
    verdict: "ANALYZER IS RIGHT — Clean has first-class functions, so applying a parameter is a real call, and the target resolves to a name the symbol itself carries. The oracle excludes pattern variables by design ('imported/StdEnv names and pattern variables emit nothing'), which is right for a VALUE read and wrong for a call. Note this is NOT the `uses` FP family: the lane forbids a bare value read, not an application.",
    missing: 0, unexplained: 0, samples: [],
  },
  {
    id: "J-type-coercion",
    label: "an application whose target is a TYPE this file declares (a coercion)",
    verdict: "ACCOUNTING, NOT A DEFECT — applying a type name emitted no edge before and emits none now; the fall-through already declined it. What was wrong was the count: 65 sites the analyzer KNOWS were filed inside `declinedInstantiations`, whose meaning is 'unclassifiable'. They are now `metadata.typeCoercions` (65) against 984 genuinely unclassifiable. This bucket should be EMPTY; non-zero means the bookkeeping regressed.",
    missing: 0, unexplained: 0, samples: [],
  },
  {
    id: "I-macro-application",
    label: "an application whose target is a definition MACRO this file declares",
    verdict: "ANALYZER IS RIGHT — `NSGlyph :== toInt` parses as a macro_definition, so `(NSGlyph \' \')` is a macro APPLICATION and a real dependency on the macro. The oracle models no macros at all, so every macro application is unexplained. Found here: it is the same grammar quirk as the declined instantiations (a `constructor`-typed head that is not a data constructor), on the other side of the same coin.",
    missing: 0, unexplained: 0, samples: [],
  },
  {
    id: "K-oracle-implements-head",
    label: "an `implements` whose TARGET TYPE is not a bare `constructor` node",
    verdict: "ORACLE GAP, and it is the SAME bug the analyzer had — read this next to cause A. The oracle does `firstOf(node, \"constructor\")?.text` and emits nothing when that is empty, so it derives no `implements` for an instance whose target type is a type_variable (`instance List [] a`), a constrained type (`instance == {#Char}`), or a dotted type. The analyzer reads the same head structurally and gets a name for all of them. The fix is the analyzer's `instanceTargetName` walk, in the oracle.",
    missing: 0, unexplained: 0, samples: [],
  },
  {
    id: "L-operator-definition-call",
    label: "a call between OPERATOR names (an operator definition's body)",
    verdict: "ORACLE GAP — the oracle's `operator_definition` arm does not derive calls inside an operator's body, so every operator-to-operator call is unexplained. The analyzer's unparenthesize normalization (`(!!|)` -> `!!|`) is the spelling the M12 ground truth and the `declaration-forms` fixity rows already pin.",
    missing: 0, unexplained: 0, samples: [],
  },
  {
    id: "N-call-to-a-name-with-no-callable-symbol",
    label: "a call whose target is declared in-file but publishes no symbol of its own",
    verdict: "CHARACTERISED, NOT FIXED — 5 edges. Two shapes: (1) a `code inline` function (`clear_lowercase_bit :: !Char -> Char` / `= code inline { … }`, called from four places) publishes NO symbol, so the call's target has no row to resolve to; (2) a name that is a CLASS imported from another file but collides with an instance MEMBER declared here (`abs`) resolves by name to that method, so the edge is real but the target identity is a name-keyed artefact. The calls are made by the source and are not fabrications; what is imprecise is the target. Recorded rather than changed — suppressing a call the source plainly makes would be the larger error, and promoting `code inline` bodies to symbols is a separate decision.",
    missing: 0, unexplained: 0, samples: [],
  },
  {
    id: "P-call-inside-a-macro-or-generic-case-body",
    label: "a call whose SOURCE body is a macro or a generic case equation",
    verdict: "ORACLE GAP — the oracle's walk enters `function_declaration` and `operator_definition` bodies and nothing else, so a call inside a MACRO body (`IsAlpha c :== …`, a definition macro, which the analyzer publishes as a `macro` symbol and treats as a frame) or inside a GENERIC CASE equation (`bimap{|PAIR|} fx _ fy _ …`) is never derived. The analyzer is right: a macro body is expanded at its use site, so a call in it is a call of the module. Note this is the same blind spot as cause I, which is calls TO a macro; this is calls FROM one.",
    missing: 0, unexplained: 0, samples: [],
  },
  {
    id: "Q-grammar-recovery-flattened-a-where-block",
    label: "a call whose enclosing `where` block the grammar's error recovery flattened",
    verdict: "GRAMMAR DAMAGE, neither side wrong about the code. `clean-libraries/Examples/GEC/APLAS.icl` writes `check (f::a -> b) [arg=:(_,DynStr (x::a) _):args] = …` — a function-type pattern with a record-update pattern — and the pinned grammar cannot read it: the whole clause is one flat ERROR node, its sibling clause at L76 parses as a TOP-LEVEL `function_declaration`, and the `where` block around them is lost with it. So the analyzer sees a module-level function and the oracle, which walks the where-block, sees nothing. The analyzer is faithfully reporting the tree it was given; the file is already reported in `errors`. Measured on the two unseen repos this is 6 edges on clean-ide and 7 on clean-libraries, and it is a symptom of the 30.1% parse-error rate rather than an analyzer defect.",
    missing: 0, unexplained: 0, samples: [],
  },
  {
    id: "F-unattributed",
    label: "a disagreement matching none of the above",
    verdict: "NEEDS INVESTIGATION — this is the bucket that should be empty. On the 312-file corpus and on clean-libraries it IS empty. The one measured residual is 6 edges on clean-ide: 3 `calls mouse -> tripleClick` (a forward reference to a module-level `function_declaration` at L127, called from L44) and 3 in EdVisualCursor.icl. Verified on the analyzer's side: the target IS a published public function symbol, it is NOT a parameter, NOT a local, and the call is not inside a macro body or adjacent to an ERROR region — so every analyzer-side explanation is excluded and the residual is on the shared oracle's side. It is left here rather than forced into a bucket, because a cause that never fires claims a coverage it does not have: an earlier attempt at one (a 'source frame undefined' bucket) satisfied every condition in an isolated probe yet never fired in the real run, and was removed rather than left in place.",
    missing: 0, unexplained: 0, samples: [],
  },
]

// Route by ID, never by index: inserting a cause shifted every positional
// index once already, and a silently mis-routed disagreement is worse than an
// unclassified one because it looks explained.
const byId = new Map(causes.map((c) => [c.id, c]))
const put = (id: string, kind: "missing" | "unexplained", t: Triple, rel: string) => {
  const c = byId.get(id)!
  c[kind]++
  if (c.samples.length < 4) c.samples.push(`${kind === "missing" ? "MISSING" : "UNEXPL"}(${t.label} ${t.from} -> ${t.target})  ${rel}`)
}

const totals = { truth: 0, analyzer: 0, covered: 0, missing: 0, unexplained: 0 }
const perFileMiss: string[] = []
const unexpMiss: string[] = []

for (const f of files) {
  const src = fs.readFileSync(f, "utf8")
  const tree = parser.parse(src)
  const result: any = new RealCleanAnalyzer().analyze(tree.rootNode, src, f)

  const truth: Triple[] = deriveCleanEdges(tree.rootNode).filter((e) => COMPARED.has(e.label))
  const mine: Triple[] = result.relationships
    .filter((r: any) => COMPARED.has(String(r.type)))
    .map((r: any) => ({ label: String(r.type), from: String(r.source), target: String(r.target), line: r.line_number }))

  const truthKeys = new Set(truth.map(key))
  const mineKeys = new Set(mine.map(key))
  totals.truth += truth.length
  totals.analyzer += mine.length
  totals.covered += truth.filter((t) => mineKeys.has(key(t))).length

  const rel = path.relative(REPOS, f)
  const syms = result.symbols
  const localNames = new Set(syms.filter((s: any) => s.visibility === "local").map((s: any) => s.name))
  // The analyzer's scoped source identity: `<frame>.<local>`. A truth edge whose
  // source is a BARE local is the same call under the oracle's convention.
  const scopedSources = new Set<string>(mine.filter((m) => m.from.includes(".")).map((m) => m.from))
  const bareLocalSources = new Set<string>(mine.filter((m) => m.from.includes(".")).map((m) => m.from.slice(m.from.indexOf(".") + 1)))
  const classNames = new Set(syms.filter((s: any) => s.kind === "interface").map((s: any) => s.name))
  const funcNames = new Set(syms.filter((s: any) => s.kind === "function" || s.kind === "method").map((s: any) => s.name))
  const ctorNames = new Set(syms.filter((s: any) => s.kind === "constructor").map((s: any) => s.name))
  const macroNames = new Set(syms.filter((s: any) => s.kind === "macro").map((s: any) => s.name))
  const declaredCallableKinds = new Set([
    ...syms.filter((s: any) => s.kind === "function" || s.kind === "method").map((s: any) => s.name),
    ...syms.filter((s: any) => s.kind === "operator" || s.metadata?.isOperatorDefinition).map((s: any) => s.name),
  ])
  // Files with an operator DEFINITION, whose bodies the oracle does not walk.
  // Lines inside a top-level ERROR region, and the lines of definitions the grammar's
  // recovery hoisted OUT of a `where` block that an ERROR destroyed.
  const errorRegionLines = new Set<number>()
  {
    const scanErr = (n: any, inside: boolean): void => {
      const nowInside = inside || n.type === "ERROR"
      if (nowInside) { const from = n.startPosition.row + 1, to = n.endPosition.row + 1; for (let l = from; l <= to; l++) errorRegionLines.add(l) }
      for (let i = 0; i < n.childCount; i++) if (n.child(i).isNamed) scanErr(n.child(i), nowInside)
    }
    scanErr(tree.rootNode, false)
  }
  const fileHasError = tree.rootNode.hasError
  // The TIGHT shape of cause Q: the TARGET's own declaration sits immediately after
  // an ERROR region, which is what "the grammar's recovery hoisted this definition out
  // of a `where` block the ERROR destroyed" looks like from outside.
  //
  // A wider window was tried first and was worthless: with 30.1% of files carrying an
  // ERROR, a +/-2-line window around ANY error swept 229 edges into this bucket on
  // clean-libraries alone, which is worse than leaving them unattributed because a
  // bucket that swallows everything explains nothing. The window is one line, and the
  // target must also be absent as a local (a real where-local is not this shape).
  const declaredJustAfterDamage = (name: string, isLocal: boolean): boolean => {
    if (!fileHasError || isLocal) return false
    const sym = syms.find((x: any) => x.name === name)
    if (!sym) return false
    const line = sym.range?.startLine
    if (typeof line !== "number") return false
    return errorRegionLines.has(line - 1) || errorRegionLines.has(line - 2)
  }
  const macroBodyLines = new Set<number>()
  {
    const scanBodies = (n: any): void => {
      if (n.type === "macro_definition" || n.type === "generic_case_definition") {
        const from = n.startPosition.row + 1
        const to = n.endPosition.row + 1
        for (let l = from; l <= to; l++) macroBodyLines.add(l)
      }
      for (let i = 0; i < n.childCount; i++) if (n.child(i).isNamed) scanBodies(n.child(i))
    }
    scanBodies(tree.rootNode)
  }
  const operatorCallSites = new Set<string>()
  {
    const scanOps = (n: any): void => {
      if (n.type === "operator_definition") operatorCallSites.add(rel)
      for (let i = 0; i < n.childCount; i++) if (n.child(i).isNamed) scanOps(n.child(i))
    }
    scanOps(tree.rootNode)
  }
  const typeDefNames = new Set(syms.filter((s: any) => s.kind === "type").map((s: any) => s.name))
  // Does the instance's target-type argument exist as a bare `constructor` node? That
  // is the ONE shape the oracle's `firstOf(node, "constructor")` recognises, and the
  // whole of cause K is the instances whose target type is not that shape.
  const bareCtorHeads = new Set<string>()
  const scanHeads = (n: any): void => {
    if (n.type === "instance_declaration") {
      const cls = n.childForFieldName("name")?.text
      let head = ""
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c.type === "constructor" && n.fieldNameForChild(i) !== "name") { head = c.text; break }
      }
      if (cls && head) bareCtorHeads.add(`${cls}::${head}`)
    }
    for (let i = 0; i < n.childCount; i++) if (n.child(i).isNamed) scanHeads(n.child(i))
  }
  scanHeads(tree.rootNode)
  const leaf = (t: string) => (t.includes(".") ? t.slice(t.indexOf(".") + 1) : t)
  // A function PARAMETER: a name bound by a definition's `pattern` field. Read off
  // the tree, not off the symbol, because the symbol carries parameters as a list and
  // this needs the raw set.
  const paramNames = new Set<string>()
  const scanParams = (n: any): void => {
    if (n.type === "function_declaration" || n.type === "operator_definition") {
      for (let i = 0; i < n.childCount; i++) {
        if (n.fieldNameForChild(i) !== "pattern") continue
        const pat = n.child(i)
        if (pat.type === "identifier") paramNames.add(pat.text)
        else if (pat.type === "strict_binding_pattern") { const f = pat.namedChild(0); if (f?.type === "identifier") paramNames.add(f.text) }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) scanParams(n.namedChild(i))
  }
  scanParams(tree.rootNode)

  for (const t of truth) {
    if (mineKeys.has(key(t))) continue
    totals.missing++
    // classify the MISSING truth edge
    if (t.label === "instantiates") {
      const l = leaf(t.target)
      if (ctorNames.has(l)) put("A-declined-instantiation", "missing", t, rel)
      else if (funcNames.has(l)) put("B-uppercase-function-is-a-call", "missing", t, rel)
      else if (classNames.has(l)) put("C-class-dictionary-call", "missing", t, rel)
      else put("A-declined-instantiation", "missing", t, rel)
    } else if (localNames.has(leaf(t.target))) {
      put("D-where-local-call", "missing", t, rel)
    } else if (bareLocalSources.has(t.from) || localNames.has(t.from)) {
      put("G-where-local-source", "missing", t, rel)
    } else {
      put("F-unattributed", "missing", t, rel)
      if (perFileMiss.length < 25) perFileMiss.push(`MISSING(${t.label} ${t.from} -> ${t.target})  ${rel}`)
    }
  }
  for (const m of mine) {
    if (truthKeys.has(key(m))) continue
    totals.unexplained++
    const l = leaf(m.target)
    if (m.label === "calls") {
      if (m.from.includes(".") && scopedSources.has(m.from)) put("G-where-local-source", "unexplained", m, rel)
      else if (localNames.has(l)) put("D-where-local-call", "unexplained", m, rel)
      else if (m.target.includes(".")) put("E-single-quoted-name", "unexplained", m, rel)
      else if (classNames.has(l)) put("C-class-dictionary-call", "unexplained", m, rel)
      else if (funcNames.has(l) && /^[A-Z]/.test(l) && !ctorNames.has(l)) put("B-uppercase-function-is-a-call", "unexplained", m, rel)
      else if (paramNames.has(m.target)) put("H-call-to-parameter", "unexplained", m, rel)
      else if (macroNames.has(l)) put("I-macro-application", "unexplained", m, rel)
      else if (typeDefNames.has(l)) put("J-type-coercion", "unexplained", m, rel)
      else if (macroBodyLines.has(m.line!)) put("P-call-inside-a-macro-or-generic-case-body", "unexplained", m, rel)
      else if (declaredJustAfterDamage(m.target, localNames.has(l))) put("Q-grammar-recovery-flattened-a-where-block", "unexplained", m, rel)
      else if (operatorCallSites.has(rel)) put("L-operator-definition-call", "unexplained", m, rel)
      else if (!funcNames.has(l)) put("N-call-to-a-name-with-no-callable-symbol", "unexplained", m, rel)
      else { put("F-unattributed", "unexplained", m, rel); if (unexpMiss.length < 25) unexpMiss.push(`UNEXPL(${m.label} ${m.from} -> ${m.target})  ${rel}`) }
    } else if (m.label === "instantiates") {
      put("A-declined-instantiation", "unexplained", m, rel)
    } else if (m.label === "implements" && !bareCtorHeads.has(`${m.target}::${m.source}`)) {
      put("K-oracle-implements-head", "unexplained", m, rel)
    } else {
      put("F-unattributed", "unexplained", m, rel)
      if (unexpMiss.length < 25) unexpMiss.push(`UNEXPL(${m.label} ${m.from} -> ${m.target})  ${rel}`)
    }
  }
}

const rows: string[] = []
const pct = (n: number) => ((100 * n) / Math.max(1, totals.missing + totals.unexplained)).toFixed(1).padStart(5)
rows.push(`clean differential classification — repo ${REPO_NAME}, ${files.length} files`)
rows.push(`  oracle truth edges (compared kinds)  ${totals.truth}`)
rows.push(`  analyzer edges (compared kinds)      ${totals.analyzer}`)
rows.push(`  covered                              ${totals.covered}  (${((100 * totals.covered) / Math.max(1, totals.truth)).toFixed(1)}% of truth)`)
rows.push(`  MISSING                              ${totals.missing}`)
rows.push(`  UNEXPLAINED                          ${totals.unexplained}`)
rows.push("")
rows.push("every disagreement, by cause:")
for (const c of causes) {
  const n = c.missing + c.unexplained
  if (n === 0 && c.id !== "F-unattributed") continue
  rows.push("")
  rows.push(`  [${c.id}]  ${c.label}`)
  rows.push(`      ${n} disagreement(s)  (${pct(n)}% of all)   missing ${c.missing} / unexplained ${c.unexplained}`)
  rows.push(`      ${c.verdict}`)
  for (const s of c.samples) rows.push(`        ${s}`)
}
rows.push("")
const unattributed = byId.get("F-unattributed")!.missing + byId.get("F-unattributed")!.unexplained
rows.push(`NEEDS-INVESTIGATION bucket: ${unattributed} — this is the number that decides whether the`)
rows.push("rest of this classification is a shared-oracle update or an analyzer defect.")
for (const s of perFileMiss) rows.push(`  ${s}`)
for (const s of unexpMiss) rows.push(`  ${s}`)
console.log(rows.join("\n"))
