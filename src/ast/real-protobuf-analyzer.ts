import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

/**
 * REAL PROTOBUF ANALYZER — pure tree-sitter AST extraction against the vendored,
 * patched and pinned `tree-sitter-proto` grammar (snake_case node types:
 * `source_file`, `message`, `enum`, `service`, `rpc`, `field`, `map_field`,
 * `oneof`, `oneof_field`, `enum_field`, `extend`, `import`, `package`, …).
 *
 * The grammar is vendored at `grammars/tree-sitter-proto/` and the node names
 * above are a CONTRACT, not an implementation detail: see that directory's
 * README for the eight patches and the one ruled construct. Three of those
 * patches added grammar fields that this analyzer depends on (`name` on a
 * group, `path` on an import, `value` on an edition), which is why the surface
 * here is a little richer than upstream's.
 *
 * ## Symbol contract (declaration nodes only — usages are relationships)
 *
 *   - `message`               → `class`  (a record type; nested types nest)
 *   - `enum`                  → `enum`
 *   - `service`               → `interface` (a contract of operations)
 *   - `rpc`                   → `method`, owned by its service, with the
 *                                request type as its single `parameter` and
 *                                the response type as its `returnType`
 *   - `field`, `map_field`,
 *     `oneof_field`           → `property`, owned by the enclosing message
 *   - `oneof`                 → `union`, owned by the enclosing message
 *   - `enum_field`            → `enum_member`, owned by the enum
 *   - `package`               → `namespace`
 *   - `syntax`, `edition`     → file metadata, not symbols
 *   - `option`, `reserved`,
 *     `extensions`            → metadata on the file or the owning message
 *
 * ## Relationship ontology
 *
 *   - `contains`  declaration → member. message→field, message→nested type,
 *                 message→oneof, oneof→field, enum→enum_field, service→rpc.
 *   - `uses`      declaration → referenced type. A field's declared type, a
 *                 map value type, a `oneof_field` type, and BOTH of an rpc's
 *                 request and response types. A SCALAR type is not a reference
 *                 and produces no edge.
 *   - `imports`   file → a file it depends on. The source is the importing
 *                 file's own module name (its basename) and the target is the
 *                 path as written, because `protoc` resolves an import against
 *                 `-I` include roots this file is never told. Both endpoints are
 *                 therefore MODULE PATHS rather than symbols, which is the
 *                 family's convention (`real-css-analyzer.ts`,
 *                 `real-dart-analyzer.ts`) and not a protobuf invention.
 *   - `exports`   file → a file it re-exports. `import public "x.proto"` is
 *                 BOTH a dependency and a republication, so it emits BOTH
 *                 edges: the two are separate facts, and pass 1's ruling that
 *                 `exports` alone suffices was overturned in pass 2.
 *   - `overrides` the later declaration of a FIELD SLOT. Protobuf has no
 *                 inheritance and no method to replace, so the only sense of
 *                 `overrides` the language reaches is two declarations in one
 *                 message claiming the same field number. The discriminator is
 *                 the NUMBER: same slot under two names is an override attempt,
 *                 one name across two slots replaces nothing. See `slotClaims`.
 *   - `extends` is deliberately NOT used. Proto's `extend Foo { … }` does not
 *     make the block a subclass of Foo — it adds FIELDS to Foo — so the honest
 *     edge is `Foo -contains-> field` with `metadata.viaExtension = true`, and
 *     the fields carry `ownerName` = the extended type. There is no
 *     inheritance in protobuf and no edge is invented for one.
 *
 * ## Extensions, and where this file stops
 *
 * A proto file splits a type across files with `extend`. An extension's members
 * are members of the EXTENDED type, so they are emitted with `ownerName` =
 * the extended type and `metadata.viaExtension = true` — the same ruling the
 * GraphQL analyzer makes for `extend type`. The block itself emits no symbol
 * of its own: emitting one would be a fabricated type, since the type already
 * has a declaration in the file that owns it.
 *
 * Reference resolution implements protobuf's own rule — a leading dot is
 * absolute, anything else is resolved from the innermost scope outward — but
 * only against the symbols THIS file declares. An unqualified reference to an
 * imported type, and a dotted one whose true owner lives in another file, fall
 * back to `<package>.<name>`. That is a real, declared boundary rather than a
 * silent guess: the resolution is correct within a file and correct for
 * absolute references, and only the cross-file dotted case can land on an
 * unresolved name. Resolution is by construction, not by a hardcoded scalar
 * list: a `type` node that contains a `message_or_enum_type` child is a
 * reference, and one with no named children is a scalar keyword.
 */
