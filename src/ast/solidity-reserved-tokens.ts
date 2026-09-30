/**
 * DERIVED, NOT REMEMBERED: every alphabetic ANONYMOUS TOKEN of the vendored
 * grammar, `grammars/tree-sitter-solidity/src/grammar.json`.
 *
 * Re-derive it with:
 *   bun run script/m60/solidity-reserved-words.ts --print
 * and the script asserts that this array equals what it derives, so this file
 * cannot drift from the grammar it claims to describe. That self-check is the
 * whole reason the array lives in its own module rather than inside the analyzer:
 * a derived set that only the author can verify is an assertion wearing a
 * derivation's clothes.
 *
 * WHY IT EXISTS. Solidity identifiers are `[A-Za-z_$][A-Za-z0-9_$]*` and none of
 * these tokens can be one, so a `calls`, `uses` or `instantiates` edge naming one
 * is a fabrication by construction — it is how a `require(...)` or a `keccak256(...)`
 * becomes a graph fact about a function that does not exist. PowerShell hit this
 * class for real: 6 fabricated `calls` edges naming its own block keywords, found
 * by a census rather than by a gate, because no `hasError`-keyed gate in this repo
 * can see it (the reserved-word residue parses CLEAN).
 *
 * ONE COPY OF THE RULE. The analyzer imports `isReservedTarget` to REFUSE these
 * edges, and the surface measure imports the same predicate to COUNT them. A
 * sibling lane had to learn this the hard way: two instruments that must agree
 * may not each hold their own copy, because they then disagree silently and
 * neither number is trustworthy.
 *
 * WHAT IT DELIBERATELY CONTAINS. It contains the 229 primitive TYPE tokens
 * (`uint256`, `bytes32`, `bool`, `string`, `address`, `int8`…) because they are
 * keywords in the grammar, and it contains the EVM/Yul opcodes (`add`, `sload`,
 * `mstore`, `log0`…) because those are tokens too. That is correct and not
 * over-broad: a `calls` edge naming `uint256` or `add` is equally impossible. A
 * `uses` edge naming `uint256` IS possible and IS legitimate — it is a reference
 * to a language-supplied type — so the predicate is applied to `calls`,
 * `instantiates`, and to `uses` only where the edge is not a type reference. The
 * distinction is the ANALYZER's to declare (it knows which of its edges is a type
 * mention) and the gate's to check; `isReservedTarget` documents both.
 */
export const RESERVED_TOKENS: ReadonlySet<string> = new Set([
  "_", "abstract", "add", "addmod",
  "address", "and", "anonymous", "as",
  "assembly", "at", "balance", "basefee",
  "blobbasefee", "blobfee", "blobhash", "blockhash",
  "bool", "break", "byte", "bytes",
  "bytes1", "bytes10", "bytes11", "bytes12",
  "bytes13", "bytes14", "bytes15", "bytes16",
  "bytes17", "bytes18", "bytes19", "bytes2",
  "bytes20", "bytes21", "bytes22", "bytes23",
  "bytes24", "bytes25", "bytes26", "bytes27",
  "bytes28", "bytes29", "bytes3", "bytes30",
  "bytes31", "bytes32", "bytes4", "bytes5",
  "bytes6", "bytes7", "bytes8", "bytes9",
  "call", "callcode", "calldata", "calldatacopy",
  "calldataload", "calldatasize", "caller", "callvalue",
  "case", "catch", "chainid", "coinbase",
  "constant", "constructor", "continue", "contract",
  "create", "create2", "days", "default",
  "delegatecall", "delete", "difficulty", "div",
  "do", "else", "emit", "enum",
  "eq", "error", "ether", "event",
  "exp", "extcodecopy", "extcodehash", "extcodesize",
  "external", "fallback", "false", "finney",
  "fixed", "for", "from", "function",
  "gas", "gaslimit", "gasprice", "global",
  "gt", "gwei", "hex", "hours",
  "if", "immutable", "import", "indexed",
  "int", "int104", "int112", "int120",
  "int128", "int136", "int144", "int152",
  "int16", "int160", "int168", "int176",
  "int184", "int192", "int200", "int208",
  "int216", "int224", "int232", "int24",
  "int240", "int248", "int256", "int32",
  "int40", "int48", "int56", "int64",
  "int72", "int8", "int80", "int88",
  "int96", "interface", "internal", "invalid",
  "is", "iszero", "keccak256", "layout",
  "leave", "let", "library", "log0",
  "log1", "log2", "log3", "log4",
  "lt", "mapping", "mcopy", "memory",
  "minutes", "mload", "mod", "modifier",
  "msize", "mstore", "mstore8", "mul",
  "mulmod", "new", "not", "number",
  "or", "origin", "override", "payable",
  "pop", "pragma", "prevrandao", "private",
  "public", "pure", "receive", "return",
  "returndatacopy", "returndatasize", "returns", "revert",
  "sar", "sdiv", "seconds", "selfbalance",
  "selfdestruct", "sgt", "shl", "shr",
  "signextend", "sload", "slt", "smod",
  "solidity", "sstore", "staticcall", "stop",
  "storage", "string", "struct", "sub",
  "switch", "szabo", "timestamp", "tload",
  "transient", "true", "try", "tstore",
  "type", "ufixed", "uint", "uint104",
  "uint112", "uint120", "uint128", "uint136",
  "uint144", "uint152", "uint16", "uint160",
  "uint168", "uint176", "uint184", "uint192",
  "uint200", "uint208", "uint216", "uint224",
  "uint232", "uint24", "uint240", "uint248",
  "uint256", "uint32", "uint40", "uint48",
  "uint56", "uint64", "uint72", "uint8",
  "uint80", "uint88", "uint96", "unchecked",
  "unicode", "using", "var", "view",
  "virtual", "weeks", "wei", "while",
  "xor", "years",])

