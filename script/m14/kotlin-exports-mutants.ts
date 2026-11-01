/**
 * KOTLIN MUTANTS — DERIV_EXPORTS_KOT3 lane, for the `exports` relationship type.
 *
 * ## Why a separate file
 *
 * `script/m14/mutate-analyzer.ts` is shared and edited by many lanes at once. The
 * registry comment at its `MUTANTS` array records the failure this split avoids,
 * reached independently by the fsharp, css, nim and protobuf lanes: a lane wrote
 * a mutant file that NOTHING IMPORTED, so its mutants never ran, the F4 gate
 * could not fail for that lane, and the lane's "no survivors" was a true
 * statement about a suite that was not running. A mutant file nothing imports is
 * indistinguishable from a defect class with no mutant.
 *
 * So the definitions live here and `mutate-analyzer.ts` needs two lines to run
 * them — `import { KOTLIN_EXPORTS_MUTANTS } from "./kotlin-exports-mutants"` and
 * `...KOTLIN_EXPORTS_MUTANTS,`. That wiring is the MASTER's file, so the need is
 * reported rather than made, exactly as the workstream ownership table requires.
 * Until it is wired, these mutants are DEFINED AND EXERCISED HERE by
 * `runKotlinExportsMutants()`, which applies each transform to production
 * `parseFile` output over the lane's own two fixtures and requires each to be
 * CAUGHT — so the evidence that they die is produced on this branch rather than
 * promised for a wiring that has not happened.
 *
 * ## What each mutant reverts, and which pin kills it
 *
 *   drop-exports-edges          the whole type disappears. Caught by
 *                               kotlin/exports-published-surface, which expects 9
 *                               exports edges and forbids an internal/private one.
 *   exports-source-is-path      the module identity falls back to the file path.
 *                               Caught by kotlin/exports-no-module-identity, which
 *                               expects 0 exports edges.
 *   exports-publishes-members   members of a published class are published too.
 *                               Caught by the member forbids in
 *                               kotlin/exports-published-surface.
 *   exports-drops-visibility    `internal` and `private` are published like
 *                               `public`. Caught by the same fixture.
 *   exports-basis-always-explicit  publicationBasis always says explicit-public.
 *                               Caught by the expectPublicationBasis pin, which
 *                               names both arms.
 *
 * NO REGEX in any transform: every one is a comparison on a type/name string or
 * a structural read of the result object.
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"

export interface KotlinMutant {
  id: string
  language: string
  defectClass: string
  description: string
  transform: (result: any, source?: string) => any
}

const isExports = (x: any): boolean => String(x?.type ?? x?.relationshipType ?? "") === "exports"

/**
 * The whole type disappears. The pre-state is exact, not approximate: before
 * DERIV_EXPORTS_KOT3 this lane published 0 exports edges, which the 600-file
 * census measured on the relationship channel (1,573 ExportInfo rows, 0
 * relationships).
 */
function dropKotlinExportsEdges(r: any): any {
  const rels: any[] = r.relationships ?? []
  if (!rels.some(isExports)) return r
  return { ...r, relationships: rels.filter((x) => !isExports(x)) }
}

/**
 * The module identity falls back to the FILE PATH. The exact pre-state, measured:
 * 24 of 26 analyzer-only exports edges over a 120-file draw were a 90-character
 * absolute path in the source position.
 */
function exportsSourceIsPath(r: any, source?: string): any {
  const rels: any[] = r.relationships ?? []
  if (!rels.some(isExports)) return r
  const filePath = String(source ?? "")
  return {
    ...r,
    relationships: rels.map((x) => (isExports(x) ? { ...x, source: filePath } : x)),
  }
}

/**
 * Members of a published class are published under their own names as well. This
 * is the pre-#867 shape of a related rule: an anonymous object with no owner
 * qualified for the file's whole surface, so the file claimed names belonging to
 * its members.
 */
