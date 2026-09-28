// Brain log shim — wraps our util/log
import { createLogger } from "../util/log.js"

const logger = createLogger("brain")

export function create(tags?: Record<string, any>) {
  const service = tags?.service ?? "brain"
  return createLogger(service)
}

// M40.A9 purge: setQuiet() removed — zero callers; BB_QUIET was written here
// but never read anywhere (a phantom env var). Quiet is BB_LOG_LEVEL=warn
// via the CLI --quiet flag (M22.W1), which workers inherit.

export function setTuiActive(_active: boolean) {}

export default { create, setTuiActive }
