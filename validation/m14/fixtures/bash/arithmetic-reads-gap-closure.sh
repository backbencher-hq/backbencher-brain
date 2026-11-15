#!/usr/bin/env bash
# BD-gap-closure: a variable read inside an arithmetic context is a read. The
# pre-wave analyzer consulted only simple_expansion/expansion, so every
# arithmetic operand was invisible.

count=0
limit=10
while (( count < limit )); do
  count=$(( count + 1 ))
  echo $(( count * 2 ))
done
for (( i = 0; i < limit; i++ )); do
  echo "$i"
done
