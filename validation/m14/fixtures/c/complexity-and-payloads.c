#include <stdlib.h>

/**
 * Computes parity of n.
 */
int compute(int n) {
    if (n > 0) { n--; }
    for (int i = 0; i < n; i++) { }
    return n > 1 && n < 9 ? 1 : 2;
}

void runner(void) {
    int r = compute(5);
    (void)r;
}

// F6 coverage (2026-09-02): enum_specifier, union_specifier, while_statement,
// do_statement, case_statement, preproc_def — declared handled_verified but
// no fixture exercised them.
#define MAX_RENDER_DEPTH 8

enum Color { RED, GREEN, BLUE };

enum Color next_color(void) {
    static enum Color c = RED;
    return c;
}

union Packet { int raw; struct { unsigned depth; } parts; };

int classify(int depth) {
    int label = 0;
    while (depth > 0) {
        depth -= 1;
        label += 1;
    }
    do {
        label += 2;
    } while (label < 4);
    switch (label) {
        case 1:
        case 2:
            return 10;
        default:
            return label > MAX_RENDER_DEPTH ? 20 : 30;
    }
}
