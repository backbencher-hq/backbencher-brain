class Widget:
    slot: Exception = None

    def read(self, stream) -> BaseException | None:
        if isinstance(stream, Exception):
            return stream
        return None

    def build(self) -> type:
        return int
