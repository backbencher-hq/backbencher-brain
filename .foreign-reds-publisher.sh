#!/usr/bin/env bash
# Foreign-reds publisher: creates the analyzer-lane review milestone + 4 issues
# inside flapping-proxy windows. Persistent (setsid); receipts live in-repo.
cd $HOME/mcp/backbencher-brain
MS_TITLE="Analyzer Lane Review — foreign-red gates (M57 convictions)"
declare -A CREATED

for round in $(seq 1 400); do
  # milestone (idempotent)
  if [ -z "${CREATED[ms]}" ]; then
    EXISTS=$(timeout 18 gh api "repos/backbencher-hq/backbencher-brain/milestones?state=open" --jq '.[] | select(.title=="'"$MS_TITLE"'") | .number' 2>/dev/null)
    if [ -n "$EXISTS" ]; then
      CREATED[ms]=$EXISTS; echo "$(date +%T) milestone exists: $EXISTS"
    elif timeout 18 gh api -X POST repos/backbencher-hq/backbencher-brain/milestones -f title="$MS_TITLE" -f description="Four gates convicted to the analyzer/indexer lane during M50/M57 (revert-proven, re-verified red at HEAD before filing). Receipts: docs/convictions/foreign-reds.md" > /dev/null 2>&1; then
      CREATED[ms]=$(timeout 18 gh api "repos/backbencher-hq/backbencher-brain/milestones?state=open" --jq '.[] | select(.title=="'"$MS_TITLE"'") | .number' 2>/dev/null)
      echo "$(date +%T) milestone created: ${CREATED[ms]}"
    fi
  fi

  # issues (idempotent by title search)
  for n in 1 2 3 4; do
    [ -n "${CREATED[i$n]}" ] && continue
    TITLE=$(sed -n "s/^## $n\. \(.*\) — RED$/\1/p" docs/convictions/foreign-reds.md | head -1)
    [ -z "$TITLE" ] && continue
    FOUND=$(timeout 18 gh issue list --search "$TITLE in:title" --json number -q '.[].number' 2>/dev/null | head -1)
    if [ -n "$FOUND" ]; then
      CREATED[i$n]=$FOUND; echo "$(date +%T) issue exists: #$FOUND"
    elif timeout 18 gh issue create --title "$TITLE — RED (foreign conviction, analyzer lane)" --body-file docs/convictions/issues/$n.md > /dev/null 2>&1; then
      CREATED[i$n]="new"; echo "$(date +%T) issue created: $TITLE"
    fi
  done

  # done when all four issues exist and milestone known
  if [ -n "${CREATED[ms]}" ] && [ -n "${CREATED[i1]}" ] && [ -n "${CREATED[i2]}" ] && [ -n "${CREATED[i3]}" ] && [ -n "${CREATED[i4]}" ]; then
    echo "ALL FILED"; break
  fi
  sleep 20
done
echo "foreign-reds publisher exit"
