/**
 * XML ONTOLOGY MUTANTS — proof that this lane's new fixtures CAN fail.
 *
 * ## Why this file exists beside the shared harness
 *
 * `script/m14/mutate-analyzer.ts` is the project's mutation harness and it is
 * SUPERVISOR-OWNED (§8 of the lane contract), so the two mutants owed by this lane's
 * work cannot be registered in it from here. This file runs the same mechanism over
 * this lane's fixtures only — the real analyzer, wrapped, with an output transform
 * standing in for a defect — and is committed with the lane so the claim "the new
 * fixtures are able to fail" is reproducible from a clean checkout.
 *
 * The shared harness is still IMPORTED (`runLang`) rather than reimplemented, so the
 * matcher that decides pass/fail is the project's matcher and not a second one that
 * could be kinder.
 *
 * ## What a survivor means
 *
 * A surviving mutant fails this script, not the mutant: a suite that stays green
 * however the analyzer is broken is decoration, and decoration is what let M13 claim
 * things it had not earned. Exit code 0 iff every mutant is caught.
 *
 * CLI: npx tsx validation/m14/fixtures/xml/ontology-mutants.mts [--json OUT]
 */
import { writeFileSync, readFileSync } from "node:fs"
import * as path from "node:path"
// @ts-ignore — the harness is a .ts module consumed by tsx, and its types are not exported
import { runLang } from "../../../../script/m14/run-fixtures"
// @ts-ignore
import { RealXmlAnalyzer } from "../../../../src/ast/real-xml-analyzer"
import { parseFile } from "../../../../src/ast/pool-worker"

type Mutant = {
  id: string
  defectClass: string
  description: string
  transform: (r: any) => any
}

/**
 * LANE-OWNED PROPERTY CHECKS — the part of the suite the shared matcher cannot express.
 *
 * `script/m14/run-fixtures.ts:254` holdsa `CONSTRAINT_KEY_ALLOWLIST`, and
 * `qualifiedName` is not on it: a symbol row may constrain `name`, `kind`,
 * `ownerName`, `range`, `startLine`, `endLine` and the rest, but not the qualified
 * name. Adding the key is a change to SUPERVISOR-OWNED shared machinery (§8 of the
 * lane contract) and is filed there rather than made here, so the behaviour the
 * 2026-10-05 fix introduced would otherwise ship with NOTHING able to fail.
 *
 * These checks close that gap inside the lane. They run the REAL analyzer on a
 * committed fixture and assert one property of the returned symbols, returning the
 * problems found. A mutant is caught when the shared fixtures fail OR when one of
 * these fails, which is the same rule the shared runner uses.
 *
 * The assertions are written from the CONTRACT — an attribute belongs to the element
 * it sits on, so its qualified name is `owner + "." + name` — and not from a dump of
 * current output, because an expectation copied out of the output it is meant to check
 * cannot fail for the reason it exists.
 */
type PropertyCheck = {
  id: string
  file: string
  what: string
  /**
   * Problems found, each one a sentence naming the symbol and what was expected.
   * Optional so a check can be about EDGES only — `assertRelationships` below — without
   * carrying a symbol assertion that would pass vacuously.
   */
  assert?: (symbols: any[]) => string[]
  /**
   * Optional. A property about an EDGE rather than a symbol.
   *
   * `assert` alone would have left the `imports` class unpinned through production, and
   * the hole is the one §8 item 7 is about: `script/m14/run-fixtures.ts` reaches the
   * analyzer through `analyze()`, while the production path is `parseFile`, and the
   * per-symbol `metadata` allowlist at `pool-worker.ts:1020-1072` has already been
   * measured dropping 13 keys this analyzer writes. Relationship metadata is a DIFFERENT
   * path and does survive — `imports-target-classes.mts` reads `resolvable` off 263 of
   * 263 edges through `parseFile` — but a corpus measurement is not a test, and this
   * suite is where a regression in that path belongs.
   */
  assertRelationships?: (relationships: any[]) => string[]
}

const ATTR_FIXTURE = path.join(import.meta.dirname, "attribute-qualified-name.xml")
const IMPORTS_CLASS_FIXTURE = path.join(import.meta.dirname, "imports-target-class.xml")
const NS_ATTR_FIXTURE = path.join(import.meta.dirname, "attribute-local-name.xml")

/**
 * The attribute-like symbol kinds, and why the checks below select on KIND rather than
 * on `metadata.isXmlAttribute`.
 *
 * `pool-worker.ts:1020-1072` is a hard-coded allowlist of metadata keys: it forwards
 * the CSS keys, the Markdown keys, `nodeType` and `language`, and nothing else. Every
 * key the XML analyzer writes into attribute metadata — `isXmlAttribute`,
 * `isXmlNamespace`, `attributeName`, `value`, `namespacePrefix`, `namespaceUri` — is
 * DROPPED at the worker boundary, so a check that selects attributes by
 * `metadata.isXmlAttribute` finds zero symbols through `parseFile` and reports
 * "nothing was published". That is the failure this file's own first draft hit, and it
 * is a check that cannot fail for the reason it exists. §8 of the lane contract files
 * the allowlist for the supervisor; the checks are written to survive without it.
 *
 * `kind` is published and is load-bearing: `:2283` makes `SymbolKind.Namespace` for a
 * namespace declaration and `SymbolKind.Property` for an attribute, from the one call
 * site. So the kind IS the distinction the checks need, and it survives the boundary.
 */
const ATTRIBUTE_LIKE_KINDS = new Set(["property", "namespace"])

/**
 * The ONE selector for "this symbol is an attribute or a namespace declaration that
 * has an owner", used by the property checks AND by the mutants below.
 *
 * It is defined once on purpose. The checks and the mutants originally each carried
 * their own copy selecting on `metadata.isXmlAttribute`, and because the worker drops
 * that key BOTH sides matched nothing: the checks reported "no attribute symbols were
 * published" and the two `attribute-qualified-name` mutants SURVIVED, each one a
 * no-op that could not fail. A mutant that does not apply is not a weak test, it is
 * the absence of one, and it is reported as a pass by the runner. One selector means a
 * mutant that stops matching is visible as a changed baseline rather than as a green
 * row.
 */
const isOwnedAttributeLike = (s: any) =>
  ATTRIBUTE_LIKE_KINDS.has(String(s?.kind ?? "")) && String(s?.ownerName ?? "").length > 0

/** Owned attribute-like symbols — the population the D1 property is about. */
const ownedAttributeLike = (symbols: any[]) => symbols.filter(isOwnedAttributeLike)

