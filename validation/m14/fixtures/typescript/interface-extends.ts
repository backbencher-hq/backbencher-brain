interface B {
    b(): void;
}

interface C {
    c(): void;
}

interface A extends B, C {
    m(): void;
}
