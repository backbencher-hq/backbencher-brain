class Reader:
    def scan(self, source):
        try:
            return source.read()
        except Exception as ex:
            return ex

    def guard(self, source):
        try:
            return source.read()
        except BaseException as stop:
            return stop
