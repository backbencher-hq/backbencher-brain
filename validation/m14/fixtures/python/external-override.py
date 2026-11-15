# M37.10 regression fixture: overrideCompanion dead-machinery sweep.
#
# Production callers never populate AnalyzeContext.overrideCompanion, so the
# pre-M37.10 python analyzer silently dropped every override whose base class
# was declared in another file. Contract now: in-file base -> verified @0.95;
# external base -> Pass-3 first-parent guess @0.5/inferred with reasonCode
# "first-parent-guess". ExternalBase is deliberately NOT declared here.

class LocalBase:
    def handle(self):
        return None


class InFileService(LocalBase):
    def handle(self):
        return super().handle()


class AuditService(ExternalBase):
    def handle(self):
        return self.log("audit")
