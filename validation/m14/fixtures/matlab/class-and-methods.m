classdef Report < BaseReport
properties
    Data
end
methods
    function report = Report(data)
        report.Data = data;
    end
    function value = total(obj)
        value = sum(obj.Data);
    end
end
end
