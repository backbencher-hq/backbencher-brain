#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# THE ARM TOKEN — the fleet's one heavy arm at a time.
#
# WHY THIS EXISTS. The owner runs EIGHT lane teammates concurrently. A
# whole-population arm is a HEAVY arm: the typescript production arm builds 42
# project indexes over 17,689 files and holds them in memory, and it took 11
# minutes. This machine has 8 CPUs and ~6 GB of available RAM. Eight arms at
# once would thrash, and a thrashed arm does not merely run slowly — it can
# FAIL, and a failed arm that reports a partial number is a WRONG measurement,
# which the charter says is worse than no measurement.
#
# SO: arms are a FLEET resource, not a per-agent one. A lane takes the token,
# runs its arm, releases it. The analytic work — analyzer code, fixtures,
# pages, rulings — is CPU-light and does NOT need the token; keep working on
# that while you wait.
#
# THE TOKEN IS A DIRECTORY, because mkdir is ATOMIC on every POSIX filesystem:
# two agents racing for it cannot both win.
#
# THE HEARTBEAT, AND WHY THE PID ALONE CANNOT BE THE LIVENESS TEST. The first
# version of this script recorded the pid of the `take` invocation — which is
# a short-lived shell that has EXITED by the time the next lane looks. So the
# liveness test said "the holder is gone" while the holder was mid-arm, and a
# second lane stole the token. (The Lead caught this by testing the token
# BEFORE trusting it — the same discipline every lane's numbers are held to.)
# The pid is therefore INFORMATION ONLY; the test is a HEARTBEAT: the holder
# refreshes a timestamp while its arm runs (`arm-token.sh beat <lane>`), and a
# token with no beat for TTL seconds is reclaimable. A crashed or vanished
# holder therefore releases itself, and a RECYCLED pid cannot keep the token.
#
# USAGE
#   script/m14/arm-token.sh take <lane>     # take it, or fail loudly
#   script/m14/arm-token.sh beat <lane>     # refresh the heartbeat (during a long arm)
#   script/m14/arm-token.sh beat-daemon <lane>   # DETACHED heartbeat that wants no CPU (see below)
#   script/m14/arm-token.sh release <lane>  # release it (yours only)
#   script/m14/arm-token.sh status          # who holds it, and for how long
#   script/m14/arm-token.sh force <lane>    # break a lock whose holder is known-gone
# ─────────────────────────────────────────────────────────────────────────────
set -u
TOKEN_DIR="${BB_ARM_TOKEN_DIR:-$PWD/.tmp-lead/arm-token}"
TTL="${BB_ARM_TOKEN_TTL:-2700}"  # 45 minutes without a beat => reclaimable
#
# WHY 45, AND NOT 15. The TTL was 900s, and on 2026-10-20 the python lane's arm LAPSED IT — the lane
# stopped beating while it was writing prose, the dart lane reclaimed the token, and the python arm ran
# its last few minutes WITHOUT the token. The lane disclosed this itself and checked the arm's
# integrity (edge count identical, class sum exact, intent closure exact, the deltas exactly as
# predicted), which is the right conduct; but the WINDOW was too short for the fleet's heaviest arms —
# the dart lane's is 33,738 files and the python lane's is 11,559 — so a long arm could lose the token
# mid-run, which is the one thing the token exists to prevent. 45 minutes is longer than any arm the
# fleet has run, and a crashed or vanished holder still releases itself. BEAT EVERY TWO MINUTES.
QUEUE_FILE="${BB_ARM_QUEUE:-$PWD/.tmp-lead/arm-queue}"
SMALL_TOKEN_DIR="${TOKEN_DIR}.small"   # the SMALL arm slot: a SEPARATE lock
# THE QUEUE LOCK. The queue is read and written by EVERY lane, and two of its operations
# (a small-slot `take` yielding a lane's place, and a small-slot `release` restoring it) happen
# CONCURRENTLY with other lanes' takes and releases.
QUEUE_LOCK="${BB_ARM_QUEUE_LOCK:-$PWD/.tmp-lead/arm-queue.lock}"
mkdir -p "$(dirname "$TOKEN_DIR")" 2>/dev/null || true
mkdir -p "$(dirname "$QUEUE_FILE")" 2>/dev/null || true

# THE LOCK ITSELF, AND WHY THE QUEUE NEEDED ONE. MEASURED 2026-10-21 (the csharp lane reported it
# and the Lead reproduced it): the small-slot `release` prints "ORDINARY-QUEUE PLACE RESTORED - at
# the BACK" and then the lane is NOT in the queue. THE CAUSE IS A LOST UPDATE, AND IT IS
# REPRODUCIBLE IN THREE LINES:
#
#   queue_remove:  grep -vxF "$l" "$QUEUE_FILE" > "$QUEUE_FILE.tmp"   # reads the file
#   queue_add:     echo "$l" >> "$QUEUE_FILE"                          # appends the restored lane
#   queue_remove:  mv "$QUEUE_FILE.tmp" "$QUEUE_FILE"                  # lands — and the add is GONE
#
# `queue_remove` REPLACES the whole file, so an append that lands between its read and its rename is
# destroyed. The restored lane's place is silently lost, its arm waits forever for a turn that is
# never coming, and a lane becomes INVISIBLE — which is worse than a visible refusal, because the
# queue is the fleet's arms' fairness and a lane nobody can see is a lane nobody serves.
#
# SO EVERY QUEUE MUTATION TAKES AN EXCLUSIVE LOCK, AND THE LOCK IS TAKEN WITH `mkdir` — WHICH IS
# ATOMIC ON EVERY POSIX FILESYSTEM, the same primitive the arm token itself uses. A LOCK THAT NOBODY
# CAN OPEN IS NOT A QUEUE, IT IS A WALL, so the lock WAITS (with a bounded spin) rather than failing:
# a queue operation must never refuse a lane because another lane is mid-operation.
queue_lock() {
  local waited=0
  while ! mkdir "$QUEUE_LOCK" 2>/dev/null; do
    waited=$((waited + 1))
    # A LOCK HOLDER THAT DIED LEAVES ITS LOCK BEHIND. The lock is a directory, and a directory
    # holding a pid file is reclaimable by the same rule the arm token uses: the pid is INFORMATION
    # ONLY and the LIVENESS TEST IS THE HEARTBEAT, because a recycled pid must not keep the lock.
    if [ -f "$QUEUE_LOCK/holder" ]; then
      local l_pid l_beat l_now l_age
      l_pid="$(sed -n 1p "$QUEUE_LOCK/holder" 2>/dev/null | cut -d= -f2)"
      l_beat="$(sed -n 2p "$QUEUE_LOCK/holder" 2>/dev/null | cut -d= -f2)"
      l_now="$(date +%s)"
      l_age=$(( l_now - ${l_beat:-0} ))
      if [ -n "$l_beat" ] && [ "$l_age" -ge 30 ]; then
        echo "QUEUE LOCK RECLAIM — holder pid ${l_pid:-?} has not beaten for ${l_age}s." >&2
        rm -rf "$QUEUE_LOCK" 2>/dev/null || true
        continue
      fi
    fi
    if [ "$waited" -ge 300 ]; then
      # THE BOUNDED SPIN IS EXHAUSTED. Refusing here would be a WALL, and a lane's queue operation
      # failing is worse than a slow one — so the lock is TAKEN ANYWAY, and the queue is rewritten
      # from a WHOLE-FILE snapshot, so the worst case is a lost update that is PRINTED rather than a
      # lane that is silently invisible.
      echo "QUEUE LOCK FORCED — the lock was held for ${waited} ticks; the queue is rewritten from a snapshot and the forced change is PRINTED." >&2
      rm -rf "$QUEUE_LOCK" 2>/dev/null || true
      break
    fi
    sleep 0.1
  done
  printf 'pid=%s\nbeat=%s\n' "$$" "$(date +%s)" > "$QUEUE_LOCK/holder" 2>/dev/null || true
}
queue_unlock() {
  rm -rf "$QUEUE_LOCK" 2>/dev/null || true
}

