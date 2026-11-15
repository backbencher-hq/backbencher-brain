// bb_tests/bb_patterns/harness/run-cli.mjs — Node-native entry to the bb CLI.
//
// WHY THIS FILE EXISTS:
//   `src/cli/index.ts` guards its direct-invocation entry with `import.meta.main`,
//   which is a Bun-only flag. Under plain Node (`tsx src/cli/index.ts ...`) that
//   expression is `undefined`, the module only *defines* `runCli`, and the
//   process exits 0 with NO output and NO index written. That is a silent no-op:
//   every exit code looks like success.
//
//   `bin/bb` avoids this by importing `runCli` and calling it explicitly, but it
//   requires a prior `tsup` build. This harness does the same export-call dance
//   against the TypeScript source so corpus runs do not depend on build state.
//
// The repo path comes from BB_REPO (set by env.sh) and NOT from a relative
// import. A relative path here silently broke when this file moved down one
// directory: ESM resolves a relative specifier against the module's own URL, so
// `../../backbencher-brain` became bb_tests/backbencher-brain and the run died
// with ERR_MODULE_NOT_FOUND after a full reindex had already been launched.
//
// usage:
//   node run-cli.mjs index <dir>
//   node run-cli.mjs patterns [...args]

import path from "node:path"
import { pathToFileURL } from "node:url"

const REPO = process.env.BB_REPO
if (!REPO) {
  console.error("run-cli.mjs: set BB_REPO (source harness/env.sh)")
  process.exit(2)
}
const { runCli } = await import(pathToFileURL(path.join(REPO, "src/cli/index.ts")).href)

const argv = process.argv.slice(2)
if (argv.length === 0) {
  console.error("run-cli.mjs: no command given")
  process.exit(2)
}

try {
  await runCli(argv)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`error: ${message}`)
  process.exitCode = 1
}
