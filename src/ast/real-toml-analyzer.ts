/**
 * TOML analyzer — M14 (#289).
 *
 * Enters a lane that had a grammar and nothing else: `toml` was absent from
 * `getAnalyzer`, so a `.toml` file was walked by the generic AST fallback and a
 * ten-line Cargo.toml published **28 symbols and 0 relationships**, every one of
 * them `kind=variable` with `owner=null`. Eleven of those 28 names contained
 * whitespace — one was literally `[package]\nname = "demo"\nversion = "0.1.0"\n\n`
 * — and two collided. A name is an identity, and source text is not one.
 *
 * ## The rulings
 *
 * **TOML-IDENTITY — a symbol is the FILE, a TABLE, or a KEY.** The file is the
 * `module`; every `[table]` and `[[array-of-tables]]` header is a symbol; every
 * `key = value` is a symbol whose owner is the table that declares it. Keys are
 * symbols because a key is what a consumer actually targets: `cargo build
 * --features X` reaches `features.X`, and a graph that cannot name that is a
 * graph of the file rather than of the document.
 *
 * **A symbol's NAME is its full dotted path from the document root.**
 * `[workspace.lints.rust]` is ONE symbol named `workspace.lints.rust`, and the
 * key `rust-version` inside it is `workspace.package.rust-version`. Not the last
 * segment: cargo's own `[workspace.lints.rust]` and `[workspace.lints.rustdoc]`
 * both end in a distinct segment but `[package]` and a `[[bin]]` element both
 * contain a key literally named `name`, so a leaf-only name collides in the very
 * first manifest anyone would write. The full path is also what makes the file's
 * names unique, which is the property the html lane needed its suffix rule for.
 *
 * **IMPLIED PARENTS ARE RECORDED, NOT MATERIALISED.** `[a.b.c]` implies `a` and
 * `a.b` whether or not the file declares them. Fabricating symbols for headers
 * the file never wrote is a guess dressed as a fact, so the table records them
 * in `metadata.impliedParents` and the graph stays honest about what was written.
 *
 * **AN INLINE TABLE'S KEYS ARE NOT SYMBOLS.** `x = { a = 1, b = "two" }` makes `x`
 * the symbol; `a` and `b` are part of a single value expression. A Cargo.toml with
 * 200 dependencies declared as `{ version = "...", features = [...] }` would
 * otherwise publish 600+ symbols naming nothing a consumer can navigate to on its
 * own. The key NAMES are still recorded on the enclosing key's
 * `metadata.inlineKeys`, so nothing is lost — it is a scoping decision, not a
 * deletion.
 *
 * **TOML'S RELATIONSHIP VOCABULARY IS `contains`, AND THAT IS THE WHOLE TRUTH.**
 * Unlike html there is no second type to emit, and inventing one would be worse
 * than a thin graph. A value like `path = "src/main.rs"` is a *string*, and
 * treating path-shaped strings as references would import ecosystem knowledge
 * (which keys are paths in which tool) into a format that has none: TOML defines
 * no include, no import and no reference mechanism at all. So there is no `uses`,
 * and `extends`/`implements`/`instantiates`/`overrides`/`exports` are absent for
 * the same reason they are absent from html — no construct produces them.
 *
 * Pure-String throughout: `segmentsOf`, `joinPath`, `asciiLower` are index loops.
 * No regex, no source-text scraping — the analyzer reads AST nodes and never the
 * file's characters.
 */
import * as path from "path"
import { ASTEngine } from "./engine"
import type { Node } from "web-tree-sitter"

/** TOML's bare-key alphabet is A-Za-z0-9_-; a quoted key is anything in quotes. */
function isBareKeyChar(code: number): boolean {
  return (
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) || // a-z
    (code >= 48 && code <= 57) || // 0-9
    code === 95 || // _
    code === 45 // -
  )
}

function asciiLower(text: string): string {
  let out = ""
  let changed = false
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c >= 65 && c <= 90) {
      out += text[i].toLowerCase()
      changed = true
    } else out += text[i]
  }
  return changed ? out : text
}

