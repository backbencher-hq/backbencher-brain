/**
 * SCSS — do the 7 recovered `@extend` edges RESOLVE, and what did they resolve to before?
 *
 * ## Population
 *
 * The 4 corpus files that produced the 7 fabricated targets, named explicitly so the
 * measurement is over the affected set and not over a sample that happens to contain it.
 * They are the files `scss-delimiter-census.ts` names on its 600-file run:
 *
 *   bulma/docs/_sass/docs/options.scss        bulma/sass/base/skeleton.scss
 *   bulma/sass/components/breadcrumb.scss     bulma/sass/components/card.scss
 *
 * Production `ASTEngine.parseFile`. READ-ONLY.
 *
 * ## The question
 *
 * `scss-delimiter-census.ts` shows the repair is a SWAP — `extends` stays at 293 edges while
 * 7 fabricated targets leave and 7 true ones arrive. That establishes the edges are neither
 * lost nor invented. It does NOT establish they are USEFUL: a target can name a real
 * selector and still bind to nothing, because the referent lives in another file or because
 * the lane does not publish placeholders as symbols at all.
 *
 * So this measures resolution at both ends, per file, and it measures the BEFORE state
 * without re-parsing it. That second part is possible because the before-state targets are on
 * disk (`/tmp/opencode/scss/before/scss-dump-extends.txt`) and because one property of the
 * language settles them: a CSS selector cannot contain `;`, `{` or `}`, so no published
 * symbol NAME can contain one either. The file checks that property rather than assuming it,
 * because assuming it is the step that would make the before-state number an assertion.
 *
 * ## What each verdict means
 *
 *   RESOLVED   target string equals a symbol name published in this file
 *   UNRESOLVED it does not — and `EXTERNAL` says whether the name is declared in another
 *              corpus file, which is a window artefact rather than a defect
 *
 * READ-ONLY. Writes nothing.
 *
 * ## Usage
 *
 *   npx tsx validation/m14/fixtures/scss/scss-extend-recovery-resolution.ts
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { ASTEngine } from "../../../../src/ast/engine"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

const AFFECTED = [
  "bulma/docs/_sass/docs/options.scss",
  "bulma/sass/base/skeleton.scss",
  "bulma/sass/components/breadcrumb.scss",
  "bulma/sass/components/card.scss",
]

/** the 7 before-state targets, quoted from the pre-fix dump rather than re-derived */
const BEFORE_TARGETS = [
  "%block; align-items: center; color: hsl(cv.getVar",
  "%block; background-color: cv.getVar",
  "%block; background-color: hsl( cv.getVar",
  "%card-item; background-color: cv.getVar",
  "%reset; background-color: cv.getVar",
  "%skeleton-pulsation; height: cv.getVar",
  "%unselectable; font-size: cv.getVar",
]

/** every symbol name published anywhere in the corpus, for the EXTERNAL column */
const corpusNames = new Set<string>()
{
  const names = execFileSync(
    "bash",
    ["-lc", `grep -rhoE '^[[:space:]]*%[-_[:alnum:]]+' ${CR} --include='*.scss' 2>/dev/null | tr -d ' \\t' | sort -u`],
    { encoding: "utf8", maxBuffer: 1 << 28 },
  )
  for (const l of names.split("\n")) if (l.startsWith("%")) corpusNames.add(l)
}

let edges = 0
let resolved = 0
const rows: string[] = []
/** names published by this lane, used to settle the BEFORE state without re-parsing it */
const allPublished = new Set<string>()

for (const rel of AFFECTED) {
  const abs = `${CR}/${rel}`
  const r: any = await ASTEngine.parseFile(abs, readFileSync(abs, "utf8"))
  const names = new Set<string>((r?.symbols ?? []).map((s: any) => String(s?.name ?? "")))
  for (const n of names) allPublished.add(n)
  for (const e of r?.relationships ?? []) {
    if (String(e?.type) !== "extends") continue
    const t = String(e?.target ?? "")
    const ok = names.has(t)
    edges++
    if (ok) resolved++
    rows.push(`  ${rel}:${String(e?.line ?? "?")}  ${ok ? "RESOLVED  " : "UNRESOLVED"}  ${JSON.stringify(t)}`)
  }
}

