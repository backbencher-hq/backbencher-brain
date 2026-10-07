// SVELTE TRUTH — the lane's OWN relationship-ontology derivation.
//
// WHY THIS FILE EXISTS. The M60 relationship-type coverage gate reports, live:
//     CHECK 1 — DERIVATION: svelte 2 un-audited: ["contains","uses"]
// i.e. on the whole svelte graph `contains` and `uses` are STORED AND COMPARED
// AGAINST NOTHING. `script/m60/rel-type-coverage-gate.ts` reads a lane's audited
// label set from `script/m14/<lang>-truth.ts` when that file exports
// `<NAME>_ORACLE_LABELS`, and that per-lane export WINS over the shared filter in
// `script/m14/differential.ts` — the ruby lane is the precedent, and the gate
// documents why (a lane whose oracle has moved out of the shared file would
// otherwise report a STALE set as a current one).
//
// So this file supplies the derivation the gate is asking for, and it supplies
// the DERIVATION, not a label list: `deriveSvelteTruth` walks the same two
// grammars the analyzer walks (tree-sitter-svelte for the template,
// tree-sitter-javascript/typescript for each <script> body) and derives
// `contains` and `uses` from the trees alone. It never imports the analyzer.
//
// WHAT IT IS NOT, stated plainly: this is a SECOND READER OF THE SAME GRAMMAR,
// not a second opinion about the grammar. A construct the pinned
// tree-sitter-svelte cannot express is invisible to both sides, and the svelte
// grammar additionally exposes every template expression as an opaque
// `svelte_raw_text` leaf — so the template half of `uses` below must scan
// expression TEXT, which is the documented fallback for a grammar-opaque
// construct, not a claim of independence from it.
//
// NO REGEX ANYWHERE (master rule 1): node.type, node field names, and explicit
// character walks only.
//
//   bun script/m14/svelte-truth.ts --compare [files=200] [corpus=<dir>]
//   bun script/m14/svelte-truth.ts --labels

import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = process.env.BB_REPO || path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..")

/**
 * The labels this module can actually derive. The gate compares this list with
 * the types `src/ast/real-svelte-analyzer.ts` can construct; a label in one and
 * not the other is a DERIVATION finding, which is the whole point of exporting
 * it. The five heritage/call labels are the ones the shared differential filter
 * already grants svelte; `contains` and `uses` are the two this file adds.
 */
export const SVELTE_ORACLE_LABELS: string[] = [
  "extends",
  "implements",
  "instantiates",
  "overrides",
  "calls",
  "contains",
  "uses",
]

export interface SvelteTruthEdge {
  label: string
  from: string
  target: string
  /** Why the edge is derivable — printed when the two sides disagree. */
  because: string
}

// ---------------------------------------------------------------------------
// AST helpers (node types and field names only)
// ---------------------------------------------------------------------------

