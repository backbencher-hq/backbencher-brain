#!/usr/bin/env bash
# Clone bash-dominant corpora for the M14 bash lane.
#
# Selection rule (lane-audit formula §4): the corpus must be language-dominant
# for the lane, and at least one must be the pinned M12 target. The existing
# pin is fsharp (build glue, not bash-dominant) — these five give the lane a
# language-reference source, an adversarial parser torture set, and three
# real-world volumes.
set -u
ROOT=<corpus-root>/bb_tests/repositories
LOG=<corpus-root>/bb_tests/bash-corpus-clone.log
: > "$LOG"

clone() {
  local name="$1" url="$2"
  if [ -d "$ROOT/$name/.git" ]; then
    echo "SKIP  $name (already cloned)" | tee -a "$LOG"
    return 0
  fi
  echo "START $name <- $url" | tee -a "$LOG"
  if git clone --depth 1 --quiet "$url" "$ROOT/$name" >>"$LOG" 2>&1; then
    local rev n
    rev=$(git -C "$ROOT/$name" rev-parse HEAD)
    n=$(git -C "$ROOT/$name" ls-files '*.sh' '*.bash' | wc -l)
    echo "OK    $name rev=$rev bashFiles=$n" | tee -a "$LOG"
  else
    echo "FAIL  $name (see $LOG)" | tee -a "$LOG"
  fi
}

# 1. the language reference: the canonical bash distribution, incl. tests/ and
#    examples/ that exercise the full builtin and expansion surface
clone bash-official   https://github.com/bminor/bash.git
# 2. the adversarial set: a shell parser's own testdata, hundreds of small
#    .sh files written to break a parser one construct at a time
clone mvdan-sh        https://github.com/mvdan/sh.git
# 3. volume + real world: ~1.3k .sh theme/plugin files
clone ohmyzsh         https://github.com/ohmyzsh/ohmyzsh.git
# 4. pure-bash real world, version-manager idiom (source/import heavy)
clone nvm             https://github.com/nvm-sh/nvm.git
# 5. pure-bash real world, different idiom
clone rbenv           https://github.com/rbenv/rbenv.git

echo "=== DONE ===" | tee -a "$LOG"
for d in bash-official mvdan-sh ohmyzsh nvm rbenv; do
  if [ -d "$ROOT/$d/.git" ]; then
    printf '%-16s rev=%s  .sh=%s  .bash=%s\n' "$d" \
      "$(git -C "$ROOT/$d" rev-parse --short HEAD)" \
      "$(git -C "$ROOT/$d" ls-files '*.sh' | wc -l)" \
      "$(git -C "$ROOT/$d" ls-files '*.bash' | wc -l)"
  else
    printf '%-16s MISSING\n' "$d"
  fi
done | tee -a "$LOG"
