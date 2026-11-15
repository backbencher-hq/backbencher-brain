// M72 — Solidity security spec (lane B). DATA only: lexical syntax plus
// source/sink/sanitizer rules; the rebuild engine (matcher + flow) decides
// whether a sink becomes a lead. Frozen contract: ../spec-types.ts.
// WHERE ITS EVIDENCE LIVES — docs/m72-security-rebuild/{PLAN,LANGUAGES}.md,
//   validation/m72/fixtures/solidity/.
// CONTRACTS IT MUST NOT BREAK — the contract's vulnerability families are
//   EVM-agnostic; reentrancy, tx.origin authorization and selfdestruct have no
//   honest family and are declared as limits instead of being mislabelled.
// TIER — leads: lexical rules only; output is a lead to validate, not a finding.
import type { LanguageSecuritySpec } from "../spec-types"

export const spec: LanguageSecuritySpec = {
  language: "solidity",
  tier: "leads",
  tierReason: "Solidity source/sink rules; call/delegatecall rules without target or data-flow typing",
  lexical: {
    lineComments: ["//"],
    blockComments: [["/*", "*/"]],
    strings: [
      { delimiter: '"', escape: "\\" },
      { delimiter: "'", escape: "\\" },
    ],
  },
  sources: [
    {
      id: "solidity.msg_sender",
      pattern: /\bmsg\.sender\b/,
      sourceType: "user_input",
      description: "caller address (msg.sender)",
    },
    {
      id: "solidity.msg_data",
      pattern: /\bmsg\.(?:data|sig)\b/,
      sourceType: "user_input",
      description: "raw calldata or selector (msg.data/msg.sig)",
    },
    {
      id: "solidity.tx_origin",
      pattern: /\btx\.origin\b/,
      sourceType: "user_input",
      description: "transaction origin address (tx.origin)",
    },
    {
      id: "solidity.calldata",
      pattern: /\bcalldata\b/,
      sourceType: "user_input",
      description: "external function calldata parameter",
      captureVariable: true,
    },
    {
      id: "solidity.block_env",
      pattern: /\bblock\.(?:timestamp|number|difficulty|prevrandao|coinbase)\b/,
      sourceType: "unknown",
      description: "block-level value that a miner/validator can influence",
    },
  ],
  sinks: [
    {
      id: "solidity.code.external_call",
      pattern: /\.(?:call|staticcall)\s*[{(]/,
      vulnerability: "code_injection",
      sinkType: "external_call",
      severity: "critical",
      argument: "any",
      description: "low-level call/staticcall with dynamic target or calldata",
    },
    {
      id: "solidity.code.delegatecall",
      pattern: /\.delegatecall\s*[{(]/,
      vulnerability: "code_injection",
      sinkType: "external_call",
      severity: "critical",
      argument: "any",
      description: "delegatecall executes callee code in this contract's storage context",
    },
    {
      id: "solidity.code.legacy_call_value",
      pattern: /\.call\.value\s*\(/,
      vulnerability: "code_injection",
      sinkType: "external_call",
      severity: "critical",
      argument: "any",
      description: "legacy .call.value(...)() sends value with an external call",
    },
    {
      id: "solidity.code.create",
      pattern: /\bcreate2?\s*\(/,
      vulnerability: "code_injection",
      sinkType: "contract_deploy",
      severity: "high",
      argument: "any",
      description: "create/create2 deploys runtime-chosen bytecode",
    },
    {
      id: "solidity.crypto.ecrecover",
      pattern: /\becrecover\s*\(/,
      vulnerability: "weak_crypto",
      sinkType: "signature_recovery",
      severity: "medium",
      argument: "all",
      description: "ecrecover result must be checked; malleable signatures are a known hazard",
    },
    {
      id: "solidity.crypto.encode_packed",
      pattern: /\babi\.encodePacked\s*\(/,
      vulnerability: "weak_crypto",
      sinkType: "hash_input",
      severity: "medium",
      argument: "any",
      description: "abi.encodePacked on dynamic types enables hash-collision inputs",
    },
    {
      id: "solidity.crypto.blockhash",
      pattern: /\bblockhash\s*\(/,
      vulnerability: "weak_crypto",
      sinkType: "weak_randomness",
      severity: "medium",
      argument: "first",
      description: "blockhash as a randomness source is predictable",
    },
  ],
  sanitizers: [
    {
      id: "solidity.access.only_owner",
      vulnerability: "*",
      pattern: /\bonlyOwner\b/,
      rationale: "an access-control modifier restricts who can reach the sink",
    },
    {
      id: "solidity.reentrancy.guard",
      vulnerability: "*",
      pattern: /\bnonReentrant\b/,
      rationale: "a reentrancy guard excludes the reentrant call sequence",
    },
    {
      id: "solidity.validate.require_compare",
      vulnerability: "*",
      pattern: /\brequire\s*\([^;\n]{0,160}?(?:==|!=|<=|>=|\ballow(?:ed|list)\b)/,
      rationale: "an explicit require comparison/allowlist validates the value before the sink",
    },
    {
      id: "solidity.validate.allowlist",
      vulnerability: "*",
      pattern: /\b(?:allowlist|allowedTargets|allowedAddresses)\b/,
      rationale: "an explicit target allowlist is consulted in the expression feeding the call",
    },
  ],
  limits: [
    "reentrancy, tx.origin authorization and selfdestruct have no honest family in SecurityVulnerability; they are not emitted",
    "the target address and calldata of an external call are not typed; contract/interface dispatch is not modelled",
    "inline assembly is not modelled as a sink; Yul semantics are outside the lexical rules",
    "immutable/constant targets are excluded only by the dynamic-argument check, not by data-flow proof",
    "cross-contract call graphs are not followed; leads only",
  ],
}