/** The primitive TYPE tokens, recognisable from the shape alone. Purely
 *  mechanical so it cannot drift: `uint`/`int`/`bytes` + digits, or one of the
 *  fixed-length type words. Kept separate so a caller can tell a legitimate type
 *  mention from a fabricated call without maintaining a hand list. */
export const isPrimitiveTypeToken = (name: string): boolean => {
  const has = (prefix: string): boolean =>
    name.length > prefix.length && name.startsWith(prefix) && isAllDigits(name.slice(prefix.length))
  if (name === "bool" || name === "string" || name === "address" ||
      name === "byte" || name === "bytes" || name === "fixed" || name === "ufixed") return true
  return has("uint") || has("int") || has("bytes")
}

const isAllDigits = (text: string): boolean => {
  if (text.length === 0) return false
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c < 48 || c > 57) return false
  }
  return true
}

/**
 * Would an edge to `target` of this `type` be a fabrication?
 *
 * `calls` / `instantiates`, BARE (no object): yes for any reserved token. Nothing
 * in Solidity can be called or constructed under a keyword's name, so `calls ->
 * keccak256` is always a fabrication.
 *
 * `calls` through a MEMBER (`x.call(…)`, `t.balance()`, `a.delegatecall(…)`):
 * NO, and the distinction is not pedantry. `call`, `balance` and `delegatecall`
 * are EVM OPCODE tokens and they are ALSO members of Solidity's built-in types,
 * so `RESERVED_TOKENS` contains all three. Applying the bare rule to a member call
 * deleted every one of them: a fixture written to pin the call shapes produced NO
 * edge for `t.call{value: 1}("")`, and the surface measure cannot even report the
 * loss because the edge never existed to be counted. A callee reached through an
 * object is named by that object's type, not by the global namespace, so the
 * global-namespace rule does not apply to it. The analyzer marks the edge
 * `isMemberCall`, and both sides call this one function — the flag cannot be
 * waved around silently because the negative controls below pin the behaviour of
 * both directions.
 *
 * `uses`: yes for a reserved token UNLESS the analyzer has declared the edge a
 * type reference, because `uses -> uint256` names a real language type and is the
 * honest edge for a declared `uint256` field. A member read is exempt for the
 * same reason a member call is.
 *
 * `contains` / `extends` / `implements` / `exports` / `references`: a reserved
 * token as a DECLARED name is impossible too, but these are checked by the
 * unknown-target metric, and folding them in here would make one number mean two
 * things.
 */
export const isReservedTarget = (type: string, target: string, metadata?: Record<string, unknown>): boolean => {
  if (target.length === 0) return false
  const meta = metadata ?? {}
  // SOL-7 / SOL-9 — a target reached THROUGH an object belongs to that object's
  // type, not to the language's global namespace, so neither the keyword rule nor
  // the opcode-token rule applies to it.
  const viaMember =
    meta.isMemberCall === true || meta.isMemberReference === true || meta.isTypeReference === true
  if (type === "calls") {
    if (viaMember) return false
    return RESERVED_TOKENS.has(target)
  }
  if (type === "instantiates") return RESERVED_TOKENS.has(target)
  if (type === "uses") {
    if (viaMember) return false
    return RESERVED_TOKENS.has(target)
  }
  return false
}

