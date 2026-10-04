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
/**
 * R9 (#835) — the declared-type reference graph: a declaration that WRITES a type name
 * depends on the type it names.
 *
 * php was one of the lanes that emitted NOTHING for this class while ten siblings had it
 * (rust's R13 header calls it a family standard; measured 2026-09-22 by
 * script/m60/declared-type-refs-census.ts under M60's rule R9). The class was invisible
 * to every gate the lane had, because an absent capability emits no edge for a per-edge
 * oracle to adjudicate — see reviews/m60-csharp-declared-type-graph.md for the full
 * shape of that argument, and this function's header for php's own conventions.
 *
 * PHP's positions, from the tree dump (script/m14/tmp/php-dt-tree.ts), NOT from the
 * grammar's documentation:
 *
 *     property_declaration.type              `private Dep $f;`  (incl. static, readonly)
 *     const_declaration.type                 `const Dep X = 1;`  (PHP 8.3 typed class constant)
 *     method_declaration.return_type         `function m(): Dep`
 *     function_definition.return_type        a top-level `function m(): Dep`
 *     simple_parameter.type                  `function m(Dep $a)`
 *     variadic_parameter.type                `function m(Dep ...$rest)`
 *     property_promotion_parameter.type      `__construct(private Dep $f)`
 *
 * and the wrappers `optional_type` (`?Dep`), `union_type` (`Dep|Other`) and
 * `intersection_type` (`Dep&IShape`) descend to their members, because each member is a
 * dependency. `named_type` carries the name; its `qualified_name` form publishes its
 * LEAF (`\App\Lib\Dep` -> `Dep`), which is what every other php edge keys on.
 *
 * THREE RULES INHERITED FROM THIS LANE, not invented here:
 *
 *   source     a property's / constant's dependency belongs to the enclosing TYPE; a
 *              parameter's / return's to the enclosing CALLABLE — the same attribution
 *              the csharp round measured off java/kotlin/python and pinned. A promoted
 *              parameter is a PARAMETER (that is the position it is written in). A
 *              FILE-SCOPE typed constant has no enclosing type and is attributed to
 *              `global` — the same file-scope owner the read rules use when nothing
 *              encloses the position (the trait-use precedent, PHP-O1) — rather than
 *              dropped, because a written dependency is not less real for having no
 *              owner symbol.
 *   marker     `declared_type`, except a return type, which the family publishes as
 *              `return_type` (java/kotlin/python/typescript all do).
 *   relative   `self` / `static` resolve to the ENCLOSING CLASS and `parent` to its
 *              declared base — this lane's own probe-verified `new self()` rule, reused
 *              rather than re-derived. MEASURED, not assumed: the first prototype passed
 *              the attribution source instead and published `copy -> copy` for
 *              `function copy(): self`. An unresolvable `parent` emits NOTHING, exactly
 *              as the `new parent()` path does — a wrong edge is worse than no edge.
 *
 * SILENT: `primitive_type` (`int`, `string`, `void`, `mixed`, ...) — the grammar tags
 * them, so no name test is needed (the exclusion java gets from its primitive_type node).
 * That covers `const string S = "a"` as well as `private string $s`.
 *
 * BOUNDARIES, DISCLOSED: `@var` / `@return` docblock annotations (not syntax),
 * closure/arrow-function return types whose enclosing callable has no name in the file,
 * and `catch (Dep $e)` clause types. Each is a real position; each is unwritten rather
 * than silently approximated.
 *
 * TYPED CLASS CONSTANTS ARE NOT ON THAT LIST, and used to be. The M60 master review
 * found the disclosure honest but UNRULED and the position not a boundary at all: the
 * grammar carries the type as an ordinary `type` field on `const_declaration` (the
 * `const_declaration` case below is the evidence), and the spec claims
 * `const_declaration` is `handled_verified` with no decision naming typed class
 * constants either way. Ruling it out would have manufactured a gap to avoid two lines
 * of code, so it is HANDLED, attributed exactly like `private Dep $f`. The lesson worth
 * keeping is the shape, not the constant: a boundary written only in a source comment,
 * with no matching entry in the adjudication set, is not a recorded decision — it is an
 * unexamined claim wearing a disclosure's clothes.
 *
 * ONE COPY, TWO CONSUMERS: the analyzer emits these edges and the differential oracle
 * derives its truth from this SAME function (a rule the truth does not share is a rule
 * that can drift, and the depth draws would read every new edge as analyzer-only).
 */
export interface PhpDeclaredTypeRef {
  source: string
  target: string
  /** The M59.A7 (#825) line: where the TARGET name is written. */
  line: number | null
  relationshipType: "declared_type" | "return_type"
  declaredOn: string
}

/** The relative types php resolves against the enclosing class (never real symbols). */
const PHP_RELATIVE_TYPES = new Set(["self", "static", "parent"])

/** Declarations a member's dependency is attributed to. */
const PHP_TYPE_DECLARATIONS = new Set([
  "class_declaration", "interface_declaration", "trait_declaration", "enum_declaration",
])

/** Callables a parameter's / return's dependency is attributed to. */
const PHP_CALLABLE_DECLARATIONS = new Set([
  "method_declaration", "function_definition", "anonymous_function", "arrow_function",
])

/** The leaf `name` node of a written type — the token that writes the published name. */
function phpDeclaredTypeLeafNode(n: Node | null | undefined): Node | null {
  if (!n) return null
  if (n.type === "name") return n
  const nm = n.childForFieldName("name")
  if (nm) return phpDeclaredTypeLeafNode(nm)
  // qualified_name(namespace_name(...), name): the trailing name is the leaf.
  for (let i = n.namedChildCount - 1; i >= 0; i--) {
    const c = phpDeclaredTypeLeafNode(n.namedChild(i))
    if (c) return c
  }
  return null
}

/**
 * R9 (#835): the declared-type reference graph of one parsed php file.
 *
 * `resolveParent` supplies the enclosing class's DECLARED base, or undefined when it is
 * not resolvable in this file. The analyzer passes its own `baseByClass`; the oracle
 * passes a map built from the analyzer's class symbols (`metadata.baseClass`), so both
 * sides resolve `parent` from the same published fact rather than from two base rules.
 */
