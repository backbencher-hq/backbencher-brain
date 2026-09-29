/**
 * M14.0.F4 — the MARKDOWN mutant set.
 *
 * Every entry is a faithful REVERT of a shape this lane was MEASURED to emit, written
 * generically off the result's own fields — never a name filter, because a name filter
 * silently stops matching the moment a fixture is renamed. Each `description` names the
 * `caughtBy` fixture or probe, so a reader can see which pin carries the class rather
 * than having to trust that one exists.
 *
 * THE LANE HAD ZERO MUTANTS, and that was the finding rather than a footnote. It is the
 * finding the SCSS lane had and the one the M14 standing rules call the real shame: a
 * suite that cannot go red proves nothing about the thing it is green for. markdown
 * was greener than almost any lane in the repository — M12 differential precision
 * 1.000, contract probe 31/31, shape census 28 live / 0 dead, corpus 734 clean with 0
 * crashes — while erasing 47% of its code blocks and 100% of its reference links.
 *
 * EVERY MUTANT BELOW REVERTS A DEFECT FIXED IN THIS ROUND, which is worth more than one
 * for a defect merely remembered, because the fixture that catches it is already known
 * to be load-bearing:
 *
 *   `markdown/site-identity-collapsed`   1,920 of 4,078 code blocks erased, 406 of 738 files
 *   `markdown/reference-links-dropped`   671 reference-link sites invisible
 *   `markdown/undefined-ref-published`   171 fabricated endpoints, dominated by `NOTICE.md -> 1`
 *   `markdown/line-number-dropped`       0 of 9,132 relationships carried a line
 *   `markdown/evidence-class-dropped`    `contains` rendered to readers as `inferred`
 *   `markdown/closing-run-retained`      `# H #` published as `H #`
 *   `markdown/empty-heading-published`   a `contains` chain named `#` -> `##` -> `###`
 *   `markdown/setext-multiline-joined`   a name containing a newline
 *   `markdown/code-span-link-emitted`    a link inside backticks published as a link
 *   `markdown/repeat-site-name-collapsed`   28.7% of relationships named a symbol the file did not declare
 *   `markdown/parent-name-collision-dropped` a heading under an identically-named parent published no edge
 *   `markdown/table-column-symbol-dropped`  every table-column edge named a symbol that was never declared
 *   `markdown/internal-anchor-unresolved`  10,174 same-document references, none of them resolvable
 *   `markdown/indented-code-block-dropped`  217 nodes the block grammar calls code, published as nothing
 *
 * The last one is the most interesting, and it inverts the usual shape. Every other
 * mutant REMOVES a fact; that one ADDS one, by descending into `code_span` children that
 * the named-child walk structurally cannot reach. It is the only mutant here whose
 * survival would mean the ANALYZER is right and the PIN is wrong, which is why it is
 * worth having: a lane that can only be broken by subtraction has never been shown to
 * agree about what it must not publish.
 */

interface MutantResult {
  symbols?: any[]
  relationships?: any[]
  metadata?: Record<string, any>
  [k: string]: any
}

const dropRelField = (field: string) => (r: MutantResult) => ({
  ...r,
  relationships: (r.relationships ?? []).map((x: any) => {
    const { [field]: _dropped, ...rest } = x
    return rest
  }),
})

const dropRelMeta = (key: string) => (r: MutantResult) => ({
  ...r,
  relationships: (r.relationships ?? []).map((x: any) => ({
    ...x,
    metadata: Object.fromEntries(Object.entries(x.metadata ?? {}).filter(([k]) => k !== key)),
  })),
})

const dropSymMeta = (key: string) => (r: MutantResult) => ({
  ...r,
  symbols: (r.symbols ?? []).map((s: any) => ({
    ...s,
    metadata: Object.fromEntries(Object.entries(s.metadata ?? {}).filter(([k]) => k !== key)),
  })),
})

/** Drop every `uses` edge whose `linkForm` says it came from a reference link. */
const dropReferenceLinkEdges: (r: MutantResult) => MutantResult = (r) => ({
  ...r,
  relationships: (r.relationships ?? []).filter(
    (x: any) => !(x.type === "uses" && x.metadata?.linkForm && x.metadata?.linkForm !== "inline_link"),
  ),
})

