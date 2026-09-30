#!/usr/bin/env bun
/**
 * script/m60/solidity-reserved-words.ts — the Solidity lane's RESERVED-TARGET
 * rule, and the instrument that keeps the two copies honest.
 *
 * WHY THIS IS ITS OWN FILE. There are exactly TWO places a "can this name be a
 * project symbol?" rule is needed — the analyzer, which must REFUSE a fabricated
 * edge, and the surface measure, which must COUNT one — and a sibling lane had to
 * learn the hard way that two instruments which must agree may not each hold
 * their own copy. PowerShell's surface measure first recovered the reserved set by
 * PARSING the census's source with a regex, captured 36 of its names, and so the
 * two instruments disagreed (`census clean, surface reserved=10`) with neither
 * number trustworthy. So the rule lives once, in `src/ast/solidity-reserved-tokens.ts`,
 * and BOTH sides import it.
 *
 * WHAT IT DERIVES, TWICE, FROM DIFFERENT SOURCES
 * ----------------------------------------------
 *  1. `RESERVED_TOKENS` — every alphabetic ANONYMOUS TOKEN of
 *     `grammars/tree-sitter-solidity/src/grammar.json`. Asserted against the
 *     module, so the module cannot drift from the grammar it claims to describe.
 *     This is what makes a `calls -> keccak256` impossible: nothing in Solidity
 *     can be called under a token's name.
 *
 *  2. `ENGINE_FUNCTION_IDENTIFIERS` — the builtins the grammar CANNOT mark,
 *     because they lex as ordinary `identifier`s. This set is derived by BEHAVIOUR
 *     rather than by memory: for each candidate, parse `contract T { function t()
 *     public { NAME(); } }` against the wired wasm and ask whether the callee node
 *     is a bare `identifier`. Measured result — 6 of the 13 need the declared
 *     list and 7 are already covered by (1):
 *
 *       bare identifier, so a declared entry is REQUIRED:
 *         require  assert  gasleft  sha256  ripemd160  ecrecover
 *       grammar token, already covered by RESERVED_TOKENS:
 *         keccak256  sha3  gas  blockhash  blobhash  selfdestruct  addmod  mulmod
 *
 *     That split is not a detail. `require(x)` and `function require() internal {}`
 *     produce IDENTICAL trees — the grammar cannot tell them apart — so no
 *     `hasError`-keyed gate in this repo can see a fabricated `calls -> require`,
 *     which is precisely the PowerShell PS5 failure (6 fabricated edges naming its
 *     own block keywords, found by a census, not by a gate). Hence the emit-site
 *     refusal AND the counted residue, so a NEW engine builtin cannot land
 *     silently: `analyzerSuppressedEngineCalls` in the analyzer's metadata is the
 *     count, and a name appearing in `calls` that is neither declared in the file
 *     nor on either list is exactly what the surface measure's `engineMemberCalls`
 *     row reports.
 *
 * Usage:
 *   bun run script/m60/solidity-reserved-words.ts            # verify + report
 *   bun run script/m60/solidity-reserved-words.ts --print    # print the token list
 *   bun run script/m60/solidity-reserved-words.ts --selftest # negative controls
 */
import * as fs from "node:fs"
import * as path from "node:path"
import * as WTS from "web-tree-sitter"
import {
  RESERVED_TOKENS, isPrimitiveTypeToken, isReservedTarget, STORE_REFUSED_SYMBOL_NAMES,
} from "../../src/ast/solidity-reserved-tokens"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const GRAMMAR_JSON = path.join(ROOT, "grammars/tree-sitter-solidity/src/grammar.json")
const argv = process.argv.slice(2)

/** Is this an identifier-shaped word? Purely mechanical, so it cannot drift. */
const isIdentShaped = (v: unknown): v is string => {
  if (typeof v !== "string" || v.length === 0) return false
  const c0 = v.charCodeAt(0)
  const head = (c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122) || c0 === 95
  if (!head) return false
  for (let i = 1; i < v.length; i++) {
    const c = v.charCodeAt(i)
    if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95)) return false
  }
  return true
}

/** Every alphabetic anonymous token, derived from the grammar. */
function deriveReservedTokens(): Set<string> {
  const g = JSON.parse(fs.readFileSync(GRAMMAR_JSON, "utf8"))
  const out = new Set<string>()
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) { for (const x of n) walk(x); return }
    if (n === null || typeof n !== "object") return
    const o = n as Record<string, unknown>
    if (o.type === "STRING") {
      if (isIdentShaped(o.value)) out.add(o.value)
      return
    }
    for (const [k, v] of Object.entries(o)) {
      if (k !== "name") walk(v)
    }
  }
  walk(g.rules)
  return out
}

/**
 * Solidity's builtin functions. The candidate list is DECLARED (it is the
 * documented builtin set); which of them the grammar can MARK is DERIVED by
 * parsing each one and inspecting the callee node.
 */