export function phpDeclaredTypeRefs(
  root: Node,
  resolveParent?: (ownerType: string) => string | undefined,
): PhpDeclaredTypeRef[] {
  const out: PhpDeclaredTypeRef[] = []
  const emitted = new Set<string>()

  const enclosing = (from: Node, kinds: Set<string>): string => {
    let cur: Node | null = from.parent
    while (cur) {
      if (kinds.has(cur.type)) {
        const nm = cur.childForFieldName("name")?.text
        if (nm) return nm
      }
      cur = cur.parent
    }
    return ""
  }

  /**
   * Every NAMED type written inside one declared type, in source order.
   *
   * `ownerType` is the enclosing CLASS — the resolution of a relative type, which is a
   * different thing from the attribution source (measured: conflating them published
   * `copy -> copy` for `function copy(): self`).
   */
  const leaves = (typeRoot: Node | null | undefined, ownerType: string): { node: Node; target: string }[] => {
    const acc: { node: Node; target: string }[] = []
    const walk = (n: Node | null | undefined): void => {
      if (!n) return
      if (n.type === "primitive_type") return
      if (n.type === "named_type") {
        const leaf = phpDeclaredTypeLeafNode(n)
        const text = String(leaf?.text ?? "").trim()
        if (!leaf || !text) return
        if (PHP_RELATIVE_TYPES.has(text)) {
          if (text === "parent") {
            const base = ownerType ? resolveParent?.(ownerType) : undefined
            if (base) acc.push({ node: leaf, target: base })
            return
          }
          if (ownerType) acc.push({ node: leaf, target: ownerType })
          return
        }
        acc.push({ node: leaf, target: text })
        return
      }
      // Wrappers (optional_type / union_type / intersection_type) and any other
      // container: each member is a dependency of its own.
      for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
    }
    walk(typeRoot)
    return acc
  }

  const push = (
    source: string,
    typeRoot: Node | null | undefined,
    ownerType: string,
    relationshipType: "declared_type" | "return_type",
    declaredOn: string,
  ): void => {
    if (!source || !typeRoot) return
    for (const leaf of leaves(typeRoot, ownerType)) {
      const line = leaf.node.startPosition.row + 1
      const key = `${source}\u0000${leaf.target}\u0000${line}`
      if (emitted.has(key)) continue
      emitted.add(key)
      out.push({ source, target: leaf.target, line, relationshipType, declaredOn })
    }
  }

  const stack: Node[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    const ownerType = enclosing(n, PHP_TYPE_DECLARATIONS)
    switch (n.type) {
      case "property_declaration":
        push(ownerType, n.childForFieldName("type"), ownerType, "declared_type", "property_declaration")
        break
      // M60 php F4: TYPED CLASS CONSTANTS (PHP 8.3) — `const Dep X = 1;`.
      //
      // This position was previously listed under BOUNDARIES, DISCLOSED as a
      // deliberate non-handling. The master review found the disclosure honest but
      // UNRULED: the spec claims `const_declaration` is handled_verified and carries
      // no decision naming typed class constants, so the lane had a boundary that was
      // documented in code, absent from the adjudication set, and — on the grammar's
      // own evidence — not actually a boundary at all.
      //
      // The grammar carries the type as an ordinary child of the declaration
      // (probe-verified against the pinned wasm):
      //
      //     const_declaration
      //       const
      //       named_type        <- `const Dep X = 1;`   the DEPENDENCY
      //         name
      //       const_element
      //         name            <- `X`, the declaration's own name
      //
      // so the position is a sibling of the one `property_declaration` already
      // handles, in the same declaration_list, naming the same kind of thing. A
      // class that writes `const Dep X` depends on `Dep` exactly as it does when it
      // writes `private Dep $f;`, and the two are attributed the same way — a
      // member's dependency belongs to the enclosing TYPE. Ruling this out would
      // have been a NEW gap created to avoid writing two lines; the family standard
      // (R9) is that a declaration which WRITES a type name depends on the type it
      // names, and this declaration writes one.
      //
      // `primitive_type` (`const string S = "a"`) is SILENT for the same reason it is
      // silent on a property: the grammar tags it, and `int`/`string` are not
      // dependencies on a userland symbol. The shared `leaves` walk already skips
      // them, so this case adds no exclusion of its own.
      //
      // FILE-SCOPE CONSTANTS are the one judgement call. A top-level
      // `const Dep TOP = 1;` has no enclosing type, and a `references` edge needs a
      // source; it is attributed to `global`, the same file-scope owner the lane's
      // read rules use when neither a callable nor a class encloses the position
      // (the trait-use precedent, PHP-O1). The alternative — dropping file-scope
      // typed constants — would leave a real, written dependency invisible for the
      // sake of a source name, and `global` is a source the lane already publishes.
      case "const_declaration": {
        const owner = ownerType || "global"
        push(owner, n.childForFieldName("type"), ownerType, "declared_type", "const_declaration")
        break
      }
      case "method_declaration":
      case "function_definition":
        push(
          n.childForFieldName("name")?.text ?? ownerType,
          n.childForFieldName("return_type"),
          ownerType,
          "return_type",
          "return_type",
        )
        break
      case "simple_parameter":
      case "variadic_parameter":
      case "property_promotion_parameter":
        push(
          enclosing(n, PHP_CALLABLE_DECLARATIONS),
          n.childForFieldName("type"),
          ownerType,
          "declared_type",
          // A promoted parameter is written in a parameter list, so it is a parameter
          // position; the property it also declares is reported by its own node type.
          n.type === "property_promotion_parameter" ? "property_promotion_parameter" : "parameter",
        )
        break
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return out
}

/**
 * PHP include/require path resolution — ONE rule, TWO consumers: the analyzer's
 * `emitInclude` and the differential oracle's truth both call this function, so
 * a change here moves both sides together instead of leaving one side to
 * disagree (the failure mode that turns a capability fix into an
 * "analyzer-only edge" finding).
 *
 * A path is emitted ONLY when it is statically known. The pre-R10 rule read the
 * raw text of any `binary_expression`, so a concatenation with a runtime part
 * published a reconstructed EXPRESSION as both the import module and a
 * `references` target:
 *
 *     include $this->baseDir . 'revision-info.php';   // phpmyadmin src/Git.php:97
 *     target = "$this->baseDir.'revision-info.php'"
 *
 * That spelling carries `$`, `->`, `.` and a quote — no php symbol can ever be
 * named that way, so the edge can never resolve — and because the oracle derived
 * its truth from the same rule, BOTH sides emitted it and no per-edge gate could
 * see it (R10's target-spelling census is what did). `__DIR__ . '/helpers.php'`
 * is unaffected: its operands are all static, so it keeps the exact shape the
 * lane has always published (the concatenation's text, whitespace-collapsed) —
 * this rule narrows WHICH concatenations are paths, not how a path is spelled.
 *
 * Shapes below are probe-verified against the pinned grammar (binary_expression:
 * two named operands with the concat operator as an anonymous child between
 * them; `"{$a}/x.php"` is an `encapsed_string` carrying a `variable_name`).
 */
export function phpStaticIncludePath(node: Node): string | undefined {
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i)
    if (!child) continue
    if (!PHP_PATH_SHAPES.has(child.type)) continue
    return phpStaticPathValue(child)
  }
  return undefined
}

/**
 * PHP callable-name resolution — ONE rule, TWO consumers (the analyzer's
 * `processFunctionCall` and the differential oracle's truth).
 *
 * A `calls` edge's target is the name of a CALLEE, so it only exists when the
 * callee is spelled as a name. `$callable()` names nothing: `$callable` is a
 * runtime VALUE, and the pre-R10 rule read the callee node's raw text anyway, so
 * the lane published `calls -> $callable` (phpmyadmin tests, `$controller($request)`
 * in LicenseControllerTest.php:23) — a target no php symbol can ever be named,
 * emitted IDENTICALLY by the oracle because its truth came from the same shape.
 * The value the call evaluates IS read, and that read is the variable pass's
 * (`uses -> callable`); publishing it as a callee name fabricated a name and lost
 * the honest edge at the same time.
 *
 * Measured over 400 real php files (phpunit/src, phpmyadmin/src + tests): 1,047
 * `name` callees, and `variable_name` the ONLY non-name shape that reaches this
 * rule (1 site) — so this narrows a fabrication, not a capability.
 */
export function phpStaticCallableName(fn: Node | null | undefined): string | undefined {
  if (!fn) return undefined
  if (fn.type !== "name" && fn.type !== "qualified_name") return undefined
  return phpLeafNameText(fn.text) || undefined
}

/** The last namespace segment of a possibly-qualified php name. */
export function phpLeafNameText(name: string): string {
  const idx = name.lastIndexOf("\\")
  return idx >= 0 ? name.substring(idx + 1) : name
}

/**
 * Drop every leading namespace separator — R1 ("no regex") as a char scan.
 *
 * This was the php ANALYZER's only regular expression (`raw.replace(/^\\+/, "")`,
 * authored 2026-09-07 and carried here for 16 days while reviews/m60-oo-family-plan.md
 * §3.7-R1 claimed "the other OO lanes carry none" — a claim the R1 section's own
 * standard is supposed to keep true, and which a census of the analyzers refutes:
 * this lane and ruby each carried exactly one). Character-code 92 is `\\`, so the
 * rule is a prefix scan and needs no engine.
 */
export function phpStripLeadingBackslashes(raw: string): string {
  let i = 0
  while (i < raw.length && raw.charCodeAt(i) === 92) i++
  return raw.substring(i)
}

/**
 * The ORDER this lane publishes its frameworks in (#934) — the marker table's own order,
 * application frameworks first and the test framework last.
 *
 * `R8`'s register states the family rule through the lane it was first fixed on: python's second
 * caught mutant is literally "the emitted order following import order instead of the marker
 * table"; swift's `SWIFT_FRAMEWORK_ORDER` and objc's `OBJC_FRAMEWORK_ORDER` are the same
 * instrument; csharp's `CS_FRAMEWORK_ORDER` is the rule python's header cites.
 *
 * php never had a table, so it published `[...detectedFrameworks]` — a Set's INSERTION order,
 * i.e. whichever marker fired first IN THE FILE. That is python's defect verbatim. The register
 * never named it for php because php's framework row already carried a different debt (the two
 * dead markers, #931), and a lane's row can only hold what someone measured. A file importing
 * Symfony before Illuminate reported Symfony as primary; with the table it reports Laravel, and
 * the pick stops depending on the statement layout of one file.
 */
const PHP_FRAMEWORK_ORDER: readonly string[] = [
  "Laravel",
  "Symfony",
  "WordPress",
  "Magento",
  "Drupal",
  "Doctrine",
  "PHPUnit",
]

