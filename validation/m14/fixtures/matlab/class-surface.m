classdef Surface < handle
properties (SetAccess=private)
    Value
end
events
    Changed
end
enumeration
    Ready (1)
end
methods (Access=private, Static)
    function answer = helper(input)
        answer = input;
    end
end
end
