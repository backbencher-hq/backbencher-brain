/**
 * ELX4 — the mutation log for this wave's new behaviours and new pins.
 *
 * `script/m14/mutate-analyzer.ts` is MASTER-owned and this lane does not edit
 * it, so these definitions live here and are run by this runner. The shape is
 * the one `script/m14/fsharp-mutants.ts` and `script/m14/go-mutants.ts` already
 * use — a lane-owned mutant module imported by the shared registry — so the
 * wiring master needs is one import and one spread line. Until that happens this
 * runner is the evidence: it reverts each behaviour and requires the elixir
 * FIXTURE SUITE to go red, which is the only thing that makes the pins real.
 *
 * Every mutant below is a REVERT of a behaviour this wave added or a defect it
 * fixed. A surviving one means the pin does not bite.
 */
import type { Mutant } from "../../mutate-analyzer"

/**
 * Revive the `contains -> Unknown` edge the analyzer used to publish for every
 * declaration whose name it could not read. The edge's SOURCE is the owning
 * module (the symbol's name is the placeholder), so the revert has to be
 * reconstructed from the symbol table rather than by rewriting an existing edge.
 */
const unknownEndpointBack = (r: any) => {
  const extra: any[] = []
  for (const s of r.symbols ?? []) {
    if (String(s.name) !== "Unknown" && !s.metadata?.unresolvedName) continue
    const owner = s.ownerName ?? s.scope
    if (!owner) continue
    extra.push({ type: "contains", source: owner, target: "Unknown", confidence: 1.0, line_number: 1, metadata: { elixirSpecific: true } })
  }
  return { ...r, relationships: [...(r.relationships ?? []), ...extra] }
}

