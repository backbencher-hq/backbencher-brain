// script/m55/screenshot-protocol.ts — M55.V1 deliverable 1 (issue #776): the
// screenshot protocol of docs/m55/SCREENSHOT-PROTOCOL.md, mechanized.
//
// The rule it enforces (Truth Rule 5, "the editor is the gate"): a claim about
// the editor is a claim about THE INSTALLED BUNDLE. The owner's report of
// 2026-09-12 was, in three of four complaints, a report about a build that
// predated the fix. So this rig:
//
//   1. builds and packages the extension, then installs the VSIX into an
//      ISOLATED profile (its own --extensions-dir and --user-data-dir) — never
//      the owner's window, never a stale bundle;
//   2. records the sha256 of the installed bundle, its install time, the editor
//      version, the display geometry and the fixture workspace hash;
//   3. launches the editor on the DECLARED external fixture
//      ($HOME/bb-demo-hub, used as-is per the owner's decision) on a
//      virtual display and drives the DECLARED flows with keyboard input
//      (deterministic: `code -g` to place the cursor, the editor's own chords
//      and the extension's contributed commands through the palette — no
//      pixel-hunting required to DRIVE a flow);
//   4. captures a frame per step with `import -window root`, hashing each one.
//
// When any declared prerequisite is absent (display tooling, the editor, the
// fixture workspace, its index, PIL) the session returns a DECLARED BLOCKED
// record with the reason — never green, never silently skipped.
//
// Run: npx tsx script/m55/screenshot-protocol.ts [--run <name>] [--out <manifest.json>]
//      [--fixture <workspace>]
//
// `--fixture` is the BLOCKED-PATH proof hook: V1's closure requires a session
// run with the fixture ABSENT to come back blocked-with-reason (never green),
// and that requires being able to point the rig at a workspace that is not
// there. The declared fixture remains the default, and the workspace actually
// used is recorded in the session record.

import { execFileSync, spawn, type ChildProcess } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { M55_ROOT } from "./lsp-wire.ts"
import { EDITOR_CONTENT_REGION, navigationSpannedFile, noNavigationReason, type RegionDiff } from "./navigation.ts"
import { DECLARED_FIXTURE, resolvePosition } from "./wire-probe.ts"
import { writeSealed } from "../lib/evidence.ts"

const ROOT = M55_ROOT

export const DISPLAY = ":99"
export const SCREEN = { width: 1920, height: 1080 } as const
export const FRAMES_DIR = path.join(M55_ROOT, "validation/m55/frames")
export const PIXEL_READ = path.join(M55_ROOT, "script/m55/pixel-read.py")

/** The declared flows (docs/m55/SCREENSHOT-PROTOCOL.md §4). Each flow states
 *  what it exists to show; a flow that cannot be driven is reported blocked. */
export interface CaptureFlow {
  id: string
  label: string
  shows: string
  file: string
  /** the symbol the cursor must sit ON: both the hover chord and the
   *  extension's commands resolve the symbol under the cursor, so a cursor in
   *  whitespace makes the flow silently do nothing (found on the first live
   *  run — the frames were identical and the gate's distinctness check said
   *  so). The position is resolved from the file text, never hardcoded. */
  symbol: string
  kind: "declaration" | "call-site"
  /** the editor action that produces the frame. `thenKeys` drives the editor's
   *  OWN keyboard navigation after the command (T2's closure requirement is the
   *  click that lands on the call site: activating a caller in the tree is
   *  VS Code's navigation, so the deterministic headless equivalent is the
   *  keyboard activation on the tree row). */
  action:
    | { kind: "none" }
    | { kind: "hover" }
    | {
        kind: "command"
        command: string
        title: string
        thenKeys?: string[]
        /** Click the Nth text row FOUND in a region of the window (region given
         *  in window fractions). The row is measured from a scratch frame the
         *  rig captures just before the click — positions are FOUND, not frozen:
         *  the first attempt froze a y-coordinate measured from an earlier run
         *  and clicked the tree's ROOT row instead of a caller, because the tab
         *  strip's height shifted the tree by ~30 px between runs. */
        thenClickRow?: { region: [number, number, number, number]; index: number }
        /** Keys sent AFTER the row click. A click on a tree row SELECTS it (and
         *  gives the tree focus); the activation that navigates is the second
         *  half — exactly how a developer finishes the gesture. */
        afterClickKeys?: string[]
      }
}

