function stringIncludes(str: string, val: string): boolean {
  return str.indexOf(val) !== -1
}

// Strip `<`, `>`, `"`, and `'` characters from an include-path node text
// (`<vector>` → `vector`, `"Service.h"` → `Service.h`). Pure-String scan —
// replaces the legacy `/[<>"']/g` regex used for include-path extraction.
function stripIncludeChars(text: string): string {
  let out = ""
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c !== "<" && c !== ">" && c !== '"' && c !== "'") out += c
  }
  return out
}

// Strip a leading access-specifier keyword from a base-class node text
// (`private Repository` → `Repository`). Pure-String scan — replaces the
// legacy `/^public\s+|^protected\s+|^private\s+/` regex.
function stripAccessSpecifier(text: string): string {
  const lower = text.toLowerCase()
  if (lower.startsWith("public")) return text.slice("public".length).trim()
  if (lower.startsWith("protected")) return text.slice("protected".length).trim()
  if (lower.startsWith("private")) return text.slice("private".length).trim()
  return text.trim()
}

import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

export class RealCppAnalyzer implements ASTEngine.LanguageAnalyzer {
  analyze(
    rootNode: Node,
    content: string,
    filePath: string,
  ): Omit<ASTEngine.ParseResult, "language" | "metadata"> & { metadata: Partial<ASTEngine.FileMetadata> } {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const errors: ASTEngine.ParseError[] = []

    const patterns: Record<string, boolean> = {}
    const frameworks: Record<string, boolean> = {}
    let memorySafetyScore = 100

    // PER-FILE state - the old version stored registries on `this`, which
    // LEAKED ACROSS FILES when analyzer instances are reused by parallel
    // indexing: identical source in a later file lost its Uses edges
    // entirely (proven by probe), and virtual registries contaminated
    // unrelated files.
    const usesSeen = new Set<string>()
    let fileDecisions = 0
    const classVirtuals = new Map<string, Map<string, string[]>>()
    const pendingOverrides: Array<{ cls: string; method: string; params: string; line?: number }> = []
    const classBases = new Map<string, string[]>()

    // CP1 (cpp review) bare-read resolution sets. C++ has no runtime —
    // every bare `identifier` that names a file-visible VALUE is a Uses
    // edge (the analyzer previously emitted none at all: `return g;`
    // produced zero edges). Bounded like the C family: ownerless
    // file-scope Variable/Function/EnumMember/Constant, namespace members
    // (visible inside their namespace or via using-directives), class
    // members (visible inside member functions), and file-scope
    // using-declarations. Qualified reads (ns::x), types, and anything
    // locally bound stay silent — recorded limitations, not fabrications.
    const fileScopeValues = new Set<string>()
    const namespaceValues = new Map<string, Set<string>>()
    const classMembers = new Map<string, Set<string>>()
    const usedNamespaces = new Set<string>()
    // Out-of-line definitions (`void Foo::bar() {}`) resolve their scope
    // AFTER the walk: class scope -> member, known namespace -> namespaced
    // value, unknown (header-defined) scope -> file-visible value.
    const pendingQualified: Array<{ name: string; scope: string }> = []
    {
      const pre: Array<{ n: Node; ns: string[]; inFn: boolean; inClass: string | null }> = [
        { n: rootNode, ns: [], inFn: false, inClass: null },
      ]
      const addValue = (name: string, ns: string[], cls: string | null): void => {
        if (!name) return
        if (cls) {
          let s = classMembers.get(cls)
          if (!s) { s = new Set(); classMembers.set(cls, s) }
          s.add(name)
          return
        }
        if (ns.length > 0) {
          const top = ns[ns.length - 1]
          let s = namespaceValues.get(top)
          if (!s) { s = new Set(); namespaceValues.set(top, s) }
          s.add(name)
          return
        }
        fileScopeValues.add(name)
      }
      const leftmostId = (n: Node | null): string | null => {
        let cur = n
        while (cur) {
          if (cur.type === "identifier" || cur.type === "field_identifier") return cur.text
          cur = cur.childForFieldName("declarator") || cur.namedChild(0)
        }
        return null
      }
      while (pre.length > 0) {
        const { n, ns, inFn, inClass } = pre.pop()!
        const t = n.type
        if (t === "namespace_definition") {
          const nm = this.childText(n, "namespace_identifier")
          if (nm && nm !== "anonymous") {
            for (let i = n.namedChildCount - 1; i >= 0; i--) {
              const c = n.namedChild(i)
              if (c) pre.push({ n: c, ns: [...ns, nm], inFn, inClass })
            }
            continue
          }
        } else if (t === "class_specifier" || t === "struct_specifier" || t === "union_specifier") {
          // CPPD1 parity (main walk + oracle): explicit/partial
          // specialization names live in template_type
          // (`FlatTupleElemBase<T, I>`), not a bare type_identifier.
          // Without the fallback the members misattribute to the enclosing
          // namespace/file scope (fmt differential: oracle-only file-scope
          // Matcher + swapped generator member sets).
          const nm =
            this.childText(n, "type_identifier") ||
            (() => {
              const tt = this.findChild(n, "template_type")
              if (!tt) return null
              const tn =
                tt.childForFieldName?.("name") ||
                this.findChild(tt, "type_identifier") ||
                this.findChild(tt, "qualified_identifier")
              if (tn?.text) return tn.text
              const lt = tt.text.indexOf("<")
              return lt > 0 ? tt.text.slice(0, lt).trim() : null
            })()
          const body = this.findChild(n, "class_body") || this.findChild(n, "field_declaration_list")
          if (nm && body) {
            for (let i = n.namedChildCount - 1; i >= 0; i--) {
              const c = n.namedChild(i)
              if (c) pre.push({ n: c, ns, inFn, inClass: nm })
            }
            continue
          }
        } else if (t === "function_definition") {
          // The defined name is a file-visible VALUE (callbacks read as
          // values); out-of-line `Foo::bar` defines a MEMBER of Foo.
          // CP2: macro-function shapes (`TEST(a, b) {...}`) define no real
          // function — their names must not enter resolution (else the
          // ERROR-recovered fragments of sibling macro sites read as uses).
          const det = this.getFunctionDetails(n)
          if (det && !det.isDestructor && !det.name.startsWith("operator") && !this.isMacroFunctionShape(n, det.name)) {
            if (det.scope) pendingQualified.push({ name: det.name, scope: det.scope })
            else if (!inFn) addValue(det.name, ns, inClass)
          }
          for (let i = n.namedChildCount - 1; i >= 0; i--) {
            const c = n.namedChild(i)
            if (c) pre.push({ n: c, ns, inFn: true, inClass })
          }
          continue
        } else if (!inFn && (t === "declaration" || t === "field_declaration")) {
          // File/namespace/class-scope value bindings (init_declarator
          // leftmost + bare declarators). Function prototypes contribute
          // their NAME (a callable value); their PARAMETERS never do (HC6
          // class: prototype params are not file-scope declarations).
          // CP6: a file-scope structured binding (`auto [x, y] = p;`)
          // declares EVERY name (the leftmost rule would register x only).
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (!c) continue
            if (c.type === "init_declarator" && c.namedChild(0)?.type === "structured_binding_declarator") {
              const sb = c.namedChild(0)!
              for (let k = 0; k < sb.namedChildCount; k++) {
                const b = sb.namedChild(k)
                if (b && (b.type === "identifier" || b.type === "field_identifier")) addValue(b.text, ns, inClass)
              }
            } else if (c.type === "init_declarator" || c.type === "identifier" || c.type === "field_identifier" ||
                c.type === "pointer_declarator" || c.type === "reference_declarator" || c.type === "array_declarator") {
              const nm = leftmostId(c)
              if (nm) addValue(nm, ns, inClass)
            } else if (c.type === "function_declarator") {
              const nm = leftmostId(c)
              if (nm) addValue(nm, ns, inClass)
            }
          }
        } else if (!inFn && t === "enumerator") {
          const nm = this.childText(n, "identifier")
          // Enum members are global constants (C parity) — visible anywhere.
          if (nm) fileScopeValues.add(nm)
        } else if (t === "using_declaration" && !inFn && !inClass) {
          const txt = n.text
          if (txt.indexOf("using namespace") !== -1) {
            const tgt = this.findChild(n, "qualified_identifier") || this.findChild(n, "identifier")
            if (tgt) usedNamespaces.add(tgt.text.split("::").filter(Boolean).join("::"))
          } else {
            const leaf = this.findChild(n, "qualified_identifier") || this.findChild(n, "identifier")
            if (leaf) {
              const segs = leaf.text.split("::").filter(Boolean)
              if (segs.length > 0) fileScopeValues.add(segs[segs.length - 1])
            }
          }
        }
        for (let i = n.namedChildCount - 1; i >= 0; i--) {
          const c = n.namedChild(i)
          if (c) pre.push({ n: c, ns, inFn, inClass })
        }
      }
      // Flush out-of-line scopes now that every class/namespace is known.
      for (const q of pendingQualified) {
        if (classMembers.has(q.scope)) addValue(q.name, [], q.scope)
        else if (namespaceValues.has(q.scope)) addValue(q.name, [q.scope], null)
        else fileScopeValues.add(q.name)
      }
    }

    interface Scope {
      node: Node
      name: string
      kind: ASTEngine.SymbolKind
      visibility: "public" | "private" | "protected"
      isTemplate: boolean
      isAbstract: boolean
      symbolRef?: ASTEngine.UniversalSymbol
      friends?: string[]
      // CP1 (cpp review): names bound by this function scope (parameters at
      // entry + local declaration bindings in walk order) — a shadowing local
      // suppresses the file/member read. Flow-sensitive like the C family:
      // reads before any binding still resolve outward.
      locals?: Set<string>
      // CP5 (second review): the owning class of an OUT-OF-LINE definition
      // (`void Foo::bar() {}` pushes a Method scope named `bar`, so the
      // Class entry that inline methods resolve through is absent and bare
      // member reads stayed silent on both sides). Set from the definition's
      // explicit scope; looked up in classMembers with the same key the
      // pre-pass flush uses (exact match — nested `A::B::m` scopes stay a
      // documented limitation, same as the flush).
      classScope?: string
    }

    const scopeStack: Scope[] = []

    interface StackItem {
      node: Node
      parentContext?: Scope
      isExit?: boolean
    }

    const stack: StackItem[] = [{ node: rootNode }]