function namedChildren(n: any): any[] {
  const out: any[] = []
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c) out.push(c)
  }
  return out
}
function field(n: any, name: string): any {
  try {
    return n.childForFieldName ? n.childForFieldName(name) : null
  } catch {
    return null
  }
}
function childOfType(n: any, type: string): any {
  for (const c of namedChildren(n)) if (c.type === type) return c
  return null
}
function descendants(n: any, out: any[] = []): any[] {
  const stack = [n]
  while (stack.length) {
    const m = stack.pop()!
    out.push(m)
    for (let i = m.namedChildCount - 1; i >= 0; i--) {
      const c = m.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return out
}
function attrName(a: any): string {
  for (const c of namedChildren(a)) if (c.type === "attribute_name") return c.text
  return ""
}
function attrValue(a: any): string {
  const stack = [a]
  while (stack.length) {
    const n = stack.pop()!
    if (n.type === "attribute_value") return n.text
    for (const c of namedChildren(n)) stack.push(c)
  }
  return ""
}

// ---------------------------------------------------------------------------
// Character walk over an opaque template expression.
//
// The grammar hands template expressions over as one `svelte_raw_text` leaf, so
// there is nothing else to walk. This scanner is written to the CONTRACT, not to
// the analyzer's helper: it skips string and template-literal CONTENTS, skips
// comments, skips member-chain LEAVES (a `.name` read is the receiver's member,
// not a component member) and reports each remaining identifier with the line it
// is written on.
// ---------------------------------------------------------------------------

const IDENT_START = (c: string): boolean =>
  (c >= "A" && c <= "Z") || (c >= "a" && c <= "z") || c === "_" || c === "$"
const IDENT_PART = (c: string): boolean => IDENT_START(c) || (c >= "0" && c <= "9")
const SPACE = (c: string): boolean => c === " " || c === "\t" || c === "\n" || c === "\r"

export interface TextScan {
  /** identifier -> the line (base + breaks before it) it is written on */
  names: Map<string, number>
  /** every identifier seen, shadowed ones included, for the binding analysis */
  allNames: string[]
}

export function scanExpression(text: string, baseLine: number): TextScan {
  const names = new Map<string, number>()
  const allNames: string[] = []
  const stack: string[] = []
  const breaksBefore = (end: number): number => {
    let n = 0
    for (let i = 0; i < end && i < text.length; i++) if (text[i] === "\n") n++
    return n
  }
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    const top = stack.length ? stack[stack.length - 1] : ""
    if (top === "'" || top === '"') {
      if (ch === "\\") {
        i += 2
        continue
      }
      if (ch === top) stack.pop()
      i++
      continue
    }
    if (top === "`") {
      if (ch === "\\") {
        i += 2
        continue
      }
      if (ch === "$" && text[i + 1] === "{") {
        stack.push("${")
        i += 2
        continue
      }
      if (ch === "`") {
        stack.pop()
        i++
        continue
      }
      i++
      continue
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      stack.push(ch)
      i++
      continue
    }
    if (ch === "{") {
      stack.push("{")
      i++
      continue
    }
    if (ch === "}") {
      if (top === "{" || top === "${") stack.pop()
      i++
      continue
    }
    if (ch === "/" && (text[i + 1] === "/" || text[i + 1] === "*")) {
      if (text[i + 1] === "/") {
        const nl = text.indexOf("\n", i + 2)
        i = nl >= 0 ? nl + 1 : text.length
      } else {
        const end = text.indexOf("*/", i + 2)
        i = end >= 0 ? end + 2 : text.length
      }
      continue
    }
    if (!IDENT_START(ch)) {
      i++
      continue
    }
    let j = i + 1
    while (j < text.length && IDENT_PART(text[j])) j++
    const word = text.slice(i, j)
    allNames.push(word)
    let k = i - 1
    while (k >= 0 && SPACE(text[k])) k--
    const prev = k >= 0 ? text[k] : ""
    if (prev !== "." && prev !== "#") names.set(word, baseLine + breaksBefore(i))
    i = j
  }
  return { names, allNames }
}

// ---------------------------------------------------------------------------
// The derivation
// ---------------------------------------------------------------------------

export interface SvelteTruthResult {
  edges: SvelteTruthEdge[]
  /** names the component owns (the `contains` targets) */
  owned: string[]
  /** names a template read can resolve to (the `uses` source side) */
  members: string[]
  /** template-local bindings, i.e. names a read must NOT publish */
  locals: string[]
  blocks: number
  componentName: string
}

export function deriveSvelteTruth(
  root: any,
  content: string,
  filePath: string,
  scriptTrees: any[],
  scriptLangs: string[],
): SvelteTruthResult {
  const componentName = path.basename(filePath, path.extname(filePath))
  const edges: SvelteTruthEdge[] = []
  const owned = new Set<string>()
  const members = new Set<string>()
  const locals = new Set<string>()
  const blocks: number[] = []

  // ---- script half: what the component owns, and what a read can name -------
  const imports = new Set<string>()
  scriptTrees.forEach((sub: any, bi: number) => {
    if (!sub || !sub.rootNode) return
    const lang = scriptLangs?.[bi] ?? "js"
    const isModuleBlock = isModuleContext(root, bi)
    const prog = sub.rootNode
    blocks.push(bi)
    // A top-level `export const X = …` / `export function f()` /
    // `export type T = …` puts the DECLARATION inside an `export_statement`, so a
    // reader that only looks at the program's direct children never sees it. That
    // is not a corner case: it is how a Svelte component publishes its module
    // API, and how `docs/src/lib/registry/ui/toggle/toggle.svelte` declares
    // `toggleVariants` — 14 shadcn-svelte files read such a name in their
    // template, and every one of those reads came back unexplained before this.
    // `decl` is the declaration a top-level child stands for; `isExport` says
    // whether an `export_statement` introduced it.
    for (const top of namedChildren(prog)) {
      const decl = top.type === "export_statement" ? (namedChildren(top)[0] ?? top) : top
      const isExportedTop = top.type === "export_statement"
      const n = decl
      const t = n.type
      // top-level BINDINGS: what a template read can name
      if (t === "import_statement") {
        for (const s of descendants(n)) {
          if (s.type === "import_clause" || s.type === "identifier" || s.type === "namespace_import") {
            if (s.type === "identifier") imports.add(s.text)
            if (s.type === "namespace_import") {
              const id = childOfType(s, "identifier")
              if (id) imports.add(id.text)
            }
          }
        }
        const src = childOfType(n, "string")
        if (src) {
          for (const s of descendants(n)) {
            if (s.type === "import_specifier" || s.type === "namespace_import") {
              const alias = field(s, "alias") ?? field(s, "name")
              if (alias && alias.type === "identifier") imports.add(alias.text)
            }
          }
        }
      }
      if (t === "lexical_declaration" || t === "variable_declaration") {
        const isExport = isExportedTop || n.parent?.type === "export_statement"
        for (const d of descendants(n)) {
          if (d.type !== "variable_declarator") continue
          const nameNode = field(d, "name")
          if (!nameNode) continue
          for (const nm of boundNames(nameNode)) {
            members.add(nm)
            if (isExport && !isModuleBlock) owned.add(nm)
          }
          // `let { a, b } = $props()` — the PROPS are the declarator's VALUE,
          // not its pattern: the pattern's own text never mentions `$props`.
          // (The first version tested `nameNode.text.includes("$props")`, which
          // is never true, so the whole `$props()` class published zero
          // component-owned names and every real prop came back unexplained.)
          const value = field(d, "value")
          if (value && value.type === "call_expression") {
            const callee = field(value, "function")
            if (callee && callee.text === "$props") {
              for (const nm of boundNames(nameNode)) {
                members.add(nm)
                owned.add(nm)
              }
            }
          }
        }
      }
      if (t === "function_declaration" || t === "generator_function_declaration") {
        const nm = field(n, "name")
        if (nm && nm.type === "identifier") {
          members.add(nm.text)
          if ((isExportedTop || n.parent?.type === "export_statement") && !isModuleBlock) owned.add(nm.text)
        }
      }
      if (t === "class_declaration") {
        const nm = field(n, "name")
        if (nm && nm.type === "identifier") {
          members.add(nm.text)
          if ((isExportedTop || n.parent?.type === "export_statement") && !isModuleBlock) owned.add(nm.text)
        }
      }
      // `type X = …` / `interface X { … }` — a TYPE name is a name in scope, so a
      // template read may resolve to it. Measured: `menu-color-picker.svelte`
      // reads `ColorChoice` inside an attribute arrow (`value as ColorChoice`)
      // and the analyzer publishes `uses`; a truth that did not know type names
      // reported it unexplained.
      if (t === "type_alias_declaration" || t === "interface_declaration") {
        const nm = field(n, "name")
        // `type_identifier`, NOT `identifier`: tree-sitter-typescript gives a
        // type alias's name its own node type, so the identifier-only guard
        // dropped every type alias and its reads came back unexplained.
        if (nm && (nm.type === "identifier" || nm.type === "type_identifier")) members.add(nm.text)
      }
      // `export { a, b }` — the export-SPECIFIER list, which is how a Svelte
      // component publishes an already-declared binding (Svelte 4 props, Svelte 5
      // instance exports). Measured: `docs/src/lib/components/mobile-nav.svelte`
      // declares `let closeMenu = …` and then `export { closeMenu }`; the
      // analyzer publishes `contains mobile-nav -> closeMenu` and the first truth
      // called it unexplained because it only read `export let`.
      if (top.type === "export_statement") {
        for (const d of descendants(top)) {
          if (d.type !== "export_specifier") continue
          // `export { className as class }` — containment names the SYMBOL, so
          // the binding site is the LOCAL name; the alias is the name the
          // component's API publishes, which is the exports edge's business.
          // Measured: `docs/src/lib/registry/blocks/otp-02/components/otp-form.svelte`
          // declares `let className` and exports it as `class`; the analyzer's
          // `contains otp-form -> className` is right and the alias is not a
          // symbol.
          const local = field(d, "local") ?? field(d, "name")
          const nm = local && (local.type === "identifier" || local.type === "type_identifier") ? local.text : ""
          if (!nm) continue
          members.add(nm)
          if (!isModuleBlock) owned.add(nm)
        }
      }
      // `$: total = expr` — a reactive component-owned variable
      if (t === "labeled_statement") {
        const label = namedChildren(n)[0]
        if (label && label.text === "$") {
          for (const d of descendants(n)) {
            if (d.type !== "assignment_expression") continue
            const left = field(d, "left")
            if (left && left.type === "identifier") {
              members.add(left.text)
              owned.add(left.text)
            }
          }
        }
      }
      // heritage, for the record: the delegate publishes these
      if (t === "class_declaration" || t === "interface_declaration") {
        const nm = field(n, "name")
        const from = nm ? nm.text : ""
        for (const h of descendants(n)) {
          if (h.type === "class_heritage" || h.type === "extends_clause" || h.type === "implements_clause") {
            const label = h.text.startsWith("implements") ? "implements" : "extends"
            for (const base of namedChildren(h)) {
              if (base.type === "type_arguments" || base.type === "type_parameters") continue
              edges.push({ label, from, target: base.text, because: `${h.type} in a ${t}` })
            }
          }
        }
      }
    }
    // $props() destructured names anywhere in the block
    for (const n of descendants(prog)) {
      if (n.type !== "call_expression") continue
      const callee = field(n, "function")
      if (!callee || callee.text !== "$props") continue
      for (const d of descendants(n)) {
        if (d.type === "variable_declarator") {
          const nameNode = field(d, "name")
          if (nameNode) for (const nm of boundNames(nameNode)) {
            members.add(nm)
            owned.add(nm)
          }
        }
      }
    }
  })

  // ---- template half --------------------------------------------------------
  const reads = new Map<string, number>()
  const snippetNames = new Set<string>()
  const stack: Array<{ n: any; shadowed: Set<string> }> = [{ n: root, shadowed: new Set<string>() }]
  while (stack.length) {
    const { n, shadowed } = stack.pop()!
    const t = n.type
    if (t === "script_element" || t === "style_element") continue
    const opensScope =
      t === "each_statement" || t === "await_statement" || t === "if_statement" ||
      t === "else_if_block" || t === "key_statement" || t === "snippet_statement"
    const childShadowed = opensScope ? new Set(shadowed) : shadowed

    if (t === "snippet_statement") {
      const nm = descendants(n).find((x) => x.type === "snippet_name")
      if (nm) {
        // A snippet is published as a component-owned Method SYMBOL, so it is
        // also a name a read can resolve to: `{@render tooltip()}` inside another
        // snippet's body resolves the way a prop does. Measured: 28 `uses` edges
        // on shadcn-svelte whose target is a snippet name (chart-pie-stacked's
        // `tooltip`, chart-radar-*'s `tooltip`, …) were unexplained until the
        // snippet was added to members as well as to owned.
        owned.add(nm.text)
        members.add(nm.text)
        snippetNames.add(nm.text)
      }
      const start = descendants(n).find((x) => x.type === "snippet_start")
      if (start) for (const r of rawTexts(start)) {
        for (const w of scanExpression(r.text, r.line).allNames) childShadowed.add(w)
      }
    }
    // BLOCK HEADS: the collection/condition is a member read; the loop vars bind
    if (t === "each_statement") {
      const start = descendants(n).find((x) => x.type === "each_start")
      if (start) {
        const rs = rawTexts(start)
        if (rs[0]) collect(rs[0], childShadowed)
        if (rs[1]) for (const w of scanExpression(rs[1].text, rs[1].line).allNames) childShadowed.add(w)
      }
    }
    if (t === "await_statement") {
      const start = descendants(n).find((x) => x.type === "await_start")
      if (start) {
        const joined = rawTexts(start)
        const head = joined.map((r) => r.text).join(" ")
        const split = splitThenAs(head)
        const base = joined[0] ? joined[0].line : 0
        if (split) {
          collectText(split.head, base, childShadowed)
          for (const w of scanExpression(head.slice(split.matchLength), base).allNames) childShadowed.add(w)
        } else {
          collectText(head, base, childShadowed)
        }
      }
      for (const blkType of ["then_start", "catch_start"]) {
        const blk = descendants(n).find((x) => x.type === blkType)
        if (!blk) continue
        for (const r of rawTexts(blk)) for (const w of scanExpression(r.text, r.line).allNames) childShadowed.add(w)
      }
    }
    if (t === "if_statement" || t === "else_if_block" || t === "key_statement") {
      const headType = t === "key_statement" ? "key_start" : t === "if_statement" ? "if_start" : "else_if_start"
      const head = descendants(n).find((x) => x.type === headType)
      if (head) {
        const rs = rawTexts(head)
        for (const r of rs) collect(r, childShadowed)
      }
    }
    // MUSTACHE / attribute / tag expressions
    if (t === "expression") {
      for (const r of rawTexts(n)) collect(r, childShadowed)
    }
    if (t === "html_tag" || t === "const_tag" || t === "debug_tag") {
      for (const r of rawTexts(n)) {
        if (t === "const_tag") {
          const eq = topLevelEq(r.text)
          if (eq >= 0) {
            for (const w of scanExpression(r.text.slice(0, eq), r.line).allNames) childShadowed.add(w)
            collectText(r.text.slice(eq + 1), r.line, childShadowed)
            continue
          }
        }
        collect(r, childShadowed)
      }
    }
    if (t === "element" || t === "self_closing_tag") {
      // shorthand `{value}` and spread `{...props}` live in the ATTRIBUTE NAME
      const startTag = childOfType(n, "start_tag") ?? childOfType(n, "self_closing_tag")
      if (startTag) {
        for (const a of namedChildren(startTag)) {
          if (a.type !== "attribute") continue
          const an = attrName(a)
          if (!an.startsWith("{")) continue
          const inner = an.slice(1, -1).trim()
          const body = inner.startsWith("...") ? inner.slice(3) : inner
          collectText(body, a.startPosition.row + 1, childShadowed)
        }
      }
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push({ n: c, shadowed: childShadowed })
    }
  }

  function rawTexts(n: any): Array<{ text: string; line: number }> {
    return descendants(n)
      .filter((x) => x.type === "svelte_raw_text")
      .sort((a, b) => a.startIndex - b.startIndex)
      .map((x) => ({ text: x.text, line: x.startPosition.row + 1 }))
  }
  function collect(r: { text: string; line: number }, shadow: Set<string>): void {
    collectText(r.text, r.line, shadow)
  }
  function collectText(text: string, base: number, shadow: Set<string>): void {
    for (const [name, line] of scanExpression(text, base).names) {
      if (shadow.has(name)) continue
      reads.set(name, line)
    }
  }

  // ---- resolve the reads ----------------------------------------------------
  for (const [name, line] of reads) {
    // a store auto-subscription reads the VALUE of the `store` member
    let resolved = name
    if (!members.has(name) && name.startsWith("$") && !name.startsWith("$$") && members.has(name.slice(1)))
      resolved = name.slice(1)
    if (!members.has(resolved)) continue
    edges.push({
      label: "uses",
      from: componentName,
      target: resolved,
      because: `template read at line ${line}`,
    })
  }

  // ---- containment ----------------------------------------------------------
  for (const name of owned) {
    edges.push({
      label: "contains",
      from: componentName,
      target: name,
      because: "component-owned binding",
    })
  }

  void imports
  void snippetNames
  return {
    edges,
    owned: [...owned],
    members: [...members],
    locals: [...locals],
    blocks,
    componentName,
  }
}

/** `let { a, b: c } = …` / `const [x, y] = …` — the names a pattern binds. */
function boundNames(pattern: any): string[] {
  const out: string[] = []
  const take = (n: any): void => {
    if (!n) return
    if (n.type === "identifier" || n.type === "shorthand_property_identifier" || n.type === "shorthand_property_identifier_pattern") {
      out.push(n.text)
      return
    }
    if (n.type === "pair_pattern") {
      take(field(n, "value"))
      return
    }
    // `object_assignment_pattern` is this grammar's name for `{ a = default }`
    // (the javascript grammar calls it `assignment_pattern`). Both bind the LEFT
    // side only — the right side is a default VALUE, never a binding.
    if (n.type === "assignment_pattern" || n.type === "object_assignment_pattern") {
      take(field(n, "left") ?? field(n, "pattern"))
      return
    }
    if (n.type === "rest_pattern") {
      take(namedChildren(n)[0])
      return
    }
    if (n.type === "object_pattern" || n.type === "array_pattern") {
      for (const c of namedChildren(n)) {
        // a type annotation names TYPES, and a type is not a binding: without
        // this, `let { ref }: ComponentProps<typeof LabelPrimitive.Root>` also
        // published ComponentProps, LabelPrimitive and Root as owned names.
        if (c.type === "type_annotation") continue
        take(c)
      }
      return
    }
    // Anything else is not a binding position — a default value's call
    // expression, a type node. The first version descended into those and
    // published `$bindable` as a component-owned prop (measured: 4 files on the
    // 60-file sample, every one of them a `{ x = $bindable() }` destructure).
  }
  take(pattern)
  return out
}

/** Is the bi-th <script> a module block? (context="module" or bare `module`.) */
export function isModuleContext(root: any, index: number): boolean {
  const blocks: any[] = []
  const walk = (n: any): void => {
    if (n.type === "script_element") {
      blocks.push(n)
      return
    }
    for (const c of namedChildren(n)) walk(c)
  }
  walk(root)
  const block = blocks[index]
  if (!block) return false
  const startTag = childOfType(block, "start_tag")
  if (!startTag) return false
  for (const a of namedChildren(startTag)) {
    if (a.type !== "attribute") continue
    const an = attrName(a)
    if (an === "module") return true
    if (an === "context" && attrValue(a) === "module") return true
  }
  return false
}

/** First top-level `=` index, or -1. */
function topLevelEq(text: string): number {
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === "(" || c === "[" || c === "{") depth++
    else if (c === ")" || c === "]" || c === "}") depth--
    else if (c === "=" && depth === 0) return i
  }
  return -1
}

