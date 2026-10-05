/**
 * PROTOBUF MUTANTS — the lane's regression mutants for the M14.0.F4 gate.
 *
 * WHY THIS IS A SEPARATE FILE. `script/m14/mutate-analyzer.ts` is a shared registry
 * that several lanes edit concurrently, and `script/m14/fsharp-mutants.ts` records
 * what happens when a lane writes its work directly into it: a 259-line block was
 * overwritten within the hour, SILENTLY, and the gate kept reporting numbers with
 * that lane's mutants simply absent. This file is the whole footprint the lane
 * asks the shared file to carry — one import and one spread — so a concurrent
 * merge cannot cost the lane its coverage.
 *
 * WHY THE LANE NEEDED IT AT ALL. Measured: `bun run script/m14/mutate-analyzer.ts`
 * over 1,481 mutants contained ZERO with `language: "protobuf"`, and both protobuf
 * fixtures passed. A suite with no mutants cannot fail, so that green was
 * unearned — it said nothing about whether these two fixtures can see a defect.
 * Every mutant below is a revert of a rule the analyzer actually implements, and
 * each one exists because the fixture suite has to be shown to catch it.
 *
 * WHAT EACH MUTANT IS. A faithful simulation of an analyzer carrying one defect,
 * applied to the analyzer's own output, written GENERICALLY off that output
 * (`metadata` flags, `role` tags, kinds) rather than off a hardcoded name from a
 * fixture — a name-hardcoded filter silently stops matching when a fixture is
 * edited, which is how a mutant survives a suite that would otherwise catch it.
 *
 * THE TEN DEFECT CLASSES, and which the two shipped fixtures caught when this
 * battery first ran (see docs/analyzers/real-protobuf-analyzer.md for the counts):
 * the reference-resolution rules, the scalar rule, the rpc request/response pair,
 * the oneof ownership ruling, and the map-key rule are all pinned. The construct
 * rules this lane had NOT been exercising — `extend`, the proto2 `group`, import
 * modifiers, streaming, `reserved`/`extensions`, the published `metadata.id`, the
 * confidence value — were NOT pinned, and those are the survivors that produced
 * the fixture files added alongside this registry.
 */
import type { Mutant } from "./mutate-analyzer"

const rels = (r: any): any[] => (r?.relationships ?? []) as any[]
const syms = (r: any): any[] => (r?.symbols ?? []) as any[]
const role = (x: any): string | undefined => x?.metadata?.role

/** Every `uses` edge, or only those carrying one role. */
const usesEdges = (r: any, want?: string): any[] =>
  rels(r).filter((x) => (x.type ?? x.relationshipType) === "uses" && (!want || role(x) === want))

