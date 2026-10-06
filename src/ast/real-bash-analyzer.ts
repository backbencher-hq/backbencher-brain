import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

/**
 * Bash analyzer.
 *
 * Contract notes that are not obvious from the code, each one a ruling recorded
 * in `script/m14/spec/bash-completeness.json`:
 *
 *  - BD1  Every relationship carries `line_number` (1-based, on the node that
 *    BEARS THE NAME) and the line is part of the edge's identity, so two call
 *    sites of one callee are two rows. The store's `relId` already keys on the
 *    line (M59/#822) and the `contains` resolver already resolves a containment
 *    edge by the line it carries (#612 follow-up), so a line-less edge from
 *    this lane could never be either per-site or correctly attributed.
 *  - BD2  The file is the unit of bash, so the file is a real owner: every
 *    script emits a `module` symbol named after its own basename, and
 *    top-level declarations and top-level edges are owned by it. The previous
 *    `relSource() || "global"` wrote the literal string `global` onto 621 edges
 *    on the pinned corpus, and `isIndexArtifactName` (src/ast/
 *    analysis-exclusions.ts) rejects `global` as a symbol name — so not one of
 *    those edges could ever resolve to a stored symbol. bb_graph and bb_impact
 *    on a top-level bash edge answered from an unresolvable id.
 *  - BD3  A signal is not code. `trap 'cleanup' EXIT` used to emit
 *    `calls: EXIT -> cleanup`, with a signal as the edge SOURCE. The handler is
 *    a command string; the edge belongs to the scope that installs the trap.
 *  - BD4  A command whose name is an unexpanded expression is not a call to a
 *    name. `${dotnetPath} --info` used to emit `calls: -> "${dotnetPath}
 *    --info"` — a target no symbol can ever have. The variable that decides the
 *    command is real and gets a `uses` edge; the call does not exist.
 *  - BD5  Nothing is emitted out of a damaged region. A `command` whose name
 *    comes from inside an ERROR/MISSING node is recovery noise, not a call:
 *    `${value/]/%5D}` in the pinned corpus emitted `calls: -> ]/%5D}`.
 *  - BD6  `unset` is ruled, not emitted: no relationship type in the ontology
 *    expresses unbinding a binding, so a `uses` edge would assert a read that
 *    does not happen and an `imports` edge would assert a dependency.
 */

// Shell builtins and reserved words that do not represent project-level command
// calls. `echo`, `cd`, `printf`, … are execution primitives, not symbols;
// emitting a Calls edge for them would drown the relationship graph in noise.
// External binaries (`docker`, `git`, `jq`, …) and project-defined functions are
// still emitted as Calls.
const SHELL_BUILTINS = new Set([
  "echo", "printf", "cd", "pwd", "exit", "return", "break", "continue",
  "shift", "source", ".", "export", "local", "declare", "typeset", "readonly",
  "set", "unset", "alias", "unalias", "trap", "eval", "exec", "true", "false",
  "test", "[", "command", "builtin", "type", "let", "pushd", "popd", "dirs",
  "wait", "jobs", "fg", "bg", "kill", "read", "readarray", "mapfile",
  "getopts", "ulimit", "umask", "times", "enable", "help", "hash", "bind",
  "compgen", "complete", "compopt", "logout", "suspend", "caller", "disown",
  "shopt", "history", "fc", "getopts", "coproc",
  // `:` is the POSIX no-op utility — a builtin, and also the shape an
  // ERROR-recovered `command` can carry when the grammar lost the real command
  // word (see isRecoveredCommandWord), so naming it here keeps a recovery
  // artifact off the call graph as well.
  ":",
  // `sudo` is DELIBERATELY absent. It is an external binary that happens to be
  // installed everywhere, not a shell builtin, and the pre-wave list filed it
  // under builtins — which withheld the edge for `sudo docker build …` and left
  // the privilege-escalation pattern as the only trace of the call. The pattern
  // is still raised (see the classification block); the edge is emitted too.
])

const DECLARATION_KEYWORDS = new Set(["export", "local", "declare", "typeset", "readonly"])

/**
 * POSIX/bash RESERVED WORDS. None of them is ever a command word: the shell
 * consumes them itself, so no script can invoke one. They are listed here
 * separately from SHELL_BUILTINS because the consequence is different — a builtin
 * IS a real command (it is simply not a project symbol, so the edge would be
 * noise), whereas a reserved word is not a command at all, so an edge to one is a
 * fabrication.
 *
 * M60 measurement, 200 hash-ordered corpus files, 2,945 `calls` edges: 30 (1.02%)
 * carried a reserved word as their target, and every one of the 30 is
 * `fi`/`esac`/`then`/`elif`/`else`/`do`/`case`/`if` read as a command name by
 * grammar recovery — e.g. `kubernetes/cluster/gce/config-test.sh:468`, a real
 * bash file, where `if [[ -n "${LOGROTATE_FILES_MAX_COUNT:-}" ]]; then` emitted
 * `calls -> if` AND `calls -> then`, and `ohmyzsh/lib/clipboard.zsh:66` emitted
 * `calls -> elif` and `calls -> then` from one line. Zero of the 30 is a command
 * any script could run: `./fi` is a command but its name is `./fi`, not `fi`.
 *
 * See guard-ab-bash-calls.ts for the A/B this decision rests on, including the
 * damage-region guard that was measured and REJECTED because it deletes real calls.
 */
const SHELL_RESERVED_WORDS = new Set([
  "if", "then", "else", "elif", "fi", "case", "esac", "for", "select", "while",
  "until", "do", "done", "in", "function", "time", "{", "}", "!", "[[", "]]",
  "((", "))", "coproc",
])



// $@, $*, $?, $$, $#, $!, $_ — positional/special parameter punctuation. They
// are tracked as function parameters but are shell bookkeeping, not project
// variables, so they never become Uses edges.
const SPECIAL_VAR_PUNCTUATION = new Set(["@", "*", "?", "$", "#", "!", "_"])

// Bash variables the shell itself defines. Referencing one is a fact about the
// runtime, not a project declaration, so it is recorded as a read of a known
// shell name rather than left to look like an undeclared project variable.
const SHELL_DEFINED_VARS = new Set([
  "BASH", "BASHOPTS", "BASHPID", "BASH_ALIASES", "BASH_ARGC", "BASH_ARGV",
  "BASH_ARGV0", "BASH_CMDS", "BASH_COMMAND", "BASH_EXECUTION_STRING",
  "BASH_LINENO", "BASH_LOADABLES_PATH", "BASH_REMATCH", "BASH_SOURCE",
  "BASH_SUBSHELL", "BASH_VERSINFO", "BASH_VERSION", "COMP_CWORD",
  "COMP_LINE", "COMP_POINT", "COMP_TYPE", "COMP_WORDBREAKS", "COMP_WORDS",
  "COMP_KEY", "COMP_WORDBREAKS", "DIRSTACK", "EPOCHREALTIME", "EPOCHSECONDS",
  "EUID", "FUNCNAME", "GROUPS", "HISTCMD", "HOSTNAME", "HOSTTYPE", "LINENO",
  "LINES", "MACHTYPE", "MAIL", "MAILCHECK", "OLDPWD", "OPTARG", "OPTERR",
  "OPTIND", "OSTYPE", "PIPESTATUS", "PPID", "PROMPT_COMMAND", "PS0", "PS1",
  "PS2", "PS3", "PS4", "PWD", "RANDOM", "SECONDS", "SHELL", "SHELLOPTS",
  "SRANDOM", "UID", "OTEST",
])

/**
 * Bash BINDS a name without ever writing `NAME=…`.
 *
 * The declaration collectors before this read exactly two node types:
 * `variable_assignment` (a plain assignment) and `declaration_command`
 * (`local`/`declare`/`export`/`readonly`/`typeset`). POSIX defines four more
 * binding constructs that carry neither, so every one of them produced a `uses`
 * edge naming a target the analyzer itself had never published — an edge the
 * graph could not walk, on a name the language had genuinely bound.
 *
 *   `for NAME in words`      POSIX 6.7.3 — NAME is assigned each word. The pinned
 *                            grammar carries it as a bare `variable_name` child of
 *                            `for_statement`, verified in
 *                            `validation/m14/fixtures/bash/probe-bash-binding-shapes.mts`.
 *   `read NAME…`             POSIX 6.2.5 — stdin is assigned to NAME. The grammar
 *                            gives the targets as plain `word`s, indistinguishable
 *                            by TYPE from a flag, so the option table below is the
 *                            only thing separating them.
 *   `mapfile`/`readarray`    bash 4.0 — fills the ARRAY NAME.
 *   `printf -v NAME`         bash 4.1 — assigns the formatted output to NAME.
 *
 * Measured on the corpus, 400 files in hash order, 96 DISTINCT files:
 * **234 binding sites** — `for` 173 in 81 files, `read` 59 in 30, `mapfile` 1,
 * `printf -v` 1 — and **357 `uses` edges** whose target one of them declared.
 * Those 357 went from unresolvable to resolvable and the `uses` TOTAL did not
 * move (7,802 before and after): the edges already existed, naming a target the
 * analyzer had never published. The per-construct file counts overlap and do not
 * sum to 96. Probe: `validation/m14/fixtures/bash/probe-bash-binding-sites.mts`.
 */
const READ_TARGET_COMMANDS = new Set(["read", "mapfile", "readarray"])

/**
 * `read`/`mapfile` option letters that CONSUME THE NEXT SIBLING NODE, whatever its
 * type. `-d` takes a delimiter, `-p` a prompt, `-n`/`-N` a count, `-t` a timeout,
 * `-u` a descriptor, `-i` text, `-e`/`-s` nothing. Consuming the next SIBLING and
 * not the next `word` is what makes `read -p "Name: " reply` declare `reply`: the
 * prompt is a `string` node, and a token-level scanner that only looked at `word`s
 * had already dropped it.
 */
const READ_VALUE_OPT_LETTERS = new Set(["d", "e", "i", "n", "N", "p", "s", "t", "u", "O"])

/** Every option letter `read`/`mapfile` accepts. A letter outside this set is not
 * an option at all, so it cannot make the next sibling a VALUE rather than a
 * target. `a` is here because it is `-a aname` — a flag whose value is the array
 * name — which is why `read -ra args` binds `args` and not a variable named `a`. */
const READ_OPTION_LETTERS = new Set(["r", "a", "d", "e", "i", "n", "N", "p", "s", "t", "u", "O", "C", "c"])

/**
 * Is this text a command NAME rather than an unexpanded expression?
 *
 * Only used where the text has already been detached from the tree (a `trap`
 * handler's command list, which the grammar hands over as one string). The
 * AST-side test for the same question is `containsExpansion`, which is
 * structural and therefore cannot be fooled by a character the test forgot.
 *
 * Characters refused: `$` and backtick (an unexpanded value), whitespace, the
 * shell metacharacters that mean the string is a compound command rather than a
 * name, and both quote characters. Characters ALLOWED include everything a real
 * command name is made of — `-`, `.`, `/`, `+`, `:`, `,`, `@`, `%` — because
 * `apt-get`, `python3`, `xcode-select`, `sha256sum`, `docker-compose` and
 * `/usr/bin/env` are all commands, and a test that refuses them silently drops
 * the majority of a real script's calls. That regression was measured, not
 * predicted: the first cut of this guard used an identifier character class and
 * a `case` fixture carrying `apt-get install -y curl` emitted ZERO
 * relationships.
 */
/**
 * Is `text` a shell identifier — `[A-Za-z_][A-Za-z0-9_]*`?
 *
 * Written as a char loop rather than a regex for two reasons, both the lane's
 * own: the M12 contract probe asserts the analyzer source contains NO regex
 * literals, and a char loop is the style `isCommandNameText` already uses. It is
 * also the cheaper of the two on the hot path, where this runs once per declared
 * name and the strings are short.
 */
const isShellIdentifierName = (text: string): boolean => {
  if (text.length === 0) return false
  const first = text.charCodeAt(0)
  const firstOk = (first >= 97 && first <= 122) || (first >= 65 && first <= 90) || first === 95 /* _ */
  if (!firstOk) return false
  for (let i = 1; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if ((c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 95) continue
    return false
  }
  return true
}

/** Does `text` open with `((`? bash reads that as arithmetic, never as a nested
 *  subshell. A char test rather than a regex for the same reason
 *  `isShellIdentifierName` is one: the M12 regex census asserts this file
 *  contains NO regex literals, and a literal here is a gate row
 *  (`MISSING real-bash-analyzer.ts`) as well as a contract the doc states. */
const opensWithDoubleParen = (text: string): boolean =>
  text.length >= 2 && text.charCodeAt(0) === 40 /* ( */ && text.charCodeAt(1) === 40

/** Does `text` open with `$((` — the arithmetic EXPANSION, as opposed to `$(` plus
 *  a subshell? The pinned grammar confuses the two in the two shapes
 *  `isArithmeticOperandCommand` exists to refuse, so the distinction has to be
 *  read off the node's own text. */
const opensWithArithmeticExpansion = (text: string): boolean =>
  text.length >= 3 && text.charCodeAt(0) === 36 /* $ */ && opensWithDoubleParen(text.slice(1))

/** Does `text` end with `))`, ignoring surrounding whitespace? */
const endsWithDoubleParen = (text: string): boolean => {
  const t = text.trim()
  return t.length >= 2 && t.charCodeAt(t.length - 2) === 41 /* ) */ && t.charCodeAt(t.length - 1) === 41
}

/**
 * Is this `compound_statement` an ARITHMETIC one — `(( … ))` — rather than a block?
 *
 * bash reads `((expr))` as an arithmetic command and `{ … }`, `if …; then … fi`'s
 * body and `do … done`'s body all reach the analyzer as the same node type, so the
 * distinction has to be read off the node's own text. `( (date) )` has a space
 * between the parens and stays a subshell, which is why the CLOSING pair is part of
 * the test.
 *
 * This is one rule in two places — here, and in `isArithmeticOperandCommand`, which
 * asks the same question of a `subshell` the grammar misparsed — so it is a single
 * function rather than the same expression written twice.
 */
const isArithmeticCompoundText = (text: string): boolean =>
  opensWithDoubleParen(text) && endsWithDoubleParen(text)

const isCommandNameText = (text: string): boolean => {
  if (text.length === 0) return false
  // A reserved word is never a command name. This is a POSIX fact rather than a
  // heuristic, and it is the single gate for BOTH command paths (the
  // `command_name` walk and the trap-handler splitter), so one check covers both.
  // Measured cost of NOT having it: 30 fabricated `calls` edges in 2,945 on a
  // 200-file hash-ordered sample. See SHELL_RESERVED_WORDS.
  if (SHELL_RESERVED_WORDS.has(text)) return false
  // A bare NUMBER is never a command name — it is an arithmetic token or an
  // argument fragment. This predicate is the single gate for BOTH command paths
  // (the `command_name` walk and the trap-handler splitter), and it was admitting
  // digits, so a trap handler whose text ran `... ; 129 ...` emitted
  // `calls: -> 129`, `-> 130`, `-> 141`, `-> 143`: 12 rows on the 385 extensionless
  // files the shebang rule had just opened, none of which any symbol can be.
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c >= 48 && c <= 57 /* 0-9 */) {
      let allDigits = true
      for (let j = 0; j < text.length; j++) {
        const d = text.charCodeAt(j)
        if (d < 48 || d > 57) { allDigits = false; break }
      }
      if (allDigits) return false
      break
    }
  }
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c === 36 /* $ */ || c === 96 /* ` */ || c === 34 /* " */ || c === 39 /* ' */) return false
    if (c === 32 || c === 9 || c === 10 || c === 13) return false
    if (c === 59 /* ; */ || c === 124 /* | */ || c === 38 /* & */) return false
    if (c === 40 /* ( */ || c === 41 /* ) */ || c === 60 /* < */ || c === 62 /* > */) return false
  }
  return true
}

