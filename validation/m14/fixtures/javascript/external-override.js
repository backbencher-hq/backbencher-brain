// M37.10 regression fixture: overrideCompanion dead-machinery sweep.
//
// Production callers never populate AnalyzeContext.overrideCompanion, so the
// pre-M37.10 javascript analyzer silently dropped every override whose base
// class was declared in another file. Contract now: in-file base -> verified
// @0.95; external base -> Pass-3 first-parent guess @0.5/inferred with
// reasonCode "first-parent-guess". ExternalBase is deliberately NOT declared
// in this file — that absence is the defect's trigger condition.

class LocalBase {
  handle() {
    return null;
  }
}

class InFileService extends LocalBase {
  handle() {
    return super.handle();
  }
}

class AuditService extends ExternalBase {
  handle() {
    return this.log("audit");
  }
}

module.exports = { LocalBase, InFileService, AuditService };
