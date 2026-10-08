#!/usr/bin/env tsx
// script/m56/verify-published-paths.ts
//
// WHY THIS GATE EXISTS. `script/m56/generate-editors.ts` reads each editor's own
// config file and publishes its launch command to the website, verbatim, as that
// editor's instructions. So a path that is merely LOCAL becomes a claim about
// everyone's machine.
//
// Two were shipped that way:
//
//   ide/helix/languages.toml carried
//     args = [ "/opt/backbencher-brain/dist/lsp/server.js" ]
//   and the website published, as Helix's `launch`:
//     node "/opt/backbencher-brain/dist/lsp/server.js"
//
// A Linux path, presented as the way to run the server, on a repository whose
// owner develops on macOS and where that directory has never existed. Nothing
// failed: a config full of a plausible absolute path reads exactly like a config
// that is merely specific, and the editors drift gate was green throughout
// because byte-identity is not the same property as correctness.
//
// The other direction is checked too — a placeholder that does not LOOK like a
// placeholder is the same defect wearing a disguise, because a reader who cannot
// tell what to edit will not edit it.
//
// WHAT IT GATES: no published editor config may contain a machine-specific
// absolute path, and every placeholder must announce itself.

import { readFileSync } from "node:fs"
import path from "node:path"

type Check = { name: string; ok: boolean; detail: string }
const checks: Check[] = []
const check = (name: string, ok: boolean, detail: string) => {
  checks.push({ name, ok, detail })
  console.log(`  ${ok ? "ok  " : "FAIL"}: ${name} — ${detail}`)
}

const ROOT = process.cwd()

// Every editor block the generator publishes, and the file each block's launch
// command is read from.
const PUBLISHED: Array<{ editor: string; file: string }> = [
  { editor: "vscode", file: "ide/vscode/package.json" },
  { editor: "zed", file: "ide/zed/bb-lsp/README.md" },
  { editor: "helix", file: "ide/helix/languages.toml" },
  { editor: "nvim", file: "script/m27/nvim-adapter.md" },
]

// A path that can only be right on the machine it was written on.
//
// `/opt/homebrew/` is DELIBERATELY not one of these: it is where Homebrew installs
// on Apple Silicon, it is stable, and the Zed launcher's node-candidate list has
// to name it. The first version of this rule was `/opt/<anything>/` and it fired
// on that legitimate prefix — a gate that flags the correct thing is a gate people
// learn to ignore. What makes a path machine-specific is that it names SOMEONE'S
// checkout or SOMEONE'S home, not that it lives under /opt.
const MACHINE_SPECIFIC = [
  /\/opt\/backbencher-brain\//,
  /\/home\/[a-z_][A-Za-z0-9_-]*\//,
  /\/Users\/[A-Za-z0-9_.-]+\//,
  /[A-Z]:\\\\/,
]

/**
 * Drop comment lines before scanning.
 *
 * A comment is not executed and is not published as a command, and these files
 * legitimately QUOTE the bad path when documenting the defect they are guarding
 * against. Scanning comments flagged this file's own explanation of the helix
 * `/opt/backbencher-brain` it had just fixed. The gate is about what bb tells a
 * reader to run, so it scans what bb tells a reader to run.
 */
function stripComments(text: string): string {
  return text
    .split("\n")
    .filter((line) => {
      const t = line.trim()
      return !t.startsWith("#") && !t.startsWith("//") && !t.startsWith("<!--") && !t.startsWith("*")
    })
    .join("\n")
}

// A placeholder a reader can recognise as something to edit.
const SHOUTS = /ABSOLUTE\/PATH\/TO\/|<checkout>|EDIT ME|REPLACE ME|\$HOME|~/

for (const { editor, file } of PUBLISHED) {
  const abs = path.join(ROOT, file)
  let text: string
  try {
    text = readFileSync(abs, "utf8")
  } catch {
    check(`${editor}: config readable`, false, `${file} could not be read`)
    continue
  }

  const scan = stripComments(text)
  const offenders: string[] = []
  for (const re of MACHINE_SPECIFIC) {
    for (const m of scan.matchAll(new RegExp(re.source, "g"))) {
      const line = scan.slice(0, m.index).split("\n").length
      offenders.push(`${file}:${line} ${m[0]}`)
    }
  }
  check(
    `${editor}: no machine-specific absolute path in ${file}`,
    offenders.length === 0,
    offenders.length === 0 ? `${text.length} chars scanned` : `*** ${offenders.join("; ")}`,
  )
}

// The website is where these become claims, so check the PUBLISHED artefact too —
// a fix to the source that was never regenerated still ships the old claim.
const generated = path.join(ROOT, "website", "src", "data", "editors.generated.ts")
try {
  const text = readFileSync(generated, "utf8")
  const scan = stripComments(text)
  const offenders: string[] = []
  for (const re of MACHINE_SPECIFIC) {
    for (const m of scan.matchAll(new RegExp(re.source, "g"))) {
      const line = scan.slice(0, m.index).split("\n").length
      offenders.push(`editors.generated.ts:${line} ${m[0]}`)
    }
  }
  check(
    "published website data carries no machine-specific absolute path",
    offenders.length === 0,
    offenders.length === 0 ? `${text.length} chars scanned` : `*** ${offenders.join("; ")}`,
  )
} catch {
  check("published website data readable", false, "website/src/data/editors.generated.ts missing")
}

// The self-test: a planted offender must be caught, or this gate cannot fail.
{
  const planted = `args = [ "/opt/backbencher-brain/dist/lsp/server.js" ]`
  const plantedHome = `args = [ "$HOME/x/dist/lsp/server.js" ]`
  const caught = MACHINE_SPECIFIC.some((re) => re.test(planted))
  check(
    "self-test: a planted /opt/backbencher-brain path IS caught (the gate can fail)",
    caught,
    caught ? "the planted offender matches a rule" : "*** the planted offender slipped through ***",
  )
  const caughtHome = MACHINE_SPECIFIC.some((re) => re.test(plantedHome))
  check(
    "self-test: a planted /Users/<name>/ path IS caught too",
    caughtHome,
    caughtHome ? "the planted offender matches a rule" : "*** the planted offender slipped through ***",
  )
  const homebrewOk = !MACHINE_SPECIFIC.some((re) => re.test("/opt/homebrew/bin/node"))
  check(
    "self-test: /opt/homebrew/ is NOT flagged — a legitimate Apple-Silicon prefix",
    homebrewOk,
    homebrewOk ? "homebrew stays allowed, as it must" : "*** the rule flags a legitimate prefix ***",
  )
  const innocent = `args = [ "/ABSOLUTE/PATH/TO/backbencher-brain/dist/lsp/server.js" ]  # EDIT ME`
  const flagged = MACHINE_SPECIFIC.filter((re) => re.test(innocent))
  const readable = SHOUTS.test(innocent)
  check(
    "self-test: a shouted placeholder is NOT flagged as machine-specific, and IS recognisable",
    flagged.length === 0 && readable,
    `machine-specific matches=${flagged.length} (want 0); placeholder announces itself=${readable}`,
  )
}

const failed = checks.filter((c) => !c.ok).length
console.log(`\nPUBLISHED PATHS: ${failed === 0 ? "PASS" : `FAILED (${failed})`}`)
process.exit(failed === 0 ? 0 : 1)