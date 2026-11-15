% `classdef X < Y & Z` — the first base is inheritance (X IS-A Y), every
% following base is conformance to an additional superclass. A dotted base is
% ONE superclass, not a chain of package segments.
classdef Multi < BaseOne & BaseTwo & matlab.mixin.Copyable
    methods
        function out = describe(obj)
            out = 'multi';
        end
    end
end
