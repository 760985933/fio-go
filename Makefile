.PHONY: cli desktop clean test

VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")

cli:
	@mkdir -p build/bin
	go build -trimpath -ldflags="-s -w" -o build/bin/fio-cli ./cmd/cli/
	@echo "✓ CLI → build/bin/fio-cli"

desktop:
	@mkdir -p build/bin
	wails build -trimpath -ldflags="-s -w" -o build/bin/fio-gui
	@echo "✓ Desktop → build/bin/fio-gui"

test:
	go test ./internal/... -v

clean:
	rm -rf build/bin/*
	@echo "✓ cleaned build/bin/"

lint:
	go vet ./...
	@echo "✓ vet passed"
