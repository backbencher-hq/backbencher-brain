/**
 * THE YAML ORACLE FOR THE TWO `extends` FORMS THE LANE LANDED IN 2026-10-22.
 *
 * This is a LANE-OWNED file. `script/m14/differential.ts` is Lead-single-writer (the fleet's
 * history says so in its own commit titles: "differential: KOTLIN fleet-phase wiring (lane
 * request, Lead single-writer) — three lane-owned oracles that were referenced by NOTHING
 * imported and pushed"), and the YAML truth `deriveYamlEdges` still lives INSIDE that file. So
 * the new forms are derived here, independently, and the wiring the Lead has to apply is two
 * lines: import this and push its rows alongside `deriveYamlEdges`.
 *
 * ## WHY A NEW FILE AND NOT A HUNK IN `differential.ts`
 *
 * Because the oracle's value is that it is a SECOND IMPLEMENTATION. It shares no rule table, no
 * key set and no path helper with the analyzer: it reads the tree and derives the edges from
 * YAML's own semantics. A hunk written next to the analyzer's code would be a copy of the
 * analyzer's code, and a copy cannot disagree with the thing it copies — so it would audit
 * nothing. The fleet's own json oracle (`script/m14/oracles/json.ts`) is the model, and it
 * already derives the JSON lane's `allOf` composition, which is the same rule.
 *
 * ## THE TWO FORMS
 *
 * 1. **JSON SCHEMA COMPOSITION.** `allOf` means "must satisfy ALL of these" — a superset-of
 *    relationship, and the only schema keyword that means one. `anyOf` and `oneOf` are
 *    ALTERNATIVES and have no ontology type, so their `$ref`s contribute only the `references`
 *    they already produce. This is the JSON lane's own settled ruling (`BD-allof-extends` in
 *    `script/m14/spec/json-completeness.json`), applied to the same construct written as YAML.
 *    The source is the schema that COMPOSES, not the `allOf` array that records the composition:
 *    `allOf` is a keyword shared by every schema in the file, so an edge whose source were the
 *    array would bind a consumer resolving by name to an arbitrary one of them.
 *
 * 2. **CONFIGURATION INHERITANCE — the `extends:` key.** `extends` on a mapping is the same
 *    relation the merge key carries, written the other way round. The value's SHAPE says what
 *    the base is: a sibling-dot name is a sibling key in this file, `{service: S}` is a sibling
 *    service in this file, `{file: F}` and `{template: T}` name a FILE (and the file is READ, so
 *    the `imports` edge is derived too), and a bare name is a config of another tool.
 *
 * ## THE RULES THAT GOT WRONG FIRST, KEPT BECAUSE THEY ARE THE LOAD-BEARING PARTS
 *
 * 1. **A `$ref` DEEPER INSIDE AN `allOf` MEMBER IS NOT A COMPOSITION.** The member
 *    `allOf[1].properties.OnTimeout.$ref` is a PROPERTY reference: the path's tail must be
 *    exactly `.allOf[N].$ref`. A rule that matched "inside an allOf" would claim every property
 *    reference in a composed schema, and the corpus has both shapes in the same document.
 * 2. **A DOTTED KEY IS NOT A PATH SEGMENT.** The paths here are joined with a dot, so a GitLab
 *    hidden job named `.pytest` has the path `<doc>..pytest` — and the "last dot segment" of
 *    that path is `pytest`, not `.pytest`. The index is keyed by the KEY TEXT, and the target is
 *    the path that the analyzer's own symbol carries, so the two agree on the leading dot.
 * 3. **THE COMPOSER IS NOT THE ARRAY.** The source of a composition is the schema that composes.
 *    Both sides got this wrong first, in opposite directions: the oracle first emitted the
 *    `allOf` array as the source, and the analyzer first emitted the `$ref` KEY. The thing that
 *    inherits is `Request`, not `Request.allOf` and not `Request.allOf[0].$ref`.
 */

export interface YamlOracleEdge {
  label: string
  from: string
  target: string
}

const CONTAINER_TYPES = new Set(["block_mapping", "flow_mapping", "block_sequence", "flow_sequence"])
const MAPPING_PAIR_TYPES = new Set(["block_mapping_pair", "flow_pair"])

/** The `extends:` key's MAPPING forms, and the key that says what the base is. */
const EXTENDS_FILE_KEYS = ["file", "template"]
const EXTENDS_SERVICE_KEYS = ["service"]

