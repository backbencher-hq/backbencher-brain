/**
 * JAVASCRIPT MUTANTS — this lane's regression mutants for the M14.0.F4 gate.
 *
 * WHY A SEPARATE FILE, following `script/m14/fsharp-mutants.ts`. The shared
 * registry `script/m14/mutate-analyzer.ts` is edited concurrently by every lane;
 * a block written into it there can be overwritten without any error, and the
 * gate keeps printing numbers with this lane's mutants simply absent from them.
 * The shared file needs ONE import line from this lane and the master makes it —
 * reported, not taken. Everything else lives here, where this lane owns it.
 *
 * WHAT EACH MUTANT IS: a revert of a defect class this lane MEASURED on real
 * JavaScript, and each names the fixture that catches it. A surviving mutant
 * fails the SUITE, not the mutant, because a suite that stays green whatever you
 * do to the code is decoration.
 *
 * All three are the R7 class — "an analyzer may not NAME something with a
 * placeholder or an empty string" — reached from three different fields, because
 * the census that found them measured edge ENDPOINTS and the third was found only
 * after a second instrument was written to look at SYMBOL names. That is the
 * argument for measuring each name-bearing field rather than the one that is easy.
 */
import type { Mutant } from "./mutate-analyzer"

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
]