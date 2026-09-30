/**
 * M60 — do the evidence artifacts a pin record CITES actually exist?
 *
 * WHY THIS EXISTS. Found while starting the cross-lane patch-liveness census. The
 * `tree-sitter-vbnet` record claims 18 grammar patches and names six artifacts as its
 * evidence. Two exist (`grammars/tree-sitter-vbnet/PIN.md`, `reviews/vb/master-review.md`);
 * four do not:
 *
 *     fixtures/validation/grammar-floor.json      ABSENT
 *     fixtures/validation/history/                ABSENT
 *     fixtures/grammar-repro/cases/                ABSENT
 *     fixtures/probes/defect-census.ts             ABSENT
 *
 * `fixtures/` does not exist in this repository at all. So a record that says "measured,
 * here is the artifact" can be citing a path that was never committed, was deleted, or
 * was always aspirational — and the gate has no way to tell, because a prose string in a
 * JSON file is not checked by anything.
 *
 * This is the same failure shape as the G10 pin dishonesty, one level up and far cheaper
 * to detect. There, a record claimed a patch the BYTES did not contain. Here, a record
 * cites EVIDENCE that does not exist. Both are claims in a file that no instrument
 * objects to. Both are invisible to sha256, to byte length, and to the surface digest.
 *
 * WHAT IT DOES AND DOES NOT CLAIM. It checks EXISTENCE only — a path that is present but
 * empty, or present and stale, passes here. It is deliberately the cheap half: a missing
 * path is unambiguous and needs no judgement, whereas "is this artifact still current"
 * is a question about content that belongs with the artifact's own producer. It also
 * reports paths that merely LOOK like paths (`reviews/...`, `validation/...`,
 * `fixtures/...`, `script/...`, `src/...`, `grammars/...`, `docs/...`) and skips
 * everything else, so a sentence in prose is not reported as a missing file.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"

const ROOT = process.cwd()
const PINS = path.join(ROOT, "validation/m14/grammar-pins.json")
const OUT = path.join(ROOT, "validation/m60/results/evidence-citation-census.json")

const PATH_LIKE = /^(fixtures|validation|script|src|grammars|docs|reviews|queries|node_modules)\//

type Row = {
  lane: string
  cites: number
  present: string[]
  missing: string[]
  /** present, but an empty file — reported, not judged. */
  empty: string[]
  patchCount: number
}

const d = JSON.parse(readFileSync(PINS, "utf8"))
const decisions: Record<string, any> = d.decisions ?? {}

