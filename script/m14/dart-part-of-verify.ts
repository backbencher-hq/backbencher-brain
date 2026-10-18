/**
 * verify-dart-part-of — the CONTRACT CHECK for the lane-owned `part_of` truth oracle.
 *
 * `script/m14/oracles/dart-part-of.ts` is a TRUTH derivation: it will be pushed beside the other
 * dart oracles in `differential.ts` (Lead wiring) and compared against the analyzer's rows. A
 * truth derivation nothing checks can be wrong in the same direction as the analyzer forever, and
 * the two agreeing would be the only evidence a reader ever sees. So each case here asserts BOTH
 * SIDES against the same expected rows, in the shapes the corpus contains:
 *
 *   1. `part 'sibling.dart';`          (library side, relative)
 *   2. `part of 'library.dart';`       (part side, relative)
 *   3. `part of my.lib;`               (part side, NAMED — the branch a path-only walk misses)
 *   4. `part 'package:pkg/src/x.dart';`(declared package)
 *   5. `package:` an undeclared package (both sides refuse: no row)
 *   6. a relative specifier that climbs out of the project (both refuse)
 *   7. `dart:` with the SDK present, and the same specifier with no SDK (both refuse)
 *
 * WHAT A CASE CANNOT CATCH: the analyzer and the oracle share the GRAMMAR. A node type the pinned
 * grammar does not produce for a construct Dart has is invisible here — the fixture suite is what
 * pins the language surface; this file pins the agreement of two implementations of the path rule.
 *
 * Run: `bun run script/m14/dart-part-of-verify.ts`
 * Exit: 0 all cases agree · 1 a disagreement.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { getParser } from "../../src/ast/engine"
import { RealDartAnalyzer } from "../../src/ast/real-dart-analyzer"
import { deriveDartPartOfTruth } from "./oracles/dart-part-of"

type Case = {
  name: string
  /** files to create under the project root: relative path -> content */
  files: Record<string, string>
  /** the file being analyzed (relative to the root) */
  file: string
  /** expected rows as `<from>-><target>`, both sides */
  expected: string[]
}

const CASES: Case[] = [
  {
    name: "part 'sibling.dart' — library side, relative",
    files: {
      "pubspec.yaml": "name: probe\n",
      "lib/src/library.dart": "part 'piece.dart';\nvoid libBody() { }\n",
      "lib/src/piece.dart": "part of 'library.dart';\n",
    },
    file: "lib/src/library.dart",
    expected: ["library->lib/src/piece.dart"],
  },
  {
    name: "part of 'library.dart' — part side, relative",
    files: {
      "pubspec.yaml": "name: probe\n",
      "lib/src/library.dart": "part 'piece.dart';\n",
      "lib/src/piece.dart": "part of 'library.dart';\nvoid pieceBody() { }\n",
    },
    file: "lib/src/piece.dart",
    expected: ["piece->lib/src/library.dart"],
  },
  {
    name: "part of my.lib — NAMED library (no URI; the branch a path-only truth walk misses)",
    files: {
      "pubspec.yaml": "name: probe\n",
      "lib/named_part.dart": "part of my.lib;\nvoid namedBody() { }\n",
    },
    file: "lib/named_part.dart",
    expected: ["named_part->my.lib"],
  },
  {
    name: "part 'package:probe/src/x.dart' — a package THIS checkout declares",
    files: {
      "pubspec.yaml": "name: probe\n",
      "lib/library.dart": "part 'package:probe/src/x.dart';\n",
      "lib/src/x.dart": "part of 'package:probe/lib/library.dart';\n",
    },
    file: "lib/library.dart",
    expected: ["library->lib/src/x.dart"],
  },
  {
    name: "package: an UNDECLARED package — both sides refuse",
    files: {
      "pubspec.yaml": "name: probe\n",
      "lib/library.dart": "part 'package:not_here/x.dart';\n",
    },
    file: "lib/library.dart",
    expected: [],
  },
  {
    // `lib/src/../../..` is the PARENT of the project root (two hops reach the root itself), so this
    // sides refuse. The shallow `lib/../x.dart` shape does NOT climb out (it normalises to
    // `x.dart` at the root) — measured while writing this case: the shallow spelling is a
    // resolution, not a refusal, and a case that assumed otherwise would have pinned a wrong rule.
    name: "a relative specifier that climbs OUT of the project — both sides refuse",
    files: {
      "pubspec.yaml": "name: probe\n",
      "lib/src/library.dart": "part '../../../outside.dart';\n",
    },
    file: "lib/src/library.dart",
    expected: [],
  },
  {
    name: "dart:async with the SDK present — resolved; without it — refused",
    files: {
      "pubspec.yaml": "name: probe\n",
      "sdk/lib/async/async.dart": "library dart.async;\n",
      "lib/with_sdk.dart": "part of 'dart:async';\n",
      "lib/without_sdk.dart": "part of 'dart:collection';\n",
    },
    file: "lib/with_sdk.dart",
    expected: ["with_sdk->sdk/lib/async/async.dart"],
  },
]

async function main(): Promise<void> {
  const parser = await getParser("dart")
  let failures = 0
  for (const c of CASES) {
    const root = mkdtempSync(path.join(tmpdir(), "dart-partof-"))
    mkdirSync(path.join(root, ".git"), { recursive: true })
    for (const [rel, content] of Object.entries(c.files)) {
      const abs = path.join(root, rel)
      mkdirSync(path.dirname(abs), { recursive: true })
      writeFileSync(abs, content)
    }
    const fileAbs = path.join(root, c.file)
    const src = c.files[c.file]
    const tree = parser.parse(src)
    if (!tree) {
      console.log(`FAIL  ${c.name}  — parser returned no tree`)
      failures++
      continue
    }
    const analyzerRows = new Set<string>(
      ((await new RealDartAnalyzer().analyze(tree.rootNode, src, fileAbs)).relationships ?? [])
        .filter((r: any) => r.type === "part_of")
        .map((r: any) => `${r.source}->${r.target}`),
    )
    const truthRows = new Set<string>(
      deriveDartPartOfTruth(tree.rootNode, { filePath: fileAbs, projectRoot: root })
        .map((e) => `${e.from}->${e.target}`),
    )
    const want = new Set(c.expected)
    const problems: string[] = []
    for (const w of want) {
      if (!analyzerRows.has(w)) problems.push(`analyzer missing ${w}`)
      if (!truthRows.has(w)) problems.push(`truth missing ${w}`)
    }
    for (const r of analyzerRows) if (!want.has(r)) problems.push(`analyzer UNEXPECTED ${r}`)
    for (const r of truthRows) if (!want.has(r)) problems.push(`truth UNEXPECTED ${r}`)
    console.log(`${problems.length === 0 ? "PASS" : "FAIL"}  ${c.name}  — rows=${[...want].join(" | ") || "(none)"}${problems.length ? `  [${problems.join("; ")}]` : ""}`)
    if (problems.length > 0) failures++
  }
  console.log("")
  if (failures === 0) {
    console.log("the part_of truth oracle and the analyzer agree on every case, including the NAMED form and both refusals")
    process.exit(0)
  }
  console.log(`${failures} case(s) failed`)
  process.exit(1)
}

await main()
