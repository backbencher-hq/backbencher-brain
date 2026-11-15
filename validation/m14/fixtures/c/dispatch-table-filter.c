extern void on(void);
extern void off(void);
void (*handlers[2])(void);

void run(int i) {
    handlers[i]();
}