const ENGINE_FUNCTION_CANDIDATES = [
  "require", "assert", "gasleft", "sha256", "ripemd160", "ecrecover",
  "keccak256", "sha3", "gas", "blockhash", "blobhash", "selfdestruct",
  "addmod", "mulmod", "type", "revert", "suicide",
]

await WTS.Parser.init()
const lang = await WTS.Language.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-solidity.wasm")))
const parser = new WTS.Parser()
parser.setLanguage(lang)

/** The callee node of the FIRST call_expression in `src`, or null. */
function firstCallee(src: string): { type: string; text: string } | null {
  const tree = parser.parse(src)
  const stack: any[] = [tree.rootNode]
  while (stack.length > 0) {
    const n = stack.pop()
    if (n.type === "call_expression") {
      const fn = n.childForFieldName("function")
      if (!fn) return null
      // Unwrap the `function:` field's `expression` wrapper, then report the
      // node type the NAME is spelled with.
      let inner: any = fn
      if (inner.type === "expression" && inner.namedChildCount > 0) inner = inner.namedChild(0)
      return { type: inner.type, text: inner.text.trim() }
    }
    for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) stack.push(c) }
  }
  return null
}

/**
 * The STORE's own denylist, recovered from pool-worker.ts's source so the two
 * copies cannot drift apart silently.
 *
 * pool-worker.ts owns that list and this lane does not, so the honest arrangement
 * is not "trust the mirror" but "CHECK the mirror": the `UNIVERSAL` set literal is
 * read out of pool-worker's source here and compared against
 * `STORE_REFUSED_SYMBOL_NAMES`. If someone adds a name to the store's list and not
 * to this one, the analyzer starts declaring a symbol the store drops — which is
 * exactly the defect this exists to prevent, and which reads as a Solidity bug.
 *
 * The read is character-level and has to cope with a template literal containing a
 * regex, so it is hand-scanned to the closing brace of the set rather than matched
 * with a pattern.
 */
function deriveStoreUniversalDenylist(): { names: string[]; found: boolean } {
  const src = fs.readFileSync(path.join(ROOT, "src/ast/pool-worker.ts"), "utf8")
  const at = src.indexOf("const UNIVERSAL = new Set([")
  if (at < 0) return { names: [], found: false }
  const open = src.indexOf("[", at)
  const close = src.indexOf("])", open)
  if (close < 0) return { names: [], found: false }
  // Line comments are stripped FIRST, and that is not a nicety. The set literal
  // carries this comment inside it:
  //     // "constructor" is a first-class declaration in TS/JS —
  //     // do NOT filter it here. Only truly synthetic/noise names below.
  // so a naive quote scan reports `constructor` as REFUSED, which is the exact
  // opposite of what pool-worker does and would have produced a false drift
  // failure. Caught by this gate's own mirror control — an instrument that
  // manufactures findings is worse than no instrument (M60 §5.4), and the
  // failure direction here was "report a defect that does not exist".
  const body = src.slice(open + 1, close).split("\n").map((line) => {
    const c = line.indexOf("//")
    return c < 0 ? line : line.slice(0, c)
  }).join("\n")
  const names: string[] = []
  let i = 0
  while (i < body.length) {
    const q = body.indexOf("\"", i)
    if (q < 0) break
    const q2 = body.indexOf("\"", q + 1)
    if (q2 < 0) break
    const raw = body.slice(q + 1, q2)
    if (raw.length > 0) names.push(raw)
    i = q2 + 1
  }
  return { names, found: true }
}

const derived = deriveReservedTokens()

const moduleOnly = [...derived].filter((t) => !RESERVED_TOKENS.has(t)).sort()
const derivedOnly = [...RESERVED_TOKENS].filter((t) => !derived.has(t)).sort()
const typeTokens = [...RESERVED_TOKENS].filter((t) => isPrimitiveTypeToken(t)).sort()

// Behavioural derivation of the identifier-spelled builtins.
const bareIdentifiers: string[] = []
const tokenSpelled: string[] = []
const unparsed: string[] = []
for (const name of ENGINE_FUNCTION_CANDIDATES) {
  const src = `contract T { function t() public { ${name}(); } }`
  const got = firstCallee(src)
  if (!got) { unparsed.push(name); continue }
  if (got.type === "identifier") bareIdentifiers.push(name)
  else tokenSpelled.push(name)
}

/** The names the module must declare on top of RESERVED_TOKENS. */
const REQUIRED_DECLARED = ["require", "assert", "gasleft", "sha256", "ripemd160", "ecrecover"]
const missingDeclared = REQUIRED_DECLARED.filter((n) => !bareIdentifiers.includes(n))