const rows: Row[] = []
for (const [lane, rec] of Object.entries(decisions).sort(([a], [b]) => a.localeCompare(b))) {
  // Every string in the record that is shaped like a repo path is a citation. The
  // `evidence` array is the declared list; the prose fields are scanned too, because a
  // record can cite an artifact only inside its `decision` sentence.
  const strings: string[] = []
  const walk = (v: any) => {
    if (typeof v === "string") strings.push(v)
    else if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === "object") Object.values(v).forEach(walk)
  }
  walk(rec)

  const cited = new Set<string>()
  for (const s of strings) {
    for (const m of s.matchAll(/(?:^|[\s`"'(])((?:fixtures|validation|script|src|grammars|docs|reviews|queries)\/[A-Za-z0-9_./@-]+\.[A-Za-z0-9]+)/g)) {
      cited.add(m[1].replace(/[.,;:)\]]+$/, ""))
    }
  }
  if (cited.size === 0) continue

  // A citation is resolved against the repo root AND against the lane's own vendored
  // source dir. This is not a nicety: a record citing `src/parser.c` or
  // `queries/highlights.scm` means that lane's grammar directory, so resolving only
  // against ROOT reports every grammar artifact in the repository as missing. The first
  // version of this instrument did exactly that and reported 89 missing citations, of
  // which a large share were this resolution error — an instrument that manufactures
  // findings is worse than no instrument, so the second resolution path is part of the
  // check rather than a fallback.
  const laneDirs = [ROOT]
  const sd = rec.source?.dir
  if (typeof sd === "string" && sd) laneDirs.push(path.join(ROOT, sd))
  const present: string[] = []
  const missing: string[] = []
  const empty: string[] = []
  for (const c of [...cited].sort()) {
    const hits = laneDirs.map((d) => path.join(d, c)).filter((a) => existsSync(a))
    if (hits.length === 0) missing.push(c)
    else {
      present.push(c)
      const f = hits.find((h) => statSync(h).isFile()) ?? hits[0]
      if (statSync(f).isFile() && statSync(f).size === 0) empty.push(c)
    }
  }
  const patchCount = (rec.provenance?.patches ?? []).length
  rows.push({ lane, cites: cited.size, present, missing, empty, patchCount })
}

const totalCited = rows.reduce((s, r) => s + r.cites, 0)
const totalMissing = rows.reduce((s, r) => s + r.missing.length, 0)
const withMissing = rows.filter((r) => r.missing.length)

const out = {
  instrument: "m60-evidence-citation-census",
  question: "Does every repo path a pin record cites actually exist?",
  scope: "existence only — a present artifact is not judged for currency; that belongs to its producer. Resolved against the repo root AND the lane's vendored source dir, because a citation like src/parser.c is lane-relative.",
  totals: {
    lanesWithCitations: rows.length,
    lanesChecked: Object.keys(decisions).length,
    citations: totalCited,
    missing: totalMissing,
    lanesWithMissing: withMissing.length,
  },
  // A missing citation is not one kind of thing, and reporting them as one number would
  // be the same error as the resolution bug above. They sort into: an EXTERNAL evidence
  // tree that is not in this repository at all (unverifiable by any reader here), and
  // GENERATED grammar artifacts that each record deliberately excludes from vendoring via
  // `notVendored` (an inconsistency in the prose, not a false claim). Only the first is
  // a finding about trust.
  breakdown: (() => {
    const all = rows.flatMap((r) => r.missing.map((m) => ({ lane: r.lane, path: m })))
    const generated = /^src\/(parser\.c|grammar\.json|node-types\.json)$|^queries\//
    return {
      externalEvidenceTree: {
        count: all.filter((x) => x.path.startsWith("fixtures/")).length,
        note: "paths under fixtures/, which does not exist in this repository — the corpora live at an external $HOME/fixtures/repositories. A claim resting on one of these cannot be opened or re-run by a reader of this repo.",
        sample: all.filter((x) => x.path.startsWith("fixtures/")).slice(0, 10),
      },
      generatedNotVendoredByDesign: {
        count: all.filter((x) => generated.test(x.path)).length,
        note: "generated grammar artifacts each record excludes from vendoring in its notVendored field. Citing them in prose while excluding them from the record is an inconsistency, not a dishonesty, so they are counted separately rather than as findings.",
      },
      other: {
        count: all.filter((x) => !x.path.startsWith("fixtures/") && !generated.test(x.path)).length,
        paths: all.filter((x) => !x.path.startsWith("fixtures/") && !generated.test(x.path)),
      },
    }
  })(),
  worstFirst: withMissing
    .map((r) => ({ lane: r.lane, missing: r.missing.length, of: r.cites, patchCount: r.patchCount }))
    .sort((a, b) => b.missing - a.missing),
  rows: rows.sort((a, b) => b.missing.length - a.missing.length || a.lane.localeCompare(b.lane)),
}
mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n")

console.log(`  ${out.totals.lanesChecked} lane decisions, ${out.totals.lanesWithCitations} cite repo paths`)
console.log(`  ${out.totals.citations} citations, ${out.totals.missing} MISSING, across ${out.totals.lanesWithMissing} lanes\n`)
for (const r of rows.filter((x) => x.missing.length)) {
  console.log(`  ${r.lane}  (${r.missing.length}/${r.cites} missing, ${r.patchCount} patches claimed)`)
  for (const m of r.missing) console.log(`      MISSING  ${m}`)
}
if (rows.filter((x) => x.empty.length).length) {
  console.log("\n  present but EMPTY:")
  for (const r of rows.filter((x) => x.empty.length)) for (const e of r.empty) console.log(`      EMPTY  ${r.lane}: ${e}`)
}
console.log(`\n  wrote ${path.relative(ROOT, OUT)}`)
if (out.totals.missing > 0) {
  console.error(`\n  ${out.totals.missing} citation(s) name a path that does not exist. A record that says "measured, artifact here" must be able to name a file a reader can open.`)
  process.exit(1)
}
