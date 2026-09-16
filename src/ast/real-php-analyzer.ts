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
// PHP VALUE SCOPE — persistent scope frames for bare-`$var` reads (PHP2).
// PHP scoping: file statements see file bindings; function/method bodies see
// params+locals+`global` imports (never file locals); closures see params+
// `use` (never the enclosing frame); arrow functions chain the enclosing
// frame (implicit capture); named nested functions start fresh. Universals
// (superglobals, top-level functions, consts, defines, use-imports) are
// visible everywhere. Frames are persistent (child snapshots parent) so no
// exit bookkeeping is needed on the iterative walks.
// ============================================================================
type PhpValueScope = {
  bound: Set<string>
  parent: PhpValueScope | null
}

function phpScopeHas(scope: PhpValueScope | null, name: string): boolean {
  let cur: PhpValueScope | null = scope
  while (cur) {
    if (cur.bound.has(name)) return true
    cur = cur.parent
  }
  return false
}

// Superglobals: ambient authority, bound in every scope (bare names here,
// without the `$` — variableBareName strips it before lookup).
const PHP_SUPERGLOBALS: ReadonlySet<string> = new Set([
  "_GET", "_POST", "_SERVER", "_COOKIE", "_SESSION", "_FILES", "_ENV",
  "_REQUEST", "GLOBALS", "argv", "argc",
])

