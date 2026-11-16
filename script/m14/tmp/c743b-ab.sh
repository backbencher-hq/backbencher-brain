#!/usr/bin/env bash
# #743b A/B: the preproc-argument header-name rule, before/after, on all four
# pinned corpora. The rule lives in the SHARED C grammar, so c's corpora have to
# be re-verified too, not only cpp's.
set -u
cd <corpus-root>/mcp/backbencher-brain || exit 1
R=<corpus-root>/bb_tests/repositories
C_OLD=wasm/tree-sitter-c.wasm
C_NEW=/tmp/c743b.wasm
CPP_OLD=/tmp/cpp743d.wasm
CPP_NEW=/tmp/cpp743e.wasm

run() { # <wasm> <repo> <exts> <limit> <out>
  timeout 500 bun script/m14/tmp/c743-baseline.ts "$1" "$2" "$3" "$4" > "$5" 2>/dev/null
  echo "$5: $(wc -l < "$5") files, EMPTY=$(grep -c EMPTY-TREE "$5")"
}
run "$C_OLD"   "$R/sqlite"        ".c,.h"            200 /tmp/ab-c-sqlite-old.txt
run "$C_NEW"   "$R/sqlite"        ".c,.h"            200 /tmp/ab-c-sqlite-new.txt
run "$C_OLD"   "$R/jq"            ".c,.h"            200 /tmp/ab-c-jq-old.txt
run "$C_NEW"   "$R/jq"            ".c,.h"            200 /tmp/ab-c-jq-new.txt
run "$CPP_OLD" "$R/fmt"           ".cpp,.hpp,.cc,.hh,.h" 300 /tmp/ab-cpp-fmt-old.txt
run "$CPP_NEW" "$R/fmt"           ".cpp,.hpp,.cc,.hh,.h" 300 /tmp/ab-cpp-fmt-new.txt
run "$CPP_OLD" "$R/nlohmann-json" ".hpp,.cpp,.h,.cc"  60  /tmp/ab-cpp-nj-old.txt
run "$CPP_NEW" "$R/nlohmann-json" ".hpp,.cpp,.h,.cc"  60  /tmp/ab-cpp-nj-new.txt

report() { # <label> <old> <new>
  echo
  echo "===== $1 ====="
  awk -F'\t' '{e+=$3;l+=$5;if($5>0)f++} END{printf "  old: errNodes=%d errLines=%d failingFiles=%d/%d\n",e,l,f,NR}' "$2"
  awk -F'\t' '{e+=$3;l+=$5;if($5>0)f++} END{printf "  new: errNodes=%d errLines=%d failingFiles=%d/%d\n",e,l,f,NR}' "$3"
  echo "  WORSE (errLines up):"
  paste "$2" "$3" | awk -F'\t' '$10>$5 {printf "    %-58s %3s -> %3s\n",$1,$5,$10}'
  echo "  newly failing files (was 0):"
  paste "$2" "$3" | awk -F'\t' '$5==0 && $10>0 {printf "    %-58s 0 -> %3s\n",$1,$10}'
  echo "  newly clean files:"
  paste "$2" "$3" | awk -F'\t' '$5>0 && $10==0 {printf "    %-58s %3s -> 0\n",$1,$5}'
}
report "c / sqlite 200" /tmp/ab-c-sqlite-old.txt /tmp/ab-c-sqlite-new.txt
report "c / jq"         /tmp/ab-c-jq-old.txt     /tmp/ab-c-jq-new.txt
report "cpp / fmt"      /tmp/ab-cpp-fmt-old.txt  /tmp/ab-cpp-fmt-new.txt
report "cpp / nlohmann-json 60" /tmp/ab-cpp-nj-old.txt /tmp/ab-cpp-nj-new.txt
echo
echo "ALL DONE"
