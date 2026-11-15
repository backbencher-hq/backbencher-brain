import Link from "next/link"
import { PARSERS, RELATIONSHIP_TYPES } from "@/data/brain-languages"
import { TRUTH } from "@/data/truth.generated"
import { DEPTH_COVERAGE } from "@/data/language-depth"
import { AtlasPage, PageHead } from "@/components/atlas/AtlasPage"
import { CONSOLE_CSS, ROWS, SYNC_SLUGS } from "@/components/languages/family-data"
import { LANGUAGES_ATLAS_CSS } from "@/components/languages/atlas-css"
import { FamilyRail } from "@/components/languages/family-rail"
import { FamilyPanel } from "@/components/languages/family-panel"
import { FamilyConsoleSync } from "@/components/languages/family-console-sync"
import { IndexPipeline, VocabularyModel } from "@/components/languages/index-model"

// The languages console — an index into /languages/<slug>.
//
// WHAT THIS PAGE IS FOR
// ---------------------
// One job: let a reader find their language and see what indexing it gets them.
// So the console comes first, before any explanation, and the two blocks that
// explain the rows come after it. The homepage argues for the product and
// enumerates the coverage once; a family page answers one question about one
// language. This page is the index between them, and it is written in the
// register of an index: counts you can check, chips you can count, and no claim
// that a row three screens up does not already make.
//
// WHAT ROUND 1 GOT WRONG, AND WHY IT IS NOT HERE ANY MORE
// -------------------------------------------------------
// It opened with an eyebrow, a serif heading, a lead and a plate of stages — the
// homepage's opening, verbatim in shape — and then printed a "depth grades"
// section as the authoritative account of the product's depth. That section
// claimed four languages had no dedicated analyzer, that their symbols came from
// a generic traversal pass, and that no call graph was resolved for them. All
// false: TOML, Protobuf, Visual Basic and Nim each have a large hand-written
// analyzer, and `GenericAnalyzer` is the unreachable `default:` branch of
// `getAnalyzer`. The grade it was built on was never defined in src/ and ranked
// the product backwards. It is gone from the dataset and gone from this page.
//
// 2026-11-07 — Evidence Atlas surface. The page is a paper index: a serif title
// block, a hairline rail of 50 families, one record at a time, then the pipeline
// and the vocabulary in the reading column. No dark console, no cards, no
// eyebrow above the heading (the heading is the surface's name), and every fact
// printed once. The interaction is untouched: hidden radios and a generated
// `:has()` rule, with the fragment selecting a family, so the console works with
// no client JavaScript. styles live in components/languages/atlas-css.ts.
//
// Everything is server-rendered. No count on this page is typed: every number is
// read from TRUTH or counted off PARSERS at render time.

export default function LanguagesPage() {
  return (
    <AtlasPage>
      <style dangerouslySetInnerHTML={{ __html: `${CONSOLE_CSS}\n${LANGUAGES_ATLAS_CSS}` }} />
      <div className="container">
        <PageHead
          title="Languages & analyzers"
          lead={
            <>
              Each name below is a display family over one or more registry entries, read by its own hand-written
              analyzer rather than a generic pass. Its record gives you the extensions it claims, the ids it answers
              to, the symbols it records and the relationship types it constructs — and every record links to the page
              that holds the rest of it.
            </>
          }
          meta={
            <>
              {TRUTH.languages.classified} registry entries · {TRUTH.languages.dedicatedParsers} dedicated grammars ·{' '}
              {PARSERS.length} display families · {RELATIONSHIP_TYPES.length} relationship types
            </>
          }
        />

        {/* ── THE CONSOLE ────────────────────────────────────────────────
            First, because it is the job. Rail on the left at every width, so
            the first thing a reader can do is pick a name. */}
        <section id="families" className="languages-index">
          <div className="lang-index-head">
            <div>
              <h2>{PARSERS.length} records. Pick the one you write.</h2>
              <p className="intro">
                Choosing a row swaps the record beside it. The cells in that record are audited against the language
                registry and the analyzer modules; the note under them is the family&rsquo;s own written record, and
                the link opens the page that holds the rest.
              </p>
            </div>
            {/* A work-in-progress count, so it is stated rather than implied. */}
            <p className="lang-notes">
              <b>Written records</b>
              {DEPTH_COVERAGE.authored} of {DEPTH_COVERAGE.total} families carry an authored note. A family without one
              still prints its audited facts and says so rather than borrowing a template sentence.
            </p>
          </div>

          <div className="languages-shell">
            {/* The hook name lives here, not inside the component: globals.css
                paints the keyboard focus ring on `.console-index label` because
                each row's radio is sr-only. */}
            <FamilyRail className="console-index" />
            <div className="languages-panels">
              {ROWS.map((row) => (
                <FamilyPanel key={row.parser.name} row={row} />
              ))}
            </div>
          </div>
        </section>

        {/* ── THE MODEL ─────────────────────────────────────────────────── */}
        <div className="reading">
          <IndexPipeline />
          <VocabularyModel />
        </div>

        <div className="lang-source">
          <p>
            Extensions, registry ids and the recorded symbols are read from the table the engine&rsquo;s own{' '}
            <code>SUPPORTED_LANGUAGES</code> registry generates; the relationship types are derived from the analyzer
            modules in <code>src/ast</code> rather than typed in beside them. If a row here disagrees with the code in
            front of you, that is a bug worth reporting.
          </p>
          <div className="lang-doors">
            <Link className="btn-ghost" href="/docs#how-the-index-works">
              How the index is built, in the docs <span aria-hidden>→</span>
            </Link>
            <Link className="btn-ghost" href="/tools">
              The {TRUTH.tools.length} tools that read what these record <span aria-hidden>→</span>
            </Link>
          </div>
        </div>
      </div>
      <FamilyConsoleSync slugs={SYNC_SLUGS} />
    </AtlasPage>
  )
}
