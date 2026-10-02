// Vue Intelligence Engine
// M12.12 rewrite: C#-family contract, pure-AST.
//
// REGEX-FREE, and the claim is now enforced rather than asserted.
//
// History, because the header is what went wrong twice: it first CLAIMED to be
// regex-free while the file carried 6 literals. Correcting it to admit 6
// registered-and-justified patterns was true, and still weak — a registered
// pattern is a pattern, and the census only ever proved they were accounted for.
// All six are now DELETED (vue final review 2026-09-30): a case-insensitive
// substring test, quote stripping on a `name:` value, an identifier character
// class used twice, and the two v-for patterns — the last replaced by
// `parseVForDirective`, which reproduces their lazy head, their `)` handling and
// their newline behaviour exactly, backtracking included.
//
// Zero is a CLAIM, so it is gated: script/m60/verify-vue-no-regex.ts counts the
// literals and re-derives the equivalence between the removed v-for patterns and
// the shipped parser over ~790 generated shapes on every run. The first
// hand-written parser was wrong (it consumed the separator greedily instead of
// backtracking, which differs on 170 of those shapes) and every fixture still
// passed — which is the whole argument for the sweep existing.
//   - Two-layer parse: (1) tree-sitter-vue gives the SFC skeleton — the
//     component root, template component usages, and the <script> block whose
//     body is a `raw_text` node with exact byte offsets; (2) the script body
//     is parsed with tree-sitter-javascript/typescript (engine pre-parse, see
//     ASTEngine.parseFile → context.sfcScriptTrees[0]) and extracted via the
//     JS/TS family analyzers, with ranges offset back to SFC lines.
//   - Symbols: component (name = file module, Class), script bindings via the
//     JS/TS contract (no locals/params), Options API declarations owned by the
//     component (methods → Method, computed → Property, data → Method,
//     props → Property, emits → Event, lifecycle hooks → Method).
//     Template elements/attributes/directives are NEVER symbols.
//   - Relationships: template component usages → instantiates (leaf tag
//     names, HTML/Vue builtins filtered); script imports/calls/extends/
//     overrides via the JS/TS contract; compiler macros (defineProps,
//     defineEmits, defineExpose, withDefaults) filtered; contains from
//     ownerName.

import type { Node, Tree } from "web-tree-sitter"
import * as path from "path"
import { ASTEngine } from "./engine"
import { RealJavaScriptAnalyzer } from "./real-javascript-analyzer"
import { RealTypeScriptAnalyzer } from "./real-typescript-analyzer"

/**
 * M49 #868 — the SFC seam must shift the delegate's metadata LINE MIRRORS, not
 * only its `line_number`/symbol ranges.
 *
 * Measured on a decorated class in this file family: in a .vue with a template
 * above the script block, the row `references Service -> sealed` carried
 * `line_number=6` — the line `@sealed` is written on — while its own metadata
 * still said `decoratorLine=5`, the SCRIPT-relative value, unshifted. The
 * applied offset was recorded on that very row (`sfcLineOffset: 1`), so the
 * payload contradicted both itself and the file, and a consumer reading the
 * mirror got a line above the decorator it names.
 *
 * Only keys whose NAME is a line (`decoratorLine`, `line`, `decoratorLines`)
 * are touched, and only numeric values: a decorator whose line was never
 * recorded stays null rather than becoming a number (never invent a line, #823).
 */
