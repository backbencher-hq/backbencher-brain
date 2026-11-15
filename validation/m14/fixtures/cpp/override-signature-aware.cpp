class Logger {
public:
    virtual void log(int level);
};

class FileLogger : public Logger {
public:
    void log(const char* message);
    void write(int fd);
};
