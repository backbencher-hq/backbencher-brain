/**
 * PROTOBUF CONSTRUCT PROBES — the two instruments, applied to every relationship
 * type the lane does not emit.
 *
 * ## Why a probe and not a justification
 *
 * A differential cannot find this class of defect: the analyzer and the oracle are
 * two walkers over ONE grammar, so when a type is absent from BOTH — because the
 * implementer ruled it inapplicable and the oracle was written after the ruling —
 * "nothing" agrees with "nothing" perfectly. Protobuf is not in
 * `differential.ts`'s LANGS at all, so nothing audits this lane (see the report's
 * DERIVATION section). Only measuring the LANGUAGE finds this class of defect, and
 * every ruling below names its probe and the count that would overturn it.
 *
 * ## Instrument A — grammar inventory
 *
 * For a type that needs a node type the language does not have: enumerate every
 * node type the grammar ACTUALLY PRODUCES across the corpus and show none
 * expresses the construct. The declared vocabulary is read from the wasm's own
 * `nodeTypeForId`/`fieldNameForId`, so the probe cannot be fooled by a stale
 * `node-types.json`, and the OBSERVED set is walked off the corpus itself.
 *
 * ## Instrument B — parse-tree semantic count
 *
 * For a type the language CAN express, where no inventory will ever find it: count
 * occurrences ON THE TREE. A string literal, a comment and a comment-shaped token
 * cannot fake a node. Each B ruling below names the construct it counts.
 *
 * Both instruments read the SAME tree in one streaming pass, so a construct can
 * never be counted on one parse and the inventory taken on another.
 *
 * CLI: npx tsx script/m14/protobuf-construct-probes.mts [--out /tmp/pb-probes.json]
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const OUT = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : "/tmp/opencode/pb/probes.json"
const ROOT = process.cwd()

// ------------------------------------------------------------------ corpus
const files: { label: string; abs: string; text: string }[] = []
for (const entry of readdirSync(CR).sort()) {
  const dir = path.join(CR, entry)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  const walk = (d: string, rel: string): void => {
    let kids: string[]
    try { kids = readdirSync(d) } catch { return }
    for (const k of kids.sort()) {
      if (k === ".git" || k === "node_modules") continue
      const abs = path.join(d, k)
      const r = rel ? `${rel}/${k}` : k
      let st
      try { st = statSync(abs) } catch { continue }
      if (st.isDirectory()) { walk(abs, r); continue }
      if (!k.endsWith(".proto")) continue
      if (st.size > 512 * 1024) continue
      files.push({ label: `${entry}/${r}`, abs, text: readFileSync(abs, "utf8") })
    }
  }
  walk(dir, "")
}
console.error(`corpus: ${files.length} .proto files`)

// ------------------------------------------------------------------ grammar
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const lang: any = await L.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-protobuf.wasm")))
const declaredNodeTypes = new Set<string>()
for (let i = 0; i < lang.nodeTypeCount; i++) { const n = lang.nodeTypeForId(i); if (n) declaredNodeTypes.add(n) }
const declaredFields = new Set<string>()
for (let i = 0; i < lang.fieldCount; i++) { const n = lang.fieldNameForId(i); if (n) declaredFields.add(n) }

// ------------------------------------------------------------------ probe state
type Probe = {
  type: string
  instrument: "A:grammar-inventory" | "B:parse-tree-count"
  describe: string
  nodeTypesThatWouldMeanIt?: string[]
  count: number
  files: number
  examples: string[]
  probe: string
  /** extra measured facts this probe produced, reported rather than discarded */
  alsoCounted?: Record<string, number>
}
const probes: Probe[] = []
const seenNodeTypes = new Map<string, number>()
let errorNodes = 0
let missingNodes = 0
const filesWithErrorNodes = new Set<string>()

const named = (n: any): any[] => { const out: any[] = []; for (const c of n.namedChildren) out.push(c); return out }
const namedOfType = (n: any, t: string): any[] => named(n).filter((c) => c.type === t)
/** The declaration name of a node, or null when it declares nothing. */
const declName = (n: any): string | null => {
  switch (n.type) {
    case "message": return namedOfType(n, "message_name")[0]?.text ?? null
    case "enum": return namedOfType(n, "enum_name")[0]?.text ?? null
    case "service": return namedOfType(n, "service_name")[0]?.text ?? null
    case "rpc": return namedOfType(n, "rpc_name")[0]?.text ?? null
    case "field": case "map_field": case "oneof_field": case "enum_field":
      return namedOfType(n, "identifier")[0]?.text ?? null
    default: return null
  }
}
/**
 * A proto2 `group` is ONE construct that DECLARES TWO things in one message: a
 * nested type `G` and a field `G` of that type. It is the one legitimate way a
 * name is declared twice in a scope, so it is counted on its own axis and the
 * duplicate count below excludes it — otherwise the probe would report a
 * language feature as a redefinition.
 */
