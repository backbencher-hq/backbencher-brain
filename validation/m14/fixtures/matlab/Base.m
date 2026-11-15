% The BASE half of the cross-file override pin. A MATLAB class file declares
% one class; an override is only verifiable against a base whose members are
% visible, so this file supplies `Base` to the companion index.
classdef Base
    methods
        function out = alpha(obj)
            out = 1;
        end
        function out = shared(obj)
            out = 'b';
        end
    end
end
