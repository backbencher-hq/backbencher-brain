// fixture: cpp/multiline-attribute-line-base-920
// #920: the engine blanks `__attribute__((...))` before parsing, and that match
// spans a newline here. Blanking must keep the newline INSIDE it, or every node
// after it is stamped one line too small (measured: 76 of zig's 14,032 C/C++
// files, worst case 138 rows of drift).

#include <cstddef>

__attribute__((
    visibility("default")))
std::size_t exposed(std::size_t n) { return n + 2; }

struct Payload {
    std::size_t size;
};

static std::size_t helper(std::size_t n) {
    return n + 1;
}

std::size_t use(Payload *p) {
    p->size = helper(p->size);
    return exposed(p->size);
}
