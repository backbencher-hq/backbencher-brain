import { writeFileSync } from "node:fs"
import path from "node:path"
import { openDoor } from "./door"
const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const FIXTURE = path.join(ROOT, "validation/tools/bb_migrate/work/stale-fixture")
const door = await openDoor({ dir: FIXTURE, dataDir: path.join(ROOT, "validation/tools/bb_migrate/work/stale-data"), label: "stale-text" })
const r = await door.callTool({ symbolNames: ["total"], targetLanguage: "python" }, 120_000)
console.log(r.text)
writeFileSync(path.join(ROOT, "validation/tools/bb_migrate/raw/door-stale-text-missing.txt"), r.text)
await door.close()