/**
 * Strip one layer of TOML quoting from a `quoted_key` / `string` node's text.
 *
 * A quoted key may be a basic string (`"a.b"`) or a literal string (`'a.b'`), and
 * the QUOTES ARE PART OF ITS SPAN — so without this a key named `a.b` and a key
 * named `"a.b"` would be the same symbol, and the second would silently shadow
 * the first. A literal string has no escapes, so it is a pure slice; a basic
 * string unescapes only the forms that can appear in a key.
 */
function unquoteKey(text: string): string {
  if (text.length < 2) return text
  const first = text.charCodeAt(0)
  if (first !== 34 && first !== 39) return text // 34 `"`, 39 `'`
  const inner = text.slice(1, -1)
  if (first === 39) return inner // literal string: no escapes at all
  let out = ""
  for (let i = 0; i < inner.length; i++) {
    const c = inner.charCodeAt(i)
    if (c !== 92) {
      out += inner[i]
      continue
    }
    // A backslash: the only escapes a KEY can carry are the ones TOML defines, and
    // an unknown one is passed through rather than dropped — silently discarding
    // half a key would invent a different identity.
    const n = inner.charCodeAt(i + 1)
    i++
    if (n === 110) out += "\n" // \n
    else if (n === 116) out += "\t" // \t
    else if (n === 114) out += "\r" // \r
    else if (n === 34) out += '"' // \"
    else if (n === 92) out += "\\" // \\
    else if (n === 117 || n === 85) {
      // \uXXXX — four hex digits, pure-String.
      const hex = inner.slice(i + 1, i + 5)
      if (hex.length === 4) {
        const v = Number.parseInt(hex, 16)
        if (Number.isFinite(v)) {
          out += String.fromCharCode(v)
          i += 4
          continue
        }
      }
      out += "\\u"
    } else {
      out += "\\"
      out += inner[i] ?? ""
    }
  }
  return out
}

/**
 * The SEGMENTS of a key node, outermost first.
 *
 * The grammar nests `dotted_key` left-associatively: `a.b.c` is
 * `dotted_key(dotted_key(dotted_key(a, b), c))` flattened to `dotted_key(a, dotted_key(b, c))`
 * in practice, so this walks down the FIRST child until it reaches a leaf key and
 * then unwinds. Recursion is bounded by the key's segment count, and a key with
 * 10,000 segments would be a file no tool can read — but the walk is iterative
 * anyway, so a pathological key cannot overflow the stack.
 */
function segmentsOf(node: Node): string[] {
  // Collect the dotted_key chain from the root down.
  const chain: Node[] = []
  let cur: Node = node
  while (cur.type === "dotted_key") {
    chain.push(cur)
    const first = ((cur.namedChildren ?? []) as Node[])[0]
    if (!first) break
    cur = first
  }
  const out: string[] = []
  if (cur.type === "bare_key" || cur.type === "quoted_key") out.push(unquoteKey(cur.text))
  // Unwind: the deepest node contributed the FIRST segment, each level adds one.
  for (let i = chain.length - 1; i >= 0; i--) {
    const kids = chain[i].namedChildren ?? []
    const rest: Node | undefined = kids.length > 0 ? (kids[kids.length - 1] as Node) : undefined
    if (rest && (rest.type === "bare_key" || rest.type === "quoted_key")) {
      out.push(unquoteKey(rest.text))
    } else if (rest) {
      // A nested dotted_key we already consumed via the chain.
      for (const seg of segmentsOf(rest)) out.push(seg)
    }
  }
  return out.filter((s) => s.length > 0)
}

/**
 * Assemble a key's dotted path, re-quoting any segment that would otherwise be
 * ambiguous.
 *
 * A flat dotted path is only a faithful name if the segments can be read back.
 * Inside `[t]`, the bare key `a.b.c` and the quoted key `"a.b".c` are DIFFERENT TOML
 * keys — the first is the table `a` holding `b` holding `c`, the second is a table
 * whose name is literally `a.b`. Assembled naively both produce `t.a.b.c`, and the
 * collision is not cosmetic: the dedupe then invents `t.a.b.c#2`, which asserts
 * that the document declared one key twice when it declared two distinct ones.
 * That is the unresolvable-identity class arriving through the naming scheme
 * rather than through a missing edge.
 *
 * So a segment containing a dot — or a quote, or a backslash — is written back the
 * way TOML itself disambiguates it, in quotes. The name then round-trips: `a.b.c`
 * stays bare, `"a.b".c` keeps its quotes, and the two can never be confused. This
 * is the document's own spelling rather than an invented escape syntax.
 */
