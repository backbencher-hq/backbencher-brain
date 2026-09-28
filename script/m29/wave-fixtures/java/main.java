// PINS the java wave fixture pack (M29.R2 wave 1, owner-approved set).
// Uniform wave convention: class Greeter with method greet, exercised in main.

package dev.backbencher.wavetest;

import java.util.List;

public class Greeter {
    private final List<String> items;

    public Greeter(List<String> items) {
        this.items = items;
    }

    public String greet() {
        return "hello " + items.size();
    }

    public static void main(String[] args) {
        Greeter g = new Greeter(List.of("a", "b"));
        System.out.println(g.greet());
    }
}
