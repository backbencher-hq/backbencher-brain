#!/usr/bin/env bash
# script/m57/foreign-reds-issues.sh — idempotent publisher/reconciler for the
# four foreign-red convictions filed from M57's closure (#802–#807 saga).
#
# HARD-WON LESSON (2026-09-13): "the search returned nothing" and "the search
# FAILED" are DIFFERENT facts. The first publisher treated a failed search (the
# flapping proxy) as "absent" and created duplicates (#806, #807 for the same
# finding). This script only CREATES when a search SUCCEEDS and returns zero
# rows. On a network failure it changes nothing and retries next round.
#
# Modes:
#   (default)   reconcile, exiting 0 only after verifying the end state:
#               exactly one OPEN issue per conviction, all on the milestone.
#   --dry-run   print the plan, mutate nothing.
#   --once      one pass, no retry loop.
#
# Liveness: use the pidfile, never `pgrep -f` (the pattern matches the checking
# shell itself and reports a false RUNNING).
set -u
cd $HOME/mcp/backbencher-brain
echo $$ > .foreign-reds-reconcile.pid

REPO=backbencher-hq/backbencher-brain
MS_TITLE="Analyzer Lane Review — foreign-red gates (M57 convictions)"
BODY_DIR=docs/convictions/issues
SRC=docs/convictions/foreign-reds.md
LOG=.foreign-reds-reconcile.log
DRY=0; ONCE=0
for a in "$@"; do
  [ "$a" = "--dry-run" ] && DRY=1
  [ "$a" = "--once" ] && ONCE=1
done
LIMIT=1000; [ "$ONCE" = "1" ] && LIMIT=1
say() { echo "$(date +%T) $*"; echo "$(date +%T) $*" >> "$LOG"; }

title_for() { sed -n "s/^## $1\. \(.*\) — RED.*$/\1/p" "$SRC" | head -1 | tr -d '`'; }

ms_num=""
PUSHED=""
for round in $(seq 1 "$LIMIT"); do
  # ---- push (the same flapping proxy blocks git; local was 15 commits ahead) ----
  if [ -z "$PUSHED" ] && [ "$DRY" = "0" ]; then
    if timeout 45 git push origin m48-recovery >/dev/null 2>&1; then PUSHED=1; say "PUSHED m48-recovery"; fi
  fi
  # ---- milestone (idempotent) ----
  if [ -z "$ms_num" ]; then
    out=$(timeout 25 gh api "repos/$REPO/milestones?state=open" \
            --jq '.[] | select(.title=="'"$MS_TITLE"'") | .number' 2>/dev/null)
    if [ $? -ne 0 ]; then
      say "net: milestone lookup failed"
    else
      ms_num=$(printf '%s' "$out" | head -1)
      if [ -z "$ms_num" ] && [ "$DRY" = "0" ]; then
        timeout 25 gh api -X POST "repos/$REPO/milestones" -f title="$MS_TITLE" \
          -f description="Four gates convicted to the analyzer/indexer lane during M50/M57. Receipts: docs/convictions/foreign-reds.md" >/dev/null 2>&1
        ms_num=$(timeout 25 gh api "repos/$REPO/milestones?state=open" \
                   --jq '.[] | select(.title=="'"$MS_TITLE"'") | .number' 2>/dev/null | head -1)
        [ -n "$ms_num" ] && say "milestone created: #$ms_num"
      fi
    fi
  fi

  ok=0
  for n in 1 2 3 4; do
    T=$(title_for "$n")
    if [ -z "$T" ]; then say "WARN: no title parsed for conviction $n"; continue; fi

    ids=$(timeout 25 gh issue list --repo "$REPO" --state all --search "$T in:title" \
            --json number -q '.[].number' 2>/dev/null)
    if [ $? -ne 0 ]; then say "net: search failed for conviction $n (no action taken)"; continue; fi
    sorted=$(printf '%s\n' $ids | grep -E '^[0-9]+$' | sort -n)

    if [ -z "$sorted" ]; then
      if [ "$DRY" = "1" ]; then say "plan: CREATE conviction $n ($T)"; ok=$((ok+1)); continue; fi
      ms_arg=(); [ -n "$ms_num" ] && ms_arg=(--milestone "$MS_TITLE")
      timeout 25 gh issue create --repo "$REPO" \
        --title "$T — RED (foreign conviction, analyzer lane)" \
        --body-file "$BODY_DIR/$n.md" "${ms_arg[@]}" >/dev/null 2>&1
      ids2=$(timeout 25 gh issue list --repo "$REPO" --state all --search "$T in:title" \
               --json number -q '.[].number' 2>/dev/null)
      sorted=$(printf '%s\n' $ids2 | grep -E '^[0-9]+$' | sort -n)
      if [ -z "$sorted" ]; then say "net: create unverified for conviction $n"; continue; fi
      say "created conviction $n: #$(printf '%s' "$sorted" | head -1)"
    fi

    canon=$(printf '%s' "$sorted" | head -1)
    dups=$(printf '%s' "$sorted" | tail -n +2)
    if [ "$DRY" = "1" ]; then
      say "plan: keep #$canon; close duplicates [$(printf '%s' "$dups" | tr '\n' ' ')]"
      ok=$((ok+1)); continue
    fi

    st=$(timeout 25 gh issue view "$canon" --repo "$REPO" --json state -q .state 2>/dev/null)
    if [ "$st" = "CLOSED" ]; then
      timeout 25 gh issue reopen "$canon" --repo "$REPO" >/dev/null 2>&1 && say "reopened canonical #$canon"
    fi
    if [ -n "$ms_num" ]; then
      if timeout 25 gh issue edit "$canon" --repo "$REPO" --milestone "$MS_TITLE" >/dev/null 2>&1; then
        say "canonical #$canon on milestone #$ms_num"
      else
        say "net: milestone edit failed for #$canon"
      fi
    fi

    for d in $dups; do
      if timeout 25 gh issue close "$d" --repo "$REPO" \
           --comment "Duplicate of #$canon (same conviction: \`$T\`). Closed by script/m57/foreign-reds-issues.sh — a failed proxy search made the earlier publisher treat an existing issue as absent, so it created this one again. The canonical receipt lives on #$canon." >/dev/null 2>&1; then
        say "closed duplicate #$d (canonical #$canon)"
      else
        say "net: could not close duplicate #$d"
      fi
    done
    ok=$((ok+1))
  done

  # ---- verification: exactly four open issues on the milestone ----
  if [ -n "$ms_num" ]; then
    open_ms=$(timeout 25 gh issue list --repo "$REPO" --state open --milestone "$MS_TITLE" --json number -q 'length' 2>/dev/null)
    if [ $? -eq 0 ] && [ "$open_ms" = "4" ] && [ "$ok" -eq 4 ] && [ -n "$PUSHED" ]; then
      say "VERIFIED: 4 convictions, exactly 4 open issues on milestone #$ms_num; branch pushed"
      exit 0
    fi
    say "round $round: ok=$ok/4 open_on_milestone=${open_ms:-?} pushed=${PUSHED:-0}"
  fi
  [ "$ONCE" = "1" ] && break
  sleep 20
done
say "reconciler exit without full verification"
exit 1
