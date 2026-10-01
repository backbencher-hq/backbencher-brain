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
 * relation the format itself defines is CONTAINMENT: the object a key is written in
 * contains that key. There is no name resolution, no binding, no inheritance and no
 * control flow, so `calls`, `extends`, `implements`, `overrides` and `instantiates` are
 * not derivable from the format at all.
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
 * relation the format itself defines is CONTAINMENT: the object a key is written
 * in contains that key. There is no name resolution, no binding, no inheritance
 * and no control flow, so `calls`, `extends`, `implements`, `overrides` and
 * `instantiates` are not derivable from the format at all.
 *
 * The one non-trivial edge is JSON Schema's `$ref`, which names another location in
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
  const composed: { from: string; target: string }[] = []
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
      items.forEach((item: any, i: number) => {
        if (!isObject(item)) return // a scalar element has no named children
        // The item is named from the ARRAY's own name plus the index, never from
        // the item's path. Taking the last dot-segment is correct only while the
        // module name has no dot, and `index.svelte.warnings.json` is an ordinary
        // filename: that path gives `warnings[0]` where the truth is
        // `index.svelte.warnings[0]`. The analyzer had the same bug and both were
        // fixed from the same rule — an array element is identified by its index
        // UNDER THE ARRAY, and the array is named by the key it was written under.
        const itemPath = `${parentPath}[${i}]`
        const itemName = `${parentName}[${i}]`
        if (parentName) edges.push({ label: "contains", from: parentName, target: itemName })
        pathToName.set(itemPath, itemName)
        walk(item, itemPath, itemName)
      })
      return
    }

    if (!isObject(node)) return
    const pairs = (node.namedChildren ?? []).filter((c: any) => c.type === "pair")
    for (const pair of pairs) {
      const key = keyText(pair)
      const value = valueOf(pair)
      if (!key || !value) continue
      const here = parentPath ? `${parentPath}.${key}` : key
      // CONTAINMENT: the object a key is written in contains that key. The SOURCE
      // is the parent SYMBOL's name, never its qualified path — an edge whose source
      // is not a symbol name resolves to nothing, which is the defect the contract
      // probe caught.
      if (parentName) edges.push({ label: "contains", from: parentName, target: key })
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
        // The enclosing key of a `$ref` tells us whether it composes. The path
        // writes an array index with BRACKETS (`…allOf[0].$ref`), which two earlier
        // attempts got wrong — one matched only the object form and one stripped a
        // dot-separated index, each finding 1 edge where the corpus has 1,226.
        const bracket = here.lastIndexOf("[")
        const owner = bracket > 0 && here.endsWith("]") ? here.slice(0, bracket) : here
        if (owner.endsWith(".allOf")) {
          const ptr = unquote(value)
          if (ptr.startsWith("#/")) {
            const pointed = `${scriptName}.${ptr.slice(2).replaceAll("/", ".")}`
            if (pathToName.has(pointed)) composed.push({ from: owner, target: pointed })
          }
        }
        refs.push({ from: here, refPath: unquote(value) })
      } else if (isObject(value) || isArray(value)) {
        walk(value, here, key)
      }
    }
  }

  const doc = (root?.namedChildren ?? []).find((c: any) => c.type === "object") ?? (root?.type === "object" ? root : null)
  if (doc) walk(doc, scriptName, scriptName)

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
  for (const c of composed) edges.push({ label: "extends", from: c.from, target: c.target })

  if (opts?.manifest) {
    // the root object is the document's only named child
    const rootObject = (root?.namedChildren ?? []).find((c: any) => c.type === "object") ?? (root?.type === "object" ? root : null)
    for (const name of manifestPublished(rootObject)) edges.push({ label: "exports", from: scriptName, target: name })
  }

  for (const d of deps) edges.push({ label: "uses", from: d.from, target: d.name })

  return edges
}
