#!/usr/bin/env bash
# BD1: two call sites of one callee are two relationships, each naming its own
# line. The pre-wave edge identity was (source|type|target), so these collapsed
# into one row and the store could only ever report "one caller".

emit() {
  echo emit
}

emit
emit
emit