const PROPERTY_CHECKS: PropertyCheck[] = [
  {
    id: "xml/attribute-qualified-name-is-owner-qualified",
    file: ATTR_FIXTURE,
    what:
      "every OWNED attribute symbol carries qualifiedName = ownerName + '.' + name, so two attributes " +
      "with the same local name on different elements are two distinct published identities",
    assert: (symbols) => {
      const problems: string[] = []
      const attrs = ownedAttributeLike(symbols)
      if (attrs.length === 0) {
        problems.push(
          "no owned property/namespace symbols were published at all, so this check asserted nothing",
        )
        return problems
      }
      for (const s of attrs) {
        const owner = String(s.ownerName)
        const want = `${owner}.${s.name}`
        if (String(s.qualifiedName ?? "") !== want) {
          problems.push(
            `attribute '${s.name}' owned by '${owner}' published qualifiedName ` +
              `'${String(s.qualifiedName ?? "")}', expected '${want}'`,
          )
        }
      }
      // The property that actually matters, stated as a property and not as a per-row
      // restatement: one published key may not denote declarations under two owners,
      // i.e. the collision the fix exists to remove must be gone from this fixture.
      //
      // This is the check that FAILS before the fix and passes after it, and it fails
      // for the right reason: pre-fix, `pool-worker.ts:930` defaults `qualifiedName` to
      // the bare name, so `fill` is published once for `path`, once for `use` and once
      // for `g` — three declarations, one key, three owners.
      const byQ = new Map<string, { count: number; owners: Set<string> }>()
      for (const s of attrs) {
        const q = String(s.qualifiedName ?? "")
        let e = byQ.get(q)
        if (!e) { e = { count: 0, owners: new Set() }; byQ.set(q, e) }
        e.count++
        e.owners.add(String(s.ownerName))
      }
      for (const [q, e] of byQ) {
        // More than one occurrence under one qualified name is legitimate when the
        // SAME element repeats the attribute (`<path fill>` at lines 22 and 26 both
        // publish `path.fill`); what must never happen is one key spanning two
        // different owners, because that is the collision the store cannot resolve.
        if (e.owners.size > 1) {
          problems.push(
            `qualifiedName '${q}' is published for attributes under ${e.owners.size} different owners ` +
              `(${[...e.owners].join(", ")}); one key cannot denote ${e.count} declarations`,
          )
        }
      }
      return problems
    },
  },
  {
    id: "xml/namespace-declaration-qualified-name-is-owner-qualified",
    file: ATTR_FIXTURE,
    what:
      "a namespace declaration is published by the SAME call site as an attribute " +
      "(real-xml-analyzer.ts:2283), so it qualifies or neither does",
    assert: (symbols) => {
      const problems: string[] = []
      const ns = ownedAttributeLike(symbols).filter((s) => String(s?.kind) === "namespace")
      if (ns.length === 0) {
        problems.push(
          "no owned namespace symbols were published, so this check asserted nothing",
        )
        return problems
      }
      for (const s of ns) {
        const owner = String(s.ownerName)
        const want = `${owner}.${s.name}`
        if (String(s.qualifiedName ?? "") !== want) {
          problems.push(
            `namespace '${s.name}' published qualifiedName '${String(s.qualifiedName ?? "")}', expected '${want}'`,
          )
        }
      }
      return problems
    },
  },
  {
    id: "xml/attribute-published-name-has-no-namespace-prefix",
    file: NS_ATTR_FIXTURE,
    what:
      "an owned attribute or namespace symbol is published under a LOCAL name: a `:` may appear in " +
      "metadata, never in `name`, because the store reduces an edge target to its last `:`/`.` " +
      "segment before it looks anything up (parallel-indexer.ts:3375-3390) and a prefixed name " +
      "cannot be found by the edge that names it",
    assert: (symbols) => {
      const problems: string[] = []
      const attrs = ownedAttributeLike(symbols)
      if (attrs.length === 0) {
        problems.push("no owned property/namespace symbols were published, so this check asserted nothing")
        return problems
      }
      for (const s of attrs) {
        if (String(s.name).includes(":")) {
          problems.push(
            `attribute owned by '${String(s.ownerName)}' published name '${String(s.name)}'; ` +
              `the store would search for '${String(s.name).split(":").pop()}' and find nothing`,
          )
        }
      }
      // The other half of the same rule, and the half a colon-stripping fix gets wrong:
      // the local part must SURVIVE. A transform that removed the prefix and the local
      // name together, or that published the prefix alone, satisfies "no colon in name"
      // while losing the declaration's identity entirely.
      const wanted = new Map<string, string>([
        ["space", "xml:space"],
        ["href", "xlink:href"],
        ["id", "id"],
        ["fill", "fill"],
      ])
      for (const [local, written] of wanted) {
        if (!attrs.some((s) => String(s.name) === local)) {
          problems.push(`no attribute published under the local name '${local}' (written '${written}')`)
        }
      }
      return problems
    },
  },
  {
    id: "xml/imports-class-survives-the-worker",
    file: IMPORTS_CLASS_FIXTURE,
    what:
      "every `imports` edge carries a `resolvable` class through PRODUCTION `parseFile`, and the class is one of " +
      "the three the language can express — `file`, `external`, `in-document`. Read through the worker, not " +
      "through `analyze()`: `xml/imports-target-class` pins the same property on the `analyze()` path, and the " +
      "two disagreeing paths is the shape §8 item 7 measured dropping 13 symbol-metadata keys.",
    assertRelationships: (rels) => {
      const problems: string[] = []
      const imports = rels.filter((r: any) => r?.type === "imports")
      if (imports.length === 0) return ["no imports edges came back through parseFile, so this asserted nothing"]
      const ALLOWED = new Set(["file", "external", "in-document"])
      for (const r of imports) {
        const cls = (r?.metadata ?? {}).resolvable
        if (cls === undefined || cls === null) {
          problems.push(`imports ${r?.source} -> ${r?.target} carries NO resolvable class through parseFile`)
        } else if (!ALLOWED.has(String(cls))) {
          problems.push(`imports ${r?.source} -> ${r?.target} carries class '${cls}', which is not one of ${[...ALLOWED].join("/")}`)
        }
      }
      // The three-class spread, so a marker that collapsed to one value cannot pass by
      // being present. Same control as `-collapsed-to-one-value` on the fixture path.
      const seen = new Set(imports.map((r: any) => String((r?.metadata ?? {}).resolvable)))
      if (seen.size < 3) problems.push(`only ${seen.size} distinct class(es) across ${imports.length} imports edges; expected all three`)
      return problems
    },
  },
]

/**
 * Runs every property check and returns `id -> problems`.
 *
 * `transform` is applied to the analyzer's own output before the assertions run, so a
 * mutant that corrupts `qualifiedName` is caught here even though `run-fixtures.ts`
 * cannot express the property: the check sees the SAME mutated result the shared
 * fixtures see, through a different assertion.
 */
