// #924 row 2, second shape: WHY does a macro-prefixed declaration publish
// "string to_string" / "system_error vwindows_error" instead of the name alone?
// Dump the grammar tree for minimal reconstructions of the real sites.
import { getParser } from "../run-fixtures"

const CASES: Array<[string, string]> = [
  ["macro-prefix + qualified return type", "FMT_API std::system_error vwindows_error(int error_code, string_view fmt);\n"],
  ["macro-prefix + qualified return type, def", "FMT_API std::system_error vwindows_error(int error_code) {\n  return {};\n}\n"],
  ["macro-line + definition", "MTPL_DECL\nstd::string to_string(const json& j)\n{\n    return j.dump();\n}\n"],
  ["macro-prefix, no define", "MTPL_DECL std::string to_string(const json& j) { return j.dump(); }\n"],
  ["plain qualified return", "std::string to_string(const json& j) { return j.dump(); }\n"],
  ["plain, macro in body only", "std::string to_string(const json& j)\n{\n    JSON_THROW(1);\n}\n"],
  ["unqualified return + macro prefix", "FMT_API system_error vwindows_error(int error_code);\n"],
  ["macro prefix unqualified return def", "GTEST_API_ string JoinAsTuple(const Strings& fields);\n"],
]

for (const [label, src] of CASES) {
  const parser = await getParser("cpp")
  const tree: any = parser.parse(src)
  console.log(`\n=== ${label}`)
  console.log("   src:", JSON.stringify(src.split("\n")[0]))
  const dump = (n: any, d = 0, max = 5): string =>
    `${"  ".repeat(d)}${n.type}${n.isMissing ? " (MISSING)" : ""}${n.isError ? " (ERROR)" : ""}${n.childCount === 0 ? " " + JSON.stringify(n.text) : ""}\n` +
    (d >= max ? "" : Array.from({ length: n.childCount }, (_, i) => n.child(i)).filter(Boolean).map((c: any) => (c.isNamed ? dump(c, d + 1, max) : "")).join(""))
  console.log(dump(tree.rootNode).trimEnd())
}
