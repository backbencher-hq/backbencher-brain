import { ASTEngine } from "./engine"
import type { Node } from "web-tree-sitter"

/**
 * Perl builtins and named operators.
 *
 * The set is not hand-maintained prose: it is the union of (a) the fixed op
 * token sets the pinned tree-sitter-perl grammar declares — the words it will
 * parse as `func1op_call_expression` / `func0op_call_expression` rather than as
 * an arbitrary bareword call — and (b) the named-op entries of perl 5.38's own
 * `opcode.h` (`PL_op_name`) that the grammar also enumerates, minus the pure
 * operators and keywords that can never be a call target.
 *
 * Derivation + the exact 10-word gap this closed:
 *   script/m14/tmp/perl-builtin-oracle.mts (grammar x opcode.h derivation)
 *   script/m14/results/M14.6.perl.json      (the before/after measurement)
 *
 * A word in this set is a call the LANGUAGE owns, so it must never become a
 * `calls` edge target. The pre-review set was missing `accept`, `break`,
 * `catch`, `chr`, `chroot`, `dbmclose`, `dbmopen`, `fc`, `say`, `system`;
 * `say` and `system` alone produced phantom call edges on the mojo corpus.
 */
/**
 * Perl's compile-time magic tokens. As a method-call INVOCANT they stand for
 * something other than a class — `__PACKAGE__->new` means "construct the current
 * package" — so they must never be emitted as the name of a type.
 */
const PERL_MAGIC_TOKENS = new Set(["__PACKAGE__", "__FILE__", "__LINE__", "__SUB__", "__DATA__", "__END__"])

export const PERL_BUILTINS = new Set([
  "abs", "accept", "alarm", "atan2", "bind", "binmode", "bless", "break", "caller", "catch", "chdir",
  "chmod", "chomp", "chop", "chown", "chr", "chroot", "close", "closedir", "cmp", "connect", "continue",
  "cos", "crypt", "dbmclose", "dbmopen", "defined", "delete", "die", "do", "dump", "each", "eof", "eval",
  "exec", "exists", "exit", "exp", "fc", "fcntl", "fileno", "flock", "fork", "format", "formline", "getc",
  "getgrent", "getgrgid", "getgrnam", "gethostbyaddr", "gethostbyname", "getlogin", "getnetbyaddr",
  "getnetbyname", "getpeername", "getpgrp", "getppid", "getpriority", "getprotobyname",
  "getprotobynumber", "getpwnam", "getpwuid", "getservbyname", "getservbyport", "getsockname",
  "getsockopt", "glob", "gmtime", "goto", "grep", "hex", "if", "index", "int", "ioctl", "join", "keys",
  "kill", "last", "lc", "lcfirst", "length", "link", "listen", "local", "localtime", "lock", "log",
  "lstat", "map", "mkdir", "msgctl", "msgget", "msgrcv", "msgsnd", "my", "next", "oct", "open", "opendir",
  "ord", "pack", "pipe", "pop", "pos", "print", "printf", "prototype", "push", "quotemeta", "rand",
  "read", "readdir", "readline", "readlink", "readpipe", "recv", "redo", "ref", "rename", "require",
  "reset", "return", "reverse", "rewinddir", "rindex", "rmdir", "say", "scalar", "seek", "seekdir",
  "select", "semctl", "semget", "semop", "send", "setpgrp", "setpriority", "setsockopt", "shift",
  "shmctl", "shmget", "shmread", "shmwrite", "shutdown", "sin", "sleep", "socket", "socketpair", "sort",
  "splice", "split", "sprintf", "sqrt", "srand", "stat", "state", "study", "substr", "symlink", "syscall",
  "sysopen", "sysread", "sysseek", "system", "syswrite", "tell", "telldir", "tie", "tied", "time", "times",
  "truncate", "uc", "ucfirst", "umask", "undef", "unlink", "unpack", "unshift", "untie", "until", "use",
  "utime", "values", "vec", "wait", "waitpid", "wantarray", "warn", "while", "write", "xor", "our",
])

/**
 * Reason codes for every edge below confidence 1.0 (M14 HONESTY-CONTRACT §4.1:
 * a sub-1.0 edge must carry a machine-readable reason code, not just a number).
 *
 * The vocabulary is small and each entry says exactly WHAT is uncertain:
 *   name-only-callee     the callee is named, but whether it binds to a sub in
 *                        this file, an imported sub, or a module-level sub is
 *                        not decided at this edge
 *   dynamic-receiver     the receiver is a runtime value; the method name is a
 *                        leaf-name match, the owning class is not known here
 *   concrete-invocant    the invocant names a package, but the constructor that
 *                        will run is resolved at runtime
 *   use-parent-declaration  inheritance read from `use parent`/`use base` text
 *                        in this file, first base only
 *   isa-array            inheritance read from an `@ISA`/`$ISA` assignment
 *   mojo-base-declaration  inheritance read from `use Mojo::Base 'Base'`
 *   moo-role-composition  role composition read from `with`
 *   use-role-composition  role composition read from `use role`
 *   base-declares-method  the override target was CONFIRMED: the base declares
 *                        the same-named method (in-file or companion index)
 *   first-parent-guess   the base does not declare it anywhere visible; the edge
 *                        is the deterministic first-parent guess
 */
export const PERL_REASON_CODES = {
  nameOnlyCallee: "name-only-callee",
  dynamicReceiver: "dynamic-receiver",
  concreteInvocant: "concrete-invocant",
  useParentDeclaration: "use-parent-declaration",
  isaArray: "isa-array",
  mojoBaseDeclaration: "mojo-base-declaration",
  mooRoleComposition: "moo-role-composition",
  useRoleComposition: "use-role-composition",
  baseDeclaresMethod: "base-declares-method",
  firstParentGuess: "first-parent-guess",
  magicTokenInvocant: "magic-token-invocant",
} as const

/** Stable alias used across the analyzer. */
const REASON = PERL_REASON_CODES

function perlFindChildByType(node: Node, type: string): Node | undefined {
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i)
    if (child?.type === type) return child
  }
  return undefined
}