function shiftMetadataLineMirrors(md: Record<string, unknown> | undefined, lineOffset: number): void {
  if (!md || lineOffset === 0) return
  for (const [k, v] of Object.entries(md)) {
    // No regex: a case-insensitive substring test. This classifies a metadata KEY
    // NAME, and `includes` on a lowercased key is exactly what `/line/i` did
    // without a pattern literal for the census to track.
    if (!k.toLowerCase().includes("line")) continue
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

const VUE_BUILTIN_TAGS = new Set([
  "component", "transition", "transition-group", "keep-alive", "teleport", "suspense",
  "fragment",
])

// F9 (master review 2026-09-30): namespaces the vue compiler resolves as
// MARKUP, so `svg:circle` / `math:mi` are not component usages. Deliberately
// NOT a "contains a colon => builtin" rule: an unknown namespace fails toward
// VISIBILITY (it is reported as a usage a human can then reject) rather than
// silence, which is the failure mode a blanket colon rule would introduce.
const BUILTIN_NAMESPACES = new Set([
  "svg", "math", "mathml", "xlink", "html", "xhtml",
])

const VUE_COMPILER_MACROS = new Set([
  "defineProps", "defineEmits", "defineExpose", "withDefaults", "defineModel",
  "defineSlots", "defineOptions",
])

// ============================================================================
// PURE-STRING HELPERS (regex-free)
// ============================================================================

/**
 * F12: peel the wrappers the TYPE layer adds around a value — `x as const`,
 * `x satisfies T`, `(x)`, `x!` — so a declaration hoisted as
 * `const defs = { a: String } as const` is the same declaration as
 * `const defs = { a: String }`. Bounded: eight levels is far past any real
 * nesting and the bound keeps a malformed tree from looping.
 */
function peelTypeWrappers(node: Node): Node {
  let cur: Node = node
  for (let i = 0; i < 8; i++) {
    const t = cur.type
    if (t !== "as_expression" && t !== "satisfies_expression" &&
        t !== "parenthesized_expression" && t !== "non_null_expression") return cur
    const kids: (Node | null)[] = cur.namedChildren
    const first = kids[0]
    if (!first) return cur
    cur = first
  }
  return cur
}

function unquote(text: string): string {
  if (text.length >= 2) {
    const first = text[0]
    if ((first === '"' || first === "'") && text[text.length - 1] === first) {
      return text.slice(1, -1)
    }
  }
  return text
}

// ============================================================================
// ANALYZER
// ============================================================================

export class RealVueAnalyzer implements ASTEngine.LanguageAnalyzer {
  analyze(
    rootNode: Node,
    content: string,
    filePath: string,
    context?: ASTEngine.AnalyzeContext
  ): ASTEngine.ParseResult & { metadata: Partial<ASTEngine.FileMetadata> } {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const errors: ASTEngine.ParseError[] = []

    const patterns: Record<string, boolean> = {}
    const moduleName = path.basename(filePath, path.extname(filePath))
    patterns["Vue SFC"] = true

    // --- Error collection (vue grammar) --------------------------------------
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
    //
    // Whether this identity was WRITTEN in the file or fell back to the file
    // stem is only decided once every `<script>` block has been read, so the
    // declaration of a stem-derived identity is made after that loop — see the
    // `identityFromFileStem` marking below.
    symbols.push({
      name: moduleName,
      kind: ASTEngine.SymbolKind.Class,
      range: this.nodeToRange(rootNode),
      scope: "",
      visibility: "public",
      metadata: { isVueComponent: true, isSfc: true },
    })

    // --- 2. Template pass: component usages → instantiates --------------------
    // Walk the SFC tree; skip <script>/<style> subtrees; every non-builtin
    // element tag is a component usage (leaf tag name as written).
    const templateStack: Node[] = [rootNode]
    const seenUsages = new Set<string>()
    let templateDecisions = 0
    // V2 (#419): template expressions reference script-side members — collect
    // the identifiers from {{ interp }} and directive value expressions
    // (:label="x", @click="y", v-model="z", v-if="w") during the template
    // walk; the member symbols only exist after the script pass, so the Uses
    // edges are emitted after the merge (step 3b).
    //
    // V4 (#419): template-LOCAL bindings shadow component members — v-for
    // loop variables (v-for="item in items" binds item) and slot props
    // (#default="{ row }" binds row). A shadowed name must NOT emit a use
    // to the same-named member; that is the TS T6 scope-blind bug class.
    const templateExprNames = new Map<string, number>()
    const shadowStack: Array<{ node: Node; shadowed: Set<string> }> = [{ node: rootNode, shadowed: new Set() }]
    while (shadowStack.length > 0) {
      const { node: n, shadowed } = shadowStack.pop()!
      const t = n.type
      if (t === "script_element" || t === "style_element") continue
      // The shadow set for this node's subtree: inherit, then add bindings
      // declared ON this node (v-for vars, slot props).
      const childShadowed = new Set(shadowed)
      if (t === "element" || t === "template_element") {
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c || c.type !== "start_tag") continue
          this.collectNodeShadowBindings(c, childShadowed)
        }
        const rawTag = this.elementTagSpelling(n)
        // F9 (master review 2026-09-30). TWO defects in this one filter, both
        // latent on the restored corpora (0 occurrences in 1,139 files), both
        // proven by probe against production parseFile.
        //
        // (a) A NAMESPACED tag is not a component. tree-sitter-vue spells it in
        // full in `tag_name` (`svg:circle`), and neither builtin set contains a
        // colon, so `<svg:circle/>` published `instantiates -> svg:circle` — a
        // target no components registry holds. A known builtin namespace means
        // markup. An UNKNOWN namespace is still treated as a component, so the
        // filter fails toward visibility rather than silence.
        //
        // (b) A DOTTED tag resolves the LEAF. `tag_name` spells only the root
        // segment, so `<Form.Input/>` recorded `instantiates -> Form` and the
        // leaf `.Input` vanished — the graph claimed the whole of Form for a
        // template that uses one sub-component. The target stays `Form`, which
        // is the name the registry holds and a resolver must match; the leaf is
        // carried in metadata, which is lossless without inventing an
        // unresolvable `Form.Input` symbol.
        const dotIdx = rawTag?.indexOf(".") ?? -1
        const colonIdx = rawTag?.indexOf(":") ?? -1
        const tag = dotIdx > 0 ? rawTag!.slice(0, dotIdx) : rawTag
        const member = dotIdx > 0 ? rawTag!.slice(dotIdx + 1) : undefined
        const nsPrefix = colonIdx > 0 ? rawTag!.slice(0, colonIdx) : undefined
        const isBuiltinNamespace = nsPrefix !== undefined && BUILTIN_NAMESPACES.has(nsPrefix)
        if (
          tag &&
          !isBuiltinNamespace &&
          !HTML_BUILTIN_TAGS.has(tag) &&
          !VUE_BUILTIN_TAGS.has(tag) &&
          !seenUsages.has(tag)
        ) {
          seenUsages.add(tag)
          const tagNode = this.elementTagNameNode(n)
          relationships.push({
            source: moduleName,
            target: tag,
            type: ASTEngine.RelationshipType.Instantiates,
            confidence: 0.95,
            // M59 (#825): the `<Child/>` tag as written in the template.
            ...(tagNode ? { line_number: tagNode.startPosition.row + 1 } : {}),
            metadata: {
              // F9(b): the leaf of a dotted tag — see the comment at the filter.
              // Merged HERE rather than spread above, because this literal's own
              // `metadata` key comes later and a spread placed before it is
              // silently overwritten (which is exactly what the first attempt did).
              ...(member ? { member, componentPath: rawTag! } : {}),
              isComponentUsage: true,
            },
          })
        }
      }
      if (t === "directive_attribute") {
        // v-if / v-else-if / v-for / v-show are TEMPLATE DECISION POINTS —
        // they branch rendering exactly like if/loops in code.
        const dname = this.findChildByType(n, "directive_name")?.text
        if (dname === "v-if" || dname === "v-else-if" || dname === "v-for" || dname === "v-show") templateDecisions++
        // The binding VALUE expression (not the directive name/argument).
        const value = this.findChildByType(n, "quoted_attribute_value")
        const attrVal = value ? this.findChildByType(value, "attribute_value") : null
        if (attrVal) {
          // v-for="item in items" — the LOOP VARIABLE (item) is bound
          // locally and shadows any same-named member; only the collection
          // (items) is a real member use.
          if (dname === "v-for") {
            this.collectVForUsage(attrVal.text, templateExprNames, childShadowed, attrVal.startPosition.row + 1)
          } else if (dname === "#" || dname === "v-slot") {
            // Slot-prop destructuring ({ row }) declares LOCAL bindings; the
            // element-level shadow pass already registered them, and the
            // destructure itself is not a member use — skip.
          } else {
            this.collectIdentifiers(attrVal.text, templateExprNames, childShadowed, attrVal.startPosition.row + 1)
          }
        }
      }
      if (t === "interpolation") {
        const raw = this.findChildByType(n, "raw_text")
        if (raw) {
          // {{ item }} under v-for="item in items" reads the LOCAL item;
          // skip identifiers bound in this scope.
          this.collectIdentifiers(raw.text, templateExprNames, childShadowed, raw.startPosition.row + 1)
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const child = n.namedChild(i)
        if (child) shadowStack.push({ node: child, shadowed: childShadowed })
      }
    }

    // --- 3. Script pass: nested JS/TS parse (engine-provided trees) ------------
    // EVERY <script> block is processed (a plain block plus <script setup>
    // is THE standard Vue 3 layout — only [0] was read, silently dropping
    // the entire setup block), dispatched to the language analyzer matching
    // the block's lang attribute.
    const scriptTreeCount = context?.sfcScriptTrees?.length ?? 0
    const pushedComponentNames = new Set<string>([moduleName])
    // F12: contracts whose EDGE is emitted after the sub-analyzer merge, not
    // during the macro walk. The store's relationship identity is
    // (source, target, type, line) with NO metadata component
    // (parallel-indexer.ts:3177) and the insert is INSERT OR IGNORE — so two
    // edges that differ ONLY in metadata are collapsed to the first. The
    // sub-analyzer's `type_argument` reference is merged in step 3b, AFTER this
    // walk, so an edge pushed here loses to it at the store and the contract
    // marker is lost with it. MEASURED: the edge vanished from the database
    // entirely (script/m14/tmp/vue-mr/f12-store.ts). Annotating the merged row
    // is the only shape that survives persistence, and it also avoids the
    // near-duplicate row the m60 svelte round recorded.
    const pendingContracts: Array<{
      name: string; marker: string; module?: string; resolved: boolean; line: number; lineOffset: number
      // F3: the `withDefaults` map for a NAMED contract. There is no prop symbol
      // to hang a per-prop default on — the members belong to the imported
      // declaration — so the map travels with the edge. `defaultKeys` is carried
      // as a COUNT because a graph answer needs to know the contract HAS
      // defaults, not merely that one key happened to match.
      defaults?: Map<string, string>
      defaultsExpression?: string
    }> = []
    // F2: the same discipline for provide/inject. The key names a declaration
    // this file does not own (every corpus key is an IDENTIFIER), so the contract
    // is an EDGE — emitted after the merge for the same reason as F12's, because
    // the store's relationship identity has no metadata component and an edge
    // pushed earlier would lose to a delegated row at the insert.
    const pendingInjections: Array<{
      key: string; marker: string; line: number; lineOffset: number
    }> = []
    // F2: keys of an inline `provide(K, { … })` value. Annotated onto the symbols
    // the sub-analyzer already emitted, never duplicated, because the store's
    // SYMBOL key excludes owner (VSD25).
    const pendingProvided: Array<{ name: string; owner: string; line: number; column: number }> = []
    let scriptCyclomaticSum = 0
    // F7 (master review 2026-09-30): the fact the pipeline already computes.
    // `hasTypeInference` used to be the literal `false`, so every SFC reported
    // the same thing — including the 778 of 1,150 restored corpus files with a
    // lang="ts" block, whose interface/annotation members the TypeScript
    // analyzer extracted correctly while the flag denied it. It is a per-file
    // statement about whether a TypeScript grammar was applied, not a
    // capability claim about the analyzer.
    let dispatchedToTypeScript = false
    // Edge types whose TARGET names a member of the component rather than the
    // component itself, and so is exempt from an identity rename.
    const MEMBER_TARGET = new Set<ASTEngine.RelationshipType>([
      ASTEngine.RelationshipType.Contains,
      ASTEngine.RelationshipType.Provides,
    ])
    // F8: when a `name:` option renames the component, every component-owned edge
    // must source the ONE symbol. The delegated rows arrive with the sub-analyzer's
    // module name as their source (it is the JS module identity), so the seam
    // re-points them — otherwise the one Class symbol would be unreachable and
    // every script edge would dangle.
    let componentIdentity = moduleName
    // F17: a `name:` option whose value is not a string literal. Hoisted so it
    // can be recorded whether or not a rename happens — the common case is
    // exactly the case where NO rename happens, because the identity stays the
    // stem and that is the whole point of the fallback.
    let declaredNameUnread = false
    // F16: the declared name from `defineOptions`, applied after the block loop.
    let declaredNameFromOptions: string | undefined
    let optionsScriptIndex = 0
    for (let bi = 0; bi < scriptTreeCount; bi++) {
      const scriptTree: Tree = context!.sfcScriptTrees![bi]
      const scriptStartLine: number = context!.sfcScriptLines![bi]
      const scriptStartColumn: number = context!.sfcScriptCols![bi] ?? 0
      // H3 (review wave): SFC byte base of this script block — added to
      // every script-relative startIndex/endIndex so ranges are coherent
      // across the line and index dimensions. Absent (hand-built contexts,
      // older callers) it defaults to 0, preserving old behavior exactly.
      const scriptStartIndex: number = context?.sfcScriptStartIndex?.[bi] ?? 0
      // #903: `tsx` is TypeScript too (the engine parses it with the JSX-capable
      // tsx grammar and reports the block's own lang here). Before this, a
      // <script lang="tsx"> block was handed to the JavaScript analyzer.
      const isTs = context?.sfcScriptLangs?.[bi] === "ts" || context?.sfcScriptLangs?.[bi] === "tsx"
      if (isTs) dispatchedToTypeScript = true
      {
      const scriptContent = scriptTree.rootNode?.text ?? ""
      const lineOffset = scriptStartLine - 1
      const colOffset = scriptStartColumn
      const defaultExport = this.findExportDefault(scriptTree.rootNode)
      // defineComponent({...}) wraps the options object in a call_expression;
      // descend to the first object node anywhere under the export statement
      // so both `export default {...}` and `export default defineComponent(
      // {...})` forms resolve (previously only the bare form worked).
      const defaultObject = defaultExport ? this.findDescendantObject(defaultExport) : undefined
      if (defaultObject) patterns["Options API"] = true
      else patterns["Composition API"] = true
      // The script body is extracted via the JS/TS family contract, and WHICH
      // analyzer runs is decided per block by its `lang` attribute: M60/#903 made
      // this a three-way dispatch (ts / tsx / js) and the comment here used to
      // say "regardless of `lang`", which #903 falsified. The surviving reason the
      // JS analyzer is still the DEFAULT is narrower: it resolves
      // method_definition scopes inside the Options-API default-export object, where
      // the TS analyzer emitted call sources as `module` (M12.12). TS-only
      // declarations (interface/type) are not extracted as CONTRACT symbols, but
      // they ARE extracted as interface/type members by the TS delegate.
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

      scriptCyclomaticSum += Math.max(0, ((sub.metadata as any)?.cyclomaticComplexity ?? 1) - 1)

      // 3a. Options API declarations (component-owned). The component
      // identity comes from the `name:` option when present, else the
      // file-derived module name — parity with class-based frameworks where
      // the component type itself is a first-class symbol (#383 payload
      // family / cross-language consistency).
      // M5 (review wave): the sub-analyzer's filtered method symbols carry
      // the full payload (parameters, return types, qualified calls) that
      // the Options re-emission below would otherwise drop. Index by bare
      // name (first wins — same-name collisions across sections are
      // pathological). Built before extractOptionsApi runs.
      const defaultPayloads = new Map<string, ASTEngine.UniversalSymbol>()
      if (defaultObject) {
        for (const s of sub.symbols ?? []) {
          if ((s.range.startIndex ?? 0) >= defaultObject.startIndex && (s.range.endIndex ?? 0) <= defaultObject.endIndex &&
            (s.kind === ASTEngine.SymbolKind.Method || s.kind === ASTEngine.SymbolKind.Function) &&
            !defaultPayloads.has(s.name)) {
            defaultPayloads.set(s.name, s)
          }
        }
      }
      if (defaultObject) {
        let componentName = moduleName
        const namePair = defaultObject.namedChildren.find(
          (c: any) => c.type === "pair" && c.childForFieldName("key")?.text === "name",
        )
        // F17 (2026-10-31): the value of `name:` is not always a string literal.
        // It can be an IMPORTED IDENTIFIER — `name: COMPONENT_NAME`, where
        // COMPONENT_NAME comes from another module and this lane cannot read its
        // value without cross-file resolution it does not do. The old code took
        // `v.text` whatever the node was, so the component's ONE identity became
        // the VARIABLE's name: measured on the restored corpus, option.vue and
        // select.vue published components called `COMPONENT_NAME`, with 64 edges
        // sourced at a name that no registry holds and no reader can resolve.
        //
        // A component named after the variable that holds its name is a graph
        // lie, and a worse one than the stem fallback F8 already chose
        // deliberately: `option` and `select` are at least real, findable names.
        // So a non-literal `name:` now keeps the stem and RECORDS that a declared
        // name was present but unreadable, which is the distinction a consumer
        // needs — silence would claim the component never declared a name.
        let declaredNameUnreadable = false
        if (namePair) {
          const v = namePair.childForFieldName("value")
          // No regex: `unquote` is the file's existing quote-stripper and the
          // value of a `name:` option is a string literal, so stripping
          // surrounding quotes is the whole job. Pinned for both quote styles by
          // vue/options-rename-identity (single) and vue/component-name-double-quotes.
          if (v && v.type === "string") componentName = unquote(v.text)
          else if (v) declaredNameUnreadable = true
        }
        declaredNameUnread = declaredNameUnread || declaredNameUnreadable
        // F8 (master review 2026-09-30): ONE component, ONE Class symbol.
        //
        // A `name:` option used to PUSH A SECOND Class alongside the SFC's own,
        // and the two had DISJOINT edge sets with neither reachable as a target.
        // Measured through the store on `WidgetFile.vue` declaring
        // `name: 'ActualName'`: 6 edges sourced `WidgetFile` (the delegated
        // imports/exports/uses) and 2 contained edges sourced `ActualName`, so
        // "what contains `lab`?" answered `ActualName` while "what imports from
        // this file?" answered `WidgetFile` — one component, two answers, and
        // no edge a consumer could walk to unify them.
        //
        // The name is the DECLARED one: `name:` is what `components: {}` resolves
        // by and what devtools shows. The file stem is not discarded — it is the
        // module's identity in the import graph and is recorded in
        // metadata.moduleName. The SFC symbol is RENAMED in place rather than a
        // second one pushed, so there is exactly one Class either way; the
        // earlier dedupe only fired when the two names happened to be EQUAL,
        // which is why the common case was covered and the renamed one was not.
        if (componentName !== moduleName) {
          const sfcSymbol = symbols.find((sy) => sy.kind === ASTEngine.SymbolKind.Class && sy.name === moduleName)
          if (sfcSymbol) {
            sfcSymbol.name = componentName
            sfcSymbol.metadata = {
              ...(sfcSymbol.metadata ?? {}),
              moduleName,
              isOptionsComponent: true,
              ...(declaredNameUnreadable ? { declaredNameUnreadable: true } : {}),
            }
            componentIdentity = componentName
          }
        }
        pushedComponentNames.add(componentName)
        this.extractOptionsApi(defaultObject, componentName, symbols, patterns, lineOffset, colOffset, defaultPayloads, scriptStartIndex, scriptTree.rootNode, relationships)
      }

      // 3b. Merge JS analyzer output, offset to SFC lines, filter:
      //     - symbols inside the default-export object (re-emitted above)
      //     - compiler-macro call rels (defineProps etc.)
      const defaultStart = defaultObject ? defaultObject.startIndex : -1
      const defaultEnd = defaultObject ? defaultObject.endIndex : -1

      for (const s of sub.symbols ?? []) {
        if (defaultStart !== -1 && (s.range.startIndex ?? 0) >= defaultStart && (s.range.endIndex ?? 0) <= defaultEnd) continue
        s.range.startLine += lineOffset
        s.range.endLine += lineOffset
        if (s.range.startLine === 1 + lineOffset) s.range.startColumn += colOffset
        if (scriptStartIndex && s.range.startIndex !== undefined) s.range.startIndex += scriptStartIndex
        if (scriptStartIndex && s.range.endIndex !== undefined) s.range.endIndex += scriptStartIndex
        // M49 #868: the symbol's own metadata line mirrors travel with its range
        // (metadata.decoratorLines is a SCRIPT-relative list of line numbers).
        shiftMetadataLineMirrors(s.metadata as Record<string, unknown> | undefined, lineOffset)
        symbols.push(s)
      }
      for (const r of sub.relationships ?? []) {
        const tgt = (r.target ?? "") as string
        if (VUE_COMPILER_MACROS.has(tgt)) continue
        // M59 (#825): the delegate's lines are SCRIPT-RELATIVE, and this loop is
        // the seam where they become FILE lines — every other script artifact
        // (symbols, imports, exports, errors) is shifted right below/above, and
        // the relationships were pushed raw. Harmless only while the delegate
        // emitted NO line at all (the pre-#825 state); the moment the JS/TS
        // analyzers began emitting `line_number`, every delegated edge claimed a
        // line above the top of the file. Measured by the M59 oracle on the same
        // pinned 40-file sample: vue 562 of 585 line-bearing edges INCONSISTENT
        // (svelte 19 of 58) — the near-miss look of a real defect.
        if (typeof r.line_number === "number") r.line_number += lineOffset
        // M49 #868: the metadata line mirrors move with it (see the helper).
        shiftMetadataLineMirrors(r.metadata as Record<string, unknown> | undefined, lineOffset)
        // The seam is RECORDED on the edge, not just applied to it: which block it
        // came from and the offset that was added. Without this the shift is only
        // observable by re-deriving the script's position, so no fixture could
        // catch a regression in it (the first version of the seam mutant SURVIVED
        // for exactly that reason), and a reader of the payload could not tell a
        // template line from a script line.
        r.metadata = { ...(r.metadata ?? {}), sfcDelegated: true, sfcLineOffset: lineOffset }
        relationships.push(r)
      }
      for (const i of sub.imports ?? []) {
        if (i.range) {
          const shifted = this.shiftScriptRange(i.range, lineOffset, colOffset, scriptStartIndex)
          i.range.startLine = shifted.startLine
          i.range.endLine = shifted.endLine
          i.range.startColumn = shifted.startColumn
          i.range.endColumn = shifted.endColumn
          if (shifted.startIndex !== undefined) i.range.startIndex = shifted.startIndex
          if (shifted.endIndex !== undefined) i.range.endIndex = shifted.endIndex
        }
        imports.push(i)
      }
      for (const e of sub.exports ?? []) {
        if (e.range) {
          const shifted = this.shiftScriptRange(e.range, lineOffset, colOffset, scriptStartIndex)
          e.range.startLine = shifted.startLine
          e.range.endLine = shifted.endLine
          e.range.startColumn = shifted.startColumn
          e.range.endColumn = shifted.endColumn
          if (shifted.startIndex !== undefined) e.range.startIndex = shifted.startIndex
          if (shifted.endIndex !== undefined) e.range.endIndex = shifted.endIndex
        }
        exports.push(e)
      }
      for (const er of sub.errors ?? []) {
        if (er.range) {
          const shifted = this.shiftScriptRange(er.range as ASTEngine.UniversalSymbol["range"], lineOffset, colOffset, scriptStartIndex)
          er.range.startLine = shifted.startLine
          er.range.endLine = shifted.endLine
          er.range.startColumn = shifted.startColumn
          er.range.endColumn = shifted.endColumn
          if (shifted.startIndex !== undefined) er.range.startIndex = shifted.startIndex
          if (shifted.endIndex !== undefined) er.range.endIndex = shifted.endIndex
        }
        errors.push(er)
      }

      // Script-setup compiler macros carry the component's PUBLIC CONTRACT
      // just like Options-API props/emits - but only the binding Constant
      // survived (`const props = defineProps(...)`), so script-setup
      // components lost their prop/event declarations entirely. Extract
      // them from the macro call arguments (parity with Options API).
      {
        const macroStack: Node[] = [scriptTree.rootNode]
        const seenMacroNames = new Set<string>()
        while (macroStack.length > 0) {
          const n = macroStack.pop()!
          if (n.type === "call_expression") {
            const fn = n.childForFieldName("function")
            if (fn && (fn.text === "defineProps" || fn.text === "defineEmits")) {
              const args = n.childForFieldName("arguments")
              const firstArg = args?.namedChild(0)
              // V1 (#419): the TYPE-LITERAL generic form defineProps<{ id:
              // string }>() / defineEmits<{ (e: 'save'): void }>() carries no
              // runtime argument — the contract lives in the type_arguments
              // node. Extract it when the runtime form is absent (the standard
              // Vue 3.3+ shape).
              // M59 (#825) follow-up, measured on element-plus split-bar.vue:
              // each prop/event symbol ranges at its own KEY's line, not the
              // `defineProps({` line — the old nodeToRange(call) stamped the
              // call for all of index/layout/resizable/... on lines 18-30.
              // propEntries already carries key nodes; the generic type-literal
              // form gets the same treatment (property identifiers / string
              // literals). Offset to SFC coordinates like every other script
              // artifact. The contains pass follows the range, so both move.
              const which = fn.text === "defineProps" ? "props" : "emits"
              // F3: read the enclosing `withDefaults` defaults once, here, where
              // the macro call is in hand — not later, because by the three
              // resolutions below the enclosing frame is out of reach.
              const defaultsArg = which === "props" ? this.withDefaultsObject(n) : null
              const propDefaults = this.defaultsEntries(defaultsArg)
              // F3, second half: when the defaults argument is NOT an object
              // literal it is an identifier or a call — measured on the remaining
              // 16 of 98 corpus files, every one of the shape
              // `withDefaults(defineProps<XProps>(), xPropsDefaults)` with the
              // defaults IMPORTED from a sibling module. Resolving that needs
              // cross-file constant resolution, which this lane does not do and
              // should not fake. But dropping it silently makes "this component's
              // defaults live in another file" indistinguishable from "this
              // component declares no defaults", so the expression is kept as
              // text. The `imports` edge the sub-analyzer already emits is what
              // makes it reachable.
              const defaultsExpression =
                defaultsArg && defaultsArg.type !== "object" ? defaultsArg.text : undefined
              // F14: participants of the TYPE-ARGUMENT form. Deliberately NOT
              // gated on `entries.length === 0` the way `macroContractName` below
              // is, and that difference is the whole point: an intersection can
              // carry BOTH a literal operand and a named one
              // (`defineProps<LeftProps & { rightB: number }>`), and once
              // genericMacroEntries could read the literal the old single-exit
              // emitted the prop SYMBOLS and silently stopped, losing the
              // `LeftProps` contract edge that options-named-contract pins. A
              // component may declare a literal prop AND name a declaration; the
              // two are independent facts about one contract.
              const typeArgsNode = this.findChildByType(n, "type_arguments")
              for (const part of this.contractTypeShape(typeArgsNode).participants) {
                const partKey = `${which}:${part.name}`
                if (seenMacroNames.has(partKey)) continue
                seenMacroNames.add(partKey)
                pendingContracts.push({
                  name: part.name,
                  marker: which === "props" ? "isPropContract" : "isEmitContract",
                  resolved: this.hasTopLevelDeclaration(part.name, n),
                  line: this.offsetRange(this.nodeToRange(part.node), lineOffset, colOffset, scriptStartIndex).startLine,
                  lineOffset,
                  // F3, and a consequence of moving the participant push UP here:
                  // this row is now the FIRST to claim `seenMacroNames`, so it is
                  // also the row the F12 `macroContractName` branch skips. Without
                  // the defaults carried along, adding F14 silently stripped every
                  // withDefaults default off every NAMED contract — the fixture
                  // caught it, which is the only reason it is worth recording.
                  ...(propDefaults.size > 0 ? { defaults: propDefaults } : {}),
                  ...(defaultsExpression ? { defaultsExpression } : {}),
                })
              }
              // F13: identifier elements of the array form name declarations.
              const declRefs = this.propDeclarationEntries(firstArg ?? undefined)
              for (const d of declRefs) {
                const contractKey = `${which}:${d.name}`
                if (seenMacroNames.has(contractKey)) continue
                seenMacroNames.add(contractKey)
                pendingContracts.push({
                  name: d.name,
                  marker: which === "props" ? "isPropContract" : "isEmitContract",
                  // Same certainty as the macro hoist: the name is written here,
                  // but this lane has not read the declaration, so the row is the
                  // weaker of the two — matching `defineProps(binding)`'s shape
                  // rather than claiming more resolution than it did.
                  resolved: false,
                  line: this.offsetRange(this.nodeToRange(d.node), lineOffset, colOffset, scriptStartIndex).startLine,
                  lineOffset,
                })
              }
              let fromBinding = false
              let inlineGeneric = false
              let entries = this.propEntries(firstArg ?? undefined)
              if (entries.length === 0) {
                entries = this.genericMacroEntries(n, which)
                if (entries.length > 0) inlineGeneric = true
              }
              // F12 (vue master review 2026-09-30): the forms a real component
              // library writes. `defineProps<AffixProps>()` (a NAMED type
              // argument) and `defineProps(affixProps)` (a BINDING) are not the
              // inline literal, and neither produced a symbol: measured on the
              // restored corpus, 103 of 103 `defineProps<Named>()` sites, 67 of
              // 67 `defineEmits(binding)` sites and 22 of 22
              // `defineProps(binding)` sites lost the whole contract — 132 of
              // the 232 corpus files that declare one.
              //
              // A same-file BINDING resolves inside this script tree and its
              // object-literal keys are published by nothing else, so it yields
              // component-owned symbols exactly as the inline runtime form does.
              if (entries.length === 0) {
                entries = this.boundMacroEntries(firstArg ?? undefined, scriptTree.rootNode, which)
                // Marks WHICH resolution produced these symbols, so the F12
                // mutant can revert the binding form alone. A single mutant that
                // reverts both the inline and the binding resolution would pass
                // whenever only the inline half is pinned — the M49 T6 lesson.
                if (entries.length > 0) fromBinding = true
              }
              // A NAMED or IMPORTED declaration is an EDGE, not a copy of the
              // members, and the store is why. The sub-analyzer already
              // publishes that declaration's members under the DECLARATION's
              // ownership (`contains LocalProps -> localA`), and the symbol
              // primary key is `${fileId}:${name}:${startLine}` with owner NOT in
              // it (parallel-indexer.ts) — so a component-owned copy of a member
              // at the same name and line was MEASURED to silently replace the
              // declaration's own row. One edge, no duplicate, and the contract
              // is answerable in a single hop either way.
              if (entries.length === 0) {
                const declared = this.macroContractName(n, firstArg ?? undefined, which)
                if (declared) {
                  const key = `${which}:${declared.name}`
                  if (!seenMacroNames.has(key)) {
                    seenMacroNames.add(key)
                    const macroKey = which === "props" ? "isPropContract" : "isEmitContract"
                    // The sub-analyzer already emits a `references` edge for a
                    // type ARGUMENT (`relationshipType: "type_argument"`), so a
                    // second edge to the same target from the same source would
                    // be a near-duplicate — the m60 svelte round's
                    // "identical source/target/type/line, collapseable" shape.
                    // Annotate that row when it is there and add one only when
                    // there is nothing to annotate (a binding has no type
                    // argument, so the case this fix exists for emits nothing).
                    pendingContracts.push({
                      name: declared.name,
                      marker: macroKey,
                      module: declared.module,
                      resolved: declared.resolved,
                      line: this.offsetRange(this.nodeToRange(declared.node), lineOffset, colOffset, scriptStartIndex).startLine,
                      lineOffset,
                      ...(propDefaults.size > 0 ? { defaults: propDefaults } : {}),
                      ...(defaultsExpression ? { defaultsExpression } : {}),
                    })
                  }
                  continue
                }
              }
              const kind = fn.text === "defineProps"
                ? ASTEngine.SymbolKind.Property
                : ASTEngine.SymbolKind.Event
              const meta = fn.text === "defineProps" ? "isProp" : "isEmit"
              for (const { name: pn, node: pnNode } of entries) {
                const dedupe = `${meta}:${pn}`
                if (seenMacroNames.has(dedupe)) continue
                seenMacroNames.add(dedupe)
                symbols.push({
                  name: pn,
                  kind,
                  range: this.offsetRange(this.nodeToRange(pnNode), lineOffset, colOffset, scriptStartIndex),
                  // F8: a contract symbol belongs to the ONE component. `name:`
                  // is read from a `name:` option in the FIRST block, so by the
                  // time a `<script setup>` block's macros run, `componentIdentity`
                  // already holds the declared name — and a script-setup prop
                  // owned by the FILE STEM while an Options prop is owned by the
                  // component is exactly the split identity F8 removed.
                  scope: componentIdentity,
                  ownerName: componentIdentity,
                  ownerKind: ASTEngine.SymbolKind.Class,
                  visibility: "public",
                  metadata: {
                    [meta]: true,
                    isScriptSetup: true,
                    // Which shape the names came from: "inline" (a literal
                    // argument), "generic" (an inline type literal) or
                    // "binding" (a same-file declaration resolved by name).
                    contractSource: fromBinding ? "binding" : inlineGeneric ? "generic" : "inline",
                    // F3: the `withDefaults` default for this prop, as WRITTEN
                    // SOURCE. A same-file binding is included, which is why this
                    // is keyed off the map rather than off the shape: a binding's
                    // members have no type annotation, and the default is the only
                    // thing that says the prop is genuinely optional-by-default.
                    ...(propDefaults.has(pn) ? { defaultValue: propDefaults.get(pn), hasDefault: true } : {}),
                  },
                })
              }
            }
          }
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (c) macroStack.push(c)
          }
        }

      // F2: provide/inject contract pass. Vue's third contract leg, with no
        // branch until now: `provide(K, v)` / `inject(K[, d])` over the corpus's
        // 79 call sites emitted nothing but the bare `calls` edge the sub-analyzer
        // makes, so the relationship between a provider and a consumer of one key
        // did not exist in the graph at all.
        //
        // The corpus decides the design here: all 79 sites use an IDENTIFIER key
        // (`provide(anchorKey, …)`, `inject(avatarGroupContextKey, undefined)`)
        // and none uses a string, so the key names a declaration this file does
        // not own — the F12 shape, answered with an edge.
        {
          const pjStack: Node[] = [scriptTree.rootNode]
          while (pjStack.length > 0) {
            const n = pjStack.pop()!
            if (n.type === "call_expression") {
              const callee = n.childForFieldName("function")?.text
              if (callee === "provide" || callee === "inject") {
                const argsNode = n.childForFieldName("arguments")
                const keyNode = argsNode?.namedChild(0)
                if (keyNode && (keyNode.type === "identifier" || keyNode.type === "string")) {
                  const keyName = keyNode.type === "string" ? unquote(keyNode.text) : keyNode.text
                  if (keyName) {
                    pendingInjections.push({
                      key: keyName,
                      marker: callee === "provide" ? "isProvideContract" : "isInjectContract",
                      line: this.offsetRange(this.nodeToRange(keyNode), lineOffset, colOffset, scriptStartIndex).startLine,
                      lineOffset,
                    })
                    if (callee === "provide") {
                      const value = this.providedValueObject(argsNode?.namedChild(1) ?? null)
                      if (value) {
                        for (let i = 0; i < value.namedChildCount; i++) {
                          const c = value.namedChild(i)
                          // F18 (2026-10-31): a SHORTHAND property is a provided
                          // member and was skipped. `provide(k, { contentRef })`
                          // shares the local `contentRef`, and a consumer reads it
                          // as `inject(k).contentRef` — so the name belongs to the
                          // provided contract exactly as a `key: value` pair's does.
                          // Measured: dropdown.vue provides 6 shorthand keys
                          // (contentRef, triggerId, isUsingKeyboard, onItemEnter,
                          // onItemLeave, handleClose) plus 6 pairs, and only the
                          // pairs were published; slider.vue and select.vue lose
                          // theirs the same way. Found by the `contains` oracle
                          // deriving rows the analyzer did not emit.
                          if (!c || (c.type !== "pair" && c.type !== "method_definition" &&
                                    c.type !== "shorthand_property_identifier")) continue
                          const shorthand = c.type === "shorthand_property_identifier"
                          const k = shorthand
                            ? c.text
                            : c.type === "pair" ? c.childForFieldName("key")?.text : c.childForFieldName("name")?.text
                          if (k && !k.startsWith("[")) {
                            pendingProvided.push({
                              name: unquote(k),
                              owner: moduleName,
                              line: n.startPosition.row + 1 + scriptStartLine,
                              column: n.startPosition.column + 1 + (context!.sfcScriptCols![bi] ?? 0),
                            })
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
            for (let i = 0; i < n.namedChildCount; i++) {
              const c = n.namedChild(i)
              if (c) pjStack.push(c)
            }
          }
        }
      }
      }
    }

    // F16: `defineOptions({ name: 'X' })` — the `<script setup>` way of declaring a
    // component's name (Vue 3.3+). It was in VUE_COMPILER_MACROS only so its CALL
    // edge would be filtered, and the `name:` inside it was never read, so every
    // component written the modern way fell back to the FILE STEM as its identity
    // while the file plainly declares otherwise.
    //
    // Measured, and found by the `contains` oracle disagreeing in a direction that
    // pointed at the analyzer: element-plus/table/src/table-body/td-wrapper.vue and
    // splitter/src/split-bar.vue both `defineOptions({ name: 'TableTdWrapper' })`
    // / `('ElSplitterBar')` and both were published as `td-wrapper` / `split-bar`.
    // F8 unified the component identity but only read `name:` out of a
    // `defineComponent({ … })` default export, so this is the same defect from the
    // other side — and worse than a cosmetic stem, because every component-owned
    // edge sources the identity and the store's symbol key is name+line, so the
    // declared name and the published one are two different symbols.
    //
    // ONLY THE READ happens here. The rename and the re-point MUST happen after
    // the block loop: doing them inside it left slider.vue publishing its Class as
    // `ElSlider` while every member stayed owned by `slider`, which is precisely
    // the split identity F8 existed to remove — reintroduced through the other
    // door. That is only visible on a component whose name comes from
    // `defineOptions` AND whose members are emitted after this point in the loop,
    // and the `contains` oracle is what surfaced it.
    for (const [bi, scriptTree] of (context?.sfcScriptTrees ?? []).entries()) {
      const optsCall = this.findCallNamed(scriptTree.rootNode, "defineOptions")
      if (!optsCall) continue
      const optsObj = this.firstObjectArgument(optsCall)
      if (!optsObj) continue
      const stack: Node[] = [optsObj]
      while (stack.length > 0 && declaredNameFromOptions === undefined) {
        const n = stack.pop()!
        const keyNode = this.findChildByType(n, "property_identifier")
        if (n.type === "pair" && keyNode && keyNode.text === "name") {
          const v = this.findChildByType(n, "string")
          if (v) declaredNameFromOptions = unquote(v.text)
        }
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c) stack.push(c)
        }
      }
      if (declaredNameFromOptions) {
        optionsScriptIndex = bi
        break
      }
    }

    // The component's identity is settled only now: every `<script>` block has
    // been read, and a block carrying `name:` has already RENAMED the Class
    // symbol above (F8). A Class still named `moduleName` therefore had no name in
    // the source — the file never spells its own name — and the m60 surface audit
    // reports every symbol whose name appears nowhere in its file.
    //
    // Declaring it with the audit's own general mechanism (`metadata.synthesized`)
    // is the right answer rather than a suppression. The audit's header is
    // explicit that a DECLARED flag cuts the other way from a name allowlist: an
    // UNDECLARED synthesized name still fails both rows, and that is the hazard
    // worth catching, which is why the decision belongs HERE — in the lane that
    // owns the fallback rule — instead of in an allowlist over there.
    //
    // Measured: 124 such findings on the 400-file m60 draw, every one of them this
    // fallback, every one of them a real component.
    // F16, applied where it is complete: after every block has been read and
    // every symbol emitted, so the rename and the re-point cannot miss one.
    if (declaredNameFromOptions && declaredNameFromOptions !== componentIdentity) {
      const cls = symbols.find(
        (sy) => sy.kind === ASTEngine.SymbolKind.Class && sy.name === componentIdentity && sy.metadata?.isVueComponent === true,
      )
      if (cls) {
        cls.metadata = {
          ...(cls.metadata ?? {}),
          moduleName: componentIdentity,
          isScriptSetupComponent: true,
        }
        const col = context!.sfcScriptCols?.[optionsScriptIndex] ?? 0
        cls.range = { ...cls.range, startColumn: cls.range.startColumn + col }
        // Every component-owned symbol and every edge that sourced the OLD
        // identity follows it — the same re-point F8 performs for `name:`.
        //
        // The old identity is captured BEFORE the Class is renamed, and the
        // re-point matches EITHER that or `moduleName`. Both are needed: the
        // emissions in this file split across `componentName` (the per-block
        // Options local) and `componentIdentity`, and for a `<script setup>`
        // block the former is the file stem. Matching only one of them is what
        // left slider.vue publishing its Class as `ElSlider` while every member
        // stayed owned by `slider`.
        const oldIdentity = cls.name
        for (const sym of symbols) {
          if (sym.ownerName === oldIdentity || sym.ownerName === moduleName) sym.ownerName = declaredNameFromOptions
          if (sym.scope === oldIdentity || sym.scope === moduleName) sym.scope = declaredNameFromOptions
        }
        for (const e of relationships) {
          if (e.source === oldIdentity || e.source === moduleName) e.source = declaredNameFromOptions
          if (e.target === oldIdentity || e.target === moduleName) e.target = declaredNameFromOptions
        }
        cls.name = declaredNameFromOptions
        componentIdentity = declaredNameFromOptions
      }
    }

    {
      const cls = symbols.find(
        (sy) => sy.kind === ASTEngine.SymbolKind.Class && sy.metadata?.isVueComponent === true,
      )
      if (cls) {
        // F16: the identity came from `defineOptions({ name: 'X' })`, which is
        // written in the file, so it needs no declaration.
        if (cls.name === moduleName) cls.metadata = { ...(cls.metadata ?? {}), synthesized: true, identityFromFileStem: true }
        // F17: and the reason it is the stem is not that no name was declared —
        // one WAS, as an identifier this lane cannot read. Silence would claim
        // the component never named itself.
        if (declaredNameUnread) cls.metadata = { ...(cls.metadata ?? {}), declaredNameUnreadable: true }
      }
    }

    // F2: attach ownership to the symbols a provided value's keys produced.
    // Annotated IN PLACE, never re-pushed: the store's symbol key is
    // `${fileId}:${name}:${startLine}` with owner NOT in it, so a second symbol at
    // the same name and line would REPLACE this one (VSD25) — annotation is the
    // only non-lossing shape, and it is why `provide(tourKey, { onClose() {} })`
    // no longer publishes an unowned method indistinguishable from a
    // module-level function.


    // F2: the provide/inject edges, emitted after the merge for the same reason
    // as F12's — the store's relationship identity has no metadata component, so
    // an edge pushed earlier would lose to a delegated row at the insert. A key
    // that both provides and injects yields two rows with different markers, so
    // the two halves of one key are joinable in the graph by name, which is the
    // entire point of provide/inject.
    for (const c of pendingInjections) {
      const meta = { [c.marker]: true, sfcDelegated: true, sfcLineOffset: c.lineOffset }
      const existing = relationships.find(
        (x) => x.source === moduleName && x.target === c.key &&
          String(x.type ?? x.relationshipType) === String(ASTEngine.RelationshipType.References),
      )
      if (existing) {
        existing.metadata = { ...(existing.metadata ?? {}), ...meta }
      } else {
        relationships.push({
          source: moduleName,
          target: c.key,
          type: ASTEngine.RelationshipType.References,
          confidence: 0.9,
          line_number: c.line,
          metadata: meta,
        })
      }
    }

    // F12: the contract edges, emitted AFTER the sub-analyzer merge so the row
    // they annotate already exists (see `pendingContracts`).
    for (const c of pendingContracts) {
      // F8: like the symbols, the contract edge names the ONE component.
      const contractMeta = {
        [c.marker]: true,
        ...(c.module ? { contractModule: c.module } : {}),
        ...(c.resolved ? {} : { unresolved: true }),
        // F3: the defaults map, plus its size so a consumer can answer "does this
        // contract declare defaults" without walking the keys.
        ...(c.defaults && c.defaults.size > 0
          ? { defaults: Object.fromEntries(c.defaults), defaultKeys: c.defaults.size }
          : {}),
        // F3: an indirect defaults expression, kept as text. Deliberately NOT
        // `defaultKeys: 0` — zero keys would claim the component declares no
        // defaults, which is the opposite of the truth.
        ...(c.defaultsExpression ? { defaultsExpression: c.defaultsExpression } : {}),
      }
      // Merge into an EXISTING row rather than pushing a near-duplicate — and the
      // match must be looser than source+target. `defineProps<NamedProps>()`
      // produces TWO facts about one declaration: the sub-analyzer's `type_argument`
      // row (sourced at the enclosing scope, on the macro's line) and this
      // contract row (sourced at the component). Those agree on target, type and
      // LINE, which is what the STORE keys on —
      // `brain_relationship.id = projectId:rel:source:target:type:line` with
      // `INSERT OR IGNORE` — so pushing a second row loses one of them, and it is
      // always the DELEGATE's that wins the insert.
      //
      // Measured through a real 4-file index (store round-trip, previously never
      // done for this lane): `isPropContract`, `unresolved` and F3's whole
      // `defaults` map were dropped on the floor for with-defaults-propagation.vue,
      // because its two rows collided; skeleton-item.vue survived only because its
      // two rows happened to differ in source. The analyzer was right and the
      // information never reached the graph.
      //
      // The widened match is deliberately restricted to `sfcDelegated` rows: it must
      // never annotate an edge this lane did not produce from the same macro line.
      // Target + type + LINE, and nothing else. Two corrections, both found by
      // measuring rather than by reading:
      //
      // (1) The line must be compared as `c.line`, NOT `c.line - c.lineOffset`.
      //     `c.line` is ALREADY offset into SFC coordinates when it is pushed, so
      //     subtracting the offset again compared 113 against 27 and the merge
      //     never fired — which is why menu.vue's `Pick` row still lost to the
      //     delegate's after the first attempt looked like it had worked on the
      //     fixture file.
      // (2) The SOURCE cannot be part of the match. The sub-analyzer sources its
      //     `type_argument` row at whatever enclosing scope the macro sits in — the
      //     component for a top-level `<script setup>` call, but the local
      //     `const props = withDefaults(…)` binding when the macro is assigned, as
      //     in menu.vue. Those are one edge described twice, and the store keys on
      //     the source it RESOLVES, not the one the analyzer wrote.
      const sameEdge = (x: any): boolean =>
        x.target === c.name &&
        String(x.type ?? x.relationshipType) === String(ASTEngine.RelationshipType.References) &&
        x.metadata?.sfcDelegated === true &&
        (x.line_number ?? x.line) === c.line
      const existing = relationships.find(sameEdge)
      if (existing) {
        existing.metadata = { ...(existing.metadata ?? {}), ...contractMeta }
        // Re-attribute to the COMPONENT as well. Merging the metadata without
        // this loses the one thing the contract edge exists to answer: the row
        // would still be sourced at whatever enclosing scope the sub-analyzer
        // named (`global`, a variable, a synthetic), so "what does this component
        // declare?" has no row to point at. For a `<script setup>` the enclosing
        // scope IS the component, so this is a refinement rather than a rewrite,
        // and it is what makes the merged row resolvable to the Class symbol the
        // store holds. It is also the only reason the collision can be resolved at
        // all from inside this lane: the store keys on
        // (source, target, type, line) with no metadata component, so two rows
        // describing one edge can only become one row if they agree on all four.
        if (existing.metadata?.sfcDelegated === true) existing.source = componentIdentity
      } else {
        relationships.push({
          source: componentIdentity,
          target: c.name,
          type: ASTEngine.RelationshipType.References,
          confidence: c.resolved ? 1.0 : 0.8,
          line_number: c.line,
          metadata: { ...contractMeta, sfcDelegated: true, sfcLineOffset: c.lineOffset },
        })
      }
    }

    // --- 3c. Template expression uses (V2) ------------------------------------
    // The template reads the component's own members: {{ count }},
    // :label="label", @click="onSave", v-model="count", v-if="show" are
    // Uses of script-side symbols. Emit only for identifiers that resolve to
    // a member symbol (intrinsics and globals stay silent — no junk edges).
    if (templateExprNames.size > 0) {
      const memberNames = new Set(symbols.map((s) => s.name))
      const seenUses = new Set<string>()
      for (const [name, line] of templateExprNames) {
        if (!memberNames.has(name)) continue
        const key = `${moduleName}:${name}`
        if (seenUses.has(key)) continue
        seenUses.add(key)
        relationships.push({
          source: moduleName,
          target: name,
          type: ASTEngine.RelationshipType.Uses,
          confidence: 0.95,
          // M59 (#825): the line the identifier is WRITTEN on (the fragment's
          // base plus its offset inside it).
          line_number: line,
          metadata: { isTemplateExpression: true },
        })
      }
    }

    // F8: the seam is where the MODULE-scoped source becomes the COMPONENT's
    // source. ONE sweep, placed after EVERY producer has run — the template pass
    // (step 2) and the template `uses` pass (step 3c) both emit before or
    // independently of the script pass that reads the `name:` option.
    //
    // Placed too early once already: the sweep sat before step 3c, which fixed
    // the delegated rows and every template `instantiates` and left the template
    // `uses` still sourced at the file stem. The fixture caught it, which is the
    // only reason this is a comment and not a second defect.
    if (componentIdentity !== moduleName) {
      for (const rel of relationships) {
        if (rel.source === moduleName) rel.source = componentIdentity
      }
    }

    // F18/F2, applied HERE and not earlier. The annotation used to run before the
    // script-side symbols existed, so it silently matched nothing for a
    // `<script setup>` binding — and `provide(KEY, { steps })` in
    // element-plus/steps/src/steps.vue published `addStep`, `removeStep` and
    // `props` (declared as their own bindings) while dropping `steps`, which came
    // from one destructuring `const { steps, addStep, removeStep } = useProvide()`.
    // Same name, same file, same declaration, different symbol: the only
    // difference was WHEN the lookup ran.
    //
    // And for a component that provides its `setup()` LOCALS (dropdown.vue's
    // contentRef / triggerId / dropdownSize / trigger / handleClick and five more)
    // there is no symbol to find at all, because a `<script setup>` body's
    // locals are not emitted as component-owned symbols. Those are synthesized
    // here, so the provided contract is published rather than dropped — ten rows
    // the `contains` oracle derived and the analyzer never emitted.
    //
    // Synthesized ones carry `metadata.synthesized` for the m60 surface audit,
    // which is the same declaration the stem fallback uses: the name is real (it
    // is written in the file) but the SYMBOL is the analyzer's, not the
    // sub-analyzer's, and the audit has to be able to say so.
    for (const p of pendingProvided) {
      const sym = symbols.find((sy) => sy.name === p.name && sy.ownerName === undefined)
      if (sym) {
        sym.ownerName = p.owner
        sym.ownerKind = ASTEngine.SymbolKind.Class
        sym.scope = p.owner
        sym.metadata = { ...(sym.metadata ?? {}), isProvided: true }
        continue
      }
      if (symbols.some((sy) => sy.name === p.name && sy.ownerName === p.owner)) continue
      symbols.push({
        name: p.name,
        kind: ASTEngine.SymbolKind.Variable,
        ownerName: p.owner,
        ownerKind: ASTEngine.SymbolKind.Class,
        scope: p.owner,
        line_number: p.line,
        range: { startLine: p.line, startColumn: p.column, endLine: p.line, endColumn: p.column + p.name.length },
        metadata: { isProvided: true, synthesized: true },
      })
    }

    // --- 4. contains from ownerName -------------------------------------------
    // V3 (#419): the JS/TS sub-analyzer ALREADY emits contains for script-side
    // symbols (class -> method), and this pass re-emitted them — every class
    // member got a duplicate contains edge. Only vue-owned members (props,
    // emits, options members with ownerName = the component) need this pass;
    // skip symbols the sub-analyzer's contains already covered.
    const existingContains = new Set<string>()
    for (const r of relationships) {
      if (r.type === ASTEngine.RelationshipType.Contains && r.source && r.target) {
        existingContains.add(`${r.source}::${r.target}`)
      }
    }
    for (const s of symbols) {
      if (s.ownerName) {
        const key = `${s.ownerName}::${s.name}`
        if (existingContains.has(key)) continue
        existingContains.add(key)
        relationships.push({
          source: s.ownerName,
          target: s.name,
          type: ASTEngine.RelationshipType.Contains,
          confidence: 1.0,
          // M59 (#825): the MEMBER's declaration line (its symbol range, already
          // shifted to SFC coordinates) — the edge names the member.
          ...(s.range?.startLine ? { line_number: s.range.startLine } : {}),
          metadata: {},
        })
      }
    }

    // --- Metadata ---------------------------------------------------------------
    const architecturalScore = Math.min(100, Math.max(0, 100 - errors.length * 5))
    const detectedPatterns = Object.keys(patterns)
    const frameworkPatterns = detectedPatterns.map((p) => ({
      framework: "Vue",
      patterns: [{ type: "usage", detected: true, description: p }],
    }))

    this.classifyEvidenceTier(relationships)

    // F16, FINAL pass. The apply block above runs before some emissions, so this
    // repeats it at the last possible moment — anything that acquired the old
    // identity after that block is corrected here. Without it, slider.vue
    // published its Class as `ElSlider` while all 44 of its members stayed owned
    // by `slider`: the split identity F8 removed, reintroduced through the
    // `defineOptions` door. Cheap, idempotent, and it is the only place that can
    // see every symbol the analyzer is about to return.
    //
    // Keyed on `componentIdentity !== moduleName` rather than on which mechanism
    // supplied the name, because BOTH supply it and both leak: `defineOptions`
    // renamed the Class while its members kept the stem (slider.vue, 44 symbols),
    // and a `name:` option does the same through F2's provide-ownership
    // annotation, which records `moduleName` as the owner (dropdown.vue's
    // contentRef / dropdownSize / trigger / triggerId and five more). Fixing the
    // two separately left each one broken through the other's door; the invariant
    // is simply that the component has ONE identity, so anything still carrying the
    // stem once a real name is in force is stale.
    if (componentIdentity !== moduleName) {
      for (const sym of symbols) {
        if (sym.ownerName === moduleName) sym.ownerName = componentIdentity
        if (sym.scope === moduleName) sym.scope = componentIdentity
      }
      for (const e of relationships) {
        if (e.source === moduleName) e.source = componentIdentity
        // ONLY THE SOURCE follows the rename. A target is a MEMBER (contains,
        // provides), a TEMPLATE TAG (`<dropzone>` instantiates nothing else), or
        // an imported name — never the component's own identity. Rewriting
        // targets produced two measured faults at once: steps.vue's provided
        // member literally named `steps` became `ElSteps contains ElSteps`, and
        // vue-element-admin's three demo components lost `instantiates ->
        // dropzone` and gained `DropzoneDemo instantiates DropzoneDemo`.
        // `MEMBER_TARGET` is kept for the case that motivated it — a member whose
        // name coincides with the stem — and asserted by the F18 fixture.
      }
    }

    return {
      language: "vue",
      symbols,
      relationships,
      imports,
      exports,
      errors,
      metadata: {
        // Real cyclomatic complexity: script-block decisions (per JS/TS
        // contract) plus template decision directives (v-if/v-for/v-show).
        // Was hardcoded 1 / the synthetic symbols+relationships heuristic.
        complexity: 1 + scriptCyclomaticSum + templateDecisions,
        linesOfCode: content.split("\n").length,
        cyclomaticComplexity: 1 + scriptCyclomaticSum + templateDecisions,
        framework: "Vue",
        patterns: detectedPatterns,
        detectedFrameworks: ["Vue"],
        frameworkPatterns,
        architecturalInsights: [],
        architecturalScore,
        codeQuality: errors.length === 0 ? "Excellent" : "Fair",
        // F7: true iff a <script> block was parsed with a TypeScript grammar
        // (lang="ts" or lang="tsx", #903's three-way dispatch). A plain block,
        // or an SFC with no script, is the JavaScript analyzer and stays false.
        hasTypeInference: dispatchedToTypeScript,
        hasFrameworkIntelligence: true,
        analysisVersion: "5.0.0-m12.12-family-contract",
      },
    }
  }

  // ============================================================================
  // OPTIONS API EXTRACTION
  // ============================================================================

  /**
   * Which shape the LAST contract resolution came from. A field rather than a
   * return value because the two call sites (the Options options and the
   * script-setup macros) each consume the entries in their own loop; the marker
   * is what lets a fixture pin the shape and a mutant revert one of them
   * without touching the others.
   */
  private lastContractSource: "inline" | "binding" | "generic" | "edge" | "none" = "none"

  private extractOptionsApi(
    objectNode: Node,
    componentName: string,
    symbols: ASTEngine.UniversalSymbol[],
    patterns: Record<string, boolean>,
    lineOffset: number,
    colOffset: number,
    payloads?: Map<string, ASTEngine.UniversalSymbol>,
    indexOffset?: number,
    /**
     * F12: the script tree this options object lives in, so `props: someDef` /
     * `emits: someDef` can be resolved exactly as the script-setup macro
     * binding is. Options API components that hoist their contract to a
     * `const` lose the whole thing otherwise — 14 files wrote `props:` and
     * extracted nothing on the restored corpus.
     */
    scriptRoot?: Node,
    relationships?: ASTEngine.UniversalRelationship[],
  ): void {
    const memberName = (n: Node): string | undefined => {
      const key = n.childForFieldName("key")
      if (key) return key.text
      const name = n.childForFieldName("name")
      if (name) return name.text
      return this.findChildByType(n, "property_identifier")?.text
    }

    for (let i = 0; i < objectNode.namedChildCount; i++) {
      const child = objectNode.namedChild(i)
      if (!child) continue
      if (child.type !== "pair" && child.type !== "method_definition") continue
      const key = memberName(child)
      if (!key) continue

      const value =
        child.type === "pair" ? child.childForFieldName("value") : undefined

      if (key === "methods" && value) {
        patterns["Options API"] = true
        this.emitObjectMembers(value, componentName, symbols, ASTEngine.SymbolKind.Method, "method", lineOffset, colOffset, payloads, indexOffset)
      } else if (key === "computed" && value) {
        patterns["Options API"] = true
        this.emitObjectMembers(value, componentName, symbols, ASTEngine.SymbolKind.Property, "computed", lineOffset, colOffset, payloads, indexOffset)
      } else if (key === "data") {
        // data() is the reactive-state factory
        symbols.push({
          name: "data",
          kind: ASTEngine.SymbolKind.Method,
          range: this.offsetRange(this.nodeToRange(child), lineOffset, colOffset, indexOffset),
          scope: componentName,
          ownerName: componentName,
          ownerKind: ASTEngine.SymbolKind.Class,
          visibility: "public",
          metadata: { isOptionsData: true },
        })
        // H1 (review wave): the KEYS are the reactive state the template
        // reads — without them `{{ count }}` can never resolve. Two shapes:
        // Vue-2 object form (`data: { count: 0 }`) reads pairs directly;
        // factory form (`data() { return {...} }`) reads the first returned
        // object literal's pairs.
        const dataValue = child.type === "pair" ? child.childForFieldName("value") : undefined
        if (dataValue && dataValue.type === "object") {
          this.emitDataKeys(dataValue, componentName, symbols, lineOffset, colOffset, indexOffset)
        } else if (child.type === "method_definition") {
          const returned = this.findReturnedObject(child)
          if (returned) this.emitDataKeys(returned, componentName, symbols, lineOffset, colOffset, indexOffset)
        } else if (
          dataValue && (dataValue.type === "arrow_function" || dataValue.type === "function_expression" || dataValue.type === "function")
        ) {
          // D2 (deeper review): `data: () => ({...})` and
          // `data: function() { return {...} }` — same factory contract,
          // different syntax. findReturnedObject covers both (expression
          // bodies via the direct-object rule, block bodies via returns).
          const returned = this.findReturnedObject(dataValue)
          if (returned) this.emitDataKeys(returned, componentName, symbols, lineOffset, colOffset, indexOffset)
        }
      } else if (key === "props") {
        // props: array of names OR object of prop declarations
        for (const { name: pn, node: pnode } of this.resolveContractEntries(value ?? child, scriptRoot, "props", relationships, componentName)) {
          symbols.push({
            name: pn,
            kind: ASTEngine.SymbolKind.Property,
            // M59 (#825): the prop KEY's own node — the line and column a
            // navigation to this prop must land on.
            range: this.offsetRange(this.nodeToRange(pnode), lineOffset, colOffset, indexOffset),
            scope: componentName,
            ownerName: componentName,
            ownerKind: ASTEngine.SymbolKind.Class,
            visibility: "public",
            metadata: { isProp: true, contractSource: this.lastContractSource },
          })
        }
      } else if (key === "emits") {
        for (const { name: en, node: enode } of this.resolveContractEntries(value ?? child, scriptRoot, "emits", relationships, componentName)) {
          symbols.push({
            name: en,
            kind: ASTEngine.SymbolKind.Event,
            range: this.offsetRange(this.nodeToRange(enode), lineOffset, colOffset, indexOffset),
            scope: componentName,
            ownerName: componentName,
            ownerKind: ASTEngine.SymbolKind.Class,
            visibility: "public",
            metadata: { isEmit: true, contractSource: this.lastContractSource },
          })
        }
      } else if (key === "extends" || key === "mixins") {
        // F1 (master review 2026-09-30, High): Options-API INHERITANCE had no
        // branch at all, so Vue's own class heritage was absent from the graph —
        // the base surfaced only as a bare `uses` from the sub-analyzer at
        // whatever confidence a name mention earns, where the SAME text as a
        // .ts file emits a real `extends`.
        //
        // Vue 2 documents `extends` as class inheritance ("this is like class
        // inheritance in other languages") and `mixins` as an options merge;
        // both make the named component's options part of this one, so both are
        // `extends` edges, distinguished by `isMixin`. Keeping the relation is
        // deliberate: `extends` is ALREADY in this lane's audited set (the M60
        // rel-type-coverage gate CHECK 1 lists it for vue), so the oracle now
        // compares these rows — a coverage GAIN — instead of the rows sitting
        // where no gate could see them.
        if (!value || !relationships) continue
        const isMixin = key === "mixins"
        for (const base of this.identifiersOf(value)) {
          relationships.push({
            source: componentName,
            target: base.name,
            type: ASTEngine.RelationshipType.Extends,
            // A named component the analyzer cannot see is the Vue
            // documentation's own guarantee — the option is resolved by Vue at
            // runtime — so this is a declaration of the relationship, not a
            // guess. It is not `structural` in the closure sense (nothing in
            // this file states the base's members), which is why the
            // confidence is below 1.
            confidence: 0.9,
            line_number: this.offsetRange(this.nodeToRange(base.node), lineOffset, colOffset, indexOffset).startLine,
            metadata: { isMixin, isOptionsApi: true },
          })
        }
        // The inline-object form (`extends: { methods: {…} }`) merges another
        // component's options in wholesale, so its members are THIS component's
        // members — the same contract a `methods:`/`computed:` block declares.
        if (value.type === "object") {
          for (let i = 0; i < value.namedChildCount; i++) {
            const sub = value.namedChild(i)
            if (!sub || (sub.type !== "pair" && sub.type !== "method_definition")) continue
            const subKey = sub.type === "pair" ? sub.childForFieldName("key")?.text : sub.childForFieldName("name")?.text
            const subValue = sub.type === "pair" ? sub.childForFieldName("value") : undefined
            if (!subKey) continue
            if ((subKey === "methods" || subKey === "computed") && subValue) {
              this.emitObjectMembers(
                subValue, componentName, symbols,
                subKey === "methods" ? ASTEngine.SymbolKind.Method : ASTEngine.SymbolKind.Property,
                subKey === "methods" ? "method" : "computed",
                lineOffset, colOffset, payloads, indexOffset,
              )
            } else if (subKey === "props" && subValue) {
              for (const { name: pn, node: pnode } of this.propEntries(subValue)) {
                symbols.push({
                  name: pn,
                  kind: ASTEngine.SymbolKind.Property,
                  range: this.offsetRange(this.nodeToRange(pnode), lineOffset, colOffset, indexOffset),
                  scope: componentName,
                  ownerName: componentName,
                  ownerKind: ASTEngine.SymbolKind.Class,
                  visibility: "public",
                  metadata: { isProp: true, inheritedFrom: "extends" },
                })
              }
            }
          }
        }
      } else if (key === "watch") {
        // watch is NOT a lifecycle hook (was mislabeled isLifecycleHook);
        // its VALUE holds the watcher handlers - each key is a reactive
        // source being watched -> Method symbol owned by the component.
        if (value) {
          patterns["Options API"] = true
          this.emitObjectMembers(value, componentName, symbols, ASTEngine.SymbolKind.Method, "isWatcher", lineOffset, colOffset, payloads, indexOffset)
        }
      } else if (key === "setup") {
        // F5 (master review 2026-09-30): `setup` was in NONE of the option
        // branches — not `methods`, not `computed`, not `watch`, not `data`,
        // not `isLifecycleHook` — so every Options component built around it had
        // no symbol for its own entry point (20 element-plus + 1
        // vue-element-admin files measured). It is deliberately NOT folded into
        // `isLifecycleHook`: it is not a lifecycle hook, it is the composition
        // function, and merging the two would make that predicate's name lie for
        // every other caller. Its own branch, its own marker.
        patterns["Options API"] = true;
        symbols.push({
          name: key,
          kind: ASTEngine.SymbolKind.Method,
          range: this.offsetRange(this.nodeToRange(child), lineOffset, colOffset, indexOffset),
          scope: componentName,
          ownerName: componentName,
          ownerKind: ASTEngine.SymbolKind.Class,
          visibility: "public",
          metadata: { isSetup: true },
        })
      } else if (this.isLifecycleHook(key)) {
        symbols.push({
          name: key,
          kind: ASTEngine.SymbolKind.Method,
          range: this.offsetRange(this.nodeToRange(child), lineOffset, colOffset, indexOffset),
          scope: componentName,
          ownerName: componentName,
          ownerKind: ASTEngine.SymbolKind.Class,
          visibility: "public",
          metadata: { isLifecycleHook: true },
        })
      }
    }
  }

  /**
   * H1 (review wave): emit one Property symbol per key of a data-state
   * object (pair ranges, so hover lands on the key). String keys unquoted.
   */
  private emitDataKeys(
    objectNode: Node,
    componentName: string,
    symbols: ASTEngine.UniversalSymbol[],
    lineOffset: number,
    colOffset: number,
    indexOffset?: number,
  ): void {
    // M49 dup-key ruling (Option A): last-wins — a duplicate data key
    // replaces the earlier symbol (JS semantics: later property wins).
    const seen = new Map<string, number>()
    for (let i = 0; i < objectNode.namedChildCount; i++) {
      const child = objectNode.namedChild(i)
      if (!child || child.type !== "pair") continue
      const keyNode = child.childForFieldName("key")
      if (!keyNode) continue
      // F6: a bracket-led computed key names a VARIABLE, which is statically
      // unknowable — the M2/VSD15 ruling, which until now reached
      // `emitObjectMembers` and none of the other three sites that turn an
      // object key into a symbol name. Measured: `Property "[key]"` at
      // panel-date-pick.vue:846, and `[dyn]` from every computed data key.
      if (keyNode.text.startsWith("[")) continue
      const name = keyNode.type === "string" ? unquote(keyNode.text) : keyNode.text
      if (!name) continue
      const prevIdx = seen.get(name)
      const sym = {
        name,
        kind: ASTEngine.SymbolKind.Property,
        range: this.offsetRange(this.nodeToRange(child), lineOffset, colOffset, indexOffset),
        scope: componentName,
        ownerName: componentName,
        ownerKind: ASTEngine.SymbolKind.Class,
        visibility: "public",
        metadata: { isDataKey: true },
      }
      if (prevIdx !== undefined) {
        symbols[prevIdx] = sym
      } else {
        seen.set(name, symbols.length)
        symbols.push(sym)
      }
    }
  }

  /**
   * H1 (review wave): first `return {...}` object literal under a data()
   * factory body. Conditional/multiple returns: first wins (documented
   * approximation — branches are not evaluated). D2 (deeper review):
   * expression-bodied arrows (`() => ({...})`) carry the object as the
   * direct body — an object reached with only parenthesized wrappers
   * between it and an arrow/function start is the body's value, not a
   * nested construction.
   */
  private findReturnedObject(methodNode: Node): Node | undefined {
    // web-tree-sitter returns FRESH wrapper objects per access — node
    // identity must be compared by span, never by reference (the KAD2
    // rule: `p !== methodNode` never matches, so the ancestor walk below
    // blew past the start node up to the pair and rejected every
    // expression-bodied arrow).
    const isStart = (p: Node | null): boolean =>
      !!p && p.startIndex === methodNode.startIndex && p.endIndex === methodNode.endIndex
    const stack: Node[] = [methodNode]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "return_statement") {
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && c.type === "object") return c
        }
      }
      if (n.type === "object" && !isStart(n)) {
        let ok = true
        let p: Node | null = n.parent
        while (p && !isStart(p)) {
          if (p.type !== "parenthesized_expression" && p.type !== "arrow_function" &&
              p.type !== "function_expression" && p.type !== "function" && p.type !== "method_definition") {
            ok = false
            break
          }
          p = p.parent
        }
        if (ok && p) return n
      }
      // Do not descend into nested functions — their returns belong to them.
      if (!isStart(n) && (n.type === "function_expression" || n.type === "arrow_function" || n.type === "function_declaration" || n.type === "method_definition")) continue
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return undefined
  }

  private emitObjectMembers(
    valueNode: Node,
    componentName: string,
    symbols: ASTEngine.UniversalSymbol[],
    kind: ASTEngine.SymbolKind,
    meta: string,
    lineOffset: number,
    colOffset: number,
    payloads?: Map<string, ASTEngine.UniversalSymbol>,
    indexOffset?: number,
  ): void {
    // M49 dup-key ruling (Option A, #745): last-wins — JS executes the
    // LAST same-key declaration, and the family contract is one symbol per
    // key keyed to the surviving declaration. The seen-set only records
    // AFTER emitting, so a later duplicate REPLACES the earlier symbol
    // (pre-fix: `seen.has(name)` skipped the later one — first-wins).
    const seen = new Map<string, number>()
    for (let i = 0; i < valueNode.namedChildCount; i++) {
      const child = valueNode.namedChild(i)
      if (!child) continue
      let name: string | undefined
      if (child.type === "method_definition" || child.type === "pair") {
        const raw = child.childForFieldName("name")?.text || child.childForFieldName("key")?.text
        if (!raw) continue
        // M2 (review wave): quoted keys ("save-data") arrive quoted — use
        // them unquoted; computed keys ([dyn]) are variables, unknowable
        // statically, so they are skipped, never kept raw.
        if (raw.startsWith("[")) continue
        name = unquote(raw)
      } else if (child.type === "property_identifier") {
        name = child.text
      }
      if (!name) continue
      const prevIdx = seen.get(name)
      // M5 (review wave): copy the sub-analyzer's payload (parameters,
      // return type, complexity, qualified calls) instead of emitting a
      // bare signature — the filtered sub-symbol already computed it.
      const payload = payloads?.get(name)
      const sym = {
        name,
        kind,
        range: this.offsetRange(this.nodeToRange(child), lineOffset, colOffset, indexOffset),
        scope: componentName,
        ownerName: componentName,
        ownerKind: ASTEngine.SymbolKind.Class,
        visibility: "public",
        parameters: payload?.parameters,
        returnType: payload?.returnType,
        complexity: payload?.complexity,
        qualified_calls: payload?.qualified_calls,
        metadata: { [meta]: true },
      }
      if (prevIdx !== undefined) {
        symbols[prevIdx] = sym
      } else {
        seen.set(name, symbols.length)
        symbols.push(sym)
      }
    }
  }

  /**
   * F12: a contract OPTION's entries, in the shape order —
   * inline literal, then a same-file BINDING, then the declaration EDGE.
   *
   * Shared by the Options `props:`/`emits:` options and (for the binding half)
   * the script-setup macros, because the two differ only in spelling: Vue
   * hoists the declaration to a `const` in both styles, and both styles lost
   * the whole contract when the name was not followed.
   */
  private resolveContractEntries(
    value: Node | undefined,
    scriptRoot: Node | undefined,
    which: "props" | "emits",
    relationships: ASTEngine.UniversalRelationship[] | undefined,
    componentName: string,
  ): Array<{ name: string; node: Node }> {
    const inline = this.propEntries(value ?? undefined)
    if (inline.length > 0) { this.lastContractSource = "inline"; return inline }
    if (!value || !scriptRoot) { this.lastContractSource = "none"; return [] }
    const bound = this.boundMacroEntries(value, scriptRoot, which)
    if (bound.length > 0) { this.lastContractSource = "binding"; return bound }
    this.lastContractSource = "none"
    // Unresolvable here (an imported declaration): the contract is an EDGE, and
    // only when the caller can record it — an options object with no relationship
    // sink must not silently drop the fact.
    if (!relationships) return []
    const declared = this.macroContractNameFromNode(value, which)
    if (!declared) return []
    const marker = which === "props" ? "isPropContract" : "isEmitContract"
    relationships.push({
      source: componentName,
      target: declared.name,
      type: ASTEngine.RelationshipType.References,
      confidence: declared.resolved ? 1.0 : 0.8,
      ...(declared.node.startPosition ? { line_number: declared.node.startPosition.row + 1 } : {}),
      metadata: {
        [marker]: true,
        isOptionsApi: true,
        ...(declared.module ? { contractModule: declared.module } : {}),
        ...(declared.resolved ? {} : { unresolved: true }),
      },
    })
    return []
  }

  /** The declaration a bare identifier argument names, without a call node. */
  private macroContractNameFromNode(
    arg: Node,
    _which: "props" | "emits",
  ): { name: string; node: Node; module?: string; resolved: boolean } | undefined {
    if (arg.type !== "identifier") return undefined
    const root = this.scriptRootOf(arg)
    return {
      name: arg.text,
      node: arg,
      module: root ? this.importModuleFor(arg.text, arg) : undefined,
      resolved: root ? this.hasTopLevelDeclaration(arg.text, arg) : false,
    }
  }

  /**
   * The identifiers a heritage option names, in the three shapes Vue accepts:
   * a bare name (`extends: Base`), an array of them (`extends: [A, B]`), and a
   * string name — which Vue also honours for a globally-registered component.
   *
   * Only names are taken. An inline OBJECT (`extends: { methods: … }`) is a
   * merge rather than a reference, and its members are extracted by the caller;
   * naming the literal's own keys as base classes would fabricate an inheritance
   * to a property.
   */
  private identifiersOf(node: Node): Array<{ name: string; node: Node }> {
    const out: Array<{ name: string; node: Node }> = []
    if (node.type === "identifier") { out.push({ name: node.text, node }); return out }
    if (node.type === "string") {
      const v = unquote(node.text)
      if (v) out.push({ name: v, node })
      return out
    }
    if (node.type === "array") {
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i)
        if (!c) continue
        if (c.type === "identifier") out.push({ name: c.text, node: c })
        else if (c.type === "string") {
          const v = unquote(c.text)
          if (v) out.push({ name: v, node: c })
        }
      }
      return out
    }
    return out
  }

  /**
   * F12: a same-file BINDING as the macro's argument —
   * `defineProps(boundProps)` / `defineEmits(boundEmits)`.
   *
   * The name is an `identifier`; this resolves it to its `variable_declarator`
   * in the SAME script tree and reads the literal it holds, which is the only
   * form whose keys are published by nothing else — so component-owned symbols
   * are safe here and match what the inline runtime form already emits. A
   * binding that does not resolve (imported from a sibling module) returns
   * nothing and the caller emits the contract edge instead; this walk never
   * leaves the tree, so it costs no I/O and cannot depend on the filesystem.
   */
  private boundMacroEntries(
    arg: Node | undefined,
    scriptRoot: Node,
    which: "props" | "emits",
  ): Array<{ name: string; node: Node }> {
    if (!arg) return []
    const nameNode = arg.type === "identifier" ? arg : this.findChildByType(arg, "identifier")
    if (!nameNode) return []
    const wanted = nameNode.text
    const stack: Node[] = [scriptRoot]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "variable_declarator") {
        const nameField = n.childForFieldName("name")
        const valueField = n.childForFieldName("value")
        if (nameField?.type === "identifier" && nameField.text === wanted && valueField) {
          return this.propEntries(peelTypeWrappers(valueField))
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    void which
    return []
  }

  /**
   * F12: the DECLARATION a macro names, when it is not an inline literal —
   * `defineProps<AffixProps>()` (a `type_identifier` in `type_arguments`) or
   * `defineProps(affixProps)` (a `binding` identifier). Returns the name plus
   * the node that writes it, and whether the declaration is reachable in THIS
   * tree (`resolved`) — which selects the edge's confidence, since a
   * same-file declaration is a certainty and an imported one is the import's
   * word for it.
   */
  private macroContractName(
    callNode: Node,
    arg: Node | undefined,
    _which: "props" | "emits",
  ): { name: string; node: Node; module?: string; resolved: boolean } | undefined {
    // F14: the TYPE-ARGUMENT form is handled by the caller's `contractTypeShape`
    // loop, which must run even when prop symbols were found — so the branch
    // that used to live here is removed rather than left as a second, narrower
    // rule for the same input. What remains here are the forms that carry no
    // type arguments at all.
    // The BINDING form: `defineProps(affixProps)` — reject a non-identifier
    // argument (a literal was already handled by the caller's inline pass).
    if (arg) {
      // `defineEmits(tooltipEmits as Mutable<typeof tooltipEmits>)` — a cast
      // wrapper is still one declaration. Peel the wrappers the type layer adds
      // and read the identifier underneath.
      let inner: Node | null = arg
      for (let i = 0; i < 8 && inner; i++) {
        if (inner.type === "identifier") break
        if (inner.type === "as_expression" || inner.type === "satisfies_expression" ||
            inner.type === "parenthesized_expression" || inner.type === "non_null_expression") {
          const kids: (Node | null)[] = inner.namedChildren
          inner = kids.length > 0 ? (kids[0] ?? null) : null
          continue
        }
        break
      }
      if (inner?.type === "identifier") {
        const resolved = this.hasTopLevelDeclaration(inner.text, callNode)
        return { name: inner.text, node: inner, module: this.importModuleFor(inner.text, callNode), resolved }
      }
      // `defineEmits([CHANGE_EVENT])` — an array of CONSTANT REFERENCES — is
      // NOT handled here, and used to be. F13 moved it to `propDeclarationEntries`,
      // which the caller runs for EVERY identifier element; this branch read only
      // the first, so by the time control reached it the key was already in
      // `seenMacroNames` and the branch was dead. It was also the last caller of
      // `findDescendantType`, whose WASM descendant search profiled at 5% of
      // wall clock. Deleted rather than left as a second, narrower rule.
    }
    return undefined
  }

  /** Is `name` declared at this tree's top level (an interface or a type alias)? */
  private hasTopLevelDeclaration(name: string, callNode: Node): boolean {
    const root = callNode.parent ? this.scriptRootOf(callNode) : null
    const scope = root ?? callNode
    // PERF: the method is called once per contract candidate and walked the whole
    // subtree looking for a declaration the predicate admits is TOP-LEVEL. A
    // `defineProps<Foo>()` resolves against a declaration that a component can
    // actually see, which is a top-level `interface` / `type` in the program; a
    // same-named declaration nested inside a function body is not that. So
    // `program`'s direct children are the complete search space, and the walk
    // that made this O(tree) per call is gone.
    const stack: Node[] = []
    for (let i = 0; i < scope.namedChildCount; i++) {
      const c = scope.namedChild(i)
      if (c) stack.push(c)
    }
    while (stack.length > 0) {
      const n = stack.pop()!
      if ((n.type === "interface_declaration" || n.type === "type_alias_declaration") &&
          n.childForFieldName("name")?.text === name) {
        return true
      }
    }
    return false
  }

  /** The `program` node this call sits in, by climbing parents (web-tree-sitter
   *  hands back fresh wrappers, so identity is never compared by reference). */
  /** The first call expression in `root` whose callee is `name` (F16). */
  private findCallNamed(root: Node, name: string): Node | null {
    const stack: Node[] = [root]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "call_expression") {
        const fn = n.childForFieldName("function")
        if (fn?.text === name) return n
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return null
  }

  /** The first object-typed argument of a call, if any (F16). */
  private firstObjectArgument(call: Node): Node | null {
    const args = call.childForFieldName("arguments")
    if (!args) return null
    for (let i = 0; i < args.namedChildCount; i++) {
      const c = args.namedChild(i)
      if (c?.type === "object") return c
    }
    return null
  }

  private scriptRootOf(node: Node): Node | null {
    let cur: Node | null = node.parent
    let last: Node = node
    while (cur) {
      if (cur.type === "program") return cur
      last = cur
      cur = cur.parent
    }
    return last.parent ? null : last
  }

  /** The module specifier an identifier was imported from, if any. */
  private importModuleFor(name: string, callNode: Node): string | undefined {
    const root = this.scriptRootOf(callNode)
    if (!root) return undefined
    // PERF: this walked the ENTIRE script tree — descending into every function
    // body, every expression — once per contract candidate, so a file with
    // several macros paid O(contracts x tree_size) with a `.text` marshal at every
    // node. Profiling the 300-file element-plus draw attributed 2.5% of total
    // wall clock to `importModule` alone. An `import_statement` can only be a
    // TOP-LEVEL statement of the program — there is no valid position for one
    // inside a function or an expression — so the direct children of `program`
    // are the complete search space. Same answer, one level of walk.
    const stack: Node[] = []
    for (let i = 0; i < root.namedChildCount; i++) {
      const c = root.namedChild(i)
      if (c) stack.push(c)
    }
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "import_statement") {
        const src = this.findChildByType(n, "string")
        const clause = n.namedChildren.find((c: any) => c.type === "import_clause")
        for (const c of clause?.namedChildren ?? []) {
          if (!c) continue
          if (c.type === "named_imports") {
            for (const sp of c.namedChildren) {
              if (!sp) continue
              const alias = sp.childForFieldName("alias")?.text
              const imp = sp.childForFieldName("name")?.text
              if ((alias ?? imp) === name) return src ? unquote(src.text) : undefined
            }
          } else if (c.type === "identifier" && c.text === name) {
            return src ? unquote(src.text) : undefined
          }
        }
      }
      // No descent: the stack holds `program`'s statements, and only an
      // `import_statement` can match, so descending past it would re-walk the
      // tree this method used to walk.
    }
    return undefined
  }

  private propNames(node: Node | undefined): string[] {
    return this.propEntries(node).map((e) => e.name)
  }

  /**
   * The prop/emit names WITH the node that writes each one (M59 #825).
   *
   * The string-only walk was enough while nothing asked WHERE a prop is
   * declared, and the caller then stamped every prop with the `props: { … }`
   * PAIR's range — one line for all of them. The oracle made that visible the
   * moment `contains` edges carried lines: Account.vue claimed `user` at line 17
   * (`props: {`) while `user` is written at 18 (the same for UserCard.vue:60 and
   * TabPane.vue:70's `type`). A prop's declaration line is the line its own key
   * is written on, which only this walk can say.
   */
  /**
   * F3 (vue master review 2026-09-30): the DEFAULTS object of a
   * `withDefaults(defineProps<T>(), { … })` call.
   *
   * The macro handler visits the inner `defineProps` call, so the defaults sit
   * one frame UP the parent chain — that frame is what was never looked at, and
   * it is the whole reason 98 corpus files lost their declared defaults. Climbs
   * from the macro call to the nearest enclosing `withDefaults` and returns its
   * SECOND argument, or null when there is no wrapper (the plain `defineProps`
   * form, which legitimately has no defaults). The hop bound guards against a
   * pathological tree; `scriptRootOf` above climbs the same way without one.
   */
  private withDefaultsObject(macroCall: Node): Node | null {
    let n: Node | null = macroCall.parent
    let hops = 0
    while (n && hops < 8) {
      if (n.type === "call_expression") {
        const fn = n.childForFieldName("function")
        if (fn && fn.text === "withDefaults") return n.childForFieldName("arguments")?.namedChild(1) ?? null
      }
      n = n.parent
      hops++
    }
    return null
  }

  /**
   * F3: key → raw default-value TEXT of a `withDefaults` defaults object.
   *
   * The value is kept as WRITTEN SOURCE, not evaluated: a default may be any
   * expression (`0`, `'hi'`, `() => []`, `defaultSize`) and this lane has no
   * evaluator, so pretending otherwise would be a worse lie than storing the
   * text. A BRACKET-LED computed key is skipped under the same F6 ruling — its
   * "default" is a variable reference, not a static default.
   */
  private defaultsEntries(objects: Node | null): Map<string, string> {
    const out = new Map<string, string>()
    if (!objects || objects.type !== "object") return out
    for (let i = 0; i < objects.namedChildCount; i++) {
      const c = objects.namedChild(i)
      if (!c || c.type !== "pair") continue
      const keyNode = c.childForFieldName("key")
      const raw = keyNode?.text
      if (!raw || raw.startsWith("[")) continue
      const value = c.childForFieldName("value")
      if (!value) continue
      const k = keyNode!.type === "string" ? unquote(raw) : raw
      if (k) out.set(k, value.text)
    }
    return out
  }

  private propEntries(node: Node | undefined): Array<{ name: string; node: Node }> {
    // Shallow: props: ['a', 'b'] (array of strings) OR
    // props: { a: {...}, b: {...} } (object — direct pair keys only).
    if (!node) return []
    const out: Array<{ name: string; node: Node }> = []
    if (node.type === "array") {
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i)
        if (c && c.type === "string") {
          const v = unquote(c.text)
          if (v) out.push({ name: v, node: c })
        }
      }
    } else if (node.type === "object") {
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i)
        if (c && c.type === "pair") {
          const keyNode = c.childForFieldName("key")
          const key = keyNode?.text
          // F6: same ruling as emitDataKeys / emitObjectMembers. A computed props
          // or emits key is a variable reference, not a contract name.
          if (key && !key.startsWith("[")) out.push({ name: key, node: keyNode ?? c })
        }
      }
    }
    return out
  }

  /**
   * F13 (full 829-file corpus draw, 2026-09-30): the IDENTIFIER elements of a
   * `defineProps([ … ])` / `defineEmits([ … ])` array.
   *
   * `propEntries` accepts string elements only, which is right for its callers —
   * an identifier is not an event NAME and must not become a symbol (that would
   * be the F6 phantom class again: `CHANGE_EVENT` is a declaration, and its
   * value is the event). But dropping it was worse than either: measured, 13
   * corpus files lost a member of their event set outright, and
   * time-select.vue's `defineEmits([CHANGE_EVENT, 'blur', 'focus', 'clear',
   * UPDATE_MODEL_EVENT])` published three events where the component emits five.
   *
   * Those constants are imported, so resolving their VALUES needs cross-file
   * constant folding this lane does not do. The DECLARATION is nameable right
   * here, and F12 already established the rule for exactly this situation in
   * `defineProps(binding)`: a named declaration becomes a contract EDGE, never a
   * copy of its members. This is a separate accessor rather than a flag on
   * `propEntries` so that the Options-API path, which uses the same helper for
   * `emits: [ … ]`, keeps ignoring identifiers rather than inheriting a
   * declaration edge it never asked for.
   */
  private propDeclarationEntries(node: Node | undefined): Array<{ name: string; node: Node }> {
    if (!node || node.type !== "array") return []
    const out: Array<{ name: string; node: Node }> = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      // A member expression (`KEYS.primary`) and a call (`ev('x')`) also do not
      // name a plain declaration; an identifier does.
      if (c && c.type === "identifier") out.push({ name: c.text, node: c })
    }
    return out
  }

  /**
   * V1 (#419): names from the TYPE-LITERAL generic form of the script-setup
   * compiler macros — defineProps<{ id: string }>() and
   * defineEmits<{ (e: 'save'): void }>() — where the public contract lives in
   * the type_arguments node, not a runtime argument. Probe-verified against
   * tree-sitter-typescript: props = property_identifier under object_type;
   * emits = the first string literal of each call_signature's formal
   * parameters.
   */
  private genericMacroNames(callNode: Node, which: "props" | "emits"): string[] {
    return this.genericMacroEntries(callNode, which).map((e) => e.name)
  }

  /**
   * M59 (#825) follow-up: genericMacroNames carrying the name node, so macro
   * symbols range at their own key lines (same contract as the runtime form).
   */
  /**
   * F14 (full 829-file corpus draw, 2026-09-30): the shape of a macro's TYPE
   * ARGUMENT, at the level of the contract, with one rule — descend through
   * intersection / union constituents and through type wrappers, read a generic's
   * OWN name, and STOP at an object literal.
   *
   * The old code had no shape at all: `findChildByType(typeArgs, "object_type")`
   * reads DIRECT children only, so `defineProps<{ … } & Pick<X, 'a'>>()` — an
   * intersection — matched nothing and published NO props (measured:
   * cascader-panel/src/menu.vue, prop symbols `[]`), while a separate
   * blind-descendant search for the first `type_identifier` reached INTO the
   * object literal's property signatures and named a prop's TYPE as the
   * contract. Both halves were visible only at the 829-file draw, and in
   * opposite directions: node.vue's plain literal `defineProps<{ node: NodeShape;
   * menuId?: string }>()` should name nothing, yet the oracle derived
   * `NodeShape` for it — a MISSING that no sampled run had ever seen.
   *
   * `CascaderNode[]` inside a property signature is still inside one, so the
   * array case that made the old pre-order rule look reasonable is covered by
   * the same stop.
   */
  private contractTypeShape(typeArgs: Node | null): {
    objectTypes: Node[]
    participants: Array<{ name: string; node: Node }>
  } {
    const objectTypes: Node[] = []
    const participants: Array<{ name: string; node: Node }> = []
    const seenParticipants = new Set<string>()
    const addParticipant = (n: Node | null): void => {
      if (!n || !n.text) return
      if (seenParticipants.has(n.text)) return
      seenParticipants.add(n.text)
      participants.push({ name: n.text, node: n })
    }
    const walk = (node: Node | null, depth: number): void => {
      if (!node || depth > 8) return
      switch (node.type) {
        case "intersection_type":
        case "union_type":
          // Every constituent contributes to the contract, which is the whole
          // point of the shape: `{ … } & Pick<X, 'a'> & { other: N }` has THREE
          // operands and the middle one names a declaration.
          for (let i = 0; i < node.namedChildCount; i++) walk(node.namedChild(i), depth + 1)
          return
        case "parenthesized_type":
        case "as_expression":
        case "satisfies_expression":
        case "non_null_expression": {
          const kids = node.namedChildren
          walk(kids.length ? kids[0] : null, depth + 1)
          return
        }
        case "object_type":
          // Its MEMBERS are the props (read by the caller). Their types are the
          // props' own business and the delegate already publishes them as
          // declared_type rows — so this is where the walk stops.
          objectTypes.push(node)
          return
        case "generic_type": {
          // `Pick<X, 'a'>` — the participant is `Pick`, the generic's OWN name.
          // Its type ARGUMENTS are not descended into: `X` is the operand of a
          // utility type, not a declaration this component's contract names, and
          // the oracle draws the same line.
          const kids = node.namedChildren
          const nameNode = kids.length > 0 ? kids[0] : null
          if (nameNode && (nameNode.type === "type_identifier" || nameNode.type === "nested_type_identifier")) {
            addParticipant(nameNode)
          }
          return
        }
        case "type_identifier":
          addParticipant(node)
          return
        default:
          // array_type, primitive_type, type_parameter, index_signature, and
          // anything this grammar adds later: not a participant.
          return
      }
    }
    if (typeArgs) for (let i = 0; i < typeArgs.namedChildCount; i++) walk(typeArgs.namedChild(i), 0)
    return { objectTypes, participants }
  }

  private genericMacroEntries(callNode: Node, which: "props" | "emits"): Array<{ name: string; node: Node }> {
    const out: Array<{ name: string; node: Node }> = []
    const typeArgs = this.findChildByType(callNode, "type_arguments")
    if (!typeArgs) return out
    // F14: an INTERSECTION puts the literal under `intersection_type`, where the
    // old direct-child lookup could not see it and every prop was lost.
    const objectTypes = this.contractTypeShape(typeArgs).objectTypes
    for (const objectType of objectTypes) for (let i = 0; i < objectType.namedChildCount; i++) {
      const member = objectType.namedChild(i)
      if (!member) continue
      if (which === "props") {
        if (member.type === "property_signature") {
          const pid = this.findChildByType(member, "property_identifier")
          if (pid?.text) out.push({ name: pid.text, node: pid })
        } else if (member.type === "index_signature") {
          // F6: an INDEX SIGNATURE is not a member. `[key: string]: string`
          // names a parameter, and emitting it as a Property called `[key]`
          // published a name no graph can resolve — measured on
          // panel-date-pick.vue:846, the corpus's one real phantom symbol. The
          // key of an index signature declares the INDEX, not a member any
          // caller can name.
        }
      } else {
        // emits: each call_signature is one event overload; the event names
        // are the string literals in its formal parameters ((e: 'save') or a
        // UNION literal (e: 'save' | 'close') declaring several names — every
        // union member is an event).
        if (member.type === "call_signature") {
          const fp = this.findChildByType(member, "formal_parameters")
          if (!fp) continue
          const seen = new Set<string>()
          for (let j = 0; j < fp.namedChildCount; j++) {
            const p = fp.namedChild(j)
            if (!p) continue
            this.collectUnionStringNodes(p, seen, out)
          }
        }
      }
    }
    return out
  }

  /** collectUnionStrings carrying the literal node (generic-emits key lines). */
  private collectUnionStringNodes(root: Node, seen: Set<string>, out: Array<{ name: string; node: Node }>): void {
    const stack: Node[] = [root]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "string") {
        const v = unquote(n.text)
        if (v && !seen.has(v)) {
          seen.add(v)
          out.push({ name: v, node: n })
        }
        continue // a string's children are fragments, not more events
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
  }

  private findDescendantType(root: Node, type: string): Node | null {
    const stack: Node[] = [root]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === type) return n
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return null
  }

  /**
   * V1b (#419): collect every string-literal event name under a parameter's
   * type — the type_annotation may be a literal_type ('save') or a union_type
   * ('save' | 'close'); both declare event names.
   */
  private collectUnionStrings(root: Node, out: Set<string>): void {
    const stack: Node[] = [root]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "string") {
        const v = unquote(n.text)
        if (v) out.add(v)
        continue // a string's children are fragments, not more events
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
  }

  /**
   * V2 (#419) + M1 (review wave) + D1 (deeper review): extract simple
   * identifier tokens from a template expression's raw text ({{ count }},
   * :label="label", @click="onSave", v-model="count", v-if="show"). The vue
   * grammar keeps these as opaque text — no child AST — so tokenization is
   * by character walk (no regex). Only chain ROOTS are uses: in `item.id`,
   * `id` is a read of the loop variable, never of a same-named member —
   * emitting it fabricated member edges (family receiver-only rule). An
   * identifier preceded (modulo whitespace) by `.`, `?.` or `#` is skipped.
   * String/template-literal CONTENTS are not identifiers either:
   * `@click="go('save')"` must not read 'save' as a member. Single/double
   * quotes skip to their closer (backslash escapes honored); backticks
   * additionally re-enter code inside ${...} (nesting tracked).
   *
   * V4 (#419): identifiers bound by a template-local construct (v-for loop
   * var, slot prop) in the current scope are skipped — they shadow any
   * same-named member.
   */
  /** Counts the line breaks before `end` — how many lines into the fragment a
   *  match sits. M59 (#825): a template expression's identifier has a REAL line
   *  (the line of the text fragment it is written in, plus its own offset within
   *  that fragment when the fragment wraps), and the collector is the only place
   *  that still knows it — a `Set<string>` throws that away, which is why vue's
   *  template `uses` edges carried no line at all.
   */
  private static linesBefore(text: string, end: number): number {
    let n = 0
    for (let i = 0; i < end && i < text.length; i++) if (text[i] === "\n") n++
    return n
  }

  private collectIdentifiers(text: string, out: Map<string, number>, shadowed: Set<string> | undefined, baseLine: number): void {
    const isIdentStart = (ch: string): boolean =>
      (ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || ch === "_" || ch === "$"
    const isIdentPart = (ch: string): boolean => isIdentStart(ch) || (ch >= "0" && ch <= "9")
    const isSpace = (ch: string): boolean => ch === " " || ch === "\t" || ch === "\n" || ch === "\r"
    // Context stack: quote chars for strings, "${" for interpolations, "{"
    // for plain braces inside them. Empty stack = code. String CONTENTS never
    // emit; template ${...} regions are code again.
    //
    // F10 (master review 2026-09-30): an unquoted object-literal KEY is not a
    // member read either, and at 432 of 1,150 corpus files `{{ { count: 1 } }}`
    // emitted Uses(count). The colon alone does not identify a key, because in a
    // TERNARY the colon follows a VALUE: `show ? count : total` reads `count`.
    // Reading the colon without tracking the `?` deletes every ternary-branch
    // read — a silent false negative, worse than the false positive it removes,
    // and invisible to a fixture that only forbids. So a pending `?` is tracked
    // PER BRACE DEPTH: `c ? { p: 1 } : d` has the `?` at the outer depth and the
    // object's key colon at the inner one, and the two must not be confused.
    const stack: string[] = []
    let braceDepth = 0
    const pendingTernary = new Set<number>()
    /** Is the identifier starting at `start` an object-literal KEY? */
    const isKeyPosition = (start: number): boolean => {
      let k = start
      while (k < text.length && isIdentPart(text[k])) k++
      while (k < text.length && isSpace(text[k])) k++
      if (text[k] !== ":") return false
      if (text[k + 1] === ":") return false
      // A colon that CLOSES a pending ternary at this depth is not a key colon,
      // and it consumes the pending marker.
      if (pendingTernary.has(braceDepth)) { pendingTernary.delete(braceDepth); return false }
      return true
    }
    const emit = (word: string, start: number): void => {
      let k = start - 1
      while (k >= 0 && isSpace(text[k])) k--
      const prev = k >= 0 ? text[k] : ""
      const prev2 = k - 1 >= 0 ? text[k - 1] : ""
      // Member access (`a.b`), optional chain (`a?.b`), private (`#x`):
      // only the root is a use.
      const chained = prev === "." || (prev2 === "?" && prev === ".") || prev === "#"
      if (!chained && !shadowed?.has(word)) out.set(word, baseLine + RealVueAnalyzer.linesBefore(text, start))
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
        if (ch === "$" && text[i + 1] === "{") { stack.push("${"); braceDepth++; pendingTernary.delete(braceDepth); i += 2; continue }
        if (ch === "`") { stack.pop(); i++; continue }
        i++
        continue
      }
      // Code context (empty stack, "${", or plain "{").
      if (ch === "'" || ch === '"' || ch === "`") { stack.push(ch); i++; continue }
      if (ch === "{") { stack.push(ch); braceDepth++; pendingTernary.delete(braceDepth); i++; continue }
      if (ch === "}") {
        if (top === "{" || top === "${") { stack.pop(); braceDepth--; pendingTernary.delete(braceDepth) }
        i++
        continue
      }
      if (ch === "?") {
        // `?.` is optional chaining and `??` is nullish coalescing; neither
        // opens a ternary, and reading either as one would disarm the key test
        // for the rest of the expression.
        if (text[i + 1] !== "." && text[i + 1] !== "?") pendingTernary.add(braceDepth)
        i++
        continue
      }
      if (ch === ":") {
        if (pendingTernary.has(braceDepth)) pendingTernary.delete(braceDepth)
        i++
        continue
      }
      if (!isIdentStart(ch)) { i++; continue }
      let j = i + 1
      while (j < text.length && isIdentPart(text[j])) j++
      if (!isKeyPosition(i)) emit(text.slice(i, j), i)
      i = j
    }
  }

  /**
   * V4 (#419): template-local bindings declared on an element's start tag.
   * (a) v-for="item in items" / v-for="(item, i) in items" — the loop
   *     variable(s) are bound locally;
   * (b) slot props #default="{ row }" / v-slot="{ row, col }" — destructured
   *     names are bound locally.
   */
  private collectNodeShadowBindings(startTag: Node, shadowed: Set<string>): void {
    for (let i = 0; i < startTag.namedChildCount; i++) {
      const c = startTag.namedChild(i)
      if (!c || c.type !== "directive_attribute") continue
      const dname = this.findChildByType(c, "directive_name")?.text
      const value = this.findChildByType(c, "quoted_attribute_value")
      const attrVal = value ? this.findChildByType(value, "attribute_value") : null
      if (!attrVal) continue
      if (dname === "v-for") {
        this.collectVForVars(attrVal.text, shadowed)
      } else if (dname === "#" || dname === "v-slot") {
        // { row, col } — the slot-prop destructuring binds locally.
        //
        // No regex, and this is the point of the change: `collectIdentifiers` is
        // the hand-written stack machine that already tokenizes THIS EXACT class
        // of template expression text for `uses`, so the lane had TWO tokenizers
        // for one input — a regex one and a stack-machine one — and they
        // disagreed on method (documented as such in the regex census). Reusing
        // the stack machine deletes the duplicate and the disagreement with it.
        this.collectIdentifierNames(attrVal.text, shadowed, attrVal.startPosition.row)
      }
    }
  }

  /**
   * V4 (#419): the loop-variable part of v-for="item in items" (before
   * in/of) is bound locally; only the collection part is a member use.
   */
  private collectVForUsage(text: string, out: Map<string, number>, shadowed: Set<string>, baseLine: number): void {
    // No regex — see `parseVForDirective`, which this delegates to and which
    // reproduces the previous pattern's lazy-match semantics exactly, including
    // its two fallback cases.
    const m = this.parseVForDirective(text)
    const collection = m && m.collectionStart >= 0 ? m.collection : text
    // The collection is a SUBSTRING of `text`, so its line base is the fragment's
    // base plus the breaks the earlier part of the directive value contains —
    // `v-for="item in\n  items"` writes items on the next line.
    const start = m && m.collectionStart >= 0 ? m.collectionStart : 0
    this.collectIdentifiers(collection, out, shadowed, baseLine + RealVueAnalyzer.linesBefore(text, start))
  }

  /**
   * V4 (#419): the loop variables themselves (item, or item + i in the
   * parenthesized form) are bound locally.
   */
  private collectVForVars(text: string, shadowed: Set<string>): void {
    // No regex on both counts: the head is parsed by `parseVForDirective` and the
    // alias names are tokenized by the same stack machine the rest of the lane
    // uses. The previous head pattern had NO `(.+)$` tail, so it matched where
    // the usage pattern could not (an empty or multi-line collection) — that
    // asymmetry is preserved and pinned by vue/v-for-directive-shapes.
    const m = this.parseVForDirective(text)
    const vars = m ? m.aliases : text
    this.collectIdentifierNames(vars, shadowed, 0)
  }

  /**
   * The `v-for` directive grammar, with NO regular expression.
   *
   *   v-for="item in items"        v-for="(row, col) in grid"
   *   v-for="item of items"        v-for="(value, key) of map"
   *
   * This replaces `/^\s*\(?([^)]*?)\)?\s+(?:in|of)\s+(.+)$/` and its tail-less
   * sibling, and reproduces their behaviour rather than an idealised version of
   * it, because three of the old behaviours are load-bearing:
   *
   * 1. `([^)]*?)` is LAZY, so the alias head is the SHORTEST run without a `)`
   *    for which the rest of the pattern matches. A greedy scan would make
   *    `item in items` bind `item in items`.
   * 2. `\)?` is optional, so the `)` belongs to the KEYWORD MATCH, not the head.
   *    `(row, col) in grid` must bind `row` and `col` — and must stop at the
   *    first `)`, because the head cannot contain one.
   * 3. `(.+)$` has no `s` flag, so `.` does NOT match a newline: a collection that
   *    spans lines fails the pattern, and the caller falls back to treating the
   *    WHOLE directive as the collection. That fallback is preserved, including
   *    its consequence that such a file loses its shadowing (the tail-less
   *    sibling still matches, so `collectVForVars` is unaffected).
   *
   * `collectionStart` is the byte offset of the collection within `text`, which
   * is what `collectVForUsage` needs to count the line breaks before it. It is
   * `-1` when the tail-less form matched but the collection form did not.
   */
  private parseVForDirective(text: string): { aliases: string; collection: string; collectionStart: number } | null {
    const n = text.length
    const isWs = (ch: string | undefined): boolean =>
      ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f" || ch === "\v"
    let i = 0
    while (i < n && isWs(text[i])) i++ // \s*
    if (i < n && text[i] === "(") i++ // \(?
    const aliasStart = i
    // At `e`, does `\)?\s+(?:in|of)\s+` match? Returns the offset just past it.
    // At `e`, does `\)?\s+(?:in|of)\s+` match? Returns the whitespace run that
    // follows the keyword, because `\s+` is GREEDY and the collection form
    // backtracks it — so the caller needs the run, not just its end.
    const keywordAt = (e: number): { wsStart: number; wsEnd: number } | null => {
      let j = e
      if (j < n && text[j] === ")") j++ // \)?
      const ws1 = j
      while (j < n && isWs(text[j])) j++ // \s+  (one or more)
      if (j === ws1) return null
      const two = text.slice(j, j + 2)
      if (two !== "in" && two !== "of") return null // (?:in|of), no word boundary
      j += 2
      const ws2 = j
      while (j < n && isWs(text[j])) j++ // \s+
      if (j === ws2) return null
      return { wsStart: ws2, wsEnd: j }
    }
    // The alias head cannot contain ')', so scanning stops just past the first
    // one — which the keyword matcher above is still allowed to consume.
    const limit = (() => {
      const close = text.indexOf(")", aliasStart)
      return close < 0 ? n : close
    })()
    let aliases = ""
    let collectionStart = -1
    for (let e = aliasStart; e <= limit; e++) {
      const kw = keywordAt(e)
      if (!kw) continue
      // `\s+(.+)`: the engine took the LONGEST whitespace run and then gave
      // characters back until `(.+)` had something to match. Reproduce that
      // backtracking exactly — it is observable: for `v-for="item in  "`
      // (trailing spaces, no collection) the old pattern matched with the
      // collection `" "`, so the final space WAS the collection and not
      // separator. A greedy scan that stops at end-of-string reports no
      // collection at all, which is a different answer on 170 of the 799
      // generated shapes.
      let chosen = -1
      for (let q = kw.wsEnd; q > kw.wsStart; q--) {
        const tail = text.slice(q)
        if (tail.length === 0) continue
        if (tail.includes("\n")) continue // `.` excludes a newline
        chosen = q
        break
      }
      if (chosen < 0) continue
      aliases = text.slice(aliasStart, e)
      collectionStart = chosen
      break
    }
    if (collectionStart < 0) {
      // The tail-less form: same shape, but an empty or multi-line collection
      // still yields a head.
      for (let e = aliasStart; e <= limit; e++) {
        if (!keywordAt(e)) continue
        aliases = text.slice(aliasStart, e)
        break
      }
    }
    if (aliases === "") return null
    return {
      aliases,
      collection: collectionStart >= 0 ? text.slice(collectionStart) : text,
      collectionStart,
    }
  }

  /**
   * Tokenize identifiers out of template expression TEXT and SHADOW them, using
   * the same stack machine `collectIdentifiers` uses for member reads. The lane
   * previously ran a regex over this input in two places while the stack machine
   * sat one method away; both now share one tokenizer.
   */
  private collectIdentifierNames(text: string, into: Set<string>, baseLine: number): void {
    const scratch = new Map<string, number>()
    this.collectIdentifiers(text, scratch, undefined, baseLine)
    for (const k of scratch.keys()) into.add(k)
  }

  private isLifecycleHook(key: string): boolean {
    return (
      key === "beforeCreate" || key === "created" || key === "beforeMount" ||
      key === "mounted" || key === "beforeUpdate" || key === "updated" ||
      key === "beforeUnmount" || key === "unmounted" || key === "activated" ||
      key === "deactivated" || key === "errorCaptured" || key === "renderTracked" ||
      key === "renderTriggered" || key === "beforeDestroy" || key === "destroyed" ||
      // M3 (review wave): the Vue 3 SSR hook was missing, so
      // serverPrefetch() methods were invisible.
      key === "serverPrefetch"
    )
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  /**
   * M14 #299 - evidence-tier classification for EVERY emitted relationship.
   * Same rules as the JVM family. Vue template instantiates are
   * usage_contextual (component usage by tag name, not construction).
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
        // vue: template tag usages are component REFERENCES, not constructions
        md.evidenceClass = md.isComponentUsage ? "usage_contextual" : "structural"
        continue
      }
      md.evidenceClass = "usage_contextual"
    }
  }


  private findDescendantObject(root: Node): Node | undefined {
    const stack: Node[] = [root]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "object") return n
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return undefined
  }

  private findExportDefault(root: Node): Node | null {
    const stack: Node[] = [root]
    while (stack.length > 0) {
      const n = stack.pop()!
      // M4 (review wave): structural check — the old
      // text.startsWith("export default") missed `export /*c*/ default`
      // (methods then surfaced ownerless through the JS fallback). An
      // export_statement whose first two children are the export/default
      // keywords is the default export regardless of comments/whitespace.
      if (n.type === "export_statement" && this.isDefaultExportStatement(n)) return n
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return null
  }

  private isDefaultExportStatement(n: Node): boolean {
    // Token shape, comments AND leading decorators skipped: `export /*c*/
    // default` and `@Dec export default` are still the default export (D3:
    // the first version bailed on any leading named child, keeping
    // decorated defaults ownerless).
    let seenExport = false
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (!c || c.type === "comment" || c.type === "decorator") continue
      if (!seenExport) {
        if (!c.isNamed && c.text === "export") seenExport = true
        else if (c.isNamed) return false
        continue
      }
      if (!c.isNamed && c.text === "default") return true
      if (c.isNamed) return false
    }
    return false
  }

  private elementTagName(element: Node): string | undefined {
    return this.elementTagNameNode(element)?.text
  }

  /**
   * F9(b): the tag as WRITTEN, dotted segments and namespace included.
   *
   * `tag_name` spells only the FIRST segment: for `<Form.Input />` it is `Form`,
   * so reading it alone is what silently dropped the sub-component. The spelling
   * lives in the enclosing `start_tag` / `self_closing_tag` text, up to the first
   * delimiter. Written with indexOf rather than a regex on purpose — this file's
   * regex census is a claim the docs now publish, and adding an 7th literal to
   * recover a string the grammar already hands us in two pieces is the wrong
   * trade.
   */
  private elementTagSpelling(element: Node): string | undefined {
    // NOTE: do NOT use `tagNameNode.parent` for this. Measured: that is the
    // `element` node, so its text is the WHOLE element including the leading
    // `<`, which produced targets like `<div` and `<template` and broke five
    // fixtures. Look the `start_tag` / `self_closing_tag` up directly instead —
    // its text starts at the tag name.
    const tagNode = this.elementTagNameNode(element)
    const holder = this.findChildByType(element, "start_tag") ?? this.findChildByType(element, "self_closing_tag")
    let text = holder?.text ?? tagNode?.text
    if (!text) return undefined
    // In this grammar `start_tag` spans the delimiters too, so its text BEGINS
    // with `<`. Drop it (charCode, no regex) or every target reads `<div`.
    if (text.charCodeAt(0) === 60 /* "<" */) text = text.slice(1)
    let end = text.length
    for (const delim of [" ", "\t", "\n", "\r", ">", "/"]) {
      const i = text.indexOf(delim)
      if (i >= 0 && i < end) end = i
    }
    return end > 0 ? text.slice(0, end) : undefined
  }

  /** The `tag_name` node itself — the node that SPELLS the tag, for its line. */
  private elementTagNameNode(element: Node): Node | null {
    const tagNode = this.findChildByType(element, "start_tag") || this.findChildByType(element, "self_closing_tag")
    if (!tagNode) return null
    return this.findChildByType(tagNode, "tag_name")
  }

  private offsetRange(
    range: ASTEngine.UniversalSymbol["range"],
    lineOffset: number,
    colOffset: number,
    indexOffset = 0,
  ): ASTEngine.UniversalSymbol["range"] {
    const out = { ...range }
    out.startLine += lineOffset
    out.endLine += lineOffset
    if (range.startLine === 1) out.startColumn += colOffset
    if (indexOffset && out.startIndex !== undefined) out.startIndex += indexOffset
    if (indexOffset && out.endIndex !== undefined) out.endIndex += indexOffset
    return out
  }

  /**
   * H2 (review wave): full script→SFC shift — lines always, columns when on
   * the script's first line (endColumn only when the range never leaves
   * it). Errors, exports, and imports were pushed raw, pointing at script
   * coordinates while symbols pointed at SFC ones.
   */
  private shiftScriptRange(
    range: ASTEngine.UniversalSymbol["range"],
    lineOffset: number,
    colOffset: number,
    indexOffset = 0,
  ): ASTEngine.UniversalSymbol["range"] {
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

  /**
   * The object literal a `provide(key, …)` publishes, unwrapping ONE call layer.
   *
   * `provide(k, reactive({ a, b }))` publishes `a` and `b`, but the direct
   * argument is a call, not an object, so reading only `args[1]` as an object
   * found nothing. `reactive` / `readonly` / `markRaw` / `computed` all take the
   * object as their first argument, which is why one level is enough;
   * `form.vue`'s `provide(formContextKey, reactive({ ...toRefs(props), emit,
   * resetFields, clearValidate, validateField }))` lost every one of those keys
   * this way. One layer only — deeper is a shape this lane should not guess at.
   */
  private providedValueObject(value: Node | null): Node | null {
    if (!value) return null
    if (value.type === "object") return value
    if (value.type !== "call_expression") return null
    const args = this.findChildByType(value, "arguments")
    if (!args) return null
    for (let i = 0; i < args.namedChildCount; i++) {
      const c = args.namedChild(i)
      if (c && c.type === "object") return c
    }
    return null
  }

  private findChildByType(node: Node, type: string): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === type) return child
    }
    return null
  }

  private nodeToRange(node: Node): ASTEngine.UniversalSymbol["range"] {
    return {
      startLine: node.startPosition.row + 1,
      startColumn: node.startPosition.column + 1,
      endLine: node.endPosition.row + 1,
      endColumn: node.endPosition.column + 1,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    }
  }
}