/**
 * SOL-7b — the engine functions the GRAMMAR CANNOT MARK.
 *
 * RESERVED_TOKENS alone is NOT sufficient against a fabricated call, and the
 * reason is the finding this module exists to hold:
 *
 *   `keccak256` IS one of the grammar's 262 alphabetic tokens, and in CALL
 *   position the lexer still produces a plain `identifier`. A token only appears
 *   where the grammar expects that literal, and `NAME()` is not such a place.
 *
 * So "it is a keyword, the token set covers it" reads as obviously true and is
 * wrong for 15 of Solidity's 17 builtin functions. `require(x)` and
 * `function require() internal {}` produce IDENTICAL trees, which means no
 * `hasError`-keyed gate in this repo can see a fabricated `calls -> require` —
 * exactly the PowerShell PS5 failure, where 6 fabricated edges naming the
 * language's own block keywords were found by a census rather than by a gate.
 *
 * DERIVED, not remembered: `bun run script/m60/solidity-reserved-words.ts` parses
 * `contract T { function t() public { NAME(); } }` for each candidate against the
 * wired wasm and reports the callee node type. Measured buckets:
 *   bare `identifier`, 15 — these need the entry below
 *   no `call_expression` at all, 2 — `type` (meta_type_expression) and `revert`
 *     (revert_statement) each have a dedicated node type, so they are
 *     structurally impossible as call targets and need no entry.
 */
export const ENGINE_FUNCTION_NAMES: ReadonlySet<string> = new Set([
  "require", "assert", "gasleft", "sha256", "ripemd160", "ecrecover", "suicide",
  "keccak256", "sha3", "gas", "blockhash", "blobhash", "selfdestruct",
  "addmod", "mulmod",
])

/**
 * The STORE refuses these symbol names, so this lane must not DECLARE them.
 *
 * MEASURED, and the measurement is the whole point. pool-worker.ts filters every
 * analyzer's symbols through a `UNIVERSAL` denylist whose comment says these are
 * "never legitimate declarations in any language". For Solidity that is false for
 * two of them, and both occur in the pinned corpus at this rev:
 *
 *   · `self`  — `Link storage self = _links[chain];` in
 *               contracts/crosschain/CrosschainLinked.sol:59
 *   · `root`  — `bytes32 public root;` in
 *               contracts/mocks/MerkleTreeMock.sol:15
 *
 * So the store drops both symbols while the analyzer's `contains` edge naming them
 * survives, and the surface measure caught the result as 2 unknown `contains`
 * targets. That is not a Solidity bug in the grammar sense; it is a shared-store
 * over-reach, and it is the SAME class the file two blocks above its own list
 * already documents having fixed once:
 *
 *     // JS-global names are only noise for JS-family languages. A method
 *     // named `process` (Scala/Python/Java), `window` or `module` is a
 *     // legitimate declaration elsewhere — applying the JS global list
 *     // cross-language silently dropped real symbols.
 *
 * The JS list was made language-scoped; the `UNIVERSAL` list reintroduced the same
 * defect one block later. The narrowest fix INSIDE this lane is to refuse the
 * declaration, so no `contains` edge can point at a symbol the store will drop —
 * the same discipline as refusing a non-positive `line_number` at the single emit
 * helper. The correct fix is in pool-worker.ts, which this lane does not own, so
 * the drift between the two lists is made LOUD instead: the check below is
 * re-derived from pool-worker's own source by
 * `script/m60/solidity-reserved-words.ts`, which fails if the two disagree.
 *
 * `constructor` is deliberately NOT here, for the same reason pool-worker's comment
 * gives for excluding it: it is a first-class declaration in TS/JS, and it is
 * Solidity's own constructor keyword (SOL-4).
 */
export const STORE_REFUSED_SYMBOL_NAMES: ReadonlySet<string> = new Set([
  "this", "super", "self", "Self", "me", "My",
  "destructor",
  "root", "program", "source_file", "module_declaration",
  "package_manifest", "GlobalScope", "SCSS_FILE_SCOPE",
  "unknown",
])