async function runPropertyChecks(transform?: (r: any) => any): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {}
  for (const c of PROPERTY_CHECKS) {
    let r: any
    try {
      // Through `parseFile`, the production pool-worker entry point, NOT `analyze()`.
      //
      // The first draft of this function called `new RealXmlAnalyzer().analyze(text, …)`.
      // That is wrong twice over and it failed SILENTLY: `analyze()` takes the PARSE
      // TREE (`run-fixtures.ts:728` passes `tree.rootNode`, not the source text), so
      // the string was read as a node, every walk found nothing, and the checks
      // reported "no attribute symbols were published at all". A check that cannot
      // distinguish "the property is broken" from "I called the analyzer wrong" is not
      // a check. `parseFile` is also what this lane measures with everywhere else
      // (`ambiguity-split.mts`, `qualified-name-population.mts`), so a mutant verdict
      // here and a corpus number there are about the same code path.
      const parsed = await parseFile(c.file, path.dirname(c.file))
      r = parsed ? (transform ? transform(parsed) : parsed) : null
      if (!r) {
        out[c.id] = [`parseFile returned nothing for ${c.file}, so this check asserted nothing`]
        continue
      }
    } catch (e) {
      out[c.id] = [`parseFile threw: ${(e as Error)?.message ?? e}`]
      continue
    }
    out[c.id] = c.assert ? c.assert(Array.isArray(r?.symbols) ? r.symbols : []) : []
    if (c.assertRelationships) {
      const rels = Array.isArray(r?.relationships) ? r.relationships : []
      if (rels.length === 0) {
        // Same rule as the `parseFile returned nothing` case above: a check that
        // selected nothing has asserted nothing, and must say so rather than pass.
        out[c.id].push("no relationships came back, so this edge property asserted nothing")
      } else {
        out[c.id].push(...c.assertRelationships(rels))
      }
    }
  }
  return out
}

/** Total problems across every property check. */
const propertyProblemCount = (r: Record<string, string[]>) =>
  Object.values(r).reduce((a, problems) => a + problems.length, 0)

