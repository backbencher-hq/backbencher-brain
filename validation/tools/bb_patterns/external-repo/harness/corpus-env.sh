#!/bin/zsh
# bb_tests/bb_patterns/harness/corpus-env.sh — set the corpus data dir ONCE, by
# absolute path, and refuse to run if it does not look like an index.
#
# WHY THIS FILE EXISTS. Two measurement runs in this lane came back with
# plausible-looking but entirely fictional numbers — "0 candidates on every
# corpus", "95% false positives on lodash" — for the same reason: a probe did
#
#     cd "$BB_REPO"; export BB_DATA_DIR="$PWD/_data2_poly"
#
# and `bb` dutifully CREATED an empty database at that path, inside the shared
# repository, and answered every query about zero files. Nothing errored. The
# failure is silent in both directions: real data looks like no data, and no
# data looks like a clean project.
#
# Two things went wrong independently and both are worth a guard:
#   * `$PWD` evaluated after a `cd`, so the path pointed somewhere unintended;
#   * better-sqlite3 opens a missing file by CREATING it unless the caller asks
#     otherwise, so a wrong path is not an error, it is an empty answer.
#
# This script pins the absolute path and asserts the corpus is real before any
# probe runs, so a wrong path fails loudly instead of measuring nothing.

set -u
BB_PATTERNS_DIR="/Users/sano/Documents/Default Project/ishaq/bb_tests/bb_patterns"
export BB_DATA_DIR="${BB_DATA_DIR:-$BB_PATTERNS_DIR/_data2_poly}"
export BB_REPO="${BB_REPO:-/Users/sano/Documents/Default Project/ishaq/backbencher-brain}"
export PATH="$HOME/.local/bbnode/bin:$PATH"

assert_complete() {
  # assert_complete <projectId> — fail unless the indexer recorded a completed
  # run for this project.
  #
  # Added after probe-l1 measured NINE of seventeen corpora as reporting zero
  # orphan candidates, with thousands of symbols each. They were not clean: the
  # language matrix was still writing those databases while the probe read them.
  # A partially-written index is not a project with no dead code, it is a
  # project that was read mid-write, and the two look identical in output.
  #
  # The first version of this harness checked only that a database EXISTED,
  # which is exactly the wrong check: a half-built index is a database.
  # brain_index_status is the indexer's own completion record, so the guard uses
  # the indexer's word rather than inferring completion from row counts.
  local pid="$1"
  local state
  state=$(node -e '
    const {createRequire}=require("module");const path=require("path");
    const req=createRequire(path.join(process.env.BB_REPO,"package.json"));
    const db=new req("better-sqlite3")(path.join(process.env.BB_DATA_DIR,"projects",process.argv[1],"brain.db"),{readonly:true,fileMustExist:true});
    const row=db.prepare("SELECT status, total_files, indexed_files FROM brain_index_status WHERE project_id=?").get(process.argv[1]);
    process.stdout.write(row ? `${row.status} ${row.indexed_files}/${row.total_files}` : "NO_STATUS_ROW");
  ' "$pid" 2>/dev/null)
  if [ -z "$state" ] || [ "$state" = "NO_STATUS_ROW" ]; then
    echo "CORPUS INCOMPLETE: project $pid has no brain_index_status row — the indexer never recorded a finished run." >&2
    echo "  A partial index reads as an empty project. Refusing to measure." >&2
    return 1
  fi
  case "$state" in
    complete*) echo "corpus $pid COMPLETE ($state)" >&2 ;;
    *) echo "CORPUS INCOMPLETE: project $pid status=$state" >&2; return 1 ;;
  esac
}

assert_corpus() {
  # assert_corpus <projectId> — fail unless the project exists and holds files.
  local pid="$1"
  local db="$BB_DATA_DIR/projects/$pid/brain.db"
  if [ ! -f "$db" ]; then
    echo "CORPUS MISSING: no brain.db for project $pid at $db" >&2
    echo "  BB_DATA_DIR=$BB_DATA_DIR" >&2
    return 1
  fi
  local files
  files=$(node -e '
      const {createRequire}=require("module");const path=require("path");
      const req=createRequire(path.join(process.env.BB_REPO,"package.json"));
      const db=new req("better-sqlite3")(path.join(process.env.BB_DATA_DIR,"projects",process.argv[1],"brain.db"),{readonly:true,fileMustExist:true});
      process.stdout.write(String(db.prepare("SELECT COUNT(*) c FROM brain_file").get().c));
    ' "$pid" 2>/dev/null)
  if [ -z "$files" ] || [ "$files" = "0" ]; then
    echo "CORPUS EMPTY: project $pid has $files indexed file(s). Refusing to measure." >&2
    echo "  If this is unexpected, the indexer is probably mid-run or crashed:" >&2
    echo "  it dies with an unhandled EPIPE when a worker times out on a large file." >&2
    return 1
  fi
  echo "corpus $pid OK: $files indexed file(s), BB_DATA_DIR=$BB_DATA_DIR" >&2
}
