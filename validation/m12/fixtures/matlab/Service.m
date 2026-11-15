% MATLAB fixture for the language-tool matrix gate: a class with methods and a
% free function, enough for the analyzer to store symbols and call edges.
classdef Service < handle
    properties
        Count = 0
    end
    methods
        function obj = Service(value)
            obj.Count = value;
        end
        function answer = compute(obj, input)
            answer = helper(obj.Count, input);
        end
    end
end

function result = helper(count, input)
    result = count + input;
end
