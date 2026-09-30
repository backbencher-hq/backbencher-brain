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
  mooExtendsKeyword: "moo-extends-keyword",
  indirectObjectInvocation: "indirect-object-invocation",
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
      // `noninterpolated_string_content` is deliberately NOT listed here: it is
      // absent from the wired 1.2.1 grammar (checked against the wasm's node-type
      // table) and the grammar-audit cell is zero-tolerance, so a branch for a
      // grammar this lane does not run is dead code by definition. It is 2.0.0's
      // counterpart of `string_content`; the bump must re-add it, and that
      // requirement is recorded in reviews/perl/master-review.md rather than
      // smuggled in as a branch the wired grammar can never reach.
      if (child.type === "string_content") {
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
    // `parenthesized_expression` is the wrapper 2.0.0 ADDS to remove the
    // multi-child paren field (1,419 unreachable sites, down from 39,526). It is
    // absent from the wired grammar and so absent here for the same reason as
    // `noninterpolated_string_content` above: the audit is zero-tolerance and
    // this lane does not run 2.0.0. The bump re-adds it.
    if (child.type === "string_literal" || child.type === "interpolated_string_literal" || child.type === "quoted_word_list" || child.type === "autoquoted_bareword") {
      if (perlWordValues(child).length > 0) result.push(child)
    }
  }
  return result
}

/**
 * Does this call node carry an ARGUMENT LIST, by grammar rather than by content?
 *
 * `perlArgumentNodes` is the wrong probe here: it keeps an argument only when the
 * argument contributes a WORD, so `&foo($y)` and `&foo(@y)` — both real calls —
 * come back empty, indistinguishable from a bare `&SIGINT`. The `arguments` FIELD
 * is the grammar's own statement of the same fact and does not filter:
 *
 *   &foo($y)   arguments=[scalar]                     -> a call
 *   &foo(@y)   arguments=[array]                      -> a call
 *   &Foo::bar("s") arguments=[interpolated_string]    -> a call
 *   &foo()     arguments=[] but a `(` marker present  -> a call
 *   &SIGINT    arguments=[] and no markers             -> a code-slot reference
 *   defined &DynaLoader::boot  arguments=[], no markers -> a definedness test
 *
 * The marker test is what separates `&foo()` from `&SIGINT`: both have an empty
 * `arguments` field, and only the first has parentheses.
 */