export class RealBashAnalyzer implements ASTEngine.LanguageAnalyzer {
  analyze(rootNode: Node, content: string, filePath: string): ASTEngine.ParseResult {
    // ---------------------------------------------------------------- state
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const patterns = new Set<string>()

    // BD2: the script is the module. Its name is the file's own basename WITH
    // the extension, which is deterministic (no machine path, so the index
    // fingerprint is stable), cannot collide with a shell identifier (no shell
    // name contains a `.`), and is not rejected by isIndexArtifactName.
    const scriptName = this.scriptNameOf(filePath)
    const scriptRange = this.nodeToRange(rootNode)
    symbols.push({
      name: scriptName,
      kind: ASTEngine.SymbolKind.Module,
      range: scriptRange,
      visibility: "public",
      metadata: { bashSpecific: true, isScript: true, scriptPath: filePath },
    })

    // Scope tracking: only real scopes (the script, or a function) ever enter
    // the stack. There is no synthetic `global` / `script` / `subshell_N` scope.
    const declaredSymbols = new Set<string>()
    // WHERE each name was declared, for the ambiguity question.
    //
    // `declaredSymbols` answers "does this file declare NAME"; it cannot answer
    // "WHICH of the 43 declarations does this edge mean". A name declared once per
    // function is a name with N declarations in one file, and a `uses` edge names
    // the NAME — so `bb_impact`, which matches reverse edges by target, picks one
    // of them by a rule nobody chose. Measured on the 400-file hash-order sample
    // (probe-bash-ambiguity.mts): 1,879 edges across five types name a target that
    // more than one published symbol answers to, 19.0% of all resolved `uses`
    // targets among them.
    //
    // Three of those five types are already disambiguated and are NOT touched by
    // this map: `contains`, `exports` and `overrides` all put the DECLARATION's
    // line on the edge (`contains` via `nameLineOf`, `exports` via the symbol
    // range, `overrides` via the `overridesLine` metadata key). `uses` and
    // `calls` put the USE SITE's line on the edge, which is a different line from
    // the declaration, so the declaration is genuinely unrecoverable from the row.
    // This map is what recovers it.
    const declSites = new Map<string, { owner: string; line: number; kind: string }[]>()
    // Every function name in the file, collected BEFORE the main walk.
    //
    // The pre-order walk reaches a `command` before the `function_definition`
    // that declares it whenever the script calls a function defined further
    // down — the normal shape of a shell script. Deciding `isFunctionCall` from
    // what the walk has seen so far made the flag depend on declaration order,
    // so the same call could be reported as a local call or an external binary
    // depending on where the definition sat. One linear pre-pass over the
    // function_definition nodes makes the answer order-independent, and costs
    // O(declarations) once rather than O(symbols) per command.
    const localFunctions = this.collectFunctionNames(rootNode)
    // The same set answers "is this owner a scope?", which is what a
    // declaration's visibility asks. O(1), and the alias branch below keeps it
    // current as aliases are discovered.
    const scopeOwners: Set<string> = localFunctions
    const functionStack: string[] = []
    // The PRIOR declaration line per function name, for the BD8b `overrides` edge.
    //
    // This recorded the FIRST declaration and the map's name said so, which was
    // true and wrong at once for a name declared more than twice. `overridesLine` is
    // read by the edge as "the declaration this one replaces", and the declaration a
    // redefinition replaces is the one IN EFFECT — the latest before it, not the
    // first. Measured on the 600-file sample: 21 of 30 ambiguous `overrides` edges
    // published a line that is a real declaration of the name and is NOT the
    // declaration the edge overrides, every one of them a chain:
    //
    //   dart-sdk ... clipcopy declared at 55,58,61,64,67,70,73,76,79,82,85,97
    //   edge@61  overridesLine=55   the definition in effect is 58
    //   edge@67  overridesLine=55   the definition in effect is 64
    //
    // So a consumer that trusts the key draws an `overrides` edge from 61 to 55
    // while 58 is the row that definition 61 actually displaces — an edge to a real
    // declaration, asserted as the wrong one. `probe-bash-contains-overrides-ceiling.mts`
    // measures it: `overridesLine` picks a declaration 30/30 and names the
    // immediately-prior one 9/30.
    //
    // The map is renamed with the behaviour rather than left to read as a first-line
    // index, and `functionDeclLines` below no longer needs the comment that explained
    // why this one recorded only the first.
    const functionPriorDeclaration = new Map<string, number>()
    const functionParams = new Map<string, Set<string>>()
    const relKeys = new Set<string>()
    // BD1: the line is part of an edge's identity. Keyed with the line so two
    // sites of one callee are two relationships, and so the store's per-site
    // `relId` has something to key on.
    //
    // M60: `const sourceDir = this.dirnameOf(filePath)` sat here and was read by
    // nothing. It existed to feed `normalizeRelative`, the relative-`source`
    // resolver that BD9 REVERSED — bash resolves a relative `source` against
    // `$PWD` at run time, not against the script's own directory — and the
    // function was left behind when the decision was reversed. Its doc comment
    // still described the reversed behaviour, so the file asserted two
    // contradictory things about the same construct. Both are deleted rather than
    // left as decoration.

    let cyclomaticComplexity = 1
    // Per-scope decision points. The lane published a FILE-level
    // `cyclomaticComplexity` and nothing per symbol, so the payload matrix row
    // for complexity had nothing to pin and a reader asking "how complex is this
    // function" had no answer. Counted in the same pass as the file total, so
    // the two can never disagree about the same decision point.
    const scopeComplexity = new Map<string, number>()
    let hasStrictError = false
    let usesEval = false
    let usesSudo = false
    let hasCurlPipeBash = false
    let hasChmod777 = false
    let hasRmRoot = false

    const enclosingFunction = (): string => functionStack[functionStack.length - 1] ?? ""
    const relSource = (): string => enclosingFunction() || scriptName

    /**
     * How an edge is KNOWN, in the vocabulary the graph engine already uses
     * (structural / import_based / usage_contextual / reference_qualified /
     * inferred). The lane published relationships with no tier at all, so every
     * consumer had to treat a lexical containment and a read the same way.
     *
     *   structural       — the tree states it outright: a declaration's owner, a
     *                      command word, an `export`
     *   import_based     — a `source`/`.` dependency
     *   usage_contextual — a read: a variable named at an expansion or inside
     *                      `$(( ))`
     *
     * Nothing in this lane is `inferred` and nothing is
     * `reference_qualified`: bash has no qualified names to disambiguate, and
     * the analyzer guesses nothing it cannot see — which is the property that
     * makes those two tiers meaningful when they are absent.
     */
    const evidenceClassFor = (type: ASTEngine.RelationshipType): string => {
      if (type === ASTEngine.RelationshipType.Imports || type === ASTEngine.RelationshipType.References) return "import_based"
      if (type === ASTEngine.RelationshipType.Uses) return "usage_contextual"
      return "structural"
    }

    const addRel = (
      source: string,
      target: string,
      type: ASTEngine.RelationshipType,
      confidence: number,
      line: number,
      metadata: Record<string, unknown> = {},
    ) => {
      // BD1: a line is mandatory. An edge with no line cannot be per-site and
      // cannot be attributed by the store, so it is not emitted at all rather
      // than emitted as a fact the product cannot use.
      if (!Number.isInteger(line) || line < 1) return
      const key = `${source}\u0000${type}\u0000${target}\u0000${line}`
      if (relKeys.has(key)) return
      relKeys.add(key)
      relationships.push({
        source,
        target,
        type,
        confidence,
        metadata: { evidenceClass: evidenceClassFor(type), ...metadata },
        line_number: line,
      })
    }

    const stack: { node: Node; exit: boolean }[] = [{ node: rootNode, exit: false }]
    while (stack.length > 0) {
      const { node, exit } = stack.pop()!
      if (!node) continue

      if (exit) {
        if (node.type === "function_definition") functionStack.pop()
        continue
      }

      stack.push({ node, exit: true })

      // Cyclomatic complexity: one count per decision point. `[[ … ]]` reaches
      // the counter as `test_command` and its operand tree as
      // `binary_expression` / `unary_expression`, so a compound condition with
      // three operands is counted three times — the shape a reader expects.
      if (
        node.type === "if_statement" ||
        node.type === "for_statement" ||
        node.type === "while_statement" ||
        node.type === "case_item" ||
        node.type === "elif_clause" ||
        node.type === "test_command" ||
        node.type === "binary_expression" ||
        node.type === "c_style_for_statement"
      ) {
        cyclomaticComplexity++
        // Attributed to the scope the decision point is IN. A
        // `function_definition` node is not itself a decision point, so by the
        // time this runs for a node inside a body the scope stack is correct.
        const scope = enclosingFunction() || scriptName
        scopeComplexity.set(scope, (scopeComplexity.get(scope) ?? 0) + 1)
      }

      if (node.type === "function_definition") {
        const parentFn = enclosingFunction()
        this.extractFunction(node, symbols, parentFn || scriptName)
        const name = this.functionName(node)
        if (name) {
          functionStack.push(name)
          if (!functionParams.has(name)) functionParams.set(name, new Set())
          // BD8b: a RE-DEFINITION replaces the prior one. Bash has no classes and
          // no inheritance, so `overrides` has no superclass to point at — but
          // redefining a function IS an override in the only sense the language
          // has one, and the lane was silently omitting the type on a prose
          // justification that did not hold. The ontology-coverage gate
          // (`script/m14/ontology-coverage-gate.ts`) is what found it: the
          // differential could not, because the oracle omitted `overrides` too,
          // and two implementations that both say nothing agree perfectly.
          // Measured on the corpus before this was added: 57 redefinitions across
          // 38 of 2,747 admitted files, e.g. otp/make/test_target_script.sh
          // declaring `print_msg` four times.
          //
          // The edge runs from the LATER definition to the EARLIER one, so both
          // endpoints are the same name and the lines are what distinguish them —
          // `overridesLine` carries the prior declaration's line explicitly so a
          // consumer does not have to infer it. `contains` already emits both
          // declarations, so the pair is resolvable.
          //
          // `overridesLine` names the declaration IN EFFECT at the moment of the
          // redefinition — the immediately prior one — because that is the
          // declaration this one displaces. In bash the binding a call site uses is
          // whatever is in effect when it runs, so a later definition does not
          // override the first one it happens to be preceded by; it overrides the
          // one the running shell would have called. For a name declared twice the
          // two readings coincide, which is why the error was invisible until a
          // name was declared three or more times: `ohmyzsh/lib/clipboard.zsh`
          // declares `clipcopy` at 55,58,61,64,67,70,73,76,79,82,85,97.
          //
          // Measured on the 600-file sample with the previous first-declaration
          // behaviour: all 30 ambiguous `overrides` edges resolved `overridesLine`
          // to a real declaration of the name, and only 9 of those 30 were the
          // immediately prior one — the other 21 named an earlier declaration, so a
          // consumer reading the key drew `overrides` to a row the definition never
          // displaced. `probe-bash-contains-overrides-ceiling.mts` is the
          // instrument, and `validation/m14/fixtures/bash/overrides-prior-line.sh`
          // is what keeps it fixed — a four-declaration chain, because the two-row
          // `redefinition-overrides.sh` cannot tell this reading from the old one.
          const prior = functionPriorDeclaration.get(name)
          if (prior !== undefined) {
            addRel(
              parentFn || scriptName,
              name,
              ASTEngine.RelationshipType.Overrides,
              1.0,
              node.startPosition.row + 1,
              {
                bashSpecific: true,
                overridesLine: prior,
                redefinition: true,
                evidenceClass: "structural",
              },
            )
          }
          // Set UNCONDITIONALLY, after the edge: the next declaration of this name
          // must find the one in effect, which is this one. Writing it only on the
          // branch that emitted no edge would freeze the map at the first
          // declaration forever, which is the defect this line replaced.
          functionPriorDeclaration.set(name, node.startPosition.row + 1)
        }
        patterns.add("Function Definition")
      } else if (node.type === "command_substitution") {
        patterns.add("Command Substitution")
      } else if (node.type === "subshell") {
        patterns.add("Subshell")
      } else if (node.type === "pipeline") {
        // curl | bash / wget | sh — AST-level pipe detection, no source text.
        const names: string[] = []
        const collect = (n: Node) => {
          for (let i = 0; i < n.namedChildCount; i++) {
            const child = n.namedChild(i)
            if (!child) continue
            if (child.type === "command") {
              const name = this.commandNameOf(child)
              if (name) names.push(name)
            } else if (child.type !== "pipeline") {
              collect(child)
            }
          }
        }
        collect(node)
        const hasDownloader = names.some((n) => n === "curl" || n === "wget")
        const hasShell = names.some((n) => n === "bash" || n === "sh" || n === "zsh" || n === "dash")
        if (hasDownloader && hasShell) {
          hasCurlPipeBash = true
          patterns.add("Insecure Pipe Execution")
        }
      } else if (
        node.type === "simple_expansion" ||
        node.type === "expansion" ||
        // BD-gap closure: a variable read inside an arithmetic context is a
        // read. `$((i + 1))`, `((count++))` and `for ((i=0; i<n; i++))` all
        // name real project variables and the analyzer reached none of them:
        // `expansionVariableName` was only consulted for the two string
        // expansion forms, so every arithmetic operand was invisible. The
        // census then named `arithmetic_expression` as a fourth form to add —
        // a literal the pinned grammar does not have, which the rewritten
        // F8 gate reported as a dead branch on the same day it was written.
        // That is the gate working: a plausible guess, refused by evidence.
        node.type === "arithmetic_expansion" ||
        node.type === "postfix_expression" ||
        node.type === "c_style_for_statement" ||
        // `((i < 5))` — an arithmetic COMMAND, whose operands are real reads. The
        // five node types above cover `$((…))`, `for ((…))` and `((i++))`, and none
        // of them covers the plain form, because the pinned grammar holds a bare
        // `(( … ))` in a `compound_statement` wrapping a `binary_expression` /
        // `unary_expression` / plain `variable_name` — none of which is dispatched.
        // The asymmetry was a grammar-shape accident rather than a fact about bash:
        // `((i++))` produced a `uses` edge only because its operand happened to
        // arrive as a `postfix_expression`, and `((i < 5))` on the same line
        // produced none. Recorded as limitation 7 and measured before it was
        // changed: `probe-bash-arithmetic-operands.mts` derives the delta from the
        // tree BEFORE the edit and predicts +70 `uses` edges on the 400-file
        // hash-order sample — 89 arithmetic compound_statements in 32 files, 126
        // operand name nodes, 115 distinct (target, line) pairs, 45 of them
        // already published through the five dispatched types and 70 not, 54 of
        // those 70 naming a variable the same file declares. The census then
        // measured uses 7,786 -> 7,856 and total relationships 16,984 -> 17,054,
        // which is the 70. NO other type moves: this adds reads, no symbols and no
        // edges of any other type.
        //
        // The first run of that probe predicted 72 and the census said 70, and the
        // probe was wrong: it deduplicated operands per STATEMENT while `addRel`'s
        // key carries no statement identity, so `(( i++ )); (( i-- ))` on one line
        // counted twice. The instrument now dedupes per file.
        //
        // The predicate is the node's own text, because `compound_statement` is also
        // a block: `then <block> fi` and `do <body> done` reach the same node type,
        // and their reads are already dispatched — `simple_expansion`, `expansion`,
        // `arithmetic_expansion`, `postfix_expression` and `c_style_for_statement`
        // all sit under them — so a block contributes no edge a block-read would
        // duplicate. The guard keeps the claim true rather than preventing a
        // duplicate, and its own population is measured: 792 compound_statements
        // are excluded by it on the 400-file sample, of which 0 open `((`.
        //
        // That 0 is also why no mutant covers the CLOSING half of the test. A
        // malformed `(( a < 2` does not arrive as a compound_statement at all — the
        // grammar produces an ERROR node for it (verified on the tree) — so
        // `opensWithDoubleParen` alone has an empty reachable population on this
        // corpus and a mutant dropping `endsWithDoubleParen` would survive. The
        // condition is kept because `( (date) )` is a subshell and `((x))` is
        // arithmetic, and it is declared rather than covered by a mutant that
        // cannot fail.
        (node.type === "compound_statement" && isArithmeticCompoundText(node.text))
      ) {
        this.emitVariableUses(node, symbols, relSource, addRel, declaredSymbols, functionStack, functionParams, declSites, scriptName)
      } else if (node.type === "for_statement") {
        // `for NAME in …` binds NAME with no assignment node. See
        // `extractImplicitBinding` for the measurement this closes.
        this.extractImplicitBinding(node, symbols, enclosingFunction() || scriptName, declaredSymbols, scopeOwners, declSites)
      } else if (node.type === "variable_assignment") {
        if (node.parent?.type !== "declaration_command") {
          this.extractAssignment(node, symbols, enclosingFunction() || scriptName, declaredSymbols, scopeOwners, declSites)
        }
      } else if (node.type === "declaration_command") {
        this.extractDeclaration(node, symbols, enclosingFunction() || scriptName, functionParams, declaredSymbols, scopeOwners, addRel, declSites)
      } else if (node.type === "command") {
        this.extractImplicitBinding(node, symbols, enclosingFunction() || scriptName, declaredSymbols, scopeOwners, declSites)
        this.extractCommand(node, symbols, imports, patterns, {
          addRel,
          relSource,
          scriptName,
          localFunctions,
          scopeOwners,
          flags: {
            usesEval: () => usesEval,
            usesSudo: () => usesSudo,
            hasChmod777: () => hasChmod777,
            hasRmRoot: () => hasRmRoot,
            hasStrictError: () => hasStrictError,
          },
          setFlag: {
            eval: (v: boolean) => (usesEval = v),
            sudo: (v: boolean) => (usesSudo = v),
            chmod777: (v: boolean) => (hasChmod777 = v),
            rmRoot: (v: boolean) => (hasRmRoot = v),
            strictError: (v: boolean) => (hasStrictError = v),
          },
        })
      }

      // Traversal: every child, named and anonymous, pushed in reverse so the
      // walk is pre-order. Iterative and O(1) stack depth per node — a 5,000-line
      // script nests no deeper than its block structure, so nothing here is
      // recursive and nothing here is O(n) per node.
      for (let i = node.childCount - 1; i >= 0; i--) {
        const child = node.child(i)
        if (child) stack.push({ node: child, exit: false })
      }
    }

    // ------------------------------------------------------------- post pass
    // Per-symbol cyclomatic complexity: 1 + the decision points in that scope.
    //
    // The key is the scope a symbol OWNS, and for a function or an alias that is
    // its OWN NAME, not its owner: `setup` is keyed by `setup`, while a `local`
    // inside it is keyed by `setup` too — so keying the function by its owner
    // gave the function nothing and handed its count to its own locals. The
    // first run of this produced `count complexity=8` and no complexity at all
    // on `setup`, which is the shape a reader would read as "the variable is
    // complex".
    // Only a scope owner carries complexity. A `local` inside a function is not
    // itself complex, and giving it the enclosing function's number is the same
    // error as giving a variable the class's method count: a reader sees a
    // number on a row where no decision point can occur.
    for (const sym of symbols) {
      if (sym.kind !== ASTEngine.SymbolKind.Module && sym.kind !== ASTEngine.SymbolKind.Function) continue
      const points = scopeComplexity.get(sym.name)
      if (points === undefined) continue
      sym.complexity = 1 + points
    }
    for (let i = 0; i < symbols.length; i++) {
      const sym = symbols[i]
      if (sym.kind === ASTEngine.SymbolKind.Function) {
        const params = functionParams.get(sym.name)
        if (params && params.size > 0) {
          const paramObjects: { name: string; type: string }[] = []
          for (const p of params) paramObjects.push({ name: p, type: "any" })
          sym.parameters = paramObjects
        }
      }
      // BD1: a containment edge's line is the line the CHILD'S NAME is written
      // on, not the line its declaration node starts (M60 #921). The store
      // resolves a `contains` edge by exactly this line (#612 follow-up), so a
      // declaration that wraps onto another line would otherwise resolve to the
      // wrong row.
      if (sym.ownerName) {
        addRel(sym.ownerName, sym.name, ASTEngine.RelationshipType.Contains, 1.0, this.nameLineOf(sym), {
          bashSpecific: true,
        })
      }
    }

    // Every declaration line per FUNCTION name, for the `calls` attribution below.
    //
    // `functionPriorDeclaration` (above) holds only the most recent declaration of a
    // name, because that is the only prior declaration an `overrides` edge can
    // mean, and it keeps none of the earlier ones. A `calls` edge needs the
    // opposite question — WHICH of several declarations is the one in effect at the
    // call site — so it needs all of them.
    //
    // It is indexed from the PUBLISHED `symbols`, not from the walk's own
    // bookkeeping, so a `targetLine` produced from it is a line the store actually
    // publishes. That is the whole reason it is not `declSites`: `declSites` keys
    // variables, aliases and locals, never functions, and mixing the two would let
    // this publish the line of something that is not a function symbol at all.
    const functionDeclLines = new Map<string, { line: number; kind: string }[]>()
    // ...and whether the name is ALSO declared as something that is not a function.
    //
    // Needed because "ambiguous" and "ambiguous" are not the same question. Among
    // function declarations alone a name declared once is not ambiguous and the
    // `calls` edge needs nothing — but the published symbol table may still hold a
    // VARIABLE of the same name, and a consumer matching reverse edges by target
    // has two candidates and no way to choose. So the names that need narrowing by
    // kind are tracked separately from the names that need a line, and the two sets
    // only overlap by accident. Measured on the whole corpus: 236 name-ambiguous
    // `calls` edges, of which the redefinition rule alone could answer 131.
    const namesWithNonFunctionDecl = new Set<string>()
    for (const sym of symbols) {
      const name = sym.name
      if (sym.kind === ASTEngine.SymbolKind.Function) {
        const line = this.nameLineOf(sym)
        const list = functionDeclLines.get(name)
        if (list) {
          if (!list.some((e) => e.line === line)) list.push({ line, kind: String(sym.kind) })
        } else functionDeclLines.set(name, [{ line, kind: String(sym.kind) }])
      } else if (name.length > 0 && !namesWithNonFunctionDecl.has(name)) {
        namesWithNonFunctionDecl.add(name)
      }
    }

    // ------------------------------------------------ attribution, BD11's flag
    // `isAssignedInFile` answers "DOES THIS FILE ASSIGN THIS NAME", and the answer
    // belongs here rather than in the walk because `declaredSymbols` is filled BY the
    // walk. Evaluated during it, the predicate could only see the declarations
    // already passed, so the answer depended on where the read sat:
    //
    //     echo "before: $LATE"    ->  uses -> LATE @1   ABSENT
    //     LATE=1
    //     echo "after: $LATE"     ->  uses -> LATE @3   TRUE
    //
    // One file, one name, one declaration, two answers. Measured on the 400-file
    // sample: 37 (file, target) pairs in 25 files carried BOTH, and a further 15
    // pairs (50 edges) were declared after every read of the name, so no
    // contradiction showed and they were wrong for the same reason
    // (`probe-bash-assigned-flag-order.mts`). 243 of 7,856 reads, 3.1%.
    //
    // `declaredSymbols` keys are `${owner}\u0000${name}`, and the contract is "under
    // ANY owner" — a read inside a function reaches a module-level assignment, which
    // is the case that matters most — so the suffixes are indexed once here. The
    // pass can only ADD the key: a name present in the finished set was present in
    // every prefix of it, so no edge that was correct before is changed after.
    //
    // Emitted on true only, matching `isShellDefined` and the `targetResolution`
    // family — ABSENCE MEANS FALSE, and the contract is stated in the spec rather
    // than left to be inferred from a pattern.
    const assignedNamesInFile = new Set<string>()
    for (const k of declaredSymbols) {
      const i = k.indexOf("\u0000")
      if (i >= 0) assignedNamesInFile.add(k.slice(i + 1))
    }
    for (const rel of relationships) {
      if (rel.type !== ASTEngine.RelationshipType.Uses) continue
      const meta = rel.metadata as Record<string, unknown>
      if (meta.isAssignedInFile !== undefined) continue
      if (assignedNamesInFile.has(String(rel.target ?? ""))) meta.isAssignedInFile = true
    }

    // ------------------------------------------------- attribution, second pass
    // `resolveDeclaration` asks "is this name ambiguous IN THIS FILE?", and at the
    // moment a `uses` edge is emitted that question is asked against a HALF-BUILT
    // index: `declSites` is filled by the same walk that emits the edges (see the
    // `noteDeclaration` call sites), so a use is compared only with the
    // declarations the walk had already passed. The consequence is that whether an
    // edge carries an attribution depends on WHERE THE USE SITS IN THE FILE rather
    // than on what the file declares — a use on the first line of a name declared
    // forty times is judged unambiguous and published bare, while a use near the
    // end of the same name is judged ambiguous and disambiguated.
    //
    // Measured on all 4,130 admitted files: 4,220 `uses` edges in 400 files name a
    // target with two or more declarations in their own file and publish no
    // `targetResolution`, every one of them because of this ordering. The two
    // outcomes are indistinguishable to a consumer, which is the whole problem:
    // "this name is unique here" and "the analyzer had not seen the other
    // declarations yet" are the same published row.
    //
    // So the question is asked a second time here, against the FINISHED index, by
    // the SAME function — one rule, not two, and a fixture that pins the
    // first-pass outcome keeps pinning it. Only edges that published nothing are
    // revisited, so an edge whose target really is unique in the file still gains
    // no keys: the 68,843 genuinely-unique reads on the pinned corpus stay exactly
    // as small as they were.
    for (const rel of relationships) {
      if (rel.type !== ASTEngine.RelationshipType.Uses) continue
      const meta = rel.metadata as Record<string, unknown>
      if (meta.targetResolution !== undefined) continue // already decided in the walk
      const resolved = this.resolveDeclaration(
        declSites,
        String(rel.target ?? ""),
        String(rel.source ?? ""),
        rel.line_number,
        scriptName,
      )
      if (resolved) Object.assign(meta, resolved)
    }

    // ------------------------------- attribution, a read that is also a function
    //
    // The last measured hole, and it is 4 edges on the 400-file sample — the whole
    // of what is left. `declSites` keys VARIABLES, aliases and locals, never
    // functions (see the note above `functionDeclLines`), so a name the file
    // declares as BOTH a function and a variable looks unique to `declSites` while
    // the published symbol table holds two declarations of it. The edge then
    // publishes nothing and a consumer matching by name has two candidates:
    //
    //   consul/build-support/functions/10-util.sh:613   uses -> ui_version   function@597 variable@612
    //   dart-sdk/pkg/vm/tool/shared_functions.sh:58     uses -> host_arch   function@7    variable@56
    //   dart-sdk/pkg/vm/tool/shared_functions.sh:59     uses -> host_arch   (same)
    //   ohmyzsh/plugins/rvm/rvm.plugin.zsh:34           uses -> rubies      function@9    variable@16
    //
    // `$name` is a parameter expansion. It reads a VARIABLE; a function is not
    // readable through `$`, so the function symbol is not a candidate for this edge
    // at all. That is a property of the language, not a preference, which is why
    // the resolution is published under its own value rather than folded into
    // `innermostScope`: a consumer that filters candidates on kind must be able to
    // see that kind is what decided this one.
    for (const rel of relationships) {
      if (rel.type !== ASTEngine.RelationshipType.Uses) continue
      const meta = rel.metadata as Record<string, unknown>
      if (meta.targetResolution !== undefined) continue
      const name = String(rel.target ?? "")
      if (!functionDeclLines.has(name)) continue // no function symbol, so no second candidate
      const resolved = this.resolveReadAgainstFunctionSymbol(
        declSites,
        name,
        String(rel.source ?? ""),
        rel.line_number,
        scriptName,
      )
      if (resolved) Object.assign(meta, resolved)
    }

    // ------------------------------------------- attribution, `calls` second pass
    //
    // The same question for the other type that carries the USE SITE's line rather
    // than the declaration's. `probe-bash-published-resolvability.mts` measured this
    // by applying every field the edge PUBLISHES to the file's real symbol table.
    //
    // Two shapes are here and they are separate defects, which the 400-file sample
    // could not tell apart because it saw one of each:
    //
    //   1. the name is declared as a FUNCTION TWICE (6 edges on the sample,
    //      kubernetes/third_party/gimme/gimme `_version_sort` at 125 and 127 with
    //      calls at 535/565/581). `isFunctionCall` cannot answer it: that flag says
    //      the target IS a local function, not WHICH one, so as a filter it leaves
    //      zero candidates on 6 of 6.
    //
    //   2. the name is declared as a function ONCE and also as something that is
    //      not a function (105 edges, visible only at whole-corpus scale:
    //      swift-nio/scripts/nio-diagnose:398 `calls -> nio_pids` against
    //      variable@136 and function@151; mvdan-sh/syntax/typedjson/testdata/
    //      roundtrip/file.sh `calls -> foo` against function@19 and variable@20).
    //      Among functions the name is not ambiguous, so this rule declines — but a
    //      consumer matching by target still has two candidates.
    //
    // Both are answered by the same function, over the FUNCTION candidate set, plus
    // the knowledge that a name with a non-function declaration needs narrowing by
    // kind even when the function is unique.
    for (const rel of relationships) {
      if (rel.type !== ASTEngine.RelationshipType.Calls) continue
      const meta = rel.metadata as Record<string, unknown>
      if (meta.targetResolution !== undefined) continue
      if (meta.isFunctionCall !== true) {
        // The comment this replaces read "an external binary names nothing local",
        // and it is FALSE for a name this file also declares. Measured on the whole
        // corpus: `ohmyzsh/plugins/pip/pip.plugin.zsh` declares `local xargs=` on 106
        // and again on 114, then RUNS `xargs` at 107 and 115. The two edges at 107/115
        // are correct — `xargs` there is /usr/bin/xargs — and a consumer matching
        // reverse edges by target finds two `variable` candidates and no way to
        // choose, because the edge published nothing. "Names nothing local" and
        // "names something local that is not this edge's target" are different facts
        // and publishing neither is what made this invisible for nine rounds.
        //
        // The answer publishes NO line, because there is no declaration at that line
        // the call denotes: command position resolves to a function or a PATH lookup,
        // never to a variable. So the fact a consumer needs is the KIND of thing the
        // name collides with, not a line among the colliding declarations. Both
        // `xargs` edges get `targetResolution: "commandNameIsExternal"` and
        // `collidesWithLocalDeclaration: true`, which together let a consumer discard
        // the variable candidates instead of picking one.
        //
        // It is NOT published on an edge read out of error recovery. The same pass
        // over the whole corpus also reaches `calls -> key` (Paket/completion/
        // paket-completion.zsh:1486, where the word `local` was swallowed into an
        // ERROR and `key` became the command name) and `calls -> name` twice
        // (kubernetes/cluster/gce/util.sh:3829/:4057, where a gcloud `--filter`
        // string was handed back as a command). Those three name no program the
        // source runs, so telling a consumer they reach an external binary would be
        // a false claim about a false edge — the labels exist to make a real
        // ambiguity visible, not to dress wreckage up as a decision.
        if (meta.commandInErrorRecovery === true) continue
        const name = String(rel.target ?? "")
        if (!namesWithNonFunctionDecl.has(name)) continue // truly external: nothing local to confuse
        meta.targetResolution = "commandNameIsExternal"
        meta.collidesWithLocalDeclaration = true
        continue
      }
      const resolved = this.resolveFunctionTarget(
        functionDeclLines,
        String(rel.target ?? ""),
        rel.line_number,
        namesWithNonFunctionDecl,
      )
      if (resolved) Object.assign(meta, resolved)
    }

    // -------------------------------------------- attribution, `exports` pass
    //
    // The one type that was counted as already-closed and is not. Rounds 5 and 9
    // both stated that `exports` puts the DECLARATION's line on the edge, and both
    // were reading a coincidence: the edge carries the line of the `export`
    // STATEMENT, which is the declaration's line only when the two are the same
    // statement. Measured on the whole corpus, applying the edge's own line to the
    // published symbol table leaves **29 of 96** ambiguous `exports` edges with
    // ZERO candidates — an assertion about a declaration that does not exist at
    // that row, which is worse than publishing nothing:
    //
    //   nvm_supports_xz -[exports]-> PATH @37   against constant@8, constant@21
    //   check_ce2ee -[exports]-> ORG_REPO @625  against variable@116, variable@163, constant@481, constant@606
    //   gate_workbench_scm -[exports]-> DARK_CONFIG_RUNDIR @65  against constant@31, constant@93, constant@144
    //
    // The 400-file sample saw 2 ambiguous `exports` edges and both coincided, which
    // is the reason the claim survived nine rounds: the sample cannot see the
    // failure, and a rule the instrument never contradicts is not a verified rule.
    //
    // The rule is the same outward scope walk `uses` uses, over `declSites` — an
    // exported name is a variable, a constant or a function, and the first two are
    // what `declSites` keys. `export -f fn` targets a function, which `declSites`
    // never holds, so those edges are left to `resolveFunctionTarget` below rather
    // than answered from an index that does not contain them.
    for (const rel of relationships) {
      if (rel.type !== ASTEngine.RelationshipType.Exports) continue
      const meta = rel.metadata as Record<string, unknown>
      if (meta.targetResolution !== undefined) continue
      const name = String(rel.target ?? "")
      if (functionDeclLines.has(name)) continue // a function export: resolveFunctionTarget's question
      const resolved = this.resolveDeclaration(
        declSites,
        name,
        String(rel.source ?? ""),
        rel.line_number,
        scriptName,
      )
      if (resolved) Object.assign(meta, resolved)
    }

    // --------------------------------------------------------------- metrics
    let security = 50
    let maintainability = 50
    if (hasStrictError) {
      security += 20
      maintainability += 10
    }
    if (usesEval) security -= 30
    if (usesSudo) security -= 10
    if (hasCurlPipeBash) security -= 25
    if (hasChmod777) security -= 20
    if (hasRmRoot) security -= 40

    let hasFunction = false
    for (let i = 0; i < symbols.length; i++) {
      if (symbols[i].kind === ASTEngine.SymbolKind.Function) {
        hasFunction = true
        break
      }
    }
    if (hasFunction) maintainability += 20
    if (cyclomaticComplexity > 10) maintainability -= 15

    const score = Math.round((security + maintainability) / 2)
    const patternsArray = [...patterns]
    const frameworks = this.detectFrameworks(patternsArray)

    return {
      language: "bash",
      symbols,
      relationships,
      imports,
      exports: symbols
        .filter((s) => s.metadata?.isExported)
        .map((s) => ({
          name: s.name,
          type: s.kind,
          range: s.range,
          isType: false,
        })),
      // Syntax errors are engine-owned (engine.ts merges treeErrors) — this
      // analyzer never duplicates them.
      metadata: {
        complexity: symbols.length + relationships.length,
        linesOfCode: content.split("\n").length,
        cyclomaticComplexity,
        framework: frameworks.length > 1 ? frameworks[1] : "Bash Script",
        patterns: patternsArray,
        detectedFrameworks: frameworks,
        frameworkPatterns: [{ framework: "Bash", patterns: patternsArray }],
        architecturalInsights: this.generateInsights(patternsArray, hasStrictError),
        architecturalScore: score,
        codeQuality: score >= 80 ? "Excellent" : score >= 60 ? "Good" : "Fair",
        hasTypeInference: false,
        // A framework claim must be earned. This used to be an unconditional
        // `true` on every bash file, which asserted framework intelligence for a
        // file that had none; it is now true only when a framework beyond the
        // language itself was actually detected from the file's own commands.
        hasFrameworkIntelligence: frameworks.length > 1,
        securityScore: Math.min(100, Math.max(0, security)),
        maintainabilityScore: Math.min(100, Math.max(0, maintainability)),
        analysisVersion: "5.0-bash-module-owner-per-site-lines",
      },
    }
  }

