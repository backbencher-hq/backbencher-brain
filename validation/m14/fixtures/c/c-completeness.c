#include <stdlib.h>
#define EXPORT_SYMBOL(x) x

typedef struct Point { int value; } Point;
EXPORT_SYMBOL(compute);

int compute(int n) {
    Point p = { n };
    if (p.value > 0) return n;
    return 0;
}

/* SCD1 write-gate fixture (M37 #599): both statements are assignment-LHS
   writes on ->value; no uses edge may originate from set_value. */
void set_value(Point *q, int v) {
    q->value = v;
    q->value += 1;
}
