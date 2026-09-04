import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

// ============================================================================
// PHP BUILTINS — global functions filtered from call relationships.
// Method calls (member/scoped/nullsafe) are NOT filtered: they are user code
// like `$obj->persist()`, whose leaf targets the scripting-family contract
// emits. This list covers the common core/extension globals that would
// otherwise flood every file with self-evident call edges.
// ============================================================================
export const PHP_BUILTINS = new Set([
  // String
  "strlen", "strpos", "stripos", "strrpos", "strstr", "stristr", "substr",
  "str_replace", "str_ireplace", "strtolower", "strtoupper", "ucfirst", "lcfirst",
  "ucwords", "trim", "ltrim", "rtrim", "explode", "implode", "join", "str_split",
  "str_repeat", "str_pad", "sprintf", "vsprintf", "printf", "number_format",
  "htmlspecialchars", "htmlentities", "html_entity_decode", "addslashes",
  "stripslashes", "nl2br", "wordwrap", "strval", "intval", "floatval", "boolval",
  "chr", "ord", "strrev", "strcmp", "strcasecmp", "strncmp", "substr_count",
  "str_contains", "str_starts_with", "str_ends_with", "parse_str",
  // Array
  "count", "sizeof", "array", "array_merge", "array_merge_recursive", "array_keys",
  "array_values", "array_flip", "array_reverse", "array_push", "array_pop",
  "array_shift", "array_unshift", "array_map", "array_filter", "array_reduce",
  "array_walk", "array_slice", "array_splice", "array_search", "array_key_exists",
  "in_array", "array_unique", "array_combine", "array_column", "range", "sort",
  "rsort", "asort", "arsort", "ksort", "krsort", "usort", "uasort", "uksort",
  "compact", "extract", "list", "end", "reset", "next", "prev", "current", "key",
  "array_sum", "array_product", "array_rand", "array_chunk", "array_pad",
  "array_fill", "array_fill_keys", "array_diff", "array_intersect", "array_replace",
  // Type / var
  "is_array", "is_string", "is_int", "is_integer", "is_float", "is_double",
  "is_bool", "is_object", "is_callable", "is_null", "is_numeric", "is_scalar",
  "is_resource", "is_iterable", "is_countable", "gettype", "settype", "get_class",
  "get_parent_class", "method_exists", "property_exists", "class_exists",
  "interface_exists", "trait_exists", "function_exists", "enum_exists",
  "instanceof", "get_class_methods", "get_class_vars", "get_object_vars",
  "get_debug_type", "get_mangled_object_vars", "var_dump", "var_export",
  "print_r", "debug_zval_dump", "serialize", "unserialize", "json_encode",
  "json_decode", "json_last_error", "json_last_error_msg", "is_a", "is_subclass_of",
  // Math / misc
  "abs", "min", "max", "round", "floor", "ceil", "pow", "sqrt", "rand", "mt_rand",
  "srand", "mt_srand", "number_format", "intdiv", "fmod", "exp", "log", "log10",
  "pi", "getrandmax", "mt_getrandmax",
  // Control / filesystem / errors
  "defined", "define", "constant", "exit", "die", "eval", "assert", "trigger_error",
  "error_log", "set_error_handler", "set_exception_handler", "file_exists",
  "file_get_contents", "file_put_contents", "fopen", "fclose", "fread", "fwrite",
  "fgets", "file", "dirname", "basename", "realpath", "is_file", "is_dir", "mkdir",
  "rmdir", "unlink", "rename", "copy", "glob", "scandir", "chdir", "getcwd",
  "touch", "chmod", "chown", "filemtime", "filesize", "tempnam", "sys_get_temp_dir",
  // String interop helpers
  "preg_match", "preg_match_all", "preg_replace", "preg_replace_callback",
  "preg_split", "preg_quote", "preg_grep", "preg_last_error", "preg_last_error_msg",
])

// Type-hint node kinds (parameter and return types).
const TYPE_NODES = new Set([
  "primitive_type", "named_type", "optional_type", "union_type",
  "intersection_type", "nullable_type", "type",
])

// ============================================================================
// MAIN ANALYZER
// ============================================================================
export class RealPhpAnalyzer implements ASTEngine.LanguageAnalyzer {
  // class name -> declared base class (leaf name), populated as class
  // declarations are encountered; consumed by processObjectCreation to
  // resolve `new parent()` to the superclass.
  private baseByClass = new Map<string, string>()

