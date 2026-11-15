/**
 * READ-ONLY PROBE — the shebang routing, positives AND negatives.
 *
 * A router rule that can only add files is exactly the kind of rule that
 * silently re-routes somebody else's language if it is not tested in BOTH
 * directions. The negatives here are the point: a recognised extension must
 * always win, a non-shell extensionless file must stay unrouted, and a
 * shebang for an interpreter this rule does not claim must stay unrouted too.
 *
 * Writes nothing.
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../src/ast/language-detection"

const dir = mkdtempSync(path.join(tmpdir(), "bb-shebang-"))
const write = (name: string, body: string) => {
  const p = path.join(dir, name)
  writeFileSync(p, body)
  return p
}

const POSITIVE: [string, string, string | null][] = [
  ["plain bash shebang", "#!/bin/bash\necho hi\n", "bash"],
  ["env bash", "#!/usr/bin/env bash\necho hi\n", "bash"],
  ["sh", "#!/bin/sh\necho hi\n", "bash"],
  ["zsh shebang (routed to the bash lane, as .zsh already is)", "#!/usr/bin/env zsh\necho hi\n", "bash"],
  ["dash", "#!/bin/dash\necho hi\n", "bash"],
  ["ksh", "#!/bin/ksh\necho hi\n", "bash"],
  ["shebang with an argument", "#!/usr/bin/env bash -e\necho hi\n", "bash"],
  ["crlf line ending", "#!/bin/bash\r\necho hi\r\n", "bash"],
  ["no shebang at all", "echo hi\n", null],
  ["LICENSE-looking text", "MIT License\n\nPermission is hereby granted...\n", null],
  ["a python shebang this rule does NOT claim", "#!/usr/bin/env python3\nprint(1)\n", null],
  ["a node shebang this rule does NOT claim", "#!/usr/bin/env node\nconsole.log(1)\n", null],
  ["a binary blob", "\\u0000\\u0001\\u0002\\u0003", null],
  ["empty file", "", null],
]

// NEGATIVES: a recognised extension must beat the shebang, always.
const NEGATIVE: [string, string, string | null][] = [
  // The extension WINS. These three are the whole point of scoping the rule to
  // extensionless files: a bash shebang on a `.py` file is a python file.
  ["python file with a BASH shebang", "#!/bin/bash\nprint(1)\n", "python"],
  ["ruby file with a bash shebang", "#!/usr/bin/env bash\nputs 1\n", "ruby"],
  ["yaml file with a bash shebang", "#!/bin/bash\nkey: value\n", "yaml"],
  ["a .sh file with a python shebang", "#!/usr/bin/env python3\necho hi\n", "bash"],
  ["a .bashrc by basename, no shebang", "export PS1='$ '\n", "bash"],
  ["a .zshrc by basename, no shebang", "export PROMPT='%# '\n", "bash"],
  ["Makefile by basename", "all:\n\techo hi\n", "make"],
]

let pass = 0
const failures: string[] = []
for (const [label, body, want] of [...POSITIVE, ...NEGATIVE]) {
  const ext = label.includes("file with a") || label.includes("a .sh") || label.includes(".bashrc") || label.includes(".zshrc") || label.includes("Makefile")
    ? (label.includes("python file") ? "x.py" : label.includes("ruby file") ? "x.rb" : label.includes("yaml") ? "x.yaml" : label.includes(".sh file") ? "x.sh" : label.includes(".bashrc") ? ".bashrc" : label.includes(".zshrc") ? ".zshrc" : "Makefile")
    : ""
  const p = write(ext || "noext", body)
  const got = detectLanguageFromPath(p, body)
  if (got === want) pass++
  else failures.push(`${label} (${ext || "extensionless"}): want ${want}, got ${got}`)
}
rmSync(dir, { recursive: true, force: true })

console.log(`shebang routing: ${pass}/${POSITIVE.length + NEGATIVE.length} cases correct`)
for (const f of failures) console.log("  FAIL " + f)
process.exitCode = failures.length === 0 ? 0 : 1
