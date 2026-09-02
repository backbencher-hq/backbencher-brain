// script/m25/fork-runner.ts — M25.V1: the fork runner (executed by E6 against
// Cursor/Windsurf/Antigravity at pinned versions).
//
// TRANSPORT ADAPTER ONLY (one-library rule): assertions come from
// script/m25/feature-assertions.ts. This file owns fork availability
// detection, pinned-version launch commands, and the honest blocked state —
// an unavailable fork is recorded with a reason, never silently skipped
// (contract: silence is guilt; the E5/E6 waiver rule).
import { spawnSync } from "node:child_process"

/** The forks E6 verifies (research base: all VS Code forks, OpenVSX consumers). */
export const FORKS = [
  { name: "cursor", cli: "cursor", flag: "--version" },
  { name: "windsurf", cli: "windsurf", flag: "--version" },
  { name: "antigravity", cli: "antigravity", flag: "--version" },
] as const

export type ForkAvailability =
  | { name: string; available: true; version: string; cli: string }
  | { name: string; available: false; reason: string }

/** Detect a fork CLI on PATH and record its version (blocked with reason otherwise). */
export function forkAvailability(fork: { name: string; cli: string; flag: string }): ForkAvailability {
  const probe = spawnSync("which", [fork.cli], { encoding: "utf8" })
  if (probe.status !== 0 || !probe.stdout.trim()) {
    return { name: fork.name, available: false, reason: `${fork.cli} CLI not found on PATH — install or record the waiver (E6 honest blocked state)` }
  }
  const version = spawnSync(fork.cli, [fork.flag], { encoding: "utf8", timeout: 30_000 })
  if (version.status !== 0) {
    return { name: fork.name, available: false, reason: `${fork.cli} --version failed: ${String(version.stderr).slice(0, 120)}` }
  }
  return { name: fork.name, available: true, version: version.stdout.trim().split("\n")[0]!, cli: fork.cli }
}

/** Availability for every fork — the honest E6 preflight record. */
export function preflightForks(): ForkAvailability[] {
  return FORKS.map(forkAvailability)
}
