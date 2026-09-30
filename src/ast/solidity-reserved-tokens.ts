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
 * `calls` and `instantiates`: yes for any reserved token — nothing in Solidity
 * can be called or constructed under a keyword's name.
 * `uses`: yes for a reserved token UNLESS the analyzer has declared the edge a
 * type reference, because `uses -> uint256` names a real language type and is
 * the honest edge for a declared `uint256` field.
 * `contains` / `extends` / `implements` / `exports` / `references`: a reserved
 * token as a DECLARED name is impossible too, but these are checked separately by
 * the unknown-target metric, and folding them in here would make one number mean
 * two things.
 */
export const isReservedTarget = (type: string, target: string, metadata?: Record<string, unknown>): boolean => {
  if (target.length === 0) return false
  if (type === "calls" || type === "instantiates") return RESERVED_TOKENS.has(target)
  if (type === "uses") {
    if (metadata && metadata.isTypeReference === true) return false
    return RESERVED_TOKENS.has(target)
  }
  return false
}