export function deriveYamlExtendsEdges(root: any, relPath: string): YamlOracleEdge[] {
  const edges: YamlOracleEdge[] = []
  const seen = new Set<string>()
  const push = (label: string, from: string, target: string): void => {
    from = String(from ?? "").trim()
    target = String(target ?? "").trim()
    if (!from || !target) return
    const k = `${label}|${from}|${target}`
    if (seen.has(k)) return
    seen.add(k)
    edges.push({ label, from, target })
  }

  // ── identity: the document's key space, the same spelling the analyzer uses ──────────────────
  const baseName = relPath.split("/").pop() ?? "document"
  const lowerBase = baseName.toLowerCase()
  let stem = baseName
  if (lowerBase.endsWith(".yaml.template")) stem = baseName.slice(0, -13)
  else if (lowerBase.endsWith(".yml.template")) stem = baseName.slice(0, -12)
  else if (lowerBase.endsWith(".yaml")) stem = baseName.slice(0, -5)
  else if (lowerBase.endsWith(".yml")) stem = baseName.slice(0, -4)
  stem = stem.trim() || "document"
  const dirScope = relPath.split("/").slice(0, -1).filter((s) => s.length > 0).join(".")
  const document = dirScope.length > 0 ? `${dirScope}.${stem}` : stem

  // ── grammar helpers (node shapes, not analyzer logic) ───────────────────────────────────────
  const kids = (n: any): any[] => (n?.namedChildren ?? []).filter((c: any) => c !== null && c !== undefined)
  const fieldOf = (n: any, f: string): any => n?.childForFieldName?.(f) ?? null
  const unquote = (t: string): string => {
    const v = t.trim()
    if (v.length >= 2) {
      const q = v[0]
      if ((q === '"' || q === "'") && v[v.length - 1] === q) return v.slice(1, -1)
    }
    return v
  }
  const isContainerType = (t: string): boolean => CONTAINER_TYPES.has(t)
  /** Descend the grammar's wrapper nodes (`flow_node`, `block_node`). */
  const unwrap = (n: any): any => {
    let cur = n
    for (let guard = 0; cur && guard < 8; guard++) {
      if (cur.type === "flow_node" || cur.type === "block_node" || cur.type === "block_sequence_item") {
        const next = kids(cur).find((c: any) => c.type !== "tag" && c.type !== "anchor")
        if (!next) return cur
        cur = next
        continue
      }
      return cur
    }
    return cur
  }
  const scalarText = (n: any): string => {
    const w = unwrap(n)
    if (!w || isContainerType(w.type) || w.type === "alias") return ""
    return unquote(String(w.text ?? ""))
  }
  const escapePointer = (s: string): string => String(s).replace(/~/g, "~0").replace(/\//g, "~1")
  const findChildType = (n: any, t: string): any => kids(n).find((c: any) => c.type === t) ?? null

  /** The scalar VALUE of a mapping entry, read from the grammar's own `key`/`value` fields. */
  const mappingEntryScalar = (node: any, keyName: string): string | null => {
    const mapping = unwrap(node)
    if (!mapping || !isContainerType(mapping.type)) return null
    for (const pair of kids(mapping)) {
      if (!MAPPING_PAIR_TYPES.has(pair.type)) continue
      const keyNode = fieldOf(pair, "key") ?? kids(pair)[0]
      if (scalarText(keyNode) !== keyName) continue
      const value = fieldOf(pair, "value")
      if (!value) return null
      const text = scalarText(value)
      return text || null
    }
    return null
  }

  // ── the two indexes the derivations need ─────────────────────────────────────────────────────
  /** JSON-pointer path -> the document path that declares it. */
  const pointerIndex = new Map<string, string>()
  /** The top-level keys of the document, and the services under `services:`. */
  const topLevelKeys = new Map<string, string>()
  const serviceKeys = new Map<string, string>()
  /** The `$ref` rows, kept until the pointer index is complete. */
  const pendingRefs: { from: string; pointer: string }[] = []

  const handlePair = (pair: any, parentPath: string, pointerPath: string): void => {
    const keyNode = fieldOf(pair, "key") ?? kids(pair)[0]
    const valueNode = fieldOf(pair, "value") ?? kids(pair)[1]
    const key = scalarText(keyNode)
    if (!key) return
    const path = parentPath ? `${parentPath}.${key}` : key
    const content = unwrap(valueNode)
    if (content && isContainerType(content.type)) {
      pointerIndex.set(`${pointerPath}/${escapePointer(key)}`, path)
    }
    if (!parentPath || parentPath === document) {
      if (content && (content.type === "block_mapping" || content.type === "flow_mapping")) {
        topLevelKeys.set(key, path)
      }
    }
    if (parentPath.endsWith("services") && content && (content.type === "block_mapping" || content.type === "flow_mapping")) {
      serviceKeys.set(key, path)
    }

    // ── FORM 2: the `extends:` key ────────────────────────────────────────────────────────────
    if (key === "extends") {
      deriveExtendsKey(parentPath, valueNode)
    }

    // ── FORM 1: a `$ref` that is a DIRECT member of an `allOf` item ───────────────────────────
    if (content && !isContainerType(content.type) && content.type !== "alias") {
      const v = scalarText(valueNode)
      if (v && (key === "$ref" || v.startsWith("#/") || v.includes("#/"))) {
        pendingRefs.push({ from: path, pointer: v })
      }
    }
    walkValue(valueNode, path, `${pointerPath}/${escapePointer(key)}`)
  }

  /** The `extends:` key's value shape decides what the base is. */
  const deriveExtendsKey = (ownerPath: string, valueNode: any): void => {
    if (!ownerPath) return
    const content = unwrap(valueNode)
    if (!content) return
    if (content.type === "block_mapping" || content.type === "flow_mapping") {
      const template = mappingEntryScalar(content, "template")
      const file = mappingEntryScalar(content, "file")
      const service = mappingEntryScalar(content, "service")
      if (template !== null) {
        // AZURE PIPELINES: `template: path.yml@Name` — the file is the base and it is READ.
        const at = template.indexOf("@")
        const file_ = at >= 0 ? template.slice(0, at) : template
        push("extends", ownerPath, file_)
        push("imports", ownerPath, file_)
        return
      }
      if (file !== null) {
        // DOCKER COMPOSE: `{file: F, service: S}` — the base is a service in ANOTHER file.
        push("extends", ownerPath, file)
        push("imports", ownerPath, file)
        return
      }
      if (service !== null) {
        // DOCKER COMPOSE, same file: the base is a SIBLING service.
        const sibling = serviceKeys.get(service)
        if (sibling) push("extends", ownerPath, sibling)
        return
      }
      return
    }
    const written = scalarText(content)
    if (!written) return
    if (written.startsWith(".")) {
      // GITLAB CI: the base is a HIDDEN JOB — a top-level key of the same file.
      const sibling = topLevelKeys.get(written)
      if (sibling) push("extends", ownerPath, sibling)
      return
    }
    // A CONFIG NAME of another tool (yamllint's `extends: default`).
    push("extends", ownerPath, written)
  }

  const walkValue = (node: any, parentPath: string, pointerPath: string): void => {
    const content = unwrap(node)
    if (!content) return
    if (content.type === "block_mapping" || content.type === "flow_mapping") {
      for (const pair of kids(content)) {
        if (!MAPPING_PAIR_TYPES.has(pair.type)) continue
        handlePair(pair, parentPath, pointerPath)
      }
      return
    }
    if (content.type === "block_sequence" || content.type === "flow_sequence") {
      let index = 0
      for (const item of kids(content)) {
        const itemPath = `${parentPath}[${index}]`
        const itemContent = unwrap(item)
        if (itemContent && (itemContent.type === "block_mapping" || itemContent.type === "flow_mapping")) {
          for (const pair of kids(itemContent)) {
            if (!MAPPING_PAIR_TYPES.has(pair.type)) continue
            handlePair(pair, itemPath, `${pointerPath}/${index}`)
          }
        } else if (itemContent && !isContainerType(itemContent.type)) {
          // A SCALAR item is a VALUE, not a declaration (the analyzer's own rule), so it has no
          // path of its own and cannot be a composer.
        }
        index++
      }
    }
  }

  // ── documents: the tree's root is a STREAM of documents, and each document's BODY is one
  // `block_node`/`flow_node` under it. The first document takes the file's own identity and the
  // rest are numbered, exactly as the analyzer's document identity does.
  const documents: any[] = []
  for (const child of kids(root)) {
    if (child.type === "document") documents.push(child)
  }
  if (documents.length === 0 && kids(root).length > 0) documents.push(root)
  let docIndex = 0
  for (const doc of documents) {
    docIndex++
    const documentName = docIndex === 1 ? document : `${document}#${docIndex}`
    const body = kids(doc).find((c: any) => c.type === "block_node" || c.type === "flow_node") ?? doc
    walkValue(body, documentName, "")
  }

  // ── FORM 1's resolution: the pointer index is complete only now ────────────────────────────
  for (const ref of pendingRefs) {
    const pointerPath = ref.pointer.startsWith("#") ? ref.pointer.slice(1) : ref.pointer
    const resolved = pointerIndex.get(pointerPath)
    // THE TAIL IS THE RULE: the `$ref` must be a DIRECT member of an `allOf` item. A `$ref` deeper
    // inside a member — `…allOf[1].properties.OnTimeout.$ref` — is a property reference.
    const m = /^(.*)\.allOf\[\d+\]\.\$ref$/.exec(ref.from)
    if (!m) continue
    const composer = m[1]
    if (!composer) continue
    push("extends", composer, resolved ?? ref.pointer)
  }

  return edges
}