  analyze(
    rootNode: Node,
    content: string,
    filePath: string,
    context?: ASTEngine.AnalyzeContext,
  ): ASTEngine.ParseResult {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    // Per-file resolution state: `new parent()` maps to the base declared in
    // THIS file. Cross-file inheritance is not resolved (honest no-edge).
    this.baseByClass = new Map()
    const imports: ASTEngine.ImportInfo[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const errors: ASTEngine.ParseError[] = []
    const detectedFrameworks = new Set<string>()
    const patterns = new Set<string>()

    if (!rootNode) {
      return this.result(symbols, relationships, imports, exports, errors, content, rootNode, detectedFrameworks, patterns)
    }

    // --- Error collection ---
    if (rootNode.hasError) {
      const errStack: Node[] = [rootNode]
      while (errStack.length > 0) {
        const n = errStack.pop()!
        if (n.type === "ERROR" || n.isMissing) {
          errors.push({
            message: `Syntax ${n.type} detected.`,
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

    // ========================================================================
    // EXTRACTIVE WALK — iterative stack, single pass
    // ========================================================================
    type Frame = {
      node: Node
      owner: string | undefined
      ownerKind: string | undefined
      ns: string | undefined
      inFunction: string | undefined
    }
    const stack: Frame[] = [{ node: rootNode, owner: undefined, ownerKind: undefined, ns: undefined, inFunction: undefined }]

    while (stack.length > 0) {
      const { node, owner, ownerKind, ns, inFunction } = stack.pop()!
      const type = node.type

      if (type === "namespace_definition") {
        const nameNode = this.findChildByType(node, "namespace_name")
        const nsName = nameNode?.text
        if (nsName) {
          symbols.push({
            name: nsName,
            kind: ASTEngine.SymbolKind.Namespace,
            range: this.nodeToRange(node),
            visibility: "public",
            metadata: { phpSpecific: true },
          })
          patterns.add("Namespaces")
          this.detectFramework(nsName, detectedFrameworks)
        }
        // Namespace applies to subsequent top-level declarations.
        for (let i = node.namedChildCount - 1; i >= 0; i--) {
          const child = node.namedChild(i)
          if (child) stack.push({ node: child, owner: undefined, ownerKind: undefined, ns: nsName, inFunction: undefined })
        }
        continue
      }

      if (type === "class_declaration") {
        const nameNode = this.findChildByType(node, "name")
        const className = nameNode ? nameNode.text : `anonymous_class_${node.startIndex}`
        const baseClause = this.findChildByType(node, "base_clause")
        const baseName = baseClause ? this.leafName(baseClause.namedChild(0)?.text ?? "") : undefined
        const interfaces: string[] = []
        const ifaceClause = this.findChildByType(node, "class_interface_clause")
        if (ifaceClause) {
          for (let i = 0; i < ifaceClause.namedChildCount; i++) {
            const iface = ifaceClause.namedChild(i)
            if (!iface) continue
            const ifaceName = iface.text
            interfaces.push(this.leafName(ifaceName))
            relationships.push({
              source: className,
              target: this.leafName(ifaceName),
              type: ASTEngine.RelationshipType.Implements,
              confidence: 1.0,
              metadata: { phpSpecific: true },
            })
          }
        }

        const modifiers = this.extractModifiers(node)
        symbols.push({
          name: className,
          kind: ASTEngine.SymbolKind.Class,
          range: this.nodeToRange(node),
          visibility: "public",
          isAbstract: modifiers.includes("abstract"),
          isStatic: modifiers.includes("static"),
          metadata: {
            phpSpecific: true,
            fqn: ns ? `${ns}\\${className}` : className,
            namespace: ns,
            baseClass: baseName,
            interfaces,
            isFinal: modifiers.includes("final"),
            isAnonymous: false,
          },
        })

        if (baseName) {
          relationships.push({
            source: className,
            target: baseName,
            type: ASTEngine.RelationshipType.Extends,
            confidence: 1.0,
            metadata: { phpSpecific: true },
          })
          // For `new parent()` resolution: map class -> declared base class
          // (leaf name). Registered at declaration time so any `new parent`
          // inside this class's methods (walked later from the same stack)
          // resolves to the base, not to the class itself.
          this.baseByClass.set(className, baseName)
        }
        if (className.endsWith("Controller")) patterns.add("MVC Architecture (Controllers)")
        if (className.endsWith("Service")) patterns.add("Service Layer Pattern")
        this.detectFramework(ns ?? "", detectedFrameworks)

        const body = this.findChildByType(node, "declaration_list")
        if (body) {
          this.pushMembers(body, stack, className, "class", ns)
        }
        continue
      }

      if (type === "interface_declaration") {
        const nameNode = this.findChildByType(node, "name")
        if (!nameNode) continue
        const ifaceName = nameNode.text
        // Pinned grammar: interface inheritance is a base_clause ("extends
        // BaseRepo, AnotherInterface") — probe-verified 2026-08-30.
        // 'interface_base_clause' was a dead literal from an older grammar.
        const baseClause = this.findChildByType(node, "base_clause")
        const extended: string[] = []
        if (baseClause) {
          for (let i = 0; i < baseClause.namedChildCount; i++) {
            const parent = baseClause.namedChild(i)
            if (!parent) continue
            const parentName = this.leafName(parent.text)
            extended.push(parentName)
            relationships.push({
              source: ifaceName,
              target: parentName,
              type: ASTEngine.RelationshipType.Extends,
              confidence: 1.0,
              metadata: { phpSpecific: true },
            })
          }
        }
        symbols.push({
          name: ifaceName,
          kind: ASTEngine.SymbolKind.Interface,
          range: this.nodeToRange(node),
          visibility: "public",
          metadata: { phpSpecific: true, fqn: ns ? `${ns}\\${ifaceName}` : ifaceName, namespace: ns, extendedInterfaces: extended },
        })
        const body = this.findChildByType(node, "declaration_list")
        if (body) this.pushMembers(body, stack, ifaceName, "interface", ns)
        continue
      }

      if (type === "trait_declaration") {
        const nameNode = this.findChildByType(node, "name")
        if (!nameNode) continue
        const traitName = nameNode.text
        symbols.push({
          name: traitName,
          kind: ASTEngine.SymbolKind.Trait,
          range: this.nodeToRange(node),
          visibility: "public",
          metadata: { phpSpecific: true, isTrait: true, fqn: ns ? `${ns}\\${traitName}` : traitName, namespace: ns },
        })
        const body = this.findChildByType(node, "declaration_list")
        if (body) this.pushMembers(body, stack, traitName, "trait", ns)
        continue
      }

      if (type === "enum_declaration") {
        const nameNode = this.findChildByType(node, "name")
        if (!nameNode) continue
        const enumName = nameNode.text
        symbols.push({
          name: enumName,
          kind: ASTEngine.SymbolKind.Enum,
          range: this.nodeToRange(node),
          visibility: "public",
          metadata: { phpSpecific: true, fqn: ns ? `${ns}\\${enumName}` : enumName, namespace: ns },
        })
        const list = this.findChildByType(node, "enum_declaration_list")
        if (list) {
          for (let i = 0; i < list.namedChildCount; i++) {
            const child = list.namedChild(i)
            if (child) stack.push({ node: child, owner: enumName, ownerKind: "enum", ns, inFunction: undefined })
          }
        }
        continue
      }

      if (type === "enum_case") {
        const nameNode = this.findChildByType(node, "name")
        if (nameNode && owner) {
          symbols.push({
            name: nameNode.text,
            kind: ASTEngine.SymbolKind.EnumMember,
            range: this.nodeToRange(node),
            ownerName: owner,
            ownerKind: ownerKind as any,
            visibility: "public",
            metadata: { phpSpecific: true },
          })
        }
        continue
      }

      if (type === "function_definition") {
        const nameNode = node.childForFieldName("name")
        if (!nameNode) continue
        const fnName = nameNode.text
        const parameters = this.extractParameters(node)
        const returnType = this.extractReturnType(node)
        symbols.push({
          name: fnName,
          kind: ASTEngine.SymbolKind.Function,
          range: this.nodeToRange(node),
          visibility: "public",
          parameters,
          returnType,
          // Per-symbol cyclomatic complexity (managed-OO family contract).
          complexity: this.calculateNodeComplexity(node),
          metadata: { phpSpecific: true, fqn: ns ? `${ns}\\${fnName}` : fnName, namespace: ns },
        })
        const body = node.childForFieldName("body")
        if (body) this.walkBody(body, symbols, relationships, imports, owner, ns, fnName, detectedFrameworks, patterns)
        continue
      }

      if (type === "method_declaration") {
        const nameNode = node.childForFieldName("name")
        if (!nameNode) continue
        const methodName = nameNode.text
        const modifiers = this.extractModifiers(node)
        let visibility = "public"
        if (modifiers.includes("private")) visibility = "private"
        else if (modifiers.includes("protected")) visibility = "protected"
        const parameters = this.extractParameters(node)
        const returnType = this.extractReturnType(node)
        symbols.push({
          name: methodName,
          kind: ASTEngine.SymbolKind.Method,
          range: this.nodeToRange(node),
          ownerName: owner,
          ownerKind: owner ? (ownerKind as any) : undefined,
          visibility,
          isStatic: modifiers.includes("static"),
          isAbstract: modifiers.includes("abstract"),
          parameters,
          returnType,
          // Per-symbol cyclomatic complexity (managed-OO family contract —
          // csharp/dart/swift/objc #264–#267). Same node set as the file-level
          // counter, scoped to this method's subtree; base 1.
          complexity: this.calculateNodeComplexity(node),
          metadata: {
            phpSpecific: true,
            isMethod: true,
            isMagicMethod: methodName.startsWith("__"),
            isFinal: modifiers.includes("final"),
          },
        })
        // Property promotion: constructor params with a visibility modifier are
        // also declared properties of the class.
        this.extractPromotedProperties(node, owner, ownerKind, symbols)
        if (methodName.startsWith("__")) patterns.add("Magic Methods")
        const body = node.childForFieldName("body")
        if (body) this.walkBody(body, symbols, relationships, imports, owner, ns, methodName, detectedFrameworks, patterns)
        continue
      }

      if (type === "property_declaration") {
        const modifiers = this.extractModifiers(node)
        let visibility = "public"
        if (modifiers.includes("private")) visibility = "private"
        else if (modifiers.includes("protected")) visibility = "protected"
        const propertyType = this.findTypeChild(node)?.text
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i)
          if (!child || child.type !== "property_element") continue
          const varNode = this.findChildByType(child, "variable_name")
          if (!varNode) continue
          symbols.push({
            name: this.variableBareName(varNode),
            kind: ASTEngine.SymbolKind.Property,
            range: this.nodeToRange(varNode),
            ownerName: owner,
            ownerKind: owner ? (ownerKind as any) : undefined,
            visibility,
            isStatic: modifiers.includes("static"),
            returnType: propertyType,
            metadata: { phpSpecific: true },
          })
        }
        continue
      }

      if (type === "const_declaration") {
        const modifiers = this.extractModifiers(node)
        let visibility = "public"
        if (modifiers.includes("private")) visibility = "private"
        else if (modifiers.includes("protected")) visibility = "protected"
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i)
          if (!child || child.type !== "const_element") continue
          const nameNode = this.findChildByType(child, "name")
          if (!nameNode) continue
          symbols.push({
            name: nameNode.text,
            kind: ASTEngine.SymbolKind.Constant,
            range: this.nodeToRange(nameNode),
            ownerName: owner,
            ownerKind: owner ? (ownerKind as any) : undefined,
            visibility: owner ? visibility : "public",
            metadata: { phpSpecific: true, isConstant: true },
          })
        }
        continue
      }

      if (type === "use_declaration") {
        // Trait use inside a class/interface/trait body.
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i)
          if (!child || (child.type !== "name" && child.type !== "qualified_name")) continue
          const traitName = this.leafName(child.text)
          relationships.push({
            source: owner || "global",
            target: traitName,
            type: ASTEngine.RelationshipType.Uses,
            confidence: 1.0,
            metadata: { phpSpecific: true, isTraitUse: true },
          })
          patterns.add("Trait Composition (Mixins)")
        }
        continue
      }

      if (type === "namespace_use_declaration") {
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i)
          // Pinned grammar: use-declaration clauses are namespace_use_clause
          // ("use App\Models\User;", "use X as Y;", "use function f;") —
          // probe-verified 2026-08-30. 'use_clause' was a dead literal.
          if (!child || child.type !== "namespace_use_clause") continue
          let fqn = ""
          let alias: string | undefined
          for (let j = 0; j < child.namedChildCount; j++) {
            const part = child.namedChild(j)
            if (!part) continue
            if (part.type === "name" || part.type === "qualified_name") {
              if (!fqn) fqn = part.text
              else alias = part.text
            }
          }
          if (!fqn) continue
          const leaf = this.leafName(fqn)
          imports.push({
            module: fqn,
            items: [alias || leaf],
            isDefaultImport: true,
            range: this.nodeToRange(child),
            metadata: { phpSpecific: true, aliased: !!alias },
          })
          this.detectFramework(fqn, detectedFrameworks)
        }
        continue
      }

