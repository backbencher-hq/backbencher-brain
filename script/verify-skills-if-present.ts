/**
 * verify-skills-if-present.ts — run the skills gate when the skills source is present.
 *
 * The release tree published to GitHub is filtered: `skills/` is excluded because the
 * skills package has its own repository. The skills gate still runs in the private
 * development repository and in the skills repository itself; in the filtered tree it
 * reports the skip instead of failing on a directory that was deliberately not published.
 */
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"

if (!existsSync("skills/package.json")) {
  console.log("skills/ is absent in this filtered tree: the skills gate is verified in the skills repository.")
  process.exit(0)
}
const result = spawnSync(process.execPath, ["--import", "tsx", "script/verify-skills.ts"], { stdio: "inherit" })
process.exit(result.status ?? 1)
