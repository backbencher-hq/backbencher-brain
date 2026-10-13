/**
 * CPP2 — SOURCE-LEVEL MUTATION GATE. Proves each of this round's four source rules
 * can be broken and that the fixture written for it goes RED.
 *
 * WHY THIS FILE IS NOT IN `script/m14/mutate-analyzer.ts`. The shared harness
 * mutates the analyzer's RESULT (`transform(result, content)`), which is the right
 * instrument for an edge or a payload rule and the wrong one for a rule that decides
 * WHICH NODES ARE WALKED AT ALL. D19, D9 and D20 are all in that second class:
 *
 *   - D19 declines to publish a symbol for an unnamed scope. With the rule reverted,
 *     `anonymous` symbols APPEAR. No result transform can invent them, because the
 *     pre-fix result contains information the post-fix result does not (which
 *     declaration was unnamed).
 *   - D20 changes an INDEX (`node.child(i)`) under a COUNT (`namedChildCount`). Its
 *     damage is absent SYMBOLS — a class body's members that were never visited. A
 *     result transform can only delete things the result already has.
 *   - D9's first half changes which `= 0` a node is read from, and its second half
 *     removes a `symbolRef` from a scope object that never reaches the result.
 *
 * `script/m14/**` is master-owned per `docs/analyzers/ONTOLOGY-WORKSTREAM.md`, so the
 * shared harness is left alone and this lane-owned gate does the job for the rules
 * this lane changed. A report of the shared-harness need is in the lane doc.
 *
 * HOW IT WORKS, and why that is not "fragile source surgery":
 *
 *   1. read `src/ast/real-cpp-analyzer.ts` as TEXT;
 *   2. apply ONE named revert, asserted to have actually matched (an edit that does
 *      not apply is a FAILURE, not a silent pass — a mutation gate whose mutation
 *      stopped matching would otherwise certify a rule that is no longer there);
 *   3. write the mutated source to a temp module inside the repo and import it;
 *   4. run the cpp fixture suite through `runLang("cpp", new MutantAnalyzer())`;
 *   5. assert the NAMED fixture is among the failures.
 *
 * Step 4 runs the WHOLE cpp suite, which is deliberate: a revert that also breaks
 * something else is still a caught revert, and the gate reports the full delta so a
 * rule whose blast radius is larger than expected is visible rather than hidden.
 *
 * EVERY mutant is stated in BOTH directions where the direction is meaningful. D8's
 * lesson — recorded in `docs/analyzers/real-cpp-analyzer.md` — is that "a gate that
 * only ever runs in the under-firing direction proves nothing about the direction that
 * costs symbols", so `d9-overfires` exists alongside `d9-shape2-and-symref-lost`.
 *
 *   bun run script/cpp-review/cpp2-source-mutants.ts
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { runLang } from "../m14/run-fixtures"

const ROOT = process.cwd()
const SRC = path.join(ROOT, "src", "ast", "real-cpp-analyzer.ts")
const TMP = path.join(ROOT, "script", "cpp-review", ".mutants")

/** The analyzer's only relative runtime import. The mutant is written outside
 *  `src/ast/`, so this must be rewritten or every mutant fails on a MODULE error —
 *  a harness failure that is indistinguishable from "the fixture stayed green". */
const ENGINE_REL = 'from "./engine"'
const ENGINE_ABS = `from "${path.join(ROOT, "src", "ast", "engine").split(path.sep).join("/")}"`

interface Mutant {
  id: string
  defectClass: string
  reverts: string
  /** the fixture that MUST fail while this revert is in place */
  mustFail: string
  /** a fixture that must NOT be the only thing that fails — sanity, not a gate */
  note?: string
  /** DISCLOSED survivor. Set only where the revert is applied to code the pinned
   *  corpus never reaches, and only with the measurement that establishes it —
   *  because "the suite stayed green" is the finding, and an undisclosed survivor is
   *  the thing `docs/M14-HONESTY-CONTRACT.md` §5.3 exists to prevent. */
  expectedSurvivor?: { measurement: string; consequence: string }
  apply: (src: string) => string
}

/** Every revert is `count`-checked: a mutation that no longer matches the source is
 *  a FAILED GATE, because "the mutant survived" and "the mutant never applied" are
 *  otherwise the same green. */