export class RealProtobufAnalyzer implements ASTEngine.LanguageAnalyzer {
  analyze(
    rootNode: Node,
    content: string,
    filePath: string,
    _context?: ASTEngine.AnalyzeContext,
  ): Omit<ASTEngine.ParseResult, "language" | "metadata"> & {
    metadata?: Partial<ASTEngine.FileMetadata>
  } {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []

    // ------------------------------------------------------ node plumbing
    const typeCache = new Map<number, string>()
    const idOf = (n: Node): number => (n as unknown as { id?: number }).id ?? -1
    const typeOf = (n: Node): string => {
      const id = idOf(n)
      const hit = typeCache.get(id)
      if (hit !== undefined) return hit
      const t = n.type
      typeCache.set(id, t)
      return t
    }
    /** Named children only. `n.children` includes nulls and anonymous tokens. */
    const kids = (n: Node): Node[] => {
      const out: Node[] = []
      for (const c of n.children) if (c && c.isNamed) out.push(c)
      return out
    }
    const firstOfType = (n: Node, t: string): Node | null => {
      for (const c of kids(n)) if (typeOf(c) === t) return c
      return null
    }
    const lineOf = (n: Node | null): number => (n ? n.startPosition.row + 1 : 0)
    /** A 1-based line for a byte offset, for the two places a range carries no line. */
    const lineOfOf = (startIndex: number): number => {
      let row = 1
      for (let i = 0; i < startIndex && i < content.length; i++) if (content.charCodeAt(i) === 10) row++
      return row
    }

    /**
     * Drop one layer of quoting by SLICING, not by a character-class replace.
     * Protobuf string literals are `"…"` or `'…'` and a bare identifier is not
     * quoted, so the check is a pair of single-character comparisons. A
     * `/["']/g` would be equivalent here and still a regex, and this analyzer
     * carries none — the same bar real-graphql-analyzer.ts holds.
     */
    const unquote = (s: string | undefined | null): string => {
      if (!s || s.length < 2) return s ?? ""
      const a = s[0]
      const b = s[s.length - 1]
      if ((a === '"' || a === "'") && a === b) return s.slice(1, -1)
      return s
    }
    /**
     * The anonymous token immediately before a child, or null.
     *
     * `prevSibling` does not exist on this binding, and the wrapper objects are
     * not identity-stable across `children` reads, so the child is located by
     * its byte span — startIndex/endIndex together are unique per node.
     */
    const prevSiblingOf = (parent: Node, child: Node): Node | null => {
      const all = parent.children
      for (let i = 0; i < all.length; i++) {
        const c = all[i]
        if (c && c.startIndex === child.startIndex && c.endIndex === child.endIndex) {
          return i > 0 ? all[i - 1] : null
        }
      }
      return null
    }

    // ------------------------------------------------------- doc comments
    // A proto doc comment is an own-line `comment` node immediately preceding a
    // declaration. A TRAILING comment (`int32 x = 1; // note`) is excluded by
    // testing that only whitespace precedes it on its own line — a byte scan,
    // not a regex — so it cannot be misattributed to the NEXT declaration.
    // `prevSibling` does not exist on this binding, so this is one pre-pass
    // rather than a backward walk per symbol.
    const docComments = new Map<number, string[]>()
    {
      const lineStarts: number[] = [0]
      for (let i = 0; i < content.length; i++) {
        if (content.charCodeAt(i) === 10) lineStarts.push(i + 1)
      }
      const onOwnLine = (n: Node): boolean => {
        const s = lineStarts[n.startPosition.row]
        if (s === undefined || s > n.startIndex) return true
        for (let i = s; i < n.startIndex; i++) {
          const c = content.charCodeAt(i)
          if (c !== 32 && c !== 9 && c !== 13) return false
        }
        return true
      }
      const stack: Node[] = [rootNode]
      while (stack.length) {
        const n = stack.pop()!
        let pending: string[] = []
        for (const c of n.children) {
          if (!c) continue
          if (typeOf(c) === "comment") {
            if (onOwnLine(c)) pending.push(c.text.trim())
            continue
          }
          if (pending.length && c.isNamed) {
            docComments.set(idOf(c), pending)
            pending = []
          }
          stack.push(c)
        }
      }
    }

    // -------------------------------------------------------------- ranges
    // 1-based, byte offsets. The range starts at the declaration's first
    // non-comment child, so a documented symbol's range points at the line
    // that actually contains its name (M59/#861).
    const nodeToRange = (node: Node): ASTEngine.UniversalSymbol["range"] => {
      let anchor: Node = node
      for (const c of node.children) {
        if (!c) continue
        if (typeOf(c) === "comment") continue
        anchor = c
        break
      }
      return {
        startLine: anchor.startPosition.row + 1,
        startColumn: anchor.startPosition.column + 1,
        endLine: node.endPosition.row + 1,
        endColumn: node.endPosition.column + 1,
        startIndex: anchor.startIndex,
        endIndex: node.endIndex,
      }
    }

    // --------------------------------------------------------- file header
    const fileDecls = kids(rootNode)
    let pkg = ""
    let syntax: string | null = null
    let edition: string | null = null
    const fileOptions: { name: string; value: string; line: number }[] = []
    for (const d of fileDecls) {
      const t = typeOf(d)
      if (t === "package") pkg = firstOfType(d, "full_ident")?.text ?? ""
      else if (t === "syntax") {
        // The value is an ANONYMOUS token whose type IS the quoted value, not a
        // named `string` node, so a named-children lookup returns null and a
        // slice of the node text keeps the `;` (`"proto2;"`). It is read as the
        // token after `=`, which is the only structural anchor available.
        // (An `edition` value IS a named `string` node — the grammar models the
        // two differently, so the two paths cannot be shared.)
        const all = d.children
        let value: string | null = null
        for (let i = 0; i < all.length; i++) {
          const c = all[i]
          if (c && !c.isNamed && c.text === "=") {
            const nxt = all[i + 1]
            if (nxt) value = unquote(nxt.text)
            break
          }
        }
        syntax = value
      } else if (t === "edition") {
        edition =
          unquote(d.childForFieldName("value")?.text) || unquote(firstOfType(d, "string")?.text) || null
      } else if (t === "option") {
        const k = kids(d)
        fileOptions.push({
          name: k[0]?.text ?? "",
          value: k[1]?.text ?? "",
          line: lineOf(d),
        })
      }
    }

    // ------------------------------------------------------------- symbols
    const SymbolKind = ASTEngine.SymbolKind

    /** Dotted identity: `pkg.Outer.Inner`. A file-level decl is `pkg.name`. */
    const qualify = (owner: string | null, name: string): string =>
      owner ? `${owner}.${name}` : name

    const declaredIds = new Set<string>()
    const usedIds = new Set<string>()
    /** The live metadata object of each emitted symbol, keyed by its id. */
    const metaOf = new Map<string, Record<string, any>>()
    /**
     * A symbol id is an `owner.name` string with no kind component, so two
     * same-named symbols in one owner collide. The only construct that
     * LEGITIMATELY does this is a proto2 `group`, which declares a nested type
     * and a field of the same name in the same message — emitting either one
     * alone would misrepresent the language, and emitting both on one id
     * produced a self-loop. `#` cannot occur in a protobuf identifier
     * (identifiers are `[A-Za-z_][A-Za-z0-9_]*`), so `#<kind>` is a
     * disambiguator no real name can forge. Damaged input can collide too — a
     * oneof sharing a field's name is rejected by protoc but not by this
     * grammar — so the guard is general rather than group-specific.
     */
    const uniqueId = (base: string, kind: string): string => {
      if (!usedIds.has(base)) return base
      let n = 0
      let cand = `${base}#${kind}`
      while (usedIds.has(cand)) {
        n++
        cand = `${base}#${kind}${n}`
      }
      return cand
    }
    /**
     * Ids that are IN THE TYPE NAMESPACE, which is what a reference resolves
     * against — deliberately narrower than `declaredIds`.
     *
     * Protobuf resolves a type name through nested scopes, and what lives in
     * those scopes is TYPES: messages and enums. A field is not in that
     * namespace, because a field declares no type. Resolving against every
     * declaration therefore let a FIELD answer a reference to a type, and the
     * shape that triggers it is ordinary protobuf — a field whose name equals
     * the type it names:
     *
     *   message Extra { repeated IPAMStatus IPAMStatus = 1; }
     *
     * The field is published as `pkg.Extra.IPAMStatus` moments before its own
     * `uses` edge is emitted, so the innermost scope candidate matched the
     * field and the edge became `pkg.Extra.IPAMStatus -> pkg.Extra.IPAMStatus`
     * — the field pointing at ITSELF — instead of at the top-level
     * `pkg.IPAMStatus` the specification names.
     *
     * Measured on the corpus: 9 self-edges over 606 files, every one of them
     * this shape — docker/daemon/cluster/convert/netextra/extra.proto:12, and 8
     * in docker/vendor/github.com/moby/buildkit (api/types/worker.proto:13-14,
     * frontend/gateway/pb/gateway.proto:173/193/197, solver/pb/ops.proto:117/120/317).
     * `pb.Definition.Source`, `pb.Mount.SSHOpt` and `pb.Mount.TmpfsOpt` are the
     * same defect reached through the package-relative spelling `pb.X`.
     *
     * A self-edge is the shape a fabricated edge takes when two declarations
     * collide on one id, so this is the defect class the workstream calls the
     * most expensive one available: `bb_graph`, `bb_impact` and `bb_migrate`
     * would each read it as a field whose type is itself.
     */
    const declaredTypeIds = new Set<string>()
    /**
     * Who has claimed each FIELD SLOT, keyed `<owner>\u0000<fieldNumber>` — the
     * same-slot override test's input.
     *
     * Pass 1 ruled `overrides` on a parse-tree count and MEASURED the construct at
     * 1, not 0 — while still calling the type absent. That is the exact defect class
     * `ontology-coverage-gate.ts` exists to catch: its rule is that a ruled type
     * whose construct probe finds a non-zero count is FALSIFIED. A ruling cannot be
     * "the construct occurs once, but that once does not count". So the type is
     * emitted, and this map is what makes the emission a decision rather than a
     * guess.
     *
     * WHAT THE CONSTRUCT IS HERE. Protobuf has no inheritance and no method to
     * replace, so the only sense of `overrides` the language can reach is a SECOND
     * DECLARATION OF A FIELD SLOT: two declarations in one message claiming the same
     * field number, where the later one states what that slot means. That is a fact
     * about the text and it is decidable on the tree, which is the structural
     * standard the rest of this analyzer holds to.
     *
     * The key is the SLOT and not the name, and the distinction is load-bearing:
     *
     *   - same number, either name -> both claim slot N. The second is stating what
     *     slot N holds. That is an override attempt. Both shapes are counted: the
     *     corpus's single site duplicates the name AND the number
     *     (`required string Value = 2; required CustomType Value = 2;`), and a
     *     file may instead re-typify a slot under a fresh name
     *     (`string legacy = 7; int64 modern = 7;`), which is the same claim.
     *   - same name, DIFFERENT number -> two DIFFERENT slots that share a label. The
     *     second replaces nothing; `protoc` rejects the name collision, but no slot
     *     is redefined. Corpus count: 0, and `protobuf/slot-and-grouping` pins the
     *     absence so the rule cannot collapse into "a repeated name is an override".
     *
     * A proto2 `group` is excluded by KIND rather than by a special case: the group
     * declares a nested type `G` (a `class`) and a field `G` of it (a `property`),
     * and only the property claims a slot. `uniqueId` keeps the two ids apart, so the
     * pair cannot read as an override of itself.
     */
    const slotClaims = new Map<string, { id: string; startIndex: number; name: string }>()
    /** `class` is a message or a group's type and `enum` is a type; a service, a
     *  field, a oneof and an rpc are declarations but NOT types, so none of them
     *  may satisfy a type reference. */
    const isTypeDeclaring = (kind: ASTEngine.SymbolKind): boolean =>
      kind === ASTEngine.SymbolKind.Class || kind === ASTEngine.SymbolKind.Enum

    /** Returns the id actually assigned, which is what relationships must use. */
    const addSymbol = (id: string, s: ASTEngine.UniversalSymbol): string => {
      const real = uniqueId(id, String(s.kind))
      const fieldNumber =
        s.metadata && s.metadata.fieldNumber !== undefined
          ? (s.metadata.fieldNumber as string | null)
          : null
      if (s.kind === ASTEngine.SymbolKind.Property && fieldNumber !== null) {
        const slotKey = `${String(s.ownerName ?? "")}\u0000${fieldNumber}`
        const prev = slotClaims.get(slotKey)
        // Direction is DOCUMENT order, read off the range, because the worklist is
        // LIFO: for two sibling fields the declaration added second here is the
        // EARLIER of the two.
        if (prev) {
          const later = (s.range.startIndex ?? 0) > prev.startIndex
          // The edge's LINE is the SOURCE's line, not the line of whichever
          // declaration this call happens to be adding. `line_number` is what
          // `bb_graph` and the store's relId key on, and for a LIFO worklist those
          // are two different declarations. Getting it wrong was measured, not
          // imagined: the first version reported the override of slot 7 at line 26,
          // which is `legacy` — the declaration being OVERRIDDEN.
          const srcStart = later ? s.range.startIndex ?? 0 : prev.startIndex
          if (!collectOnly) {
            addRel(
              later ? real : prev.id,
              later ? prev.id : real,
              RelationshipTypeOverrides,
              lineOfOf(srcStart),
              { role: "fieldSlot", fieldNumber },
            )
          }
        }
        slotClaims.set(slotKey, { id: real, startIndex: s.range.startIndex ?? 0, name: String(s.name) })
      }
      usedIds.add(real)
      declaredIds.add(real)
      if (isTypeDeclaring(s.kind)) declaredTypeIds.add(real)
      if (collectOnly) return real
      // The resolved id is published on the symbol, not just used in
      // relationships. A consumer that re-derives `ownerName + "." + name`
      // reconstructs the WRONG id for a proto2 group, because the group's field
      // and its type share a name — which is how the corpus probe first
      // reported 28 phantom duplicate ids and 48 phantom unresolved endpoints.
      s.metadata = { ...s.metadata, id: real }
      metaOf.set(real, s.metadata)
      symbols.push(s)
      return real
    }
    /**
     * Amend a symbol's metadata AFTER it was emitted.
     *
     * `reserved` and `extensions` are read while walking a message's body, by
     * which point the message symbol already exists and is already in the
     * `symbols` array. Mutating the object the symbol holds is correct here and
     * is why `addSymbol` records the live metadata object rather than a copy.
     */
    const ownerMeta = (id: string, fn: (m: Record<string, any>) => void): void => {
      const m = metaOf.get(id)
      if (m) fn(m)
    }
    /** File-scope `reserved`/`extensions`, which have no owning message. */
    const fileRanges: { kind: string; range?: string; name?: string }[] = []
    /**
     * Phase 1 of the walk records DECLARATIONS only; phase 2 records facts.
     * `collectOnly` is what makes the two phases share one code path, so the id
     * a type gets in phase 1 is by construction the id it gets in phase 2.
     */
    let collectOnly = false

    /**
     * The evidence tier of an edge, in the vocabulary the graph panel reads
     * (`structural` / `import_based` / `usage_contextual` / `reference_qualified`
     * / `inferred`).
     *
     * Every edge this analyzer emits is read off the parse tree — a declaration
     * node, a named child, an anonymous sibling token, a position — so
     * `contains`, `uses` and `exports` are `structural` and an import is
     * `import_based`, which is what the C analyzer assigns the same two shapes.
     *
     * The lane previously set NO tier at all: measured over the corpus,
     * 40,562 of 40,562 production edges carried no `evidenceClass`, so the
     * honesty contract's requirement that a heuristic be COUNTABLE had nothing
     * to count and the graph panel had to fall back to inferring a tier from the
     * confidence value. Nothing here is inferred from confidence — that is the
     * point of writing it down where the derivation is a fact about the tree.
     */
    const evidenceClassFor = (type: ASTEngine.RelationshipType): string => {
      if (type === ASTEngine.RelationshipType.Imports) return "import_based"
      if (type === ASTEngine.RelationshipType.Exports) return "structural"
      return "structural"
    }

    const addRel = (
      source: string,
      target: string,
      type: ASTEngine.RelationshipType,
      line: number,
      metadata: Record<string, unknown> = {},
    ): void => {
      if (collectOnly) return
      relationships.push({
        source,
        target,
        type,
        relationshipType: type,
        line_number: line,
        confidence: 1.0,
        metadata: { evidenceClass: evidenceClassFor(type), ...metadata },
      })
    }

    /**
     * protobuf name resolution, restricted to this file (see the header).
     *
     * The specification's rule: a leading dot is absolute, anything else is
     * resolved from the innermost enclosing scope outward. The scope chain is
     * therefore walked from the owner down to the package and then to the root,
     * and the first candidate this file actually DECLARED wins. An earlier
     * version concatenated the scope segments with the package segments and
     * compared only the last segment, so `User` referenced from
     * `demo.v1.Auth` resolved to `demo.v1.Auth.demo.v1.User` — a name that
     * exists in no file. Comparing whole ids is what makes the walk terminate
     * on the right answer.
     */
    const resolveRef = (text: string, scope: string | null): string => {
      if (text.startsWith(".")) return text.slice(1)
      const chain: (string | null)[] = []
      if (scope) {
        const segs = scope.split(".")
        for (let i = segs.length; i > 0; i--) {
          const cand = segs.slice(0, i).join(".")
          if (!pkg || cand === pkg || cand.startsWith(pkg + ".")) chain.push(cand)
        }
      }
      if (pkg) chain.push(pkg)
      chain.push(null)
      for (const base of chain) {
        const cand = base ? `${base}.${text}` : text
        // `declaredTypeIds`, not `declaredIds`: only a TYPE can satisfy a type
        // reference. A field is a declaration but not a type, so admitting one
        // here let a field named after its own type resolve to ITSELF — the
        // 9 self-edges measured in `declaredTypeIds`'s comment. The candidate
        // `declaredTypeIds` rejects is exactly the field the walk just
        // published, and the walk then continues outward to the real type.
        if (declaredTypeIds.has(cand)) return cand
      }
      // Not declared in this file. The two cases differ, and the difference is
      // measured rather than guessed: an UNQUALIFIED name resolves within the
      // package by specification, so `pkg.name` is right for a type imported
      // from elsewhere. A DOTTED name is written fully qualified in practice —
      // `extend google.protobuf.MessageOptions` inside `package a` means the
      // GLOBAL `google.protobuf.MessageOptions`, and prefixing the package
      // produced `a.google.protobuf.MessageOptions`, a name that exists in no
      // file. So a dotted name falls back as written.
      if (text.includes(".")) return text
      return qualify(pkg || null, text)
    }

    /** A `type` node is a reference iff it holds a `message_or_enum_type`. */
    const refTypeOf = (typeNode: Node | null): string | null => {
      if (!typeNode) return null
      const inner = firstOfType(typeNode, "message_or_enum_type")
      return inner ? inner.text : null
    }

    const addFieldLike = (
      node: Node,
      nameNode: Node,
      ctx: Ctx,
      extra: Record<string, unknown>,
    ): string | null => {
      const name = nameNode.text
      if (!name) return null
      const meta: Record<string, unknown> = { ...extra }
      if (ctx.oneof) meta.oneof = ctx.oneof
      if (ctx.viaExtension) meta.viaExtension = true
      const id = addSymbol(qualify(ctx.owner, name), {
        name,
        kind: SymbolKind.Property,
        range: nodeToRange(node),
        ownerName: ctx.owner ?? undefined,
        ownerKind: ctx.ownerKind ?? undefined,
        metadata: meta,
      })
      if (ctx.owner) {
        addRel(ctx.owner, id, RelationshipTypeContains, lineOf(node), {
          member: "field",
          // `viaExtension` on the EDGE as well as on the symbol. It was on the
          // symbol only, so a consumer reading `google.protobuf.MessageOptions
          // -contains-> audit_ticket` could not tell an extension field added in
          // another file from a field declared in the message's own body — and the
          // header's claim that the edge carries it was false. Measured over the
          // corpus before this change: 0 of the extension-derived `contains` edges
          // carried `viaExtension`, because `addFieldLike` set it on the symbol's
          // metadata object and the `addRel` call passed only `member`.
          ...(ctx.viaExtension ? { viaExtension: true } : {}),
        })
      }
      return id
    }

    // ------------------------------------------------------------- the walk
    // Explicit stack, never recursion: a proto file can nest messages to any
    // depth and the reference corpus contains 8-level nestings, so a recursive
    // descent would be a stack-overflow waiting for a hostile file.
    type Ctx = {
      pkg: string
      owner: string | null
      ownerKind: ASTEngine.SymbolKind | null
      oneof: string | null
      viaExtension: boolean
    }
    const RelationshipTypeContains = ASTEngine.RelationshipType.Contains
    const RelationshipTypeUses = ASTEngine.RelationshipType.Uses
    const RelationshipTypeImports = ASTEngine.RelationshipType.Imports
    const RelationshipTypeExports = ASTEngine.RelationshipType.Exports
    const RelationshipTypeOverrides = ASTEngine.RelationshipType.Overrides

    const emitField = (node: Node, ctx: Ctx): void => {
      const typeNode = firstOfType(node, "type")
      const body = firstOfType(node, "message_body")
      const numNode = firstOfType(node, "field_number")
      const label = (node.children ?? [])
        .filter((c) => c && !c.isNamed)
        .map((c) => c!.text)
        .find((t) => t === "optional" || t === "required" || t === "repeated")

      // A proto2 `group` is a field whose type is a nested message written
      // inline: the grammar gives it NO `type` child and a `message_body`
      // instead. It declares BOTH a type and a field, so it emits both, with
      // distinct kinds (the store does not collapse by name).
      if (!typeNode && body) {
        const gname = node.childForFieldName("name")?.text ?? firstOfType(node, "identifier")?.text
        if (gname) {
          // Two symbols, two ids: the type takes the plain dotted id and the
          // field is disambiguated by `uniqueId`, so the `uses` edge below
          // points field→type instead of looping a symbol onto itself.
          const typeId = addSymbol(qualify(ctx.owner, gname), {
            name: gname,
            kind: SymbolKind.Class,
            range: nodeToRange(node),
            ownerName: ctx.owner ?? undefined,
            ownerKind: ctx.ownerKind ?? undefined,
            metadata: { isGroupType: true, ...(ctx.viaExtension ? { viaExtension: true } : {}) },
          })
          if (ctx.owner) addRel(ctx.owner, typeId, RelationshipTypeContains, lineOf(node), { member: "groupType", ...(ctx.viaExtension ? { viaExtension: true } : {}) })
          const fieldId = addSymbol(qualify(ctx.owner, gname), {
            name: gname,
            kind: SymbolKind.Property,
            range: nodeToRange(node),
            ownerName: ctx.owner ?? undefined,
            ownerKind: ctx.ownerKind ?? undefined,
            metadata: {
              type: gname,
              isGroup: true,
              fieldNumber: numNode?.text ?? null,
              ...(label ? { label } : {}),
              ...(ctx.viaExtension ? { viaExtension: true } : {}),
            },
          })
          if (ctx.owner) addRel(ctx.owner, fieldId, RelationshipTypeContains, lineOf(node), { member: "field", ...(ctx.viaExtension ? { viaExtension: true } : {}) })
          addRel(fieldId, typeId, RelationshipTypeUses, lineOf(node), { role: "groupType" })
          // the group's own body
          const inner: Ctx = { ...ctx, owner: typeId, ownerKind: SymbolKind.Class, oneof: null }
          pushAll(kids(body), inner)
          return
        }
      }

      const nameNode = firstOfType(node, "identifier")
      if (!nameNode) return
      const ref = refTypeOf(typeNode)
      const fieldId = addFieldLike(node, nameNode, ctx, {
        type: ref ?? typeNode?.text ?? null,
        ...(ref ? {} : { scalar: true }),
        fieldNumber: numNode?.text ?? null,
        ...(label ? { label } : {}),
      })
      if (fieldId && ref) {
        addRel(fieldId, resolveRef(ref, ctx.owner), RelationshipTypeUses, lineOf(node), { role: "fieldType" })
      }
    }

    const emitMapField = (node: Node, ctx: Ctx): void => {
      const nameNode = firstOfType(node, "identifier")
      if (!nameNode) return
      const keyNode = firstOfType(node, "key_type")
      const valType = firstOfType(node, "type")
      const valRef = refTypeOf(valType)
      const numNode = firstOfType(node, "field_number")
      const fieldId = addFieldLike(node, nameNode, ctx, {
        isMap: true,
        mapKey: keyNode?.text ?? null,
        mapValue: valRef ?? valType?.text ?? null,
        ...(valRef ? {} : { valueIsScalar: true }),
        fieldNumber: numNode?.text ?? null,
      })
      if (fieldId && valRef) {
        addRel(fieldId, resolveRef(valRef, ctx.owner), RelationshipTypeUses, lineOf(node), {
          role: "mapValueType",
        })
      }
    }

    const emitOneofField = (node: Node, ctx: Ctx): void => {
      const nameNode = firstOfType(node, "identifier")
      if (!nameNode) return
      const typeNode = firstOfType(node, "type")
      const ref = refTypeOf(typeNode)
      const fieldId = addFieldLike(node, nameNode, ctx, {
        type: ref ?? typeNode?.text ?? null,
        ...(ref ? {} : { scalar: true }),
        fieldNumber: firstOfType(node, "field_number")?.text ?? null,
      })
      if (fieldId && ref) {
        addRel(fieldId, resolveRef(ref, ctx.owner), RelationshipTypeUses, lineOf(node), { role: "oneofFieldType" })
      }
    }

    const emitEnumField = (node: Node, ctx: Ctx): void => {
      const nameNode = firstOfType(node, "identifier")
      if (!nameNode) return
      const name = nameNode.text
      const id = addSymbol(qualify(ctx.owner, name), {
        name,
        kind: SymbolKind.EnumMember,
        range: nodeToRange(node),
        ownerName: ctx.owner ?? undefined,
        ownerKind: SymbolKind.Enum,
        metadata: {
          value: firstOfType(node, "int_lit")?.text ?? null,
          ...(ctx.viaExtension ? { viaExtension: true } : {}),
        },
      })
      if (ctx.owner) addRel(ctx.owner, id, RelationshipTypeContains, lineOf(node), { member: "enumValue", ...(ctx.viaExtension ? { viaExtension: true } : {}) })
    }

    const emitRpc = (node: Node, ctx: Ctx): void => {
      const nameNode = firstOfType(node, "rpc_name")
      if (!nameNode) return
      const name = nameNode.text
      // The grammar gives an rpc's request and response the SAME node type,
      // `message_or_enum_type`, with no distinguishing wrapper or field name.
      // They are told apart by position only: the first is the request, the
      // second the response. Ruled alternative: matching on the `returns`
      // keyword would need the anonymous token's index, and positional order
      // is what the grammar itself guarantees.
      const types = kids(node).filter((c) => typeOf(c) === "message_or_enum_type")
      const request = types[0]?.text ?? null
      const response = types[1]?.text ?? null
      // `stream` is an anonymous sibling IMMEDIATELY BEFORE the type it
      // qualifies, so streaming is read off the tree rather than matched out
      // of the node text. An earlier version tested the text for `(stream`,
      // which is a regex AND gets it wrong on `option (x) = "stream(1)"`.
      const isStreaming = (t: Node | undefined): boolean => {
        if (!t) return false
        const p = prevSiblingOf(node, t)
        return !!p && !p.isNamed && p.text === "stream"
      }
      const clientStreaming = isStreaming(types[0])
      const serverStreaming = isStreaming(types[1])
      const id = addSymbol(qualify(ctx.owner, name), {
        name,
        kind: SymbolKind.Method,
        range: nodeToRange(node),
        ownerName: ctx.owner ?? undefined,
        ownerKind: SymbolKind.Interface,
        ...(request ? { parameters: [{ name: "request", type: request }] } : {}),
        ...(response ? { returnType: response } : {}),
        metadata: {
          ...(request ? { requestType: request } : {}),
          ...(response ? { responseType: response } : {}),
          clientStreaming,
          serverStreaming,
        },
      })
      if (ctx.owner) addRel(ctx.owner, id, RelationshipTypeContains, lineOf(node), { member: "rpc", ...(ctx.viaExtension ? { viaExtension: true } : {}) })
      if (request) addRel(id, resolveRef(request, ctx.owner), RelationshipTypeUses, lineOf(node), { role: "rpcRequest" })
      if (response) addRel(id, resolveRef(response, ctx.owner), RelationshipTypeUses, lineOf(node), { role: "rpcResponse" })
    }

    /**
     * The worklist. This walk is ITERATIVE and must stay that way.
     *
     * An earlier version of this comment already said so while the code called
     * `visit` from `visit` — a recursive descent wearing an iterative comment.
     * The robustness gate caught it the only way it could be caught: a
     * 5,000-level message nest overflowed Node's stack and took the process
     * down. Nesting depth is not a theoretical input for a schema language, and
     * an indexer that crashes on a deeply nested file is a denial of service on
     * any repository that contains one.
     */
    const stack: { node: Node; ctx: Ctx }[] = []
    const pushAll = (children: Node[], ctx: Ctx): void => {
      for (const c of children) stack.push({ node: c, ctx })
    }
    // `visit` handles ONE node and enqueues its children; it never descends.
    const visit = (node: Node, ctx: Ctx): void => {
      switch (typeOf(node)) {
        case "message": {
          const nameNode = firstOfType(node, "message_name")
          if (!nameNode) return
          const name = nameNode.text
          const id = addSymbol(qualify(ctx.owner, name), {
            name,
            kind: SymbolKind.Class,
            range: nodeToRange(node),
            ...(docComments.has(idOf(node)) ? { comments: docComments.get(idOf(node)) } : {}),
            ownerName: ctx.owner ?? undefined,
            ownerKind: ctx.ownerKind ?? undefined,
            metadata: { isMessage: true, ...(ctx.viaExtension ? { viaExtension: true } : {}) },
          })
          if (ctx.owner) addRel(ctx.owner, id, RelationshipTypeContains, lineOf(node), { member: "nestedType", ...(ctx.viaExtension ? { viaExtension: true } : {}) })
          const body = firstOfType(node, "message_body")
          if (body) {
            const inner: Ctx = { ...ctx, owner: id, ownerKind: SymbolKind.Class, oneof: null }
            pushAll(kids(body), inner)
          }
          return
        }
        case "enum": {
          const nameNode = firstOfType(node, "enum_name")
          if (!nameNode) return
          const name = nameNode.text
          const id = addSymbol(qualify(ctx.owner, name), {
            name,
            kind: SymbolKind.Enum,
            range: nodeToRange(node),
            ...(docComments.has(idOf(node)) ? { comments: docComments.get(idOf(node)) } : {}),
            ownerName: ctx.owner ?? undefined,
            ownerKind: ctx.ownerKind ?? undefined,
            metadata: { isEnum: true, ...(ctx.viaExtension ? { viaExtension: true } : {}) },
          })
          if (ctx.owner) addRel(ctx.owner, id, RelationshipTypeContains, lineOf(node), { member: "nestedType", ...(ctx.viaExtension ? { viaExtension: true } : {}) })
          const body = firstOfType(node, "enum_body")
          if (body) {
            const inner: Ctx = { ...ctx, owner: id, ownerKind: SymbolKind.Enum, oneof: null }
            pushAll(kids(body), inner)
          }
          return
        }
        case "service": {
          const nameNode = firstOfType(node, "service_name")
          if (!nameNode) return
          const name = nameNode.text
          const id = addSymbol(qualify(ctx.owner, name), {
            name,
            kind: SymbolKind.Interface,
            range: nodeToRange(node),
            ...(docComments.has(idOf(node)) ? { comments: docComments.get(idOf(node)) } : {}),
            ownerName: ctx.owner ?? undefined,
            ownerKind: ctx.ownerKind ?? undefined,
            metadata: { isService: true, ...(ctx.viaExtension ? { viaExtension: true } : {}) },
          })
          if (ctx.owner) addRel(ctx.owner, id, RelationshipTypeContains, lineOf(node), { member: "nestedType", ...(ctx.viaExtension ? { viaExtension: true } : {}) })
          const inner: Ctx = { ...ctx, owner: id, ownerKind: SymbolKind.Interface, oneof: null }
          pushAll(
            kids(node).filter((c) => typeOf(c) !== "service_name"),
            inner,
          )
          return
        }
        case "extend": {
          // `extend Foo { … }` adds the block's members to Foo. No symbol for
          // the block: the type already has a declaration in its own file, and
          // a second one here would be a phantom.
          const target = firstOfType(node, "full_ident")?.text ?? firstOfType(node, "message_or_enum_type")?.text
          const body = firstOfType(node, "message_body")
          if (!target || !body) return
          const resolved = resolveRef(target, ctx.owner)
          const inner: Ctx = {
            ...ctx,
            owner: resolved,
            ownerKind: SymbolKind.Class,
            oneof: null,
            viaExtension: true,
          }
          pushAll(kids(body), inner)
          return
        }
        case "oneof": {
          // The grammar gives a oneof's name as a BARE `identifier` child, with
          // no wrapper node, so it is read positionally among the named kids.
          const kn = kids(node)
          const nameNode = kn.find((c) => typeOf(c) === "identifier")
          if (!nameNode) return
          const name = nameNode.text
          const id = addSymbol(qualify(ctx.owner, name), {
            name,
            kind: SymbolKind.Union,
            range: nodeToRange(node),
            ...(docComments.has(idOf(node)) ? { comments: docComments.get(idOf(node)) } : {}),
            ownerName: ctx.owner ?? undefined,
            ownerKind: ctx.ownerKind ?? undefined,
            metadata: { isOneof: true },
          })
          if (ctx.owner) addRel(ctx.owner, id, RelationshipTypeContains, lineOf(node), { member: "oneof", ...(ctx.viaExtension ? { viaExtension: true } : {}) })
          // Fields inside a oneof are members of the MESSAGE, not of the oneof:
          // the field number lives in the message's own space and
          // `msg.field` is how every protobuf tool refers to them, so
          // reassigning ownership to the oneof would be wrong.
          //
          // The oneof therefore emits exactly ONE edge — the message contains
          // the oneof — and there is deliberately NO edge from the oneof to its
          // fields. An earlier version of this comment claimed one, and the
          // comment was wrong: the code never emitted it. That was caught by
          // writing the m14 fixture lane, which asserts the absence as a
          // `forbidRelationship` rather than leaving the claim to be believed.
          //
          // The reason it is right to leave it out: membership and grouping are
          // different relations, and a second `contains` edge would make one
          // edge type mean both. The grouping is carried as `metadata.oneof` on
          // each field, which is queryable and cannot be confused with
          // ownership.
          //
          // `metadata.oneof` is the oneof's RESOLVED ID, not its bare name. It
          // was the bare `name`, and a bare name cannot address a oneof: two
          // messages in one file may each declare `oneof attrs`, and a consumer
          // grouping fields by that string merges them. Measured over the corpus
          // before this change: 423 of 1,121 oneof fields (37.73%) sat under a
          // bare name declared by more than one owner — `oneof attrs` in 7
          // different messages of boundary's session_recording.proto alone. The
          // resolved id is unique within the file, which is the scope a consumer
          // can actually group in, and it is what the `contains` edge into the
          // oneof already uses.
          const inner: Ctx = { ...ctx, oneof: id }
          pushAll(kids(node), inner)
          return
        }
        case "reserved":
        case "extensions": {
          // The number ranges a message reserves, and the extension ranges it
          // opens. Both are facts about the SCHEMA, not about any declaration:
          // a reserved number records a deleted field (which is what makes a
          // migration audit possible) and an extension range records where other
          // files may add members. They are attached to the owning message's
          // metadata, because that is the scope the specification gives them —
          // they belong to the message, and `reserved` also appears at file
          // scope, where there is no owner and they go to the file.
          const what = typeOf(node) === "reserved" ? "reserved" : "extensions"
          const ranges = kids(node)
            .filter((c) => typeOf(c) === "ranges")
            .flatMap((r) => kids(r).filter((c) => typeOf(c) === "range").map((c) => c.text))
          const names = kids(node)
            .filter((c) => typeOf(c) === "field_names")
            .flatMap((f) => kids(f).map((c) => unquote(c.text)))
          if (ctx.owner) ownerMeta(ctx.owner, (m) => {
            const list = (m[what] as any[]) ?? []
            list.push(...(ranges.length ? ranges.map((t) => ({ range: t })) : names.map((t) => ({ name: t }))))
            m[what] = list
          })
          else
            fileRanges.push(
              ...(ranges.length ? ranges.map((t) => ({ kind: what, range: t })) : names.map((t) => ({ kind: what, name: t }))),
            )
          return
        }
        case "field":
          emitField(node, ctx)
          return
        case "map_field":
          emitMapField(node, ctx)
          return
        case "oneof_field":
          emitOneofField(node, ctx)
          return
        case "enum_field":
          emitEnumField(node, ctx)
          return
        case "rpc":
          emitRpc(node, ctx)
          return
        default:
          return
      }
    }
    const root: Ctx = { pkg, owner: pkg || null, ownerKind: null, oneof: null, viaExtension: false }
    // Seed the worklist with the file's own declarations, then DRAIN it. The
    // import/package handling below is folded into the same loop so there is one
    // driver and one dispatch path.
    const drain = (): void => {
      while (stack.length) {
      const item = stack.pop()!
      const d = item.node
      const t = typeOf(d)
      if (t === "import") {
        const raw = d.childForFieldName("path")?.text ?? firstOfType(d, "string")?.text ?? ""
        const path = unquote(raw)
        // The modifier is read off the ANONYMOUS TOKEN child, not by matching
        // the node's text for an "import public" prefix. The prefix form was a
        // parser in disguise: it decided a structural fact (is this a public
        // re-export?) by string-matching a whole declaration, which is the exact
        // thing the no-text-scan gate exists to catch, and it would misfire on
        // any future grammar change to the import rule.
        let modifier: "public" | "weak" | "option" | null = null
        for (const c of d.children) {
          if (!c || c.isNamed) continue
          if (c.text === "public" || c.text === "weak" || c.text === "option") {
            modifier = c.text
            break
          }
        }
        if (!collectOnly) {
          imports.push({
            module: path,
            path,
            items: [],
            isDefaultImport: false,
            isNamespaceImport: false,
            range: nodeToRange(d),
            metadata: { ...(modifier ? { modifier } : {}) },
          })
          // `imports` and `exports` — the two relationship types this lane was
          // missing, and both were missing while the CONSTRUCT was everywhere.
          //
          // Measured on 606 corpus files before this change: 1,117 `import`
          // nodes in 392 files, recorded into `result.imports` and emitted as NO
          // edge at all; and 4 `import public` nodes in 4 files. A dependency
          // graph for a schema language that cannot answer "which file does this
          // type come from" is missing the one edge a consumer needs most, and
          // its absence is invisible to a differential because the oracle was
          // written after the same ruling.
          //
          // The ENDPOINTS are module paths, not local symbols, and that is the
          // family's convention rather than a protobuf invention: the CSS
          // analyzer imports from `importerName` onto the imported stylesheet's
          // name, Dart from the library name, and the store records an edge whose
          // endpoint is not a symbol of the file as `source_external` / an
          // external target. protoc resolves `import "a/b.proto"` against -I
          // include roots the analyzer is never told, so the path AS WRITTEN is
          // the most faithful name available; the file's own module name is its
          // basename for the same reason CSS uses one, with the full path kept in
          // metadata so a consumer that knows the include root can do better.
          if (path) {
            // The SOURCE is the importing file's own module name and the TARGET
            // is the path as written. Taking the basename of the IMPORTED path
            // for the source instead — which a first draft did — makes a file
            // appear to import ITSELF: `import public "common/v1/types.proto"`
            // became `types.proto -> common/v1/types.proto`, an edge whose two
            // endpoints name the same module and which `bb_graph` would read as a
            // self-dependency. CSS's `importerName` is the importing file for the
            // same reason.
            const selfMod = filePath.split("/").pop() || filePath
            const moduleMeta = { modulePath: path, filePath }
            if (modifier === "public") {
              // `import public` is BOTH, and this was wrong in pass 1.
              //
              // Pass 1 emitted `exports` alone and pinned the absence of `imports`
              // with a `forbidRelationships` row whose stated reason was that
              // emitting both "would double the module's inbound dependency and lose
              // the re-export fact entirely". Neither half survives measurement:
              // nothing is doubled, because the pair went from ZERO `imports` edges
              // to one, and the re-export fact is not lost, it is what `exports`
              // carries. What IS lost by emitting `exports` alone is the dependency
              // itself: a consumer asking "which files must I read to compile this"
              // gets an incomplete answer, and `bb_impact` on the imported file
              // cannot see a file that depends on it through a public import.
              //
              // Measured on the corpus: 4 `import public` sites in 4 files, all in
              // pb-reference (cpp_options.proto:15, json_options.proto:14,
              // unittest_import.proto, unittest_import_lite.proto). Every other
              // language in this family that has a re-export emits both edges —
              // ES modules' `export … from`, and TypeScript's, which the
              // typescript-oracle file in script/m14/oracles/ checks as a pair.
              // protoc agrees: a `public` import is a `FileDescriptorProto`
              // dependency like any other, with `public_dependency` naming its
              // index. The dependency is a fact; republication is a second fact.
              addRel(selfMod, path, RelationshipTypeExports, lineOf(d), {
                ...moduleMeta,
                viaPublicImport: true,
              })
              addRel(selfMod, path, RelationshipTypeImports, lineOf(d), {
                ...moduleMeta,
                ...(modifier ? { modifier } : {}),
                viaPublicImport: true,
              })
            } else {
              addRel(selfMod, path, RelationshipTypeImports, lineOf(d), {
                ...moduleMeta,
                ...(modifier ? { modifier } : {}),
                // The editions FEATURE import resolves an option's definition
                // rather than a message, which is why it is not a re-export even
                // though it names a file this one depends on.
                ...(modifier === "option" ? { isFeatureImport: true } : {}),
              })
            }
          }
        }
        continue
      }
      if (t === "package") {
        addSymbol(pkg, {
          name: pkg,
          kind: SymbolKind.Namespace,
          range: nodeToRange(d),
          metadata: { isProtoPackage: true },
        })
        continue
      }
      visit(d, item.ctx)
      }
    }

    /**
     * Two passes over the same walk, and the second is the one that publishes.
     *
     * Name resolution consults `declaredIds`, so in a single pass a field could
     * only resolve a type the walk had already reached. Protobuf permits a
     * forward reference — a field may name a message declared further down the
     * file — and a LIFO worklist makes the order neither document order nor
     * anything else a reader could reason about. The regression is measured, not
     * imagined: converting the recursive walk to an explicit stack turned
     * `n.Outer.i -> n.Outer.Inner` into `n.Outer.i -> n.Inner`, because `Inner`
     * was popped after `i`.
     *
     * So the declarations are collected first, over the identical traversal, and
     * only then are the facts emitted. Resolution is then independent of visit
     * order, which is the property the language actually has.
     */
    collectOnly = true
    pushAll(fileDecls, root)
    drain()
    collectOnly = false
    // `uniqueId` must start from a clean slate, or phase 2 would find phase 1's
    // ids already taken and disambiguate every symbol a second time. But
    // `declaredIds` is exactly what phase 1 was FOR: clearing it before phase 2
    // threw away the pre-pass and left resolution dependent on visit order all
    // over again.
    usedIds.clear()
    metaOf.clear()
    slotClaims.clear()
    fileRanges.length = 0
    stack.length = 0
    pushAll(fileDecls, root)
    drain()

    // ----------------------------------------------------------------- done
    return {
      symbols,
      relationships,
      imports,
      metadata: {
        ...(syntax ? { syntax } : {}),
        ...(edition ? { edition } : {}),
        ...(pkg ? { protoPackage: pkg } : {}),
        ...(fileOptions.length ? { fileOptions } : {}),
        ...(fileRanges.length ? { fileRanges } : {}),
        // A COUNTED work measure, not a duration. `typeCache.size` is the number
        // of distinct nodes the walk actually read, which is what a linearity
        // claim needs: it is deterministic and load-independent, where a wall
        // clock on a shared machine moved this lane's own ratio between 0.94 and
        // 2.05 across runs of identical code, and exceeded its bound only when
        // other lanes were running. A gate whose verdict depends on what else the
        // machine is doing is not a gate.
        visitedNodes: typeCache.size,
        filePath,
        symbolCount: symbols.length,
        relationshipCount: relationships.length,
      },
    }
  }
}
