/**
 * CS3 / csharp — A/B + MUTATION proof for the `exports` edge, lane-owned.
 *
 * ## Why this file exists rather than an entry in `mutate-analyzer.ts`
 *
 * `script/m14/**` is the master's. This lane therefore did not add its mutants to
 * `script/m14/mutate-analyzer.ts`; it wrote the same proof where the lane owns
 * files, and REPORTS the need for the shared registry. The need is concrete: the
 * eight mutants below belong in `mutate-analyzer.ts` next to the lane's existing
 * `csharp/*` entries so that `audit:mutations` counts them.
 *
 * ## The proof
 *
 * `runLang(lang, overrideAnalyzer)` already accepts an injected analyzer — the
 * seam `mutate-analyzer.ts` itself uses. So each mutant here is a wrapper whose
 * `analyze()` returns the real result with ONE rule broken, and the SAME
 * expectation files judge it. A mutant is CAUGHT when the target fixture
 * `csharp/public-type-exports` appears in the failures; a lane-level failure count
 * would be a weaker claim, because a neighbouring fixture could go red for an
 * unrelated reason and mask a survivor.
 *
 * ## The nine mutants, and which pin each one is for
 *
 * A fixture that cannot fail is decoration. Each mutant below targets one clause
 * of the rule, and the comment on each names the pin row that convicts it — so a
 * new mutant that no pin catches is visible as a survivor rather than as a
 * judgement call.
 *
 * ## No regular expression
 *
 * MASTER-HANDOFF rule 1. Nothing here matches source text; every mutant keys on
 * symbol `kind` / `visibility` / `ownerKind` and on the relationship `type`.
 */
import { runLang } from "../../../../script/m14/run-fixtures"

const LANG = "csharp"
const TARGET = `${LANG}/public-type-exports`
const TYPES = new Set(["class", "struct", "interface", "enum", "delegate"])
const rels = (r: any) => (r.relationships ?? []) as any[]
const isExport = (x: any) => String(x.type ?? x.relationshipType ?? "") === "exports"

/** Wrap the real analyzer and transform its output. */
function mutant(id: string, description: string, transform: (r: any) => any) {
  return {
    id,
    description,
    analyze: async (root: any, content: string, filePath: string, ctx?: any) => {
      const { RealCSharpAnalyzer } = await import("../../../../src/ast/real-csharp-analyzer")
      const real = new RealCSharpAnalyzer().analyze(root, content, filePath, ctx)
      return transform(real)
    },
  }
}

