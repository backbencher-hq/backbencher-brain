# perl/ontology-imports — the `imports` EDGE, not the `imports` payload.
#
# Every line here is a construct perl HAS and that the lane did not read as an
# edge. The `ImportInfo` payload already carried every one of them; `bb_graph`
# reads `brain_relationship`, so payload rows were stored and in no graph.
use strict;
use warnings;
use Mojo::Base -base;
use Feature::Compat 'try';
no strict 'refs';
use 5.010;
require Runtime::Lazy;
sub loader {
  require Runtime::Inside;
  return 1;
}
sub guarded {
  use integer;
  return 2;
}
1;