export function hasArgumentSyntax(node: Node): boolean {
  if (node.childrenForFieldName("arguments").length > 0) return true
  for (let i = 0; i < node.childCount; i++) {
    const t = node.child(i)?.type
    if (t === "(" || t === ")") return true
  }
  return false
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
    const packageBaseLine = new Map<string, number>()
    const packageMethods = new Map<string, Set<string>>()
    const deferredIsa: { owner: string; right: Node }[] = []
    // Inner `ambiguous_function_call_expression` nodes that are the CLASS
    // half of an indirect-object call (`new Class @args`). They are visited
    // by the walk because they are real children, but their only content is
    // the class name, so visiting them as calls files that name under a
    // second, wrong label.
    //
    // Keyed by byte POSITION, not by node identity: web-tree-sitter hands out a
    // fresh JS wrapper on every access, so the node `argumentNodes()` returned
    // is never `===` the node `namedChild()` yields later, and an identity Set
    // silently matched nothing.
    const indirectObjectClassNodes = new Set<string>()
    const nodeKey = (n: Node) => `${n.startIndex}:${n.endIndex}:${n.type}`
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
      nameNode?: Node,
    ): ASTEngine.UniversalSymbol | undefined => {
      if (!name) return undefined
      const owner = ownerOverride ?? state.ownerName
      const key = `${kind}\u001f${owner || ""}\u001f${name}`
      if (symbolKeys.has(key)) return symbolsByKey.get(key)
      // M59.A7 / #921: the line that NAMES the symbol, which is not always the
      // line its DECLARATION starts on. Perl allows
      //
      //     sub
      //       greeting { ... }
      //
      // where `subroutine_declaration_statement` starts on line 1 and the name is
      // written on line 2, so an edge stamped from `range.startLine` names a line
      // the symbol's name is not on. The c/cpp round found 166 such rows in a
      // 120-file draw and the same trap is already the `cpp/contains-line-at-
      // declaration-start` mutant. `meta.nameLine` records the name's own line
      // where a name node is in hand; a `contains` edge prefers it and falls
      // back to `range.startLine`, which is the pre-fix behaviour and therefore
      // the honest fallback for any shape the name node is not found for.
      const nameLineSource = nameNode ?? node.childForFieldName("name") ?? this.findChildByType(node, "bareword")
      const nameLine =
        name === node.text?.trim() ? node.startPosition.row + 1 : nameLineSource ? nameLineSource.startPosition.row + 1 : node.startPosition.row + 1
      const symbol: ASTEngine.UniversalSymbol = {
        name,
        kind,
        range: this.nodeToRange(node),
        scope: owner || state.packageName || undefined,
        ownerName: owner,
        ownerKind: owner ? state.ownerKind : undefined,
        visibility: state.visibility,
        metadata: { perlSpecific: true, nameLine, ...extra },
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
    /**
     * The line a symbol's NAME is written on, for an edge emitted outside the
     * walk (where no `Node` is in hand). `meta.nameLine` is set at extraction;
     * the `range.startLine` fallback is the pre-#921 behaviour, so an edge never
     * loses its line to this accessor.
     */
    const nameLineOf = (symbol: ASTEngine.UniversalSymbol): number | undefined => {
      const recorded = (symbol.metadata as Record<string, unknown> | undefined)?.nameLine
      if (typeof recorded === "number" && recorded > 0) return recorded
      const start = symbol.range?.startLine
      return typeof start === "number" && start > 0 ? start : undefined
    }

    const addRelationship = (
      source: string,
      target: string,
      type: ASTEngine.RelationshipType,
      metadata: Record<string, unknown> = {},
      confidence = 0.9,
      lineNode?: Node,
      explicitLine?: number,
    ) => {
      if (!source || !target) return
      const key = `${type}\u001f${source}\u001f${target}`
      if (relationshipKeys.has(key)) return
      relationshipKeys.add(key)
      const line = explicitLine ?? (lineNode ? lineNode.startPosition.row + 1 : undefined)
      relationships.push({
        source,
        target,
        type,
        confidence,
        ...(typeof line === "number" && line > 0 ? { line_number: line } : {}),
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
    const addBase = (owner: string, parents: string[], reasonCode: string, nameNode?: Node, parentLines?: Map<string, number>) => {
      const existing = packageBases.get(owner) || []
      for (const parent of parents) {
        if (!parent) continue
        if (!existing.includes(parent)) {
          existing.push(parent)
          if (!packageBaseOrigin.has(owner)) packageBaseOrigin.set(owner, reasonCode)
        }
        // The LINE is per parent. A parent's name is not on the line of the
        // keyword that introduces it:
        //     use parent 'Class::MOP::Module',          <- what the old code stamped
        //              'Class::MOP::HasAttributes',     <- where HasAttributes is
        //              'Class::MOP::HasMethods',
        //              'Class::MOP::HasOverloads';
        // `use parent` takes an argument LIST, so three of Moose's four bases in
        // Class/MOP/Class.pm live on lines the `use` never touches, and the M59
        // line oracle read all three as INCONSISTENT. One shared `nameNode` — the
        // `parent`/`base` keyword — cannot be right for a list longer than one,
        // and it was right for exactly the single-argument case, which is why no
        // fixture caught it.
        const key = `${owner}\u001f${parent}`
        if (packageBaseLine.has(key)) continue
        const perParent = parentLines?.get(parent)
        if (typeof perParent === "number") packageBaseLine.set(key, perParent)
        else if (nameNode) packageBaseLine.set(key, nameNode.startPosition.row + 1)
      }
      packageBases.set(owner, existing)
    }

    // `calleeNode` is the node the LINE comes from — for a call that is the
    // `function` field, which is NOT the call node. The `&`-argument test below
    // needs the call node itself, so it is passed separately rather than
    // guessed from the callee.
    // `builtinProbe` is the METHOD name. It is passed separately because the
    // target may now be QUALIFIED (`IOLoop.reset`), and testing that against
    // PERL_BUILTINS misses `reset` — a builtin — so `Mojo::IOLoop->reset` stopped
    // being suppressed. The builtin test has always been about the method being
    // invoked, never about the shape of the edge's target.
    const addCall = (
      target: string,
      state: WalkState,
      calleeNode: Node,
      dynamicReceiver: boolean,
      callNode?: Node,
      builtinProbe?: string,
    ) => {
      const probe = builtinProbe ?? target
      if (!target || PERL_BUILTINS.has(probe) || probe === "use" || probe === "no") return
      // A callee whose name starts with `&` is a CODE-SLOT REFERENCE, not an
      // invocation — UNLESS it carries an argument list, because `&foo(@args)`
      // is perl's EXPLICIT-CALL syntax. The grammar gives both the same shape: a
      // `function` field composed of an `&` token and a varname. So the `&` alone
      // is not the discriminator; the argument list is. Two measured cases that
      // reference rather than call, and both had no arguments:
      //   new POSIX::SigSet &SIGINT   the `&SIGINT` is an ARGUMENT (a reference
      //                                to the SIGINT handler slot); the call is
      //                                the indirect-object `new` beside it;
      //   defined &DynaLoader::boot_DynaLoader
      //                               a DEFINEDNESS TEST on a code slot.
      // Suppressing on the `&` alone cost 323 truth rows across perl5, so the
      // narrower rule is the one that is actually right.
      if (target.startsWith("&") && !hasArgumentSyntax(callNode ?? calleeNode)) return
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
            // Per-argument lines, from the ARGUMENT nodes — a base's name is
            // written on its own line inside the `use parent` list.
            const parentLines = new Map<string, number>()
            for (const argNode of this.argumentNodes(node)) {
              for (const value of this.wordValues(argNode)) {
                if (this.isOption(value)) continue
                const line = this.lineOfNameWithin(argNode, value)
                if (line !== undefined) parentLines.set(value, line)
              }
            }
            if (state.packageName) addBase(state.packageName, parents, REASON.useParentDeclaration, moduleNode, parentLines)
          } else if (module === "role") {
            // `use role 'R'` is the pre-`with` spelling of the same
            // composition; without it the role is an undeclared dependency.
            // Iterate ARGUMENT NODES, not the extracted strings: the string has
            // lost the node, and the node is where the name's own line lives. The
            // pre-fix line came from `moduleNode` — the `role` KEYWORD — so
            // `use role 'R'` on a following line, or a role inside a `qw` list,
            // claimed the line of the word `role`.
            for (const argNode of this.argumentNodes(node)) {
              for (const value of this.wordValues(argNode)) {
                if (this.isOption(value)) continue
                addRelationship(
                  state.packageName || "global",
                  this.leafName(value),
                  ASTEngine.RelationshipType.Implements,
                  { reasonCode: REASON.useRoleComposition },
                  0.9,
                  undefined,
                  this.lineOfNameWithin(argNode, value),
                )
              }
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
          // Same rule as the method side. A `function` field holding compound
          // text is a method call the grammar typed as a function call, not a
          // callee name — measured as `calls -> DemolishAll->new`.
          if (!this.isWrittenCalleeName(target)) break
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
              if (isWith) {
                addRelationship(
                  state.packageName || "global",
                  this.leafName(value),
                  ASTEngine.RelationshipType.Implements,
                  { reasonCode: REASON.mooRoleComposition, mooseKeyword: target },
                  0.9,
                  arg,
                  // `arg` is the right NODE but the wrong LINE for a `qw` list that
                  // wraps: the list starts on the `with` line and the role names
                  // are on the lines after it. Prefer the name's own line and keep
                  // the node as the fallback, so a shape the offset search cannot
                  // resolve keeps its previous (correct) line.
                  this.lineOfNameWithin(arg, value),
                )
                continue
              }
              // A bare `extends 'Base::Class';` is the Moose spelling of
              // `use parent`. It used to call addRelationship DIRECTLY, which
              // emitted a correct `extends` edge and left `packageBases` empty —
              // so the override resolver below found no base and emitted NO
              // `overrides` edge for any of the class's methods. Every class
              // inheriting by this spelling had its inheritance graph stop one
              // hop short.
              //
              // This is why two differential corpora never saw it: mojo and
              // plack contain ZERO bare-`extends` files, and the spelling is
              // overwhelmingly a Moose idiom — 401 of the 7-corpus census's
              // 5,774 files, concentrated in Moose (314), Catalyst (52) and Moo
              // (34). Auditing the corpora the census walks but the F5 lane
              // never sampled is what named it.
              //
              // Routing through addBase is the fix, and it is also the
              // consistent one: all FIVE inheritance spellings (`use parent`,
              // `use base`, `our @ISA`, `use Mojo::Base`, bare `extends`) now
              // reach the extends emitter and the override resolver by the same
              // path, so `extends` cannot be emitted by a route that `overrides`
              // cannot see. The edge is byte-identical to the direct call —
              // same leaf target, same 0.9 — and the line comes from
              // `packageBaseLine`, the same argument node.
              addBase(state.packageName || "global", [value], REASON.mooExtendsKeyword, arg, new Map([[value, this.lineOfNameWithin(arg, value) ?? arg.startPosition.row + 1]]))
            }
            frameworks.add("Moose/Moo OOP")
          } else if (target === "new") {
            // Perl's INDIRECT OBJECT syntax: `new Class @args` is exactly
            // `Class->new(@args)`. The grammar spells it as an
            // ambiguous_function_call_expression whose `function` is the METHOD
            // and whose single argument is a second ambiguous call whose
            // `function` is the CLASS.
            //
            // The pre-fix read took `firstValue(node)`, which harvested WORDS
            // from the whole argument subtree, so `new Win32::ODBC $h->{DSN}`
            // published a phantom class `DSN` — a hash KEY — and the inner
            // ambiguous call separately emitted `calls ODBC`, filing the real
            // class under the wrong label. The class is the inner `function`
            // field and nothing else.
            const indirect = this.indirectObjectClass(node)
            const inner = indirect?.carrier
            if (inner && indirect?.name) {
              // The inner node's only job was to carry the class name. It must
              // not also be walked as a call of its own, or the class is filed
              // twice under two labels.
              indirectObjectClassNodes.add(nodeKey(inner))
              addRelationship(state.functionName || state.packageName || "global", `${this.leafName(indirect.name)}.constructor`, ASTEngine.RelationshipType.Instantiates, { isConstructor: true, reasonCode: REASON.indirectObjectInvocation }, 0.9, node)
              break
            }
            const requestedType = this.firstValue(node)
            const instanceTarget = requestedType && !requestedType.includes("$") ? `${this.leafName(requestedType)}.constructor` : "constructor"
            addRelationship(state.functionName || state.packageName || "global", instanceTarget, ASTEngine.RelationshipType.Instantiates, { isConstructor: true, reasonCode: REASON.concreteInvocant }, 0.9, node)
          } else {
            if (indirectObjectClassNodes.has(nodeKey(node))) break
            addCall(target, state, functionNode ?? node, false, node)
          }
          break
        }

        case "method_call_expression": {
          const methodNode = this.findChildByType(node, "method")
          const method = methodNode?.text || ""
          if (!this.isWrittenCalleeName(method)) {
            // Symbolic deref, or a method name held in a variable: nothing is
            // WRITTEN that names the callee, so there is no target to publish
            // and no line that could be the target's line. `break` leaves the
            // generic child walk below to run, so real calls inside the
            // expression are still published.
            break
          }
          // `invocant` is multi-child for a parenthesised receiver
          // `(Foo)->new` / `($self || $other)->new`; the bracket markers carry
          // no name, so the first NAMED child is the receiver. Hoisted out of the
          // `new` branch because a receiver that NAMES A CLASS is what makes the
          // METHOD's owner derivable — true of `Mojo::IOLoop->stream` exactly as
          // much as of `Mojo::IOLoop->new`.
          const invocant = this.fieldNodes(node, "invocant").find((c) => c.isNamed) ?? this.firstNamedChild(node)
          if (method === "new") {
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
            } else if (invocant && this.namesAClass(invocant) && target && !target.includes("$") && !target.includes("->")) {
              // A POSITIVE allowlist, not a "does the text look wrong" test.
              //
              // The old guard only rejected receivers containing `$` or `->`, so
              // anything else became a phantom type. `use_module('X')->new(@a)`
              // in Moose's Class::MOP::Class::Immutable::Trait is the measured
              // case: `use_module` is a function that loads a module at runtime,
              // the receiver is its return VALUE, and the edge published a class
              // named `use_module`. A negative test can only enumerate the
              // dynamic cases someone already hit; this enumerates the cases
              // that actually NAME a class, and everything else is a value.
              addRelationship(state.functionName || state.packageName || "global", `${this.leafName(target)}.constructor`, ASTEngine.RelationshipType.Instantiates, { isConstructor: true, reasonCode: REASON.concreteInvocant }, 0.9, invocant ?? node)
            }
          } else {
            // A receiver that NAMES A CLASS makes the method's OWNER derivable,
            // so the target is `Receiver.method` and not a bare leaf. The
            // pre-review lane emitted the leaf, which is a real precision loss
            // and not a cosmetic one: `Mojo::IOLoop->remove`, `->stream` and
            // `->server` all collapsed onto the single targets `remove`,
            // `stream` and `server`, so two classes' same-named methods became
            // one node and a caller of one looked like a caller of the other.
            // Measured with script/m14/tmp/perl-receiver-scope.mts: 15,754 of
            // 71,230 corpus `calls` edges (22.1%) had a class receiver and lost
            // it — 37.4% of mojo's, 30.3% of Moo's, 28.9% of Moose's.
            //
            // The differential reported 100% coverage with 0 unexplained
            // throughout, because the oracle derived the target by leaf name too.
            // That is the third time this pair has agreed on a shared premise
            // (after the `use constant { ... }` dead branch and the oracle's
            // `!inSub` gap), and it is why the number had to come from the AST
            // rather than from either derivation.
            //
            // A receiver that is a VALUE — `$self->other`, a chained call, a
            // scalar — still gets the leaf, because there is no class to name.
            // The discriminator is the same `namesAClass` allowlist the
            // `instantiates` path uses: one rule, two labels. The line is the
            // METHOD node either way.
            // Two corrections to the first version of this, both found by the
            // differential the moment it landed (18 unexplained on mojo).
            //
            // (1) QUALIFYING THE TARGET DEFEATED THE BUILTIN CHECK. `addCall`
            // tests its argument against PERL_BUILTINS, and it was being handed
            // `IOLoop.reset` where it needs to be handed `reset` — so
            // `Mojo::IOLoop->reset` stopped being suppressed, because `reset` IS
            // a perl builtin. The builtin test has always been about the METHOD.
            // `addCall` now takes the method separately for that test.
            //
            // (2) A BARE BAREWORD IS NOT A CLASS. `app->log->level('fatal')` in
            // mojo's t/mojo/cgi.t qualified to `app.log` — inventing a class
            // named `app` for what is a lexical holding a Mojo::Server. The
            // grammar types both `app` and `Mojo::IOLoop` as `bareword`, so node
            // type cannot tell them apart; only the `::` can. So qualification
            // requires a receiver that is PROVABLY a package name: a `package`
            // node, or a bareword carrying `::`. A plain bareword keeps the leaf,
            // which is the honest answer for a variable.
            const recvTarget = invocant ? this.invocantName(invocant) : ""
            const provableClass =
              invocant != null &&
              this.namesAClass(invocant) &&
              (invocant.type === "package" || recvTarget.includes("::")) &&
              !recvTarget.includes("$") &&
              !recvTarget.includes("->")
            if (provableClass) {
              addCall(`${this.leafName(recvTarget)}.${method}`, state, methodNode ?? node, false, node, method)
            } else {
              addCall(method, state, methodNode ?? node, true, node, method)
            }
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
          undefined,
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
        // The node that NAMES an override is the SUBCLASS's own method — that is
        // where the overriding definition is written. Its name line is therefore
        // the edge's line (#921). This edge previously carried none, on the stated
        // ground that an inferred override has no naming node; the inference is
        // about the BASE (a guess, kept honest at confidence 0.5 / `inferred`),
        // while the method being overridden is not in doubt and is written here.
        addRelationship(`${symbol.ownerName}.${method}`, `${baseLeaf}.${method}`, ASTEngine.RelationshipType.Overrides, { isOverride: true, reasonCode: REASON.baseDeclaresMethod }, 0.95, undefined, nameLineOf(symbol))
      } else if (!context?.overrideCompanion) {
        // Pass 3 (family parity with java/groovy resolveOverrides): the base
        // is not declared in this file and no companion index was supplied
        // (production callers never populate one — see M37.10). Emit the
        // deterministic first-parent guess BELOW the patterns.ts threshold
        // (0.7): visible in raw output, counted as heuristic (honest
        // suspicion) by the differential. Pre-M37.10 this edge was silently
        // dropped for every externally-declared base package.
        addRelationship(`${symbol.ownerName}.${method}`, `${baseLeaf}.${method}`, ASTEngine.RelationshipType.Overrides, { isOverride: true, reasonCode: REASON.firstParentGuess }, 0.5, undefined, nameLineOf(symbol))
      }
    }

    // Stable ownership edges are generated once, after extraction, so there is no
    // `Node` in hand at the emit site — but the CHILD's own name is a written node
    // in this file, and M59.A7's rule is that an edge's line is the line that
    // NAMES it. The previous comment here said membership "has no single naming
    // node", which was true of the POST-PASS and false of the child: `run` in
    // `sub run` is written, and c/cpp/objc all moved their `contains` edges onto
    // it for exactly this reason (#921, `objc/contains-line-at-container`).
    //
    // `meta.nameLine` is the line the name is written on and
    // `range.startLine` the line the declaration starts on. They differ for
    // `sub\n  greeting { ... }`; the fallback is the pre-fix value, so a shape the
    // name node is not found for keeps its old line rather than losing the field.
    for (const symbol of symbols) {
      if (symbol.ownerName && symbol.ownerName !== symbol.name) addRelationship(symbol.ownerName, symbol.name, ASTEngine.RelationshipType.Contains, {}, 1.0, undefined, nameLineOf(symbol))
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

    // Evidence-tier classification (managed-OO family contract — ruby/swift/
    // dart/csharp/objc/php precedent; M14 section D requires >=2 distinct
    // evidenceClass values, and src/lsp/evidence_tier.ts rule 1 says a STORED
    // legend-tier value wins and is never re-derived).
    this.classifyEvidenceTier(relationships)

    return { symbols, relationships, imports, exports, errors, metadata }
  }

  /**
   * Perl's own confidences decide the floors, not a copied constant: the
   * source-declared edges (`extends`/`implements`/`instantiates` from `use
   * parent`, `with`, `use role`, a class invocant) are all 0.9, `contains` is
   * 1.0, `calls` is 0.9, and `overrides` is 0.5 because it is guessed from a
   * first-parent chain. So the guessed kind lands on `inferred` on its own,
   * with no special case: a 0.5 edge can never clear a 0.7 structural floor.
   */
  private classifyEvidenceTier(relationships: ASTEngine.UniversalRelationship[]): void {
    for (const r of relationships) {
      const type = r.type ?? r.relationshipType ?? ""
      // Attach FIRST, then classify: the branches below all `continue`, so
      // writing the metadata after them would discard every classification
      // except the fallthrough's.
      const md: any = r.metadata ?? {}
      r.metadata = md
      if (type === "contains") { md.evidenceClass = "structural"; continue }
      if (type === "instantiates" || type === "extends" || type === "implements") {
        md.evidenceClass = (r.confidence ?? 0) >= 0.9 ? "structural" : "inferred"
        continue
      }
      if (type === "calls") {
        md.evidenceClass = (r.confidence ?? 0) >= 0.85 ? "usage_contextual" : "inferred"
        continue
      }
      if (type === "overrides") { md.evidenceClass = "inferred"; continue }
      md.evidenceClass = "inferred"
    }
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

  /**
   * The line a NAME is written on INSIDE a node, when the node's own start line
   * is not it. `with qw/\n  MooseRoleOne\n  MooseRoleTwo\n/` is ONE
   * `quoted_word_list` node starting on the `with` line, so stamping the edge from
   * that node puts `implements` two lines above the role it names.
   *
   * Scoped to the ARGUMENT node, never the whole statement: for
   * `use Moose::Role 'My::Role'`, searching the statement for `Role` finds the
   * one inside `Moose::Role` and returns the module's line — exactly the bug
   * this avoids. Returns undefined when the name is not in the node's text, so
   * callers fall back to the node's own line rather than inventing one.
   */
  private lineOfNameWithin(node: Node, name: string): number | undefined {
    if (!name) return undefined
    const text = String(node.text ?? "")
    const ident = /[A-Za-z0-9_]/
    let from = 0
    for (;;) {
      const idx = text.indexOf(name, from)
      if (idx < 0) return undefined
      const before = idx > 0 ? text[idx - 1] : ""
      const after = text[idx + name.length] ?? ""
      if (!ident.test(before) && !ident.test(after)) {
        let line = node.startPosition.row
        for (let i = 0; i < idx; i++) if (text.charCodeAt(i) === 10) line++
        return line + 1
      }
      from = idx + 1
    }
  }

  /**
   * Is this callee text a NAME the source actually writes?
   *
   * A target that is not written cannot be verified — the M59 line oracle reads
   * every claimed target back against the file's own text, and one that is not
   * there is a FABRICATED claim rather than a weak one. Same reasoning that
   * removed the phantom `DSN` and `use_module` classes, applied to the method
   * side, and found by that oracle:
   *
   *   Moo/Object.pm:56   calls -> DemolishAll->new
   *   Moo/Role.pm:224    calls -> ${\( $tc->can('coercion')||sub { ... } )}
   *
   * Both are symbolic deref — `$self->${\( EXPR \)}`, perl's "call the method
   * whose name this expression computes". The grammar puts the whole expression
   * in the `method` field, so the lane published arbitrary source text as a
   * callee name. A POSITIVE allowlist again, not a "does this look wrong" test:
   * a negative test only enumerates the dynamic cases somebody already hit, and
   * this pair has been wrong that way three times.
   *
   * Rejected: a sigil (`->$name`), braces, `$`, `->`, whitespace. For a rejected
   * one NO edge is emitted — and the children are still walked, so the real calls
   * INSIDE the expression survive: `Method::Generate::DemolishAll->new` inside a
   * deref becomes its own `instantiates` edge. 19 such edges left a 14-file
   * draw.
   */
  private isWrittenCalleeName(text: string): boolean {
    const t = String(text ?? "").trim()
    if (!t) return false
    if (t.includes("$") || t.includes("->") || t.includes("{") || t.includes("}") || /\s/.test(t)) return false
    if (t.startsWith("&")) return false
    return /^(?:[A-Za-z_][A-Za-z0-9_]*::)*[A-Za-z_][A-Za-z0-9_]*$/.test(t)
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
   * `signature` NODE TYPE, whose children are `mandatory_parameter`,
   * `optional_parameter` and `slurpy_parameter`; each wraps the
   * scalar/array/hash node that carries the `varname`.
   *
   * The first version of this fix said FIELD here and reached for
   * `childForFieldName("signature")`, which is dead for the same reason the
   * original was — `signature` is not among the grammar's 44 fields either. The
   * working `findChildByType` beside it is what has been producing every
   * parameter all along, and the dead-literal audit is what finally said so. The
   * wording is corrected here because the wrong word is what produced the bug.
   */
  private extractParameters(node: Node): ASTEngine.Parameter[] {
    // `signature` is a NODE TYPE, not a field. The pinned grammar declares 44
    // fields — alternative, arguments, array, arrayref, attributes, block, body,
    // callback, catch_block, catch_expr, condition, consequent, content,
    // continue, default, finally_block, function, hash, hashref, index,
    // initialiser, invocant, iterator, key, label, left, lexical, list, loopex,
    // method, modifiers, module, name, operand, operator, phase, right, statement,
    // try_block, type, value, variable, variables — and `signature` is not one of
    // them, so `childForFieldName("signature")` is undefined on EVERY sub, signed
    // or not. Measured, not assumed: on `sub f ($a, $b = 1, @rest) { }` it
    // returns undefined while the signature is right there as a named child.
    //
    // That call was the SAME defect as #863 with a different field name: the
    // lane read a field the grammar does not declare, and the `findChildByType`
    // fallback beside it is what has quietly done the work. The audit caught both
    // (UNREGISTERED perl field literal "signature"), which is what the dead-literal
    // record exists for. Read the node type.
    const signature = this.findChildByType(node, "signature")
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

  /**
   * Does this receiver node NAME a class, as opposed to being a runtime value?
   *
   * The allowlist is the set of node types whose entire content is a name. A
   * `function_call_expression` is deliberately absent: its `function` field is
   * the name of a FUNCTION, and calling it yields a value, so
   * `use_module('X')->new` constructs nothing knowable. `ambiguous_function_
   * call_expression` IS present because that is the indirect-object spelling,
   * where the node's `function` field is the class.
   */
  /**
   * The CLASS half of an indirect-object call: `new Class @args` is exactly
   * `Class->new(@args)`, and the grammar spells the class as the `function`
   * FIELD of a nested `ambiguous_function_call_expression`.
   *
   * Read STRUCTURALLY, from the node's named children, rather than through
   * `argumentNodes` — that helper keeps an argument only when it contributes at
   * least one WORD, and this nested call contributes none whenever its own
   * arguments are a plain scalar or a list of literals. Measured: it returned
   * `[]` for `new Win32::ODBC $dbname` and `new Foo 1, 2` but DID return the
   * call for `new Win32::ODBC $x->{DSN}` — kept only because of a hash KEY, which
   * is the same accident that published the phantom class `DSN`. A structural
   * read is right for all three, and for the third shape (`new Foo;`, where the
   * class is a direct `bareword` child and there is no nested call at all) the
   * caller's existing path already reads the bareword correctly.
   */
  private indirectObjectClass(node: Node): { name: string; carrier: Node } | undefined {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child || child.type !== "ambiguous_function_call_expression") continue
      const fn = child.childForFieldName("function") || this.findChildByType(child, "function")
      if (fn?.text) return { name: fn.text, carrier: child }
    }
    return undefined
  }

  private namesAClass(node: Node): boolean {
    switch (node.type) {
      case "bareword":
      case "autoquoted_bareword":
      case "package":
      case "ambiguous_function_call_expression":
        return true
      case "string_literal":
      case "interpolated_string_literal":
        // A quoted class name is a name; an INTERPOLATED one is only a name if
        // nothing was interpolated into it.
        return !node.text.includes("$")
      default:
        return false
    }
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
