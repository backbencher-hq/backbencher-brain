/**
 * Perl Intelligence Engine — Author: Muhammad Ishaq Khan
 * What this file is: the pure-AST analyzer for Perl (extensions pl/pm/perl), wired in
 * engine.ts getAnalyzer → RealPerlAnalyzer. It reads packages, subs and variables and the
 * Perl builtin/named-operator surface (REAL_PERL_BUILTINS below) without source-text scanning.
 * Grammar: tree-sitter-perl.wasm (WASM loaded by engine.ts).
 * Relationship types covered: calls, uses, contains, imports, references, extends, implements,
 * overrides, instantiates.
 * Where its scripts/validations live: docs/analyzers/real-perl-analyzer.md,
 * script/m14/spec/perl-completeness.json, validation/m14/fixtures/perl/**, and the LANG_CONFIG
 * row in script/m14/completeness-inventory.ts.
 * THE LANE'S KNOWN OPEN CLASS, so the next contributor knows where the residual lives: the
 * differential's last measured reading is missing=1635, unexplained=0 — real unanswered edges,
 * mostly RECEIVER-TYPED APPLICATION-OBJECT calls. They are not parser failures; they are a
 * per-file typing boundary, and a future wave must either resolve them or rule them with a run
 * falsifier rather than explaining them away.
 * EDIT THESE TOO when this file changes: the spec, the fixtures, the doc above, and the
 * LANG_CONFIG row.
 */
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

/**
 * Perl identifier character classes, by comparison rather than by pattern.
 *
 * These exist because the lane's contract is ZERO regex literals — proved by
 * script/m14/tmp/perl-zero-regex.mts on top of the M12 AST scanner, not by a
 * grep — and the PERL-MR12 name allowlist reached for three regular expressions
 * (`/[A-Za-z0-9_]/`, `/\s/`, and the allowlist itself). The instrument caught
 * them on its next run.
 *
 * Formula section 10's point applies to the fix as much as to the defect: the
 * metric is not "how many regexes" but regexes doing syntax work. Reading a
 * character class is syntax work; asking whether a string is a written perl
 * identifier is data validation, and `charCodeAt` comparisons say the same thing
 * with nothing to parse. Written out longhand on purpose — a single shared
 * `const IDENT = /[A-Za-z0-9_]/` would be shorter and would put the lane back in
 * violation of its own gate.
 */
