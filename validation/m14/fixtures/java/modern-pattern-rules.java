// Pins the three references rules the CORPORPUS never exercises.
//
// `permits` and `record_pattern` were fixture-pinned; `switch_pattern` was not — and
// `switch_pattern` fires on NEITHER corpus, so it had no coverage at all: not the
// differential (grails-core and clojure predate these constructs) and not a fixture.
// Measured: 0 of 79 `instanceof_check`, 103 `class_literal` and 1
// `method_reference_receiver` edges in a 60-file draw, against ZERO for the three here.
//
// That is the same blind spot the java completion plan's own addendum records — "the
// canonical 60-file draw never sampled that file, which is why the lane read green" — in
// its purest form: a rule that cannot fire on the corpus and is not pinned is a rule whose
// behaviour is whatever it currently happens to be.
//
// All three verified working on the pinned grammar before being pinned:
//   sealed interface Shape permits Circle, Square  -> Shape->Circle, Shape->Square
//   case R(int a)                                  -> m->R
//   case String s                                  -> m->String
//   case R(int a, int b)                           -> m->R
//   case String s when s.length() > 1              -> m->String

import java.util.List;

sealed interface Shape permits Circle, Square {
}

final class Circle implements Shape {
}

final class Square implements Shape {
}

record Point(int x, int y) {
}

record Line(Point from, Point to) {
}

class ModernPatternRules {

    double area(Shape shape) {
        return switch (shape) {
            case Circle c -> 1.0;
            case Square s -> 2.0;
        };
    }

    String describe(Object o) {
        return switch (o) {
            case String s when s.length() > 1 -> "long string";
            case String s -> "string";
            case Integer i -> "int " + i;
            case List<?> l -> "list of " + l.size();
            case Point(int x, int y) -> "point " + x + "," + y;
            case Line(Point(var ax, var ay), Point p2) -> "line";
            case null -> "null";
            default -> "?";
        };
    }

    int firstCoordinate(Object o) {
        if (o instanceof Point(int x, int y)) {
            return x + y;
        }
        return switch (o) {
            case Point p -> p.x();
            default -> 0;
        };
    }
}
