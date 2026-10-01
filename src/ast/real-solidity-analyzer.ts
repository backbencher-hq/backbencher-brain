import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"
import { isReservedTarget, isPrimitiveTypeToken, ENGINE_FUNCTION_NAMES, STORE_REFUSED_SYMBOL_NAMES } from "./solidity-reserved-tokens"
import { buildResolutionTables } from "./project-index"

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
 *  - SOL-6  NOTHING IS EMITTED FROM A RECOVERY REGION — AND A RECOVERY REGION IS
 *    A RANGE OF SOURCE LINES, NOT AN ERROR NODE'S SUBTREE. bash BD5, extended.
 *    The first version skipped an ERROR/MISSING node's descendants, and the
 *    fixture written to test it proved the rule was too narrow: on
 *
 *        function good() public pure returns (uint256) { return 1; }
 *        this is not ) valid solidity ( at all
 *        function alsoGood() public pure returns (uint256) { return 2; }
 *
 *    the parser emits `ERROR` covering only `is not ) valid solidity ( at` and
 *    a MISSING `;`. The tokens `this` and `all` are SIBLINGS of that ERROR node,
 *    outside its subtree, so the subtree rule let both through and the file
 *    published a symbol named `all` and a type reference `this` — the parser's
 *    guess about garbage, stored as graph fact. What is actually unrecoverable is
 *    the SOURCE LINE, not the node: once a line is inside a recovery region the
 *    parser is inventing, and anything it reports there is an invention. So the
 *    rule is: pre-pass the tree for ERROR/MISSING line spans, and refuse any
 *    symbol or relationship whose line falls in one. Cost is one O(n) pre-pass and
 *    an O(1) Set lookup per emit.
 *    The corpus is 0% damaged so this is defensive, and the fixture
 *    `recovery-regions-sol6` forces an ERROR on purpose — otherwise a green
 *    0-damage corpus would leave the rule untested, which is how it stayed too
 *    narrow through a full surface measurement.
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
    context?: ASTEngine.AnalyzeContext,
  ): ASTEngine.ParseResult & { metadata: Partial<ASTEngine.FileMetadata> } {
    // SOL-21 — OPTIONAL project knowledge. Absent means the per-file contract, which is
    // byte-for-byte what this analyzer did before the index existed.
    const projectIndex = context?.projectIndex
    let inheritanceKindsResolvedProjectWide = 0
    // SOL-6 — every SOURCE LINE the parser had to invent. Collected in one
    // pre-pass before the walk; consulted by both emit helpers.
    /** The node types a NatSpec comment may document. Declared once, here, because
     *  SOL-16 needs it and a second copy would be a second thing to forget. */
    /** SOL-18 — declared type name -> "contract" | "interface" | "library". */
    const typeKindByName = new Map<string, string>()
    const DECLARATION_NODE_TYPES = new Set([
      "contract_declaration", "interface_declaration", "library_declaration",
      "function_definition", "modifier_definition", "constructor_definition",
      "fallback_receive_definition", "struct_declaration", "enum_declaration",
      "event_definition", "error_declaration", "user_defined_type_definition",
      "state_variable_declaration", "variable_declaration",
    ])

    /**
     * SOL-22 — read the licence identifier off the file's first comment run.
     *
     * Solidity's own convention is `SPDX-License-Identifier: <id>`, and the grammar's
     * `comment` node holds the text verbatim, so the marker is found by scanning for the
     * literal rather than by matching a shape — no regex, consistent with this lane.
     * Only the FIRST run is considered, because a licence is a file-level statement and
     * a licence buried on line 400 is a remark that happens to contain the word.
     */
    const readSolcLicence = (root: Node): string | null => {
      const run: Node[] = []
      for (let i = 0; i < root.namedChildCount; i++) {
        const c = root.namedChild(i)
        if (!c) continue
        if (c.type === "comment") { run.push(c); continue }
        break
      }
      for (const c of run) {
        const text = readNatSpec(c.text).text
        if (text === "") continue
        for (const line of text.split("\n")) {
          const t = line.trim()
          if (!t.startsWith("SPDX-License-Identifier:")) continue
          const id = t.slice("SPDX-License-Identifier:".length).trim()
          if (id !== "") return id
        }
      }
      return null
    }

    /**
     * SOL-16 — NATSPEC. The language's documentation system, and this lane read NONE
     * of it: 5,254 `comment` nodes over the 389-file corpus, zero reaching a symbol.
     * Solidity's `///` line form and its slash-star block form are exactly what the
     * TypeScript lane extracts from JSDoc, so their absence was the single largest
     * depth gap between the two analyzers.
     *
     * ATTACHMENT, measured rather than assumed. A comment's `prevNamedSibling` is
     * NULL and its index in `parent.children` is -1, so the obvious "the comment
     * before this declaration" join does not exist. Its `nextNamedSibling` IS the
     * declaration it documents. Solidity attaches documentation to what FOLLOWS it,
     * which is also why the two forms can be told apart from position alone.
     *
     * MARKERS ARE STRIPPED WITH `startsWith`/`slice`, never a regex — this lane's
     * zero-regex gate is a real gate, and documentation parsing is exactly where a
     * whitespace-and-star matcher would have crept in and quietly become the
     * analyzer's first regular expression.
     */
    const readNatSpec = (raw: string): { text: string; kind: string } => {
      const lines = raw.split("\n")
      const out: string[] = []
      let sawNatspec = false
      for (const line of lines) {
        let t = line
        while (t.length > 0 && t.charAt(0) === " ") t = t.slice(1)
        // Block form, with a leading star on each continuation line for alignment.
        if (t.startsWith("*/")) t = t.slice(2)
        else if (t.startsWith("/**")) { t = t.slice(3); sawNatspec = true }
        else if (t.startsWith("///")) { t = t.slice(3); sawNatspec = true }
        else if (t.startsWith("//")) t = t.slice(2)
        else if (t.startsWith("*")) t = t.slice(1)
        if (t.startsWith(" ")) t = t.slice(1)
        out.push(t)
      }
      while (out.length > 0 && out[out.length - 1].trim() === "") out.pop()
      while (out.length > 0 && out[0].trim() === "") out.shift()
      return {
        text: out.join("\n").trim(),
        kind: sawNatspec ? (raw.indexOf("/**") === 0 ? "natspec-block" : "natspec-line") : "line",
      }
    }
    /** The `@tag` on each line, in order. NatSpec's structured payload, read
     *  mechanically: a line whose first non-space character is `@` contributes the
     *  run of tag characters. No regex, and no hand list of NatSpec tags — an
     *  unknown `@custom:` tag is reported like any other rather than dropped. */
    const natSpecTags = (text: string): string[] => {
      const tags: string[] = []
      for (const line of text.split("\n")) {
        const t = line.trim()
        if (!t.startsWith("@")) continue
        let end = 1
        while (end < t.length) {
          const c = t.charAt(end)
          if (c === " " || c === "\t") break
          end++
        }
        tags.push(t.slice(0, end))
      }
      return tags
    }
    /**
     * node id -> documentation for the declaration a comment documents, ACCUMULATED.
     *
     * A run of `///` lines is NOT one comment node: `/// @notice …`, `/// @dev …`,
     * `/// @param x …` and `/// @return y …` are four separate `comment` nodes whose
     * `nextNamedSibling` is the SAME declaration. The first version of this used
     * `docByNode.set(...)` and so kept only the LAST line of every docstring — which
     * is the opposite of what documentation means and would have shipped a lane that
     * read NatSpec while silently discarding 3 of every 4 lines. The corpus has 5,254
     * comment nodes against far fewer documented declarations for exactly this reason.
     */
    const docByNode = new Map<number, { text: string; kind: string; parts: string[] }>()
    let commentsRead = 0
    let commentsAttached = 0
    let documentedSymbols = 0
    let symbolsWithComplexity = 0
    let symbolsWithQualifiedCalls = 0
    {
      // RUNS, not single comments — and the first version was wrong in a way that
      // looked correct. `nextNamedSibling` is the documented declaration only for
      // the LAST comment of a run, so `docByNode.set(...)` per comment kept exactly
      // one line of every NatSpec block: `library Docs` came out documented as
      // "@author Someone" and the `@title`/`@notice` above it were silently dropped.
      //
      // A comment RUN is a maximal set of line-ADJACENT comment siblings. Line
      // adjacency is the contiguity boundary, matching the TypeScript lane's own
      // rule: a blank line ends a docstring, so trailing remarks about the previous
      // declaration are not stolen onto the next one. Runs are collected per parent
      // because `source_file` and `contract_body` both hold them.
      const attachRun = (run: Node[], anchor: Node | null): void => {
        if (run.length === 0 || anchor === null) return
        if (!DECLARATION_NODE_TYPES.has(anchor.type)) return
        const parts: string[] = []
        let kind = "line"
        for (const c of run) {
          const read = readNatSpec(c.text)
          if (read.text === "") continue
          parts.push(read.text)
          if (read.kind !== "line") kind = read.kind
          commentsAttached++
        }
        if (parts.length === 0) return
        const prior = docByNode.get(anchor.id)
        if (prior === undefined) {
          docByNode.set(anchor.id, { text: parts.join("\n"), kind, parts })
        } else {
          prior.parts.push(...parts)
          prior.text = prior.parts.join("\n")
          if (kind !== "line") prior.kind = kind
        }
      }
      const stack: Node[] = [rootNode]
      while (stack.length > 0) {
        const p = stack.pop()!
        for (let i = 0; i < p.childCount; i++) {
          const c = p.child(i)
          if (c) stack.push(c)
        }
        let run: Node[] = []
        let anchor: Node | null = null
        const flush = (): void => {
          if (run.length > 0) attachRun(run, anchor)
          run = []
          // The anchor is CONSUMED. Without this reset a trailing run at the end of a
          // parent reused the PREVIOUS declaration: on natspec-sol16 the closing
          // remark of the file was published as part of `IThing`'s docstring, which is
          // the precise opposite of what a trailing remark is. Caught by the fixture
          // that exists to pin the trailing case.
          anchor = null
        }
        for (let i = 0; i < p.namedChildCount; i++) {
          const c = p.namedChild(i)
          if (!c) continue
          if (c.type === "comment") {
            commentsRead++
            const last = run.length > 0 ? run[run.length - 1] : null
            if (last !== null && c.startPosition.row > last.endPosition.row + 1) flush()
            run.push(c)
            continue
          }
          anchor = c
          flush()
        }
        // A run still open at the end of a parent documents nothing: it is a trailing
        // remark, and Solidity attaches documentation to what FOLLOWS.
        flush()
      }
    }

    const recoveryLines = new Set<number>()
    {
      const stack: Node[] = [rootNode]
      while (stack.length > 0) {
        const n = stack.pop()!
        if (n.type === "ERROR" || n.isMissing) {
          for (let r = n.startPosition.row + 1; r <= n.endPosition.row + 1; r++) recoveryLines.add(r)
        }
        for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) stack.push(c) }
      }
    }

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

    // SOL-22 — LICENCE. The module symbol is pushed here, BEFORE the NatSpec pre-pass
    // runs, so it was the one symbol that could never be documented — and the licence
    // lives on exactly that symbol.
    //
    // `// SPDX-License-Identifier: MIT` is the first comment in virtually every
    // Solidity file, and it reaches nothing for a structural reason: its next named
    // sibling is the `pragma_directive`, which is not a DECLARATION, so SOL-16's
    // attachment rule has no declaration to land on. The consequence was that ZERO of
    // 5,976 symbols carried a licence, on a corpus where every file states one.
    //
    // So the licence is read here, from the FILE'S FIRST comment run, and only when it
    // actually carries a licence identifier. A file whose first comment is an ordinary
    // remark gets no `license` key at all rather than a guess: absence is the honest
    // value, and `pool-worker` has no licence field, so this travels in metadata and as
    // a top-level symbol field beside `docstring`.
    const licence = readSolcLicence(rootNode)
    symbols.push({
      name: fileName,
      kind: ASTEngine.SymbolKind.Module,
      range: this.nodeToRange(rootNode),
      visibility: "public",
      ...(licence !== null ? { license: licence } : {}),
      metadata: {
        soliditySpecific: true,
        isCompilationUnit: true,
        ...(licence !== null ? { license: licence } : {}),
      },
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
    interface Frame {
      owner: string; scope: string; containerLine: number; yul: boolean; isType?: boolean
      /** SOL-18 — branches seen inside THIS frame, and the symbol they belong to. */
      branches: number
      sym: ASTEngine.UniversalSymbol | null
      /** SOL-20 — qualified calls made from inside THIS frame. */
      qualifiedCalls: string[]
    }
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
    /** SOL-15 — modifiers declared in THIS file, so a call to one is a modifier
     *  INVOCATION and not a call to some function that happens to share its name.
     *  `initializer()` is the corpus's clearest case: 24 rows, all of them the
     *  `Initializable` modifier, none of them a function. */
    const modifierNamesInFile = new Set<string>()
    /** Deferred `overrides`: resolved after the whole file is read. */
    const overrideCandidates: {
      memberName: string; owner: string; line: number; explicit: string[]; anyBase: string[]
    }[] = []
    /** SOL-12 — the file-scope surface, for the module's `exports` edges. */
    const topLevelExports: { name: string; line: number }[] = []
    /** Import edge targets: a name per imported symbol, or `*` for the file. */
    const importEdges: { name: string; path: string; line: number; isNamespace?: boolean }[] = []
    /** SOL-7b — how many engine-function calls were refused at the emit site.
     *  COUNTED, not silent: a refusal nobody counts is how the next engine
     *  builtin lands as a fabricated edge with nothing to notice it. */
    let engineCallsSuppressed = 0
    /** SOL-14 — the declarations refused because the STORE would drop them anyway.
     *  Counted AND NAMED: `self` and `root` are real Solidity identifiers that
     *  pool-worker's UNIVERSAL denylist refuses, and an uncounted refusal is
     *  indistinguishable from the analyzer being wrong. The names (not just the
     *  count) are also what makes the rule testable from the result alone: a
     *  revert that reinstates them cannot be written without being told which
     *  ones, and a mutant that hard-codes `self` and `root` would measure the
     *  fixture rather than the behaviour. */
    const storeRefusedNames = new Set<string>()
    let storeRefusedDeclarations = 0
    /** SOL-6 — declarations refused because their line is a recovery line. */
    let symbolsSuppressedOnRecoveryLines = 0
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
    const evidenceClassFor = (
      type: ASTEngine.RelationshipType,
      isImport = false,
      confidence = 1,
    ): string => {
      if (isImport) return "import_based"
      switch (type) {
        case ASTEngine.RelationshipType.Contains:
        case ASTEngine.RelationshipType.Extends:
        case ASTEngine.RelationshipType.Implements:
        case ASTEngine.RelationshipType.Exports:
        case ASTEngine.RelationshipType.Instantiates:
          // SOL-19 — the tier is a function of the TYPE, and the first attempt made it
          // a function of CONFIDENCE as well ("below 1.0 is not structural"). That rule
          // is wrong, and the fixture suite said so within one run: `instantiates` is
          // emitted at 0.95 for conservatism while being structural evidence — the
          // `new_expression` states its type — and keying on the number relabelled it
          // `inferred`.
          //
          // So the discriminator is NOT how confident the number is. It is whether a
          // COMPONENT of the assertion was undecided — and the call site already says
          // so, in `kindUnresolved`. A conservative score and an undecided claim are
          // different facts, and conflating them would trade one wrong label for
          // another. The downgrade therefore stays at the call site, which is where the
          // knowledge is, and it is pinned by a fixture row and a mutant rather than by
          // a heuristic here — a heuristic cannot be right for both cases.
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
      // SOL-6 — refuse anything on a line the parser invented.
      if (recoveryLines.has(line)) return
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
        metadata: { evidenceClass: evidenceClassFor(type, isImport, confidence), soliditySpecific: true, ...metadata },
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
      if (clean === "") return
      // SOL-16 — documentation attaches at the SINGLE point every declaration kind
      // goes through, for the same reason SOL-14's store refusal does: a rule
      // repeated per declaration kind is a rule that will be applied to some kinds
      // and forgotten for the rest.
      const doc = docByNode.get(node.id)
      if (doc !== undefined && meta.docstring === undefined) {
        meta.docstring = doc.text
        meta.docstringKind = doc.kind
        // `comments` as an ARRAY, because that is the field the TypeScript lane
        // populates for the same job (`extractComments` returns `string[]`), and a
        // lane that reads comments off a Solidity symbol should not have to learn a
        // second shape. `docstring` is set too, because that one is a first-class
        // symbol field the store persists to `brain_symbol.docstring` — a column that
        // has been NULL for every Solidity symbol this lane has ever produced.
        meta.comments = doc.parts
        const tags = natSpecTags(doc.text)
        if (tags.length > 0) meta.docTags = tags
        documentedSymbols++
      } null
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
        // SOL-16 — top-level as well as in metadata, because `docstring` is a
        // FIRST-CLASS field on UniversalSymbol and the store reads `s.docstring`
        // (pool-worker.ts:673). Metadata alone left `brain_symbol.docstring` NULL for
        // every Solidity symbol while the analyzer believed it had published
        // documentation — the field existed in the payload and nothing read it.
        // SOL-17 — first-class symbol field, so it crosses the worker boundary and
        // reaches the store rather than living only in metadata.
        ...(Array.isArray(meta.decorators) ? { decorators: meta.decorators as string[] } : {}),
        // SOL-18 — `ownerKind` is a first-class symbol field (`pool-worker` forwards
        // it), so it is set top-level as well as in metadata, for the same reason
        // `docstring` is.
        ...(typeof meta.ownerKind === "string" ? { ownerKind: meta.ownerKind as string } : {}),
        ...(typeof meta.docstring === "string"
          ? {
            docstring: meta.docstring,
            // Also top-level: pool-worker's parseFile return shape does not carry
            // `metadata` on symbols at all, so anything only in metadata is invisible
            // to every consumer of this API — which is how `docstringKind` read `-`
            // on the first successful run of this feature.
            docstringKind: meta.docstringKind,
            docTags: meta.docTags,
            comments: meta.comments,
          }
          : {}),
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
    ): ASTEngine.UniversalSymbol | null => {
      const clean = name.trim()
      // SOL-18 — this now RETURNS the symbol it declared, so a caller can hold the
      // object and finish populating it later. It called `pushSymbol` and discarded
      // the result, which is why the first attempt at per-symbol complexity published
      // 1 for every function in the corpus: the frame carried `sym: null`, the exit
      // branch had nothing to write to, and `symbolsWithComplexity` was 0. A feature
      // that measures nothing still reports the pool-worker's default of 1, so it
      // looked configured rather than broken.
      if (clean === "") return null
      // SOL-16 — documentation attaches at the SINGLE point every declaration kind
      // goes through, for the same reason SOL-14's store refusal does: a rule
      // repeated per declaration kind is a rule that will be applied to some kinds
      // and forgotten for the rest.
      const doc = docByNode.get(node.id)
      if (doc !== undefined && meta.docstring === undefined) {
        meta.docstring = doc.text
        meta.docstringKind = doc.kind
        // `comments` as an ARRAY, because that is the field the TypeScript lane
        // populates for the same job (`extractComments` returns `string[]`), and a
        // lane that reads comments off a Solidity symbol should not have to learn a
        // second shape. `docstring` is set too, because that one is a first-class
        // symbol field the store persists to `brain_symbol.docstring` — a column that
        // has been NULL for every Solidity symbol this lane has ever produced.
        meta.comments = doc.parts
        const tags = natSpecTags(doc.text)
        if (tags.length > 0) meta.docTags = tags
        documentedSymbols++
      }
      // SOL-14 — the store refuses this name, so declaring it would publish a
      // `contains` edge pointing at a symbol that never reaches the store. Refuse
      // HERE, at the single point every declaration goes through, exactly as a
      // non-positive line is refused in `addRel`. See
      // src/ast/solidity-reserved-tokens.ts for the measured evidence: `self` at
      // CrosschainLinked.sol:59 and `root` at MerkleTreeMock.sol:15 are both real
      // Solidity identifiers the shared filter drops.
      if (STORE_REFUSED_SYMBOL_NAMES.has(clean)) {
        // Counted and NAMED here, at the single point every declaration kind goes
        // through. The state-variable path checks FIRST so it can also suppress the
        // SOL-3 getter; it breaks before reaching this line, so there is no double
        // count.
        storeRefusedDeclarations++
        storeRefusedNames.add(clean)
        return null
      }
      // SOL-6 — a declaration on a recovery line is the parser guessing.
      if (recoveryLines.has(line)) {
        symbolsSuppressedOnRecoveryLines++
        return null
      }
      // SOL-18 — `ownerKind`, the kind of the TYPE a member belongs to. The
      // TypeScript lane sets it from the scope stack and `pool-worker` forwards it, so
      // a consumer asking "is this method on an interface or a contract" gets an answer
      // for every language except this one. Read from the declaration table rather than
      // re-inspecting the tree, so it cannot disagree with the kind the owner was
      // DECLARED with.
      const ownerKindName = typeKindByName.get(top().owner)
      if (ownerKindName !== undefined && meta.ownerKind === undefined) {
        meta.ownerKind = ownerKindName
      }
      if (kind === ASTEngine.SymbolKind.Class || kind === ASTEngine.SymbolKind.Interface) {
        // SOL-19 — a LIBRARY is not a contract. `declareSymbol` maps both
        // `contract_declaration` and `library_declaration` to `SymbolKind.Class`, so
        // deriving ownerKind from the Kind reported every library member as a contract
        // member — a bug in the first version of SOL-18, caught by reading
        // `contracts/utils/Strings.sol` back. `declarationKeyword` is already on the
        // type's own metadata and is the tree's word for it.
        const kw = typeof meta.declarationKeyword === "string" ? meta.declarationKeyword : ""
        typeKindByName.set(
          clean,
          kind === ASTEngine.SymbolKind.Interface ? "interface"
            : kw === "library" ? "library"
              : "contract",
        )
      }
      const key = `${top().owner}\u0000${clean}\u0000${kind}`
      if (symbolMap.has(key)) return null
      const pushed = pushSymbol(clean, kind, node, meta, parameters)
      const owner = top().owner
      if (owner && owner !== clean) {
        addRel(owner, clean, ASTEngine.RelationshipType.Contains, 1.0, containsLine ?? line, {})
      }
      return pushed
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
    const calleeNameOf = (
      node: Node | null,
      depth = 0,
      viaMember = false,
    ): { name: string; line: number; viaMember: boolean } | null => {
      if (!node || depth > 6) return null
      const line = node.startPosition.row + 1
      switch (node.type) {
        case "identifier":
          return { name: node.text, line, viaMember }
        case "member_expression": {
          const prop = node.childForFieldName("property")
          return prop ? calleeNameOf(prop, depth + 1, true) : null
        }
        case "struct_expression":
          // SOL-10 — the call-with-options / named-argument form: the NAME lives
          // in the `type:` field, and the `struct_field_assignment` children are
          // option values, not names.
          return calleeNameOf(node.childForFieldName("type"), depth + 1, viaMember)
        case "user_defined_type": {
          const n = udtName(node)
          return n === "" ? null : { name: n, line, viaMember }
        }
        case "array_access":
          return calleeNameOf(node.childForFieldName("base"), depth + 1, viaMember)
        case "expression":
        case "payable_conversion_expression":
        case "parenthesized_expression": {
          for (let i = 0; i < node.namedChildCount; i++) {
            const c = node.namedChild(i)
            if (!c) continue
            const got = calleeNameOf(c, depth + 1, viaMember)
            if (got) return got
          }
          return null
        }
        default:
          return null
      }
    }

    /** SOL-15 companion — the INNER callee node. `call_expression`'s `function`
     *  field is an `expression` WRAPPER around the real callee, which is why
     *  `calleeNameOf` descends. The first version of the callee-object capture passed
     *  the WRAPPER to `memberObjectName`, whose `childForFieldName("object")` is null
     *  on a wrapper, so every member call got `calleeObject: ""` and all 270 of the
     *  corpus's namespace builtins (`abi.encode`) classified as `external` — the
     *  classification silently measuring nothing. Same descent as the name, so the
     *  two can never disagree about which node the callee is. */
    const innerCalleeOf = (node: Node | null, depth = 0): Node | null => {
      if (!node || depth > 6) return null
      if (node.type === "identifier" || node.type === "member_expression" ||
          node.type === "user_defined_type") return node
      // SOL-10 — for the call-WITH-OPTIONS form (`target.call{value: v}(…)`) the
      // callee is a `struct_expression` whose NAME lives in its `type:` field. Stopping
      // there, as this did, handed `memberObjectName` a wrapper with no `object` field
      // and every such call got `calleeObject: ""` — so `target.call` and a hypothetical
      // `super.call` became indistinguishable, which is the one distinction SOL-15
      // relies on to tell a namespace builtin from a project member.
      if (node.type === "struct_expression") {
        return innerCalleeOf(node.childForFieldName("type"), depth + 1)
      }
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i)
        if (!c) continue
        const got = innerCalleeOf(c, depth + 1)
        if (got) return got
      }
      return null
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
     * SOL-2's callee suppression, for a BARE identifier read — and this one checks
     * the IMMEDIATE parent only, which is the correction the F5 differential
     * forced.
     *
     * `isClaimedCallee` climbs the whole ancestor chain, and that is right for a
     * `member_expression` (whose property can sit two wrappers below a call's
     * `function:` field) and WRONG for a bare identifier read. In
     *
     *     stringMap[key].getStringSlot().value
     *
     * the `array_access` base `stringMap` is an `expression` that is an ANCESTOR
     * of the claimed callee, so the climb suppressed it — and the RECEIVER of a
     * method call is a real read that the lane was dropping corpus-wide. The
     * differential reported it as 20 MISSING rows of the shape
     * `uses getStringStorage -> stringMap`; every one was correct and every one was
     * absent.
     *
     * Why the immediate parent is sufficient here: an identifier that genuinely IS
     * a callee has the claimed `function:`-field node as its DIRECT parent, so
     * nothing further up the chain needs consulting. The ancestor climb exists only
     * for the member case, and it stays.
     */
    const isClaimedCalleeDirect = (node: Node): boolean => {
      const parent = node.parent
      return parent !== null && claimedCallees.has(parent.id)
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
      // SOL-17 — APPLIED MODIFIERS are Solidity's annotation mechanism, and they are
      // what the TypeScript lane calls a decorator: `onlyOracle`, `nonReentrant`,
      // `initializer`. Published on the `decorators` field rather than as a
      // relationship, which is the FAMILY CONTRACT — C#, Java and F# all treat
      // decorators as metadata on the thing they decorate, and the
      // `modifier_invocation` case already emits the one edge that does carry
      // meaning (a `calls` edge, because invoking a modifier IS calling it).
      //
      // grammar.js:765 — `modifier_invocation` is an identifier path plus optional
      // arguments with NO field, so the name is the first `identifier` child. That
      // is the same read the relationship case performs, deliberately: a modifier
      // list and a modifier-call list that could disagree would be worse than
      // neither.
      const applied: string[] = []
      for (const inv of findChildren(node, "modifier_invocation")) {
        const id = findFirstChild(inv, "identifier")
        if (id) applied.push(id.text)
      }
      if (applied.length > 0) meta.decorators = applied
      return meta
    }

    /** Register a member name under its owner, for SOL-11's override resolution. */
    const noteMember = (owner: string, name: string) => {
      if (owner === fileName || owner === "") return
      let set = membersByType.get(owner)
      if (!set) { set = new Set<string>(); membersByType.set(owner, set) }
      set.add(name)
    }

    /**
     * Is this node a DECISION POINT for cyclomatic complexity?
     *
     * Solidity's branching constructs: `if`/`for`/`while`/`do`-`while`, the ternary
     * conditional, `catch`, `&&`, `||`, and the two Yul forms. `else` is part of
     * `if_statement` in this grammar (one node), so an `if`/`else` pair is ONE branch
     * — which is the standard reading, and the alternative would make the number a
     * measure of the grammar's node layout rather than of the code.
     *
     * The FIRST version counted `binary_expression` unconditionally, which is wrong
     * in both directions at once: it counted `a + b` as a decision point and missed
     * `if` entirely. Measured on all-kinds-sol it produced 3 for a file holding six
     * contracts, which is not a complexity anyone would recognise. The operator is
     * read STRUCTURALLY — `binary_expression` puts it between its `left:` and
     * `right:` fields as an anonymous token, so `node.child(i).type === "&&"` is a
     * fact about the tree rather than a substring match on source text.
     */
    const isBranchNode = (node: Node): boolean => {
      switch (node.type) {
        case "if_statement":
        case "for_statement":
        case "while_statement":
        case "do_while_statement":
        case "ternary_expression":
        case "catch_clause":
        case "yul_if_statement":
        case "yul_switch_statement":
          return true
        case "binary_expression": {
          for (let i = 0; i < node.childCount; i++) {
            const c = node.child(i)
            if (c && (c.type === "&&" || c.type === "||")) return true
          }
          return false
        }
        default:
          return false
      }
    }

    const openFrame = (
      node: Node, owner: string, scope: string, line: number,
      yul = false, isType = false, sym: ASTEngine.UniversalSymbol | null = null,
    ) => {
      openedFrames.add(nodeKey(node))
      frames.push({ owner, scope, containerLine: line, yul, isType, branches: 1, sym, qualifiedCalls: [] })
    }
    /** SOL-15 — the nearest enclosing TYPE. `top().owner` cannot answer this inside a
     *  function body, because SOL-13 makes a function frame its own owner, so
     *  `top().owner` there is the FUNCTION (`everything`), not the contract. Marking
     *  the type frames is what lets a call say which contract it was written in,
     *  which is the whole basis of resolving it. */
    const enclosingTypeOf = (): string => {
      for (let i = frames.length - 1; i >= 1; i--) if (frames[i].isType) return frames[i].owner
      return ""
    }

    // -------------------------------------------------------------- traversal

    const work: { node: Node; exit: boolean }[] = [{ node: rootNode, exit: false }]
    /** Nodes already claimed as a callee, so SOL-2 does not also read them. */
    const claimedCallees = new Set<number>()

    while (work.length > 0) {
      const { node, exit } = work.pop()!

      if (exit) {
        if (openedFrames.has(nodeKey(node))) {
          // SOL-18 — the frame is the LAST moment the symbol's own body has been seen,
          // so the branch count is final here. Attributed through the frame rather than
          // by re-walking each declaration's subtree: the file-level walk already
          // visits every node, and a second traversal per symbol is exactly the cost the
          // TypeScript lane measured and removed.
          const done = frames.pop()!
          if (done.sym !== null) {
            done.sym.metadata.complexity = done.branches
            done.sym.complexity = done.branches
            symbolsWithComplexity++
            // SOL-20 — `qualified_calls`, the field the TypeScript lane populates and
            // this one left unset: the qualified call expressions a symbol MAKES, e.g.
            // `token.transfer`. Collected on the frame and deduplicated on pop, which is
            // the only point where the frame's call set is final. It is charged to the
            // frame's OWN symbol, so a call inside a modifier or a Yul helper is
            // attributed to the code that contains it rather than to whatever
            // declaration the walk started from.
            if (done.qualifiedCalls.length > 0) {
              const uniq = [...new Set(done.qualifiedCalls)].sort()
              // Set under BOTH spellings: `pool-worker`'s symbol builder and the store
              // binding read `qualified_calls`, while the TypeScript lane's convention is
              // the snake name. One of the two is redundant today; which one is an
              // accident of which file reads it, so both are written rather than
              // guessing which side moves.
              done.sym.qualified_calls = uniq
              ;(done.sym as any).qualifiedCalls = uniq
              done.sym.metadata.qualifiedCalls = uniq
              symbolsWithQualifiedCalls++
            }
          }
          openedFrames.delete(nodeKey(node))
        }
        continue
      }

      // SOL-6 — nothing is emitted from a recovery region, and a recovery
      // region's whole SUBTREE is skipped rather than its direct children.
      if (node.type === "ERROR" || node.isMissing) continue

      // CYCLOMATIC COMPLEXITY, counted once per BRANCH and BEFORE the switch,
      // because half of Solidity's branching constructs (`if`, `for`, `while`,
      // `do`-`while`) are in the silent list below — counting them in `default` meant
      // the switch consumed them first and they were never counted at all. Measured
      // on a probe file carrying every branch construct in the language: 4, where
      // there are 7.
      if (isBranchNode(node)) {
        cyclomaticComplexity++
        top().branches++
      }

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
            importEdges.push({ name: alias.text, path: rawPath, line, isNamespace: true })
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
            } else if (!isInterface && !typeNamesInFile.has(baseName) &&
                       projectIndex?.typeKinds.get(baseName) === undefined) {
              // SOL-21 — the index settles this question when it can, so a base the
              // index knows about is NOT counted as undecided. Without the clause this
              // counter reported 507 with the index present and 507 without it, which
              // is the shape of a metric that measures the instrument rather than the
              // thing: the number could not move, so it was not reporting anything.
              extendsUnresolvedAsInterface++
            }
            // SOL-19 — the confidence and the TIER were the defect, not the edge.
            //
            // The inheritance is structural: the tree states that `X` lists `B` in its
            // heritage, and that much is certain. But the ROW'S KIND is part of what it
            // asserts, and when `B` is declared in another file the kind was decided by
            // the ABSENCE of a declaration — the tree does not say whether `B` is an
            // interface. So `extends B` asserts "B is a contract", which is an
            // inference, and it was being published at confidence 1.0 with
            // `evidenceClass: "structural"`.
            //
            // That is the same failure class as a doc number that is accurate but
            // unjustified, and it is worse here: a consumer weighting by tier reads a
            // guess as a fact, and a consumer filtering `extends` to find contracts
            // inherits a mis-typed base. 537 corpus rows carried it.
            //
            // The edge is still emitted — omitting a TRUE inheritance edge to avoid
            // annotating an uncertain kind would trade a labelled fact for a silence,
            // and the label is the whole point. What changes is the claim: 0.9 and
            // `inferred`, with `kindUnresolved`, the kind that was ASSUMED, and a
            // reasonCode, so a consumer can select on exactly this population.
            // SOL-21 — the index answers the question the FILE cannot. `IFeed` in
            // another file is an interface or a contract depending on a declaration this
            // tree does not contain, so with NO index the kind is undecided and the row
            // is labelled `kindUnresolved` at 0.9. With one, it is SETTLED and the row
            // returns to 1.0/`structural` — not a guess being promoted, a guess that
            // stopped being a guess. The absent-index path is untouched, which is what
            // keeps every pre-existing gate meaningful.
            const projectKind = isInterface || typeNamesInFile.has(baseName)
              ? undefined
              : projectIndex?.typeKinds.get(baseName)
            if (projectKind !== undefined) inheritanceKindsResolvedProjectWide++
            const projectIsInterface = projectKind === "interface"
            const kindUnresolved = !isInterface && !typeNamesInFile.has(baseName) &&
              projectKind === undefined
            addRel(name, baseName,
              (isInterface || projectIsInterface)
                ? ASTEngine.RelationshipType.Implements
                : ASTEngine.RelationshipType.Extends,
              kindUnresolved ? 0.9 : 1.0, (anc ?? spec).startPosition.row + 1, {
                isSolidityInheritance: true,
                interfaceResolvedInFile: isInterface,
                ...(kindUnresolved
                  ? {
                    // The tier, stated at the site that knows the claim is undecided.
                    evidenceClass: "inferred",
                    kindUnresolved: true,
                    assumedKind: ASTEngine.RelationshipType.Extends,
                    reasonCode: "base-not-declared-in-file",
                  }
                  : {}),
                // SOL-21 — how the kind was settled, so a consumer can tell a settled
                // cross-file kind from an in-file one. `undefined` for the in-file case,
                // which is the pre-existing shape and needs no new key.
                ...(projectKind !== undefined
                  ? {
                    kindResolvedProjectWide: true,
                    baseDeclarationKind: projectKind,
                  }
                  : {}),
                ...(spec.childForFieldName("ancestor_arguments") ? { hasBaseConstructorArgs: true } : {}),
              })
          }
          basesByContract.set(name, bases)
          openFrame(node, name, name, line, false, true)
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
          const modSym = declareSymbol(name, kind, node, line, meta, collectParameters(node))
          noteMember(top().owner, name)
          // SOL-12, a stated boundary rather than an accident: a file-scope FREE
          // FUNCTION is deliberately NOT added to the module's `exports` surface.
          // `solc` emits an ABI and an abstraction for each contract/interface in
          // a source unit and for nothing else — a free function lives in the
          // unit's bytecode and contributes no ABI entry, so calling it an export
          // would claim a surface the language does not define. Counted in
          // `module-owner-sol1`'s expectRelationshipCount, so widening the
          // boundary is visible rather than silent.
          // SOL-13 — the frame's OWNER is the function itself, not the contract.
          // PowerShell PS3 deliberately keeps a method's owner as the class so a
          // `contains` edge from inside names the class; that is right for
          // PowerShell and WRONG for Solidity, whose locals are strictly
          // function-scoped. `contains C -> ok` says the contract contains a
          // variable it does not contain. The function's own place in the
          // contract is already served by the `contains C -> f` edge emitted at
          // its declaration site, one line above.
          openFrame(node, name, name, line, false, false, modSym)
          break
        }

        case "modifier_definition": {
          const nameNode = node.childForFieldName("name")
          if (!nameNode) break
          const name = nameNode.text
          const line = nameNode.startPosition.row + 1
          modifierNamesInFile.add(name)   // SOL-15
          const meta = modifiersOf(node)
          if (findFirstChild(node, "override_specifier")) {
            meta.overrideExternal = true
            overrideCandidates.push({
              memberName: name, owner: top().owner, line, explicit: [],
              anyBase: basesByContract.get(top().owner) ?? [],
            })
          }
          const fnSym = declareSymbol(name, ASTEngine.SymbolKind.Method, node, line, meta, collectParameters(node))
          noteMember(top().owner, name)
          openFrame(node, name, name, line, false, false, fnSym)   // SOL-13
          break
        }

        // SOL-4 — the name is READ off the `constructor` keyword token. Unlike
        // PowerShell's `Deployment(...)`, Solidity writes the word, so this is not
        // a synthesised name and the line is the real name line.
        case "constructor_definition": {
          const line = node.startPosition.row + 1
          const name = "constructor"
          const ctorSym = declareSymbol(name, ASTEngine.SymbolKind.Constructor, node, line,
            modifiersOf(node), collectParameters(node))
          noteMember(top().owner, name)
          openFrame(node, name, name, line, false, false, ctorSym)   // SOL-13
          break
        }

        // SOL-4 — `receive` and `fallback` share ONE grammar rule
        // (fallback_receive_definition), split by the leading keyword token.
        case "fallback_receive_definition": {
          const first = node.childCount > 0 ? node.child(0) : null
          const name = first !== null && first.type === "receive" ? "receive" : "fallback"
          const line = node.startPosition.row + 1
          const fbSym = declareSymbol(name, ASTEngine.SymbolKind.Method, node, line,
            { ...modifiersOf(node), isFallbackOrReceive: true }, collectParameters(node))
          noteMember(top().owner, name)
          openFrame(node, name, name, line, false, false, fbSym)   // SOL-13
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
          // SOL-14, checked BEFORE the getter so the two cannot disagree. The
          // fixture that found this had `root` refused as a declaration while
          // `root()` was still published and still linked by
          // `references root -> root()` — an edge whose SOURCE was not a symbol,
          // which is the same dangling shape SOL-14 exists to prevent, reached
          // through the getter path because the getter is published by
          // `pushSymbol` and the refusal lived in `declareSymbol`.
          if (STORE_REFUSED_SYMBOL_NAMES.has(name)) {
            storeRefusedDeclarations++
            storeRefusedNames.add(name)
            // `break`, NOT `return`: this is a `switch` case inside the walk's
            // `while`, so `return` would exit `analyze` itself and the whole file
            // would come back as `undefined` — which `JSON.stringify` renders as a
            // clean-looking absence rather than an error (M60 §5.5). Measured by
            // running it: `r.relationships` was not an object at all.
            break
          }
          // SOL-3 — the synthesised getter, published under its real name.
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
            if (getter) {
              getterSymbols++
              // SOL-13 — the getter's owner is the CONTRACT, so `contains
              // Contract -> balance()` is emitted here. Without it the getter was
              // a symbol no containment edge reached: measured on the fixture that
              // wrote this decision down, `contains Vault -> balance()` was
              // absent while `balance()` existed as a symbol, so the contract's
              // member surface — the thing a reader opens the contract for — was
              // missing a function the contract really has. SOL-12's boundary is
              // about the MODULE's export surface and says nothing about contract
              // membership, so this edge is not in tension with it.
              const getterOwner = top().owner
              if (getterOwner && getterOwner !== getterName) {
                addRel(getterOwner, getterName, ASTEngine.RelationshipType.Contains, 1.0, line, {
                  isSynthesisedGetter: true,
                  getterOfVariable: name,
                })
              }
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
          //
          // The children are `yul_identifier`, NOT `identifier`: grammar.js:398
          // declares `yul_identifier: $ => $.identifier`, an ALIAS, so the node
          // type on the wire is `yul_identifier` wrapping an `identifier`. Reading
          // `identifier` children found none, and the first Yul fixture emitted
          // ZERO path reads — 2,640 `yul_path` nodes in the corpus, none of them
          // ever read. Read the alias, which is what the tree actually says.
          const segs = findChildren(node, "yul_identifier")
          const segTexts: Node[] = segs.length > 0 ? segs : findChildren(node, "identifier")
          segTexts.forEach((seg, i) => {
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
          // Defence in depth with SOL-2: a global is not a type either. The read
          // rule refuses `this`/`msg`/… but the user_defined_type case is a
          // different branch, and a recovery-region fragment that parses as a type
          // name reached it (measured: `uses -> this` with
          // `isTypeReference: true` on a line the parser could not handle).
          if (name !== "" && !GLOBAL_OBJECTS.has(name)) {
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

        // `using {eqCallType as ==} for CallType global;` — NEVER FIRED before
        // SOL-16. It looked for DIRECT `identifier` children, but the grammar nests
        // the name: `using_alias (user_defined_type (identifier))
        // (user_definable_operator)`, so `findChildren(node, "identifier")` was always
        // empty and the loop body never ran. Found by a per-case emit census over the
        // 389-file corpus — 4 `using_alias` nodes, all four in
        // contracts/account/utils/draft-ERC7579Utils.sol, 0 edges — which is the same
        // signature as the `revert_statement` dead branch, and the reason the census is
        // worth running rather than reading the code.
        //
        // The name is read the way every other type reference in this analyzer reads
        // one, through `udtName`, so it cannot disagree with the rest.
        case "using_alias": {
          const name = udtName(findDescendant(node, "user_defined_type"))
          if (name !== "") {
            addRel(top().scope, name, ASTEngine.RelationshipType.References, 0.85,
              (findDescendant(node, "user_defined_type") ?? node).startPosition.row + 1,
              { isUsingAliasFunction: true })
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
            // SOL-20 — the qualified form of the callee, recorded on the enclosing
            // frame so it lands on that symbol. Read here rather than in a post-pass
            // because `innerCalleeOf` is only in scope at the emit, and a post-pass
            // would have only the target NAME — which is exactly what cannot distinguish
            // `token.transfer` from `vault.transfer`, the two calls a reader most needs
            // told apart.
            const qObj = got.viaMember ? memberObjectName(innerCalleeOf(fn)) : ""
            // `abi.encode` and `type(X).y` are LANGUAGE NAMESPACES, not calls on an
            // object — publishing them as qualified calls would put `abi.encode` beside
            // `target.call` in the same list, which is the distinction a reader of this
            // field most needs. `super.f()` and `this.f()` ARE object calls and are
            // kept: `super.supportsInterface` says something a bare `supportsInterface`
            // cannot. This reuses the `namespaceBuiltin` split SOL-15 already draws
            // rather than inventing a second judgement.
            if (qObj !== "" && qObj !== "abi" && qObj !== "type" && !ENGINE_FUNCTION_NAMES.has(got.name)) {
              top().qualifiedCalls.push(`${qObj}.${got.name}`)
            }
            addRel(top().scope, got.name, ASTEngine.RelationshipType.Calls, 0.9, got.line, {
              isSolidityCall: true,
              // The member flag is REPORTED BY THE NAME RESOLVER, never by a second
              // traversal that re-decides the same question. The first version ran a
              // separate `isMemberLike(fn)` over the callee's DIRECT children, which
              // cannot see a `member_expression` nested under a `struct_expression`'s
              // `type:` field — so `t.call{value: 1}("")` resolved the name `call`
              // and then failed to say it was a member call, and the reserved-token
              // rule deleted the edge it had just resolved. `call`, `balance` and
              // `delegatecall` are EVM opcode TOKENS and also members of Solidity's
              // built-in types, so that deletion was silent and total. The name and
              // the fact about where it came from now cannot disagree.
              ...(got.viaMember ? { isMemberCall: true } : {}),
              // SOL-15 — the OBJECT a member call hangs off. `abi.encode(…)` and
              // `token.balanceOf(…)` are both `member_expression` callees, and only
              // the object separates a language builtin from a project member. Read
              // HERE, at the emit, because the post-pass has the callee NAME and
              // nothing else: `encode` alone cannot say which of the two it was.
              ...(got.viaMember ? { calleeObject: qObj } : {}),
              // SOL-15 — the enclosing TYPE, captured here because the relationship's
              // SOURCE is the enclosing scope's LEAF name (`everything`, not
              // `Child.everything`), so the owner cannot be recovered from the row
              // afterwards. The first version tried, got no owner, and classified
              // every call as `inFileTypeMember` — a wrong answer produced by a
              // missing field rather than a wrong rule, which is the harder kind of
              // bug to see because the rule looks fine.
              ...(enclosingTypeOf() !== "" ? { calleeOwner: enclosingTypeOf() } : {}),
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
        // A CUSTOM ERROR is a call, and this case NEVER FIRED before SOL-15 measured
        // it. It tested `node.namedChild(0).type === "identifier"`, but the grammar
        // puts an `expression` WRAPPER there for all three spellings —
        // `revert Boom(1);`, `revert Solo;` and `revert("x");` each report
        // `expression` — so the guard was false for every possible input and the
        // branch was decoration. The corpus has custom errors declared in
        // `contracts/interfaces/draft-IERC6093.sol` and elsewhere, and not one
        // reached the graph as a call.
        //
        // The name is the same leaf the callee resolver reads, so `revert Boom(1)`
        // resolves through the call's `function` field and `revert Solo` through the
        // wrapper, and `revert("x")` resolves to nothing at all — a string is not a
        // name, which is the correct outcome rather than a missed row.
        case "revert_statement": {
          const first = node.namedChildCount > 0 ? node.namedChild(0) : null
          const calleeNode = first === null ? null
            : first.type === "call_expression" ? innerCalleeOf(first.childForFieldName("function"))
              : innerCalleeOf(first)
          const got = calleeNameOf(calleeNode)
          if (got && got.name !== "") {
            addRel(top().scope, got.name, ASTEngine.RelationshipType.Calls, 0.9,
              got.line, {
                isCustomErrorRevert: true,
                ...(enclosingTypeOf() !== "" ? { calleeOwner: enclosingTypeOf() } : {}),
              })
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
          if (isClaimedCalleeDirect(node)) break
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
          // Every other construct: descend, emit nothing. The complexity count
          // happens above the switch — see the note there for why it cannot live in
          // this branch.
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
    let overridesEmittedExternal = 0
    let overridesUnresolved = 0
    /** SOL-11 — refused because a bare `override` over 2+ bases says one of them
     *  declares the member without saying which. A real ambiguity, not a gap. */
    let overridesAmbiguousBaseCount = 0
    for (const cand of overrideCandidates) {
      // SOL-11 — a bare `override` over SEVERAL header bases is genuinely
      // ambiguous (which base declares it?), and stays refused. An EXPLICIT list is
      // not: the compiler enforces that each named base declares the member.
      const bases = cand.explicit.length > 0
        ? cand.explicit
        : (cand.anyBase.length === 1 ? cand.anyBase : [])
      // `bases` IS the policy: an explicit list, else the single header base, else
      // empty for the 2+-bases case. So emptiness is the ONLY refusal condition,
      // and it is decided before the loop — gating inside the loop on `inFile` is
      // what made both an earlier draft drop the explicit-list case and a later one
      // drop the single-header-base case. Two bugs, one bad guard.
      if (bases.length === 0) {
        overridesUnresolved++
        overridesAmbiguousBaseCount++
        continue
      }
      let hit = false
      for (const base of bases) {
        // A contract listing ITSELF in `override(A, B)` is a diamond-inheritance
        // shape the grammar accepts; `overrides g -> B` inside `B` would be a
        // function overriding a member of its own owner, which is not a thing.
        if (base === cand.owner) continue
        if (!symbolMap.has(`${cand.owner}\u0000${cand.memberName}\u0000method`)) continue
        const members = membersByType.get(base)
        const inFile = members !== undefined && members.has(cand.memberName)
        // The shared companion hook, for the callers that DO populate it. Nothing
        // in production does — see the header — but reading it costs one lookup and
        // means this lane participates rather than only bypassing it.
        const companion = context?.overrideCompanion?.get(base)
        const viaCompanion = !inFile && companion !== undefined && companion.has(cand.memberName)
        const external = !inFile
        addRel(cand.memberName, base, ASTEngine.RelationshipType.Overrides, external ? 0.75 : 0.9, cand.line, {
          overridesMember: cand.memberName,
          baseType: base,
          ...(cand.explicit.length > 0 ? { baseNamedByOverrideSpecifier: true } : { baseFromContractHeader: true }),
          ...(external
            ? {
              externalBase: true,
              // A single header base is as strong as an explicit list: the compiler
              // requires SOME base to declare the member and there is only one
              // candidate. The reasonCode distinguishes them rather than merging
              // two different proofs under one label.
              reasonCode: cand.explicit.length > 0
                ? "named-by-override-specifier"
                : (viaCompanion ? "companion-index" : "single-header-base"),
              ...(viaCompanion ? { crossFileVerified: true } : {}),
            }
            : {}),
        })
        overridesEmitted++
        if (external) overridesEmittedExternal++
        hit = true
      }
      if (!hit) overridesUnresolved++
    }

    // ------------------------------------------------------------- SOL-15 calls
    // WHAT THIS IS FOR. Every `calls` edge used to be emitted from the callee NAME
    // ALONE, with no statement of whether that name is a symbol at all. The corpus
    // census then reported 1,786 targets "resolving to no declared symbol" and the
    // doc called the whole class expected — which is honest as far as it goes and
    // useless as a gate, because it lumps together four things that have nothing to
    // do with each other:
    //
    //   · `uint256(x)`, `address(p)` — a CONVERSION. Solidity's grammar models it as
    //     a `call_expression` whose callee is a `primitive_type`, so it is not a
    //     function call and its target is not a symbol. 40 in the corpus.
    //   · `abi.encode(…)`, `type(IERC20).interfaceId`, `super.f()`, `this.f()` — a
    //     language NAMESPACE, not a project member. 270.
    //   · a call to a modifier (`initializer()`), which invokes code but is not a
    //     function. 24 by name; see modifierNamesInFile.
    //   · and only then the real residue: a member or free function that this file
    //     cannot see because it is declared in ANOTHER file.
    //
    // So every `calls` edge now carries `calleeKind`, DERIVED — from the grammar for
    // the first two (the callee node's own type, and the member object), and from
    // this file's own declarations plus the inheritance closure for the rest. There
    // is deliberately NO hand-written list of "builtin member names" here. The first
    // draft of this measurement had one, containing `at`, `contains` and `length` —
    // and those are user-defined `EnumerableSet` methods declared in another file,
    // so the list would have silently reclassified real project edges as builtins.
    // A classification that needs a curated list to avoid eating live relationships
    // is not a classification.
    //
    // WHY A POST-PASS. Calls are emitted DURING the walk and a declaration may follow
    // its use — legal Solidity, and the corpus does it. Same reason SOL-11's override
    // resolution is a post-pass.
    const memberClosure = (owner: string, seen = new Set<string>()): Set<string> => {
      const out = new Set<string>()
      if (seen.has(owner)) return out
      seen.add(owner)
      for (const m of membersByType.get(owner) ?? []) out.add(m)
      for (const b of basesByContract.get(owner) ?? []) {
        for (const m of memberClosure(b, seen)) out.add(m)
      }
      return out
    }
    const closures = new Map<string, Set<string>>()
    for (const owner of membersByType.keys()) closures.set(owner, memberClosure(owner))

    const callKinds: Record<string, number> = {
      conversion: 0, namespaceBuiltin: 0, modifierInvocation: 0,
      localFunction: 0, inheritedMember: 0, inFileTypeMember: 0,
      crossFileInheritedMember: 0, projectMemberCandidate: 0,
      eventEmission: 0, errorRevert: 0, structConstructor: 0, external: 0,
    }
    // SOL-21 — the index's inheritance-closed member set per type, and the
    // name -> declaring-types table. Built once per file from the shared index rather
    // than per call, because a per-call walk of the inheritance graph is the shape of a
    // quadratic pass and this classifier runs on every call in the file.
    const projectAllMembers = new Map<string, Set<string>>()
    const projectMemberOwners = new Map<string, Set<string>>()
    if (projectIndex) {
      const { memberOwners, allMembers } = buildResolutionTables(projectIndex)
      for (const [t, ms] of allMembers) projectAllMembers.set(t, ms)
      for (const [m, ts] of memberOwners) projectMemberOwners.set(m, ts)
    }
    for (const rel of relationships) {
      if (rel.type !== ASTEngine.RelationshipType.Calls) continue
      const md = rel.metadata as Record<string, unknown>
      // The SOURCE is the enclosing scope's qualified name, so the owner is
      // everything before the final separator. A file-scope source has no owner.
      const owner = typeof md.calleeOwner === "string" ? md.calleeOwner : ""
      const ownDirect = new Set<string>(membersByType.get(owner) ?? [])
      const ownInherited = new Set<string>()
      for (const b of basesByContract.get(owner) ?? []) {
        for (const m of memberClosure(b)) ownInherited.add(m)
      }
      const kind = ((): string => {
        // The three non-call shapes this language routes through `calls`, each tagged
      // by its OWN emit site: `emit E(...)`, `revert MyError(...)`, and `S{...}`.
      if (md.isEventEmission === true) return "eventEmission"
      if (md.isCustomErrorRevert === true) return "errorRevert"
      if (md.isStructConstructor === true) return "structConstructor"
        // A conversion's callee IS a primitive type word, which the reserved-token
        // module already recognises MECHANICALLY (`uint`/`int`/`bytes` + digits, or
        // a fixed type word) — so this needs no list of type names.
        if (isPrimitiveTypeToken(rel.target)) return "conversion"
        const obj = typeof md.calleeObject === "string" ? md.calleeObject : ""
        if (obj === "abi" || obj === "type" || obj === "super" || obj === "this") return "namespaceBuiltin"
        if (modifierNamesInFile.has(rel.target)) return "modifierInvocation"
        // ORDER MATTERS, and the first draft had it wrong in a way no corpus row
        // could catch: `own` was the member CLOSURE, which already contains the
        // inherited members, so `own.has(target)` was true for an inherited call and
        // EVERYTHING resolved as `localFunction` — leaving `inheritedMember`
        // unreachable. A classification whose most interesting branch cannot fire is
        // not tested by the corpus, because the corpus happens to have zero
        // same-file calls at all (measured: localFunction 0, inheritedMember 0 over
        // 3,878 edges — OpenZeppelin calls out of the file almost every time). The
        // fixture is what tests it, which is why validation/m14/fixtures/solidity/
        // call-resolution-sol15.sol exists.
        //
        // 1. declared directly on the enclosing type — a local function
        if (ownDirect.has(rel.target)) return "localFunction"
        // 2. reachable through an in-file base — an inherited member
        if (ownInherited.has(rel.target)) return "inheritedMember"
        // 3. a member of SOME OTHER in-file type reached through a receiver or a
        //    `using X for T` directive. Named `inFileTypeMember` rather than
        //    `libraryFunction` because a receiver can be a CONTRACT or a STRUCT too,
        //    and calling that "library" would state something the tree does not say.
        for (const [otherOwner, set] of membersByType) {
          if (otherOwner === owner) continue
          if (set.has(rel.target)) return "inFileTypeMember"
        }
        // SOL-21 — CROSS-FILE RESOLUTION, in two grades, and the grades are NOT
        // interchangeable. The project-wide census measured the split before this was
        // written, which is why it is two rows rather than one optimistic one:
        //
        //   crossFileInheritedMember  the OWNING contract's ancestors — followed
        //     through the index's inheritance graph — declare this name. The call site
        //     proves which type it means, because the owner is known and its ancestors
        //     are a fixed set. This is a RESOLUTION.
        //
        //   projectMemberCandidate  some project type declares this name, but WHICH one
        //     is undecidable: a Solidity `calls` edge carries no receiver type for a
        //     free function, so `toUint(x)` could be `SafeCast.toUint` or anything else
        //     that declares it. Naming the candidates is real information; calling it a
        //     resolution would not be.
        //
        // Collapsing these two would have turned 1,134 honest candidates into 1,134
        // confident facts, which is the exact failure this repo's evidence tiers exist
        // to prevent.
        if (projectIndex) {
          const closed = projectAllMembers.get(owner)
          if (closed?.has(rel.target)) return "crossFileInheritedMember"
          const owners = projectMemberOwners.get(rel.target)
          if (owners) return "projectMemberCandidate"
        }
        return "external"
      })()
      md.calleeKind = kind
      callKinds[kind] = (callKinds[kind] ?? 0) + 1
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
        // A namespace import IS a namespace import, and the ALIASED form
        // (`import * as Utils from …`) was not labelled as one — only the bare form
        // carried the marker. So nothing in the output said which edges came from a
        // namespace import, and the marker selected the wrong set: a filter keyed on
        // `isNamespaceImport` removed the bare import (which the F9 gate already
        // suppresses) and left the aliased one standing.
        ...(e.isNamespace ? { isNamespaceImport: true } : {}),
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
        commentsRead,
        commentsAttached,
        documentedSymbols,
        symbolsWithComplexity,
        symbolsWithQualifiedCalls,
        inheritanceKindsResolvedProjectWide,
        callKinds,
        overridesEmitted,
        overridesEmittedExternal,
        overridesUnresolved,
        overridesAmbiguousBaseCount,
        engineCallsSuppressed,
        getterSymbols,
        storeRefusedDeclarations,
        storeRefusedNames: [...storeRefusedNames].sort(),
        symbolsSuppressedOnRecoveryLines,
        // The SET, not just the count, and for a testable reason: SOL-6's mutant
        // has to reinstate what the narrower rule would have emitted, and a revert
        // written from a count alone cannot be written generically — it would have
        // to hard-code the fixture's line, which measures the fixture rather than
        // the behaviour. The list is also the same fact at a resolution a reader
        // wants: which lines of this file the parser could not handle.
        recoveryLinesList: [...recoveryLines].sort((a, b) => a - b),
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
