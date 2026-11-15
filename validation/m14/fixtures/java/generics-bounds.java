package com.acme.core;

import java.util.List;

public class Box<T extends Comparable<T>> {
    private T value;
    public <R> R map(Function<T, R> fn) { return fn.apply(value); }
}
