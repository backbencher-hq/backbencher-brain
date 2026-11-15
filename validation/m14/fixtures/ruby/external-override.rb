# frozen_string_literal: true

# M37.10 regression fixture: overrideCompanion dead-machinery sweep.
#
# Production callers never populate AnalyzeContext.overrideCompanion, so the
# pre-M37.10 ruby analyzer silently dropped every override whose base class
# was declared in another file. Contract now: in-file base -> verified @0.95;
# external base -> Pass-3 first-parent guess @0.5/inferred with reasonCode
# "first-parent-guess". The external base MUST NOT be declared in this file —
# that absence is the defect's trigger condition.

class LocalBase
  def handle
    nil
  end
end

class InFileService < LocalBase
  def handle
    super
  end
end

class AuditService < ExternalBase
  def handle
    log('audit')
  end
end