/** The words a node contributes — a module path or a list element. */
export function perlWordValues(node: Node): string[] {
  if (node.type === "string_content" || node.type === "autoquoted_bareword" || node.type === "bareword" || node.type === "package") return node.text ? splitWords(node.text) : []
  if (node.type === "quoted_word_list") {
    const content = node.childForFieldName("content") || perlFindChildByType(node, "string_content")
    return content ? splitWords(content.text) : []
  }
  if (node.type === "string_literal") {
    const content = node.childForFieldName("content") || perlFindChildByType(node, "string_content")
    return [content ? content.text : unquote(node.text)]
  }
  if (node.type === "interpolated_string_literal") {
    // A DOUBLE-quoted literal. Its words are the `string_content` pieces; the
    // interpolated VARIABLES are payload and must never become words, or
    // `use lib "./t/lib"` would publish `$dir` as an imported name. Unread
    // before this wave, so every double-quoted argument lost its items —
    // `use feature "class"`, `use lib "./t/lib"`, `use warnings "once"`.
    const values: string[] = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue
      if (child.type === "string_content" || child.type === "noninterpolated_string_content") {
        for (const w of splitWords(child.text)) values.push(w)
      }
    }
    return values
  }
  const values: string[] = []
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i)
    if (child) values.push(...perlWordValues(child))
  }
  return values
}

/** Strip one layer of matching quotes by INDEX, not by pattern: the lane's
 *  documented contract is zero regexes, and the grammar already exposes the
 *  unquoted text under `content` on every shape that needs this. */
function unquote(text: string): string {
  if (text.length >= 2) {
    const first = text[0]
    const last = text[text.length - 1]
    if ((first === "'" && last === "'") || (first === '"' && last === '"')) return text.slice(1, -1)
  }
  return text
}

function splitWords(text: string): string[] {
  const result: string[] = []
  let current = ""
  for (const char of text) {
    if (char === " " || char === "\t" || char === "\n" || char === ",") {
      if (current) result.push(current)
      current = ""
    } else current += char
  }
  if (current) result.push(current)
  return result
}

/**
 * The argument nodes of a call or `use`, across BOTH live grammar generations
 * (see the class's own comment for the measured shape of each). EXPORTED
 * because script/m14/differential.ts's perl oracle must read arguments by the
 * SAME rule: when the oracle had its own copy, the two disagreed on the
 * non-parenthesised `use Module 'Name'` form (the payload carries no field under
 * 1.2.1), and 47 of mojo's unexplained inheritance rows were that divergence
 * rather than any defect in either side.
 */
export function perlArgumentNodes(node: Node): Node[] {
  const module = node.childForFieldName("module")
  const fromField: Node[] = []
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child && node.fieldNameForChild(i) === "arguments" && perlWordValues(child).length > 0) fromField.push(child)
  }
  if (fromField.length) return fromField
  const list = perlFindChildByType(node, "list_expression")
  if (list) return list.namedChildren.filter((c): c is Node => !!c && perlWordValues(c).length > 0)
  const result: Node[] = []
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i)
    if (!child || child === module) continue
    if (child.type === "string_literal" || child.type === "interpolated_string_literal" || child.type === "quoted_word_list" || child.type === "autoquoted_bareword" || child.type === "parenthesized_expression") {
      if (perlWordValues(child).length > 0) result.push(child)
    }
  }
  return result
}

/**
 * Perl extraction follows the stable AST contract, read entirely from the
 * pinned tree-sitter-perl grammar's own fields:
 *
 *   symbols       packages (`package NAME` in BOTH forms), `class NAME` and
 *                 `role NAME` blocks, named subs (`sub`/`method`), package
 *                 globals (`our`), Exporter arrays (`@EXPORT`, `@EXPORT_OK`,
 *                 `%EXPORT_TAGS`), `use constant` names, Moose/Moo attributes
 *                 (`has`), and 5.38 class fields (`field`)
 *   relationships inheritance (`use parent`/`use base`/`use Mojo::Base`,
 *                 `@ISA`/`$ISA`), role composition (`with`/`use role`),
 *                 constructor calls, method/function calls, ownership
 *                 (`contains`), and companion-backed overrides
 *   imports       `use Module ...` (never `no`, which DISABLES a feature) and
 *                 `require Module` at runtime; a `use VERSION` requirement is
 *                 a language-version constraint, recorded as metadata
 *
 * Deliberately NOT symbols: lexical locals (`my`/`state`/`field` outside a
 * class body), plain parameters, anonymous subs, and expression payload.
 *
 * Every declaration kind, name, signature and attribute is read from a grammar
 * NODE TYPE or FIELD — never from `node.text` matching. Every relationship
 * that corresponds to a source construct carries that construct's 1-based
 * `line_number`; relationships with no single source construct (ownership
 * `contains`, inferred `overrides`) carry none rather than a fabricated one.
 */