const isPerlIdentStart = (c: string): boolean =>
  (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_"
const isPerlIdentChar = (c: string): boolean => isPerlIdentStart(c) || (c >= "0" && c <= "9")

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
 *   code-reference      the target is a sub named as a CODE SLOT — `\&name`, or
 *                        a `&`-prefixed callee with NO argument list such as
 *                        `defined &builtin::is_bool`. The name is written and
 *                        bound to the slot, but nothing is invoked: a `calls`
 *                        edge would say a sub ran.
 *   qualified-variable-read  the target is another package's DECLARED VARIABLE
 *                        read as a value (`$Pkg::name`, `@Pkg::name`,
 *                        `%Pkg::name`). The written name is the identity — two
 *                        packages may declare the same leaf, so the target keeps
 *                        its full qualification.
 *   type-query-literal  the target is a class / role / method named as a LITERAL
 *                        inside a runtime query (`->isa('C')`, `->DOES('R')`,
 *                        `->can('m')`), so the name is written and nothing is
 *                        invoked, but whether the object satisfies it at runtime
 *                        is not decided at this edge
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
  // THE IMPORT AND EXPORT EDGES ✓✓ — 2026-10-21 ✓✓.
  //
  // The corpus EXPRESSES both ✓✓ (3,539 use/require sites ✓✓, 33 @EXPORT
  // conventions in 11 files ✓✓) and the ARM's TABLE 1 carried `imports 0` and
  // `exports 0` ✓✓, because the facts went into the analyzer's OUTPUT SHAPE ✓✓
  // and never became RELATIONSHIPS ✓✓. These two codes are the receipt ✓✓.
  moduleImport: "module-import",
  exportedSymbol: "exported-symbol",
  exportedArrayPush: "exporter-array-push",
  exportedArrayDeclaration: "exporter-array-declaration",
  exporterSurface: "exporter-surface",
  useModuleLoad: "use-module-load",
  runtimeRequire: "runtime-require",
  isaArrayPush: "isa-array-push",
  baseDeclaresMethod: "base-declares-method",
  firstParentGuess: "first-parent-guess",
  magicTokenInvocant: "magic-token-invocant",
  codeReference: "code-reference",
  qualifiedVariableRead: "qualified-variable-read",
  qualifiedNameAccess: "qualified-name-access",
  blessClassLiteral: "bless-class-literal",
  refClassComparison: "ref-class-comparison",
  universalIsaLiteral: "universal-isa-literal",
  isaClassLiteral: "isa-class-literal",
  doesRoleLiteral: "does-role-literal",
  typeQueryLiteral: "type-query-literal",
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
  // PERL-MR4. The generic recursion below used to descend into EVERY named child,
  // which means anything reachable from an argument was published as an IMPORTED
  // NAME. Two shapes made that visible, and tree-sitter-perl 2.0.0 is what exposed
  // them — its `parenthesized_expression` puts argument lists where 1.2.1's
  // multi-child paren field did not, so the same latent rule starts harvesting:
  //
  //   use overload '""' => sub { ... }, bool => sub { ... }, fallback => 1;
  //        1.2.1: items=["*"]                      2.0.0: items=["\"\"","as_string","bool","fallback"]
  //
  // A fat-comma KEY is not an import — it is the name of an overload slot, a
  // metaclass role, a `has` attribute, whichever pragma is in play — and the
  // VALUE is code. Neither is a module name. So a pair is not an argument list
  // (callers that want keys have `fatCommaKeys` for exactly that), and a
  // sub's BODY is code (PERL-MR12 made the same refusal on the callee side, for
  // the same reason: text that is written is not thereby a name).
  //
  // Measured over all seven corpora with a freshly built 2.0.0 wasm: 23 of 5,774
  // files differ between the grammars, and the change ADDED 21 import emissions
  // while REMOVING 11. Both directions are addressed — the added ones by this
  // guard, the removed ones by the argument-reach fix below.
  // PERL-MR4: there is deliberately NO `fat_comma` check here, and there was one
  // for several hours. tree-sitter-perl has no such node type in EITHER
  // generation -- a `=>` pair is flat children of a `list_expression` with the
  // `=>` as an ANONYMOUS TOKEN between them -- so the check could never match.
  // It passed the fixture suite (which runs 1.2.1, where it was equally dead) and
  // only the F1 grammar cell caught it, by reporting an unknown type as a dead
  // branch. Naming a type by PATTERN from another grammar's conventions instead of
  // reading node-types.json is the mistake, and it is easy to repeat, because such
  // a branch is invisible to every test that is not the grammar audit.
  if (node.type === "subroutine_declaration_statement" || node.type === "anonymous_subroutine_expression" || node.type === "block" || node.type === "block_statement") return []

  // PERL-MR4, third clause, and it is the same principle as the closure guard
  // above rather than a new one: CODE IS NOT NAMES. A branch of `?:`, `and`/`or`,
  // `||`, or `//` computes a value; it does not declare an import.
  //
  //   use Catalyst (
  //       'Test::Plugin',
  //       '+TestApp::Plugin::FullyQualified',
  //       (eval { require MooseX::Role::Parameterized; 1 }
  //           ? ('+TestApp::Plugin::ParameterizedRole' => { method_name => 'affe' })
  //           : ()),
  //   );
  //
  // The two plugins on top are the arguments. Inside the ternary there are no
  // arguments at all: `+TestApp::Plugin::ParameterizedRole` is a KEY and `affe`
  // is a hash VALUE, and which of them the import gets is decided at runtime.
  // The node is `conditional_expression`, and its branches are reached because the
  // harvester walks every descendant — so without this clause the recorded items
  // were ["+TestApp::Plugin::FullyQualified","+TestApp::Plugin::ParameterizedRole",
  // "Test::Plugin","affe","method_name"]: two real arguments, one key, and two
  // hash values.
  //
  // Note this is NOT the `=>` rule above: the outer list has no top-level `=>`, so
  // `isArgumentSpecification` correctly says "this is a name list" and the
  // argument count is right. Only the descent into the branch is wrong.
  if (node.type === "conditional_expression") return []

  // PERL-MR4, fourth clause -- the same "code is not names" rule, now for a CALL's
  // own arguments. This was the last disagreement between the two grammars in the
  // whole corpus, at perl5/lib/B/Deparse-core.t:42:
  //
  //   use feature (sprintf(":%vd", $^V));   # to avoid relying on the feature
  //
  // The argument is a COMPUTED value. The bundle name is decided at runtime -- it
  // is `:5.36` or whatever `$^V` renders to -- so there is no name here to import.
  // 1.2.1 records ["*"], which is right. 2.0.0 recorded [":%vd"]: the FORMAT STRING
  // of sprintf, whose `%v` is a version conversion, not a feature bundle.
  //
  // It is a false positive that MY OWN third fix introduced. Making
  // `parenthesized_expression` transparent is correct, and it is also what let the
  // walk reach into the sprintf at all. A reachability fix that stops honouring
  // what the subtree CONTAINS ships that format string as an import name, so the
  // wrapper has to be transparent for FINDING arguments and NOT transparent for
  // READING them, and both halves need saying out loud.
  //
  // The callee name is not lost: this refuses only descending INTO the call, and
  // `sprintf` is published by the ordinary call machinery.
  if (node.type === "function_call_expression" || node.type === "method_call_expression" || node.type === "func0op_call_expression" || node.type === "func1op_call_expression" || node.type === "coderef_call_expression" || node.type === "ambiguous_function_call_expression") return []
  if (node.type === "binary_expression" || node.type === "lowprec_logical_expression" || node.type === "logical_not_expression") {
    const op = node.childForFieldName("operator") ?? node.children.find((c: any) => !c.isNamed)
    const t = op ? op.type : ""
    if (t === "and" || t === "or" || t === "||" || t === "&&" || t === "//") return []
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

/**
 * Is this `use`d module a PRAGMA? A pragma changes how the REST OF THIS FILE
 * compiles (`use strict`, `use integer`, `use feature 'class'`); it does not
 * export symbols into the caller. The distinction is metadata because the EDGE is
 * the same fact either way — the file loads the module — while a consumer asking
 * "which imported names are callable here" must not be told a pragma exported
 * any. Read from perl's own pragma module set; an unknown name is not a pragma.
 */
function isPerlPragma(module: string): boolean {
  return PERL_PRAGMAS.has(module)
}

const PERL_PRAGMAS = new Set([
  "strict", "warnings", "integer", "feature", "lib", "utf8", "bytes", "constant",
  "vars", "parent", "base", "overload", "bigint", "bignum", "bigrat", "open",
  "charnames", "autodie", "re", "attributes", "sigtrap", "sort", "subs", "threads",
  "fields", "if", "less", "locale", "mro", "ops", "version", "vmsish", "arybase",
  "deprecated", "experimental", "diagnostics", "sigtrap", "class", "builtin",
])

/** The words `ref()` returns for a BUILTIN container, not a class name. */
const PERL_BUILTIN_REF_TYPES = new Set(["ARRAY", "HASH", "SCALAR", "CODE", "REF", "GLOB", "LVALUE", "REGEXP", "IO", "VSTRING", "UNKNOWN"])

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
 * PERL-MR4: is this argument list a KEY/VALUE SPECIFICATION rather than a list of
 * names to import?
 *
 *   use overload q{""} => 'as_string', bool => sub () { 1 }, fallback => 1;
 *        q{""}      a key   -- which overload slot
 *        'as_string' a value -- the HANDLER the file must define, not to import
 *        bool       a key
 *        fallback   a key
 *
 * None of it is an imported name. The `=>` is an ANONYMOUS TOKEN between the
 * list's children rather than a `fat_comma` wrapper that the grammar does not have — which is why a `fat_comma`
 * guard changed nothing when it was tried first, and why that guard is kept
 * separately for the grammars that do wrap.
 *
 * The discriminator is POSITIONAL, and has to be: `as_string` and `fallback` are
 * perfectly good identifiers, and no spelling test separates "a handler the file
 * defines" from "a symbol a module exports". The `=>` is the only thing in the
 * source that says so.
 *
 * SCOPED to import arguments, and that scoping is the whole lesson: the first
 * version put this inside `perlWordValues`, where it also silenced
 * `our @EXPORT_OK = (gamma => 1, delta => 2)` — a list that uses `=>` precisely
 * because its KEYS are the exported names. One rule, applied one level too high,
 * deleted four real exports.
 */
function isArgumentSpecification(statement: Node): boolean {
  // A list WRAPPER is transparent: 2.0.0 puts the arguments in
  // `parenthesized_expression > list_expression`, so the `=>` tokens are
  // grandchildren of the node `perlArgumentNodes` returns. Checking only the
  // direct children is what the first attempt did, and it silently did nothing
  // on exactly the grammar this rule exists for — 2.0.0 still harvested
  // `q{""}`, `as_string`, `bool`, `fallback` and the file count went UP, from 23
  // differing to 27.
  // `parenthesized_expression` is 2.0.0-only and deliberately NOT listed, for the
  // reason PERL-MR11 gives for `noninterpolated_string_content`: a branch for a
  // grammar this lane does not run is dead code by definition, and the bump
  // requirement lives in reviews/perl/master-review.md instead.
  const WRAPPERS = new Set(["list_expression", "array_expression", "hash_expression", "anonymous_array_expression", "anonymous_hash_expression"])
  const hasFatArrow = (n: any): boolean => {
    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i)
      if (!child) continue
      if (!child.isNamed && child.type === "=>") return true
    }
    return false
  }
  // The `=>` tokens sit BETWEEN the arguments in the STATEMENT's own child list --
  // `perlArgumentNodes` returns only the NAMED children, so scanning the arguments
  // never sees them. That is why the first version of this rule was inert on
  // 1.2.1 as well as 2.0.0: on 1.2.1 the four harvested words came back as four
  // argument nodes with no `=>` among them. Measured directly on
  // Moose-2.4000/lib/Moose/Exception.pm:
  //     1.2.1  overload items=["\"\"","as_string","bool","fallback"]   <- the defect
  //     2.0.0  overload items=["*"]
  // so the harvest is a 1.2.1 defect and 2.0.0 is accidentally correct (it
  // reaches no argument nodes at all). The bump would have PAPERED OVER it.
  const nodes = [statement, ...Array.from({ length: statement.childCount }, (_, i) => statement.child(i)).filter(Boolean)] as any[]
  for (const n of nodes) {
    if (!n) continue
    if (hasFatArrow(n)) return true
    // One level of list wrappers only. Descending further would reach a closure
    // body, where a `=>` is a hash constructor the FILE wrote, not a specifier —
    // and treating that as "no imported names" would drop real items.
    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i)
      if (child && WRAPPERS.has(child.type) && hasFatArrow(child)) return true
    }
  }
  return false
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
  // PERL-MR4: 2.0.0 inserts `parenthesized_expression` between the statement and
  // its `list_expression`, so the direct-child lookup below cannot see the list at
  // all and every parenthesised `use` lost its arguments. Measured on
  // Catalyst-Runtime-5.90132/t/lib/PluginTestApp.pm:
  //     1.2.1  Catalyst items=["+TestApp::Plugin::FullyQualified","Test::Plugin"]
  //     2.0.0  Catalyst items=["*"]
  // Two real plugins dropped by the bump, in every parenthesised `use` across the
  // corpora. The wrapper is a grouping paren, so it is transparent here exactly
  // as the `_` and `,` tokens are -- and the same transparency the
  // `isArgumentSpecification` wrapper set already assumes, which is why that rule
  // had to be taught to look through wrappers before it could work at all.
  const list = perlFindChildByType(node, "list_expression")
  if (list) return list.namedChildren.filter((c): c is Node => !!c && perlWordValues(c).length > 0)
  // `parenthesized_expression` is itself a valid argument carrier when it holds a
  // single value (`use Foo ('Bar')`), so accept it in the fallback too.
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
     * A NAME a runtime QUERY names — not invoked, not called. The label is
     * `references` (the fleet's split: `uses` is a value the code reads,
     * `references` is a name a query tests), the target is the LEAF with the
     * written package in `metadata.qualifiedAs`, and the line is the literal's
     * own line.
     *
     * The leaf rule is the one the `\&name` branch documents and it applies here
     * for the same reason: one class is one node whether the query wrote it
     * qualified or not. A SELF-REFERENCE (querying the enclosing sub's own name)
     * is refused, exactly as the other reference sites refuse it.
     */
    const addReferenceName = (rawName: string, nameNode: Node, state: WalkState, reasonCode: string) => {
      const leaf = this.leafName(rawName)
      const source = state.functionName || state.ownerName || state.packageName || "global"
      if (!leaf || leaf === source) return
      const qualifier = rawName.includes("::") ? rawName.slice(0, rawName.lastIndexOf("::")) : undefined
      addRelationship(source, leaf, ASTEngine.RelationshipType.References, { reasonCode, ...(qualifier ? { qualifiedAs: rawName, qualifier } : {}) }, 0.9, nameNode)
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
    // THE QUALIFIED CLASS NAMES THIS RUN BOUND TO AN EDGE.
    //
    // WHY THIS EXISTS (2026-10-20, the lane's own measurement — see
    // validation/m14/verification/PERL-VERDICT-2026-10-20.md section 5.2).
    //
    // This lane publishes a receiver's class as its LEAF: `Mojo::UserAgent->new`
    // becomes the target `UserAgent.constructor`, and `use Mojolicious::Controller`
    // becomes the base leaf `Controller`. That truncation is the lane's own
    // convention and it is priced (the qualifier repair resolves 153 `extends` and
    // 536 `calls`/`overrides`/`instantiates` rows, and raises `arbitraryTwin` by
    // +149 / +531 — PERL-FIX.md section 3.2 — which the lane's own axis forbids).
    //
    // The DECLARED CAUSE channel (`metadata.baseBeyondRunScope`) then claimed, on
    // every such row, that "the base is beyond this run's reach". MEASURED OVER THE
    // WHOLE POPULATION, THAT CLAIM IS FALSE for 178 of the lane's 182 named causes
    // and 2222 of its 2251 cause edges: the base is declared by the PROJECT
    // (Base 712 edges <- Mojo::Base at mojo/lib/Mojo/Base.pm; EventEmitter 233;
    // IOLoop 166), and the SOURCE wrote it qualified within fifteen lines of the
    // edge. The run did not fail to REACH the base; it REACHED it and published its
    // LEAF. A cause that is true of the spelling the analyzer synthesised and false
    // of the class the edge means is a claim the reader cannot act on — and the
    // fleet's own ruling (finding 3.20) is that a claim refuted by the corpus is a
    // claim the ANALYZER should not have emitted, fixed LANE-SIDE, with claims
    // replaced by honest unresolved rows as the correct direction.
    //
    // SO THE FIX IS TO STATE THE CAUSE ONLY WHERE THE RUN COULD NOT NAME THE CLASS
    // AT ALL. This set holds the qualified class names the run bound to an edge, so
    // the cause channel can see that the run DID hold a name for that class — and
    // the row is then honestly `unresolved`, carrying its own reasonCode, instead of
    // carrying a claim that is not true.
    //
    // THE PRICE IS MEASURED AND IT IS ON THE PAGE: `causeOK` 2251 -> 29 over the
    // whole population, the gate's clause-1 residual 5534 -> 7756, and the
    // PRODUCTION VIEW UNCHANGED at 46.0798 % — because a declared cause was never a
    // resolution, and dropping it moves no resolution number. It moves rows from
    // "classified" to "honest", which is the direction the python lane took when it
    // retired its `decorates` claims.
    const qualifiedClassNames = new Set<string>()

    const addCall = (
      target: string,
      state: WalkState,
      calleeNode: Node,
      dynamicReceiver: boolean,
      callNode?: Node,
      builtinProbe?: string,
    ) => {
      // `&foo(...)` is perl's EXPLICIT-CALL syntax and `foo(...)` is the same
      // invocation of the same sub, so the `&` is sigil, not part of the name. The
      // emitted target used to keep it, and the measured cost was 93 `calls` edges
      // in 36 corpus files whose target was `&build_sysctl`, `&timediff`,
      // `&print_imp` -- none of which is a name the indexer stores, because the
      // symbol is `build_sysctl`. Every one of those edges was unresolvable at the
      // target end by construction, and no gate could see it: the label was right,
      // the count matched, and the differential derives its target from the same
      // `function` field this reads.
      //
      // The strip happens BEFORE the builtin probe and before the emitted target, so
      // `&print(...)` is suppressed as the builtin it is. Measured on the corpus:
      //   go-stdlib/src/syscall/mksysctl_openbsd.pl:166 -> &build_sysctl
      //   otp/lib/snmp/bin/snmp-v2tov1.pl:52             -> &print_imp
      //   perl5-core/Benchmark.pm:724                    -> &timediff
      const named = target.startsWith("&") ? target.slice(1) : target
      const probe = builtinProbe ?? named
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
      //
      // A REFERENCE IS NOT NOTHING, THOUGH, AND THE FIRST VERSION OF THIS RULE
      // STOPPED AT THE SUPPRESSION. The source NAMES a code slot as a value —
      // the fact `uses` carries everywhere else — so the edge belongs here and
      // not in no label at all. `defined &builtin::is_bool` is perl's most
      // idiomatic conditional probe and it was invisible: the construct has no
      // `refgen_expression` in it, the call branch refused it (correctly), and
      // nothing else looked. The panic cases are the same construct: `new
      // POSIX::SigSet &SIGINT` passes a handler slot as an argument.
      //
      // The target is the LEAF with the written package in `metadata.qualifiedAs`
      // — the rule the `\&name` branch has applied since its first version, and
      // its reason is measured: `\&Pkg::helper` and `\&helper` are ONE edge to
      // one sub, while the corpus writes 3,618 reference sites whose target is
      // COMPUTED (`\&$cb`, `\&{"Pkg::sub"}`) and carries no name at all, so a
      // target that trusted the text would have to fabricate one for those.
      if (target.startsWith("&") && !hasArgumentSyntax(callNode ?? calleeNode)) {
        const source = state.functionName || state.ownerName || state.packageName || "global"
        const leaf = this.leafName(named)
        // Same self-reference refusal as the `\&name` branch: `defined &run`
        // inside `sub run` is true of the source and useless in a graph.
        if (leaf && leaf !== source) {
          const qualifier = named.includes("::") ? named.slice(0, named.lastIndexOf("::")) : undefined
          addRelationship(source, leaf, ASTEngine.RelationshipType.Uses, { reasonCode: REASON.codeReference, ...(qualifier ? { qualifiedAs: named, qualifier } : {}) }, 0.9, calleeNode)
        }
        return
      }
      addRelationship(
        state.functionName || state.ownerName || state.packageName || "global",
        this.leafName(named),
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

        case "refgen_expression": {
          // `\&name` / `\&Package::name` -- perl's CODE REFERENCE. The sub is named
          // as a VALUE and nothing is invoked, which is a different fact from a call
          // and the reason this is not filed under `calls`: `$cb = \&helper;` runs
          // nothing, and a graph that reads it as a call says `helper` was executed.
          //
          // It is a `uses` edge because that is what `uses` is in every other lane:
          // a symbol named in a VALUE position. bash files a `$VAR` read that way,
          // ruby an `@ivar` read, python an `obj.attr` read, php a `$this->x` read.
          // The engine's own tier rule agrees on the tier (src/lsp/evidence_tier.ts
          // rule 3: `reference(s)`/`use(s)` -> usage_contextual), so the two labels
          // are separated on semantics instead: `uses` is a value this code USES,
          // `references` is a name a query NAMES. That split is what keeps the two
          // from being the same edge under two labels.
          //
          // WHY IT WAS 0 EDGES BEFORE THIS BRANCH. Nothing walked a
          // `refgen_expression`, and the grammar puts `\&helper` under a `function`
          // node with an `&` token -- which is the same shape as perl's EXPLICIT
          // CALL syntax `&helper(...)`, so the `function` field alone cannot separate
          // them. The discriminator is the `varname`: a code reference carries one,
          // and a reference to a computed slot (`\&$cb`, `\&{"Pkg::sub"}`, `\@array`)
          // does not. Measured over the derived population (5,127 files):
          // 1,267 `\&name` and 278 `\&Pkg::name` sites against 3,618 sites whose
          // target is NOT a written name -- so a text-shaped emitter would have
          // fabricated 3,618 targets, and the count is the reason the rule is a
          // positive `varname` allowlist rather than "strip a sigil and hope".
          //
          // `\&name(...)` is perl's "take a reference to a CALL", and the call is
          // filed as a `calls` edge by the ordinary function-call branch. It needs no
          // suppression here: the grammar types the `&name(...)` child as
          // `function_call_expression`, not `function`, so the lookup below finds
          // nothing. Measured on the grammar's own output, not assumed --
          //   `\&helper`     refgen_expression > function         > varname
          //   `\&helper(1)`  refgen_expression > function_call_expression > function > varname
          const fnNode = this.findChildByType(node, "function")
          if (!fnNode) break
          const varname = this.findChildByType(fnNode, "varname")
          if (!varname) break
          // EXACTLY one named child under the `function` node: the varname. Anything
          // else is a compound form (`&{...}`, `&($x)`) whose target is computed, and
          // its named child is not a `varname` at all -- so this is a second guard on
          // the same rule, not a new one.
          if (fnNode.namedChildCount !== 1) break
          const name = varname.text
          if (!name || !this.isWrittenCalleeName(name)) break
          const leaf = this.leafName(name)
          const source = state.functionName || state.ownerName || state.packageName || "global"
          // A self-reference (`\&run` inside `sub run`) is true of the source and
          // useless in a graph: the edge would be the only one in the label that
          // makes it reflexive. Same reasoning as the self-base guard below.
          if (leaf === source) break
          // The qualifier is recorded but not used as the target. `\&Pkg::helper`
          // and `\&helper` in one sub are ONE edge to `helper`, exactly as two calls
          // to the same leaf are one edge; the package the name carried is not lost,
          // it is in the metadata where a reader can ask for it.
          const qualifier = name.includes("::") ? name.slice(0, name.lastIndexOf("::")) : undefined
          addRelationship(source, leaf, ASTEngine.RelationshipType.Uses, { reasonCode: REASON.codeReference, ...(qualifier ? { qualifiedAs: name, qualifier } : {}) }, 0.9, varname)
          break
        }

        case "scalar":
        case "array":
        case "hash": {
          // `$Pkg::name` / `@Pkg::name` / `%Pkg::name` — a READ of another
          // package's declared variable, written as a name. Perl has no field
          // syntax, so this is the language's member read, and a variable read
          // is exactly `uses`'s contract: a name the code READS and does not
          // invoke. (`$self`, a lexical, and every unqualified read stay silent:
          // the label is about a name this file QUALIFIES, because only a
          // qualified name identifies a declaration another file owns.)
          //
          // THE TARGET KEEPS ITS FULL QUALIFICATION, and that is the opposite of
          // the code-slot rows on purpose. A code slot names ONE sub — `\&helper`
          // and `\&Pkg::helper` are the same sub, so the leaf is the identity and
          // the package rides in metadata. A package VARIABLE has no such
          // per-sub binding: `$Foo::LIMIT` and `$Bar::LIMIT` are two different
          // globals, and folding both to `LIMIT` is the leaf-collapse that makes
          // one package's counter look like the other's.
          //
          // REFUSED, measured: an unqualified read (`$TIMEOUT`) is not this
          // construct; and a COMPUTED package half (`$Config{ $key }::SSL_ERROR`)
          // does not parse as this shape at all — the grammar produces a
          // hash_element_expression followed by an ERROR node, so nothing written
          // can be resolved and no target is invented.
          const varname = this.findChildByType(node, "varname")
          const qualified = varname?.text || ""
          if (!qualified || !qualified.includes("::")) break
          if (!this.isWrittenCalleeName(qualified)) break
          const readSource = state.functionName || state.ownerName || state.packageName || "global"
          addRelationship(readSource, qualified, ASTEngine.RelationshipType.Uses, { reasonCode: REASON.qualifiedVariableRead }, 0.9, varname)
          break
        }

        case "equality_expression": {
          // `ref($x) eq 'Class'` — perl's type test written as a COMPARISON. The
          // grammar types it `equality_expression`, NOT `binary_expression` —
          // a reader that looked for the latter reported 0 occurrences of a
          // construct mojo writes 67 times. The class is the written literal; a
          // BUILTIN reference type (`ref($x) eq 'ARRAY'`) names no class and is
          // refused.
          const kids: Node[] = []
          for (let i = 0; i < node.namedChildCount; i++) {
            const c = node.namedChild(i)
            if (c) kids.push(c)
          }
          const isRefCall = (n: Node) => n.type === "func1op_call_expression" && String(n.child(0)?.text ?? "") === "ref"
          const refKid = kids.find(isRefCall)
          const litKid = kids.find((k) => k.type === "string_literal" || k.type === "interpolated_string_literal")
          if (refKid && litKid) {
            const word = this.wordValues(litKid)[0]
            if (word && this.isWrittenCalleeName(word) && !PERL_BUILTIN_REF_TYPES.has(word)) addReferenceName(word, litKid, state, REASON.refClassComparison)
          }
          break
        }

        case "bareword": {
          // `my $own = Ontology::VERSION;` — a package-qualified name in VALUE
          // position. Perl has no field syntax and no sigil'd form for a class,
          // so a qualified bareword in a value slot is the language's read of
          // that name. The target keeps its FULL qualification: `Config::Limits`
          // names a package, and a leaf would collapse `Foo::Bar` with `Baz::Bar`.
          //
          // REFUSED: a bareword in a position that DECLARES or INVOKES it — a
          // callee, a method invocant, a package statement's name, a `use`/
          // `require` module — because those belong to other labels; a TRAILING
          // `::` (an invocant spelling); and an UNQUALIFIED bareword, which is a
          // hash key or a string as often as it is a name. Only a value slot
          // (`= RHS`, a list element, a return) is read.
          const text = String(node.text ?? "")
          if (!text.includes("::") || text.endsWith("::")) break
          const parent = node.parent
          const parentType = parent ? String(parent.type) : ""
          // A HASH KEY IS NOT A NAME, and the two spellings both carry `::`:
          //   (Config::Only::Key => 1)   a bareword followed by a `=>` token —
          //                              a KEY/VALUE slot, not a value
          //   $only{Config::Only::Key}   a subscript key
          // Reading either as a package read published a name nothing declares.
          // The KEY test is the `=>` that FOLLOWS the node, which is the only
          // thing in the source that says so — the same positional rule the
          // import harvester uses one level up.
          if (parentType === "hash_element_expression" || parentType === "slice_container_variable") break
          if (parent) {
            let nextIsFatComma = false
            for (let i = 0; i < parent.childCount; i++) {
              const child = parent.child(i)
              if (!child || child.id !== node.id) continue
              const next = parent.child(i + 1)
              if (next && !next.isNamed && next.type === "=>") nextIsFatComma = true
              break
            }
            if (nextIsFatComma) break
          }
          const VALUE_PARENT = new Set(["assignment_expression", "return_expression", "list_expression", "expression_statement", "keyval_expression"])
          if (!VALUE_PARENT.has(parentType)) break
          let ancestor = parent
          let insideDirective = false
          for (let depth = 0; ancestor && depth < 4; depth++) {
            if (ancestor.type === "use_statement" || ancestor.type === "require_expression" || ancestor.type === "require_version_expression") { insideDirective = true; break }
            ancestor = ancestor.parent
          }
          if (insideDirective) break
          const source = state.functionName || state.ownerName || state.packageName || "global"
          addRelationship(source, text, ASTEngine.RelationshipType.Uses, { reasonCode: REASON.qualifiedNameAccess }, 0.9, node)
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
            items: args.length > 0 && !isArgumentSpecification(node) ? args : ["*"],
            isDefault: true,
            range: this.nodeToRange(node),
            metadata: { perlSpecific: true, type: "use" },
          })
          patterns.add("Module Includes")
          // **THE IMPORT EDGE ✓✓ — THE FACTS WERE COLLECTED AND NEVER PUBLISHED ✓✓.**
          //
          // The `imports` array above ✓✓ already holds every use/require site the
          // corpus expresses ✓✓ — 3,539 of them ✓✓ — and the ARM's TABLE 1 has
          // carried the row `imports 0` ✓✓ since the lane's first arm ✓✓, because
          // the facts went into the analyzer's OUTPUT SHAPE ✓✓ and never became
          // RELATIONSHIPS ✓✓.
          //
          // THE SHAPE IS THE FLEET'S ✓✓: the source is the IMPORTING SCOPE and the
          // target is the IMPORTED MODULE ✓✓ — the same shape the bash and clean
          // lanes publish `Imports` with ✓✓.
          //
          // `no strict;` never reaches here ✓✓ (it breaks out above ✓✓) and
          // `use constant` never reaches here ✓✓ (it breaks out above ✓✓) ✓✓,
          // because neither loads a module ✓✓.
          // A WRITTEN LOAD IS CERTAIN, and its metadata says which kind it is.
          // The authored-ahead ontology fixtures pin this surface — the kind
          // (`use_module` vs `require_module` vs `require_file`), whether the
          // module is a PRAGMA (its effects are lexical, not imported symbols),
          // and that a module load is a FILE-LEVEL fact whatever sub body wrote
          // it — and the previous emission carried none of it, so every such row
          // read as a metadata gap while the EDGE itself was right.
          addRelationship(state.packageName || "global", module, ASTEngine.RelationshipType.Imports, {
            reasonCode: REASON.useModuleLoad,
            perlSpecific: true,
            relationshipType: "use_module",
            isImport: true,
            fileLevel: true,
            isPragma: isPerlPragma(module),
            items: imports[imports.length - 1]?.items ?? [],
          }, 1.0, node)
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
          // A `use` STATEMENT's ARGUMENT LIST IS WALKED, so a CODE REFERENCE
          // inside it -- `use overload '&{}' => \&to_app_auto, fallback => 1;` --
          // is VISITED and published as a `uses` edge.
          //
          // MEASURED (2026-10-21): the branch RETURNED here, so the argument list
          // was never walked, and the 2 `uses` rows the oracle derives
          // (`uses|Plack::Component|to_app_auto` .
          // `uses|Plack::Recursive::ForwardRequest|as_string`) had no analyzer
          // edge -- a real EMISSION GAP, and the oracle is right.
          //
          // The arguments live in a `list_expression` DIRECT NAMED CHILD with no
          // `arguments` field -- measured on the grammar, not assumed.
          const useArgList = this.findChildByType(node, "list_expression")
          if (useArgList) walk(useArgList, state)
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
          // The payload is a MODULE NAME (bareword/package) or a FILE PATH (a
          // string literal). The old reader accepted only the name form, so
          // `require ./lib/Bootstrap.pm` published NO dependency at all — a
          // real load missing from the graph. The two are separated in
          // metadata.relationshipType because a resolver can chase a module name
          // and can only display a path.
          const moduleNode = this.findChildByType(node, "bareword") || this.findChildByType(node, "package")
          // ONLY a plain string literal is a WRITTEN path. A double-quoted
          // `require "./lib/Late$stage.pm"` interpolates at runtime: the specifier
          // is computed, so nothing written can be resolved and the rule is the
          // presence of a written literal, not the presence of a quote.
          const pathNode = this.findChildByType(node, "string_literal")
          const module = pathNode ? this.wordValues(pathNode)[0] ?? "" : moduleNode?.text ?? ""
          if (!module) break
          imports.push({
            module,
            items: [],
            isDefault: false,
            range: this.nodeToRange(node),
            metadata: { perlSpecific: true, type: "require" },
          })
          // THE REQUIRE EDGE ✓✓ — the same gap as the `use` edge ✓✓.
          //
          // `require Some::Module` is a runtime load ✓✓ and it IS a dependency ✓✓
          // (the file cannot run without it ✓✓), and the analyzer's own comment
          // says so ✓✓ — but the fact went into the output shape ✓✓ and never
          // became a relationship ✓✓, so the ARM's TABLE 1 carried `imports 0` ✓✓.
          addRelationship(state.packageName || "global", module, ASTEngine.RelationshipType.Imports, {
            reasonCode: REASON.runtimeRequire,
            perlSpecific: true,
            relationshipType: pathNode ? "require_file" : "require_module",
            ...(pathNode ? { specifier: "path" } : {}),
            isImport: true,
            fileLevel: true,
            isPragma: false,
            items: [],
          }, 0.9, node)
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
              // **THE EXPORT EDGE ✓✓ — THE SAME GAP, THE OTHER SIDE ✓✓.**
              //
              // The exported NAME was collected above ✓✓ and the ARM's TABLE 1 has
              // carried the row `exports 0` ✓✓ — the names went into the analyzer's
              // OUTPUT SHAPE ✓✓ and never became RELATIONSHIPS ✓✓.
              //
              // THE SHAPE IS THE FLEET'S ✓✓: the source is the OWNING MODULE and the
              // target is the EXPORTED NAME ✓✓ — the same shape the bash lane
              // publishes `Exports` with ✓✓.
              // The NAME's own line, not the assignment's: a wrapped
              // `@EXPORT_OK = ( \n gamma, \n delta )` writes the names on lines the
              // assignment never touches, and M59's rule is that an edge carries
              // the line that names it.
              addRelationship(state.packageName || "global", exported, ASTEngine.RelationshipType.Exports, { reasonCode: REASON.exportedArrayDeclaration, perlSpecific: true, exportArray: leftName }, 1.0, node, this.lineOfNameWithin(right, exported))
            }
            patterns.add("Exports")
          }
          if (leftName === "EXPORT_TAGS" && right) {
            // `%EXPORT_TAGS = (tag => \@NAMES)` — the fat-comma KEYS are the
            // opt-in tag names callers pass to `import`.
            for (const tag of this.fatCommaKeys(right)) {
              exports.push({ name: tag.text, kind: ASTEngine.SymbolKind.Function, range: this.nodeToRange(node), metadata: { perlSpecific: true, exportTag: "EXPORT_TAGS" } })
              addRelationship(state.packageName || "global", tag.text, ASTEngine.RelationshipType.Exports, { reasonCode: REASON.exporterSurface, perlSpecific: true, exportTag: "EXPORT_TAGS" }, 1.0, node, tag.startPosition.row + 1)
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
          if (target === "bless") {
            // `bless $self, 'Class'` — the CLASS is the last written literal of
            // the argument list. The grammar hands the whole list to the call's
            // `arguments` field, so a reader that looked for a literal on the
            // carrier found a `list_expression` and nothing else, and the
            // construct the `references` label rests on produced NO edge. The
            // elements are read one by one. A COMPUTED class
            // (`bless $self, $class`) states no name and is refused.
            const els = this.compositionElements(node)
            let cls: string | undefined
            let clsNode: Node | undefined
            for (const el of els) {
              if (el.type !== "string_literal" && el.type !== "interpolated_string_literal") continue
              const word = this.wordValues(el)[0]
              if (word && this.isWrittenCalleeName(word)) { cls = word; clsNode = el }
            }
            if (cls && clsNode) addReferenceName(cls, clsNode, state, REASON.blessClassLiteral)
            break
          }
          if (target === "UNIVERSAL::isa") {
            // The FUNCTION spelling of the type test. The class is the LAST
            // written literal — the three-argument form
            // `UNIVERSAL::isa($x, ref($x), 'C')` still ends with the class, which
            // is the fact this reader shares with the method spelling. The CALL
            // itself stays a `calls` edge (it invokes a UNIVERSAL builtin), so
            // this branch does not break.
            const els = this.compositionElements(node)
            let cls: string | undefined
            let clsNode: Node | undefined
            for (const el of els) {
              if (el.type !== "string_literal" && el.type !== "interpolated_string_literal") continue
              const word = this.wordValues(el)[0]
              if (word && this.isWrittenCalleeName(word)) { cls = word; clsNode = el }
            }
            if (cls && clsNode) addReferenceName(cls, clsNode, state, REASON.universalIsaLiteral)
          }
          if (target === "push") {
            // `push @EXPORT_OK, qw(a b)` and `push @ISA, 'Base'` — perl builds
            // two of its DECLARATIONS with `push`, and the assignment-only reader
            // published neither: a module's exported API was the assignment half
            // only, and inheritance by `push` published no `extends` edge (and,
            // because it bypassed `addBase`, left the override resolver blind to
            // the base). The elements are read one by one because the call's
            // `arguments` field holds the whole `list_expression` — the same
            // shape the `with` reader had to learn.
            //
            // The array being pushed onto is the FIRST element and it names the
            // DECLARATION; a qualified varname (`@Pkg::ISA`) names the OWNER, so
            // the edge is sourced from the package the source wrote.
            //
            // REFUSED, and each refusal is a shape the fixture pins:
            //   push @EXPORT_OK, @Other::EXPORT_OK   copies ANOTHER module's
            //       array; its contents are not written here, so nothing is
            //       invented.
            //   push \@ISA, __FILE__                 a REFERENCE to the array is
            //       not a declaration of a base.
            const elements = this.compositionElements(node)
            const targetEl = elements[0]
            const arrayVar = targetEl && targetEl.type === "array" ? this.findChildByType(targetEl, "varname")?.text ?? "" : ""
            const arrayName = this.leafName(arrayVar)
            const owner = arrayVar.includes("::") ? arrayVar.slice(0, arrayVar.lastIndexOf("::")) : state.packageName || "global"
            const NAMED_ELEMENT = new Set(["quoted_word_list", "string_literal", "interpolated_string_literal", "autoquoted_bareword", "bareword"])
            if (arrayName === "EXPORT" || arrayName === "EXPORT_OK") {
              for (const el of elements.slice(1)) {
                if (!NAMED_ELEMENT.has(el.type)) continue
                for (const value of this.wordValues(el)) {
                  if (!value || this.isOption(value)) continue
                  exports.push({ name: value, kind: ASTEngine.SymbolKind.Function, range: this.nodeToRange(node), metadata: { perlSpecific: true, exportArray: arrayName } })
                  addRelationship(owner, value, ASTEngine.RelationshipType.Exports, { reasonCode: REASON.exportedArrayPush, perlSpecific: true, exportArray: arrayName }, 1.0, node, this.lineOfNameWithin(el, value))
                }
              }
              patterns.add("Exports")
            } else if (arrayName === "ISA") {
              const bases: string[] = []
              const lines = new Map<string, number>()
              for (const el of elements.slice(1)) {
                if (!NAMED_ELEMENT.has(el.type)) continue
                for (const value of this.wordValues(el)) {
                  if (!value || this.isOption(value)) continue
                  bases.push(value)
                  const line = this.lineOfNameWithin(el, value)
                  if (line !== undefined) lines.set(value, line)
                }
              }
              // Routed through `addBase` so the OVERRIDE resolver reads the
              // base too — the same reason the bare-`extends` spelling routes
              // there instead of emitting directly.
              if (bases.length) addBase(owner, bases, REASON.isaArrayPush, targetEl, lines)
            }
            break
          }
          if (target === "has") {
            // `has 'name' => (...)` — the attribute NAME is the first argument;
            // the symbol's range must be that name, not the whole statement.
            //
            // **AND `has [qw(a b c)]` DECLARES SEVERAL ATTRIBUTES, AND THE ANALYZER
            // PUBLISHED ONLY THE FIRST — A REAL EMISSION GAP, FOUND BY THE LANE'S OWN
            // ORACLE AND NOT BY A MUTANT.**
            //
            // MEASURED (2026-10-21, script/m14/perl-truth-run.ts): the lane's oracle
            // derives every name of a `has [qw(...)]` declaration, the analyzer published
            // one of them, and the difference was 66 unexplained `contains` rows over the
            // population. The declarations are real and common: `has [qw(handlers
            // helpers)]` (mojo/lib/Mojolicious/Renderer.pm:18), `has [qw(conditions
            // shortcuts)]` (mojo/lib/Mojolicious/Routes.pm:13), `has [qw(constraints
            // defaults types)]` (mojo/lib/Mojolicious/Routes/Pattern.pm:6) — so
            // `helpers`, `shortcuts`, `defaults` and `types` were DECLARED MEMBERS THAT
            // NO EDGE NAMED.
            //
            // AND A QUOTED NAME IS ONE NAME: `has 'has spaces'` was split at the
            // space by the shared word splitter, publishing a member named `has`
            // (a real perl function, so `bb_impact` on it would reach every Moose
            // class) while the declared member got nothing. `attributeNames` keeps
            // the split for the shapes that ARE lists and never for a literal.
            const attrs = this.attributeNames(node)
            for (const attr of attrs) {
              if (!attr.name || !state.packageName) continue
              if (symbolKeys.has(`${ASTEngine.SymbolKind.Property}\u001f${state.packageName}\u001f${attr.name}`)) continue
              addSymbol(attr.name, ASTEngine.SymbolKind.Property, attr.node, { ...state, ownerName: state.packageName, ownerKind: ASTEngine.SymbolKind.Class }, { isMooseProperty: true }, state.packageName)
            }
            frameworks.add("Moose/Moo OOP")
            patterns.add("Declarative Properties")
          } else if (target === "with" || target === "extends") {
            // `with 'Role'` / `with qw(A B)` / `with 'A', { -excludes => [...] },
            // 'B'` / `with 'A' => { ... }, 'B' => { ... }` — all four shapes the
            // fleet measured, and the reader below is element-wise for that reason:
            // the call's `arguments` field holds ONE `list_expression`, so reading
            // `wordValues(arg)[0]` read the first word of the WHOLE list and dropped
            // every name after it. That is the `with qw(A B)` defect the fixture's
            // rationale prices at 6 of 94 implements rows and 5 of 109 extends rows
            // on 142 Moo files, and it silently lost the third element of the mixed
            // form too.
            const isWith = target === "with"
            for (const arg of this.compositionElements(node)) {
              // A bare `{ ... }` among the names is a MODIFIER SPECIFICATION: its
              // keys are OPTION names (`-excludes`, `-alias`), and publishing them
              // as roles was measured on Moose's role_conflict_detection.t.
              if (arg.type === "anonymous_hash_expression" || arg.type === "hash_expression" || arg.type === "anonymous_array_expression") continue
              for (const value of this.wordValues(arg)) {
                if (!value || this.isOption(value)) continue
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
              if (indirect.name.includes("::")) qualifiedClassNames.add(indirect.name)
              addRelationship(state.functionName || state.packageName || "global", `${this.leafName(indirect.name)}.constructor`, ASTEngine.RelationshipType.Instantiates, { isConstructor: true, reasonCode: REASON.indirectObjectInvocation }, 0.9, node)
              break
            }
            const requestedType = this.firstValue(node)
            const instanceTarget = requestedType && !requestedType.includes("$") ? `${this.leafName(requestedType)}.constructor` : "constructor"
            if (requestedType && requestedType.includes("::")) qualifiedClassNames.add(requestedType)
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
              if (owner && owner !== "main") {
                if (owner.includes("::")) qualifiedClassNames.add(owner)
                addRelationship(state.functionName || owner, `${this.leafName(owner)}.constructor`, ASTEngine.RelationshipType.Instantiates, { isConstructor: true, reasonCode: REASON.magicTokenInvocant }, 0.9, invocant ?? node)
              }
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
              if (target.includes("::")) qualifiedClassNames.add(target)
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
              if (recvTarget.includes("::")) qualifiedClassNames.add(recvTarget)
              addCall(`${this.leafName(recvTarget)}.${method}`, state, methodNode ?? node, false, node, method)
            } else {
              addCall(method, state, methodNode ?? node, true, node, method)
            }
          }
          // A class / role / method NAMED IN A QUERY rather than invoked.
          // `UNIVERSAL` exposes exactly three such queries and all three take the
          // name as an argument, so the query IS the method call:
          //
          //   $obj->isa('Class')    does this object satisfy this class
          //   $obj->DOES('Role')    does it satisfy this role
          //   $obj->can('method')   does this method exist
          //
          // None of them invokes anything, which is why the target cannot be a
          // `calls` edge (`calls -> isa` would say a sub named `isa` ran), and
          // why the name cannot be a `uses` edge either: `uses` is a value the
          // code uses, and this is a name a query tests against. It is a
          // `references` edge -- the same label python's analyzer emits for its
          // identical construct, `isinstance(x, T)`.
          //
          // The name must be WRITTEN. `$obj->isa($class)` and
          // `$obj->can($method)` pass a variable, so the file states no name at
          // all and publishing one would invent a symbol. Measured over the
          // derived population (5,127 files): 341 literal `isa`, 11 literal
          // `DOES`, 512 literal `can`, against 170 `isa($var)` and 5
          // `DOES($var)` sites that are deliberately refused.
          //
          // `UNIVERSAL::isa($x, 'C')` -- the FUNCTION spelling of the same query --
          // is measured at 0 sites in 5,127 files, so there is no branch for it
          // here: a branch for a construct the corpus does not contain is dead
          // code by this lane's own standard, and the ruling is recorded with its
          // count instead.
          if (method === "isa" || method === "DOES" || method === "can") {
            const args = this.argumentNodes(node)
            const named = this.fieldNodes(node, "arguments").filter((a) => a.isNamed)
            const first = named[0] ?? args[0]
            const queried = this.literalNameIn(first)
            if (queried && this.isWrittenCalleeName(queried) && !PERL_MAGIC_TOKENS.has(queried)) {
              const leaf = this.leafName(queried)
              const source = state.functionName || state.ownerName || state.packageName || "global"
              // Two self-reference shapes, both true of the source and useless in a
              // graph, so both are refused -- the same rule the self-base guard
              // applies to `extends`:
              //   `$self->can('run')` inside `sub run`            leaf === source
              //   `$self->isa('My::Class')` in `package My::Class`  queried === package
              const selfByMethod = leaf === source
              const selfByPackage = state.packageName !== "" && queried === state.packageName
              if (!selfByMethod && !selfByPackage) {
                const nameNode = this.queriedNameNode(first) ?? first
                addRelationship(
                  source,
                  leaf,
                  ASTEngine.RelationshipType.References,
                  // The written package rides in `qualifiedAs` for the same
                  // reason the other reference sites record it: the target is the
                  // LEAF (one class, one node) and the qualification the source
                  // wrote is not lost, it is metadata a reader can ask for.
                  { reasonCode: REASON.typeQueryLiteral, query: method, ...((queried.includes("::")) ? { qualifiedAs: queried } : {}) },
                  0.9,
                  nameNode,
                )
              }
            }
          }
          break
        }
      }

      if (node.type !== "source_file") {
        // A `package` STATEMENT governs the rest of its ENCLOSING BLOCK, so a
        // block's children are walked with a COPY of the state and the
        // statement's mutation cannot escape the block.
        //
        // MEASURED (2026-10-21): the analyzer attributed a WHOLE FILE to a
        // `package` statement declared LATER in it -- in
        // mojo/t/mojo/base_util.t, `use Sub::Util qw(subname);` at line 3 and
        // `subtest 'class_to_path' => sub {` at line 4 were filed under
        // `MojoMonkeyTest`, while the `package MojoMonkeyTest;` statement is at
        // line 19, inside a `{ }` inside a `subtest` sub: 12 edges the analyzer
        // published that it should not have (8 `calls`, 4 `references`).
        //
        // THE FILE SCOPE keeps the SHARED state, so a top-level `package NAME;`
        // still governs the rest of the file -- perl's rule -- and only a
        // package inside a block is confined to that block.
        const childState: WalkState =
          node.type === "block" || node.type === "block_statement" ? { ...state } : state
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i)
          if (child) walk(child, childState)
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
        // THE TARGET IS THE DECLARED MEMBER, NOT `Base.method` — see the cpp site for the measurement;
        // this lane resolved 9 of 1,280 with the dotted spelling. The owner is CARRIED rather than
        // dropped, so a reader can still tell which base declares it.
        addRelationship(`${symbol.ownerName}.${method}`, method, ASTEngine.RelationshipType.Overrides, { isOverride: true, reasonCode: REASON.baseDeclaresMethod, overriddenOwner: baseLeaf }, 0.95, undefined, nameLineOf(symbol))
      } else if (!context?.overrideCompanion?.has(base) && !context?.overrideCompanion?.has(baseLeaf)) {
        // PERL-MR14. The guard used to be `!context?.overrideCompanion` — it asked
        // whether a companion OBJECT was supplied, not whether it had an OPINION
        // about THIS base. So passing any companion at all silenced the guess for
        // every base the companion did not cover, and the edge was DELETED rather
        // than kept as a guess. Measured on a 120-file draw per corpus: 2,235
        // guessed override edges, of which 2,215 named a base the companion did
        // NOT contain — and 1,928 of them vanished. A companion is a partial view
        // by construction (a sample, a subset, an incremental index), and "I have
        // never heard of this base" is not "this base does not declare the method".
        //
        // The python lane already reads this correctly (`else if
        // (!overrideCompanion?.has(base))`), which is where the correct form came
        // from. The cost of the wrong form is invisible in the common case: it
        // only fires when someone supplies a companion at all, and until this
        // round nobody did (M37.10) — which is exactly how a defect that deletes
        // the majority of a relationship label survives to be found by building
        // the instrument that was missing.
        //
        // Otherwise: the base is not declared in this file and the companion has
        // no opinion. Emit the deterministic first-parent guess BELOW the
        // patterns.ts threshold (0.7): visible in raw output, counted as heuristic
        // (honest suspicion) by the differential. Pre-M37.10 this edge was
        // silently dropped for every externally-declared base package.
        if (base.includes("::")) qualifiedClassNames.add(base)
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

    // THE STATED CAUSE, ON THE CHANNEL THE ARBITER READS. Placed after every emitter (the call
    // walk, the deferred base pass, the override pass) and before the return, because it is a
    // statement ABOUT the edges that already exist: it adds one metadata key and changes no
    // source, target, label, line or confidence.
    this.publishStatedCauses(symbols, relationships, qualifiedClassNames)

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
      // `src/lsp/evidence_tier.ts` rule 2 names `imports` as `import_based`, and
      // the fallthrough here was overriding the fleet's own derivation with
      // `inferred` — a stored tier must not contradict the single derivation.
      // `exports` is the same import surface (the module's declared API), so it
      // takes the same tier rather than falling to "a guess".
      if (type === "imports" || type === "exports") { md.evidenceClass = "import_based"; continue }
      if (type === "instantiates" || type === "extends" || type === "implements") {
        md.evidenceClass = (r.confidence ?? 0) >= 0.9 ? "structural" : "inferred"
        continue
      }
      if (type === "calls") {
        md.evidenceClass = (r.confidence ?? 0) >= 0.85 ? "usage_contextual" : "inferred"
        continue
      }
      // `uses` and `references` are named by `src/lsp/evidence_tier.ts` rule 3
      // as `usage_contextual`, and this lane's own reason codes say why they are
      // not structural: a code reference names a sub it does not invoke, and a
      // type query names a class it does not test at this layer. Without these
      // two branches both labels fell through to `inferred`, which is the tier
      // for "a guess" -- and these are not guesses, they are written names.
      if (type === "uses" || type === "references") {
        md.evidenceClass = (r.confidence ?? 0) >= 0.7 ? "usage_contextual" : "inferred"
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
    let from = 0
    for (;;) {
      const idx = text.indexOf(name, from)
      if (idx < 0) return undefined
      const before = idx > 0 ? text[idx - 1] : ""
      const after = text[idx + name.length] ?? ""
      if (!isPerlIdentChar(before) && !isPerlIdentChar(after)) {
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
    // Whitespace, and every character that cannot appear in a written name.
    // Character-by-character, NOT a regular expression: this lane's contract is
    // zero regex literals, proved by script/m14/tmp/perl-zero-regex.mts against the
    // M12 AST scanner, and the first version of this allowlist used three of them.
    // The zero-regex instrument caught it on its next run, which is the gate doing
    // exactly the job it exists for — a rule written for a corpus is a rule that
    // eventually meets its own lane's constraints.
    for (let i = 0; i < t.length; i++) {
      const c = t.charAt(i)
      if (c === " " || c === "\t" || c === "\n" || c === "\r") return false
      if (c === "$" || c === "{" || c === "}") return false
    }
    if (t.includes("->")) return false

    // A LEADING `&` and a LEADING `::` are both written-name shapes, and rejecting
    // them was a self-inflicted regression worth recording: the first version of
    // this allowlist omitted both, and it cost 32 truth rows on Moo, 155 on Moose
    // and 97 on perl5, every one of them a call the file really does make.
    //   ::is_deeply(...)  an ABSOLUTE package path — `::foo` is how perl writes
    //                      "the package foo, unambiguously"
    //   &encode(...)      explicit-call syntax; whether it is a call or a code-slot
    //                      REFERENCE is decided by `hasArgumentSyntax`, which is a
    //                      separate and already-correct rule. Forbidding `&` here
    //                      pre-empted it and deleted both cases.
    let i = 0
    if (t.charAt(i) === "&") i++
    if (t.charAt(i) === ":" && t.charAt(i + 1) === ":") i += 2
    // One or more `Segment::`, then a final Segment.
    let segments = 0
    for (;;) {
      if (segments > 0) {
        if (t.charAt(i) !== ":" || t.charAt(i + 1) !== ":") break
        i += 2
      }
      if (!isPerlIdentStart(t.charAt(i))) return false
      i++
      while (isPerlIdentChar(t.charAt(i))) i++
      segments++
      if (i >= t.length) return true
    }
    return false
  }

  /**
   * The ELEMENTS of a role-composition argument list — the shapes `with` and
   * `extends` are written in, as separate elements rather than as one blob.
   *
   * The call's `arguments` field holds ONE `list_expression` for every
   * multi-argument form, so a reader that treated that field as a single argument
   * read the first word of the WHOLE list and dropped the rest. Expanding the list
   * into its named children restores the element boundary: in
   * `with A, { -excludes => [...] }, B` the elements are A, the modifier hash
   * and B, which is exactly the information the role reader needs.
   */
  private compositionElements(node: Node): Node[] {
    const out: Node[] = []
    for (const arg of this.argumentNodes(node)) {
      if (arg.type === "list_expression") {
        for (let i = 0; i < arg.namedChildCount; i++) {
          const child = arg.namedChild(i)
          if (child) out.push(child)
        }
      } else out.push(arg)
    }
    return out
  }

  /**
   * The names a `has` declaration declares — ONE per element of its name list.
   *
   * TWO facts live here and each was a measured defect. (1) A QUOTED name is ONE
   * name whatever it contains: `has 'has spaces' => (is => 'ro')` is a legal
   * attribute whose name has a space in it, and the old reader ran the name
   * through `wordValues`, whose whitespace splitter exists for `qw(a b)` (a real
   * LIST) and truncated this to `has` — publishing a member named `has`, which is
   * a real perl function, while the declared member got no symbol at all. (2) A
   * `qw`/array list declares SEVERAL attributes: `has [qw(handlers helpers)]` is
   * two members, and reading only the first dropped the rest.
   *
   * The splitter is therefore applied to the shapes that ARE lists
   * (`quoted_word_list`, each element of an array), and never to a string
   * literal's own content.
   */
  private attributeNames(node: Node): { name: string; node: Node }[] {
    const args = this.argumentNodes(node)
    const first = args[0]
    if (!first) return []
    const head = first.type === "list_expression" && first.namedChildCount > 0 ? first.namedChild(0) : first
    if (!head) return []
    return this.namesOfDeclarator(head)
  }

  private namesOfDeclarator(head: Node): { name: string; node: Node }[] {
    if (head.type === "string_literal") {
      const content = head.childForFieldName("content") || this.findChildByType(head, "string_content")
      const name = content ? content.text : unquote(head.text)
      return name ? [{ name, node: content ?? head }] : []
    }
    if (head.type === "quoted_word_list") {
      const content = head.childForFieldName("content") || this.findChildByType(head, "string_content")
      if (!content) return []
      return splitWords(content.text).filter(Boolean).map((name) => ({ name, node: content }))
    }
    // `has [qw(a b)]` / `has [ 'a', 'b' ]` — an array of names.
    if (head.type === "anonymous_array_expression" || head.type === "array_expression") {
      const out: { name: string; node: Node }[] = []
      for (let i = 0; i < head.namedChildCount; i++) {
        const child = head.namedChild(i)
        if (child) out.push(...this.namesOfDeclarator(child))
      }
      return out
    }
    if (head.type === "interpolated_string_literal") {
      // A DOUBLE-quoted literal. With no interpolated variable it is one name,
      // verbatim exactly like the single-quoted case; with one it names nothing
      // resolvable and the word pieces are all the file writes.
      const pieces: string[] = []
      let interpolates = false
      for (let i = 0; i < head.namedChildCount; i++) {
        const child = head.namedChild(i)
        if (!child) continue
        if (child.type === "string_content") pieces.push(...splitWords(child.text))
        else if (child.type === "scalar" || child.type === "array" || child.type === "hash") interpolates = true
      }
      if (interpolates) return pieces.filter(Boolean).map((name) => ({ name, node: head }))
      const content = head.childForFieldName("content") || this.findChildByType(head, "string_content")
      const verbatim = content ? content.text : ""
      return verbatim ? [{ name: verbatim, node: content ?? head }] : []
    }
    // A bareword (`has attr => ...`) — one name.
    return this.wordValues(head).filter(Boolean).map((name) => ({ name, node: head }))
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

  /**
   * The NAME an argument node writes, and only when it writes one literally.
   *
   * `'Class::Name'` and `Class::Name` are names. `$class`, `@classes` and
   * `"Pkg::$sub"` are not: the file states no name, so an edge built on one
   * would name a symbol the source never mentions. The interpolation test is
   * character comparison on the literal's own text, never a pattern -- the
   * grammar exposes the unquoted body under `content`, so there is nothing to
   * unquote here and nothing to strip.
   *
   * Returns undefined for every other node type, which is the refusal the
   * measured counts depend on: 170 `isa($var)` and 5 `DOES($var)` sites in
   * 5,127 files resolve to nothing rather than to a guess.
   */
  private literalNameIn(node: Node | undefined): string | undefined {
    if (!node) return undefined
    if (node.type !== "string_literal" && node.type !== "bareword" && node.type !== "package" && node.type !== "autoquoted_bareword") return undefined
    // An INTERPOLATED literal is only a name when nothing was interpolated into
    // it -- the same rule `namesAClass` already applies, for the same reason.
    if (node.text.includes("$")) return undefined
    const content = node.childForFieldName("content") ?? this.findChildByType(node, "string_content")
    const text = String(content?.text ?? node.text ?? "").trim()
    return text.length ? text : undefined
  }

  /**
   * The node a queried name is WRITTEN on, so the edge's `line_number` is the
   * line that names it and not the line the call starts on (M59.A7: the line
   * comes from the node that NAMES the edge). `literalNameIn` already decided
   * the name exists; this only locates it.
   */
  private queriedNameNode(node: Node | undefined): Node | undefined {
    if (!node) return undefined
    return node.childForFieldName("content") ?? this.findChildByType(node, "string_content") ?? this.findChildByType(node, "varname") ?? node
  }

  private stripSigil(name: string): string {
    if (!name) return name
    const first = name[0]
    return first === "$" || first === "@" || first === "%" || first === "#" ? name.slice(1) : name
  }

  private leafName(name: string): string {
    // A TRAILING `::` is perl's "this class, unambiguously" spelling
    // (`Config::Limits::->new`), NOT an empty final segment. Taking the text
    // after the last `::` gave the empty string, so the edge published
    // `.constructor` — an endpoint with no owner at all, the one shape a target
    // can be that nobody could name.
    let trimmed = name
    while (trimmed.length >= 2 && trimmed.charAt(trimmed.length - 1) === ":" && trimmed.charAt(trimmed.length - 2) === ":") trimmed = trimmed.slice(0, -2)
    const colon = trimmed.lastIndexOf("::")
    return colon >= 0 ? trimmed.slice(colon + 2) : trimmed
  }

  /**
   * THE BASE A `leaf.member` TARGET NAMES — the single-dot, identifier-shaped owner the declared
   * cause channel is defined over, or null when the target cannot carry that claim at all.
   *
   * This is not a style choice, it is the channel's own precondition. The arbiter takes the owner
   * as everything before the LAST dot (`incoming-rule.ts` `targetOwner`) and accepts a stated base
   * only when it is IDENTIFIER-SHAPED and IS that owner
   * (`classifyEdge`: `const shaped = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(claim.base)` then
   * `const consistent = shaped && owner === claim.base`). A target carrying two dots, an empty
   * member, or an owner with `::` in it therefore cannot be given this claim: writing one there
   * reads `causeRefuted`, which is `causeFAIL` — a clause-4 defect, not a stated cause.
   *
   * The character test is the lane's own `isPerlIdentStart`/`isPerlIdentChar` rather than a regex
   * literal, because this file's contract forbids regex literals (proved by
   * `script/m14/tmp/perl-zero-regex.mts`), and reusing them keeps the predicate from drifting away
   * from the rest of the lane.
   */
  private statedOwnerOf(target: string): string | null {
    const dot = target.lastIndexOf(".")
    if (dot <= 0 || dot === target.length - 1) return null
    // EXACTLY ONE DOT: `IOLoop.start` is the shape; `Foo::Bar.baz` and `a.b.c` are not.
    if (target.indexOf(".") !== dot) return null
    const owner = target.slice(0, dot)
    if (!isPerlIdentStart(owner[0]!)) return null
    for (let i = 1; i < owner.length; i++) if (!isPerlIdentChar(owner[i]!)) return null
    return owner
  }

  /**
   * PUBLISH THE REASON THE LANE ALREADY COMPUTES, ON THE KEY THE GATE READS — the fleet's finding
   * (a), measured on this lane rather than assumed: every perl edge below confidence 1.0 carries a
   * machine-readable `metadata.reasonCode` (M14 HONESTY-CONTRACT §4.1 — the 1,664 `contains` edges
   * are @1.0 and carry none), and the arbiter's bucket-3 column reads
   * `metadata.baseBeyondRunScope` ONLY (`incoming-rule.ts` `CAUSE_CLAIM_KEY`). So the gate printed
   * `causeOK 0`, `clause 2 ok — no edge carries a declared cause (residual 6998)`, and clause 2
   * passed VACUOUSLY over a 4,110-edge unresolved residual. See
   * `validation/m14/verification/PERL-FIX.md` for the bucketed residual and the measurements.
   *
   * WHAT THE CLAIM MEANS, and it is a claim about the RUN, not about the project: "the base this
   * edge names is beyond THIS RUN's reach" (`incoming-rule.ts`, `CAUSE_CLAIM_KEY`). Production
   * parses a perl file with NO project index and NO override companion
   * (`parallel-indexer.ts` `PROJECT_INDEX_EXTENSIONS` names only `.sol`), so a class another file
   * declares is genuinely out of this run's sight — which is exactly what the lane's own reason
   * codes already say (`first-parent-guess`: "the base does not declare it anywhere visible";
   * `name-only-callee`: "whether it binds to a sub in this file, an imported sub, or a
   * module-level sub is not decided at this edge"). Dart is the reference implementation of this
   * mechanism for the index-less case (`real-dart-analyzer.ts:2089-2091`).
   *
   * THE GUARD, and it is the difference between a stated cause and a laundering vector: the claim
   * is attached ONLY where the class the target names is NOT published by the file being analyzed.
   * When this file declares the class, the run DID reach it, and "beyond this run's reach" would be
   * FALSE — so `IOLoop.start` inside `package IOLoop` keeps its reason code and states nothing.
   * The arbiter cannot check this half (property 4 of the channel — a second implementation — is
   * explicitly not claimed to exist), so the analyzer must not state it.
   *
   * It can never move a resolution number. `classifyEdge` reads a cause ONLY inside its
   * `decls === 0` branch, so a claimed edge is already unresolved; and it is REFUTED outright if
   * the edge also carries an external claim — the lane publishes none, which is why the conflict
   * branch cannot fire here.
   */
  private publishStatedCauses(
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    qualifiedClassNames: ReadonlySet<string>,
  ): void {
    // THE CLASSES THIS FILE ITSELF PUBLISHES, BY LEAF. A perl package symbol's `name` is its full
    // package name (`Mojo::Base`), so the leaf is what a `leaf.member` target can name.
    const declaredHere = new Set<string>()
    for (const symbol of symbols) {
      const kind = symbol.kind
      if (kind !== ASTEngine.SymbolKind.Class && kind !== ASTEngine.SymbolKind.Trait) continue
      const name = String(symbol.name ?? "")
      if (name) declaredHere.add(this.leafName(name))
    }
    // AND THE CLASSES THIS RUN BOUND TO AN EDGE, BY LEAF — the second guard, and the one the
    // lane's own whole-population measurement added on 2026-10-20.
    //
    // THE CLAIM IS "THE BASE IS BEYOND THIS RUN'S REACH", and it is only true where the run could
    // not NAME the class at all. Where the run held a QUALIFIED name for the class and published
    // only its LEAF, the run did not fail to reach the base — it REACHED the base and truncated
    // the spelling, and the claim is then true of the spelling it invented and false of the class
    // the edge means. MEASURED over the whole population: 178 of the 182 named causes and 2222 of
    // the 2251 cause edges are refuted exactly that way (the class is declared by the PROJECT, and
    // the SOURCE wrote it qualified within fifteen lines of the edge).
    //
    // So the cause is stated only where neither guard fires: the file does not declare the class
    // AND the run did not bind a qualified name for it. The rows that lose the claim are not
    // silenced — they keep their `reasonCode` and read `unresolved`, which is the honest class.
    //
    // A CLAIM'S SCOPE MUST MATCH ITS EVIDENCE'S SCOPE (the fleet's own ruling), and this is the
    // lane paying it: the claim is removed where the corpus can refute it, rather than left in
    // place where a reader would believe it.
    const heldQualified = new Set<string>()
    for (const qualified of qualifiedClassNames) heldQualified.add(this.leafName(qualified))
    for (const relationship of relationships) {
      const type = relationship.type
      // THE THREE LABELS WHOSE TARGET IS `leaf.member`. `extends` targets a bare leaf and
      // `references`/`uses` target a leaf or a `::` path — none of them can carry this claim, and
      // none is given one.
      if (type !== ASTEngine.RelationshipType.Calls && type !== ASTEngine.RelationshipType.Overrides && type !== ASTEngine.RelationshipType.Instantiates) continue
      const metadata = relationship.metadata as Record<string, unknown> | undefined
      if (!metadata || metadata.baseBeyondRunScope !== undefined) continue
      const owner = this.statedOwnerOf(String(relationship.target ?? ""))
      if (owner === null || declaredHere.has(owner)) continue
      // THE SECOND GUARD: the run HELD a qualified name for this class, so the claim is not true.
      if (heldQualified.has(owner)) continue
      metadata.baseBeyondRunScope = owner
    }
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
