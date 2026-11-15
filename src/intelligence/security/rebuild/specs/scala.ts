// M72 — Scala security spec (lane B). DATA only: lexical syntax plus
// source/sink/sanitizer rules; the rebuild engine (matcher + flow) decides
// whether a sink becomes a lead. Frozen contract: ../spec-types.ts.
// WHERE ITS EVIDENCE LIVES — docs/m72-security-rebuild/{PLAN,LANGUAGES}.md,
//   validation/m72/fixtures/scala/.
// CONTRACTS IT MUST NOT BREAK — JVM APIs are matched by their real call shape;
//   Scala string interpolation s"...$x..." lives inside a masked literal and is
//   declared as a limit rather than silently guarded.
// TIER — leads: lexical rules only; output is a lead to validate, not a finding.
import type { LanguageSecuritySpec } from "../spec-types"

export const spec: LanguageSecuritySpec = {
  language: "scala",
  tier: "leads",
  tierReason: "Scala source/sink rules; no interprocedural/JVM-dispatch flow proof",
  lexical: {
    lineComments: ["//"],
    blockComments: [["/*", "*/"]],
    strings: [
      { delimiter: '"', escape: "\\" },
      { delimiter: '"""', multiline: true },
    ],
  },
  sources: [
    {
      id: "scala.args",
      pattern: /\bargs\s*\(\s*\d/,
      sourceType: "argv",
      description: "main(args) command-line argument",
    },
    {
      id: "scala.env",
      pattern: /\bsys\.(?:env|props)\b/,
      sourceType: "env",
      description: "system environment/properties read",
    },
    {
      id: "scala.request",
      pattern: /\brequest\.(?:getQueryString|body|headers|queryString|cookies|uri)\b/,
      sourceType: "user_input",
      description: "Play/Spray request member",
      captureVariable: true,
    },
    {
      id: "scala.stdin",
      pattern: /\bStdIn\s*\./,
      sourceType: "user_input",
      description: "scala.io.StdIn read",
    },
    {
      id: "scala.file_read",
      pattern: /\bSource\.from(?:File|InputStream)\s*\(/,
      sourceType: "file",
      description: "file/stream contents read via scala.io.Source",
    },
  ],
  sinks: [
    {
      id: "scala.cmd.runtime_exec",
      pattern: /\bRuntime\.getRuntime\s*\(\s*\)\s*\.exec\s*\(|\bProcess\s*\(/,
      vulnerability: "command_injection",
      sinkType: "process_exec",
      severity: "critical",
      argument: "first",
      description: "JVM Runtime.exec or scala.sys.process.Process with a dynamic command",
    },
    {
      id: "scala.cmd.sys_process",
      pattern: /\bscala\.sys\.process\b|\.lines_!\b/,
      vulnerability: "command_injection",
      sinkType: "process_exec",
      severity: "high",
      argument: "all",
      description: "scala.sys.process command builder / lines_! execution",
    },
    {
      id: "scala.code.class_for_name",
      pattern: /\bClass\.forName\s*\(/,
      vulnerability: "code_injection",
      sinkType: "code_load",
      severity: "high",
      argument: "first",
      description: "Class.forName loads a runtime-chosen class",
    },
    {
      id: "scala.code.toolbox",
      pattern: /\b(?:scala\.reflect\.toolbox|runtimeMirror|ToolBox)\b/,
      vulnerability: "code_injection",
      sinkType: "code_eval",
      severity: "high",
      argument: "any",
      description: "Scala reflection/toolbox compiles or evaluates code at runtime",
    },
    {
      id: "scala.sql.jdbc",
      pattern: /\b(?:executeQuery|executeUpdate|executeBatch)\s*\(/,
      vulnerability: "sql_injection",
      sinkType: "sql_exec",
      severity: "high",
      argument: "all",
      description: "JDBC statement execution on a dynamically built statement",
    },
    {
      id: "scala.deser.java_serial",
      pattern: /\bObjectInputStream\s*\(|\bJavaSerializer\b/,
      vulnerability: "insecure_deserialization",
      sinkType: "deserialize",
      severity: "high",
      argument: "any",
      description: "Java-serialization path (ObjectInputStream/Akka JavaSerializer)",
    },
    {
      id: "scala.path.files",
      pattern: /\bFiles\.(?:write|delete|move|copy|createFile)\s*\(/,
      vulnerability: "path_traversal",
      sinkType: "file_mutation",
      severity: "high",
      argument: "first",
      description: "java.nio.file mutation on a caller-influenced path",
    },
    {
      id: "scala.ssrf.http",
      pattern: /\bHttp\s*\(|\bWS\.url\s*\(/,
      vulnerability: "ssrf",
      sinkType: "http_request",
      severity: "high",
      argument: "first",
      description: "outbound HTTP request to a caller-controlled URL",
    },
    {
      id: "scala.xss.html",
      pattern: /\bHtml\s*\(/,
      vulnerability: "xss",
      sinkType: "html_output",
      severity: "medium",
      argument: "first",
      description: "play.twirl.api.Html marks markup as safe output without escaping",
    },
  ],
  sanitizers: [
    {
      id: "scala.sql.prepared",
      vulnerability: "sql_injection",
      pattern: /\bPreparedStatement\b|prepareStatement\s*\(/,
      rationale: "PreparedStatement keeps the statement text separate from bound values",
    },
    {
      id: "scala.cmd.seq_argv",
      vulnerability: "command_injection",
      pattern: /\bProcess\s*\(\s*Seq\s*\(/,
      rationale: "Process(Seq(...)) passes an argv list instead of a shell command line",
    },
    {
      id: "scala.xss.escape",
      vulnerability: "xss",
      pattern: /\bHtmlFormat\.escape\s*\(/,
      rationale: "HtmlFormat.escape HTML-encodes the value before output",
    },
    {
      id: "scala.path.get_name",
      vulnerability: "path_traversal",
      pattern: /\.getName\b/,
      rationale: "java.io.File.getName strips directory components before the path is used",
    },
    {
      id: "scala.num.toint",
      vulnerability: "*",
      pattern: /\.to(?:Int|Long|Double)\b/,
      rationale: "numeric conversion rejects non-numeric text before the sink",
    },
  ],
  limits: [
    "Scala string interpolation (s\"...$x...\") is inside a masked literal; only variables outside the literal are visible",
    "JVM dynamic dispatch, implicits and typeclasses hide the concrete sink implementation",
    "Play/Scala framework request helpers beyond request.* are not sources",
    "reflection/toolbox sinks are reported as leads only; the evaluated code is not analysed",
    "triple-quoted multiline strings are masked; stripMargin interpolation is not resolved",
  ],
}