export const MARKDOWN_MUTANTS = [
  // ---------------------------------------------------------------- site identity
  {
    id: "markdown/site-identity-collapsed",
    language: "markdown",
    defectClass: "relationship-loss",
    description:
      "MD-2 REVERT: a repeated site is collapsed back to its first occurrence, i.e. the " +
      "`owner + name` key that erased 1,920 of the grammar's 4,078 `fenced_code_block` nodes " +
      "across 406 of 738 corpus files (worst case docs/_spec/05-classes-and-objects.md, 79 sites " +
      "published as 24 symbols). Caught by markdown/code-block-site-identity, whose " +
      "`expectSymbolCount { equals: 2 }` on a two-block owner cannot be satisfied by a name-keyed lane.",
    transform: (r: MutantResult) => {
      // Collapse by (ownerName, name), keeping the FIRST of each — exactly the
      // pre-fix behaviour, expressed off the emitted fields rather than a name list.
      const keptSymbol = new Set<string>()
      const symbols: any[] = []
      for (const s of r.symbols ?? []) {
        const k = `${s.ownerName ?? ""}\u0000${s.name}`
        if (keptSymbol.has(k)) continue
        keptSymbol.add(k)
        symbols.push(s)
      }
      const keptRel = new Set<string>()
      const relationships: any[] = []
      for (const x of r.relationships ?? []) {
        const k = `${x.type}\u0000${x.source}\u0000${x.target}`
        if (keptRel.has(k)) continue
        keptRel.add(k)
        relationships.push(x)
      }
      return { ...r, symbols, relationships }
    },
  },

  // ---------------------------------------------------------------- reference links
  {
    id: "markdown/reference-links-dropped",
    language: "markdown",
    defectClass: "relationship-loss",
    description:
      "MD-1 REVERT: no edge is published for a reference link, i.e. the state in which 671 " +
      "sites (44 uses + 627 definitions) across 66 of 738 corpus files produced nothing while " +
      "the lane doc claimed 'Links (inline and reference destinations)'. Caught by " +
      "markdown/reference-links and F9-PROBE-MD1.",
    transform: dropReferenceLinkEdges,
  },
  {
    id: "markdown/undefined-ref-published",
    language: "markdown",
    defectClass: "fabricated-relationship",
    description:
      "MD-D1 REVERT: an UNDEFINED reference link publishes a `uses` edge to its bare label. " +
      "Measured on the corpus before it was rejected: 171 edges over 34 files, dominated by bare " +
      "bracketed citation markers (`NOTICE.md: document -> 1`, six times in one file) — fabricated " +
      "endpoints and an R10 target-spelling violation. Caught by markdown/reference-links' " +
      "`forbidRelationships` and F9-PROBE-MD1b, whose forbidden half is asserted on the ORACLE " +
      "too, so a lane that agreed with itself about this would fail as collusion.",
    transform: (r: MutantResult) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        // Re-label a resolved reference edge as if it were unresolved-and-published:
        // the observable shape is an extra `uses` target that is a bare label.
        x.type === "uses" && x.metadata?.linkForm && x.metadata.linkForm !== "inline_link"
          ? { ...x, target: String(x.metadata?.linkText ?? x.target) }
          : x,
      ),
    }),
  },

  // ---------------------------------------------------------------- payload seam
  {
    id: "markdown/line-number-dropped",
    language: "markdown",
    defectClass: "payload-loss",
    description:
      "M59 REVERT: no relationship carries `line_number`, i.e. the state in which 0 of 9,132 " +
      "relationships had one while 35 of 41 sibling analyzers published it. Three measured " +
      "consequences: bb_graph's line-guarded caller/callee dedup skips every markdown edge, bb_doc " +
      "renders markdown citations with no `#L` anchor (85% NULL, the worst language in the index), " +
      "and the store's `(source, type, target, line)` key cannot separate two sites of one target — " +
      "which is what made the code-block identity defect unrecoverable. Caught by " +
      "markdown/payload-lines-evidence, whose `_everyRelationshipCarries` names all seven lines.",
    transform: dropRelField("line_number"),
  },
  {
    id: "markdown/evidence-class-dropped",
    language: "markdown",
    defectClass: "payload-loss",
    description:
      "M14 #419-D REVERT: no edge carries `evidenceClass`. The lane's own edges are then judged " +
      "by graph-core's read-time derivation, whose STRUCTURAL_TYPES set does not contain `contains` " +
      "— so the entire heading hierarchy, a direct AST parent/child relation, was rendered to " +
      "readers as `inferred`: 'a guess, treat as a hint, never as fact'. Measured before the fix: " +
      "0 of 9,132 relationships carried a class. Caught by markdown/payload-lines-evidence's two " +
      "`meta.evidenceClass` assertions.",
    transform: dropRelMeta("evidenceClass"),
  },
  {
    id: "markdown/site-flag-dropped",
    language: "markdown",
    defectClass: "payload-loss",
    description:
      "REVERT: `isRepeatedSite` is no longer set on a repeat. The repeats themselves still " +
      "publish (so this is subtler than the identity collapse), but a consumer can no longer " +
      "tell one code block from the next. Caught by markdown/code-block-site-identity's third " +
      "`expectSymbols` entry.",
    transform: dropSymMeta("isRepeatedSite"),
  },

  // ---------------------------------------------------------------- heading identity
  {
    id: "markdown/closing-run-retained",
    language: "markdown",
    defectClass: "wrong-identity",
    description:
      "MD-6 REVERT: an ATX heading's closing `#` run stays in its published name, so `# H #` " +
      "publishes `H #`. A document that closes its headings and one that does not then produce two " +
      "different symbols for the same section. Caught by markdown/heading-identity's " +
      "`forbidSymbols { \"Closed with a trailing run ##\" }` and F9-PROBE-MD10.",
    transform: (r: MutantResult) => ({
      ...r,
      symbols: (r.symbols ?? []).map((s: any) =>
        typeof s.name === "string" && s.metadata?.nodeType === "atx_heading" && !s.name.endsWith("#")
          ? { ...s, name: `${s.name} #` }
          : s,
      ),
      relationships: (r.relationships ?? []).map((x: any) =>
        x.metadata?.role === "heading_hierarchy" && !String(x.target).endsWith("#")
          ? { ...x, target: `${x.target} #` }
          : x,
      ),
    }),
  },
  {
    id: "markdown/empty-heading-published",
    language: "markdown",
    defectClass: "fabricated-symbol",
    description:
      "MD-8 REVERT: an empty ATX heading publishes a symbol named after its OWN MARKER, so a " +
      "document of empty headings produces a `contains` chain named `#` -> `##` -> `###`. That is " +
      "the M60 R7 class — a name that is not a name, one step short of the register's own MARKER " +
      "pattern — and two sibling `##` headings both named `##` collided, so every heading after " +
      "them was attributed to the empty `#` as its owner. Caught by markdown/heading-identity's " +
      "`forbidSymbols` and F9-PROBE-MD9.",
    transform: (r: MutantResult) => ({
      ...r,
      symbols: (r.symbols ?? []).map((s: any) =>
        s.kind === "type" ? { ...s, name: `#${"#".repeat(Math.max(1, (s.metadata?.headingLevel as number) ?? 1))}` } : s,
      ),
    }),
  },
  {
    id: "markdown/setext-multiline-joined",
    language: "markdown",
    defectClass: "wrong-identity",
    description:
      "MD-7 REVERT: a multi-line setext heading's name is every line but the underline, so it " +
      "carries an embedded NEWLINE into `ownerName`, the qualified path and every display " +
      "surface. Measured pre-fix: \"Multi Line Title\\nsecond line of paragraph\". Caught by " +
      "markdown/heading-identity, whose `expectSymbolCount { equals: 1 }` on the setext name fails " +
      "when the name carries the continuation line.",
    transform: (r: MutantResult) => ({
      ...r,
      symbols: (r.symbols ?? []).map((s: any) =>
        s.metadata?.nodeType === "setext_heading" && typeof s.name === "string" && !s.name.includes("\n")
          ? { ...s, name: `${s.name}\\ncontinued` }
          : s,
      ),
    }),
  },

  // ---------------------------------------------------------------- the ADDITIVE mutant
  {
    id: "markdown/code-span-link-emitted",
    language: "markdown",
    defectClass: "fabricated-relationship",
    description:
      "The only ADDITIVE mutant here, and the most valuable: a link inside a `code_span` or a " +
      "closed fence is published as a link. Every other mutant removes a fact; this one adds " +
      "one, by descending into children the named-child walk structurally cannot reach — the " +
      "inline grammar gives a `code_span` only ANONYMOUS children, so a `link_destination` is " +
      "unreachable beneath one and the exclusion is a property a reader can check rather than a " +
      "filter someone remembered. If this mutant SURVIVES, the analyzer is right and the pin is " +
      "wrong, which is the only direction a subtraction-only mutant set can never reveal. Caught " +
      "by markdown/reference-links' `forbidRelationships` and F9-PROBE-MD6.",
    transform: (r: MutantResult, source?: string) => {
      const rels = [...(r.relationships ?? [])]
      if (source) {
        // Model the defect, not the fixture. The pre-fix behaviour being reverted is
        // "the walk descends EVERY child rather than only NAMED ones", and a
        // code_span's children are anonymous, so a link written inside backticks
        // would surface. The only honest way to reproduce that is to read the link
        // destinations out of the source's code spans — which is what the mutant
        // does, generically, naming nothing from any fixture.
        //
        // The FIRST version of this mutant tried to do it from the result alone by
        // cloning an existing `uses` edge, and it SURVIVED: the code-span link is
        // correctly absent from the result, so the clone condition never fired and
        // the mutant was a no-op that changed nothing for a fixture to catch. A
        // mutant that cannot fire is not a weak mutant, it is a dead one, and the
        // harness is right to refuse the suite over it.
        const codeSpanLinkTargets = (text: string): string[] => {
          const out: string[] = []
          // inline code spans: `...`
          for (const m of text.matchAll(/`+[^`\n]*`+/g)) {
            for (const lm of m[0].matchAll(/\]\(([^)\n]+)\)/g)) out.push(lm[1])
          }
          // fenced blocks: ``` ... ``` on their own lines
          for (const m of text.matchAll(/^[ \t]*`{3,}[^\n]*\n([\s\S]*?)^[ \t]*`{3,}[ \t]*$/gm)) {
            for (const lm of m[1].matchAll(/\]\(([^)\n]+)\)/g)) out.push(lm[1])
          }
          return out
        }
        for (const target of codeSpanLinkTargets(source)) {
          rels.push({
            source: "document",
            target,
            type: "uses",
            confidence: 1.0,
            metadata: { role: "markdown_link", linkText: target },
          })
        }
      }
      return { ...r, relationships: rels }
    },
  },
  // ---------------------------------------------------------------- endpoint resolvability
  {
    id: "markdown/repeat-site-name-collapsed",
    language: "markdown",
    defectClass: "dangling-endpoint",
    description:
      "REVERT: a repeated site publishes the BARE name again while its edge keeps the suffixed " +
      "spelling, i.e. the state this round measured at 529 of 1,843 relationships (28.7%) over 120 " +
      "scala3 markdown files naming a symbol the file did not declare. The store keys a " +
      "relationship by (source, type, target, line) and checks the target name against a denylist " +
      "rather than for existence, so an unsatisfiable name does not fail loudly -- it writes a row " +
      "referencing a symbol id no symbol row has. The diff could not see it: the independent " +
      "oracle derives the same suffixed spelling, so both sides agreed on a name neither " +
      "published, and two implementations sharing a convention is not evidence that the " +
      "convention resolves. Caught by markdown/code-block-site-identity's " +
      "`expectSymbolCount { name: code_block.scala#2, equals: 1 }` and by " +
      "markdown/table-structure's `forbidSymbols { Name/Meaning#2 }`.",
    transform: (r: MutantResult) => {
      const bare = (n: unknown) => (typeof n === "string" ? String(n).replace(/#\d+$/, "") : n)
      return {
        ...r,
        symbols: (r.symbols ?? []).map((s: any) => ({ ...s, name: bare(s.name) })),
        relationships: (r.relationships ?? []).map((x: any) => ({ ...x, target: bare(x.target) })),
      }
    },
  },
  {
    id: "markdown/parent-name-collision-dropped",
    language: "markdown",
    defectClass: "relationship-loss",
    description:
      "REVERT: the heading-hierarchy edge is dropped whenever the two ends spell the same string, " +
      "i.e. the self-edge filter is asked about NAMES rather than about identity. A `## Changelog` " +
      "under a `# Changelog` is two distinct sites -- the child's id is qualified by its parent's -- " +
      "so the containment is real and the edge must be published. Found by the differential rather " +
      "than by the read, and found quietly: the tree oracle derives the edge from the grammar, the " +
      "analyzer did not have it, and the kubernetes draw read MISSING=1 in about one draw in nine " +
      "(`vendor/github.com/google/uuid/CHANGELOG.md`), which is the rate at which a reader writes " +
      "a count off as sampling noise. Caught by markdown/heading-parent-name-collision, whose two " +
      "`Changelog -> Changelog` rows and `Setup -> Setup` row cannot be satisfied by a name-keyed filter.",
    transform: (r: MutantResult) => ({
      ...r,
      relationships: (r.relationships ?? []).filter(
        (x: any) => !(x.metadata?.role === "heading_hierarchy" && x.source === x.target),
      ),
    }),
  },
  {
    id: "markdown/table-column-symbol-dropped",
    language: "markdown",
    defectClass: "dangling-endpoint",
    description:
      "REVERT: a table column declares no symbol, while its `table_column` edge is still emitted -- " +
      "the state in which the analyzer's own comment said 'a column is a site too' and the site " +
      "never shipped. Measured after the repeat-site fix, over the same 120 files, 31 endpoints " +
      "still named no symbol and every remaining one was a column. The edges survive this mutant " +
      "on purpose: that is what made the defect invisible, because a count of relationships cannot " +
      "tell an edge to nothing from an edge to something. Caught by markdown/table-structure's " +
      "`isMarkdownTableColumn` assertions and its `Reading -> Reading` column edge.",
    transform: (r: MutantResult) => ({
      ...r,
      symbols: (r.symbols ?? []).filter((s: any) => !s.metadata?.isMarkdownTableColumn),
    }),
  },
  {
    id: "markdown/internal-anchor-unresolved",
    language: "markdown",
    defectClass: "dangling-endpoint",
    description:
      "REVERT: a same-document reference is published with its RAW FRAGMENT as the target, i.e. the " +
      "state this round measured at 10,174 fragments in a 420-file draw, every one an edge to a name no " +
      "symbol declared. A link writes a heading's ANCHOR and the lane published heading TEXT, so the two " +
      "spellings could not meet: `## Install Now!` publishes as `Install Now!` and a link to it says " +
      "`#install-now`, and nothing in the file is called `install-now`. 10,158 of those references now " +
      "resolve and 16 name a heading that does not exist. The differential could not see it for the same " +
      "reason it could not see MD-12: the oracle derived the same raw fragment, so the two agreed at 100% " +
      "on a name neither published. Caught by markdown/internal-anchor-links' `forbidRelationships`, whose " +
      "rows name the raw fragment specifically because an implementation that resolved nothing and one " +
      "that resolved everything-but-wrote-the-fragment both look correct to a count.",
    transform: (r: MutantResult) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        x.metadata?.linkForm === "internal_anchor" ? { ...x, target: `#${x.metadata.anchor}` } : x,
      ),
    }),
  },
  {
    id: "markdown/indented-code-block-dropped",
    language: "markdown",
    defectClass: "symbol-loss",
    description:
      "MD-G1 REVERT: an INDENTED (four-space) code block publishes nothing, while the fenced form beside it " +
      "publishes a per-site `function`. Measured with the block grammar over 1,138 pinned corpus files: 217 " +
      "`indented_code_block` nodes, every one of them a node the grammar names. The gap originally recorded 2 " +
      "sites, measured by a text heuristic; the grammar is 100x that, and most of the 217 are the wrapped " +
      "continuation lines of deeply-nested list items, which CommonMark genuinely reads as indented code. So the " +
      "revert deletes 217 symbols, which is why the symbol COUNT is the assertion here and not a name: a lane " +
      "that published them under a different name would satisfy a name filter and still lose the construct. " +
      "Caught by markdown/indented-code-block, whose expectSymbolCount totals 6 blocks across 3 sections and " +
      "whose `Not a code block` forbid rows stop the fixture being satisfied by treating any indented line as code.",
    transform: (r: MutantResult) => ({
      ...r,
      symbols: (r.symbols ?? []).filter((s: any) => s.metadata?.nodeType !== "indented_code_block"),
    }),
  },
]
