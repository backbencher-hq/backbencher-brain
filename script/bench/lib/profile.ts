// script/bench/lib/profile.ts — build an isolated, disposable DSH home for ONE arm.
//
// WHY THIS EXISTS (read docs/benchmarks/HARNESS.md before changing this file).
//
// A benchmark arm is only an arm if the agent's tool inventory is exactly what the arm
// declares. Three separate things can silently break that, and all three were observed
// on the reference machine before this file existed:
//
//   1. The bb MCP server is a PLUGIN, not a host row. Removing it from a profile is the
//      documented way to build the no-bb arm. But `bb` is also on PATH, so the "no bb"
//      agent can run `bb --version` in bash and get the product. Measured:
//      {"tool":"bash","input":{"command":"bb --version"}} -> "0.2.2". An unshimmed
//      control measures bb-with-tools against bb-through-bash and UNDERSTATES the very
//      benefit the benchmark exists to measure. Hence the PATH shim below.
//   2. `@deepseek-ai/dsh-mcp-client` needs `transport: stdio`. Omit it and the plugin
//      throws "TypeError: Cannot convert undefined or null to object" at load, the run
//      still COMPLETES, the agent still answers confidently, and the C arm has no bb
//      tools. That is the false negative that would be read as "bb doesn't help".
//   3. FreePi authenticates with a persisted install secret (`freepi-install.json`),
//      not an env var. Seeding only `.credentials.yaml` yields FREEPI_NOT_SIGNED_IN.
//
// The profile is generated per WAVE, not per run, because a run must not be able to
// mutate the conditions it is measured under.