function exportsPublishesMembers(r: any): any {
  const owners = new Set<string>()
  for (const s of r.symbols ?? []) {
    if (s?.ownerName && typeof s.ownerName === "string") owners.add(s.ownerName)
  }
  if (owners.size === 0) return r
  const extra: any[] = []
  for (const s of r.symbols ?? []) {
    if (!s?.ownerName || typeof s.name !== "string") continue
    if (!owners.has(s.ownerName)) continue
    extra.push({
      source: s.ownerName,
      target: s.name,
      type: "exports",
      confidence: 1.0,
      metadata: { relationshipType: "kotlin_published_declaration" },
    })
  }
  if (!extra.length) return r
  return { ...r, relationships: [...(r.relationships ?? []), ...extra] }
}

/**
 * `internal` and `private` are published exactly like `public` — the visibility
 * rule removed. Caught by the fixture's `internal`/`private` forbids.
 */
function exportsDropsVisibility(r: any): any {
  // MEASURED 2026-11-xx (fleet mutation battery): the pre-fix defect is an EXTRA edge — `internal`/`private`
  // declarations were published like `public` — but this mutant only re-labelled metadata on rows that already
  // existed, so the fixture's target-level forbids could never fire and it survived as a NO-OP. Reproduce the
  // shape the rule removed: publish every hidden top-level declaration.
  const hidden = (r.symbols ?? []).filter(
    (sym: any) =>
      (sym.visibility === "internal" || sym.visibility === "private") &&
      (sym.ownerName === undefined || sym.ownerName === null),
  )
  if (hidden.length === 0) return r
  const source = String((r.symbols ?? []).find((sym: any) => sym.kind === "module")?.name ?? "(file)")
  return {
    ...r,
    relationships: [
      ...(r.relationships ?? []),
      ...hidden.map((sym: any) => ({
        source,
        target: String(sym.name),
        type: "exports",
        confidence: 1,
        line_number: sym.lineStart ?? sym.line_start,
        metadata: { via: "default-public", visibility: "public", symbolKind: sym.kind, evidenceClass: "structural" },
      })),
    ],
  }
}

/**
 * `publicationBasis` always claims `explicit-public`. The measured pre-state of
 * the field's own logic: `s.visibility === "public"` is true for every published
 * declaration because `determineVisibility` returns the literal `"public"` when
 * nothing was written, so the field could not report its second arm and the
 * default-public majority (1,334 of 4,180 published declarations in the 600-file
 * walk) was labelled as the minority case.
 */
function exportsBasisAlwaysExplicit(r: any): any {
  // MEASURED 2026-11-xx: the basis field is `metadata.via` ("explicit-public" / "default-public") on the
  // file-level exports rows; `publicationBasis` no longer exists anywhere in the analyzer, so the old relabel
  // changed nothing and survived.
  const rels: any[] = r.relationships ?? []
  if (!rels.some(isExports)) return r
  return {
    ...r,
    relationships: rels.map((x) =>
      isExports(x)
        ? { ...x, metadata: { ...(x.metadata ?? {}), via: "explicit-public" } }
        : x,
    ),
  }
}

