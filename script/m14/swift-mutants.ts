/**
 * SWIFT LANE MUTANTS — the swift lane's own defect-class registry for the
 * ONTOLOGY wave.
 *
 * WHY A LANE-OWNED FILE: `script/m14/mutate-analyzer.ts` is MASTER-owned and
 * holds the one `MUTANTS` array the F4 gate reads, so a registry kept anywhere
 * else has to be spread into it with a wiring line. The fsharp lane established
 * the shape (`script/m14/fsharp-mutants.ts`, spread with one line) and the go
 * lane followed it; this file does the same for swift. **The one-line wiring
 * this lane needs in `mutate-analyzer.ts` is REPORTED to master, not made
 * here** — `import { SWIFT_ONTOLOGY_MUTANTS } from "./swift-mutants"` beside the
 * existing `fsharp-mutants` import, and `...SWIFT_ONTOLOGY_MUTANTS` in the
 * array spread.
 *
 * `script/m14/tmp/swift-mutant-run.ts` runs these against the real fixture
 * runner and prints each mutant's effect, so the lane can show its own gates
 * failing NOW rather than claiming the reds.
 *
 * Every transform is expressed over the RESULT and over the SHAPE (a
 * relationship type, an access level, a path-segment rule), never over a single
 * hardcoded fixture name — a mutant pinned to one name stops matching the moment
 * a fixture is renamed, and that is how a mutant goes from caught to surviving
 * without anybody editing it.
 */
export interface SwiftMutant {
  id: string
  language: "swift"
  defectClass: string
  description: string
  transform: (result: any, source?: string) => any
}

const rels = (r: any): any[] => (r?.relationships ?? []) as any[]
const type = (x: any): string => String(x?.type ?? x?.relationshipType ?? "")

/** Drop every relationship of one type, whatever its endpoints. */
function dropType(t: string) {
  return (r: any) => ({ ...r, relationships: rels(r).filter((x: any) => type(x) !== t) })
}

/** Re-label every relationship of one type as another. */
function relabelType(from: string, to: string) {
  return (r: any) => ({
    ...r,
    relationships: rels(r).map((x: any) => (type(x) === from ? { ...x, type: to } : x)),
  })
}

// ---------------------------------------------------------------------------
// ONTOLOGY wave: `imports` and `exports`.
//
// Each mutant is a faithful revert of a shape this lane's own implementation
// really had, or a shape an over-broad rule of this family would produce.
// ---------------------------------------------------------------------------

