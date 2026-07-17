.PHONY: cli desktop clean test

VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")

cli:
	@mkdir -p build/bin
	go build -trimpath -ldflags="-s -w" -o build/bin/fio-go-cli ./cmd/cli/
	@echo "✓ CLI → build/bin/fio-go-cli"

desktop:
	@mkdir -p build/bin
	wails build -trimpath -ldflags="-s -w" -o build/bin/fio-go-desktop
	@echo "✓ Desktop → build/bin/fio-go-desktop"

test:
	go test ./internal/... -v

clean:
	rm -rf build/bin/*
	@echo "✓ cleaned build/bin/"

lint:
	go vet ./...
	@echo "✓ vet passed"