export const CAPTURE_FLOWS: CaptureFlow[] = [
  { id: "1", label: "base", shows: "the workspace open at the pinned settings (the reference frame)", file: "src/greeter.ts", symbol: "greet", kind: "declaration", action: { kind: "none" } },
  { id: "2", label: "hover-declaration", shows: "the card at a method's declaration (T3, T4, T5)", file: "src/greeter.ts", symbol: "greet", kind: "declaration", action: { kind: "hover" } },
  { id: "3", label: "hover-call-site", shows: "the card at a call site — the same identity (T1, T3)", file: "src/report.ts", symbol: "greet", kind: "call-site", action: { kind: "hover" } },
  { id: "4", label: "open-in-graph", shows: "the hub list by file (T3, T5, P1)", file: "src/greeter.ts", symbol: "Greeter", kind: "declaration", action: { kind: "command", command: "bb.openGraph", title: "Backbencher: Open in Graph" } },
  { id: "5", label: "impact", shows: "the impact view (T1 U5 root)", file: "src/greeter.ts", symbol: "Greeter", kind: "declaration", action: { kind: "command", command: "bb.openImpact", title: "Backbencher: Impact Analysis" } },
  { id: "6", label: "call-hierarchy", shows: "the call hierarchy (T2)", file: "src/greeter.ts", symbol: "greet", kind: "declaration", action: { kind: "command", command: "bb.showCallHierarchy", title: "Backbencher: Show Call Hierarchy" } },
  { id: "7", label: "status", shows: "the status surface: every fact carries its claim level (Truth Rule 1)", file: "src/greeter.ts", symbol: "greet", kind: "declaration", action: { kind: "command", command: "bbLsp.showStatusPanel", title: "Backbencher: Show status (evidence levels, staleness)" } },
  // T1's own closure requirement: "the constructor case reproduced by V1's
  // fresh-install frame showing the label". The owner's filing evidence
  // (s10-ctor-graph.png) captured the SILENT RELABEL — a constructor graph that
  // opened on the class with nothing said. These two flows capture the same
  // case after the fix, so the claim has a frame at the evidence HEAD instead
  // of a reference to the filing run.
  { id: "8", label: "ctor-hover-declaration", shows: "the card at the constructor's declaration — a member identity that resolves (T1 U5)", file: "src/greeter.ts", symbol: "constructor", kind: "declaration", action: { kind: "hover" } },
  { id: "9", label: "ctor-open-in-graph", shows: "the hub opened from the constructor — the label names the owning declaration (T1 U5, the silent relabel)", file: "src/greeter.ts", symbol: "constructor", kind: "declaration", action: { kind: "command", command: "bb.openGraph", title: "Backbencher: Open in Graph" } },
  // T3's own closure requirement: the zero-usage case in the editor ("0 usages"
  // and NO list — declared absence, never the callees or the owning class).
  { id: "10", label: "hover-zero-usages", shows: "the card for a symbol with zero usages — a declared absence (T3)", file: "src/greeter.ts", symbol: "greetAll", kind: "declaration", action: { kind: "hover" } },
  // T2's own closure requirement: "clicking one lands on the CALL SITE with the
  // correct symbol".
  //
  // F13 (recorded result of the first attempt): the KEYBOARD driver
  // (Down + Return) did not reach the tree on a bare Xvfb — the frame showed no
  // call-hierarchy view and the cursor still on greeter.ts:15 — so that flow was
  // removed rather than kept with a label the frame did not support.
  //
  // This flow uses a real MOUSE CLICK on a caller row, which is what the owner's
  // requirement describes and what a developer does. The row is FOUND in a
  // scratch frame the rig captures just before the click (never a frozen
  // coordinate — see thenClickRow), inside a region measured from
  // validation/m55/frames/live-14/6-call-hierarchy.png.
  //
  // GESTURE (corrected after reading live-17 and live-19 side by side):
  //   live-17 — click + `Return`: the editor opened src/app.ts with the caller
  //             `main` selected.                                    = NAVIGATION
  //   live-19 — click + `Right`,`Down`,`Return`: the click had not taken the
  //             row selection, so the keys went to the EDITOR — the frame shows
  //             the same file with a dirty dot and the cursor on line 15.
  // The two extra keys bought nothing and could only damage the file, so the
  // gesture is the click plus the single activation key. On top of that the rig
  // now REFUSES to record a frame whose editor did not navigate (the shared
  // rule in script/m55/navigation.ts), which is how live-19 was recorded as a
  // landing while showing a cursor move. The label says what the frame shows:
  // the editor lands on the CALLER (its declaration), which is the landing half
  // of T2; the call-site nuance is recorded in F13 and machine-asserted at the
  // wire by script/m55/verify-call-hierarchy.ts (every fromRange resolves to
  // the invocation token).
  { id: "11", label: "call-hierarchy-click", shows: "the call hierarchy after CLICKING a caller — the editor opens the caller's file with the caller (T2; the call-site nuance is F13)", file: "src/greeter.ts", symbol: "greet", kind: "declaration", action: { kind: "command", command: "bb.showCallHierarchy", title: "Backbencher: Show Call Hierarchy", thenClickRow: { region: [0.646, 0.296, 0.839, 0.407], index: 1 }, afterClickKeys: ["Return"] } },
  // The call-SITE half of the same gesture (T2's wording: "lands on the CALL
  // SITE") was ATTEMPTED as a second flow (expand the caller, Down onto its
  // call-site child, Return) and is NOT here: re-issuing the call-hierarchy
  // command in the following flow produced no state change, so the rig's
  // own "did the workbench change?" check refused the frame twice (live-18,
  // live-19). What the kept flow DOES prove is recorded in F13.
]

