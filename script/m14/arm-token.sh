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
  grep -vxF "$l" "$QUEUE_FILE" > "$QUEUE_FILE.tmp" 2>/dev/null || : > "$QUEUE_FILE.tmp"
  mv "$QUEUE_FILE.tmp" "$QUEUE_FILE"
}
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

write_holder() {  # lane pid ticks
  printf '%s\n%s\n%s\n%s\n' "$1" "$2" "$3" "$(now)" > "$TOKEN_DIR/holder"
}

cmd="${1:-status}"; lane="${2:-}"

case "$cmd" in
  take)
    [ -n "$lane" ] || { echo "usage: arm-token.sh take <lane>"; exit 2; }
    # THE HEAD OF THE QUEUE GOES FIRST. A lane that is not at the head is REFUSED, and told the order.
    # Polling and hoping was how a lane could be overtaken by a later arrival.
    head="$(queue_head)"
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
    [ -n "$lane" ] || { echo "usage: arm-token.sh beat <lane>"; exit 2; }
    h_lane="$(holder | sed -n 1p)"
    if [ "$h_lane" != "$lane" ]; then
      echo "NOT BEATEN — the token is held by '${h_lane:-nobody}', not by $lane."; exit 4
    fi
    h_pid="$(holder | sed -n 2p)"; h_ticks="$(holder | sed -n 3p)"
    write_holder "$lane" "$h_pid" "$h_ticks"
    echo "ARM TOKEN BEAT by $lane"; exit 0
    ;;
  release)
    [ -n "$lane" ] || { echo "usage: arm-token.sh release <lane>"; exit 2; }
    h_lane="$(holder | sed -n 1p)"
    if [ "$h_lane" != "$lane" ]; then
      echo "NOT RELEASED — the token is held by '${h_lane:-nobody}', not by $lane."; exit 4
    fi
    rm -rf "$TOKEN_DIR" 2>/dev/null || true
    queue_remove "$lane"
    echo "ARM TOKEN RELEASED by $lane"; exit 0
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
    exit 0
    ;;
  force)
    [ -n "$lane" ] || { echo "usage: arm-token.sh force <lane>"; exit 2; }
    rm -rf "$TOKEN_DIR" 2>/dev/null || true
    echo "ARM TOKEN FORCED FREE by $lane"; exit 0
    ;;
  *) echo "usage: arm-token.sh {take|beat|release|status|force} [lane]"; exit 2 ;;
esac
