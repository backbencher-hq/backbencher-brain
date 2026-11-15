package com.example.mrefs;

import java.util.function.Function;
import java.util.function.Supplier;

/**
 * EXPORTS_JAVA2 fixture: the receiver of `X::m` is a NAME only when the source
 * wrote one.
 *
 * JLS 15.13 allows any expression as the receiver, and a real corpus writes
 * them. Measured on java-lib's 3,275 files: 15 endpoints were source text rather
 * than names — a parenthesised call with its arguments
 * (`newArrayList(v3(), v4())`), a chained call
 * (`MultimapBuilder.linkedHashKeys().arrayListValues()`), and a STRING LITERAL
 * (`"com.google.common."::length`, whose CONTENTS would have landed in the
 * graph). None can join to a symbol.
 *
 * So each shape below appears twice: once where a name IS written and once where
 * an expression is, and the pins say which.
 */
public class MethodRefReceivers {
    static class Widget {
        void configure() {}
        static Widget create() { return new Widget(); }
    }

    // NAMED receivers — a bare type, a qualified type, and a qualified type
    // whose qualification the grammar spells `field_access`.
    void namedReceivers() {
        Runnable a = Widget::new;
        Function<Widget, Runnable> b = Widget::configure;
        Function<Widget, Runnable> c = java.util.Map.Entry::getKey;
        Supplier<Widget> d = Widget.create()::hashCode;
        use(a); use(b); use(c); use(d);
    }

    // EXPRESSION receivers — no name is written, so no edge may be published.
    void expressionReceivers() {
        Function<Widget, Runnable> e = Widget.create()::configure;
        Supplier<Widget> f = list().get(0)::hashCode;
        Function<Integer, Integer> g = "com.google.common."::length;
        Function<Object, Integer> h = this.field::hashCode;
        use(e); use(f); use(g); use(h);
    }

    Widget field;

    private static java.util.List<Widget> list() { return null; }

    private static void use(Object o) {}
}