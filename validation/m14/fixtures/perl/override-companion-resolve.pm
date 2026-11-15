package MR15::Confirmed;
use parent -norequire, 'Remote::Base';
# CONFIRMED: the base declares `run`. 0.5 guess -> 0.95 base-declares-method.
sub run { 2 }

package MR15::Withdrawn;
use parent -norequire, 'Remote::Silent';
# WITHDRAWN: the base is PRESENT in the companion and declares `unrelated`, not
# `gone`. The guess must not survive. This is 75.6% of the corpus's guesses.
sub gone { 3 }

package MR15::Unknown;
use parent -norequire, 'Some::Absent::Base';
# STILL A GUESS: the base is outside the project. Absence of knowledge is not
# knowledge of absence, so the deterministic first-parent default stands.
sub stranded { 4 }

1;
