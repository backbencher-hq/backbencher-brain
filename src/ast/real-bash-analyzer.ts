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
    // First declaration line per function name, for the BD8b `overrides` edge.
    const functionFirstDeclaration = new Map<string, number>()
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
          const prior = functionFirstDeclaration.get(name)
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
          } else {
            functionFirstDeclaration.set(name, node.startPosition.row + 1)
          }
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
        node.type === "c_style_for_statement"
      ) {
        this.emitVariableUses(node, symbols, relSource, addRel, declaredSymbols, functionStack, functionParams)
      } else if (node.type === "for_statement") {
        // `for NAME in …` binds NAME with no assignment node. See
        // `extractImplicitBinding` for the measurement this closes.
        this.extractImplicitBinding(node, symbols, enclosingFunction() || scriptName, declaredSymbols, scopeOwners)
      } else if (node.type === "variable_assignment") {
        if (node.parent?.type !== "declaration_command") {
          this.extractAssignment(node, symbols, enclosingFunction() || scriptName, declaredSymbols, scopeOwners)
        }
      } else if (node.type === "declaration_command") {
        this.extractDeclaration(node, symbols, enclosingFunction() || scriptName, functionParams, declaredSymbols, scopeOwners, addRel)
      } else if (node.type === "command") {
        this.extractImplicitBinding(node, symbols, enclosingFunction() || scriptName, declaredSymbols, scopeOwners)
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
    // `( (` written adjacently is `((`: bash reads it as arithmetic, never as a
    // nested subshell, so the closing pair is part of the test rather than a
    // detail. `( (date) )` has a space and stays a real subshell.
    const isDoubleParen = (t: string): boolean => opensWithDoubleParen(t) && endsWithDoubleParen(t)
    let cur: Node | null = node.parent
    while (cur) {
      // A `command_substitution` decides it. `$((` is the arithmetic expansion
      // the grammar misread as `$(` + subshell; a plain `$(` is a real command
      // substitution, and `$(wc -l < f)` nested inside `$(( ))` really does run
      // `wc`, so that edge must survive.
      if (cur.type === "command_substitution") return opensWithArithmeticExpansion(cur.text)
      if (cur.type === "subshell" && isDoubleParen(cur.text)) return true
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
  ) {
    const names: { rawName: string; line: number }[] = []
    this.collectReadNames(node, names)

    // Was this read name ASSIGNED anywhere in this file? `declaredSymbols` is the
    // one per-file store both the declaration collector and this emitter see, but
    // its keys are `${owner}\u0000${name}` — a read inside a function cannot
    // reach a module-level assignment by asking for its own owner, which is
    // exactly the case that matters most. So the suffixes are indexed once and
    // the memo is keyed on the set's size, which only ever grows as declarations
    // are collected.
    let assignedIndex: { size: number; names: Set<string> } | null = null
    const assignedInFile = (n: string): boolean => {
      if (!assignedIndex || assignedIndex.size !== declaredSymbols.size) {
        const s = new Set<string>()
        for (const k of declaredSymbols) {
          const i = k.indexOf("\u0000")
          if (i >= 0) s.add(k.slice(i + 1))
        }
        assignedIndex = { size: declaredSymbols.size, names: s }
      }
      return assignedIndex.names.has(n)
    }
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
          ...(declaredSymbols.has(`global\u0000${name}`) ? { isDeclaredGlobal: true } : {}),
          // BD11. The lane's classification previously stopped at "a symbol, a
          // known noise leaf, or nothing", and 407 of the `uses` edges on the
          // pinned corpus fell into the last bucket: the read is real and the
          // name is honest, but nothing said WHETHER this file assigns it. A
          // consumer therefore had to guess whether `$TMPDIR` was a project
          // variable it could not see or an environment-supplied one it never
          // will. Emitted on true only, matching `isShellDefined` and
          // `isDeclaredGlobal` above — ABSENCE MEANS FALSE, and the contract is
          // stated in the spec rather than left to be inferred from a pattern.
          ...(assignedInFile(name) ? { isAssignedInFile: true } : {}),
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
  ) {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === "variable_name" && child.text.trim() !== "") {
        const key = `${owner}\u0000${child.text}`
        if (declaredSymbols.has(key)) return // reassignment, not a declaration
        declaredSymbols.add(key)
        // `arr=(a b c)` — the value is an `array` node; the flag used to be a
        // parameter every caller passed `false`, so `isArray` was constant-false
        // on every plain assignment. It is now read from the tree.
        const isArray = this.valueIsArray(node)
        symbols.push({
          name: child.text,
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
  ) {
    const publish = (name: string, at: Node, site: string, isArray: boolean) => {
      if (!isShellIdentifierName(name)) return
      const key = `${owner}\u0000${name}`
      if (declaredSymbols.has(key)) return // already declared; first declaration wins
      declaredSymbols.add(key)
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
          let consumesNext = false
          for (let j = 1; j < child.text.length; j++) {
            const letter = child.text[j]
            if (!READ_OPTION_LETTERS.has(letter)) continue
            if (READ_VALUE_OPT_LETTERS.has(letter)) consumesNext = true
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
      bashSpecific: true,
    })
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
      ctx.addRel(ctx.relSource(), firstToken, ASTEngine.RelationshipType.Calls, 0.7, nameLine, {
        isTrapHandler: true,
        viaTrap: true,
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
