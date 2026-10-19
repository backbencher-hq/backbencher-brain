/**
 * CITATION VOCABULARIES — the committed lists a lane may declare as `languageNamespace`.
 *
 * WHY THIS FILE EXISTS. Three lanes independently identified the same resolution wall: a target that
 * names a PLATFORM or LIBRARY symbol which the project is NOT expected to declare, but which no
 * path/owner rule can verify either, because the spelling is not a project path and the project's key
 * space rightly says nothing about it. The java lane measured 1,160 non-reserved dotted rows
 * (jakarta/androidx/org.yaml), the dart lane sized 246,724 annotation project-scope rows and 197,823
 * type-shaped outside-project rows, the C lane 4,708 ISO-C collision rows. The requested remedy was a
 * new claim kind. THE MECHANISM ALREADY EXISTS: the `namespace` claim kind
 * (`NAMESPACE_CLAIM_KEY = "languageNamespace"`, incoming-rule.ts), whose root list is checked by the
 * arbiter and where a target outside the declared list is REFUTED (`extFAIL`). So the Lead ruling is:
 *
 *   A CITATION IS A `languageNamespace` CLAIM. The analyzer declares the roots it certifies; the
 *   arbiter checks the target's root against that list, counts a match as a verified external claim
 *   (`extOK`, `verifiedBy: "namespace"`), and a non-listed root as `externalRefuted` (counted against
 *   the lane, so a citation can never become a blanket excuse). The commitment that makes this
 *   honest is THESE VOCABULARIES: a lane's declared list must be one of the vocabularies below (or a
 *   documented subset), each entry carrying its citable source. A lane may not invent namespaces.
 *
 * WHAT IS DELIBERATELY NOT A VOCABULARY: generic lowercase dotted module paths (the kotlin precedent:
 * `kotlinx.*` is the project's own code in some checkouts, and the refiner refutation there is
 * correct). Any extension of this file is a policy change recorded in the programme charter §18.8.
 *
 * THE ROOTS ARE MATCHED BY `namespaceMatchOf`: the target is split on `.`/`::` and every prefix is
 * compared with the list, so `java.util.List` matches root `java` and a bare `override` matches the
 * exact symbol listed as a root. A lane that needs symbol-level citation lists the symbols themselves.
 *
 * THIS FILE IS READ-ONLY EVIDENCE FOR LANES AND REVIEWERS; analyzers do not import it (src/ast must
 * not depend on script/). A lane copies the relevant list into its analyzer with a comment naming the
 * vocabulary id below.
 */

export interface CitationVocabulary {
  /** Stable id a lane cites in its analyzer comment and evidence page. */
  id: string
  /** Where each root's citable authority comes from. */
  source: string
  /** Exact roots (namespace prefixes or bare symbols) a lane may declare. */
  roots: readonly string[]
}

/** JLS §6.1 / JPMS: the namespaces reserved to the Java platform. Mirrors
 *  `RESERVED_PLATFORM_NAMESPACES` in incoming-rule.ts (which the refiner/citation paths already use). */
export const JLS_JPMS: CitationVocabulary = {
  id: "jls-jpms",
  source: "JLS §6.1 / JPMS module system — names owned by the Java platform, never user code",
  roots: ["java", "javax", "jdk", "sun", "com.sun"],
}

/** Java EE / Android platform APIs: third-party but platform-scoped. Citable only for the NAMESPACES
 *  named by their specifications; a project that vendors them under the same root is a name collision
 *  the namespace claim cannot refute (recorded limitation; the `ext?` class stays named if a lane
 *  chooses not to claim). */
export const JAVA_PLATFORM_LIBRARIES: CitationVocabulary = {
  id: "java-platform-libraries",
  source: "Jakarta EE specifications (jakarta.*) · AndroidX (androidx.*) · SnakeYAML (org.yaml) · Scala 3 tools (dotty.tools)",
  roots: ["jakarta", "androidx", "org.yaml", "dotty.tools"],
}

/** Dart SDK core annotations/globals: declarations in `dart:core`/`dart:async` that a project never
 *  declares, carried bare (no specifier). Root list is symbol-level. */
