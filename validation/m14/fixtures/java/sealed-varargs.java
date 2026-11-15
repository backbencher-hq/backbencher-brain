package com.acme.shapes;

public sealed class Shape permits Circle, Square {

    public static java.util.List<String> describe(java.util.List<Shape> shapes, String... labels) {
        return null;
    }
}

final class Circle extends Shape { }

non-sealed class Square extends Shape { }
