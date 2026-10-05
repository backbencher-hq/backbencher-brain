/**
 * DERIV_TS LANE MUTANTS — the three defect classes this lane's fixes introduced
 * a pin for.
 *
 * WHY A LANE-OWNED FILE: `script/m14/mutate-analyzer.ts` is MASTER-owned, and the
 * fsharp / go lanes established the shape — their mutants live in
 * `script/m14/<lang>-mutants.ts` and are spread into the master's `MUTANTS` array
 * with one line, because "a mutant that is not registered is indistinguishable
 * from a defect class with no mutant". The three wiring lines are REPORTED to
 * master, not made here.
 *
 * Each transform reconstructs the PRE-FIX result from facts the POST-FIX result
 * already carries, so none of them hardcodes a fixture's name and none can
 * silently stop matching:
 *
 *   computed-import-specifier-published  the fabricated `imports` row for a
 *       computed specifier, rebuilt from the source text the transform is handed
 *       (the same channel `swift/drop-container-subscript-uses` needed, for the
 *       same reason: the post-fix result no longer records the suppressed row).
 *   placeholder-signature-member        the `(call)` / `(new)` symbols and their
 *       `contains` edges, rebuilt from the `hasCallSignature` /
 *       `hasConstructSignature` flags the fix left on the owning interface — so
 *       the mutant reads the construct off the result rather than off a name.
 *   type-mention-double-label           the `uses`/`isTypeReference` twin of every
 *       `references` row that carries a `relationshipType`, which is exactly the
 *       half the de-duplication post-pass removes.
 */
export interface TsDerivMutant {
  id: string
  language: "typescript"
  defectClass: string
  description: string
  transform: (result: any, source?: string) => any
}

const normType = (r: any): string => String(r?.type ?? r?.relationshipType ?? "")

/** The literal PREFIX of every computed template specifier in the source: the
 *  `data:text/javascript,` in `` import(`data:text/javascript,${x}`) ``. A pure
 *  string scan is right for a mutant — its job is to reproduce the old output,
 *  not to be a parser. */
function computedSpecifierPrefixes(source: string): string[] {
  const out: string[] = []
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== "`") continue
    let j = i + 1
    let body = ""
    let computed = false
    while (j < source.length && source[j] !== "`") {
      if (source[j] === "\\") { body += source[j + 1] ?? ""; j += 2; continue }
      if (source[j] === "$" && source[j + 1] === "{") {
        computed = true
        let depth = 1
        j += 2
        while (j < source.length && depth > 0) {
          if (source[j] === "{") depth++
          else if (source[j] === "}") depth--
          j++
        }
        continue
      }
      body += source[j]
      j++
    }
    if (computed && body) out.push(body)
    i = j
  }
  return out
}

export const TS_DERIV_MUTANTS: TsDerivMutant[] = [
  {
    id: "ts/computed-import-specifier-published",
    language: "typescript",
    defectClass: "fabricated-endpoint",
    description:
      "DERIV_TS regression: a dynamic `import()` / `require()` whose argument is a template with a SUBSTITUTION publishes the template's literal prefix as a module (`imports gen -> \"data:text/javascript,:*\"`). Pre-fix state, measured at 1 row of 2,926 on a 200-file draw of microsoft/TypeScript — the single row the independent `imports` oracle derived and the analyzer did not, which is how it was found. Caught by typescript/computed-import-specifier, whose two literal controls (`./helper.js:*`, `node:path:*`) stay expected so a fix that simply stopped emitting dynamic imports cannot pass, and whose forbid rows name the fabricated target.",
    transform: (r: any, source?: string) => {
      if (!source) return r
      const prefixes = computedSpecifierPrefixes(source)
      if (!prefixes.length) return r
      // The `imports` SOURCE is this file's module leaf, and the transform is
      // handed the result rather than the analyze() arguments, so the leaf is read
      // off a row the analyzer already published for this file. A file whose ONLY
      // import is a computed one has no such row; the fixture pins the fabricated
      // target by (type, target) and not by source, so detection does not depend on
      // this, and the value is a name either way rather than a magic constant
      // standing in for a fixture.
      const leaf =
        (r?.relationships ?? []).find((x: any) => normType(x) === "imports" || normType(x) === "exports")?.source ??
        "module"
      const fabricated = prefixes.map((p) => ({
        source: String(leaf),
        target: `${p}:*`,
        type: "imports",
        confidence: 1,
        metadata: { module: p, isDynamic: true },
      }))
      return { ...r, relationships: [...(r.relationships ?? []), ...fabricated] }
    },
  },
  {
    id: "ts/placeholder-signature-member",
    language: "typescript",
    defectClass: "placeholder-literal-endpoint",
    description:
      "DERIV_TS regression: an interface's CALL SIGNATURE is a symbol named `(call)` and its CONSTRUCT SIGNATURE a symbol named `(new)`, each with a `contains` edge to that placeholder. Pre-fix state, measured at 8 placeholder endpoints per 200 tracked files and the only `contains` rows of 6,357 that no oracle could derive. Caught by typescript/unnamed-signature-members, whose forbidSymbols name both placeholder names and whose forbidRelationships name both `contains` endpoints, with the interface's one REAL member still expected so the mutant cannot pass by emptying the symbol table.",
    transform: (r: any) => {
      const symbols = [...(r?.symbols ?? [])]
      const relationships = [...(r?.relationships ?? [])]
      let touched = false
      for (const s of symbols) {
        const md = s?.metadata ?? {}
        const name = md.hasCallSignature === true || md.isCallSignature === true ? "(call)"
          : md.hasConstructSignature === true || md.isConstructSignature === true ? "(new)"
          : null
        if (!name) continue
        touched = true
        symbols.push({
          name,
          kind: name === "(call)" ? "method" : "constructor",
          range: s.range,
          scope: s.name,
          ownerName: s.name,
          ownerKind: s.kind,
          metadata: name === "(call)" ? { isCallSignature: true } : { isConstructSignature: true },
        })
        relationships.push({
          source: s.name,
          target: name,
          type: "contains",
          confidence: 1,
          metadata: { evidenceClass: "structural" },
        })
      }
      if (!touched) return r
      return { ...r, symbols, relationships }
    },
  },
  {
    id: "ts/type-mention-double-label",
    language: "typescript",
    defectClass: "double-emission",
    description:
      "DERIV_TS regression: a name written in a TYPE position is published under BOTH labels — `uses` at 0.9 with `isTypeReference` and `references` at 0.95 with `relationshipType`. Pre-fix state; measured at 733+ (source, target) pairs per 200 tracked files carrying both, and PINNED BY TWO FIXTURES OF THIS LANE that contradicted each other (`usage-references` wanted `uses greet->User`, `type-usage-graph` wanted `references` for the same construct). Caught by typescript/usage-references, whose forbid rows name the `uses` twin of two type annotations — and, in the other direction, `type-usage-graph` still requires the `relationshipType` annotations, so a mutant that resolved the ambiguity by dropping the richer row would fail there instead.",
    transform: (r: any) => {
      const twins = (r?.relationships ?? [])
        .filter((x: any) => normType(x) === "references" && x?.metadata?.relationshipType)
        .map((x: any) => ({
          source: x.source,
          target: x.target,
          type: "uses",
          confidence: 0.9,
          line_number: x.line_number,
          metadata: { isTypeReference: true, line: x.line_number },
        }))
      if (!twins.length) return r
      return { ...r, relationships: [...(r.relationships ?? []), ...twins] }
    },
  },
]