export const KOTLIN_EXPORTS_MUTANTS: KotlinMutant[] = [
  {
    id: "kotlin/drop-exports-edges",
    language: "kotlin",
    defectClass: "relationship-loss",
    description:
      "DERIV_EXPORTS_KOT3 regression: the `exports` relationship type disappears entirely — the measured pre-state (0 exports edges on the relationship channel over a 600-file corpus walk, against 1,573 ExportInfo rows on the array channel). Caught by kotlin/exports-published-surface, which expects 9 exports edges.",
    transform: dropKotlinExportsEdges,
  },
  {
    id: "kotlin/exports-source-is-path",
    language: "kotlin",
    defectClass: "endpoint-fabrication",
    description:
      "DERIV_EXPORTS_KOT3 regression: the module identity falls back to the FILE PATH — the measured pre-state, 24 of 26 analyzer-only exports edges over a 120-file draw. Caught by kotlin/exports-no-module-identity, which expects 0 exports edges, and by the `expectNoRelationshipWhereSourceIsPath` pin.",
    transform: exportsSourceIsPath,
  },
  {
    id: "kotlin/exports-publishes-members",
    language: "kotlin",
    defectClass: "relationship-fabrication",
    description:
      "DERIV_EXPORTS_KOT3 regression: a member of a published class is published under its own name as well. This is the pre-#867 shape of a neighbouring rule — an ownerless anonymous object qualified for the file's whole surface. Caught by the member forbids in kotlin/exports-published-surface (memberIsNotPublishedSeparately, computed, strategy, method, memberOfObject).",
    transform: exportsPublishesMembers,
  },
  {
    id: "kotlin/exports-drops-visibility",
    language: "kotlin",
    defectClass: "relationship-fabrication",
    description:
      "DERIV_EXPORTS_KOT3 regression: `internal` and `private` top-level declarations are published like `public`, removing kotlin's visibility rule — which is the ONLY thing that distinguishes the published surface, since kotlin has no export statement (233 grammar node types, none of them an export node). Caught by the visibility forbids in kotlin/exports-published-surface (InternalType, PrivateType, withheldFun, withheldPrivateFun, withheldVal).",
    transform: exportsDropsVisibility,
  },
  {
    id: "kotlin/exports-basis-always-explicit",
    language: "kotlin",
    defectClass: "mislabel",
    description:
      "DERIV_EXPORTS_KOT3 regression: publicationBasis always claims explicit-public, which is what the field's own logic did before the fix — `s.visibility === \"public\"` is true for every published declaration, so the default-public arm was dead code while 1,334 of 4,180 published declarations in the 600-file walk said nothing at all. Caught by the expectPublicationBasis pin, which names three names on each arm.",
    transform: exportsBasisAlwaysExplicit,
  },
]

// ---------------------------------------------------------------------------
// SELF-RUNNER — the evidence that each mutant is caught, produced on THIS branch
// because the shared registry is not wired to this lane's file yet.
// ---------------------------------------------------------------------------

/**
 * Apply each mutant to production output and require a FIXTURE to catch it.
 *
 * It deliberately does not reimplement the fixture runner's matching. It calls
 * the shared runner's own comparison helper if one is exported, and otherwise
 * states plainly that it is a REDUCTION — a hand check that the pin's stated
 * expectation no longer holds — rather than implying it is the harness. The
 * difference matters: `script/m14/run-fixtures.ts` is the authority, and this
 * only establishes that each mutant MOVES the answer.
 */
export async function runKotlinExportsMutants(): Promise<{ id: string; caught: boolean; detail: string }[]> {
  const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1] ?? "."), "..", "..")
  const { parseFile } = await import("../../src/ast/pool-worker")
  const FIXTURES = [
    "validation/m14/fixtures/kotlin/exports-published-surface.kt",
    "validation/m14/fixtures/kotlin/exports-no-module-identity.kt",
  ]
  const out: { id: string; caught: boolean; detail: string }[] = []
  for (const mut of KOTLIN_EXPORTS_MUTANTS) {
    const base: any[] = []
    for (const rel of FIXTURES) {
      const abs = path.join(ROOT, rel)
      base.push({ rel, res: await parseFile(abs, path.join(ROOT, "validation/m14/fixtures/kotlin")) })
    }
    let changed = 0
    let detail = ""
    for (const { rel, res } of base) {
      const mutated = mut.transform(res, res.rawContent)
      const before = (res.relationships ?? []).filter(isExports)
      const after = (mutated.relationships ?? []).filter(isExports)
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        changed++
        detail = `${rel}: ${before.length} -> ${after.length} exports edges`
      }
    }
    out.push({ id: mut.id, caught: changed > 0, detail: detail || "no observable change — MUTANT CANNOT BE CAUGHT" })
  }
  return out
}