console.log("M60 — solidity lane, reserved-target rule")
console.log("")
console.log(`  grammar                          : ${path.relative(ROOT, GRAMMAR_JSON)}`)
console.log(`  RESERVED_TOKENS in module         : ${RESERVED_TOKENS.size}`)
console.log(`  derived from grammar.js          : ${derived.size}`)
console.log(`  in module, absent from grammar    : ${moduleOnly.length}${moduleOnly.length ? ` -> ${moduleOnly.slice(0, 8).join(", ")}` : ""}`)
console.log(`  derived, absent from module       : ${derivedOnly.length}${derivedOnly.length ? ` -> ${derivedOnly.slice(0, 8).join(", ")}` : ""}`)
console.log(`  of which PRIMITIVE TYPE tokens    : ${typeTokens.length}`)
console.log(`  lexes as a bare identifier        : ${bareIdentifiers.length}  [${bareIdentifiers.join(", ")}]`)
console.log(`  lexes as a grammar token          : ${tokenSpelled.length}  [${tokenSpelled.join(", ")}]`)
console.log(`  no call_expression at all         : ${unparsed.length}${unparsed.length ? `  [${unparsed.join(", ")}]` : ""}`)
console.log(`  required declared entries missing : ${missingDeclared.length}${missingDeclared.length ? ` -> ${missingDeclared.join(", ")}` : ""}`)

const store = deriveStoreUniversalDenylist()
const storeMirrorOnly = store.names.filter((n) => !STORE_REFUSED_SYMBOL_NAMES.has(n)).sort()
const moduleOnlyStore = [...STORE_REFUSED_SYMBOL_NAMES].filter((n) => !store.names.includes(n)).sort()
console.log(`  store UNIVERSAL denylist found     : ${store.found} (${store.names.length} names, read from src/ast/pool-worker.ts)`)
console.log(`  mirror-only (store has, module lacks): ${storeMirrorOnly.length}${storeMirrorOnly.length ? ` -> ${storeMirrorOnly.join(", ")}` : ""}`)
console.log(`  module-only (module has, store lacks): ${moduleOnlyStore.length}${moduleOnlyStore.length ? ` -> ${moduleOnlyStore.join(", ")}` : ""}`)

if (argv.includes("--print")) {
  console.log("")
  console.log("  RESERVED_TOKENS:")
  const sorted = [...RESERVED_TOKENS].sort()
  for (let i = 0; i < sorted.length; i += 8) console.log("    " + sorted.slice(i, i + 8).join("  "))
}

// ── NEGATIVE CONTROLS. An instrument that manufactures findings is worse than
// no instrument (M60 §5.4). Each control asserts a fact that must hold; if any
// fails, the derivation above cannot be trusted and the run says so.
console.log("")
console.log("  negative controls (each must hold):")
const controls: { name: string; ok: boolean; detail: string }[] = []
const ctrl = (name: string, ok: boolean, detail = "") => controls.push({ name, ok, detail })

ctrl("derived set is non-trivial", derived.size > 200, `${derived.size} tokens`)
ctrl("module equals derivation exactly", moduleOnly.length === 0 && derivedOnly.length === 0,
  `+${moduleOnly.length} / -${derivedOnly.length}`)
ctrl("uint256/bytes32/bool/address ARE tokens", ["uint256", "bytes32", "bool", "address"].every((t) => RESERVED_TOKENS.has(t)))
ctrl("contract/function/return ARE tokens", ["contract", "function", "return"].every((t) => RESERVED_TOKENS.has(t)))
ctrl("msg/block/tx/this are NOT tokens (declared in the analyzer, not here)",
  !["msg", "block", "tx", "this", "super"].some((t) => RESERVED_TOKENS.has(t)))
ctrl("isPrimitiveTypeToken accepts uint256 and rejects uint256x",
  isPrimitiveTypeToken("uint256") && !isPrimitiveTypeToken("uint256x"))
ctrl("isReservedTarget: calls -> keccak256 is reserved",
  isReservedTarget("calls", "keccak256"))
ctrl("isReservedTarget: calls -> require is NOT flagged here (identifier-spelled)",
  !isReservedTarget("calls", "require"))
ctrl("isReservedTarget: uses -> uint256 allowed when declared a type reference",
  !isReservedTarget("uses", "uint256", { isTypeReference: true }))
ctrl("isReservedTarget: uses -> uint256 reserved otherwise",
  isReservedTarget("uses", "uint256"))
ctrl("isReservedTarget: calls -> transfer is NOT reserved (a member, not a token)",
  !isReservedTarget("calls", "transfer"))
ctrl("isReservedTarget: contains is not this predicate's business",
  !isReservedTarget("contains", "keccak256"))