const isGroupField = (n: any): boolean => n.type === "field" && namedOfType(n, "group").length > 0
const declKey = (n: any): string | null => (isGroupField(n) ? `(group)${declName(n) ?? "?"}` : declName(n))

// ------------------------------------------------------------------ A probes
const addA = (type: string, describe: string, nodeTypesThatWouldMeanIt: string[]): void => {
  const present = nodeTypesThatWouldMeanIt.filter((n) => seenNodeTypes.has(n))
  probes.push({
    type, instrument: "A:grammar-inventory", describe, nodeTypesThatWouldMeanIt,
    count: present.length,
    files: present.length ? files.length : 0,
    examples: present.map((n) => `grammar PRODUCES ${n} (${seenNodeTypes.get(n)} occurrences)`),
    probe: `walk every node of every corpus file, collect node.type into a set, intersect with [${nodeTypesThatWouldMeanIt.join(", ")}]. Overturn: a non-zero intersection.`,
    alsoCounted: { distinctNodeTypesObserved: seenNodeTypes.size },
  })
}

// ------------------------------------------------------------------ the run
{
  const parser = new P()
  parser.setLanguage(lang)

  // counts accumulated during the single streaming pass
  const nImport = { n: 0, files: new Set<string>(), ex: [] as string[] }
  const nImportPublic = { n: 0, files: new Set<string>(), ex: [] as string[] }
  const nImportWeak = { n: 0, files: new Set<string>(), ex: [] as string[] }
  const nDupScope = { n: 0, files: new Set<string>(), ex: [] as string[], groups: 0 }
  const nMsgTyped = { n: 0, files: new Set<string>(), ex: [] as string[] }
  const nScalarTyped = { n: 0 }
  const nOption = { file: 0, decl: 0, files: new Set<string>(), ex: [] as string[], custom: 0, customFiles: new Set<string>(), customEx: [] as string[], byScope: new Map<string, number>(), customByScope: new Map<string, number>(), declFiles: new Set<string>(), declEx: [] as string[] }
  const nBlock = { n: 0, byScope: new Map<string, number>(), ex: [] as string[] }
  const nExtend = { n: 0, files: new Set<string>(), ex: [] as string[] }
  const nService = { n: 0, files: new Set<string>(), ex: [] as string[] }
  const nMessage = { n: 0 }

  for (const f of files) {
    const tree = parser.parse(f.text)
    if (!tree) continue
    const root = tree.rootNode
    let hadError = false

    // ---- instrument A: the grammar's own observed vocabulary
    const stack = [root]
    while (stack.length) {
      const n = stack.pop()
      seenNodeTypes.set(n.type, (seenNodeTypes.get(n.type) ?? 0) + 1)
      if (n.type === "ERROR") { errorNodes++; hadError = true }
      if (n.isMissing) missingNodes++
      for (let i = 0; i < n.childCount; i++) stack.push(n.child(i))
    }
    if (hadError) filesWithErrorNodes.add(f.label)

    // ---- instrument B, one pass over the same tree
    const dupScopes: { scope: string; seen: Map<string, number> }[] = []

    const scanScope = (container: any, scopeLabel: string): void => {
      const seen = new Map<string, number>()
      dupScopes.push({ scope: scopeLabel, seen })
      for (const c of named(container)) {
        // `rpc` is a declaration of the SERVICE scope; `message_body`/`enum_body`
        // open a scope of their own and are visited as their own container below.
        if (c.type === "message_body" || c.type === "enum_body") continue
        const k = declKey(c)
        if (!k) continue
        const cnt = (seen.get(k) ?? 0) + 1
        seen.set(k, cnt)
        if (cnt === 2) {
          if (k.startsWith("(group)")) nDupScope.groups++
          else {
            nDupScope.n++
            nDupScope.files.add(f.label)
            if (nDupScope.ex.length < 8) nDupScope.ex.push(`${scopeLabel}: ${k} declared twice in ${f.label}`)
          }
        }
      }
    }

    const visitDecl = (n: any): void => {
      // Construct counters read NAMED nodes only. The grammar gives several of
      // these rules a NAMED node AND an anonymous keyword token of the same type
      // — `import`, `extend`, `message`, `option`, `oneof` all do — so an
      // unfiltered walk counts every construct exactly twice. Measured 2026-10-03:
      // the first version of this probe reported 2,234 import nodes across the
      // corpus against 1,117 that `parseFile` actually records, and the 2:1 ratio
      // held in every file checked. The inventory walk below is deliberately NOT
      // filtered, because an anonymous token is part of the grammar's vocabulary.
      if (!n.isNamed) return
      const nm = declName(n)
      if (n.type === "import") {
        nImport.n++; nImport.files.add(f.label)
        if (nImport.ex.length < 8) nImport.ex.push(`${f.label}: ${JSON.stringify(n.text).slice(0, 70)}`)
        let mod: string | null = null
        for (const c of n.children) if (c && !c.isNamed && (c.text === "public" || c.text === "weak" || c.text === "option")) { mod = c.text; break }
        if (mod === "public") { nImportPublic.n++; nImportPublic.files.add(f.label); if (nImportPublic.ex.length < 8) nImportPublic.ex.push(`${f.label}: ${JSON.stringify(n.text).slice(0, 70)}`) }
        if (mod === "weak") { nImportWeak.n++; nImportWeak.files.add(f.label) }
      } else if (n.type === "option") {
        // Scope: the parent node decides it, read off the tree. `option` appears at
        // file scope and inside message / enum / service / rpc / field / enum_field /
        // oneof, and ONLY the file-scope ones are currently read (into
        // `metadata.fileOptions`); every declaration-scoped one is read nowhere.
        const scope = n.parent?.type ?? "(none)"
        nOption.byScope.set(scope, (nOption.byScope.get(scope) ?? 0) + 1)
        if (scope === "source_file") nOption.file++
        else {
          nOption.decl++
          nOption.declFiles.add(f.label)
          if (nOption.declEx.length < 8) nOption.declEx.push(`${f.label}:${n.startPosition.row + 1} [in ${scope}] ${JSON.stringify(n.text).slice(0, 64)}`)
        }
        nOption.files.add(f.label)
        // A CUSTOM option names an EXTENSION TYPE: `(my.opt)`. The test is
        // STRUCTURAL and positional — the option's `_option_name` rule (an inlined
        // hidden rule) makes the FIRST name element either a bare `identifier` or a
        // parenthesised `full_ident`, and a LATER element may also be parenthesised
        // (`features.(pb.cpp).repeated_type`, patch 6). So "is custom" is decided by
        // the first `(` token appearing before the first `.` token, never by reading
        // the option's text: a mere "contains a paren" test counts editions feature
        // options as custom and inflates the number.
        const kids = n.children.filter((c: any) => c && !c.isNamed)
        const firstParen = kids.findIndex((c: any) => c.text === "(")
        const firstDot = kids.findIndex((c: any) => c.text === ".")
        const custom = firstParen >= 0 && (firstDot < 0 || firstParen < firstDot)
        if (custom) {
          nOption.custom++
          nOption.customFiles.add(f.label)
          const key = `${scope}`
          nOption.customByScope.set(key, (nOption.customByScope.get(key) ?? 0) + 1)
          if (nOption.customEx.length < 8) nOption.customEx.push(`${f.label}:${n.startPosition.row + 1} [in ${scope}] ${JSON.stringify(n.text).slice(0, 64)}`)
        }
      } else if (n.type === "extend") {
        nExtend.n++; nExtend.files.add(f.label)
        if (nExtend.ex.length < 8) nExtend.ex.push(`${f.label}: ${JSON.stringify(n.text).slice(0, 70)}`)
      } else if (n.type === "block_lit") {
        // protobuf's AGGREGATE LITERAL: `{ field: value … }`. It is the only place a
        // .proto file writes a VALUE OF A MESSAGE TYPE, so it is the construct an
        // `instantiates` edge would have to come from. Counted with its parent chain
        // so the report can say WHERE the value is written.
        nBlock.n++
        const scope = n.parent?.type ?? "(none)"
        nBlock.byScope.set(scope, (nBlock.byScope.get(scope) ?? 0) + 1)
        if (nBlock.ex.length < 8) nBlock.ex.push(`${f.label}:${n.startPosition.row + 1} [in ${scope}] ${JSON.stringify(n.text).slice(0, 64)}`)
      } else if (n.type === "type") {
        const inner = namedOfType(n, "message_or_enum_type")[0]
        if (inner) { nMsgTyped.n++; nMsgTyped.files.add(f.label); if (nMsgTyped.ex.length < 8) nMsgTyped.ex.push(`${n.parent?.type ?? "?"}: ${inner.text} (${f.label}:${n.startPosition.row + 1})`) }
        else nScalarTyped.n++
      } else if (n.type === "message") {
        nMessage.n++
      } else if (n.type === "service") {
        nService.n++; nService.files.add(f.label)
      }
      void nm
    }

    scanScope(root, `file scope of ${f.label}`)
    const walk = (n: any): void => {
      visitDecl(n)
      if (n.type === "message" || n.type === "enum" || n.type === "service") {
        const nm = declName(n)
        for (const b of named(n)) {
          if (b.type === "message_body" || b.type === "enum_body") scanScope(b, `${n.type} ${nm ?? "?"} in ${f.label}`)
        }
      }
      for (let i = 0; i < n.childCount; i++) walk(n.child(i))
    }
    walk(root)
    tree.delete?.()
  }

  // ---- assemble B probes
  probes.push({
    type: "imports", instrument: "B:parse-tree-count",
    describe: "a file-to-file dependency: `import [public|weak|option] \"path\";`",
    count: nImport.n, files: nImport.files.size, examples: nImport.ex,
    probe: "count `import` NODES on the parse tree. An `import` node is structural, so a path written inside a string or a comment cannot produce one. Overturn: count > 0 while the analyzer emits no `imports` relationship.",
    alsoCounted: { weakImports: nImportWeak.n, weakFiles: nImportWeak.files.size },
  })
  probes.push({
    type: "exports", instrument: "B:parse-tree-count",
    describe: "a RE-EXPORT: `import public \"x.proto\";` — the importing file passes x's symbols on to its own importers, which is protobuf's only re-export construct",
    count: nImportPublic.n, files: nImportPublic.files.size, examples: nImportPublic.ex,
    probe: "count `import` nodes carrying the ANONYMOUS token `public` as a child, read off the tree. Overturn: count > 0 while the analyzer emits no `exports` relationship.",
  })
  probes.push({
    type: "overrides", instrument: "B:parse-tree-count",
    describe: "a second declaration of a name already declared in the SAME scope — protobuf has no inheritance, so replacing a prior declaration is the only sense of `overrides` the language has",
    count: nDupScope.n, files: nDupScope.files.size, examples: nDupScope.ex,
    probe: "collect declaration names per scope from the tree (file scope, each message_body, each enum_body, each service) and count every name declared twice in one scope. proto2 `group` is counted on its own axis and EXCLUDED here, because a group legitimately declares a nested type and a field of the same name. Overturn: count > 0 while the analyzer emits no `overrides` relationship.",
    alsoCounted: { groupDeclarationsExcluded: nDupScope.groups },
  })
  probes.push({
    type: "instantiates", instrument: "B:parse-tree-count",
    describe: "a declaration that PRODUCES a message-typed value — a field, a map value, a oneof case or an rpc payload whose type is a message rather than a scalar keyword",
    count: nMsgTyped.n, files: nMsgTyped.files.size, examples: nMsgTyped.ex,
    probe: "count `type` nodes that contain a `message_or_enum_type` child (a reference, i.e. a message-typed declaration) against those that do not (a scalar keyword). This is the same STRUCTURAL test the analyzer uses, so the count cannot disagree with the analyzer by reading text. Overturn: message-typed declarations > 0 while the analyzer emits no `instantiates` relationship.",
    alsoCounted: {
      scalarTypedDeclarations: nScalarTyped.n,
      aggregateLiterals: nBlock.n,
      aggregateLiteralsByParentNode: Object.fromEntries([...nBlock.byScope.entries()].sort((a, b) => b[1] - a[1])),
    },
  })
  probes.push({
    type: "custom-options", instrument: "B:parse-tree-count",
    describe: "a CUSTOM option: `option (my.opt) = …;` — the enclosing declaration names an extension type, a type reference protobuf expresses and the analyzer currently reads nowhere",
    count: nOption.custom, files: nOption.customFiles.size, examples: nOption.customEx,
    probe: "count `option` nodes with the ANONYMOUS token `(` as a direct child, which is what makes an option CUSTOM (a builtin option name is a bare identifier or a dotted name with no parens). Overturn: count > 0 while the analyzer emits no edge naming the option's type.",
    alsoCounted: {
      fileLevelOptions: nOption.file,
      declarationLevelOptions: nOption.decl,
      filesWithDeclarationLevelOptions: nOption.declFiles.size,
      filesWithAnyOption: nOption.files.size,
      optionsByParentNode: Object.fromEntries([...nOption.byScope.entries()].sort((a, b) => b[1] - a[1])),
      customOptionsByParentNode: Object.fromEntries([...nOption.customByScope.entries()].sort((a, b) => b[1] - a[1])),
    },
  })

  // ---- A probes, now that the observed vocabulary is known
  addA("calls", "a function definition or a call expression — no .proto file has an executable body",
    ["function_definition", "method_definition", "call_expression", "call", "function_body", "block", "expression_statement", "argument_list", "body_statement"])
  addA("extends", "a superclass clause — protobuf has no inheritance",
    ["extends_clause", "superclass", "class_declaration", "interface_declaration", "struct_declaration", "inheritance_specifier", "base_class", "class_heritage"])
  addA("implements", "an interface-implementation clause",
    ["implements_clause", "superclass", "interface_implementation", "protocol_reference_list", "base_class"])
  addA("references", "a node that names a type in a NON-declaring position — the sibling IDL lane (graphql) also emits no `references`, labelling a type reference `uses` instead",
    ["type_identifier", "reference", "identifier_reference", "scoped_identifier", "qualified_identifier", "type_annotation"])

  probes.push({
    type: "extend", instrument: "B:parse-tree-count",
    describe: "an `extend Foo { … }` block — protobuf's ONLY way a type gains members declared in another file, and the construct whose members the analyzer re-attributes onto the extended type",
    count: nExtend.n, files: nExtend.files.size, examples: nExtend.ex,
    probe: "count `extend` nodes on the parse tree. Overturn: count > 0 with no member re-attributed onto the extended type.",
  })
  probes.push({
    type: "services", instrument: "B:parse-tree-count",
    describe: "a `service` declaration — the only declaration with operations in protobuf",
    count: nService.n, files: nService.files.size, examples: [],
    probe: "count `service` nodes on the parse tree. Reported because `calls` is ruled on the grammar and a service is where a reader would look for the substitute; the count says how much rpc surface exists at all.",
  })
  probes.push({
    type: "messages", instrument: "B:parse-tree-count",
    describe: "a `message` declaration — protobuf's record type",
    count: nMessage.n, files: 0, examples: [],
    probe: "count `message` nodes on the parse tree.",
  })
}