    // CP1 helpers (bare-read discipline). All name-level; mirrors the C
    // family's CGD-gates where they exist, documented where C++ differs.
    const DECL_PARENT_TYPES = new Set([
      "declaration", "field_declaration", "parameter_declaration",
      "init_declarator", "function_declarator", "pointer_declarator",
      "reference_declarator", "array_declarator", "abstract_pointer_declarator",
      "abstract_array_declarator", "abstract_function_declarator",
      "enumerator", "using_declaration", "alias_declaration",
      "optional_parameter_declaration", "type_parameter_declaration",
      // CP6 (second review): `auto [x, y]` bindings declare (see the
      // carve-out in isDeclarationPosition — all names, not first-only).
      "structured_binding_declarator",
      // F6 audit: `template_type_parameter` / `template_value_parameter` are
      // NOT types in the pinned tree-sitter-cpp grammar — template parameters
      // parse as `type_parameter_declaration` (`typename T` / `class T`) and
      // `parameter_declaration` / `optional_parameter_declaration`
      // (`int N`, `int N = M`), all live in this set above. Removed.
    ])
    // Leftmost-identifier declarator walk (C isDeclaringChainLeftmost
    // contract): `int x = g;` declares x, reads g.
    const isDeclaringChainLeftmost = (node: Node): boolean => {
      const p = node.parent
      if (!p || !p.type.endsWith("declarator")) return false
      let cur: Node | null = p
      while (cur) {
        if (cur.type === "identifier" || cur.type === "field_identifier") {
          return cur.startIndex === node.startIndex
        }
        let next: Node | null = null
        for (let k = 0; k < cur.namedChildCount; k++) {
          const c = cur.namedChild(k)
          if (c && (c.type.endsWith("declarator") || c.type === "identifier" || c.type === "field_identifier")) {
            next = c
            break
          }
        }
        cur = next
      }
      return false
    }
    const isDeclarationPosition = (node: Node): boolean => {
      const p = node.parent
      if (!p) return false
      // Template value-parameter defaults: only the FIRST identifier child
      // declares (`template <int N = M>`: N declares, M reads).
      // F6 audit: only the real template-parameter nodes belong here. The
      // former `template_type_parameter` / `template_value_parameter` names
      // never occur in the pinned grammar; `parameter_declaration` (bare
      // `int N`) is deliberately NOT listed — its single identifier needs no
      // first-only rule, and `optional_parameter_declaration` (`int N = M`)
      // gives N-declares / M-reads via the first-identifier rule below.
      if (p.type === "optional_parameter_declaration" || p.type === "type_parameter_declaration") {
        for (let k = 0; k < p.namedChildCount; k++) {
          const c = p.namedChild(k)
          if (c && (c.type === "identifier" || c.type === "field_identifier")) {
            return c.startIndex === node.startIndex
          }
        }
        return false
      }
      // CP8 (second review): member/EnUM declarator segments. A
      // field_declaration or enumerator with a bare identifier value
      // (`int x = LIMIT;`, `A = LIMIT`) has NO init_declarator wrapper —
      // the whole declarator is flat, so the generic rule below treated
      // the VALUE as declaring and the read stayed silent on both sides.
      // Segment rule over ALL children (anonymous `,`/`;` split segments;
      // `=`/`:`/`{` switch a segment from declaring to reading): the first
      // identifier-ish child of a fresh segment declares, the rest read.
      // `int x = G, y = 2` → x declares, G reads, y declares. Multi-name
      // `int x, y;` still declares both (one segment each). Residual: two
      // declarators sharing one flat segment cannot occur (a comma always
      // splits), so the rule is exact for this grammar.
      if (p.type === "field_declaration" || p.type === "enumerator") {
        let fresh = true
        let foundFirst = false
        for (let k = 0; k < p.childCount; k++) {
          const c = p.child(k)
          if (!c) continue
          if (!c.isNamed) {
            if (c.type === "," || c.type === ";") { fresh = true; foundFirst = false }
            else if (c.type === "=" || c.type === ":" || c.type === "{") fresh = false
            continue
          }
          if (c.type === "identifier" || c.type === "field_identifier") {
            if (!foundFirst && fresh) {
              if (c.startIndex === node.startIndex && c.endIndex === node.endIndex) return true
              foundFirst = true
            } else {
              if (c.startIndex === node.startIndex && c.endIndex === node.endIndex) return false
            }
          }
        }
        return false
      }
      if (!DECL_PARENT_TYPES.has(p.type)) return false
      // CP6 (second review): structured bindings declare EVERY name
      // (`auto [x, y] = p` binds x AND y — not first-only). The initializer
      // is a SIBLING under init_declarator (or the range under
      // for_range_loop), never under this node, so a blanket true is exact.
      // Must precede the endsWith-declarator branch below: that rule is
      // first-only and would bind x while leaking y as a read.
      if (p.type === "structured_binding_declarator") return true
      if (p.type.endsWith("declarator") || p.type === "init_declarator") {
        return isDeclaringChainLeftmost(node)
      }
      return true
    }
    // Directive text (CGD11 contract): identifiers under preproc_* with no
    // code container between are textual (`#ifdef FEAT`), never reads.
    // Macro bodies (preproc_arg blob) are likewise never walked as code.
    const isPreprocText = (node: Node): boolean => {
      let cur: Node | null = node.parent
      while (cur) {
        const t: string = cur.type
        if (t.includes("statement") || t.includes("declaration") || t.includes("declarator") ||
            t.includes("specifier") || t.includes("enumerator") || t.includes("compound") ||
            t.includes("argument_list") || t.includes("init") || t.includes("expression") ||
            t.includes("function_definition") || t.includes("class_body") || t.includes("field_declaration_list")) return false
        if (t.startsWith("preproc_")) return true
        cur = cur.parent
      }
      return false
    }
    const hasFriendAncestor = (node: Node): boolean => {
      let cur: Node | null = node.parent
      while (cur) {
        if (cur.type === "friend_declaration") return true
        cur = cur.parent
      }
      return false
    }
    // Qualified reads (`ns::x`, `Foo::y`) resolve through scopes the
    // single-TU graph cannot see — recorded limitation, stays silent.
    const hasQualifiedAncestor = (node: Node): boolean => {
      let cur: Node | null = node.parent
      while (cur) {
        const t: string = cur.type
        if (t === "qualified_identifier") return true
        if (t.includes("statement") || t.includes("declaration") || t.includes("declarator") ||
            t.includes("expression") || t.includes("function_definition") || t.includes("field_declaration_list") ||
            t.includes("class_body") || t.includes("argument_list")) return false
        cur = cur.parent
      }
      return false
    }
    // Attribute names (`[[maybe_unused]]`) never name values.
    const hasAttributeAncestor = (node: Node): boolean => {
      let cur: Node | null = node.parent
      while (cur) {
        const t: string = cur.type
        if (t === "attribute" || t === "attribute_declaration" || t === "attribute_specifier") return true
        if (t.includes("statement") || t.includes("declaration") || t.includes("function_definition") ||
            t.includes("expression") || t.includes("class_body")) return false
        cur = cur.parent
      }
      return false
    }
    // CP1 callee climb: the callee of a call is a call, never a use —
    // including through template wrappers (`f<T>()`), dependent names
    // (`x.template m<T>()`) and defense parentheses (`(f)(x)`, the Windows
    // min/max idiom the calls branch already unwraps). Without the climb,
    // every explicit-template call emitted calls+uses for one target.
    const isCallCallee = (node: Node): boolean => {
      let top: Node = node
      let p: Node | null = node.parent
      while (p && (p.type === "template_function" || p.type === "template_method" ||
          p.type === "dependent_name" || p.type === "parenthesized_expression")) {
        top = p
        p = p.parent
      }
      if (!p || p.type !== "call_expression") return false
      const fnField = p.childForFieldName("function")
      if (fnField) return fnField.startIndex === top.startIndex && fnField.endIndex >= top.endIndex
      const first = p.namedChild(0)
      return !!first && first.startIndex === top.startIndex && first.endIndex >= top.endIndex
    }
    // CP1: is this the defined FUNCTION's own declarator name (not a
    // parameter)? It declares the entity, never a local — binding it
    // would self-shadow same-named overload reads (oracle parity).
    const isFunctionOwnName = (node: Node): boolean => {
      let up: Node | null = node.parent
      while (up) {
        if (up.type === "parameter_list" || up.type === "parameter_declaration") return false
        if (up.type === "function_declarator" && up.parent && up.parent.type === "function_definition") return true
        up = up.parent
      }
      return false
    }
    // Enclosing function scope for locals lookup (lambdas have no scope —
    // their bodies read the enclosing function's bindings, correctly).
    const enclosingFunctionScope = (): any | null => {
      for (let i = scopeStack.length - 1; i >= 0; i--) {
        const s = scopeStack[i]
        if (s.kind === ASTEngine.SymbolKind.Function || s.kind === ASTEngine.SymbolKind.Method ||
            s.kind === ASTEngine.SymbolKind.Constructor) return s
      }
      return null
    }
    // CP1 resolution: file-scope value, enclosing-class member,
    // enclosing/used-namespace member, or global enum member.
    const isResolvableRead = (name: string): boolean => {
      if (fileScopeValues.has(name)) return true
      const enclosingNs: string[] = []
      for (let i = scopeStack.length - 1; i >= 0; i--) {
        const s = scopeStack[i]
        if (s.kind === ASTEngine.SymbolKind.Class || s.kind === ASTEngine.SymbolKind.Struct) {
          const mm = classMembers.get(s.name)
          if (mm && mm.has(name)) return true
        }
        // CP5: out-of-line member scope carries its class (see Scope).
        if (
          (s.kind === ASTEngine.SymbolKind.Function || s.kind === ASTEngine.SymbolKind.Method ||
            s.kind === ASTEngine.SymbolKind.Constructor) && s.classScope
        ) {
          const mm = classMembers.get(s.classScope)
          if (mm && mm.has(name)) return true
        }
        if (s.kind === ASTEngine.SymbolKind.Namespace && s.name !== "anonymous") enclosingNs.push(s.name)
      }
      for (const ns of enclosingNs) {
        const nm = namespaceValues.get(ns)
        if (nm && nm.has(name)) return true
      }
      for (const used of usedNamespaces) {
        const nm = namespaceValues.get(used)
        if (nm && nm.has(name)) return true
      }
      return false
    }
    // Parameter names of one declarator (K&R n/a in C++).
    const declaratorParamNames = (decl: Node | null): string[] => {
      const out: string[] = []
      if (!decl) return out
      const walk: Node[] = [decl]
      while (walk.length > 0) {
        const m = walk.pop()!
        if (m.type === "parameter_declaration") {
          let cur: Node | null = m
          while (cur) {
            if (cur.type === "identifier" || cur.type === "field_identifier") { out.push(cur.text); break }
            cur = cur.childForFieldName("declarator") || cur.namedChild(0)
          }
          continue
        }
        for (let k = 0; k < m.namedChildCount; k++) {
          const c = m.namedChild(k)
          if (c) walk.push(c)
        }
      }
      return out
    }

