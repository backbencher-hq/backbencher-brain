CC := gcc
CFLAGS := -O2 -Wall
APP := order-api
SRCS := src/main.c src/server.c

.PHONY: all clean test install

all: $(APP)

$(APP): $(SRCS)
	$(CC) $(CFLAGS) -o $@ $(SRCS)

build: $(APP)

test: build
	./run-tests.sh

clean:
	rm -f $(APP) *.o

install: $(APP)
	cp $(APP) /usr/local/bin/

include config.mk

# vim: noet
