// PINS the java wave fixture pack (M29.R1 dry-run / M29.R2 wave execution).
// Adversarial per the wave protocol: declarations, inheritance, calls,
// imports, cross-file-style references, and the known-hard #419 bug classes
// (array uses, ctor delegation, record patterns, initializer calls).

package dev.backbencher.wavetest;

import java.util.List;

public class Main {
    private final List<String> items;

    public Main(List<String> items) {
        this.items = items;
    }

    // #419 G1 class: array reads/writes must be Uses of xs.
    public int sum(int[] xs) {
        int total = 0;
        for (int i = 0; i < xs.length; i++) {
            total += xs[i];
        }
        return total;
    }

    // #419 G2 class: super()/this() delegation must be a Calls edge.
    public Main() {
        this(List.of("seed"));
    }

    public String describe() {
        return "Main with " + items.size() + " items";
    }
}

class Helper {
    static int twice(int n) { return n * 2; }
}
