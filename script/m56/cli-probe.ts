// script/m56/cli-probe.ts — M56.D1 support.
//
// Prints the real CLI's help/version output for the given arguments to stdout,
// so a gate can read the SHIPPED surface without depending on a compiled dist
// or on `import.meta.main` (which is Bun-only, so `tsx src/cli/index.ts ...` is
// a silent no-op under Node — the trap M23.P3's comment warns about).
//
// Usage: npx tsx script/m56/cli-probe.ts index --help
//
// Commander prints help and exits the process; that exit code is this
// process's exit code, which is exactly what the caller wants to observe.

import { runCli } from "../../src/cli/index"

await runCli(process.argv.slice(2))
