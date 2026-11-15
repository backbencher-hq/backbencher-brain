#!/usr/bin/env bash
# BD7: `export` is a first-class relationship type in the ontology and seven peer
# lanes emit it. The pre-wave analyzer parsed `export` for years, set
# isExported in metadata, and emitted no edge at all.

export EXPORTED_PLAIN
export EXPORTED_WITH_VALUE=42
readonly READONLY_VALUE=7

export -f exported_function

exported_function() {
  echo hi
}

export -f other_function
other_function() {
  echo other
}