  // -------------------------------------------------------------- functions

  /** BD2: the file's own basename, extension included. */
  private scriptNameOf(filePath: string): string {
    const normalized = filePath.split("\\").join("/")
    const base = normalized.slice(normalized.lastIndexOf("/") + 1)
    return base.length > 0 ? base : "script.sh"
  }

  /** The 1-based line a symbol's NAME is written on (M60 #921). */
  private nameLineOf(sym: ASTEngine.UniversalSymbol): number {
    const line = sym.range?.startLine
    return typeof line === "number" && line >= 1 ? line : 1
  }

  /** Record WHERE a name was declared. One entry per (owner, name), added at the
   * same place `declaredSymbols` is, so the two indexes cannot disagree. */
  private noteDeclaration(
    declSites: Map<string, { owner: string; line: number; kind: string }[]>,
    name: string,
    owner: string,
    line: number,
    kind: string,
  ): void {
    if (!Number.isInteger(line) || line < 1) return
    const list = declSites.get(name)
    if (list) list.push({ owner, line, kind })
    else declSites.set(name, [{ owner, line, kind }])
  }

  /**
   * Which declaration does an edge naming `name` at `useLine` in `useOwner` mean?
   *
   * The rule is a lexical-scope chain walked OUTWARD, and the order of the two
   * halves is load-bearing:
   *
   *   1. Walk the scope chain from the use's own function out to the file. In the
   *      first scope that has a declaration of `name` AT OR BEFORE the use site,
   *      the nearest such line is the answer — and the walk STOPS there. A use is
   *      not answered by a declaration in a scope it does not belong to.
   *   2. If no scope in the chain has one, the analyzer publishes nothing and
   *      says `targetResolution: "ambiguousInFile"`.
   *
   * Both halves were arrived at by being wrong first, and the fixture
   * `ambiguous-target-resolution.sh` is what caught each:
   *
   *   The first version had no scope chain at all — it took every declaration of
   *   the name in the file and picked the nearest preceding one. So `echo "$X"` at
   *   line 45 inside `read_early`, whose own assignment to X is at line 46,
   *   resolved to line 37 — a declaration inside a DIFFERENT function. That is
   *   wrong twice over: bash does not let one function's assignment to a local
   *   shadow another function's, and the fixture's own comment says the analyzer
   *   must not point at a declaration that does not exist yet at the use site.
   *
   *   The second version had the chain but walked it in the wrong direction for
   *   the "no declaration yet" case, and would fall through to a nearer
   *   declaration in an unrelated scope instead of the file-scope one that really
   *   is the value in effect.
   *
   * `declSites` keys only the first declaration of each (owner, name), because
   * that is exactly what the collectors publish — a second `X=1` in the same
   * function is a reassignment, not a declaration. So "nearest preceding" within
   * a scope always has one candidate, and the ties the corpus measurement found
   * (49 of 1,879 edges) can only arise between scopes.
   *
   * The three outcomes are DISTINCT on purpose, because "the analyzer could not
   * say" and "the analyzer saw several and declined to pick" are different facts:
   *
   *   resolved   one candidate — `targetLine` + `targetKind` + the rule named, so
   *              the fact can be checked rather than trusted.
   *   ambiguous  two or more candidates and the rule cannot separate them — no
   *              line is published, because publishing one of several would be
   *              exactly the invented attribution this exists to prevent.
   *   undefined  fewer than two declarations in the file, so the name is not
   *              ambiguous and the edge needs nothing added to it.
   *
   * The `undefined` case is why this adds metadata to 15.2% of `uses` edges
   * rather than all of them: an edge whose target is unique in its file carries
   * no new information, and 80,851 `uses` edges on the whole corpus would each
   * grow three keys to say so.
   */
  private resolveDeclaration(
    declSites: Map<string, { owner: string; line: number; kind: string }[]>,
    name: string,
    useOwner: string,
    useLine: number,
    fileOwner: string,
  ): Record<string, unknown> | undefined {
    const cands = declSites.get(name)
    if (!cands || cands.length < 2) return undefined // not ambiguous: nothing to add
    // Outward walk. `useOwner` is "" at file scope, and so is `fileOwner` for a
    // script, so the first iteration already covers the file-scope case and a
    // use inside a function gets its own scope before the file's.
    const scopes: string[] = useOwner === fileOwner ? [fileOwner] : [useOwner, fileOwner]
    for (const scope of scopes) {
      const atOrBefore = cands.filter((c) => c.owner === scope && c.line <= useLine)
      if (atOrBefore.length === 0) continue // this scope has nothing yet; look outward
      const nearest = Math.max(...atOrBefore.map((c) => c.line))
      const winners = atOrBefore.filter((c) => c.line === nearest)
      if (winners.length !== 1) return { targetResolution: "ambiguousInFile" }
      return {
        targetLine: winners[0]!.line,
        targetKind: winners[0]!.kind,
        targetResolution: scope === useOwner ? "innermostScope" : "outerScope",
      }
    }
    // The name IS declared several times in this file and none of it is in
    // effect where this edge points. Say so; publish no line.
    return { targetResolution: "ambiguousInFile" }
  }