// ------------------------------------------------------------------ report
const out: any = {
  at: new Date().toISOString(),
  corpusRoot: CR,
  filesAdmitted: files.length,
  instrumentA: {
    declaredNodeTypesFromWasm: [...declaredNodeTypes].sort(),
    declaredFieldNamesFromWasm: [...declaredFields].sort(),
    observedNodeTypesAcrossCorpus: Object.fromEntries([...seenNodeTypes.entries()].sort((a, b) => b[1] - a[1])),
    observedDistinctNodeTypeCount: seenNodeTypes.size,
    errorNodes,
    missingNodes,
    filesWithErrorNodes: [...filesWithErrorNodes],
  },
  probes,
}
writeFileSync(OUT, JSON.stringify(out, null, 2))

const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`\ncorpus ${files.length} files   distinct node types OBSERVED ${seenNodeTypes.size}   declared by wasm ${declaredNodeTypes.size}   field names ${declaredFields.size}   ERROR ${errorNodes}   MISSING ${missingNodes}   files with ERROR ${filesWithErrorNodes.size}`)
console.log(`\n${w("type", 15)}${w("instrument", 22)}${w("count", 9)}${w("files", 7)}also`)
console.log("-".repeat(120))
for (const p of probes) {
  console.log(`${w(p.type, 15)}${w(p.instrument, 22)}${w(String(p.count), 9)}${w(String(p.files), 7)}${JSON.stringify(p.alsoCounted ?? {})}`)
}
console.log(`\nwrote ${OUT}`)