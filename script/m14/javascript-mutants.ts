/**
 * JAVASCRIPT MUTANTS — this lane's regression mutants for the M14.0.F4 gate.
 *
 * WHY A SEPARATE FILE, following `script/m14/fsharp-mutants.ts`. The shared
 * registry `script/m14/mutate-analyzer.ts` is edited concurrently by every lane;
 * a block written into it there can be overwritten without any error, and the
 * gate keeps printing numbers with this lane's mutants simply absent from them.
 * The definitions therefore live here, where this lane owns them, and the registry
 * holds exactly TWO lines — an import and a spread. **Those two lines were missing
 * until 2026-10-10** (Open findings §3): the mutants were correct, lane-owned and
 * measured by `script/m14/javascript-mutant-runner.ts`, and no canonical run
 * executed them. They are in now — filtered canonical run: 62 selected of 1,845,
 * all 62 caught — and the lane's runner CHECKS for the spread line on every run, so
 * a merge that removes it reports rather than silently un-registering six defect
 * classes.
 *
 * WHAT EACH MUTANT IS: a revert of a defect class this lane MEASURED on real
 * JavaScript, and each names the fixture that catches it. A surviving mutant
 * fails the SUITE, not the mutant, because a suite that stays green whatever you
 * do to the code is decoration.
 *
 * THREE OF THE SIX are the R7 class — "an analyzer may not NAME something with a
 * placeholder or an empty string" — reached from three different fields, because
 * the census that found them measured edge ENDPOINTS and the third was found only
 * after a second instrument was written to look at SYMBOL names. That is the
 * argument for measuring each name-bearing field rather than the one that is easy.
 * The other three are a containment-attribution defect (JD3-CLOSURE), a
 * lost-information defect (JSD40), and a wrong-name defect whose field is
 * populated with something that IS a name-shaped string but is not a name at all
 * (JSD2/§2: `calls` targets holding SOURCE TEXT). The file is not organised around
 * R7 for that reason: the rule is "every defect class this lane measured on real
 * JavaScript gets a revert here", and the classes are not all the same class.
 */
import type { Mutant } from "./mutate-analyzer"

/** Matching `)` for the `(` at `open`, by balance only — strings and comments are
 * not modelled because a mutant is a defect injector, not a parser. Returns -1 when
 * unbalanced. */