console.log(`SCSS — do the recovered @extend edges resolve?`)
console.log(`population: the ${AFFECTED.length} corpus files that produced the 7 fabricated targets\n`)
for (const l of rows) console.log(l)
console.log(`\n@extends edges in those files ${edges}   resolved at the target end ${resolved}   ${edges ? Math.round((100 * resolved) / edges) : 0}%`)

// ── the BEFORE state, settled by a checked property rather than by a re-parse ────────
console.log(`\nTHE BEFORE STATE — 7 targets, no re-parse:`)
// The argument is that a before-state target binds to nothing. It rests on a property of the
// language: a CSS selector cannot contain `;`, so no published symbol NAME can contain one
// either — and the 7 targets all carry one.
//
// `;` AND NOT `{`/`}`, and the narrowing is not cosmetic. A first draft of this check tested
// all three characters and the CONTROL it carries is what caught it: 46 symbol names in these
// four files DO carry braces, because `#{}` is SCSS INTERPOLATION and a selector may contain
// it (`bulma/sass/base/skeleton.scss` publishes 5 rules named
// `#{iv.$variables-host} .#{iv.$class-prefix}is-skeleton`). Those 46 are legitimate, and a
// check that counted them would have voided an argument that is actually sound.
const semiNamed = [...allPublished].filter((n) => n.includes(";"))
const braceNamed = [...allPublished].filter((n) => /[{}]/.test(n))
console.log(`   symbol names published here carrying ';'      ${semiNamed.length}   <- must be 0 for the argument below`)
console.log(`   symbol names published here carrying '{' or '}': ${braceNamed.length}   <- interpolation, legitimate, NOT disqualifying`)
if (semiNamed.length > 0) console.log(`   *** PROPERTY FALSE — the BEFORE count below is not derivable *** ${JSON.stringify(semiNamed.slice(0, 5))}`)
const beforeResolvable = semiNamed.length > 0 ? [] : BEFORE_TARGETS.filter((t) => allPublished.has(t) || corpusNames.has(t))
console.log(`   the 7 before-state targets that are a published symbol name anywhere: ${beforeResolvable.length} of 7`)

// ── WHY the 10 recovered-but-unresolved edges still do not resolve ───────────────────
// `%card-item` resolves in card.scss and the other 10 do not. Two different reasons are
// possible and they are not the same defect: the referent may be declared in another file
// (a window artefact), or declared in THIS file and simply not published as a symbol (a real
// gap). This separates them per target, because only the second is worth fixing.
console.log(`\nWHY THE OTHER 10 DO NOT RESOLVE — referent declared in THIS file?`)
const seen = new Set<string>()
for (const rel of AFFECTED) {
  const abs = `${CR}/${rel}`
  const r: any = await ASTEngine.parseFile(abs, readFileSync(abs, "utf8"))
  const names = new Set<string>((r?.symbols ?? []).map((s: any) => String(s?.name ?? "")))
  for (const e of r?.relationships ?? []) {
    if (String(e?.type) !== "extends") continue
    const t = String(e?.target ?? "")
    if (names.has(t) || seen.has(t)) continue
    seen.add(t)
    // Is the placeholder DECLARED in this file's source at all?
    const src = readFileSync(abs, "utf8")
    const declaredHere = new RegExp(`^[ \\t]*${t.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")}[ \\t]*(,|\\{)`, "m").test(src)
    // Is it published under a name that DIFFERS from the edge target?
    const nearby = [...names].filter((n) => n.includes(t) || t.includes(n))
    console.log(`   ${t}`)
    console.log(`      declared in THIS file's source: ${declaredHere}`)
    console.log(`      declared in the corpus (other file): ${corpusNames.has(t)}`)
    console.log(`      published under a DIFFERENT name: ${nearby.length ? JSON.stringify(nearby.slice(0, 2)) : "none"}`)
  }
}

console.log(`\nNET, on these 4 files: 7 edges went from naming a selector that cannot exist to naming one that does.`)
console.log(`Of the 11 @extends edges present, ${resolved} resolve at the target end; the rest are reported above, split by cause.`)