const PHP_PATH_SHAPES: ReadonlySet<string> = new Set([
  "string",
  "encapsed_string",
  "binary_expression",
  "name",
  "qualified_name",
])

/** The static VALUE of a path-shaped node, or undefined when it is not static. */
function phpStaticPathValue(n: Node): string | undefined {
  switch (n.type) {
    case "string":
      return phpCleanStringText(n.text)
    case "encapsed_string":
      // Interpolation is dynamic: `include "{$a}/dyn.php"` has no fixed path.
      return phpHasInterpolation(n) ? undefined : phpCleanStringText(n.text)
    case "name":
    case "qualified_name":
      // `__DIR__`, `__FILE__` and a defined path constant are static by
      // definition; the lane has always published them as written.
      return n.text
    case "binary_expression": {
      const operands: Node[] = []
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) operands.push(c)
      }
      if (operands.length !== 2) return undefined
      const between = n.text.slice(operands[0].endIndex - n.startIndex, operands[1].startIndex - n.startIndex).trim()
      // Only `.` composes a path. Any other operator is not a concatenation.
      if (between !== ".") return undefined
      const left = phpStaticPathValue(operands[0])
      const right = phpStaticPathValue(operands[1])
      if (left === undefined || right === undefined) return undefined
      // The path is the CONCATENATION OF THE OPERANDS' VALUES, not the source
      // text of the concatenation. The R10 census (script/m60/target-spelling-
      // census.ts) caught the difference on phpunit's autoloaders: returning
      // `n.text` published `__DIR__.'/src/DeprecatedClass.php'` as a `references`
      // target — the operator, the quotes and the magic constant's spelling, in
      // a string no symbol can be named and which both sides agreed on, so no
      // gate could see it. Both operands are static by the test above, so their
      // values compose exactly: `__DIR__` + `/src/DeprecatedClass.php`. The
      // decision (is this path static?) was always right; only the rendering was
      // wrong, which is why this narrows a fabrication without dropping a single
      // include edge.
      return left + right
    }
    default:
      return undefined
  }
}

function phpHasInterpolation(n: Node): boolean {
  if (n.type === "variable_name" || n.type === "dynamic_variable_name") return true
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c && phpHasInterpolation(c)) return true
  }
  return false
}

