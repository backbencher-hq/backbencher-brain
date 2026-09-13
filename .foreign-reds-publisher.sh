#!/usr/bin/env bash
# Foreign-reds publisher v2: creates the analyzer-lane review milestone + 4
# issues inside flapping-proxy windows, and ATTACHES every issue to the
# milestone (v1 forgot --milestone and its title regex missed "— RED (n/m)").
# Persistent (setsid); log lives in-repo so a /tmp wipe cannot lose it.
cd $HOME/mcp/backbencher-brain
LOG=.foreign-reds-publisher.log
MS_TITLE="Analyzer Lane Review — foreign-red gates (M57 convictions)"
REPO=backbencher-hq/backbencher-brain

say() { echo "$(date +%T) $*" >> "$LOG"; }

ms_num=""

title_for() { # $1 = index
  sed -n "s/^## $1\. \(.*\) — RED.*$/\1/p" docs/convictions/foreign-reds.md | head -1
}

for round in $(seq 1 400); do
  # ---- milestone (idempotent) ----
  if [ -z "$ms_num" ]; then
    ms_num=$(timeout 18 gh api "repos/$REPO/milestones?state=open" --jq '.[] | select(.title=="'"$MS_TITLE"'") | .number' 2>/dev/null | head -1)
    if [ -z "$ms_num" ]; then
      timeout 18 gh api -X POST "repos/$REPO/milestones" \
        -f title="$MS_TITLE" \
        -f description="Four gates convicted to the analyzer/indexer lane during M50/M57 (revert-proven, re-verified red at HEAD before filing). Receipts: docs/convictions/foreign-reds.md" >/dev/null 2>&1
      ms_num=$(timeout 18 gh api "repos/$REPO/milestones?state=open" --jq '.[] | select(.title=="'"$MS_TITLE"'") | .number' 2>/dev/null | head -1)
      [ -n "$ms_num" ] && say "milestone created: $ms_num"
    fi
  fi

  # ---- issues (idempotent by title search) ----
  done_count=0
  for n in 1 2 3 4; do
    T=$(title_for "$n")
    [ -z "$T" ] && { say "WARN empty title for $n"; continue; }
    SEARCH=$(printf '%s' "$T" | tr -d '`')
    NUM=$(timeout 18 gh issue list --repo "$REPO" --search "$SEARCH in:title" --state all --json number -q '.[0].number' 2>/dev/null | head -1)
    if [ -z "$NUM" ]; then
      TITLE_TXT="${T} — RED (foreign conviction, analyzer lane)"
      if [ -n "$ms_num" ]; then
        timeout 18 gh issue create --repo "$REPO" --title "$TITLE_TXT" --body-file "docs/convictions/issues/$n.md" --milestone "$MS_TITLE" >/dev/null 2>&1
      else
        timeout 18 gh issue create --repo "$REPO" --title "$TITLE_TXT" --body-file "docs/convictions/issues/$n.md" >/dev/null 2>&1
      fi
      NUM=$(timeout 18 gh issue list --repo "$REPO" --search "$SEARCH in:title" --state all --json number -q '.[0].number' 2>/dev/null | head -1)
      [ -n "$NUM" ] && say "issue $n created: #$NUM"
    fi
    [ -z "$NUM" ] && continue
    # attach to milestone regardless of how it was created
    if [ -n "$ms_num" ]; then
      timeout 18 gh issue edit "$NUM" --repo "$REPO" --milestone "$MS_TITLE" >/dev/null 2>&1 \
        && say "issue $n #$NUM on milestone $ms_num" || say "issue $n #$NUM milestone pending"
    fi
    done_count=$((done_count+1))
  done

  if [ -n "$ms_num" ] && [ "$done_count" -eq 4 ]; then
    say "ALL FILED (milestone $ms_num)"
    break
  fi
  sleep 20
done
say "foreign-reds publisher exit"
