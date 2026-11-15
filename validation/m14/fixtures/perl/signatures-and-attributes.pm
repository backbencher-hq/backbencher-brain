package Pins;
sub plain { 1 }
sub mandatory ($self, $id) { $id }
sub optional ($self, $id = 7, @rest) { $id }
sub slurpy ($class, %args) { 1 }
sub lvalue_attr :lvalue :method($self) { 1 }
sub prototyped :prototype(@$) { 2 }
1;