export class RealPerlAnalyzer implements ASTEngine.LanguageAnalyzer {
  analyze(
    rootNode: Node,
    content: string,
    _filePath: string,
    context?: ASTEngine.AnalyzeContext,
  ): Omit<ASTEngine.ParseResult, "language" | "metadata"> & { metadata?: Partial<ASTEngine.FileMetadata> } {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const errors: ASTEngine.ParseError[] = []
    const frameworks = new Set<string>(["Perl"])
    const patterns = new Set<string>()
    const symbolKeys = new Set<string>()
    const symbolsByKey = new Map<string, ASTEngine.UniversalSymbol>()
    const relationshipKeys = new Set<string>()
    const packageBases = new Map<string, string[]>()
    const packageBaseOrigin = new Map<string, string>()
    /** The node that NAMES each (owner, base) pair, so the `extends` edge
     *  emitted in the post-walk pass can carry that construct's line instead of
     *  arriving line-less while every other source-backed edge carries one. */
    const packageBaseLine = new Map<string, Node>()
    const packageMethods = new Map<string, Set<string>>()
    const deferredIsa: { owner: string; right: Node }[] = []
    const versionRequirements: string[] = []

    if (!rootNode) return this.result(symbols, relationships, imports, exports, errors, content, frameworks, patterns)

    this.collectErrors(rootNode, errors)

    /** What encloses the node being walked — a package block, a 5.38 class or
     *  role body, or plain file scope. `field` only declares a property inside
     *  a class/role body; anywhere else it is a lexical. */
    type BodyKind = "file" | "package" | "class" | "role"
    type WalkState = {
      packageName: string
      ownerName?: string
      ownerKind?: ASTEngine.SymbolKind
      functionName?: string
      insideFunction: boolean
      visibility: string
      bodyKind: BodyKind
    }

    const addSymbol = (
      name: string,
      kind: ASTEngine.SymbolKind,
      node: Node,
      state: WalkState,
      extra: Record<string, unknown> = {},
      ownerOverride?: string,
    ): ASTEngine.UniversalSymbol | undefined => {
      if (!name) return undefined
      const owner = ownerOverride ?? state.ownerName
      const key = `${kind}\u001f${owner || ""}\u001f${name}`
      if (symbolKeys.has(key)) return symbolsByKey.get(key)
      const symbol: ASTEngine.UniversalSymbol = {
        name,
        kind,
        range: this.nodeToRange(node),
        scope: owner || state.packageName || undefined,
        ownerName: owner,
        ownerKind: owner ? state.ownerKind : undefined,
        visibility: state.visibility,
        metadata: { perlSpecific: true, ...extra },
      }
      symbolKeys.add(key)
      symbolsByKey.set(key, symbol)
      symbols.push(symbol)
      return symbol
    }

    /**
     * M59.A7 (#825): `lineNode` is the node that NAMES the edge — the callee
     * leaf, the invocant, the heritage word. The 1-based line of THAT node is
     * the edge's `line_number`, never the enclosing construct's line and never
     * a fabricated 0. Callers with no single naming node (ownership `contains`,
     * an inferred override) pass nothing and the field is absent, which is the
     * honest value.
     */
    const addRelationship = (
      source: string,
      target: string,
      type: ASTEngine.RelationshipType,
      metadata: Record<string, unknown> = {},
      confidence = 0.9,
      lineNode?: Node,
    ) => {
      if (!source || !target) return
      const key = `${type}\u001f${source}\u001f${target}`
      if (relationshipKeys.has(key)) return
      relationshipKeys.add(key)
      relationships.push({
        source,
        target,
        type,
        confidence,
        ...(lineNode ? { line_number: lineNode.startPosition.row + 1 } : {}),
        metadata: { perlSpecific: true, ...metadata },
      })
    }

    /**
     * Record a package's base classes. First base wins for override
     * resolution, and `packageBaseOrigin` remembers WHICH declaration
     * established it so the emitted edge's reason code names the real source
     * (`use parent` vs `use base` vs `@ISA` vs `use Mojo::Base`) instead of a
     * generic "Perl inheritance".
     */
    const addBase = (owner: string, parents: string[], reasonCode: string, nameNode?: Node) => {
      const existing = packageBases.get(owner) || []
      for (const parent of parents) {
        if (!parent) continue
        if (!existing.includes(parent)) {
          existing.push(parent)
          if (!packageBaseOrigin.has(owner)) packageBaseOrigin.set(owner, reasonCode)
        }
        if (nameNode && !packageBaseLine.has(`${owner}\u001f${parent}`)) packageBaseLine.set(`${owner}\u001f${parent}`, nameNode)
      }
      packageBases.set(owner, existing)
    }

    const addCall = (target: string, state: WalkState, calleeNode: Node, dynamicReceiver: boolean) => {
      if (!target || PERL_BUILTINS.has(target) || target === "use" || target === "no") return
      addRelationship(
        state.functionName || state.ownerName || state.packageName || "global",
        this.leafName(target),
        ASTEngine.RelationshipType.Calls,
        { reasonCode: dynamicReceiver ? REASON.dynamicReceiver : REASON.nameOnlyCallee },
        0.9,
        calleeNode,
      )
    }

    const walk = (node: Node, state: WalkState): void => {
      switch (node.type) {
        case "package_statement": {
          // `name` is the grammar's field for the package name; the `package`
          // keyword is an UNNAMED token, so a bare type search would be a guess.
          const nameNode = node.childForFieldName("name") ?? undefined
          const name = nameNode?.text || ""
          if (!name) break
          const kind = ASTEngine.SymbolKind.Class
          // The symbol's range is the NAME, not the statement: in the block
          // form (`package Outer { ... }`) the statement node spans every
          // method in the block, which made the package symbol cover its own
          // members and put its end line on the last one.
          // `packageName: name` so the symbol's SCOPE is itself. Passing the
          // incoming state made a package declared after another package adopt
          // the PREVIOUS one's scope (`package SelfNamed;` reported
          // `scope: IsaArray`) — the namespace a class belongs to is the class.
          addSymbol(name, kind, nameNode ?? node, { ...state, packageName: name }, { isPackage: true })
          patterns.add("Packages")

          const block = node.childForFieldName("body") || this.findChildByType(node, "block")
          if (block) {
            // BLOCK form: the package applies ONLY inside the braces. The
            // lexical package after the block is unchanged — proved against
            // perl 5.34 itself (`package Outer { } sub after {}; print
            // __PACKAGE__` prints `main`, the analyzer used to say `Outer`).
            walkChildren(block, {
              ...state,
              packageName: name,
              ownerName: name,
              ownerKind: kind,
              insideFunction: false,
              bodyKind: "package",
            })
          } else {
            // STATEMENT form: `package NAME;` changes the lexical package for
            // every following sibling. The sequential child loop below passes
            // this state by reference, so the mutation is the mechanism.
            state.packageName = name
          }
          return
        }

        case "class_statement":
        case "role_statement": {
          // Perl 5.38 core OO. `class NAME { }` / `role NAME { }` are blocks:
          // the class body owns its methods and fields, and the lexical package
          // does not leak past the closing brace (same rule as `package`).
          const nameNode = node.childForFieldName("name") ?? undefined
          const name = nameNode?.text || ""
          if (!name) break
          const isRole = node.type === "role_statement"
          const kind = isRole ? ASTEngine.SymbolKind.Trait : ASTEngine.SymbolKind.Class
          addSymbol(name, kind, nameNode ?? node, { ...state, packageName: name }, isRole ? { isPerlRole: true } : { isPerlClass: true })
          patterns.add(isRole ? "Roles" : "Classes")
          frameworks.add("Perl 5.38 core OO")
          const block = node.childForFieldName("body") || this.findChildByType(node, "block")
          if (block) {
            walkChildren(block, {
              ...state,
              packageName: name,
              ownerName: name,
              ownerKind: kind,
              insideFunction: false,
              bodyKind: isRole ? "role" : "class",
            })
          }
          return
        }

        case "subroutine_declaration_statement":
        case "method_declaration_statement": {
          if (state.insideFunction) {
            // Named subs nested in a closure are not stable package API symbols,
            // but their body can still contain useful calls.
            const nestedBody = node.childForFieldName("body") || this.findChildByType(node, "block")
            if (nestedBody) walkChildren(nestedBody, { ...state, insideFunction: true })
            return
          }
          const nameNode = node.childForFieldName("name") || this.findChildByType(node, "bareword")
          const rawName = nameNode?.text || ""
          if (!rawName) break
          const isConstructor = rawName === "new"
          const name = isConstructor ? "constructor" : rawName
          const owner = state.packageName || state.ownerName
          const kind = isConstructor ? ASTEngine.SymbolKind.Constructor : owner ? ASTEngine.SymbolKind.Method : ASTEngine.SymbolKind.Function
          const symbol = addSymbol(name, kind, node, {
            ...state,
            ownerName: owner,
            ownerKind: owner ? ASTEngine.SymbolKind.Class : undefined,
          }, {
            originalName: rawName,
            isMethod: !!owner,
            isConstructor,
          }, owner)
          if (symbol) {
            symbol.parameters = this.extractParameters(node)
            symbol.ownerKind = owner ? ASTEngine.SymbolKind.Class : undefined
            // `sub f :lvalue :method($self)` — the grammar's `attributes` field.
            // The AST contract's carrier for these is `decorators`, which the
            // production pool worker already forwards to brain_symbol.
            const decorators = this.extractAttributes(node)
            if (decorators.length) symbol.decorators = decorators
          }
          if (owner && symbol) {
            let methodSet = packageMethods.get(owner)
            if (!methodSet) {
              methodSet = new Set<string>()
              packageMethods.set(owner, methodSet)
            }
            methodSet.add(rawName)
          }
          const body = node.childForFieldName("body") || this.findChildByType(node, "block")
          if (body) walkChildren(body, { ...state, ownerName: owner, ownerKind: owner ? ASTEngine.SymbolKind.Class : undefined, functionName: name, insideFunction: true })
          return
        }

        case "variable_declaration": {
          // The scope is a NAMED CHILD NODE TYPE (`our`/`my`/`state`/`field`),
          // never a prefix of the statement text: `variable_declaration` has
          // no `scope` field, and text-prefix matching mis-reads a declaration
          // whose first statement begins with a comment or a newline.
          const declaration = this.declarationKind(node)
          patterns.add("Variable Declarations")
          const inClassBody = state.bodyKind === "class" || state.bodyKind === "role"
          // `our` at file/package scope is a package global — a stable symbol.
          // `field` directly in a 5.38 class/role body is that class's
          // instance state: the same concept as a Moose `has` attribute, so it
          // is a Property owned by the class. `my`/`state` are lexical, and
          // `field` anywhere else (a method body) is lexical too.
          const isPackageGlobal = declaration === "our" && !state.insideFunction
          const isClassField = declaration === "field" && inClassBody && !state.insideFunction
          if (!isPackageGlobal && !isClassField) break
          for (const variable of this.variableChildren(node)) {
            const varNameNode = this.findChildByType(variable, "varname")
            const rawName = varNameNode?.text || ""
            const name = this.stripSigil(rawName)
            if (!name || name === "_") continue
            if (isClassField) {
              addSymbol(name, ASTEngine.SymbolKind.Property, variable, state, { isPerlField: true, perlDeclType: declaration, sigil: variable.type }, state.packageName || state.ownerName)
              continue
            }
            // `@ISA`/`$ISA` is the inheritance mechanism itself, not an
            // application constant; it is reported as a Variable so a user
            // searching for constants is not handed an inheritance table.
            const kind = name === "ISA" ? ASTEngine.SymbolKind.Variable : this.isAllCapsName(name) ? ASTEngine.SymbolKind.Constant : ASTEngine.SymbolKind.Variable
            addSymbol(name, kind, variable, state, { perlDeclType: declaration, sigil: variable.type, ...(name === "ISA" ? { isInheritanceVariable: true } : {}) }, state.packageName || undefined)
          }
          break
        }

        case "use_statement": {
          // `no` is an UNNAMED first token of the same node type as `use`:
          // `no strict;` parses as a use_statement whose first child is `no`.
          // It DISABLES a feature, so recording it as a dependency import
          // invents a dependency edge on a file that never loads the module.
          if (node.child(0)?.type === "no") break
          const moduleNode = node.childForFieldName("module") ?? undefined
          const module = moduleNode?.text || ""
          if (!module) break
          if (module === "constant") {
            // `use constant NAME => value` / `use constant { A => 1, B => 2 }`
            // declares compile-time constants. Each fat-comma KEY is a name;
            // the values are payload. This is a declaration, not a dependency,
            // so it emits Constants and no import.
            for (const constant of this.constantDeclarationNames(node)) {
              addSymbol(constant.name, ASTEngine.SymbolKind.Constant, constant.node, state, { isPerlConstant: true }, state.packageName || undefined)
            }
            patterns.add("Constants")
            frameworks.add("Compile-time Constants")
            break
          }
          const args = this.argumentValues(node)
          imports.push({
            module,
            items: args.length > 0 ? args : ["*"],
            isDefault: true,
            range: this.nodeToRange(node),
            metadata: { perlSpecific: true, type: "use" },
          })
          patterns.add("Module Includes")
          if (module === "Moose" || module === "Moo" || module === "Mojo::Base") frameworks.add(module === "Mojo::Base" ? "Mojolicious" : "Moose/Moo OOP")
          if (module === "parent" || module === "base") {
            const parents = args.filter((arg) => !this.isOption(arg))
            if (state.packageName) addBase(state.packageName, parents, REASON.useParentDeclaration, moduleNode)
          } else if (module === "role") {
            // `use role 'R'` is the pre-`with` spelling of the same
            // composition; without it the role is an undeclared dependency.
            for (const arg of args) {
              if (this.isOption(arg)) continue
              addRelationship(state.packageName || "global", this.leafName(arg), ASTEngine.RelationshipType.Implements, { reasonCode: REASON.useRoleComposition }, 0.9, moduleNode)
            }
            if (state.packageName) frameworks.add("Moose/Moo OOP")
          }
          if (module === "Mojo::Base" && state.packageName) {
            // `use Mojo::Base 'Base::Class';` names the parent outright.
            // `use Mojo::Base -base;` / `-strict` / `-utf8` pass only FLAGS, and
            // the class being subclassed is Mojo::Base ITSELF — the pre-review
            // rule skipped every option-bearing form, so 53 of mojo's 118
            // inheritance sites (the `-base` form, used by every Controller and
            // Plugin) produced no edge at all.
            const named = args.find((arg) => arg && !this.isOption(arg))
            addBase(state.packageName, [named ?? module], REASON.mojoBaseDeclaration, moduleNode)
          }
          return
        }

        case "use_version_statement": {
          // `use 5.010;` / `use v5.36;` — a LANGUAGE VERSION requirement, not a
          // module dependency. It is recorded as file metadata; emitting an
          // import named "5.010" would put a fake module in the dependency
          // graph and in every "unused import" report.
          const versionNode = node.childForFieldName("version")
          const version = versionNode?.text || ""
          if (version) {
            versionRequirements.push(version)
            patterns.add("Version Requirements")
          }
          return
        }

        case "require_expression": {
          // `require Some::Module` — a runtime load. It IS a dependency (the
          // file cannot run without it) but imports nothing into the namespace,
          // so isDefault is false.
          const moduleNode = this.findChildByType(node, "bareword") || this.findChildByType(node, "package")
          const module = moduleNode?.text || ""
          if (!module) break
          imports.push({
            module,
            items: [],
            isDefault: false,
            range: this.nodeToRange(node),
            metadata: { perlSpecific: true, type: "require" },
          })
          patterns.add("Module Includes")
          return
        }

        case "require_version_expression": {
          const versionNode = node.childForFieldName("version") || this.findChildByType(node, "number")
          const version = versionNode?.text || ""
          if (version) {
            versionRequirements.push(version)
            patterns.add("Version Requirements")
          }
          return
        }

        case "assignment_expression": {
          // `left`/`right` are MULTI-CHILD fields in this grammar: a
          // parenthesised right side shares the field across `(`, the payload
          // and `)`. Reading one child took the empty bracket marker and
          // silently lost every `our @EXPORT_OK = (...)` / `our $ISA = (...)`.
          const lefts = this.fieldNodes(node, "left")
          const rights = this.fieldNodes(node, "right")
          const leftVar = lefts.flatMap((l) => this.variableChildren(l).map((variable) => this.findChildByType(variable, "varname")).find(Boolean)).find(Boolean)
          const leftName = leftVar?.text || ""
          const right = rights.find((r) => r.isNamed && r.namedChildCount > 0) ?? rights[0]
          if (leftName === "ISA" && right && state.packageName) deferredIsa.push({ owner: state.packageName, right })
          if (right && (leftName === "EXPORT" || leftName === "EXPORT_OK")) {
            // `@EXPORT` and `@EXPORT_OK` are the Exporter's symbol arrays: the
            // words in them ARE the module's exported API. Reading only
            // `@EXPORT` lost the whole optional half of every Exporter module.
            for (const exported of this.wordValues(right)) {
              exports.push({ name: exported, kind: ASTEngine.SymbolKind.Function, range: this.nodeToRange(node), metadata: { perlSpecific: true, exportArray: leftName } })
            }
            patterns.add("Exports")
          }
          if (leftName === "EXPORT_TAGS" && right) {
            // `%EXPORT_TAGS = (tag => \@NAMES)` — the fat-comma KEYS are the
            // opt-in tag names callers pass to `import`.
            for (const tag of this.fatCommaKeys(right)) {
              exports.push({ name: tag.text, kind: ASTEngine.SymbolKind.Function, range: this.nodeToRange(node), metadata: { perlSpecific: true, exportTag: "EXPORT_TAGS" } })
            }
            patterns.add("Exports")
          }
          break
        }

        case "ambiguous_function_call_expression":
        case "function_call_expression": {
          const functionNode = node.childForFieldName("function") || this.findChildByType(node, "function")
          const target = functionNode?.text || ""
          if (target === "has") {
            // `has 'name' => (...)` — the attribute NAME is the first argument;
            // the symbol's range must be that name, not the whole statement.
            const nameNode = this.firstArgumentNameNode(node)
            const property = nameNode ? this.wordValues(nameNode)[0] : undefined
            if (property && state.packageName && !symbolKeys.has(`${ASTEngine.SymbolKind.Property}\u001f${state.packageName}\u001f${property}`)) {
              addSymbol(property, ASTEngine.SymbolKind.Property, nameNode ?? node, { ...state, ownerName: state.packageName, ownerKind: ASTEngine.SymbolKind.Class }, { isMooseProperty: true }, state.packageName)
            }
            frameworks.add("Moose/Moo OOP")
            patterns.add("Declarative Properties")
          } else if (target === "with" || target === "extends") {
            const isWith = target === "with"
            for (const arg of this.argumentNodes(node)) {
              const value = this.wordValues(arg)[0]
              if (!value) continue
              addRelationship(
                state.packageName || "global",
                this.leafName(value),
                isWith ? ASTEngine.RelationshipType.Implements : ASTEngine.RelationshipType.Extends,
                { reasonCode: isWith ? REASON.mooRoleComposition : REASON.useParentDeclaration, mooseKeyword: target },
                0.9,
                arg,
              )
            }
            frameworks.add("Moose/Moo OOP")
          } else if (target === "new") {
            const requestedType = this.firstValue(node)
            const instanceTarget = requestedType && !requestedType.includes("$") ? `${this.leafName(requestedType)}.constructor` : "constructor"
            addRelationship(state.functionName || state.packageName || "global", instanceTarget, ASTEngine.RelationshipType.Instantiates, { isConstructor: true, reasonCode: REASON.concreteInvocant }, 0.9, node)
          } else {
            addCall(target, state, functionNode ?? node, false)
          }
          break
        }

        case "method_call_expression": {
          const methodNode = this.findChildByType(node, "method")
          const method = methodNode?.text || ""
          if (method === "new") {
            // `invocant` is multi-child for a parenthesised receiver
            // `(Foo)->new` / `($self || $other)->new`; the bracket markers
            // carry no name, so the first NAMED child is the receiver.
            const invocant = this.fieldNodes(node, "invocant").find((c) => c.isNamed) ?? this.firstNamedChild(node)
            const target = invocant ? this.invocantName(invocant) : ""
            if (target && PERL_MAGIC_TOKENS.has(target)) {
              // `__PACKAGE__->new` IS a constructor call, but `__PACKAGE__` is a
              // compile-time token for the CURRENT package, not a class: naming
              // it produced a phantom `__PACKAGE__.constructor` type (measured on
              // mojo's examples/fast.pl). The honest target is the package the
              // token stands for, and where there is no package to name it, the
              // edge is not derivable and is not emitted.
              const owner = state.packageName
              if (owner && owner !== "main") addRelationship(state.functionName || owner, `${this.leafName(owner)}.constructor`, ASTEngine.RelationshipType.Instantiates, { isConstructor: true, reasonCode: REASON.magicTokenInvocant }, 0.9, invocant ?? node)
            } else if (target && !target.includes("$") && !target.includes("->")) {
              // A concrete package invocant is resolvable; a scalar or chained
              // method receiver is dynamic and must not become a phantom type.
              addRelationship(state.functionName || state.packageName || "global", `${this.leafName(target)}.constructor`, ASTEngine.RelationshipType.Instantiates, { isConstructor: true, reasonCode: REASON.concreteInvocant }, 0.9, invocant ?? node)
            }
          } else {
            // `$obj->method` — the receiver is a runtime value, so the target is
            // a leaf-name match. The line is the METHOD node, which is where the
            // call is written (not the line the chain opened on).
            addCall(method, state, methodNode ?? node, true)
          }
          break
        }
      }

      if (node.type !== "source_file") {
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i)
          if (child) walk(child, state)
        }
      }
    }

    const walkChildren = (container: Node, state: WalkState): void => {
      for (let i = 0; i < container.namedChildCount; i++) {
        const child = container.namedChild(i)
        if (child) walk(child, state)
      }
    }

    // Source-file children are intentionally visited in order because a
    // non-block package declaration changes the active Perl package.
    const rootState: WalkState = { packageName: "", insideFunction: false, visibility: "public", bodyKind: "file" }
    if (rootNode.type === "source_file") walkChildren(rootNode, rootState)
    else walk(rootNode, rootState)

    for (const item of deferredIsa) {
      const parents = this.wordValues(item.right)
      if (parents.length) addBase(item.owner, parents, REASON.isaArray, item.right)
    }

    for (const [owner, bases] of packageBases) {
      const origin = packageBaseOrigin.get(owner) ?? REASON.useParentDeclaration
      for (const base of bases) {
        // A class that names ITSELF as its own base (`use Mojo::Base 'Mojo::Base'`
        // inside package Mojo::Base) is a real self-reference in the source but
        // a useless edge in a graph, and it would be the only edge that makes
        // `extends` non-reflexive. Compared on the FULL name: a leaf comparison
        // also fires for `package Foo::Bar; use Mojo::Base 'Other::Bar';`, which
        // is a real inheritance edge between two different classes.
        if (base === owner) continue
        addRelationship(
          owner,
          this.leafName(base),
          ASTEngine.RelationshipType.Extends,
          { via: "Perl inheritance", reasonCode: origin },
          0.9,
          packageBaseLine.get(`${owner}\u001f${base}`),
        )
      }
    }

    // Resolve overrides against local declarations first, then the project
    // companion index supplied by the production/differential caller.
    for (const symbol of symbols) {
      if ((symbol.kind !== ASTEngine.SymbolKind.Method && symbol.kind !== ASTEngine.SymbolKind.Constructor) || !symbol.ownerName) continue
      const base = packageBases.get(symbol.ownerName)?.[0]
      if (!base) continue
      const baseLeaf = this.leafName(base)
      // A class whose own FULLY QUALIFIED name is its declared base
      // (`use Mojo::Base 'SelfNamed'` inside `package SelfNamed`) would produce
      // the edge `SelfNamed.run -> SelfNamed.run` — an override of a method by
      // itself, true of the source and useless in a graph.
      //
      // The comparison is on the FULL name, never the leaf. A leaf comparison
      // looks equivalent and is not: `package MojoliciousTest3::Baz; use Mojo::Base
      // 'Mojolicious::Baz';` is a real subclass of a DIFFERENT class whose leaf
      // collides with the subclass's own leaf, and a leaf guard deleted every
      // such override (the F5 differential named 7 of them across mojo and plack:
      // MojoliciousTest3::Baz.index -> Baz.index, Test::Controller.render ->
      // Controller.render, Plack::Handler::HTTP::Server::PSGI.run -> PSGI.run).
      if (base === symbol.ownerName) continue
      const method = String(symbol.metadata?.originalName || symbol.name)
      const candidateNames = [method, symbol.name]
      const localMethods = packageMethods.get(base) || packageMethods.get(baseLeaf)
      const companionMethods = context?.overrideCompanion?.get(base) || context?.overrideCompanion?.get(baseLeaf)
      const localDeclares = candidateNames.some((candidate) => localMethods?.has(candidate))
      const companionDeclares = candidateNames.some((candidate) => companionMethods?.has(candidate))
      if (localDeclares || companionDeclares) {
        addRelationship(`${symbol.ownerName}.${method}`, `${baseLeaf}.${method}`, ASTEngine.RelationshipType.Overrides, { isOverride: true, reasonCode: REASON.baseDeclaresMethod }, 0.95)
      } else if (!context?.overrideCompanion) {
        // Pass 3 (family parity with java/groovy resolveOverrides): the base
        // is not declared in this file and no companion index was supplied
        // (production callers never populate one — see M37.10). Emit the
        // deterministic first-parent guess BELOW the patterns.ts threshold
        // (0.7): visible in raw output, counted as heuristic (honest
        // suspicion) by the differential. Pre-M37.10 this edge was silently
        // dropped for every externally-declared base package.
        addRelationship(`${symbol.ownerName}.${method}`, `${baseLeaf}.${method}`, ASTEngine.RelationshipType.Overrides, { isOverride: true, reasonCode: REASON.firstParentGuess }, 0.5)
      }
    }

    // Stable ownership edges are generated once, after extraction. They have no
    // single naming node in the source (the membership is a fact about the two
    // symbols), so they carry no line_number — declared, not fabricated.
    for (const symbol of symbols) {
      if (symbol.ownerName && symbol.ownerName !== symbol.name) addRelationship(symbol.ownerName, symbol.name, ASTEngine.RelationshipType.Contains, {}, 1.0)
    }

    const metadata: Partial<ASTEngine.FileMetadata> = {
      complexity: symbols.length + relationships.length,
      linesOfCode: this.lineCount(content),
      cyclomaticComplexity: this.countBranches(rootNode) + 1,
      framework: [...frameworks][0],
      detectedFrameworks: [...frameworks],
      patterns: [...patterns],
      frameworkPatterns: [...patterns].map((pattern) => ({ framework: "Perl", patterns: [{ type: "usage", detected: true, description: pattern }] })),
      architecturalInsights: [],
      architecturalScore: Math.max(0, 100 - errors.length * 5),
      codeQuality: errors.length === 0 ? "Excellent" : "Fair",
      hasTypeInference: false,
      hasFrameworkIntelligence: true,
      analysisVersion: "3.1.0-perl-ast",
      ...(versionRequirements.length ? { perlVersion: versionRequirements[0], perlVersions: versionRequirements } : {}),
    } as Partial<ASTEngine.FileMetadata>

    return { symbols, relationships, imports, exports, errors, metadata }
  }

  private result(
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    imports: ASTEngine.ImportInfo[],
    exports: ASTEngine.ExportInfo[],
    errors: ASTEngine.ParseError[],
    content: string,
    frameworks: Set<string>,
    patterns: Set<string>,
  ) {
    return {
      symbols,
      relationships,
      imports,
      exports,
      errors,
      metadata: {
        complexity: symbols.length + relationships.length,
        linesOfCode: this.lineCount(content),
        cyclomaticComplexity: 1,
        framework: [...frameworks][0],
        detectedFrameworks: [...frameworks],
        patterns: [...patterns],
        frameworkPatterns: [],
        architecturalInsights: [],
        architecturalScore: Math.max(0, 100 - errors.length * 5),
        codeQuality: errors.length === 0 ? "Excellent" : "Fair",
        hasTypeInference: false,
        hasFrameworkIntelligence: true,
        analysisVersion: "3.1.0-perl-ast",
      },
    }
  }

  private collectErrors(root: Node, errors: ASTEngine.ParseError[]): void {
    const stack: Node[] = [root]
    while (stack.length > 0) {
      const node = stack.pop()!
      if (node.type === "ERROR" || node.isMissing) {
        errors.push({ message: `Syntax ${node.type} detected.`, range: this.nodeToRange(node), severity: "warning" })
      }
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (child) stack.push(child)
      }
    }
  }

  /**
   * ALL children carrying `name` as their field.
   *
   * The pinned grammar gives one field name to SEVERAL children whenever a
   * construct is parenthesised: `our @EXPORT_OK = (a => 1, b => 2)` puts `(`,
   * the `list_expression` and `)` ALL under the `right` field, so
   * `childForFieldName("right")` returns the EMPTY `(` marker. Measured over
   * mojo+Moose+DBI+plack: `assignment_expression.right` 1,593 sites,
   * `ambiguous_function_call_expression.arguments` 1,058,
   * `method_call_expression.invocant` 168, `function_call_expression.arguments`
   * 3, `method_call_expression.arguments` 36 — every one of them lost by the
   * single-child read. `variable_declaration` additionally spells the paren form
   * `variables` (plural) against the bare form `variable`, 14,272 sites.
   */
  private fieldNodes(node: Node, name: string): Node[] {
    const out: Node[] = []
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child && node.fieldNameForChild(i) === name) out.push(child)
    }
    return out
  }

  /**
   * The declared variables of a `variable_declaration`. The bare form
   * (`our $VERSION`) spells the field `variable`; the parenthesised form
   * (`our ($x, $y) = ...`) spells it `variables`, so BOTH are read.
   */
  private variableChildren(node: Node): Node[] {
    const result: Node[] = []
    for (const child of [...this.fieldNodes(node, "variable"), ...this.fieldNodes(node, "variables")]) {
      if (child.type === "scalar" || child.type === "array" || child.type === "hash") result.push(child)
    }
    return result
  }

  /**
   * The declaration scope, read from the grammar's own scope node.
   *
   * `variable_declaration` declares NO `scope` field: `our`/`my`/`state`/`field`
   * are CHILD NODES of the declaration. The pre-review implementation matched
   * `node.text.startsWith("our ")` — source text doing a syntax job, which
   * mis-reads any declaration whose keyword is followed by a newline or whose
   * text begins with something else.
   *
   * Those scope tokens are UNNAMED (`node.isNamed === false`, no field), so the
   * scan walks the RAW child list. A named-child scan silently finds nothing
   * and every `our` global in the corpus would vanish — the 2,379 constants
   * measured on the pre-review corpus all came from the text prefix.
   */
  private declarationKind(node: Node): string {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (!child) continue
      if (child.type === "our" || child.type === "my" || child.type === "state" || child.type === "field") return child.type
    }
    return "unknown"
  }

  /**
   * The argument nodes of a call or `use`.
   *
   * Two grammar generations have to be read here, and both are live:
   *  - 1.2.1 (the WIRED build): the `arguments` field is MULTI-CHILD — a
   *    parenthesised argument list spreads one field across `(`, the payload
   *    and `)`, so `childForFieldName` returns the empty bracket marker.
   *    Measured on 5,875 corpus files: 39,897 such sites over 41 field pairs.
   *  - 2.0.0: the paren is a `parenthesized_expression` NODE, and on a
   *    `use_statement` it carries NO field at all — so a field-driven read sees
   *    nothing and the whole import list disappears.
   *
   * Reading every child that yields words, and descending through the paren
   * wrapper, is correct under BOTH: measured over the same 5,875 files, the
   * analyzer's emissions are then identical under a 1.2.1 build and a 2.0.0
   * build on 5,875 of 5,875 files, so a grammar bump needs no analyzer work.
   */
  private argumentNodes(node: Node): Node[] {
    return perlArgumentNodes(node)
  }

  /** The node carrying an argument's NAME — `has 'x' => ...` / `has x => ...`. */
  private firstArgumentNameNode(node: Node): Node | undefined {
    const args = this.argumentNodes(node)
    const first = args[0]
    if (!first) return undefined
    if (first.type === "string_literal") return first.childForFieldName("content") || this.findChildByType(first, "string_content") || first
    return first
  }

  private argumentValues(node: Node): string[] {
    const module = node.childForFieldName("module")
    if (module && module.type !== "package") return this.wordValues(module)
    const values: string[] = []
    for (const arg of this.argumentNodes(node)) values.push(...this.wordValues(arg))
    return values
  }

  /**
   * The fat-comma KEYS of a list: the named child immediately followed by a
   * `=>` token. Read from the child list, so `A => 1, B => 2` yields A and B
   * and never the values.
   */
  private fatCommaKeys(node: Node): Node[] {
    // `use constant A => 1;`         -> use_statement > list_expression
    // `use constant { A => 1, B => 2 };` -> use_statement > anonymous_hash_expression > list_expression
    // The two forms differ by ONE level of anonymous_hash_expression, and
    // findChildByType searches direct named children only, so the shallow
    // lookup missed the brace form entirely. The pre-fix code carried an
    // `else if (node.type === "anonymous_hash_expression")` branch that was
    // unreachable: the caller passes the use_statement, never the hash. So
    // every brace-form `use constant` declared ZERO constants -- 2 files and
    // every constant in them, including Mojo::Util's PC_* table.
    let list: Node | undefined
    if (node.type === "list_expression") list = node
    else {
      list = this.findChildByType(node, "list_expression")
      if (!list) {
        const hash = this.findChildByType(node, "anonymous_hash_expression")
        if (hash) list = this.findChildByType(hash, "list_expression")
      }
    }
    if (!list) return []
    const keys: Node[] = []
    let pending: Node | null = null
    for (let i = 0; i < list.childCount; i++) {
      const child = list.child(i)
      if (!child) continue
      if (child.type === "=>") {
        if (pending) keys.push(pending)
        pending = null
        continue
      }
      pending = child.isNamed ? child : pending
    }
    return keys
  }

  /** Names declared by `use constant ...` — the fat-comma keys. */
  private constantDeclarationNames(node: Node): { name: string; node: Node }[] {
    const result: { name: string; node: Node }[] = []
    for (const key of this.fatCommaKeys(node)) {
      const name = this.wordValues(key)[0]
      if (name) result.push({ name, node: key })
    }
    return result
  }

  private wordValues(node: Node): string[] {
    return perlWordValues(node)
  }

  private firstValue(node: Node): string | undefined {
    const values = this.argumentValues(node)
    return values[0]
  }

  /**
   * M14 #863 REPAYMENT — the dead `childForFieldName("parameters")`.
   *
   * The pinned tree-sitter-perl grammar declares NO `parameters` field, so that
   * lookup returned undefined for every sub in every file and the lane shipped
   * 0 parameters across 29,640 symbols on 5,866 corpus files. A signature is the
   * `signature` FIELD, whose children are `mandatory_parameter`,
   * `optional_parameter` and `slurpy_parameter`; each wraps the
   * scalar/array/hash node that carries the `varname`.
   */
  private extractParameters(node: Node): ASTEngine.Parameter[] {
    const signature = node.childForFieldName("signature") || this.findChildByType(node, "signature")
    if (!signature) return []
    const result: ASTEngine.Parameter[] = []
    for (let i = 0; i < signature.namedChildCount; i++) {
      const param = signature.namedChild(i)
      if (!param) continue
      const kind = param.type
      if (kind !== "mandatory_parameter" && kind !== "optional_parameter" && kind !== "slurpy_parameter") continue
      const carrier = this.findChildByType(param, "scalar") || this.findChildByType(param, "array") || this.findChildByType(param, "hash")
      if (!carrier) continue
      const varname = this.findChildByType(carrier, "varname")
      if (!varname) continue
      result.push({ name: this.stripSigil(varname.text), isOptional: kind === "optional_parameter" })
    }
    return result
  }

  /** `sub f :lvalue :method` — the grammar's `attributes` field. */
  private extractAttributes(node: Node): string[] {
    const attrlist = node.childForFieldName("attributes") || this.findChildByType(node, "attrlist")
    if (!attrlist) return []
    const result: string[] = []
    for (let i = 0; i < attrlist.namedChildCount; i++) {
      const attribute = attrlist.namedChild(i)
      if (!attribute || attribute.type !== "attribute") continue
      const nameNode = attribute.childForFieldName("name") || this.findChildByType(attribute, "attribute_name")
      const name = nameNode?.text || ""
      if (name) result.push(name)
    }
    return result
  }

  private invocantName(node: Node): string {
    if (node.type === "scalar" || node.type === "array" || node.type === "hash") {
      // Keep the sigil: it distinguishes a dynamic variable receiver from a
      // concrete package invocant such as BaseService->new().
      return node.text
    }
    if (node.type === "function_call_expression" || node.type === "ambiguous_function_call_expression") {
      const fn = node.childForFieldName("function") || this.findChildByType(node, "function")
      return fn?.text || ""
    }
    return node.text
  }

  private isOption(value: string): boolean {
    return value.length > 0 && value[0] === "-"
  }

  private stripSigil(name: string): string {
    if (!name) return name
    const first = name[0]
    return first === "$" || first === "@" || first === "%" || first === "#" ? name.slice(1) : name
  }

  private leafName(name: string): string {
    const colon = name.lastIndexOf("::")
    return colon >= 0 ? name.slice(colon + 2) : name
  }

  private isAllCapsName(name: string): boolean {
    let hasLetter = false
    for (const char of name) {
      if (char >= "a" && char <= "z") return false
      if ((char >= "A" && char <= "Z") || (char >= "0" && char <= "9") || char === "_") hasLetter = true
    }
    return hasLetter
  }

  private findChildByType(node: Node, type: string): Node | undefined {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child?.type === type) return child
    }
    return undefined
  }

  private firstNamedChild(node: Node): Node | undefined {
    return node.namedChildCount > 0 ? (node.namedChild(0) || undefined) : undefined
  }

  /**
   * Cyclomatic decision points, counted from the pinned grammar's OWN node
   * types (probed: script/m14/tmp/perl-branch-shapes.ts).
   *
   * The pre-review set named `if_statement`, `unless_statement`,
   * `while_statement`, `until_statement`, `foreach_statement` and
   * `ternary_expression` — SIX literals the grammar does not declare, so only
   * `for_statement` and `conditional_expression` ever fired and
   * cyclomaticComplexity was 1 for almost every real file. This grammar spells
   * them `conditional_statement` (if/unless), `loop_statement` (while/until/
   * bare foreach), `for_statement`, `cstyle_for_statement`,
   * `conditional_expression` (ternary), `postfix_conditional_expression`
   * (statement modifier) and `try_statement`; `elsif` and `catch` are further
   * decisions in their own chains.
   */
  private countBranches(root: Node): number {
    const branchTypes = new Set([
      "conditional_statement",
      "elsif",
      "loop_statement",
      "for_statement",
      "cstyle_for_statement",
      "conditional_expression",
      "postfix_conditional_expression",
      "try_statement",
      "catch",
      "when",
      "given",
    ])
    const logicalTypes = new Set(["lowprec_logical_expression", "logical_not_expression"])
    let count = 0
    const stack: Node[] = [root]
    while (stack.length > 0) {
      const node = stack.pop()!
      if (branchTypes.has(node.type)) count++
      else if (logicalTypes.has(node.type)) {
        // `&&`, `||` and friends are the OPERATOR tokens of these nodes; each
        // one is a short-circuit decision.
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)
          if (child && (child.type === "&&" || child.type === "||" || child.type === "and" || child.type === "or")) {
            count++
            break
          }
        }
      }
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (child) stack.push(child)
      }
    }
    return count
  }

  private lineCount(content: string): number {
    let lines = 1
    for (const char of content) if (char === "\n") lines++
    return lines
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
