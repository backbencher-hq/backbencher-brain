import { execSync } from "child_process"
export function loadAvg1(): number {
  try {
    const out = execSync("cat /proc/loadavg", { encoding: "utf8" })
    return parseFloat(out.trim().split(/\s+/)[0]) || 0
  } catch { return 0 }
}