export interface FrameRecord {
  flow: string
  label: string
  shows: string
  path: string
  sha256: string
  bytes: number
  capturedAt: string
  /** the editor window's geometry at capture time. Without a window manager
   *  this cannot be assumed to be the whole screen, so the gate reads its
   *  regions RELATIVE to this rectangle rather than to the display. */
  window: { x: number; y: number; width: number; height: number } | null
}

export interface SessionResult {
  status: "captured" | "blocked"
  reason?: string
  run: string
  display: string
  screen: { width: number; height: number }
  editor: { binary: string; version: string; pinnedDeclared: string; pinHonored: boolean }
  bundle: { vsix: string; installedAt: string; bundlePath: string; bundleSha256: string }
  fixture: { workspace: string; present: boolean; contentHash: string | null; indexedProjectDir: string | null }
  flows: Array<{ id: string; label: string; status: "captured" | "blocked"; reason?: string; frame?: FrameRecord }>
  generatedAt: string
}

function run(cmd: string, args: string[], opts: { cwd?: string; timeout?: number; env?: Record<string, string> } = {}): string {
  return execFileSync(cmd, args, {
    cwd: opts.cwd ?? M55_ROOT,
    encoding: "utf8",
    timeout: opts.timeout ?? 300_000,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...(opts.env ?? {}) },
  })
}

function sha256File(p: string): string {
  return createHash("sha256").update(readFileSync(p)).digest("hex")
}

function sh(cmd: string, args: string[], env: Record<string, string> = {}): { ok: boolean; out: string } {
  try {
    return { ok: true, out: run(cmd, args, { timeout: 60_000, env }) }
  } catch (e) {
    return { ok: false, out: e instanceof Error ? e.message : String(e) }
  }
}

/** The declared prerequisites. Missing entries produce a blocked session (the
 *  gate records them; it never turns them into a pass). */
export function rigPreflight(fixture: string = DECLARED_FIXTURE): { ok: boolean; missing: string[]; notes: Record<string, string> } {
  const missing: string[] = []
  const notes: Record<string, string> = {}
  for (const tool of ["Xvfb", "xdotool", "import"]) {
    const found = sh("bash", ["-lc", `command -v ${tool}`])
    if (!found.ok || found.out.trim() === "") missing.push(`${tool} (display tooling)`)
    else notes[tool] = found.out.trim()
  }
  const editor = sh("bash", ["-lc", "command -v code"])
  if (!editor.ok || editor.out.trim() === "") missing.push("code (the editor under test)")
  else notes.editor = editor.out.trim()
  const pil = sh("python3", ["-c", "import PIL; print(PIL.__version__)"])
  if (!pil.ok) missing.push("python3 + PIL (script/m55/pixel-read.py)")
  else notes.pil = pil.out.trim()
  if (!existsSync(fixture)) missing.push(`declared fixture workspace (${fixture})`)
  return { ok: missing.length === 0, missing, notes }
}

/** Hash the fixture's content so a fixture edit is visible in the evidence. */
export function fixtureContentHash(workspace: string): string | null {
  if (!existsSync(workspace)) return null
  try {
    const files = run("bash", ["-lc", `find ${JSON.stringify(workspace)} -type f -not -path '*/node_modules/*' -not -path '*/.git/*' | sort | xargs sha256sum`])
    return createHash("sha256").update(files).digest("hex")
  } catch {
    return null
  }
}

/** The owner's index directory for the fixture (the protocol's §3 decision:
 *  the session sees the same data the owner sees). */
