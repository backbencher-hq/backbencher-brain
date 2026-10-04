/**
 * The JSON oracle — LANE-OWNED.
 *
 * It lives here rather than in `differential.ts` so that the shared file's JSON
 * footprint is one import and one registration instead of 120 lines. `differential.ts`
 * is edited by several lanes at once; every line a lane keeps out of a shared file is a
 * line that cannot conflict, and this lane had already rewritten its own block there
 * three times while other lanes were working in the same file.
 *
 * The oracle is written from JSON's semantics and shares no rule table, key set, path
 * helper or resolver with `RealJsonAnalyzer`. That is the only property that makes a
 * MATCH mean something: an oracle derived from the analyzer cannot disagree with it,
 * and the bash lane's first truth file was exactly that — 55 hand-authored facts, all
 * `authority: manual_audit`, twelve of which pinned the `global` phantom endpoint as
 * EXPECTED. A lane whose truth cannot disagree with its analyzer has no differential;
 * it has a mirror.
 *
 * ## What JSON's semantics actually give
 *
 * A JSON document is a tree of `object` (pairs) / `array` / scalars, and the only
 * relation the FORMAT itself defines is CONTAINMENT: the object a key is written in
 * contains that key. There is no name resolution, no binding, no inheritance and no
 * control flow, so `calls`, `implements`, `overrides` and `instantiates` are not
 * derivable from the format at all.
 *
 * `extends` used to be listed in that sentence and no longer is. The FORMAT cannot
 * express it — but neither can it express `imports`, `exports` or `uses`, and all
 * three are derived here from CONVENTIONS (a `$ref` naming another file, a manifest's
 * `exports`/`main`/`bin`, a `dependencies` entry). A grammar has no node type for a
 * keyword any more than for a manifest field, so "the format cannot express it" was
 * the wrong question and `allOf` — the one keyword that means "must satisfy all of
 * these", a superset-of relation — is the convention that carries `extends`.
 *
 * ## The three rules this got wrong first, kept because they are the load-bearing parts
 *
 * 1. A `$ref` is a JSON Pointer, which is RELATIVE TO THE DOCUMENT ROOT, so
 *    `#/components/schemas/X` names `<module>.components.schemas.X`. Looking the raw
 *    pointer up against a module-keyed path index skipped every kubernetes OpenAPI
 *    `$ref` — 7,653 edges, the largest class in the corpus — and reported them as
 *    fabrications. A pointer is not a path in the document; it is a path FROM it.
 * 2. A `$ref` names a LOCATION, not a symbol, so the edge targets the location. Nothing
 *    guarantees the name at a location is unique; two documents in one file can each
 *    declare `spec`, and kubernetes/hack/testdata does.
 * 3. An array element is identified by its index UNDER THE ARRAY, and the array is
 *    named by the key it was written under. Deriving it from the path's last
 *    dot-segment is correct only while the module name has no dot, and
 *    `index.svelte.warnings.json` is an ordinary filename. The analyzer and this oracle
 *    had the identical bug, which is the strongest evidence it was a shared misreading
 *    rather than a slip.
 */
/**
 * M14 F5 — the JSON oracle.
 *
 * Written from JSON's own semantics and sharing no rule table, key set, path
 * helper or classification branch with `RealJsonAnalyzer`. That is the only
 * property that makes a MATCH mean something: an oracle derived from the analyzer
 * cannot disagree with it, and the bash lane's first truth file was exactly that
 * — 55 hand-authored facts, all `authority: manual_audit`, twelve of which pinned
 * the `global` phantom endpoint as EXPECTED. A lane whose truth cannot disagree
 * with its analyzer has no differential; it has a mirror.
 *
 * ## What JSON's semantics actually give
 *
* A JSON document is a tree of `object` (pairs) / `array` / scalars, and the only
 * relation the FORMAT itself defines is CONTAINMENT: the object a key is written in
 * contains that key. There is no name resolution, no binding, no inheritance and no
 * control flow, so `calls`, `implements`, `overrides` and `instantiates` are not
 * derivable from the format at all.
 *
 * ## The one non-trivial edge is JSON Schema's `$ref`, which names another location in
 * the SAME document. Resolving it needs a path index, so the oracle builds its own
 * from its own walk — deliberately not by calling the analyzer's `referenceTarget`,
 * because a shared resolver would make the comparison untestable in exactly the way
 * this lane's blind spot already was.
 *
 * ## Grain
 *
 * (label, from, target) triples, one per declaration, matching site-agnostically in
 * the F5 harness. Module name is the file's basename WITHOUT its extension, which is
 * what the analyzer emits and what the contract probe pins.
 */