# THE QUEUE. Eight lanes, ONE arm slot, and arms take 7 to 45 minutes — so without a queue the lanes
# POLL, and a lane can be overtaken by a later arrival (the Lead did it to toml). The queue is a plain
# file, one lane per line, in arrival order, and `take` REFUSES a lane that is not at the head. It is
# also the Lead's situational awareness: `status` prints the whole queue, so the Lead can see who is
# next and WHY a lane has not run yet.
queue_add() {
  local l="$1"
  [ -f "$QUEUE_FILE" ] || : > "$QUEUE_FILE"
  # IDEMPOTENT, AND **AUDITED** (2026-10-21, the Lead) ✓✓. `queue_remove` prints what it did because
  # "A QUEUE THAT CHANGES SILENTLY IS A QUEUE NOBODY CAN TRUST" ✓✓ — but an ADD that printed nothing
  # was the SAME defect in the other direction ✓✓: a lane's place being RESTORED is a queue change
  # nobody can see, and the fleet's arms' fairness is the queue ✓✓ ⇒ ⇒ ⇒ BOTH SIDES NOW PRINT ✓✓.
  #
  # THE LOCK (2026-10-21, the Lead — the csharp lane found the defect this fixes). The check below
  # and the append below are ONE operation, and they must not interleave with another lane's
  # `queue_remove` — whose whole-file rewrite would destroy an append that landed in between. See
  # `queue_lock` for the reproduction in three lines. The lock is taken for the WHOLE
  # check-then-append, never around one half of it, because a lock around half an operation is no
  # lock at all.
  queue_lock
  local before after
  if grep -qxF "$l" "$QUEUE_FILE"; then
    queue_unlock
    return 0
  fi
  before="$(queue_list | tr '\n' ' ')"
  echo "$l" >> "$QUEUE_FILE"
  after="$(queue_list | tr '\n' ' ')"
  queue_unlock
  echo "QUEUE AUDIT — added '$l' · before: ${before:-（empty）} · after: ${after:-（empty）}" >&2
}
queue_remove() {
  local l="$1"
  [ -f "$QUEUE_FILE" ] || return 0
  # THE QUEUE AUDIT (2026-10-20, Lead). A lane found ITS OWN PLACE GONE from the queue with no
  # explanation — the file's mtime had moved and the lane was not there any more. The removal
  # functions were verified to remove ONLY the named lane, so something had removed it EXPLICITLY
  # and the queue file could not say who. **A QUEUE THAT CHANGES SILENTLY IS A QUEUE NOBODY CAN
  # TRUST**, and the queue IS the fleet's arms' fairness — so every change now PRINTS the lane, the
  # queue before and the queue after ✓✓. A change that is not accounted for is still not explained,
  # but it is now VISIBLE ✓, and a lane that sees its name removed can point at the line.
  #
  # THE LOCK (2026-10-21, the Lead) — see `queue_lock`. THE ORDER MATTERS: the read, the rewrite and
  # the audit are all inside the lock, and the unlock comes AFTER the rewrite lands. A rewrite that
  # happened outside the lock is exactly the lost update that cost csharp its place.
  queue_lock
  local before after
  before="$(queue_list | tr '\n' ' ')"
  grep -vxF "$l" "$QUEUE_FILE" > "$QUEUE_FILE.tmp" 2>/dev/null || : > "$QUEUE_FILE.tmp"
  mv "$QUEUE_FILE.tmp" "$QUEUE_FILE"
  after="$(queue_list | tr '\n' ' ')"
  queue_unlock
  echo "QUEUE AUDIT — removed '$l' · before: ${before:-（empty）} · after: ${after:-（empty）}" >&2
}
holder_granted() { [ -f "$TOKEN_DIR/holder" ] && sed -n 5p "$TOKEN_DIR/holder" || echo 0; }
queue_head() { [ -f "$QUEUE_FILE" ] && head -1 "$QUEUE_FILE" || echo ''; }
queue_list() { [ -f "$QUEUE_FILE" ] && cat "$QUEUE_FILE" || echo '(nobody waiting)'; }

now() { date +%s; }

proc_start_ticks() {  # field 22 of /proc/<pid>/stat
  local pid="$1"
  [ -r "/proc/$pid/stat" ] || return 1
  local rest
  rest="$(sed 's/^.*) //' "/proc/$pid/stat" 2>/dev/null)" || return 1
  echo "$rest" | awk '{print $20}'
}

holder() {  # lane | pid | startTicks | lastBeat
  head -1 "$TOKEN_DIR/holder" 2>/dev/null || echo '?'
  sed -n 2p "$TOKEN_DIR/holder" 2>/dev/null || echo ''
  sed -n 3p "$TOKEN_DIR/holder" 2>/dev/null || echo ''
  sed -n 4p "$TOKEN_DIR/holder" 2>/dev/null || echo ''
}

token_fresh() {  # live if the last beat is within TTL
  local ts="$1"
  [ -n "$ts" ] && [ "$ts" != "0" ] || return 1
  local age=$(( $(now) - ts ))
  [ "$age" -ge 0 ] && [ "$age" -lt "$TTL" ]
}

