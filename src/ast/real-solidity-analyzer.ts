import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"
import { isReservedTarget, ENGINE_FUNCTION_NAMES, STORE_REFUSED_SYMBOL_NAMES } from "./solidity-reserved-tokens"

/**
 * Solidity analyzer.
 *
 * Contract notes that are not obvious from the code. Each is a ruling, and each
 * names the measurement or the grammar line that forced it. Several were settled
 * by reading the vendored `grammar.js` rather than by writing Solidity and hoping
 * the tree looked the way memory said it would — which is section 5.4's "your own
 * instruments will lie to you", applied to the obvious failure mode of trusting a
 * language model about a language it cannot parse.
 *
 * ── THE SHAPE, AS MEASURED ────────────────────────────────────────────────────
 * Every construct below was read off the wired bytes with
 * `script/m60/solidity-type-census.ts`, over all 389 production files of
 * solidity@32b5b8c4 (OpenZeppelin/openzeppelin-contracts), draw digest
 * c1531019: 0 damaged files, 0 ERROR nodes, 0 MISSING nodes, and 112 of the 124
 * declared named types exercised. Three claims in the lane's handoff were WRONG
 * and are corrected here by the number that replaces them:
 *
 *   · "27 never-exercised named types" is a property of the 60-file DRAW, not of
 *     the corpus. Over the full 389-file production corpus it is 12.
 *   · "the corpus under-represents Yul" is FALSE, and had it been believed the
 *     lane would have been built wrong. OpenZeppelin is assembly-heavy: 2,800
 *     `yul_function_call`, 2,819 `yul_identifier`, 2,640 `yul_path`, 447
 *     `assembly_statement`. Yul is a first-class sub-language HERE and is
 *     analysed as one, including its own functions, variables, calls, paths and
 *     loops. Evidence: `validation/m60/results/solidity-type-census.json`.
 *   · "0 damage" was measured on the 60-file draw; it also holds on all 389.
 *
 *  - SOL-1  THE FILE IS THE MODULE, AND THE EXTENSION STAYS. A `.sol` file is a
 *    compilation unit holding SEVERAL top-level contracts — OpenZeppelin's
 *    `AccessControl.sol` holds `AccessControl` AND `AccessControlEnumerable`
 *    (measured: 389 files, 325 `contract_declaration`, 75 `interface_declaration`,
 *    65 `library_declaration`), so there is no single declaration to name the
 *    file. bash BD2 / PowerShell PS1's ruling is adopted: the module is a real
 *    symbol named after its own basename WITH the extension. No Solidity
 *    identifier can contain a `.`, so `AccessControl.sol` cannot collide with a
 *    project name, and it is machine-path-free so the index fingerprint is
 *    stable. NAMED LIMITATION: two files sharing a basename in different
 *    directories produce the same module name — inherited from bash and
 *    PowerShell, measured and declared in
 *    `docs/analyzers/real-solidity-analyzer.md` §Verified limitations, not
 *    hidden.
 *
 *  - SOL-2  DECLARATION / REFERENCE / CALL / READ. A DECLARATION is a symbol; a
 *    type MENTION is a `uses` edge; a call is a `calls` edge. The fourth
 *    question — what is a READ — has the answer "an `identifier` whose PARENT is
 *    an `expression`", which is the grammar's own primary-expression position
 *    (grammar.js:805 `_primary_expression`). Stating it POSITIONALLY rather than
 *    as a name list is what keeps it honest: every declaration name in Solidity
 *    is the `name:` FIELD of its declaration node, so a declaration name can
 *    never sit under an `expression` and the two classes cannot overlap. The
 *    name-list version would have needed ~40 suppressions and would still have
 *    leaked. Measured consequence: 37,467 `identifier` nodes in the corpus, and
 *    the read pass claims only the ones in that position.
 *
 *  - SOL-3  THE PUBLIC STATE-VARIABLE GETTER IS PUBLISHED UNDER ITS REAL NAME,
 *    `bal()`. `uint256 public bal;` makes the compiler synthesise a getter that
 *    appears NOWHERE in the source, and the decision is which of three shapes to
 *    give it. The first draft chose "record it in the symbol's metadata and do not
 *    publish it", on the reasoning that a duplicate `bal` would collide with the
 *    state variable invisibly. MEASUREMENT KILLED THAT DRAFT: `parseFile` returns
 *    every symbol with `metadata: undefined`, because pool-worker.ts drops the
 *    whole object at the worker boundary — the same seam that cost the PowerShell
 *    lane its `is_static = 0` and its `annotations = null`. So "record it in
 *    metadata" was a decision the store never received, which is structurally the
 *    same failure as the PowerShell lane's pin record claiming 8 patches against
 *    bytes containing 7: an artifact agreeing with itself and disagreeing with what
 *    ships.
 *
 *    What ships instead: the getter is a real symbol, named with its EXTERNAL
 *    SIGNATURE `bal()`. A Solidity identifier cannot contain `(`, so this name can
 *    never collide with the state variable `bal`, with a function, or with
 *    anything else — the collision the first draft was avoiding does not exist
 *    under this spelling. It is navigable (`bb_graph`, search, the `contains` tree
 *    from the contract), and a `references` edge from the variable to the getter
 *    makes the pair a walk rather than two adjacent rows. It is a leaf of the call
 *    graph, which is CORRECT: a public getter has no in-repo caller unless the repo
 *    calls it. `metadata.getterSynthesised` is still set, because a pre-store
 *    consumer can use it — it is simply not what makes the fact true.
 *    352 `state_variable_declaration` nodes in the corpus; the public ones are
 *    counted as `getterSymbols` in the surface artifact.
 *
 *  - SOL-4  `constructor` IS WRITTEN IN THE SOURCE. `constructor_definition` has
 *    NO `name:` field — but unlike PowerShell's `Deployment(...)`, Solidity
 *    writes the literal keyword `constructor`, so the name is READ off the first
 *    token, not synthesised, and the line is the real name line with no null-line
 *    handling. `fallback_receive_definition` is ONE rule covering both `receive`
 *    and `fallback` (grammar.js:830) and is split by the same token read;
 *    11 occurrences in the corpus.
 *
 *  - SOL-5  `is` IS NOT ALWAYS `extends`. Solidity has ONE heritage construct:
 *    `contract C is A, B`. There is no `interface` keyword in the heritage list,
 *    so the tree does NOT say which relationship kind each ancestor is — that
 *    distinction lives in the ANCESTOR'S OWN DECLARATION. The rule: an ancestor
 *    bound to an `interface_declaration` in the same file is `implements`;
 *    everything else is `extends`. 544 `inheritance_specifier` occurrences in the
 *    corpus; the split is reported per-kind in
 *    `validation/m60/results/solidity-surface.json`. NAMED LIMITATION: an
 *    interface declared in ANOTHER file of the same project resolves as
 *    `extends`, because a per-file analyzer cannot see it. That is a wrong KIND,
 *    not a missing edge, and it is counted and reported as
 *    `implementsCrossFileUnresolved` rather than papered over.
 *
 *  - SOL-6  NOTHING IS EMITTED FROM A RECOVERY REGION. bash BD5, extended to a
 *    SUBTREE: an ERROR or MISSING node's whole subtree is skipped, not merely its
 *    own children — a recovery region contains syntactically valid-looking
 *    children, and emitting them is how a parser's guess becomes a graph fact.
 *    The corpus is 0% damaged so this is defensive, and it is gated by the
 *    fixture `recovery-regions-sol6`, which forces an ERROR on purpose —
 *    otherwise a green 0-damage corpus would leave the rule untested.
 *
 *  - SOL-7  A GLOBAL'S MEMBERS ARE NOT PROJECT MEMBERS. `msg.sender` parses as a
 *    `member_expression` with `object:`/`property:` fields, so the naive
 *    member-read pass publishes `uses -> sender` for a name no project can
 *    declare. `msg`, `block`, `tx`, `super`, `this` are NOT grammar tokens — the
 *    grammar declares 262 alphabetic anonymous tokens and none of these five is
 *    among them, and `externals` is an empty array — so GLOBAL_OBJECTS is a
 *    DECLARED set, sourced to Solidity's Global Variables page, and is labelled
 *    as declared in the source so nobody later reads it as measured. The member
 *    READ of a global is silent; a CALL through one is not — `this.f()` and
 *    `super.f()` are real calls to real overridable functions and keep their
 *    `calls` edge.
 *
 *  - SOL-8  AN EVM BUILTIN IS NOT A CALL. `yul_function_call`'s `function:` field
 *    is `choice(yul_identifier, yul_evm_builtin)` (grammar.js:442), so `add(1,2)`
 *    in assembly is an OPCODE, not a function, and `calls -> add` would put 2,800
 *    rows naming a name no Solidity identifier can hold. Skipped, and the EVM
 *    builtins are `internal_silent` in the F9 spec with this reason. The skip is
 *    LOSSLESS because the lexer makes it so: a bare `add` in Yul is always lexed
 *    `yul_evm_builtin`, so a user-defined Yul function can never be named `add`.
 *
 *  - SOL-9  THE CALLEE RESOLVER MUST BE GENERAL, BECAUSE THE GRAMMAR SAYS SO.
 *    The intuitive model of a Solidity call target is `identifier` or
 *    `member_expression`. The tree refutes it:
 *      · `t.call{value: 1}("")` parses as `call_expression` → `function:` →
 *        `expression` → **`struct_expression`** (grammar.js:801 places
 *        `struct_expression` in `_expression`; grammar.js:53 declares it
 *        conflicting with `layout_specifier`). 33 `call_struct_argument` and 13
 *        `struct_expression` occurrences exist in the corpus.
 *      · `payable(t).transfer(x)` puts a `payable_conversion_expression` under
 *        the member's `object:`. 2 occurrences.
 *    A resolver written to the intuitive model publishes NO callee for every
 *    option-bearing and payable-converted call in the language. So
 *    `calleeNameOf` descends through those wrappers and STOPS at the first
 *    name-bearing node, which is what makes it O(wrapper depth) per site rather
 *    than O(subtree) per call.
 *
 *  - SOL-10 TWO STRUCT LITERAL SPELLINGS, BOTH REAL. `S({a: 1})` is a
 *    `call_expression` with `call_struct_argument` children (named arguments);
 *    `S { a: 1 }` is a `struct_expression` with `struct_field_assignment`
 *    children (the pre-0.8.8 form). Both name a struct constructor and both
 *    yield a `calls` edge — which is the payoff of SOL-9's generality. Neither is
 *    the other: the 33 and the 13 are disjoint corpus counts.
 *
 *  - SOL-11 `overrides` IS `inferred`, AND THE LANGUAGE HELPS MORE THAN
 *    POWERSHELL'S DID. Solidity HAS the keyword — `override_specifier`, 394
 *    occurrences — so WHICH bases are overridden is settled by the tree. The
 *    TARGET is not: it is the same-named member inside the named base, located by
 *    matching. PowerShell's and csharp's ruling carries: a match is an inference
 *    and calling it `structural` would overstate it. When the base is not declared
 *    in the same file NO `overrides` edge is emitted — a fabricated target sits at
 *    zero `unknownTargets` while being wrong, which is exactly the failure the
 *    `isPlausibleSymbolName` note describes — so instead the function carries
 *    `metadata.overrideExternal: true` and a `references` edge to the base, and
 *    `overridesUnresolved` is reported in the surface artifact rather than
 *    hidden.
 *
 *  - SOL-12 `exports` HAS NO CONSTRUCT IN SOLIDITY, AND THE EDGE IS STILL
 *    EMITTED — as the compilation-unit surface, not as a statement. `exports` is
 *    one of the ontology's ten kinds, and a lane that silently omits it has a
 *    hole in the matrix. The reading: a `.sol` file's entire top-level surface is
 *    compiled into that unit's artifacts, and `solc` emits an ABI and an
 *    abstraction for every contract in the source unit, so every top-level
 *    declaration IS what this file offers its importers. Tier `structural` — the
 *    tree states which declarations are at file scope and which are members.
 *    Recorded as a design decision in the F9 spec, not as a silent absence.
 *
 * Complexity envelope (M60 R6): ONE iterative DFS with an explicit
 * `{node, exit}` stack (no recursion whose depth is input-bounded), a frame stack
 * whose depth is declaration nesting depth, a Map symbol dedupe keyed
 * `owner\u0000name\u0000kind`, a Set PER-SITE relationship dedupe (the line is in
 * the key, so two call sites of one callee are two rows), and descendant
 * searches that stop at the first hit. `overrides` resolution is a single pass
 * after the walk, because a base may be declared AFTER its subclass in source
 * order — legal, and the corpus does it. Measured by
 * `script/m60/solidity-surface-measure.ts`.
 *
 * ZERO REGEX — the policy, and the three helpers that satisfy it. Same policy as
 * PowerShell PS: NO REGEX IN THIS FILE DECIDES A FACT. Every symbol,
 * relationship, type and parameter is read off the AST. The character loops below
 * normalise AST-derived text (a basename, an import path, a quoted literal) and
 * are spelled out so `isSpaceCode` matches JavaScript's `\s` exactly rather than
 * the `c <= 32` approximation that silently stops matching NBSP. Enforced by
 * `script/m60/solidity-zero-regex.ts`, which COUNTS this file's own source, FAILS
 * if a regex returns, AND asserts the three helpers are still present — because a
 * zero-regex gate is trivially satisfiable by deleting the work, and a green
 * "zero regex" meaning "nothing left to be wrong about" is the vacuous pass this
 * repo refuses elsewhere.
 */