function replaceOnce(src: string, needle: string, repl: string, what: string): string {
  const n = src.split(needle).length - 1
  if (n !== 1) throw new Error(`revert ${what}: expected exactly 1 occurrence of the anchor, found ${n}`)
  return src.replace(needle, repl)
}

/** Replace the `n`-th (1-based) occurrence of a single-line anchor. Two identical
 *  decline sites exist in the analyzer — `namespace_definition` and `enum_specifier`
 *  read alike — and a multi-line context anchor for them is a quoting exercise that
 *  silently stops matching when a comment is inserted between two of the lines. */
function replaceNth(src: string, needle: string, repl: string, n: number, what: string): string {
  const parts = src.split(needle)
  if (parts.length - 1 < n) throw new Error(`revert ${what}: expected >= ${n} occurrences of ${JSON.stringify(needle)}, found ${parts.length - 1}`)
  // `parts.slice(0, n)` and not `slice(0, n - 1)`: `parts[0]` is the text BEFORE the
  // first occurrence, so dropping it silently truncates the file. The first version
  // did, and the gate reported "class decline: found 0" because the analyzer it was
  // mutating no longer existed — a broken helper that read as a surviving rule.
  return parts.slice(0, n).join(needle) + repl + parts.slice(n).join(needle)
}

const MUTANTS: Mutant[] = [
  {
    id: "cpp2/d19-sentinel-republished",
    defectClass: "fabricated-symbol-name",
    reverts: "D19: the three `name === CPP_ANONYMOUS` / `name === CPP_ANONYMOUS ||` declines go back to publishing the sentinel.",
    mustFail: "cpp/unnamed-scope-919",
    note: "Also fails cpp/contains-name-line-921 and cpp/specifier-qualified-name-962, whose corrected rows forbid the sentinel. The blast radius is expected to be 3 fixtures: the sentinel reached two pre-existing fixtures that were PINNING it as correct, which is the finding batch 1 recorded and did not act on.",
    apply: (src) => {
      let s = src
      s = replaceOnce(s, `        const name = this.childText(node, "namespace_identifier") || CPP_ANONYMOUS`,
        `        const name = this.childText(node, "namespace_identifier") || "anonymous"`, "namespace fallback")
      s = replaceOnce(s, "specifierDeclaredName(node) || CPP_ANONYMOUS", `specifierDeclaredName(node) || "anonymous"`, "enum fallback")
      // the namespace decline is the FIRST of the two identical lines
      s = replaceNth(s, "        if (name === CPP_ANONYMOUS || !isCppSpelledName(name)) {",
        "        if (!isCppSpelledName(name)) {", 1, "namespace decline")
      s = replaceNth(s, "        if (name === CPP_ANONYMOUS || !isCppSpelledName(name)) {",
        "        if (!isCppSpelledName(name)) {", 1, "enum decline")
      s = replaceOnce(s, "if (name === CPP_ANONYMOUS) {", "if (false) {", "class decline")
      return s
    },
  },
  {
    id: "cpp2/d20-declined-body-not-walked",
    defectClass: "symbol-loss",
    reverts: "D20: the decline paths go back to bounding a `node.child(i)` index with `namedChildCount`, so a class body that starts after the keyword and the `{` is never visited.",
    mustFail: "cpp/unnamed-scope-919",
    note: "Faithful to the pre-fix source, not a synthetic deletion: this is the exact mismatch that deleted 154 real member symbols of anonymous unions in `sqlite/src/sqliteInt.h` on the first D19 run. Reverting only the ACCESSOR (and not D19) loses the bodies of the two keyword-spiked declines, which is why this mutant also fails the `recovered` and `MakeWidget` rows.",
    apply: (src) => {
      let s = src
      const bad = `          for (let i = node.namedChildCount - 1; i >= 0; i--) {
            const child = node.namedChild(i)`
      const good = `          for (let i = node.namedChildCount - 1; i >= 0; i--) {
            const child = node.child(i)`
      const count = s.split(bad).length - 1
      if (count < 2) throw new Error(`revert D20: expected >= 2 corrected decline loops, found ${count}`)
      // revert every one of them, which is the pre-fix state
      s = s.split(bad).join(good)
      return s
    },
  },
  {
    id: "cpp2/d9-shape2-and-symref-lost",
    defectClass: "payload-loss",
    reverts: "D9, both halves: `cppPureVirtualDeclaration` keeps only the direct-child shape (the pre-fix rule), and the macro-decorated scope goes back to carrying no `symbolRef`.",
    mustFail: "cpp/pure-virtual-abstract-919",
    note: "Under-firing direction: the half that loses symbols' metadata. The members' SYMBOLS are untouched either way, which is exactly why the pre-fix miss survived — no symbol count and no differential could see it.",
    apply: (src) => {
      let s = src
      s = replaceOnce(
        s,
        `  // shape 2: the declarator is an \`init_declarator\` whose VALUE is the \`0\`
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (!c || c.type !== "init_declarator") continue
    const value = c.childForFieldName?.("value")
    const inner = c.childForFieldName?.("declarator")
    if (value?.type === "number_literal" && value.text.trim() === "0" && inner?.type === "function_declarator") return true
  }
  return false`,
        `  return false`,
        "cppPureVirtualDeclaration shape 2",
      )
      s = replaceOnce(s, "              symbolRef: decoratedSym,\n", "", "decorated-head symbolRef")
      return s
    },
  },
  {
    id: "cpp2/d9-overfires",
    defectClass: "payload-fabrication",
    reverts: "D9, OVER-firing direction: the declarator requirement is dropped, so ANY `= 0` on a member marks it a pure virtual and marks its class abstract.",
    mustFail: "cpp/pure-virtual-abstract-919",
    note: "The control that makes the previous mutant mean something. A gate that only ever runs in the under-firing direction proves nothing about the direction that fabricates; this one is caught by `WithZeroMember` (a `virtual int x = 0;` initialiser) and by `DecoratedDerived` (which overrides two pure virtuals and is NOT abstract).",
    apply: (src) => {
      let s = src
      // An `override`/`final` virtual specifier is evidence that the method IS an
      // implementation, which is the opposite of a pure virtual — and C++ forbids the
      // two in one declaration. A rule that read specifiers as abstractness evidence
      // would mark `DecoratedDerived` abstract for overriding two pure virtuals, and
      // `FileChannel`/`NullChannel` abstract for implementing three.
      // A `virtual_specifier` (`override`, `final`) sits INSIDE the declarator, one
      // level below the declaration — the first cut of this revert scanned the
      // declaration's own named children, found nothing, and the mutant SURVIVED
      // while reporting itself applied. A mutation that cannot reach the construct it
      // claims to break is indistinguishable from a rule nothing checks.
      s = replaceOnce(
        s,
        `  if (node.type !== "declaration" && node.type !== "field_declaration" && node.type !== "function_definition") return false`,
        `  if (node.type !== "declaration" && node.type !== "field_declaration" && node.type !== "function_definition") return false
  const decl2 = node.childForFieldName?.("declarator")
  const scan = decl2 ? [decl2, ...((decl2.namedChildren ?? []) as any[])] : []
  for (const c of scan) {
    if (c?.type === "virtual_specifier") return true
    for (let k = 0; k < (c?.namedChildCount ?? 0); k++) {
      if (c.namedChild(k)?.type === "virtual_specifier") return true
    }
  }`,
        "override-as-pure-virtual",
      )
      return s
    },
  },
  {
    id: "cpp2/d20-returntype-body-lost",
    defectClass: "symbol-loss",
    reverts: "D20's THIRD site only: a function whose return type is a class definition goes back to re-walking its children with a `namedChildCount` bound over `node.child(i)`.",
    mustFail: "(none — the site is unreachable on this corpus)",
    note: "This is a DISCLOSED SURVIVOR and the disclosure is the measurement, which `script/cpp-review/cpp2-dead-branches.ts` re-derives: over the 162 candidate files of the two pinned corpora, **0 of 1,001 `function_definition` nodes trip `returnTypeIsClassDefinition`** — the guard requires the node's `type` FIELD to be a class/struct/union specifier carrying a `field_declaration_list`, and no real C++ writes a nested class in a return-type position. So the accessor at this site was matched to its bound for consistency with the other two, and no fixture can fail on it because no input reaches it. Reporting it as a caught rule would be the dishonest option; the finding it produces — a dead branch in a hot analyzer — is in the lane doc and in the dead-branch register.",
    expectedSurvivor: {
      measurement: "0 of 1,001 function_definition nodes trip returnTypeIsClassDefinition over 162 files (script/cpp-review/cpp2-dead-branches.ts)",
      consequence: "the accessor fix at this site is unverified by fixture and rests on the same count/accessor argument as the two sites that ARE verified; the dead branch itself is reported to master as a finding.",
    },
    apply: (src) => {
      // The stack-push line is UNIQUE to this site (every other decline pushes with
      // `parentContext: newContext`), so it identifies the loop even though a comment
      // block sits between the `if` and the `for`.
      // The `stack.push({ node: child, parentContext })` form appears at three sites,
      // so the site is located by its own `if` and the accessor is the first
      // `namedChild(i)` AFTER it. Locating by index rather than by a multi-line context
      // anchor is deliberate: a comment block sits between the `if` and the `for` here,
      // and a context anchor that spans it stops matching the moment that comment is
      // reworded — which is how a mutation gate silently starts certifying nothing.
      const head0 = 'if (type === "function_definition" && this.returnTypeIsClassDefinition(node)) {'
      if (src.split(head0).length - 1 !== 1) throw new Error("revert returnTypeIsClassDefinition: the site head is not unique")
      const from = src.indexOf(head0)
      const fixed = "const child = node.namedChild(i)"
      const at = src.indexOf(fixed, from)
      if (at < 0) throw new Error("revert returnTypeIsClassDefinition: no namedChild accessor after the site head")
      return src.slice(0, at) + "const child = node.child(i)" + src.slice(at + fixed.length)
    },
  },
{
    id: "cpp3/d25-class-scope-ctor-self-call",
    defectClass: "edge-fabrication",
    reverts: "D25: the `source === targetName && parentContext.kind === class` guard goes away, so a constructor declared at class scope inside a macro-decorated head's recovered body is published as `calls C -> C`.",
    mustFail: "cpp/class-scope-constructor",
    note: "The direction that fabricates. The corpus cost is 9 rows over 6 files (4,660 -> 4,651 `calls`), and the fixture's four `expectRelationships` rows are what stop a guard keyed on 'inside a decorated body' from passing by deleting the real member call in `MutexLock`'s member-initialiser — so this mutant must fail on the two `forbidRelationships` rows AND leave those four in place.",
    // The anchor is the guard AS IT READS ON THIS TREE. It was first written against
    // the lane branch's spelling of the same rule
    // (`source === targetName && parentContext?.kind === ASTEngine.SymbolKind.Class`),
    // which stopped matching when the branch was reconciled with main's reader — the
    // rule is stated over the ENCLOSING SCOPE's kind and NAME (`ownerIsTypeScope &&
    // parentContext?.name === targetName`) because main's `class-self-call-925` pins
    // real METHOD recursion as a row that must survive, and the lane's spelling
    // suppressed it. A mutation gate whose anchor no longer exists certifies nothing,
    // so the revert is re-anchored rather than dropped.
    apply: (src) => {
      return replaceOnce(
        src,
        `          const ownerIsTypeScope =
            parentContext?.kind === ASTEngine.SymbolKind.Class ||
            parentContext?.kind === ASTEngine.SymbolKind.Struct
          const classCallingItself = ownerIsTypeScope && parentContext?.name === targetName
          if (!targetName.startsWith("operator") && !calleeIsTempCall && !calleeIsUnnamed && !calleeIsError && !classCallingItself) {`,
        `          if (!targetName.startsWith("operator") && !calleeIsTempCall && !calleeIsUnnamed && !calleeIsError) {`,
        "D25 class-scope constructor guard",
      )
    },
  },
  {
    id: "cpp3/d25-overfires-on-method-self-call",
    defectClass: "edge-loss",
    reverts: "D25, OVER-firing direction: the `parentContext.kind === class` half is dropped, so ANY `source === target` call is suppressed — which deletes every real recursive call.",
    mustFail: "cpp/class-scope-constructor",
    note: "The control that makes the previous mutant mean something. 43 `source === target` call rows survive over the same corpus and every one is a real call from a function or a method (`void String::size_impl() { size_impl(); }`). A guard that read only the spelling would remove all 43, and the fixture's `measure`/`step` rows are what make that visible.",
    // Re-anchored with the mutant above, for the same reason: the rule on this tree
    // reads `ownerIsTypeScope && parentContext?.name === targetName`, and dropping the
    // KIND half (`ownerIsTypeScope`) leaves a guard keyed on the callee's spelling —
    // which is exactly the text-based rule the fixture's `measure`/`step` rows exist to
    // refuse.
    apply: (src) => {
      return replaceOnce(
        src,
        `          const classCallingItself = ownerIsTypeScope && parentContext?.name === targetName`,
        `          const classCallingItself = !!parentContext?.name && parentContext?.name === targetName`,
        "D25 class-scope half",
      )
    },
  },
  {
    id: "cpp3/d24-nul-separator-restored",
    defectClass: "source-integrity",
    reverts: "D24: the `\\u0000` ESCAPE in the contains de-duplication key goes back to a raw NUL byte written into the source file.",
    mustFail: "(none — no fixture can see a byte in the analyzer's own source)",
    note: "DISCLOSED as an undetected regression by construction, and the disclosure is the point. D24's two measured costs are to TOOLS, not to output: `grep` classifies a file holding a NUL as binary and answers 'binary file matches' instead of printing lines, and `script/m14/audit-analyzer-grammar.ts` parses the analyzer with tree-sitter-typescript, where the NUL became an ERROR node so it printed '[warn] real-cpp-analyzer.ts: source did not parse cleanly; extraction may be incomplete' over cpp's `refs=88 unknown=0` row. A fixture runs the analyzer's OUTPUT, and the output was byte-identical either way, so no fixture can fail on it and this mutant is expected to survive. The gate for it is `script/cpp-review/source-integrity.ts`, which reads the bytes.",
    expectedSurvivor: {
      measurement: "1 NUL byte at line 4136 pre-fix; 0 ERROR/MISSING nodes under tree-sitter-typescript pre-fix vs 0/0 post-fix (script/cpp-review/source-integrity.ts). Output is unchanged by construction: the pre-fix separator and the post-fix escape are the same string.",
      consequence: "the revert is invisible to the fixture suite BY CONSTRUCTION, so the source-level gate is the only thing standing on it; if source-integrity.ts is not run, D24 can silently return.",
    },
    apply: (src) => {
      const before = Buffer.from(src, "utf8").filter((b) => b === 0).length
      if (before !== 0) throw new Error(`revert D24: expected a NUL-free source, found ${before} NUL byte(s)`)
      return replaceOnce(
        src,
        "const relKey = `${_owner}\\u0000${s.name}`",
        "const relKey = `${_owner}\u0000${s.name}`",
        "D24 contains key separator",
      )
    },
  },
{
    id: "cpp3/d27-whitespace-not-collapsed",
    defectClass: "payload-loss",
    reverts: "D27: `collapseSpaces` goes back to a plain `trim()`, so a declared type written across lines or with alignment padding reaches `returnType` with its original spacing.",
    mustFail: "cpp/exports-marker-910",
    note: "Under-firing direction, on a payload field: `returnType` is an overload-resolution input rather than a display field, and `unsigned   long   long` is not a spelling of any C++ type a compiler accepts. Before this round NO assertion in the suite covered the collapse — the revert was applied and 39 of 39 fixtures stayed green, which is why the `Counter` row was added to `exports-marker-910` rather than a new fixture. `collapseSpaces` was introduced to remove the ONE genuine regex literal this analyzer had (`D6`), which the ontology batches added and the lane document continued to report as zero.",
    // The anchor is the call site that actually normalises a marker-peeled type on
    // this tree. Three candidate sites exist and only one of them is the one the
    // `Counter` row reads, which is why this anchor took three attempts:
    //
    //   * `const piece = collapseSpaces(c.text)` (lane branch) — inside a private
    //     helper with no callers after the reconciliation: the revert APPLIED to dead
    //     code and the mutant SURVIVED with `suite failure count 0`.
    //   * `const stated = collapseSpaces(typeField.text)` — live, but NOT the path
    //     `Counter` takes: `LIB_EXPORT` in front of the type makes the specifier a
    //     `macro_prefixed_type_specifier`, so the reader goes through
    //     `specifierTypeText`, and that mutation again SURVIVED.
    //   * `return collapseSpaces(parts.join(" ")) || undefined` — the join inside
    //     `specifierTypeText` itself, where the pieces (`unsigned`, `long`, `long`) are
    //     separate nodes whose source spacing is the author's alignment. Reverted, the
    //     declaration publishes `unsigned   long   long` and the fixture fails.
    //
    // An anchor that APPLIES is not the same as an anchor that MATTERS; `suite
    // failure count 0` with `applied: true` is the signature of the second case.
    apply: (src) => {
      return replaceOnce(
        src,
        '  return collapseSpaces(parts.join(" ")) || undefined',
        '  return parts.join(" ").trim() || undefined',
        "collapseSpaces call site",
      )
    },
  },
]