/** The `{#await p then v}` head split: promise expression, then the rest. */
export function splitThenAs(text: string): { head: string; matchLength: number } | undefined {
  let i = 0
  while (i < text.length) {
    if (!SPACE(text[i])) {
      i++
      continue
    }
    const wsStart = i
    while (i < text.length && SPACE(text[i])) i++
    let kw = 0
    if (text.startsWith("then", i)) kw = 4
    else if (text.startsWith("as", i)) kw = 2
    if (kw > 0 && i + kw < text.length && SPACE(text[i + kw])) {
      let after = i + kw
      while (after < text.length && SPACE(text[after])) after++
      return { head: text.slice(0, wsStart), matchLength: after }
    }
    i++
  }
  return undefined
}

// ---------------------------------------------------------------------------
// CLI — the lane's own differential for the two labels it adds
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv.includes("--labels")) {
    console.log(JSON.stringify(SVELTE_ORACLE_LABELS))
    return
  }
  const corpusName = (argv.find((a) => a.startsWith("corpus=")) ?? "corpus=shadcn-svelte").slice(7)
  const nFiles = Number((argv.find((a) => a.startsWith("files=")) ?? "files=200").slice(6))
  const corpusRoot = process.env.BB_CORPUS || "$HOME/fixtures/repositories"
  const dir = path.join(corpusRoot, corpusName)

  const files: string[] = []
  const walk = (d: string, depth = 0): void => {
    if (depth > 20 || files.length >= nFiles) return
    let ents: fs.Dirent[]
    try {
      ents = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of ents) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".git") continue
        walk(p, depth + 1)
      } else if (e.name.endsWith(".svelte")) files.push(p)
      if (files.length >= nFiles) return
    }
  }
  walk(dir)

  const eng: any = await import(path.join(ROOT, "src/ast/engine.ts"))
  const AUDITED = ["contains", "uses"]
  const stat: Record<string, { truth: number; analyzer: number; missing: number; unexplained: number }> = {}
  for (const l of AUDITED) stat[l] = { truth: 0, analyzer: 0, missing: 0, unexplained: 0 }
  const delegated: Record<string, number> = { contains: 0, uses: 0 }
  const missingSamples: Record<string, string[]> = { contains: [], uses: [] }
  const unexplainedSamples: Record<string, string[]> = { contains: [], uses: [] }
  let filesRead = 0

  for (const f of files) {
    let content: string
    try {
      content = fs.readFileSync(f, "utf8")
    } catch {
      continue
    }
    const parser = await eng.getParser("svelte")
    const tree = parser.parse(content, f)
    // the seam's own block extraction, so the truth sees the same script bodies
    const blocks: Array<{ body: string; lang: string; startLine: number; startColumn: number; startIndex: number }> = []
    // DOCUMENT order, and the SAME order isModuleContext() collects in. The first
    // version used a LIFO stack here and a recursive pre-order walk there, so the
    // two disagreed about which index is the module block: for a file with
    // `<script module>` FOLLOWED by an instance block, the truth read the instance
    // block as the module one and published all 21 module exports as
    // component-owned (21 false `contains` rows, one file).
    const collectBlocks = (n: any): void => {
      if (n.type === "script_element") {
        let raw: any = null
        let lang = "js"
        for (const c of namedChildren(n)) {
          if (c.type === "raw_text") raw = c
          if (c.type === "start_tag")
            for (const a of namedChildren(c)) {
              if (a.type === "attribute" && attrName(a) === "lang") {
                const v = attrValue(a)
                if (v === "ts" || v === "tsx") lang = v
              }
            }
        }
        if (raw) {
          const body = content.substring(raw.startIndex, raw.endIndex)
          if (body.trim().length > 0)
            blocks.push({
              body,
              lang,
              startLine: raw.startPosition.row + 1,
              startColumn: raw.startPosition.column,
              startIndex: raw.startIndex,
            })
        }
        return
      }
      for (const c of namedChildren(n)) collectBlocks(c)
    }
    collectBlocks(tree.rootNode)
    const scriptTrees: any[] = []
    const scriptLangs: string[] = []
    for (const b of blocks) {
      const sub = b.lang === "ts" ? "typescript" : b.lang === "tsx" ? "tsx" : "javascript"
      try {
        scriptTrees.push((await eng.getParser(sub)).parse(b.body))
        scriptLangs.push(b.lang)
      } catch {
        /* grammar unavailable */
      }
    }

    const truth = deriveSvelteTruth(tree.rootNode, content, f, scriptTrees, scriptLangs)
    const res = await eng.parseFile(f, content)
    filesRead++
    const component = truth.componentName

    for (const label of AUDITED) {
      const tSet = new Set(
        truth.edges.filter((e) => e.label === label).map((e) => `${e.from}|${e.target}`),
      )
      // PROVENANCE, taken structurally rather than from analyzer metadata: an
      // edge whose SOURCE is the component itself was derived from the SFC
      // template, and one whose source is a script-declared symbol came through
      // the JS/TS delegate (the javascript lane's ontology, audited by that
      // lane's own differential). Counting the delegated half here would be
      // comparing the svelte truth against a second language's contract, which
      // is how a lane ends up explaining another lane's edges.
      const all = (res.relationships ?? []).filter(
        (r: any) => String(r.relationshipType ?? r.type) === label,
      )
      const aSet = new Set(
        all.filter((r: any) => r.source === component).map((r: any) => `${r.source}|${r.target}`),
      )
      delegated[label] += all.length - [...aSet].length
      stat[label].truth += tSet.size
      stat[label].analyzer += aSet.size
      for (const k of tSet) if (!aSet.has(k)) {
        stat[label].missing++
        if (missingSamples[label].length < 15) missingSamples[label].push(f.split(dir + "/")[1] + " " + k)
      }
      for (const k of aSet) if (!tSet.has(k)) {
        stat[label].unexplained++
        if (unexplainedSamples[label].length < 15) unexplainedSamples[label].push(f.split(dir + "/")[1] + " " + k)
      }
    }
    try {
      tree.delete()
    } catch {
      /* ignore */
    }
  }

  console.log(`svelte-truth --compare  corpus=${corpusName}  files read ${filesRead}`)
  console.log(`labels compared: ${AUDITED.join(" ")}   (the two the M60 DERIVATION check reports unaudited)`)
  console.log("SFC-derived edges (source = the component): compared against this lane's truth")
  console.log("label      truth  analyzer  missing  unexplained   delegated-to-js")
  for (const l of AUDITED) {
    const s = stat[l]
    console.log(
      `${l.padEnd(10)} ${String(s.truth).padStart(5)} ${String(s.analyzer).padStart(9)} ${String(s.missing).padStart(8)} ${String(s.unexplained).padStart(12)} ${String(delegated[l]).padStart(18)}`,
    )
  }
  console.log(
    "\nthe delegated column is the SCRIPT half: edges whose source is a script-declared symbol, published by the JS/TS delegate. Those are the javascript lane's ontology (interface member containment, object-read uses) and are audited by that lane's differential, not by this file.",
  )
  for (const l of AUDITED) {
    if (missingSamples[l].length) console.log(`\nMISSING (truth, no analyzer edge) on ${l}:\n  ` + missingSamples[l].join("\n  "))
    if (unexplainedSamples[l].length) console.log(`\nUNEXPLAINED (analyzer edge, no truth) on ${l}:\n  ` + unexplainedSamples[l].join("\n  "))
  }
}

if ((import.meta as any).main === undefined || process.argv[1]?.endsWith("svelte-truth.ts")) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}