    while (stack.length > 0) {
      const item = stack.pop()!
      const { node, parentContext, isExit } = item

      if (isExit) {
        if (parentContext?.symbolRef && parentContext.isAbstract) {
          parentContext.symbolRef.isAbstract = true
          if (parentContext.symbolRef.metadata) {
            parentContext.symbolRef.metadata.isAbstract = true
          }
        }
        if (parentContext && scopeStack.length > 0 && scopeStack[scopeStack.length - 1] === parentContext) {
          scopeStack.pop()
        }
        continue
      }

      if (node.isMissing || node.hasError) {
        if (node.type === "ERROR" || node.type === "MISSING") {
          if (errors.length < 3) errors.push({
            message: `Syntax ${node.type} detected`,
            range: this.nodeToRange(node),
            severity: "warning",
          })
        }
      }

      let newContext = parentContext
      const type = node.type
      let pushedScope = false

      // 1. V8 Freeze Fix: Only check small text identifiers, not global node text
      if (type === "identifier" || type === "qualified_identifier" || type === "type_identifier") {
        const text = node.text
        if (text === "std::make_unique" || text === "std::make_shared") {
          memorySafetyScore = Math.min(100, memorySafetyScore + 5)
        }
      }
      if (type === "new_expression" || type === "delete_expression") {
        memorySafetyScore = Math.max(0, memorySafetyScore - 5)
      }

      // T1 family contract: decisions = branch constructs + short-circuit
      // operators. File-level cyclomatic was entirely absent before.
      if (
        type === "if_statement" || type === "for_statement" ||
        type === "while_statement" || type === "do_statement" ||
        type === "case_statement" || type === "catch_clause" ||
        type === "conditional_expression"
      ) {
        fileDecisions++
      } else if (type === "binary_expression") {
        const op = node.childForFieldName("operator")?.text
        if (op === "&&" || op === "||") fileDecisions++
      }

      if (type === "using_declaration") {
        // CPPD12 (deep review 2026-09-05): using-declarations emitted the
        // LEGACY {source, imported} import shape — the exact defect class the
        // C wave fixed for #include ("the persister reads imp.module and
        // DROPS imports with none"). `using namespace std;` and `using
        // std::vector;` were therefore NEVER persisted to brain_import.
        // Aligned to the family {module, items} contract (rust use:
        // module = qualified path, items = imported names; namespace form =
        // wildcard). Only FILE/NAMESPACE-scope usings are module imports — a
        // class-body `using B::f;` is a member RE-EXPORT (brings an inherited
        // member into the derived scope), not a module dependency, and stays
        // silent (no fabricated import edge).
        const inClass =
          parentContext &&
          (parentContext.kind === ASTEngine.SymbolKind.Class ||
            parentContext.kind === ASTEngine.SymbolKind.Struct ||
            parentContext.kind === ASTEngine.SymbolKind.Method ||
            parentContext.kind === ASTEngine.SymbolKind.Function ||
            parentContext.kind === ASTEngine.SymbolKind.Constructor)
        if (!inClass) {
          const targetNode = this.findChild(node, "qualified_identifier") || this.findChild(node, "identifier")
          const raw = targetNode?.text ?? ""
          const isNamespaceForm = node.text.indexOf("using namespace") !== -1
          if (raw) {
            const segs = raw.split("::").filter(Boolean)
            imports.push({
              module: raw,
              items: isNamespaceForm ? ["*"] : segs.length > 1 ? [segs[segs.length - 1]] : [raw],
              range: this.nodeToRange(node),
              metadata: { isImport: true, isUsingDeclaration: true, isNamespaceImport: isNamespaceForm },
            })
            relationships.push({
              // File-level dependency statement → source "global" (same
              // convention as the #include references edge above).
              source: "global",
              target: raw,
              type: ASTEngine.RelationshipType.References,
              confidence: 0.9,
              // M59.A7 (#825): the written path names the edge, not the `using`
              // keyword — `using namespace\n  std;` would otherwise name the line
              // above the module.
              line_number: this.nodeLine(targetNode ?? node),
              metadata: { isUsingDeclaration: true, isImport: true, relationshipType: "using_dependency" },
            })
          }
        }
      } else if (type === "alias_declaration") {
        // `using Point = std::pair<double, double>;` — the modern typedef.
        // The alias name is the `name` field (type_identifier); the value is
        // a type_descriptor. Captured as a Type symbol (matches C typedefs).
        const nameNode = node.childForFieldName("name") || this.findChild(node, "type_identifier")
        const name = nameNode?.text
        if (name) {
          symbols.push({
            name,
            kind: ASTEngine.SymbolKind.Type,
            range: this.nodeToRange(node),
            visibility: parentContext?.visibility || "public",
            ownerName: parentContext?.name,
            ownerKind: parentContext?.kind,
            metadata: { isTypeAlias: true, isUsingDeclaration: true },
          })
        }
      } else if (type === "type_definition" || node.text.startsWith("typedef")) {
        const typeId = this.findChild(node, "type_identifier")
        if (typeId) {
          symbols.push({
            name: typeId.text,
            kind: ASTEngine.SymbolKind.Type,
            range: this.nodeToRange(node),
            visibility: parentContext?.visibility || "public",
            ownerName: parentContext?.name,
            ownerKind: parentContext?.kind,
            metadata: { isTypeAlias: true },
          })
        }
      } else if (type === "preproc_include") {
        const text = node.text
        // Family contract (c wave): ImportInfo canonical fields are
        // module/items — the persister reads imp.module ?? imp.path ??
        // imp.localName and DROPS imports with none. The legacy shape
        // { source, imported, isTypeOnly } produced no module, so C++
        // #include imports were NEVER persisted to brain_import (caught by
        // the systems-cluster e2e gate M14.0.F9, 2026-08-29). Align with c.
        const includePath = stripIncludeChars(text.slice(text.indexOf("include") + "include".length)).trim()
        imports.push({
          module: includePath,
          items: ["*"],
          range: this.nodeToRange(node),
          metadata: { isSystemInclude: includePath.startsWith("<"), isImport: true, isIncludeDependency: true },
        })
        // depends: #include = compile-time dependency (includePath computed above)
        if (includePath) {
          // #419 family contract: include edges carry the SAME metadata shape
          // as the C analyzer (relationshipType "include_dependency" +
          // isImport) — the C++ variant previously emitted only
          // isIncludeDependency, so the completeness gate's Section B saw no
          // pin for the include dependency kind.
          relationships.push({
            source: "global",
            target: includePath,
            type: ASTEngine.RelationshipType.References,
            confidence: 1.0,
            // M59.A7 (#825), the C lane's rule: the include directive is the
            // source construct and its WRITTEN NAME is the path token — take
            // that node's line, not the directive's (a multi-line include puts
            // the path last).
            line_number: this.nodeLine(
              this.findChild(node, "string_literal") ?? this.findChild(node, "system_lib_string") ?? node,
            ),
            metadata: { relationshipType: "include_dependency", isSystem: includePath.startsWith("<"), isImport: true, isIncludeDependency: true },
          })
        }

        const lowerText = text.toLowerCase()
        if (stringIncludes(lowerText, "memory") || stringIncludes(lowerText, "unique_ptr") || stringIncludes(lowerText, "shared_ptr")) {
          patterns["RAII"] = true
          patterns["Smart Pointers"] = true
        }
        if (
          stringIncludes(lowerText, "qt") ||
          stringIncludes(lowerText, "qobject") ||
          stringIncludes(lowerText, "qstring") ||
          stringIncludes(lowerText, "qwidget")
        )
          frameworks["Qt"] = true
        if (stringIncludes(lowerText, "iostream") || stringIncludes(lowerText, "vector") || stringIncludes(lowerText, "algorithm"))
          frameworks["stl"] = true
        if (stringIncludes(lowerText, "windows.h")) frameworks["win32"] = true
      }

      if (type === "auto") patterns["auto"] = true
      if (type === "lambda_expression") patterns["lambda"] = true

      // 5. Deep Tree Walk Fix: Only check direct children for constexpr
      if (this.hasDirectModifier(node, "constexpr")) patterns["constexpr"] = true

      if (type === "access_specifier") {
        if (parentContext) {
          const t = node.text.replace(":", "").trim()
          if (t === "public" || t === "private" || t === "protected") {
            parentContext.visibility = t as any
          }
        }
      }

      if (type === "namespace_definition") {
        const name = this.childText(node, "namespace_identifier") || "anonymous"
        symbols.push({
          name,
          kind: ASTEngine.SymbolKind.Namespace,
          range: this.nodeToRange(node),
          visibility: "public",
          metadata: { isCppNamespace: true, fullName: this.buildFullName(scopeStack, name) },
        })
        newContext = {
          node,
          name,
          kind: ASTEngine.SymbolKind.Namespace,
          visibility: "public",
          isTemplate: false,
          isAbstract: false,
          friends: [],
        }
        scopeStack.push(newContext)
        pushedScope = true
      } else if (type === "class_specifier" || type === "struct_specifier" || type === "union_specifier") {
        // Forward declaration (`class X;`) — no body: NOT a symbol, no scope
        // push (matches the C negative contract: forward decls produce no
        // symbol). Only the type identifier lives inside, so walk children
        // (harmless) and continue.
        const bodyNode = this.findChild(node, "class_body") || this.findChild(node, "field_declaration_list")
        if (!bodyNode) {
          newContext = parentContext
          for (let i = node.namedChildCount - 1; i >= 0; i--) {
            const child = node.namedChild(i)
            if (child) stack.push({ node: child, parentContext: newContext })
          }
          continue
        }
        // CPPD1 (M37.9 probe, fmt corpus): partial/explicit class template
        // SPECIALIZATION (`template <typename T> class Box<T*>`, `template <>
        // class Box<int>`) carries its name in a template_type child
        // (`Box<T*>`), not a bare type_identifier — so every specialization
        // fabricated a bogus `anonymous` class symbol (255 across fmt). The
        // base name of the template_type IS the class (a specialization is
        // the same class Box, not a new anonymous type).
        const name =
          this.childText(node, "type_identifier") ||
          (() => {
            const tt = this.findChild(node, "template_type")
            if (tt) {
              const tn =
                tt.childForFieldName?.("name") ||
                this.findChild(tt, "type_identifier") ||
                this.findChild(tt, "qualified_identifier")
              if (tn?.text) return tn.text
              const lt = tt.text.indexOf("<")
              return lt > 0 ? tt.text.slice(0, lt).trim() : null
            }
            return null
          })() ||
          "anonymous"
        const kind = ASTEngine.SymbolKind.Class
        const defaultVis = type === "class_specifier" ? "private" : "public"

        const isTemplate = node.parent?.type === "template_declaration"

        newContext = { node, name, kind, visibility: defaultVis, isTemplate, isAbstract: false, friends: [] }
        scopeStack.push(newContext)
        pushedScope = true

        const baseClasses: string[] = []
        const baseClause = this.findChild(node, "base_class_clause")
        if (baseClause) {
          // Pinned-wasm shape: base_class_clause children are FLAT
          // (access_specifier / type_identifier / template_type). The old
          // 'base_class' wrapper branches were dead literals (grammar audit).
          for (let i = 0; i < baseClause.namedChildCount; i++) {
            const bc = baseClause.namedChild(i)
            if (!bc || bc.type === "access_specifier") continue
            const typeNode =
              this.findChild(bc, "type_identifier") ||
              this.findChild(bc, "qualified_identifier") ||
              this.findChild(bc, "template_type") ||
              bc
            // CPPD4 (M37.9 fmt probe, base.h is_std_string_like): the extends
            // EDGE target must be the BASE CLASS NAME — leaf segment, template
            // ARGUMENTS stripped. Simple bases already parse to a bare
            // type_identifier (native_formatter), but a QUALIFIED templated
            // base (`detail::is_convertible<decltype(...)>`) fell through to
            // the whole template_type text, fabricating extends edges whose
            // target is the full argument list. Template args are ARGUMENTS,
            // never the inherited base (family contract, mirror of the
            // JS/TS/Dart heritage rule). The cleanBases registry below already
            // applies exactly this clean (split '<' then ::-segments) — the
            // edge now uses the same leaf.
            let rawText = stripAccessSpecifier(typeNode.text)
            const ltRaw = rawText.indexOf("<")
            if (ltRaw !== -1) rawText = rawText.slice(0, ltRaw).trim()
            const rawSegs = rawText.split(/::|\s+/).filter(Boolean)
            if (rawSegs.length > 1) rawText = rawSegs[rawSegs.length - 1]
            if (rawText) {
              baseClasses.push(rawText)
              relationships.push({
                source: name,
                target: rawText,
                type: ASTEngine.RelationshipType.Extends,
                confidence: 1.0,
                // M59.A7 (#825): a type expression's start is not always the
                // line of the names inside it (a specifier starts at its
                // KEYWORD) — `nameLine` prefers the grammar's `name` field.
                line_number: this.nameLine(typeNode),
                metadata: { nodeType: typeNode.type },
              })
            }
          }
          // Registry key = CLEAN base name (template args stripped, leaf
          // segment) - methods register under the declared class name, so a
          // raw 'numpunct<Char>' key never matched the 'numpunct' registry.
          const cleanBases = baseClasses.map((b) => {
            let t = b.split("<")[0].trim()
            const parts = t.split(/::|\s+/).filter(Boolean)
            return parts[parts.length - 1] ?? t
          })
          classBases.set(name, cleanBases)
        }

        const sym: ASTEngine.UniversalSymbol = {
          name,
          kind: ASTEngine.SymbolKind.Class,
          range: this.nodeToRange(node),
          visibility: parentContext?.visibility || "public",
          ownerName: parentContext?.name,
          ownerKind: parentContext?.kind,
          metadata: {
            isCppClass: true,
            isTemplate,
            baseClasses,
          },
        }
        symbols.push(sym)
        newContext.symbolRef = sym
      } else if (type === "enum_specifier") {
        const name = this.childText(node, "type_identifier") || "anonymous"
        let isEnumClass = false
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)
          if (child && (child.text === "class" || child.text === "struct")) {
            isEnumClass = true
            break
          }
        }

