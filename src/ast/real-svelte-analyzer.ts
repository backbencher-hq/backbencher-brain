// Svelte Intelligence Engine
// M12.13 rewrite: C#-family contract, pure-AST, fully regex-free.
//   - Two-layer parse: (1) tree-sitter-svelte gives the SFC skeleton — the
//     component root, template component usages, event-directive handlers,
//     and the <script> blocks whose bodies are `raw_text` nodes with exact
//     byte offsets; (2) each script body is parsed with
//     tree-sitter-javascript/typescript (engine pre-parse, see
//     ASTEngine.parseFile → context.sfcScriptTrees) and extracted via the
//     JS/TS family analyzer, with ranges offset back to SFC lines.
//   - Symbols: component (name = file module, Class); script bindings via the
//     JS contract (no locals/params); Svelte props (export let → Property,
//     $props() destructure → Property); reactive declarations ($: target →
//     Variable); rune/`$` reactive vars via the JS contract.
//     Template elements/attributes/directives are NEVER symbols.
//   - Relationships: template component usages → instantiates (leaf tag
//     names, HTML/Svelte builtins filtered); on: event directives → calls
//     (leaf handler identifier from the expression); script imports/calls/
//     exports via the JS contract; compiler macros/rune calls ($state,
//     $derived, $effect, $props, $inspect, $bindable, $host, $render)
//     filtered; contains from ownerName.
//
// Svelte 5 runes ($state/$derived/$effect/$props) are compiler macros — the
// vars they initialize are first-class symbols, the rune CALLS are not.

import type { Node, Tree } from "web-tree-sitter"
import * as path from "path"
import { ASTEngine } from "./engine"
import { RealJavaScriptAnalyzer } from "./real-javascript-analyzer"
import { RealTypeScriptAnalyzer } from "./real-typescript-analyzer"

/**
 * M49 #868 — the SFC seam must shift the delegate's metadata LINE MIRRORS, not
 * only its `line_number`/symbol ranges.
 *
 * Measured on a decorated class inside a .vue script block (the same container
 * logic the svelte twin uses): the row `references Service -> sealed` carried
 * `line_number=6` — the line `@sealed` is actually written on — while its own
 * metadata still said `decoratorLine=5`, the SCRIPT-relative value, unshifted.
 * The applied offset was recorded on that very row (`sfcLineOffset: 1`), so the
 * payload contradicted both itself and the file, and a tool reading the mirror
 * got a line above the decorator it names.
 *
 * Only keys whose NAME is a line (`decoratorLine`, `line`, `decoratorLines`)
 * are touched, and only numeric values: a decorator whose line was never
 * recorded stays null rather than becoming a number (never invent a line, #823).
 */
function shiftMetadataLineMirrors(md: Record<string, unknown> | undefined, lineOffset: number): void {
  if (!md || lineOffset === 0) return
  for (const [k, v] of Object.entries(md)) {
    if (!/line/i.test(k)) continue
    if (typeof v === "number") md[k] = v + lineOffset
    else if (Array.isArray(v) && v.some((x) => typeof x === "number")) {
      md[k] = v.map((x) => (typeof x === "number" ? x + lineOffset : x))
    }
  }
}

// ============================================================================
// BUILTIN TAG FILTERS — template component-usage detection
// ============================================================================

const HTML_BUILTIN_TAGS = new Set([
  "a", "abbr", "address", "area", "article", "aside", "audio", "b", "base", "bdi", "bdo",
  "blockquote", "body", "br", "button", "canvas", "caption", "cite", "code", "col",
  "colgroup", "data", "datalist", "dd", "del", "details", "dfn", "dialog", "div", "dl",
  "dt", "em", "embed", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2",
  "h3", "h4", "h5", "h6", "head", "header", "hgroup", "hr", "html", "i", "iframe", "img",
  "input", "ins", "kbd", "label", "legend", "li", "link", "main", "map", "mark", "menu",
  "meta", "meter", "nav", "noscript", "object", "ol", "optgroup", "option", "output", "p",
  "picture", "pre", "progress", "q", "rp", "rt", "ruby", "s", "samp", "script", "search",
  "section", "select", "slot", "small", "source", "span", "strong", "style", "sub",
  "summary", "sup", "table", "tbody", "td", "template", "textarea", "tfoot", "th", "thead",
  "time", "title", "tr", "track", "u", "ul", "var", "video", "wbr",
  // SVG
  "svg", "path", "g", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "text", "tspan", "use", "defs", "linearGradient", "radialGradient", "stop", "mask",
  "pattern", "marker", "view", "symbol", "clipPath",
])

const SVELTE_BUILTIN_TAGS = new Set([
  "slot", "svelte:component", "svelte:self", "svelte:element", "svelte:window",
  "svelte:document", "svelte:body", "svelte:head", "svelte:options", "svelte:fragment",
  "svelte:boundary",
])

// Svelte compiler macros / runes — calls to these are never relationships.
const SVELTE_RUNES = new Set([
  "$state", "$state.raw", "$state.snapshot", "$derived", "$derived.by",
  "$effect", "$effect.pre", "$effect.tracking", "$effect.root", "$effect.untracked",
  "$props", "$props.id", "$props.is_safe", "$bindable", "$host", "$inspect",
  "$inspect.trace", "$render", "$props",
])

// ============================================================================
// PURE-STRING HELPERS (regex-free)
// ============================================================================