const MUTANTS: Mutant[] = [
  {
    id: "xml/ontology-call-edge-relabelled-as-reference",
    defectClass: "neighbouring-type",
    description:
      "The M60 XML ontology GAP for `calls`, reverted. XSLT 1.0 §6 says \"An xsl:call-template element invokes a template by name\"; the pre-gap lane emitted the edge as `references` on the reasoning that a call-template \"names a template DECLARATION\". This mutant relabels every `calls` edge back to `references`, which is exactly the state the lane was in for three waves and the state the census measured at 0 calls edges. It must fail xml/xslt-named-template-calls on two independent rows: the two `expectRelationships` rows that name the type `calls`, and the `forbidRelationships` row forbidding `references outer -> inner`.",
    transform: (r) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        x.type === "calls" ? { ...x, type: "references" } : x,
      ),
    }),
  },
  {
    id: "xml/ontology-call-source-is-the-call-site",
    defectClass: "wrong-endpoint",
    description:
      "The second defect this lane's fixture work found, and the one a type-only assertion cannot catch: a `calls` edge whose SOURCE is the `xsl:call-template` instruction rather than the enclosing template that makes the call. It was the first implementation's actual output — `calls xsl:call-template -> inner` — and a consumer asking \"what does this template call\" gets nothing from it, because one source name carries every call site in the stylesheet. Reverted generically: every `calls` edge is retargeted to `xsl:call-template`. Pinned by the `forbidRelationships` row `calls xsl:call-template -> inner` in xml/xslt-named-template-calls, which is the only assertion in the lane that can tell a caller from a call site.",
    transform: (r) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        x.type === "calls" ? { ...x, source: "xsl:call-template" } : x,
      ),
    }),
  },
  {
    id: "xml/ontology-recursive-call-dropped",
    defectClass: "reference-suppression",
    description:
      "A guard copied from the reference pass, which refuses a construct that references itself. Applied to `calls` it drops RECURSION, because a template invoking itself is ordinary XSLT: `libxslt/tests/XSLTMark/bottles.xsl` calls `bottles` from inside template `bottles` three times. XSLT 1.0 §6 makes two TEMPLATES of one name and import precedence the error (\"It is an error if a stylesheet contains more than one template with the same name and same import precedence\"), not a template calling one of them. This mutant deletes every self-directed call edge, and xml/xslt-named-template-calls must fail on `calls inner -> outer` — mutual recursion with `calls outer -> inner`, both true. A suite that pins only a non-recursive call cannot catch this, which is why the fixture's two calls form a cycle.",
    transform: (r) => ({
      ...r,
      relationships: (r.relationships ?? []).filter((x: any) => !(x.type === "calls" && x.source === x.target)),
    }),
  },
  {
    id: "xml/ontology-derivation-relabelled-as-reference",
    defectClass: "neighbouring-type",
    description:
      "The M60 XML ontology GAP for `extends`, reverted. XSD 1.0 Part 1 §3.4.2 defines `<extension base = xs:QName>` and `<restriction base = xs:QName>` as the qualified name of the BASE TYPE and calls the mechanism type derivation; the pre-gap lane emitted every `base=` value as `references`. This mutant relabels every `extends` edge back to `references`. It must fail THREE fixtures independently: xml/xsd-type-derivation's two `expectRelationships` rows and its two forbid rows, xml/declared-name-xsd's relabelled `<xs:restriction base=\"xs:int\"/>` row and the forbid row added beside it, and nothing else — so a lane that had relabelled only the analyzer and not the fixture would go red here.",
    transform: (r) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        x.type === "extends" ? { ...x, type: "references" } : x,
      ),
    }),
  },
  {
    id: "xml/ontology-derivation-includes-forgotten",
    defectClass: "partial-implementation",
    description:
      "A rule that diverts `xs:extension` and forgets `xs:restriction`. Both elements carry `base` and both are type derivation (§3.4.2), and `xs:restriction` is the far more common of the two in the corpus — so a rule written from the shape in the first file found and relabelled nothing else leaves every restriction edge as a `references` edge and looks finished. This mutant relabels only `derivation === \"extension\"` edges back. xml/xsd-type-derivation pins one of each for exactly this reason, and must fail on the `Code -> token` row alone while the `Base` row still passes.",
    transform: (r) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        x.type === "extends" && x.metadata?.derivation === "extension" ? { ...x, type: "references" } : x,
      ),
    }),
  },
  {
    id: "xml/extends-source-is-the-derivation-constructor",
    defectClass: "fabricated-endpoint",
    description:
      "The 2026-10-04 defect, reverted. `extends` relates two TYPES, and XSD writes type derivation as a `base=` attribute on an inline `<xs:extension>`/`<xs:restriction>` (XSD 1.0 Part 1 §3.4.2) which carries no `name` of its own. The analyzer took an attribute's owner to be the element the attribute sits on, so the owner of every `base=` was the derivation element's own tag text, and the edge came out `xs:restriction -> int`. Measured over the full 11,456-file admitted corpus that put a fabricated source on 438 of 438 `extends` edges — 100%, zero sources a document declares (validation/m14/fixtures/xml/derivation-accounting.mts). This mutant rewrites each `extends` edge's source to the schema constructor its `derivation` names, which is exactly what the analyzer emitted before the fix. It must fail on the forbid rows added for it — `extends xs:restriction -> int` in xml/declared-name-xsd and the `xs:extension`/`xs:restriction` rows in xml/xsd-type-derivation — and on those fixtures' expectation rows, whose sources are now `Version`, `Derived` and `Code`. This is the mutant the lane owed for this fix and the fixture rows alone would not have caught it, because before the fix the fixtures PINTED the fabricated value.",
    transform: (r) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) => {
        if (x.type !== "extends") return x
        const kind = x.metadata?.derivation === "extension" ? "extension" : "restriction"
        return { ...x, source: `xs:${kind}` }
      }),
    }),
  },
  {
    id: "xml/calls-source-is-a-vocabulary-tag",
    defectClass: "fabricated-endpoint",
    description:
      "The `calls` half of the 2026-10-04 fabrication, as a PROXY and not a replay. Measured over the full admitted corpus, 495 of 548 `calls` edges — 90.3% — named an XSLT vocabulary tag or an HTML tag as the caller (`xsl:for-each -> dumptext`, `xsl:template -> dumptext`, `p -> dumptext`), leaving 53 whose source is a name the stylesheet declares. `calls` resolved at 100% at BOTH ENDS throughout, because the analyzer mints a symbol for whatever name an edge needs. The mechanism was `elementOwnerName`, the enclosing ELEMENT, rather than the nearest ancestor that DECLARES a name. This transform rewrites every `calls` source to `xsl:for-each`, a tag no stylesheet declares, which is the same defect class and must be caught by the forbid rows in xml/xslt-call-source-through-inline-body. It is a proxy because a transform over the analyzer's OUTPUT cannot recover which enclosing element the old code would have picked — that needs the source, and the exact replay is the analyzer-level revert measured in the doc (24/24 fixtures with the fix, 23/24 without, failure localised to this fixture while xml/xslt-named-template-calls PASSES, which is the proof that the older fixture could not see this defect).",
    transform: (r) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        x.type === "calls" ? { ...x, source: "xsl:for-each" } : x,
      ),
    }),
  },
  {
    id: "xml/ontology-unresolvable-call-published",
    defectClass: "phantom-symbol",
    description:
      "The refusal under test, reverted. A `calls` edge whose target this stylesheet does not declare points at a name that lives in an included or imported stylesheet — 724 of libxslt's 1,446 call sites. From inside one file those names cannot be resolved, and publishing the edge puts a name in the graph that no file supports: the M60.R10 class. This mutant adds a `calls` edge for every unresolved call name, which is what emitting all of them would look like. xml/xslt-named-template-calls must fail on `forbidRelationships` `calls outer -> elsewhere` and on `forbidSymbols` `elsewhere`.",
    transform: (r) => {
      const rels = r.relationships ?? []
      const called = new Set(rels.filter((x: any) => x.type === "calls").map((x: any) => x.target))
      const unresolved = (r.symbols ?? [])
        .filter((s: any) => s.ownerName === "xsl:call-template" && s.name === "name" && typeof s.metadata?.value === "string" && s.metadata.value.length > 0)
        .map((s: any) => s.metadata.value as string)
        .filter((v) => !called.has(v))
      const callers = [...new Set(rels.filter((x: any) => x.type === "contains" && x.target === "xsl:call-template").map((x: any) => String(x.source)))]
      // DELIBERATELY BLUNT, and the reason is worth recording. Three versions of this
      // mutant left every fixture green, each for a different mechanical reason, and
      // the third is the interesting one: the call SITES cannot be recovered from the
      // result side at all. `contains outer -> xsl:call-template` is emitted ONCE for
      // the two call sites `outer` makes, because edge identity is source|type|target,
      // so there is one edge where the document has two instructions and no way to
      // pair a name with the line it was written on. The shared harness states the
      // same limitation for `xml/qname-whitespace-not-collapsed` and reverts the
      // OBSERVABLE instead of trying to reconstruct the exact site.
      //
      // So: every caller that has a call site, against every call name that has no
      // edge. That is a superset of the defect — three edges where one is the defect
      // — and a superset is the right trade here, because the assertion under test is
      // a `forbidRelationships` row and over-emitting can only make it easier to fire.
      const added: any[] = []
      for (const caller of callers) {
        for (const target of unresolved) {
          added.push({
            source: caller,
            target,
            type: "calls",
            confidence: 1,
            metadata: { role: "xslt_named_template_call", resolvable: "in-document", occurrences: 1 },
          })
        }
      }
      return { ...r, relationships: [...rels, ...added] }
    },
  },
  {
    id: "xml/placeholder-literal-published",
    defectClass: "placeholder-collision",
    description:
      "M60 rule R7, reverted. `unknown` is the placeholder for an endpoint that could not be determined, and no edge endpoint may equal it — a consumer reading the string cannot tell a placeholder from a name. The ontology census resolved both ends of all 191,251 relationships across the 11,066-file corpus and found exactly 2 endpoints equal to it, both in `libxslt/tests/general/bug-166.xsl`, where two `xsl:variable` result-tree fragments each begin with a literal result element `<unknown/>`. This mutant reinstates them. xml/placeholder-literal-refused must fail on all three of its refusal rows — the symbol and the two edge labels — while its two sibling-element rows stay green, which is what distinguishes a value-based refusal from a rule that stopped walking.",
    transform: (r) => ({
      ...r,
      symbols: [
        ...(r.symbols ?? []),
        { name: "unknown", kind: "class", range: { start: { line: 10, character: 0 }, end: { line: 10, character: 10 } }, visibility: "public", metadata: { nodeType: "element", tagName: "unknown" } },
      ],
      relationships: [
        ...(r.relationships ?? []),
        { source: "sort-order", target: "unknown", type: "contains", confidence: 1, line_number: 10, metadata: { role: "xml_element", evidenceClass: "structural", occurrences: 1 } },
      ],
    }),
  },
  {
    id: "xml/ontology-derivation-confidence-downgraded",
    defectClass: "confidence-honesty",
    description:
      "Every `calls` and `extends` edge demoted below the 0.7 heuristic threshold with no reason code. The honesty contract §4 requires a sub-1.0 edge to be countable AS a heuristic, which means the tier has to be right as well as the number: both new types are read off the tree and off the vocabulary's own declaration, so neither is a guess and neither may be filed as one. This mutant cannot be caught by a type or line assertion, only by the `meta.evidenceClass` rows the two new fixtures carry — which is why those rows are in the fixtures rather than only in this file's description.",
    transform: (r) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        x.type === "calls" || x.type === "extends"
          ? { ...x, confidence: 0.5, metadata: { ...x.metadata, evidenceClass: "inferred" } }
          : x,
      ),
    }),
  },
  {
    id: "xml/pereference-semicolon-guard-removed",
    defectClass: "fabricated-edge",
    description:
      "The mistake this lane's regex removal nearly shipped, kept as a mutant because the probe that caught it is not a test. `validation/m14/fixtures/xml/pereference-shape-probe.mts` compared three predicates for the `PEReference` branch and found that the brief's own preferred method — \"where the information is IN THE NODE, a regex over the text is strictly worse\" — LOSES here: reading the node's `Name` child instead of slicing its text disagreed with the shipped predicate on 3 of 11 obtainable nodes and was WRONG on 2. On `<!ELEMENT %pe EMPTY>` the grammar's error recovery builds a `PEReference` whose only child is a `Name` and whose text has no `;`, so the child lookup invents a use of `pe` from a document that never wrote `%pe;`. On `% zz '&#60;` it invents a use of `zz` from a VALUE-form declaration. This mutant adds exactly those edges — for every declared parameter-entity name that has no edge yet, a `references` edge from the DOCTYPE — and xml/pereference-semicolon-required must fail on `forbidRelationships` target `unterminated` while its positive row and its `contains` row stay green. A suite pinning only the positive reference cannot catch this, which is why the fixture ships a forbid row with no matching expect row.",
    transform: (r) => {
      const rels = r.relationships ?? []
      const existing = new Set(rels.map((x: any) => `${x.source}|${x.type}|${x.target}`))
      const doctypes = new Set(
        (r.symbols ?? []).filter((s: any) => s.metadata?.nodeType === "doctypedecl").map((s: any) => String(s.name)),
      )
      const declaredParameterEntities = (r.symbols ?? [])
        .filter((s: any) => s.metadata?.nodeType === "PEDecl")
        .map((s: any) => String(s.name))
      const added: any[] = []
      for (const dt of doctypes) {
        for (const name of declaredParameterEntities) {
          if (existing.has(`${dt}|references|${name}`)) continue
          added.push({
            source: dt,
            target: name,
            type: "references",
            confidence: 1,
            line_number: 0,
            metadata: { role: "parameter_entity_reference", entityName: name, isParameterEntity: true, resolvable: "in-document", occurrences: 1, evidenceClass: "structural" },
          })
        }
      }
      return { ...r, relationships: [...rels, ...added] }
    },
  },
  {
    id: "xml/overrides-relabelled-as-references",
    defectClass: "neighbouring-type",
    description:
      "The M60 XML ontology GAP for `overrides`, reverted. XSLT 1.0 §5.5 makes two templates with the same match, mode and priority an error resolved by running the later one, so the second declaration REPLACES the first; the pre-gap lane emitted nothing at all, which is why `script/m14/ontology-coverage-gate.ts` reported its RULED verdict FALSIFIED over 11,456 corpus files (3 sites in 3 files). A plausible wrong repair is to file the collision as a `references` edge — 'this template refers to that one' — which is a neighbouring type and not the one the spec defines. This mutant relabels every `overrides` edge to `references` and xml/xslt-competing-template-overrides must fail on all three `expectRelationships` rows plus the two forbid rows that name the type.",
    transform: (r) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        x.type === "overrides" ? { ...x, type: "references" } : x,
      ),
    }),
  },
  {
    id: "xml/overrides-direction-reversed",
    defectClass: "wrong-endpoint",
    description:
      "The same edge with its direction reversed. XSLT 1.0 §5.5 runs the LAST matching template, so the source must be the later declaration and the target the one it replaced; a reversed edge says the first rule took the second's place, which is the opposite of what a processor does, and a graph carrying both directions makes every override look mutual. This mutant is the only assertion in the lane that can catch it: type-only rows pass either way, so xml/xslt-competing-template-overrides carries two direction forbids — one on the derived pair of row 1 and one on the named pair of row 3 — and the runner below checks the mutant localises to that fixture.",
    transform: (r) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        x.type === "overrides" ? { ...x, source: x.target, target: x.source } : x,
      ),
    }),
  },
  {
    id: "xml/declaration-anchored-to-the-name-attribute-again",
    defectClass: "range-precision",
    description:
      "The M60 containment fix, reverted: a vocabulary declaration's range goes back to the `name=` Attribute node instead of the element. It is invisible to `xml/xsd-declared-name-lines` — the fixture M19 was written for, which asserts only the reported LINE — because the revert preserves the line exactly: in the all-on-one-line shape the attribute and the element start on the same row. It is equally invisible to every resolution rate, because both endpoints still resolve. The only assertion in the lane that can catch it is `xml/declaration-range-contains-its-members`, which pins byte offsets: `Address` collapses from the whole element at 2469..2614 onto `name=\"Address\"` at 2486..2500, which no longer encloses `xsd:sequence` at 2506..2593 and is the identical range its own `name` attribute symbol already occupies. This mutant is therefore also the measurement that the pre-existing suite had a hole in this shape, and it is why the new fixture exists rather than restating the old one. It is expressed on the OUTPUT rather than as a source edit because `runLang` reaches the analyzer through `parseFile`, whose engine module caches the analyzer class on first use, so a file edit mid-run is not observable to it; and the shape restriction is exact rather than a compromise — `C.startLine === P.startLine` IS the `allOnOneLine` condition the fix tests, so the transform reproduces the pre-fix output on precisely the shape the fix changed and touches nothing else.",
    transform: (r) => {
      // The range is NESTED under `range` on the analyzer's own `UniversalSymbol`, and the
      // fixture matcher reads `sym.range[k]` — not the worker's flat shape. The first
      // version of this transform read `s.startIndex`, which is `undefined` there, so
      // `p.startIndex > c.startIndex` was `undefined > undefined` and the transform changed
      // nothing. It SURVIVED, and the harness reported the survivor, which is the only
      // reason this is worth writing down: a mutant that does not fire looks exactly like a
      // fixture that cannot fail, and only running it tells the two apart.
      const syms = (r.symbols ?? []).map((s: any) => ({ ...s, range: { ...(s.range ?? {}) } }))
      const byOwner = new Map<string, any[]>()
      for (const s of syms) {
        if (s.kind !== "property") continue
        const list = byOwner.get(String(s.ownerName)) ?? []
        list.push(s)
        byOwner.set(String(s.ownerName), list)
      }
      for (const c of syms) {
        if (c.kind !== "class") continue
        for (const p of byOwner.get(String(c.name)) ?? []) {
          // Same row, strictly inside: the all-on-one-line shape and nothing else.
          if (p.range.startLine !== c.range.startLine) continue
          if (!(p.range.startIndex > c.range.startIndex && p.range.endIndex < c.range.endIndex)) continue
          c.range.startIndex = p.range.startIndex
          c.range.endIndex = p.range.endIndex
          c.range.startColumn = p.range.startColumn
          c.range.endColumn = p.range.endColumn
          break
        }
      }
      return { ...r, symbols: syms }
    },
  },
  {
    id: "xml/ndata-notation-tier-back-to-structural",
    defectClass: "wrong-evidence-class",
    description:
      "The `dtd_ndata_notation` tier, reverted from `usage_contextual` to `structural`. `structural` is a claim that NESTING was observed, and no nesting is: XML 1.0 §4.5 writes the clause as `NDATA NotationName`, naming a notation the DTD declares elsewhere and necessarily earlier, so the notation's declaration is never inside the entity's. The containment ledger measured exactly 2 edges of this shape over the full 11,464-file admitted population — libxslt/tests/general/bug-21-.xml and bug-52.xml — with the target's span entirely before the source's in both. Nothing else in the lane can catch this: the census reports tier histograms and a role with 2 edges is inside its own noise, and no resolution rate is sensitive to an evidence class. `xml/dtd-ndata-notation-is-not-nesting` is the only assertion that pins it, through the `meta.evidenceClass` constraint and a forbid row on the pre-fix value.",
    transform: (r) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        x.metadata?.role === "dtd_ndata_notation" ? { ...x, metadata: { ...x.metadata, evidenceClass: "structural" } } : x,
      ),
    }),
  },
  {
    id: "xml/overrides-name-only-templates-counted",
    defectClass: "partial-implementation",
    description:
      "The lane's OWN census probe's defect, injected into the analyzer so it cannot come back. `validation/m14/fixtures/xml/ontology-census.mts`'s `same-file-template-override` probe keyed on `match|mode|priority` and ignored `name`, so every name-only template reduced to the key `||` and legal stylesheets read as collisions: it reported 3 occurrences in 3 files, and all nine templates behind them were verified by hand to be name-only (`name=\"dumptext\"` and two siblings in each of libxslt's two html.xsl, `name='transformCALSCell'` and two siblings in powershell's Maml_HTML_Style.xsl). This mutant drops the `match` requirement from the key, which is precisely that error, and must fail xml/xslt-competing-template-overrides on the `forbidRelationships` row targeting `dumptext` while rows 1, 3 and 4 stay green. The template names are recovered from `calls` TARGETS rather than from symbol metadata, because the pool pipeline strips custom symbol fields: a `calls` target is by construction a template name this stylesheet declares, so this mutant finds them the same way a consumer would.",
    transform: (r) => {
      const rels = r.relationships ?? []
      // Every declared template name this file calls, treated as if it carried no
      // pattern — which is what the census probe's `||` key did.
      const templateNames = [...new Set(rels.filter((x: any) => x.type === "calls").map((x: any) => String(x.target)))]
      const added: any[] = []
      for (const n of templateNames) {
        if (rels.some((x: any) => x.type === "overrides" && x.source === n)) continue
        added.push({
          source: n,
          target: n,
          type: "overrides",
          confidence: 1,
          line_number: 0,
          metadata: { role: "xslt_competing_template_rule", derivation: "xslt-5.5-later-template-replaces-earlier", resolvable: "in-document" },
        })
      }
      return { ...r, relationships: [...rels, ...added] }
    },
  },
  {
    id: "xml/references-source-is-the-vocabulary-tag",
    defectClass: "wrong-endpoint",
    description:
      "The references pass re-based onto the DECLARER, reverted. This is the defect the round measured at 1,066 of 10,411 corpus `references` edges and then reported rather than fixed: the source of an `attribute_qname_reference` edge is the element carrying the attribute, and when that element carries no `name=` of its own its symbol is the vocabulary's own tag text — so `<xs:element ref=\"comment\"/>` inside `<xs:complexType name=\"PurchaseOrderType\">` was emitted as `xs:element -> comment`, a type CONSTRUCTOR used where a DECLARER belongs. `xs:element` is a name no document declares, and bb_graph, bb_impact and bb_migrate then present it as a real type. Ret: the two edges whose source is the re-based declarer go back to the tag. It must fail xml/references-source-is-the-declarer on its two forbid rows naming `xs:element`, and on nothing else.",
    transform: (r) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        x.type === "references" && x.target === "comment" ? { ...x, source: "xs:element" } : x,
      ),
    }),
  },
  {
    id: "xml/references-source-walks-past-its-own-declaration",
    defectClass: "wrong-endpoint",
    description:
      "The other half of the same fix, and the one a blanket walk-up looks identical to. The rule has two branches — a carrier that DECLARES a name sources the reference itself, and only a carrier without one walks up — and this mutant deletes the first while keeping the walk. `<xs:element name=\"shipTo\" type=\"AddressType\"/>` therefore becomes `PurchaseOrderType -> AddressType`: a claim no document makes, on an edge that was CORRECT before the mutant, and a second fabricated endpoint rather than a repair of the first. It must fail xml/references-source-is-the-declarer on the forbid row `PurchaseOrderType -> AddressType`, the only assertion in the lane that can tell a declarer from its scope.",
    transform: (r) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        x.type === "references" && x.target === "AddressType" ? { ...x, source: "PurchaseOrderType" } : x,
      ),
    }),
  },
  {
    id: "xml/entity-reference-source-is-the-instruction",
    defectClass: "wrong-endpoint",
    description:
      "The entity pass left behind when the attribute pass was fixed, kept as its own mutant because it WAS left behind: the first implementation of the re-base touched `referenceCandidates` only, and 158 vocabulary-tag sources survived it, the largest remaining class being `&gt;` written inside `<xsl:if>` whose owner was the instruction. `<xsl:if>` is an XSLT instruction, not an entity — the use is written by the enclosing `<xsl:template name=\"row\">`. Ret: `row -> gt` becomes `xsl:if -> gt`. It must fail xml/references-source-is-the-declarer on the forbid row `xsl:if -> gt`.",
    transform: (r) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        x.type === "references" && x.target === "gt" ? { ...x, source: "xsl:if" } : x,
      ),
    }),
  },
  {
    id: "xml/public-id-published-as-an-import",
    defectClass: "fabricated-edge",
    description:
      "The public-identifier defect, reinstated in output terms. `extractExternalId` read `SystemLiteral ?? PubidLiteral` and its notation caller added `|| findDirectChild(node, \"PublicID\")`, so `<!NOTATION gif PUBLIC \"GIF\">` — a `PublicID` node carrying a `PubidLiteral` and no system literal — published `gif -imports-> gif` at `confidence: 1`. A public identifier is a catalogue name a parser matches, not a path it opens, so the edge named a file that does not exist. Found as the only `imports` edge in 11,552 corpus files with no site on the parse tree, and counted from two sides by public-id-census.mts: 1 pubid-only node against 1 `externalIdKind: \"public\"` edge. This mutant re-adds that edge for every notation DECLARATION the analyzer left without an import, which is the pre-fix output exactly: `jpeg` and `pairs` keep the edges they legitimately have, `gif` gains the fabricated one. It must fail xml/dtd-public-id-names-no-file on the `forbidRelationships` row constrained on `from: \"gif\"` alone — the row that names no target on purpose, so an analyzer that invented a different target instead would still be caught.",
    transform: (r) => {
      const has = new Set(
        (r.relationships ?? [])
          .filter((x: any) => x.type === "imports")
          .map((x: any) => `${x.source} ${x.target}`),
      )
      const invented = (r.symbols ?? [])
        .filter((s: any) => s.metadata?.isDtdNotationDeclaration === true)
        .filter((s: any) => !has.has(`${s.name} ${s.name}`))
        .map((s: any) => ({
          type: "imports",
          source: s.name,
          target: s.name,
          confidence: 1,
          metadata: { role: "notation_external_id", externalIdKind: "public" },
        }))
      return { ...r, relationships: [...(r.relationships ?? []), ...invented] }
    },
  },
  {
    id: "xml/notation-import-refused-entirely",
    defectClass: "over-correction",
    description:
      "The other half of the same fix, and the more likely way to get it wrong. Requiring a `SystemLiteral` is correct; refusing every notation import is not, and `<!NOTATION jpeg SYSTEM \"image/jpeg\">` names a real file exactly as an entity's `SYSTEM` id does — the corpus has 298 system-literal ExternalID nodes and the pre-fix analyzer emitted all 298. A fix that silenced the construct instead of the fabrication would pass a fixture written only around the bad case and would lose a real import class. This mutant drops every `imports` edge whose source is a notation declaration. It must fail xml/dtd-public-id-names-no-file on the `expectRelationships` rows `jpeg -> image/jpeg` and `pairs -> -//IETF//NOTATION TIFF//EN`, which is why the fixture carries a SYSTEM notation and a PUBLIC+SYSTEM notation as controls beside the public-id one.",
    transform: (r) => {
      const notations = new Set(
        (r.symbols ?? [])
          .filter((s: any) => s.metadata?.isDtdNotationDeclaration === true)
          .map((s: any) => s.name),
      )
      return {
        ...r,
        relationships: (r.relationships ?? []).filter(
          (x: any) => !(x.type === "imports" && notations.has(x.source)),
        ),
      }
    },
  },
{
    id: "xml/attribute-qualified-name-dropped",
    defectClass: "identity",
    description:
      "The 2026-10-05 fix, reverted exactly: an attribute symbol stops publishing a qualified name, so `parallel-indexer.ts:3038` falls back to `symbol.qualifiedName || symbol.name` and every attribute in the corpus re-enters the store's `_res_qname` PRIMARY KEY table under its local name. Measured before the fix on draw `099e7a868f7b73ee`: 83,454 of 83,454 `property` symbols and 1,002 of 1,002 `namespace` symbols carried `qualifiedName === name`, with 4,627 declarations named `fill` across 319 files and 9,819 named `name`. This mutant is NOT catchable by any shared fixture, because `qualifiedName` is absent from `run-fixtures.ts`'s CONSTRAINT_KEY_ALLOWLIST — which is why this file carries lane-owned property checks for it. Without them the fix would ship with no assertion able to fail.",
    transform: (r) => ({
      ...r,
      symbols: (r.symbols ?? []).map((s: any) =>
        isOwnedAttributeLike(s) ? { ...s, qualifiedName: undefined } : s,
      ),
    }),
  },
  {
    id: "xml/attribute-qualified-name-qualifies-with-the-owner-blank",
    defectClass: "over-correction",
    description:
      "The likelier way to get the same fix wrong, and the one a fixture written only around the repeated case would miss. Falling back to the BARE name instead of `owner + '.' + name` — for instance by reading the qualified name off the element the attribute is written on and losing the local name, or by dropping attributes whose owner is the document root. That publishes `path.fill` and `use.fill` as the single key `path`, which collides worse than before because it now also merges every other attribute of `<path>`. The property check catches it on the same fixture, from the opposite direction: the per-row assertion wants `owner.name` and the collision assertion catches one key spanning owners.",
    transform: (r) => ({
      ...r,
      symbols: (r.symbols ?? []).map((s: any) =>
        isOwnedAttributeLike(s) ? { ...s, qualifiedName: String(s.ownerName ?? "") } : s,
      ),
    }),
  },
  {
    id: "xml/attribute-local-name-reverted-to-the-prefixed-spelling",
    defectClass: "resolution-defect",
    description:
      "The 2026-10-05 resolution fix, reverted exactly. A namespaced attribute is published under its written spelling (`xml:space`) instead of its local part (`space`), and its `contains` edge targets the same written spelling. The store reduces every edge target to its last `:`/`.` segment before any lookup (`parallel-indexer.ts:3375-3390`, `extractLeaf`) and `resolveContainsTargetStmt` (`:2354-2360`) only ORDERS same-file first without FILTERING to the edge's file, so this spelling makes the declaration unfindable and the edge bind to a same-named declaration in an unrelated file. Measured through the real indexer on the 120-file draw `08d7fb24a87da7e7` (`validation/m14/fixtures/xml/store-binding-truth.mts`): of 3,803 `contains` rows, 179 unbound and 35 bound to another file, with 178 of the 179 having a project-unique declaration of the LOCAL name; after the fix, 49 unbound and 17 foreign-bound on 3,097 rows. It must fail xml/attribute-local-name on both halves independently — the `expectRelationships` rows naming the local targets and the `forbidRelationships` rows naming the prefixed ones — and it must fail xml/attribute-qualified-name, whose `<use pfx:href>` attribute is the second prefixed case in another document. The transform reads the written spelling off the EDGE's own `metadata.attributeName`, which survives the worker (relationship metadata is filtered for noise, not for keys), so the mutant needs no knowledge of the analyzer's internals; the symbol rename is driven off the same map, so this is a whole-feature revert rather than a half-revert that would fail for the wrong reason.",
    transform: (r) => {
      const rels: any[] = r.relationships ?? []
      const prefixed = new Map<string, string>()
      for (const x of rels) {
        const written = String(x?.metadata?.attributeName ?? "")
        if (x?.type === "contains" && written.includes(":")) prefixed.set(`${x.source}|${x.target}`, written)
      }
      return {
        ...r,
        symbols: (r.symbols ?? []).map((s: any) => {
          if (!isOwnedAttributeLike(s)) return s
          const written = prefixed.get(`${s.ownerName}|${s.name}`)
          return written ? { ...s, name: written, qualifiedName: `${s.ownerName}.${written}` } : s
        }),
        relationships: rels.map((x: any) => {
          const written = prefixed.get(`${x?.source}|${x?.target}`)
          return written ? { ...x, target: written } : x
        }),
      }
    },
  },
  {
    id: "xml/imports-target-class-removed",
    defectClass: "resolution-defect",
    description:
      "The cause-C feature, reverted exactly: `resolvable` is dropped from every `imports` edge. Measured before the feature, 0 of 263 `imports` edges on the census draw `3bd539410d1a9189` carried any class, so the census reported the whole type's resolvability block as `<none>` and a target naming a file the corpus holds was indistinguishable from a 404. It must fail xml/imports-target-class on all six `expectRelationships` rows, since every one of them pins `meta.resolvable` — and the pin is on the EDGE's own metadata, which the shared worker filters for noise rather than for keys, so the transform needs no knowledge of the analyzer's internals. Note what this mutant does NOT break: the `imports` edge COUNT, the targets and the `imports` rows are all unchanged, which is the point — the feature was added to a type that already emitted correctly and that no count-based assertion in the suite could see.",
    transform: (r) => {
      const rels: any[] = r.relationships ?? []
      return {
        ...r,
        relationships: rels.map((x: any) => {
          if (x?.type !== "imports") return x
          const rest = { ...(x?.metadata ?? {}) }
          delete rest.resolvable
          return { ...x, metadata: rest }
        }),
      }
    },
  },
  {
    id: "xml/imports-target-class-collapsed-to-one-value",
    defectClass: "resolution-defect",
    description:
      "The over-correction this feature invites: every `imports` target stamped `external`. It is the shape cause C warns against in the other direction — marking everything excludes everything, and the store learns nothing. It must fail xml/imports-target-class on five of its six rows; `#local-style` is `in-document`, so that one agrees by accident and is the control that shows this is not a blanket renamer. The measurement that says the collapse would otherwise have been invisible: 153 of the 263 real targets are paths and 107 are URIs, so a single value mislabels 58.2 % of the type.",
    transform: (r) => {
      const rels: any[] = r.relationships ?? []
      return {
        ...r,
        relationships: rels.map((x: any) =>
          x?.type === "imports" ? { ...x, metadata: { ...(x?.metadata ?? {}), resolvable: "external" } } : x,
        ),
      }
    },
  },
  {
    id: "xml/imports-target-class-absolute-path-read-as-external",
    defectClass: "resolution-defect",
    description:
      "The narrowest mistake available in this feature: the class is decided by whether the target starts with `/`, so an ABSOLUTE local path is called `external` and only the leading-slash row of xml/imports-target-class notices. It exists because a `file` class and an `external` class are one character apart at the boundary, and a fixture using only relative paths and URIs would pass on both this mutant and its correct counterpart. The shipped implementation does NOT use this test — `isRemoteUri` returns false at the first `/`, backslash or `.` it meets, so `/absolute/rooted.xsd` reads as `file` and only a `:` reached before any of those counts as a scheme.",
    transform: (r) => {
      const rels: any[] = r.relationships ?? []
      return {
        ...r,
        relationships: rels.map((x: any) => {
          if (x?.type !== "imports") return x
          const t = String(x?.target ?? "")
          const cls = t.startsWith("/") ? "external" : (x?.metadata ?? {}).resolvable
          return { ...x, metadata: { ...(x?.metadata ?? {}), resolvable: cls } }
        }),
      }
    },
  },
]