const ONTOLOGY_MUTANTS: SwiftMutant[] = [
  {
    id: "swift/ontology-drop-imports",
    language: "swift",
    defectClass: "relationship-loss",
    description:
      "ONTOLOGY regression: removes the module-dependency edge entirely (the state at handover, where the ONLY label was `references`) — imports-exports expectRelationships pins die",
    transform: dropType("imports"),
  },
  {
    id: "swift/ontology-imports-target-is-spelled-path",
    language: "swift",
    defectClass: "relationship-fabrication",
    description:
      "ONTOLOGY regression: re-uses the SPELLED import path as the `imports` target, so `import let WinSDK.IPPROTO_IP` targets `WinSDK.IPPROTO_IP` — a dotted specifier no Swift module is called (the R10 failure go documents for `net/http`). imports-exports expect pins and the dotted-target forbids die",
    transform: (r: any) => ({
      ...r,
      relationships: rels(r).map((x: any) => {
        if (type(x) !== "imports") return x
        const spelled = x?.metadata?.moduleSpecifier
        return typeof spelled === "string" && spelled.length > 0 ? { ...x, target: spelled } : x
      }),
    }),
  },
  {
    id: "swift/ontology-imports-loses-scoped-kind",
    language: "swift",
    defectClass: "relationship-metadata-loss",
    description:
      "ONTOLOGY regression: drops the scoped-import detail (`import let X.Y` names a module AND a declaration) — imports-exports `meta.scopedKind`/`meta.scopedItem` pins die",
    transform: (r: any) => ({
      ...r,
      relationships: rels(r).map((x: any) => {
        if (type(x) !== "imports") return x
        const md = { ...(x?.metadata ?? {}) }
        delete md.scopedKind
        delete md.scopedItem
        delete md.isScopedImport
        delete md.submodulePath
        return { ...x, metadata: md }
      }),
    }),
  },
  {
    id: "swift/ontology-imports-one-per-statement",
    language: "swift",
    defectClass: "relationship-fabrication",
    description:
      "ONTOLOGY regression: emits an `imports` edge per import STATEMENT instead of per MODULE, so a file's two `Foundation` imports publish two edges for one dependency — imports-exports forbid (one module, one edge) dies",
    transform: (r: any) => {
      // `references` is one-per-import-STATEMENT, so mirroring it is what a
      // per-statement `imports` rule actually produces: two rows for
      // Foundation in this fixture (lines 38 and 40).
      const extra: any[] = rels(r)
        .filter((x: any) => type(x) === "references")
        .map((x: any) => ({
          type: "imports",
          source: String(x?.source ?? "root"),
          target: String(x?.target ?? ""),
          isExternal: true,
          weight: 0.9,
          confidence: 1,
          metadata: { ...(x?.metadata ?? {}), isImport: true },
        }))
      return { ...r, relationships: [...rels(r), ...extra] }
    },
  },
  {
    id: "swift/ontology-drop-exports",
    language: "swift",
    defectClass: "relationship-loss",
    description:
      "ONTOLOGY regression: removes the API-surface edge entirely — imports-exports `exports` expect pins die",
    transform: dropType("exports"),
  },
  {
    id: "swift/ontology-exports-internal-too",
    language: "swift",
    defectClass: "relationship-fabrication",
    description:
      "ONTOLOGY regression: treats EVERY file-scope declaration as exported, forgetting that Swift's default access level is `internal` and `internal` is the ABSENCE of export — imports-exports forbid pins on internalHelper die",
    transform: (r: any) => {
      // The rule this mutant represents: "a file-scope declaration is exported,
      // full stop" — i.e. no access-level test at all.
      const already = new Set(rels(r).filter((x: any) => type(x) === "exports").map((x: any) => String(x?.target ?? "")))
      const extra: any[] = []
      const extraExports: any[] = []
      for (const s of r?.symbols ?? []) {
        if (s?.ownerName) continue
        if (s?.kind === "extension") continue
        const nm = String(s?.name ?? "")
        if (!nm || already.has(nm)) continue
        already.add(nm)
        extra.push({
          type: "exports",
          source: "root",
          target: nm,
          isExternal: true,
          weight: 1,
          confidence: 1,
          metadata: { exportForm: "access_level", accessLevel: s?.visibility ?? "internal", evidenceClass: "structural" },
        })
        extraExports.push({ name: nm, kind: s?.kind, visibility: s?.visibility ?? "internal" })
      }
      return { ...r, relationships: [...rels(r), ...extra], exports: [...(r?.exports ?? []), ...extraExports] }
    },
  },
  {
    id: "swift/ontology-exports-members-too",
    language: "swift",
    defectClass: "relationship-fabrication",
    description:
      "ONTOLOGY regression: exports MEMBERS as well as their owner, so an exported type's private member is also exported — membership would then ride two labels at once. imports-exports forbid pins on hiddenField/visibleField/constructor/internalMethod die",
    transform: (r: any) => {
      const out = [...rels(r)]
      for (const s of r?.symbols ?? []) {
        if (!s?.ownerName) continue
        if (String(s?.visibility ?? "") !== "private") continue
        out.push({
          type: "exports",
          source: "root",
          target: s.name,
          isExternal: true,
          weight: 1,
          confidence: 1,
          metadata: { exportForm: "access_level", accessLevel: s.visibility, evidenceClass: "structural" },
        })
      }
      return { ...r, relationships: out }
    },
  },
  {
    id: "swift/ontology-exports-extension-target",
    language: "swift",
    defectClass: "relationship-fabrication",
    description:
      "ONTOLOGY regression: drops the EXTENSION exclusion, so `public extension Int` publishes `exports root -> Int` — a stdlib symbol the file never declares. imports-exports forbid pin on Int dies",
    transform: (r: any) => {
      const out: any[] = []
      for (const s of r?.symbols ?? []) {
        if (String(s?.kind ?? "") !== "extension") continue
        if (String(s?.visibility ?? "") !== "public") continue
        out.push({
          type: "exports",
          source: "root",
          target: s.name,
          isExternal: true,
          weight: 1,
          confidence: 1,
          metadata: { exportForm: "access_level", accessLevel: "public", evidenceClass: "structural" },
        })
      }
      return { ...r, relationships: [...rels(r), ...out] }
    },
  },
  {
    id: "swift/ontology-exports-module-reexport",
    language: "swift",
    defectClass: "relationship-fabrication",
    description:
      "ONTOLOGY regression: re-adds the `@_exported` module as an `exports` EDGE. This is the shape the lane's FIRST implementation produced and the fixture gate rejected — a module is not a symbol and the export invariant requires a top-level symbol. imports-exports forbid pin on Reexported dies",
    transform: (r: any) => ({
      ...r,
      relationships: [
        ...rels(r),
        {
          type: "exports",
          source: "root",
          target: "Reexported",
          isExternal: true,
          weight: 1,
          confidence: 1,
          metadata: { exportForm: "module_reexport", viaModuleReExport: true, evidenceClass: "import_based" },
        },
      ],
      exports: [...(r?.exports ?? []), { name: "Reexported", metadata: { exportForm: "module_reexport" } }],
    }),
  },
  {
    id: "swift/ontology-exports-tier-import-based",
    language: "swift",
    defectClass: "evidence-tier",
    description:
      "ONTOLOGY regression: re-labels every `exports` edge import_based, the tier this lane's classifier gave the type before the wave (it lumped exports in with imports/references). imports-exports structural-tier forbid dies",
    transform: (r: any) => ({
      ...r,
      relationships: rels(r).map((x: any) => {
        if (type(x) !== "exports") return x
        return { ...x, metadata: { ...(x?.metadata ?? {}), evidenceClass: "import_based" } }
      }),
    }),
  },
  {
    id: "swift/ontology-relabel-imports-to-references",
    language: "swift",
    defectClass: "relationship-mislabelling",
    description:
      "ONTOLOGY regression: MOVES the module dependency from `imports` to `references` instead of adding it beside — the one-fact-one-label shape go GO and ruby argue for, and the shape that needs the master-owned swift oracle and differential baseline changed together. imports-exports `imports` pins die, which is the point: the relabel must be a DECLARED change, not a silent one",
    transform: relabelType("imports", "references"),
  },
  {
    id: "swift/ontology-references-relabelled",
    language: "swift",
    defectClass: "relationship-mislabelling",
    description:
      "ONTOLOGY regression: relabels the pre-existing `references` import edge to `imports`, i.e. the silent relabel the differential's swift oracle WOULD catch (it derives `references: root -> module`). Every swift differential corpus file reading an import would lose a matched edge — caught by the lane differential, not by a fixture, and pinned here so the intent is recorded",
    transform: relabelType("references", "imports"),
  },
  {
    id: "swift/ontology-typealias-visibility-revert",
    language: "swift",
    defectClass: "symbol-mislabelling",
    description:
      "ONTOLOGY regression: reverts the typealias visibility fix — a `public typealias` publishes as internal, so the public type aliases of every module are silently not exported. imports-exports `expectSymbols` visibility pin and the PublicAlias `exports` pin die",
    transform: (r: any) => ({
      ...r,
      symbols: (r?.symbols ?? []).map((s: any) => {
        if (!s?.metadata?.isTypeAlias) return s
        return { ...s, visibility: "internal" }
      }),
      relationships: rels(r).filter(
        (x: any) => !(type(x) === "exports" && String(x?.target ?? "") === "PublicAlias"),
      ),
      exports: (r?.exports ?? []).filter((e: any) => e?.name !== "PublicAlias"),
    }),
  },
  {
    id: "swift/ontology-drop-file-level",
    language: "swift",
    defectClass: "attribution",
    description:
      "ONTOLOGY regression: drops `metadata.fileLevel` from the new edges, so the parallel-indexer stores the placeholder string `root` as the importer instead of the importing FILE's relative path (the M60/#910 contract). The edges remain and every downstream reader of `source_external` loses the importer — caught here by the `meta.isModuleDependency`-adjacent fileLevel assertions",
    transform: (r: any) => ({
      ...r,
      relationships: rels(r).map((x: any) => {
        const t = type(x)
        if (t !== "imports" && t !== "exports") return x
        const md = { ...(x?.metadata ?? {}) }
        delete md.fileLevel
        return { ...x, metadata: md }
      }),
    }),
  },
  {
    id: "swift/ontology-imports-scoped-item-partial",
    language: "swift",
    defectClass: "partial-payload",
    description:
      "ONTOLOGY follow-up regression: publishes the single-valued `scopedItem` on an `imports` edge even when the module is scoped-imported 2+ times, so the field names one of N scoped items and reads as all of them (corpus: 25 (file, module) pairs, swift-nio's Sources/NIOCore/BSDSocketAPI.swift has 37 scoped WinSDK imports). scoped-import-metadata's `meta.scopedItem: null` expect rows and its `meta.scopedItem` forbid rows die",
    transform: (r: any) => ({
      ...r,
      relationships: rels(r).map((x: any) => {
        if (type(x) !== "imports") return x
        const md = { ...(x?.metadata ?? {}) }
        // Re-attach the first statement's scoped item and drop the count, which
        // is what the pre-rule code published.
        if (md.scopedItemCount !== undefined) {
          const spec = String(md.moduleSpecifier ?? "")
          const dot = spec.indexOf(".")
          md.scopedItem = dot > 0 ? spec.slice(dot + 1) : md.scopedItem
          delete md.scopedItemCount
        }
        return { ...x, metadata: md }
      }),
    }),
  },
  {
    id: "swift/ontology-imports-count-on-unscoped",
    language: "swift",
    defectClass: "fabricated-payload",
    description:
      "ONTOLOGY follow-up regression: stamps `scopedItemCount` on EVERY `imports` edge, including a module the file imports plainly. scoped-import-metadata's Solo row (`meta.scopedItemCount: null`) and its Solo forbid row die — the count must describe scoped imports only",
    transform: (r: any) => ({
      ...r,
      relationships: rels(r).map((x: any) => {
        if (type(x) !== "imports") return x
        const md = { ...(x?.metadata ?? {}) }
        if (md.scopedItemCount === undefined) md.scopedItemCount = 1
        return { ...x, metadata: md }
      }),
    }),
  },
]

export const SWIFT_ONTOLOGY_MUTANTS: SwiftMutant[] = ONTOLOGY_MUTANTS
export default SWIFT_ONTOLOGY_MUTANTS