  /**
   * Publish, on a `uses` edge, that this file binds `name` as a VARIABLE nowhere.
   *
   * ## Why this is not the same as "external"
   *
   * The obvious field name here is `isExternal`, and it would be a false claim on a
   * measured population. Measured on the pinned corpus — 600 `*.sh` files in path order,
   * production `parseFile`, analyzer digest `6d5542aa6d6640e2` — 490 `uses` edges go to a
   * name no file in the window declares, and a whole-corpus pass over all 3,748 tracked
   * bash files found a real declaration for 101 of them:
   *
   *     consul/test/integration/connect/envoy/defaults.sh   DEFAULT_REQUIRED_SERVICES  32 edges
   *     fsharp/eng/common/tools.sh                            HOME                       48 edges
   *     consul/test/integration/connect/envoy/run-tests.sh   CASE_DIR, CLUSTER, XDS_TARGET
   *
   * Those 101 reads are not external. They read a variable that a `source`d file assigns,
   * and a single-file analyzer cannot see it. Calling them external would tell a consumer
   * to stop looking for a declaration that exists.
   *
   * So the published fact is the one that is true and checkable: **no variable, alias or
   * local in THIS FILE binds this name.**
   *
   * ## Why the field says "variable"
   *
   * `declSites` holds variables, aliases and locals and never functions — the same
   * limitation `resolveReadAgainstFunctionSymbol` is built around (a `$name` read cannot
   * denote a function). So for a name declared only as a function, "no declaration in this
   * file" is FALSE while "no VARIABLE binding in this file" is TRUE. The field is named for
   * the index it is derived from so the row cannot be over-read, and the distinction is the
   * one a consumer needs: a read that no variable binds is unresolved for a different
   * reason than one that binds ambiguously, and `targetResolution` already reports the
   * latter.
   *
   * Published on both states, as `resolvedWithinFile` is, so a consumer reads one field
   * rather than inferring the negative from an absent one.
   */
  private declareAbsenceOfVariableBinding(
    declSites: Map<string, { owner: string; line: number; kind: string }[]>,
    name: string,
  ): Record<string, unknown> {
    const cands = declSites.get(name)
    return { variableDeclaredInFile: cands !== undefined && cands.length > 0 }
  }

  /**
   * A `$name` read in a file that also declares `name` as a FUNCTION.
   *
   * `resolveDeclaration` declines here, and correctly so: it is asked "is this name
   * ambiguous in this file?" and `declSites` — variables, aliases and locals, never
   * functions — says no. The ambiguity a consumer actually faces is against the
   * PUBLISHED symbol table, which holds both.
   *
   * The rule is the language's, not a preference: `$name` is a parameter expansion,
   * it reads a variable, and a function is not reachable through `$`. So the
   * function symbol is excluded as a candidate and the SAME outward scope walk
   * `resolveDeclaration` performs runs over what remains. One walk, called twice
   * over two different candidate sets — not a second implementation of the walk,
   * which is how two rules drift apart.
   *
   * Declines, publishing no line, when the walk finds nothing at or before the use
   * site or finds a tie: the same two refusals `resolveDeclaration` makes, for the
   * same reason. In that case the edge carries `ambiguousInFile`, which is the
   * honest row — the name is genuinely claimed by two published declarations and
   * this edge declines to say which.
   */
  private resolveReadAgainstFunctionSymbol(
    declSites: Map<string, { owner: string; line: number; kind: string }[]>,
    name: string,
    useOwner: string,
    useLine: number,
    fileOwner: string,
  ): Record<string, unknown> | undefined {
    const cands = declSites.get(name)
    if (!cands || cands.length === 0) return undefined // no variable either: nothing to add
    const scopes: string[] = useOwner === fileOwner ? [fileOwner] : [useOwner, fileOwner]
    for (const scope of scopes) {
      const atOrBefore = cands.filter((c) => c.owner === scope && c.line <= useLine)
      if (atOrBefore.length === 0) continue
      const nearest = Math.max(...atOrBefore.map((c) => c.line))
      const winners = atOrBefore.filter((c) => c.line === nearest)
      if (winners.length !== 1) return { targetResolution: "ambiguousInFile" }
      return {
        targetLine: winners[0]!.line,
        targetKind: winners[0]!.kind,
        targetResolution: "readCannotBeAFunction",
      }
    }
    return { targetResolution: "ambiguousInFile" }
  }

