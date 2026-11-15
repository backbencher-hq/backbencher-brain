#!/usr/bin/perl
# PERL-1 — a dependency the file does not declare is a CLAIM, not silence.
#
# The lane published no externality reading at all: 10,096 edges, 9,435 ambiguous/unresolved, 0
# verified. `use strict` / `use Test::More` name a module, and `is(...)` names a sub no corpus file
# declares — both were published with no reading.
use strict;
use warnings;
use Test::More;

sub local_helper {
    return 1;
}

local_helper();
is(local_helper(), 1, 'the local helper is ours');
