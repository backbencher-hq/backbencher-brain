// validation/m12/fixtures/c/Module.c
// M12.16 C positive fixture: definitions, calls, field access, globals,
// enum member usage, typedef usage, static functions.
#include "Module.h"
#include <stdlib.h>

static int initialized = 0;

static int clamp(int value, int lo, int hi) {
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}

int module_init(void) {
  initialized = 1;
  return STATUS_OK;
}

int module_shutdown(void) {
  initialized = 0;
  return STATUS_OK;
}

Buffer *buffer_create(int capacity) {
  Buffer *buf = (Buffer *)malloc(sizeof(Buffer));
  if (buf == NULL) return NULL;
  buf->capacity = clamp(capacity, 1, MAX_BUFFER);
  buf->length = 0;
  buf->data = (int *)malloc(sizeof(int) * (size_t)capacity);
  return buf;
}

void buffer_destroy(Buffer *buf) {
  if (buf == NULL) return;
  free(buf->data);
  free(buf);
}

int buffer_append(Buffer *buf, int value) {
  if (buf == NULL || buf->length >= MAX_BUFFER) return STATUS_ERROR;
  buf->data[buf->length] = value;
  buf->length++;
  return STATUS_OK;
}

int point_distance(const Point *a, const Point *b) {
  int dx = a->x - b->x;
  int dy = a->y - b->y;
  return dx * dx + dy * dy;
}

int compare_ints(const void *a, const void *b) {
  int ia = *(const int *)a;
  int ib = *(const int *)b;
  return ia - ib;
}

void sort_buffer(Buffer *buf) {
  if (buf == NULL || buf->length < 2) return;
  qsort(buf->data, (size_t)buf->length, sizeof(int), compare_ints);
}