      if (type === "require_once_expression" || type === "include_once_expression" ||
          type === "require_expression" || type === "include_expression") {
        this.emitInclude(node, imports, relationships, ns)
        continue
      }

      // --- Top-level statement wrapper (e.g. `require_once ...;` is wrapped in
      // an expression_statement at the program level).
      if (type === "expression_statement") {
        for (let i = node.namedChildCount - 1; i >= 0; i--) {
          const child = node.namedChild(i)
          if (child) stack.push({ node: child, owner, ownerKind, ns, inFunction })
        }
        continue
      }

      // --- Program root: forward children ---
      if (type === "program") {
        for (let i = node.namedChildCount - 1; i >= 0; i--) {
          const child = node.namedChild(i)
          if (child) stack.push({ node: child, owner, ownerKind, ns, inFunction })
        }
        continue
      }
    }

    // --- Override relationships (implicit PHP overrides) ---
    this.resolveOverrides(symbols, relationships, context)

    // --- Contains relationships from ownerName ---
    for (const s of symbols) {
      if (s.ownerName) {
        relationships.push({
          source: s.ownerName,
          target: s.name,
          type: ASTEngine.RelationshipType.Contains,
          confidence: 1.0,
          metadata: { isContained: true },
        })
      }
    }

    if (symbols.some((s) => s.kind === ASTEngine.SymbolKind.Class || s.kind === ASTEngine.SymbolKind.Interface)) {
      patterns.add("Object-Oriented Programming")
    }

    return this.result(symbols, relationships, imports, exports, errors, content, rootNode, detectedFrameworks, patterns)
  }

  // ========================================================================
  // BODY WALKER — call expressions inside a function/method body
  // ========================================================================
  private walkBody(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    imports: ASTEngine.ImportInfo[],
    owner: string | undefined,
    ns: string | undefined,
    inFunction: string | undefined,
    detectedFrameworks: Set<string>,
    patterns: Set<string>,
  ): void {
    const stack: Array<{ n: Node; parent: Node | null }> = [{ n: node, parent: null }]
    while (stack.length > 0) {
      const { n, parent } = stack.pop()!
      const type = n.type

      if (type === "function_call_expression") {
        this.processFunctionCall(n, relationships, owner, ns, inFunction, detectedFrameworks, patterns)
      } else if (type === "member_call_expression" || type === "nullsafe_member_call_expression") {
        this.processMethodCall(n, relationships, inFunction)
      } else if (type === "scoped_call_expression") {
        this.processScopedCall(n, relationships, inFunction)
      } else if (type === "object_creation_expression") {
        this.processObjectCreation(n, relationships, owner, inFunction)
      } else if (type === "require_once_expression" || type === "include_once_expression" ||
                 type === "require_expression" || type === "include_expression") {
        this.emitInclude(n, imports, relationships, ns)
      } else if (type === "member_access_expression") {
        // Member READS (managed-OO family contract — dart/swift/objc emit
        // uses for property reads). `$this->balance`, `$obj->name`,
        // `$this->svc->inner` parse as member_access_expression with a
        // "name" field (probe-verified 2026-08-30). Emit uses -> the field
        // name for READS only: a member_access that is the FIRST child of
        // an assignment_expression is a WRITE (never a read); a
        // member_call_expression receiver is a call target, not a read.
        // Pure AST (parent node carried in the walk), never source text
        // scanning.
        // Node wrappers are re-created per call in web-tree-sitter, so
        // identity (===) never holds — compare by byte range instead.
        const lhs = parent ? parent.namedChild(0) : null
        const isWrite = parent && parent.type === "assignment_expression" && lhs && lhs.startIndex === n.startIndex && lhs.endIndex === n.endIndex
        const isCallReceiver = parent && (parent.type === "member_call_expression" || parent.type === "nullsafe_member_call_expression")
        if (!isWrite && !isCallReceiver) {
          const nameNode = n.childForFieldName("name")
          const member = nameNode ?? (n.namedChildCount > 0 ? n.namedChild(n.namedChildCount - 1) : null)
          if (member && member.text && !member.text.startsWith("$")) {
            relationships.push({
              source: inFunction || "global",
              target: member.text,
              type: ASTEngine.RelationshipType.Uses,
              confidence: 0.9,
              metadata: { phpSpecific: true, isMemberRead: true },
            })
          }
        }
      }

      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const child = n.namedChild(i)
        if (child) stack.push({ n: child, parent: n })
      }
    }
  }

  private processFunctionCall(
    node: Node,
    relationships: ASTEngine.UniversalRelationship[],
    _owner: string | undefined,
    _ns: string | undefined,
    inFunction: string | undefined,
    detectedFrameworks: Set<string>,
    patterns: Set<string>,
  ): void {
    const nameNode = node.childForFieldName("function")
    const callName = nameNode?.text
    if (!callName) return
    if (callName === "add_action" || callName === "add_filter") {
      detectedFrameworks.add("WordPress")
      patterns.add("Event-Driven Architecture (WP Hooks)")
      return
    }
    if (PHP_BUILTINS.has(callName)) return
    relationships.push({
      source: inFunction || "global",
      target: callName,
      type: ASTEngine.RelationshipType.Calls,
      confidence: 0.9,
      metadata: { phpSpecific: true },
    })
  }

  private processMethodCall(
    node: Node,
    relationships: ASTEngine.UniversalRelationship[],
    inFunction: string | undefined,
  ): void {
    const nameNode = node.childForFieldName("name")
    const methodName = nameNode?.text
    if (!methodName) return
    relationships.push({
      source: inFunction || "global",
      target: methodName,
      type: ASTEngine.RelationshipType.Calls,
      confidence: 0.9,
      metadata: { phpSpecific: true },
    })
  }

  private processScopedCall(
    node: Node,
    relationships: ASTEngine.UniversalRelationship[],
    inFunction: string | undefined,
  ): void {
    const nameNode = node.childForFieldName("name")
    const methodName = nameNode?.text
    if (!methodName) return
    relationships.push({
      source: inFunction || "global",
      target: methodName,
      type: ASTEngine.RelationshipType.Calls,
      confidence: 0.9,
      metadata: { phpSpecific: true },
    })
  }

  private processObjectCreation(
    node: Node,
    relationships: ASTEngine.UniversalRelationship[],
    owner: string | undefined,
    inFunction: string | undefined,
  ): void {
    // object_creation_expression has no named field for the type; the first
    // named child is the class/interface name (or relative_scope for new self).
    let target: string | undefined
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue
      if (child.type === "name" || child.type === "qualified_name") {
        // Probe-verified 2026-09-01 (pinned grammar): `new self()/parent()/static()`
        // parses as object_creation_expression > name — relative_scope never
        // appears for these. PHP semantics:
        //   self   -> the enclosing class (compile-time class of the method)
        //   static -> late static binding; statically best-effort = owner
        //   parent -> the DECLARED base class of owner. Unresolvable (no base,
        //             or owner is not a class) emits NOTHING — a wrong edge
        //             is worse than no edge.
        if (child.text === "self" || child.text === "static" || child.text === "parent") {
          if (child.text === "parent") {
            target = owner ? this.baseByClass.get(owner) : undefined
          } else {
            target = owner
          }
        } else {
          target = this.leafName(child.text)
        }
        break
      }
      if (child.type === "relative_scope") {
        // new self / new static / new parent (PHP semantics):
        //   self   -> the enclosing class (compile-time class of the method)
        //   static -> late static binding; statically best-effort = owner
        //   parent -> the DECLARED base class of owner. Unresolvable (owner
        //             has no base, or owner is not a class) emits NOTHING —
        //             a wrong edge is worse than no edge.
        if (child.text === "parent") {
          target = owner ? this.baseByClass.get(owner) : undefined
        } else {
          target = owner
        }
        break
      }
    }
    if (!target) return
    relationships.push({
      source: inFunction || "global",
      target,
      type: ASTEngine.RelationshipType.Instantiates,
      confidence: 0.9,
      metadata: { phpSpecific: true, isNew: true },
    })
  }

  // ========================================================================
  // HELPERS
  // ========================================================================

  private pushMembers(
    body: Node,
    stack: { node: Node; owner: string | undefined; ownerKind: string | undefined; ns: string | undefined; inFunction: string | undefined }[],
    owner: string,
    ownerKind: string,
    ns: string | undefined,
  ): void {
    for (let i = body.namedChildCount - 1; i >= 0; i--) {
      const child = body.namedChild(i)
      if (child) stack.push({ node: child, owner, ownerKind, ns, inFunction: undefined })
    }
  }

  private resolveOverrides(
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    context?: ASTEngine.AnalyzeContext,
  ): void {
    const baseByClass = new Map<string, string>()
    for (const s of symbols) {
      if (s.kind === ASTEngine.SymbolKind.Class && s.metadata?.baseClass) {
        baseByClass.set(s.name, this.leafName(String(s.metadata.baseClass)))
      }
    }
    const methodsByOwner = new Map<string, Set<string>>()
    for (const s of symbols) {
      if (s.kind !== ASTEngine.SymbolKind.Method || !s.ownerName) continue
      let names = methodsByOwner.get(s.ownerName)
      if (!names) {
        names = new Set<string>()
        methodsByOwner.set(s.ownerName, names)
      }
      names.add(s.name)
    }
    for (const s of symbols) {
      if (s.kind !== ASTEngine.SymbolKind.Method || !s.ownerName) continue
      const base = baseByClass.get(s.ownerName)
      if (!base) continue
      const baseMethods = methodsByOwner.get(base) ?? context?.overrideCompanion?.get(base)
      if (baseMethods?.has(s.name)) {
        relationships.push({
          source: `${s.ownerName}.${s.name}`,
          target: `${base}.${s.name}`,
          type: ASTEngine.RelationshipType.Overrides,
          confidence: 0.95,
          metadata: { phpSpecific: true, isOverride: true },
        })
      }
    }
  }

  private extractParameters(node: Node): ASTEngine.Parameter[] {
    const paramsList = node.childForFieldName("parameters")
    if (!paramsList) return []
    const params: ASTEngine.Parameter[] = []
    for (let i = 0; i < paramsList.namedChildCount; i++) {
      const child = paramsList.namedChild(i)
      if (!child) continue
      if (child.type !== "simple_parameter" && child.type !== "variadic_parameter" &&
          child.type !== "property_promotion_parameter") continue
      const varNode = child.childForFieldName("name") || this.findChildByType(child, "variable_name")
      if (!varNode) continue
      const name = this.variableBareName(varNode)
      if (!name) continue
      const typeNode = child.childForFieldName("type") || this.findTypeChild(child)
      const defaultValue = this.findDefaultValue(child, varNode)
      params.push({
        name,
        type: typeNode?.text,
        defaultValue,
        isOptional: defaultValue !== undefined || child.type === "property_promotion_parameter",
      })
    }
    return params
  }

  private extractPromotedProperties(
    node: Node,
    owner: string | undefined,
    ownerKind: string | undefined,
    symbols: ASTEngine.UniversalSymbol[],
  ): void {
    const paramsList = node.childForFieldName("parameters")
    if (!paramsList || !owner) return
    for (let i = 0; i < paramsList.namedChildCount; i++) {
      const child = paramsList.namedChild(i)
      if (!child || child.type !== "property_promotion_parameter") continue
      const varNode = child.childForFieldName("name") || this.findChildByType(child, "variable_name")
      if (!varNode) continue
      const modifiers = this.extractModifiers(child)
      let visibility = "public"
      if (modifiers.includes("private")) visibility = "private"
      else if (modifiers.includes("protected")) visibility = "protected"
      symbols.push({
        name: this.variableBareName(varNode),
        kind: ASTEngine.SymbolKind.Property,
        range: this.nodeToRange(varNode),
        ownerName: owner,
        ownerKind: ownerKind as any,
        visibility,
        returnType: child.childForFieldName("type")?.text || this.findTypeChild(child)?.text,
        metadata: { phpSpecific: true, isPromoted: true },
      })
    }
  }

  private extractReturnType(node: Node): string | undefined {
    const returnNode = node.childForFieldName("return_type")
    return returnNode?.text || undefined
  }

  private findTypeChild(node: Node): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && TYPE_NODES.has(child.type)) return child
    }
    return null
  }

  private findDefaultValue(paramNode: Node, varNode: Node): string | undefined {
    for (let i = 0; i < paramNode.namedChildCount; i++) {
      const child = paramNode.namedChild(i)
      if (!child || child === varNode) continue
      if (TYPE_NODES.has(child.type) || child.type === "variable_name" || child.type === "name") continue
      return child.text
    }
    return undefined
  }

  private extractModifiers(node: Node): string[] {
    const mods: string[] = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type.endsWith("_modifier")) {
        mods.push(child.text.toLowerCase())
      }
    }
    return mods
  }

  private emitInclude(
    node: Node,
    imports: ASTEngine.ImportInfo[],
    relationships: ASTEngine.UniversalRelationship[],
    ns: string | undefined,
  ): void {
    const filePath = this.extractIncludePath(node)
    if (!filePath) return
    imports.push({
      module: filePath,
      items: ["*"],
      isDefaultImport: true,
      range: this.nodeToRange(node),
      metadata: { phpSpecific: true, includeType: node.type.replace("_expression", "") },
    })
    relationships.push({
      source: ns || "global",
      target: filePath,
      type: ASTEngine.RelationshipType.References,
      confidence: 0.9,
      metadata: { phpSpecific: true, includeType: node.type.replace("_expression", "") },
    })
  }

  private extractIncludePath(node: Node): string | undefined {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue
      if (child.type === "encapsed_string" || child.type === "string") {
        return this.cleanString(child.text)
      }
      if (child.type === "binary_expression") {
        // __DIR__ . '/helpers.php' → rebuild without whitespace
        return this.collapseWhitespace(child.text)
      }
      if (child.type === "name" || child.type === "qualified_name") {
        return child.text
      }
    }
    return undefined
  }

  private findChildByType(node: Node, type: string): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === type) return child
    }
    return null
  }

  /** Bare name from a variable_name node (its `name` child, else strip `$`). */
  private variableBareName(node: Node): string {
    const nameChild = this.findChildByType(node, "name")
    if (nameChild) return nameChild.text
    const t = node.text
    return t.startsWith("$") ? t.slice(1) : t
  }

  /** Leaf name from a possibly-qualified FQN like App\Base\BaseService. */
  private leafName(name: string): string {
    const idx = name.lastIndexOf("\\")
    return idx >= 0 ? name.substring(idx + 1) : name
  }

  /** Strip surrounding single/double quotes — pure char scan. */
  private cleanString(text: string): string {
    if (text.length >= 2) {
      const first = text.charCodeAt(0)
      const last = text.charCodeAt(text.length - 1)
      if ((first === 34 && last === 34) || (first === 39 && last === 39)) {
        return text.substring(1, text.length - 1)
      }
    }
    return text
  }

  /** Remove all whitespace — pure char scan (binary include expressions). */
  private collapseWhitespace(text: string): string {
    let out = ""
    for (let i = 0; i < text.length; i++) {
      const c = text[i]
      if (c !== " " && c !== "\t" && c !== "\n" && c !== "\r") out += c
    }
    return out
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

  private detectFramework(text: string, detectedFrameworks: Set<string>): void {
    if (text.includes("Illuminate\\") || text === "App\\") detectedFrameworks.add("Laravel")
    if (text.includes("Symfony\\")) detectedFrameworks.add("Symfony")
    if (text.startsWith("wp_") || text.includes("WordPress")) detectedFrameworks.add("WordPress")
    if (text.includes("Magento\\")) detectedFrameworks.add("Magento")
    if (text.includes("Drupal\\")) detectedFrameworks.add("Drupal")
    if (text.includes("PHPUnit\\Framework") || text === "TestCase") detectedFrameworks.add("PHPUnit")
    if (text.includes("Doctrine\\ORM")) detectedFrameworks.add("Doctrine")
  }

  private result(
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    imports: ASTEngine.ImportInfo[],
    exports: ASTEngine.ExportInfo[],
    errors: ASTEngine.ParseError[],
    content: string,
    rootNode: Node,
    detectedFrameworks: Set<string>,
    patterns: Set<string>,
  ): ASTEngine.ParseResult {
    // Evidence-tier classification (managed-OO family contract — swift/dart/
    // csharp/objc #264–#267 precedent; M14 section D requires >=2 distinct
    // evidenceClass values). structural (grammar clauses, conf 1.0) |
    // usage_contextual (calls, member reads, conf >= 0.85) | import_based
    // (import directives) | inferred (confidence < 1 non-call edges).
    this.classifyEvidenceTier(relationships)
    const frameworks = [...detectedFrameworks]
    const patternList = [...patterns]
    return {
      symbols,
      relationships,
      imports,
      exports,
      errors,
      metadata: {
        complexity: symbols.length + relationships.length,
        linesOfCode: content.split("\n").length,
        cyclomaticComplexity: this.calculateCyclomaticComplexity(rootNode),
        framework: frameworks[0],
        patterns: patternList,
        detectedFrameworks: frameworks,
        frameworkPatterns: frameworks.map((f) => ({
          framework: f,
          patterns: [{ type: "usage", detected: true, description: `${f} usage detected` }],
        })),
      },
    }
  }

  /**
   * Evidence-tier classification — same rules as the swift/dart/csharp/objc
   * family (see swift wave #266 for the full rationale).
   */
  private classifyEvidenceTier(relationships: ASTEngine.UniversalRelationship[]): void {
    for (const r of relationships) {
      const type = r.type ?? r.relationshipType ?? ""
      const md: any = r.metadata ?? {}
      if (type === "contains") { md.evidenceClass = "structural"; continue }
      if (type === "imports" || type === "exports" || type === "references") { md.evidenceClass = "import_based"; continue }
      if (type === "calls" || type === "uses") {
        md.evidenceClass = (r.confidence ?? 0) >= 0.85 ? "usage_contextual" : "inferred"
        continue
      }
      if (type === "instantiates" || type === "extends" || type === "implements") {
        md.evidenceClass = (r.confidence ?? 0) >= 0.9 ? "structural" : "inferred"
        continue
      }
      if (type === "overrides") { md.evidenceClass = "structural"; continue }
      md.evidenceClass = "usage_contextual"
    }
  }

  /**
   * Per-symbol cyclomatic complexity (managed-OO family contract — csharp
   * #264 wave precedent). Mirrors the file-level counter's node set exactly,
   * scoped to a single method/function subtree; base 1. Same decision nodes:
   * if/elseif/for/foreach/while/do/switch/match/try/catch/ternary +
   * short-circuit && || and or.
   */
  private calculateNodeComplexity(node: Node): number {
    if (!node) return 1
    let complexity = 1
    const stack: Node[] = [node]
    let guard = 0
    while (stack.length > 0 && guard++ < 200000) {
      const n = stack.pop()!
      switch (n.type) {
        case "if_statement":
        case "elseif_clause":
        case "for_statement":
        case "foreach_statement":
        case "while_statement":
        case "do_statement":
        case "switch_statement":
        case "match_expression":
        case "match_conditional_expression":
        case "try_statement":
        case "catch_clause":
        case "conditional_expression":
          complexity++
          break
        case "binary_expression": {
          let hasLogic = false
          for (let i = 0; i < n.childCount; i++) {
            const c = n.child(i)
            if (c && (c.type === "&&" || c.type === "||" || c.type === "and" || c.type === "or")) {
              hasLogic = true
              break
            }
          }
          if (hasLogic) complexity++
          break
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const child = n.namedChild(i)
        if (child) stack.push(child)
      }
    }
    return complexity
  }

  private calculateCyclomaticComplexity(rootNode: Node): number {
    if (!rootNode) return 1
    let complexity = 1
    const stack: Node[] = [rootNode]
    while (stack.length > 0) {
      const n = stack.pop()!
      switch (n.type) {
        case "if_statement":
        case "elseif_clause":
        case "for_statement":
        case "foreach_statement":
        case "while_statement":
        case "do_statement":
        case "switch_statement":
        case "match_expression":
        case "match_conditional_expression":
        case "try_statement":
        case "catch_clause":
        case "conditional_expression":
          complexity++
          break
        case "binary_expression": {
          let hasLogic = false
          for (let i = 0; i < n.childCount; i++) {
            const c = n.child(i)
            if (c && (c.type === "&&" || c.type === "||" || c.type === "and" || c.type === "or")) {
              hasLogic = true
              break
            }
          }
          if (hasLogic) complexity++
          break
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const child = n.namedChild(i)
        if (child) stack.push(child)
      }
    }
    return complexity
  }
}
