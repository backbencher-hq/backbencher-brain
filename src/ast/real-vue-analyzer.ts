// Vue Intelligence Engine
// M12.12 rewrite: C#-family contract, pure-AST, fully regex-free.
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

const VUE_BUILTIN_TAGS = new Set([
  "component", "transition", "transition-group", "keep-alive", "teleport", "suspense",
  "fragment",
])

const VUE_COMPILER_MACROS = new Set([
  "defineProps", "defineEmits", "defineExpose", "withDefaults", "defineModel",
  "defineSlots", "defineOptions",
])

// ============================================================================
// PURE-STRING HELPERS (regex-free)
// ============================================================================

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
        const tag = this.elementTagName(n)
        if (tag && !HTML_BUILTIN_TAGS.has(tag) && !VUE_BUILTIN_TAGS.has(tag) && !seenUsages.has(tag)) {
          seenUsages.add(tag)
          const tagNode = this.elementTagNameNode(n)
          relationships.push({
            source: moduleName,
            target: tag,
            type: ASTEngine.RelationshipType.Instantiates,
            confidence: 0.95,
            // M59 (#825): the `<Child/>` tag as written in the template.
            ...(tagNode ? { line_number: tagNode.startPosition.row + 1 } : {}),
            metadata: { isComponentUsage: true },
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
    let scriptCyclomaticSum = 0
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
      // The script body is extracted via the JS-family contract (M12.10)
      // regardless of `lang` — the JS grammar tolerates TS type annotations
      // (verified: zero ERROR nodes on lang=ts fixtures) and, unlike the TS
      // analyzer, resolves method_definition scopes inside the Options-API
      // default-export object (calls source from the method name, not module).
      // TS-only declarations (interface/type) are not extracted as symbols.
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
        if (namePair) {
          const v = namePair.childForFieldName("value")
          if (v) componentName = v.text.replace(/['"]/g, "")
        }
        // DEDUPE: the SFC skeleton already pushed a Class symbol for
        // moduleName — pushing again without a `name:` option produced TWO
        // identical component Class symbols.
        if (!pushedComponentNames.has(componentName)) {
          pushedComponentNames.add(componentName)
          symbols.push({
            name: componentName,
            kind: ASTEngine.SymbolKind.Class,
            range: this.offsetRange(this.nodeToRange(defaultObject), lineOffset, colOffset, scriptStartIndex),
            visibility: "public",
            metadata: { nodeType: "vue_options_component", isOptionsComponent: true },
          })
        }
        this.extractOptionsApi(defaultObject, componentName, symbols, patterns, lineOffset, colOffset, defaultPayloads, scriptStartIndex)
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
              let entries = this.propEntries(firstArg ?? undefined)
              if (entries.length === 0) {
                entries = this.genericMacroEntries(n, fn.text === "defineProps" ? "props" : "emits")
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
                  scope: moduleName,
                  ownerName: moduleName,
                  ownerKind: ASTEngine.SymbolKind.Class,
                  visibility: "public",
                  metadata: { [meta]: true, isScriptSetup: true },
                })
              }
            }
          }
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (c) macroStack.push(c)
          }
        }
      }
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
        hasTypeInference: false,
        hasFrameworkIntelligence: true,
        analysisVersion: "5.0.0-m12.12-family-contract",
      },
    }
  }

  // ============================================================================
  // OPTIONS API EXTRACTION
  // ============================================================================

  private extractOptionsApi(
    objectNode: Node,
    componentName: string,
    symbols: ASTEngine.UniversalSymbol[],
    patterns: Record<string, boolean>,
    lineOffset: number,
    colOffset: number,
    payloads?: Map<string, ASTEngine.UniversalSymbol>,
    indexOffset?: number,
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
        for (const { name: pn, node: pnode } of this.propEntries(value ?? child)) {
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
            metadata: { isProp: true },
          })
        }
      } else if (key === "emits") {
        for (const { name: en, node: enode } of this.propEntries(value ?? child)) {
          symbols.push({
            name: en,
            kind: ASTEngine.SymbolKind.Event,
            range: this.offsetRange(this.nodeToRange(enode), lineOffset, colOffset, indexOffset),
            scope: componentName,
            ownerName: componentName,
            ownerKind: ASTEngine.SymbolKind.Class,
            visibility: "public",
            metadata: { isEmit: true },
          })
        }
      } else if (key === "watch") {
        // watch is NOT a lifecycle hook (was mislabeled isLifecycleHook);
        // its VALUE holds the watcher handlers - each key is a reactive
        // source being watched -> Method symbol owned by the component.
        if (value) {
          patterns["Options API"] = true
          this.emitObjectMembers(value, componentName, symbols, ASTEngine.SymbolKind.Method, "isWatcher", lineOffset, colOffset, payloads, indexOffset)
        }
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
          if (key) out.push({ name: key, node: keyNode ?? c })
        }
      }
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
  private genericMacroEntries(callNode: Node, which: "props" | "emits"): Array<{ name: string; node: Node }> {
    const out: Array<{ name: string; node: Node }> = []
    const typeArgs = this.findChildByType(callNode, "type_arguments")
    if (!typeArgs) return out
    const objectType = this.findChildByType(typeArgs, "object_type")
    if (!objectType) return out
    for (let i = 0; i < objectType.namedChildCount; i++) {
      const member = objectType.namedChild(i)
      if (!member) continue
      if (which === "props") {
        if (member.type === "property_signature") {
          const pid = this.findChildByType(member, "property_identifier")
          if (pid?.text) out.push({ name: pid.text, node: pid })
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
    // for plain braces inside them. Empty stack = code. String contents
    // (including object keys like {a: 1} — pre-existing acceptance, not
    // solved here) never emit; template ${...} regions are code again.
    const stack: string[] = []
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
        if (ch === "$" && text[i + 1] === "{") { stack.push("${"); i += 2; continue }
        if (ch === "`") { stack.pop(); i++; continue }
        i++
        continue
      }
      // Code context (empty stack, "${", or plain "{").
      if (ch === "'" || ch === '"' || ch === "`") { stack.push(ch); i++; continue }
      if (ch === "{") { stack.push(ch); i++; continue }
      if (ch === "}") {
        if (top === "{" || top === "${") stack.pop()
        i++
        continue
      }
      if (!isIdentStart(ch)) { i++; continue }
      let j = i + 1
      while (j < text.length && isIdentPart(text[j])) j++
      emit(text.slice(i, j), i)
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
        const re = /[A-Za-z_$][A-Za-z0-9_$]*/g
        let m: RegExpExecArray | null
        while ((m = re.exec(attrVal.text)) !== null) shadowed.add(m[0])
      }
    }
  }

  /**
   * V4 (#419): the loop-variable part of v-for="item in items" (before
   * in/of) is bound locally; only the collection part is a member use.
   */
  private collectVForUsage(text: string, out: Map<string, number>, shadowed: Set<string>, baseLine: number): void {
    const m = /^\s*\(?([^)]*?)\)?\s+(?:in|of)\s+(.+)$/.exec(text)
    const collection = m ? m[2] : text
    // The collection is a SUBSTRING of `text`, so its line base is the fragment's
    // base plus the breaks the earlier part of the directive value contains —
    // `v-for="item in\n  items"` writes items on the next line.
    const start = m ? m[0].length - m[2].length : 0
    this.collectIdentifiers(collection, out, shadowed, baseLine + RealVueAnalyzer.linesBefore(text, start))
  }

  /**
   * V4 (#419): the loop variables themselves (item, or item + i in the
   * parenthesized form) are bound locally.
   */
  private collectVForVars(text: string, shadowed: Set<string>): void {
    const m = /^\s*\(?([^)]*?)\)?\s+(?:in|of)\s+/.exec(text)
    const vars = m ? m[1] : text
    const re = /[A-Za-z_$][A-Za-z0-9_$]*/g
    let mm: RegExpExecArray | null
    while ((mm = re.exec(vars)) !== null) shadowed.add(mm[0])
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