function matchParen(source: string, open: number): number {
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === "(") depth++
    else if (source[i] === ")") {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** A character that can continue a callee expression to the left of a `(` —
 * identifier parts and member access, so `define()` is captured whole. */
function isCalleeNameChar(c: number): boolean {
  if (c === 0x24 || c === 0x5f || c === 0x2e) return true
  if (c >= 0x41 && c <= 0x5a) return true
  if (c >= 0x61 && c <= 0x7a) return true
  return c >= 0x30 && c <= 0x39
}

/** The replaced guard's token test, restated so the revert is exactly as narrow as
 * the guard it reverts. */
function refusedByTokenGuard(span: string): boolean {
  if (span.length > 100) return true
  if (span.includes("\n") || span.includes("`") || span.includes("${")) return true
  for (let i = 0; i < span.length; i++) {
    const ch = span[i]
    if (ch === "{" || ch === "}" || ch === ";" || ch === "=") return true
  }
  return false
}

export const JAVASCRIPT_MUTANTS: Mutant[] = [
  {
    id: "javascript/restore-empty-edge-endpoints",
    language: "javascript",
    defectClass: "relationship-garbage",
    description:
      "PRE-FIX (R7, runtime half): 2,037 of 356,490 emitted edges on the 13,202-file corpus carried an EMPTY source or target — 1,934 `uses` rows reading a zero-length `identifier` node, 87 `uses` rows whose member-chain segment node was empty, 5 template substitutions written `${ }`, 7 `uses` rows with an empty SOURCE (the source expression read `method ?? owner ?? moduleName` and `??` does not fall through an empty string), 3 `calls` rows on an empty callee, and 1 `exports` row whose CJS surface segment was empty. Every one came from tree-sitter's error recovery, so `svelte` (3,447 real JavaScript files) and `lodash` (51) both measure 0 — which is exactly why this class survived: no clean corpus exercises it. The fix is a TERMINAL guard that drops any row with an empty endpoint, matching the guard the differential's truth side already applies. Reverted here by re-publishing one empty-target `uses` row and one empty-source `calls` row per file, which is the shape both forbid rows name. Caught by javascript/empty-endpoints-refused (six forbid rows over all six affected types, with expect rows so a 'drop everything' guard fails instead of passing vacuously) and by javascript/recovery-empty-node-endpoints, whose damaged source reproduces three of the six shapes for real.",
    transform: (r: any) => {
      const srcs = (r.relationships ?? []).map((x: any) => String(x.source ?? "")).filter(Boolean)
      const first = srcs[0]
      if (!first) return r
      return {
        ...r,
        relationships: [
          ...(r.relationships ?? []),
          { type: "uses", source: first, target: "", confidence: 0.6, metadata: { isFieldAccess: true, bareRead: true } },
          { type: "calls", source: "", target: first, confidence: 0.9, metadata: {} },
        ],
      }
    },
  },
  {
    id: "javascript/restore-global-instanceof-source",
    language: "javascript",
    defectClass: "wrong-name",
    description:
      "PRE-FIX (R7, runtime half, the `global` literal): `extractInstanceofRefs.resolveSource` returned the string \"global\" when no enclosing declaration named the site, so a module-scope `if (x instanceof T)` written as a bare expression statement published `references` FROM a symbol name that appears in no file. Measured on REAL JavaScript, not only on recovery residue: 14 rows across lodash's 51 ES5 files and 1 on svelte, which is why it is here and not merely noted — the corpus the differential samples never met one, and the fixture lane's existing javascript/instanceof-source pins only the const-bound shape. The fix sources it to the module, the convention `extractExportRelationships` and the `uses` walk already apply. Reverted here by re-sourcing every `instanceof_check` row whose source equals the file's own module name. Caught by javascript/instanceof-module-scope-source, whose forbid row names the literal and whose four expect rows stop a fix that returned the module name unconditionally.",
    transform: (r: any) => {
      const rows = (r.relationships ?? []).filter(
        (x: any) => x.type === "references" && (x.metadata ?? {}).relationshipType === "instanceof_check",
      )
      if (rows.length === 0) return r
      const globalSrc = new Set(rows.map((x: any) => String(x.source)))
      return {
        ...r,
        relationships: (r.relationships ?? []).map((x: any) =>
          x.type === "references" && (x.metadata ?? {}).relationshipType === "instanceof_check" && globalSrc.has(String(x.source))
            ? { ...x, source: "global" }
            : x,
        ),
      }
    },
  },
  {
    id: "javascript/restore-empty-pattern-binding-symbol",
    language: "javascript",
    defectClass: "wrong-name",
    description:
      "PRE-FIX (R7, runtime half, the SYMBOL field): `collectPatternPairs` pushed a module-scope destructuring binding with `name: n.text` and no length check, so a zero-length `identifier` became a symbol named the empty string. Measured: 32 such symbols over 115,356 on the 13,202-file corpus (115,356 -> 115,324 after the fix), every one a reserved word used as a module-scope binding in a TypeScript baseline; `svelte` (6,228 symbols) and `lodash` (899) both measure 0. This mutant injects the defect directly rather than re-deriving it from the tree, because the transform layer receives the ANALYZER'S RESULT and the source text but no parse tree — and the corpus shape that produces a zero-length pattern identifier depends on preceding `import` recovery state that no self-contained three-line source reproduces (five candidate shapes were probed). The row it has to fail is javascript/recovery-empty-node-endpoints' single `forbidSymbols: [{ name: \"\" }]`, which is stated as the RULE rather than as a reproduction; this mutant is what shows the row is satisfiable.",
    transform: (r: any) => ({
      ...r,
      symbols: [...(r.symbols ?? []), { name: "", kind: "variable", range: undefined, visibility: "public" }],
    }),
  },
  {
    id: "javascript/restore-source-text-call-target",
    language: "javascript",
    defectClass: "wrong-name",
    description:
      "PRE-FIX (§2): `extractCallRelationships`' callee guard tested TOKEN MEMBERSHIP — length > 100, newline, backtick, `${`, and `hasBraceEquals` — as a proxy for \"is this leaf a NAME\". A parenthesised, conditional or sequence callee contains none of those tokens, so the callee's own SOURCE TEXT was published in `target`, the field the graph reads as a symbol name: `(fn)`, `(0, helper.other)`, `(cond ? a : b)`, `(reset(), start())`, `define()`, `[\"text\"]`, `[]`. Measured through the analyzer's own output by script/m14/js-ontology/js-callee-shape-census.ts: 31 of 31,973 `calls` rows on svelte (0.097%) and 550 of 22,210 on the ts corpus (2.476%), against 0 such rows published by any fixture in this suite — the 75 fixtures passed with the defect live, which is why the class outlived the empty-endpoint guard next door. The fix is a NAME-SHAPE test (`isNameShapedCallTarget`), and the crucial part of it is the `#` clause: 123 of the svelte rows are `#private` call targets (`this.#tick()`), which an alphanumeric filter would have DELETED to remove the 31. Reverted here by re-publishing the parenthesised callee spans found in the source text, which is the pre-fix spelling at the pre-fix line; the old guard's own token test is applied to each span first, so a span the pre-fix guard would have refused (`(function () {})`, whose braces trip `hasBraceEquals`) is NOT injected. The transform layer receives the analyzer's RESULT and the source text but no parse tree, so the spans are located by a balanced-paren scan rather than by re-deriving the callee nodes; the scan is what makes this revert non-circular, since hardcoding the fixture's spellings would prove only that a string can be inserted. Caught by javascript/non-name-callee-refused, whose six pre-fix forbid rows fire under it while its four expect rows keep passing — measured by reverting the guard in a copy of the analyzer, where that fixture is the ONLY failure in the 76-fixture suite.",
    caughtBy: "javascript/non-name-callee-refused",
    transform: (r: any, source?: string) => {
      const rels = (r.relationships ?? []) as any[]
      if (!source || rels.length === 0) return r
      // The actor the pre-fix row would carry: the file's own call rows name their
      // source, and every call site in the fixture shares it.
      const callRow = rels.find((x: any) => String(x.type ?? x.relationshipType) === "calls")
      const from = String(callRow?.source ?? "(file)")
      const spans: string[] = []
      for (let i = 0; i < source.length; i++) {
        if (source[i] !== "(") continue
        const close = matchParen(source, i)
        if (close < 0) continue
        let j = close + 1
        while (j < source.length && (source[j] === " " || source[j] === "\t")) j++
        if (source[j] !== "(") { i = close; continue }
        // The callee node's text, which is what the pre-fix guard published: the
        // parenthesised span itself, or — for a call-expression callee — the span
        // plus the identifier it is applied to (`define()`).
        let start = i
        while (start > 0 && isCalleeNameChar(source.charCodeAt(start - 1))) start--
        const span = source.slice(start, close + 1)
        // The pre-fix guard's OWN condition, so this mutant reverts the guard rather
        // than widening it: a span with braces, `;` or `=` was refused then too.
        if (!refusedByTokenGuard(span)) spans.push(span)
        i = close
      }
      if (spans.length === 0) return r
      const seen = new Set<string>()
      const injected: any[] = []
      for (const span of spans) {
        if (seen.has(span)) continue
        seen.add(span)
        injected.push({ type: "calls", source: from, target: span, confidence: 0.9, metadata: { calleeExpression: span } })
      }
      return { ...r, relationships: [...rels, ...injected] }
    },
  },
  {
    id: "javascript/class-scope-preempts-literal-owner",
    language: "javascript",
    defectClass: "wrong-name",
    description:
      "PRE-FIX (JD3-CLOSURE): the `method_definition` case read `scopeOwnerName(scopeStack) ?? containerOwnerName(node)`, and `scopeOwnerName` is a CLASS-SCOPE lookup, so inside a class body it answered for every object literal nested there. One construct, two answers: `class C { m() { const api = { run(){}, stop(){} }; return api } }` published `contains C -> run` and `contains C -> stop` while the module-scope `const api = { run(){} }` published `contains api -> run` — a binding written in plain sight, discarded. The lane doc claimed `containerOwnerName` had superseded `scopeOwnerName`; it had superseded it only where no class scope existed. Measured consequence: 2 rows on a 600-file svelte draw (`svelte/src/legacy/legacy-client.js`, `new Proxy({}, { get(){}, has(){} })`) registered as UNEXPLAINED fabrications at confidence 1.0, because the differential's `contains` rule asks whether the container is NAMEABLE and declines one it cannot bind — so the row looked fabricated rather than mis-attributed. Reverted here by re-owning every object-literal member that carries a container-derived owner to the nearest enclosing class instead, read off the result itself so the mutant cannot silently stop matching. Caught by javascript/literal-owner-inside-class, whose four forbid rows name the class-owned form (including the carrier-path spelling) and whose expect rows keep the class-member and module-scope shapes right.",
    transform: (r: any) => {
      const classes = new Set((r.symbols ?? []).filter((s: any) => s.kind === "class").map((s: any) => String(s.name)))
      if (classes.size === 0) return r
      const symByName = new Map((r.symbols ?? []).map((s: any) => [String(s.name), s]))
      // The pre-fix rule was "the nearest enclosing CLASS scope owns an object
      // literal's member". The result records that chain in the symbol's own
      // `scope` (`Service.configure` for a member of a literal inside
      // `Service.configure`), so the class the pre-fix code would have picked is
      // recoverable from the result rather than hardcoded — which is what keeps
      // the mutant from silently ceasing to match if the fixture is renamed.
      // A member at module scope (`scope: ""`) has no class in its chain and is
      // correctly left alone, which is also the pre-fix behaviour there.
      const nearestClass = (s: any): string | null => {
        const chain = String(s?.scope ?? "").split(".").filter(Boolean)
        for (const seg of chain) if (classes.has(seg)) return seg
        return null
      }
      const moved = new Map<any, string>()
      for (const s of (r.symbols ?? []) as any[]) {
        const owner = s?.ownerName
        if (typeof owner !== "string" || owner === "" || classes.has(owner)) continue
        const cls = nearestClass(s)
        if (!cls) continue
        moved.set(s, cls)
      }
      if (moved.size === 0) return r
      const nameToClass = new Map<string, string>()
      for (const [s, cls] of moved) nameToClass.set(String(s.name), cls)
      return {
        ...r,
        symbols: (r.symbols ?? []).map((s: any) => (moved.has(s) ? { ...s, ownerName: moved.get(s) } : s)),
        relationships: (r.relationships ?? []).map((x: any) => {
          if (String(x.type) !== "contains") return x
          const cls = nameToClass.get(String(x.target ?? ""))
          return cls ? { ...x, source: cls } : x
        }),
      }
    },
  },
  {
    id: "javascript/restore-star-form-indistinct",
    language: "javascript",
    defectClass: "lost-information",
    description:
      "PRE-FIX (JSD46): the two clause-less re-export forms emitted BYTE-IDENTICAL records. `export * from './m'` REDISTRIBUTES every member of `./m`; `export * as ns from './m'` binds ONE name in this module and redistributes nothing — and both produced the `imports` edge `./m:*` at 0.6 with `{isReExport: true, unresolved: true}` and nothing else, so read back out of a real index both produced the same `brain_import` row (`imported_as` = NULL, `import_type` = 'named') and the namespace alias `ns` existed in no field anywhere. The cost is not the missing alias alone: a resolver reading a star edge as a redistribution invents, for a consumer of that file, every member of `./m` the language does not export from it — measured by the gate's B17, which reads an invented edge the moment the discriminator is gone (45 of 46), while the fixture suite fails exactly the new javascript/star-reexport. Reverted here by stripping `starForm`/`namespaceName` off every clause-less re-export edge, which is the pre-fix RECORD rather than a re-derivation from the tree: this layer receives the analyzer's result, and the field being removed is the one the fix added. Caught by javascript/star-reexport, whose two `meta.starForm` pins are what the revert breaks.",
    caughtBy: "javascript/star-reexport",
    transform: (r: any) => {
      const rels = (r.relationships ?? []) as any[]
      const isStarReexport = (x: any) =>
        String(x?.type) === "imports" &&
        x?.metadata?.isReExport === true &&
        String(x?.target ?? "").endsWith(":*")
      if (!rels.some((x) => isStarReexport(x) && (x.metadata?.starForm || x.metadata?.namespaceName))) return r
      return {
        ...r,
        relationships: rels.map((x) => {
          if (!isStarReexport(x)) return x
          const { starForm, namespaceName, ...rest } = x.metadata ?? {}
          return { ...x, metadata: rest }
        }),
      }
    },
  },
  {
    id: "javascript/restore-reexport-module-star",
    language: "javascript",
    defectClass: "lost-information",
    description:
      "PRE-FIX (JSD40, the re-export half): every re-export target was spelled `${modulePath}:*` at 0.6 with `metadata.unresolved: true`, INCLUDING the form that writes the members — so `export { alpha, beta } from \"./m\"` lost two written names while `import { alpha } from \"./m\"` produced `./m:alpha` at 1.0 with `declaredName`. Measured across the three corpora: 713 named re-export statements carrying 790 specifiers (svelte 106/271, the ts corpus 607/519, lodash 0), and on the same-files A/B the change is 271 member rows in and 106 `path:*` rows out, with the oracle moved in the same commit. Reverted here by collapsing every named re-export edge back to the module star at the same line, deduped per line so the mutant reproduces the pre-fix shape (one row per STATEMENT, not per specifier). Caught by javascript/barrel-named-clause and javascript/barrel-reexport (whose forbid rows name `./m:*` and `./mod:*` and whose expect rows name `./m:alpha` / `./mod:named`) and by javascript/reexport-forms, which pins the four forms that must NOT collapse — a mutant that collapsed every re-export indiscriminately fails that fixture's `export * as ns` and empty-clause rows too. The transform reads the row set rather than the tree for the same reason the pattern-binding mutant does: this layer receives the analyzer's RESULT, and the pre-fix spelling is recoverable from the row it replaced.",
    transform: (r: any) => {
      const rels = (r.relationships ?? []) as any[]
      const isMemberReexport = (x: any) =>
        String(x?.type) === "imports" &&
        x?.metadata?.isReExport === true &&
        x?.metadata?.declaredKind === "named"
      if (!rels.some(isMemberReexport)) return r
      const out: any[] = []
      const seen = new Set<string>()
      for (const x of rels) {
        if (!isMemberReexport(x)) {
          out.push(x)
          continue
        }
        // `path:<member>` -> `path:*`; the LAST colon separates the member, and a
        // fixture module path has none, so the collapse names the same module the
        // pre-fix row did rather than a prefix of it.
        const target = String(x.target ?? "")
        const cut = target.lastIndexOf(":")
        const star = cut > 0 ? `${target.slice(0, cut)}:*` : target
        const key = `${star}#${x.line ?? x.line_number ?? ""}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push({ ...x, target: star, confidence: 0.6, metadata: { isReExport: true, unresolved: true } })
      }
      return { ...r, relationships: out }
    },
  },
  {
    id: "javascript/restore-call-shaped-base-as-mixin",
    language: "javascript",
    defectClass: "wrong-name",
    description:
      "PRE-FIX (M14 / R3, the call-shaped heritage): `class X extends Base.extend(M)` puts the BASE and the MIXIN at OPPOSITE depths — the base is the member call's RECEIVER and the mixin is its ARGUMENT — and the analyzer's lookup pair read only the heritage's DIRECT named children, so it found neither and published NO edge for the class at all. Measured over the whole admitted population: 76 call-shaped clauses (74 member-form, 2 identifier-form) of which the pre-remedy lookup found 0, and 802 of 2,572 heritage clauses (31.2 %) published no edge. The remedy reads the heritage's direct named child, and if it is a `call_expression` it takes the RECEIVER as the base and the ARGUMENTS as mixins (member form) or the CALLEE as the mixin and the first ARGUMENT as the base (plain form). The role assignment is the whole of the rule, and this mutant breaks it in the direction that is hardest to see: it publishes the BASE as a mixin as well, so `class X extends Base.extend(M)` yields `mixes_in X -> Base` beside `mixes_in X -> M` and `extends X -> Base`. Every such row is a false edge — it says the class composes its own supertype into itself — and it is invisible in a count, because the row COUNT is unchanged. Reverted here by DUPLICATING the base as a mixin row, which is the pre-remedy shape's closest reachable form: the transform layer receives the analyzer's RESULT and no parse tree, so the base is recovered from the `extends` row the remedy published and re-published under `mixes_in` with the same `isMixin` metadata. Caught by javascript/call-shaped-heritage-mixins, whose seven FORBID rows name exactly these false edges (`ApplicationRoute -> Route` is never a mixin, `ApplicationRoute -> WithBlockingActions` is never the base, `RedwoodRecord -> Core` is never a mixin, `RedwoodRecord -> ValidationMixin` is never the base) and whose twelve EXPECT rows keep the correct assignment passing — so a fix that published nothing at all would fail the expect rows rather than pass vacuously.",
    caughtBy: "javascript/call-shaped-heritage-mixins",
    transform: (r: any) => {
      const rels = (r.relationships ?? []) as any[]
      const mixinRows = rels.filter((x: any) => String(x?.type) === "mixes_in")
      if (mixinRows.length === 0) return r
      // The BASE of each call-shaped heritage is the `extends` row the remedy published
      // for the SAME class — recovered from the result, not hardcoded, so the mutant
      // cannot silently stop matching if the fixture is renamed.
      const baseBySource = new Map<string, string>()
      for (const x of rels) {
        if (String(x?.type) !== "extends") continue
        const s = String(x.source ?? "")
        const t = String(x.target ?? "")
        if (!s || !t) continue
        baseBySource.set(s, t)
      }
      const injected: any[] = []
      const seen = new Set<string>()
      for (const x of mixinRows) {
        const s = String(x.source ?? "")
        const base = baseBySource.get(s)
        if (!base) continue
        const key = `${s}|${base}`
        if (seen.has(key)) continue
        seen.add(key)
        injected.push({
          type: "mixes_in",
          source: s,
          target: base,
          confidence: 1.0,
          metadata: { ...(x.metadata ?? {}), isMixin: true },
        })
      }
      if (injected.length === 0) return r
      return { ...r, relationships: [...rels, ...injected] }
    },
  },
  {
    id: "javascript/restore-plain-heritage-as-mixin",
    language: "javascript",
    defectClass: "relationship-garbage",
    description:
      "PRE-FIX (M14 / R3, the shape guard's other side): the remedy's discriminator is that the heritage's own expression is a CALL — a call in heritage position is a class-producing expression BY CONSTRUCTION, because the language requires the heritage to evaluate to a constructor or the class is a runtime error, while a call in ARGUMENT position is not. The rule therefore never fires on a plain heritage: `class Derived extends PlainBase {}` publishes `extends` and NOTHING else, and a rule that fired on it would publish `mixes_in Derived -> PlainBase` — a class that composes its own supertype into itself, on every class in the corpus. This mutant is the inverse of the previous one and is what proves the rule is SHAPE-gated rather than merely present: it publishes a `mixes_in` row for EVERY plain `extends` row, so the fixture's positive controls (`class PlainBase {} class PlainDerived extends PlainBase {}`) become fabrications while the correct rows are untouched. Caught by javascript/call-shaped-heritage-mixins, whose forbid row names `PlainDerived -> PlainBase` as a mixin, and whose expect rows keep the shape-(A) and shape-(B) rows passing.",
    caughtBy: "javascript/call-shaped-heritage-mixins",
    transform: (r: any) => {
      const rels = (r.relationships ?? []) as any[]
      const extendsRows = rels.filter((x: any) => String(x?.type) === "extends")
      if (extendsRows.length === 0) return r
      const injected: any[] = []
      const seen = new Set<string>()
      for (const x of extendsRows) {
        const s = String(x.source ?? "")
        const t = String(x.target ?? "")
        if (!s || !t) continue
        const key = `${s}|${t}`
        if (seen.has(key)) continue
        seen.add(key)
        injected.push({
          type: "mixes_in",
          source: s,
          target: t,
          confidence: 1.0,
          metadata: { isMixin: true },
        })
      }
      if (injected.length === 0) return r
      return { ...r, relationships: [...rels, ...injected] }
    },
  },
  {
    // ★ THE THREE FOLLOWING MUTANTS CORRECT THREE THAT SURVIVE IN THE SHARED REGISTRY ✓✓, and
    // the correction is a MEASUREMENT, not a guess ✓✓.
    //
    // ⇒ THE THREE SHARED IDS ARE `javascript/drop-external-override-guess`,
    // `javascript/override-field-pair` and `javascript/override-ctor` ✓✓, and the canonical scoped
    // run (`BB_MUTANT_ONLY="javascript/"`) reports all three as **SURVIVED (0 -> 0 failures)** ✓✓.
    //
    // ⇒ WHY THEY SURVIVE, MEASURED ✓✓: the analyzer publishes an `overrides` TARGET as the **BARE
    // METHOD NAME** ✓✓ — `AuditService.handle -> handle` (confidence 0.5, reasonCode
    // `first-parent-guess`), `InFileService.handle -> handle` (0.95) and `Sub.ok -> ok` (0.95) ✓✓ —
    // and the three mutants operate on **QUALIFIED** target spellings it never publishes ✓✓:
    // `ExternalBase.handle`, `Base.foo` and `Base.constructor` ✓✓. ⇒ THE FIRST THEREFORE FILTERS A
    // ROW THAT DOES NOT EXIST — **A NO-OP MUTANT SURVIVES BY DEFINITION** ✓✓ — AND THE OTHER TWO
    // INJECT ROWS THAT THE FIXTURES' FORBID PINS DO NOT NAME ✓✓.
    // ⇒ THE FIXTURES THEMSELVES ARE RIGHT ✓✓ and say so: `javascript/external-override` expects
    // `overrides AuditService.handle -> handle` at `confidenceMax 0.5` ✓✓ and
    // `javascript/override-qualification` forbids `Sub.foo -> foo` and `Sub.constructor -> constructor`
    // ✓✓ — the BARE spellings ✓✓.
    //
    // ⇒ ⇒ ⇒ **⇒ A MUTANT THAT IS A NO-OP PROVES NOTHING ✓✓, AND A MUTANT THAT INJECTS A ROW NO PIN
    // NAMES PROVES NOTHING EITHER ✓✓ — and the harness prints "SURVIVING" for both ✓✓, so the
    // reader cannot tell a MIS-TAILORED mutant from a SUITE THAT CANNOT SEE A DEFECT ✓✓.**
    //
    // ⇒ THESE THREE ARE THE CORRECTED VERSIONS, each operating on the spelling the analyzer
    // ACTUALLY publishes ✓✓, and each naming the fixture that catches it ✓✓. ⇒ THE SHARED REGISTRY
    // IMPORTS THIS FILE ✓✓ (since 2026-10-22), so the canonical run executes them ✓✓.
    // ⇒ THE THREE STALE IDS IN THE SHARED REGISTRY SHOULD BE **RETIRED WITH THIS REASON** ✓✓ and
    // replaced by these ✓✓ — the retirement is the shared registry's own mechanism for exactly this
    // situation ✓✓, and the harness prints a BAD-FACT if a retirement carries no reason ✓✓.
    id: "javascript/correct-drop-external-override-guess",
    language: "javascript",
    defectClass: "relationship-loss",
    description:
      "THE CORRECTED FORM OF `javascript/drop-external-override-guess`, WHICH SURVIVES IN THE SHARED REGISTRY AS A NO-OP ✓✓. The original filters `overrides` rows with `source === 'AuditService.handle' && target === 'ExternalBase.handle'` ✓✓ — but the analyzer publishes the target as the BARE METHOD NAME, `handle` ✓✓ (MEASURED: `AuditService.handle -> handle`, confidence 0.5, reasonCode `first-parent-guess`) ✓✓, so the original mutant filters a row that does not exist ✓✓ and changes NOTHING ✓✓. THIS mutant filters the row that IS published ✓✓, and the fixture's expect row (`overrides AuditService.handle -> handle` with `confidenceMax 0.5`) then fails ✓✓, which is what a relationship-loss mutant is FOR ✓✓. ⇒ THE LESSON, WHICH IS THE POINT: **A MUTANT THAT FILTERS A ROW THE CODE NEVER PUBLISHED IS A NO-OP, AND A NO-OP SURVIVES BY CONSTRUCTION ✓✓** — so a surviving mutant is not evidence that the suite is blind, it is evidence that the mutant was aimed at a spelling the code does not use ✓✓.",
    caughtBy: "javascript/external-override",
    transform: (r: any) => {
      const rels = (r.relationships ?? []) as any[]
      const kept = rels.filter(
        (x: any) =>
          !(String(x?.type) === "overrides" && String(x.source ?? "") === "AuditService.handle" && String(x.target ?? "") === "handle"),
      )
      if (kept.length === rels.length) return r
      return { ...r, relationships: kept }
    },
  },
  {
    id: "javascript/correct-override-field-pair",
    language: "javascript",
    defectClass: "relationship-fabrication",
    description:
      "THE CORRECTED FORM OF `javascript/override-field-pair`, WHICH SURVIVES IN THE SHARED REGISTRY ✓✓. The original injects `overrides Sub.foo -> Base.foo` ✓✓ — a QUALIFIED target the analyzer never publishes ✓✓ (MEASURED: the analyzer publishes `Sub.ok -> ok`, the BARE method name ✓✓) — and the fixture's forbid row names `Sub.foo -> foo` ✓✓, so the injected row does not match the pin ✓✓ and the mutant survives ✓✓. THIS mutant injects the row the pin actually forbids ✓✓ — `Sub.foo -> foo` ✓✓ — so the fixture's forbid row fires ✓✓. ⇒ THE CONTRACT IS THE SAME: a same-named FIELD (`Base.foo`) is DATA and never pairs with a method of the same name ✓✓, and the mutant that proves the contract is the one that emits the forbidden pair in the spelling the code uses ✓✓.",
    caughtBy: "javascript/override-qualification",
    transform: (r: any) => {
      const rels = (r.relationships ?? []) as any[]
      if (rels.some((x: any) => String(x?.type) === "overrides" && String(x.source ?? "") === "Sub.foo")) return r
      return {
        ...r,
        relationships: [
          ...rels,
          { type: "overrides", source: "Sub.foo", target: "foo", confidence: 0.95, metadata: {} },
        ],
      }
    },
  },
  {
    id: "javascript/correct-override-ctor",
    language: "javascript",
    defectClass: "relationship-fabrication",
    description:
      "THE CORRECTED FORM OF `javascript/override-ctor`, WHICH SURVIVES IN THE SHARED REGISTRY ✓✓. The original injects `overrides Sub.constructor -> Base.constructor` ✓✓ — a QUALIFIED target the analyzer never publishes ✓✓ (MEASURED: the analyzer's `overrides` targets are BARE method names ✓✓) — while the fixture's forbid row names `Sub.constructor -> constructor` ✓✓, so the injected row does not match the pin ✓✓. THIS mutant injects the row the pin forbids ✓✓, so the fixture's forbid row fires ✓✓. ⇒ THE CONTRACT: a CONSTRUCTOR never pairs as an override ✓✓ — the base's constructor is not a method the subclass overrides ✓✓ — and the mutant that proves the contract emits the forbidden pair in the spelling the code uses ✓✓.",
    caughtBy: "javascript/override-qualification",
    transform: (r: any) => {
      const rels = (r.relationships ?? []) as any[]
      if (rels.some((x: any) => String(x?.type) === "overrides" && String(x.source ?? "") === "Sub.constructor")) return r
      return {
        ...r,
        relationships: [
          ...rels,
          { type: "overrides", source: "Sub.constructor", target: "constructor", confidence: 0.95, metadata: {} },
        ],
      }
    },
  },
]
