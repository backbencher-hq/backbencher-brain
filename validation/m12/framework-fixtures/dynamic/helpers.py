def add(a, b):
    return a + b


def format_name(first, last):
    return f"{first} {last}"


class Counter:
    def __init__(self):
        self._value = 0

    def increment(self):
        self._value += 1
        return self._value
