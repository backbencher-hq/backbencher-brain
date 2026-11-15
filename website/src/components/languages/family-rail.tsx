import Link from "next/link"
import { languageHref } from "@/data/language-depth"
import { ROWS, radioId } from "./family-data"

// The index rail — the left column of the languages console.
//
// WHAT A ROW IS
// -------------
// Two controls, because the row has to do two honest jobs:
//   1. the hidden radio inside the label selects this family's panel. It is
//      `.sr-only` and globals.css paints the focus ring on the label, so a
//      keyboard user can see which row they are about to select;
//   2. the trailing arrow is a real link to that family's own page, built from
//      `languageHref` so no href is ever typed by hand.
//
// They are separate controls on purpose. Folding the link into the label would
// make one click do both things, which means every visit to a detail page is also
// a state change nobody asked for — and it nests an interactive element inside a
// label, which is where accessibility goes to die.
//
// THE SECOND LINE
// ---------------
// `parser.extracts` — "modules · functions · typespecs" — is the audited answer
// to "what does this family get me", straight from the dataset, and it is the
// only capability sentence a rail row may carry: a hand-authored framing per
// family would be fifty more chances to overclaim, and the depth records own that
// prose. It is allowed to wrap. Truncating an honest fact mid-word would be a
// worse lie than a taller row.
//
// 2026-11-07 — Evidence Atlas surface. The row is set as an editorial index
// entry: a running number in the margin, the family name in the page's body face,
// the recorded symbols beneath it, and a hairline between rows. The per-language
// hue is gone with the dark console: on paper the old icon colours ranged from
// unreadable to decorative, and the atlas system keeps one accent. Selection is
// painted by the generated rules in ./family-data.ts — a tinted ground and an
// ember edge — which is a stronger signal than a 5px dot.

export function FamilyRail({ className }: { className: string }) {
  const bands = new Map<string, typeof ROWS>()
  for (const row of ROWS) {
    const list = bands.get(row.band) ?? []
    list.push(row)
    bands.set(row.band, list)
  }

  return (
    <nav
      aria-label="Language families"
      // `className` is the caller's, and it is "console-index": the hook
      // globals.css uses to draw the focus ring on a row whose radio is visually
      // hidden. The page owns that name so the affordance and the audit for it
      // are declared in one place; this component owns only layout.
      className={`lang-rail ${className}`}
    >
      {[...bands].map(([band, members]) => (
        <section key={band} className="lang-band">
          <p className="lang-band-label">
            {band}
            <span className="n">{members.length}</span>
          </p>
          <ul className="lang-rows">
            {members.map((row) => {
              const { parser, index } = row
              return (
                <li key={parser.name} className="lang-row">
                  <label htmlFor={radioId(index)} data-rail-row={index} className="lang-row-label">
                    <input
                      type="radio"
                      name="lang-family"
                      id={radioId(index)}
                      value={row.slug}
                      className={`lang-tab lang-tab-${index} sr-only`}
                    />
                    <span aria-hidden className="lang-row-index">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="lang-row-body">
                      <span className="lang-row-name">{parser.name}</span>
                      <span className="lang-row-extracts">{parser.extracts}</span>
                    </span>
                  </label>
                  {/* No slug yet means no detail page yet, and `languageHref`
                      would silently point back at this console. The row keeps
                      its selection behaviour either way. */}
                  {row.slug ? (
                    <Link
                      href={languageHref(parser.name)}
                      aria-label={`Open the ${parser.name} page`}
                      prefetch={false}
                      className="lang-row-link"
                    >
                      <span aria-hidden>→</span>
                    </Link>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </section>
      ))}
      <p className="lang-rail-note">
        Selection is plain HTML — every family&apos;s record is already in this page, and reading any of them needs
        no JavaScript. What scripting adds is the address bar: it follows the family you pick, so the view you are
        reading is a link you can send.
      </p>
    </nav>
  )
}
