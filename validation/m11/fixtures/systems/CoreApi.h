// validation/m11/fixtures/systems/CoreApi.h
// M11.10 C fixture: headers, declarations/definitions, structs, enums,
// typedefs, function pointers, macros, includes.
#ifndef CORE_API_H
#define CORE_API_H

#include <stddef.h>

#define MAX_ITEMS 128
#define SAFE_CALL(fn) ((fn) != NULL ? (fn)() : -1)

typedef struct Point Point;

struct Point {
  int x;
  int y;
};

typedef struct {
  int length;
  int capacity;
  int *data;
} Buffer;

typedef enum {
  STATUS_OK = 0,
  STATUS_ERROR = 1,
  STATUS_TIMEOUT = 2
} Status;

typedef int (*CompareFn)(const void *a, const void *b);

typedef struct Point Point2D;

int core_init(void);
int core_shutdown(void);
Buffer *buffer_create(int capacity);
void buffer_destroy(Buffer *buf);
int buffer_append(Buffer *buf, int value);
int point_distance(const Point *a, const Point *b);

#endif // CORE_API_H
