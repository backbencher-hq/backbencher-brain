import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { BANDS, PARSERS, RELATIONSHIP_TYPES } from "@/data/brain-languages"
import type { LangFamily } from "@/data/brain-languages"
import { depthFor, languageHref, slugFor, slugToFamily } from "@/data/language-depth"
import { TRUTH } from "@/data/truth.generated"
import { LANGUAGE_RULINGS } from "@/data/language-rulings.generated"
import { AtlasPage, PageHead } from "@/components/atlas/AtlasPage"
import { LANGUAGE_DETAIL_ATLAS_CSS } from "@/components/languages/atlas-css"
import {
  emittedTypes,
  reachLabel,
  registryHeadline,
  unconstructedTypes,
  VOCABULARY_SIZE,
} from "@/components/languages/detail/emits"
import { CLAIMS, highlight } from "@/components/languages/detail/highlight"
import { Rich } from "@/components/languages/detail/Rich"

// /languages/[slug] — one page per family, answering one question about it.
//
// WHY THIS PAGE EXISTS
// --------------------
// The owner of this project said it plainly: "in the languages take, only the
// languages are listed, nothing at all is told there of what is being done
// there, like just the names of languages, that's it." The register fixed the
// listing half. This is the page that answers the question a reader arrives with:
//
//     what does indexing this language buy me, and what does it not?
//
// WHAT IT MAY AND MAY NOT SAY (round 2)
// --------------------------------------
// Round 1 of these pages rendered tier-based boilerplate, and on four live pages
// — TOML, Protobuf, Visual Basic, Nim — it asserted that they had no dedicated
// analyzer and no call graph. Every one of those families has a large
// hand-written analyzer wired into `getAnalyzer`; `GenericAnalyzer` is that
// switch's unreachable `default:` branch. So this page carries no sentence bank.
// Every claim on it comes from one of three places, and nowhere else:
//
//   · the family row — extensions, registry ids, recorded symbols, `emits`;
//   · the family's authored record in data/language-depth;
//   · the generated ruling table (data/language-rulings.generated.ts), which
//     says whether the analyzer page records a ruling for an absent type;
//   · TRUTH, for the counts the whole site shares.
//
// Where the record has not landed, the page shows less. It does not substitute a
// template, because the template is what produced the lie: a prewritten "ceiling"
// line, chosen by tier, is a sentence nobody checked against an analyzer.
//
// THE ORDER IS AN ARGUMENT
// ------------------------
// The headline says what you get. The registry row and the ledger say how much,
// and which of the engine's fourteen relationship types are in play. Limitations
// comes next, because it is the other half of the same sentence and belongs in the
// first screen. Then the mechanics — where the files sit, what an agent can ask,
// what the analyzer sees in one of them — and only then the exits.
//
// 2026-11-07 — Evidence Atlas surface. AtlasPage chrome + PageHead, the reading
// column from globals.css, one hairline table for the ledger, one night plate for
// the sample. The previous page-local component set (Frame/RegistryFacts/AskList/
// SnippetPlate/Limitations/RelatedLanguages) was replaced by this page's own
// markup so the heading outline is the reading column's (h2 sections, no eyebrow
// kickers) and every fact still renders once.
//
// ROUTING
// -------
// `output: static`, so every declared slug is generated from the slug contract
// and `dynamicParams = false` makes an unknown slug a 404 rather than an empty
// page. Slugs are never hand-written: they come from data/language-depth/slugs.

type Params = Promise<{ slug: string }>

function parserFor(slug: string): LangFamily | undefined {
  const family = slugToFamily[slug]
  if (!family) return undefined
  return PARSERS.find((p) => p.name === family)
}

export function generateStaticParams() {
  return Object.keys(slugToFamily).map((slug) => ({ slug }))
}

