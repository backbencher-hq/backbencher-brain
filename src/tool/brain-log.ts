// Brain log shim — wraps our util/log
import { createLogger } from "../util/log.js"

const logger = createLogger("brain")

export function create(tags?: Record<string, any>) {
  const service = tags?.service ?? "brain"
  return createLogger(service)
}

export function setQuiet(q: boolean) {
  if (q) {
    process.env.BB_QUIET = "1"
  } else {
    delete process.env.BB_QUIET
  }
}

export function setTuiActive(_active: boolean) {}

export default { create, setQuiet, setTuiActive }
