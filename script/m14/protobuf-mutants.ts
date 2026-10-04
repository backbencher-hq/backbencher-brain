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
]

export default PROTOBUF_MUTANTS