function isIdentifier(text: string): boolean {
  if (text.length === 0) return false
  const first = text[0]
  if (!((first >= "a" && first <= "z") || (first >= "A" && first <= "Z") || first === "_" || first === "$")) return false
  for (let i = 1; i < text.length; i++) {
    const c = text[i]
    if (!((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_" || c === "$")) return false
  }
  return true
}

/**
 * `/^on[a-z]+$/` as a char walk — the Svelte-5 event-attribute spelling test
 * (`on` + one or more lowercase letters, nothing else). M49.R2: the AST regex
 * census counted the literal as review-class debt, and a fixed prefix plus a
 * lowercase run needs no regex.
 */
function isOnEventAttrName(name: string): boolean {
  if (name.length < 3 || name[0] !== "o" || name[1] !== "n") return false
  for (let i = 2; i < name.length; i++) {
    const c = name[i]
    if (c < "a" || c > "z") return false
  }
  return true
}

// ============================================================================
// ANALYZER
// ============================================================================

// Last segments of dotted runes - a '$'-prefixed callee whose leaf is one of
// these is a rune call; '$'-prefixed USER functions with other names pass.
const RUNE_LEAF_SEGMENTS = new Set([
  "state", "raw", "snapshot", "derived", "by", "effect", "pre", "tracking",
  "root", "untracked", "props", "id", "is_safe", "bindable", "host",
  "inspect", "trace", "render",
])

function isRuneCallee(calleeExpression: string): boolean {
  if (!calleeExpression.startsWith("$")) return false
  if (SVELTE_RUNES.has(calleeExpression)) return true
  const leaf = calleeExpression.split(".").pop() ?? ""
  return RUNE_LEAF_SEGMENTS.has(leaf)
}

export class RealSvelteAnalyzer implements ASTEngine.LanguageAnalyzer {
  analyze(
    rootNode: Node,
    content: string,
    filePath: string,
    context?: ASTEngine.AnalyzeContext,
  ): ASTEngine.ParseResult & { metadata: Partial<ASTEngine.FileMetadata> } {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const errors: ASTEngine.ParseError[] = []

    const patterns: Record<string, boolean> = {}
    const moduleName = path.basename(filePath, path.extname(filePath))
    patterns["Svelte SFC"] = true

    // --- Error collection (svelte grammar) -----------------------------------
    if (rootNode.hasError) {
      const errStack: Node[] = [rootNode]
      while (errStack.length > 0) {
        const n = errStack.pop()!
        if (n.type === "ERROR" || n.isMissing) {
          errors.push({
            message: `Syntax ${n.type} detected. The Brain Engine is bypassing this broken node.`,
            range: this.nodeToRange(n),
            severity: "warning",
          })
        }
        for (let i = n.namedChildCount - 1; i >= 0; i--) {
          const child = n.namedChild(i)
          if (child) errStack.push(child)
        }
      }
    }

    // --- 1. Component symbol ---------------------------------------------------
    symbols.push({
      name: moduleName,
      kind: ASTEngine.SymbolKind.Class,
      range: this.nodeToRange(rootNode),
      scope: "",
      visibility: "public",
      metadata: { isSvelteComponent: true, isSfc: true },
    })

    // --- 2. Template pass: component usages → instantiates; on: → calls ------
    // Walk the SFC tree; skip <script>/<style> subtrees; every non-builtin
    // element tag is a component usage (leaf tag name as written). on: event
    // directives produce a call to the leaf handler identifier in the
    // expression value.
    // Each stack frame carries a mutable lexical scope shared by siblings.
    // This is necessary for {@const}: its binding becomes visible to later
    // siblings in the enclosing block, but must not leak to the parent or a
    // nested block.
    const seenUsages = new Set<string>()
    let templateDecisions = 0
    // S1 (#419): template expressions reference script-side members — collect
    // the identifiers from expressions ({count}, label={label}, {#each items
    // as item}, {#await promise then value}, {@html raw}, {@const total},
    // {@debug x}, <svelte:component this={Comp}>) during the walk; the member
    // symbols only exist after the script pass, so the Uses edges are emitted
    // after the merge (step 3b).
    //
    // The svelte grammar exposes template expressions as opaque svelte_raw_text
    // (no child AST), so identifier extraction is by text scan (the documented
    // fallback).
    //
    // Scope (vue V4 lesson, applied pre-fix): template-LOCAL bindings shadow
    // members — {#each items as item, i} binds item+i; {#await promise then
    // value} binds value; {:catch err} binds err; {#snippet row(label)}
    // binds label+count. A shadowed name must NOT emit a use.
    const templateExprNames = new Map<string, number>()
    // H2 (review wave): `this=` targets on svelte:component/svelte:element
    // with a bare-identifier value are DYNAMIC component references,
    // resolved post-merge (imports are unknown until the script pass).
    const thisTargets = new Map<string, number>()
    const templateStack: Array<{ node: Node; scope: { shadowed: Set<string> } }> = [
      { node: rootNode, scope: { shadowed: new Set() } },
    ]
    while (templateStack.length > 0) {
      const { node: n, scope } = templateStack.pop()!
      const t = n.type
      if (t === "script_element" || t === "style_element") continue
      const shadowed = scope.shadowed
      // A block gets an isolated scope shared by all of its children. Ordinary
      // nodes keep the current scope so {@const} can update the enclosing
      // block for later siblings without leaking across nested blocks.
      const opensScope =
        t === "each_statement" || t === "await_statement" ||
        t === "if_statement" || t === "else_if_block" ||
        t === "key_statement" || t === "snippet_statement"
      const childScope = opensScope ? { shadowed: new Set(shadowed) } : scope
      const childShadowed = childScope.shadowed
      // {#snippet name(params)} — reusable template functions; the name is
      // a component-owned Method, and {@render name(...)} calls it.
      if (t === "snippet_statement") {
        const nm = this.findDescendant(n, (c) => c.type === "snippet_name")
        if (nm && !seenUsages.has("snippet:" + nm.text)) {
          seenUsages.add("snippet:" + nm.text)
          symbols.push({
            name: nm.text,
            kind: ASTEngine.SymbolKind.Method,
            range: this.nodeToRange(n),
            scope: moduleName,
            ownerName: moduleName,
            ownerKind: ASTEngine.SymbolKind.Class,
            visibility: "public",
            metadata: { isSnippet: true },
          })
          // snippet params ({#snippet row(label)} of) are template-local
          this.collectSnippetParams(n, childShadowed)
        }
      }
      if (t === "render_tag") {
        // render_tag content is OPAQUE TEXT in this grammar (no child
        // nodes) - the snippet name is scanned from the raw tag text.
        const text = n.text.replace("{@render", "").trim()
        let end = 0
        while (end < text.length && (isIdentifier(text.slice(0, end + 1)))) end++
        let targetName = text.slice(0, end)
        // D4 (second review): dotted render targets (`{@render ns.row(it)}`)
        // resolved to the FIRST segment while on: handlers resolve dotted
        // leaves to the LAST (`box.open` -> open) — same shape, opposite
        // answers. The callable leaf is the last all-identifier segment
        // (optional-chaining and the trailing call parens stripped); anything
        // else keeps the leading-identifier fallback (`children?.()` -> children).
        const afterLead = text.slice(end).trimStart()
        if (targetName && (afterLead.startsWith(".") || afterLead.startsWith("?."))) {
          const leaf = this.dottedRenderLeaf(text)
          if (leaf) targetName = leaf
        }
        const target = targetName ? { text: targetName } : undefined
        if (target && isIdentifier(target.text)) {
          relationships.push({
            source: moduleName,
            target: target.text,
            type: ASTEngine.RelationshipType.Calls,
            confidence: 0.9,
            // M59 (#825): the `{@render ...}` tag the name is written in.
            line_number: n.startPosition.row + 1,
            metadata: { context: "Svelte {@render} tag" },
          })
        }
      }
      // Template DECISION constructs: {#if}/{:else if} branches, {#each}
      // loops, {#await} branches — they branch rendering like code.
      if (
        t === "if_statement" || t === "else_if_block" ||
        t === "each_statement" || t === "await_statement" || t === "key_statement"
      ) {
        templateDecisions++
      }
      // S1: {#each items as item, i} — the collection is a member use, but
      // the loop vars (item, i) are template-LOCAL.
      if (t === "each_statement") {
        this.collectEachExpression(n, templateExprNames, childShadowed)
      }
      // S1: {#await promise then value} {:catch err} — the promise is a member
      // use; then/catch vars are template-LOCAL.
      if (t === "await_statement") {
        this.collectAwaitExpression(n, templateExprNames, childShadowed)
      }
      // D5 (second review): {#if cond}, {:else if cond} and {#key exp}
      // conditions are opaque svelte_raw_text under if_start/else_if_start/
      // key_start — no `expression` node ever visits them, so conditions
      // referencing ONLY the condition (masked in every fixture by duplicate
      // reads elsewhere) emitted nothing. Pure reads, no bindings.
      if (t === "if_statement" || t === "else_if_block" || t === "key_statement") {
        this.collectConditionExpression(n, templateExprNames, childShadowed)
      }
      if (t === "expression") {
        // {count}, label={label}, this={Comp}, {@const total}, {@debug x},
        // {@html raw} — every expression body is a member read.
        this.collectExpressionIdentifiers(n, templateExprNames, childShadowed)
      }
      // {@html raw} / {@const total = expr} / {@debug expr} carry the body
      // directly as svelte_raw_text (no `expression` wrapper node).
      if (t === "html_tag" || t === "const_tag" || t === "debug_tag") {
        this.collectTagExpressionIdentifiers(n, templateExprNames, childShadowed)
        // {@const total = expr} BINDS `total` as a template-LOCAL that
        // shadows any same-named member within this subtree — register the
        // binding name into childShadowed so later {total} reads don't emit a
        // false member use (S5, {@const} shadow case).
        if (t === "const_tag") {
          const body = this.expressionText(n)
          const eq = this.topLevelEq(body)
          if (eq >= 0) this.collectShadowNames(body.slice(0, eq), childShadowed)
        }
      }
      if (t === "element" || t === "self_closing_tag") {
        const tag = this.elementTagName(n)
        if (tag && !HTML_BUILTIN_TAGS.has(tag) && !SVELTE_BUILTIN_TAGS.has(tag) && !seenUsages.has(tag)) {
          seenUsages.add(tag)
          const tagNode = this.elementTagNameNode(n)
          relationships.push({
            source: moduleName,
            target: tag,
            type: ASTEngine.RelationshipType.Instantiates,
            confidence: 0.95,
            // M59 (#825): the `<Child/>` tag as written.
            ...(tagNode ? { line_number: tagNode.startPosition.row + 1 } : {}),
            metadata: { isComponentUsage: true },
          })
        }
        // H2: svelte:component/svelte:element `this={X}` — record bare
        // identifiers for post-merge resolution (below).
        if (tag === "svelte:component" || tag === "svelte:element") {
          const thisTag = this.findChildByType(n, "start_tag") || this.findChildByType(n, "self_closing_tag")
          if (thisTag) {
            for (let i = 0; i < thisTag.namedChildCount; i++) {
              const attr = thisTag.namedChild(i)
              if (!attr || attr.type !== "attribute" || this.attributeName(attr) !== "this") continue
              const valueNode = this.findChildByType(attr, "expression")
              if (!valueNode) continue
              let vt = valueNode.text.trim()
              if (vt.startsWith("{") && vt.endsWith("}")) vt = vt.slice(1, -1).trim()
              if (vt && isIdentifier(vt)) thisTargets.set(vt, valueNode.startPosition.row + 1)
            }
          }
        }
        // H1/H3 (review wave): shorthand {value} and spread {...props}
        // carry the whole expression in the attribute NAME with no
        // expression child, so no other walk ever visits them. Named
        // attributes WITH an expression child (this={Comp}, label={x})
        // are already covered by the generic expression branch — skip
        // those here to avoid double collection. (on: handlers keep
        // their own calls path above and are skipped too.)
        const startTag2 = this.findChildByType(n, "start_tag") || this.findChildByType(n, "self_closing_tag")
        if (startTag2) {
          for (let i = 0; i < startTag2.namedChildCount; i++) {
            const attr = startTag2.namedChild(i)
            if (!attr || attr.type !== "attribute") continue
            const attrName = this.attributeName(attr)
            if (!attrName || attrName.startsWith("on:")) continue
            if (this.findChildByType(attr, "expression")) continue
            if (attrName.startsWith("{") && attrName.endsWith("}")) {
              const inner = attrName.slice(1, -1).trim()
              const expr = inner.startsWith("...") ? inner.slice(3) : inner
              // The shorthand lives in the attribute NAME, so the line is the
              // attribute's (the name is written on the tag it belongs to).
              this.collectIdentifiersFromText(expr, templateExprNames, childShadowed, attr.startPosition.row + 1)
            }
          }
        }
        // on: directives — the handler is the first call-target identifier or
        // bare-identifier leaf of the expression value (`on:click={inc}` →
        // inc; `on:click={() => bump()}` → bump; `on:greet={greet}` → greet).
        // Svelte 5 `onclick`-style attributes (`onclick={save}`) are the same
        // edge through the modern spelling — but ONLY on intrinsic tags. On a
        // component, `onclick` is a *prop* (parent→child data flow reads the
        // value as uses elsewhere, never a call). `on:` stays universal
        // (component event-listener syntax); bare `onclick` on a component
        // must not fabricate. Short words (`on`, `once`, `only`) are never
        // events.
        const startTag = this.findChildByType(n, "start_tag") || this.findChildByType(n, "self_closing_tag")
        if (startTag) {
          for (let i = 0; i < startTag.namedChildCount; i++) {
            const attr = startTag.namedChild(i)
            if (!attr || attr.type !== "attribute") continue
            const attrName = this.attributeName(attr)
            if (!attrName) continue
            const isOnDirective = attrName.startsWith("on:")
            const isOnclickAttr =
              !isOnDirective &&
              isOnEventAttrName(attrName) &&
              attrName.length > 4 &&
              !!tag &&
              tag[0] === tag[0].toLowerCase() &&
              !tag.includes(".") &&
              (!tag.includes(":") || tag.startsWith("svelte:"))
            if (!isOnDirective && !isOnclickAttr) continue
            // The handler's LINE is where its identifier starts, not where
            // the expression opens — a multiline arrow body
            // (`onsubmit={(e) => {\n e.preventDefault()\n}}`) names its callee
            // lines below the attribute. Same rule for both spellings.
            const handlerSite = this.onHandlerCall(attr)
            const handler = handlerSite?.name
            if (handler && handler !== moduleName) {
              relationships.push({
                source: moduleName,
                target: handler,
                type: ASTEngine.RelationshipType.Calls,
                confidence: 0.85,
                ...(typeof handlerSite.line === "number" ? { line_number: handlerSite.line } : {}),
                metadata: {
                  context: isOnDirective
                    ? `Svelte event directive ${attrName}`
                    : `Svelte event attribute ${attrName}`,
                },
              })
            }
          }
          // {@attach handler} / {@attach handler(args)} — Svelte 5 attachment
          // directives. The pinned grammar has no rule for them: they parse as
          // a stable ERROR shape — `{`, `@`, ERROR[attach], the handler
          // expression, `}` (measured in script/m14/tmp/web-adv-attach-tree.ts,
          // the adversarial round on the M12 census residual). The lane reads
          // that shape structurally: identifier and call forms emit a calls
          // edge at the handler's own line; any other expression (arrow
          // params, member chains) emits nothing — the same no-fabrication
          // policy as the event lane. Attach is a behavior hook on intrinsic
          // AND component tags.
          for (let i = 0; i < startTag.childCount; i++) {
            const directive = startTag.child(i)
            if (!directive || directive.type !== "ERROR") continue
            const kids: Node[] = []
            for (let j = 0; j < directive.childCount; j++) {
              const c = directive.child(j)
              if (c) kids.push(c)
            }
            const attachIdx = kids.findIndex((k) => k.type === "ERROR" && k.text === "attach")
            if (attachIdx < 0) continue
            const nameTok = kids[attachIdx + 1]
 if (!nameTok || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(nameTok.text)) continue
            const afterText = (kids[attachIdx + 2]?.text ?? "}").trim()
            if (afterText !== "}" && afterText !== "(") continue
            const attachHandler = nameTok.text
            if (attachHandler === moduleName) continue
            relationships.push({
              source: moduleName,
              target: attachHandler,
              type: ASTEngine.RelationshipType.Calls,
              confidence: 0.8,
              line_number: nameTok.startPosition.row + 1,
              metadata: { context: "Svelte attach directive" },
            })
          }
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const child = n.namedChild(i)
        if (child) templateStack.push({ node: child, scope: childScope })
      }
    }

    // --- 3. Script pass: nested JS/TS parse (engine-provided trees) -----------
    // Multiple <script> blocks are allowed (context="module" + instance);
    // each is parsed independently and offset back to SFC lines.
    const scriptTrees: Tree[] = context?.sfcScriptTrees ?? []
    const scriptLines: number[] = context?.sfcScriptLines ?? []
    const scriptCols: number[] = context?.sfcScriptCols ?? []
    // H4 (review wave): SFC byte base per block for index coherence (same
    // engine field the Vue wave added; absent in hand-built contexts it
    // defaults to 0, preserving old behavior exactly).
    const scriptStartIdx: number[] = (context as any)?.sfcScriptStartIndex ?? []
    let scriptDecisions = 0
    for (let bi = 0; bi < scriptTrees.length; bi++) {
      const scriptTree = scriptTrees[bi]
      const scriptStartLine = scriptLines[bi]
      const scriptStartColumn = scriptCols[bi]
      const scriptBlockIndex = scriptStartIdx[bi] ?? 0
      if (!scriptTree || scriptStartLine === undefined) continue
      const scriptContent = scriptTree.rootNode?.text ?? ""
      const lineOffset = scriptStartLine - 1
      const colOffset = scriptStartColumn ?? 0
      // Dispatch by the block's lang attribute — lang="ts" blocks were run
      // through the JS analyzer even though the engine pre-parses them with
      // the TS grammar, silently dropping TS-only declarations.
      // #903: `tsx` is TypeScript too (the engine parses it with the
      // JSX-capable tsx grammar and reports the block's own lang here).
      const isTs = context?.sfcScriptLangs?.[bi] === "ts" || context?.sfcScriptLangs?.[bi] === "tsx"

      let sub: ASTEngine.ParseResult
      try {
        sub = isTs
          ? new RealTypeScriptAnalyzer().analyze(scriptTree.rootNode, scriptContent, filePath)
          : new RealJavaScriptAnalyzer().analyze(scriptTree.rootNode, scriptContent, filePath, context)
      } catch (e: any) {
        sub = { symbols: [], relationships: [], imports: [], exports: [], errors: [], metadata: {} } as any
        errors.push({
          message: `script sub-parse failed: ${e?.message?.slice(0, 120)}`,
          range: { startLine: scriptStartLine, startColumn: 0, endLine: scriptStartLine, endColumn: 0 },
          severity: "warning",
        })
      }

      // 3a. Svelte-specific symbols from the script tree: $props() destructure
      //     → Property; $: reactive declaration targets → Variable.
      this.extractSvelteDeclarations(scriptTree.rootNode, moduleName, symbols, lineOffset, colOffset, scriptBlockIndex)

      // Block-kind: context="module" exports are MODULE API, never
      // component props. Only instance-block export-let/const bindings are
      // the component's public prop surface.
      const isModuleBlock = this.isModuleContextBlock(rootNode, bi)

      // 3b. Merge JS analyzer output, offset to SFC lines, filter rune calls.
      // S2 (#419): the names declared by $props() destructuring are emitted as
      // component-owned Properties by extractSvelteDeclarations below; the JS
      // sub-analyzer ALSO emits them as destructured Variables. Drop the JS
      // duplicates so each rune-prop binding is declared EXACTLY once.
      const runePropNames = new Set<string>()
      this.collectPropsDestructuredNames(scriptTree.rootNode, runePropNames)
      const runePropNamesLowered = new Set(scriptContent.length > 0 ? [...runePropNames] : [])
      // S6: a `$:` reactive target is component state declared by
      // extractSvelteDeclarations below; the JS sub-analyzer's plain copy of
      // the same `let` variable is DUPLICATE — drop it so the component-owned
      // reactive symbol is the only one.
      const reactiveTargetNames = new Set<string>()
      this.collectReactiveTargetNames(scriptTree.rootNode, reactiveTargetNames)
      for (const s of sub.symbols ?? []) {
        if (runePropNamesLowered.has((s.name ?? "") as string)) continue
        if (reactiveTargetNames.has((s.name ?? "") as string)) continue
        // H4: full SFC coherence — lines + first-line cols + byte indices
        // (same single-line endColumn rule as the Vue wave).
        const firstLine = s.range.startLine === 1
        s.range.startLine += lineOffset
        s.range.endLine += lineOffset
        if (firstLine && colOffset) {
          s.range.startColumn += colOffset
          if (s.range.endLine === s.range.startLine) s.range.endColumn += colOffset
        }
        if (scriptBlockIndex && s.range.startIndex !== undefined) s.range.startIndex += scriptBlockIndex
        if (scriptBlockIndex && s.range.endIndex !== undefined) s.range.endIndex += scriptBlockIndex
        // M49 #868: the symbol's own metadata line mirrors travel with its range
        // (metadata.decoratorLines is a SCRIPT-relative list of line numbers).
        shiftMetadataLineMirrors(s.metadata as Record<string, unknown> | undefined, lineOffset)
        // Svelte prop: `export let x` — JS analyzer reports Variable + export;
        // reclassify as Property (the component's public prop API). Exported
        // bindings (export let/const/function/class) are component-owned
        // (contains + owner) like Vue props.
        if (!isModuleBlock && this.isExported(sub.exports ?? [], s.name)) {
          const wasVariable = s.kind === ASTEngine.SymbolKind.Variable
          if (wasVariable) {
            s.kind = ASTEngine.SymbolKind.Property
            // annotate ONLY actual props - a false isSvelteProp key on
            // every exported binding polluted the payload
            s.metadata = { ...(s.metadata ?? {}), isSvelteProp: true }
          }
          s.ownerName = moduleName
          s.ownerKind = ASTEngine.SymbolKind.Class
          s.scope = moduleName
        }
        symbols.push(s)
      }
      const moduleExportNames = new Set(
        isModuleBlock ? (sub.exports ?? []).map((e) => e.name) : [],
      )
      for (const r of sub.relationships ?? []) {
        const tgt = (r.target ?? "") as string
        if (SVELTE_RUNES.has(tgt)) continue
        // module-block exports are module API, not component members
        if (r.type === ASTEngine.RelationshipType.Contains && isModuleBlock && moduleExportNames.has(tgt)) continue
        // Dotted runes ($derived.by, $effect.root, $props.id): the JS
        // call-target extractor keeps the LAST segment ('by', 'root',
        // 'id'), so the exact-name filter above never fired for them.
        // PRECISE RULE: full dotted name is a known rune, OR the callee is
        // '$'-prefixed with a RUNE LEAF segment. A bare '$'-prefix alone
        // would also swallow USER-defined $functions - silent data loss.
        const callee = (r.metadata?.calleeExpression ?? "") as string
        if (isRuneCallee(callee) || (r.source === "(script)" && SVELTE_RUNES.has(tgt))) continue
        // M59 (#825): the delegate's lines are SCRIPT-RELATIVE — shift them to
        // file lines here, the same rule the symbols/imports/exports merges
        // apply. Measured before this: svelte 19 of 58 line-bearing edges
        // INCONSISTENT (vue 562 of 585). The applied offset is recorded on the
        // edge so the seam is auditable and testable (see the vue twin).
        if (typeof r.line_number === "number") r.line_number += lineOffset
        // M49 #868: the metadata line mirrors move with it (see the helper).
        shiftMetadataLineMirrors(r.metadata as Record<string, unknown> | undefined, lineOffset)
        r.metadata = { ...(r.metadata ?? {}), sfcDelegated: true, sfcLineOffset: lineOffset }
        relationships.push(r)
      }
      for (const i of sub.imports ?? []) {
        if (i.range) {
          const firstLine = i.range.startLine === 1
          i.range.startLine += lineOffset
          i.range.endLine += lineOffset
          if (firstLine && colOffset) {
            i.range.startColumn += colOffset
            if (i.range.endLine === i.range.startLine) i.range.endColumn += colOffset
          }
          if (scriptBlockIndex && i.range.startIndex !== undefined) i.range.startIndex += scriptBlockIndex
          if (scriptBlockIndex && i.range.endIndex !== undefined) i.range.endIndex += scriptBlockIndex
        }
        imports.push(i)
      }
      // M49 exports invariant: component-owned svelte props (export let →
      // Property, ownerName = component above) are component MEMBERS —
      // membership rides Contains, they are not module exports. Only
      // module-block exports (`<script context="module">` — the module's
      // true importable API) flow into the export list.
      // D1 (second review): these were pushed raw with script-relative
      // ranges — shift to SFC coherence like every other script artifact.
      if (isModuleBlock) {
        for (const e of sub.exports ?? []) {
          const r = (e as any).range
          if (r) {
            const firstLine = r.startLine === 1
            r.startLine += lineOffset
            r.endLine += lineOffset
            if (firstLine && colOffset) {
              r.startColumn += colOffset
              if (r.endLine === r.startLine) r.endColumn += colOffset
            }
            if (scriptBlockIndex && r.startIndex !== undefined) r.startIndex += scriptBlockIndex
            if (scriptBlockIndex && r.endIndex !== undefined) r.endIndex += scriptBlockIndex
          }
          exports.push(e)
        }
      }
      // H4: sub-errors are script-relative — shift to SFC coherence.
      for (const er of sub.errors ?? []) {
        const r = er.range as any
        if (r) {
          const firstLine = r.startLine === 1
          r.startLine += lineOffset
          r.endLine += lineOffset
          if (firstLine && typeof r.startColumn === "number") {
            r.startColumn += colOffset
            r.endColumn += colOffset
          }
          if (typeof r.startIndex === "number") {
            r.startIndex += scriptBlockIndex
            r.endIndex += scriptBlockIndex
          }
        }
        errors.push(er)
      }
      scriptDecisions += Math.max(0, ((sub.metadata as any)?.cyclomaticComplexity ?? 1) - 1)
    }

    // --- 3c. Template expression uses (S1) ------------------------------------
    // The template reads the component's own members: {count}, label={label},
    // {#each rows as row} (collection rows), {#await promise}, {@html raw},
    // {@const total}, <svelte:component this={inc}> — each is a Use of a
    // member symbol. Emit only for identifiers that resolve to a member;
    // template-locals (already filtered by the shadow scope) and intrinsics
    // stay silent — no junk edges.
    if (templateExprNames.size > 0) {
      const memberNames = new Set(symbols.map((s) => s.name))
      const seenUses = new Set<string>()
      for (const [name, line] of templateExprNames) {
        // Svelte store auto-subscription: `{$store}` reads the VALUE of the
        // `store` member (`$:` rules don't apply in markup). A single-`$`
        // name that matches no member resolves through the sigil to a member
        // that does — measured on a `writable` store read with zero edges.
        // Exact matches win first (a member literally named `$x` keeps its
        // edge); `$$` legacy specials (`$$props`) never strip.
        let resolved = name
        if (
          !memberNames.has(name) &&
          name.startsWith("$") &&
          !name.startsWith("$$") &&
          memberNames.has(name.slice(1))
        ) {
          resolved = name.slice(1)
        }
        if (!memberNames.has(resolved)) continue
        const key = `${moduleName}:${resolved}`
        if (seenUses.has(key)) continue
        seenUses.add(key)
        relationships.push({
          source: moduleName,
          target: resolved,
          type: ASTEngine.RelationshipType.Uses,
          confidence: 0.95,
          // M59 (#825): the line the identifier is WRITTEN on, recorded where
          // the text was scanned. `0` can only appear if a caller passed no
          // base line for a fragment it could not locate — the oracle counts
          // that as a wrong line rather than a silent pass.
          ...(line > 0 ? { line_number: line } : {}),
          metadata: { isTemplateExpression: true },
        })
      }
    }

    // H2 (review wave): dynamic `this=` targets that did NOT resolve as
    // member uses. An import-bound bare identifier in component position is
    // a component usage (the standard dynamic-dispatch pattern); anything
    // else stays silent per the no-junk rule. Member-resolved targets
    // already carry a Uses edge above and are skipped (no double emission).
    if (thisTargets.size > 0) {
      const memberNames = new Set(symbols.map((s) => s.name))
      const importBindings = new Set<string>()
      for (const imp of imports) {
        for (const item of imp.items ?? []) {
          if (item && item !== "*") importBindings.add(item)
        }
      }
      for (const [name, line] of thisTargets) {
        if (memberNames.has(name) || !importBindings.has(name)) continue
        relationships.push({
          source: moduleName,
          target: name,
          type: ASTEngine.RelationshipType.Instantiates,
          confidence: 0.95,
          // M59 (#825): the `this={X}` value's line.
          ...(line > 0 ? { line_number: line } : {}),
          metadata: { isComponentUsage: true },
        })
      }
    }

    // --- 4. contains from ownerName -------------------------------------------
    for (const s of symbols) {
      if (s.ownerName) {
        relationships.push({
          source: s.ownerName,
          target: s.name,
          type: ASTEngine.RelationshipType.Contains,
          confidence: 1.0,
          // M59 (#825): the MEMBER's declaration line (already in SFC
          // coordinates) — the edge names the member.
          ...(s.range?.startLine ? { line_number: s.range.startLine } : {}),
          metadata: {},
        })
      }
    }

    // --- Metadata ---------------------------------------------------------------
    const architecturalScore = Math.min(100, Math.max(0, 100 - errors.length * 5))
    const detectedPatterns = Object.keys(patterns)
    const frameworkPatterns = detectedPatterns.map((p) => ({
      framework: "Svelte",
      patterns: [{ type: "usage", detected: true, description: p }],
    }))

    // DEDUPE: sub-analyzers emit their own contains edges; combined with
    // the ownerName-based pass above, identical triples appeared twice.
    const relSeen = new Set<string>()
    const uniqueRelationships: ASTEngine.UniversalRelationship[] = []
    for (const r of relationships) {
      const key = `${String(r.type)}|${String(r.source)}|${String(r.target)}`
      if (relSeen.has(key)) continue
      relSeen.add(key)
      uniqueRelationships.push(r)
    }
    relationships.length = 0
    relationships.push(...uniqueRelationships)

    // Evidence tiers on EVERY edge (#419-D) — same rules as the Vue/JVM family.
    this.classifyEvidenceTier(relationships)
    const cyclomaticComplexity = 1 + templateDecisions + scriptDecisions

    return {
      language: "svelte",
      symbols,
      relationships,
      imports,
      exports,
      errors,
      metadata: {
        // Real cyclomatic complexity: script decisions + template decision
        // blocks. Was the synthetic symbols+relationships heuristic with a
        // hardcoded cyclomatic of 1 (fourth analyzer with this disease).
        complexity: cyclomaticComplexity,
        linesOfCode: content.split("\n").length,
        cyclomaticComplexity,
        framework: "Svelte",
        patterns: detectedPatterns,
        detectedFrameworks: ["Svelte"],
        frameworkPatterns,
        architecturalInsights: [],
        architecturalScore,
        hasFrameworkIntelligence: true,
        hasTypeInference: false,
      },
    }
  }

  // ============================================================================
  // SVELTE-SPECIFIC DECLARATION EXTRACTION
  // ============================================================================

  /**
   * S2 (#419): the binding names declared by a $props() destructure
   * (`let { a, b, c = 5 } = $props()`). These are component-owned Properties
   * emitted by extractSvelteDeclarations; the JS sub-analyzer's parallel
   * destructured Variables are dropped to avoid double declaration.
   */
  private collectPropsDestructuredNames(root: Node, out: Set<string>): void {
    const stack: Node[] = [root]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "call_expression") {
        const callee = n.childForFieldName?.("function") ?? n.namedChild(0)
        if (callee && (callee.text === "$props" || callee.text === "$props()")) {
          const declarator = this.findAncestor(n, (p) => p.type === "variable_declarator")
          if (declarator) {
            const pattern = declarator.childForFieldName?.("name") ?? this.findChildByType(declarator, "object_pattern")
            const names = pattern ? this.objectPatternNames(pattern) : []
            names.forEach((nm) => out.add(nm))
          }
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
  }

  private objectPatternNames(pattern: Node): string[] {
    return this.objectPatternPairs(pattern).map((p) => p.name)
  }

  /**
   * M59 (#825) follow-up, measured on a `$props()` rename destructure: the
   * pair VALUE binds, not the key (`let { renamed: local }` binds `local`).
   * The old key-side naming emitted a phantom Property `renamed` AND defeated
   * the merge dedupe (the JS delegate's correct `local` survived alongside
   * it — one binding, two symbols). Each pair also carries its node so the
   * symbol ranges at its own NAME line, not the whole declarator.
   */
  private objectPatternPairs(pattern: Node): Array<{ name: string; node: Node }> {
    const out: Array<{ name: string; node: Node }> = []
    const take = (n: Node): void => {
      if (
        n.type === "identifier" ||
        n.type === "shorthand_property_identifier" ||
        n.type === "shorthand_property_identifier_pattern"
      ) {
        out.push({ name: n.text, node: n })
      } else if (n.type === "pair_pattern") {
        const value = n.childForFieldName?.("value")
        if (value) take(value)
      } else if (n.type === "rest_pattern") {
        const inner = n.namedChild(0)
        if (inner) take(inner)
      } else if (n.type === "assignment_pattern") {
        const left = n.childForFieldName?.("left") ?? n.namedChild(0)
        if (left) take(left)
      } else if (
        n.type === "object_assignment_pattern" ||
        n.type === "object_pattern" ||
        n.type === "array_pattern"
      ) {
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c) take(c)
        }
      }
    }
    take(pattern)
    return out
  }

  /**
   * S6 (#419): collect the target names of every `$:` reactive declaration
   * (`$: doubled = expr` → `doubled`). Used at the merge to drop the JS/TS
   * sub-analyzer's PLACE COPY of such a variable, so the component-owned
   * reactive symbol emitted by extractSvelteDeclarations is the ONLY one —
   * the same dedupe S2 applies to $props() bindings.
   */
  private collectReactiveTargetNames(root: Node, out: Set<string>): void {
    const stack: Node[] = [root]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "labeled_statement") {
        const label = n.namedChild(0)
        if (label && label.text === "$") {
          const assignment = this.findDescendant(n, (c) => c.type === "assignment_expression")
          const left = assignment?.childForFieldName?.("left") ?? assignment?.namedChild(0)
          if (left && left.type === "identifier") out.add(left.text)
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
  }

  private extractSvelteDeclarations(
    root: Node,
    componentName: string,
    symbols: ASTEngine.UniversalSymbol[],
    lineOffset: number,
    colOffset: number,
    indexOffset = 0,
  ): void {
    const stack: Node[] = [root]
    // S6 (#419): a `$:` target assigned from MULTIPLE reactive blocks is still
    // ONE variable — track already-declared targets so we never push a second
    // identical symbol for the same name.
    const reactiveTargets = new Set<string>()
    while (stack.length > 0) {
      const n = stack.pop()!
      // $props() destructure → Property symbols (`let { a, b } = $props()`)
      if (n.type === "call_expression") {
        const callee = n.childForFieldName?.("function") ?? n.namedChild(0)
        if (callee && (callee.text === "$props" || callee.text === "$props()")) {
          const declarator = this.findAncestor(n, (p) => p.type === "variable_declarator")
          if (declarator) {
            const pattern = declarator.childForFieldName?.("name") ?? this.findChildByType(declarator, "object_pattern")
            // M59 (#825): each binding ranges at its OWN name node — a wrapped
            // `$props()` destructure stamped the whole declarator line for
            // every member. Pairs carry value-side names (see
            // objectPatternPairs), so a rename binds `local`, not `renamed`.
            const pairs = pattern && pattern.type === "object_pattern" ? this.objectPatternPairs(pattern) : []
            for (const { name, node: nameNode } of pairs) {
              symbols.push({
                name,
                kind: ASTEngine.SymbolKind.Property,
                range: this.offsetRange(this.nodeToRange(nameNode), lineOffset, colOffset, indexOffset),
                scope: componentName,
                ownerName: componentName,
                ownerKind: ASTEngine.SymbolKind.Class,
                visibility: "public",
                metadata: { isSvelteProp: true, fromRunes: true },
              })
            }
          }
        }
      }
      // $: reactive declaration → Variable (`$: doubled = expr`)
      if (n.type === "labeled_statement") {
        const label = n.namedChild(0)
        if (label && label.text === "$") {
          const assignment = this.findDescendant(n, (c) => c.type === "assignment_expression")
          if (assignment) {
            const left = assignment.childForFieldName?.("left") ?? assignment.namedChild(0)
            if (left && left.type === "identifier") {
              // S6: a target already declared by an earlier $: block is the SAME
              // variable — only the first block declares it.
              if (reactiveTargets.has(left.text)) continue
              reactiveTargets.add(left.text)
              symbols.push({
                name: left.text,
                kind: ASTEngine.SymbolKind.Variable,
                range: this.offsetRange(this.nodeToRange(assignment), lineOffset, colOffset, indexOffset),
                scope: componentName,
                ownerName: componentName,
                ownerKind: ASTEngine.SymbolKind.Class,
                visibility: "public",
                metadata: { isReactiveDeclaration: true },
              })
            }
          }
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
  }

  /**
   * Is the bi-th <script> block marked context="module"? Module-block
   * exports are module-level API - they must NOT become component props.
   */
  private isModuleContextBlock(rootNode: Node, index: number): boolean {
    // Document-order scan - a LIFO stack walk visits later siblings first,
    // which INVERTED the block indices (module block treated as instance).
    const blocks: Node[] = []
    const walk = (n: Node): void => {
      if (n.type === "script_element") {
        blocks.push(n)
        return
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) walk(c)
      }
    }
    walk(rootNode)
    const block = blocks[index]
    if (!block) return false
    const startTag = this.findChildByType(block, "start_tag")
    return !!startTag && /context=["']module["']/.test(startTag.text)
  }

  private isExported(exportInfos: ASTEngine.ExportInfo[], name: string): boolean {
    for (const e of exportInfos) {
      if (e.name === name && !e.isDefault) return true
    }
    return false
  }

  // ============================================================================
  // S1 TEMPLATE EXPRESSION EXTRACTION
  // ============================================================================

  /** Extract the opaque expression text from a node (svelte_raw_text child). */
  /** The `svelte_raw_text` node the expression body lives in — the node that
   *  gives the expression a LINE (M59 #825). `expressionText` returns only the
   *  string, which is exactly why every template read in this analyzer claimed
   *  no line at all. */
  private expressionTextNode(node: Node): Node | null {
    const stack: Node[] = [node]
    while (stack.length > 0) {
      const m = stack.pop()!
      if (m.type === "svelte_raw_text") return m
      for (let i = m.namedChildCount - 1; i >= 0; i--) {
        const c = m.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return null
  }

  private expressionText(node: Node): string {
    return this.expressionTextNode(node)?.text ?? ""
  }

  /** Every `svelte_raw_text` node under `root`, in document order — text AND
   *  position from the same node, so a fragment's line cannot drift from the
   *  fragment the name was read out of. */
  private rawTextNodes(root: Node): Node[] {
    const out: Node[] = []
    const stack: Node[] = [root]
    while (stack.length > 0) {
      const m = stack.pop()!
      if (m.type === "svelte_raw_text") out.push(m)
      for (let i = m.namedChildCount - 1; i >= 0; i--) {
        const c = m.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return out.sort((a, b) => a.startIndex - b.startIndex)
  }

  /** Line breaks before `end` — how far into a fragment a match sits. */
  private static linesBefore(text: string, end: number): number {
    let n = 0
    for (let i = 0; i < end && i < text.length; i++) if (text[i] === "\n") n++
    return n
  }

  /**
   * Shadow-binding sites only: the names are DEFINITIONS, so no line is ever
   * claimed for them — but they MUST land in `shadowed`.
   *
   * Careful: the pre-#825 call sites did this by passing the shadow set as the
   * collector's `out` (`collectIdentifiersFromText(vars, shadowed, new Set())`),
   * which is where the bindings were registered. Now that `out` is a Map, that
   * shape silently registers nothing — measured: `{#each rows as row}` and
   * `{#await p then value}` stopped shadowing, so `row`/`item`/`total`/`value`/
   * `d` all came back as template READS (two existing fixtures caught it:
   * svelte/each-shadow-collision and svelte/await-inline-shadow). So the names
   * are collected into a scratch Map and then transferred, preserving the
   * original semantics exactly.
   */
  private collectShadowNames(text: string, shadowed: Set<string>): void {
    const names = new Map<string, number>()
    this.collectIdentifiersFromText(text, names, new Set())
    for (const n of names.keys()) shadowed.add(n)
  }

  private collectIdentifiersFromText(text: string, out: Map<string, number>, shadowed: Set<string>, baseLine = 0): void {
    // M2+M3 (review wave): the flat identifier regex read string contents
    // (`f("a=b")` -> Uses(a), Uses(b)) and chain leaves (`item.id` -> member
    // `id`) as member reads. Character walk with quote states (backslash
    // escapes honored; backtick ${...} re-enters code, brace-tracked) and
    // receiver-only emission (dot/?./#-preceded tokens skipped) — the same
    // contract as the Vue D1/M1 machine, implemented here because the two
    // analyzers share no template code.
    // D3 (second review): `//` and `/* */` comments are code-skipped — a
    // `{f(a) /* b */}` comment must not read member b. (Vue's twin machine
    // has the same hole; flagged as a family follow-up, fixed here where
    // probe-proven.) Comment detection runs in code context only, so string
    // contents (URLs, '//' literals) are unaffected.
    const isIdentStart = (ch: string): boolean =>
      (ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || ch === "_" || ch === "$"
    const isIdentPart = (ch: string): boolean => isIdentStart(ch) || (ch >= "0" && ch <= "9")
    const isSpace = (ch: string): boolean => ch === " " || ch === "\t" || ch === "\n" || ch === "\r"
    const stack: string[] = []
    const emit = (word: string, start: number): void => {
      let k = start - 1
      while (k >= 0 && isSpace(text[k])) k--
      const prev = k >= 0 ? text[k] : ""
      const prev2 = k - 1 >= 0 ? text[k - 1] : ""
      if (prev === "." || (prev2 === "?" && prev === ".") || prev === "#") return
      if (shadowed.has(word)) return
      out.set(word, baseLine + RealSvelteAnalyzer.linesBefore(text, start))
    }
    let i = 0
    while (i < text.length) {
      const ch = text[i]
      const top = stack.length > 0 ? stack[stack.length - 1] : ""
      if (top === "'" || top === '"') {
        if (ch === "\\") { i += 2; continue }
        if (ch === top) stack.pop()
        i++
        continue
      }
      if (top === "`") {
        if (ch === "\\") { i += 2; continue }
        if (ch === "$" && text[i + 1] === "{") { stack.push("${"); i += 2; continue }
        if (ch === "`") { stack.pop(); i++; continue }
        i++
        continue
      }
      if (ch === "'" || ch === '"' || ch === "`") { stack.push(ch); i++; continue }
      if (ch === "{") { stack.push(ch); i++; continue }
      if (ch === "}") {
        if (top === "{" || top === "${") stack.pop()
        i++
        continue
      }
      // D3: comment skipping (code context only — quote states returned
      // above, so '//' inside strings/regex-shaped text is literal).
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
      if (!isIdentStart(ch)) { i++; continue }
      let j = i + 1
      while (j < text.length && isIdentPart(text[j])) j++
      emit(text.slice(i, j), i)
      i = j
    }
  }

  /** {#each items as item, i} — collection is a use; loop vars shadow. */
  private collectEachExpression(node: Node, out: Map<string, number>, shadowed: Set<string>): void {
    const start = this.findDescendant(node, (c) => c.type === "each_start")
    if (!start) return
    const rawTexts = this.rawTextNodes(start)
    // each_start has two raw_text children: [collection, vars]
    const collection = rawTexts[0]
    if (collection) this.collectIdentifiersFromText(collection.text, out, shadowed, collection.startPosition.row + 1)
    // S5 (#419): the loop-var list (rawTexts[1], e.g. `row, i` / `[a, b]` /
    // `{ id }`) binds template-LOCAL names that SHADOW same-named members. They
    // must be registered into `shadowed` (the set the children inherit) so a
    // `{row}`/`{row.id}` reading the loop element never emits a false Use of a
    // member function `row`. Previously this was never seeded — the shadow
    // machinery was dead for `{#each}` and only "passed" fixtures where no
    // same-named member existed to collide (the vue V4 bug class).
    const vars = rawTexts[1]
    this.collectShadowNames(vars?.text ?? "", shadowed)
  }

  /** {#await promise then value} {:catch err} — promise is a use; vars shadow. */
  private collectAwaitExpression(node: Node, out: Map<string, number>, shadowed: Set<string>): void {
    const start = this.findDescendant(node, (c) => c.type === "await_start")
    const thenBlk = this.findDescendant(node, (c) => c.type === "then_start")
    const catchBlk = this.findDescendant(node, (c) => c.type === "catch_start")
    if (start) {
      const rawNodes = this.rawTextNodes(start)
      const rawTexts = rawNodes.map((r) => r.text)
      // await_start raw_text: `promise then value` / `promise as value`
      const text = rawTexts.join(" ")
      // The promise expression (everything before `then`/`as`) is entirely
      // inside the FIRST fragment, so that fragment's own line is its base.
      const firstLine = rawNodes[0] ? rawNodes[0].startPosition.row + 1 : 0
      // the promise expression is everything up to then/as; then/catch vars
      // shadow. Simpler: collect all identifiers but drop the then/catch vars
      // (already added to childShadowed), and only the promise survives.
      const m = /^(.*?)\s+(?:then|as)\s+/.exec(text)
      const promiseExpr = m ? m[1] : text
      this.collectIdentifiersFromText(promiseExpr, out, shadowed, firstLine)
      // M4 (review wave): the INLINE then/as vars (`then value` with no
      // then_block node) were never registered — {value} later leaked as a
      // member use. Register the remainder as template-local bindings.
      if (m) {
        const rest = text.slice(m[0].length)
        this.collectShadowNames(rest, shadowed)
      }
    }
    // then/catch var names shadow members within their block.
    // M1 (review wave): no phantom entries — an earlier revision appended a
    // literal " x" here, shadowing every member named x in every await block
    // subtree (probe: real {x} read suppressed). Empty blocks collect
    // nothing on their own, which is already correct.
    for (const blk of [thenBlk, catchBlk]) {
      if (!blk) continue
      // Shadow bindings only — no line is needed (and none is claimed).
      const rawTexts = this.rawTextNodes(blk).map((r) => r.text)
      this.collectShadowNames(rawTexts.join(" "), shadowed)
    }
  }

  /** D5: {#if cond} / {:else if cond} / {#key exp} — the condition is a
   *  svelte_raw_text child of if_start/else_if_start/key_start (no
   *  `expression` wrapper, unlike mustache bodies). Every identifier is a
   *  member read; these heads bind nothing, so no shadow registration. */
  private collectConditionExpression(node: Node, out: Map<string, number>, shadowed: Set<string>): void {
    const start = this.findDescendant(node, (c) =>
      c.type === "if_start" || c.type === "else_if_start" || c.type === "key_start")
    if (!start) return
    const rawNodes = this.rawTextNodes(start)
    // if_start's raw_text INCLUDES the {#if marker text? No — block_start_tag
    // is a separate child holding `#if`; raw_text holds only the condition.
    // (Verified against the live grammar: if_start->[block_start_tag,
    // svelte_raw_text]; the tag child contributes no raw text.)
    // M59 (#825): the condition node's own line is the base; a multi-fragment
    // head (`{#key a}` + separate text) then offsets from the first fragment, so
    // the claimed line is still a line the name is written on.
    const baseLine = rawNodes[0] ? rawNodes[0].startPosition.row + 1 : 0
    this.collectIdentifiersFromText(rawNodes.map((r) => r.text).join(" "), out, shadowed, baseLine)
  }

  /** {#snippet row(label, count)} heads — params are template-local. */
  private collectSnippetParams(node: Node, shadowed: Set<string>): void {
    const start = this.findDescendant(node, (c) => c.type === "snippet_start")
    if (!start) return
    // Shadow bindings only — no line is claimed for them.
    const rawTexts = this.rawTextNodes(start).map((r) => r.text)
    this.collectShadowNames(rawTexts.join(" "), shadowed)
  }

  /** A template expression body ({count}, label={label}, {@html raw}). */
  private collectExpressionIdentifiers(node: Node, out: Map<string, number>, shadowed: Set<string>): void {
    const textNode = this.expressionTextNode(node)
    this.collectIdentifiersFromText(textNode?.text ?? "", out, shadowed, textNode ? textNode.startPosition.row + 1 : 0)
  }

  /** D4: last all-identifier segment of a dotted render target
   *  (`ns.row(it)` -> row; `a . b . c()` -> c). Returns undefined unless
   *  every segment is a bare identifier — the caller keeps its fallback. */
  private dottedRenderLeaf(text: string): string | undefined {
    // cut the trailing `}` and any call arguments `(...)`
    let body = text.trim()
    if (body.endsWith("}")) body = body.slice(0, -1)
    const paren = body.indexOf("(")
    if (paren >= 0) body = body.slice(0, paren)
    const parts = body.split(".").map((p) => {
      // strip whitespace and one optional-chaining marker by hand (no
      // regex — the R2 census gates every pattern literal in this family)
      let q = p.trim()
      if (q.endsWith("?")) q = q.slice(0, -1).trim()
      return q
    })
    if (parts.length < 2 || !parts.every((p) => isIdentifier(p))) return undefined
    return parts[parts.length - 1]
  }

  /** {@html raw} / {@const total = expr} / {@debug expr} — body is a direct
   *  svelte_raw_text child of the tag (no `expression` wrapper). */
  private collectTagExpressionIdentifiers(node: Node, out: Map<string, number>, shadowed: Set<string>): void {
    const textNode = this.expressionTextNode(node)
    const baseLine = textNode ? textNode.startPosition.row + 1 : 0
    let text = textNode?.text ?? ""
    // {@const total = expr} — `total` is the const's OWN template-local
    // BINDING, not a member use; only the RHS expression reads members (and
    // the RHS loop vars are already shadowed). Strip the binding LHS so the
    // declared name never leaks as a use (S5, {@const} shadow case).
    let base = baseLine
    if (node.type === "const_tag") {
      const eq = this.topLevelEq(text)
      if (eq >= 0) {
        // The RHS starts after the `=` — advance the base by the breaks the
        // `{@const name =` prefix contains, so the line stays the expression's.
        base = baseLine + RealSvelteAnalyzer.linesBefore(text, eq + 1)
        text = text.slice(eq + 1)
      }
    }
    this.collectIdentifiersFromText(text, out, shadowed, base)
  }

  /** Index of the first top-level `=` (not inside () / [] / {}) in `text`.*/
  private topLevelEq(text: string): number {
    let depth = 0
    for (let i = 0; i < text.length; i++) {
      const c = text[i]
      if (c === "(" || c === "[" || c === "{") depth++
      else if (c === ")" || c === "]" || c === "}") depth--
      else if (c === "=" && depth === 0) return i
    }
    return -1
  }

  /**
   * M59 (#825) follow-up, measured on shadcn-svelte forms: the handler's
   * NAME and its LINE travel together. The old text-only leaf plus the
   * expression node's line split them across lines for multiline arrow
   * bodies. Same three rules as before (first call target, bare identifier,
   * dotted callable leaf), each now carrying its offset into the raw text.
   */
  private onHandlerCall(attr: Node): { name: string; line: number } | undefined {
    // The maintained grammar (v0.6.0, Svelte 5) wraps attribute expression
    // values as `attribute > expression > svelte_raw_text`; older grammars
    // used `expr_attribute_value > raw_text_expr`. Handle both shapes.
    // Pinned wasm shape: attribute > expression (older grammars used
    // expr_attribute_value — dead here per grammar audit).
    const value = this.findChildByType(attr, "expression")
    if (!value) return undefined
    // The svelte grammar exposes template expressions as an opaque
    // raw_text_expr/svelte_raw_text leaf — the handler text must be scanned
    // with pure-String ops (the documented fallback for constructs the
    // grammar can't express).
    let text = ""
    let baseLine = 0
    const stack: Node[] = [value]
    while (stack.length > 0) {
      const m = stack.pop()!
      if (m.type === "svelte_raw_text") {
        text = m.text
        baseLine = m.startPosition.row + 1
        break
      }
      for (let i = m.namedChildCount - 1; i >= 0; i--) {
        const c = m.namedChild(i)
        if (c) stack.push(c)
      }
    }
    if (!text) return undefined
    const at = (offset: number): number => baseLine + RealSvelteAnalyzer.linesBefore(text, offset)
    // 1. First FREE identifier immediately followed by `(` = call target
    //    (`() => bump()` → bump; `() => onSelect(title)` → onSelect).
    //    FREE = not a member call: an identifier preceded by `.` (which also
    //    covers `?.`) names a property of the receiver (`rest?.onclick()`,
    //    `deferred.shift()`, `console.log('…')`) — emitting it fabricated a
    //    calls edge to a name that may not even exist in scope (#898, all six
    //    arrow-body cases). Member-call targets stay unemitted: the receiver
    //    resolution is a different, not-yet-built lane.
    // 2. Else, if the whole text is a bare identifier → that identifier
    //    (`nextPage` → nextPage).
    // 3. Else (arrow params, property access, etc.) → nothing.
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_" || ch === "$") {
        let end = i
        while (end < text.length) {
          const c = text[end]
          if ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_" || c === "$") end++
          else break
        }
        const ident = text.slice(i, end)
        if (end < text.length && text[end] === "(") {
          let back = i - 1
          while (back >= 0 && (text[back] === " " || text[back] === "\t" || text[back] === "\n")) back--
          if (back < 0 || text[back] !== ".") return { name: ident, line: at(i) }
        }
        // not a call target — move past this identifier
        i = end
      }
    }
    // Bare-identifier check
    if (isIdentifier(text)) return { name: text, line: at(0) }
    // Dotted member leaf: `on:click={box.open}` binds the method reference -
    // the CALLABLE LEAF is the last segment. (Previously emitted nothing.)
    const parts = text.split(".")
    if (parts.length > 1 && parts.every((p) => isIdentifier(p))) {
      const leaf = parts[parts.length - 1]
      return { name: leaf, line: at(text.lastIndexOf(leaf)) }
    }
    return undefined
  }

  private onHandlerLeaf(attr: Node): string | undefined {
    return this.onHandlerCall(attr)?.name
  }

  /**
   * #419-D - evidence-tier classification for EVERY emitted relationship.
   * Same rules as the Vue/JVM family. Template instantiates are
   * usage_contextual (component usage by tag name).
   */
  private classifyEvidenceTier(relationships: ASTEngine.UniversalRelationship[]): void {
    for (const r of relationships) {
      const md = r.metadata ?? (r.metadata = {})
      if (md.evidenceClass) continue
      const t = String(r.type ?? r.relationshipType ?? "")
      const conf = typeof r.confidence === "number" ? r.confidence : 1
      if (t === "contains" || t === "exports") { md.evidenceClass = "structural"; continue }
      if (t === "references") {
        md.evidenceClass = md.isImport ? "import_based" : "reference_qualified"
        continue
      }
      if (t === "extends" || t === "implements" || t === "overrides") {
        md.evidenceClass = conf >= 1 ? "structural" : conf >= 0.85 ? "usage_contextual" : "inferred"
        continue
      }
      if (t === "instantiates") {
        md.evidenceClass = md.isComponentUsage ? "usage_contextual" : "structural"
        continue
      }
      md.evidenceClass = "usage_contextual"
    }
  }

  private findAncestor(node: Node, predicate: (n: Node) => boolean): Node | null {
    let current = node.parent
    while (current) {
      if (predicate(current)) return current
      current = current.parent
    }
    return null
  }

  private findDescendant(node: Node, predicate: (n: Node) => boolean): Node | null {
    const stack: Node[] = [node]
    while (stack.length > 0) {
      const n = stack.pop()!
      // KAD2 sweep: `n !== node` never matched fresh wrappers — but the
      // predicate keys on node TYPE while the root is a container, so no
      // false-positive ever materialized. Span-based exclusion keeps the
      // guard real for root nodes whose type could match.
      if (!(n.startIndex === node.startIndex && n.endIndex === node.endIndex) && predicate(n)) return n
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return null
  }

  private elementTagName(el: Node): string | undefined {
    return this.elementTagNameNode(el)?.text
  }

  /** The `tag_name` node itself — the node that SPELLS the tag (M59 #825: the
   *  Instantiates edge for a component usage is about that name, so its line
   *  must come from the tag, not from the element's opening bracket). */
  private elementTagNameNode(el: Node): Node | null {
    // element > start_tag/self_closing_tag > tag_name (for regular elements
    // the tag_name is nested inside the start_tag, not a direct child)
    const startTag = this.findChildByType(el, "start_tag") || this.findChildByType(el, "self_closing_tag")
    if (startTag) {
      const tag = this.findChildByType(startTag, "tag_name")
      if (tag) return tag
    }
    return this.findChildByType(el, "tag_name")
  }

  private attributeName(attr: Node): string {
    const name = this.findChildByType(attr, "attribute_name")
    return name ? name.text : ""
  }

  /**
   * M59 (#825): the `line_number` for a relationship, from the node that SPELLS
   * the name the edge is about. Same contract as the java/TS/JS analyzers: the
   * line belongs to the name, and a construct with no name-bearing node gets
   * NOTHING rather than `0` (unknown must be absent, never a number).
   */
  private lineField(nameNode: Node | null | undefined): { line_number?: number } {
    return nameNode ? { line_number: nameNode.startPosition.row + 1 } : {}
  }

  private offsetRange(
    range: ASTEngine.UniversalSymbol["range"],
    lineOffset: number,
    colOffset: number,
    indexOffset = 0,
  ): ASTEngine.UniversalSymbol["range"] {
    // H4: mirror the Vue offsetRange — endColumn shifts only when the range
    // never leaves the script's first line; indices shift when defined.
    const out = { ...range }
    const firstLine = out.startLine === 1
    out.startLine += lineOffset
    out.endLine += lineOffset
    if (firstLine && colOffset) {
      out.startColumn += colOffset
      if (out.endLine === out.startLine) out.endColumn += colOffset
    }
    if (indexOffset && out.startIndex !== undefined) out.startIndex += indexOffset
    if (indexOffset && out.endIndex !== undefined) out.endIndex += indexOffset
    return out
  }

  private findChildByType(node: Node, type: string): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c && c.type === type) return c
    }
    return null
  }

  private nodeToRange(node: Node): ASTEngine.UniversalSymbol["range"] {
    return {
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      // Columns are 1-based everywhere else in the codebase (+1); this
      // analyzer silently emitted 0-based columns.
      startColumn: node.startPosition.column + 1,
      endColumn: node.endPosition.column + 1,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    }
  }
}