        symbols.push({
          name,
          kind: ASTEngine.SymbolKind.Enum,
          range: this.nodeToRange(node),
          visibility: parentContext?.visibility || "public",
          ownerName: parentContext?.name,
          ownerKind: parentContext?.kind,
          metadata: { isCppEnum: true, isEnumClass, isScopedEnum: isEnumClass },
        })
        newContext = {
          node,
          name,
          kind: ASTEngine.SymbolKind.Enum,
          visibility: "public",
          isTemplate: false,
          isAbstract: false,
          friends: [],
        }
        scopeStack.push(newContext)
        pushedScope = true
      } else if (type === "function_definition" || type === "field_declaration" || type === "declaration") {
        // CP2 (cpp review): friend declarations (`friend void helper();`)
        // are NOT members — the inner declaration node previously minted a
        // (private) Method symbol for someone else's function. The subtree
        // still walks (parameter names bind nothing observable), but no
        // symbol is emitted.
        if (hasFriendAncestor(node)) {
          newContext = parentContext
          for (let i = node.namedChildCount - 1; i >= 0; i--) {
            const child = node.namedChild(i)
            if (child) stack.push({ node: child, parentContext: newContext })
          }
          continue
        }
        const funcDetails = this.getFunctionDetails(node)

        let isStatic = this.hasDirectModifier(node, "static")
        let isConstexpr = this.hasDirectModifier(node, "constexpr")
        let isConst = this.hasDirectModifier(node, "const")
        let isVirtual = this.hasDirectModifier(node, "virtual") || this.hasDirectModifier(node, "override")

        if (funcDetails) {
          const { name: funcName, scope: explicitScope, isDestructor, isOperator } = funcDetails

          // CP2: macro-function shapes (`TEST(a, b) {...}`) declare no real
          // function — emit no symbol — BUT the body is real code whose
          // locals must bind (shadowing) and whose nested declarations must
          // NOT leak as file-scope symbols. Push an anonymous function scope
          // (no symbolRef, empty name → relationship sources fall back to
          // "global", matching the oracle which scopes these bodies as
          // plain functions). Without the scope, TEST-body locals minted as
          // file-scope Variables AND shadow-suppression failed (phantom
          // uses to same-named globals: `copy`, `file`).
          if (!isDestructor && this.isMacroFunctionShape(node, funcName)) {
            newContext = {
              node,
              name: "",
              kind: ASTEngine.SymbolKind.Function,
              visibility: "public",
              isTemplate: false,
              isAbstract: false,
              friends: [],
              locals: new Set<string>(),
            }
            scopeStack.push(newContext)
            pushedScope = true
            // The branch continues past the shared exit-record push below,
            // so record the pop here (else the scope leaks into siblings).
            stack.push({ node, parentContext: newContext, isExit: true })
            for (let i = node.namedChildCount - 1; i >= 0; i--) {
              const child = node.namedChild(i)
              if (child) stack.push({ node: child, parentContext: newContext })
            }
            continue
          }

          // 3. Out-of-Line Method Orphan Fix: Use explicit scope if defined (e.g. MyClass::myMethod)
          const actualOwnerName = explicitScope || parentContext?.name
          const actualOwnerKind = explicitScope ? ASTEngine.SymbolKind.Class : parentContext?.kind

          const isConstructor = actualOwnerName === funcName && actualOwnerKind === ASTEngine.SymbolKind.Class

          // 2. Pure Virtual Hallucination Fix: Only check direct immediate children for '0' in a field declaration
          let isPureVirtual = false
          if (isVirtual || type === "field_declaration" || type === "declaration") {
            for (let i = 0; i < node.childCount; i++) {
              const child = node.child(i)
              if (child && child.type === "number_literal" && child.text === "0") {
                isPureVirtual = true
                break
              }
            }
          }

          if (isPureVirtual && parentContext && parentContext.name === actualOwnerName) {
            parentContext.isAbstract = true
          }

          const isTemplate = node.parent?.type === "template_declaration"
        // Destructors are compiler-managed lifecycle members; exclude them from
        // the declaration symbol set (matching the universal contract's focus on
        // user declarations).
        if (isDestructor) {
          // still walk children for nested declarations
          newContext = parentContext
          for (let i = node.namedChildCount - 1; i >= 0; i--) {
            const child = node.namedChild(i)
            if (child) stack.push({ node: child, parentContext: newContext })
          }
          continue
        }

        const kind = isConstructor
            ? ASTEngine.SymbolKind.Constructor
            : actualOwnerKind === ASTEngine.SymbolKind.Class
              ? ASTEngine.SymbolKind.Method
              : ASTEngine.SymbolKind.Function

        // Universal contract: constructors are normalized to the name
        // "constructor" (identical to the C# normalization). The C++ class name
        // remains available via ownerName.
        let symName = funcName
        if (isConstructor) symName = "constructor"

          const sym: ASTEngine.UniversalSymbol = {
            name: symName,
            kind: kind,
            range: this.nodeToRange(node),
            complexity: this.methodComplexityCpp(node),
            // CP3 (cpp review, HC1 parity): file-scope `static` (internal
            // linkage) is private. Class-member `static` is NOT internal
            // linkage — members keep their access-specifier visibility.
            visibility: (isStatic && actualOwnerKind !== ASTEngine.SymbolKind.Class
              ? "private"
              : parentContext?.visibility) || "public",
            isStatic,
            ownerName: actualOwnerName,
            ownerKind: actualOwnerKind,
            metadata: {
              isCppFunction: true,
              isTemplate,
              isVirtual,
              isPureVirtual,
              isConst,
              isStatic,
              isConstexpr,
              isConstructor,
              isDestructor,
              isOperatorOverload: isOperator,
            },
          }
          // Override tracking. The OLD code stored registries on `this`
          // AND gated registration on a prior base_class_clause - base-class
          // methods were never registered before Derived was walked
          // (top-down order), so the feature was DEAD in practice.
          // Now: EVERY class-scope method registers (C++ virtual dispatch
          // does not require the keywords); resolution is post-loop when
          // all classes/bases are known. Constructors never register.
          if (
            !isConstructor &&
            kind === ASTEngine.SymbolKind.Method &&
            parentContext?.kind === ASTEngine.SymbolKind.Class &&
            funcName !== parentContext.name
          ) {
            // Signature-aware registry: name -> normalized TYPE-ONLY
            // parameter signature. CPPD5 (M37.9 fmt probe, gtest.h
            // EmptyTestEventListener): parameter NAMES are not part of a C++
            // signature, and the gtest idiom of commenting an unused name out
            // (`const TestInfo& /*test_info*/`) made the old full-text
            // comparison diverge from the base declaration — every such
            // override was silently dropped (11 of Empty's 15 overrides).
            // Comment-stripping is insufficient: the base has the name, the
            // child has none. Compare only each parameter's TYPE (the text
            // before its declarator), so names, comments, and whitespace
            // never affect virtual-dispatch matching — while DIFFERENT
            // parameter TYPES still correctly hide (the override-signature-
            // aware fixture contract).
            const decl2 = this.findChild(node, "function_declarator")
            const paramsNode = decl2?.childForFieldName("parameters") ?? null
            const normParams = this.buildParamSig(paramsNode)
            const sigs = classVirtuals.get(parentContext.name) ?? new Map()
            // CPPD11 (deep review 2026-09-05): overloaded virtuals — a base
            // declaring BOTH `virtual void f(int)` and `virtual void f(double)`
            // only ever matched the LAST-registered signature, so the other
            // overload's override was silently dropped (probe: Derived
            // overriding f(int) AND f(double) emitted one edge). Registry is
            // now per-name signature LIST.
            const prev = sigs.get(funcName) ?? []
            if (!prev.includes(normParams)) sigs.set(funcName, [...prev, normParams])
            else sigs.set(funcName, prev)
            classVirtuals.set(parentContext.name, sigs)
            if ((classBases.get(parentContext.name)?.length ?? 0) > 0) {
              pendingOverrides.push({ cls: parentContext.name, method: funcName, params: normParams, line: this.nodeLine(node) })
            }
          }

          symbols.push(sym)

          if (type === "function_definition") {
            newContext = {
              node,
              // CPPD9 (deep review 2026-09-05): the scope NAME must match the
              // emitted symbol name. Constructors were pushed as the raw
              // class name (`Engine`) while their symbol was normalized to
              // "constructor" — so ctor-body calls emitted source=Engine (the
              // Class symbol) instead of the Constructor symbol, and the
              // qualified_calls payload never reached the constructor. The
              // family contract (groovy/java/csharp) scopes ctors under the
              // normalized "constructor" name. Class-scope (non-ctor) funcs
              // keep funcName == symName already.
              name: symName,
              kind,
              visibility: "public",
              isTemplate: false,
              isAbstract: false,
              friends: [],
              symbolRef: sym,
              // CP5: out-of-line class scope for member resolution.
              classScope: explicitScope,
              // CP1: parameters bind at function entry (flow-sensitive
              // shadowing like the C family — reads before any local
              // binding still resolve outward).
              locals: new Set(declaratorParamNames(this.findChild(node, "function_declarator"))),
            }
            scopeStack.push(newContext)
            pushedScope = true
          }
        } else if (type === "field_declaration" || type === "declaration") {
          const decls = this.findAllChildren(node, "init_declarator")
          if (decls.length === 0) {
            // Member fields use field_identifier (`int id_;`); pointer/reference
            // members wrap it in a pointer_declarator (`UserRepository *repository_;`).
            const ptrWrap =
              this.findChild(node, "pointer_declarator") || this.findChild(node, "reference_declarator")
            const basicDecl =
              this.findChild(node, "identifier") ||
              this.findChild(node, "field_identifier") ||
              (ptrWrap ? this.findChild(ptrWrap, "field_identifier") || this.findChild(ptrWrap, "identifier") : null)
            if (basicDecl) decls.push(node)
          }

          for (let idx = 0; idx < decls.length; idx++) {
            const d = decls[idx];
            // Still finding the immediate identifier for a variable, no deep walks
            let idNode = this.findChild(d, "identifier") || this.findChild(d, "field_identifier")
            if (!idNode) {
              const ptr = this.findChild(d, "pointer_declarator") || this.findChild(d, "reference_declarator")
              if (ptr) idNode = this.findChild(ptr, "identifier") || this.findChild(ptr, "field_identifier")
            }

            const name = idNode ? idNode.text : this.childText(d, "identifier") || this.childText(d, "field_identifier")
            // Function-local declarations are execution artifacts, not
            // declaration sites — only class-scope fields and file-scope
            // variables become symbols.
            const insideFunction =
              parentContext &&
              (parentContext.kind === ASTEngine.SymbolKind.Function ||
                parentContext.kind === ASTEngine.SymbolKind.Method ||
                parentContext.kind === ASTEngine.SymbolKind.Constructor)
            // CP1: ...but they DO bind locals (shadowing suppression for
            // later reads in walk order — C CGD7 contract; the RHS
            // initializer is never a binding).
            if (name && insideFunction) {
              const fnScope = enclosingFunctionScope()
              if (fnScope) {
                if (!fnScope.locals) fnScope.locals = new Set<string>()
                fnScope.locals.add(name)
              }
            }
            if (name && !stringIncludes(name, "(") && !insideFunction && !this.isBareMacroDeclaration(node, name)) {
              // File-scope static (internal linkage) → private, matching the
              // C family contract; class-scope members keep the
              // access-specifier visibility.
              const visStatic =
                isStatic && parentContext?.kind !== ASTEngine.SymbolKind.Class ? "private" : undefined
              symbols.push({
                name,
                kind: isConstexpr
                  ? ASTEngine.SymbolKind.Constant
                  : parentContext?.kind === ASTEngine.SymbolKind.Class
                    ? ASTEngine.SymbolKind.Property
                    : ASTEngine.SymbolKind.Variable,
                range: this.nodeToRange(d),
                visibility: visStatic || parentContext?.visibility || "public",
                isStatic,
                ownerName: parentContext?.name,
                ownerKind: parentContext?.kind,
                metadata: {
                  isConstexpr,
                  isStatic,
                  isConst,
                },
              })
            }
          }
        }
      } else if (type === "enumerator") {
        const name = this.childText(node, "identifier")
        if (name) {
          // CP1: function-local enumerators bind locals too (shadow
          // suppression for later reads — same walk-order discipline as
          // variable declarations).
          const fnScope = enclosingFunctionScope()
          if (fnScope && scopeStack.length > 0) {
            let inFnBody = false
            let cur2: Node | null = node.parent
            while (cur2) {
              if (cur2.type === "function_definition") { inFnBody = true; break }
              if (cur2.type === "class_specifier" || cur2.type === "struct_specifier" ||
                  cur2.type === "union_specifier") break
              cur2 = cur2.parent
            }
            if (inFnBody) {
              if (!fnScope.locals) fnScope.locals = new Set<string>()
              fnScope.locals.add(name)
            }
          }
          symbols.push({
            name,
            kind: ASTEngine.SymbolKind.EnumMember,
            range: this.nodeToRange(node),
            visibility: "public",
            ownerName: parentContext?.name,
            ownerKind: parentContext?.kind,
            metadata: { isCppEnumMember: true },
          })
        }
      } else if (type === "field_expression") {
        // struct.field or ptr->field → Uses relationship (family contract:
        // field access is a USES edge, never a references/uses pair). When the
        // field access is the function of a call (`obj.method()`), the
        // call_expression branch already emits the `calls` edge — skipping it
        // here avoids the redundant `uses` pair (one edge per pair).
        const field = node.childForFieldName("field")
        const obj = node.childForFieldName("argument") || node.namedChild(0)
        // CPPD3 (M37.9 fmt probe, base-test.cc): a member read on a CALL
        // TEMPORARY (`parse_arg_id("42:").res`) was dropped by the old
        // `!(obj.type === call_expression)` guard — that guard was meant to
        // skip method-call shapes, but `x().field` (read on a temporary) is a
        // genuine member READ. The correct callee discriminator is the PARENT
        // check (field_expression as the function of a call), which remains
        // below. The obj being a call says nothing about whether `.field` is
        // read or invoked.
        // CPPD2 (M37.9 fmt probe, xchar/chrono-test.cc): assignment-LHS
        // member WRITES (`tm.tm_year = 116`) emitted `uses` — only call-
        // callee positions were gated, not write designators. The family
        // contract (C CGD27, SCD1, OO member-read sweep) gates member writes:
        // the LHS of an assignment is a write, never a read-use.
        const pType = node.parent?.type
        // F6 audit: `compound_assignment_expression` is not a tree-sitter-cpp
        // type; `a += 1` parses as `assignment_expression` with a compound
        // operator token, which this condition already covers.
        const lhsAssign =
          pType === "assignment_expression" &&
          node.parent?.namedChild(0) &&
          node.parent!.namedChild(0)!.startIndex === node.startIndex
        if (field && field.text.trim() && pType !== "call_expression" && !lhsAssign) {
          const source = parentContext?.name || "global"
          const relKey = `${source}::uses::${field.text}`
          if (!usesSeen.has(relKey)) {
            usesSeen.add(relKey)
            relationships.push({
              source,
              target: field.text,
              type: ASTEngine.RelationshipType.Uses,
              confidence: 0.9,
              // M59.A7 (#825) / #870: the FIELD LEAF names this edge. This row
              // carried no line at all, which is the #870 measurement (a member
              // read reported at line 0 in the fmt lane).
              line_number: this.nodeLine(field),
              metadata: { relationshipType: "field_access", accessedFrom: obj?.text },
            })
          }
        }
      } else if (type === "call_expression") {
        const funcNode = node.childForFieldName("function") || node.namedChild(0)
        if (funcNode) {
          let targetName = funcNode.text
          let qualifiedName = targetName

          // CPPD13 (deep review 2026-09-05, fmt corpus: 855 -> 214 leaky
          // targets): the CALLEE LEAF is the bare name — template args
          // (m<int>), nested `::` chains (`std::numeric_limits<X>::lowest`),
          // and defense-parentheses (`(X)()` — the Windows min/max idiom)
          // must all unwrap to the innermost identifier. Recursive descent:
          //  template_function/method  -> first named child (bare name)
          //  qualified_identifier      -> last named child (repeat for
          //                              nested chains)
          //  parenthesized_expression  -> inner expression (then unwrap)
          //  field_expression          -> field member (leaf or template)
          // Stops at identifier / field_identifier / type_identifier /
          // operator_name / destructor_name. The FULL qualified path stays in
          // qualifiedName (qc payload) — only the edge target is the leaf.
          // M59.A7 (#825) contract, mirrored from the C lane: a row's line is the
          // line of the node that NAMES the relationship. For a call that is the
          // CALLEE LEAF — a `call_expression` starts at its RECEIVER, so a
          // multi-line receiver (`return obj\n  .method()`) would stamp the call
          // one line early, and a receiver span (a call inside a template
          // argument) further off. This returns the NODE, not its text, so the
          // edge's `line_number` and its `target` cannot name different nodes.
          const calleeLeafNode = (n: any): any => {
            let cur = n
            let guard = 0
            while (cur && guard++ < 8) {
              const t = cur.type
              if (t === "field_expression") {
                const f = cur.childForFieldName("field") ?? cur.namedChild(cur.namedChildCount - 1)
                if (!f) return cur
                cur = f
                continue
              }
              if (t === "template_function" || t === "template_method") {
                const base = cur.namedChild(0)
                if (!base) return cur
                cur = base
                continue
              }
              // `loc.template get<T>()` / `u.template m<int>()` — the
              // `template` disambiguator keyword makes the member a
              // dependent_name wrapping the real template_method.
              if (t === "dependent_name" && cur.namedChildCount >= 1) {
                const inner = cur.namedChild(0)
                if (inner && (inner.type === "template_method" || inner.type === "template_function" || inner.type === "identifier" || inner.type === "field_identifier")) {
                  cur = inner
                  continue
                }
                return cur
              }
              if (t === "qualified_identifier" && cur.namedChildCount >= 1) {
                cur = cur.namedChild(cur.namedChildCount - 1)
                continue
              }
              if (t === "parenthesized_expression" && cur.namedChildCount >= 1) {
                cur = cur.namedChild(0)
                continue
              }
              if (t === "identifier" || t === "field_identifier" || t === "type_identifier" ||
                  t === "operator_name" || t === "destructor_name" || t === "namespace_identifier") {
                return cur
              }
              return cur
            }
            return cur
          }
          const calleeLeaf = (n: any): string => calleeLeafNode(n)?.text ?? ""
          // The naming node of the call edge — the SAME leaf whose text becomes
          // `targetName` below, so line and target can never disagree.
          let calleeSite: any = calleeLeafNode(funcNode)
          if (funcNode.type === "field_expression") {
            // obj.method() or ptr->method()
            const field = funcNode.childForFieldName("field")
            const obj = funcNode.childForFieldName("argument") || funcNode.namedChild(0)
            if (field) {
              targetName = calleeLeaf(field)
              qualifiedName = obj ? `${obj.text}.${field.text}` : field.text
              calleeSite = calleeLeafNode(field)
            }
          } else {
            targetName = calleeLeaf(funcNode)
            qualifiedName = funcNode.text
          }

          const source = parentContext?.name || "global"

          // CPPD13 (deep review 2026-09-05, fmt): a call whose CALLEE is
          // itself a call_expression is a functor-temporary invocation
          // (`std::forward<F>(f)(args)`, `Op<int>()(a, b)`) — the effective
          // callee is the anonymous temporary's operator(), which has no
          // named target (the CPP-D9 operator-call ruling; the inner
          // construction call is emitted separately at its own node). The
          // pre-fix code emitted the raw callee text (`std::forward<F>(f)`)
          // as a junk target. Pointer-to-member recovery (`->*` in decltype
          // soup) is the same shape: no named callee.
          const calleeIsTempCall = funcNode.type === "call_expression"
          // CPPD13 tail (gmock.h L1872): `(std::declval<Class*>()->*pmf)()` —
          // a pointer-to-MEMBER invocation. The callee is only knowable at
          // runtime (like C function pointers), and the pinned grammar
          // ERROR-recovers the shape (fn.hasError). A mangled callee has no
          // trustworthy leaf — emit nothing.
          const calleeIsError = !!funcNode.hasError
          if (!targetName.startsWith("operator") && !calleeIsTempCall && !calleeIsError) {
            relationships.push({
              source,
              target: targetName,
              fromSymbol: source,
              toSymbol: qualifiedName,
              type: ASTEngine.RelationshipType.Calls,
              // M59.A7 (#825) / M60.P1 (#873): ONE line, ONE base, ONE node. The
              // row's `line_number` is the callee leaf's line (the node that
              // names the edge) and the metadata mirror repeats THAT value
              // instead of the call node's — a mirror that named a different
              // node would make "the row's line" ambiguous again, which is what
              // #873 was about. Base stays 1-based (R6).
              line_number: this.nodeLine(calleeSite),
              metadata: { line: this.nodeLine(calleeSite), qualified: qualifiedName },
            })
            // #383 payload: qualified path WITHOUT argument text (C++ keeps
            // :: separators), attributed to the enclosing function/method
            // symbol DIRECTLY (family contract — groovy/java push onto
            // parentContext.symbolRef at the call site). CPPD10 (deep review
            // 2026-09-05): the old post-loop merge keyed payloads by bare
            // method NAME, so two same-named methods in different classes
            // (Alpha.run / Beta.run) shared one bucket and BOTH symbols
            // carried BOTH classes' call lists (probe: 192 names / 640 excess
            // owners across fmt). Direct symbolRef attach is exact — and it
            // also fixes CPPD9's lost ctor payload (the ctor scope now has
            // name "constructor" == its symbol name).
            const caller = parentContext?.symbolRef
            if (caller && (caller.kind === ASTEngine.SymbolKind.Method || caller.kind === ASTEngine.SymbolKind.Function || caller.kind === ASTEngine.SymbolKind.Constructor)) {
              if (!caller.qualified_calls) caller.qualified_calls = []
              caller.qualified_calls.push(qualifiedName)
            }
          }
        }
      } else if (type === "new_expression") {
        // Track instantiations: new Foo() or new std::vector<int>()
        const typeNode = node.namedChild(0)
        if (typeNode) {
          let typeName = typeNode.text
          // CPPD8 (M37.9 fmt probe, gtest Message ctor): a leading global-scope
          // `::` adds a NESTED qualified_identifier level, so `new
          // ::std::stringstream` parses as qualified_identifier >
          // qualified_identifier("std::stringstream") > type_identifier. One
          // unwrap left "std::stringstream" — still qualified — and the clean
          // leaf regex below dropped the whole edge, while `new ::Foo` (single
          // unwrap reaches the leaf) worked. Descend to the innermost name
          // (the pinned grammar nests every namespace chain — `::` prefix or
          // Foo::Bar::Baz — as qualified_identifier levels; probed 2026-09-05:
          // no cpp shape emits scoped_type_identifier, so only
          // qualified_identifier is unwrapped here).
          let cur: any = typeNode
          while (cur && cur.type === "qualified_identifier" && cur.namedChildCount >= 1) {
            const inner = cur.namedChild(cur.namedChildCount - 1)
            if (!inner) break
            cur = inner
          }
          if (cur && cur !== typeNode) typeName = cur.text
          // Template arguments are not part of the constructed type name
          // (`new std::vector<int>` instantiates vector, not 'vector<int>').
          const lt3 = typeName.indexOf("<")
          if (lt3 !== -1) typeName = typeName.slice(0, lt3)
          // CPPD6 (M37.9 fmt probe, gtest.h/gmock.h): macro-mangled
          // new_expression recovery fabricates garbage constructed-type
          // targets (`(static_cast`, `typename Derived::template
          // gmock_Impl`, `(&locale_)`) from ERROR-region node soup. A real
          // constructed type is a clean identifier (optionally namespace-
          // qualified before template stripping) — anything else is a
          // recovery artifact and emits no edge (the C-wave CGD19 class).
          // ≡ /^[A-Za-z_]\w*$/ — full-string identifier shape: first char a
          // letter/underscore, every later char word-class. \w ≡ [A-Za-z0-9_]
          // in non-unicode mode, which is how this file's regexes run.
          if (this.isPlainIdentifier(typeName)) {
            const source = parentContext?.name || "global"
            relationships.push({
              source,
              target: typeName,
              fromSymbol: source,
              toSymbol: typeNode.text,
              type: ASTEngine.RelationshipType.Instantiates,
              confidence: typeNode.hasError ? 0.6 : 1.0,
              // M59.A7 (#825): the constructed type's own node names this edge —
              // `new` and its type can sit on different lines. Same value in the
              // #873 mirror, 1-based.
              line_number: this.nodeLine(typeNode),
              metadata: { line: this.nodeLine(typeNode), isNew: true },
            })
          }
        }
      } else if (type === "identifier") {
        // CP1 (cpp review): bare value reads. The analyzer previously
        // emitted NO bare-identifier edges at all (`return g;` produced
        // zero relationships) while the oracle only audited calls and
        // member reads — a both-sides blind spot. Every bare identifier
        // naming a file-visible VALUE is a Uses edge (C family contract),
        // with the C family's exclusion discipline:
        // declaration positions (leftmost-declarator rule), call callees
        // (calls branch owns them), member leaves (field path owns them),
        // qualified reads (limitation), preprocessor text (CGD11), labels,
        // attributes, lambda-capture bindings — and shadowing suppression
        // via function locals/params. Resolvability is required: unknown
        // names stay silent (no junk edges to std/external names).
        const p = node.parent
        // Lambda capture binding (`[z = g]`: z binds, g reads).
        if (p && p.type === "lambda_capture_initializer" && p.namedChild(0)?.startIndex === node.startIndex) {
          const fnScope = enclosingFunctionScope()
          if (fnScope) {
            if (!fnScope.locals) fnScope.locals = new Set<string>()
            fnScope.locals.add(node.text)
          }
        } else if (isDeclarationPosition(node) && !isFunctionOwnName(node)) {
          // Declaring occurrences bind locals in walk order (flow-sensitive
          // like the C family) — lambda/catch params, local struct members,
          // enumerators. The defined function NAME itself never binds
          // (self-shadow would eat same-named overload reads; oracle parity).
          const fnScope = enclosingFunctionScope()
          if (fnScope) {
            let inFnBody = false
            let cur2: Node | null = p
            while (cur2) {
              if (cur2.type === "function_definition") { inFnBody = true; break }
              if (cur2.type === "class_specifier" || cur2.type === "struct_specifier" ||
                  cur2.type === "union_specifier") break
              cur2 = cur2.parent
            }
            if (inFnBody) {
              if (!fnScope.locals) fnScope.locals = new Set<string>()
              fnScope.locals.add(node.text)
            }
          }
        } else if (
          node.text &&
          !isDeclarationPosition(node) &&          !isPreprocText(node) &&
          // Assignment LHS is a WRITE, never a read (C CGD1 / family
          // write-is-not-a-use contract — plain and compound assignments
          // both carry the LHS as first named child).
          !((p && p.type === "assignment_expression") &&
            p.namedChild(0)?.startIndex === node.startIndex &&
            (p.namedChild(0)?.endIndex ?? 0) >= node.endIndex) &&
          // Call callee (span-matched like C CGD17, climbing through
          // template/dependent/parenthesized wrappers like the calls
          // branch's calleeLeaf) — the calls branch owns it.
          !isCallCallee(node) &&
          // Member leaves — the field path owns them (both read and call
          // positions). The OBJECT of a field access is a genuine read and
          // stays (CGD31 contract): only the field-role leaf is skipped.
          !(p && p.type === "field_expression" &&
            p.childForFieldName("field")?.startIndex === node.startIndex) &&
          // Qualified reads (`ns::x`) — limitation, stays silent.
          !hasQualifiedAncestor(node) &&
          // Labels and attributes never name values.
          !(p && (p.type === "goto_statement" || p.type === "labeled_statement")) &&
          !hasAttributeAncestor(node)
        ) {
          const fnScope = enclosingFunctionScope()
          const shadowed = !!fnScope?.locals?.has(node.text)
          if (!shadowed && isResolvableRead(node.text)) {
            const source = parentContext?.name || "global"
            const relKey = `${source}::uses::${node.text}`
            if (!usesSeen.has(relKey)) {
              usesSeen.add(relKey)
              relationships.push({
                source,
                target: node.text,
                type: ASTEngine.RelationshipType.Uses,
                confidence: 1.0,
                line_number: this.nodeLine(node),
                metadata: { relationshipType: "identifier_usage", nodeType: node.type },
              })
            }
          }
        }
      }

      if (pushedScope) {
        stack.push({ node, parentContext: newContext, isExit: true })
      }

      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) {
          stack.push({ node: child, parentContext: newContext })
        }
      }
    }

    // Populate exports for file-scope public symbols
    // M49 JVM-closure exports invariant (F3 gate in run-fixtures.ts): export
    // names must be UNIQUE and resolve to top-level symbols. The old
    // class-scope member branch emitted methods/ctors (duplicate `run`/
    // `log`/`constructor` across classes; `operator()` payloads) — the
    // member half is removed; membership rides Contains. Members of anonymous
    // (unnamed-namespace) constructs are likewise dropped.
    const seenExportNames = new Set<string>()
    for (const sym of symbols) {
      if (!sym.ownerName && !sym.ownerKind) {
        // File-scope: global namespace
        const isPrivate = sym.visibility === "private" || sym.isStatic
        if (!isPrivate && !sym.name.startsWith("anonymous") && !seenExportNames.has(sym.name)) {
          seenExportNames.add(sym.name)
          exports.push({
            name: sym.name,
            kind: sym.kind,
            range: sym.range,
            visibility: sym.visibility || "public",
          })
        }
      }
    }

    // POST-LOOP override resolution: every class and virtual is known now.
    // Resolves transitively (A->B->C) with a depth cap.
    {
      const resolves = (startCls: string, method: string, params: string): string[] => {
        const found: string[] = []
        const seen = new Set<string>()
        const queue = [startCls]
        let depth = 0
        while (queue.length && depth < 10) {
          depth++
          const cls = queue.shift()!
          if (seen.has(cls)) continue
          seen.add(cls)
          for (const base of classBases.get(cls) ?? []) {
            // CROSS-FILE BASE COLLISION GUARD: `class format_facet : public
            // fmt::format_facet<std::locale>` leaf-cleans to a base named
            // `format_facet` — identical to the class's own name. Resolving it
            // against the in-file registry (which holds the class's OWN
            // methods) fabricates a self-override (`format_facet.do_put ->
            // format_facet.do_put`). A class cannot inherit from itself, so any
            // base equal to the start class is a cross-file name collision and
            // must be skipped, not resolved.
            if (base === startCls) continue
            const baseSigs = classVirtuals.get(base)
            // SIGNATURE-AWARE: a same-name DIFFERENT-parameter overload is
            // C++ name-hiding, not virtual dispatch. CPPD11: the registry is
            // now a per-name LIST of signatures — any matching signature is a
            // real virtual override.
            if (baseSigs && (baseSigs.get(method) ?? []).includes(params)) found.push(base)
            queue.push(base)
          }
        }
        return found
      }
      // CPPD11: overloads whose sigs all override the same base collapse to
      // the same (cls.method, base.method) pair under the no-arity edge model
      // — emit each pair once.
      const seenOv = new Set<string>()
      for (const pend of pendingOverrides) {
        for (const base of resolves(pend.cls, pend.method, pend.params)) {
          const k = `${pend.cls}.${pend.method}|${base}.${pend.method}`
          if (seenOv.has(k)) continue
          seenOv.add(k)
          relationships.push({
            source: `${pend.cls}.${pend.method}`,
            target: `${base}.${pend.method}`,
            type: ASTEngine.RelationshipType.Overrides,
            confidence: 0.9,
            // M59.A7 (#825): the overriding method's own declaration site (the
            // pending record carries the line captured where the method was
            // walked — a post-loop resolution has no node to ask).
            line_number: pend.line,
            metadata: { isVirtualOverride: true, reasonCode: "signature-match" },
          })
        }
      }
    }

    // Post-loop: add contains for owned symbols (class→method, class→field, namespace→class)
    for (const s of symbols) {
      const _owner = s.ownerName || s.scope
      if (_owner) {
        relationships.push({
          source: _owner,
          target: s.name,
          type: ASTEngine.RelationshipType.Contains,
          confidence: 1.0,
          // M59.A7 (#825), the C lane's rule: a contains edge takes the CHILD's
          // own line, so it can never disagree with the symbol range it mirrors.
          line_number: s.range?.startLine,
          metadata: {},
        })
      }
    }



    // Dedupe direct-attached qualified_calls per symbol (a method calling the
    // same target twice must list it once — the old Set-merge did this).
    for (const sym of symbols) {
      if (Array.isArray(sym.qualified_calls) && sym.qualified_calls.length > 1) {
        sym.qualified_calls = [...new Set(sym.qualified_calls)]
      }
    }

    // #419-D evidence tiers on EVERY edge (family classifier).
    this.classifyEvidenceTier(relationships)

    return {
      symbols,
      relationships,
      imports,
      exports,
      errors,
      metadata: {
        linesOfCode: content.split("\n").length,
        cyclomaticComplexity: 1 + fileDecisions,
        complexity: 1 + fileDecisions,
        patterns: (() => { const arr: string[] = []; for (const p in patterns) arr.push(p); return arr; })(),
        detectedFrameworks: (() => { const arr: string[] = []; for (const f in frameworks) arr.push(f); return arr; })(),
        memorySafetyScore,
      },
    }
  }

  // CP2 (cpp review): test/macro function shapes — `TEST(suite, name)
  // {...}`, `BOOST_AUTO_TEST_CASE(x) {...}` parse as function_definitions
  // whose declarator params are BARE identifiers (macro paste-tokens, no
  // types). Minting a `TEST` Function symbol per site (11 in one file) and
  // resolving reads against it fabricates API + edges for a preprocessor
  // fiction (C-D2: no macro expansion). Detection: ALL-CAPS declarator
  // name + a non-empty parameter list in which NO parameter carries a type
  // node. Real functions always type their params (`void f()`/`f(void)`
  // have empty/void lists and are kept); ALL-CAPS real functions with
  // typed params (`WINAPI Foo(int)`) are kept.
  private isMacroFunctionShape(node: Node, funcName: string): boolean {
    if (!this.isAllCapsName(funcName)) return false
    const decl = this.findChild(node, "function_declarator")
    if (!decl) return false
    const params = decl.childForFieldName("parameters")
    if (!params || params.namedChildCount === 0) return false
    for (let i = 0; i < params.namedChildCount; i++) {
      const p = params.namedChild(i)
      if (!p) continue
      if (p.type === "comment") continue
      if (this.paramHasType(p)) return false
    }
    return true
  }

  // #915: a bare top-level macro must not become a `variable`. Two consecutive
  // macros at file scope are recovered by the grammar as a `declaration` whose
  // "type" is itself a macro and whose terminator is MISSING
  // (`FMT_END_EXPORT` / `FMT_END_NAMESPACE` -> type_identifier + identifier +
  // MISSING `;`), and the declaration branch then names the symbol after the
  // second macro. Measured on fmt: 13 such phantoms in a 58-file draw, all bare
  // ALL-CAPS macro names (`variable FMT_END_NAMESPACE` x8, `GTEST_ATTRIBUTE_UNUSED_`
  // x2, `RUN_ALL_TESTS`, `GTEST_DEFAULT_DEATH_TEST_STYLE`, `FMT_BEGIN_EXPORT`),
  // and 0 on nlohmann-json. This is the BARE sibling of the call-shaped class
  // `isMacroFunctionShape` already suppresses.
  //
  // Three conditions, each doing real work — the first two alone would lose a
  // real symbol:
  //   * the name is ALL-CAPS            (`MAX_SIZE` stays a symbol, `MAX_SIZE;`)
  //   * the node is ERROR-RECOVERED     (a clean `MyType MAX_SIZE;` is kept,
  //                                      because its terminator is real; only
  //                                      already-broken code is affected)
  //   * it carries NO hard type         (`int MAX_SIZE` and
  //                                      `MyType *MAX_SIZE` are kept — a lone
  //                                      `type_identifier` is the grammar's
  //                                      classification of macro soup, not a type,
  //                                      the same reading `paramHasType` uses)
  private isBareMacroDeclaration(node: Node, name: string): boolean {
    if (!this.isAllCapsName(name)) return false

    let recovered = false
    const walkRecovered: Node[] = [node]
    while (walkRecovered.length > 0) {
      const m = walkRecovered.pop()!
      if (m.isMissing || m.isError) {
        recovered = true
        break
      }
      for (let i = 0; i < m.childCount; i++) {
        const c = m.child(i)
        if (c) walkRecovered.push(c)
      }
    }
    if (!recovered) return false

    const walkType: Node[] = [node]
    while (walkType.length > 0) {
      const m = walkType.pop()!
      if (
        m.type === "primitive_type" || m.type === "sized_type_specifier" ||
        m.type === "template_type" || m.type === "qualified_identifier" ||
        m.type === "dependent_type" || m.type === "decltype" ||
        m.type === "struct_specifier" || m.type === "union_specifier" ||
        m.type === "enum_specifier" || m.type === "class_specifier" ||
        m.type === "placeholder_type_specifier" || m.type === "macro_prefixed_type_specifier"
      ) {
        return false
      }
      for (let i = 0; i < m.childCount; i++) {
        const c = m.child(i)
        if (c) walkType.push(c)
      }
    }
    return true
  }

  private isAllCapsName(name: string): boolean {
    let hasUpper = false
    for (let i = 0; i < name.length; i++) {
      const c = name[i]
      if (c >= "a" && c <= "z") return false
      if (c >= "A" && c <= "Z") hasUpper = true
    }
    return hasUpper
  }

  private paramHasType(param: Node): boolean {
    // A parameter is typed iff it carries an unambiguous type node
    // (primitive/sized/template/qualified/typename/decltype/struct/union/
    // enum) or a type_identifier BESIDE a distinct declarator identifier
    // (`MyClass x`). A LONE type_identifier is the grammar's classification
    // of a bare macro-soup name (`TEST(a, b)` → type_identifier(a)) — NOT a
    // type. Accepted residual: `void F(T)` (all-caps, single abstract
    // type_identifier param) misreads as macro — near-nonexistent in real
    // code, and both sides skip identically so no edge pair can result.
    let sawHardType = false
    let sawTypeIdent = false
    let sawNameIdent = false
    const stack: Node[] = [param]
    while (stack.length > 0) {
      const m = stack.pop()!
      if (
        m.type === "primitive_type" || m.type === "sized_type_specifier" ||
        m.type === "template_type" || m.type === "qualified_identifier" ||
        m.type === "dependent_type" || m.type === "decltype" ||
        m.type === "struct_specifier" || m.type === "union_specifier" ||
        m.type === "enum_specifier"
      ) {
        sawHardType = true
        break
      }
      if (m.type === "type_identifier") sawTypeIdent = true
      if (m.type === "identifier" || m.type === "field_identifier") sawNameIdent = true
      for (let i = 0; i < m.namedChildCount; i++) {
        const c = m.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return sawHardType || (sawTypeIdent && sawNameIdent)
  }

  private buildParamSig(parametersNode: Node | null): string {
    // CPPD5 (M37.9 fmt probe, gtest.h): parameter TYPE-ONLY signature. Each
    // parameter_declaration's name lives in its trailing `declarator` field;
    // the TYPE is the parameter text minus that declarator. Names, comments
    // (`/*test_info*/`), and whitespace never enter the signature — matching
    // real C++ overload semantics where only the types discriminate.
    if (!parametersNode) return ""
    const parts: string[] = []
    for (let i = 0; i < parametersNode.namedChildCount; i++) {
      const pc = parametersNode.namedChild(i)
      if (!pc) continue
      if (pc.type === "comment") continue
      if (pc.type === "optional_parameter_declaration") {
        // `= default` / `= expr` after the type — the DEFAULT is not part of
        // the signature either; the type text precedes the `=` assignment.
        let t = pc.text
        const eq = t.indexOf("=")
        if (eq !== -1) t = t.slice(0, eq).trim()
        const d2 = pc.childForFieldName?.("declarator")
        if (d2) t = t.slice(0, t.length - d2.text.length).trim()
        if (t) parts.push(t)
        continue
      }
      if (pc.type !== "parameter_declaration") {
        // variadic_parameter (`...`) or stray nodes: include raw text.
        if (pc.text) parts.push(pc.text)
        continue
      }
      let t = pc.text
      const d = pc.childForFieldName?.("declarator")
      if (d) t = t.slice(0, t.length - d.text.length).trim()
      if (t) parts.push(t)
    }
    return parts.join(",")
  }

  private methodComplexityCpp(node: Node): number {
    // T1 family contract: 1 + decision points (branch constructs +
    // short-circuit operators; else adds nothing).
    const decisionTypes = new Set([
      "if_statement", "for_statement", "while_statement", "do_statement",
      "case_statement", "catch_clause", "conditional_expression",
    ])
    let c = 1
    const st: Node[] = [node]
    while (st.length) {
      const n = st.pop()!
      if (decisionTypes.has(n.type)) c++
      else if (n.type === "binary_expression") {
        const op = n.childForFieldName("operator")?.text
        if (op === "&&" || op === "||") c++
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const ch = n.namedChild(i)
        if (ch) st.push(ch)
      }
    }
    return c
  }

  /**
   * #419-D - evidence-tier classification for EVERY emitted relationship
   * (same rules as the JVM/web family).
   */
  private classifyEvidenceTier(relationships: ASTEngine.UniversalRelationship[]): void {
    for (const r of relationships) {
      const md = r.metadata ?? (r.metadata = {})
      if (md.evidenceClass) continue
      const t = String(r.type ?? "")
      const conf = typeof r.confidence === "number" ? r.confidence : 1
      if (t === "contains" || t === "exports") { md.evidenceClass = "structural"; continue }
      if (t === "references") { md.evidenceClass = md.isImport ? "import_based" : "reference_qualified"; continue }
      if (t === "extends" || t === "implements" || t === "overrides") {
        md.evidenceClass = conf >= 1 ? "structural" : conf >= 0.85 ? "usage_contextual" : "inferred"
        continue
      }
      if (t === "instantiates") { md.evidenceClass = "structural"; continue }
      md.evidenceClass = "usage_contextual"
    }
  }

  /**
   * M59.A7 (#825): the line of the node that NAMES a relationship, 1-based, or
   * `undefined` when the site is not attributable — never a fabricated 0 and
   * never an enclosing declaration's line. The C lane carries the identical
   * helper; the contract is "call-site line or NULL" (M59.O2).
   */
  private nodeLine(node: Node | null | undefined): number | undefined {
    if (!node || !node.startPosition || typeof node.startPosition.row !== "number") return undefined
    return node.startPosition.row + 1
  }

  /**
   * M59.A7 (#825): a type expression's start is not the line of the names inside
   * it. A specifier starts at its KEYWORD, and a wrapped declaration puts the
   * name on the following line:
   *
   *   struct          <- the specifier's start
   *   Bigint {        <- where the name is written
   *
   * The grammar's `name` field is the site when it exists; otherwise the node is.
   * (Mirror of the C lane's `nameLine`.)
   */
  private nameLine(node: Node | null | undefined): number | undefined {
    if (!node) return undefined
    const nameField =
      typeof (node as any).childForFieldName === "function" ? node.childForFieldName("name") : null
    return this.nodeLine(nameField ?? node)
  }

  private nodeToRange(node: Node) {
    return {
      startLine: node.startPosition.row + 1,
      startColumn: node.startPosition.column + 1,
      endLine: node.endPosition.row + 1,
      endColumn: node.endPosition.column + 1,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    }
  }

  private findChild(node: Node, type: string, text?: string): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === type) {
        if (text === undefined || child.text === text) return child
      }
    }
    return null
  }

  private findAllChildren(node: Node, type: string): Node[] {
    const res: Node[] = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === type) res.push(child)
    }
    return res
  }

  private childText(node: Node, type: string): string | null {
    const child = this.findChild(node, type)
    return child ? child.text : null
  }

  private hasDirectModifier(node: Node, modifier: string): boolean {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (!child) continue
      if (child.text === modifier) return true
      if (
        (child.type === "type_qualifier" ||
          child.type === "storage_class_specifier" ||
          child.type === "virtual_specifier") &&
        child.text === modifier
      ) {
        return true
      }
    }
    // Also check inside function_declarator for virtual_specifier (override keyword)
    const funcDecl = this.findChild(node, "function_declarator")
    if (funcDecl) {
      for (let i = 0; i < funcDecl.childCount; i++) {
        const child = funcDecl.child(i)
        if (child?.type === "virtual_specifier" && child.text === modifier) return true
      }
    }
    return false
  }

  private getFunctionDetails(
    node: Node,
  ): { name: string; scope?: string; isDestructor: boolean; isOperator: boolean } | null {
    let decl = this.findChild(node, "function_declarator")
    if (!decl) {
      const ptr = this.findChild(node, "pointer_declarator") || this.findChild(node, "reference_declarator")
      if (ptr) decl = this.findChild(ptr, "function_declarator")
    }

    if (!decl) return null

    let nameNode =
      this.findChild(decl, "identifier") ||
      this.findChild(decl, "field_identifier") ||
      this.findChild(decl, "destructor_name") ||
      this.findChild(decl, "operator_name") ||
      this.findChild(decl, "qualified_identifier")

    if (!nameNode) return null

    let name = nameNode.text
    let scope: string | undefined = undefined
    let isDestructor = nameNode.type === "destructor_name" || name.startsWith("~")
    let isOperator = nameNode.type === "operator_name" || name.startsWith("operator")

    if (nameNode.type === "qualified_identifier") {
      // `ConsoleLogger::log` parses as qualified_identifier[namespace_identifier,
      // identifier]. The scope is the FIRST named child (namespace/type/class),
      // the method name is the LAST named child. Checking `identifier` before
      // `namespace_identifier` wrongly grabs the method name as the scope
      // (constructor:log in log) — so inspect in the right order.
      const actualNameNode = nameNode.namedChild(nameNode.namedChildCount - 1)
      // CP7 (second review): nested qualification (`Outer::Inner::m`)
      // nests RIGHT-leaning as qid[ns Outer, qid[ns Inner, m]] — the owning
      // scope is the INNERMOST qualifier (`Inner`). The old code read the
      // outermost qualifier's full text (`Outer`, and the oracle took the
      // outermost segment too), so neither side matched the `Inner`-keyed
      // member registry and bare member reads in nested out-of-line bodies
      // stayed silent on both sides. Descend to the deepest qualifier,
      // then read its scope child with the same rules as below. (The
      // method NAME computation above is untouched.)
      let scopeQid: Node = nameNode
      while (true) {
        const last = scopeQid.namedChild(scopeQid.namedChildCount - 1)
        if (last && last.type === "qualified_identifier") scopeQid = last
        else break
      }
      let scopeNode: Node | null = null
      for (let i = 0; i < scopeQid.namedChildCount - 1; i++) {
        const c = scopeQid.namedChild(i)
        if (c && (c.type === "namespace_identifier" || c.type === "type_identifier" || c.type === "identifier")) {
          scopeNode = c
          break
        }
        // `Registry<T>::add` — the scope is a template_type (`Registry<T>`);
        // use its underlying type name so template method definitions resolve
        // their owner correctly (instead of leaking to the namespace).
        if (c && c.type === "template_type") {
          const tname = c.childForFieldName("name") || this.findChild(c, "type_identifier")
          if (tname) {
            scopeNode = tname
            break
          }
        }
      }
      // Defensive fallback (unreachable after the descent above — the
      // deepest qualifier's first child is always a scope leaf): keep the
      // scope empty rather than guessing.
      const firstChild = scopeQid.namedChild(0)
      if (!scopeNode && firstChild && firstChild.type === "qualified_identifier") {
        scopeNode = firstChild
      }

      if (actualNameNode) {
        name = actualNameNode.text
        if (scopeNode) scope = scopeNode.text
        if (actualNameNode.type === "destructor_name" || name.startsWith("~")) isDestructor = true
        if (actualNameNode.type === "operator_name" || name.startsWith("operator")) isOperator = true
      }
    }

    return { name, scope, isDestructor, isOperator }
  }

  // ≡ /^[A-Za-z_]\w*$/ (zero-regex helper, M49 closure wave) — full-string
  // identifier shape: letter/underscore head, word-class tail. CGD19 class:
  // recovery-artifact type names (qualified, templated, mangled) fail this
  // and emit no edge.
  private isPlainIdentifier(s: string): boolean {
    if (s.length === 0) return false
    const c0 = s.charCodeAt(0)
    const firstOk = (c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122) || c0 === 95
    if (!firstOk) return false
    for (let i = 1; i < s.length; i++) {
      const c = s.charCodeAt(i)
      const ok = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95
      if (!ok) return false
    }
    return true
  }

  private buildFullName(scopeStack: any[], name: string): string {
    const parts: string[] = []
    for (let i = 0; i < scopeStack.length; i++) {
      if (scopeStack[i].kind === ASTEngine.SymbolKind.Namespace) {
        parts.push(scopeStack[i].name)
      }
    }
    parts.push(name)
    return parts.join("::")
  }
}
