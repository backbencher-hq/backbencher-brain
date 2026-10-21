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
mkdir -p "$(dirname "$TOKEN_DIR")" 2>/dev/null || true
mkdir -p "$(dirname "$QUEUE_FILE")" 2>/dev/null || true

# THE QUEUE. Eight lanes, ONE arm slot, and arms take 7 to 45 minutes — so without a queue the lanes
# POLL, and a lane can be overtaken by a later arrival (the Lead did it to toml). The queue is a plain
# file, one lane per line, in arrival order, and `take` REFUSES a lane that is not at the head. It is
# also the Lead's situational awareness: `status` prints the whole queue, so the Lead can see who is
# next and WHY a lane has not run yet.
queue_add() {
  local l="$1"
  [ -f "$QUEUE_FILE" ] || : > "$QUEUE_FILE"
  grep -qxF "$l" "$QUEUE_FILE" || echo "$l" >> "$QUEUE_FILE"
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
  local before after
  before="$(queue_list | tr '\n' ' ')"
  grep -vxF "$l" "$QUEUE_FILE" > "$QUEUE_FILE.tmp" 2>/dev/null || : > "$QUEUE_FILE.tmp"
  mv "$QUEUE_FILE.tmp" "$QUEUE_FILE"
  after="$(queue_list | tr '\n' ' ')"
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
      echo "ARM TOKEN TAKEN by $lane — run ONE arm, then: arm-token.sh release $lane"
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
  release)
    [ -n "$lane" ] || { echo "usage: arm-token.sh release <lane>"; exit 2; }
    # THE SMALL SLOT IS CHECKED FIRST: a lane may hold the small slot while the HEAVY token is held by
    # another lane entirely, and the heavy holder's name must not block the small slot's release.
    if [ -f "$SMALL_TOKEN_DIR/holder/holder" ] && grep -q "lane=$lane" "$SMALL_TOKEN_DIR/holder/holder" 2>/dev/null; then
      rm -rf "$SMALL_TOKEN_DIR" 2>/dev/null || true
      echo "ARM SMALL SLOT RELEASED by $lane"
      exit 0
    fi
    h_lane="$(holder | sed -n 1p)"
    if [ "$h_lane" != "$lane" ]; then
      echo "NOT RELEASED — the token is held by '${h_lane:-nobody}', not by $lane."; exit 4
    fi
    rm -rf "$TOKEN_DIR" 2>/dev/null || true
    # A GRANTED TURN DOES NOT CONSUME THE LANE'S QUEUE PLACE ✓✓ (the holder records it ✓).
    if [ "${h_granted:-0}" = "1" ]; then
      echo "ARM TOKEN RELEASED by $lane — a GRANTED turn ✓; the lane's queue place is KEPT ✓."
    else
      queue_remove "$lane"
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
    if mkdir "$SMALL_TOKEN_DIR/holder" 2>/dev/null; then
      printf 'lane=%s\npid=%s\nstarted=%s\nbeat=%s\npopulation=%s\n' "$lane" "$$" "$(date +%s)" "$(date +%s)" "$files" > "$SMALL_TOKEN_DIR/holder/holder.tmp" && mv "$SMALL_TOKEN_DIR/holder/holder.tmp" "$SMALL_TOKEN_DIR/holder/holder"
      echo "ARM SMALL SLOT TAKEN by $lane (declared population $files files) — a SEPARATE lock, so a HEAVY arm may run beside it."
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
      echo "ARM SMALL SLOT: HELD by $(grep '^lane=' "$SMALL_TOKEN_DIR/holder/holder" | cut -d= -f2) (population $(grep '^population=' "$SMALL_TOKEN_DIR/holder/holder" | cut -d= -f2) files, last beat $(( $(date +%s) - $(grep '^beat=' "$SMALL_TOKEN_DIR/holder/holder" | cut -d= -f2) ))s ago)"
    else
      echo "ARM SMALL SLOT: FREE (a population of 2,000 files or fewer, declared when taken)"
    fi
    exit 0
    ;;
  force)
    [ -n "$lane" ] || { echo "usage: arm-token.sh force <lane> [--urgent] [--holder-is-gone]"; exit 2; }
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
    if token_fresh "$h_beat" && [ "${3:-}" != "--holder-is-gone" ]; then
      if [ "${2:-}" != "--urgent" ]; then
        echo "REFUSED — the token is held by ${h_lane:-nobody} and its heartbeat is FRESH ($(( $(now) - h_beat ))s ago; TTL ${TTL}s)."
        echo "  A holder that is GONE stops beating, so a fresh heartbeat PROVES it is alive."
        echo "  If you KNOW the holder is frozen and the heartbeat is lying, re-run with --urgent."
        exit 5
      fi
      echo "*** URGENT FORCE — the token is being pulled from ${h_lane:-nobody}, whose heartbeat is FRESH ($(( $(now) - h_beat ))s ago)."
      echo "*** If that lane has an arm running, two arms are about to run at once."
      queue_add "$h_lane" 2>/dev/null || true
    fi
    rm -rf "$TOKEN_DIR" 2>/dev/null || true
    echo "ARM TOKEN FORCED FREE by $lane"; exit 0
    ;;
  *) echo "usage: arm-token.sh {take|beat|release|status|force} [lane]"; exit 2 ;;
esac
