// M37.10 regression fixture: overrideCompanion dead-machinery sweep (swift side).
//
// Swift's analyzer always had a Pass-3 first-parent fallback, but it emitted
// the GUESS at confidence 1.0 with evidenceClass "structural" — a silent
// overclaim: the guess was indistinguishable from a companion-verified
// override in thresholded analysis. The exact anti-pattern java's Pass-3
// comment documents as fixed. Contract now: verified (in-file) @1.0;
// guess @0.5/"inferred" with reasonCode "first-parent-guess".
// ExternalBase is deliberately NOT declared in this file.

class LocalBase {
  func handle() {}
}

class InFileService: LocalBase {
  override func handle() {
    super.handle()
  }
}

class AuditService: ExternalBase {
  override func handle() {
    log("audit")
  }
}
