package com.acme.orders;

import org.apache.commons.io.FileUtils;

public class FqThirdPartyCalls {
    public void run() {
        Service.doWork();
        org.apache.commons.io.FileUtils.readFile("x");
        org.slf4j.LoggerFactory.getLogger(FqThirdPartyCalls.class);
        System.out.println("control stdlib");
        java.nio.file.Files.exists(null);
    }
}