function phpCleanStringText(text: string): string {
  if (text.length >= 2) {
    const first = text.charCodeAt(0)
    const last = text.charCodeAt(text.length - 1)
    if ((first === 34 && last === 34) || (first === 39 && last === 39)) return text.substring(1, text.length - 1)
  }
  return text
}

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
      ownerKind: ASTEngine.SymbolKind | undefined
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
        // The node that NAMES the extends edge: the first base-clause child (#929).
        const baseNode = baseClause?.namedChild(0) ?? null
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
              line_number: this.nodeLine(iface),
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
          // M60 NAMESPACE CONTAINMENT. A top-level class belongs to its
          // namespace, and PHP's own resolution says so: an unqualified name is
          // looked up in the current namespace FIRST, which is only true because
          // the namespace scopes it. So this is a parse fact, not a guess, and
          // it is emitted at the same 1.0 / structural the member-level
          // containment edge already uses (the `contains` edges are generated
          // from `ownerName` at line ~1158, so setting the owner here is what
          // creates the edge — there is no second code path to keep in step).
          //
          // The convention is the project's, not php's own invention: the csharp
          // analyzer sets `ownerName`/`ownerKind: Namespace` for a top-level type
          // (verified on `namespace App.Services { interface IRunner; class Runner; }`
          // -> `contains App.Services -> IRunner`, `contains App.Services -> Runner`)
          // and the typescript analyzer does the same through
          // `ScopeKind.Namespace`. php emitted 4,442 `namespace` symbols and
          // joined NONE of them to anything, so before this the lane's 4th-largest
          // label carried the member level and stopped there.
          //
          // Gated on `!owner` so a declaration nested in another declaration is
          // never re-parented: PHP has no nested named classes, so this is
          // belt-and-braces against a future frame that sets `owner`.
          ownerName: owner ?? ns,
          ownerKind: owner ? ownerKind : (ns ? ASTEngine.SymbolKind.Namespace : ownerKind),
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
            line_number: this.nodeLine(baseNode),
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
        // #931 — PHPUnit's GLOBAL-namespace base.
        //
        // The table's PHPUnit marker has two spellings — an import of
        // `PHPUnit\Framework` and the bare name `TestCase` — but `detectFramework`
        // was only ever handed a NAMESPACE, and a class in the global namespace
        // has no namespace at all, so `class MyTest extends TestCase` (the shape a
        // PHPUnit project writes when it does not import the framework) could
        // never fire. MEASURED at HEAD: the probe's `phpunit-global-base` case
        // detected [] while claiming `PHPUnit`, alongside `laravel-app-root-only`.
        //
        // The base CLAUSE is the node that names this relationship, and it is
        // already resolved two lines up, so the marker's own two spellings are
        // tested against the name the source actually writes. Deliberately only
        // this marker: the table's substring entries (`WordPress`, `wp_`) would
        // fire on a class merely NAMED after a framework if base names were fed
        // through the whole table, and that is a different, unevidenced claim.
        if (rawBase === "TestCase" || (rawBase?.includes("PHPUnit\\") ?? false)) {
          detectedFrameworks.add("PHPUnit")
        }

        const body = this.findChildByType(node, "declaration_list")
        if (body) {
          this.pushMembers(body, stack, className, ASTEngine.SymbolKind.Class, ns, scope)
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
              line_number: this.nodeLine(parent),
              metadata: { phpSpecific: true },
            })
          }
        }
        symbols.push({
          name: ifaceName,
          kind: ASTEngine.SymbolKind.Interface,
          range: this.nodeToRange(node),
          visibility: "public",
          // M60 NAMESPACE CONTAINMENT — see the class_declaration branch for
          // the derivation and the csharp/typescript precedent.
          ownerName: owner ?? ns,
          ownerKind: owner ? ownerKind : (ns ? ASTEngine.SymbolKind.Namespace : ownerKind),
          metadata: { phpSpecific: true, fqn: ns ? `${ns}\\${ifaceName}` : ifaceName, namespace: ns, extendedInterfaces: extended },
        })
        const body = this.findChildByType(node, "declaration_list")
        if (body) this.pushMembers(body, stack, ifaceName, ASTEngine.SymbolKind.Interface, ns, scope)
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
          // M60 NAMESPACE CONTAINMENT — see the class_declaration branch.
          ownerName: owner ?? ns,
          ownerKind: owner ? ownerKind : (ns ? ASTEngine.SymbolKind.Namespace : ownerKind),
          metadata: { phpSpecific: true, isTrait: true, fqn: ns ? `${ns}\\${traitName}` : traitName, namespace: ns },
        })
        const body = this.findChildByType(node, "declaration_list")
        if (body) this.pushMembers(body, stack, traitName, ASTEngine.SymbolKind.Trait, ns, scope)
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
              line_number: this.nodeLine(iface),
              metadata: { phpSpecific: true, isEnumImplements: true },
            })
          }
        }
        symbols.push({
          name: enumName,
          kind: ASTEngine.SymbolKind.Enum,
          range: this.nodeToRange(node),
          visibility: "public",
          // M60 NAMESPACE CONTAINMENT — see the class_declaration branch.
          ownerName: owner ?? ns,
          ownerKind: owner ? ownerKind : (ns ? ASTEngine.SymbolKind.Namespace : ownerKind),
          metadata: { phpSpecific: true, fqn: ns ? `${ns}\\${enumName}` : enumName, namespace: ns, implementedInterfaces: ifaceClause ? Array.from({ length: ifaceClause.namedChildCount }, (_, i) => this.heritageTarget(ifaceClause.namedChild(i)?.text ?? "", enumName)).filter(Boolean) : [] },
        })
        const list = this.findChildByType(node, "enum_declaration_list")
        if (list) {
          for (let i = 0; i < list.namedChildCount; i++) {
            const child = list.namedChild(i)
            if (child) stack.push({ node: child, owner: enumName, ownerKind: ASTEngine.SymbolKind.Enum, ns, inFunction: undefined, scope })
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
            ownerKind,
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
          // M60 NAMESPACE CONTAINMENT — see the class_declaration branch. A
          // namespaced function is the case PHP's resolution leans on hardest:
          // `use function`/`call_user_func` reach a top-level function through
          // its namespace, and without this edge the namespace symbol carries
          // nothing at all.
          ownerName: owner ?? ns,
          ownerKind: owner ? ownerKind : (ns ? ASTEngine.SymbolKind.Namespace : ownerKind),
          metadata: { phpSpecific: true, fqn: ns ? `${ns}\\${fnName}` : fnName, namespace: ns },
        })
        const body = node.childForFieldName("body")
        if (body) this.walkBody(body, symbols, relationships, imports, owner, ns, fnName, detectedFrameworks, patterns, { file: fileScope, funcValues, constValues })
        this.walkCallableHeader(node, symbols, relationships, imports, owner, ns, fnName, detectedFrameworks, patterns, { file: fileScope, funcValues, constValues })
        this.pushNonBodyChildren(node, stack, owner, ownerKind, ns, scope, true)
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
          this.walkCallableHeader(node, symbols, relationships, imports, owner, ns, undefined, detectedFrameworks, patterns, { file: fileScope, funcValues, constValues })
          this.pushNonBodyChildren(node, stack, owner, ownerKind, ns, scope, true)
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
          ownerKind: owner ? ownerKind : undefined,
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
        this.walkCallableHeader(node, symbols, relationships, imports, owner, ns, methodName, detectedFrameworks, patterns, { file: fileScope, funcValues, constValues })
        this.pushNonBodyChildren(node, stack, owner, ownerKind, ns, scope, true)
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
            ownerKind: owner ? ownerKind : undefined,
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
            // M60 NAMESPACE CONTAINMENT — see the class_declaration branch. A
            // top-level `const` lives in the namespace in force exactly as a
            // top-level class does; it was the one top-level declaration kind
            // still left unowned after the class/interface/trait/enum/function
            // branches were converted.
            ownerName: owner ?? ns,
            ownerKind: owner ? ownerKind : (ns ? ASTEngine.SymbolKind.Namespace : undefined),
            visibility: owner ? visibility : "public",
            metadata: { phpSpecific: true, isConstant: true, fqn: !owner && ns ? `${ns}\\${nameNode.text}` : undefined, namespace: !owner ? ns : undefined },
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
            line_number: this.nodeLine(child),
            metadata: { phpSpecific: true, isTraitUse: true },
          })
          patterns.add("Trait Composition (Mixins)")
        }
        continue
      }

      if (type === "namespace_use_declaration") {
        // M12.PHP-GROUPED-USE. A `use` declaration has TWO shapes, and only the
        // first was handled:
        //
        //   use App\Models\User;          -> namespace_use_clause           (direct child)
        //   use App\Models\{User, Post};  -> namespace_name + namespace_use_group
        //                                        ^prefix        ^the clauses live in here
        //
        // The loop below only ever looked at DIRECT children for a
        // namespace_use_clause, so the grouped form matched nothing and emitted
        // NO import and NO `imports` edge at all. Grouped use is the idiomatic
        // modern form, and it is absent from BOTH php corpora (phpunit and
        // phpmyadmin contain zero occurrences), which is why a full-corpus run
        // reported 100% coverage while missing it: the corpora cannot detect a
        // construct they do not contain, and the differential's oracle had the
        // same blind spot, so the two agreed on an absence. Only a hand-authored
        // construct matrix finds this class of gap.
        //
        // The prefix is the declaration's own namespace_name child; each grouped
        // member is prefix + "\\" + member, which is the FQN PHP actually binds.
        // Resolve the group prefix ONLY when a group is actually present. The
        // naive form scanned a declaration's children for `namespace_name`
        // unconditionally, which is wasted work on EVERY plain `use App\X;` —
        // and plain use is the overwhelming majority in real code. The scan
        // also read `.text` (a JS<->WASM crossing) for nothing on the common
        // path. Same output, strictly less work.
        let groupPrefix = ""
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i)
          if (!child) continue
          if (child.type === "namespace_use_group") {
            for (let k = 0; k < node.namedChildCount; k++) {
              const pn = node.namedChild(k)
              if (pn && pn.type === "namespace_name") { groupPrefix = pn.text; break }
            }
            break
          }
        }
        for (let i = 0; i < node.namedChildCount; i++) {
          let child = node.namedChild(i)
          let prefix = ""
          // Descend one level into namespace_use_group, qualifying each member.
          if (child && child.type === "namespace_use_group") {
            if (!groupPrefix) continue
            for (let k = 0; k < child.namedChildCount; k++) {
              const member = child.namedChild(k)
              if (member && member.type === "namespace_use_clause") this.emitUseClause(member, relationships, imports, detectedFrameworks, groupPrefix)
            }
            continue
          }
          if (child && child.type === "namespace_use_clause") this.emitUseClause(child, relationships, imports, detectedFrameworks, "")
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
        // M60 NAMESPACE CONTAINMENT, the half that makes the edge reachable.
        //
        // PHP has TWO namespace forms and the grammar spells them differently
        // (probe-verified against the pinned wasm):
        //
        //   braced     `namespace A { class B {} }` -> `namespace_definition`
        //               owns a `compound_statement`, so the declarations are
        //               CHILDREN and the existing `namespace_definition` branch
        //               reaches them with `ns` set.
        //
        //   semicolon  `namespace A; class B {}`  -> `namespace_definition`
        //               ends at the `;` and the declarations are SIBLINGS at
        //               `program` level. Nothing in the namespace_definition's
        //               own subtree names them, so `ns` is `undefined` for every
        //               one of them.
        //
        // The semicolon form is the overwhelmingly common one, so without this
        // the `namespace` symbol — which the lane emits 4,442 of corpus-wide —
        // would be joined to nothing at all. The scope of a semicolon form runs
        // to the NEXT `namespace` declaration or to end of file; that is PHP's
        // own rule, and it is what the segment index below encodes.
        const segments = this.namespaceSegments(node)
        for (let i = node.namedChildCount - 1; i >= 0; i--) {
          const child = node.namedChild(i)
          if (!child) continue
          // A `namespace_definition` reached directly at program level carries
          // its own name; a declaration takes the segment's namespace.
          const segNs = child.type === "namespace_definition" ? undefined : segments.get(child.startIndex)
          stack.push({ node: child, owner, ownerKind, ns: segNs ?? ns, inFunction, scope: extScope })
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

    // --- `exports`: a name this file PUBLISHES and does not declare ---
    this.emitDefineExports(rootNode, symbols, relationships, exports, filePath)

    // --- Contains relationships from ownerName ---
    for (const s of symbols) {
      if (s.ownerName) {
        relationships.push({
          source: s.ownerName,
          target: s.name,
          type: ASTEngine.RelationshipType.Contains,
          confidence: 1.0,
          // The member's own declaration line — the node that names it is its
          // symbol (ruby stamps its contains edges the same way).
          line_number: s.range?.startLine,
          metadata: { isContained: true },
        })
      }
    }

    if (symbols.some((s) => s.kind === ASTEngine.SymbolKind.Class || s.kind === ASTEngine.SymbolKind.Interface)) {
      patterns.add("Object-Oriented Programming")
    }

    return this.result(symbols, relationships, imports, exports, errors, content, rootNode, detectedFrameworks, patterns)
  }

  /**
   * `exports` — a name this file PUBLISHES which no declaration in it writes.
   *
   * ## Why this is here, and what it cost to find out
   *
   * This lane RULED `exports` inapplicable on a measured parse-tree count, and the
   * ruling was WRONG. The probe that supported it read `define('NAME', …)` as 0
   * occurrences over 4,642 corpus files, because it compared `arguments.namedChild(0)`
   * against `string` / `encapsed_string` and tree-sitter-php puts an `argument` node in
   * between:
   *
   *   function_call_expression
   *     name "define"
   *     arguments
   *       argument          <- what namedChild(0) returned
   *         encapsed_string <- the node the test wanted
   *
   * No corpus could falsify that zero, because no corpus makes it non-zero. A control
   * corpus containing `define("X", 1);` read 0 as well, until the wrapper was looked at.
   * With the wrapper descended, the corpus reads 60 occurrences in 20 files
   * (49 at file scope, 11 nested inside a function), so the construct is real and the
   * type is a GAP, not a ruling. See validation/m14/fixtures/php/exports-probe-controls.mts.
   *
   * ## What counts, and the three tests that decide it
   *
   *   1. the callee is EXACTLY the bare name `define` — a `Foo\define` or a variable
   *      callee is a different function and is not a publication;
   *   2. the first argument's VALUE node is a `string` / `encapsed_string`, read
   *      THROUGH the `argument` wrapper. `define($n, …)` publishes a name nobody can
   *      write down, so there is nothing for an edge to point at (measured: 1 in the
   *      corpus, and it is left unemitted rather than given an invented endpoint);
   *   3. the call is at FILE scope — no enclosing function, method, closure or class
   *      body. A `define()` inside a function body publishes the name only if that
   *      function runs, so an edge from the FILE would assert something the file does
   *      not guarantee (measured: 11 such calls in the corpus, all correctly excluded).
   *      A top-level `if` is NOT a scope: it still executes when the file is included.
   *
   * All three are grammar facts read off nodes, so the edge is `confidence: 1` and
   * carries no name matching anywhere — there is no heuristic here to be honest about.
   *
   * ## Why a symbol is published for the name
   *
   * The edge needs an endpoint that resolves. `define('CLEANHOME', …)` writes no
   * declaration anywhere in the file, so without a symbol the target resolves to
   * nothing and the graph asserts a name that is not there — which is the
   * hopeless-target failure, not a resolution. `define()` does declare a constant, in
   * the GLOBAL namespace: PHP resolves the name it writes against the global scope, so
   * `ownerName` is deliberately left unset here even when the file is inside a
   * namespace, and the comment on the `const_declaration` branch above (which does set
   * `ownerName: ns`) is the deliberate contrast. That is also why the symbol is not
   * `ownerName`-linked and therefore gets no `contains` edge: nothing in this file
   * contains it.
   *
   * ## The source spelling, and what it costs
   *
   * `source: "global"` is the spelling PHP's other two file-scoped edge types already
   * use (`emitUseClause`, `emitInclude`), and consistency inside one analyzer matters
   * more here than a locally prettier choice: a reader filtering on
   * `relationship_type IN ('imports','exports')` (src/lsp/graph_request.ts:256) sees one
   * owner convention for all three. The honest cost is that `global` is not a published
   * symbol, so the SOURCE end of these edges resolves to no declaration — measured and
   * reported per type in docs/analyzers/real-php-analyzer.md rather than papered over.
   * `metadata.file` carries the file identity for any consumer that needs to attribute
   * the edge: 3 of the 45 distinct names in the corpus are published by more than one
   * file, and without it those edges are indistinguishable.
   */
  private emitDefineExports(
    rootNode: Node,
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    exports: ASTEngine.ExportInfo[],
    filePath: string,
  ): void {
    // A function, method, closure or class body. Deliberately NOT `if`,
    // `compound_statement` or `statement`: a top-level conditional still runs when
    // the file is included, so its `define()` does publish.
    const SCOPE = new Set([
      "function_definition", "method_declaration", "anonymous_function", "arrow_function",
      "class_declaration", "interface_declaration", "trait_declaration", "enum_declaration",
      "function_static_declaration",
    ])
    const isFileLevel = (n: Node): boolean => {
      let a: Node | null = n.parent
      let guard = 0
      while (a && guard++ < 64) {
        if (SCOPE.has(a.type)) return false
        if (a.type === "program") return true
        a = a.parent
      }
      return false
    }
    const stack: Node[] = [rootNode]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "function_call_expression") {
        const fn = n.childForFieldName("function")
        if (fn && fn.text === "define" && isFileLevel(n)) {
          const args = this.findChildByType(n, "arguments")
          const wrapper = args?.namedChild(0)
          // THROUGH the `argument` wrapper — see the header: testing the wrapper's own
          // type is what made this rule report 0 on a corpus that contains 60.
          const value = wrapper && wrapper.type === "argument" ? this.findChildByType(wrapper, "encapsed_string") ?? this.findChildByType(wrapper, "string") : wrapper
          if (value && (value.type === "string" || value.type === "encapsed_string")) {
            const name = value.text.slice(1, -1)
            // PHP's `define()` accepts ANY string as a constant name — `define('A B', 1)`
            // is legal and publishes the name `A B` — so no character-shape test belongs
            // here: inventing one would drop names the language really does publish. The
            // only names refused are the ones with no nameable content, because an edge
            // to an empty or whitespace-only endpoint is not an endpoint. (No regex: a
            // shape test over a name is exactly the text-matching this lane must not do,
            // and `trim()` is a string operation, not a pattern.)
            if (name.length > 0 && name.trim().length > 0) {
              // The symbol spans the NAME, not the quotes — the `const_declaration`
              // branch above ranges a constant on its `name` node, and a byte range that
              // included the quotes would disagree with it for the same kind.
              const nameNode = this.findChildByType(value, "string_content") ?? value
              symbols.push({
                name,
                kind: ASTEngine.SymbolKind.Constant,
                range: this.nodeToRange(nameNode),
                visibility: "public",
                metadata: { phpSpecific: true, isDefinedConstant: true, definedBy: "define", fileLevel: true },
              })
              relationships.push({
                source: "global",
                target: name,
                type: ASTEngine.RelationshipType.Exports,
                confidence: 1,
                line_number: this.nodeLine(n),
                metadata: {
                  phpSpecific: true,
                  fileLevel: true,
                  relationshipType: "define_call",
                  file: filePath,
                  // The name is GLOBAL even inside a namespace, which is why the symbol
                  // carries no ownerName. Recorded so a consumer does not re-derive it
                  // from the file's namespace and get it wrong.
                  globalName: true,
                },
              })
              exports.push({
                name,
                kind: ASTEngine.SymbolKind.Constant,
                range: this.nodeToRange(nameNode),
                metadata: { phpSpecific: true, definedBy: "define", fileLevel: true, globalName: true },
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
          // M60 php round — a member READ names a member only when the name
          // field is a STATIC `name` node. The old gate was a proxy
          // (`!member.text.startsWith("$")`) and a proxy is exactly what the
          // dynamic spellings break: `$postParams->$param` (phpmyadmin
          // src/Http/ServerRequest.php:233) emitted NOTHING while the oracle
          // published the raw field text as a target (`uses -> $param` — a
          // spelling no other edge in this lane can produce), and
          // `$box->{'quoted'}` / `$box->{1}` published a STRING/INTEGER
          // LITERAL as a symbol name on BOTH sides, so no mirror could ever
          // show it (measured: script/m14/tmp/php-dynamic-member-shapes.ts).
          //
          // The braces ARE in the tree (probe: `$o->NAME` is `variable_name,
          // ~->, name`; `$o->{NAME}` is `variable_name, ~->, ~{, name, ~}`), so
          // the two shapes are distinguishable: a
          // braced field is a DYNAMIC selection — the property is chosen at
          // run time, the static graph holds no member symbol for it, and the
          // field's own expression reads (a `$var`, a file const, an inner
          // `$this->x`) are emitted by the ordinary rules for those nodes.
          const nameNode = n.childForFieldName("name")
          const member = nameNode && nameNode.type === "name" && !this.isBracedMemberName(n) ? nameNode : null
          if (member && member.text) {
            relationships.push({
              source: inFunction || "global",
              target: member.text,
              type: ASTEngine.RelationshipType.Uses,
              confidence: 0.9,
              line_number: this.nodeLine(member),
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
              line_number: this.nodeLine(varNode),
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
        let memberNode: Node | null = null
        for (let i = n.namedChildCount - 1; i >= 0; i--) {
          const c = n.namedChild(i)
          if (c && c.type === "name") { member = c.text; memberNode = c; break }
        }
        if (member && member.toLowerCase() !== "class") {
          relationships.push({
            source: inFunction || "global",
            target: member,
            type: ASTEngine.RelationshipType.Uses,
            confidence: 0.9,
            line_number: this.nodeLine(memberNode),
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
              line_number: this.nodeLine(n),
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
            line_number: this.nodeLine(n),
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
            line_number: this.nodeLine(n),
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
            line_number: this.nodeLine(n),
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
    if (!nameNode) return
    // A FULLY-QUALIFIED call spells its name with a leading backslash
    // (`\is_file(...)`, `\spl_autoload_register(...)` — phpunit's bootstrap and
    // test-helper files). Taking the raw text broke both halves of this rule
    // at once: `PHP_BUILTINS` holds BARE names, so `has("\\is_file")` is false
    // and a builtin escaped the filter, and the edge published a target no
    // other relationship in this lane can spell — `calls delete_directory ->
    // \is_file` (targets are bare names everywhere else: `leafName` in
    // processObjectCreation, the `name` field in the scoped/member calls).
    // Measured on phpunit FULL EXTENT (2,907 files, 2026-09-22): 12 such
    // edges, 10 of them builtins the filter should have dropped. The oracle's
    // rule is leaf-then-builtin (`leafName(fn.text)` then `PHP_BUILTINS`), so
    // this is the analyzer side converging on the rule both sides state.
    // R10 (#835): a callee that is not spelled as a name has no callee NAME.
    // The value is still read (`uses -> callable`, the variable pass owns it),
    // so this drops a fabricated symbol and keeps the honest edge.
    const callName = phpStaticCallableName(nameNode)
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
        line_number: this.nodeLine(nameNode),
        metadata: { phpSpecific: true, isTearOff: true },
      })
      return
    }
    relationships.push({
      source: inFunction || "global",
      target: callName,
      type: ASTEngine.RelationshipType.Calls,
      confidence: 0.9,
      line_number: this.nodeLine(nameNode),
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
        line_number: this.nodeLine(nameNode),
        metadata: { phpSpecific: true, isTearOff: true },
      })
      return
    }
    relationships.push({
      source: inFunction || "global",
      target: methodName,
      type: ASTEngine.RelationshipType.Calls,
      confidence: 0.9,
      line_number: this.nodeLine(nameNode),
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
        line_number: this.nodeLine(nameNode),
        metadata: { phpSpecific: true, isTearOff: true },
      })
      return
    }
    relationships.push({
      source: inFunction || "global",
      target: methodName,
      type: ASTEngine.RelationshipType.Calls,
      confidence: 0.9,
      line_number: this.nodeLine(nameNode),
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
    // The node that NAMES the instantiates edge: the class name child (#929).
    let targetNode: Node | null = null
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
        targetNode = child
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
        targetNode = child
        break
      }
    }
    if (!target) return
    relationships.push({
      source: inFunction || "global",
      target,
      type: ASTEngine.RelationshipType.Instantiates,
      confidence: 0.9,
      line_number: this.nodeLine(targetNode),
      metadata: { phpSpecific: true, isNew: true },
    })
  }

  // ========================================================================
  // HELPERS
  // ========================================================================

  /**
   * M60 NAMESPACE CONTAINMENT — the namespace each top-level declaration sits
   * in, keyed by that declaration node's `startIndex`.
   *
   * Only the SEMICOLON form needs an index. The braced form nests its
   * declarations inside the `namespace_definition`'s own `compound_statement`,
   * so the walk reaches them with `ns` already set and they must NOT appear
   * here (a `namespace_definition` carrying a `compound_statement` is therefore
   * skipped, and its children are left to the normal descent).
   *
   * A file may carry several namespace blocks (`namespace A; ... namespace B;
   * ...`), and a semicolon form's scope runs to the next declaration or to end
   * of file. `use`/`declare` statements between blocks belong to the namespace
   * in force at that point, which is why the running value is not reset by
   * anything except the next `namespace_definition`.
   *
   * Byte offsets rather than child indices: the walk looks nodes up by identity
   * and web-tree-sitter re-creates the Node wrapper per call, so an index into
   * `namedChildren` would not be a stable key. `startIndex` is a value on the
   * node itself and is unique within a file.
   */
  private namespaceSegments(program: Node): Map<number, string> {
    const out = new Map<number, string>()
    let current: string | undefined
    for (let i = 0; i < program.namedChildCount; i++) {
      const child = program.namedChild(i)
      if (!child) continue
      if (child.type === "namespace_definition") {
        // The braced form owns a `compound_statement`; its declarations are
        // children of that and the normal descent already reaches them.
        if (this.findChildByType(child, "compound_statement")) continue
        const nsName = this.findChildByType(child, "namespace_name")?.text
        if (nsName) current = nsName
        continue
      }
      if (current) out.set(child.startIndex, current)
    }
    return out
  }

  /**
   * PHP2: push a declaration's non-body children (attributes, signatures)
   * for the extractive walk. Bodies belong to walkBody; heritage and names
   * belong to no value rule — but defaults, const initializers and
   * attribute arguments genuinely read (consts/globals via file frame).
   */
  private pushNonBodyChildren(
    node: Node,
    stack: { node: Node; owner: string | undefined; ownerKind: ASTEngine.SymbolKind | undefined; ns: string | undefined; inFunction: string | undefined; scope: PhpValueScope }[],
    owner: string | undefined,
    ownerKind: ASTEngine.SymbolKind | undefined,
    ns: string | undefined,
    scope: PhpValueScope,
    callableHeader = false,
  ): void {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (!c) continue
      // `attribute_list` and `formal_parameters` are NOT descended here for a
      // callable: they are owned by walkCallableHeader, which runs the BODY
      // walker over them (see its header for why). The branch is still live for
      // class/interface/trait/enum declarations, where truth's inBody is false
      // and the extracted walk's subset is the correct semantics.
      if (c.type === "attribute_list" || c.type === "formal_parameters") {
        if (callableHeader) continue
        for (let j = c.namedChildCount - 1; j >= 0; j--) {
          const g = c.namedChild(j)
          if (g) stack.push({ node: g, owner, ownerKind, ns, inFunction: undefined, scope })
        }
      }
    }
  }

  /**
   * A NAMED callable's declaration header — its parameter list and its
   * attribute list — is walked with the BODY walker.
   *
   * Why: the differential oracle gates its read rules on `inBody`, and that
   * boundary is the callable's whole SUBTREE, not just its body. Both the
   * parameter list and the attribute list sit inside it, so truth reads them
   * with the full rule set (a parameter DEFAULT and an attribute ARGUMENT are
   * expressions evaluated at call time — the same category as the field
   * default / const initializer this lane already reads). The extracted walk
   * visits those positions with a SUBSET of its read rules (file-const `name`
   * reads and variable reads only — no class-constant, static-property or
   * member branch), so `= self::DEFAULT` and `#[Spec(self::NAME)]` in a method
   * header emitted nothing while truth derived an edge.
   *
   * Measured, not assumed: phpunit FULL EXTENT (2,907 files, 2026-09-22) —
   * `Result::from(..., int $shellExitCode = self::SUCCESS)` was the lane's only
   * non-`calls` MISSING edge, and the fixture php/header-reads reports the
   * attribute-argument half as `oracle-only -> NAME` before this walk.
   *
   * walkBody is REUSED, never re-implemented: it already excludes the DECLARING
   * positions by ptype (`simple_parameter`, `variadic_parameter`,
   * `property_promotion_parameter` — mirrored exactly by the oracle), so walking
   * these subtrees emits the defaults'/arguments' reads and nothing else. Its
   * frame seed collects the declaration's own params, which is the frame the
   * oracle gives these nodes too. Source attribution is the enclosing callable,
   * as in the body.
   *
   * The boundary is deliberate and pinned by the fixture: the SAME attribute on
   * a CLASS is outside any callable, truth's inBody is false there, and it stays
   * on the extracted subset (no read).
   */
  private walkCallableHeader(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    imports: ASTEngine.ImportInfo[],
    owner: string | undefined,
    ns: string | undefined,
    fnName: string | undefined,
    detectedFrameworks: Set<string>,
    patterns: Set<string>,
    scopeCtx: { file: PhpValueScope; funcValues: Set<string>; constValues: Set<string> },
  ): void {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (!c) continue
      if (c.type !== "formal_parameters" && c.type !== "attribute_list") continue
      this.walkBody(c, symbols, relationships, imports, owner, ns, fnName, detectedFrameworks, patterns, scopeCtx)
    }
  }

  private pushMembers(
    body: Node,
    stack: { node: Node; owner: string | undefined; ownerKind: ASTEngine.SymbolKind | undefined; ns: string | undefined; inFunction: string | undefined; scope: PhpValueScope }[],
    owner: string,
    ownerKind: ASTEngine.SymbolKind,
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
    // M60 round — VISIBILITY. A `private` method is not inherited, so a subclass method of
    // the same name is a DIFFERENT method and never an override. This rule had no
    // visibility filter at all, on EITHER path, and it was pre-existing rather than
    // introduced here: the same-file prescan collected every `method` symbol regardless
    // of modifiers, and `class A { private function p() {} } class B extends A { private
    // function p() {} }` published `B.p -> A.p`. It stayed invisible because the corpora
    // do not exercise it — MEASURED over both pinned repos with the cross-file companion
    // built: of phpunit's 527 and phpmyadmin's 553 `overrides` edges, **0** name a private
    // base method. A defect with a zero corpus footprint is exactly the class the
    // hand-written fixture exists for, and the fixture that found it declares a private
    // method on both sides on purpose.
    const privateByOwner = new Map<string, Set<string>>()
    for (const s of symbols) {
      if (s.kind !== ASTEngine.SymbolKind.Method || !s.ownerName) continue
      let names = methodsByOwner.get(s.ownerName)
      if (!names) {
        names = new Set<string>()
        methodsByOwner.set(s.ownerName, names)
      }
      names.add(s.name)
      if (s.visibility === "private") {
        let priv = privateByOwner.get(s.ownerName)
        if (!priv) {
          priv = new Set<string>()
          privateByOwner.set(s.ownerName, priv)
        }
        priv.add(s.name)
      }
    }
    for (const s of symbols) {
      if (s.kind !== ASTEngine.SymbolKind.Method || !s.ownerName) continue
      const base = baseByClass.get(s.ownerName)
      if (!base) continue
      const inFileMethods = methodsByOwner.get(base)
      const baseMethods = inFileMethods ?? context?.overrideCompanion?.get(base)
      // Same-file bases are filtered from the analyzer's OWN symbols, where the
      // modifiers are known. A CROSS-FILE base is filtered from
      // `overrideCompanionVisibility` when the caller supplies it; absent, visibility is
      // genuinely unknown and the edge is published as it always was. That asymmetry is
      // deliberate and recorded rather than guessed around — see the Known-gaps entry.
      // …and ONLY from the same-file reading. The CROSS-FILE visibility channel is
      // deliberately NOT consulted for this decision, and the reason is the most important
      // thing this round found.
      //
      // php keys every edge on the LEAF name, so a NAME-keyed index is ambiguous whenever
      // two namespaces declare the same class name — and phpunit does that four times:
      // three `TestSuite` classes (one with a PRIVATE `__construct`, two public) and two
      // `Assert` classes, one of them a VENDORED library at
      // `tools/.phpstan/vendor/webmozart/assert/src/Assert.php` with a private
      // `__construct` while phpunit's own `abstract class Assert` has none.
      //
      // Every ambiguity rule tried here produced a wrong answer:
      //   - take the MOST RESTRICTIVE reading -> suppressed 7 correct overrides;
      //   - require UNANIMITY among observations -> still suppressed 1, because the two
      //     `Assert` classes do not disagree, there is only one observation of the key and
      //     it comes from the wrong class.
      //
      // So a cross-file lookup here is a GUESS, and the rule is that a rule acting on a
      // guess defaults to the permissive reading: the permissive reading never removes a
      // true edge, and it is the pre-M60 behaviour for this path. The channel stays on
      // `AnalyzeContext` because the index itself is correct and a consumer holding
      // QUALIFIED identity can use it — this analyzer cannot, because `baseClass` is a leaf.
      //
      // Same-file bases ARE exact, because the base's own symbols are right here, and that
      // half is real: it is what stopped `B.p -> A.p` for a private `A::p`.
      const baseIsPrivateInFile = privateByOwner.get(base)?.has(s.name) === true
      if (inFileMethods && baseIsPrivateInFile) continue
      // Referenced only to document that the channel is deliberately unused; the `void`
      // keeps the parameter meaningful and stops a future reader from adding a use by
      // accident. See the note above.
      void context?.overrideCompanionVisibility
      if (baseMethods?.has(s.name)) {
        relationships.push({
          source: `${s.ownerName}.${s.name}`,
          target: `${base}.${s.name}`,
          type: ASTEngine.RelationshipType.Overrides,
          confidence: 0.95,
          // The overriding METHOD's own declaration line (the node that names it).
          line_number: s.range?.startLine,
          metadata: { phpSpecific: true, isOverride: true },
        })
      }
      // M12.PHP-OVERRIDE-AUDIT: the 0.5 "first-parent-guess" edge that used to
      // stand here asserted an override for EVERY method of a class whose base
      // lives in another file, without ever checking that the base declares
      // that method. The companion index that could verify it is never
      // populated in production (M37.10), so in production EVERY cross-file
      // override was that guess. `script/m12/php-override-audit.ts` measured it
      // on phpunit@c8d6921f: of the guesses it could decide against the real
      // declaring file, 66.7% were FALSE — e.g.
      // StringEqualsStringIgnoringWhitespace.normalizeWhitespace "overrides"
      // Constraint.normalizeWhitespace, and Repeat.times "overrides"
      // Metadata.times; neither method is declared on the base at all.
      //
      // The edge sat below the 0.7 threshold, so pool-worker already dropped
      // it and it never reached the graph — meaning the guess bought no real
      // cross-file override while manufacturing a large majority-false
      // unverified bucket (369 edges across the two sampled corpora, all of it
      // `overrides`). An `overrides` edge is now emitted ONLY when the base's
      // declaration is actually visible — in this file, or via the project
      // companion index — at confidence 0.95. Restoring cross-file coverage
      // honestly means populating that companion, not guessing.
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
    ownerKind: ASTEngine.SymbolKind | undefined,
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
        ownerKind,
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

  /**
   * One `use` clause -> one ImportInfo + one `imports` edge.
   *
   * Shared by the plain form (`use App\Models\User;`) and the grouped form
   * (`use App\Models\{User, Post};`), which differ only in that a grouped
   * member is qualified by the declaration's own prefix — that prefix is what
   * `prefix` carries, so `Post` is recorded as `App\Models\Post`, the FQN PHP
   * actually binds, not as a bare `Post` that would collide with every other
   * group's members.
   */
  private emitUseClause(
    child: Node,
    relationships: ASTEngine.UniversalRelationship[],
    imports: ASTEngine.ImportInfo[],
    detectedFrameworks: Set<string>,
    prefix: string,
  ): void {
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
    if (!fqn) return
    if (prefix) fqn = `${prefix}\\${fqn}`
    const leaf = this.leafName(fqn)
    imports.push({
      module: fqn,
      items: [alias || leaf],
      isDefaultImport: true,
      range: this.nodeToRange(child),
      metadata: { phpSpecific: true, aliased: !!alias, grouped: !!prefix },
    })
    // M12.PHP-IMPORTS: a `use` clause is a MODULE DEPENDENCY, and the file-level
    // reader keys on it — src/lsp/graph_request.ts:256 is `relationship_type IN
    // ('imports','exports')`. Before this the clause was recorded only as
    // ImportInfo with no relationship, so every PHP module dependency was
    // invisible to that reader. `use` is per-compilation-unit in PHP, so the
    // owner is file scope — the same owner emitInclude uses for the include path.
    relationships.push({
      source: "global",
      target: fqn,
      type: ASTEngine.RelationshipType.Imports,
      confidence: 1,
      line_number: this.nodeLine(child),
      metadata: {
        phpSpecific: true,
        isImport: true,
        fileLevel: true,
        aliased: !!alias,
        grouped: !!prefix,
        relationshipType: "use_clause",
      },
    })
    this.detectFramework(fqn, detectedFrameworks)
  }

  private emitInclude(
    node: Node,
    imports: ASTEngine.ImportInfo[],
    relationships: ASTEngine.UniversalRelationship[],
    // Kept in the signature because both call sites pass it and the namespace is
    // still the right thing for a future include-side resolution to have. The
    // OWNER is unconditionally file scope — see the `source: "global"` note
    // below — so nothing here reads it.
    _ns: string | undefined,
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
      // M60 NAMESPACE CONTAINMENT, the owner half. This was `ns || "global"`,
      // and it was only ever exercised one way: before that round `ns` was
      // UNDEFINED for every declaration under the common SEMICOLON namespace
      // form, so the fallback fired on essentially every real file and the
      // `ns` branch was reached only by a braced `namespace X { ... }`.
      //
      // Now that the semicolon form resolves, the branch became reachable at
      // scale — and it is WRONG. `require`/`include` resolves a PATH against
      // the file's own directory; the namespace in force has no part in it, and
      // PHP scopes `include` to the compilation unit exactly as it scopes `use`.
      // So the owner is file scope in both cases, which is what the doc's
      // `imports` row already claimed ("Owner is file scope") and what
      // `emitUseClause` hard-codes three branches above.
      //
      // Left as `ns || "global"`, one analyzer would have filed the SAME kind at
      // two different owners depending only on which namespace syntax the file
      // happened to use, and the `php/include-paths` fixture caught it: 6 of its
      // expected file-scope `imports` edges stopped matching. The fixture is the
      // contract here, not the code.
      source: "global",
      target: filePath,
      // M12.PHP-IMPORTS: `require`/`include` is a module dependency, not a
      // symbol reference. It was filed as `references`, which mislabels a
      // file-level edge as an intra-file symbol read and kept it out of the
      // file-level reader's `('imports','exports')` filter. Same fix as the
      // `use` clause above: one kind for all PHP module dependencies.
      type: ASTEngine.RelationshipType.Imports,
      confidence: 0.9,
      line_number: this.nodeLine(node),
      metadata: {
        phpSpecific: true,
        isImport: true,
        fileLevel: true,
        relationshipType: "include_path",
        includeType: node.type.replace("_expression", ""),
      },
    })
  }

  private extractIncludePath(node: Node): string | undefined {
    // R10 (#835): the static-path rule lives at module level because the
    // differential oracle calls the SAME function — a path the analyzer
    // refuses to fabricate must be refused on the truth side too, or the
    // narrowing reads as "analyzer lost 12 edges" in the next draw.
    return phpStaticIncludePath(node)
  }

  /**
   * M60 #929 — the line of the node that NAMES an edge. Mirrors ruby's `nodeLine`.
   *
   * The family contract (M59.A7, R6) is that EVERY relationship carries the line of
   * the node that names it: the base name for `extends`/`implements`, the trait name
   * for a trait `uses`, the callee name for `calls`, the member name for
   * `uses`/`contains`, the constructed class name for `instantiates`, the overriding
   * method for `overrides`, the include path for its `references`.
   *
   * php carried a line on exactly ONE label — `references`, the R9 declared-type graph
   * added 2026-09-22 — and none on the other seven. MEASURED at HEAD: 2,123 of 2,418
   * corpus edges (87.8%) with no `line_number` at all, while the completion matrix's
   * `lines` cell read PASS, because M60.P1's check asks whether the field is written
   * ANYWHERE rather than whether every edge carries one. The differential cannot see
   * it either (it matches on label/from/target, never on the line), and php's twelve
   * fixtures never pinned a line — three instruments, one blind spot. Hence the
   * fixture and the reverting mutant that hold this rule now.
   *
   * `undefined` when there is no node to ask: a missing line is honest, a fabricated
   * 0 is the M59 defect.
   */
  private nodeLine(node: Node | null | undefined): number | undefined {
    if (!node) return undefined
    return node.startPosition.row + 1
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
        line_number: this.nodeLine(n),
        metadata: { phpSpecific: true, isLocalRead: true },
      })
    } else if (scopeCtx.funcValues.has(base)) {
      relationships.push({
        source,
        target: base,
        type: ASTEngine.RelationshipType.Uses,
        confidence: 0.9,
        line_number: this.nodeLine(n),
        metadata: { phpSpecific: true, isGlobalRead: true },
      });
    } else if (PHP_SUPERGLOBALS.has(base)) {
      relationships.push({
        source,
        target: base,
        type: ASTEngine.RelationshipType.Uses,
        confidence: 0.9,
        line_number: this.nodeLine(n),
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
    // M60: the member-access exclusion covers the STATIC member-NAME position
    // (a name there names a member, not a value). A BRACED field is the dynamic
    // form — an expression context, where a bare name IS a value: in
    // `$o->{$CONST}` the constant selects the property, so it is read. Same
    // exception as the member rule above, same `{` token test, mirrored in the
    // oracle.
    const dynamicMemberField = !!parent &&
      (ptype === "member_access_expression" || ptype === "nullsafe_member_access_expression") &&
      this.isBracedMemberName(parent)
    if (
      (!dynamicMemberField && (ptype === "member_access_expression" || ptype === "nullsafe_member_access_expression")) ||
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
        line_number: this.nodeLine(n),
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
      return phpStripLeadingBackslashes(raw)
    }
    return leaf
  }

  /**
   * M60 php round: is this member access written in the BRACED dynamic form
   * (`$o->{$x}`, `$o->{'lit'}`, `$o->{CONST}`)? The pinned grammar keeps the
   * braces as ANONYMOUS `{`/`}` tokens around the name field, which is the only
   * thing distinguishing `$o->NAME` (a static member name) from `$o->{NAME}` (a
   * dynamic selection whose value happens to be a constant) — both carry a
   * `name` node. Pure AST, never source text. Mirrored exactly by the oracle's
   * phpIsBracedMember. 
   */
  private isBracedMemberName(n: Node): boolean {
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c && !c.isNamed && c.type === "{") return true
    }
    return false
  }

  // `cleanString` and `collapseWhitespace` used to live here, as private methods.
  // Both are GONE as of the M60 php master review, and the note is the reason rather
  // than an empty space: nothing called them. When the R10 include-path rule moved
  // out of the class to module scope (commit bdce721aa) so the analyzer and the
  // differential oracle could share ONE implementation — `phpStaticIncludePath` /
  // `phpStaticPathValue` / `phpCleanStringText` — these two private copies were left
  // behind as orphans, each declared once and referenced nowhere.
  //
  // They survived because nothing can see them: `tsconfig.json` sets
  // `noUnusedLocals: false`, so tsc reports 0 errors for this file, and the repo has
  // no dead-code gate over analyzer sources. That is worth stating rather than
  // quietly fixing, because "the compiler is green" was the only evidence available
  // and it was evidence of nothing. The replacements are not identical and were not
  // meant to be: `phpCleanStringText` also serves the `name`/`qualified_name` shapes
  // (which `cleanString` never handled), and `phpStaticPathValue` composes the
  // OPERAND VALUES of a concatenation rather than collapsing the source text, which
  // is the fix that stopped `__DIR__.'/src/X.php'` being published as a `references`
  // target. So these were not "the same functions, tidied" — they were two
  // superseded drafts of a rule that has since been rewritten.

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
    // #931 — the Laravel app root is a PREFIX, not an exact string.
    //
    // Laravel's own code lives under the `App\` namespace (`app/Http/Controllers`
    // => `App\Http\Controllers`). The marker read `text === "App\\"` — an exact
    // match on a string whose only possible producer is a namespace node whose
    // text ENDS in a backslash, which no node's text does. MEASURED at HEAD: the
    // probe's `laravel-app-root-only` case (`namespace App\Http\Controllers;`)
    // detected [] while claiming `Laravel`, and so did a plain `namespace App;`;
    // the register has carried it as a claim miss since 2026-09-22 and R8 still
    // read MET, because a marker that cannot fire is a detector every corpus
    // calls clean. The author's intent is visible in the literal — the `App\`
    // root — so the exact match becomes the prefix match it was written to be.
    //
    // Cost measured before applying: 0 of 3,231 phpunit + 1,232 phpmyadmin + 125
    // slim files declare any `App` namespace, so the runtime half (425 files, 0
    // findings) cannot move, and a namespace that merely STARTS with `App\` —
    // no other spelling can, `App` is followed by the separator — is the app
    // root by definition. `namespace App;` alone still does NOT fire: the
    // marker's own literal asked for the `App\` root, not for a project that
    // happens to name one namespace `App`.
    if (text.includes("Illuminate\\") || text.startsWith("App\\")) detectedFrameworks.add("Laravel")
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
    // R9 (#835): the declared-type reference graph — family standard, mirrors
    // go/c/rust/java/kotlin (see phpDeclaredTypeRefs' header for php's positions, the
    // inherited conventions and the disclosed boundaries). Emitted BEFORE
    // classifyEvidenceTier so these edges carry an evidence class like every other
    // reference edge, and from the SAME function the differential oracle derives its
    // truth from. `parent` resolves through this lane's own baseByClass.
    for (const ref of phpDeclaredTypeRefs(rootNode, (owner) => this.baseByClass.get(owner))) {
      relationships.push({
        source: ref.source,
        target: ref.target,
        type: ASTEngine.RelationshipType.References,
        confidence: 0.9,
        ...(ref.line ? { line_number: ref.line } : {}),
        metadata: { relationshipType: ref.relationshipType, declaredOn: ref.declaredOn },
      })
    }

    this.classifyEvidenceTier(relationships)
    const frameworks = PHP_FRAMEWORK_ORDER.filter((f) => detectedFrameworks.has(f)).concat(
      [...detectedFrameworks].filter((f) => !PHP_FRAMEWORK_ORDER.includes(f)),
    )
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
