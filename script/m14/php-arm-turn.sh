#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# php ARM TURN — stand by for the queue, TAKE THE TOKEN WHEN php IS THE HEAD, run the arm, release.
#
# WHY THIS IS A LOOP AND NOT A ONE-SHOT TAKE. The fleet's token rule is: only the HEAD of the queue
# may take the ordinary token (`arm-token.sh take` refuses a lane that is not at the head with exit
# 3 and tells it to WAIT for the head). php is THIRD this round — javascript and yaml run first — so
# the correct behaviour is to WAIT, and then take on the turn, not to take early and not to leave the
# turn unused because nobody was watching. This loop watches the queue PRINTED BY THE TOKEN SCRIPT
# (it does not re-derive the order, and it never forces anything): it waits for php to be the head
# AND the token to be free, then takes. If a take loses a race (the script's own exit 3), it waits
# again. The take is the ONLY mutation this script makes to fleet state.
#
# THE ARM ITSELF IS `php-arm-run.sh`, unchanged: preflight (token must be held by php), the
# population emit census beating from its own loop, the arbiter's whole-population gate with a beat
# watcher whose lifetime is the gate's, no promotion of partial output, release on the normal path.
#
# USAGE
#   bash script/m14/php-arm-turn.sh                    # wait for the turn, then run the arm
#   PHP_ARM_MAX_WAIT=14400 bash script/m14/php-arm-turn.sh   # bounded standby (seconds; default 4 h)
#
# EXIT: 0 arm completed · 2 environment · 3 the queue never reached php inside the bound · 4 the take
#       kept losing a race (each explainable, none silent) · (the arm runner's own codes otherwise)
# ─────────────────────────────────────────────────────────────────────────────
set -u

LANE=php
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO" || exit 2
MAX_WAIT="${PHP_ARM_MAX_WAIT:-14400}"
POLL="${PHP_ARM_POLL:-45}"
START="$(date +%s)"
ATTEMPTS=0

say() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

status_line() { bash script/m14/arm-token.sh status 2>&1 | sed -n 1p; }
queue_head() {
  bash script/m14/arm-token.sh status 2>&1 | awk '
    /^ARM QUEUE/ { inq=1; next }
    inq && NF { print $1; exit }
  '
}
free_or_stale() {
  # a STALE holder is reclaimable by the token script itself (`take` handles the reclaim) — the
  # loop treats it as free so the script's own reclaim path decides, rather than this wrapper.
  status_line | grep -qE "FREE|STALE"
}

say "php ARM TURN — standby begun. bound=${MAX_WAIT}s poll=${POLL}s"
say "  $(status_line)"
say "  queue head: $(queue_head)"

while :; do
  NOW="$(date +%s)"
  if [ $((NOW - START)) -ge "$MAX_WAIT" ]; then
    say "TIMEOUT — the queue did not reach $LANE within ${MAX_WAIT}s. Nothing taken, nothing changed."
    say "  $(status_line)"
    say "  queue head: $(queue_head)"
    exit 3
  fi

  LINE="$(status_line)"
  HEAD="$(queue_head)"

  # already ours (a previous turn took it, or a retry) — go straight to the arm
  if printf '%s' "$LINE" | grep -q "HELD by $LANE"; then
    say "token is held by $LANE — running the arm"
    break
  fi

  # the token is held by someone else: wait, and say who, so the standby log is a progress record
  if ! free_or_stale; then
    say "waiting — $LINE (head: ${HEAD:-nobody})"
    sleep "$POLL"
    continue
  fi

  # token free (or stale-reclaimable): only the HEAD may take
  if [ "${HEAD:-}" != "$LANE" ]; then
    say "token free but head is ${HEAD:-nobody} — waiting my turn"
    sleep "$POLL"
    continue
  fi

  ATTEMPTS=$((ATTEMPTS + 1))
  say "php is the head and the token is free — take (attempt $ATTEMPTS)"
  set +e
  TAKE_OUT="$(bash script/m14/arm-token.sh take "$LANE" 2>&1)"
  TAKE_RC=$?
  printf '%s\n' "$TAKE_OUT" | sed 's/^/  /'
  case "$TAKE_RC" in
    0) break ;;
    7)
      # the memory gate refused: that is a measurement-integrity refusal, not a queue problem.
      say "the take was refused by the MEMORY gate — waiting ${POLL}s and retrying (never overcommit silently)"
      sleep "$POLL"
      continue
      ;;
    *)
      # exit 3: lost a race, or the head changed between the read and the take. Re-read and retry.
      [ "$ATTEMPTS" -ge 20 ] && { say "REFUSED — 20 take attempts without success; reporting rather than forcing."; exit 4; }
      sleep 15
      continue
      ;;
  esac
done

say "running the arm (script/m14/php-arm-run.sh)"
bash script/m14/php-arm-run.sh
ARM_RC=$?
say "arm runner exit=${ARM_RC}"
exit "$ARM_RC"
