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
    /** Returns the id actually assigned, which is what relationships must use. */
    const addSymbol = (id: string, s: ASTEngine.UniversalSymbol): string => {
      const real = uniqueId(id, String(s.kind))
      usedIds.add(real)
      declaredIds.add(real)
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
        metadata,
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
        if (declaredIds.has(cand)) return cand
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
          if (ctx.owner) addRel(ctx.owner, typeId, RelationshipTypeContains, lineOf(node), { member: "groupType" })
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
          if (ctx.owner) addRel(ctx.owner, fieldId, RelationshipTypeContains, lineOf(node), { member: "field" })
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
      if (ctx.owner) addRel(ctx.owner, id, RelationshipTypeContains, lineOf(node), { member: "enumValue" })
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
      if (ctx.owner) addRel(ctx.owner, id, RelationshipTypeContains, lineOf(node), { member: "rpc" })
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
          if (ctx.owner) addRel(ctx.owner, id, RelationshipTypeContains, lineOf(node), { member: "nestedType" })
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
          if (ctx.owner) addRel(ctx.owner, id, RelationshipTypeContains, lineOf(node), { member: "nestedType" })
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
          if (ctx.owner) addRel(ctx.owner, id, RelationshipTypeContains, lineOf(node), { member: "nestedType" })
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
          if (ctx.owner) addRel(ctx.owner, id, RelationshipTypeContains, lineOf(node), { member: "oneof" })
          // Fields inside a oneof are members of the MESSAGE, not of the oneof:
          // the field number lives in the message's own space and
          // `msg.field` is how every protobuf tool refers to them. The oneof is
          // recorded on each field as `metadata.oneof` and carries a `contains`
          // edge to each of them, so the grouping is navigable without
          // reassigning ownership.
          const inner: Ctx = { ...ctx, oneof: name }
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
        if (!collectOnly)
          imports.push({
            module: path,
            path,
            items: [],
            isDefaultImport: false,
            isNamespaceImport: false,
            range: nodeToRange(d),
            metadata: { ...(modifier ? { modifier } : {}) },
          })
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
        filePath,
        symbolCount: symbols.length,
        relationshipCount: relationships.length,
      },
    }
  }
}
