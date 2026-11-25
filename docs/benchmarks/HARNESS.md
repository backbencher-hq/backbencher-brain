# The harness recipe — verified on this machine, 2026-11-25

Everything in this file was **run**, not read. Each block says what it proves. If a
line here stops working, the arm it belongs to is invalid until it is fixed.

---

## 0 · Why this file exists

The first attempt to run a headless benchmark agent failed five times in a row, for five
different reasons, none of which was documented anywhere:

1. `~/.dsh/profiles/headless` is **read-only** in this sandbox → `EROFS` on boot.
2. headless defaults to provider **`deepseek-official`**, which has **no key** → `MISSING_CREDENTIAL`.
3. the `freepi` provider that the web profile uses is **not a builtin** — it is a
   third-party plugin (`dsh-free-pi-official`) that must be present in the profile.
4. `dsh plugin ... add` fails in the sandbox (`EROFS` from the shared pnpm store), so the
   plugin must be **copied** into the profile's `node_modules`.
5. FreePi authenticates with a **persisted install secret**, not an env var → copying
   only `.credentials.yaml` still yields `FREEPI_NOT_SIGNED_IN`.
6. and the `mcp-bb` row needs `transport: stdio`; without it the MCP client throws
   `TypeError: Cannot convert undefined or null to object` and the agent silently runs
   with **no bb tools at all** — the exact "adoption failure" that would have been
   misread as a product failure.

That last one is the dangerous failure mode: the run *succeeds*, the agent *answers*, and
the arm is quietly not the arm you think it is. So the runner must **assert** the tools
are present (§5).

---

## 1 · Build a disposable benchmark home

```bash
BENCH_HOME=<wave-root>/dshhome
mkdir -p "$BENCH_HOME/profiles"
cp -r ~/.dsh/profiles/headless "$BENCH_HOME/profiles/"          # the writable copy
ln -s ~/.dsh/.credentials.yaml "$BENCH_HOME/.credentials.yaml"
cp   ~/.dsh/freepi-install.json "$BENCH_HOME/freepi-install.json"   # the install secret
```

**Verified:** with the symlink only, `FREEPI_NOT_SIGNED_IN` (401). With
`freepi-install.json` added, the run completes. The install secret is what FreePi's
`#headers()` sends as `authorization: Bearer <secret>`; it is created lazily by
`loadInstallSecret()` under `DSH_HOME` and identifies the install to the gateway.

> **Security note for the runner:** `freepi-install.json` and `.credentials.yaml` are
> secrets. They must be seeded from the operator's home, **never** committed, and never
> copied into a run's transcript. The runner seeds them at run start and the run
> directory is scrubbed before publication (§6).

## 2 · The freepi provider (arms that need a model)

```bash
mkdir -p "$BENCH_HOME/profiles/headless/node_modules"
cp -r ~/.dsh/profiles/web/node_modules/dsh-free-pi-official \
      "$BENCH_HOME/profiles/headless/node_modules/"
```

And the profile patch layer — **pin provider + model, never `auto`**:

```yaml
# $BENCH_HOME/profiles/headless/cordis.patch.yml
- insert:
    - id: freepi
      name: dsh-free-pi-official
      config:
        gateway: https://api.freepi.ai
- id: agent-default-model
  config:
    provider: freepi
    model: deepseek-v4.1-flash
```

`auto` means "the server's current default model" — a moving target is not an
experimental condition. **Verified:** `dsh --profile headless --dump-config` shows the
`freepi` row and `provider: freepi, model: deepseek-v4.1-flash`.

## 3 · The bb server (arm C/D only)

```yaml
- insert:
    - id: mcp-bb
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: bb
        transport: stdio                              # REQUIRED — omitting it breaks the plugin
        command: /home/ishaq2321/.nvm/versions/node/v22.22.1/bin/bb
        args: [ 'mcp', '--dir', '<ABS PATH OF THIS RUN WORKSPACE>' ]
        toolCallTimeoutMs: 120000
        failOnStartupError: true
```

**Arms A and B must not have this row.** The `--dir` must be the run's own workspace,
which is why the profile is generated per wave, not shared.

## 4 · Run it

```bash
cd <run-workspace>
BB_DATA_DIR=<wave-root>/bbdata \
DSH_HOME=<wave-root>/dshhome \
  dsh --profile headless --json --permission-mode workspace-write \
      --add-dir <run-workspace> \
      "$(cat <task-prompt.md>)" \
  > <run-dir>/trace.ndjson 2> <run-dir>/stderr.log
```

**Verified event shapes** (from `@deepseek-ai/dsh-headless/src/json-stream.ts`, confirmed
by a live run):

| `type` | fields | use in the benchmark |
|---|---|---|
| `session` | `sessionId`, `cwd` | run identity |
| `status` | `phase` ∈ `turn_start`,`step_start`,`step_end`,`turn_end`, `turn`, `step`, `reason`, and **`usage`** on `step_end` when complete | **token accounting** |
| `text` | `text` | agent's assertions (false-confidence grading) |
| `thinking` | `text` | needed to see *why* it chose a tool |
| `tool_call` | `callId`, `tool`, `input` | discovery tax, tool economy, bb call rate |
| `tool_result` | `callId`, `status`, `result` | bytes returned, refusals, fallback answers |
| `final` | `sessionId`, `reason`, `text` | terminal state |

A real captured run (`inputTokens: 7260, outputTokens: 4`) and a real
`mcp__bb__bb_search` tool call with a full payload were both produced and are
reproducible with the block above.

## 4a · Blocking the bb CLI from the no-bb arms (a confirmed hole)

