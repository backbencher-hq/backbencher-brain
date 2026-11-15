import Link from "next/link"
import { EMITS_COUNTS, ONTOLOGY, PARSERS, RELATIONSHIP_TYPES } from "@/data/brain-languages"
import { TRUTH } from "@/data/truth.generated"
import { EMITS_EMPTY, EMITS_MAX, EMITS_SPREAD } from "./family-data"

// The two blocks that explain what the index rows above them mean.
//
// WHAT REPLACED THE GRADES
// ------------------------
// Round 1 of this page carried a "Depth is graded, not implied" section built on
// a `tier` of full / structural / generic. Every clause of it was false. It told
// readers that TOML, Protobuf, Visual Basic and Nim had no dedicated analyzer —
// they each have a large hand-written one — and it described `GenericAnalyzer`,
// which is the unreachable `default:` branch of `getAnalyzer`. Nothing here ranks
// a family. A missing relationship type is not, by itself, a fact about the
// format: it is either a written ruling or a derived absence. Both blocks below
// say which, with counts a reader can check.
//
// 2026-11-07 — Evidence Atlas surface. Both blocks now sit in the page's reading
// column: serif section headings, hairline rows, a real table for the spread, and
// no icon row. The pipeline's label is still the gate-pinned literal "What
// happens when you index" and it is now the section's own heading rather than an
// eyebrow above one; the docs deep link it must carry is unchanged.
//
// TYPE FLOOR
// ----------
// Nothing in this file renders below 13px for content: labels 10.5–11px mono are
// labels, prose is 14–15px, and the two section headings are the page's own.

/** Gate-pinned literal, and the honest name for what the four steps are. */
const PIPELINE_LABEL = "What happens when you index"

export function IndexPipeline() {
  const steps = [
    {
      step: "01",
      title: "Parse",
      text: `A dedicated tree-sitter grammar reads each file as a syntax tree. ${PARSERS.length} of the ${TRUTH.languages.classified} registry entries have one; the other three — TSX, Sass and Terraform — are aliases read by their parent language's analyzer.`,
    },
    {
      step: "02",
      title: "Extract",
      text: "The family's own analyzer walks that tree and records symbols with exact start and end positions, plus the relationships it can construct from the file.",
    },
    {
      step: "03",
      title: "Store",
      text: `Files, symbols, relationships and annotations are written to the project's own index — ${TRUTH.tables} tables in one database file, no service to call.`,
    },
    {
      step: "04",
      title: "Read",
      text: `That one store is what the ${TRUTH.tools.length} agent tools, the CLI and the editor integrations read. A query is answered from the rows in it.`,
    },
  ]

  return (
    <section id="pipeline" className="lang-model">
      <h2>{PIPELINE_LABEL}</h2>
      <ol className="lang-steps">
        {steps.map((entry) => (
          <li key={entry.step} className="lang-step">
            <p className="k">{entry.step}</p>
            <p className="step-title">{entry.title}</p>
            <p className="step-text">{entry.text}</p>
          </li>
        ))}
      </ol>
      <p className="lang-model-more">
        <Link href="/docs#how-the-index-works" prefetch={false}>
          The whole pipeline in the docs <span aria-hidden>→</span>
        </Link>
      </p>
    </section>
  )
}

/**
 * The relationship vocabulary: what the types are, why one can be absent without
 * anything being broken, and how widely each one is published.
 *
 * ONTOLOGY is the three-part vocabulary — emitted, ruled, evidence class — read
 * straight off the dataset so the definitions cannot drift from the engine.
 * EMITS_COUNTS is the coverage claim, and it is the checkable kind: every number
 * below is `PARSERS.filter(p => p.emits.includes(type)).length`, rendered as a
 * row a reader can count. The spread is deliberately left untidied into buckets.
 * `contains` is near universal and `exports` is a minority, and that difference
 * is interesting and true; three neat columns would have hidden it.
 *
 * The family names are not repeated here: every type's publishers are the chips
 * on the records above, and printing the names again would be the same list a
 * second time. The count is the fact; the records are where the names live.
 */
