// M72 — Zig security spec (lane B). DATA only: lexical syntax plus
// source/sink/sanitizer rules; the rebuild engine (matcher + flow) decides
// whether a sink becomes a lead. Frozen contract: ../spec-types.ts.
// WHERE ITS EVIDENCE LIVES — docs/m72-security-rebuild/{PLAN,LANGUAGES}.md,
//   validation/m72/fixtures/zig/.
// CONTRACTS IT MUST NOT BREAK — args/env/stdin/fs-read are sources; Child
//   init/run, execv and fs mutation are sinks; the argv literal array is the
//   sanitized form.
// TIER — leads: lexical rules only; output is a lead to validate, not a finding.
import type { LanguageSecuritySpec } from "../spec-types"

export const spec: LanguageSecuritySpec = {
  language: "zig",
  tier: "leads",
  tierReason: "Zig source/sink rules; std.process.Child rules without data-flow proof",
  lexical: {
    lineComments: ["//"],
    blockComments: [],
    strings: [
      { delimiter: '"', escape: "\\" },
      { delimiter: "'", escape: "\\" },
    ],
  },
  sources: [
    {
      id: "zig.args",
      pattern: /\bstd\.process\.args\w*\s*\(/,
      sourceType: "argv",
      description: "process arguments (std.process.args/argsAlloc)",
    },
    {
      id: "zig.os_argv",
      pattern: /\bstd\.os\.argv\b/,
      sourceType: "argv",
      description: "raw OS argument vector",
    },
    {
      id: "zig.env",
      pattern: /\bstd\.process\.getEnvVar(?:Owned)?\s*\(/,
      sourceType: "env",
      description: "environment variable read",
    },
    {
      id: "zig.stdin",
      pattern: /\bstd\.io\.getStdIn\s*\(/,
      sourceType: "user_input",
      description: "standard-input handle",
    },
    {
      id: "zig.file_read",
      pattern: /\bstd\.fs\.cwd\s*\(\s*\)\s*\.(?:openFile|readFileAlloc)\s*\(/,
      sourceType: "file",
      description: "file contents read with openFile/readFileAlloc",
    },
  ],
  sinks: [
    {
      id: "zig.cmd.child_init",
      pattern: /\b(?:std\.process\.)?Child\.(?:init|run)\s*\(/,
      vulnerability: "command_injection",
      sinkType: "process_exec",
      severity: "critical",
      argument: "first",
      description: "std.process.Child init/run with a caller-influenced program/argv",
    },
    {
      id: "zig.cmd.execv",
      pattern: /\bstd\.process\.execv(?:e|pe)?\s*\(/,
      vulnerability: "command_injection",
      sinkType: "process_exec",
      severity: "critical",
      argument: "all",
      description: "std.process.execv family replaces the process with a runtime-chosen image",
    },
    {
      id: "zig.cmd.child_spawn",
      pattern: /\bstd\.process\.Child\b[^;\n]{0,120}?\.spawn\s*\(/,
      vulnerability: "command_injection",
      sinkType: "process_exec",
      severity: "high",
      argument: "any",
      description: "Child.spawn launches a configured child process",
    },
    {
      id: "zig.path.fs_mutation",
      pattern: /\bstd\.fs\.cwd\s*\(\s*\)\s*\.(?:deleteFile|deleteDir|rename|createFile|writeFile|copyFile)\s*\(/,
      vulnerability: "path_traversal",
      sinkType: "file_mutation",
      severity: "high",
      argument: "first",
      description: "std.fs mutation on a caller-influenced path",
    },
    {
      id: "zig.code.dynlib_open",
      pattern: /\bDynLib\.open\s*\(/,
      vulnerability: "code_injection",
      sinkType: "code_load",
      severity: "critical",
      argument: "first",
      description: "std.dynamic_library.DynLib.open loads a runtime-chosen library",
    },
  ],
  sanitizers: [
    {
      id: "zig.cmd.argv_literal",
      vulnerability: "command_injection",
      pattern: /\.argv\s*=\s*&\.\{/,
      rationale: ".argv = &.{...} passes an argv array instead of a shell command line",
    },
    {
      id: "zig.path.basename",
      vulnerability: "path_traversal",
      pattern: /\bstd\.fs\.path\.(?:basename|dirname)\s*\(/,
      rationale: "path.basename/dirname strips or isolates directory components before use",
    },
    {
      id: "zig.num.parse_int",
      vulnerability: "*",
      pattern: /\b(?:std\.fmt\.)?parseInt\s*\(/,
      rationale: "std.fmt.parseInt rejects values that are not the expected integer",
    },
  ],
  limits: [
    "Zig is compiled: there is no runtime eval, so code injection only covers dynamic library loading",
    "Zig multiline string literals (lines prefixed with \\\\) are not masked",
    "std.process.Child always executes argv arrays; command injection requires an explicit shell to be spawned and is still only a lead",
    "the spec targets the standard library of recent Zig; third-party packages are not modelled",
  ],
}