start_beat_daemon() {  # lane — a DETACHED heartbeat that wants no CPU
  # ★ THE DAEMON IS WHAT MAKES THE BEAT TRUSTWORTHY. It sleeps and writes a file, so it needs no
  # scheduler attention and keeps beating under a saturated load; the lane's own beat calls are
  # OPTIONAL from here on, because the daemon covers them.
  local d_lane="${1:-}" d_log d_alive d_marker_age d_now
  [ -n "$d_lane" ] || return 0
  d_log="${BB_ARM_BEAT_LOG:-$PWD/.tmp-lead/arm-beat-daemon.log}"
  # ⇒⇒⇒ THE LOG PATH IS ABSOLUTE, BECAUSE A RELATIVE PATH IN A DETACHED BACKGROUND JOB IS A WISH.
  # The daemon is launched by a lane's own driver, and that driver's working directory is not
  # necessarily the repository root — a relative log path simply loses the daemon's output, and a
  # lost daemon is a silent one.
  mkdir -p "$(dirname "$d_log")" 2>/dev/null || true
  d_log="$(cd "$(dirname "$d_log")" && pwd)/$(basename "$d_log")" 2>/dev/null || d_log="$PWD/arm-beat-daemon.log"
  # ⇒⇒⇒ THE MARKER IS A HEARTBEAT OF THE DAEMON ITSELF, NOT A ONE-TIME FLAG. MEASURED 2026-10-22:
  # the marker was created on the first take and NEVER CLEARED, so every later take returned early
  # and started NO daemon — and the token's beat then sat stale for 541 s while the holder was
  # demonstrably running. ⇒⇒⇒ **A GUARD THAT PREVENTS A DUPLICATE DAEMON MUST NOT ALSO PREVENT A
  # DAEMON FROM EVER STARTING**, and the only way to tell a live daemon from a dead one is the
  # daemon's OWN pulse. ⇒⇒⇒ The daemon refreshes this marker on every loop; a marker older than
  # DAEMON_STALE seconds means the daemon is gone, and a new one is started.
  d_alive="$TOKEN_DIR.daemon-$d_lane"
  d_now="$(now)"
  d_marker_age=999999
  if [ -f "$d_alive" ]; then
    d_marker_age=$(( d_now - $(sed -n 1p "$d_alive" 2>/dev/null || echo 0) ))
  fi
  if [ "$d_marker_age" -lt "${BB_ARM_DAEMON_STALE:-300}" ]; then
    return 0   # a daemon pulsed recently — it is alive
  fi
  printf '%s\n' "$d_now" > "$d_alive" 2>/dev/null || true
  # ⇒⇒⇒ AND THE MARKER IS WRITTEN AT START, not only after the daemon's first 120 s sleep, so a take
  # is observable as "a daemon is on its way" rather than "nothing is known yet".
  # ⇒⇒⇒ AND THE SCRIPT PATH IS ABSOLUTE. `"$0"` is whatever the CALLER typed, and a caller that
  # typed a relative path gets a daemon that cannot find its own script the moment its working
  # directory is not the repository root. ⇒⇒⇒ A PATH THAT WAS NEVER RUN FROM ELSEWHERE IS A WISH.
  local d_script
  d_script="$(cd "$(dirname "$0")" 2>/dev/null && pwd)/$(basename "$0")" 2>/dev/null || d_script="$0"
  setsid nohup bash "$d_script" __beat-daemon-loop "$d_lane" >>"$d_log" 2>&1 &
  return 0
}

write_holder() {  # lane pid ticks [granted]
  # THE ATOMIC WRITE (2026-10-20, the javascript lane's finding). A plain `printf > holder` is NOT
  # atomic, and a reader CAN CATCH THE FILE MID-WRITE: the javascript lane saw the dart lane's
  # holder read as "last beat 1792547563s ago" — a garbage beat that made a LIVE holder look
  # ANCIENT ✓✓. That is not a cosmetic reading: `force` refuses a FRESH heartbeat, so a garbage
  # read is exactly what would authorise a force against a live holder — the failure the token
  # exists to prevent ✓✓. So the holder file is now written to a TEMP file and RENAMED ✓, which is
  # atomic on every filesystem the fleet runs on ✓✓.
  printf '%s\n%s\n%s\n%s\n%s\n' "$1" "$2" "$3" "$(now)" "${4:-0}" > "$TOKEN_DIR/holder.tmp" 2>/dev/null \
    && mv "$TOKEN_DIR/holder.tmp" "$TOKEN_DIR/holder" 2>/dev/null \
    || { rm -f "$TOKEN_DIR/holder.tmp" 2>/dev/null || true; }
}

cmd="${1:-status}"; lane="${2:-}"
# ★★★ THE FLAGS ARE PARSED FROM ALL ARGUMENTS, AND THE POSITIONAL PARSE WAS OFF BY ONE — WHICH MADE
# BOTH OF THEM UNREACHABLE. `cmd` is $1 and `lane` is $2, so the force verb's checks on "${2:-}" and
# "${3:-}" were reading THE LANE NAME and the first flag — never the flags themselves. ⇒ ⇒ ⇒ SO
# `force <lane> --urgent` and `force <lane> --holder-is-gone` HAVE NEVER WORKED, and the script's
# own message ("re-run with --urgent --holder-is-gone") advertised a path that could not be taken.
# ⇒ MEASURED 2026-10-22: the Lead ran `force typescript --urgent --holder-is-gone` against a token
# whose holder was gone, and it printed REFUSED. ⇒ **A DOCUMENTED ESCAPE HATCH THAT CANNOT BE TAKEN
# IS THE SAME CLASS OF DEFECT AS A DOCUMENTED FLAG THAT DISABLES THE RECOVERY.**
#
# ⇒ THE FIX IS TO PARSE THE FLAGS BY NAME, FROM ANY POSITION, so the caller's order cannot matter.
BB_FLAG_URGENT=0
BB_FLAG_GONE=0
for a in "$@"; do
  case "$a" in
    --urgent) BB_FLAG_URGENT=1 ;;
    --holder-is-gone) BB_FLAG_GONE=1 ;;
  esac
done