  /**
   * Which FUNCTION does a `calls` edge at `useLine` naming `name` reach?
   *
   * The sibling of `resolveDeclaration`, over functions rather than variables, and
   * deliberately not a shared code path: `declSites` keys variables, aliases and
   * locals and never functions, so the two indexes have different contents and a
   * shared body would be a claim about one of them dressed as a claim about both.
   *
   * bash has no nested function scope, so the scope chain `resolveDeclaration`
   * walks does not exist here and is not faked. The language rule is one step:
   * a name resolves to the most recent definition executed before the call, which
   * for a script read top to bottom is the latest definition AT OR BEFORE the call
   * site. `overrides` already publishes that a redefinition happened and both
   * lines; this publishes which one a given call reaches.
   *
   * The three outcomes are the same three `resolveDeclaration` publishes, and they
   * are distinct on purpose — "resolved", "there is more than one at the same
   * line" and "every definition is after the call" are different facts, and a
   * consumer cannot tell them apart if they collapse into one row:
   *
   *   latestDefinitionBeforeUse  one candidate — `targetLine` + `targetKind`, so
   *                              the fact can be checked against the symbol table
   *                              instead of trusted.
   *   commandNameIsAFunction     exactly ONE function declaration, and the name is
   *                              also declared as something that is not a function.
   *                              Position is irrelevant here and deliberately so: a
   *                              COMMAND position cannot denote a variable at all,
   *                              so unlike a `uses` edge there is no "declared
   *                              after the use site" case to decline. Measured at
   *                              105 whole-corpus edges (swift-nio/scripts/
   *                              nio-diagnose:398 `nio_pids` against variable@136
   *                              and function@151; mvdan-sh/syntax/typedjson/
   *                              testdata/roundtrip/file.sh `foo` against
   *                              function@19 and variable@20).
   *   commandNameIsExternal      NOT this function. Published by the CALLER, not
   *                              here: `isFunctionCall` is false and the name is
   *                              declared in this file as something that is not a
   *                              function, so a name-matching consumer has
   *                              candidates that are not this edge's target. The
   *                              sibling of `commandNameIsAFunction` and the same
   *                              fact seen from the other side — there the
   *                              function is the answer, here nothing local is.
   *                              2 whole-corpus edges (`xargs` in
   *                              ohmyzsh/plugins/pip/pip.plugin.zsh at 107/115).
   *   ambiguousInFile            two declarations on the same line, which the
   *                              published line cannot separate. No line: picking
   *                              one would be the invented attribution.
   *   declaredAfterUse           every definition of the name is below the call
   *                              site, so none of them is in effect there. bash
   *                              permits the forward reference — the callee may be
   *                              defined before the caller's body runs — so this
   *                              says what was observed and publishes no line
   *                              rather than pretending the text order settles it.
   *
   * The name is only ambiguous at all if there are two or more FUNCTION
   * declarations of it, or one function plus a declaration of another kind. Fewer
   * than that and nothing is added: 55,241 `calls` edges on the whole corpus and
   * only the 236 whose target the published symbol table answers to twice grow a
   * key.
   *
   * `targetKind` is read off the PUBLISHED symbol rather than written as a literal.
   * The first version wrote the literal `"Function"` and the published kind is
   * `"function"` (`SymbolKind.Function`, src/ast/types.ts:11), so every edge it
   * touched carried a `targetKind` that matched nothing: the attribution pointed at
   * a real line and a kind no symbol carries, and a consumer filtering on kind
   * discarded the answer. `probe-bash-published-resolvability.mts` caught it as 6
   * edges where applying the published fields leaves ZERO candidates — which is the
   * worse outcome, because it reads as a dangling claim rather than a wrong kind.
   */
  private resolveFunctionTarget(
    functionDeclLines: Map<string, { line: number; kind: string }[]>,
    name: string,
    useLine: number,
    namesWithNonFunctionDecl: Set<string>,
  ): Record<string, unknown> | undefined {
    const cands = functionDeclLines.get(name)
    const collidesWithOtherKind = namesWithNonFunctionDecl.has(name)
    if (!cands) return undefined // not a function declaration at all: nothing local to name
    if (cands.length < 2) {
      if (!collidesWithOtherKind) return undefined // unique name: nothing to add
      const only = cands[0]!
      return { targetLine: only.line, targetKind: only.kind, targetResolution: "commandNameIsAFunction" }
    }
    const atOrBefore = cands.filter((c) => c.line <= useLine)
    if (atOrBefore.length === 0) return { targetResolution: "declaredAfterUse" }
    const nearest = Math.max(...atOrBefore.map((c) => c.line))
    const winners = atOrBefore.filter((c) => c.line === nearest)
    if (winners.length !== 1) return { targetResolution: "ambiguousInFile" }
    return {
      targetLine: nearest,
      targetKind: winners[0]!.kind,
      targetResolution: "latestDefinitionBeforeUse",
    }
  }

  /** Remove quote characters from a path expression. Index arithmetic over the
   *  two quote code points; a path cannot contain either. */
  private dequotePath(text: string): string {
    let out = ""
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i)
      if (c === 34 || c === 39) continue
      out += text[i]
    }
    return out
  }

  private stripQuotes(text: string): string {
    if (text.length >= 2) {
      const first = text.charCodeAt(0)
      const last = text.charCodeAt(text.length - 1)
      if ((first === 34 || first === 39) && last === first) return text.slice(1, -1)
    }
    return text
  }

  private commandNameNode(node: Node): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === "command_name") return child
    }
    return null
  }

  private commandNameOf(node: Node): string {
    const cn = this.commandNameNode(node)
    if (!cn) return ""
    for (let j = 0; j < cn.namedChildCount; j++) {
      const word = cn.namedChild(j)
      if (word && word.type === "word") return word.text
    }
    return cn.text
  }

  /**
   * BD4 (structural): does this node's subtree contain an unexpanded value?
   * `command_name` holding `$cmd`, `${cmd}` or `$(cmd)` names a command only at
   * run time, so there is no callee to point at. The test is on the TREE, not
   * on the text: a character-class test cannot tell `apt-get` from `$pkg_mgr`
   * without a rule per metacharacter, and the first cut of this guard was
   * exactly that and swallowed every hyphenated command in the corpus.
   */
  private containsExpansion(node: Node): boolean {
    const stack: Node[] = [node]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (
        n.type === "simple_expansion" ||
        n.type === "expansion" ||
        n.type === "command_substitution" ||
        n.type === "arithmetic_expansion" ||
        n.type === "process_substitution"
      ) {
        return true
      }
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c) stack.push(c)
      }
    }
    return false
  }

  /**
   * Is this `command` node an ARITHMETIC OPERAND that the grammar handed back in
   * command position?
   *
   * bash writes an arithmetic expression `$(( ... ))`. The pinned grammar models
   * it correctly in the ordinary position — `z=$((a + 1))` yields
   * `arithmetic_expansion` → `binary_expression` → `variable_name`, and there
   * is no `command` node to misread. It misparses in exactly two shapes, and in
   * both the operand arrives as a `command` whose `command_name` is a VARIABLE,
   * so the analyzer was emitting a call to something bash never runs:
   *
   *   1. as the default operand of a parameter expansion inside a string —
   *      `last_run="${last_run:-$((attempt + 1))}"` parses as
   *      `expansion` → `command_substitution` → `subshell` → `command` →
   *      `command_name: attempt`, i.e. `$(` plus a subshell where `$((` was meant.
   *   2. under `!` — `! ((force_known_update))` parses as `negated_command` →
   *      `subshell` → `subshell` → `command` → `command_name`.
   *
   * The test is the enclosing node's own text, never the source text: a
   * `command_substitution` whose text opens `$((` is an arithmetic expansion,
   * and a `subshell` whose text opens `((` is one too. A real command
   * substitution is untouched by this — `$(wc -l < f)` inside `$(( ))` opens
   * `$(w`, so `calls: -> wc` still fires, which is correct, because `wc` really
   * is run there.
   *
   * Measured on the 400-file census sample: 2 occurrences of shape 1 and 1 of
   * shape 2. Both edges carried `confidence: 1` and
   * `evidenceClass: structural`, i.e. they were presented as parse facts rather
   * than guesses, which is what made them worth removing rather than labelling.
   */
  private isArithmeticOperandCommand(node: Node): boolean {
    let cur: Node | null = node.parent
    while (cur) {
      // A `command_substitution` decides it. `$((` is the arithmetic expansion
      // the grammar misread as `$(` + subshell; a plain `$(` is a real command
      // substitution, and `$(wc -l < f)` nested inside `$(( ))` really does run
      // `wc`, so that edge must survive.
      if (cur.type === "command_substitution") return opensWithArithmeticExpansion(cur.text)
      if (cur.type === "subshell" && isArithmeticCompoundText(cur.text)) return true
      cur = cur.parent
    }
    return false
  }

  /**
   * Is this `command` a `case` arm's PATTERN that the grammar could not close?
   *
   * `if ! case "$t" in binary) … ;; source) … ;; esac; then` is a construct the
   * pinned wasm cannot close, so an arm arrives as
   *
   *   command @936 "binary) _try_existing binary"
   *     command_name → word "binary"     ← the arm's PATTERN, not a command
   *     ERROR → ")"                      ← the arm terminator the grammar kept
   *     word "_try_existing"
   *
   * The structural fact is a POSIX one, not a heuristic: **a `)` can never
   * immediately follow a command NAME in valid bash.** `(cmd)` puts the `)` on
   * the subshell, a sibling of the whole command; `echo )` puts it after an
   * argument or on its own as a `word`. The only way `)` lands directly between
   * the name and the first argument is a terminator the grammar could not place.
   *
   * This is the narrow half that the rejected damage guard (see
   * `guard-ab-bash-calls.ts`, guard E) lacked. Guard E refuses a command with ANY
   * direct `ERROR`/missing child and costs 15 real `kube::log::status` calls in
   * kubernetes/test/e2e_node/gubernator.sh, because `V=2 kube::log::status "…"`
   * puts a `variable_assignment` in the command's own slot and the grammar puts an
   * `ERROR` beside it. Keying on the POSITION — immediately after `command_name` —
   * and on the CHARACTER `)` costs 0 real calls on 400 hash-ordered corpus files
   * while removing 5 fabrications.
   *
   * The wider predicate was measured too and REJECTED, rather than assumed:
   * "the command has a direct `ERROR`/missing child whose text is `)`" fires on
   * `echo one two ) three`, where `)` is an ordinary word argument, so it would
   * delete a real `calls: -> echo`. `guard-f-soundness.mts` asks both predicates
   * about 39 node shapes; the positional one fires on 0 valid-parse commands, the
   * wider one on 1.
   *
   * **Why this is worth an edge the `calls` guards were declined.** The `binary`,
   * `git` and `auto` arms produce `calls` edges naming nothing runnable — the
   * residuals pass 2 named and declined. The `source` arm's pattern is the word
   * `source`, so that arm's `command` reaches the `source`/`.` branch, which emits
   * `imports` AND `references` to its first argument:
   *
   *   gimme -[imports]->    _try_existing
   *   gimme -[references]-> _try_existing
   *
   * `_try_existing` is a shell FUNCTION defined at gimme:414, not a file. That is
   * a fabricated module dependency — the kind `imports` feeds `bb_migrate` and
   * `bb_impact` — and no prior guard was aimed at it. The shared differential
   * cannot see it either: `deriveBashEdges` pushes `imports`+`references` for the
   * same construct, so two walkers over the same tree agree that a function name
   * is a dependency.
   */
  private isCaseArmPatternCommand(node: Node): boolean {
    const name = this.commandNameNode(node)
    if (!name) return false
    const after = name.nextSibling
    if (!after) return false
    if (after.type !== "ERROR" && !after.isMissing) return false
    return after.text.charCodeAt(0) === 41 /* ) */
  }

  /**
   * A command's name is a WORD, and a plain `word` name is trusted outright.
   * The two real-world shapes that put something else in `command_name` are
   * both fabrications: a zsh `case` arm's alternation, and a quoted string or
   * number the grammar could not classify. Measured on ohmyzsh's
   * `tools/changelog.sh` the analyzer emitted `calls: -> ]+` and
   * `calls: -> \e[2m\1\e[0m`; measured on the 385 extensionless files the
   * shebang rule had just opened (nvm, rbenv, ohmyzsh, otp) it emitted
   * `calls: -> 129`, `-> 130`, `-> 141`, `-> 143` and `-> 6` — numeric literals
   * promoted to callees, 18 rows the independent oracle refused.
   */
  private isRecoveredCommandWord(nameNode: Node | null): boolean {
    if (!nameNode) return true
    if (nameNode.isMissing) return true

    const name: Node = nameNode
    const nameIsPlainWord =
      name.namedChildCount === 0 ||
      (name.namedChildCount === 1 && name.namedChild(0)?.type === "word")
    if (!nameIsPlainWord) {
      // Not a word, and therefore not a name — no callee exists to point at.
      return true
    }
    // A word that OPENS with a backslash is an escape, not a name. `\.` is what
    // the grammar leaves behind when it splits a sed argument such as
    // `s/\./-/g`, and a command named `\.` is a name no symbol can ever have.
    if (name.text.charCodeAt(0) === 92 /* \ */) return true
    // A plain word is trusted for its shape.
    //
    // M60, re-measured: the DAMAGE half of BD5 is not implemented, deliberately,
    // and the two helpers that would have implemented it
    // (`enclosingStatementIsDamaged`, `subtreeIsDamaged`) were dead code. They
    // were removed rather than wired up because the A/B is now measured and the
    // damage guard LOSES. `guard-ab-bash-calls.ts`, 200 hash-ordered corpus files,
    // 2,945 `calls` edges: refusing every call in a damaged region removes 96
    // (3.26%), and the removal set contains 15 real calls to
    // `kube::log::status` in kubernetes/test/e2e_node/gubernator.sh plus real
    // `print`/`echoti`/`setopt`/`autoload` invocations in
    // ohmyzsh/lib/termsupport.zsh — a MISSING token anywhere in the file
    // condemns every command under it, which is the `#907` swallow class this
    // decision was originally taken to avoid.
    //
    // What IS implemented is the narrow half, and it is measured the same way: a
    // reserved-word name is never a command, so `isCommandNameText` refuses it,
    // which removes 30 fabrications and 0 real calls.
    return false
  }

  private functionName(node: Node): string {
    // The grammar's own `name` field is the authority. `function_definition`
    // carries `name:` and `body:` in the pinned wasm, so the positional scan
    // that used to find the name is a fallback for a grammar that does not
    // label it — not the primary path. Reading the field is what makes the
    // extraction survive a shape the scan mis-reads, and it is the same
    // field-first rule M60 #924 established for include names.
    const named = node.childForFieldName?.("name")
    if (named && named.text) return named.text
    let prev: Node | null = null
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue
      // `name() { … }` and `function name() { … }` both put the name word
      // immediately before the body. The pinned tree-sitter-bash grammar has
      // no `identifier` node type (F1: unknown literal), so the alternative
      // spelling this branch used to accept could never fire — the dead branch
      // is deleted rather than kept as decoration.
      if (child.type === "compound_statement" && prev && prev.type === "word") {
        return prev.text
      }
      prev = child
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === "word" && child.text !== "function") return child.text
    }
    return ""
  }

  /**
   * Every function name the file declares, in one linear pass over the
   * function_definition nodes. Order-independent by construction: a call to a
   * function defined later in the file resolves the same as one defined above
   * it, which is the property the pre-order walk cannot provide on its own.
   */
  private collectFunctionNames(root: Node): Set<string> {
    const names = new Set<string>()
    const stack: Node[] = [root]
    while (stack.length > 0) {
      const node = stack.pop()!
      if (node.type === "function_definition") {
        const name = this.functionName(node)
        if (name) names.add(name)
      }
      for (let i = node.childCount - 1; i >= 0; i--) {
        const child = node.child(i)
        if (child) stack.push(child)
      }
    }
    return names
  }

  private extractFunction(node: Node, symbols: ASTEngine.UniversalSymbol[], owner: string) {
    const name = this.functionName(node)
    if (!name) return
    symbols.push({
      name,
      kind: ASTEngine.SymbolKind.Function,
      range: this.nodeToRange(node),
      scope: owner,
      visibility: "public",
      ownerName: owner,
      parameters: [],
      metadata: { bashSpecific: true, isScriptFunction: true },
    })
  }

  /**
   * Every variable READ the analyzer can see, at any expansion or arithmetic
   * site. Positional parameters and shell bookkeeping never become Uses edges.
   */
  private emitVariableUses(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    relSource: () => string,
    addRel: (
      source: string,
      target: string,
      type: ASTEngine.RelationshipType,
      confidence: number,
      line: number,
      metadata?: Record<string, unknown>,
    ) => void,
    declaredSymbols: Set<string>,
    functionStack: string[],
    functionParams: Map<string, Set<string>>,
    declSites: Map<string, { owner: string; line: number; kind: string }[]>,
    fileOwner: string,
  ) {
    const names: { rawName: string; line: number }[] = []
    this.collectReadNames(node, names)

    // BD11's `isAssignedInFile` is NOT decided here. It used to be, and this is
    // the second time this walk answered a file-level question against a
    // half-built index (the first was `resolveDeclaration`, fixed in round 6 by a
    // post-walk pass). `declaredSymbols` is filled by this same walk, so a
    // predicate evaluated mid-walk can only see the declarations already passed,
    // and the answer then depends on WHERE THE READ SITS rather than on what the
    // file declares:
    //
    //     echo "before: $LATE"      ->  uses -> LATE @1   isAssignedInFile ABSENT
    //     LATE=1
    //     echo "after: $LATE"       ->  uses -> LATE @3   isAssignedInFile TRUE
    //
    // One file, one name, one declaration, two answers, and BD11's published
    // contract says file-level ("set when the file assigns the name under any
    // owner"). `probe-bash-assigned-flag-order.mts` measures the population: 37
    // (file, target) pairs in 25 of 400 files carry BOTH answers. The pass is
    // below, after the walk, against the finished index.
    for (const { rawName, line } of names) {
      // Read names are trimmed at the single point they are emitted. A zsh
      // `$ _iterm2_command` left the differential reporting
      // `uses: -> " _iterm2_command"` — a target with a LEADING SPACE that
      // cannot match any declaration, so the edge could never be resolved. The
      // walk that collects names has several sources and only this loop is
      // common to all of them.
      const name = rawName.trim()
      if (name.length === 0) continue
      if (isAllDigits(name)) {
        // Positional parameter reference ($1..$9) — feeds the enclosing
        // function's parameter list, never a Uses edge. $0 is the script name.
        if (name === "0") continue
        const fn = functionStack[functionStack.length - 1]
        if (fn) functionParams.get(fn)?.add(name)
        continue
      }
      if (SPECIAL_VAR_PUNCTUATION.has(name)) continue
      addRel(
        relSource(),
        name,
        ASTEngine.RelationshipType.Uses,
        0.8,
        line,
        {
          isVariableReference: true,
          bashSpecific: true,
          // A read of a name the shell itself defines is recorded as such, so
          // a consumer can tell `${BASH_SOURCE[0]}` from a project variable
          // instead of seeing 23 undiagnosable edges to one shell name.
          ...(SHELL_DEFINED_VARS.has(name) ? { isShellDefined: true } : {}),
          // Why a `uses` edge does not name a line, when the reason is that this file
          // binds the name as a variable nowhere. `resolveDeclaration` publishes nothing
          // in that case and the edge looks identical to one that resolved, so the
          // population is unreadable from the row alone.
          ...this.declareAbsenceOfVariableBinding(declSites, name),
          // WHICH declaration, when this file has more than one. A `uses` edge
          // puts the READ's line on the row, which is a different line from the
          // declaration, so without this the declaration is unrecoverable from
          // the edge and any consumer matching on target alone is choosing
          // between N declarations by a rule it did not write. Emitted ONLY when
          // the name is ambiguous in this file — see `resolveDeclaration` for the
          // three outcomes and why "declined to pick" is published separately
          // from "picked one".
          ...(this.resolveDeclaration(
            declSites,
            name,
            functionStack[functionStack.length - 1] ?? "",
            line,
            fileOwner,
          ) ?? {}),
        },
      )
    }
    void symbols
  }

  /** Variable names read anywhere under `node`, each with the line it is on. */
  private collectReadNames(node: Node, out: { rawName: string; line: number }[]): void {
    const visit = (n: Node) => {
      if (n.type === "variable_name" || n.type === "special_variable_name") {
        const text = n.text
        if (text.length > 0) out.push({ rawName: text, line: n.startPosition.row + 1 })
        return
      }
      // `${arr[i]}` — the READ is the base name; the index is a separate
      // subscript_expression whose own base is picked up by the same walk.
      if (n.type === "subscript") {
        for (let j = 0; j < n.namedChildCount; j++) {
          const c = n.namedChild(j)
          if (c) visit(c)
        }
        return
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) visit(c)
      }
    }
    visit(node)
  }