const args = process.argv.slice(2)
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : undefined

// A parser instance is not shareable across `analyze` calls, so the mutant wrapper
// constructs a REAL analyzer per call exactly as the shared harness does.
const mutantFor = (m: Mutant) => ({
  analyze: async (...a: any[]) => {
    const real = new RealXmlAnalyzer()
    // The real analyzer re-parses damaged regions through this hook; without it the
    // recovery-labelling fixture loses its input.
    ;(real as any).setParserForRecovery?.(globalThis.__bbParserForXmlMutants)
    return m.transform(await real.analyze(...(a as [any, any, any])))
  },
  transform: m.transform,
})

console.log("xml ontology mutants — proving the new fixtures can fail\n")
const base = await runLang("xml")
const baseProps = await runPropertyChecks()
const basePropProblems = propertyProblemCount(baseProps)
console.log(`baseline (unmutated): ${base.pass} pass, ${base.fail} fail; ${basePropProblems} property problems`)
if (base.fail !== 0 || basePropProblems > 0) {
  console.error("\nBASELINE IS ALREADY RED — a mutant result would be unreadable. Fix the lane first.")
  for (const [id, problems] of Object.entries(baseProps)) {
    for (const p of problems) console.error(`  ${id}: ${p}`)
  }
  process.exit(1)
}