export const DART_SDK_CORE: CitationVocabulary = {
  id: "dart-sdk-core",
  source: "Dart SDK `dart:core` / `dart:async` — metadata annotations and core global symbols",
  roots: [
    "override", "deprecated", "Deprecated", "pragma", "deprecated_member_use", "mustCallSuper",
    "protected", "required", "immutable", "factory", "optionalTypeArgs", "visibleForTesting",
    "visibleForOverriding", "doNotStore", "doNotSubmit", "mustBeOverridden", "redeclare",
    "nonVirtual", "recordUse", "target", "Target", "Metadata", "Object", "String", "int", "double",
    "bool", "List", "Map", "Set", "Future", "FutureOr", "Stream", "Function", "Iterable", "Duration",
    "DateTime", "Exception", "Error", "StackTrace", "RegExp", "Uri", "BigInt", "Symbol", "Type",
    "Null", "Never", "void", "dynamic", "print", "identical", "identityHashCode",
  ],
}

/** ISO/IEC 9899 standard library identifiers: functions, macros, types of the C standard library,
 *  which a project cannot be expected to declare. Symbol-level list, deliberately a CORE subset: a
 *  lane may claim only the names actually in this list, so an unlisted library name stays `ext?`
 *  (never invented into a citation). */
export const ISO_C_STDLIB: CitationVocabulary = {
  id: "iso-c-stdlib",
  source: "ISO/IEC 9899 (C standard library) — names reserved to the implementation's standard library",
  roots: [
    "printf", "fprintf", "sprintf", "snprintf", "vprintf", "puts", "putchar", "fputs", "fputc", "getchar",
    "fgets", "fread", "fwrite", "fopen", "fclose", "fflush", "fseek", "ftell", "fgetc", "scanf", "sscanf",
    "malloc", "calloc", "realloc", "free", "exit", "abort", "atexit", "getenv", "setenv", "system",
    "strlen", "strcmp", "strncmp", "strcpy", "strncpy", "strcat", "strncat", "strchr", "strrchr", "strstr",
    "strdup", "memcpy", "memmove", "memset", "memcmp", "memchr", "atoi", "atol", "atoll", "strtol",
    "strtoul", "strtoll", "strtod", "strtof", "abs", "labs", "qsort", "bsearch", "pow", "sqrt", "fabs",
    "floor", "ceil", "round", "trunc", "fmod", "sin", "cos", "tan", "log", "log10", "exp", "ldiv", "div",
    "assert", "errno", "FILE", "NULL", "size_t", "ssize_t", "ptrdiff_t", "int8_t", "int16_t", "int32_t",
    "int64_t", "uint8_t", "uint16_t", "uint32_t", "uint64_t", "intptr_t", "uintptr_t", "stdin", "stdout",
    "stderr", "va_list", "va_start", "va_end", "va_arg", "offsetof", "bool", "true", "false", "stdbool",
    "intmax_t", "uintmax_t", "wchar_t", "char16_t", "char32_t", "time_t", "clock_t", "div_t", "ldiv_t",
  ],
}

/** Python STANDARD LIBRARY modules: names the runtime provides and a project does not declare
 *  (Python docs module index). Root list is module-level; a lane may claim only targets whose root
 *  is in this list. Third-party packages are deliberately NOT here — their names can be the project's
 *  own code in their own checkout (the kotlinx precedent), so they stay named classes, not citations. */
export const PYTHON_STDLIB: CitationVocabulary = {
  id: "python-stdlib",
  source: "Python 3 standard library module index (docs.python.org/3/library)",
  roots: [
    "sys", "os", "re", "json", "typing", "__future__", "collections", "itertools", "functools",
    "operator", "pathlib", "datetime", "time", "logging", "unittest", "subprocess", "socket",
    "http", "urllib", "sqlite3", "csv", "io", "abc", "enum", "dataclasses", "asyncio", "threading",
    "multiprocessing", "hashlib", "random", "math", "warnings", "contextlib", "copy", "pickle",
    "struct", "base64", "tempfile", "shutil", "glob", "fnmatch", "textwrap", "string", "traceback",
    "weakref", "types", "inspect", "importlib", "pkgutil", "platform", "uuid", "decimal",
    "fractions", "statistics", "heapq", "bisect", "array", "queue", "signal", "errno", "stat",
    "zlib", "gzip", "bz2", "lzma", "tarfile", "zipfile", "configparser", "argparse", "getopt",
    "shlex", "cmd", "pdb", "profile", "timeit", "doctest", "ast", "dis", "code", "compileall",
    "py_compile", "symtable", "token", "tokenize", "keyword", "builtins", "__builtin__", "gc",
    "atexit", "site", "sysconfig", "ctypes", "mmap", "select", "selectors", "ssl", "smtplib",
    "ftplib", "poplib", "imaplib", "xml", "html", "email", "mimetypes", "quopri", "uu", "binascii",
    "secrets", "hmac", "locale", "gettext", "calendar", "numbers", "cmath", "statistics", "graphlib",
  ],
}

