% The SUBCLASS half of the cross-file override pin. MATLAB allows one classdef
% per file, so the base cannot be declared here; the override is verified
% through the companion index built from Base.m.
classdef Multi < Base
    methods
        function out = alpha(obj)
            out = 2;
        end
        function out = extra(obj)
            out = 3;
        end
    end
end
