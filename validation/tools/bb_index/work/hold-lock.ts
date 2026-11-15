// Hold the project index lock until killed — a live second process for the door probe.
import { acquireIndexLock } from "../../../../src/ast/index-lock"
const projectId = process.argv[2]
const lock = await acquireIndexLock(projectId, { kind: "hold" })
console.log("LOCKED " + process.pid + " " + lock.token)
const keep = setInterval(() => {}, 60_000)
process.on("SIGTERM", () => { clearInterval(keep); process.exit(0) })
