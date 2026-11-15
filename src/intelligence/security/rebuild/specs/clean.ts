// M72 — Clean security spec (lane A, specs-a).
//
// WHAT THIS FILE IS — lexical source/sink rules for the Clean functional
// language (Nijmegen, .icl/.dcl). Clean is pure: effects are threaded through
// *World, so the sinks are the file APIS that take a runtime path.
//
// API SOURCES (checked against the upstream definitions, not guessed):
//   • StdFile: fopen/sfopen/freadline/freads  (base/stdenv lib/StdFile.dcl)
//   • Directory: fremove/createDirectory/fmove/setCurrentDirectory/
//     getDirectoryContents/getFileInfo          (clean-libraries Directory.dcl)
//   • ArgEnv: getEnvironmentVariable/getCommandLine/getArg (clean-libraries
//     ArgEnvUnix/ArgEnv.icl)
// Clean's standard environment is small: it exposes no shell/process launch,
// no SQL client and no parameterized path/query API, so this spec has no
// command_injection rule and no sanitizer rule. That is a statement about the
// audited stdlib surface, recorded in `limits`.
//
// CONVENTIONS — sink patterns end at the callee token plus the start of its
// application; the flow engine reads the argument text from there.
import type { LanguageSecuritySpec } from "../spec-types"

export const spec: LanguageSecuritySpec = {
  language: "clean",
  tier: "leads",
  tierReason: "Clean lexical rules only: no evaluated data flow, so a match is a lead to validate.",
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
      id: "clean.source.getEnvironmentVariable",
      pattern: /\bgetEnvironmentVariable\b/,
      sourceType: "env",
      description: "ArgEnv getEnvironmentVariable reads a caller-controlled environment variable",
    },
    {
      id: "clean.source.command-line",
      pattern: /\b(?:getCommandLine|getArg)\b/,
      sourceType: "cli",
      description: "ArgEnv getCommandLine/getArg return command-line arguments",
    },
    {
      id: "clean.source.fread",
      pattern: /\b(?:freadline|freads|freadc)\b/,
      sourceType: "file",
      description: "StdFile fread* returns file content",
    },
  ],
  sinks: [
    {
      id: "clean.sink.fopen",
      pattern: /\bfopen\s+[A-Za-z_(]/,
      vulnerability: "path_traversal",
      sinkType: "file_open",
      severity: "medium",
      argument: "first",
      description: "StdFile fopen opens a runtime path (FReadText/FWriteText/FAppendText)",
    },
    {
      id: "clean.sink.sfopen",
      pattern: /\bsfopen\s+[A-Za-z_(]/,
      vulnerability: "path_traversal",
      sinkType: "file_open",
      severity: "medium",
      argument: "first",
      description: "StdFile sfopen opens a runtime path for shared reading",
    },
    {
      id: "clean.sink.fremove",
      pattern: /\bfremove\s+[A-Za-z_(]/,
      vulnerability: "path_traversal",
      sinkType: "file_delete",
      severity: "medium",
      argument: "first",
      description: "Directory fremove deletes a runtime path",
    },
    {
      id: "clean.sink.createDirectory",
      pattern: /\bcreateDirectory\s+[A-Za-z_(]/,
      vulnerability: "path_traversal",
      sinkType: "file_create",
      severity: "medium",
      argument: "first",
      description: "Directory createDirectory creates a runtime path",
    },
    {
      id: "clean.sink.fmove",
      pattern: /\bfmove\s+[A-Za-z_(]/,
      vulnerability: "path_traversal",
      sinkType: "file_move",
      severity: "medium",
      argument: "first",
      description: "Directory fmove moves/renames a runtime path",
    },
    {
      id: "clean.sink.setCurrentDirectory",
      pattern: /\bsetCurrentDirectory\s+[A-Za-z_(]/,
      vulnerability: "path_traversal",
      sinkType: "directory_switch",
      severity: "medium",
      argument: "first",
      description: "Directory setCurrentDirectory switches the working directory to a runtime path",
    },
    {
      id: "clean.sink.getDirectoryContents",
      pattern: /\bgetDirectoryContents\s+[A-Za-z_(]/,
      vulnerability: "path_traversal",
      sinkType: "directory_list",
      severity: "medium",
      argument: "first",
      description: "Directory getDirectoryContents lists a runtime path",
    },
    {
      id: "clean.sink.getFileInfo",
      pattern: /\bgetFileInfo\s+[A-Za-z_(]/,
      vulnerability: "path_traversal",
      sinkType: "file_stat",
      severity: "medium",
      argument: "first",
      description: "Directory getFileInfo stats a runtime path",
    },
  ],
  // The audited StdFile/Directory/ArgEnv surface has no parameterized query,
  // path canonicaliser or shell-escaping primitive; the safe form is textual
  // (constants or an allowlist in the program), not a callable sanitiser.
  sanitizers: [],
  limits: [
    "no evaluated data flow: the *World threading is not traced",
    "the audited stdlib (StdFile, Directory, ArgEnv) exposes no shell/process launch, SQL client or parameterized path API, so this spec has no command_injection or SQL sink and no sanitizer rule",
    "stdin console input via the compiler-distributed StdIO module is not audited; only ArgEnv and StdFile input sources are covered",
    "project-local IO wrappers, C FFI calls and the ABC/intermediate representation are not analysed",
    "no interprocedural flow: a helper that calls fopen/fremove is only a lead at its own symbol",
  ],
}