function joinPath(segments: string[]): string {
  let out = ""
  for (let i = 0; i < segments.length; i++) {
    if (i > 0) out += "."
    out += spellSegment(segments[i])
  }
  return out
}

/** Spell ONE path segment: bare when TOML permits it, quoted otherwise.
 *
 *  The question is the SPEC's — may this segment be written BARE? — rather than
 *  "does it contain punctuation". TOML's bare-key alphabet is exactly A-Za-z0-9-_
 *  and a bare key may not be empty, so anything else is quoted.
 *
 *  The distinction is not pedantic. `[target."cfg(unix)".dependencies]` is real
 *  cargo syntax, and a test for `.`/`"`/`\` alone finds no punctuation in
 *  `cfg(unix)` at all — it has parentheses — so the segment was emitted UNQUOTED
 *  as `target.cfg(unix).dependencies`. The name then read back as three nested
 *  tables when the document declares two, and an unquoted path is not a spelling
 *  TOML can parse, so the name had lost the property that makes it faithful.
 *  Found by the differential oracle on cargo's own Cargo.toml, which is the
 *  argument for deriving the rule from the specification rather than from the
 *  characters that happen to matter in the sample you tested. The same rule
 *  catches a segment containing a SPACE, which is legal quoted and illegal bare.
 */
function spellSegment(seg: string): string {
  let bare = seg.length > 0
  for (let k = 0; bare && k < seg.length; k++) {
    const c = seg.charCodeAt(k)
    bare = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 45
  }
  if (bare) return seg
  let out = '"'
  for (let k = 0; k < seg.length; k++) {
    const c = seg.charCodeAt(k)
    if (c === 34 || c === 92) out += "\\"
    out += seg[k]
  }
  return out + '"'
}

/** The value node of a `pair`, or null when the pair has none. */
function valueOf(pair: Node): Node | null {
  const kids = (pair.namedChildren ?? []) as Node[]
  // The KEY is first; the VALUE is whatever follows it. A pair with no value is a
  // parse artefact, not a TOML document.
  return kids.length > 1 ? kids[kids.length - 1] : null
}

/** The key node of a `pair` — first child, which is always a key type. */
function keyOf(pair: Node): Node | null {
  const first = (pair.namedChildren ?? [])[0] as Node | undefined
  if (!first) return null
  return first.type === "bare_key" || first.type === "quoted_key" || first.type === "dotted_key" ? first : null
}

/** The header key of a `table` / `table_array_element`. */
function headerKeyOf(node: Node): Node | null {
  for (const child of (node.namedChildren ?? []) as Node[]) {
    if (child.type === "bare_key" || child.type === "quoted_key" || child.type === "dotted_key") return child
  }
  return null
}

/** A stable, human-meaningful `resourceType`-style label for a value node. */
function valueKind(node: Node | null): string {
  if (!node) return "none"
  switch (node.type) {
    case "string":
      return "string"
    case "integer":
      return "integer"
    case "float":
      return "float"
    case "boolean":
      return "boolean"
    case "array":
      return "array"
    case "inline_table":
      return "inline-table"
    case "offset_date_time":
    case "local_date_time":
    case "local_date":
    case "local_time":
      return "datetime"
    default:
      return node.type
  }
}