export const PROTOBUF_MUTANTS: Mutant[] = [
  {
    id: "protobuf/dotted-reference-prefixed-with-the-package",
    language: "protobuf",
    defectClass: "wrong-target",
    description:
      "The one resolution rule the header argues for at length: a DOTTED name in protobuf is written fully qualified, so `extend google.protobuf.MessageOptions` inside `package a` means the GLOBAL google.protobuf.MessageOptions. The pre-fix fallback prefixed the package to every unresolved reference and so produced `a.google.protobuf.MessageOptions`, a type that exists in no file. Reverted by prefixing the package to any `uses` target that is dotted and does not already carry the package prefix — the result's own `metadata.protoPackage` supplies the package, so the transform stays valid on any fixture. Caught by protobuf/payload-and-ontology, whose `User.created` row pins `uses -> google.protobuf.Timestamp` at the absolute spelling.",
    transform: (r: any) => {
      const pkg = r?.metadata?.protoPackage
      if (!pkg) return r
      return {
        ...r,
        relationships: rels(r).map((x) => {
          const t = x.type ?? x.relationshipType
          if (t !== "uses") return x
          const tgt = String(x.target ?? "")
          if (!tgt.includes(".") || tgt === pkg || tgt.startsWith(`${pkg}.`)) return x
          return { ...x, target: `${pkg}.${tgt}` }
        }),
      }
    },
  },
  {
    id: "protobuf/leading-dot-no-longer-absolute",
    language: "protobuf",
    defectClass: "wrong-target",
    description:
      "A leading dot in a protobuf type reference means ABSOLUTE: `.google.protobuf.Timestamp` names the global type whatever the enclosing package is, and stripping the dot and resolving from the innermost scope outward lands on `demo.v1.google.protobuf.Timestamp`. This is the half of the resolution contract the dotted-fallback mutant does not exercise, and it is separate from it: fixing one leaves the other live. Reverted by re-prefixing the package onto any `uses` target that is neither package-qualified nor a name the file itself declares — the analyzer records `metadata.protoPackage`, and the declared set is rebuilt from the result's own symbols, so the transform does not depend on a fixture's names. Caught by protobuf/absolute-and-scope-resolution, whose `.demo.v1.Role` and `Outer.Inner` rows pin the absolute case and the scope walk independently.",
    transform: (r: any) => {
      const pkg = r?.metadata?.protoPackage
      if (!pkg) return r
      const declared = new Set<string>(syms(r).map((s: any) => s?.metadata?.id).filter(Boolean))
      return {
        ...r,
        relationships: rels(r).map((x) => {
          const t = x.type ?? x.relationshipType
          if (t !== "uses") return x
          const tgt = String(x.target ?? "")
          if (!tgt.includes(".") || tgt === pkg || tgt.startsWith(`${pkg}.`) || declared.has(tgt)) return x
          return { ...x, target: `${pkg}.${tgt}` }
        }),
      }
    },
  },
  {
    id: "protobuf/relative-reference-lands-on-the-outermost-declaration",
    language: "protobuf",
    defectClass: "wrong-target",
    description:
      "A protobuf reference resolves from the INNERMOST enclosing scope outward, so inside `Outer`, the name `Inner` is `Outer.Inner` and not the top-level `Inner` — a shape protobuf permits precisely because two scopes may declare the same leaf name. The pre-fix resolver compared only the last dot segment against a package-prefixed concatenation and produced `demo.v1.Auth.demo.v1.User`, a name in no file; the fix compares whole ids along the scope chain. Reverted by moving every `uses` edge off a NESTED declaration onto the top-level declaration of the same leaf name where one exists, which is the defect this rule exists to prevent expressed in its other direction: a resolver that starts its walk at the outermost scope instead of the innermost. Caught by protobuf/absolute-and-scope-resolution, whose `Outer.inner` and `Outer.Deepest.inner` rows both pin the NESTED `Outer.Inner` while a top-level `Inner` is declared in the same file, so an analyzer that reached either would fail.",
    transform: (r: any) => {
      const pkg = String(r?.metadata?.protoPackage ?? "")
      if (!pkg) return r
      // Top-level declarations are exactly `pkg.<leaf>`; anything deeper is nested.
      const topLevel = new Map<string, string>()
      for (const s of syms(r)) {
        const id = String(s?.metadata?.id ?? "")
        if (id.startsWith(`${pkg}.`) && id.slice(pkg.length + 1).indexOf(".") === -1) topLevel.set(String(s.name), id)
      }
      if (topLevel.size === 0) return r
      return {
        ...r,
        relationships: rels(r).map((x) => {
          const t = x.type ?? x.relationshipType
          if (t !== "uses") return x
          const tgt = String(x.target ?? "")
          if (!tgt.startsWith(`${pkg}.`)) return x
          const rest = tgt.slice(pkg.length + 1)
          if (!rest.includes(".")) return x
          const outer = topLevel.get(rest.slice(rest.lastIndexOf(".") + 1))
          return outer ? { ...x, target: outer } : x
        }),
      }
    },
  },
  {
    id: "protobuf/scalar-type-published-as-a-reference",
    language: "protobuf",
    defectClass: "fabricated-edge",
    description:
      "A `type` node holding no `message_or_enum_type` child is a scalar KEYWORD — `string`, `int32`, `bytes` — and there is no declaration of it anywhere, so a `uses` edge onto one points at nothing. The analyzer decides this by construction rather than from a hardcoded scalar list, which is what makes an unrecognised scalar safe. Reverted by giving every `property` the analyzer marked `metadata.scalar` a `uses` edge onto its own `metadata.type`. This is the fabrication defect the workstream calls the most expensive one available, because an edge onto a non-symbol poisons bb_graph, bb_impact and bb_migrate. Caught by protobuf/payload-and-ontology, whose forbid rows name `uses -> string` for both a plain field and a map value.",
    transform: (r: any) => {
      const scalars = syms(r).filter((s: any) => s?.kind === "property" && s?.metadata?.scalar === true)
      if (scalars.length === 0) return r
      const extra = scalars
        .filter((s: any) => typeof s.metadata?.type === "string" && s.metadata.type.length > 0)
        .map((s: any) => ({
          source: s.metadata.id,
          target: s.metadata.type,
          type: "uses",
          relationshipType: "uses",
          line_number: s.range?.startLine ?? 0,
          confidence: 1.0,
          metadata: { role: "fieldType" },
        }))
      return { ...r, relationships: [...rels(r), ...extra] }
    },
  },
  {
    id: "protobuf/map-key-type-published-as-a-reference",
    language: "protobuf",
    defectClass: "fabricated-edge",
    description:
      "A map field's KEY type is a scalar by specification — the grammar admits no other kind there — so the key is never a reference, while the VALUE is an ordinary type reference and does produce an edge. Treating the two alike publishes an edge onto a keyword. Reverted by emitting a second `uses` edge from every `isMap` property onto its `metadata.mapKey`. Caught by protobuf/payload-and-ontology, whose map forbid row pins the absence for a `map<string, string>` field; the value edge is pinned by the same fixture, so the pair cannot be satisfied by dropping both.",
    transform: (r: any) => {
      const maps = syms(r).filter((s: any) => s?.metadata?.isMap === true)
      const extra = maps
        .filter((s: any) => typeof s.metadata?.mapKey === "string" && s.metadata.mapKey.length > 0)
        .map((s: any) => ({
          source: s.metadata.id,
          target: s.metadata.mapKey,
          type: "uses",
          relationshipType: "uses",
          line_number: s.range?.startLine ?? 0,
          confidence: 1.0,
          metadata: { role: "mapKeyType" },
        }))
      if (extra.length === 0) return r
      return { ...r, relationships: [...rels(r), ...extra] }
    },
  },
  {
    id: "protobuf/rpc-response-edge-dropped",
    language: "protobuf",
    defectClass: "missing-edge",
    description:
      "An rpc names a request AND a response, and the grammar gives both the same node type with no field name, so they are told apart by position. Emitting one edge per rpc records half the fact and makes `Login -> User` indistinguishable from an rpc whose response differs. Reverted by dropping every `uses` edge tagged `role: rpcResponse`. Caught by protobuf/payload-and-ontology, whose `expectRelationshipCount` pins `equals: 2` for a request and response that are the SAME type — a suite that only checked presence would report a pass here, which is why the count row exists.",
    transform: (r: any) => ({
      ...r,
      relationships: rels(r).filter((x) => role(x) !== "rpcResponse"),
    }),
  },
  {
    id: "protobuf/oneof-field-reowned-by-the-oneof",
    language: "protobuf",
    defectClass: "wrong-source",
    description:
      "A oneof's fields belong to the MESSAGE, not to the oneof: the field number lives in the message's own space and `msg.field` is how every protobuf tool names it. Grouping is a different relation from ownership, so the grouping travels as `metadata.oneof` and `contains` means ownership only. Reverted by re-owning every `union`-flagged field to its oneof and moving the `contains` edge with it — which is exactly the pre-fix shape, and it also manufactures the second `contains` edge the header argues against. Caught by protobuf/payload-and-ontology, which pins `contains User -> User.email` AND forbids `contains User.contact -> User.email`, so neither half alone passes.",
    transform: (r: any) => {
      const oneofs = new Map<string, any>()
      for (const s of syms(r)) {
        if (s?.kind === "union" && s?.ownerName && s?.metadata?.id) oneofs.set(String(s.metadata.id), s)
      }
      if (oneofs.size === 0) return r
      const ownerOf = (id: string): string | null => {
        for (const [oid, o] of oneofs) {
          if (id.startsWith(`${oid}.`)) return oid
        }
        return null
      }
      return {
        ...r,
        symbols: syms(r).map((s: any) => {
          if (s?.kind !== "property" || typeof s?.metadata?.oneof !== "string") return s
          const owner = ownerOf(String(s?.metadata?.id ?? ""))
          if (!owner) return s
          return { ...s, ownerName: owner, ownerKind: "union" }
        }),
        relationships: rels(r).map((x) => {
          const t = x.type ?? x.relationshipType
          if (t !== "contains") return x
          const tgt = String(x.target ?? "")
          const oneofName = syms(r).find((s: any) => s?.metadata?.id === tgt)?.metadata?.oneof
          if (typeof oneofName !== "string") return x
          const msgId = String(x.source ?? "")
          // `metadata.oneof` is the oneof's RESOLVED ID as of pass 2; it used to be
          // the bare name, which made the lookup `message.id + "." + oneofName`. Both
          // spellings are tried, because a mutant that can no longer fire reports a
          // hole that does not exist while missing the one that does — the exact
          // failure this battery was rebuilt to stop, and it is what happened to this
          // row the moment the oneof key was qualified.
          const owner = oneofs.get(oneofName) ?? oneofs.get(`${msgId}.${oneofName}`)
          if (!owner) return x
          return { ...x, source: owner.metadata.id }
        }),
      }
    },
  },
  {
    id: "protobuf/extend-block-mints-a-phantom-type",
    language: "protobuf",
    defectClass: "fabricated-symbol",
    description:
      "`extend Foo { … }` adds fields to a type this file does NOT declare, so the block is not a declaration and publishing a symbol for it is a fabricated type: a phantom that then becomes the source of a fabricated containment edge and a second, disagreeing copy of a type that already has an owner in the file that declares it. The analyzer emits no block symbol for this reason. Reverted by minting one `class` symbol per `viaExtension` member's owner that the file does not itself declare, and a `contains` edge from the phantom to each of that owner's members — the pre-fix shape. Caught by protobuf/extend-and-group, which forbids the phantom symbol name outright and pins the total symbol count, so neither half of the fabrication can be satisfied by removing only the edge.",
    transform: (r: any) => {
      const declared = new Set<string>(syms(r).map((s: any) => s?.metadata?.id).filter(Boolean))
      const extOwners = new Set<string>()
      for (const s of syms(r)) {
        if (s?.metadata?.viaExtension === true && typeof s?.ownerName === "string") extOwners.add(s.ownerName)
      }
      const missing = [...extOwners].filter((t) => !declared.has(t))
      if (missing.length === 0) return r
      const extraSyms = missing.map((t) => ({
        name: t.includes(".") ? t.slice(t.lastIndexOf(".") + 1) : t,
        kind: "class",
        range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1, startIndex: 0, endIndex: 0 },
        metadata: { id: t, isExtendBlock: true },
      }))
      // The phantom OWNS the members, so the pre-fix shape also moved the real
      // containment edges onto it. Reverting only the symbol would leave the
      // graph self-consistent and the mutant would survive on a technicality.
      const extraRels = missing.flatMap((t) =>
        rels(r)
          .filter((x) => (x.type ?? x.relationshipType) === "contains" && String(x.source) === t)
          .map((x) => ({ ...x, source: t })),
      )
      return { ...r, symbols: [...syms(r), ...extraSyms], relationships: [...rels(r), ...extraRels] }
    },
  },
  {
    id: "protobuf/group-type-and-field-share-one-id",
    language: "protobuf",
    defectClass: "duplicate-symbol",
    description:
      "A proto2 `group` declares a nested type AND a field of the same name in the same message, so on a bare `owner.name` id the two collide and the `uses` edge that should run field→type loops a symbol onto itself. The fix disambiguates the second id with a `#<kind>` suffix and PUBLISHES the resolved id on `metadata.id`, so a consumer re-deriving `ownerName + \".\" + name` cannot reconstruct the wrong one. Reverted by rewriting every `#`-disambiguated id back to its bare form, which restores both the collision and the self-edge. Caught by protobuf/extend-and-group, which pins two DISTINCT symbols for the group, the `uses` edge between them, and forbids the self-edge.",
    transform: (r: any) => {
      const disambiguated = syms(r).filter((s: any) => typeof s?.metadata?.id === "string" && s.metadata.id.includes("#"))
      if (disambiguated.length === 0) return r
      const bare = new Map<string, string>()
      for (const s of disambiguated) bare.set(String(s.metadata.id), String(s.metadata.id).split("#")[0])
      return {
        ...r,
        symbols: syms(r).map((s: any) => {
          const id = String(s?.metadata?.id ?? "")
          const b = bare.get(id)
          if (!b) return s
          return { ...s, metadata: { ...s.metadata, id: b } }
        }),
        relationships: rels(r).map((x) => {
          const out = { ...x }
          const src = bare.get(String(x.source ?? ""))
          const tgt = bare.get(String(x.target ?? ""))
          if (src) out.source = src
          if (tgt) out.target = tgt
          return out
        }),
      }
    },
  },
  {
    id: "protobuf/import-modifier-not-read",
    language: "protobuf",
    defectClass: "missing-field",
    description:
      "`import public` is a re-export: this file's importers reach the imported declarations THROUGH it, which is a fact about the module graph and not derivable from the path. The modifier is an anonymous token child, read off the tree, because matching the declaration's text for an `import public` prefix is a parser in disguise and misfires on any grammar change. Reverted by dropping `metadata.modifier` from every import. Caught by protobuf/imports-and-editions, which pins `public`, `weak` and the editions `option` import form, and forbids an import with no modifier claiming one.",
    transform: (r: any) => ({
      ...r,
      imports: (r?.imports ?? []).map((i: any) => {
        if (!i?.metadata || i.metadata.modifier === undefined) return i
        const { modifier, ...rest } = i.metadata
        return { ...i, metadata: rest }
      }),
    }),
  },
  {
    id: "protobuf/streaming-detected-from-node-text",
    language: "protobuf",
    defectClass: "wrong-payload",
    description:
      "`stream` is an anonymous sibling immediately BEFORE the type it qualifies, so client- and server-streaming are read off the tree. The pre-fix version tested the rpc's text for `(stream`, which is a text scan AND wrong on `option (x) = \"stream(1)\"` — a quoted value that mentions the keyword. Reverted by forcing both streaming flags false on every rpc. Caught by protobuf/streaming-and-forward-refs, which pins one client-streaming, one server-streaming and one bidirectional rpc, and forbids the flags on a unary rpc — a suite pinning only the positive cases would pass an analyzer that set every flag true.",
    transform: (r: any) => ({
      ...r,
      symbols: syms(r).map((s: any) =>
        s?.kind === "method" && s?.metadata
          ? { ...s, metadata: { ...s.metadata, clientStreaming: false, serverStreaming: false } }
          : s,
      ),
    }),
  },
  {
    id: "protobuf/reserved-and-extensions-dropped",
    language: "protobuf",
    defectClass: "missing-field",
    description:
      "`reserved` records field numbers and names a schema has RETIRED, and `extensions` records where other files may add members. Both are what makes a migration audit possible, and both are facts about the schema rather than about a declaration, so they attach to the owning message's metadata — the scope the specification gives them — or to the file at file scope. Reverted by stripping both lists. Caught by protobuf/extend-and-group, which pins the message-level ranges, the message-level reserved NAMES and the file-scope list separately, so a rule that moved one to the other scope would fail too.",
    transform: (r: any) => ({
      ...r,
      symbols: syms(r).map((s: any) => {
        if (!s?.metadata) return s
        const { reserved, extensions, ...rest } = s.metadata
        return { ...s, metadata: rest }
      }),
      metadata: (() => {
        const { fileRanges, ...rest } = r?.metadata ?? {}
        return rest
      })(),
    }),
  },
  {
    id: "protobuf/published-symbol-id-dropped",
    language: "protobuf",
    defectClass: "missing-field",
    description:
      "The resolved id is published as `metadata.id` rather than left to be re-derived, because a consumer that rebuilds `ownerName + \".\" + name` reconstructs the WRONG id for a proto2 group and for any damaged input — which is how the corpus probe first reported 28 phantom duplicate ids and 48 phantom unresolved endpoints. Reverted by deleting `metadata.id` from every symbol. Caught by protobuf/extend-and-group, whose group rows are keyed on the two distinct ids, and by protobuf/payload-and-ontology's endpoint rows.",
    transform: (r: any) => ({
      ...r,
      symbols: syms(r).map((s: any) => {
        if (!s?.metadata || s.metadata.id === undefined) return s
        const { id, ...rest } = s.metadata
        return { ...s, metadata: rest }
      }),
    }),
  },
  {
    id: "protobuf/field-shadows-its-own-type-reference",
    language: "protobuf",
    defectClass: "self-edge",
    description:
      "A REGRESSION guard for a defect this lane measured and fixed, not a revert of a pre-fix draft. Protobuf resolves a type name through nested scopes, and only TYPES are in that namespace; a field declares no type. The resolver accepted every declaration, so an ordinary field whose NAME equals the type it names answered its own type reference: `message Extra { repeated IPAMStatus IPAMStatus = 1; }` published the field as `pkg.Extra.IPAMStatus` moments before emitting its edge, the innermost scope candidate matched the field, and the edge became `pkg.Extra.IPAMStatus -> pkg.Extra.IPAMStatus`. Measured: 9 self-edges over 606 corpus files — docker/daemon/cluster/convert/netextra/extra.proto:12 and 8 under docker/vendor/github.com/moby/buildkit (api/types/worker.proto:13-14, frontend/gateway/pb/gateway.proto:173/193/197, solver/pb/ops.proto:117/120/317). A self-edge is the shape a fabricated edge takes when two declarations collide on one id, so bb_graph, bb_impact and bb_migrate would each read it as a field whose type is itself. Reverted by resolving against EVERY declaration again — the result's own symbol table gives the containing message of each `property`, and a `uses` edge from that property onto an id with the same leaf name is moved onto it. Caught by protobuf/absolute-and-scope-resolution, whose `SelfNamed.Inner` row pins the top-level type and whose forbid row pins the ABSENCE of the self-edge; the `SelfNamed.shadow` row is the control, since it has no collision for this defect to exploit.",
    transform: (r: any) => {
      const propIds = new Set(
        syms(r).filter((s: any) => s?.kind === "property").map((s: any) => String(s?.metadata?.id ?? "")),
      )
      if (propIds.size === 0) return r
      return {
        ...r,
        relationships: rels(r).map((x) => {
          const t = x.type ?? x.relationshipType
          if (t !== "uses") return x
          const src = String(x.source ?? "")
          const tgt = String(x.target ?? "")
          // The pre-fix shape exactly: the field answers its own type reference,
          // so the edge's SOURCE is also its TARGET. That is the whole defect —
          // the innermost scope candidate that matched was `owner.<fieldName>`,
          // which is this edge's own source. Matching on the source rather than
          // on any field sharing a leaf name is what keeps the mutant faithful:
          // a looser predicate also fires on unrelated fields and would then be
          // caught by the wrong assertion, which is coverage that reads as
          // coverage and is not.
          if (src === tgt) return x
          const leaf = tgt.includes(".") ? tgt.slice(tgt.lastIndexOf(".") + 1) : tgt
          if (!src.endsWith(`.${leaf}`) || !propIds.has(src)) return x
          return { ...x, target: src }
        }),
      }
    },
  },
  {
    id: "protobuf/import-edge-dropped",
    language: "protobuf",
    defectClass: "missing-edge",
    description:
      "A dependency graph for a schema language that cannot answer `which file does this type come from` is missing the one edge a consumer needs most, and its absence is invisible to a differential because the oracle was written after the same ruling. Measured before this lane's change: 1,117 `import` nodes across 392 of 606 corpus files were recorded into `result.imports` and emitted as NO edge at all. Reverted by dropping every `imports` relationship while leaving the `imports[]` array intact, which is exactly the pre-fix state — the array was already correct, so this mutant is faithful rather than a wholesale deletion. Caught by protobuf/imports-and-editions, which pins all three non-public forms including the editions feature import.",
    transform: (r: any) => ({
      ...r,
      relationships: rels(r).filter((x) => (x.type ?? x.relationshipType) !== "imports"),
    }),
  },
  {
    id: "protobuf/public-import-recorded-as-a-plain-import",
    language: "protobuf",
    defectClass: "wrong-type",
    description:
      "`import public` is a RE-EXPORT: this file's own importers reach the imported declarations through it. Recorded as a plain import it becomes an ordinary dependency, the re-export fact is lost, and a consumer asking which of two files importing the same path republishes it gets the same answer for both. Measured: 4 occurrences in 4 files (pb-reference/src/google/protobuf/{cpp_options,json_options,unittest_import,unittest_import_lite}.proto). Reverted by relabelling every `exports` edge as `imports` and dropping its `viaPublicImport` marker — the shape an analyzer that knew about imports but not re-exports produces. Caught by protobuf/imports-and-editions, which pins an `exports` row AND forbids the `imports` row for the same target, so relabelling alone cannot satisfy it.",
    transform: (r: any) => ({
      ...r,
      relationships: rels(r).map((x) => {
        const t = x.type ?? x.relationshipType
        if (t !== "exports") return x
        const { viaPublicImport, ...rest } = (x.metadata ?? {}) as any
        return { ...x, type: "imports", relationshipType: "imports", metadata: { ...rest, evidenceClass: "import_based" } }
      }),
    }),
  },
  {
    id: "protobuf/import-edge-sourced-from-the-imported-path",
    language: "protobuf",
    defectClass: "fabricated-edge",
    description:
      "The SOURCE of a module edge is the importing file and the TARGET is the path as written. Taking the basename of the IMPORTED path for the source — which a first draft of this change did, before the suite caught it — makes a file appear to depend on ITSELF: `import public \"common/v1/types.proto\"` became `types.proto -> common/v1/types.proto`, an edge whose two endpoints name the same module, which bb_graph reads as a self-dependency and bb_impact reads as a cycle. Reverted by re-sourcing every module edge onto the basename of its own target. Caught by protobuf/imports-and-editions, whose forbid row names the self-import shape explicitly.",
    transform: (r: any) => ({
      ...r,
      relationships: rels(r).map((x) => {
        const t = x.type ?? x.relationshipType
        if (t !== "imports" && t !== "exports") return x
        const tgt = String(x.target ?? "")
        const self = tgt.includes("/") ? tgt.slice(tgt.lastIndexOf("/") + 1) : tgt
        return { ...x, source: self }
      }),
    }),
  },
  {
    id: "protobuf/evidence-class-dropped",
    language: "protobuf",
    defectClass: "missing-field",
    description:
      "Every edge this analyzer emits is read off the parse tree — a declaration node, a named child, an anonymous sibling token, a position — so its tier is `structural`, or `import_based` for an import. Measured before this lane's change: 40,562 of 40,562 production edges carried NO `evidenceClass`, so the honesty contract's requirement that a heuristic be COUNTABLE had nothing to count and the graph panel had to infer a tier from the confidence value instead. Reverted by deleting the key from every edge. Caught by protobuf/imports-and-editions, whose rows pin `meta.evidenceClass` on both a `contains` edge and an `imports` edge — the two different tiers, so an analyzer that stamped one constant on everything would fail as well.",
    transform: (r: any) => ({
      ...r,
      relationships: rels(r).map((x) => {
        if (!x?.metadata || x.metadata.evidenceClass === undefined) return x
        const { evidenceClass, ...rest } = x.metadata as any
        return { ...x, metadata: rest }
      }),
    }),
  },
  {
    id: "protobuf/parse-fact-downgraded-to-a-heuristic",
    language: "protobuf",
    defectClass: "confidence",
    description:
      "Every relationship this analyzer emits is a parse FACT — a declaration node, a named child, a position — so the honest confidence is 1.0 and nothing lands under the 0.7 threshold the contract reserves for name-match guesses. Reverted by writing 0.5 on every edge, which is the shape a heuristic guess would take and which the contract requires to be countable. Caught by protobuf/streaming-and-forward-refs, whose every relationship row carries `confidenceMin: 0.9` — a fixture that asserted no confidence would pass this mutant, and then the workstream's heuristic-ratio question would have no answer for this lane.",
    transform: (r: any) => ({
      ...r,
      relationships: rels(r).map((x) => ({ ...x, confidence: 0.5 })),
    }),
  },
  {
    id: "protobuf/same-slot-override-collapsed-into-a-duplicate-name",
    language: "protobuf",
    defectClass: "dropped-edge",
    description:
      "The `overrides` rule pass 1 did not have. What protobuf can express as an override is a field SLOT restated: two declarations in one message claiming the same number. This mutant reverts the rule to the reading pass 1's own probe used — 'a name declared twice in one scope' — which is the reading that fires on a name collision that replaces nothing, because the two claims occupy different slots. Reverted by dropping every `overrides` edge whose two endpoints carry DIFFERENT `metadata.fieldNumber`s, i.e. keeping only the name-and-number shape and deleting the slot shape. That is the pre-fix state: `string legacy = 7; int64 modern = 7;` restates slot 7 under a fresh name and the edge disappears, while `string dup = 3; bool dup = 3;` survives, so the corpus count of 1 that pass 1 measured was a coincidence of one syntax-highlighting fixture rather than a measurement of the construct. Caught by protobuf/slot-and-grouping, whose `Slot.modern -> Slot.legacy` row requires the slot shape. Its `Twin` forbid rows are the other half: they fail an analyzer whose rule is 'a repeated NAME', which is the mutant the fixture exists to keep out.",
    transform: (r: any) => {
      const byId = new Map<string, any>(syms(r).map((s: any) => [String(s?.metadata?.id), s]))
      // The name-collision reading: an override is a name declared twice. Every one
      // of those also repeats the field number, so the number cannot be the
      // discriminator — the NAME can. Dropping exactly the edges whose endpoints
      // carry different names leaves the name-and-number shape standing and deletes
      // the slot shape, which is the pre-fix behaviour.
      const dropped = rels(r).filter((x: any) => {
        if ((x.type ?? x.relationshipType) !== "overrides") return false
        const a = byId.get(String(x.source))
        const b = byId.get(String(x.target))
        return a && b && String(a.name) !== String(b.name)
      })
      if (dropped.length === 0) return r
      const gone = new Set(dropped.map((x: any) => `${x.source}\u0000${x.target}\u0000${x.line_number}`))
      return {
        ...r,
        relationships: rels(r).filter((x: any) => !gone.has(`${x.source}\u0000${x.target}\u0000${x.line_number}`)),
      }
    },
  },
  {
    id: "protobuf/override-edge-line-taken-from-the-declaration-being-added",
    language: "protobuf",
    defectClass: "wrong-line",
    description:
      "The `overrides` edge's `line_number` must be the SOURCE's line, because `line_number` is what `bb_graph` and the store's relId key on. The walk is a LIFO stack and reaches siblings in reverse document order, so the declaration being ADDED when the collision is noticed is usually the EARLIER one — this is measured, not hypothetical: the first version of the rule reported the override of slot 7 at line 26, which is `legacy`, the declaration being overridden, while the source `modern` is line 27. Reverted by rewriting each `overrides` edge's line to the LOWER of its two endpoints' lines, which is the same wrong answer for a forward-declared pair and cannot be told apart from the correct one by an assertion that does not read the source. Caught by protobuf/slot-and-grouping, whose two `overrides` rows pin line 27 and line 36 — the sources — and whose forbid rows name the same two symbol pairs, so an edge with the right endpoints and the wrong line still fails.",
    transform: (r: any) => {
      const byId = new Map<string, any>(syms(r).map((s: any) => [String(s?.metadata?.id), s]))
      return {
        ...r,
        relationships: rels(r).map((x: any) => {
          if ((x.type ?? x.relationshipType) !== "overrides") return x
          const a = Number(byId.get(String(x.source))?.range?.startLine ?? x.line_number ?? 0)
          const b = Number(byId.get(String(x.target))?.range?.startLine ?? x.line_number ?? 0)
          return { ...x, line_number: Math.min(a, b) || x.line_number }
        }),
      }
    },
  },
  {
    id: "protobuf/oneof-grouping-key-downgraded-to-the-bare-name",
    language: "protobuf",
    defectClass: "ambiguous-metadata",
    description:
      "`metadata.oneof` is how a oneof's grouping travels, since `contains` means ownership only and there is deliberately no edge from the oneof to its fields. It carried the oneof's BARE name, which cannot address a oneof: two messages in one file may each declare `oneof body`, and a consumer grouping fields by that string merges two unrelated discriminated unions. Measured over the corpus before the change: 423 of 1,121 oneof fields (37.73%) sat under a bare name declared by more than one owner — `oneof attrs` in 7 different messages of boundary's session_recording.proto alone. Reverted by truncating every `metadata.oneof` to its last dotted segment, rebuilt from the result's own symbols rather than from a fixture name. Caught by protobuf/slot-and-grouping, which declares `oneof body` in two messages and requires the two fields' keys to be the two RESOLVED ids — an analyzer emitting the bare name fails both rows, and neither row can be satisfied by emitting nothing.",
    transform: (r: any) => {
      const declared = new Set<string>(syms(r).map((s: any) => String(s?.metadata?.id)).filter(Boolean))
      return {
        ...r,
        symbols: syms(r).map((s: any) => {
          const key = s?.metadata?.oneof
          if (typeof key !== "string") return s
          const bare = key.split(".").pop() ?? key
          // only downgrade when a DIFFERENT oneof in this file really does own the
          // bare name — otherwise the two spellings are the same string and the
          // transform cannot fire, which would report a hole that does not exist.
          const owners = new Set<string>()
          for (const id of declared) {
            if (id.endsWith(`.${bare}`)) owners.add(id)
          }
          if (owners.size < 2) return s
          return { ...s, metadata: { ...s.metadata, oneof: bare } }
        }),
      }
    },
  },
  {
    id: "protobuf/extension-edge-loses-viaextension",
    language: "protobuf",
    defectClass: "missing-field",
    description:
      "`viaExtension` was carried on the extension field's SYMBOL and not on the EDGE that adds it to the extended type, so a consumer reading `google.protobuf.MessageOptions -contains-> audit_ticket` could not tell a field added by an `extend` block in another file from one declared in MessageOptions' own body — and this analyzer's own header claimed the edge carried it, which made the header false. Measured over the corpus before the change: 0 of the extension-derived `contains` edges carried `viaExtension`. Reverted by deleting the key from every edge whose metadata has it, leaving the symbol's copy intact — the exact pre-fix shape, in which the two are not derived from each other and the flag can drift. Caught by protobuf/extend-and-group, whose two rows now require `meta.viaExtension` ON THE EDGE. The same fixture's plain-field rows in protobuf/payload-and-ontology forbid the flag there, so stamping it on every edge fails as well.",
    transform: (r: any) => ({
      ...r,
      relationships: rels(r).map((x: any) => {
        const md = x?.metadata
        if (!md || md.viaExtension === undefined) return x
        const { viaExtension, ...rest } = md as any
        return { ...x, metadata: rest }
      }),
    }),
  },
  {
    id: "protobuf/public-import-loses-its-dependency-edge",
    language: "protobuf",
    defectClass: "dropped-edge",
    description:
      "`import public \"x.proto\"` is BOTH a dependency and a re-export: `protoc` records it as a `FileDescriptorProto` dependency like any other, with `public_dependency` naming its index. Pass 1 emitted `exports` alone, pinned the absence of `imports` with a fixture forbid, and the fixture's stated reason — that emitting both 'would double the module's inbound dependency and lose the re-export fact entirely' — is wrong on both halves: nothing is doubled, because the pair went from ZERO `imports` edges to one, and the re-export fact is what the `exports` edge carries. Reverted by dropping every `imports` edge that also appears as an `exports` edge on the same source and target, which is exactly the pre-fix state. Caught by protobuf/imports-and-editions, whose public-import rows now REQUIRE both labels, so neither reading satisfies the fixture alone.",
    transform: (r: any) => {
      const pub = new Set<string>(
        rels(r)
          .filter((x: any) => (x.type ?? x.relationshipType) === "exports")
          .map((x: any) => `${x.source}\u0000${x.target}`),
      )
      return {
        ...r,
        relationships: rels(r).filter(
          (x: any) =>
            !(
              (x.type ?? x.relationshipType) === "imports" &&
              pub.has(`${x.source}\u0000${x.target}`)
            ),
        ),
      }
    },
  },

  {
    id: "protobuf/module-edge-source-back-to-the-basename",
    language: "protobuf",
    defectClass: "wrong-source",
    description:
      "Pass 16 measured that the `imports`/`exports` SOURCE resolved against published ids at 0 of 1,561 + 4 edges, and that 967 of 1,565 (61.8%) hung off a basename another corpus file also uses. The source is now the file's own `package` namespace, which the analyzer already publishes. This mutant is the pre-pass-16 state, reproduced GENERICALLY: any `imports`/`exports` edge whose `metadata.moduleOwner` is `package` has its source replaced by `path.basename(metadata.filePath)`. Caught by protobuf/imports-and-editions and protobuf/ancestor-scope-resolution, whose module-edge rows name the package as the source, and by protobuf/module-edge-source-fallback, which pins the other arm so the transform cannot be satisfied by always emitting a basename either.",
    transform: (r: any) => ({
      ...r,
      relationships: rels(r).map((x: any) => {
        const t = x.type ?? x.relationshipType
        if ((t !== "imports" && t !== "exports") || x?.metadata?.moduleOwner !== "package") return x
        const fp = String(x?.metadata?.filePath ?? "")
        const base = fp.split("/").pop()
        if (!base) return x
        const { moduleOwner, ...rest } = x.metadata as any
        return { ...x, source: base, metadata: rest }
      }),
    }),
  },
  {
    id: "protobuf/module-edge-source-the-empty-package",
    language: "protobuf",
    defectClass: "unknown-endpoint",
    description:
      "The same rule read `pkg` without checking it, which is what happens to a file declaring no `package`: 11 of 821 corpus files, carrying 5 of the 1,561 `imports` edges. The edge is published with the EMPTY STRING as its source, which is an endpoint the index cannot hold and the graph cannot walk from. Reverted generically: any `imports`/`exports` edge whose `metadata.moduleOwner` is `basename` — which is exactly the set of edges whose file declared no package — has its source emptied. Caught by protobuf/module-edge-source-fallback, whose fallback row names the basename and whose `forbidRelationships` carries `{type: \"imports\", from: \"\"}` for this shape. No other fixture can catch it: all ten other protobuf fixtures declare a package.",
    transform: (r: any) => ({
      ...r,
      relationships: rels(r).map((x: any) => {
        const t = x.type ?? x.relationshipType
        if ((t !== "imports" && t !== "exports") || x?.metadata?.moduleOwner !== "basename") return x
        const { moduleOwner, ...rest } = x.metadata as any
        return { ...x, source: "", metadata: rest }
      }),
    }),
  },
  {
    id: "protobuf/module-edge-source-loses-which-spelling-it-used",
    language: "protobuf",
    defectClass: "missing-field",
    description:
      "`metadata.moduleOwner` is the only thing that tells a consumer whether an unresolvable module-edge source is a file that declares no package — an external-by-necessity endpoint — or a name the analyzer simply failed to publish. Without it the two are indistinguishable, which is the same confusion this lane separates everywhere else (an external package versus a declaration it failed to publish). Reverted by deleting the key from every edge that carries it. Caught by protobuf/module-edge-source-fallback, which asserts `meta.moduleOwner: \"basename\"` on its fallback row, and by protobuf/imports-and-editions and protobuf/ancestor-scope-resolution, which assert it on the package arm.",
    transform: (r: any) => ({
      ...r,
      relationships: rels(r).map((x: any) => {
        const md = x?.metadata
        if (!md || md.moduleOwner === undefined) return x
        const { moduleOwner, ...rest } = md as any
        return { ...x, metadata: rest }
      }),
    }),
  },

  {
    id: "protobuf/dotted-reference-back-to-the-name-as-written",
    language: "protobuf",
    defectClass: "dangling-endpoint",
    description:
      "A relative DOTTED type name is resolved through the package's ANCESTOR scopes, because protobuf's rule is C++ name lookup over every enclosing scope and not only the package subtree. The pre-fix behaviour was to emit such a name exactly as written, which is the shape of all 431 corpus edges that named an id no file publishes: `resources.scopes.v1.ScopeInfo` where the declaration is `controller.api.resources.scopes.v1.ScopeInfo`. This transform rewrites a target back to the name as written ONLY where the walk moved ALONG a shared ancestor path — the target's package shares a leading segment with the source's own package but is not equal to it, which is the corpus shape and is what makes the transform fire on the row under test and not on the guard's row. Caught by protobuf/ancestor-scope-resolution, which requires the ancestor-resolved id and forbids the name as written as well as the package-prefixed reading. Nothing is dropped, so a transform that emitted no edge at all would fail the same three rows.",
    transform: (r: any) => {
      const declared = new Set<string>(syms(r).map((s: any) => String(s?.metadata?.id)).filter(Boolean))
      const importedDirs = new Set<string>()
      for (const x of rels(r)) {
        if ((x.type ?? x.relationshipType) !== "imports") continue
        const mod = String((x?.metadata as any)?.modulePath ?? x?.target ?? "")
        const cut = mod.lastIndexOf("/")
        importedDirs.add(cut > 0 ? mod.slice(0, cut) : "")
      }
      if (importedDirs.size === 0) return r
      /** The first package segment boundary, or -1 when the two share nothing. */
      const sharedAncestorDepth = (a: string, b: string): number => {
        const as = a.split(".")
        const bs = b.split(".")
        let i = 0
        while (i < as.length && i < bs.length && as[i] === bs[i]) i++
        return i
      }
      return {
        ...r,
        relationships: rels(r).map((x: any) => {
          if ((x.type ?? x.relationshipType) !== "uses") return x
          const tgt = String(x?.target ?? "")
          if (declared.has(tgt)) return x
          const tCut = tgt.lastIndexOf(".")
          if (tCut <= 0) return x
          const targetPkg = tgt.slice(0, tCut)
          if (!importedDirs.has(targetPkg.split(".").join("/"))) return x
          const src = String(x?.source ?? "")
          const sCut = src.lastIndexOf(".")
          if (sCut <= 0) return x
          const sourcePkg = src.slice(0, sCut)
          if (targetPkg === sourcePkg) return x
          // Shares a leading segment but is not the source's own package: the walk
          // went up to a common ancestor and back down into a sibling.
          if (sharedAncestorDepth(targetPkg, sourcePkg) < 2) return x
          return { ...x, target: tgt.slice(tgt.indexOf(".") + 1) }
        }),
      }
    },
  },
  {
    id: "protobuf/ancestor-scope-guard-removed",
    language: "protobuf",
    defectClass: "dangling-endpoint",
    description:
      "The ancestor walk accepts a candidate only when the matched import directory is not a proper SUFFIX of a more specific candidate's directory, and that condition is what a `-I` root ABOVE the package looks like. Dropping it was measured at 7 wrong corpus ids: docker vendors containerd, whose `api/types/platform.proto` declares `package containerd.types;` and is imported as `types/platform.proto`, so a guardless walk answers `types.Platform` where `protoc` answers `containerd.types.Platform`. This transform reproduces the guardless answer for the ONE shape the guard exists for — a reference whose package is a SINGLE segment, so every ancestor candidate is strictly longer and `types` is a proper suffix of all of them — and fires on nothing else. Caught by protobuf/ancestor-scope-resolution alone, and by exactly two of its rows: the `Shifted` requirement (`types.Platform`) goes missing and the innermost-candidate forbid (`corp.api.resources.accounts.v1.types.Platform`) appears instead. Measured rather than described: the walk reaches the MOST SPECIFIC ancestor first, so the id it asserts is that one and not `corp.types.Platform` — which is a second forbid row in the fixture, added so the chain ORDER is pinned independently of the guard. The ancestor-walk row is untouched by this mutant, which is what separates it from the mutant above.",
    transform: (r: any) => {
      const declared = new Set<string>(syms(r).map((s: any) => String(s?.metadata?.id)).filter(Boolean))
      const importedDirs = new Set<string>()
      for (const x of rels(r)) {
        if ((x.type ?? x.relationshipType) !== "imports") continue
        const mod = String((x?.metadata as any)?.modulePath ?? x?.target ?? "")
        const cut = mod.lastIndexOf("/")
        importedDirs.add(cut > 0 ? mod.slice(0, cut) : "")
      }
      if (importedDirs.size === 0) return r
      return {
        ...r,
        relationships: rels(r).map((x: any) => {
          if ((x.type ?? x.relationshipType) !== "uses") return x
          const tgt = String(x?.target ?? "")
          if (declared.has(tgt)) return x
          const tCut = tgt.lastIndexOf(".")
          if (tCut <= 0) return x
          const rootedAt = tgt.slice(0, tCut)
          // A SINGLE-segment package: the shape a shifted `-I` root produces, and
          // the only one on which the guard is decidable without the chain.
          if (rootedAt.includes(".")) return x
          if (!importedDirs.has(rootedAt)) return x
          const src = String(x?.source ?? "")
          const sCut = src.lastIndexOf(".")
          if (sCut <= 0) return x
          const sourcePkg = src.slice(0, sCut)
          const segs = sourcePkg.split(".")
          // The most specific ancestor whose directory ends with the matched one,
          // which is what the guardless walk would have reached.
          for (let i = segs.length - 1; i > 0; i--) {
            const longer = [...segs.slice(0, i), ...rootedAt.split(".")].join("/")
            if (longer.endsWith(rootedAt) && longer !== rootedAt) {
              return { ...x, target: `${segs.slice(0, i).join(".")}.${rootedAt}.${tgt.slice(tCut + 1)}` }
            }
          }
          return x
        }),
      }
    },
  },
  {
    id: "protobuf/extend-block-used-as-the-resolution-scope",
    language: "protobuf",
    defectClass: "dangling-endpoint",
    description:
      "A type written inside an `extend` block is resolved from where the block is WRITTEN, because " +
      "`extend` opens no scope: the extended type is where the block's members GO, not a scope their " +
      "types are looked up in. `Ctx` therefore carries `scope` (the lexical position) separately " +
      "from `owner` (the extended type), and the `extend` case inherits `ctx.scope` unchanged. This " +
      "transform reinstates the single value by re-pointing the SCOPE at the OWNER for every symbol " +
      "whose owner is an extended type — i.e. the pre-fix behaviour — which is exactly the defect " +
      "class: a field inside `extend google.protobuf.FieldOptions` had `google.protobuf.FieldOptions` " +
      "handed to the resolver as its scope, every candidate derived from it fell outside the " +
      "package subtree and was dropped, and a reference to a type nested in the enclosing messages " +
      "resolved to nothing.\n\n" +
      "MEASURED end to end, by two independent instruments and not by argument. Corpus-wide, this " +
      "transform moves 6 of 13,275 `uses` targets and adds and removes no edge. `protoc` 36.2, run " +
      "as an oracle over the corpus (`script/m14/tmp/protobuf/probe/protoc-oracle.py`), reads " +
      "exactly those 6 as disagreements and nothing else: WRONG-NAME 47 before, 42 after, on " +
      "11,250 judged edges, with 5 verdict flips and 0 new ones. Each flip is a case where `protoc` " +
      "names a nested declaration the pre-fix analyzer could not see — " +
      "`proto2_unittest.ComplexOptionType2.ComplexOptionType4`, " +
      "`proto2_unittest.TestExtensionOrderings2.TestExtensionOrderings3`, " +
      "`edition_unittest.TestExtensionOrderings2.TestExtensionOrderings3`, " +
      "`proto2_unittest.TestNestedExtension.OptionalGroup_extension` and " +
      "`edition_unittest.TestNestedExtension.OptionalGroup_extension`. The 6th moved edge is in " +
      "`unittest_delimited.proto`, where `protoc` reports two declarations under one owner-qualified " +
      "name and the oracle records INDISTINCTUISHABLE rather than guessing; read by hand from " +
      "`protoc`'s descriptor it answers `editions_unittest.LengthPrefixed`, which is the post-fix " +
      "emitted name.\n\n" +
      "Caught by protobuf/nested-extend-scope, whose two rows are the two directions: ROW 1 (a block " +
      "nested inside the type it names) loses `nse.demo.Nest.Leaf` and regains the forbidden " +
      "`nse.demo.Leaf`; ROW 2 (a FILE-SCOPE block with two declarations named `Twin`) loses " +
      "`nse.demo.Twin` and regains the forbidden `nse.demo.Dual.Twin`. ROW 2 is what stops this " +
      "mutant from being satisfiable by 'always prefer the innermost declaration', and ROW 3 (an " +
      "ordinary field resolving to the nested type) is the control neither direction may break. " +
      "Ownership is asserted on both extension members, so a transform that moved the resolution " +
      "scope by also moving ownership would fail on a `contains` row rather than pass.",
    transform: (r: any) => {
      // Which ids are EXTENDED TYPES: the source of a `contains` edge carrying
      // `viaExtension`. Read off the analyzer's own output rather than a name list,
      // so editing the fixture cannot silently stop the mutant matching.
      const extendedTypes = new Set<string>()
      for (const x of rels(r)) {
        if ((x.type ?? x.relationshipType) !== "contains") continue
        if (!(x?.metadata as any)?.viaExtension) continue
        extendedTypes.add(String(x.source))
      }
      if (extendedTypes.size === 0) return r

      // Only a TYPE can satisfy a type reference, which is the same restriction the
      // analyzer's own `declaredTypeIds` applies.
      const typeIds = new Set<string>()
      for (const s2 of syms(r)) {
        const k = String(s2?.kind ?? "")
        if (k !== "class" && k !== "enum") continue
        const id = String(s2?.metadata?.id ?? s2?.name ?? "")
        if (id) typeIds.add(id)
      }
      const pkg = syms(r).find((s2: any) => String(s2?.kind ?? "") === "namespace")?.name
      const pkgStr = typeof pkg === "string" ? pkg : ""

      // The pre-fix resolver, reproduced: given the OWNER of the field — which for
      // a member of an `extend` block is the EXTENDED type — walk that owner's scope
      // chain innermost-first for the reference's leaf name, and fall back to the
      // package plus the name as written.
      const preFix = (owner: string, leaf: string): string => {
        const segs = owner.split(".")
        for (let i = segs.length; i > 0; i--) {
          const cand = `${segs.slice(0, i).join(".")}.${leaf}`
          if (typeIds.has(cand)) return cand
        }
        if (pkgStr) {
          const c2 = `${pkgStr}.${leaf}`
          if (typeIds.has(c2)) return c2
        }
        return typeIds.has(leaf) ? leaf : (pkgStr ? `${pkgStr}.${leaf}` : leaf)
      }

      const ownerOf = new Map<string, string>()
      for (const s2 of syms(r)) {
        const id = String(s2?.metadata?.id ?? s2?.name ?? "")
        const owner = s2?.ownerName
        if (id && typeof owner === "string") ownerOf.set(id, owner)
      }

      return {
        ...r,
        relationships: rels(r).map((x: any) => {
          if ((x.type ?? x.relationshipType) !== "uses") return x
          const src = String(x.source)
          const owner = ownerOf.get(src)
          // Only a reference written INSIDE an extend block is affected: that is
          // the set of fields whose owner is an extended type.
          if (!owner || !extendedTypes.has(owner)) return x
          const tgt = String(x.target ?? "")
          const leaf = tgt.includes(".") ? tgt.slice(tgt.lastIndexOf(".") + 1) : tgt
          const next = preFix(owner, leaf)
          return next === tgt ? x : { ...x, target: next }
        }),
      }
    },
  },
  {
    id: "protobuf/qualified-id-stopped-being-published",
    // `language` and `defectClass` were MISSING from this entry, and the mutant had
    // therefore never run. `mutate-analyzer.ts:18869` calls `clean(m.language)` and
    // `runLang(undefined)` throws `TypeError: The "paths[1]" property must be of type
    // string, got undefined` — so the shared F4 gate CRASHES on this mutant rather than
    // passing it, and a crash is not a verdict: every mutant after it in the array goes
    // unrun. Measured at this pass: with `BB_MUTANT_ONLY="protobuf/"` the battery reported
    // 30 CAUGHT and then died on mutant 31 of 34, and 33 of the lane's mutants had
    // reached a verdict while `qualified-id-stopped-being-published` had reached none.
    // Importing the array directly is what made it visible —
    // `PROTOBUF_MUTANTS.filter(m => !m.language).map(m => m.id)` returned exactly this
    // one id — because a crash inside a long run reads as an infrastructure failure
    // rather than as a mutant that cannot be constructed.
    language: "protobuf",
    defectClass: "dangling-endpoint",
    description:
      "The resolved id is published on the symbol through TWO channels — `qualifiedName` (the one " +
      "pool-worker's projection carries into `brain_symbol.qualified_name`, which is the column " +
      "`resolveRelationships` strategy 1 matches a relationship's target against) and " +
      "`metadata.qualifiedName` (the one a fixture can assert, because `run-fixtures.ts`'s " +
      "`CONSTRAINT_KEY_ALLOWLIST` carries no `qualifiedName`). This transform deletes both, " +
      "which is the pre-fix state. It reverts the RULE rather than one line: the two " +
      "assignments are the same value on the two channels a consumer can reach, and reverting " +
      "one alone would be a mutant of a line while the rule stayed published. Measured cost of " +
      "the pre-fix state, end to end through the real indexer and the real store over 40 " +
      "reference `.proto` files (script/m14/tmp/protobuf/probe/store-binding.mts, two runs " +
      "each): 0 of 3,075 analyzer edges were PROVABLY the declaration the edge named, against " +
      "2,977 of 3,075 with it — and `contains` 0 of 2,565 against 2,563, `uses` 0 of 489 " +
      "against 414. A fixture cannot see the store binding, so it pins the published value on " +
      "both channels and the probe carries the store half.",
    transform: (r: any) => ({
      ...r,
      symbols: syms(r).map((s: any) => {
        const { qualifiedName: _droppedQualified, ...rest } = s
        void _droppedQualified
        const m = { ...(s?.metadata ?? {}) }
        delete m.qualifiedName
        return { ...rest, metadata: m }
      }),
    }),
  },
  {
    id: "protobuf/group-type-owned-by-the-extendee",
    language: "protobuf",
    defectClass: "dangling-endpoint",
    description:
      "A proto2 `group` declared inside an `extend` block has its TYPE declared at the BLOCK'S OWN " +
      "SCOPE; only its FIELD belongs to the extendee. `Ctx` carries `scope` (the lexical position) " +
      "separately from `owner` (the extendee), and the group's type takes `scope` while its field " +
      "keeps `owner`. This transform reinstates the single value by re-pointing a group's TYPE at the " +
      "OWNER — the pre-fix behaviour — which is a fabricated declaration: `optional group GroupField " +
      "= 121` written in a file-scope `extend TestAllTypesProto2` in " +
      "`pb-reference/src/google/protobuf/test_messages_proto2.proto` produced a nested type " +
      "`protobuf_test_messages.proto2.TestAllTypesProto2.GroupField`, which `protoc` 36.2's " +
      "descriptor does not contain anywhere. The extension is recorded in the descriptor's top-level " +
      "`extension` list with `type_name = .protobuf_test_messages.proto2.GroupField`, so the type is " +
      "a FILE-SCOPE message and the extendee owns only the field.\n\n" +
      "MEASURED end to end by `protoc`'s descriptor as an oracle over the corpus " +
      "(script/m14/tmp/protobuf/probe/protoc-descriptor-oracle.py, 821 files, 781 compiled), not by " +
      "argument: `contains` agreement 36,017 of 37,042 judged with this mutant against 36,022 of " +
      "37,042 without it, and the oracle's `unexplained` bucket — the rows its stated rules cannot " +
      "account for, which is the number that has to be zero — reads 7 with this mutant and 0 " +
      "without it. The 7 are: the two phantom group TYPES (`…TestAllTypesProto2.GroupField`, " +
      "`proto2_unittest.ComplexOpt6`), the three group MEMBERS published under them, and the two " +
      "extension FIELD rows that cannot be matched because the type they name was never published at " +
      "the scope protoc gives it. 7 corpus `contains` edges move, 0 are added, 0 are removed.\n\n" +
      "Caught by protobuf/group-in-extend-scope, whose three rows are the three directions. ROW 1 " +
      "(a file-scope `extend`) loses `gie.demo.Hoisted` and regains the forbidden " +
      "`gie.demo.Target.Hoisted` groupType row — the corpus defect's shape. ROW 2 (an `extend` " +
      "nested inside a MESSAGE) loses `gie.demo.Outer.Inner` and regains the forbidden " +
      "`gie.demo.Outer.Holder.Inner`, which is what stops the rule being satisfiable by 'always " +
      "hoist to the package' — the companion mutant below is that rule. ROW 3 (a group already " +
      "inside its owner) is the control in the other direction and is byte-identical in both arms. " +
      "The field->type `uses` edge is asserted too, because a transform that moved the type's owner " +
      "while leaving the `uses` target alone would produce one right edge and one wrong one.",
    transform: (r: any) => {
      // A group's TYPE is the symbol carrying `isGroupType`, and the group's FIELD is
      // the property carrying `isGroup`. Both are read off the analyzer's own output
      // rather than a name list, so editing the fixture cannot silently stop this
      // mutant from matching.
      //
      // The transform is the pre-fix rule stated directly: put the TYPE's id in the
      // FIELD's owner. Every edge that named the type is re-pointed through an
      // explicit old->new id map, so the mutant produces a SELF-CONSISTENT wrong
      // graph rather than a broken one — a mutant whose edges dangled would fail
      // every fixture for the wrong reason and prove nothing about this rule.
      const relsOf = (x: any): any[] => (x?.relationships ?? []) as any[]
      const out = syms(r).map((s: any) => ({ ...s, metadata: { ...(s?.metadata ?? {}) } }))
      const idOf = (s: any): string => (s.metadata.id ?? s.qualifiedName) as string

      // oldTypeId -> newTypeId, and the member ids hanging off each type.
      const typeRemap = new Map<string, string>()
      const ownerOf = (id: string): string => id.slice(0, id.lastIndexOf("."))
      for (const typeSym of out) {
        if (!typeSym?.metadata?.isGroupType) continue
        const oldTypeId = idOf(typeSym)
        const fieldSym = out.find(
          (f: any) =>
            f?.metadata?.isGroup === true &&
            f?.name === typeSym.name &&
            ownerOf(idOf(f)) !== oldTypeId.slice(oldTypeId.lastIndexOf(".") + 1),
        )
        // The group's FIELD is the `isGroup` property sharing the type's name whose
        // owner is the EXTENDEE. When the two share an owner (a group not in an
        // `extend`) there is nothing to re-own and this mutant is a no-op, which is
        // correct: the pre-fix rule and the post-fix rule agree there.
        if (!fieldSym) continue
        const fieldOwner = ownerOf(idOf(fieldSym))
        if (fieldOwner === ownerOf(oldTypeId)) continue
        typeRemap.set(oldTypeId, `${fieldOwner}.${typeSym.name}`)
      }
      if (typeRemap.size === 0) return r

      // Members of a moved type move with it: `…Type.member` -> `…newType.member`.
      const remap = (id: string): string => {
        for (const [oldType, newType] of typeRemap) {
          if (id === oldType) return newType
          if (id.startsWith(`${oldType}.`)) return `${newType}${id.slice(oldType.length)}`
        }
        return id
      }
      for (const s of out) {
        const before = idOf(s)
        const after = remap(before)
        if (after === before) continue
        s.metadata.id = after
        s.qualifiedName = after
        if (typeof s.ownerName === "string") s.ownerName = ownerOf(after)
      }
      return {
        ...r,
        symbols: out,
        relationships: relsOf(r).map((e: any) => {
          const source = remap(e.source as string)
          const target = remap(e.target as string)
          return source === e.source && target === e.target ? e : { ...e, source, target }
        }),
      }
    },
  },
  {
    id: "protobuf/group-type-hoisted-to-the-package",
    language: "protobuf",
    defectClass: "dangling-endpoint",
    description:
      "The COMPANION to `protobuf/group-type-owned-by-the-extendee`, and the reason the fixture has " +
      "three rows rather than one. Re-hoisting every group's type to the FILE's package satisfies " +
      "`protobuf/group-type-owned-by-the-extendee`'s corpus evidence — both corpus groups with a " +
      "misplaced type are inside a file-scope `extend` block, so 'always the package' produces the " +
      "same 36,022 of 37,042 and the same `unexplained` 0 on this corpus — and is wrong for a group " +
      "declared inside an `extend` block that is itself nested in a message.\n\n" +
      "protobuf resolves that case to the ENCLOSING MESSAGE's scope. `protoc` 36.2 on " +
      "`validation/m14/fixtures/protobuf/group-in-extend-scope.proto` reports, for an `extend " +
      "Holder` block written inside `message Outer`, the nested message `gie.demo.Outer.Inner` and " +
      "the in-message extension `inner` with `extendee = .gie.demo.Outer.Holder` and " +
      "`type_name = .gie.demo.Outer.Inner` — so hoisting to the package would publish " +
      "`gie.demo.Inner`, which protoc does not define. The corpus contains no such case: measured " +
      "over all 821 files, every one of the 8 groups sits either directly in a message body or in a " +
      "file-scope `extend`, so this defect is INVISIBLE to the corpus oracle and is caught only by " +
      "the fixture. That is the honest reason a fixture exists alongside a corpus oracle, and it is " +
      "stated here because the alternative — quoting the corpus number as though it covered this — " +
      "would be the same mistake in a different place.\n\n" +
      "Caught by protobuf/group-in-extend-scope ROW 2, which loses `gie.demo.Outer.Inner` and " +
      "regains the explicitly forbidden `gie.demo -> gie.demo.Outer.Inner` groupType row. ROW 1 " +
      "(file scope) and ROW 3 (already inside its owner) are unaffected by this mutant, which is " +
      "what makes ROW 2 load-bearing rather than decorative.\n\n" +
      "MEASURED, and this is the number that makes the fixture necessary: the corpus contains 10 " +
      "`groupType` edges, of which 2 sit in a file-scope `extend` block (their type's owner is the " +
      "package), 8 sit directly in a message body (their type's owner is that message), and 0 sit " +
      "in an `extend` block nested inside a message. So this mutant produces the same 36,022 of " +
      "37,042 and the same `unexplained` 0 as the correct analyzer on every file in the corpus, " +
      "while being wrong on every group written in an in-message `extend` block. It is also caught " +
      "by protobuf/extend-and-group, whose groups live in message bodies and are therefore " +
      "over-hoisted by it — so two fixtures catch it and one corpus does not.",
    transform: (r: any) => {
      const rels = (x: any): any[] => (x?.relationships ?? []) as any[]
      const pkg = (r?.metadata ?? {}).protoPackage as string | undefined
      if (!pkg) return r
      const out = syms(r).map((s: any) => ({ ...s, metadata: { ...(s?.metadata ?? {}) } }))
      const idOf = (s: any): string => (s.metadata.id ?? s.qualifiedName) as string
      for (const s of out) {
        if (!s?.metadata?.isGroupType) continue
        const cur = idOf(s)
        const curOwner = cur.slice(0, cur.lastIndexOf("."))
        // Only groups whose owner is NOT already the package, and whose owner is not
        // the group's own enclosing scope. The transform is deliberately crude: it
        // hoists on `isGroupType` alone, which is what makes it a mutant rather than a
        // second implementation of the rule.
        if (curOwner === pkg) continue
        const next = `${pkg}.${s.name}`
        s.ownerName = pkg
        s.metadata.id = next
        s.qualifiedName = next
      }
      const byId = new Map<string, any>()
      for (const s of out) {
        const id = idOf(s)
        byId.set(id, s)
      }
      const remapped = rels(r).map((e: any) => {
        const t = e.target as string
        const s = e.source as string
        let newTarget = t
        for (const sym of out) {
          if (!sym?.metadata?.isGroupType) continue
          const cur = idOf(sym)
          const curOwner = cur.slice(0, cur.lastIndexOf("."))
          if (t === `${curOwner}.${sym.name}` && t !== cur) newTarget = cur
          if (s === `${curOwner}.${sym.name}` && s !== cur) {
            return { ...e, source: cur, target: newTarget }
          }
        }
        return { ...e, source: s, target: newTarget }
      })
      void byId
      return { ...r, symbols: out, relationships: remapped }
    },
  },
  {
    id: "protobuf/dotted-relative-name-package-prefixed",
    language: "protobuf",
    defectClass: "dangling-endpoint",
    description:
      "Prefixes the file's own `package` onto a DOTTED type name whenever the import-directory " +
      "guard declines — the defect the analyzer avoids by construction, reproduced here so the " +
      "refusal has a regression test rather than being an unexamined gap.\n\n" +
      "`resolveViaImports` returns the name AS WRITTEN when no enclosing scope's candidate " +
      "directory is one this file imports, because that is the only honest outcome: the import " +
      "path is relative to an include root the analyzer is never told, so path and package are " +
      "independent and the path is not evidence about any package name. The tempting repair is " +
      "to fall back on the package-relative reading that UNQUALIFIED names already get.\n\n" +
      "Measured over all 842 on-disk corpus files, that fallback would be wrong on every dotted " +
      "name the guard declines, and it is wrong in a way no fixture can miss: it produces a " +
      "fully-qualified-looking id that no file anywhere publishes. `extend " +
      "google.protobuf.MessageOptions` inside `package a` would become " +
      "`a.google.protobuf.MessageOptions`, which the language cannot declare.\n\n" +
      "The corpus shapes it breaks, from script/m14/protobuf-ambiguity-split.mts over 842 files " +
      "and 13,024 `uses` edges: 42 edges on 12 distinct targets whose leaf IS declared under a " +
      "different id — `common.EnterpriseMeta`, `common.RaftIndex`, `common.Locality`, " +
      "`types.Platform`, `types.Metric`, `NodeSpec.Membership`, `connect.IssuedCert`, " +
      "`connect.CARoots`, `config.Config`, `common.QueryMeta`, `status.Status`, " +
      "`NodeSpec.Availability` — plus 4 edges whose leaf is declared nowhere. The transform " +
      "below keys on the analyzer's own `metadata.role: \"fieldType\"`, so it stops matching the " +
      "moment a fixture is edited rather than silently passing.\n\n" +
      "Caught by protobuf/dotted-relative-sibling-package ROW 3, which requires the target to " +
      "stay `resources.scopes.v1.ScopeInfo`; this mutant rewrites it to " +
      "`corp.api.resources.accounts.v1.resources.scopes.v1.ScopeInfo`. Caught also by " +
      "protobuf/ancestor-scope-resolution, whose `resources.scopes.v1.ScopeInfo` and " +
      "`types.Platform` rows are CLIMBS the guard resolves — the mutant leaves those alone, " +
      "which is why one fixture is not enough: the always-declines mutant is caught there and " +
      "this one is caught here.",
    transform: (r: any) => {
      const rels = (x: any): any[] => (x?.relationships ?? []) as any[]
      const pkg = (r?.metadata ?? {}).protoPackage as string | undefined
      if (!pkg) return r
      // Keyed on `role: "fieldType"` rather than on a name from a fixture, so editing a
      // fixture cannot make this stop matching. Two exclusions keep it to ONE defect: an
      // unqualified name (the package-relative reading is already correct for it) and a
      // target that already carries the file's own package (the climb the guard
      // performed). A target the guard CLIMBED is therefore left alone, which is why
      // `protobuf/ancestor-scope-resolution` is not the fixture that catches this and
      // `protobuf/dotted-relative-sibling-package` is.
      const remapped = rels(r).map((e: any) => {
        if ((e.type ?? e.relationshipType) !== "uses") return e
        if (role(e) !== "fieldType") return e
        const t = e.target as string
        if (!t.includes(".")) return e
        if (t.startsWith(`${pkg}.`)) return e
        return { ...e, target: `${pkg}.${t}` }
      })
      return { ...r, relationships: remapped }
    },
  },
]

export default PROTOBUF_MUTANTS
