package com.acme.points;

public record Point(int x, int y, String... tags) {

    public Point {
        if (x < 0) throw new IllegalArgumentException("negative");
    }
}