case "$cmd" in
  take)
    [ -n "$lane" ] || { echo "usage: arm-token.sh take <lane>"; exit 2; }
    # THE HEAD OF THE QUEUE GOES FIRST. A lane that is not at the head is REFUSED, and told the order.
    # Polling and hoping was how a lane could be overtaken by a later arrival.
    head="$(queue_head)"
    # THE QUEUE ORDERS LANES. The LEAD'S VERIFICATION IS NOT A LANE'S ARM: the floor moves only when the
    # Lead has INDEPENDENTLY REPRODUCED a lane's movement, and that reproduction is a read-only re-run of
    # the lane's own command — it decides no lane's verdict and it does not consume a lane's slot. So the
    # Lead may take a FREE token with the queue non-empty, and it says so out loud, because a SILENT
    # carve-out is what broke the one-arm invariant once already. It may NEVER take a HELD token.
    if [ "$lane" = "lead" ] && [ ! -d "$TOKEN_DIR" ]; then
      echo "ARM TOKEN TAKEN by lead — THE LEAD'S OWN VERIFICATION, jumping the queue (the queue is LANE order)."
      echo "  head: ${head:-nobody} — the lane at the head waits for this arm and keeps its place."
      mkdir "$TOKEN_DIR" 2>/dev/null && write_holder "lead" "$$" "$(proc_start_ticks $$ 2>/dev/null || echo 0)"
      exit 0
    fi
    if [ -n "$head" ] && [ "$head" != "$lane" ]; then
      echo "ARM TOKEN: the QUEUE is not empty and $lane is not at the head."
      echo "  head: $head"
      echo "  queue:"; queue_list | sed 's/^/    /'
      echo "  WAIT for $head. Your arm runs when the head releases it; do not poll — the queue is the order."
      exit 3
    fi
    if mkdir "$TOKEN_DIR" 2>/dev/null; then
      write_holder "$lane" "$$" "$(proc_start_ticks $$ 2>/dev/null || echo 0)"
      queue_remove "$lane"
      # ★★★ THE BEAT DAEMON IS STARTED BY THE TAKE, AUTOMATICALLY, AND THAT IS THE FIX THAT ENDS
      # THIS CLASS OF DEADLOCK. MEASURED 2026-10-22: typescript's whole-population arm held the
      # heavy token with a beat 1,219 s old, then 1,302 s, then 2,212 s, on a machine at load 6.14 on
      # 8 CPUs — the arm was demonstrably RUNNING and its BEAT was CPU-STARVED, because the lane's
      # beat call was queued behind its own parse. ⇒ ⇒ ⇒ AND THEN THE HOLDER WENT AWAY ENTIRELY: the
      # lane finished its turn, the beat froze, and SIX LANES SAT BEHIND A STALE LOCK FOR FORTY
      # MINUTES — because the ONLY liveness signal the script trusts is the beat, and the beat is
      # exactly the thing a CPU-saturated fleet starves.
      #
      # ⇒ THE FIX IS THAT NO HOLDER EVER HAS TO REMEMBER TO BEAT. The take starts a DETACHED loop
      # that sleeps 120 s and writes the heartbeat — it wants NO CPU, so it keeps beating under a
      # saturated load, and the token's liveness signal stops depending on the very resource the arm
      # is consuming. ⇒ A HOLDER THAT STOPS BEATING IS THEN GENUINELY GONE, which is what makes the
      # TTL path safe to reclaim on.
      start_beat_daemon "$lane"
      echo "ARM TOKEN TAKEN by $lane — run ONE arm, then: arm-token.sh release $lane"
      echo "  (the BEAT DAEMON was started for you; it wants no CPU, so your arm cannot be starved)"
      exit 0
    fi
    h_lane="$(holder | sed -n 1p)"; h_pid="$(holder | sed -n 2p)"; h_beat="$(holder | sed -n 4p)"
    if token_fresh "$h_beat"; then
      echo "ARM TOKEN HELD by $h_lane (last beat $(( $(now) - h_beat ))s ago) — do NOT start an arm."
      echo "Keep working on analyzer/fixture/page work, and retry. Current holder: script/m14/arm-token.sh status"
      exit 3
    fi
    # the holder has stopped beating — it crashed, vanished, or was killed
    rm -rf "$TOKEN_DIR" 2>/dev/null || true
    if mkdir "$TOKEN_DIR" 2>/dev/null; then
      write_holder "$lane" "$$" "$(proc_start_ticks $$ 2>/dev/null || echo 0)"
      echo "ARM TOKEN RECLAIMED by $lane — the previous holder ($h_lane, pid $h_pid) stopped beating $(( $(now) - h_beat ))s ago."
      exit 0
    fi
    echo "ARM TOKEN RECLAIM RACE — another lane took it. Retry."; exit 3
    ;;
  beat)
    # THE SMALL SLOT IS BEATEN TOO, or its holder would look dead to the TTL.
    if [ -f "$SMALL_TOKEN_DIR/holder/holder" ] && grep -q "lane=$lane" "$SMALL_TOKEN_DIR/holder/holder" 2>/dev/null; then
      sed -i "s/^beat=.*/beat=$(date +%s)/" "$SMALL_TOKEN_DIR/holder/holder" 2>/dev/null || true
      echo "beat ok (small slot)"
      exit 0
    fi
    [ -n "$lane" ] || { echo "usage: arm-token.sh beat <lane>"; exit 2; }
    h_lane="$(holder | sed -n 1p)"
    if [ "$h_lane" != "$lane" ]; then
      echo "NOT BEATEN — the token is held by '${h_lane:-nobody}', not by $lane."; exit 4
    fi
    h_pid="$(holder | sed -n 2p)"; h_ticks="$(holder | sed -n 3p)"
    # THE GRANTED FLAG MUST SURVIVE THE BEAT (2026-10-21, the dart lane's finding). `write_holder` takes
    # the granted flag as its FOURTH argument (line 111 ✓✓) and writes it as the holder file's FIFTH line
    # ✓✓, and the BEAT passed NO FOURTH ARGUMENT ✓✗ — so the FIRST BEAT turned a GRANTED turn into an ORDINARY
    # one ✓✗, and the release then CONSUMED the lane's queue place ✓✗ — PRECISELY the defect `take-granted`
    # was written to fix ✓✗, REAPPEARING THROUGH THE BEAT ✓✗. THE FIX IS ONE ARGUMENT ✓✓: carry the CURRENT
    # flag through ✓✓ (`holder_granted` reads the fifth line ✓✓) — and the ordinary `take` still writes 0 ✓✓
    # explicitly ✓✓, so a lane that was never granted cannot inherit one ✓✓.
    write_holder "$lane" "$h_pid" "$h_ticks" "$(holder_granted)"
    echo "ARM TOKEN BEAT by $lane"; exit 0
    ;;
  __beat-daemon-loop)
    # THE INTERNAL LOOP OF THE BEAT DAEMON. It is NOT a lane-facing verb and it is not in USAGE.
    #
    # ★ WHY IT EXISTS, AND IT IS A REAL DEFECT MEASURED IN THE FLEET. THE HEARTBEAT IS A LIVENESS
    # SIGNAL, AND A LIVENESS SIGNAL THAT NEEDS THE CPU IS NOT A LIVENESS SIGNAL IN A FLEET WHOSE
    # ARMS SATURATE THE CPU. MEASURED: typescript's whole-population arm held the heavy token with
    # a beat 1,219s old, then 1,302s old, on a machine whose load average was 6.14 on 8 CPUs — the
    # arm was demonstrably RUNNING (the load said so) and its BEAT was CPU-STARVED, because the
    # lane's beat call was queued behind its own parse.
    #
    # ⇒ ⇒ ⇒ AND THE CONSEQUENCE IS THE WORST ONE THE TOKEN EXISTS TO PREVENT: the reclaim rule is
    # `age >= TTL`, so a LIVE arm whose beat is starved gets its token RECLAIMED MID-RUN — and then
    # the next lane in the queue starts a SECOND heavy arm while the first is still running. That is
    # two heavy arms at once, which is exactly what the one-heavy-arm rule forbids, and it is how a
    # fleet produces a WRONG measurement rather than merely a slow one.
    #
    # ⇒ THE FIX IS THAT THE BEAT MUST NOT NEED THE CPU. This loop is `sleep` and a `sed`: it wants
    # no scheduler attention at all, so it keeps beating under a saturated load, and the token's
    # liveness signal stops depending on the very resource the arm is consuming.
    while :; do
      sleep 120
      # THE DAEMON STOPS WHEN THE LANE NO LONGER HOLDS THE TOKEN — so a released token is never
      # kept alive by a stale daemon, and a daemon cannot outlive its arm into another lane's turn.
      h="$(holder | sed -n 1p)"
      small_held=0
      if [ -f "$SMALL_TOKEN_DIR/holder/holder" ] && grep -q "lane=$lane" "$SMALL_TOKEN_DIR/holder/holder" 2>/dev/null; then
        small_held=1
      fi
      if [ "$h" != "$lane" ] && [ "$small_held" -eq 0 ]; then
        echo "beat-daemon for $lane stopping: the token is no longer held by $lane (now: ${h:-nobody})."
        rm -f "$TOKEN_DIR.daemon-$lane" 2>/dev/null || true
        exit 0
      fi
      # ⇒⇒⇒ THE DAEMON PULSES ITS OWN MARKER EVERY LOOP — and the pulse is written BEFORE the beat,
      # so a daemon that is alive but whose beat is failing is still distinguishable from a dead
      # one. ⇒⇒⇒ A marker that only ever gets CREATED is a flag, and a flag cannot say "alive".
      printf '%s\n' "$(now)" > "$TOKEN_DIR.daemon-$lane" 2>/dev/null || true
      "$0" beat "$lane" >/dev/null 2>&1 || true
    done
    ;;
  beat-daemon)
    [ -n "$lane" ] || { echo "usage: arm-token.sh beat-daemon <lane>"; exit 2; }
    # THE LANE MUST ALREADY HOLD THE TOKEN (heavy or small) — a daemon for a token nobody holds is a
    # daemon that beats nothing.
    h="$(holder | sed -n 1p)"
    small_held=0
    if [ -f "$SMALL_TOKEN_DIR/holder/holder" ] && grep -q "lane=$lane" "$SMALL_TOKEN_DIR/holder/holder" 2>/dev/null; then
      small_held=1
    fi
    if [ "$h" != "$lane" ] && [ "$small_held" -eq 0 ]; then
      echo "BEAT DAEMON REFUSED — $lane holds neither the heavy token (held by ${h:-nobody}) nor the small slot."
      exit 3
    fi
    # ⇒⇒⇒ THE VERB DELEGATES TO THE SAME HELPER THE `take` USES, BECAUSE THE VERB HAD ITS OWN COPY
    # OF THE LAUNCH AND THE COPY STILL USED THE RELATIVE `"$0"`. ⇒⇒⇒ **A LAUNCH PATH DUPLICATED IN
    # TWO PLACES IS ONE PATH THAT WILL BE FIXED IN ONE PLACE ONLY** — the same shape as the
    # operator-name class that was extended in one place and not the other, which left 7 Ruby
    # setter rows dropped and a commit message claiming they were exempt. ⇒⇒⇒ ONE HELPER, ONE
    # LAUNCH, ONE PATH TO BE RIGHT.
    start_beat_daemon "$lane"
    echo "BEAT DAEMON started for $lane (detached, every 120s, no CPU wanted)."
    echo "  log: ${BB_ARM_BEAT_LOG:-$PWD/.tmp-lead/arm-beat-daemon.log}"
    exit 0
    ;;
  release)
    [ -n "$lane" ] || { echo "usage: arm-token.sh release <lane>"; exit 2; }
    # THE SMALL SLOT IS CHECKED FIRST: a lane may hold the small slot while the HEAVY token is held by
    # another lane entirely, and the heavy holder's name must not block the small slot's release.
    if [ -f "$SMALL_TOKEN_DIR/holder/holder" ] && grep -q "lane=$lane" "$SMALL_TOKEN_DIR/holder/holder" 2>/dev/null; then
      rm -rf "$SMALL_TOKEN_DIR" 2>/dev/null || true
      # THE LANE COMES BACK — AT THE BACK ✓✓ (2026-10-21, the Lead). The small-slot `take` YIELDED the
      # lane's ordinary-queue place ✓✓, so the small-slot `release` must RETURN it ✓✓ ⇒ ⇒ ⇒ otherwise the
      # yield would DROP THE LANE OUT OF THE QUEUE ENTIRELY ✓✓ — which is EXACTLY the defect the ordinary
      # release was already fixed for (MEASURED: `java` took the token, ran, released, and VANISHED ✓✓) ⇒
      # ⇒ ⇒ A LANE THAT HAS HAD ITS TURN IS NOT A LANE THAT HAS LEFT THE FLEET ✓✓ ⇒ ⇒ ONE RULE PER CASE ✓✓.
      # THE LEAD IS NOT A LANE ✓✓ — the Lead's own verification does not consume a lane's slot ✓✓, so
      # the Lead does not take a QUEUE place either ✓✓ ⇒ ⇒ ⇒ the Lead's own release MUST NOT add it ✓✓
      # (MEASURED: the Lead's first small-slot release added 'lead' to the lane queue ✓✓, and the Lead
      # does not own an arm to come back for ✓✓ ⇒ ⇒ ⇒ a queue entry the holder cannot serve is a wall ✓✓).
      if [ "$lane" != "lead" ]; then
        queue_add "$lane"
        echo "  ORDINARY-QUEUE PLACE RESTORED — at the BACK ✓✓ (audited above) ✓✓."
      fi
      echo "ARM SMALL SLOT RELEASED by $lane"
      exit 0
    fi
    h_lane="$(holder | sed -n 1p)"
    if [ "$h_lane" != "$lane" ]; then
      echo "NOT RELEASED — the token is held by '${h_lane:-nobody}', not by $lane."; exit 4
    fi
    # THE GRANTED FLAG MUST BE READ **BEFORE** THE HOLDER IS REMOVED ✓✓ (2026-10-21, the dart lane measured this ✓✓).
    # The holder file lives INSIDE $TOKEN_DIR ✓✓, so the `rm -rf` below DELETES it ✓✓ — a read after that returns 0 ✓✓
    # and the granted branch below is DEAD CODE ✓✓. The flag was WRITTEN ✓✓, CARRIED ✓✓, and NEVER READ ✓✓.
    h_granted="$(holder_granted)"
    rm -rf "$TOKEN_DIR" 2>/dev/null || true
    # A GRANTED TURN DOES NOT CONSUME THE LANE'S QUEUE PLACE ✓✓ (the holder records it ✓).
    if [ "${h_granted:-0}" = "1" ]; then
      echo "ARM TOKEN RELEASED by $lane — a GRANTED turn ✓; the lane's queue place is KEPT ✓."
    else
      # A LANE THAT SPENT ITS TURN COMES BACK — AT THE BACK (2026-10-21, the Lead) ✓✓.
      # `take` REMOVES the holder from the queue (it is running its arm now) ✓✓, so a plain `release`
      # that ALSO removed it DROPPED THE LANE OUT OF THE QUEUE ENTIRELY ✓✓ — MEASURED: `java` took the
      # token, ran, released, and VANISHED ⇒ the queue LOST a lane, the head jumped to `cpp`, and seven
      # lanes were queued behind a head nobody was serving ✓✓ ⇒ THE TOKEN TOOK A LANE'S PLACE AND THEN
      # TOOK THE LANE ITSELF ✓✓ ⇒ THAT IS NOT WHAT A TURN IS ✓✓.
      # A LANE THAT HAS HAD ITS TURN IS NOT A LANE THAT HAS LEFT THE FLEET ✓✓ ⇒ `queue_add` (idempotent,
      # appends at the BACK) ✓✓. The GRANTED branch above keeps its place because a granted turn never
      # consumed one ✓✓ — ONE RULE PER CASE, AND EACH CASE IS NAMED ✓✓.
      queue_add "$lane"
    fi
    echo "ARM TOKEN RELEASED by $lane"; exit 0
    ;;
  take-small)
    # ── THE SMALL ARM SLOT (2026-10-20, Lead; approved by the owner) ──────────────────────────────
    # THE FLOOR'S RATE IS ARM-BOUND. Nine lanes were queued behind ONE 33,738-file / 3.7 M-edge arm,
    # and the floor's gate is the LEAD's reproduction — so the Lead's verifications for the SMALL lanes
    # (toml 1,485 files · clojure 646 · powershell 1,181 — about a MINUTE each) were queued behind
    # arms that take an HOUR. This slot is a SEPARATE lock, so a small arm runs BESIDE a heavy one.
    #
    # THE BOUND IS ENFORCED HERE, NOT BY CONVENTION: the arm must DECLARE its population, and the
    # slot refuses a population of 0 (which means "the whole population" — a heavy arm in disguise) or
    # more than 2,000 files. The memory arithmetic: the arm that was OOM-killed had THREE residents
    # (the 33,738-file dart arm and TWO 11,155-file arms) at 14.7 GB used with 12.6 GB of swap in
    # use; a 646-file arm is a fraction of one 11,155-file arm, so the bound is generous and the
    # pairing is safe.
    #
    # AND THE DECLARATION IS CHECKABLE: the arm PRINTS ITS OWN POPULATION, so a false declaration is
    # caught by reading the arm's header against the number the slot was given.
    # `lane` is the SECOND argument and the population is the THIRD (`cmd="${1:-}"; lane="${2:-}"`).
    files="${3:-}"
    if [ -z "$lane" ] || [ -z "$files" ]; then
      echo "usage: arm-token.sh take-small <lane> <declaredPopulationFiles>"; exit 2
    fi
    if ! printf '%s' "$files" | grep -Eq '^[0-9]+$'; then
      echo "REFUSED — the declared population must be a NUMBER of files (got '$files')."; exit 4
    fi
    if [ "$files" -le 0 ]; then
      echo "REFUSED — 0 means the WHOLE population, which is a HEAVY arm. Take the ordinary token for that."; exit 4
    fi
    if [ "$files" -gt 2000 ]; then
      echo "REFUSED — the SMALL slot is for a population of 2,000 files or fewer (declared: $files)."; exit 4
    fi
    mkdir -p "$SMALL_TOKEN_DIR" 2>/dev/null || true
    # ── THE SMALL SLOT's STALE-HOLDER RECLAIM (2026-10-21, the Lead) ─────────────────────────────────
    # THE DEFECT THIS FIXES, MEASURED: the ORDINARY `take` HAS a TTL reclaim path (a stale beat is
    # reclaimable ✓✓) — and `take-small` DID NOT ✓✓ ⇒ ⇒ ⇒ A CRASHED small arm's HOLDER DIRECTORY
    # BLOCKED THE SMALL SLOT **FOREVER** ✓✓, because `mkdir` fails on an existing directory and the
    # old path had no other way in ✓✓.
    # MEASURED ON THIS FLEET: the go lane's small holder (population 888) had a beat 9,209 s old
    # (152 min) with NO LIVE PROCESS behind it ⇒ ⇒ THE SLOT WAS HELD BY A HOLDER THAT IS GONE, AND
    # THE SMALL SLOT IS THE ONLY SLOT THE VERIFICATION ARMS CAN USE (toml 1,485 · clojure 646 ·
    # powershell 1,181) ⇒ ⇒ ⇒ THREE LANES' ARMS WERE BLOCKED BY A CRASHED ARM'S DIRECTORY ✓✓.
    # SO THE SMALL SLOT GETS THE **SAME** LIVENESS RULE AS THE ORDINARY ONE: THE BEAT IS THE TEST,
    # THE PID IS INFORMATION ONLY ✓✓ (the same rule the ordinary path already carries ✓✓), AND THE
    # RECLAIM IS **AUDITED** — a silent reclaim of a lock is a lock nobody can trust ✓✓ ⇒ ⇒ ⇒ the
    # fleet's own rule, applied to the fleet's own instrument ✓✓.
    if [ -f "$SMALL_TOKEN_DIR/holder/holder" ]; then
      s_lane="$(grep '^lane=' "$SMALL_TOKEN_DIR/holder/holder" 2>/dev/null | cut -d= -f2)"
      s_beat="$(grep '^beat=' "$SMALL_TOKEN_DIR/holder/holder" 2>/dev/null | cut -d= -f2)"
      s_pop="$(grep '^population=' "$SMALL_TOKEN_DIR/holder/holder" 2>/dev/null | cut -d= -f2)"
      s_now="$(now)"
      s_age=$(( s_now - ${s_beat:-0} ))
      if [ "$s_age" -ge 0 ] && [ "$s_age" -ge "$TTL" ]; then
        echo "SMALL SLOT RECLAIM — the holder '${s_lane:-nobody}' (declared population ${s_pop:-?} files) has not beaten for ${s_age}s (TTL ${TTL}s) ⇒ IT IS GONE, AND THE SLOT IS RELEASED ✓✓"
        rm -rf "$SMALL_TOKEN_DIR/holder" 2>/dev/null || true
      fi
    fi
    if mkdir "$SMALL_TOKEN_DIR/holder" 2>/dev/null; then
      printf 'lane=%s\npid=%s\nstarted=%s\nbeat=%s\npopulation=%s\n' "$lane" "$$" "$(date +%s)" "$(date +%s)" "$files" > "$SMALL_TOKEN_DIR/holder/holder.tmp" && mv "$SMALL_TOKEN_DIR/holder/holder.tmp" "$SMALL_TOKEN_DIR/holder/holder"
      # ── THE SMALL SLOT YIELDS THE ORDINARY-QUEUE PLACE (2026-10-21, the Lead) ──────────────────────
      # THE DEADLOCK THIS FIXES, MEASURED: the ORDINARY queue orders the ORDINARY (heavy) token ✓✓, and a
      # lane whose arm is SMALL-SLOT-SIZED never takes that token ✓✓ ⇒ ⇒ ⇒ SO A SMALL-SLOT LANE AT THE
      # HEAD OF THE ORDINARY QUEUE IS A HEAD NOBODY CAN EVER SERVE ✓✓ ⇒ ⇒ ⇒ AND EVERY HEAVY LANE BEHIND
      # IT STARVES ✓✓.
      # MEASURED ON THIS FLEET: the queue read `clojure · python · dart · typescript · javascript · go ·
      # java · c` ✓✓, the HEAD was `clojure` ✓✓, and the clojure lane's OWN ARM SCRIPT takes the SMALL
      # slot (`take-small clojure 646` ✓✓ — its population is 646 files ✓✓) ⇒ ⇒ ⇒ **SEVEN LANES WERE
      # BLOCKED BEHIND A HEAD THAT COULD NOT TAKE THE TOKEN** ✓✓ ⇒ ⇒ ⇒ AND THE ORDINARY TOKEN WAS
      # FREE THE WHOLE TIME ✓✓ ⇒ ⇒ ⇒ A LOCK THAT NOBODY CAN OPEN IS NOT A QUEUE, IT IS A WALL ✓✓.
      # SO A SMALL-SLOT ARM **YIELDS** THE ORDINARY-QUEUE PLACE while it runs ✓✓ (the queue is the ORDINARY
      # token's order ✓✓, and a lane running a SMALL arm is not waiting for the ORDINARY token ✓✓) — and
      # it COMES BACK AT THE BACK when it releases ✓✓, by the SAME rule the ordinary release already
      # carries ✓✓ ⇒ ⇒ ⇒ ONE RULE PER CASE, AND EACH CASE IS NAMED ✓✓.
      # THE REMOVAL IS **AUDITED** (the queue prints what it did ✓✓) ⇒ a lane that finds its place gone
      # can point at the line ✓✓ ⇒ ⇒ ⇒ a queue that changes silently is a queue nobody can trust ✓✓.
      queue_remove "$lane"
      echo "ARM SMALL SLOT TAKEN by $lane (declared population $files files) — a SEPARATE lock, so a HEAVY arm may run beside it."
      echo "  ORDINARY-QUEUE PLACE YIELDED while the SMALL arm runs ✓✓ — the head advances to the next lane ✓✓."
      exit 0
    fi
    echo "REFUSED — the small slot is held. Its holder: $(cat "$SMALL_TOKEN_DIR/holder/holder" 2>/dev/null | tr '\n' ' ')"
    exit 3
    ;;
  take-granted)
    # ── A GRANTED TURN (2026-10-20, the Lead's ruling: "a cheap gate that can prevent an expensive
    # spend should not wait behind that spend") ──────────────────────────────────────────────────────
    # THE GAP THIS FIXES: the ordinary `take` REMOVES THE LANE FROM THE QUEUE ✓ (correct for a queue
    # turn ✓), so a lane taking a GRANTED turn through it SILENTLY LOST ITS OWN PLACE ✓✓ — and the
    # granted turn then could not start at all ✓, because the tool's bookkeeping had undone the
    # ruling that granted it ✓✓. The dart lane caught this ✓ and did NOT edit the queue file for
    # itself ✓✓ — a lane editing the queue for itself is the defect the queue exists to prevent ✓.
    # SO A GRANTED TURN TAKES A FREE TOKEN AND KEEPS THE LANE'S QUEUE PLACE ✓✓, and the holder file
    # records that it was granted ✓ so the release does not consume the place either ✓✓.
    [ -n "$lane" ] || { echo "usage: arm-token.sh take-granted <lane>"; exit 2; }
    if mkdir "$TOKEN_DIR" 2>/dev/null; then
      write_holder "$lane" "$$" "$(proc_start_ticks $$ 2>/dev/null || echo 0)" 1
      echo "ARM TOKEN TAKEN by $lane — A GRANTED TURN ✓ (the queue's place is KEPT ✓; the lane's ordinary turn is still owed ✓)."
      exit 0
    fi
    h_lane="$(holder | sed -n 1p)"; h_pid="$(holder | sed -n 2p)"; h_beat="$(holder | sed -n 4p)"
    echo "REFUSED — the token is held by '${h_lane:-nobody}' (pid $h_pid, last beat $h_beat s ago)."
    exit 3
    ;;
  queue)
    if [ -n "$lane" ]; then
      queue_add "$lane"
      head="$(queue_head)"
      echo "QUEUED: $lane (position $(queue_list | grep -nxF "$lane" | cut -d: -f1) of $(queue_list | grep -c .))"
      [ "$head" = "$lane" ] && echo "  you are at the HEAD — the token is free the moment it is released."
      exit 0
    fi
    echo "ARM QUEUE (first is next):"; queue_list | sed 's/^/  /'
    exit 0
    ;;
  status)
    if [ -d "$TOKEN_DIR" ]; then
      h_lane="$(holder | sed -n 1p)"; h_pid="$(holder | sed -n 2p)"; h_beat="$(holder | sed -n 4p)"
      age=$(( $(now) - ${h_beat:-0} ))
      if token_fresh "$h_beat"; then
        echo "ARM TOKEN: HELD by $h_lane (pid $h_pid, last beat ${age}s ago)"
      else
        echo "ARM TOKEN: HELD by $h_lane (pid $h_pid) BUT STALE (last beat ${age}s ago, TTL ${TTL}s) — reclaim it: arm-token.sh take <your-lane>"
      fi
    else
      echo "ARM TOKEN: FREE"
    fi
    echo "ARM QUEUE (first is next):"
    queue_list | sed 's/^/  /'
    if [ -f "$SMALL_TOKEN_DIR/holder/holder" ]; then
      _ss_age=$(( $(date +%s) - $(grep '^beat=' "$SMALL_TOKEN_DIR/holder/holder" | cut -d= -f2) ))
      if [ "$_ss_age" -ge "$TTL" ]; then
        echo "ARM SMALL SLOT: HELD by $(grep '^lane=' "$SMALL_TOKEN_DIR/holder/holder" | cut -d= -f2) (population $(grep '^population=' "$SMALL_TOKEN_DIR/holder/holder" | cut -d= -f2) files, last beat ${_ss_age}s ago) — **STALE (TTL ${TTL}s) ⇒ RECLAIMABLE**"
      else
        echo "ARM SMALL SLOT: HELD by $(grep '^lane=' "$SMALL_TOKEN_DIR/holder/holder" | cut -d= -f2) (population $(grep '^population=' "$SMALL_TOKEN_DIR/holder/holder" | cut -d= -f2) files, last beat ${_ss_age}s ago)"
      fi
    else
      echo "ARM SMALL SLOT: FREE (a population of 2,000 files or fewer, declared when taken)"
    fi
    exit 0
    ;;
  force)
    [ -n "$lane" ] || { echo "usage: arm-token.sh force <lane> [--urgent] [--holder-is-gone]"; exit 2; }
    # ── THE NAME MUST BE A LANE, AND IT MUST BE THE HOLDER (2026-10-21, the Lead's own mistake) ──
    # THE LEAD RAN `force small --holder-is-gone` INTENDING TO RECLAIM DART'S STALE SMALL SLOT, AND
    # `force` TAKES A LANE NAME, NOT A SLOT NAME — so it DELETED THE HEAVY TOKEN DIRECTORY WHILE
    # TYPESCRIPT HELD IT. The typescript lane lost BOTH the token AND its queue place, because the
    # `force` path re-queues the displaced holder ONLY in its `--urgent` branch.
    #
    # ⇒ THE DEFECT IS NOT THE MISSING `--urgent`; it is that a verb which DELETES A SHARED LOCK
    # ACCEPTED A NAME THE CALLER INVENTED. "break a lock whose holder is known-gone" and "delete a lock
    # because I typed the wrong word" are indistinguishable to that verb, and the second one is what
    # cost a lane an arm.
    #
    # ⇒ THE FIX IS A CHECK, AND IT IS A CHECK THAT CANNOT BE SATISFIED BY A TYPO: THE NAME MUST BE
    # THE CURRENT HOLDER OF THE SLOT BEING FORCED. There is no "small" holder for the heavy token, so
    # "small" is refused before anything is deleted.
    f_holder="$(holder | sed -n 1p)"
    if [ -z "$f_holder" ] || [ "$f_holder" = "?" ]; then
      echo "REFUSED — the heavy arm token is FREE (no holder), so there is nothing to force."
      echo "  A lane whose place is missing from the queue is a QUEUE question, not a token question:"
      echo "  run 'arm-token.sh status' for the queue, and 'take <lane>' for the token."
      exit 5
    fi
    if [ "$f_holder" != "$lane" ]; then
      echo "REFUSED — 'force' acts on the CURRENT HOLDER of the heavy arm, and the holder is '$f_holder', not '$lane'."
      echo "  A verb that deletes a shared lock on a name the caller INVENTED cannot tell"
      echo "  'break a lock whose holder is known-gone' from 'delete a lock because I typed the wrong word'."
      echo "  The small slot is NOT forced by this verb: it reclaims ITSELF on the TTL path, so the next"
      echo "  'take-small' after the holder's beat goes stale reclaims it. Run 'arm-token.sh status' to see"
      echo "  the small slot's holder and its beat age."
      exit 5
    fi
    # ── THE LEAD BROKE THE ONE-ARM INVARIANT WITH THIS COMMAND, AND THE FIX IS HERE. ──
    # On 2026-10-20 the Lead ran `arm-token.sh force test` to EXERCISE THE QUEUE, while the dart lane's
    # 33,738-file arm was legitimately holding the token and running. `force` deleted the token directory
    # UNCONDITIONALLY, so the holder's heartbeat — which lives in that directory — vanished, the token looked
    # FREE, and the java lane took it and started an arm: TWO ARMS AT ONCE, caused by the Lead's test.
    #
    # THE FIX IS THE INVARIANT, NOT THE EXPLANATION. A holder that is GONE stops beating, so a fresh
    # heartbeat PROVES the holder is alive — and `force` must REFUSE a fresh heartbeat. The TTL path
    # already reclaims a dead holder; `force` exists only for the rarer case of a holder that is FROZEN
    # (alive, not beating), and it says so loudly and takes the displaced holder's place in the queue.
    h_lane="$(holder | sed -n 1p)"; h_beat="$(holder | sed -n 4p)"; h_pid="$(holder | sed -n 2p)"
    h_ticks="$(holder | sed -n 3p)"; now_ticks="$(proc_start_ticks "$h_pid" 2>/dev/null || echo 0)"
    # ── THE NAMESPACE RULE (2026-10-21) — THE LEAD'S OWN FIX, REVERTED, AND THE REASON IS THE POINT ──
    # The Lead first made the refusal depend on the holder's PROCESS being alive (pid + start-ticks).
    # MEASURED ON THIS BOX: THE AGENTS RUN IN THEIR OWN PID NAMESPACE ✓✓ — the dart lane's LIVE holder
    # is pid 6 ✓, and /proc/6 DOES NOT EXIST in the Lead's namespace ✓✓ (the Lead sees 4 processes
    # ✓). So a pid check reads a namespaced agent's live holder as DEAD ✓✗✗ — and `force` would then
    # have STOLEN A LIVE HOLDER'S TOKEN ✓✗✗, breaking the one-arm invariant the rule exists to
    # protect ✓✗✗✗. WORSE, IT IS NOT EVEN CONSISTENT ✓✓: the python lane's holder (pid 3901 ✓) WAS
    # host-visible ✓, so the same check would have said DEAD ✓ and LIVE ✓ for two different lanes ✓✗.
    # **A RULE THAT SOMETIMES WORKS IS WORSE THAN NO RULE ✓✓.**
    # SO: THE SCRIPT NEVER GUESSES LIVENESS ✓✓ — IT CANNOT ✓✓. THE BEAT IS THE ONLY NAMESPACE-SAFE
    # SIGNAL ✓✓ (a file's mtime is visible across namespaces ✓✓), so a LIVE holder keeps the beat
    # fresh ✓✓ and a CRASHED holder's beat goes stale ✓✓ — and the reclaim happens on the TTL path ✓✓.
    # THE ONE WAY PAST A FRESH BEAT IS THE LEAD'S EXPLICIT ASSERTION ✓✓: `--holder-is-gone` ✓✓, which
    # says "I have checked this holder OUTSIDE this script" ✓✓ — the Lead knows the harness's own view
    # of whether the lane is still executing ✓✓, and the script knows only the clock ✓✓.
    if [ "$h_pid" != "" ] && [ "$now_ticks" != "0" ] && [ "$h_ticks" != "$now_ticks" ]; then
      echo "NOTE — the holder's pid ${h_pid} is not visible to the Lead's namespace (or its start-ticks differ) ✓✓."
      echo "       THAT IS EXPECTED ✓✓ — the agents run in their own pid namespace ✓✓ — so the pid is REPORTED, NEVER DECIDED ✓✓."
    fi
    # ★★★ THE TWO FLAGS WERE MUTUALLY EXCLUSIVE IN EFFECT, AND THAT WAS THE THIRD INSTANCE OF THE
    # SHAPE THAT COST THIS SCRIPT ITS FIRST LANE. `--holder-is-gone` is the documented way past a
    # fresh beat ("I have checked this holder OUTSIDE this script"), and `--urgent` is what
    # RE-QUEUES the displaced holder. The old condition put them on opposite sides of one `if`:
    # `--holder-is-gone` SKIPPED the whole block and so SKIPPED THE RE-QUEUE, and `--urgent` alone
    # did the re-queue. ⇒ ⇒ ⇒ SO THE FLAG THE SCRIPT DOCUMENTED AS THE LEAD'S EXPLICIT ASSERTION WAS
    # EXACTLY THE ONE THAT LOST THE HOLDER ITS QUEUE PLACE — the very defect the Lead caused on
    # 2026-10-20 when `force` deleted typescript's live token, and the reason `--urgent` was added
    # in the first place. ⇒ A FLAG THAT MEANS "I HAVE CHECKED" MUST NOT DISABLE THE RECOVERY THE
    # OTHER FLAG PERFORMS.
    #
    # ⇒ THE FIX: THE REFUSAL IS BYPASSED BY EITHER FLAG, AND THE RE-QUEUE HAPPENS IN BOTH CASES.
    # ⇒ AND THE RE-QUEUE IS NOW UNCONDITIONAL ON THE FRESH-BEAT PATH: a displaced holder goes to the
    # BACK of the queue, never off it, because **A LANE THAT HAS HAD ITS TURN IS NOT A LANE THAT HAS
    # LEFT THE FLEET** (the same rule the small-slot release already follows).
    f_fresh=0
    if token_fresh "$h_beat"; then f_fresh=1; fi
    if [ "$f_fresh" -eq 1 ] && [ "$BB_FLAG_URGENT" -eq 0 ] && [ "$BB_FLAG_GONE" -eq 0 ]; then
      echo "REFUSED — the token is held by ${h_lane:-nobody} and its heartbeat is FRESH ($(( $(now) - h_beat ))s ago; TTL ${TTL}s)."
      echo "  A holder that is GONE stops beating, so a fresh heartbeat PROVES it is alive."
      echo "  If you KNOW the holder is frozen or gone, re-run with --urgent --holder-is-gone."
      exit 5
    fi
    if [ "$f_fresh" -eq 1 ]; then
      echo "*** URGENT FORCE — the token is being pulled from ${h_lane:-nobody}, whose heartbeat is FRESH ($(( $(now) - h_beat ))s ago)."
      echo "*** If that lane has an arm running, two arms are about to run at once."
      echo "*** The displaced holder is RE-QUEUED at the BACK — it does not lose its place."
      queue_add "$h_lane" 2>/dev/null || true
    fi
    rm -rf "$TOKEN_DIR" 2>/dev/null || true
    echo "ARM TOKEN FORCED FREE by $lane"; exit 0
    ;;
  *) echo "usage: arm-token.sh {take|beat|release|status|force} [lane]"; exit 2 ;;
esac