export function VocabularyModel() {
  const families = PARSERS.length

  return (
    <section id="relationship-vocabulary" className="lang-model lang-vocab">
      <h2>A missing type is a ruling, not a gap.</h2>
      <p className="lang-model-lead">{VOCABULARY_LEAD}</p>

      <h3>Three words this index uses</h3>
      <dl className="lang-vocab-defs">
        {ONTOLOGY.map((entry) => (
          <div key={entry.label} className="lang-vocab-def">
            <dt>{entry.label}</dt>
            <dd>
              {entry.what}
              <span className="note">{entry.note}</span>
            </dd>
          </div>
        ))}
      </dl>

      <h3>
        {RELATIONSHIP_TYPES.length} types, counted across {families} families
      </h3>
      <div className="lang-spread-wrap overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th scope="col">Relationship type</th>
              <th scope="col">Families that publish it</th>
            </tr>
          </thead>
          <tbody>
            {EMITS_SPREAD.map((row) => (
              <tr key={row.type}>
                <td>
                  <code className="lang-spread-type">{row.type}</code>
                </td>
                <td>
                  <span className="lang-spread-cell">
                    <span className="lang-spread-count">{row.families}</span>
                    <span aria-hidden className="lang-spread-bar">
                      <i style={{ width: `${Math.round((row.families / EMITS_MAX) * 100)}%` }} />
                    </span>
                    <span className="sr-only">of {families} families</span>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="lang-spread-note">
        Bars are scaled to the widest type, so the shape of the spread is the claim; the number beside each bar is the
        one to count. Widest first is a reading order and nothing more — no family is ranked by it anywhere on this
        page. A count can include edges a family publishes from an analyzer it delegates inline blocks to, and that
        family&apos;s own record says so.
      </p>

      <p className="lang-spread-note">
        On each family&apos;s own record, an absent type is marked <em>ruled absent</em> only where that family&apos;s
        analyzer page carries the written ruling and corpus measurement; otherwise it is marked <em>not constructed</em>,
        which is the derivation and nothing more. A missing type is never presented as a fact about the format on the
        strength of the derivation alone.
      </p>

      <h3>A ruled type is a falsifiable claim</h3>
      <p>
        Calling a type ruled is the strongest thing this page says, because it can be checked. No construct in the
        language produces the edge, the reason is written down, and the construct is measured against the corpus —{" "}
        <code>script/m14/ontology-coverage-gate.ts</code> fails the build if it ever turns up. A wrong ruling cannot
        survive that gate.
      </p>
      <p>
        TOML is the clearest case. It publishes containment and nothing else, because{" "}
        <code>path = &quot;src/main.rs&quot;</code> is a string: TOML defines no include, no import and no reference
        mechanism, so reading it as an edge would import ecosystem knowledge the format does not carry. Markdown, JSON,
        YAML, GraphQL, HCL and XML are ruled for <code>calls</code> on the same ground — a heading cannot call
        anything. SQL is not ruled: it emits <code>calls</code> for trigger-to-function and non-builtin invocation.
      </p>
      {EMITS_EMPTY.length > 0 ? (
        <p className="lang-spread-note">
          One footnote about the derivation itself: {EMITS_EMPTY.join(", ")} comes back with an empty vocabulary from
          this pass, because its analyzer builds edges through a differently-shaped helper. An empty row records what
          the derivation found, not the absence of edges.
        </p>
      ) : null}
    </section>
  )
}

/**
 * The lead for the vocabulary section: the shape of the spread, in one
 * sentence, with every number derived. The widest and narrowest are read off
 * the sorted rows rather than named by hand, so adding a family cannot leave
 * this sentence describing a spread that no longer exists.
 */
export const VOCABULARY_LEAD = (() => {
  const widest = EMITS_SPREAD[0]
  const narrowest = EMITS_SPREAD[EMITS_SPREAD.length - 1]
  if (!widest || !narrowest) return ""
  const share = (row: typeof widest) =>
    row.families === PARSERS.length ? `all ${row.families}` : `${row.families} of ${PARSERS.length}`
  return `${EMITS_COUNTS.length} relationship types are declared by the engine's enum. The widest is ${widest.type}, published by ${share(widest)} families; the narrowest is ${narrowest.type}, published by ${share(narrowest)}. Every count below is a row you can check against the records above.`
})()