export const dynamicParams = false

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params
  const parser = parserFor(slug)
  // dynamicParams=false means this branch never renders a page; it exists so a
  // bad param can never produce an empty <head> with someone else's canonical.
  if (!parser) return { title: "Language not found" }
  const reach = emittedTypes(parser.emits).length
  return {
    // `absolute`, because the root layout's "%s | Backbencher" template does
    // not reach a route two segments down — /languages/layout.tsx declares a
    // plain string title, which ends the chain — and a nested page must not
    // depend on where that chain happens to stop. Writing the suffix here keeps
    // this title exactly what it says, and immune to a fix elsewhere. The family
    // name makes it unique across every route on the site.
    title: {
      absolute: `${parser.name} — the symbols bb records, and where it stops | Backbencher`,
    },
    // Unique per family for the same reason: the extensions, the recorded
    // symbols and the size of the emitted vocabulary are all family-specific, so
    // no two of these descriptions can collide.
    description: `${parser.ext} files: bb records ${parser.extracts}, and constructs ${reach} of the engine's ${VOCABULARY_SIZE} relationship types. What an agent can retrieve from ${parser.name} code — and the limitations that come with it.`,
    alternates: { canonical: `/languages/${slugFor(parser.name)}` },
  }
}

export default async function LanguageDetailPage({ params }: { params: Params }) {
  const { slug } = await params
  const parser = parserFor(slug)
  if (!parser) notFound()

  const band = BANDS.find((b) => b.names.includes(parser.name))
  const depth = depthFor(parser.name)

  // One sentence about what indexing buys. The authored record owns it; without
  // one, the page says only what its own row supports.
  const headline = depth?.headline ?? registryHeadline(parser)
  const asks = depth?.agentAsks ?? []
  const limitations = depth?.limitations ?? []
  const where = depth?.whereItShowsUp ?? []
  const sample = depth?.sample

  const emitted = emittedTypes(parser.emits)
  const absent = unconstructedTypes(emitted)
  // The ledger's other half: which absent types the canonical analyzer page
  // records as ruled absent, and which analyzers this one delegates inline
  // blocks to. Generated from docs/analyzers + the analyzer source, and
  // byte-checked by verify-language-rulings.ts.
  const rulings = LANGUAGE_RULINGS[slug] ?? null
  const ruled = new Set(rulings?.ruled ?? [])
  const unrecordedAbsent = absent.filter((type) => !ruled.has(type))
  const delegates = rulings?.delegates ?? []
  const delegatedTypes = new Set(rulings?.delegatedTypes ?? [])

  // The sibling band: every other family the same repositories tend to use.
  // Counts are derived from the same helper the ledger uses, so a sibling's
  // number and its own page cannot disagree.
  const siblings = (band?.names ?? [])
    .filter((name) => name !== parser.name)
    .map((name) => PARSERS.find((p) => p.name === name))
    .filter((p): p is LangFamily => Boolean(p))

  const tokens = sample ? highlight(sample.code) : []

  return (
    <AtlasPage>
      <style dangerouslySetInnerHTML={{ __html: LANGUAGE_DETAIL_ATLAS_CSS }} />
      <div className="container">
        {/* Breadcrumb — a leaf page must show where it hangs. */}
        <nav aria-label="Breadcrumb" className="lang-crumb">
          <Link href="/languages">← All languages</Link>
          <span aria-hidden>/</span>
          <span>{band?.label ?? "The register"}</span>
          <span aria-hidden>/</span>
          <span className="here">{parser.name}</span>
        </nav>

        {/* Head — what indexing this family buys you, in one sentence. */}
        <PageHead title={parser.name} lead={headline} meta={`${band?.label ?? "Unfiled"} · ${parser.ext}`} />

        <div className="reading">
          {/* The registry row, and the vocabulary it implies — the two blocks
              that carry every number on this page. */}
          <h2>The registry row this page is generated from</h2>
          <p>
            Read at render time from the same family row the register reads, so nothing in this block can disagree
            with it.
          </p>
          <dl className="lang-detail-facts">
            <div className="lang-detail-fact">
              <dt>Extensions</dt>
              <dd className="mono">{parser.ext}</dd>
            </div>
            <div className="lang-detail-fact">
              <dt>Registry names</dt>
              <dd>
                <span className="chips">
                  {parser.ids.map((id) => (
                    <code key={id}>{id}</code>
                  ))}
                </span>
              </dd>
            </div>
            <div className="lang-detail-fact">
              <dt>Recorded symbols</dt>
              <dd>{parser.extracts}</dd>
            </div>
          </dl>

          {/* The ledger: one row per relationship type the engine declares. An
              absent row states only what is known — "ruled absent" where the
              family's analyzer page records a ruling, "not constructed" where
              no ruling is recorded. Colour is never the only carrier. */}
          <h2>Relationship types this analyzer constructs</h2>
          <p>
            {emitted.length === 0
              ? `The family row records no relationship type here, so this page claims nothing about which of the ${VOCABULARY_SIZE} this analyzer constructs. The vocabulary below is drawn because it is the engine's own; what belongs in it is not yet on this row.`
              : `${reachLabel(emitted.length)} constructed, read from this analyzer's source and re-derived by the languages gate. Each row below is one of the engine's types, in the engine's own order.`}
          </p>
          <div className="lang-ledger-wrap overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th scope="col">Relationship type</th>
                  <th scope="col">Constructed</th>
                </tr>
              </thead>
              <tbody>
                {RELATIONSHIP_TYPES.map((type) => {
                  const constructed = emitted.includes(type)
                  return (
                    <tr key={type}>
                      <td>
                        <code>{type}</code>
                      </td>
                      <td className={constructed ? "hit" : "miss"}>
                        {constructed
                          ? delegatedTypes.has(type)
                            ? "published through delegated analyzers"
                            : "constructed by this analyzer"
                          : ruled.has(type)
                            ? "ruled absent"
                            : "not constructed"}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {emitted.length > 0 ? (
            <p className="lang-ledger-note">
              {emitted.length} constructed, {absent.length} not constructed.
              {delegates.length > 0 && delegatedTypes.size > 0
                ? ` The ${delegatedTypes.size} ${delegatedTypes.size === 1 ? "type" : "types"} marked as published through delegated analyzers come from the ${delegates.join(", ")} ${delegates.length === 1 ? "analyzer" : "analyzers"} this one hosts for inline blocks; their edges are stored under ${parser.name}.`
                : ""}
              {ruled.size > 0
                ? ruled.size === absent.length
                  ? ` ${ruled.size === 1 ? "The absent type is" : `All ${ruled.size} absent types are`} recorded as ruled absent: the written reason and the corpus measurement behind ${ruled.size === 1 ? "it" : "each"} are in this family's completeness record.`
                  : ` ${ruled.size} of the ${absent.length} absent ${ruled.size === 1 ? "type is" : "types are"} recorded as ruled absent: the written reason and the corpus measurement behind ${ruled.size === 1 ? "it" : "each"} are in this family's completeness record.`
                : ""}
              {unrecordedAbsent.length > 0
                ? ruled.size > 0
                  ? ` The other ${unrecordedAbsent.length} ${unrecordedAbsent.length === 1 ? "has" : "have"} no recorded ruling and ${unrecordedAbsent.length === 1 ? "is" : "are"} shown as not constructed; this page makes no claim about why.`
                  : ` This family's completeness record does not agree with the analyzer-source derivation on the emitted vocabulary, so no per-type ruling is claimed for ${unrecordedAbsent.length === 1 ? "that absence" : "those absences"}; ${unrecordedAbsent.length === 1 ? "it is" : "they are"} shown as not constructed and ${unrecordedAbsent.length === 1 ? "its" : "their"} absence is a derived fact, not a format claim.`
                : ""}{" "}
              <Link href="/languages#relationship-vocabulary">The register</Link> defines constructed, ruled and the
              gates each is checked by.
            </p>
          ) : null}

          {/* The other half of the ledger's sentence. */}
          <h2>What this analyzer does not resolve</h2>
          {limitations.length > 0 ? (
            <>
              <ul className="lang-limits">
                {limitations.map((line) => (
                  <li key={line}>
                    <Rich text={line} />
                  </li>
                ))}
              </ul>
              <p className="lang-ledger-note">
                Every line above was written against {parser.name}&apos;s own analyzer module and is named against a
                construct in it, so it can be checked against the source. Nothing here is inherited from a template, or
                from another language&apos;s page.
              </p>
            </>
          ) : (
            <p>
              No limitation has been written for this family yet, so this page asserts only what it can read:{" "}
              {parser.ext} files, the registry names above, {parser.extracts}, and{" "}
              {emitted.length === 0
                ? "no relationship type on this row"
                : `${emitted.length} of the ${VOCABULARY_SIZE} relationship types in the ledger`}
              . A general disclaimer would be a sentence nobody checked against an analyzer, so there is none here
              yet.
            </p>
          )}

          {where.length > 0 ? (
            <>
              <h2>Where you meet it in a repository</h2>
              <p>
                Recognised by extension — <code>{parser.ext}</code>. Everything below is about where those files
                actually sit in a working repository.
              </p>
              <ul className="lang-where">
                {where.map((note) => (
                  <li key={note}>
                    <Rich text={note} />
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {asks.length > 0 ? (
            <>
              <h2>Questions this index answers</h2>
              <p>
                Phrased as retrievals, because that is what an index can honestly do: it holds the symbols and the
                edges between them, and hands them back with the evidence attached.
              </p>
              <ol className="lang-asks">
                {asks.map((ask) => (
                  <li key={ask}>
                    <span>
                      <Rich text={ask} />
                    </span>
                  </li>
                ))}
              </ol>
            </>
          ) : null}

          {/* Six lines of the language, in the language — the one night plate on
              this page. What no table can show is what the analyzer sees in a
              file, which is why each family ships a short annotated sample. */}
          {sample ? (
            <>
              <h2>What the analyzer sees in code like this</h2>
              <figure className="lang-snippet">
                <figcaption>{sample.caption}</figcaption>
                <pre>
                  <code>
                    {tokens.map((token, i) => (
                      <span key={i} className={CLAIMS[token.kind]}>
                        {token.value}
                      </span>
                    ))}
                  </code>
                </pre>
              </figure>
              <p className="lang-ledger-note">
                Symbols are stored with the file they came from and the bytes they span, so a hit points at a line
                rather than at a guess. The annotations in the sample are commentary for the reader, not strings the
                index would store.
              </p>
            </>
          ) : null}

          {/* The exit, so the page never dead-ends. */}
          <h2>Languages that turn up in the same repository</h2>
          <p>
            {band?.label ?? "This band"} — the count beside each name is how many relationship types that family&rsquo;s
            analyzer constructs.
          </p>
          {siblings.length > 0 ? (
            <ul className="lang-siblings">
              {siblings.map((sibling) => (
                <li key={sibling.name}>
                  <Link href={languageHref(sibling.name)}>
                    <span>{sibling.name}</span>
                    <span className="n">{emittedTypes(sibling.emits).length} types</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p>No other family shares this band in the dataset.</p>
          )}
        </div>

        {/* Where this page's claims come from, restated once. */}
        <div className="detail-source">
          <p>
            The extensions, registry names, recorded symbols and relationship types above are the parser registry row
            for {parser.name}, read while the page rendered — the same row <Link href="/languages">the register</Link>{" "}
            reads, so the two surfaces cannot tell two stories. Every relationship type listed as constructed appears
            in <code>src/ast/real-*</code>, the analyzer modules bb ships. bb {TRUTH.version} answers from a local store
            over {PARSERS.length} languages ({TRUTH.languages.classified} registry ids, three of them aliases).
             There is no benchmark on this page: every claim here is one you can go and read in the source.
          </p>
        </div>

        <div className="page-actions">
          <Link className="btn-ghost" href="/languages">
            The whole register <span aria-hidden>→</span>
          </Link>
          <Link className="btn-ghost" href="/docs#how-the-index-works">
            How the index is built <span aria-hidden>→</span>
          </Link>
          <Link className="btn-ghost" href="/tools">
            The {TRUTH.tools.length} tools that read it <span aria-hidden>→</span>
          </Link>
        </div>
      </div>
    </AtlasPage>
  )
}