// Magic constants: `name` nodes, never values (`__DIR__` etc. — boolean/
// null literals are dedicated node types and never reach the read rules).
const PHP_MAGIC_CONSTANTS: ReadonlySet<string> = new Set([
  "__DIR__", "__FILE__", "__LINE__", "__FUNCTION__", "__CLASS__",
  "__METHOD__", "__NAMESPACE__", "__TRAIT__",
])
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
      scope: PhpValueScope
    }
    // PHP2 file scope: prescanned top-level bindings (uniform — valid code
    // declares before use; hoisted functions resolve regardless of order).
    // Function/method/closure bodies do NOT inherit file locals (PHP
    // scoping); they consult funcValues/constValues/superglobals separately
    // (see read rules).
    const fileScope: PhpValueScope = { bound: new Set<string>(), parent: null }
    // Universals: visible in EVERY scope. funcValues (top-level function
    // names + use-function imports — PHP functions hoist) and constValues
    // (file consts + define() + use-const imports). Superglobals
    // (PHP_SUPERGLOBALS) are ambient in every frame lookup. File VARIABLES
    // live only in fileScope (functions never inherit them).
    const funcValues = new Set<string>()
    const constValues = new Set<string>()
    this.collectPhpFileScope(rootNode, fileScope.bound, funcValues, constValues)
    const stack: Frame[] = [{ node: rootNode, owner: undefined, ownerKind: undefined, ns: undefined, inFunction: undefined, scope: fileScope }]

    while (stack.length > 0) {
      const { node, owner, ownerKind, ns, inFunction, scope } = stack.pop()!
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
          if (child) stack.push({ node: child, owner: undefined, ownerKind: undefined, ns: nsName, inFunction: undefined, scope })
        }
        continue
      }

      if (type === "class_declaration") {
        const nameNode = this.findChildByType(node, "name")
        const className = nameNode ? nameNode.text : `anonymous_class_${node.startIndex}`
        const baseClause = this.findChildByType(node, "base_clause")
        // PHPD10: heritage target resolution — never fabricate a self-edge
        // when a qualified base/interface shares the class's leaf name.
        // heritageTarget returns the OWN name when qualification cannot
        // disambiguate (global single-segment base like \\RuntimeException):
        // emit NO extends for that unresolvable base.
        const rawBase = baseClause?.namedChild(0)?.text
        const baseName = baseClause ? this.heritageTarget(rawBase ?? "", className) : undefined
        const baseUnresolvable =
          !!rawBase && rawBase !== baseName && baseName === className
        const interfaces: string[] = []
        const ifaceClause = this.findChildByType(node, "class_interface_clause")
        if (ifaceClause) {
          for (let i = 0; i < ifaceClause.namedChildCount; i++) {
            const iface = ifaceClause.namedChild(i)
            if (!iface) continue
            const ifaceName = this.heritageTarget(iface.text, className)
            if (ifaceName === className && iface.text !== ifaceName) continue // unresolvable same-name interface
            interfaces.push(ifaceName)
            relationships.push({
              source: className,
              target: ifaceName,
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
            baseClass: baseUnresolvable ? undefined : baseName,
            interfaces,
            isFinal: modifiers.includes("final"),
            isAnonymous: false,
          },
        })

        if (baseName && !baseUnresolvable) {
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
          this.pushMembers(body, stack, className, "class", ns, scope)
        }
        this.pushNonBodyChildren(node, stack, undefined, undefined, ns, scope)
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
            // PHPD10: same-leaf qualified parents (`interface Exception
            // extends \PHPUnit\Exception`) must keep qualification — the leaf
            // would fabricate a self-extends. A qualified parent whose name
            // still equals the interface after disambiguation (global
            // single-segment, e.g. `interface Foo extends \Foo`) is
            // unresolvable in the leaf graph: skip it (no self-loop).
            const parentName = this.heritageTarget(parent.text, ifaceName)
            if (parentName === ifaceName && parent.text !== parentName) continue
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
        if (body) this.pushMembers(body, stack, ifaceName, "interface", ns, scope)
        this.pushNonBodyChildren(node, stack, undefined, undefined, ns, scope)
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
        if (body) this.pushMembers(body, stack, traitName, "trait", ns, scope)
        this.pushNonBodyChildren(node, stack, undefined, undefined, ns, scope)
        continue
      }

      if (type === "enum_declaration") {
        const nameNode = this.findChildByType(node, "name")
        if (!nameNode) continue
        const enumName = nameNode.text
        // M37.13: PHP 8.1 enums implement interfaces via the SAME
        // class_interface_clause shape classes use (`enum Status implements
        // Labeled`). Probe-verified: enum_declaration carries the clause; the
        // pre-M37.13 code never read it, silently dropping enum implements.
        const ifaceClause = this.findChildByType(node, "class_interface_clause")
        if (ifaceClause) {
          for (let i = 0; i < ifaceClause.namedChildCount; i++) {
            const iface = ifaceClause.namedChild(i)
            if (!iface) continue
            relationships.push({
              source: enumName,
              target: this.heritageTarget(iface.text, enumName),
              type: ASTEngine.RelationshipType.Implements,
              confidence: 1.0,
              metadata: { phpSpecific: true, isEnumImplements: true },
            })
          }
        }
        symbols.push({
          name: enumName,
          kind: ASTEngine.SymbolKind.Enum,
          range: this.nodeToRange(node),
          visibility: "public",
          metadata: { phpSpecific: true, fqn: ns ? `${ns}\\${enumName}` : enumName, namespace: ns, implementedInterfaces: ifaceClause ? Array.from({ length: ifaceClause.namedChildCount }, (_, i) => this.heritageTarget(ifaceClause.namedChild(i)?.text ?? "", enumName)).filter(Boolean) : [] },
        })
        const list = this.findChildByType(node, "enum_declaration_list")
        if (list) {
          for (let i = 0; i < list.namedChildCount; i++) {
            const child = list.namedChild(i)
            if (child) stack.push({ node: child, owner: enumName, ownerKind: "enum", ns, inFunction: undefined, scope })
          }
        }
        this.pushNonBodyChildren(node, stack, undefined, undefined, ns, scope)
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
        if (body) this.walkBody(body, symbols, relationships, imports, owner, ns, fnName, detectedFrameworks, patterns, { file: fileScope, funcValues, constValues })
        this.pushNonBodyChildren(node, stack, owner, ownerKind, ns, scope)
        continue
      }

      if (type === "method_declaration") {
        const nameNode = node.childForFieldName("name")
        if (!nameNode) continue
        const methodName = nameNode.text
        // M37.13 (dual-lens php): anonymous-class methods are reached only
        // through `new class { ... }` (owner undefined — a class body member
        // always carries its owner via pushMembers). The class has no nameable
        // symbol, so no method symbol / promoted-property is fabricated; the
        // body is still walked so calls/creations are not lost (mirrors
        // walkBody's treatment of anon classes nested inside named methods).
        if (!owner) {
          const body = node.childForFieldName("body")
          if (body) this.walkBody(body, symbols, relationships, imports, owner, ns, undefined, detectedFrameworks, patterns, { file: fileScope, funcValues, constValues })
          this.pushNonBodyChildren(node, stack, owner, ownerKind, ns, scope)
          continue
        }
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
        if (body) this.walkBody(body, symbols, relationships, imports, owner, ns, methodName, detectedFrameworks, patterns, { file: fileScope, funcValues, constValues })
        this.pushNonBodyChildren(node, stack, owner, ownerKind, ns, scope)
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
      }

      // --- Top-level call/creation dispatch (M37.13 procedural gap) ---
      // The call/creation processors used to live ONLY inside walkBody
      // (method/function bodies). Statements at program/namespace scope
      // (`$x = new App(); $app->run(); run_it(); echo fn();` — PHP scripts,
      // config/bootstrap files, WP/plugin hook files) were silently dropped
      // by the extractive walk, so procedural files emitted ZERO relationship
      // edges while the differential oracle (a generic walk) derived them
      // all. These dispatchers fire wherever a call/creation is reached
      // OUTSIDE a body; the generic fallback below descends every unmatched
      // statement/expression wrapper until it finds them (nested args,
      // chained member calls, assignments, closures). Member READS are
      // deliberately not dispatched here — the oracle derives uses for
      // member_access only inside method/function bodies (inBody), which the
      // extractive walk never reaches (walkBody owns bodies).
      if (type === "function_call_expression") {
        this.processFunctionCall(node, relationships, owner, ns, inFunction, detectedFrameworks, patterns)
      } else if (type === "member_call_expression" || type === "nullsafe_member_call_expression") {
        this.processMethodCall(node, relationships, inFunction)
      } else if (type === "scoped_call_expression") {
        this.processScopedCall(node, relationships, inFunction)
      } else if (type === "object_creation_expression") {
        this.processObjectCreation(node, relationships, owner, inFunction)
      }
      // PHP2: bare value reads outside bodies (file scope, field defaults,
      // const initializers, attributes). Closures/arrows at this level get
      // their frames below before children are pushed.
      // Read edges attribute to the innermost function, else the
      // enclosing class (trait-use precedent, PHP-O1), else file scope.
      const readSource = inFunction || owner || "global"
      if (type === "variable_name") {
        this.emitPhpVariableRead(node, node.parent, scope, { file: fileScope, funcValues, constValues }, readSource, relationships)
      } else if (type === "name") {
        this.emitPhpConstRead(node, node.parent, { file: fileScope, funcValues, constValues }, readSource, relationships)
      }
      // PHP2 scope boundaries at top/class level (closures/arrows assigned
      // or nested outside any body).
      let extScope = scope
      if (type === "anonymous_function") {
        const fresh: PhpValueScope = { bound: new Set<string>(), parent: null }
        this.collectPhpScopeBinds(node, fresh.bound)
        extScope = fresh
      } else if (type === "arrow_function") {
        const chained: PhpValueScope = { bound: new Set<string>(), parent: scope }
        this.collectPhpScopeBinds(node, chained.bound)
        extScope = chained
      }

      // --- Top-level statement wrapper (e.g. `require_once ...;` is wrapped in
      // an expression_statement at the program level).
      if (type === "expression_statement") {
        for (let i = node.namedChildCount - 1; i >= 0; i--) {
          const child = node.namedChild(i)
          if (child) stack.push({ node: child, owner, ownerKind, ns, inFunction, scope: extScope })
        }
        continue
      }

      // --- Program root: forward children ---
      if (type === "program") {
        for (let i = node.namedChildCount - 1; i >= 0; i--) {
          const child = node.namedChild(i)
          if (child) stack.push({ node: child, owner, ownerKind, ns, inFunction, scope: extScope })
        }
        continue
      }

      // --- Generic fallback: descend every unmatched node ---
      // The extractive walk previously DROPPED any node type it did not
      // match (no default recursion), which is precisely how procedural
      // statements, anonymous-class bodies, and deep expression trees fell
      // into the void. Symbol-bearing branches above all `continue`, so this
      // only re-descends statement/expression wrappers — mirroring the
      // oracle's generic walk.
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) stack.push({ node: child, owner, ownerKind, ns, inFunction, scope: extScope })
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
    scopeCtx: { file: PhpValueScope; funcValues: Set<string>; constValues: Set<string> },
  ): void {
    // PHP2 entry seed: the body's declaration params (methods, functions,
    // closures incl. `use`) — fresh frame, never chained (only arrows chain,
    // handled inline below).
    const seed: PhpValueScope = { bound: new Set<string>(), parent: null }
    this.collectPhpScopeBinds(node.parent, seed.bound)
    const stack: Array<{ n: Node; parent: Node | null; scope: PhpValueScope }> = [{ n: node, parent: null, scope: seed }]
    while (stack.length > 0) {
      const { n, parent, scope } = stack.pop()!
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
      } else if (type === "member_access_expression" || type === "nullsafe_member_access_expression") {
        // Member READS (managed-OO family contract — dart/swift/objc emit
        // uses for property reads). `$this->balance`, `$obj->name`,
        // `$this->svc->inner` parse as member_access_expression with a
        // "name" field (probe-verified 2026-08-30); PHP 8 nullsafe reads
        // `$this->svc?->name` parse as nullsafe_member_access_expression
        // with the SAME "name" field (master-review wave-2 probe
        // 2026-09-07) — both emit uses -> the field name. Emit uses for
        // READS only: a member_access that is the FIRST child of an
        // assignment_expression is a WRITE (never a read).
        // PHP-A (first review): the old isCallReceiver gate skipped the
        // receiver of a member call — but receivers ARE read (`$this->dep`
        // in `$this->dep->run()` must be evaluated to dispatch `run`; the
        // nullsafe chain already emitted its links, so plain chains were
        // inconsistently silent). Only the call's own NAME is the call
        // target (handled by the call branches, never as member_access).
        // SCD1 family parity (M37 #599 pre-wave follow-up): the pinned
        // grammar parses compound-assign as a DIFFERENT node —
        // augmented_assignment_expression ($this->count += $step) — so the
        // plain-assign gate leaked RMW writes as uses (probe-verified).
        // Both shapes are gated now.
        // Pure AST (parent node carried in the walk), never source text
        // scanning.
        // Node wrappers are re-created per call in web-tree-sitter, so
        // identity (===) never holds — compare by byte range instead.
        const lhs = parent ? parent.namedChild(0) : null
        const isWrite = parent && (parent.type === "assignment_expression" || parent.type === "augmented_assignment_expression") && lhs && lhs.startIndex === n.startIndex && lhs.endIndex === n.endIndex
        if (!isWrite) {
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
      } else if (type === "scoped_property_access_expression") {
        // PHP-H (first review): static property reads (`C::$total`,
        // `self::$x`, `parent::$x`, `static::$x`) parse as
        // scoped_property_access with a variable_name member — the scoped
        // CALLS (`C::create()`) were always covered, the READS never were.
        // Same write gate as member reads; the scope (type/relative_scope)
        // is never a value read.
        const lhs = parent ? parent.namedChild(0) : null
        const isWrite = parent && (parent.type === "assignment_expression" || parent.type === "augmented_assignment_expression") && lhs && lhs.startIndex === n.startIndex && lhs.endIndex === n.endIndex
        if (!isWrite) {
          const varNode = this.findChildByType(n, "variable_name")
          const member = varNode ? this.variableBareName(varNode) : undefined
          if (member) {
            relationships.push({
              source: inFunction || "global",
              target: member,
              type: ASTEngine.RelationshipType.Uses,
              confidence: 0.9,
              metadata: { phpSpecific: true, isMemberRead: true, isStaticRead: true },
            })
          }
        }
      } else if (type === "class_constant_access_expression") {        // PHP-D (first review): constant fetches (`Suit::Hearts`,
        // `parent::VERSION`, `C::MAX`) — the scoped CALLS were covered, the
        // constant READS never were (dart emits enum members the same way).
        // `::class` is a keyword, not a member — always skipped. The grammar
        // defines NO name field here — children are positional [scope, name],
        // so the constant is the LAST name child (the scope `Suit`/`C` is a
        // type, never a read).
        let member: string | undefined
        for (let i = n.namedChildCount - 1; i >= 0; i--) {
          const c = n.namedChild(i)
          if (c && c.type === "name") { member = c.text; break }
        }
        if (member && member.toLowerCase() !== "class") {
          relationships.push({
            source: inFunction || "global",
            target: member,
            type: ASTEngine.RelationshipType.Uses,
            confidence: 0.9,
            metadata: { phpSpecific: true, isMemberRead: true, isConstFetch: true },
          })
        }
      } else if (type === "variable_name" && parent && parent.type === "subscript_expression") {
        // PHP-B (first review): subscript bases (`$a['k']`, `$a[$k]`,
        // `$a['j'] = 5`) — an index operation presupposes a value (dart
        // DT-F parity). Only the FIRST named child (the base) reads; the
        // index is a bare value (review-2 inventory). Write-position bases
        // read the array address (OC-E parity).
        const first = parent.namedChild(0)
        if (first && first.startIndex === n.startIndex && first.endIndex === n.endIndex) {
          const base = this.variableBareName(n)
          if (base && base !== "this") {
            relationships.push({
              source: inFunction || "global",
              target: base,
              type: ASTEngine.RelationshipType.Uses,
              confidence: 0.9,
              metadata: { phpSpecific: true, isSubscriptBase: true },
            })
          }
        }
      } else if (type === "variable_name" && parent && parent.type === "anonymous_function_use_clause") {
        // PHP-C (first review): closure captures (`use ($factor)`) copy
        // outer values — every name in the clause is a genuine read.
        // Arrow-fn implicit captures need inventory (review 2).
        const base = this.variableBareName(n)
        if (base && base !== "this") {
          relationships.push({
            source: inFunction || "global",
            target: base,
            type: ASTEngine.RelationshipType.Uses,
            confidence: 0.9,
            metadata: { phpSpecific: true, isClosureCapture: true },
          })
        }
      } else if (type === "variable_name" && this.isInsideInterpolation(n)) {
        // PHP-F (first review): string interpolation reads (`"hello $name"`,
        // `"sum {$n}"`) — every variable inside an encapsed/dynamic string
        // is evaluated (dart DT-F blanket parity). `$this` is implicit.
        const base = this.variableBareName(n)
        if (base && base !== "this") {
          relationships.push({
            source: inFunction || "global",
            target: base,
            type: ASTEngine.RelationshipType.Uses,
            confidence: 0.9,
            metadata: { phpSpecific: true, isInterpolationRead: true },
          })
        }
      } else if (type === "name" && parent && parent.type === "dynamic_variable_name") {
        // PHP-F: `"${o}"` parses the variable as a bare name inside a
        // dynamic_variable_name — unambiguously a read there.
        const base = n.text
        if (base && base !== "this") {
          relationships.push({
            source: inFunction || "global",
            target: base,
            type: ASTEngine.RelationshipType.Uses,
            confidence: 0.9,
            metadata: { phpSpecific: true, isInterpolationRead: true },
          })
        }
      }

      // PHP2 scope boundaries: closures get fresh frames (params +
      // `use`), arrows chain the enclosing frame (implicit capture), named
      // nested functions start fresh (no capture).
      let childScope = scope
      if (type === "anonymous_function") {
        const fresh: PhpValueScope = { bound: new Set<string>(), parent: null }
        this.collectPhpScopeBinds(n, fresh.bound)
        childScope = fresh
      } else if (type === "arrow_function") {
        const chained: PhpValueScope = { bound: new Set<string>(), parent: scope }
        this.collectPhpScopeBinds(n, chained.bound)
        childScope = chained
      } else if (type === "function_definition" || type === "method_declaration") {
        const freshFn: PhpValueScope = { bound: new Set<string>(), parent: null }
        this.collectPhpScopeBinds(n, freshFn.bound)
        childScope = freshFn
      }
      // PHP2: bare value reads. variable_name positions resolve through the
      // scope chain, then file-scope functions, then superglobals; `name`
      // positions resolve through file consts only. $this never reads.
      // Declaration, write, label, member-link, callee and type positions
      // never read (mirrored exactly in the oracle).
      if (type === "variable_name") {
        this.emitPhpVariableRead(n, parent, scope, scopeCtx, inFunction || "global", relationships)
      } else if (type === "name") {
        this.emitPhpConstRead(n, parent, scopeCtx, inFunction || "global", relationships)
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const child = n.namedChild(i)
        if (child) stack.push({ n: child, parent: n, scope: childScope })
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
    // PHP-E (first review): first-class callable `foo(...)` never invokes —
    // the sole `...` argument creates a Closure. A tear-off references.
    if (this.isFirstClassTearOff(node)) {
      relationships.push({
        source: inFunction || "global",
        target: callName,
        type: ASTEngine.RelationshipType.Uses,
        confidence: 0.9,
        metadata: { phpSpecific: true, isTearOff: true },
      })
      return
    }
    relationships.push({
      source: inFunction || "global",
      target: callName,
      type: ASTEngine.RelationshipType.Calls,
      confidence: 0.9,
      metadata: { phpSpecific: true },
    })
  }

  /**
   * PHP-E: first-class callable syntax — the call's arguments consist solely
   * of the `...` placeholder (`$this->handler(...)`, `strlen(...)`,
   * `Widget::make(...)`). Mixed forms (`$f($x, ...)`) genuinely invoke (and
   * error-recover in the pinned grammar); only the sole-placeholder shape
   * is a non-invoking reference.
   */
  private isFirstClassTearOff(node: Node): boolean {
    const args = this.findChildByType(node, "arguments")
    if (!args) return false
    let sawPlaceholder = false
    for (let i = 0; i < args.namedChildCount; i++) {
      const c = args.namedChild(i)
      if (!c) continue
      if (c.type === "variadic_placeholder") {
        if (sawPlaceholder) return false
        sawPlaceholder = true
        continue
      }
      return false
    }
    return sawPlaceholder
  }

  private processMethodCall(
    node: Node,
    relationships: ASTEngine.UniversalRelationship[],
    inFunction: string | undefined,
  ): void {
    const nameNode = node.childForFieldName("name")
    const methodName = nameNode?.text
    if (!methodName) return
    // PHP-E: `$this->handler(...)` is a tear-off reference, never a call.
    if (this.isFirstClassTearOff(node)) {
      relationships.push({
        source: inFunction || "global",
        target: methodName,
        type: ASTEngine.RelationshipType.Uses,
        confidence: 0.9,
        metadata: { phpSpecific: true, isTearOff: true },
      })
      return
    }
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
    // PHP-E: `Widget::make(...)` is a tear-off reference, never a call.
    if (this.isFirstClassTearOff(node)) {
      relationships.push({
        source: inFunction || "global",
        target: methodName,
        type: ASTEngine.RelationshipType.Uses,
        confidence: 0.9,
        metadata: { phpSpecific: true, isTearOff: true },
      })
      return
    }
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

  /**
   * PHP2: push a declaration's non-body children (attributes, signatures)
   * for the extractive walk. Bodies belong to walkBody; heritage and names
   * belong to no value rule — but defaults, const initializers and
   * attribute arguments genuinely read (consts/globals via file frame).
   */
  private pushNonBodyChildren(
    node: Node,
    stack: { node: Node; owner: string | undefined; ownerKind: string | undefined; ns: string | undefined; inFunction: string | undefined; scope: PhpValueScope }[],
    owner: string | undefined,
    ownerKind: string | undefined,
    ns: string | undefined,
    scope: PhpValueScope,
  ): void {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (!c) continue
      if (c.type === "attribute_list" || c.type === "formal_parameters") {
        for (let j = c.namedChildCount - 1; j >= 0; j--) {
          const g = c.namedChild(j)
          if (g) stack.push({ node: g, owner, ownerKind, ns, inFunction: undefined, scope })
        }
      }
    }
  }

  private pushMembers(
    body: Node,
    stack: { node: Node; owner: string | undefined; ownerKind: string | undefined; ns: string | undefined; inFunction: string | undefined; scope: PhpValueScope }[],
    owner: string,
    ownerKind: string,
    ns: string | undefined,
    scope: PhpValueScope,
  ): void {
    for (let i = body.namedChildCount - 1; i >= 0; i--) {
      const child = body.namedChild(i)
      if (child) stack.push({ node: child, owner, ownerKind, ns, inFunction: undefined, scope })
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
        // PHPD10: metadata.baseClass already holds the heritage-resolved
        // target (qualified form kept when a same-leaf collision would
        // fabricate a self-edge). Re-leafing here would collapse the
        // qualified external base back onto the subclass name and re-create
        // the self-override — use it verbatim.
        baseByClass.set(s.name, String(s.metadata.baseClass))
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
      const inFileMethods = methodsByOwner.get(base)
      const baseMethods = inFileMethods ?? context?.overrideCompanion?.get(base)
      if (baseMethods?.has(s.name)) {
        relationships.push({
          source: `${s.ownerName}.${s.name}`,
          target: `${base}.${s.name}`,
          type: ASTEngine.RelationshipType.Overrides,
          confidence: 0.95,
          metadata: { phpSpecific: true, isOverride: true },
        })
      } else if (!inFileMethods && !context?.overrideCompanion?.get(base)) {
        // Pass 3 (family parity with java/groovy resolveOverrides): the base
        // is not declared in this file and the companion index gave no
        // opinion (it is never populated in production — see M37.10), so
        // declaring-parent verification is impossible. Emit the deterministic
        // first-parent guess BELOW the patterns.ts threshold (0.7): visible
        // in raw output, never contaminating thresholded analysis, and
        // counted as heuristic (honest suspicion) by the differential. The
        // pre-M37.10 behavior dropped the edge entirely when the base was
        // external — silently losing every cross-file override.
        relationships.push({
          source: `${s.ownerName}.${s.name}`,
          target: `${base}.${s.name}`,
          type: ASTEngine.RelationshipType.Overrides,
          confidence: 0.5,
          metadata: { phpSpecific: true, isOverride: true, reasonCode: "first-parent-guess" },
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
    // KAD2 sweep: `child === varNode` never matched fresh wrappers. The
    // type-based skips masked it, so this is hygiene over semantics — but
    // the guard must still WORK: span-based self-skip restores the intent
    // (e.g. a simple `= $x` shape would otherwise return the variable
    // itself as its own default).
    for (let i = 0; i < paramNode.namedChildCount; i++) {
      const child = paramNode.namedChild(i)
      if (!child) continue
      if (child.startIndex === varNode.startIndex && child.endIndex === varNode.endIndex) continue
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

  /**
   * PHP-F: bounded ancestor climb — is this node inside string
   * interpolation (encapsed_string / dynamic_variable_name)?
   */
  private isInsideInterpolation(n: Node): boolean {
    let p: Node | null | undefined = n.parent
    let guard = 0
    while (p && guard++ < 8) {
      if (p.type === "encapsed_string" || p.type === "dynamic_variable_name") return true
      // PHP bodies are compound_statement (function_body is not a node in
      // the pinned grammar) — interpolation never spans statements.
      if (p.type === "compound_statement" ||
          p.type === "class_declaration" || p.type === "program" ||
          p.type === "function_definition" || p.type === "method_declaration") return false
      p = p.parent
    }
    return false
  }

  /**
   * PHP2: bare `$var` value reads. Lookup order encodes PHP scoping:
   * frame chain (params/locals/use/catch/loop), then file functions, then
   * superglobals. `$this` never reads. Skips: declaration/write/label
   * positions (isPhpBindSite covers binds), member-link and callee
   * positions (pass-1 owns member calls/reads), subscript/use-clause/
   * interpolation interiors (pass-1 owns those unconditionally), and
   * property declarations (members, never locals).
   */
  private emitPhpVariableRead(
    n: Node,
    parent: Node | null,
    scope: PhpValueScope,
    scopeCtx: { file: PhpValueScope; funcValues: Set<string>; constValues: Set<string> },
    source: string,
    relationships: ASTEngine.UniversalRelationship[],
  ): void {
    const base = this.variableBareName(n);
    if (!base || base === "this") return
    const ptype = parent?.type ?? ""
    // Pass-1 owns use-clause/interpolation positions and declaring
    // positions bind, never read. Subscript BASES belong to the
    // unconditional subscript rule — but index expressions read.
    if (
      ptype === "property_declaration" || ptype === "property_element" ||
      ptype === "simple_parameter" || ptype === "variadic_parameter" ||
      ptype === "property_promotion_parameter" ||
      ptype === "anonymous_function_use_clause"
    ) {
      return
    }
    if (ptype === "subscript_expression" && parent) {
      const first = parent.namedChild(0)
      if (first && first.startIndex === n.startIndex && first.endIndex === n.endIndex) return
    }
    if (this.isPhpBindSite(n)) return
    if (this.isInsideInterpolation(n)) return
    // Call-callee variables read the callable (`$fn(n)`); every other
    // variable position reads the value when bound.
    if (phpScopeHas(scope, base)) {
      relationships.push({
        source,
        target: base,
        type: ASTEngine.RelationshipType.Uses,
        confidence: 0.9,
        metadata: { phpSpecific: true, isLocalRead: true },
      })
    } else if (scopeCtx.funcValues.has(base)) {
      relationships.push({
        source,
        target: base,
        type: ASTEngine.RelationshipType.Uses,
        confidence: 0.9,
        metadata: { phpSpecific: true, isGlobalRead: true },
      });
    } else if (PHP_SUPERGLOBALS.has(base)) {
      relationships.push({
        source,
        target: base,
        type: ASTEngine.RelationshipType.Uses,
        confidence: 0.9,
        metadata: { phpSpecific: true, isGlobalRead: true },
      });
    }
  }

  /**
   * PHP2: bare `NAME` constant reads (userland file consts, define(),
   * use-const imports). Magic constants never read; member/call/const-
   * fetch/heritage/label positions belong to other rules or nothing.
   */
  private emitPhpConstRead(
    n: Node,
    parent: Node | null,
    scopeCtx: { file: PhpValueScope; funcValues: Set<string>; constValues: Set<string> },
    source: string,
    relationships: ASTEngine.UniversalRelationship[],
  ): void {
    const txt = n.text
    if (!txt || PHP_MAGIC_CONSTANTS.has(txt)) return
    const ptype = parent?.type ?? ""
    if (
      ptype === "member_access_expression" || ptype === "nullsafe_member_access_expression" ||
      ptype === "class_constant_access_expression" ||
      ptype === "function_call_expression" || ptype === "scoped_call_expression" ||
      ptype === "member_call_expression" || ptype === "nullsafe_member_call_expression" ||
      ptype === "base_clause" || ptype === "class_interface_clause"
    ) {
      return
    }
    // Const-element declarations (`const FOO = BAR`): only the FIRST name
    // declares; values nested after `=` read.
    if (ptype === "const_element" && parent) {
      const first = parent.namedChild(0)
      if (first && first.startIndex === n.startIndex && first.endIndex === n.endIndex) return
    }
    // Named-argument labels (`cb:`) name, never read: this name is a
    // label iff the next raw sibling is ':'.
    if (ptype === "argument" && parent) {
      for (let i = 0; i < parent.childCount; i++) {
        const c = parent.child(i)
        if (c && c.isNamed && c.startIndex === n.startIndex && c.endIndex === n.endIndex) {
          const nx = parent.child(i + 1)
          if (nx && !nx.isNamed && nx.type === ":") return
          break
        }
      }
    }
    // Enum-case declarations (`case Hearts = 1`): only the FIRST name
    // declares; backing values read.
    if (ptype === "enum_case" && parent) {
      const first = parent.namedChild(0)
      if (first && first.startIndex === n.startIndex && first.endIndex === n.endIndex) return
    }
    if (ptype === "namespace_use_clause" || ptype === "namespace_name") return
    let a: Node | null | undefined = parent
    let g = 0
    while (a && g++ < 4) {
      if (a.type === "namespace_use_clause" || a.type === "namespace_definition") return
      if (a.type === "compound_statement" ||
          a.type === "class_declaration" || a.type === "program" ||
          a.type === "expression_statement") break
      a = a.parent
    }
    if (scopeCtx.constValues.has(txt)) {
      relationships.push({
        source,
        target: txt,
        type: ASTEngine.RelationshipType.Uses,
        confidence: 0.9,
        metadata: { phpSpecific: true, isConstRead: true },
      });
    }
  }

  /** Bare name from a variable_name node (its `name` child, else strip `$`). */
  private variableBareName(node: Node): string {
    const nameChild = this.findChildByType(node, "name")
    if (nameChild) return nameChild.text
    const t = node.text
    return t.startsWith("$") ? t.slice(1) : t
  }

  /**
   * PHP2: collect the names a scope node binds — parameters (simple/
   * formal/constructor), closure `use` vars, catch vars, loop vars,
   * static/global/destructuring declarations and assignment targets.
   * Declaration SITES bind; reads elsewhere resolve against the frame.
   * Pure AST, span-compared, never regex.
   */
  private collectPhpScopeBinds(node: Node | null, out: Set<string>): void {
    if (!node) return
    const t = node.type
    // Parameters: simple/formal/constructor/super (direct variable child).
    if (t === "simple_parameter" || t === "variadic_parameter" ||
        t === "property_promotion_parameter") {
      const v = this.findChildByType(node, "variable_name")
      if (v) {
        const nm = this.variableBareName(v)
        if (nm && nm !== "this") out.add(nm)
      }
      return
    }
    // Closure `use (...)` vars (direct variable children).
    if (t === "anonymous_function_use_clause") {
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i)
        if (c && c.type === "variable_name") {
          const nm = this.variableBareName(c)
          if (nm && nm !== "this") out.add(nm)
        }
      }
      return
    }
    // A declaration-ish subtree: walk it collecting binds.
    const stack: Node[] = [node]
    while (stack.length > 0) {
      const n = stack.pop()!
      const nt = n.type
      // Nested scopes bind their own frames — never leak outward.
      if (n !== node && (nt === "anonymous_function" || nt === "arrow_function" ||
          nt === "function_definition" || nt === "method_declaration")) {
        continue
      }
      if (nt === "variable_name" && this.isPhpBindSite(n)) {
        const nm = this.variableBareName(n)
        if (nm && nm !== "this") out.add(nm)
      }
      if (nt === "simple_parameter" || nt === "variadic_parameter" ||
          nt === "property_promotion_parameter") {
        const v = this.findChildByType(n, "variable_name")
        if (v) {
          const nm = this.variableBareName(v)
          if (nm && nm !== "this") out.add(nm)
        }
      }
      if (nt === "catch_clause") {
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && c.type === "variable_name") {
            const nm = this.variableBareName(c)
            if (nm && nm !== "this") out.add(nm)
          }
        }
      }
      if (nt === "anonymous_function_use_clause") {
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && c.type === "variable_name") {
            const nm = this.variableBareName(c)
            if (nm && nm !== "this") out.add(nm)
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
   * PHP2: is this variable occurrence a BINDING site (declaration, write
   * target, loop var, catch var, use var, destructuring element)?
   */
  private isPhpBindSite(n: Node): boolean {
    const parent = n.parent
    if (!parent) return false
    const pt = parent.type
    if (pt === "static_variable_declaration" || pt === "global_declaration") return true
    if (pt === "catch_clause") return true
    // Assignment LHS (plain `=` and compound — span-matched): `$x = ...`
    // binds; `pair()`-style values never sit here.
    if (pt === "assignment_expression") {
      const lhs = parent.namedChild(0)
      return !!lhs && lhs.startIndex <= n.startIndex && lhs.endIndex >= n.endIndex
    }
    // Destructuring LHS (`list($a,$b) = ...`, `[$a,$b] = ...`): the list
    // must sit inside an assignment LHS span.
    if (pt === "list_literal") {
      let a: Node | null | undefined = parent.parent
      let g = 0
      while (a && g++ < 4) {
        if (a.type === "assignment_expression") {
          const lhs = a.namedChild(0)
          return !!lhs && lhs.startIndex <= parent.startIndex && lhs.endIndex >= parent.endIndex
        }
        if (a.type === "expression_statement" || a.type === "compound_statement" ||
            a.type === "program") return false
        a = a.parent
      }
      return false
    }
    // foreach key/value (`as $k => $v` — pair under foreach).
    if (pt === "pair") {
      let a: Node | null | undefined = parent.parent
      let g = 0
      while (a && g++ < 4) {
        if (a.type === "foreach_statement") return true
        if (a.type === "compound_statement" || a.type === "program" ||
            a.type === "expression_statement") return false
        a = a.parent
      }
      return false
    }
    // Bare foreach value (`as $item` — variable directly under the
    // foreach; the collection is always the first named child and reads).
    if (pt === "foreach_statement") {
      const first = parent.namedChild(0)
      return !!first && (first.startIndex !== n.startIndex || first.endIndex !== n.endIndex)
    }
    return false
  }

  /**
   * PHP2: file-scope prescan — top-level value bindings (uniform: valid
   * code declares before use; hoisted functions resolve regardless).
   * Functions (all depths — nested named functions are global in PHP),
   * file consts, define() names, use function/const imports, top-level
   * variable binds. Class/interface/trait/enum bodies contribute nothing
   * (members are never bare values).
   */
  private collectPhpFileScope(rootNode: Node, out: Set<string>, funcValues: Set<string>, constValues: Set<string>): void {
    // Scopes bind their own frames — never descend for file bindings, with
    // two global-effect exceptions handled at visit time below (hoisted
    // function names, define()).
    const isScopeRoot = (t: string): boolean =>
      t === "function_definition" || t === "method_declaration" ||
      t === "anonymous_function" || t === "arrow_function" ||
      t === "class_declaration" || t === "interface_declaration" ||
      t === "trait_declaration" || t === "enum_declaration"
    const stack: Array<{ n: Node; fileLevel: boolean }> = [{ n: rootNode, fileLevel: true }]
    while (stack.length > 0) {
      const { n, fileLevel } = stack.pop()!
      const t = n.type
      // Global effects, visible everywhere regardless of nesting.
      if (t === "function_definition") {
        const nm = n.childForFieldName("name")
        if (nm) funcValues.add(nm.text)
      }
      if (t === "function_call_expression") {
        const fn = n.childForFieldName("function")
        if (fn && fn.text === "define") {
          const args = this.findChildByType(n, "arguments")
          if (args) {
            const first = args.namedChild(0)
            if (first) {
              const txt = first.text
              if ((txt.startsWith("'") || txt.startsWith('"')) && txt.length >= 2) {
                constValues.add(txt.slice(1, -1))
              }
            }
          }
        }
      }
      if (t === "namespace_use_clause") {
        let isFn = false
        let isConst = false
        let leaf: string | null = null
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i)
          if (!c) continue
          if (!c.isNamed && c.text === "function") isFn = true
          else if (!c.isNamed && c.text === "const") isConst = true
          if (c.isNamed && (c.type === "name" || c.type === "qualified_name")) {
            leaf = this.leafName(c.text)
          }
        }
        if (leaf && isFn) funcValues.add(leaf)
        else if (leaf && isConst) constValues.add(leaf)
      }
      // File-level const declarations bind globally.
      if (t === "const_declaration" && fileLevel) {
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && c.type === "const_element") {
            const nm = this.findChildByType(c, "name")
            if (nm) constValues.add(nm.text)
          }
        }
      }
      // File-level variable binds (declarations, assignments, loops...).
      if (fileLevel && !isScopeRoot(t)) {
        if (n.type === "variable_name" && this.isPhpBindSite(n)) {
          const nm = this.variableBareName(n)
          if (nm && nm !== "this") out.add(nm)
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (!c) continue
        stack.push({ n: c, fileLevel: fileLevel && !isScopeRoot(t) })
      }
    }
  }

  /** Leaf name from a possibly-qualified FQN like App\Base\BaseService. */
  private leafName(name: string): string {
    const idx = name.lastIndexOf("\\")
    return idx >= 0 ? name.substring(idx + 1) : name
  }

  /**
   * PHPD10 (M37.13): namespaced heritage target resolution.
   * A class may inherit from a DIFFERENT class that shares its leaf name in
   * another namespace (`class Setup\\FeaturesForm extends
   * \\PhpMyAdmin\\Config\\Forms\\User\\FeaturesForm` — phpmyadmin's Setup form
   * family). Leaf-collapsing the fully-qualified base fabricates SELF edges
   * (extends FeaturesForm->FeaturesForm, verified self-overrides at 0.95,
   * `new parent()` -> self): the leaf equals the subclass's own name, so
   * every in-file/companion check matches the class's OWN methods. When the
   * declared base/interface text is namespace-qualified AND its leaf equals
   * the declaring class's name, keep the qualification (leading \\ stripped)
   * so the external entity stays distinct from the in-file class. Bare
   * unqualified names and non-colliding qualified names keep the leaf
   * (unchanged behavior).
   *
   * A qualified name whose qualification does NOT disambiguate it
   * (single-segment global: `class InvalidArgumentException extends
   * \\InvalidArgumentException` — the SPL builtin, phpunit's exception
   * classes) returns the OWN name unchanged; callers treat that as
   * UNRESOLVABLE and emit NO edge (a self-loop is always fabrication, and a
   * wrong edge is worse than no edge — family precedent: `new parent()`
   * with an unresolvable base).
   */
  private heritageTarget(raw: string, ownName: string): string {
    const leaf = this.leafName(raw)
    if (raw.includes("\\") && leaf === ownName) {
      return raw.replace(/^\\+/, "")
    }
    return leaf
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
      if (type === "overrides") {
        // M37.10 family contract: verified overrides are structural; a
        // Pass-3 first-parent guess is only "inferred" (the external base
        // may not even declare the method).
        md.evidenceClass = (r.confidence ?? 0) >= 0.9 ? "structural" : "inferred"
        continue
      }
      md.evidenceClass = "usage_contextual"
    }
  }

  /**
   * Per-symbol cyclomatic complexity (managed-OO family contract — csharp
   * #264 wave precedent). Mirrors the file-level counter's node set exactly,
   * scoped to a single method/function subtree; base 1. Same decision nodes:
   * if/elseif/for/foreach/while/switch-arms/match-arms/catch/ternary +
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
        case "case_statement":
        case "default_statement":
        case "match_conditional_expression":
        case "match_default_expression":
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
        case "case_statement":
        case "default_statement":
        case "match_conditional_expression":
        case "match_default_expression":
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
