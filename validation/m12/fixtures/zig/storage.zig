// validation/m12/fixtures/zig/storage.zig
// M12.20 Zig positive fixture: generic containers (comptime), error unions,
// pointer types, function calls across the file.

const std = @import("std");

pub const StorageError = error{ Full, NotFound };

pub const RingBuffer = struct {
    data: []u8,
    head: usize,
    tail: usize,
    capacity: usize,

    pub fn init(capacity: usize) RingBuffer {
        return RingBuffer{ .data = &[_]u8{}, .head = 0, .tail = 0, .capacity = capacity };
    }

    pub fn push(self: *RingBuffer, value: u8) StorageError!void {
        if (self.len() >= self.capacity) return StorageError.Full;
        self.data[self.tail] = value;
        self.tail = (self.tail + 1) % self.capacity;
    }

    pub fn pop(self: *RingBuffer) StorageError!u8 {
        if (self.len() == 0) return StorageError.NotFound;
        const value = self.data[self.head];
        self.head = (self.head + 1) % self.capacity;
        return value;
    }

    pub fn len(self: *const RingBuffer) usize {
        return (self.tail + self.capacity - self.head) % self.capacity;
    }
};

pub fn GenericStack(comptime T: type) type {
    return struct {
        items: []T,
        count: usize,

        pub fn init(items: []T) GenericStack(T) {
            return GenericStack(T){ .items = items, .count = 0 };
        }

        pub fn push(self: *GenericStack(T), item: T) void {
            self.items[self.count] = item;
            self.count += 1;
        }
    };
}

pub fn main() void {
    var buf: [8]u8 = undefined;
    var rb = RingBuffer.init(buf.len);
    _ = rb.push(10) catch return;
    _ = rb.pop() catch return;

    var arr: [4]u32 = undefined;
    var stack = GenericStack(u32).init(&arr);
    stack.push(42);
    _ = stack;
}
