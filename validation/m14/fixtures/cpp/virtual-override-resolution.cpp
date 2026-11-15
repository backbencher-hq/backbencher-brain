class Base {
public:
    virtual void run();
};

class Derived : public Base {
public:
    void run() override;
};