/** A `$ref` that names a document rather than pointing inside one. Mirrors the
 *  corpus shapes: a relative path, optionally with a `#fragment`, and not a URL. */
function isFileNamingRef(refPath: string): boolean {
  if (refPath.length === 0) return false
  if (refPath.startsWith("#/")) return false
  if (refPath.startsWith("http://") || refPath.startsWith("https://")) return false
  const withoutFragment = refPath.split("#")[0]
  const ext = withoutFragment.slice(withoutFragment.lastIndexOf(".") + 1).toLowerCase()
  return ["json", "jsonc", "json5", "yaml", "yml", "avsc", "avdl", "proto"].includes(ext)
}

export function deriveJsonEdges(root: any, scriptName: string, opts?: { manifest?: boolean }): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  // An npm manifest declares, under these four keys, a map of package name to
  // version RANGE. Each entry is a genuine `uses` relationship: the manifest uses
  // that package. Encoded here from the npm manifest format rather than from the
  // analyzer's `isDependencyContainerPath`, so the two agreeing means something —
  // they are the same four keys because the FORMAT names those four, not because
  // the analyzer did.
  const MANIFEST_DEPENDENCY_KEYS = new Set(["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"])

  /**
   * What an npm `scripts` object publishes, and what each entry INVOKES.
   *
   * Written from the npm manifest format: `scripts` maps a script name to a shell
   * command, and a command of the form `<runner> run <name>` invokes the SIBLING script
   * called `<name>`. The callee must be a key of the SAME `scripts` object — a target
   * that is not declared there is a binary or another package's script, and naming it
   * would be an edge to a symbol the file does not contain.
   *
   * Tokenised with its own character scan rather than by calling the analyzer's
   * `npmRunTargets`, for the reason this file exists at all: two implementations that
   * share a routine cannot disagree, and a disagreement is the only evidence the
   * comparison produces. A runner is a WHOLE token (`npx` contains `npm`, and a path
   * named `npm` is not a runner) and a quoted target is declined, because quoting means
   * the shell rewrote the argument.
   */
  const npmScriptCalls = (rootObject: any): { from: string; target: string }[] => {
    const out: { from: string; target: string }[] = []
    const keyOf = (pair: any): string =>
      String(pair?.childForFieldName?.("key")?.namedChildren?.find((c: any) => c.type === "string_content")?.text ?? "")
    const scriptsPair = (rootObject?.namedChildren ?? [])
      .filter((c: any) => c.type === "pair")
      .find((p: any) => keyOf(p) === "scripts")
    const scripts = scriptsPair?.childForFieldName?.("value")
    if (!scripts || scripts.type !== "object") return out
    const declared = new Set<string>()
    const commands = new Map<string, string>()
    for (const sp of (scripts.namedChildren ?? []).filter((c: any) => c.type === "pair")) {
      const name = keyOf(sp)
      const v = sp.childForFieldName?.("value")
      if (!name) continue
      declared.add(name)
      if (v?.type === "string") commands.set(name, unquote(v))
    }
    const RUNNERS = ["npm", "pnpm", "yarn", "bun"]
    const VERBS = ["run", "run-script", "run-s"]
    const SEPARATORS = new Set([" ", "\t", "\n", "\r", ";", "&", "|", "(", ")", "<", ">"])
    for (const [name, command] of commands) {
      const tokens: { text: string; quoted: boolean }[] = []
      let current = ""
      let quoted = false
      let inQuotes = false
      for (const ch of command) {
        if (ch === '"') { inQuotes = !inQuotes; quoted = true; continue }
        if (!inQuotes && SEPARATORS.has(ch)) {
          if (current.length > 0) tokens.push({ text: current, quoted })
          current = ""
          quoted = false
          continue
        }
        current += ch
      }
      if (current.length > 0) tokens.push({ text: current, quoted })
      for (let i = 0; i < tokens.length; i++) {
        if (!RUNNERS.includes(tokens[i].text)) continue
        const verb = tokens[i + 1]
        if (!verb || verb.quoted || !VERBS.includes(verb.text)) continue
        const target = tokens[i + 2]
        if (!target || target.quoted) continue
        if (target.text === name) continue
        if (!declared.has(target.text)) continue
        out.push({ from: name, target: target.text })
        i += 2
      }
    }
    return out
  }

  /**
   * What a manifest PUBLISHES, from the npm manifest format rather than from the
   * analyzer's pass — so the two agreeing means something. A published entry point IS
   * an export: a subpath key for `exports`, the field name for `main`, the command
   * name for `bin`. The lane first ruled `exports` out on a grammar inventory and that
   * is the same unsound reasoning that produced the wrong `imports` ruling: a grammar
   * cannot see a convention. Mass is small (1 of 36 manifests carries `exports`) and
   * the principle is not.
   */
  const manifestPublished = (rootObject: any): string[] => {
    const out: string[] = []
    const keyOf = (pair: any): string =>
      String(pair?.childForFieldName?.("key")?.namedChildren?.find((c: any) => c.type === "string_content")?.text ?? "")
    for (const pair of (rootObject?.namedChildren ?? []).filter((c: any) => c.type === "pair")) {
      const key = keyOf(pair)
      const v = pair.childForFieldName?.("value")
      if (!v) continue
      if (key === "main") { if (v.type === "string") out.push("main"); continue }
      if (key === "bin") {
        if (v.type === "string") out.push("bin")
        else for (const b of (v.namedChildren ?? []).filter((c: any) => c.type === "pair")) {
          const n = keyOf(b)
          if (n) out.push(n)
        }
        continue
      }
      if (key === "exports") {
        if (v.type === "string") out.push("exports")
        else for (const sp of (v.namedChildren ?? []).filter((c: any) => c.type === "pair")) {
          const n = keyOf(sp)
          if (n) out.push(n)
        }
      }
    }
    return out
  }
  const pathToName = new Map<string, string>()
  const refs: { from: string; refPath: string }[] = []
  const deps: { from: string; name: string }[] = []
  const endpoints: { from: string; target: string }[] = []
  /**
   * Composition found during the walk, with its target still the RAW POINTER.
   *
   * The first version resolved the pointer against `pathToName` DURING the walk, and that
   * is an ORDERING bug rather than a semantic one: `definitions` frequently comes AFTER
   * `properties` in a JSON Schema document, so a pointer into `definitions` had not been
   * recorded yet when the `allOf` that referenced it was read. Measured: 809 `extends` edges
   * on a 3,272-file corpus read as analyzer-only, and on go-openapi's `schema.json` alone the
   * oracle produced ZERO while the analyzer produced 4 — every one of them an `allOf` under
   * `properties`. The same document order is why the `references` rule, which resolves in a
   * SECOND pass, was always right. Resolving composition after the walk is the fix.
   */
  const composed: { from: string; refPath: string }[] = []
  /**
   * INHERITANCE STATED AS ORDINARY KEYS — `extends` and `implements` from type
   * DECLARATIONS, not from schema composition.
   *
   * Written from the corpus rather than from the analyzer: the two shapes that occur are the
   * Language Server Protocol's meta-model (a `name` string plus an array of
   * `{"kind":"reference","name":X}` literals under `extends` / `mixins`) and duckdb's
   * serialisation schemas (a `class` string plus a `base` string). Both are announced by the
   * document before anything is interpreted, which is what stops a `name` key in an i18n
   * bundle from being read as a type declaration — measured: 2 of 11,713 admitted documents
   * contain a `{"kind":"reference"}` literal and 21 contain a `class` string.
   *
   * `mixins` names the TypeScript interfaces a class mixes in, which is `implements`: an
   * interface carries no implementation, so there is nothing else for the word to mean.
   *
   * A reference to a type the document does not declare produces NO edge. Measured: 16
   * supertype statements in duckdb's schemas name a type declared in a sibling file, and an
   * edge to a symbol this file does not contain is a fabrication.
   */
  const typeDeclarations = new Map<string, string>()
  const inheritanceCandidates: { from: string; target: string; label: "extends" | "implements" }[] = []
  const LSP_INHERITANCE_KEYS = ["extends", "base", "superclass", "superClass", "implements", "mixins"]
  let usesReferenceLiterals = false
  let usesClassDeclarations = false
  const HTTP_METHOD_KEYS = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"])

  const keyText = (pair: any): string | null => {
    const k = pair.childForFieldName?.("key")
    if (!k) return null
    // A JSON key is a `string` node whose `string_content` child is the name; the
    // quotes are not part of it. Reading the CONTENT node rather than stripping
    // quotes off the parent's text is the structural form, and it is why this
    // oracle needs no regex.
    const c = k.namedChildren?.find((x: any) => x.type === "string_content")
    if (c) return String(c.text ?? "")
    const raw = String(k.text ?? "")
    return raw.length >= 2 ? raw.slice(1, -1) : raw
  }
  const valueOf = (pair: any): any => pair.childForFieldName?.("value") ?? null
  const isObject = (n: any): boolean => !!n && n.type === "object"
  const isArray = (n: any): boolean => !!n && n.type === "array"
  const unquote = (n: any): string => {
    const t = String(n?.text ?? "")
    return t.length >= 2 ? t.slice(1, -1) : t
  }
  /** The string VALUE of a pair, or null when the value is not a string. */
  const stringValue = (pair: any): string | null => {
    const v = valueOf(pair)
    return v?.type === "string" ? unquote(v) : null
  }
  const stringField = (pairs: any[], key: string): string | null => {
    for (const p of pairs) if (keyText(p) === key) return stringValue(p)
    return null
  }
  const hasField = (pairs: any[], key: string): boolean => pairs.some((p: any) => keyText(p) === key)
  const isIdentifierText = (text: string): boolean => {
    if (text.length === 0) return false
    const first = text[0]
    if (!((first >= "a" && first <= "z") || (first >= "A" && first <= "Z") || first === "_")) return false
    for (let i = 1; i < text.length; i++) {
      const c = text[i]
      if (!((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_")) return false
    }
    return true
  }
  /** LSP's reference literal: `{"kind":"reference","name":X}`. A REFERENCE, never a declaration. */
  const referenceLiteralName = (node: any): string | null => {
    if (!isObject(node)) return null
    const pairs = (node.namedChildren ?? []).filter((c: any) => c.type === "pair")
    if (stringField(pairs, "kind") !== "reference") return null
    return stringField(pairs, "name")
  }

  // Pass 0 — the two DOCUMENT preconditions, read once before any key is interpreted.
  //
  // Both exist because the pass-2 corpus probe found inheritance declared as ordinary object
  // keys, in exactly 2 of 11,713 admitted documents (`{"kind":"reference"}` literal) and 21
  // (`class` string). Without the precondition a `name` key in an i18n bundle or an OpenAPI
  // operation would be read as a type declaration, which is the fabrication the ontology
  // workstream calls the most expensive mistake available.
  {
    const pre: any[] = [root]
    while (pre.length) {
      const n = pre.pop()
      if (n.type === "pair") {
        if (keyText(n) === "kind" && stringValue(n) === "reference") usesReferenceLiterals = true
        if (keyText(n) === "class") {
          const declared = stringValue(n)
          if (declared !== null && isIdentifierText(declared)) usesClassDeclarations = true
        }
      }
      for (let i = n.childCount - 1; i >= 0; i--) pre.push(n.child(i))
    }
  }

  // Pass 1 — walk, recording CONTAINMENT and every path at which a name is declared,
  // plus every `$ref` with the path it was written at.
  const walk = (node: any, parentPath: string, parentName: string): void => {
    if (isArray(node)) {
      // An array's SCALAR elements are leaves — positional, unnamed, nothing to
      // contain. But an array of OBJECTS carries real containment, and this oracle's
      // first version returned early for every array, which is how 18,283
      // analyzer edges came to read as fabrications when the truth simply had not
      // modelled them. Being wrong in the oracle's direction is still wrong: it
      // would have convicted correct edges, which is the one failure a differential
      // must never produce.
      const items = (node.namedChildren ?? []).filter((c: any) => c.type !== "[")
      // An element that is itself an ARRAY is a container with a declared position, so it
      // carries containment and needs a name. Declining it — which this oracle did, and which
      // is why 30 `contains` edges on a 3,272-file corpus had no truth to match — states less
      // than the document does: `{ "rows": [[{"cell":1}]] }` plainly has `rows` containing
      // `rows[0]`. Named from the array's own QUALIFIED path, which is what an array nested
      // inside another array needs: the inner array's bare name is the outer array's name, so
      // naming from it made two different objects collide and produced
      // `rows[0] contains rows[0][1]` between objects that are not nested at all.
      // An array that is itself an ELEMENT has no key of its own, so its children are named
      // from its qualified path; an array written under a KEY keeps the short name that key
      // gives it, because that is the name the document already uses (`allOf[0]`). The test is
      // the path's last segment: an element's ends in `]`.
      // A document whose TOP LEVEL is an array is named by the MODULE, whose basename may
      // contain a dot — `Dotted.name.json` — so its element is `Dotted.name[0]` and not
      // `name[0]`. That case is why the module name, and not the last dot-segment, is the
      // identity here.
      const lastSegment = parentPath.slice(parentPath.lastIndexOf(".") + 1)
      const self =
        parentPath === scriptName
          ? scriptName
          : lastSegment.endsWith("]")
            ? parentPath.slice(scriptName.length + 1)
            : lastSegment
      items.forEach((item: any, i: number) => {
        const isContainer = isObject(item) || isArray(item)
        if (!isContainer) return // a scalar element has no named children and nothing to own
        const itemPath = `${parentPath}[${i}]`
        const itemName = `${self}[${i}]`
        // `contains` endpoints are QUALIFIED PATHS on both sides, and this is why: a JSON
        // document repeats key names relentlessly, so a bare-name endpoint is ambiguous by
        // construction and the shared resolver declines a non-unique bare name — the edge is in
        // the graph, asserts containment, and cannot be walked in either direction. Measured on
        // a 202-file, 99-repo sample: 32,660 of 66,032 `contains` edges (49.4%) named a target
        // matching more than one published symbol, and 1,119 were self-loops because the source
        // and the target were the same bare string.
        if (parentName) edges.push({ label: "contains", from: parentPath, target: itemPath })
        pathToName.set(itemPath, itemName)
        walk(item, itemPath, itemName)
      })
      return
    }

    if (!isObject(node)) return
    const pairs = (node.namedChildren ?? []).filter((c: any) => c.type === "pair")
    // A key declared TWICE in THIS object replaces its earlier declaration, which is
    // the redefinition the bash lane calls `overrides`. Scoped to the object because a
    // JSON key is unique only within its object — the same key in two different objects
    // is not a redefinition, and it is the corpus's dominant shape (120,174 occurrences
    // across 7,679 files, against 21 genuine duplicates across 11).
    //
    // The oracle cannot check this one against the analyzer's rule, because the analyzer
    // derives it from the walk's per-object frame and there is no shared structure to
    // compare: what is compared is the resulting (owner, key) pair, which both sides
    // reach independently. An EMPTY key is declined — 10 occurrences, every one a
    // document the grammar recovered with ERROR nodes, and an empty key names no member.
    const declaredHere = new Set<string>()
    // A type DECLARATION this document makes, and the inheritance it states. Recorded here
    // because `parentPath` IS the walked object's own path, which is what the endpoints need.
    if (referenceLiteralName(node) === null) {
      const className = usesClassDeclarations ? stringField(pairs, "class") : null
      // A declaration names itself AND carries a key that makes it a type rather than one of
      // its members. A property descriptor `{"name":"textDocument","type":{…}}` has a name
      // and none of those, and it sits inside a declaration in the same file.
      const lspName =
        usesReferenceLiterals && (hasField(pairs, "properties") || hasField(pairs, "values") || hasField(pairs, "extends") || hasField(pairs, "mixins") || hasField(pairs, "implements"))
          ? stringField(pairs, "name") ?? stringField(pairs, "typeName")
          : null
      const named = className ?? lspName
      if (named !== null && named.length > 0 && !typeDeclarations.has(named)) typeDeclarations.set(named, parentPath)
      if (named !== null && named.length > 0) {
        if (className !== null) {
          const base = stringField(pairs, "base")
          // A member descriptor — duckdb writes `{"id":200,"name":"info","type":"AlterInfo*",
          // "base":"ParseInfo"}` for a FIELD — carries no `class` marker, so the 16 such
          // statements are declined by the marker rather than by a name list.
          if (base !== null && base.length > 0) inheritanceCandidates.push({ from: parentPath, target: base, label: "extends" })
        } else {
          for (const key of LSP_INHERITANCE_KEYS) {
            const pair = pairs.find((p: any) => keyText(p) === key)
            const value = pair ? valueOf(pair) : null
            if (!isArray(value)) continue
            const label: "extends" | "implements" = key === "mixins" || key === "implements" ? "implements" : "extends"
            for (const item of (value.namedChildren ?? []).filter((c: any) => c.type !== "[")) {
              const reference = referenceLiteralName(item)
              if (reference === null) continue
              inheritanceCandidates.push({ from: parentPath, target: reference, label })
            }
          }
        }
      }
    }
    for (const pair of pairs) {
      const key = keyText(pair)
      const value = valueOf(pair)
      if (!key || !value) continue
      if (key.length > 0) {
        if (declaredHere.has(key)) {
          if (parentName) edges.push({ label: "overrides", from: parentName, target: key })
        } else {
          declaredHere.add(key)
        }
      }
      const here = parentPath ? `${parentPath}.${key}` : key
      // CONTAINMENT: the object a key is written in contains that key, and both endpoints are
      // QUALIFIED PATHS. The SOURCE used to be the parent symbol's BARE name, on the reasoning
      // that an edge whose source is not a symbol name resolves to nothing — which is true and
      // is also why the edge was unwalkable: a bare name shared by every array element in the
      // file resolves to an arbitrary one of them, and 51 corpus-wide resolved to nothing at
      // all because a real JSON key is named `unknown`. The path is the symbol's identity and
      // the resolver matches it exactly, so it is what both sides emit.
      if (parentName) edges.push({ label: "contains", from: parentPath, target: here })
      pathToName.set(here, key)
      // OpenAPI path entry: a `/`-prefixed key whose object declares an HTTP method.
      if (key.length > 1 && key.startsWith("/") && isObject(value)) {
        const methods = (value.namedChildren ?? []).filter((c: any) => c.type === "pair").map((c: any) => keyText(c))
        if (methods.some((m: string | null) => !!m && HTTP_METHOD_KEYS.has(m))) {
          endpoints.push({ from: parentName || scriptName, target: key })
        }
      }
      if (opts?.manifest && MANIFEST_DEPENDENCY_KEYS.has(key) && isObject(value)) {
        for (const dep of (value.namedChildren ?? []).filter((c: any) => c.type === "pair")) {
          const depKey = keyText(dep)
          if (depKey) deps.push({ from: scriptName, name: depKey })
        }
      }
      if (key === "$ref" && value.type === "string") {
        // The enclosing key of a `$ref` tells us whether it composes. TWO strips are
        // needed, in this order, and the first version did only the second: `here` is
        // the path OF THE `$ref` NODE (`…allOf[0].$ref`), not of its parent, so the
        // trailing `]` test is false, the index never comes off, `owner` never ends
        // with `.allOf`, and the rule emits literally nothing — 1,225 analyzer edges
        // read as 1,208 fabrications. A rule that silently matches nothing still looks
        // like a rule that found nothing, which is how a green suite hides a hole.
        let owner = here
        const lastDot = owner.lastIndexOf(".")
        if (lastDot >= 0) owner = owner.slice(0, lastDot) // drop the `.$ref` itself
        const bracket = owner.lastIndexOf("[")
        if (bracket > 0 && owner.endsWith("]")) owner = owner.slice(0, bracket)
        if (owner.endsWith(".allOf")) {
          // The SOURCE is the schema object that COMPOSES, not the `allOf` array that records
          // the composition. The first version used the array, so every edge read
          // `Request.allOf -[extends]-> ProtocolMessage` — and `allOf` is a keyword shared by
          // every schema in the file, so a consumer resolving by name binds it to an arbitrary
          // one. The thing that inherits is `Request`.
          const composer = owner.length > ".allOf".length ? owner.slice(0, owner.length - ".allOf".length) : scriptName
          const ptr = unquote(value)
          // Two ref forms count as composition, derived from the SEEN shapes rather
          // than an assumed one: `#/…` inside the document, and a sibling file with a
          // fragment (`dataTypeBase.json#`), which the `imports` rule already treats as
          // a file-naming ref. Written from the grammar of the corpus, not from the
          // analyzer, so agreement is evidence rather than a shared assumption.
          const isDoc = ptr.startsWith("#/")
          const isFile = !isDoc && isFileNamingRef(ptr)
          if (isDoc || isFile) composed.push({ from: composer, refPath: ptr })
        }
        refs.push({ from: here, refPath: unquote(value) })
      } else if (isObject(value) || isArray(value)) {
        walk(value, here, key)
      }
    }
  }

  // The document's top level may be an OBJECT or an ARRAY, and an earlier version of
  // this oracle only handled the object — so all 1,380 array-rooted files returned
  // zero truth edges and every analyzer edge on them read as a fabrication.
  // terraform's `apply.json` equivalence outputs are arrays at the top level, which
  // is how it surfaced: the analyzer emitted 65 correct `contains` edges on a file
  // where the oracle had nothing to say. A differential that is SILENT is worse than
  // one that is wrong, because silence reads as corroboration.
  //
  // This invocation was also deleted by accident while the manifest rule above was
  // being added — a `replace` whose anchor spanned it — and the symptom was
  // WORSE NUMBERS (files-with-truth 2,201 -> 1,884), which read like an analyzer
  // regression rather than a broken instrument. An instrument that fails by being
  // absent is the hardest kind of failure to notice and the easiest to misattribute.
  // EVERY top-level value, not just the first. Concatenated JSON documents are legal
  // input for tooling that streams them, and kubernetes' `hack/testdata` holds
  // several: two `Service` objects back to back in one file. The oracle walked only
  // the first, so the whole second document's containment went uncorroborated and
  // 12 edges read as fabrications. Note the cost this exposes rather than hides: the
  // two documents both declare `spec`, so both symbols are named `spec` and the
  // edges from them are AMBIGUOUS — which is the language property recorded in §7,
  // arriving through a door nobody expected.
  //
  // This loop REPLACED an earlier `walk(doc, …)` line rather than joining it, and for a
  // `document`-rooted file the two overlapped: `doc` was the first entry of
  // `topLevels`, so the walk ran twice over the whole first document and the oracle
  // emitted every one of its edges exactly twice. Measured: `contains` truth 122,146
  // against 61,115 analyzer edges — 50.03% coverage, with `uses` and `references` at
  // 50.00% each and `calls`/`exports` at 100% (they are emitted from the manifest
  // block, which was never walked twice). The shared F5 harness compares edge SETS, so
  // the duplication was invisible there and the lane's recorded 100% survived it; a
  // count-sensitive consumer inherits the halving. One walk, below.
  const topLevels: any[] =
    root?.type === "object" || root?.type === "array"
      ? [root]
      : (root?.namedChildren ?? []).filter((c: any) => c.type === "object" || c.type === "array")
  for (const topLevel of topLevels) walk(topLevel, scriptName, scriptName)

  // Pass 2 — resolve each `$ref` against the index Pass 1 built.
  //
  // A `$ref` names a LOCATION in the document, not a symbol, so the edge targets the
  // LOCATION. This is not a cosmetic choice and it is the whole adjudication for
  // 7,653 edges: the first version of this oracle resolved a pointer to the bare
  // NAME declared there, the analyzer resolves it to the PATH, and the two disagreed
  // on 91% of every `references` edge in the corpus — kubernetes' OpenAPI specs,
  // where a `$ref` is a location and the name at that location is one of several
  // possible names. A pointer into a document cannot be answered with a name,
  // because nothing guarantees the name is unique; a location can. The analyzer was
  // right and the oracle was under-specified.
  // A `$ref` naming another FILE is a dependency. Decided from the JSON Schema
  // document shape, not from the analyzer's `isFileNamingRef`, so the two agreeing
  // means something. 58 occurrences across 12 files in the corpus.
  const DOCUMENT_EXTENSIONS = ["json", "jsonc", "json5", "yaml", "yml", "avsc", "avdl", "proto"]
  for (const r of refs) {
    if (r.refPath.length === 0 || r.refPath.startsWith("#/") || r.refPath.startsWith("http://") || r.refPath.startsWith("https://")) continue
    const withoutFragment = r.refPath.split("#")[0]
    const dot = withoutFragment.lastIndexOf(".")
    if (dot < 0) continue
    if (!DOCUMENT_EXTENSIONS.includes(withoutFragment.slice(dot + 1))) continue
    edges.push({ label: "imports", from: r.from, target: r.refPath })
  }

  for (const r of refs) {
    if (!r.refPath.startsWith("#/")) continue
    // A JSON Pointer is RELATIVE TO THE DOCUMENT ROOT, so `#/components/schemas/X`
    // names `<module>.components.schemas.X`. The lookup used the raw pointer
    // (`components/schemas/X`) against a path index keyed from the module name, so it
    // never matched and 7,653 kubernetes OpenAPI `$ref`s — the single largest class in
    // the corpus — were skipped by the oracle and read as fabrications. A pointer is
    // not a path in the document; it is a path FROM the document.
    const pointerPath = `${scriptName}.${r.refPath.slice(2).replaceAll("/", ".")}`
    if (!pathToName.has(pointerPath)) continue // no declaration at that location
    edges.push({ label: "references", from: r.from, target: pointerPath })
  }

  // An OpenAPI/Swagger `paths` entry: a key beginning with `/` whose object holds at
  // least one HTTP method. The endpoints are USED by the `paths` object, and the
  // method names are the evidence — the rule is structural, taken from the OpenAPI
  // document shape rather than from the analyzer's `isApiEndpoint`.
  for (const e of endpoints) edges.push({ label: "uses", from: e.from, target: e.target })

  // The manifest's dependencies are `uses`, sourced by the file's own module.
  // JSON Schema COMPOSITION as `extends`. `allOf` means "must satisfy ALL of these",
  // which is a superset-of relationship; `anyOf`/`oneOf` are ALTERNATIVES and have no
  // ontology type, so they contribute only the `references` their `$ref`s already
  // produce. Recorded during the ref emission below, where the enclosing path is known.
  // Resolved HERE, after the walk, for the ordering reason recorded on `composed`. A
  // pointer into a location this document never declares still produces no edge: measured,
  // that is the analyzer's own fallback case and the two implementations disagree about it
  // by design (the analyzer keeps the raw pointer, the oracle declines), which is the one
  // `extends` class the lane records as unadjudicated.
  for (const c of composed) {
    if (!c.refPath.startsWith("#/")) {
      edges.push({ label: "extends", from: c.from, target: c.refPath })
      continue
    }
    const pointed = `${scriptName}.${c.refPath.slice(2).replaceAll("/", ".")}`
    if (pathToName.has(pointed)) edges.push({ label: "extends", from: c.from, target: pointed })
  }

  // Inheritance declared as ordinary keys, resolved against the declarations this document
  // makes. A reference to a type the document never declares produces NO edge.
  for (const c of inheritanceCandidates) {
    const targetPath = typeDeclarations.get(c.target)
    if (targetPath === undefined || targetPath === c.from) continue
    edges.push({ label: c.label, from: c.from, target: targetPath })
  }

  if (opts?.manifest) {
    // the root object is the document's only named child
    const rootObject = (root?.namedChildren ?? []).find((c: any) => c.type === "object") ?? (root?.type === "object" ? root : null)
    for (const name of manifestPublished(rootObject)) edges.push({ label: "exports", from: scriptName, target: name })
    for (const c of npmScriptCalls(rootObject)) edges.push({ label: "calls", from: c.from, target: c.target })
  }

  for (const d of deps) edges.push({ label: "uses", from: d.from, target: d.name })

  return edges
}
