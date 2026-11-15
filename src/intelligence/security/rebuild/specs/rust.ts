// M72 — Rust security spec (lane B). DATA only: lexical syntax plus
// source/sink/sanitizer rules; the rebuild engine (matcher + flow) decides
// whether a sink becomes a lead. Frozen contract: ../spec-types.ts.
// WHERE ITS EVIDENCE LIVES — docs/m72-security-rebuild/{PLAN,LANGUAGES}.md,
//   validation/m72/fixtures/rust/.
// CONTRACTS IT MUST NOT BREAK — env/argv/stdin/fs-read are sources;
//   Command::new/query/fs-mutation/deserialization are sinks; lifetime and
//   ownership do not imply safety, so a dynamic argument is still required.
// TIER — leads: lexical rules only; output is a lead to validate, not a finding.
import type { LanguageSecuritySpec } from "../spec-types"

export const spec: LanguageSecuritySpec = {
  language: "rust",
  tier: "leads",
  tierReason: "Rust source/sink rules; Command/std::fs rules without whole-program flow",
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
      id: "rust.env",
      pattern: /\b(?:std::)?env::var(?:_os)?\s*\(/,
      sourceType: "env",
      description: "environment variable read (std::env::var)",
    },
    {
      id: "rust.argv",
      pattern: /\b(?:std::)?env::args(?:_os)?\s*\(/,
      sourceType: "argv",
      description: "process argument vector (std::env::args)",
    },
    {
      id: "rust.stdin",
      pattern: /\bio::stdin\s*\(/,
      sourceType: "user_input",
      description: "standard-input handle",
    },
    {
      id: "rust.file_read",
      pattern: /\bfs::(?:read|read_to_string)\s*\(/,
      sourceType: "file",
      description: "file contents read via std::fs",
    },
    {
      id: "rust.web_extract",
      pattern: /\bweb::(?:Query|Json|Form)\b/,
      sourceType: "user_input",
      description: "actix-web extractor for query/form/JSON request data",
      captureVariable: true,
    },
  ],
  sinks: [
    {
      id: "rust.cmd.command_new",
      pattern: /\bCommand::new\s*\(/,
      vulnerability: "command_injection",
      sinkType: "process_exec",
      severity: "critical",
      argument: "first",
      description: "std::process::Command created with a caller-influenced program/argument",
    },
    {
      id: "rust.sql.query",
      pattern: /\bsqlx::query(?:_as|_scalar)?\s*\(|\bconn\.(?:execute|query_row|prepare)\s*\(/,
      vulnerability: "sql_injection",
      sinkType: "sql_exec",
      severity: "high",
      argument: "all",
      description: "sqlx/rusqlite statement execution on a dynamically built statement",
    },
    {
      id: "rust.path.fs_mutation",
      pattern: /\bfs::(?:write|remove_file|remove_dir_all|copy|rename|set_permissions)\s*\(/,
      vulnerability: "path_traversal",
      sinkType: "file_mutation",
      severity: "high",
      argument: "first",
      description: "std::fs write/delete/move on a caller-influenced path",
    },
    {
      id: "rust.deser.binary_codec",
      pattern: /\b(?:bincode|serde_cbor|rmp_serde)::(?:deserialize|from_slice|from_str)\s*\(/,
      vulnerability: "insecure_deserialization",
      sinkType: "deserialize",
      severity: "high",
      argument: "first",
      description: "binary-format deserialization of untrusted bytes",
    },
    {
      id: "rust.code.dynamic_library",
      pattern: /\b(?:libloading::)?Library::new\s*\(/,
      vulnerability: "code_injection",
      sinkType: "code_load",
      severity: "critical",
      argument: "first",
      description: "libloading Library::new loads a runtime-chosen shared library",
    },
    {
      id: "rust.ssrf.http",
      pattern: /\b(?:reqwest|ureq)::(?:get|post|request)\s*\(/,
      vulnerability: "ssrf",
      sinkType: "http_request",
      severity: "high",
      argument: "first",
      description: "outbound HTTP request to a caller-controlled URL",
    },
    {
      id: "rust.crypto.weak_hash",
      pattern: /\b(?:md5::compute|sha1::Sha1|sha1::Digest)\s*\(/,
      vulnerability: "weak_crypto",
      sinkType: "weak_hash",
      severity: "medium",
      argument: "any",
      description: "MD5/SHA-1 hash of untrusted data",
    },
  ],
  sanitizers: [
    {
      id: "rust.cmd.argv_args",
      vulnerability: "command_injection",
      pattern: /\bCommand::new\s*\([^;\n]{0,160}?\)\s*\.arg(?:s)?\s*\(/,
      rationale: "Command::new(...).arg(...) passes arguments separately from the program",
    },
    {
      id: "rust.sql.bind",
      vulnerability: "sql_injection",
      pattern: /\.bind\s*\(/,
      rationale: "sqlx bind() keeps values out of the SQL text",
    },
    {
      id: "rust.path.file_name",
      vulnerability: "path_traversal",
      pattern: /\bfile_name\s*\(\s*\)/,
      rationale: "Path::file_name() discards directory components before the path is used",
    },
    {
      id: "rust.deser.serde_json",
      vulnerability: "insecure_deserialization",
      pattern: /\bserde_json::from_(?:str|slice)\s*\(/,
      rationale: "serde_json produces data values, never executable objects",
    },
    {
      id: "rust.num.parse",
      vulnerability: "*",
      pattern: /\.parse::<[^>\n]{1,60}>\s*\(\s*\)/,
      rationale: "typed parse::<T>() rejects values that are not the expected numeric type",
    },
  ],
  limits: [
    "raw strings (r\"...\" / r#\"...\"#) are not masked by the simple delimiter table",
    "proc-macros, unsafe blocks and trait-object dispatch hide the concrete sink; no whole-program flow",
    "Command::new with a literal program and dynamic arguments is still a lead: argv-vs-shell intent is not proven",
    "the spec targets the standard library plus sqlx/reqwest/libloading; other crates are not modelled",
  ],
}