export function fixtureProjectDir(workspace: string): string | null {
  const pid = createHash("sha1").update(path.resolve(workspace)).digest("hex").substring(0, 40)
  const dir = path.join(homedir(), ".bb", "projects", pid)
  return existsSync(path.join(dir, "brain.db")) ? dir : null
}

/** Build + package the extension under test; returns the VSIX path. */
export function buildVsix(): { vsix: string; bundleSha256: string } {
  const ide = path.join(M55_ROOT, "ide/vscode")
  run("node", ["./esbuild-extension.mjs"], { cwd: ide })
  run("node", ["./collect-server-deps.mjs"], { cwd: ide })
  run("npx", ["--yes", "@vscode/vsce", "package", "--allow-missing-repository", "--no-git-tag-version"], { cwd: ide, timeout: 420_000 })
  const vsix = path.join(ide, "bb-lsp-vscode-0.1.0.vsix")
  if (!existsSync(vsix)) throw new Error(`vsce did not produce ${vsix}`)
  const bundle = path.join(ide, "dist/extension.js")
  return { vsix, bundleSha256: existsSync(bundle) ? sha256File(bundle) : "" }
}

/** Install the VSIX into an ISOLATED profile and return the installed bundle. */
export function installIntoProfile(profile: string, vsix: string): { extensionDir: string; bundlePath: string; bundleSha256: string; installedAt: string } {
  const extDir = path.join(profile, "extensions")
  const dataDir = path.join(profile, "user-data")
  mkdirSync(extDir, { recursive: true })
  mkdirSync(dataDir, { recursive: true })
  run("bash", ["-lc", `command -v code`])
  run("code", ["--install-extension", vsix, "--force", "--extensions-dir", extDir, "--user-data-dir", dataDir], { timeout: 240_000 })
  const bundlePath = path.join(extDir, "backbencher.bb-lsp-vscode-0.1.0/dist/extension.js")
  if (!existsSync(bundlePath)) throw new Error(`the isolated install has no bundle at ${bundlePath}`)
  return { extensionDir: extDir, bundlePath, bundleSha256: sha256File(bundlePath), installedAt: new Date().toISOString() }
}

/** EVERY input/capture call MUST carry the rig's own display. Without it,
 *  xdotool falls back to the ambient DISPLAY (the owner's real desktop on :0)
 *  and the rig drives — moves, resizes, clicks and types into — the owner's
 *  editor window. That happened on the first live runs; this is the fix, and
 *  `assertOwnWindow` below is the guard that makes it unrepeatable. */
function xdo(...args: string[]): void {
  sh("xdotool", args, { DISPLAY })
}