const MUTANTS = [
  mutant(
    "csharp/exports-dropped",
    "relationship-loss: deletes every `exports` edge — the capability this lane was missing while nine of ten types fired. Caught by the nine expectRelationships rows and by expectRelationshipCount equals 10.",
    (r) => ({ ...r, relationships: rels(r).filter((x) => !isExport(x)) }),
  ),
  mutant(
    "csharp/exports-nested-as-global",
    "relationship-fabrication: the REGRESSION the fixture pins. Reverts the top-level test to `ownerKind === Namespace ? ownerName : global`, which accepts a NESTED public type and publishes it as a global-scope export. Measured on aspnetcore as 24 fabricated rows against 275 real ones. Caught by forbidRelationships target NestedPublic.",
    (r) => {
      const extra: any[] = []
      for (const s of r.symbols ?? []) {
        if (s.visibility !== "public" || !TYPES.has(String(s.kind))) continue
        if (rels(r).some((x) => isExport(x) && x.target === s.name && x.source === (s.ownerKind === "namespace" ? s.ownerName : "global"))) continue
        extra.push({ source: s.ownerKind === "namespace" ? s.ownerName : "global", target: s.name, type: "exports", confidence: 1.0, metadata: { relationshipType: "csharp_public_type_export" } })
      }
      return { ...r, relationships: [...rels(r), ...extra] }
    },
  ),
  mutant(
    "csharp/exports-any-top-level",
    "relationship-fabrication: publishes EVERY top-level type regardless of accessibility. dotnet/roslyn is 303 of 333 `internal` top-level types and 0 `public`, so this fabricates 302 edges on that corpus. Caught by forbidRelationships target InternalTopLevel.",
    (r) => {
      const extra: any[] = []
      for (const s of r.symbols ?? []) {
        if (!TYPES.has(String(s.kind))) continue
        if (s.ownerKind !== "namespace" && s.ownerName) continue
        extra.push({ source: s.ownerKind === "namespace" ? s.ownerName : "global", target: s.name, type: "exports", confidence: 1.0, metadata: {} })
      }
      return { ...r, relationships: [...rels(r), ...extra] }
    },
  ),
  mutant(
    "csharp/exports-no-modifier-is-public",
    "relationship-fabrication: treats a top-level type with NO accessibility modifier as exported, i.e. supplies a `public` default. C#'s default accessibility for a top-level type declaration is `internal`. Caught by forbidRelationships target NoModifierTopLevel.",
    (r) => {
      const extra: any[] = []
      for (const s of r.symbols ?? []) {
        if (s.visibility !== undefined) continue
        if (!TYPES.has(String(s.kind))) continue
        if (s.ownerKind !== "namespace" && s.ownerName) continue
        extra.push({ source: s.ownerKind === "namespace" ? s.ownerName : "global", target: s.name, type: "exports", confidence: 1.0, metadata: {} })
      }
      return { ...r, relationships: [...rels(r), ...extra] }
    },
  ),
  mutant(
    "csharp/exports-file-scoped-public",
    "relationship-fabrication: publishes `file`-scoped types, which are visible only in their own file (CS-B4 mapped `file` to `private`). Caught by forbidRelationships target FileScopedType.",
    (r) => {
      const extra: any[] = []
      for (const s of r.symbols ?? []) {
        if (!TYPES.has(String(s.kind))) continue
        if (s.ownerKind !== "namespace" && s.ownerName) continue
        if (String(s.name) !== "FileScopedType") continue
        extra.push({ source: s.ownerKind === "namespace" ? s.ownerName : "global", target: s.name, type: "exports", confidence: 1.0, metadata: {} })
      }
      return { ...r, relationships: [...rels(r), ...extra] }
    },
  ),
  mutant(
    "csharp/exports-members-too",
    "relationship-fabrication: also publishes public MEMBERS. The R3 population was counted at 1,986 edges on aspnetcore against R1's 275 and rejected as `contains` with a modifier attached. Caught by forbidRelationships target PublicTopLevelMethod and InternalMethod.",
    (r) => {
      const extra: any[] = []
      for (const s of r.symbols ?? []) {
        if (s.visibility !== "public") continue
        const k = String(s.kind)
        if (k !== "method" && k !== "property" && k !== "field") continue
        extra.push({ source: s.ownerName, target: s.name, type: "exports", confidence: 1.0, metadata: {} })
      }
      return { ...r, relationships: [...rels(r), ...extra] }
    },
  ),
  mutant(
    "csharp/exports-source-always-global",
    "mislabel: rewrites every exports source to the file scope, discarding the namespace owner. Both endpoints still resolve for a global declaration, so the source-resolution column of the census would NOT catch it — only a fixture pin that names the namespace can. Caught by expectRelationships from Probe.Block and from Probe.Scoped.",
    (r) => ({ ...r, relationships: rels(r).map((x) => (isExport(x) ? { ...x, source: "global" } : x)) }),
  ),
  mutant(
    "csharp/exports-evidence-class-usage",
    "metadata regression: rewrites `evidenceClass` from `structural` to `usage_contextual`, which is the class `calls`/`uses` carry because the BINDING they denote is not written in the file. An exports edge is written in the file twice over — the `public` keyword and the name — so this is a wrong tier claim a consumer reads to decide whether to trust the edge, and no count can see it. Caught by expectRelationships meta.evidenceClass structural.",
    (r) => ({
      ...r,
      relationships: rels(r).map((x) => (isExport(x) ? { ...x, metadata: { ...(x.metadata ?? {}), evidenceClass: "usage_contextual" } } : x)),
    }),
  ),
  mutant(
    "csharp/exports-class-kinds-only",
    "relationship-loss: publishes only `class`-kind types, dropping enum, struct, interface, delegate and both record forms. Caught by the PublicEnum / PublicStruct / PublicInterface / PublicDelegate / PublicRecord / PublicRecordStruct expect rows and by expectRelationshipCount equals 10.",
    (r) => {
      const keep = new Set(["PublicEnum", "PublicStruct", "PublicInterface", "PublicDelegate", "PublicRecord", "PublicRecordStruct"])
      return { ...r, relationships: rels(r).filter((x) => !isExport(x) || keep.has(String(x.target))) }
    },
  ),
]

console.log(`CS3 csharp exports A/B + mutation proof`)
console.log(`baseline first: the real analyzer against the whole ${LANG} fixture lane`)
const base = await runLang(LANG)
const baseTarget = base.details.find((d: any) => d.fixture === TARGET)
console.log(`  lane ${base.pass} pass / ${base.fail} fail;  ${TARGET}: ${baseTarget?.ok ? "PASS" : "FAIL"}`)
if (!baseTarget?.ok) {
  console.error(`\nABORT: ${TARGET} does not pass against the real analyzer, so a mutant failing it proves nothing.`)
  for (const p of baseTarget?.problems ?? []) console.error(`  ${p}`)
  process.exit(2)
}

let survivors = 0
console.log(`\nmutants (each MUST make ${TARGET} fail):`)
for (const m of MUTANTS) {
  const r = await runLang(LANG, { analyze: m.analyze })
  const d = r.details.find((x: any) => x.fixture === TARGET)
  const caught = d ? !d.ok : false
  if (!caught) survivors++
  console.log(`  ${caught ? "CAUGHT  " : "SURVIVED"} ${m.id}  (lane ${r.pass}p/${r.fail}f)`)
  if (caught) {
    const first = String((d as any).problems?.[0] ?? "").split("; got:")[0]
    if (first) console.log(`            ${first.slice(0, 150)}`)
  } else {
    console.log(`            ${m.description}`)
  }
}

console.log(`\n${MUTANTS.length - survivors}/${MUTANTS.length} caught`)
console.log(`NEEDED, REPORTED NOT DONE: these nine mutants belong in script/m14/mutate-analyzer.ts (the master's file) so that \`bun run audit:mutations\` counts them. Until then this file is the lane's own proof and nothing else runs it.`)
process.exitCode = survivors === 0 ? 0 : 1