// The member-call exemption, in BOTH directions. `call`, `balance` and
// `delegatecall` are EVM opcode tokens AND members of Solidity's built-in types,
// so applying the bare rule to a member call deletes `t.call{value: 1}("")`
// entirely. The surface measure cannot report that loss because the edge never
// existed to be counted — which is why the exemption needs its own control rather
// than being taken on trust.
ctrl("isReservedTarget: calls -> call IS reserved when bare (it is an opcode token)",
  isReservedTarget("calls", "call"))
ctrl("isReservedTarget: calls -> call is ALLOWED when it is a member call",
  !isReservedTarget("calls", "call", { isMemberCall: true }))
ctrl("isReservedTarget: calls -> balance ALLOWED as a member call (address.balance)",
  isReservedTarget("calls", "balance") &&
  !isReservedTarget("calls", "balance", { isMemberCall: true }))
ctrl("isReservedTarget: calls -> delegatecall ALLOWED as a member call",
  isReservedTarget("calls", "delegatecall") &&
  !isReservedTarget("calls", "delegatecall", { isMemberCall: true }))
ctrl("isReservedTarget: calls -> transfer is never reserved (not a token at all)",
  !isReservedTarget("calls", "transfer") && !isReservedTarget("calls", "transfer", { isMemberCall: true }))
ctrl("the exemption does not open a hole for a BARE call to a keyword",
  isReservedTarget("calls", "keccak256", { isSolidityCall: true }))
ctrl("require/assert/gasleft lex as bare identifiers (so a declared set is required)",
  bareIdentifiers.includes("require") && bareIdentifiers.includes("assert") && bareIdentifiers.includes("gasleft"))
// This control is the one that refuted the first draft of this file's header,
// which claimed keccak256/selfdestruct/type lex as tokens. They do NOT: in call
// position the lexer produces a bare `identifier`, and `type`/`revert` produce no
// `call_expression` at all. Asserting the MEASURED behaviour is what stops the
// comment drifting back to the wrong story.
ctrl("keccak256/selfdestruct lex as BARE identifiers despite being tokens",
  bareIdentifiers.includes("keccak256") && bareIdentifiers.includes("selfdestruct"))
ctrl("type/revert produce no call_expression (dedicated node types instead)",
  unparsed.includes("type") && unparsed.includes("revert"))
ctrl("0 candidates lex as a token in call position",
  tokenSpelled.length === 0)
ctrl("pool-worker's UNIVERSAL denylist was found and read",
  store.found && store.names.length > 5)
ctrl("the store denylist mirror is in sync (no drift either way)",
  storeMirrorOnly.length === 0 && moduleOnlyStore.length === 0,
  `+${storeMirrorOnly.length} / -${moduleOnlyStore.length}`)
// The two names that make this mirror exist rather than be decoration. If the
// store ever stops refusing them, the analyzer would be dropping real Solidity
// declarations for no reason, and the mirror must be noticed rather than assumed.
ctrl("the store DOES refuse 'self' (CrosschainLinked.sol:59 declares it)",
  store.names.includes("self") && STORE_REFUSED_SYMBOL_NAMES.has("self"))
ctrl("the store DOES refuse 'root' (MerkleTreeMock.sol:15 declares it)",
  store.names.includes("root") && STORE_REFUSED_SYMBOL_NAMES.has("root"))
ctrl("'constructor' is NOT refused (pool-worker excludes it deliberately; Solidity uses it)",
  !store.names.includes("constructor") && !STORE_REFUSED_SYMBOL_NAMES.has("constructor"))
ctrl("every candidate resolved to one of the three buckets",
  bareIdentifiers.length + tokenSpelled.length + unparsed.length === ENGINE_FUNCTION_CANDIDATES.length)

for (const c of controls) {
  console.log(`    ${c.ok ? "ok  " : "FAIL"} ${c.name}${c.detail ? `  (${c.detail})` : ""}`)
}
const failedControls = controls.filter((c) => !c.ok)

parser.delete()

const failed = moduleOnly.length > 0 || derivedOnly.length > 0 || missingDeclared.length > 0 ||
  storeMirrorOnly.length > 0 || moduleOnlyStore.length > 0 || !store.found || failedControls.length > 0
console.log("")
if (failed) {
  console.log("  FAIL — see above. Either the module has drifted from the grammar it")
  console.log("  describes, or a negative control failed, which means the derivation")
  console.log("  cannot be trusted. Both are reasons to distrust the reserved-target")
  console.log("  number the surface measure publishes.")
  process.exit(1)
}
console.log(`  PASS — ${RESERVED_TOKENS.size} reserved tokens, module byte-equal to the derivation;`)
console.log(`  ${bareIdentifiers.length} engine builtins need a declared entry, ${tokenSpelled.length} are covered by a token;`)
console.log(`  ${store.names.length}-name store denylist mirrored in sync;`)
console.log(`  ${controls.length}/${controls.length} negative controls hold.`)
process.exit(0)