export const ELIXIR4_MUTANTS: Mutant[] = [
  {
    id: "elixir/elx4-uses-mixin-dropped",
    language: "elixir",
    defectClass: "relationship type dropped (ELX4 `uses`)",
    description: "ELX4: `use Mod` stops publishing `uses`. A pin that only asserted `references` would still pass, so this is what proves the new type is asserted.",
    transform: (r: any) => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => x.type !== "uses") }),
  },
  {
    id: "elixir/elx4-uses-mixin-relabelled",
    language: "elixir",
    defectClass: "relationship mislabelled (`uses` -> `references`)",
    description: "ELX4: `use Mod` is relabelled to `references` instead of ALSO emitting `uses` — the plausible wrong fix, in which the module-dep edge survives and the mixin claim never appears. The corpus measurement (512 sites) is what would have hidden it.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) => (x.type === "uses" ? { ...x, type: "references" } : x)),
    }),
  },
  {
    id: "elixir/elx4-uses-applied-to-alias",
    language: "elixir",
    defectClass: "label widened past its construct (ELX4 `uses` on alias/import/require)",
    description: "ELX4: the mixin edge is emitted for `alias`/`import`/`require` too. A rename and an import are not mixin applications; this is the neighbour-label failure `forbidRelationships` exists to catch.",
    transform: (r: any) => ({
      ...r,
      relationships: [
        ...(r.relationships ?? []).filter((x: any) => x.type !== "uses"),
        ...(r.relationships ?? []).filter((x: any) => x.type === "references").map((x: any) => ({ ...x, type: "uses", metadata: { ...x.metadata, isMixin: true } })),
      ],
    }),
  },
  {
    id: "elixir/elx4-imports-dropped",
    language: "elixir",
    defectClass: "relationship type dropped (ELX4 `imports`)",
    description: "ELX4: `import Mod` stops publishing `imports` (ER-D41 parity).",
    transform: (r: any) => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => x.type !== "imports") }),
  },
  {
    id: "elixir/elx4-imports-applied-to-use",
    language: "elixir",
    defectClass: "label widened past its construct (ELX4 `imports` on `use`)",
    description: "ELX4: `use Mod` also publishes `imports`. `use` injects code; it does not bring names into scope, so this is a different statement.",
    transform: (r: any) => ({
      ...r,
      relationships: [
        ...(r.relationships ?? []),
        ...(r.relationships ?? []).filter((x: any) => x.type === "uses").map((x: any) => ({ ...x, type: "imports" })),
      ],
    }),
  },
  {
    id: "elixir/elx4-exports-dropped",
    language: "elixir",
    defectClass: "relationship type dropped (ELX4 `exports`)",
    description: "ELX4: the public surface stops publishing `exports`. 4,036 corpus edges; the pin is the only thing that notices for the fixtures.",
    transform: (r: any) => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => x.type !== "exports") }),
  },
  {
    id: "elixir/elx4-exports-includes-private",
    language: "elixir",
    defectClass: "ELX4 `exports` ignores visibility (defp/defmacrop leak)",
    description: "ELX4: `exports` loses the `visibility === public` filter, so `defp`/`defmacrop` members become public API. The most likely way this edge class goes wrong, because `contains` publishes them too.",
    transform: (r: any) => ({
      ...r,
      relationships: [
        ...(r.relationships ?? []).filter((x: any) => x.type !== "exports"),
        ...(r.relationships ?? [])
          .filter((x: any) => x.type === "contains" && ["secret", "helper", "hidden", "invisible"].includes(String(x.target)))
          .map((x: any) => ({ ...x, type: "exports" })),
      ],
    }),
  },
  {
    id: "elixir/elx4-exports-includes-struct-fields",
    language: "elixir",
    defectClass: "ELX4 `exports` widens to non-callable members",
    description: "ELX4: struct fields become exports. `%Mod{}` already produces `instantiates`, and a field is not callable as `Mod.f(...)`.",
    transform: (r: any) => ({
      ...r,
      relationships: [
        ...(r.relationships ?? []).filter((x: any) => !(x.type === "contains" && ["id", "name"].includes(String(x.target)))),
      ],
    }),
  },
  {
    id: "elixir/elx4-overrides-dropped",
    language: "elixir",
    defectClass: "relationship type dropped (ELX4 `overrides`)",
    description: "ELX4: the `defoverridable` redefinition stops publishing `overrides`. 14 corpus edges, and the ontology gate's `overrides` allowlist entry has no oracle either, so nothing else would notice.",
    transform: (r: any) => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => x.type !== "overrides") }),
  },
  {
    id: "elixir/elx4-overrides-without-defoverridable",
    language: "elixir",
    defectClass: "ELX4 `overrides` fires on any redefinition",
    description: "ELX4: the `defoverridable` gate is dropped, so a second definition of a name becomes an override even when the module never marked it overridable. In Elixir that is a multi-clause continuation, not an override — the false-positive direction that would poison bb_impact.",
    transform: (r: any) => ({
      ...r,
      relationships: [
        ...(r.relationships ?? []).filter((x: any) => !(x.type === "overrides" && String(x.target) === "never_replaced")),
        { type: "overrides", source: "ELX4.Overridable", target: "never_replaced", confidence: 1.0, line_number: 8, metadata: { elixirSpecific: true, redefinition: true } },
      ],
    }),
  },
  {
    id: "elixir/elx4-overrides-line-lost",
    language: "elixir",
    defectClass: "ELX4 `overrides` drops `overridesLine`",
    description: "ELX4: both endpoints of an `overrides` edge are the same symbol by design (bash BD8b parity), so `metadata.overridesLine` is the ONLY thing that says which declaration was replaced. Losing it leaves an edge a consumer cannot act on.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) => {
        if (x.type !== "overrides") return x
        const md = { ...x.metadata }
        delete md.overridesLine
        return { ...x, metadata: md }
      }),
    }),
  },
  {
    id: "elixir/elx4-unknown-endpoint-back",
    language: "elixir",
    defectClass: "R7 fabrication: a placeholder name published as an edge endpoint",
    description: "ELX4: `contains -> Unknown` is restored for a symbol marked `unresolvedName`. 19 such edges existed at HEAD; this is the pin that keeps them out.",
    transform: unknownEndpointBack,
  },
  {
    id: "elixir/elx4-dirdefect-name-fabricated",
    language: "elixir",
    defectClass: "R7 fabrication: a directive's OPTIONS text published as a module name",
    description: "ELX4: the directive name extractor falls back to the whole `arguments` text again, so `alias :lists, as: MyList` publishes `references -> \":lists, as: MyList\"` — the register's own conviction class for this lane.",
    transform: (r: any, source?: string) => ({
      ...r,
      relationships: (r.relationships ?? []).flatMap((x: any) => {
        const t = String(x.target)
        const ci = t.indexOf(":")
        if (x.type !== "references" && x.type !== "calls") return [x]
        if (!source || ci === -1 || !source.includes(t.slice(0, ci))) return [x]
        // The pre-fix spelling: the target carries the directive's options.
        const fabrication = `${t}, as: Fabri`
        return ci !== -1 && t === ":lists" ? [{ ...x, target: fabrication }] : [x]
      }),
    }),
  },
  {
    id: "elixir/elx4-spec-directive-leak-back",
    language: "elixir",
    defectClass: "a TYPESPEC naming a directive-shaped function read as a directive",
    description: "ELX4: `@spec require([Path.t()], require_opts()) :: ...` publishes a `references` edge again (kernel/parallel_compiler.ex:278 published `references -> \"[Path.t], require_opts\"`; 22 sibling edges). The doc claimed this shape was gated and only use/import/alias had reached the gate.",
    transform: (r: any) => ({
      ...r,
      relationships: [...(r.relationships ?? []), { type: "references", source: "ELX4.R7Host", target: "[Path.t], require_opts", confidence: 0.9, metadata: { elixirSpecific: true }, line_number: 2 }],
    }),
  },
  {
    id: "elixir/elx4-struct-expression-call-back",
    language: "elixir",
    defectClass: "R7 fabrication: a struct EXPRESSION published as a call target",
    description: "ELX4: `%URI{uri | path: \"/bar\"}.path` publishes a call again — the conviction sample `validation/m60/target-spelling-register.json` records for this lane, which survived every round since it was written.",
    transform: (r: any) => ({
      ...r,
      relationships: [...(r.relationships ?? []), { type: "calls", source: "ELX4.R7Host.on_struct/0", target: '%URI{uri | path: "/bar"}.path', confidence: 0.8, metadata: { elixirSpecific: true }, line_number: 12 }],
    }),
  },
  {
    id: "elixir/elx4-field-read-call-back",
    language: "elixir",
    defectClass: "a MEMBER READ published as a call",
    description: "ELX4: `x.foo` publishes `calls -> foo` again. The corpus site was kernel/raise_test.exs:494 (`Process.get(:unused, %{}).foo`) and it reached the graph through the chained-receiver branch, which does not run the declared-set check.",
    transform: (r: any) => ({
      ...r,
      relationships: [...(r.relationships ?? []), { type: "calls", source: "ELX4.R7Host", target: "foo", confidence: 0.8, metadata: { elixirSpecific: true }, line_number: 10 }],
    }),
  },
  {
    id: "elixir/elx4-paren-operator-name-clobbered",
    language: "elixir",
    defectClass: "a name written by a fix is immediately overwritten (EX-A15's dead branch)",
    description: "ELX4: the three operator-reading lines move back OUT of the `else`, so `defmacro (..)` publishes a macro named `(` again. This is the exact brace misplacement that made EX-A15 dead on arrival, reverted to prove the pin bites.",
    transform: (r: any) => ({
      ...r,
      symbols: (r.symbols ?? []).filter((s: any) => s.name !== "..").concat([{ ...(r.symbols ?? []).find((s: any) => s.name === ".."), name: "(" }]),
      relationships: [
        ...(r.relationships ?? []).filter((x: any) => String(x.target) !== ".."),
        { type: "contains", source: "ELX4.R7Host", target: "(", confidence: 1.0, line_number: 14, metadata: { elixirSpecific: true } },
      ],
    }),
  },
  {
    id: "elixir/elx4-computed-module-body-attached",
    language: "elixir",
    defectClass: "a FALSE owner: an unnameable module's body attached to the enclosing module",
    description: "ELX4: the subtree skip is removed, so the `defstruct [:name, :age]` inside `defmodule Module.concat(A, B)` publishes `contains` edges from the enclosing module — a different fabrication from the fabricated name, and the one that replaced it.",
    transform: (r: any) => ({
      ...r,
      relationships: [
        ...(r.relationships ?? []).filter((x: any) => !["sample", "name", "age"].includes(String(x.target))),
        { type: "contains", source: "ELX4.R7Host.Computed", target: "name", confidence: 1.0, line_number: 36, metadata: { elixirSpecific: true } },
        { type: "contains", source: "ELX4.R7Host.Computed", target: "age", confidence: 1.0, line_number: 36, metadata: { elixirSpecific: true } },
      ],
    }),
  },
  {
    id: "elixir/elx4-absolute-module-reprefixed",
    language: "elixir",
    defectClass: "a name written in full re-prefixed with its scope",
    description: "ELX4: `defmodule :\"Elixir.ELX4.Abs\"` publishes `ELX4.R7Host.Absolute.Elixir.ELX4.Abs` again — measured, doubled on 8 corpus module names.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) =>
        String(x.target) === "Elixir.ELX4.Abs" ? { ...x, target: "ELX4.R7Host.Absolute.Elixir.ELX4.Abs" } : x),
    }),
  },
  {
    id: "elixir/elx4-evidenceclass-dropped",
    language: "elixir",
    defectClass: "ELX4 `evidenceClass` disappears (Q6)",
    description: "ELX4: no edge carries `evidenceClass` again. Before this wave 0 of 60,959 corpus edges had one, so a consumer asking which edges are read off a node and which are name-resolved had nothing to read.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) => {
        const md = { ...x.metadata }
        delete md.evidenceClass
        return { ...x, metadata: md }
      }),
    }),
  },
]