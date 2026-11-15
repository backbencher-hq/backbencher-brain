use v5.38;
class Point {
    field $x;
    field $y = 0;
    method new ($class, $x, $y) { return bless { x => $x, y => $y }, $class }
    method sum ($self) { return $self->x + $self->y }
}
role Greeter {
    method greet { return "hi" }
}
package Legacy;
sub new { return bless {}, shift }
1;
