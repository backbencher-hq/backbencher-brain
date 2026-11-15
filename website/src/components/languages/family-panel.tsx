import Link from "next/link"
import { depthFor, languageHref } from "@/data/language-depth"
import type { FamilyRow } from "./family-data"

// One family panel — the right column of the languages console. All 50 are
// server-rendered in the built HTML; the checked radio picks which one is
// visible (see CONSOLE_CSS in ./family-data).
//
// THE ORDER OF THE BLOCKS IS A CONTRACT, NOT A STYLE CHOICE
// ---------------------------------------------------------
// The audit gate reads the built HTML and, for every family, requires the file
// extension, the `extracts` line, every registry id as `>id</code>` and the
// family's relationship types to appear within 2600 characters of that family's
// `<h2>`. So:
//
//   <h2>Name</h2>
//   extensions · registry ids · records · relationship types   ← the audited
//                                                            core, nothing
//                                                            interleaved
//   ───────────────────────────────────────────────────────────
//   the record's headline + a link to the family's own page  ← editorial
//
// Interleaving a long intro above the id chips would push them out of range, and
// quietly dropping a chip to save characters would be a worse failure. So the
// core stays first and short — the audited facts are four hairline rows — and the
// preview is a sibling that starts after it. `script/m56/verify-languages-surface.ts`
// is the check.
//
// WHAT THE PANEL NO LONGER SAYS
// -----------------------------
// No grade. A tier pill used to sit beside the title and a promise sentence used
// to sit under it, and both were built on a `tier` field that had no definition
// in src/ and ranked the product backwards. A family's vocabulary now speaks for
// itself: the chips are the types its analyzer constructs, in the engine's own
// words, and their absence is explained a screen further down rather than
// apologised for here.
//
// 2026-11-07 — Evidence Atlas surface. The four facts are reading rows in the
// atlas measure rather than a grid of dark cells, and the editorial half is the
// record's headline plus the link that hands the reader the rest. The full
// ask list and the full limitations list live on /languages/<slug>: this console
// is the index, and printing them here would make every fact appear twice.
export function FamilyPanel({ row }: { row: FamilyRow }) {
  const { parser, slug, band, emits } = row
  // A family reaches this page before its detail page necessarily exists: the
  // slug contract is authored separately, and `languageHref` falls back to the
  // console itself for a family with no slug yet. Linking to the console under
  // the label "Open the X page" would be a lie, so the link is simply absent
  // until the slug lands, and the record above it still stands on its own.
  const href = slug ? languageHref(parser.name) : ""
  const depth = depthFor(parser.name)

  return (
    <article id={slug} data-panel={parser.name} className="lang-panel reading">
      <header className="lang-head">
        <h2 className="lang-name">{parser.name}</h2>
        <p className="lang-band">{band}</p>
      </header>

      {/* The audited core: extensions, registry ids, what the analyzer records,
          and the relationship types it can construct. Four rows, no editorial
          prose — everything here is checked against the engine registry and the
          analyzer modules by the gate. */}
      <dl className="lang-facts">
        <div className="lang-fact">
          <dt>Extensions</dt>
          <dd className="mono">{parser.ext}</dd>
        </div>
        <div className="lang-fact">
          <dt>Registry ids</dt>
          <dd>
            <span className="lang-chips">
              {parser.ids.map((id) => (
                <code key={id}>{id}</code>
              ))}
            </span>
          </dd>
        </div>
        <div className="lang-fact">
          <dt>What the analyzer records</dt>
          <dd>{parser.extracts}</dd>
        </div>
        <div className="lang-fact">
          <dt>Relationship types it publishes</dt>
          <dd>
            {emits.length > 0 ? (
              <span className="lang-chips">
                {emits.map((type) => (
                  <code key={type}>{type}</code>
                ))}
              </span>
            ) : (
              <span className="lang-missing">
                nothing listed by the current derivation — see the note under the vocabulary table
              </span>
            )}
          </dd>
        </div>
      </dl>

      {/* Everything editorial starts here — below the audited core. */}
      <div className="lang-depth">
        {depth ? (
          <p className="headline">{depth.headline}</p>
        ) : (
          <p className="pending">
            Every {parser.name} file is parsed and read by a hand-written analyzer, and the rows above are what it
            publishes. The written notes for this family — the questions an agent can answer from them, and the
            constructs it stops short of — are still being authored, so no page is linked here yet.
          </p>
        )}
        {href ? (
          <p className="lang-more">
            <Link href={href} prefetch={false}>
              The {parser.name} record: what agents can ask, and where its coverage stops
              <span aria-hidden> →</span>
            </Link>
          </p>
        ) : null}
      </div>
    </article>
  )
}