let survivors = 0
const log: any[] = []
for (const m of MUTANTS) {
  const mutated = await runLang("xml", mutantFor(m))
  const mutProps = await runPropertyChecks(m.transform)
  const baseProblems = base.details.reduce((a: number, d: any) => a + (d.problems?.length ?? 0), 0)
  const mutProblems = mutated.details.reduce((a: number, d: any) => a + (d.problems?.length ?? 0), 0)
  const mutPropProblems = propertyProblemCount(mutProps)
  const caught = mutated.fail > base.fail || mutProblems > baseProblems || mutPropProblems > basePropProblems
  const caughtByFixtures = mutated.details
    .filter((d) => !d.ok)
    .map((d: any) => d.fixture)
    .filter((f) => !base.details.some((bd: any) => !bd.ok && bd.fixture === f))
    .join(", ")
  const caughtByProps = Object.entries(mutProps)
    .filter(([, problems]) => problems.length > 0)
    .map(([id]) => id)
    .join(", ")
  const caughtBy = [caughtByFixtures, caughtByProps].filter((s) => s.length > 0).join(" + ")
  console.log(
    `${caught ? "CAUGHT    " : "SURVIVED  "} ${m.id}\n` +
      `             fixtures ${base.fail} -> ${mutated.fail} failures; ` +
      `property checks ${basePropProblems} -> ${mutPropProblems} problems` +
      `${caughtBy ? "; caught by: " + caughtBy : ""}`,
  )
  log.push({
    mutant: m.id,
    defectClass: m.defectClass,
    description: m.description,
    caught,
    detail: `fixtures ${base.fail} -> ${mutated.fail}; property ${basePropProblems} -> ${mutPropProblems}`,
    caughtBy,
  })
  if (!caught) survivors++
}

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify({ base: { pass: base.pass, fail: base.fail, propertyProblems: basePropProblems }, mutants: log, survivors }, null, 2))
}
console.log(`\n${MUTANTS.length - survivors}/${MUTANTS.length} caught, ${survivors} survivors`)
if (survivors > 0) {
  console.error("\n>>> A SURVIVING MUTANT IS A FIXTURE THAT CANNOT FAIL. The mutant fails, not the fixture.")
  process.exit(1)
}
console.log("every mutant was caught by at least one assertion in this lane's fixtures")