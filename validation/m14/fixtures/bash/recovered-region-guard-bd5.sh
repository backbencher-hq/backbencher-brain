#!/usr/bin/env bash
# BD5 / BA-G2: nothing is emitted out of a grammar-damaged region. The pinned
# corpus emitted `calls: -> ]/%5D}` from a `${value/]/%5D}` parameter expansion
# whose `]` the vendored grammar does not model; that is a recovery artifact, not
# a call. The FORBID entries below are the pre-fix shape.

value=alpha
value=${value/]/%5D}
echo "$value"
