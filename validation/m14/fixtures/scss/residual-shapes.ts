/**
 * SCSS RESIDUAL SHAPES — what the gate's OWN `unresolvedNames`/`ambiguousNames` are, by shape.
 *
 * The gate names the residual edges; it does not classify them. This reads its JSON (whole
 * population, one run) and splits every residual edge by the SHAPE of its target, because shape is
 * what decides ownership — a Sass module specifier, a CSS custom property and a bare identifier have
 * three different owners and the split cannot be read off a frequency list.
 *
 * Shapes (the same three the lane's U2 classifier defines, plus the two the gate's own names added):
 *   MODULE-PATH  starts `.` or contains `/` — the argument of @use/@forward/@import: a filesystem
 *                path, not a declaration name. No symbol is published under it, because a symbol
 *                named `./placeholders` would be a name with no referent.
 *   CUSTOM-PROP  starts `--` — a `var(--x)` read. Publishable in principle: the css delegate does
 *                publish custom-property declarations, so this shape has a live counterfactual.
 *   URL          matches `<scheme>:` — a remote resource; not a corpus declaration by construction.
 *   FRAGMENT     starts `#` — an intra-document IDREF: names a NODE, not a declaration of that name.
 *   BARE-IDENT   anything else — the only shape whose referent, if any, is a plain declaration.
 *
 * USAGE  npx tsx validation/m14/fixtures/scss/residual-shapes.ts <gate-json> [out-json]
 * READ-ONLY over the corpus. Writes only its own report.
 */
import { readFileSync, writeFileSync } from "node:fs"

type Shape = "MODULE-PATH" | "CUSTOM-PROP" | "URL" | "FRAGMENT" | "EMPTY" | "BARE-IDENT"

export function shapeOf(target: string): Shape {
  const t = target.trim()
  if (t.length === 0) return "EMPTY"
  if (t.startsWith("--")) return "CUSTOM-PROP"
  if (t.startsWith("#")) return "FRAGMENT"
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(t)) return "URL"
  if (t.startsWith(".") || t.includes("/") || t.includes("::")) return "MODULE-PATH"
  return "BARE-IDENT"
}

const gatePath = process.argv[2]
if (!gatePath) { console.error("usage: residual-shapes.ts <gate-json> [out-json]"); process.exit(2) }
const gate = JSON.parse(readFileSync(gatePath, "utf8"))

const ledger: Record<string, { unresolved: Record<string, number>; ambiguous: Record<string, number>; unresolvedExamples: Record<string, string[]>; ambiguousTop: { name: string; count: number }[] }> = {}
const totals = { unresolved: {} as Record<string, number>, ambiguous: {} as Record<string, number> }
for (const [type, row] of Object.entries<any>(gate.perType ?? {})) {
  const proj = row.project ?? {}
  const un: string[] = (proj.unresolvedNames ?? []).map((u: any) => String(u.name))
  const am: string[] = (proj.ambiguousNames ?? []).map((a: any) => String(a.name))
  const counts: Record<string, number> = {}
  const examples: Record<string, string[]> = {}
  for (const n of un) {
    const s = shapeOf(n)
    counts[s] = (counts[s] ?? 0) + 1
    totals.unresolved[s] = (totals.unresolved[s] ?? 0) + 1
    ;(examples[s] ??= []).push(n)
  }
  const acounts: Record<string, number> = {}
  for (const n of am) { const s = shapeOf(n); acounts[s] = (acounts[s] ?? 0) + 1; totals.ambiguous[s] = (totals.ambiguous[s] ?? 0) + 1 }
  const dedup = new Map<string, number>()
  for (const n of am) dedup.set(n, (dedup.get(n) ?? 0) + 1)
  ledger[type] = {
    unresolved: counts, ambiguous: acounts,
    unresolvedExamples: Object.fromEntries(Object.entries(examples).map(([s, xs]) => [s, xs.slice(0, 4)])),
    ambiguousTop: [...dedup].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 10),
  }
}
const report = {
  instrument: "scss residual shapes — the gate's own residual names split by target shape",
  source: gatePath,
  population: gate.population,
  verdict: gate.verdict,
  reason: gate.reason,
  totalsByShape: totals,
  perType: ledger,
  reading: "shape decides ownership: MODULE-PATH/URL are specifiers with no referent by construction; FRAGMENT names a node; CUSTOM-PROP has a live counterfactual (the css delegate publishes custom properties); BARE-IDENT is the only shape whose referent would be a plain declaration.",
}
const out = process.argv[3] ?? "validation/m14/fixtures/scss/residual-shapes.json"
writeFileSync(out, JSON.stringify(report, null, 2) + "\n")
console.log(JSON.stringify({ verdict: report.verdict, reason: report.reason, totalsByShape: totals, perType: Object.fromEntries(Object.entries(ledger).map(([t, v]) => [t, { unresolved: v.unresolved, ambiguous: v.ambiguous }])) }, null, 2))
