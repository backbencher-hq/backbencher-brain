package Remote::Base;

# The base DECLARES `run`, so a subclass's `run` is a real override. This file
# exists so the companion has an opinion about `Remote::Base`.
sub run { 1 }

1;
