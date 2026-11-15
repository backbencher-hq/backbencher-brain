package com.acme.core;

public sealed interface Shape permits Circle, Square {
}
public record Circle(double radius) implements Shape {
}
public record Square(double side) implements Shape {
}