**Measured, and it invalidates every A/B run made without this fix.** With the `mcp-bb`
row removed from the profile — the documented way to build arm A — the agent ran:

```
{"tool":"bash","input":{"command":"bb --version"}}
{"status":"completed","result":"0.2.2\n"}
```

Arm A has the binary on `PATH` (`/…/node/bin/bb`) and the agent found it. So the "without
bb" control can drive the product through the CLI, and every A-vs-C comparison taken in
that state compares *bb-with-tools* against *bb-through-bash*. That is the single most
dangerous defect found in this whole design, because it inflates the control arm and
therefore **understates** bb's benefit — the exact direction that makes us look modest
while producing a meaningless number.

### The fix, in three parts (all required)

1. **PATH shim.** The runner prepends a directory containing an executable `bb` that
   exits non-zero with `bb is not available in this arm`. It shadows the real binary for
   any non-absolute invocation. This is a *declared* arm condition, printed in the run
   record, not a hidden trap — an agent told "you do not have bb" can behave accordingly.
2. **Absolute-path scan.** The shim only stops `bb`; it does not stop
   `/home/…/bin/bb`. So grading scans the trace: any `tool_call` whose input contains the
   resolved absolute bb path in arms A/B ⇒ **`status: invalid`, reason: `bb-leak`**.
3. **The reverse assertion.** The probe turn (§5) already fails a C/D run with no bbtools.
   Add its mirror: a B-run that *successfully* invokes any bb CLI form is invalid.

### Why a shim and not a container-only fix

A container without bb is cleaner, but the same image serves arms C/D, and the arm's tool
inventory is a property of the *agent profile*, not the image. The shim keeps one image
for the whole wave — which is what makes the arms comparable — while removing the binary
from the arm that must not have it. The trace scan is what makes the shim auditable.

### Recorded, not assumed

`run-record.json.arm_enforcement` records:

```json
{ "bb_mcp_mounted": false, "bb_cli_shimmed": true,
  "bb_cli_invocations": 0, "absolute_path_invocations": 0 }
```

A run whose arm enforcement is not recorded is not publishable, for the same reason a
run without a trace is not.

---

## 5 · Assert the arm is the arm (mandatory pre-check)

Before the measured turns, the runner issues one **probe turn** and asserts:

| arm | assertion | failure means |
|---|---|---|
| A, B | **no** tool name matches `^mcp__bb__` | the bb row leaked into a no-bb arm |
| C, D | a `tool_call` to `mcp__bb__bb_search` **succeeded** | bb not mounted (the silent failure) |

The probe runs against a fixture repository, not the task repository, so it cannot leak
task content. **A run whose probe fails is `status: invalid`**, never scored.

Without this check, failure #6 above produced a fluent, confident answer from an agent
that had no bb tools — a false negative that looks exactly like "bb doesn't help".

## 5a · Timestamps: the trace has none, so the runner supplies them

**Verified against the source and a live capture: the NDJSON stream carries no time
field.** `json-stream.ts` writes `session`, `status`, `text`, `thinking`, `tool_call`,
`tool_result` and `final` — every event has a `type` and its payload, and **none has a
timestamp**.

This matters because the discovery-tax endpoint is *defined in time*: median ms before the
first correct-file edit. So:

1. **The runner timestamps the stream on arrival**, not the harness. Each line is written
   with a `_t_ms` monotonic offset from run start, by the same process that writes
   `trace.ndjson`. Declared in every run record:
   `"timing": {"source": "runner-arrival", "resolution_ms": …}`.
2. **Arrival time is an upper bound**, not the agent's own latency: it includes pipe and
   scheduling delay. It is therefore **never** used for a wall-clock speedup claim; it is
   used only for *ordering* and for *relative* discovery tax between arms — which is
   exactly how DESIGN §1 defines it. Both arms suffer the same bound.
3. **Token-based discovery tax is the primary measure**, because tokens come from the
   harness (`step_end.usage`) and carry no timing assumption at all. The ms figure is
   reported beside it and labelled "arrival, upper bound".

Any report that presents the ms figure without that label is reporting an artefact of the
pipe as if it were agent latency.

---

## 6 · Transcripts (the evidence requirement)

Two artifacts per run, both retained:

1. **`trace.ndjson`** — the event stream above, byte-for-byte as emitted. This is the
   primary evidence: it shows every tool call, every payload, every token count.
2. **`session.v4.jsonl.zstd`** — DSH's own persisted session, under
   `$DSH_HOME/sessions/<workspace-slug>/<sessionId>/`. Verified present after a run.
   This is the harness's independent record; if it disagrees with `trace.ndjson`, the run
   is suspect.

**Scrub before publication:** the trace contains absolute paths that may include the
operator's username. The published transcript is path-normalised (`$HOME` → `~`,
workspace → `$WS`) and **must not** contain `.credentials.yaml`, `freepi-install.json`,
API keys or the install secret. The runner scans for those strings and refuses to publish
a run whose trace contains them.

## 7 · What this recipe does NOT establish

- **Reproducibility across FreePi accounts.** FreePi is an ad-supported free tier with
  daily allowances and a shared server; a reader with their own account may see different
  latency and rate limits. This is exactly why the headline arm is the network-free one
  (`DESIGN.md` §7) and why the model/embedding conditions are printed in every table.
- **That `deepseek-v4.1-flash` is stable.** A free-tier model id can be repointed. The run
  record stores the id it actually used and the `sessionId`; a wave that spans a model
  change is not publishable as one wave.
- **Anything about other harnesses.** `--json` is DSH-specific. A different harness plugs
  in at the trace contract (`benchmarks/spec/ARMS.md` §3.2), not here.