/** ISO C++ STANDARD LIBRARY symbols (namespace `std`) — the SAFE subset measured by the cpp lane's
 *  whole-population namespace census (`69af5a208`): 2,998 residual calls spell `std::<symbol>` and the
 *  namespaces `absl`/`json`/`testing` are EXCLUDED — a project may vendor those libraries, so claiming
 *  them external would be false by construction (the vendoring caveat is recorded). ISO C++ reserves
 *  the `std` namespace, so a `std::<listed symbol>` spelling is a citable platform fact. List = the
 *  measured top spellings (lane artifact has the full ranking); extending it is a policy change. */
export const ISO_CPP_STDLIB: CitationVocabulary = {
  id: "iso-cpp-stdlib",
  source: "ISO/IEC 14882 C++ standard library (namespace std; measured top spellings from the cpp namespace census)",
  roots: [
    "move", "string", "max", "infinity", "min", "quiet_NaN", "make_pair", "isnan", "signaling_NaN",
    "swap", "make_tuple", "sort", "to_string", "forward", "make_shared", "make_unique", "size_t",
    "vector", "map", "unordered_map", "set", "pair", "tuple", "optional", "variant", "function",
    "shared_ptr", "unique_ptr", "string_view", "numeric_limits", "find", "begin", "end", "size",
    "copy", "fill", "count", "abs", "fabs", "sqrt", "pow", "floor", "ceil", "round", "log", "exp",
  ],
}

/**
 * .NET PLATFORM / LIBRARY NAMESPACES (csharp lane proposal `6e7c153c3`, 2026-10-19): the seven
 * namespaces that are EXACTLY the measured 706-row `ext?` population of the csharp clean arm
 * (System.Text.Json 635 · Newtonsoft.Json 43 · System.Xml 17 · System.Net.Http.Json 8 ·
 * Microsoft.AspNetCore.Http.Json 1 · BenchmarkDotNet.Exporters.Csv 1 · BenchmarkDotNet.Exporters.Json 1).
 * Measured namespaces only, no broad prefixes. The two JSON/BenchmarkDotNet entries carry the same
 * VENDORING CAVEAT JAVA_PLATFORM_LIBRARIES records — a project that vendors one is the collision the
 * citation design cannot refute; strict-absent keeps the name model's answer.
 */
export const DOTNET_PLATFORM_LIBRARIES: CitationVocabulary = {
  id: "dotnet-platform-libraries",
  source: ".NET API browser (learn.microsoft.com/dotnet/api) for System.Text.Json / System.Xml / System.Net.Http.Json / Microsoft.AspNetCore.Http.Json · Json.NET (newtonsoft.com) · BenchmarkDotNet (benchmarkdotnet.org/api)",
  roots: [
    "System.Text.Json",
    "Newtonsoft.Json",
    "System.Xml",
    "System.Net.Http.Json",
    "Microsoft.AspNetCore.Http.Json",
    "BenchmarkDotNet.Exporters.Csv",
    "BenchmarkDotNet.Exporters.Json",
  ],
}

export const CITATION_VOCABULARIES: readonly CitationVocabulary[] = [
  JLS_JPMS, JAVA_PLATFORM_LIBRARIES, DART_SDK_CORE, ISO_C_STDLIB, PYTHON_STDLIB, ISO_CPP_STDLIB, DOTNET_PLATFORM_LIBRARIES,
]