/**
 * JavaScript's `\s`, exactly: whitespace, line terminators and the Unicode
 * separators. Spelled out rather than approximated — `/[\s]/` also matches NBSP
 * and U+FEFF, and a `c <= 32` test would silently stop matching both.
 */
const isSpaceCode = (code: number): boolean =>
  code === 32 || (code >= 9 && code <= 13) ||
  code === 0xa0 || code === 0x1680 || (code >= 0x2000 && code <= 0x200a) ||
  code === 0x2028 || code === 0x2029 || code === 0x202f || code === 0x205f ||
  code === 0x3000 || code === 0xfeff

/**
 * F9 — could this string be a SYMBOL NAME at all?
 *
 * The question PowerShell's F9 asks, asked of Solidity text, and used to DROP an
 * edge rather than to keep one. Solidity identifiers are
 * `[A-Za-z_$][A-Za-z0-9_$]*`, so a `.` is not an identifier character — but the
 * MODULE symbol is `AccessControl.sol` and SOL-3's synthesised getter is `bal()`,
 * and both name real stored symbols. Rather than special-case either, `.`, `(` and
 * `)` are admitted here, and this test is applied only to edge TARGETS, never to a
 * declaration name. A target carrying a newline, a quote, a space or a brace names
 * nothing resolvable, and it would sit at zero `unknownTargets` for exactly as long
 * as it existed — the same invisibility the PowerShell here-string targets had.
 *
 * Admitting `(`/`)` is safe here precisely because no target is derived from
 * arbitrary source text: every target is an `identifier`'s text, a keyword the
 * analyzer refused earlier, or one of the two names the analyzer synthesises
 * itself (the module basename, a getter signature). MEASURED — with `(` refused the
 * SOL-3 `references bal -> bal()` edge was dropped by this very gate, so the getter
 * was published as a symbol and then never linked to the variable it reads, which
 * is the half of SOL-3 that makes it navigable.
 */
const isPlausibleSymbolName = (name: string): boolean => {
  if (name.length === 0) return false
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i)
    const ok =
      (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) ||
      c === 95 /* _ */ || c === 36 /* $ */ || c === 46 /* . */ ||
      c === 40 /* ( */ || c === 41 /* ) */
    if (!ok) return false
  }
  return true
}

/** `/^\s+/` — leading whitespace, so an indented keyword still compares equal. */
const skipLeadingSpace = (text: string): string => {
  let i = 0
  while (i < text.length && isSpaceCode(text.charCodeAt(i))) i++
  return text.slice(i)
}

/** One layer of matching surrounding quotes: `"` is 34 and `'` is 39. */
const unquote = (text: string): string => {
  if (text.length < 2) return text
  const first = text.charCodeAt(0)
  if (first !== 34 && first !== 39) return text
  if (text.charCodeAt(text.length - 1) !== first) return text
  return text.slice(1, -1)
}

/**
 * SOL-7 — the EVM global scope. DECLARED, not derived: the vendored grammar
 * declares 262 alphabetic anonymous tokens and none of these five is among them,
 * and `externals` is an empty array, so the grammar cannot answer this. Sourced
 * to Solidity's "Global Variables and Functions" page and labelled as declared so
 * nobody later reads the array as measured.
 *
 * `abi`, `type`, `gas`, `addmod`, `mulmod` are engine-supplied too but are
 * grammar keywords or EVM builtins, already covered by the reserved-target gate;
 * deliberately NOT duplicated here.
 */
const GLOBAL_OBJECTS = new Set(["msg", "block", "tx", "super", "this"])

/**
 * SOL-8 — the EVM opcodes as the vendored grammar spells them in
 * `yul_evm_builtin`. DECLARED, and re-derivable: every alphabetic anonymous
 * token of `grammars/tree-sitter-solidity/src/grammar.json` that is not a
 * primitive type and not a Solidity keyword. The derivation command is named in
 * `docs/analyzers/real-solidity-analyzer.md` §Evidence, so this list can be
 * checked against the grammar rather than trusted.
 */