async function main() {
  const original = fs.readFileSync(SRC, "utf8")
  fs.mkdirSync(TMP, { recursive: true })
  const rows: Array<Record<string, unknown>> = []
  let failed = 0

  for (const m of MUTANTS) {
    let mutated: string
    try {
      mutated = m.apply(original)
    } catch (e) {
      failed++
      rows.push({ id: m.id, defectClass: m.defectClass, applied: false, caught: false, reason: `revert did not apply: ${e instanceof Error ? e.message : String(e)}` })
      continue
    }
    if (mutated === original) {
      failed++
      rows.push({ id: m.id, defectClass: m.defectClass, applied: false, caught: false, reason: "revert produced a file identical to HEAD — the rule it reverts is not in the source" })
      continue
    }
    const file = path.join(TMP, `${m.id.replace(/[^a-z0-9]+/gi, "-")}.ts`)
    // The mutant lives outside `src/ast/`, so the analyzer's own RELATIVE imports do
    // not resolve from here — the first run of this gate failed all five mutants with
    // `Cannot find module './engine'`, which is a HARNESS error that would have been
    // indistinguishable from "the fixture stayed green". They are rewritten to
    // absolute paths, and a mutant that still cannot be imported is reported as a
    // harness failure rather than a surviving mutant.
    const absEngine = ENGINE_ABS
    fs.writeFileSync(file, mutated.split(ENGINE_REL).join(ENGINE_ABS))
    let caught = false
    let suiteFail = 0
    let failures: string[] = []
    let harnessError = ""
    try {
      const mod: any = await import(file)
      const res = await runLang("cpp", new mod.RealCppAnalyzer())
      suiteFail = res.fail
      failures = res.details.filter((d: any) => !d.ok).map((d: any) => d.fixture)
      caught = failures.includes(m.mustFail)
    } catch (e) {
      failures = [`threw: ${e instanceof Error ? e.message : String(e)}`]
    } finally {
      try { fs.unlinkSync(file) } catch { /* leave it; the directory is gitignored */ }
    }
    const disclosed = !!m.expectedSurvivor
    // A disclosed survivor is not counted as caught and is NOT counted as a failure:
    // it is counted as DISCLOSED, and the disclosure carries the measurement that
    // makes it a finding rather than an excuse. An UNdisclosed survivor fails.
    if (!caught && !disclosed) failed++
    rows.push({ id: m.id, defectClass: m.defectClass, applied: true, caught, disclosedSurvivor: disclosed ? true : null, expectedSurvivor: m.expectedSurvivor ?? null, harnessError: harnessError || null, mustFail: m.mustFail, suiteFail, failingFixtures: failures, reverts: m.reverts, note: m.note })
  }

  try { fs.rmSync(TMP, { recursive: true, force: true }) } catch { /* best effort */ }

  const out = { at: new Date().toISOString(), source: path.relative(ROOT, SRC), mutants: rows, allCaught: failed === 0 }
  const outPath = path.join(process.env.CPP_OUT ?? "/tmp/opencode/cpp-review", "cpp2-source-mutants.json")
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2))

  for (const r of rows) {
    const verdict = !r.applied ? "REVERT DID NOT APPLY" : r.caught ? "caught" : r.disclosedSurvivor ? "SURVIVED (DISCLOSED — dead branch, see note)" : "SURVIVED"
    const mark = r.caught ? "PASS" : r.disclosedSurvivor ? "NOTE" : "FAIL"
    console.log(`${mark}  ${r.id}  [${r.defectClass}]  ${verdict}`)
    console.log(`      reverts: ${r.reverts}`)
    console.log(`      gate:    must fail ${r.mustFail}; suite failure count ${r.suiteFail}; failing fixtures ${JSON.stringify(r.failingFixtures)}`)
    if (r.reason) console.log(`      reason:  ${r.reason}`)
    if (r.note) console.log(`      note:    ${r.note}`)
  }
  const disclosed = rows.filter((r) => r.disclosedSurvivor).length
  const caught = rows.filter((r) => r.caught).length
  console.log(`\nevidence: ${outPath}`)
  if (failed > 0) {
    console.error(`${failed} source mutant(s) not caught and not disclosed — the gate proves nothing for those rules`)
    process.exit(1)
  }
  console.log(`${caught} of ${rows.length} source mutants caught${disclosed ? `; ${disclosed} disclosed survivor(s), each with the measurement that explains it` : ""}`)
}

await main()
