package com.example.advanced;

import java.util.List;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Covers records, enums, lambdas, overloads, generics, and annotations.
 */
@Deprecated
public class AdvancedFeatures<T extends Number> {

    public record Point(int x, int y) {
        public double distance() {
            return Math.sqrt(x * x + y * y);
        }
    }

    public enum Status { ACTIVE, INACTIVE, PENDING }

    @FunctionalInterface
    public interface Mapper<A, B> {
        B map(A value);
    }

    private final List<Point> points = List.of(new Point(1, 2), new Point(3, 4));

    public AdvancedFeatures() {
    }

    public Status getStatus(String key) {
        return key == null ? Status.PENDING : Status.ACTIVE;
    }

    public int overload(int value) {
        return value * 2;
    }

    public String overload(String value) {
        return value + value;
    }

    public double totalDistance() {
        return points.stream().mapToDouble(Point::distance).sum();
    }

    public <R> R mapFirst(Function<Point, R> fn) {
        return fn.apply(points.get(0));
    }

    public List<Integer> mapXs() {
        return points.stream().map((p) -> p.x()).collect(Collectors.toList());
    }

    public int genericBound(T value) {
        return value.intValue();
    }
}