function spawnDetached(cmd: string, args: string[], env: Record<string, string> = {}): ChildProcess {
  const child = spawn(cmd, args, { detached: true, stdio: "ignore", env: { ...process.env, ...env } })
  child.unref()
  return child
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

/** A capture session: build, install, launch, drive, capture, record. */
export async function runCaptureSession(opts: { run?: string; profile?: string; fixture?: string } = {}): Promise<SessionResult> {
  const runName = opts.run ?? `run-${new Date().toISOString().replace(/[:.]/g, "-")}`
  const profile = opts.profile ?? path.join(M55_ROOT, "validation/m55/profile")
  /** The workspace under test. Declared (wire-probe's DECLARED_FIXTURE) unless
   *  an explicit override is passed: the override exists so the BLOCKED PATH is
   *  provable — V1's closure requires a session run with the fixture absent to
   *  come back blocked-with-reason, never green, and that cannot be shown
   *  without being able to point the rig at a workspace that is not there. */
  const fixture = opts.fixture ?? DECLARED_FIXTURE
  const outDir = path.join(FRAMES_DIR, runName)
  const editorVersion = sh("bash", ["-lc", "code --version | head -3"]).out.trim().split("\n")
  const base: SessionResult = {
    status: "blocked",
    run: runName,
    display: DISPLAY,
    screen: { ...SCREEN },
    editor: { binary: sh("bash", ["-lc", "command -v code"]).out.trim(), version: editorVersion[0] ?? "unknown", pinnedDeclared: "1.85.0 (.vscode-test)", pinHonored: false },
    bundle: { vsix: "", installedAt: "", bundlePath: "", bundleSha256: "" },
    fixture: { workspace: fixture, present: existsSync(fixture), contentHash: fixtureContentHash(fixture), indexedProjectDir: fixtureProjectDir(fixture) },
    flows: [],
    generatedAt: new Date().toISOString(),
  }

  const pre = rigPreflight(fixture)
  if (!pre.ok) return { ...base, reason: `rig prerequisites absent: ${pre.missing.join(", ")}` }
  if (base.fixture.indexedProjectDir === null) {
    return { ...base, reason: `the declared fixture has no index in the owner's BB_DATA_DIR (run: bb index ${fixture})` }
  }

  // A pinned profile: settings recorded with the frames so the render is
  // comparable (protocol §2).
  mkdirSync(path.join(profile, "user-data/User"), { recursive: true })
  writeFileSync(
    path.join(profile, "user-data/User/settings.json"),
    JSON.stringify(
      {
        "window.zoomLevel": 0,
        "editor.minimap.enabled": false,
        "telemetry.telemetryLevel": "off",
        "security.workspace.trust.enabled": false,
        "workbench.startupEditor": "none",
        "extensions.autoCheckUpdates": false,
        "update.mode": "none",
      },
      null,
      2,
    ),
  )

  let displayProc: ChildProcess | null = null
  let editorProc: ChildProcess | null = null
  try {
    const built = buildVsix()
    const installed = installIntoProfile(profile, built.vsix)
    base.bundle = { vsix: built.vsix, installedAt: installed.installedAt, bundlePath: installed.bundlePath, bundleSha256: installed.bundleSha256 }
    if (built.bundleSha256 !== "" && built.bundleSha256 !== installed.bundleSha256) {
      return { ...base, reason: `the isolated install's bundle hash differs from the built bundle (built ${built.bundleSha256.slice(0, 12)} vs installed ${installed.bundleSha256.slice(0, 12)}) — a stale install would make every frame a lie` }
    }

    rmSync(outDir, { recursive: true, force: true })
    mkdirSync(outDir, { recursive: true })

    // Clear the isolated profile's singleton locks: a killed session leaves
    // them behind, and the next launch then hangs behind a "profile in use"
    // prompt without ever showing a window (found by live-4: 0/7 frames,
    // "the editor window never appeared").
    for (const lock of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
      try {
        const p = path.join(profile, "user-data", lock)
        if (existsSync(p)) rmSync(p, { force: true })
      } catch {}
    }

    // Clear a STALE X lock: a killed display leaves /tmp/.X99-lock behind and
    // the next Xvfb silently refuses to start, which then reads as "the editor
    // window never appeared" (found by live-4/live-5 — the frames leg was
    // reporting the wrong cause).
    const displayNum = DISPLAY.replace(":", "")
    for (const stale of [`/tmp/.X${displayNum}-lock`, `/tmp/.X11-unix/X${displayNum}`]) {
      try {
        if (existsSync(stale)) rmSync(stale, { force: true })
      } catch {}
    }
    displayProc = spawnDetached("Xvfb", [DISPLAY, "-screen", "0", `${SCREEN.width}x${SCREEN.height}x24`])
    let displayUp = false
    for (let i = 0; i < 20 && !displayUp; i++) {
      await sleep(500)
      const geo = sh("bash", ["-lc", `DISPLAY=${DISPLAY} xdotool getdisplaygeometry 2>/dev/null`])
      displayUp = geo.ok && /^\d+ \d+$/.test(geo.out.trim())
    }
    if (!displayUp) {
      return { ...base, reason: `the virtual display ${DISPLAY} did not come up (Xvfb failed to start) — the frames leg cannot run` }
    }
    editorProc = spawnDetached("code", [
      "--disable-gpu",
      "--extensions-dir", path.join(profile, "extensions"),
      "--user-data-dir", path.join(profile, "user-data"),
      "--new-window",
      "--verbose",
      fixture,
    ], { DISPLAY })
    // Wait for the workbench: the window must exist before any capture.
    let windowId = ""
    for (let i = 0; i < 60; i++) {
      await sleep(1000)
      const found = sh("xdotool", ["search", "--onlyvisible", "--class", "Code"], { DISPLAY })
      const byName = found.ok && found.out.trim() !== "" ? found : sh("xdotool", ["search", "--onlyvisible", "--name", "Visual Studio Code"], { DISPLAY })
      if (byName.ok && byName.out.trim() !== "") {
        windowId = byName.out.trim().split("\n")[0]!
        break
      }
    }
    if (windowId === "") return { ...base, reason: `the editor window never appeared on the virtual display ${DISPLAY} within 60s` }
    // GUARD: never drive a window that is not this session's own instance. The
    // window's process must be an editor launched with THIS profile's dirs.
    const winPid = sh("xdotool", ["getwindowpid", windowId], { DISPLAY }).out.trim()
    const winCmd = winPid === "" ? "" : sh("bash", ["-lc", `tr '\\0' ' ' < /proc/${winPid}/cmdline 2>/dev/null || ps -o args= -p ${winPid} 2>/dev/null`]).out
    const ownWindow = winCmd.includes(path.join(profile, "user-data")) || winCmd.includes(path.join(profile, "extensions"))
    if (!ownWindow) {
      return { ...base, reason: `refusing to drive window ${windowId} on ${DISPLAY}: its process (pid ${winPid || "?"}) is not this session's isolated instance — driving a foreign window would move, resize and type into someone else's editor` }
    }
    xdo("windowmove", windowId, "0", "0")
    xdo("windowsize", windowId, String(SCREEN.width), String(SCREEN.height))
    xdo("windowfocus", "--sync", windowId)
    xdo("windowactivate", "--sync", windowId)
    await sleep(6000)

    /** The window rectangle (the frame reads are relative to it — there is no
     *  window manager on a bare Xvfb, so the window does not necessarily fill
     *  the screen and `windowactivate` is a no-op). */
    const windowRect = (): { x: number; y: number; width: number; height: number } | null => {
      const g = sh("xdotool", ["getwindowgeometry", "--shell", windowId], { DISPLAY })
      if (!g.ok) return null
      const get = (k: string): number => Number(new RegExp(`${k}=(-?\\d+)`).exec(g.out)?.[1] ?? "0")
      const rect = { x: get("X"), y: get("Y"), width: get("WIDTH"), height: get("HEIGHT") }
      return rect.width > 100 && rect.height > 100 ? rect : null
    }
    void windowRect()
    /** Put the input focus in the editor's text area by clicking it: with no
     *  window manager, a webview that took focus swallows nothing global, but
     *  the extension's commands resolve the symbol under the ACTIVE editor, so
     *  the editor must be the focused control (found on the live run where the
     *  impact/status commands did nothing while the editor was unfocused). */
    /** Give the editor pane keyboard focus WITHOUT touching the text. The
     *  previous version clicked at 35%/30% of the window — which is inside the
     *  text area, so it MOVED the text cursor before every command flow. Since
     *  M55.V1 the symbol-scoped actions resolve their identity from the cursor
     *  when invoked without args (hover-commands.ts), so that stray click would
     *  have silently changed which symbol the flow opened. Focus is taken from
     *  the window and the palette instead; the cursor placed by `code -g`
     *  survives (asserted by the flow's own frame read). */
    const focusEditor = (): void => {
      xdo("windowfocus", "--sync", windowId)
      xdo("windowactivate", "--sync", windowId)
    }

    const frames: FrameRecord[] = []
    const captureTo = (framePath: string): boolean => {
      const captured = sh("import", ["-window", "root", "-display", DISPLAY, framePath])
      return captured.ok && existsSync(framePath)
    }
    for (const flow of CAPTURE_FLOWS) {
      try {
        xdo("windowfocus", "--sync", windowId)
        xdo("windowactivate", "--sync", windowId)
        // Place the cursor ON the symbol (the editor's own -g). Without a
        // window manager, focus has to be set explicitly too: `windowactivate`
        // is an EWMH request that does nothing on a bare Xvfb.
        const pos = resolvePosition(fixture, { file: flow.file, symbol: flow.symbol, kind: flow.kind, id: flow.id } as never)
        const line = pos === null ? 1 : pos.line + 1
        const column = pos === null ? 1 : pos.character + 1
        run("code", ["-g", path.join(fixture, flow.file) + `:${line}:${column}`, "--extensions-dir", path.join(profile, "extensions"), "--user-data-dir", path.join(profile, "user-data")], { timeout: 60_000 })
        await sleep(2500)
        xdo("windowfocus", "--sync", windowId)
        xdo("windowactivate", "--sync", windowId)
        const framePath = path.join(outDir, `${flow.id}-${flow.label}.png`)
        if (flow.action.kind === "hover") {
          // VS Code's own "Show or Focus Hover" chord — deterministic, no
          // pixel hunting to DRIVE the flow (the frames are still pixel-read).
          xdo("key", "--clearmodifiers", "ctrl+k", "ctrl+i")
          await sleep(1400)
          if (!captureTo(framePath)) {
            base.flows.push({ id: flow.id, label: flow.label, status: "blocked", reason: "capture failed (import returned an error)" })
            continue
          }
        } else if (flow.action.kind === "command") {
          // The palette is driven by the command's BARE ID — never by its
          // human title, and never with the `>` prefix.
          //
          // Three live runs taught this (probe frames kept in the findings
          // document; the palette's first entry is what Return runs):
          //   (1) the TITLE is not an identifier — live-8 typed
          //       "Backbencher: Show status", the first match was
          //       "…Show server status", and the frame showed THAT command's
          //       output while the flow claimed another.
          //   (2) `>` + the id is WORSE, not better: the fuzzy matcher put
          //       "View: Toggle Panel Visibility" first, so live-9 toggled the
          //       panel and opened a terminal — the exact opposite of the flow.
          //       (Probed directly: the frame after typing shows the match list.)
          //   (3) the bare id ranks our own command FIRST, because VS Code
          //       fuzzy-matches the id itself in the default palette mode.
          // So: type the id, and let the flow's own frame be the proof.
          const paletteQuery = flow.action.command
          let driven = false
          xdo("key", "--clearmodifiers", "Escape")
          await sleep(400)
          focusEditor()
          await sleep(400)
          xdo("key", "--clearmodifiers", "ctrl+shift+p")
          await sleep(1200)
          xdo("type", "--delay", "25", paletteQuery)
          await sleep(1600)
          xdo("key", "--clearmodifiers", "Return")
          await sleep(3000)
          // T2's closure leg: the tree row activation.
          //  * `thenKeys` drives the editor's own keyboard navigation (kept for
          //    legs that can prove the tree holds focus);
          //  * `thenClick` clicks a declared point in the window — the mouse
          //    path the owner's requirement names. A click is delivered to
          //    whatever is under the pointer, so no window manager is needed.
          for (const key of flow.action.thenKeys ?? []) {
            xdo("key", "--clearmodifiers", key)
            await sleep(1200)
          }
          if (flow.action.thenClickRow !== undefined) {
            const rect = windowRect()
            if (rect === null) {
              base.flows.push({ id: flow.id, label: flow.label, status: "blocked", reason: "the window rectangle could not be read, so a row click cannot be aimed" })
              continue
            }
            const [fx0, fy0, fx1, fy1] = flow.action.thenClickRow.region
            const rx = rect.x + Math.round(rect.width * fx0)
            const ry = rect.y + Math.round(rect.height * fy0)
            const rw = Math.round(rect.width * (fx1 - fx0))
            const rh = Math.round(rect.height * (fy1 - fy0))
            // Read the CURRENT screen: capture a scratch frame and find its rows.
            const scratch = path.join(outDir, `.scratch-${flow.id}.png`)
            if (!captureTo(scratch)) {
              base.flows.push({ id: flow.id, label: flow.label, status: "blocked", reason: "the scratch frame for the row read could not be captured" })
              continue
            }
            const read = sh("python3", [PIXEL_READ, "rows", scratch, String(rx), String(ry), String(rw), String(rh)])
            let found: { y0: number; y1: number; x0: number }[] = []
            try {
              found = ((JSON.parse(read.out) as { rows?: typeof found }).rows ?? [])
            } catch {
              found = []
            }
            const target = found[flow.action.thenClickRow.index]
            if (target === undefined) {
              // Found-not-frozen: a missing row is DECLARED, never clicked blind.
              base.flows.push({
                id: flow.id,
                label: flow.label,
                status: "blocked",
                reason: `the row to click (index ${flow.action.thenClickRow.index}) was not found in the region — ${found.length} text row(s) read`,
              })
              rmSync(scratch, { force: true })
              continue
            }
            const cx = rx + target.x0 + 120
            const cy = ry + Math.round((target.y0 + target.y1) / 2)
            xdo("mousemove", "--sync", String(cx), String(cy))
            await sleep(300)
            xdo("click", "1")
            await sleep(1200)
            // The activation half: the click selected (and focused) the row, so
            // the tree is the focused control now — Return navigates from it.
            for (const key of flow.action.afterClickKeys ?? []) {
              xdo("key", "--clearmodifiers", key)
              await sleep(1800)
            }
            await sleep(1500)
            // The self-check (see script/m55/navigation.ts): the scratch frame
            // is the PRE-click screen, so capturing the post-click screen and
            // applying the shared rule tells the rig whether the gesture
            // navigated. A frame that did not navigate is DECLARED BLOCKED here
            // and never recorded — the same discipline as the palette flow's
            // "did the workbench change?" check, and the reason a cursor move
            // can no longer be filed as a landing.
            const post = path.join(outDir, `.scratch-${flow.id}-post.png`)
            if (!captureTo(post)) {
              base.flows.push({ id: flow.id, label: flow.label, status: "blocked", reason: "the post-click frame for the navigation check could not be captured" })
              rmSync(scratch, { force: true })
              continue
            }
            const [ex, ey, ew, eh] = EDITOR_CONTENT_REGION
            const navRead = sh("python3", [
              PIXEL_READ,
              "diff",
              scratch,
              post,
              String(rect.x + Math.round(rect.width * ex)),
              String(rect.y + Math.round(rect.height * ey)),
              String(Math.round(rect.width * ew)),
              String(Math.round(rect.height * eh)),
            ])
            let navDiff: RegionDiff | null = null
            try {
              navDiff = JSON.parse(navRead.out) as RegionDiff
            } catch {
              navDiff = null
            }
            rmSync(scratch, { force: true })
            rmSync(post, { force: true })
            if (!navigationSpannedFile(navDiff)) {
              base.flows.push({
                id: flow.id,
                label: flow.label,
                status: "blocked",
                reason: `the click did not navigate — ${noNavigationReason(navDiff)}`,
              })
              continue
            }
          }
          if (captureTo(framePath)) {
            const previous = frames[frames.length - 1]
            if (previous === undefined) {
              driven = true
            } else {
              const d = sh("python3", [PIXEL_READ, "diff", path.join(ROOT, previous.path), framePath, "0", "0", String(SCREEN.width), String(SCREEN.height)])
              driven = d.ok && Number((JSON.parse(d.out) as { changedPixels?: number }).changedPixels ?? 0) > 500
            }
          }
          if (!driven) {
            base.flows.push({ id: flow.id, label: flow.label, status: "blocked", reason: `the command \`${paletteQuery}\` did not change the workbench (it was driven by id, so no other command can have answered)` })
            continue
          }
        } else if (!captureTo(framePath)) {
          base.flows.push({ id: flow.id, label: flow.label, status: "blocked", reason: "capture failed (import returned an error)" })
          continue
        }
        const rec: FrameRecord = {
          flow: flow.id,
          label: flow.label,
          shows: flow.shows,
          path: path.relative(M55_ROOT, framePath),
          sha256: sha256File(framePath),
          bytes: statSync(framePath).size,
          capturedAt: new Date().toISOString(),
          window: windowRect(),
        }
        frames.push(rec)
        base.flows.push({ id: flow.id, label: flow.label, status: "captured", frame: rec })
      } catch (e) {
        base.flows.push({ id: flow.id, label: flow.label, status: "blocked", reason: e instanceof Error ? e.message.slice(0, 160) : String(e) })
      }
    }
    // Escape out of any open overlay so the next run starts clean.
    xdo("key", "--clearmodifiers", "Escape")
    const captured = base.flows.filter((f) => f.status === "captured").length
    if (captured === 0) return { ...base, reason: "not one frame was captured (every flow failed) — reported as blocked with the per-flow reasons above" }
    base.status = "captured"
    writeSealed(path.join(outDir, "manifest.json"), base)
    return base
  } catch (e) {
    return { ...base, reason: `session threw: ${e instanceof Error ? e.message.slice(0, 220) : String(e)}` }
  } finally {
    try { editorProc?.kill() } catch {}
    try { displayProc?.kill() } catch {}
  }
}

// --- CLI ---------------------------------------------------------------------------
if (process.argv[1] !== undefined && /screenshot-protocol\.ts$/.test(process.argv[1])) {
  const args = process.argv.slice(2)
  const runIdx = args.indexOf("--run")
  const fixtureIdx = args.indexOf("--fixture")
  const result = await runCaptureSession({
    run: runIdx >= 0 ? args[runIdx + 1] : undefined,
    fixture: fixtureIdx >= 0 ? args[fixtureIdx + 1] : undefined,
  })
  const outIdx = args.indexOf("--out")
  if (outIdx >= 0 && args[outIdx + 1] !== undefined) writeSealed(args[outIdx + 1]!, result)
  console.log(`screenshot-protocol: ${result.status}${result.reason !== undefined ? ` — ${result.reason}` : ""} (${result.flows.filter((f) => f.status === "captured").length}/${CAPTURE_FLOWS.length} frames)`)
  for (const flow of result.flows) {
    console.log(`  ${flow.status === "captured" ? "✓" : "✗"} ${flow.id} ${flow.label}${flow.reason !== undefined ? ` — ${flow.reason}` : ""}`)
  }
  process.exit(result.status === "captured" ? 0 : 2)
}