export class RealTomlAnalyzer implements ASTEngine.LanguageAnalyzer {
  analyze(
    rootNode: Node,
    content: string,
    filePath: string,
    _context?: ASTEngine.AnalyzeContext,
  ): ASTEngine.ParseResult {
    // The engine hands over the PATH, not a module name — every analyzer derives
    // its own. `Cargo.toml` must be the module `Cargo`: a module whose name ends
    // in its own extension collides with nothing but reads as a filename wherever
    // it appears, and `Cargo` is what a user would search for.
    const moduleName = path.basename(filePath, path.extname(filePath)) || "document"
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const errors: ASTEngine.ParseError[] = []
    const patterns: string[] = []

    /** Per-file name allocation. TOML forbids redefining a key inside one table,
     *  but a file may still collide across constructs, and a NAME that is not
     *  unique is an identity that cannot be resolved — so allocation is tracked
     *  the same way html tracks it, including the watermark + occupancy PROBE:
     *  a document may literally declare a key called `bin#2`. */
    // The module OWNS its name in this file's name space, and relationships
    // address nodes by name, so a table that wants the same name makes every edge
    // to it ambiguous. `doc/book/book.toml` declares `[book]`, so without this the
    // module and the table are both `book` and a `contains` edge naming `book`
    // resolves to two nodes. Seeding the space makes the TABLE take the suffix
    // instead, which is the same precedence html uses (its `usedNames` starts as
    // `{ [moduleName]: 1 }`): the file's identity is derived from its PATH and is
    // not negotiable, while a document node is competing for a name that is
    // already taken. Measured on cargo: 2 such collisions in 684 files, both of the
    // form `<stem>.toml` containing `[<stem>]`.
    const usedNames: Record<string, number> = { [moduleName]: 1 }
    /** Declared table path -> allocated symbol name, in document order. */
    const declaredTables: Record<string, string> = {}
    const allocate = (want: string): string => {
      const seen = usedNames[want]
      if (seen === undefined) {
        usedNames[want] = 1
        return want
      }
      let n = seen
      let name = want
      do {
        n++
        name = `${want}#${n}`
      } while (usedNames[name] !== undefined)
      usedNames[name] = 1
      usedNames[want] = n
      return name
    }

    const range = (node: Node): ASTEngine.UniversalSymbol["range"] => ({
      startLine: node.startPosition.row + 1,
      startColumn: node.startPosition.column + 1,
      endLine: node.endPosition.row + 1,
      endColumn: node.endPosition.column + 1,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    })


    // --- Error collection ----------------------------------------------------
    // The error-recovery contract is REPORTED / BYPASSED / KEEP PUBLISHING, and
    // this analyzer was honouring only the middle and last of those on its own:
    // it pushed no diagnostics at all, so the "reported" half was entirely the
    // ENGINE's, reached through `children` rather than anything this file does.
    // That is a contract resting on a caller — the same blindness the svelte lane
    // had, in the opposite direction. Measured over the whole 743-file pool, 2
    // files (0.27%) carry an ERROR node, and the spec claimed neither ERROR nor
    // MISSING ever occurred here, from twelve hand-made malformed documents. The
    // corpus says otherwise, so this walks the tree itself and reports each
    // recovery node at its OWN span, matching what the engine will also say.
    // `children`, not `namedChild`: the expected token of a MISSING node can be
    // anonymous, and a named-only walk is blind to exactly the case it exists for.
    if (rootNode.hasError) {
      const errStack: Node[] = [rootNode]
      while (errStack.length > 0) {
        const n = errStack.pop()!
        if (n.type === "ERROR" || n.isMissing) {
          errors.push({
            message: `Syntax ${n.type} detected. The Brain Engine is bypassing this broken node.`,
            range: range(n),
            severity: "warning",
          })
        }
        for (let i = n.childCount - 1; i >= 0; i--) {
          const child = n.child(i)
          if (child) errStack.push(child)
        }
      }
    }

    // The file is the module. A TOML document is one root table, and without a
    // module every top-level key is parentless and the file has no identity.
    symbols.push({
      name: moduleName,
      kind: ASTEngine.SymbolKind.Module,
      range: range(rootNode),
      scope: "",
      visibility: "public",
      ownerName: undefined,
      ownerKind: undefined,
      metadata: {
        tomlSpecific: true,
        isDocumentRoot: true,
        evidenceClass: "structural",
      },
    })

    let tableCount = 0
    let keyCount = 0
    let arrayOfTablesCount = 0
    let inlineTableCount = 0
    let maxDepth = 0

    /**
     * The nearest DECLARED ancestor of `segments`, which is the owner a table
     * reports. Walks the path prefix by prefix — O(depth), not O(declared) — and
     * returns the implied parents it passed over, so a header like `[a.b.c]` in a
     * file that never declares `a` records `a` and `a.b` as implied rather than
     * inventing symbols for them.
     */
    const resolveOwner = (
      segments: string[],
    ): { owner: string; implied: string[] } => {
      const implied: string[] = []
      let owner = moduleName
      // Accumulate the SEGMENTS and let `joinPath` do the spelling, rather than
      // concatenating strings here. An intermediate version split an already-joined
      // path on `.` to recover the segments, which is unsound for the same reason
      // indexing a raw string with decoded offsets was: a QUOTED segment contains
      // dots, so `target."cfg(windows)".dependencies`.split(".") cuts inside it and
      // returns fragments with unbalanced quotes. The segment array is the truth;
      // the joined string is only ever produced by the one function that owns it.
      const acc: string[] = []
      // The prefix MUST be assembled by the SAME function that keys
      // `declaredTables`, and it was not. `declaredTables` is keyed by `joinPath`,
      // which re-quotes any segment that cannot be written bare, while this built
      // its prefixes from the raw segments — so a lookup for
      // `target.cfg(windows).dependencies` never matched the stored
      // `target."cfg(windows)".dependencies` and the declared ancestor was
      // reported as implied. The visible effect was on cargo's OWN Cargo.toml,
      // where `[target.'cfg(windows)'.dependencies.windows-sys]` on line 254 was
      // filed under the module instead of under the `[target.'cfg(windows)'.
      // dependencies]` declared three lines earlier. The symbol's NAME was right —
      // it came from the emit path, which does use `joinPath` — so only the
      // CONTAINMENT was wrong, which is precisely the class of defect a
      // hand-written fixture misses and a differential finds: two paths through
      // the same file building the same key differently.
      for (let i = 0; i < segments.length - 1; i++) {
        acc.push(segments[i])
        const prefix = joinPath(acc)
        const declared = declaredTables[prefix]
        if (declared !== undefined) owner = declared
        else implied.push(prefix)
      }
      return { owner, implied }
    }

    /**
     * Emit a key symbol. `path` is its FULL dotted path from the document root,
     * which is what makes the file's names unique without a synthetic suffix on
     * every collision.
     */
    const emitKey = (pair: Node, path: string, owner: string): void => {
      const keyNode = keyOf(pair)
      if (!keyNode) return
      const name = allocate(path)
      const value = valueOf(pair)
      const inlineKeys: string[] = []
      if (value && value.type === "inline_table") {
        inlineTableCount++
        for (const child of (value.namedChildren ?? []) as Node[]) {
          const ck = keyOf(child)
          if (ck) inlineKeys.push(joinPath(segmentsOf(ck)))
        }
      }
      const line = keyNode.startPosition.row + 1
      symbols.push({
        name,
        kind: ASTEngine.SymbolKind.Property,
        range: range(pair),
        scope: "",
        visibility: "public",
        ownerName: owner,
        ownerKind: owner === moduleName ? ASTEngine.SymbolKind.Module : ASTEngine.SymbolKind.Namespace,
        metadata: {
          tomlSpecific: true,
          isDocumentRoot: owner === moduleName,
          keyText: joinPath(segmentsOf(keyNode)),
          valueType: valueKind(value),
          ...(inlineKeys.length > 0 ? { inlineKeys } : {}),
          evidenceClass: "structural",
        },
      })
      relationships.push({
        source: owner,
        target: name,
        type: ASTEngine.RelationshipType.Contains,
        confidence: 1.0,
        line_number: line,
        metadata: {
          tomlSpecific: true,
          isKeyContainment: true,
          evidenceClass: "structural",
        },
      })
      keyCount++
    }

    // The document's children are its sections and its implicit-root keys. TOML
    // tables are FLAT sections — a `table` never contains another `table` — so
    // this walk is one level deep and needs no stack at all.
    for (const node of (rootNode.namedChildren ?? []) as Node[]) {
      if (node.type === "table" || node.type === "table_array_element") {
        const header = headerKeyOf(node)
        if (!header) continue
        const segments = segmentsOf(header)
        if (segments.length === 0) continue
        const path = joinPath(segments)
        const { owner, implied } = resolveOwner(segments)
        const isArray = node.type === "table_array_element"
        if (isArray) arrayOfTablesCount++
        // The name is the full path, suffixed only on a genuine collision (two
        // `[[bin]]` blocks), and the CHILDREN use the allocated name so a key
        // under the second `[[bin]]` is distinct from the first's.
        const name = allocate(path)
        declaredTables[path] = name
        tableCount++
        if (segments.length > maxDepth) maxDepth = segments.length
        symbols.push({
          name,
          kind: ASTEngine.SymbolKind.Namespace,
          // The section's whole span, from its `[` to the line before the next
          // header — which is exactly the region its keys live in, so a key's
          // range is inside its table's and containment is checkable.
          range: range(node),
          scope: "",
          visibility: "public",
          ownerName: owner,
          ownerKind: owner === moduleName ? ASTEngine.SymbolKind.Module : ASTEngine.SymbolKind.Namespace,
          metadata: {
            tomlSpecific: true,
            isDocumentRoot: owner === moduleName,
            isArrayOfTables: isArray,
            headerText: header.text,
            keyPath: path,
            ...(implied.length > 0 ? { impliedParents: implied } : {}),
            evidenceClass: "structural",
          },
        })
        relationships.push({
          source: owner,
          target: name,
          type: ASTEngine.RelationshipType.Contains,
          confidence: 1.0,
          line_number: node.startPosition.row + 1,
          metadata: {
            tomlSpecific: true,
            isTableHeader: true,
            isArrayOfTables: isArray,
            ...(implied.length > 0 ? { hasImpliedParents: true } : {}),
            evidenceClass: "structural",
          },
        })
        // The section's own key/value pairs. Comments and nested values are not
        // descended into — see the inline-table ruling.
        for (const child of (node.namedChildren ?? []) as Node[]) {
          if (child.type !== "pair") continue
          const ck = keyOf(child)
          if (!ck) continue
          emitKey(child, `${name}.${joinPath(segmentsOf(ck))}`, name)
        }
      } else if (node.type === "pair") {
        // A key before any header belongs to the implicit root table.
        const ck = keyOf(node)
        if (!ck) continue
        const segs = segmentsOf(ck)
        if (segs.length === 0) continue
        emitKey(node, joinPath(segs), moduleName)
        if (segs.length > maxDepth) maxDepth = segs.length
      }
    }

    // Structural observations, published as `patterns` so a consumer can see the
    // document's SHAPE without re-parsing it. None of these is a defect claim.
    if (arrayOfTablesCount > 0) patterns.push(`array-of-tables x${arrayOfTablesCount}`)
    if (inlineTableCount > 0) patterns.push(`inline-tables x${inlineTableCount}`)

    return {
      language: "toml",
      symbols,
      relationships,
      imports: [],
      exports: [],
      errors,
      rawContent: content,
      metadata: {
        // Structural depth is the DEEPEST key path, not a node count: a flat
        // document with 10,000 sibling keys is not deeper than one with three
        // levels, and reporting the former as complexity would be meaningless.
        complexity: maxDepth,
        linesOfCode: content.split("\n").length,
        cyclomaticComplexity: 1 + tableCount,
        framework: "TOML",
        patterns,
        detectedFrameworks: [],
        frameworkPatterns: [],
        architecturalInsights: [],
        architecturalScore: 0,
        codeQuality: "unknown",
        hasTypeInference: false,
        hasFrameworkIntelligence: false,
        analysisVersion: "m14-toml-identity-v1",
        documentMetrics: {
          tableCount,
          keyCount,
          arrayOfTablesCount,
          inlineTableCount,
          maxKeyPathDepth: maxDepth,
        },
      },
    }
  }
}
