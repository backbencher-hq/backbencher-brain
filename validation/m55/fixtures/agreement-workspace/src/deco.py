import functools

def target():
    return 1

@functools.wraps(target)
def caller():
    return target()