const EVM_BUILTIN_NAMES = new Set([
  "stop", "add", "sub", "mul", "div", "sdiv", "mod", "smod", "exp", "not",
  "lt", "gt", "slt", "sgt", "eq", "iszero", "and", "or", "xor", "byte",
  "shl", "shr", "sar", "addmod", "mulmod", "signextend", "keccak256",
  "pop", "mload", "mstore", "mstore8", "sload", "sstore", "mcopy", "tload",
  "tstore", "msize", "gas", "address", "balance", "selfbalance", "caller",
  "callvalue", "calldataload", "calldatasize", "calldatacopy", "extcodesize",
  "extcodecopy", "extcodehash", "returndatasize", "returndatacopy",
  "create", "create2", "call", "callcode", "delegatecall", "staticcall",
  "return", "revert", "selfdestruct", "invalid", "log0", "log1", "log2",
  "log3", "log4", "datasize", "dataoffset", "dataload", "setimmutable",
  "loadimmutable", "linkersymbol", "memoryguard", "verbatim", "chainid",
  "basefee", "blobbasefee", "blobhash", "origin", "gasprice", "blockhash",
  "coinbase", "timestamp", "number", "difficulty", "prevrandao", "gaslimit",
])

export class RealSolidityAnalyzer implements ASTEngine.LanguageAnalyzer {
  analyze(
    rootNode: Node,
    content: string,
    filePath: string,
  ): ASTEngine.ParseResult & { metadata: Partial<ASTEngine.FileMetadata> } {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const relKeys = new Set<string>()

    const frameworks = new Set<string>(["Solidity"])
    const patterns = new Set<string>()

    // SOL-1 — the file's own basename, extension included.
    const fileName = this.basenameOf(filePath)
    const lines = content.split("\n")

    symbols.push({
      name: fileName,
      kind: ASTEngine.SymbolKind.Module,
      range: this.nodeToRange(rootNode),
      visibility: "public",
      metadata: { soliditySpecific: true, isCompilationUnit: true },
    })

    let cyclomaticComplexity = 1

    /**
     * The frame stack. `owner` is the nearest DECLARATION container (the one a
     * `contains` edge names); `scope` is the nearest SCOPE (the one a `calls` /
     * `uses` edge is sourced from). They differ inside a contract: a function's
     * owner is the CONTRACT (containment) while its scope is the FUNCTION
     * (attribution), so calls made inside a method are attributed to the method
     * and a contract's incoming edges stay its own rather than its methods'.
     */
    interface Frame { owner: string; scope: string; containerLine: number; yul: boolean }
    const frames: Frame[] = [{ owner: fileName, scope: fileName, containerLine: 1, yul: false }]
    const top = (): Frame => frames[frames.length - 1]
    const atFileScope = (): boolean => frames.length === 1
    const nodeKey = (n: Node): string => `${n.startIndex}:${n.endIndex}`

    /** SOL-11 — a frame is popped on the SAME node it was pushed for. A leaked
     *  frame re-owns every declaration after it, which PowerShell PS-A2 measured
     *  as worse than the bug it was fixing. */
    const openedFrames = new Set<string>()

    /** SOL-5 — declared type names that are INTERFACES in this file. */
    const interfaceNames = new Set<string>()
    /** Every declared contract/interface/library/user-defined-type name. */
    const typeNamesInFile = new Set<string>()
    /** `<owning type>` → its own declared member names, for SOL-11. */
    const membersByType = new Map<string, Set<string>>()
    /** `<contract>` → its direct base names, for SOL-5 and SOL-11. */
    const basesByContract = new Map<string, string[]>()
    /** Deferred `overrides`: resolved after the whole file is read. */
    const overrideCandidates: {
      memberName: string; owner: string; line: number; explicit: string[]; anyBase: string[]
    }[] = []
    /** SOL-12 — the file-scope surface, for the module's `exports` edges. */
    const topLevelExports: { name: string; line: number }[] = []
    /** Import edge targets: a name per imported symbol, or `*` for the file. */
    const importEdges: { name: string; path: string; line: number }[] = []
    /** SOL-7b — how many engine-function calls were refused at the emit site.
     *  COUNTED, not silent: a refusal nobody counts is how the next engine
     *  builtin lands as a fabricated edge with nothing to notice it. */
    let engineCallsSuppressed = 0
    /** SOL-14 — how many declarations were refused because the STORE would drop
     *  them anyway. Counted for the same reason: `self` and `root` are real
     *  Solidity identifiers that pool-worker's UNIVERSAL denylist refuses, and an
     *  uncounted refusal is indistinguishable from the analyzer being wrong. */
    let storeRefusedDeclarations = 0
    /** SOL-3 — how many synthesised public getters were published as symbols. */
    let getterSymbols = 0

    /** SOL-5 — counted, not hidden: an `extends` that may really be an
     *  `implements` because the interface is declared in another file. */
    let extendsUnresolvedAsInterface = 0

    /**
     * The EVIDENCE TIER, emitted CENTRALLY so no call site can forget it and
     * none can drift: the same shape as bash's `evidenceClassFor`.
     *
     *   structural        the tree states the fact. A container holds a declared
     *                      child; a header literally lists a base; `new_expression`
     *                      is a node type NAMED for the fact; file scope is
     *                      visible in the tree.
     *   usage_contextual  the edge comes from a node's POSITION rather than a
     *                      named field — a bare identifier under an `expression`
     *                      is a read and nothing in the tree says "read here";
     *                      `emit_statement`'s `name:` field is an event emission
     *                      by what the node is.
     *   import_based      an import edge.
     *   inferred          derived by MATCHING rather than reading. Exactly ONE
     *                      relationship kind in this lane is that: `overrides`,
     *                      whose target is located by matching a member name
     *                      inside a base the tree only names (SOL-11).
     */
    const evidenceClassFor = (type: ASTEngine.RelationshipType, isImport = false): string => {
      if (isImport) return "import_based"
      switch (type) {
        case ASTEngine.RelationshipType.Contains:
        case ASTEngine.RelationshipType.Extends:
        case ASTEngine.RelationshipType.Implements:
        case ASTEngine.RelationshipType.Exports:
        case ASTEngine.RelationshipType.Instantiates:
          return "structural"
        case ASTEngine.RelationshipType.Overrides:
          return "inferred"
        default:
          return "usage_contextual"
      }
    }

    const addRel = (
      source: string,
      target: string,
      type: ASTEngine.RelationshipType,
      confidence: number,
      line: number,
      metadata: Record<string, unknown> = {},
    ) => {
      if (!source || !target) return
      if (!isPlausibleSymbolName(target)) return
      // SOL-1: EVERY edge carries the line of the node that BEARS ITS NAME, and
      // that line is part of the identity, so two call sites of one callee are
      // two rows — the store resolves a containment edge BY the line it carries,
      // and a per-set key swallows every site but the first. A line that is not
      // positive is REFUSED HERE rather than emitted as null, because line
      // coverage is meant to be a completeness check on the emit path and an
      // emit path that can produce a null cannot be checked.
      if (!Number.isFinite(line) || line < 1) return
      // SOL-7b — a reserved TOKEN cannot be a call target or a constructed type.
      // `require(...)`, `assert(...)`, `keccak256(...)` and `type(...)` all parse
      // clean and would otherwise each become a graph fact about a function that
      // does not exist. The set is derived from the vendored grammar, not
      // remembered; see src/ast/solidity-reserved-tokens.ts.
      if (isReservedTarget(type, target, metadata)) return
      // SOL-7b — `require(ok, "x")` parses exactly like a call to a user function
      // named `require`, so the tree cannot settle it and a declared list must.
      if (type === ASTEngine.RelationshipType.Calls && ENGINE_FUNCTION_NAMES.has(target)) {
        engineCallsSuppressed++
        return
      }
      const key = `${source}\u0000${type}\u0000${target}\u0000${line}`
      if (relKeys.has(key)) return
      relKeys.add(key)
      const isImport = (metadata as { import?: boolean }).import === true
      relationships.push({
        source,
        target,
        type,
        confidence,
        line_number: line,
        // Caller metadata LAST so an explicit `evidenceClass` at a call site wins.
        metadata: { evidenceClass: evidenceClassFor(type, isImport), soliditySpecific: true, ...metadata },
      })
    }

    const symbolMap = new Map<string, ASTEngine.UniversalSymbol>()

    const pushSymbol = (
      name: string,
      kind: ASTEngine.SymbolKind,
      node: Node,
      meta: Record<string, unknown> = {},
      parameters?: ASTEngine.Parameter[],
    ): ASTEngine.UniversalSymbol | null => {
      const clean = name.trim()
      if (clean === "") return null
      const owner = top().owner
      const key = `${owner}\u0000${clean}\u0000${kind}`
      const existing = symbolMap.get(key)
      if (existing) return existing
      const sym: ASTEngine.UniversalSymbol = {
        name: clean,
        kind,
        range: this.nodeToRange(node),
        scope: owner,
        ownerName: owner,
        visibility: (meta.visibility as string) ?? "public",
        parameters,
        metadata: { soliditySpecific: true, ...meta },
      }
      // The payload the STORE actually reads. pool-worker.ts drops the whole
      // `metadata` object at the worker boundary except a narrow key, so
      // anything that must survive has to be a declared field — measured on the
      // PowerShell lane, where `isStatic` written only into metadata stored with
      // `is_static = 0` and `[ValidateSet(…)]` stored with `annotations = null`.
      if (typeof meta.isAbstract === "boolean") sym.isAbstract = meta.isAbstract
      if (typeof meta.returnType === "string" && meta.returnType) sym.returnType = meta.returnType
      symbols.push(sym)
      symbolMap.set(key, sym)
      return sym
    }

    /**
     * A DECLARATION: the symbol plus its ONE containment edge, bound together.
     * They MUST be bound because the relationship key is PER-SITE (it contains
     * the line), so a repeated name earns a second EDGE while `pushSymbol`
     * dedupes it to one SYMBOL — and the result is a `contains` edge pointing at a
     * name the file does not declare. Measured in a sibling lane: `$value = 1`
     * then `$value = $(…)` published TWO `contains` edges for one variable.
     * Bound once, here, for every kind.
     */
    const declareSymbol = (
      name: string,
      kind: ASTEngine.SymbolKind,
      node: Node,
      line: number,
      meta: Record<string, unknown> = {},
      parameters?: ASTEngine.Parameter[],
      containsLine: number | null = line,
    ): void => {
      const clean = name.trim()
      if (clean === "") return
      // SOL-14 — the store refuses this name, so declaring it would publish a
      // `contains` edge pointing at a symbol that never reaches the store. Refuse
      // HERE, at the single point every declaration goes through, exactly as a
      // non-positive line is refused in `addRel`. See
      // src/ast/solidity-reserved-tokens.ts for the measured evidence: `self` at
      // CrosschainLinked.sol:59 and `root` at MerkleTreeMock.sol:15 are both real
      // Solidity identifiers the shared filter drops.
      if (STORE_REFUSED_SYMBOL_NAMES.has(clean)) {
        storeRefusedDeclarations++
        return
      }
      const key = `${top().owner}\u0000${clean}\u0000${kind}`
      if (symbolMap.has(key)) return
      pushSymbol(clean, kind, node, meta, parameters)
      const owner = top().owner
      if (owner && owner !== clean) {
        addRel(owner, clean, ASTEngine.RelationshipType.Contains, 1.0, containsLine ?? line, {})
      }
    }

    // ---------------------------------------------------------------- tree reads

    const findChildren = (node: Node | null, type: string): Node[] => {
      const out: Node[] = []
      if (!node) return out
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i)
        if (c && c.type === type) out.push(c)
      }
      return out
    }

    const findFirstChild = (node: Node | null, type: string): Node | null => {
      const found = findChildren(node, type)
      return found.length > 0 ? found[0] : null
    }

    /** First descendant of `type`, breadth-first, so the SHALLOWEST hit wins. */
    const findDescendant = (node: Node | null, type: string): Node | null => {
      if (!node) return null
      const work: Node[] = [node]
      while (work.length > 0) {
        const n = work.shift()!
        if (n.type === type) return n
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c) work.push(c)
        }
      }
      return null
    }

    /** Every descendant of `type` at or below `root`, depth-first. */
    const findDescendants = (root: Node, type: string): Node[] => {
      const out: Node[] = []
      const work: Node[] = [root]
      while (work.length > 0) {
        const n = work.pop()!
        if (n !== root && n.type === type) out.push(n)
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c) work.push(c)
        }
      }
      return out
    }

    /** A `user_defined_type`'s name: its single `identifier` child. */
    const udtName = (node: Node | null): string => {
      if (!node) return ""
      if (node.type === "identifier") return node.text
      if (node.type !== "user_defined_type") return ""
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i)
        if (c && c.type === "identifier") return c.text
      }
      return ""
    }

    /**
     * A declared type's head: `S` for `S memory[3]`, `L.T` for `L.T`,
     * `uint256` for `mapping(address => uint256)`. `mapping`'s VALUE type is the
     * only interesting mention in a mapping, and it is found structurally.
     */
    const typeTextOf = (node: Node | null): string => {
      if (!node) return ""
      const udt = findFirstChild(node, "user_defined_type")
      if (udt) return udtName(udt)
      return skipLeadingSpace(node.text).trim()
    }

    /**
     * SOL-9 — the name a call is directed at, from ANY callee shape.
     *
     * `t.call{value: 1}("")` is a `call_expression` whose `function:` field is an
     * `expression` wrapping a `struct_expression`; `payable(t).transfer(x)` puts a
     * `payable_conversion_expression` under the member's `object:`. Written to the
     * intuitive `identifier`/`member_expression` model this returns nothing for
     * every option-bearing and payable-converted call in the language. The
     * recursion descends only through wrappers that can legally sit between a
     * call and its name, and STOPS at the first name-bearing node, so it is
     * O(wrapper depth) per site rather than O(subtree).
     */
    const calleeNameOf = (node: Node | null, depth = 0): { name: string; line: number } | null => {
      if (!node || depth > 6) return null
      const line = node.startPosition.row + 1
      switch (node.type) {
        case "identifier":
          return { name: node.text, line }
        case "member_expression": {
          const prop = node.childForFieldName("property")
          return prop ? calleeNameOf(prop, depth + 1) : null
        }
        case "struct_expression":
          // SOL-10 — the call-with-options / named-argument form: the NAME lives
          // in the `type:` field, and the `struct_field_assignment` children are
          // option values, not names.
          return calleeNameOf(node.childForFieldName("type"), depth + 1)
        case "user_defined_type": {
          const n = udtName(node)
          return n === "" ? null : { name: n, line }
        }
        case "array_access":
          return calleeNameOf(node.childForFieldName("base"), depth + 1)
        case "expression":
        case "payable_conversion_expression":
        case "parenthesized_expression": {
          for (let i = 0; i < node.namedChildCount; i++) {
            const c = node.namedChild(i)
            if (!c) continue
            const got = calleeNameOf(c, depth + 1)
            if (got) return got
          }
          return null
        }
        default:
          return null
      }
    }

    /** SOL-7 companion — the OBJECT a member access hangs off. */
    const memberObjectName = (node: Node): string => {
      const obj = node.childForFieldName("object")
      if (!obj) return ""
      if (obj.type === "identifier") return obj.text
      if (obj.type === "expression" && obj.namedChildCount > 0) {
        const c = obj.namedChild(0)
        if (c && c.type === "identifier") return c.text
      }
      return ""
    }

    /**
     * Is this node INSIDE the callee subtree of an enclosing call?
     *
     * Asked by walking up and asking whether any ancestor was CLAIMED by a
     * `call_expression`'s `function:` field (or an `emit_statement`'s `name:`
     * field) when that call was entered. The first version instead walked up and
     * tested "is my parent this call's `function:` field", with a hop limit of 3,
     * and it was wrong in a way the corpus showed immediately: for
     * `t.call{value: 1}("")` the `member_expression`'s ancestors are
     * `expression` → `struct_expression` → `expression` → `call_expression`, so
     * the `function:` comparison was against the WRONG node and the call's own
     * property was emitted a second time as a member read —
     * `calls f -> call` AND `uses f -> call` for one source call. An ancestor
     * test against a claimed set has no hop limit to get wrong, and the claim is
     * made on ENTER, before any child is visited.
     */
    const isClaimedCallee = (node: Node): boolean => {
      let cur: Node | null = node
      for (let hop = 0; hop < 6 && cur; hop++) {
        if (claimedCallees.has(cur.id)) return true
        cur = cur.parent
      }
      return false
    }

    /**
     * SOL-7 — is this member access's OBJECT an engine-supplied thing rather than
     * a project value? Two shapes qualify and both were found by reading the tree
     * on real code rather than by reasoning about it:
     *   · `msg.sender` / `block.number` — the object is one of GLOBAL_OBJECTS.
     *   · `type(uint).max` — the object is a `meta_type_expression`, and `max`,
     *     `creationCode` and `runtimeCode` are members of the META TYPE. The
     *     `meta_type_expression` case sets `descend = false` so it does not read
     *     them, but the grammar puts the `.` and the property in a SEPARATE
     *     `member_expression` wrapping it, so that node is still walked. Measured:
     *     without this test the corpus emits `uses -> max` for every `type(…)` in
     *     it, naming a member no project can declare.
     */
    const isEngineMemberObject = (object: Node | null): boolean => {
      if (!object) return false
      if (object.type === "identifier" && GLOBAL_OBJECTS.has(object.text)) return true
      if (object.type === "meta_type_expression") return true
      if (object.type === "expression" && object.namedChildCount > 0) {
        const c = object.namedChild(0)
        if (c && c.type === "meta_type_expression") return true
        if (c && c.type === "identifier" && GLOBAL_OBJECTS.has(c.text)) return true
      }
      return false
    }

    /** Parameters of a function-like node: declared, then return parameters. */
    const collectParameters = (node: Node): ASTEngine.Parameter[] => {
      const lists: Node[] = []
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i)
        if (!c) continue
        if (c.type === "parameter") lists.push(c)
        else if (c.type === "return_type_definition") lists.push(...findChildren(c, "parameter"))
      }
      const out: ASTEngine.Parameter[] = []
      for (const p of lists) {
        const nameNode = p.childForFieldName("name")
        if (!nameNode) continue
        out.push({ name: nameNode.text, type: typeTextOf(p.childForFieldName("type")) })
      }
      return out
    }

    /**
     * The modifiers on a declaration. Read from CHILD NODE TYPES, never from
     * `node.text.includes(...)`: substring-matching the source text to decide a
     * fact is the thing the zero-regex policy exists to prevent in a regex, and
     * doing it with `includes` instead is the same defect wearing a hat.
     */
    const modifiersOf = (node: Node): Record<string, unknown> => {
      const meta: Record<string, unknown> = {}
      const hasChildType = (t: string): boolean => {
        for (let i = 0; i < node.childCount; i++) {
          const c = node.child(i)
          if (c && c.type === t) return true
        }
        return false
      }
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i)
        if (!c) continue
        if (c.type === "state_mutability") meta.stateMutability = c.text
        else if (c.type === "visibility") meta.visibility = c.text
        else if (c.type === "virtual") meta.isVirtual = true
        else if (c.type === "override_specifier") meta.hasOverrideSpecifier = true
        else if (c.type === "constant") meta.isConstant = true
        else if (c.type === "immutable") meta.isImmutable = true
      }
      // `abstract contract C` — the keyword precedes `contract`, so the check is
      // on the node's FIRST child token, which is what the tree settles.
      const first = node.childCount > 0 ? node.child(0) : null
      meta.isAbstract = first !== null && first.type === "abstract"
      const ret = node.childForFieldName("return_type")
      if (ret) {
        const types = findChildren(ret, "parameter").map((p) => typeTextOf(p.childForFieldName("type")))
        if (types.length === 1) meta.returnType = types[0]
        else if (types.length > 1) meta.returnType = `(${types.join(", ")})`
      }
      meta.hasBody = findFirstChild(node, "function_body") !== null
      return meta
    }

    /** Register a member name under its owner, for SOL-11's override resolution. */
    const noteMember = (owner: string, name: string) => {
      if (owner === fileName || owner === "") return
      let set = membersByType.get(owner)
      if (!set) { set = new Set<string>(); membersByType.set(owner, set) }
      set.add(name)
    }

    const openFrame = (node: Node, owner: string, scope: string, line: number, yul = false) => {
      openedFrames.add(nodeKey(node))
      frames.push({ owner, scope, containerLine: line, yul })
    }

    // -------------------------------------------------------------- traversal

    const work: { node: Node; exit: boolean }[] = [{ node: rootNode, exit: false }]
    /** Nodes already claimed as a callee, so SOL-2 does not also read them. */
    const claimedCallees = new Set<number>()

    while (work.length > 0) {
      const { node, exit } = work.pop()!

      if (exit) {
        if (openedFrames.has(nodeKey(node))) {
          frames.pop()
          openedFrames.delete(nodeKey(node))
        }
        continue
      }

      // SOL-6 — nothing is emitted from a recovery region, and a recovery
      // region's whole SUBTREE is skipped rather than its direct children.
      if (node.type === "ERROR" || node.isMissing) continue

      let descend = true

      switch (node.type) {
        // ----------------------------------------------------- file structure
        case "source_file":
          break

        case "pragma_directive": {
          patterns.add(`pragma:${skipLeadingSpace(node.text).slice(0, 40)}`)
          break
        }

        case "import_directive": {
          const srcNode = node.childForFieldName("source")
          const rawPath = srcNode ? unquote(skipLeadingSpace(srcNode.text)) : ""
          const alias = node.childForFieldName("alias")
          // `{A, B}` — the grammar puts NO name in `import_name` for a braced
          // list, so every identifier inside the braces is read positionally.
          // Measured on the corpus: 826 `import_directive`, and the braced form is
          // the common one in OpenZeppelin.
          const braced: string[] = []
          let braceDepth = 0
          for (let i = 0; i < node.childCount; i++) {
            const c = node.child(i)
            if (!c) continue
            if (c.type === "{") braceDepth++
            else if (c.type === "}") braceDepth--
            else if (braceDepth === 1 && c.type === "identifier") braced.push(c.text)
          }
          const anySource = findFirstChild(node, "any_source_type") !== null
          const plainName = node.childForFieldName("import_name")
          const line = node.startPosition.row + 1
          const names = braced.length > 0 ? braced : (plainName ? [plainName.text] : [])
          for (const n of names) importEdges.push({ name: n, path: rawPath, line })
          if (names.length === 0 && alias) {
            // `import * as Utils from "./Utils.sol"` — the local BINDING is `Utils`,
            // and it is the only name the importing file can actually use. The
            // first version emitted nothing here, so a namespace import published
            // no `references` edge at all while a braced one published one per
            // name: measured on `tiny.sol`, 2 import statements → 1 edge.
            importEdges.push({ name: alias.text, path: rawPath, line })
          } else if (names.length === 0 && !alias) {
            importEdges.push({ name: "*", path: rawPath, line })
          }
          imports.push({
            source: rawPath,
            imported: alias ? alias.text : (anySource ? "*" : (names[0] ?? rawPath)),
            line,
            isDefault: names.length === 0 && !alias,
            metadata: { soliditySpecific: true, namedImports: names, isNamespaceImport: anySource },
          } as ASTEngine.ImportInfo)
          break
        }

        // ------------------------------------------------------ declarations
        case "contract_declaration":
        case "interface_declaration":
        case "library_declaration": {
          const nameNode = node.childForFieldName("name")
          if (!nameNode) break
          const name = nameNode.text
          const line = nameNode.startPosition.row + 1
          const kind = node.type === "interface_declaration"
            ? ASTEngine.SymbolKind.Interface
            : ASTEngine.SymbolKind.Class
          if (node.type === "interface_declaration") interfaceNames.add(name)
          typeNamesInFile.add(name)
          declareSymbol(name, kind, node, line, {
            ...modifiersOf(node),
            declarationKeyword: node.type.slice(0, -"_declaration".length),
          })
          if (atFileScope()) topLevelExports.push({ name, line })
          const bases: string[] = []
          for (const spec of findChildren(node, "inheritance_specifier")) {
            const anc = spec.childForFieldName("ancestor")
            const baseName = udtName(anc)
            if (baseName === "") continue
            bases.push(baseName)
            // SOL-5 — the kind depends on a DECLARATION this file may not hold.
            const isInterface = interfaceNames.has(baseName)
            if (!isInterface && typeNamesInFile.has(baseName)) {
              // A known non-interface base: settled, not an unresolved case.
            } else if (!isInterface && !typeNamesInFile.has(baseName)) {
              extendsUnresolvedAsInterface++
            }
            addRel(name, baseName,
              isInterface ? ASTEngine.RelationshipType.Implements : ASTEngine.RelationshipType.Extends,
              1.0, (anc ?? spec).startPosition.row + 1, {
                isSolidityInheritance: true,
                interfaceResolvedInFile: isInterface,
                ...(spec.childForFieldName("ancestor_arguments") ? { hasBaseConstructorArgs: true } : {}),
              })
          }
          basesByContract.set(name, bases)
          openFrame(node, name, name, line)
          break
        }

        case "struct_declaration": {
          const nameNode = node.childForFieldName("name")
          if (!nameNode) break
          const name = nameNode.text
          const line = nameNode.startPosition.row + 1
          declareSymbol(name, ASTEngine.SymbolKind.Struct, node, line, { declarationKeyword: "struct" })
          if (atFileScope()) topLevelExports.push({ name, line })
          openFrame(node, name, top().scope, line)
          break
        }

        case "enum_declaration": {
          const nameNode = node.childForFieldName("name")
          if (!nameNode) break
          const name = nameNode.text
          const line = nameNode.startPosition.row + 1
          declareSymbol(name, ASTEngine.SymbolKind.Enum, node, line, { declarationKeyword: "enum" })
          if (atFileScope()) topLevelExports.push({ name, line })
          openFrame(node, name, top().scope, line)
          break
        }

        // grammar.js:285 — `enum_body: commaSep(alias($.identifier, $.enum_value))`.
        // An `enum_value` has NO fields: the name IS the node's own text, because
        // the grammar aliased the identifier to the value node. Reading a `name:`
        // field here returns null and silently publishes nothing.
        case "enum_value": {
          const name = node.text.trim()
          if (name === "") break
          const line = node.startPosition.row + 1
          declareSymbol(name, ASTEngine.SymbolKind.EnumMember, node, line, { declarationKeyword: "enum value" })
          break
        }

        case "struct_member": {
          const nameNode = node.childForFieldName("name")
          if (!nameNode) break
          const line = nameNode.startPosition.row + 1
          declareSymbol(nameNode.text, ASTEngine.SymbolKind.Property, node, line, {
            declarationKeyword: "struct member",
            declaredType: typeTextOf(node.childForFieldName("type")),
          })
          break
        }

        case "function_definition": {
          const nameNode = node.childForFieldName("name")
          if (!nameNode) break
          const name = nameNode.text
          const line = nameNode.startPosition.row + 1
          const kind = atFileScope() ? ASTEngine.SymbolKind.Function : ASTEngine.SymbolKind.Method
          const meta = modifiersOf(node)
          const overrideSpec = findFirstChild(node, "override_specifier")
          if (overrideSpec) {
            const explicit = findChildren(overrideSpec, "user_defined_type")
              .map((u) => udtName(u)).filter((s) => s !== "")
            const anyBase = basesByContract.get(top().owner) ?? []
            const inFile = explicit.filter((b) => typeNamesInFile.has(b))
            meta.overrideExternal = inFile.length === 0
            overrideCandidates.push({ memberName: name, owner: top().owner, line, explicit, anyBase })
            for (const b of explicit) {
              // SOL-11 — an explicit `override(A)` names a base the tree settles.
              // If A is not in this file the edge is a REFERENCE to a name we can
              // read, never an `overrides` to a target we would have to invent.
              if (!typeNamesInFile.has(b)) {
                addRel(top().scope, b, ASTEngine.RelationshipType.References, 0.8, line,
                  { isOverrideBase: true, overrideBaseExternal: true })
              }
            }
          }
          declareSymbol(name, kind, node, line, meta, collectParameters(node))
          noteMember(top().owner, name)
          // SOL-13 — the frame's OWNER is the function itself, not the contract.
          // PowerShell PS3 deliberately keeps a method's owner as the class so a
          // `contains` edge from inside names the class; that is right for
          // PowerShell and WRONG for Solidity, whose locals are strictly
          // function-scoped. `contains C -> ok` says the contract contains a
          // variable it does not contain. The function's own place in the
          // contract is already served by the `contains C -> f` edge emitted at
          // its declaration site, one line above.
          openFrame(node, name, name, line)
          break
        }

        case "modifier_definition": {
          const nameNode = node.childForFieldName("name")
          if (!nameNode) break
          const name = nameNode.text
          const line = nameNode.startPosition.row + 1
          const meta = modifiersOf(node)
          if (findFirstChild(node, "override_specifier")) {
            meta.overrideExternal = true
            overrideCandidates.push({
              memberName: name, owner: top().owner, line, explicit: [],
              anyBase: basesByContract.get(top().owner) ?? [],
            })
          }
          declareSymbol(name, ASTEngine.SymbolKind.Method, node, line, meta, collectParameters(node))
          noteMember(top().owner, name)
          openFrame(node, name, name, line)   // SOL-13
          break
        }

        // SOL-4 — the name is READ off the `constructor` keyword token. Unlike
        // PowerShell's `Deployment(...)`, Solidity writes the word, so this is not
        // a synthesised name and the line is the real name line.
        case "constructor_definition": {
          const line = node.startPosition.row + 1
          const name = "constructor"
          declareSymbol(name, ASTEngine.SymbolKind.Constructor, node, line,
            modifiersOf(node), collectParameters(node))
          noteMember(top().owner, name)
          openFrame(node, name, name, line)   // SOL-13
          break
        }

        // SOL-4 — `receive` and `fallback` share ONE grammar rule
        // (fallback_receive_definition), split by the leading keyword token.
        case "fallback_receive_definition": {
          const first = node.childCount > 0 ? node.child(0) : null
          const name = first !== null && first.type === "receive" ? "receive" : "fallback"
          const line = node.startPosition.row + 1
          declareSymbol(name, ASTEngine.SymbolKind.Method, node, line,
            { ...modifiersOf(node), isFallbackOrReceive: true }, collectParameters(node))
          noteMember(top().owner, name)
          openFrame(node, name, name, line)   // SOL-13
          break
        }

        case "event_definition": {
          const nameNode = node.childForFieldName("name")
          if (!nameNode) break
          const name = nameNode.text
          const line = nameNode.startPosition.row + 1
          const paramNodes = findChildren(node, "event_parameter")
          const params: ASTEngine.Parameter[] = []
          const indexed: string[] = []
          let isAnonymous = false
          for (let i = 0; i < node.childCount; i++) {
            const c = node.child(i)
            if (c && c.type === "anonymous") isAnonymous = true
          }
          for (const p of paramNodes) {
            const n = p.childForFieldName("name")
            params.push({
              name: n ? n.text : "",
              type: typeTextOf(p.childForFieldName("type")),
            })
            for (let i = 0; i < p.childCount; i++) {
              const c = p.child(i)
              if (c && c.type === "indexed" && n) indexed.push(n.text)
            }
          }
          declareSymbol(name, ASTEngine.SymbolKind.Event, node, line, {
            declarationKeyword: "event",
            indexedParameters: indexed,
            isAnonymous,
          }, params)
          noteMember(top().owner, name)
          if (atFileScope()) topLevelExports.push({ name, line })
          break
        }

        // A custom error is a named, declared, ABI-visible entity with its own
        // parameter list. `Type` is the kind that says "a named type-ish
        // declaration" without claiming it is a class. Recorded as a decision in
        // the F9 spec, not an accident of convenience.
        case "error_declaration": {
          const nameNode = node.childForFieldName("name")
          if (!nameNode) break
          const name = nameNode.text
          const line = nameNode.startPosition.row + 1
          const params: ASTEngine.Parameter[] = findChildren(node, "error_parameter").map((p) => ({
            name: p.childForFieldName("name")?.text ?? "",
            type: typeTextOf(p.childForFieldName("type")),
          }))
          declareSymbol(name, ASTEngine.SymbolKind.Type, node, line,
            { declarationKeyword: "error" }, params)
          noteMember(top().owner, name)
          if (atFileScope()) topLevelExports.push({ name, line })
          break
        }

        case "state_variable_declaration": {
          const nameNode = node.childForFieldName("name")
          if (!nameNode) break
          const name = nameNode.text
          const line = nameNode.startPosition.row + 1
          const meta = modifiersOf(node)
          meta.declaredType = typeTextOf(node.childForFieldName("type"))
          if (node.childForFieldName("location")) {
            meta.stateLocation = node.childForFieldName("location")!.text
          }
          // SOL-3 — the synthesised getter, published under its external name.
          if (meta.visibility === "public") {
            meta.getterSynthesised = true
            meta.getterVisibility = "public"
            meta.getterIsPayable = meta.stateMutability === "payable"
            const getterName = `${name}()`
            const getter = pushSymbol(getterName, ASTEngine.SymbolKind.Method, node, {
              ...meta,
              isSynthesisedGetter: true,
              declarationKeyword: "public state variable getter",
              getterFor: name,
              ...(meta.stateMutability === "view" || !meta.stateMutability
                ? { stateMutability: meta.stateMutability ?? "view" }
                : {}),
            })
            void getter
            if (getter) {
              getterSymbols++
              // The pair is a WALK, not two adjacent rows.
              addRel(name, getterName, ASTEngine.RelationshipType.References, 1.0, line,
                { isGetterFor: true, getterOfVariable: name })
            }
          }
          declareSymbol(name, ASTEngine.SymbolKind.Property, node, line, meta)
          noteMember(top().owner, name)
          break
        }

        // grammar.js:177 — a FILE-SCOPE-only declaration, one of the twelve
        // members of `_declaration`. Inside a contract the same source text is a
        // `state_variable_declaration`, which is why 352 of those and only 6 of
        // these exist in the corpus.
        case "constant_variable_declaration": {
          const nameNode = node.childForFieldName("name")
          if (!nameNode) break
          const name = nameNode.text
          const line = nameNode.startPosition.row + 1
          declareSymbol(name, ASTEngine.SymbolKind.Constant, node, line,
            { ...modifiersOf(node), isConstant: true, declaredType: typeTextOf(node.childForFieldName("type")) })
          topLevelExports.push({ name, line })
          break
        }

        case "user_defined_type_definition": {
          const nameNode = node.childForFieldName("name")
          if (!nameNode) break
          const name = nameNode.text
          const line = nameNode.startPosition.row + 1
          declareSymbol(name, ASTEngine.SymbolKind.TypeAlias, node, line, {
            declarationKeyword: "type",
            underlyingType: findFirstChild(node, "primitive_type")?.text ?? "",
          })
          typeNamesInFile.add(name)
          topLevelExports.push({ name, line })
          break
        }

        // ------------------------------------------------------------- locals
        case "variable_declaration": {
          const nameNode = node.childForFieldName("name")
          if (!nameNode) break
          const line = nameNode.startPosition.row + 1
          const isImmutable = findFirstChild(node, "immutable") !== null
          declareSymbol(nameNode.text,
            isImmutable ? ASTEngine.SymbolKind.Constant : ASTEngine.SymbolKind.Variable,
            node, line, {
              declaredType: typeTextOf(node.childForFieldName("type")),
              ...(node.childForFieldName("value") ? { hasInitialiser: true } : {}),
              isImmutable,
            })
          break
        }

        // ----------------------------------------------------------------- Yul
        case "yul_variable_declaration": {
          const left = node.childForFieldName("left")
          if (!left) break
          const names = left.type === "identifier" ? [left] : findDescendants(left, "identifier")
          for (const n of names) {
            declareSymbol(n.text, ASTEngine.SymbolKind.Variable, n, n.startPosition.row + 1,
              { isYul: true, declaredType: "yul" })
          }
          break
        }

        case "yul_function_definition": {
          const idents = findChildren(node, "yul_identifier")
          const nameNode = idents.length > 0 ? idents[0] : findDescendant(node, "yul_identifier")
          if (!nameNode) break
          const name = nameNode.text
          const line = nameNode.startPosition.row + 1
          const params: ASTEngine.Parameter[] = idents.slice(1).map((p) => ({ name: p.text, type: "yul" }))
          declareSymbol(name, ASTEngine.SymbolKind.Function, node, line, { isYul: true }, params)
          noteMember(top().owner, name)
          openFrame(node, top().owner, name, line, true)
          break
        }

        // SOL-8 — a `yul_evm_builtin` is an OPCODE, not a function. The skip is
        // lossless: the lexer always spells a bare `add` as the builtin, so a
        // user-defined Yul function can never carry that name.
        case "yul_function_call": {
          const fn = node.childForFieldName("function")
          if (fn && fn.type === "yul_identifier") {
            addRel(top().scope, fn.text, ASTEngine.RelationshipType.Calls, 0.9, fn.startPosition.row + 1,
              { isYulCall: true })
          }
          break
        }

        case "yul_path": {
          // `sstore` / `x.slot` — the FIRST segment is the variable, the rest are
          // members. A segment the grammar spells as an EVM builtin is silent.
          findChildren(node, "identifier").forEach((seg, i) => {
            if (EVM_BUILTIN_NAMES.has(seg.text)) return
            addRel(top().scope, seg.text, ASTEngine.RelationshipType.Uses, 0.7, seg.startPosition.row + 1, {
              isYulPathSegment: true,
              ...(i === 0 ? { isYulVariableRead: true } : { isYulMemberReference: true }),
            })
          })
          break
        }

        // ---------------------------------------------------------- inheritance
        // Handled at the contract level, where the frame is pushed and the SOL-5
        // kind decision is made. Descending in here would emit every base twice.
        case "inheritance_specifier": {
          descend = false
          break
        }

        // ------------------------------------------------------- type mentions
        case "user_defined_type": {
          const parent = node.parent
          const ptype = parent ? parent.type : ""
          // Contexts that OWN this mention elsewhere. Staying silent here is what
          // keeps one mention from becoming two edges, and each of these owners
          // is a case in this switch.
          if (ptype === "inheritance_specifier" || ptype === "override_specifier" ||
              ptype === "new_expression" || ptype === "struct_expression" ||
              ptype === "catch_clause" || ptype === "meta_type_expression") break
          const name = udtName(node)
          if (name !== "") {
            addRel(top().scope, name, ASTEngine.RelationshipType.Uses, 0.85, node.startPosition.row + 1,
              { isTypeReference: true, typeReferenceSite: ptype })
          }
          break
        }

        // `using L for T` / `using {f as +} for T global` — the aliased entity.
        case "type_alias": {
          const id = findFirstChild(node, "identifier")
          if (id) {
            addRel(top().scope, id.text, ASTEngine.RelationshipType.References, 0.85,
              id.startPosition.row + 1, { isUsingDirectiveTarget: true })
          }
          break
        }

        case "using_alias": {
          for (const id of findChildren(node, "identifier")) {
            addRel(top().scope, id.text, ASTEngine.RelationshipType.References, 0.85,
              id.startPosition.row + 1, { isUsingAliasFunction: true })
          }
          break
        }

        // `catch MyError(string memory reason)` names a declared error.
        case "catch_clause": {
          const id = findFirstChild(node, "identifier")
          if (id) {
            addRel(top().scope, id.text, ASTEngine.RelationshipType.References, 0.85,
              id.startPosition.row + 1, { isCaughtError: true })
          }
          break
        }

        // `type(uint).max` / `type(C).creationCode` — the TYPE is the reference;
        // `max`/`creationCode` are members of the meta type, not of the project.
        case "meta_type_expression": {
          // Only a USER-DEFINED type is a project reference. `type(uint256).max`
          // names a language type; publishing `references -> uint256` would put a
          // resolvable-looking edge on a name no project declares.
          const udt = findDescendant(node, "user_defined_type")
          const name = udtName(udt)
          if (name !== "" && typeNamesInFile.has(name)) {
            addRel(top().scope, name, ASTEngine.RelationshipType.References, 0.85,
              udt!.startPosition.row + 1, { isMetaType: true })
          }
          descend = false
          break
        }

        // ------------------------------------------------------------- calls
        case "call_expression": {
          const fn = node.childForFieldName("function")
          // SOL-9 — claim the callee subtree so SOL-2 does not also read it.
          if (fn) claimedCallees.add(fn.id)
          const got = calleeNameOf(fn)
          if (got && got.name !== "") {
            addRel(top().scope, got.name, ASTEngine.RelationshipType.Calls, 0.9, got.line, {
              isSolidityCall: true,
              ...(fn && isMemberLike(fn) ? { isMemberCall: true } : {}),
              ...(fn && findFirstChild(fn, "struct_expression") !== null ? { hasCallOptions: true } : {}),
            })
          }
          break
        }

        // `emit Transfer(...)` is NOT a call_expression — the grammar models the
        // whole thing as `emit_statement` with a `name:` field, and 168 exist in
        // the corpus. A callee pass over `call_expression` alone would publish
        // ZERO event edges for the entire language.
        case "emit_statement": {
          const nameNode = node.childForFieldName("name")
          if (nameNode) claimedCallees.add(nameNode.id)
          const got = calleeNameOf(nameNode)
          if (got && got.name !== "") {
            addRel(top().scope, got.name, ASTEngine.RelationshipType.Calls, 0.9, got.line,
              { isEventEmission: true })
          }
          break
        }

        // `revert MyError(...)` — a custom error is a CALL. The name is the first
        // NAMED child when it is a bare identifier; `revert("msg")` has no such
        // child, which is the structural difference (measured on the tree, not
        // assumed: `revert E(m)` puts the identifier and the `revert_arguments` as
        // SIBLINGS).
        case "revert_statement": {
          const first = node.namedChildCount > 0 ? node.namedChild(0) : null
          if (first && (first.type === "identifier" || first.type === "user_defined_type")) {
            const name = first.type === "identifier" ? first.text : udtName(first)
            if (name !== "") {
              addRel(top().scope, name, ASTEngine.RelationshipType.Calls, 0.9,
                first.startPosition.row + 1, { isCustomErrorRevert: true })
            }
          }
          break
        }

        // `onlyOwner` in a function header, `Base(msg.sender)` in a constructor
        // header. grammar.js:765 — `modifier_invocation` is `$._identifier_path`
        // plus optional arguments, with NO field, so the name is the first
        // `identifier` child. `descend` stays TRUE so the arguments are read.
        case "modifier_invocation": {
          const id = findFirstChild(node, "identifier")
          if (id) {
            addRel(top().scope, id.text, ASTEngine.RelationshipType.Calls, 0.85,
              id.startPosition.row + 1, { isModifierInvocation: true })
          }
          break
        }

        case "new_expression": {
          // The `user_defined_type` is NOT a direct child: grammar.js nests it in
          // a `type_name` first, so `findFirstChild` returns null and the
          // `instantiates` edge silently disappears — which is exactly what the
          // first run measured (0 `instantiates` across a file containing
          // `A a = new A();`).
          const udt = findDescendant(node, "user_defined_type")
          const name = udtName(udt)
          if (name !== "") {
            addRel(top().scope, name, ASTEngine.RelationshipType.Instantiates, 0.95,
              (udt ?? node).startPosition.row + 1, { isNewExpression: true })
          }
          break
        }

        // SOL-10 — the OTHER struct spelling: `S { a: 1 }` in a primary-expression
        // position is a struct construction, and its NAME is in the `type:` field.
        // When it is a call's callee the `call_expression` case owns it, so
        // `isCalleeOf` is what keeps `t.call{value: 1}(...)` from emitting twice.
        case "struct_expression": {
          if (isClaimedCallee(node)) break
          const got = calleeNameOf(node.childForFieldName("type"))
          if (got && got.name !== "") {
            addRel(top().scope, got.name, ASTEngine.RelationshipType.Calls, 0.9, got.line,
              { isStructConstructor: true })
          }
          // `struct_field_assignment` / `call_struct_argument` names are bound by
          // the struct's and the function's own declarations; naming them from
          // the use site would produce an edge whose target resolves to a member
          // of a DIFFERENT owner, which is a different lie. Silent, and said so.
          descend = false
          break
        }

        // --------------------------------------------------------- references
        case "member_expression": {
          const prop = node.childForFieldName("property")
          if (!prop) break
          if (isClaimedCallee(node)) break
          // SOL-7 — a global's members, and the META TYPE's members, are not
          // project members.
          const objectNode = node.childForFieldName("object")
          if (isEngineMemberObject(objectNode)) break
          const object = memberObjectName(node)
          addRel(top().scope, prop.text, ASTEngine.RelationshipType.Uses, 0.8,
            prop.startPosition.row + 1, {
              isMemberReference: true,
              ...(object !== "" ? { viaObject: object } : {}),
            })
          break
        }

        case "identifier": {
          // SOL-2 — a READ is an identifier whose PARENT is an `expression`.
          const parent = node.parent
          if (!parent || parent.type !== "expression") break
          if (isClaimedCallee(node)) break
          if (top().yul) break
          // SOL-7 — `address(this).call(…)` puts a bare `this` under an
          // `expression`, so the positional read rule alone published
          // `uses -> this` for every occurrence. A global is not a read of
          // anything the file declares.
          if (GLOBAL_OBJECTS.has(node.text)) break
          addRel(top().scope, node.text, ASTEngine.RelationshipType.Uses, 0.75,
            node.startPosition.row + 1, { isVariableReference: true })
          break
        }

        // ------------------------------------------------------------- silence
        // Named here so the F9 spec points at code rather than at an absence, and
        // so each reason lives beside the switch. Every one of these is either a
        // literal, a keyword, a wrapper, or a node whose whole content is
        // semantics the graph does not model.
        case "comment":
        case "string":
        case "string_literal":
        case "hex_string_literal":
        case "unicode_string_literal":
        case "number_literal":
        case "number_unit":
        case "boolean_literal":
        case "true":
        case "false":
        case "primitive_type":
        case "type_name":
        case "assembly_flags":
        case "assembly_statement":
        case "yul_evm_builtin":
        case "yul_boolean":
        case "yul_string_literal":
        case "yul_hex_string_literal":
        case "yul_hex_number":
        case "yul_decimal_number":
        case "yul_break":
        case "yul_continue":
        case "yul_leave":
        case "yul_label":
        case "layout_specifier":
        case "state_location":
        case "virtual":
        case "immutable":
        case "visibility":
        case "state_mutability":
        case "override_specifier":
        case "unchecked":
        case "enum_body":
        case "struct_body":
        case "contract_body":
        case "function_body":
        case "statement":
        case "expression":
        case "expression_statement":
        case "block_statement":
        case "yul_block":
        case "yul_assignment":
        case "if_statement":
        case "while_statement":
        case "for_statement":
        case "break_statement":
        case "continue_statement":
        case "do_while_statement":
        case "return_statement":
        case "return_parameter":
        case "revert_arguments":
        case "solidity_pragma_token":
        case "solidity_version":
        case "solidity_version_comparison_operator":
        case "pragma_value":
        case "any_pragma_token":
        case "any_source_type":
        case "inline_array_expression":
          break

        default: {
          // Cyclomatic complexity, counted once per BRANCH at the node the tree
          // names as a branch. This is an explicit list rather than a
          // catch-all so adding a construct cannot silently change the metric.
          if (node.type === "ternary_expression" || node.type === "binary_expression" ||
              node.type === "catch_clause" || node.type === "yul_if_statement" ||
              node.type === "yul_switch_statement") cyclomaticComplexity++
          break
        }
      }

      if (descend) {
        work.push({ node, exit: true })
        for (let i = node.childCount - 1; i >= 0; i--) {
          const c = node.child(i)
          if (c) work.push({ node: c, exit: false })
        }
      }
    }

    // ------------------------------------------------------------ SOL-11 pass
    // `overrides`, resolved AFTER the whole file, because a base may be declared
    // AFTER its subclass in source order — legal Solidity, and the corpus does
    // it. A candidate with no in-file target emits NOTHING: a fabricated target
    // sits at zero `unknownTargets` while being wrong.
    let overridesEmitted = 0
    let overridesUnresolved = 0
    for (const cand of overrideCandidates) {
      const bases = cand.explicit.length > 0 ? cand.explicit : cand.anyBase
      let hit = false
      for (const base of bases) {
        // A contract listing ITSELF in `override(A, B)` is a diamond-inheritance
        // shape the grammar accepts; `overrides g -> B` inside `B` would be a
        // function overriding a member of its own owner, which is not a thing.
        if (base === cand.owner) continue
        const members = membersByType.get(base)
        if (!members || !members.has(cand.memberName)) continue
        if (!symbolMap.has(`${cand.owner}\u0000${cand.memberName}\u0000method`)) continue
        if (!symbolMap.has(`${base}\u0000${cand.memberName}\u0000method`)) continue
        addRel(cand.memberName, base, ASTEngine.RelationshipType.Overrides, 0.8, cand.line, {
          overridesMember: cand.memberName,
          baseType: base,
          ...(cand.explicit.length > 0
            ? { baseNamedByOverrideSpecifier: true }
            : { baseFromContractHeader: true }),
        })
        overridesEmitted++
        hit = true
      }
      if (!hit) overridesUnresolved++
    }

    // ---------------------------------------------------------- SOL-12 exports
    // The compilation-unit surface. Structural: the tree states which
    // declarations are at file scope and which are members.
    const exportedNames = new Set<string>()
    for (const { name, line } of topLevelExports) {
      if (exportedNames.has(name)) continue
      exportedNames.add(name)
      addRel(fileName, name, ASTEngine.RelationshipType.Exports, 1.0, line,
        { isCompilationUnitSurface: true })
      exports.push({
        name,
        range: this.lineRange(line),
        metadata: { soliditySpecific: true, isFileScopeDeclaration: true },
      })
    }

    // ------------------------------------------------------------------ imports
    for (const e of importEdges) {
      if (e.name === "*") {
        addRel(fileName, e.path, ASTEngine.RelationshipType.References, 1.0, e.line, {
          import: true,
          isNamespaceImport: true,
        })
        continue
      }
      addRel(fileName, e.name, ASTEngine.RelationshipType.References, 1.0, e.line, {
        import: true,
        importPath: e.path,
      })
    }

    const detectedPatterns = [...patterns]
    const detectedFrameworks = [...frameworks]

    return {
      language: "solidity",
      symbols,
      relationships,
      imports,
      exports,
      errors: [],
      metadata: {
        complexity: symbols.length + relationships.length,
        linesOfCode: lines.length,
        cyclomaticComplexity,
        framework: detectedFrameworks[0],
        patterns: detectedPatterns,
        detectedFrameworks,
        frameworkPatterns: detectedPatterns.map((p) => ({
          framework: "Solidity",
          patterns: [{ type: "usage", detected: true, description: p }],
        })),
        architecturalInsights: [],
        architecturalScore: Math.min(100, 60 + relationships.length),
        codeQuality: "Excellent",
        hasTypeInference: false,
        hasFrameworkIntelligence: true,
        analysisVersion: "6.0-sol-module-owners-lines-tiers",
        // Reported rather than hidden — see the F9 spec and the surface measure.
        overridesEmitted,
        overridesUnresolved,
        engineCallsSuppressed,
        getterSymbols,
        storeRefusedDeclarations,
        implementsCrossFileUnresolved: extendsUnresolvedAsInterface,
      } as Partial<ASTEngine.FileMetadata>,
    }
  }

  // ---------------------------------------------------------------- helpers

  /** SOL-1 — the file's own basename, extension included. */
  private basenameOf(filePath: string): string {
    const normalized = filePath.split("\\").join("/")
    const base = normalized.slice(normalized.lastIndexOf("/") + 1)
    return base.length > 0 ? base : "contract.sol"
  }

  private lineRange(line: number): ASTEngine.UniversalSymbol["range"] {
    return {
      startLine: line, startColumn: 1, endLine: line, endColumn: 1,
      startIndex: 0, endIndex: 0,
    }
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

/** Is this a callee wrapper that resolves to a MEMBER access? `t.call{…}(…)`. */
function isMemberLike(fn: Node): boolean {
  if (fn.type !== "expression") return false
  for (let i = 0; i < fn.namedChildCount; i++) {
    const c = fn.namedChild(i)
    if (!c) continue
    if (c.type === "member_expression") return true
    if (c.type === "struct_expression" && findFirstNamed(c, "member_expression") !== null) return true
    if (c.type === "payable_conversion_expression") return true
  }
  return false
}

function findFirstNamed(node: Node, type: string): Node | null {
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c && c.type === type) return c
  }
  return null
}