import {
  mkdirSync,
  writeFileSync,
  cpSync,
  existsSync,
  rmSync,
  symlinkSync,
  readdirSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";

/** Absolute path of the placebo proxy, resolved next to this file. */
const PLACEBO_ENTRY = path.join(import.meta.dirname ?? ".", "placebo-proxy.ts");

/** The arms. A and B have no bb server; C and D do. See benchmarks/spec/ARMS.md. */
export type Arm = "A" | "B" | "C" | "D" | "E";

export const ARMS: readonly Arm[] = ["A", "B", "C", "D", "E"] as const;

export interface ArmSpec {
  arm: Arm;
  /** Is the bb MCP server mounted in the agent's profile? */
  bbMcp: boolean;
  /** Does the prompt carry the frozen bb manual block? */
  manualBlock: boolean;
  /** Are the published bb skills + AGENTS.md onboard section present? */
  skills: boolean;
  /**
   * PLACEBO. The server is mounted and answers, but every task-bearing argument is
   * rewritten so the returned content is unrelated to the task. This is the presentation
   * control that separates "the tools return useful things" from "having tools changes
   * behaviour" -- without it a C-vs-A gain cannot be attributed to content at all.
   * See docs/benchmarks/PRIOR-WORK.md 1 and lib/placebo-proxy.ts.
   */
  placebo: boolean;
}

export const ARM_SPECS: Record<Arm, ArmSpec> = {
  A: {
    arm: "A",
    bbMcp: false,
    manualBlock: false,
    skills: false,
    placebo: false,
  },
  B: {
    arm: "B",
    bbMcp: false,
    manualBlock: true,
    skills: false,
    placebo: false,
  },
  C: {
    arm: "C",
    bbMcp: true,
    manualBlock: true,
    skills: false,
    placebo: false,
  },
  D: { arm: "D", bbMcp: true, manualBlock: true, skills: true, placebo: false },
  // E is C with the arguments scrambled. Same manual block, same 16 tools, same server --
  // only the CONTENT of the answers stops being about the task.
  E: { arm: "E", bbMcp: true, manualBlock: true, skills: false, placebo: true },
};

export interface ProfileOptions {
  /** Where the wave's work tree lives (already gitignored). */
  waveRoot: string;
  arm: Arm;
  /** Absolute path of the project the bb server should index for this arm. */
  projectDir: string;
  /** Provider + model to PIN. `auto` is refused: a moving default is not a condition. */
  provider: string;
  model: string;
  /** Override the bb binary (tests use a fake). */
  bbBin?: string;
  /** Where the operator's real DSH home is (source of the seeded secrets). */
  sourceHome?: string;
  /** Skip seeding credentials (used by the offline selftest). */
  seedCredentials?: boolean;
}

export interface BuiltProfile {
  home: string;
  profileDir: string;
  shimDir: string;
  /** Per-arm agents home holding the skill catalog (empty unless arm D). */
  agentsHome: string;
  /** How many bb-* skills were installed for this arm (0 for A/B/C/E). */
  skillsInstalled: number;
  /** Absolute path of the bb binary the shim shadows (null when nothing to shadow). */
  shadowedBb: string | null;
  /** True when arm A/B got a failing `bb` on PATH. */
  cliShimmed: boolean;
  bbMcpMounted: boolean;
}

/** Non-zero exit + a message the agent can read. Mirrors "not installed" semantics. */
const SHIM_BODY = `#!/bin/sh
# bb is not available in this arm. This is a deliberate benchmark condition, not a
# broken installation: the arm under test is "an agent without Backbencher Brain".
echo "bb: command not found" >&2
echo "This environment does not have Backbencher Brain installed. Use the host tools (read, grep, glob, bash)." >&2
exit 127
`;

function realBbBinary(): string | null {
  const candidates = [
    process.env.BENCH_BB_BIN,
    // The launcher this repo ships; the npm bin is a different, global install.
    path.resolve(import.meta.dirname ?? ".", "../../../bin/bb"),
  ].filter((c): c is string => typeof c === "string" && c.length > 0);
  for (const c of candidates) if (existsSync(c)) return path.resolve(c);
  return null;
}

/**
 * Build one arm's disposable DSH home. Idempotent: a rebuild wipes the arm's home only,
 * so one arm can never corrupt another's.
 */
export function buildProfile(opts: ProfileOptions): BuiltProfile {
  const { waveRoot, arm, projectDir, provider, model } = opts;
  if (provider === "auto" || model === "auto") {
    throw new Error(
      `profile: model must be pinned, not "${model}". A provider's "auto" default moves between waves, so a run recorded under it is not reproducible.`,
    );
  }
  const spec = ARM_SPECS[arm];
  let skillsInstalled = 0;
  const home = path.join(waveRoot, "dshhome", `arm-${arm}`);
  const profileDir = path.join(home, "profiles", "headless");
  const shimDir = path.join(waveRoot, "shim", `arm-${arm}`);
  const agentsHome = path.join(waveRoot, "agentshome", `arm-${arm}`);

  rmSync(home, { recursive: true, force: true });
  rmSync(shimDir, { recursive: true, force: true });
  rmSync(agentsHome, { recursive: true, force: true });
  mkdirSync(profileDir, { recursive: true });
  mkdirSync(shimDir, { recursive: true });
  mkdirSync(path.join(agentsHome, "skills"), { recursive: true });

  // ── THE SKILLS LEAK ─────────────────────────────────────────────────────────
  //
  // DSH discovers skills from `$DSH_AGENTS_HOME` (default `~/.agents`) -- GLOBAL, not per
  // profile. This machine has the nine published bb skills installed there. Left alone, arms
  // A, B and C would load `bb-code-navigation` and friends anyway, and arm D -- whose whole
  // independent variable is "the documented experience, skills included" -- would differ
  // from C by NOTHING. That is the same defect class as the measured bb CLI leak: the
  // control arm quietly carrying the treatment.
  //
  // So every arm gets its own agents home, empty except in D, which is populated from the
  // real installed set so that D *is* the documented experience rather than a paraphrase.
  if (spec.skills) {
    const SRC =
      process.env.BENCH_SKILLS_SRC ??
      path.join(os.homedir(), ".agents", "skills");
    if (!existsSync(SRC)) {
      throw new Error(
        `profile: arm D needs the published bb skills but ${SRC} does not exist. Arm D measures the documented install; silently running it without skills would make it a duplicate of arm C.`,
      );
    }
    let copied = 0;
    for (const entry of readdirSync(SRC, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith("bb-")) continue;
      cpSync(
        path.join(SRC, entry.name),
        path.join(agentsHome, "skills", entry.name),
        { recursive: true },
      );
      copied++;
    }
    if (copied === 0) {
      throw new Error(
        `profile: arm D found no bb-* skills in ${SRC}; arm D would be identical to arm C`,
      );
    }
    skillsInstalled = copied;
  }

  // ── the headless profile skeleton ────────────────────────────────────────────
  // Copied from the operator's real profile because `dsh` composes from a profile tree,
  // and this sandbox has that tree read-only. A missing source is a hard error, not a
  // silent empty profile -- an empty profile would boot with different tools.
  const sourceHome = opts.sourceHome ?? path.join(os.homedir(), ".dsh");
  const sourceProfile = path.join(sourceHome, "profiles", "headless");
  if (!existsSync(sourceProfile)) {
    throw new Error(
      `profile: no headless profile at ${sourceProfile}. The benchmark needs a DSH profile tree to compose from; pass --source-home or install one.`,
    );
  }
  cpSync(sourceProfile, profileDir, { recursive: true });
  // The copied tree carries the operator's plugin layer; we replace it below.
  rmSync(path.join(profileDir, "cordis.patch.yml"), { force: true });

  // ── the FreePi provider plugin (not a builtin; must be present in the tree) ──
  const pluginSource = path.join(
    sourceHome,
    "profiles",
    "web",
    "node_modules",
    "dsh-free-pi-official",
  );
  if (opts.seedCredentials !== false && existsSync(pluginSource)) {
    const nm = path.join(profileDir, "node_modules");
    mkdirSync(nm, { recursive: true });
    cpSync(pluginSource, path.join(nm, "dsh-free-pi-official"), {
      recursive: true,
    });
    writeFileSync(
      path.join(profileDir, "package.json"),
      JSON.stringify(
        {
          name: "dsh-profile-headless",
          private: true,
          dependencies: { "dsh-free-pi-official": "beta" },
          dsh: {
            profile: {
              bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless"],
            },
          },
        },
        null,
        2,
      ) + "\n",
    );
  }

  // ── secrets, seeded not committed ────────────────────────────────────────────
  if (opts.seedCredentials !== false) {
    const cred = path.join(sourceHome, ".credentials.yaml");
    if (existsSync(cred))
      symlinkSync(cred, path.join(home, ".credentials.yaml"));
    const install = path.join(sourceHome, "freepi-install.json");
    if (existsSync(install))
      cpSync(install, path.join(home, "freepi-install.json"));
  }

  // ── the patch layer: provider pinned, bb server ONLY for C/D ─────────────────
  const rows: string[] = [];
  rows.push(`- insert:
    - id: freepi
      name: dsh-free-pi-official
      config:
        gateway: https://api.freepi.ai`);
  rows.push(`- id: agent-default-model
  config:
    provider: ${provider}
    model: ${model}`);

  if (spec.bbMcp) {
    const bbBin = opts.bbBin ?? realBbBinary();
    if (bbBin === null) {
      throw new Error(
        "profile: arm C/D needs a bb binary but none was found. Pass --bb-bin or set BENCH_BB_BIN. Refusing to build an arm that silently has no bb tools.",
      );
    }
    // Arm E launches the PROXY, which forwards to the same bb binary. The proxy is a
    // separate process so the arm's serverName stays `bb` and its tool surface is identical
    // -- the agent must not be able to tell E from C, or the control is meaningless.
    const command = spec.placebo ? (process.env.BENCH_TSX ?? "npx") : bbBin;
    const args = spec.placebo
      ? ["tsx", PLACEBO_ENTRY, bbBin, path.resolve(projectDir)]
      : ["mcp", "--dir", path.resolve(projectDir)];
    rows.push(`- insert:
    - id: mcp-bb
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: bb
        transport: stdio
        command: ${JSON.stringify(command)}
        args: [ ${args.map((a) => JSON.stringify(a)).join(", ")} ]
        toolCallTimeoutMs: 120000
        failOnStartupError: true`);
  }
  writeFileSync(
    path.join(profileDir, "cordis.patch.yml"),
    rows.join("\n") + "\n",
  );

  // ── the PATH shim: A and B must not reach the product through bash ──────────
  let shadowedBb: string | null = null;
  let cliShimmed = false;
  if (!spec.bbMcp) {
    shadowedBb = opts.bbBin ?? realBbBinary();
    writeFileSync(path.join(shimDir, "bb"), SHIM_BODY, { mode: 0o755 });
    cliShimmed = true;
  }

  return {
    home,
    profileDir,
    shimDir,
    agentsHome,
    skillsInstalled,
    shadowedBb,
    cliShimmed,
    bbMcpMounted: spec.bbMcp,
  };
}

/** The environment for one run. `PATH` is where the shim does its work. */
export function runEnv(
  p: BuiltProfile,
  extra: Record<string, string> = {},
): Record<string, string> {
  const base: Record<string, string> = {
    DSH_HOME: p.home,
    // Per-arm agents home: empty for A/B/C/E, the real bb skills for D. Without this the
    // global ~/.agents/skills leaks into every arm.
    DSH_AGENTS_HOME: p.agentsHome,
    // Prepend the shim so a bare `bb` resolves to the failing stub for A/B. For C/D the
    // directory is empty, so this is inert -- one code path, no arm-specific branch.
    PATH: `${p.shimDir}${path.delimiter}${process.env.PATH ?? ""}`,
  };
  return { ...base, ...extra };
}