private extractAssignment(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    owner: string,
    declaredSymbols: Set<string>,
    scopeOwners: Set<string>,
    declSites: Map<string, { owner: string; line: number; kind: string }[]>,
  ) {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      // `name[index]=value` BINDS `name` — if the array does not exist the
      // assignment creates it, so this is a declaration in exactly the class the
      // analyzer already recognises for `NAME=value`, a `for` loop variable and a
      // `read` target. The grammar holds that LHS one level deeper than the bare
      // case, as `subscript > variable_name`, and this loop only ever looked at a
      // DIRECT `variable_name` child. So the declaration published nothing, the
      // file's other reads of the name had nothing to resolve against, and BD11
      // classified every one of them as environment-supplied.
      //
      // The base name is read from the tree, never reconstructed from `node.text`,
      // and the shape is ENUMERATED by `probe-bash-array-element-binding.mts`, so
      // "the fix covers `subscript`" is a checked claim rather than a shape I
      // assumed: every LHS shape `variable_assignment` produces on the corpus is
      // printed there, and a sibling shape with its own population appears as its
      // own row. On the 400-file sample that census reads `variable_name` 3298 and
      // `subscript` 19, with a `variable_name` base on 19 of 19.
      let nameNode: Node | null = null
      let elementAssignment = false
      if (child && child.type === "variable_name") {
        nameNode = child
      } else if (child && child.type === "subscript") {
        const base = child.namedChild(0)
        if (base && base.type === "variable_name") {
          nameNode = base
          elementAssignment = true
        }
      }
      if (nameNode && nameNode.text.trim() !== "") {
        const key = `${owner}\u0000${nameNode.text}`
        if (declaredSymbols.has(key)) return // reassignment, not a declaration
        declaredSymbols.add(key)
        this.noteDeclaration(declSites, nameNode.text, owner, node.startPosition.row + 1, "variable")
        // `arr=(a b c)` — the value is an `array` node; the flag used to be a
        // parameter every caller passed `false`, so `isArray` was constant-false
        // on every plain assignment. It is now read from the tree. An ELEMENT
        // assignment makes the name an array too, whatever the value node is:
        // `COMPREPLY[i]=…` declares an array and nothing else could.
        const isArray = elementAssignment || this.valueIsArray(node)
        symbols.push({
          name: nameNode.text,
          kind: ASTEngine.SymbolKind.Variable,
          range: this.nodeToRange(node),
          scope: owner,
          visibility: this.visibilityForOwner(owner, scopeOwners),
          ownerName: owner || undefined,
          metadata: { bashSpecific: true, isArray, isTopLevel: owner === "" },
        })
        return
      }
    }
  }

  /**
   * A binding the language creates without an assignment node.
   *
   * `extractAssignment` and `extractDeclaration` cover the two node types that
   * carry an explicit `NAME=`. These four constructs bind a name and carry
   * neither, so before this existed they produced a `uses` edge to a target the
   * analyzer had not published — the edge asserted a read of a declaration that
   * did not exist in the graph. Measured on a 400-file hash-ordered sample:
   * 234 binding sites across 96 distinct files, and 357 `uses` edges naming a
   * target one of them declared. Adding this closed all 357 — the unresolvable
   * `uses` count fell 1,920 -> 1,563 and the `uses` total stayed at 7,802.
   *
   * The rule throughout is DECLINE, NEVER GUESS. A target counts only when it is
   * a `word` sibling that is a shell identifier, because the pinned grammar
   * represents a computed name as a different node and a literal name as a
   * `word` — so the type test is the whole filter. Every one of these was
   * verified on the tree rather than assumed, in
   * `validation/m14/fixtures/bash/probe-bash-binding-shapes.mts`:
   *
   *   read "$target"          -> `string`      declined
   *   read pre${n}fix         -> `concatenation` declined
   *   printf -v "$2"          -> `string`      declined
   *   mapfile -t "$name"      -> `string`      declined
   *   read *.txt              -> `word`        declined, not an identifier
   *   read                    -> (no target)   declined; bash assigns REPLY,
   *                                            which is in SHELL_DEFINED_VARS
   *   # read x                -> `comment`     declined
   *   echo "read x"           -> `string_content` declined
   *   cat <<'EOF' … read x …  -> `heredoc_body`  declined
   *
   * The last three are why this reads the tree: a text matcher would have
   * declared a variable from a comment, a string and a heredoc.
   */
  private extractImplicitBinding(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    owner: string,
    declaredSymbols: Set<string>,
    scopeOwners: Set<string>,
    declSites: Map<string, { owner: string; line: number; kind: string }[]>,
  ) {
    const publish = (name: string, at: Node, site: string, isArray: boolean) => {
      if (!isShellIdentifierName(name)) return
      const key = `${owner}\u0000${name}`
      if (declaredSymbols.has(key)) return // already declared; first declaration wins
      declaredSymbols.add(key)
      this.noteDeclaration(declSites, name, owner, at.startPosition.row + 1, "variable")
      symbols.push({
        name,
        kind: ASTEngine.SymbolKind.Variable,
        range: this.nodeToRange(at),
        scope: owner,
        visibility: this.visibilityForOwner(owner, scopeOwners),
        ownerName: owner || undefined,
        metadata: { bashSpecific: true, isImplicitBinding: true, bindingSite: site, isArray },
      })
    }

    // `for NAME in words; do …; done` and `for NAME; do …; done` — both carry a
    // bare `variable_name` child of `for_statement`. The c-style loop
    // `for ((i=0; …))` is a `c_style_for_statement` whose init IS a
    // `variable_assignment`, so it arrives at `extractAssignment` already and is
    // deliberately not handled here: two collectors publishing one name would
    // make one of them dead.
    if (node.type === "for_statement") {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (child && child.type === "variable_name") publish(child.text, child, "for", false)
      }
      return
    }

    // `read`/`mapfile`/`readarray` targets, and `printf -v NAME`.
    const cmd = this.commandNameOf(node)
    if (cmd.length === 0) return
    if (READ_TARGET_COMMANDS.has(cmd)) {
      let skipNext = false
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (!child || child.type === "command_name") continue
        // An env prefix (`IFS='/:' read …`) and a redirection target are neither
        // an option nor a name; they just advance the scan.
        if (child.type === "variable_assignment") continue
        const isOption =
          child.type === "word" &&
          child.text.length > 1 &&
          child.text.charCodeAt(0) === 45 /* - */ &&
          child.text.charCodeAt(1) !== 45 /* not `--` */
        if (isOption) {
          // A bundled option carries its value EITHER inside the bundle or in the
          // next sibling, and which one is decided by POSITION: only a value-taking
          // letter in the LAST position has nothing after it to take the value
          // from. `-ra args` -> `a` is last, so `args` is the array name. `-u3
          // name` -> `u` is followed by `3`, so the descriptor is inside the
          // bundle and `name` is a TARGET.
          //
          // This was a real defect in the first version, which asked only "does
          // this bundle contain a value letter" and so consumed `name` in
          // `read -u3 name`, dropping a binding bash actually makes. It was found
          // by a surviving MUTANT rather than by reading the code: emptying
          // READ_VALUE_OPT_LETTERS left the fixture battery green, which said the
          // fixture could not tell the two rules apart, and the discriminating
          // shape is in `probe-bash-binding-shapes.mts` as bundle-u3.
          const lastIndex = child.text.length - 1
          let consumesNext = false
          for (let j = 1; j < child.text.length; j++) {
            const letter = child.text[j]
            if (!READ_OPTION_LETTERS.has(letter)) continue
            if (READ_VALUE_OPT_LETTERS.has(letter)) {
              consumesNext = j === lastIndex
              // The FIRST value-taking letter owns the value; a letter after it is
              // not a separate option.
              break
            }
          }
          skipNext = consumesNext
          continue
        }
        if (skipNext) {
          skipNext = false
          continue
        }
        // `mapfile`/`readarray` fill an ARRAY; `read` fills a scalar.
        publish(child.text, child, cmd, cmd !== "read")
      }
      return
    }
    // `printf -v NAME fmt …` (bash 4.1). The target is the node IMMEDIATELY after
    // `-v`, and it must itself be a `word`, so `printf -v "$2" …` — a name the
    // script computes at run time — yields nothing. `echo` has no `-v`, which is
    // why this is keyed on `printf` and not on the flag.
    if (cmd === "printf") {
      for (let i = 0; i < node.namedChildCount - 1; i++) {
        const child = node.namedChild(i)
        if (!child || child.type !== "word" || child.text !== "-v") continue
        const target = node.namedChild(i + 1)
        if (target && target.type === "word") publish(target.text, target, "printf -v", false)
        return
      }
    }
  }

  private valueIsArray(node: Node): boolean {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue
      if (child.type === "array") return true
      // The NAME is not the value. The first cut returned false on the first
      // child that was not an `array`, and the first child IS the name — so
      // `DECK2=(one two)` reported isArray=false while `declare -a DECK=(…)`
      // reported true only because the declaration path sets the flag from a
      // different source. Caught by the fixture, not by inspection.
      if (child.type === "variable_name") continue
      if (child.type === "word" || child.type === "string" || child.type === "concatenation") continue
      return false
    }
    return false
  }

  /**
   * A declaration inside a function is private to it; one at the script's top
   * level is part of the script's surface.
   *
   * The lookup is a Set membership test, not a scan of the symbol list. The
   * scan was the last O(n^2) on the hot path: this is called for EVERY
   * assignment and EVERY `local`/`declare`, so a file with D declarations and S
   * symbols spent O(D x S) deciding a field that answers to one question — "is
   * this owner a function?". The answer is already known: the caller collected
   * the file's function names in one linear pre-pass (BD10) precisely so that
   * this kind of question is O(1). `alias` names join the same set, because an
   * alias is callable and a `local` inside one is equally private.
   */
  private visibilityForOwner(owner: string, scopeOwners: Set<string>): string {
    return scopeOwners.has(owner) ? "private" : "public"
  }

  private extractDeclaration(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    owner: string,
    functionParams: Map<string, Set<string>>,
    declaredSymbols: Set<string>,
    scopeOwners: Set<string>,
    addRel: (
      source: string,
      target: string,
      type: ASTEngine.RelationshipType,
      confidence: number,
      line: number,
      metadata?: Record<string, unknown>,
    ) => void,
    declSites: Map<string, { owner: string; line: number; kind: string }[]>,
  ) {
    const keyword = node.child(0)?.text ?? ""
    if (!DECLARATION_KEYWORDS.has(keyword)) return

    // export -f fn — exports a function definition; mark the existing symbol.
    const hasFunctionFlag = (() => {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (child && child.type === "word" && child.text === "-f") return true
      }
      return false
    })()

    const isArrayDecl = keyword === "declare" || keyword === "typeset"
    let sawArrayFlag = false
    // `declare -x NAME` exports NAME — the `-x` flag is `declare`'s spelling of
    // `export`, and a script that uses it is stating an interface just as
    // plainly. Found by the differential on the pinned corpus.
    let sawExportFlag = false
    if (isArrayDecl) {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (!child || child.type !== "word") continue
        if (child.text === "-a") sawArrayFlag = true
        if (child.text === "-x") sawExportFlag = true
      }
    }
    // `export` under either spelling, for the edge and the metadata alike.
    const isExport = keyword === "export" || sawExportFlag

    const emit = (name: string, range: ASTEngine.UniversalSymbol["range"], line: number) => {
      if (!name || name.trim() === "") return
      // A DECLARED NAME is a shell identifier: `[A-Za-z_][A-Za-z0-9_]*`. The
      // universe sweep over 2,747 admitted files across 51 repositories found the
      // analyzer emitting `exports` and `contains` for `PWD/collection_root_sys` —
      // a PATH FRAGMENT, and the real declaration missing with it. The cause is a
      // grammar truncation, not a typo: `export A=$PWD/x_user:$PWD/x_sys` parses as
      //   declaration_command
      //     variable_assignment "A=$PWD/x_user:$"   <- grammar stops at the colon
      //     word "PWD/x_sys"                        <- the tail, as a bare sibling
      // and the export handler read that `word` as a second exported name. Two
      // ansible test files, four fabricated edges, and the shape is common
      // (`export VAR=$HOME/a:$HOME/b` is how PATH-like variables are written).
      //
      // This is scoped to DECLARATIONS on purpose. The same sweep found 157 module
      // symbols containing spaces and many containing `$`, and those are
      // CORRECT: nvm's test fixtures are files literally named
      // `'nvm alias' should ignore leading blank lines in the file`, and BD2 makes
      // the script's own name its module. A rule applied to every symbol name
      // would delete those; applied here it cannot.
      if (!isShellIdentifierName(name)) return
      // The `exports` EDGE is a different fact from the SYMBOL, and the two have
      // separate dedupe rules. The pre-fix shape returned early on an
      // already-declared name, which silently swallowed the edge: `CFLAGS=…`
      // followed later by `export CFLAGS` — the ordinary two-step idiom in
      // every build script — produced the variable and no `exports` edge at all.
      // Measured on the pinned corpus: 10 export rows the differential expected
      // and the analyzer did not emit, every one of them a name first assigned
      // and then exported.
      if (isExport) {
        addRel(owner, name, ASTEngine.RelationshipType.Exports, 1.0, line, {
          bashSpecific: true,
          exportForm: "variable",
        })
      }
      const key = `${owner}\u0000${name}`
      if (declaredSymbols.has(key)) return // reassignment, not a declaration
      declaredSymbols.add(key)
      this.noteDeclaration(declSites, name, owner, line, isExport || keyword === "readonly" ? "constant" : "variable")
      if (isExport || keyword === "readonly") {
        symbols.push({
          name,
          kind: ASTEngine.SymbolKind.Constant,
          range,
          scope: owner,
          visibility: "public",
          ownerName: owner || undefined,
          metadata: {
            bashSpecific: true,
            isExported: isExport,
            isReadonly: keyword === "readonly",
          },
        })
      } else {
        symbols.push({
          name,
          kind: ASTEngine.SymbolKind.Variable,
          range,
          scope: owner,
          visibility: this.visibilityForOwner(owner, scopeOwners),
          ownerName: owner || undefined,
          metadata: {
            bashSpecific: true,
            isLocal: keyword === "local",
            isDeclared: keyword === "declare" || keyword === "typeset",
            isArray: sawArrayFlag,
          },
        })
      }
    }

    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue
      const childLine = child.startPosition.row + 1
      if (child.type === "variable_name") {
        // `export NAME`, `export -f fn`, `local NAME`, `declare -a NAME` with no
        // value all reach the extractor as a BARE `variable_name` child, not as
        // a `word` and not wrapped in a `variable_assignment`. The pre-wave
        // extractor handled only the other two shapes, so `export NAME` — one of
        // the most common statements in a shell script — emitted no symbol, no
        // `exports` edge and nothing else. Found by fixture export-edges-bd7,
        // not by inspection: the tree was read after the assertion failed.
        if (hasFunctionFlag) {
          this.markFunctionExported(symbols, child.text)
          addRel(owner, child.text, ASTEngine.RelationshipType.Exports, 1.0, childLine, {
            bashSpecific: true,
            exportForm: "function",
          })
        } else {
          emit(child.text, this.nodeToRange(child), childLine)
        }
      } else if (child.type === "variable_assignment") {
        if (hasFunctionFlag) {
          // export -f fn=... is unusual; treat the name as a function export
          for (let j = 0; j < child.namedChildCount; j++) {
            const vn = child.namedChild(j)
            if (vn && vn.type === "variable_name") {
              this.markFunctionExported(symbols, vn.text)
              addRel(owner, vn.text, ASTEngine.RelationshipType.Exports, 1.0, childLine, {
                bashSpecific: true,
                exportForm: "function",
              })
            }
          }
          continue
        }
        for (let j = 0; j < child.namedChildCount; j++) {
          const vn = child.namedChild(j)
          if (vn && vn.type === "variable_name") {
            emit(vn.text, this.nodeToRange(child), childLine)
            if (keyword === "local" && owner) {
              // positional $1..$9 defaults (local x=$1) also record parameters
              const valueNode = child.namedChild(1)
              this.collectPositionalFromValue(valueNode, functionParams, owner)
            }
          }
        }
      } else if (child.type === "word" && !child.text.startsWith("-") && child.text !== keyword) {
        if (hasFunctionFlag) {
          this.markFunctionExported(symbols, child.text)
          addRel(owner, child.text, ASTEngine.RelationshipType.Exports, 1.0, childLine, {
            bashSpecific: true,
            exportForm: "function",
          })
        } else {
          emit(child.text, this.nodeToRange(child), childLine)
        }
      }
    }
  }

  private collectPositionalFromValue(
    node: Node | null,
    functionParams: Map<string, Set<string>>,
    fnName: string,
  ) {
    if (!node) return
    const scan = (n: Node) => {
      if (n.type === "simple_expansion") {
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && c.type === "variable_name" && c.text.length > 0 && c.text.charCodeAt(0) >= 48 && c.text.charCodeAt(0) <= 57) {
            functionParams.get(fnName)?.add(c.text)
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) scan(child)
      }
    }
    scan(node)
  }

  private markFunctionExported(symbols: ASTEngine.UniversalSymbol[], name: string) {
    for (let i = 0; i < symbols.length; i++) {
      const s = symbols[i]
      if (s.kind === ASTEngine.SymbolKind.Function && s.name === name) {
        s.metadata = { ...s.metadata, isExported: true }
        s.visibility = "public"
        return
      }
    }
  }

  private extractCommand(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    imports: ASTEngine.ImportInfo[],
    patterns: Set<string>,
    ctx: {
      addRel: (
        source: string,
        target: string,
        type: ASTEngine.RelationshipType,
        confidence: number,
        line: number,
        metadata?: Record<string, unknown>,
      ) => void
      relSource: () => string
      scriptName: string
      localFunctions: Set<string>
      scopeOwners: Set<string>
      flags: {
        usesEval: () => boolean
        usesSudo: () => boolean
        hasChmod777: () => boolean
        hasRmRoot: () => boolean
        hasStrictError: () => boolean
      }
      setFlag: {
        eval: (v: boolean) => void
        sudo: (v: boolean) => void
        chmod777: (v: boolean) => void
        rmRoot: (v: boolean) => void
        strictError: (v: boolean) => void
      }
    },
  ) {
    const nameNode = this.commandNameNode(node)
    if (!nameNode) return
    const cmdName = this.commandNameOf(node)
    if (!cmdName) return
    // BD1: the edge's line is the line the command NAME is on.
    const nameLine = nameNode.startPosition.row + 1

    // BD5: nothing is emitted out of a recovered name. The shape test is
    // `nameNode` alone: the damage half is measured and rejected, see
    // isRecoveredCommandWord.
    if (this.isRecoveredCommandWord(nameNode)) {
      patterns.add("Recovered Parse Region")
      return
    }

    // BD4: a command word that is an unexpanded expression is not a call to a
    // name. The variables inside it are still read, and the expansion walk
    // already emits those Uses edges; there is no callee to point at.
    //
    // The refusal itself is ONE gate, `isCommandNameText` — the predicate the
    // trap-handler path shares, so a reserved word cannot come back through the
    // other door. The pattern label is derived here rather than gating anything:
    // a reserved word is not a dynamic command name, it is the grammar handing
    // back a keyword. Deriving the label instead of testing the word a second
    // time is a measured choice — with the test duplicated, the mutant
    // `bash/reserved-word-guard-removed` (which deletes the line in
    // `isCommandNameText`) SURVIVED, because the duplicate still held the line.
    // mutants-bash-lane.mts is what said so.
    if (this.containsExpansion(nameNode) || !isCommandNameText(cmdName)) {
      patterns.add(SHELL_RESERVED_WORDS.has(cmdName) ? "Recovered Parse Region" : "Dynamic Command Name")
      return
    }

    // An arithmetic operand the grammar handed back in command position is not a
    // callee. `attempt` inside `$((attempt + 1))` is a number being read, not a
    // program being run, so there is nothing to point a `calls` edge at.
    if (this.isArithmeticOperandCommand(node)) {
      return
    }

    // A `case` arm's PATTERN, read back in command position because the grammar
    // could not close the construct. This must sit ABOVE the `source`/`.` branch
    // below, which is the whole point: the `source` arm's pattern IS the word
    // `source`, so without this guard the arm publishes `imports` + `references`
    // edges to a shell function. See `isCaseArmPatternCommand`.
    if (this.isCaseArmPatternCommand(node)) {
      patterns.add("Recovered Parse Region")
      return
    }

    // Dependency/pattern classification for well-known tooling.
    if (cmdName === "docker" || cmdName === "docker-compose" || cmdName === "kubectl" || cmdName === "helm") {
      patterns.add("Container/Orchestration Script")
      patterns.add("Deployment Script")
    } else if (cmdName === "aws" || cmdName === "gcloud" || cmdName === "az" || cmdName === "terraform") {
      patterns.add("Cloud Infrastructure Script")
    } else if (cmdName === "npm" || cmdName === "yarn" || cmdName === "pnpm" || cmdName === "cargo" || cmdName === "go") {
      patterns.add("Build/Compilation Script")
    } else if (cmdName === "curl" || cmdName === "wget") {
      patterns.add("Network Request Script")
    } else if (cmdName === "eval") {
      ctx.setFlag.eval(true)
      patterns.add("Dynamic Code Execution")
    } else if (cmdName === "sudo") {
      ctx.setFlag.sudo(true)
      patterns.add("Privilege Escalation")
    }

    if (cmdName === "source" || cmdName === ".") {
      const arg = this.firstArgumentWord(node)
      if (arg) {
        const line = this.firstArgumentLine(node) ?? nameLine
        // A sourced path built from a variable cannot be resolved to a file, so
        // it is labelled rather than presented as a resolved dependency: 16 of
        // the lane's 23 import edges on the pinned corpus were
        // `source $scriptroot/tools.sh`, a target no symbol can ever have.
        // Dynamic iff the ARGUMENT NODE holds an unexpanded value — a
        // structural test, so a path that merely contains a dot or a dash is
        // not mistaken for one. The first cut asked whether the text looked
        // like an identifier after the directory was stripped, which
        // classified the plain literal `./sibling.sh` as dynamic and marked
        // 2 of the fixture's 3 imports unresolved.
        const argNode = this.firstArgumentNode(node)
        const dynamic = argNode ? this.containsExpansion(argNode) : false
        // The path is kept AS WRITTEN. An earlier version of this decision
        // "improved" it by resolving a relative path against the sourcing file's
        // own directory, and that was WRONG: bash resolves a relative `source`
        // against `$PWD` at run time, not against the script's location, so the
        // rewrite turned `source ./eng/common/tools.sh` inside `eng/common/`
        // into the nonexistent `eng/common/eng/common/tools.sh`. The script's
        // own directory is recorded as CONTEXT, where it is useful, and the
        // path itself is reported as the shell will read it.
        // De-quote the path EXPRESSION. `source "$(dirname "$0")"/lib.sh`
        // concatenates a command substitution with literal path text, and the
        // quotes wrap only the substitution — so the target as written begins
        // with a stray `"` that no reader and no graph can use. A filesystem
        // path cannot contain a quote character, so removing them is mechanical
        // rather than interpretive. Measured: it was the last disagreement on the
        // pinned corpus, one row seen from both sides because the two
        // implementations de-quoted differently.
        const normalized = this.dequotePath(arg)
        imports.push({
          module: normalized,
          items: ["*"],
          isDefaultImport: true,
          isNamespaceImport: false,
          range: this.nodeToRange(node),
          metadata: {
            isSourceImport: true,
            resolution: dynamic ? "dynamic" : "literal",
          },
        })
        ctx.addRel(ctx.relSource(), normalized, ASTEngine.RelationshipType.Imports, 1.0, line, {
          isSourceImport: true,
          resolution: dynamic ? "dynamic" : "literal",
          bashSpecific: true,
        })
        ctx.addRel(ctx.relSource(), normalized, ASTEngine.RelationshipType.References, 1.0, line, {
          isSourceDependency: true,
          resolution: dynamic ? "dynamic" : "literal",
          bashSpecific: true,
        })
      }
      return
    }

    if (cmdName === "export") {
      this.handleExportCommand(node, symbols, ctx)
      return
    }

    if (cmdName === "alias") {
      const aliasName = this.aliasNameOf(node)
      if (aliasName) {
        symbols.push({
          name: aliasName,
          kind: ASTEngine.SymbolKind.Function,
          range: this.nodeToRange(node),
          scope: ctx.scriptName,
          visibility: "public",
          ownerName: ctx.scriptName,
          metadata: { isAlias: true, bashSpecific: true },
        })
        ctx.localFunctions.add(aliasName)
        ctx.scopeOwners.add(aliasName)
      }
      return
    }

    if (cmdName === "trap") {
      this.handleTrap(node, ctx, patterns, nameLine)
      return
    }

    if (cmdName === "set") {
      if (this.hasErrexitFlags(node)) {
        ctx.setFlag.strictError(true)
        patterns.add("Strict Error Handling")
      }
      return
    }

    // `chmod` and `rm` are external commands, so they are CALLS; the security
    // classification is an ADDITIONAL fact about the call, not a replacement
    // for it. Returning here — the pre-fix shape — withheld the edge and left
    // the differential with 12 `calls` rows the analyzer could not produce.
    if (cmdName === "chmod" && this.hasArgument(node, "777")) {
      ctx.setFlag.chmod777(true)
      patterns.add("Insecure Permissions")
    }

    if (cmdName === "rm" && this.isRmRoot(node)) {
      ctx.setFlag.rmRoot(true)
      patterns.add("Destructive File Operation")
    }

    if (SHELL_BUILTINS.has(cmdName)) return
    // A `case` arm's commands are ordinary calls — `case $1 in install)
    // apt-get install foo ;; esac` installs something, and a reader asking "what
    // does this script install?" must see it. The arm's PATTERN is a `word` or
    // `string` node, never a `command`, so suppressing by depth threw away
    // real calls and never suppressed a pattern. Measured on the pinned corpus:
    // 33 command nodes suppressed, of which 14 were distinct (source,target)
    // pairs that were otherwise never emitted.
    const isLocal = ctx.localFunctions.has(cmdName)
    ctx.addRel(ctx.relSource(), cmdName, ASTEngine.RelationshipType.Calls, 1.0, nameLine, {
      // The previous emitter set BOTH flags to `true` on every call, so a call
      // to a function defined three lines above claimed to be an external
      // command. The two are now mutually exclusive facts.
      isFunctionCall: isLocal,
      isExternalCommand: !isLocal,
      resolvedWithinFile: isLocal,
      // Where this command node sits, so the attribution pass can tell a name
      // collision from wreckage. Published on true only, and it is a statement
      // about the node's POSITION rather than a verdict on the edge — round 13
      // measured 427 function names whose `name:` field sits inside an ERROR span
      // and every one is a real declaration, the span reaching back over intact
      // code. So this flag never removes an edge. It exists because the
      // attribution pass runs AFTER the walk and would otherwise have to re-derive
      // the shape from a node it no longer holds.
      commandInErrorRecovery: this.isInsideErrorNode(node) || undefined,
      bashSpecific: true,
    })
  }

  /**
   * Is this node a DESCENDANT of a tree-sitter `ERROR` node?
   *
   * The narrow half of what round 3's guard B would have tested, and the half that
   * survives its own measurement. Guard B was "any damaged region — subtree or
   * ancestor chain" and it removed 96 of 2,945 `calls` edges on a 200-file sample,
   * 15 of them real `kube::log::status` calls, because a MISSING token anywhere in
   * a file condemns every command under it.
   *
   * Re-measured at whole corpus with the analyzer's OWN selector for the command
   * name (`commandNameNode`, which scans all named children — the first version of
   * the probe read `namedChild(0)` and so missed the very shape round 3 named):
   *
   *   2,891 `calls` edges come from a command inside an ERROR subtree, and the
   *   removal set is `setopt`, `print`, `echoti`, `autoload`, `emulate`, `title`,
   *   `terminal-notifier`, `notify-send` — real work, overwhelmingly zsh.
   *
   * So the flag is published and NO guard is built on it. The three whole-corpus
   * edges it would have caught are named in the lane doc as residuals, because the
   * alternative is deleting 2,891 correct edges to remove 3.
   */
  private isInsideErrorNode(node: Node): boolean {
    for (let cur: Node | null = node.parent; cur; cur = cur.parent) {
      if (cur.type === "ERROR") return true
    }
    return false
  }

  private handleExportCommand(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    ctx: {
      relSource: () => string
      addRel: (
        source: string,
        target: string,
        type: ASTEngine.RelationshipType,
        confidence: number,
        line: number,
        metadata?: Record<string, unknown>,
      ) => void
    },
  ) {
    // `export -f fn` in command position — mark function exported.
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child || child.type !== "word" || child.text !== "-f") continue
      for (let j = 0; j < node.namedChildCount; j++) {
        const word = node.namedChild(j)
        if (word && word.type === "word" && !word.text.startsWith("-") && word.text !== "export") {
          this.markFunctionExported(symbols, word.text)
          ctx.addRel(ctx.relSource(), word.text, ASTEngine.RelationshipType.Exports, 1.0, child.startPosition.row + 1, {
            bashSpecific: true,
            exportForm: "function",
          })
        }
      }
      return
    }
    // `export VAR=value` in command position → Constant.
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === "variable_assignment") {
        for (let j = 0; j < child.namedChildCount; j++) {
          const vn = child.namedChild(j)
          if (vn && vn.type === "variable_name") {
            symbols.push({
              name: vn.text,
              kind: ASTEngine.SymbolKind.Constant,
              range: this.nodeToRange(child),
              scope: ctx.relSource(),
              visibility: "public",
              ownerName: ctx.relSource(),
              metadata: { isExported: true, bashSpecific: true },
            })
            ctx.addRel(ctx.relSource(), vn.text, ASTEngine.RelationshipType.Exports, 1.0, child.startPosition.row + 1, {
              bashSpecific: true,
              exportForm: "variable",
            })
          }
        }
      }
    }
  }

  private aliasNameOf(node: Node): string {
    // `alias ll='ls -la'` parses the definition as a concatenation whose first
    // word carries the name and an `=` separator (e.g. `ll=`). The grammar
    // provides no structural field for the alias name, so the name is the
    // portion before the first `=` — index arithmetic, not source scanning.
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue
      const text = child.type === "concatenation" ? child.text : child.type === "word" ? child.text : ""
      if (text) {
        const eq = text.indexOf("=")
        if (eq > 0) {
          const name = text.slice(0, eq)
          if (name.trim() !== "" && !name.startsWith("-")) return name
        }
      }
    }
    return ""
  }

  /**
   * BD3: `trap 'handler' SIGNAL`. A signal is not code and was used as the
   * edge SOURCE, which produced `calls: EXIT -> cleanup` — a caller that does
   * not exist. The handler is a command string; the edge belongs to the scope
   * that installs the trap, the target is the handler's command NAME, and the
   * signal rides along in metadata.
   */
  private handleTrap(
    node: Node,
    ctx: {
      addRel: (
        source: string,
        target: string,
        type: ASTEngine.RelationshipType,
        confidence: number,
        line: number,
        metadata?: Record<string, unknown>,
      ) => void
      relSource: () => string
      /**
       * The set of function names the file declares, collected in a pre-pass.
       *
       * M60: this was added so the trap handler's `calls` edge carries the SAME
       * `isFunctionCall`/`isExternalCommand` classification as the 54,995 edges
       * the main command site emits. Those two flags are the only thing that tells
       * a consumer whether a call leaves the file, and this site was the one place
       * that asserted a call without classifying it — 223 corpus edges, of which
       * 123 name a function the same file declares. See
       * `docs/analyzers/real-bash-analyzer.md`, "Round 7".
       */
      localFunctions: Set<string>
    },
    patterns: Set<string>,
    nameLine: number,
  ) {
    let handlerText = ""
    const signals: string[] = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue
      const type = child.type
      if (type === "raw_string" || type === "string") {
        const inner = this.stripQuotes(child.text)
        if (!handlerText) handlerText = inner
      } else if (type === "word") {
        if (child.text === "trap") continue
        if (child.text.startsWith("-")) continue
        if (!handlerText) handlerText = child.text
        else signals.push(child.text)
      }
    }
    if (!handlerText) return

    // A handler is one or more `;`-separated commands. Each named command is a
    // real call site; a compound handler that is itself a definition or an
    // anonymous block contributes no name and is skipped rather than emitted
    // as a text blob.
    const parts = handlerText.split(";")
    let emittedAny = false
    for (const rawPart of parts) {
      const part = rawPart.trim()
      if (part.length === 0) continue
      const firstToken = this.firstTokenOf(part)
      if (!firstToken || !isCommandNameText(firstToken)) continue
      if (SHELL_BUILTINS.has(firstToken)) continue
      // The SAME classification the main command site applies, from the SAME
      // pre-pass. Whether the callee leaves the file is a property of the callee's
      // name, not of how the name was extracted, so the fact is exactly as sound
      // here as it is there — and a consumer reading `calls` metadata has one rule
      // to learn rather than two, one of which is silent on this path.
      const isLocal = ctx.localFunctions.has(firstToken)
      ctx.addRel(ctx.relSource(), firstToken, ASTEngine.RelationshipType.Calls, 0.7, nameLine, {
        isTrapHandler: true,
        viaTrap: true,
        isFunctionCall: isLocal,
        isExternalCommand: !isLocal,
        resolvedWithinFile: isLocal,
        signals: signals.length > 0 ? signals : ["EXIT"],
        bashSpecific: true,
      })
      emittedAny = true
    }
    if (!emittedAny) {
      // A handler with no resolvable command name (`trap ':' EXIT`, a compound
      // block) is recorded as a pattern so the fact is not lost, but it
      // produces no edge. The alternative considered and refused was a
      // self-edge on the enclosing scope: a relationship whose source and
      // target are the same symbol says nothing a pattern does not say better.
      patterns.add("Signal Handler")
    }
  }

  /** The first shell token of a handler string: leading `name`, `name=value` and
   *  `name(args)` shapes all yield the command name. */
  private firstTokenOf(part: string): string {
    let i = 0
    // skip leading env assignments: FOO=bar cmd …
    while (i < part.length) {
      const start = i
      while (i < part.length && part.charCodeAt(i) !== 32 && part.charCodeAt(i) !== 61) i++
      const token = part.slice(start, i)
      if (i < part.length && part.charCodeAt(i) === 61) {
        i++ // skip the value
        while (i < part.length && part.charCodeAt(i) === 32) i++
        continue
      }
      if (i < part.length && part.charCodeAt(i) === 40) break // `name(…)` is a call, not a command
      return token
    }
    return ""
  }

  private hasErrexitFlags(node: Node): boolean {
    let sawO = false
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child || child.type !== "word") continue
      const text = child.text
      if (text === "-o") {
        sawO = true
        continue
      }
      if (sawO && text === "errexit") return true
      sawO = false
      if (text.startsWith("-") && text.length > 1) {
        for (let j = 1; j < text.length; j++) {
          if (text.charCodeAt(j) === 101) return true // lowercase e → errexit
        }
      }
    }
    return false
  }

  private hasArgument(node: Node, value: string): boolean {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === "word" && child.text === value) return true
    }
    return false
  }

  private isRmRoot(node: Node): boolean {
    let hasRecursive = false
    let hasForce = false
    let hasRoot = false
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child || child.type !== "word") continue
      const text = child.text
      if (text === "/") hasRoot = true
      else if (text.startsWith("-")) {
        for (let j = 1; j < text.length; j++) {
          const code = text.charCodeAt(j)
          if (code === 114) hasRecursive = true // r
          if (code === 102) hasForce = true // f
        }
      }
    }
    return hasRecursive && hasForce && hasRoot
  }

  private firstArgumentWord(node: Node): string {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child || child.type === "command_name") continue
      if (child.type === "word" || child.type === "raw_string" || child.type === "string" || child.type === "concatenation") {
        return this.stripQuotes(child.text)
      }
    }
    return ""
  }

  private firstArgumentNode(node: Node): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child || child.type === "command_name") continue
      if (child.type === "word" || child.type === "raw_string" || child.type === "string" || child.type === "concatenation") {
        return child
      }
    }
    return null
  }

  private firstArgumentLine(node: Node): number | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child || child.type === "command_name") continue
      if (child.type === "word" || child.type === "raw_string" || child.type === "string" || child.type === "concatenation") {
        return child.startPosition.row + 1
      }
    }
    return null
  }

  // `normalizeRelative` was DELETED in M60, not merely unused. It resolved a
  // relative `source` against the sourcing file's own directory, which BD9
  // reversed as wrong: bash resolves a relative `source` against `$PWD` at run
  // time, so the rewrite turned `source ./eng/common/tools.sh` inside
  // `eng/common/` into the nonexistent `eng/common/eng/common/tools.sh`. The
  // function had no callers, and its doc comment still asserted the reversed
  // behaviour, so the file described two different contracts for one construct.

  private detectFrameworks(patterns: string[]): string[] {
    // The language itself is not a framework. Returning a bare ["Bash"] made
    // `hasFrameworkIntelligence: true` true for every file in the corpus; the
    // language is reported separately as `framework`, and this list carries only
    // what was actually detected.
    const frameworks: string[] = []
    for (let i = 0; i < patterns.length; i++) {
      if (patterns[i] === "Container/Orchestration Script" && !frameworks.includes("Docker/Kubernetes")) frameworks.push("Docker/Kubernetes")
      if (patterns[i] === "Cloud Infrastructure Script" && !frameworks.includes("Cloud Native")) frameworks.push("Cloud Native")
    }
    return frameworks
  }

  private generateInsights(patterns: string[], hasStrictError: boolean): string[] {
    const insights: string[] = []
    for (let i = 0; i < patterns.length; i++) {
      if (patterns[i] === "Deployment Script") {
        insights.push("This script contains deployment logic.")
        break
      }
    }
    let hasContainerPattern = false
    let hasEnvPattern = false
    for (let i = 0; i < patterns.length; i++) {
      if (patterns[i] === "Container/Orchestration Script") hasContainerPattern = true
      if (patterns[i] === "Environment Variable Tracking") hasEnvPattern = true
    }
    if (hasContainerPattern) insights.push("Acts as a container orchestration script")
    if (hasEnvPattern) insights.push("Manages environment states for downstream processes")
    if (!hasStrictError) insights.push("Lacks 'set -e' for strict error catching")
    return insights
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

function isAllDigits(text: string): boolean {
  if (text.length === 0) return false
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code < 48 || code > 57) return false
  }
  return true
}
