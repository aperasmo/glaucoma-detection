## --- Stage 1: Builder ---
## Uses full Go toolchain to compile the binary
## Nothing from this stage goes into the final image except the compiled binary
FROM golang:1.26-alpine AS builder

WORKDIR /build

# Copy dependency manifests first
# go mod download is cached until go.mod or go.sum changes
# A code change in main.go does not invalidate this layer
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY main.go .

# Build a static binary for Linux
# CGO_ENABLED=0 produces a fully statically linked binary with no C library dependencies
# GOOS=linux ensures the correct target OS regardless of the build machine (Windows/macOS)
# -ldflags="-s -w" strips debug symbols and DWARF info - reduces binary size significantly
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o report-service .

# --- Stage 2: Final image ---
# Minimal alpine base - no Go toolchain, no build artifacts, no source code
# Final image will be approximately 15-20MB
FROM alpine:3.20

WORKDIR /app

# Copy only the compiled binary from the builder stage
COPY --from=builder /build/report-service .

# Copy assets folder
# Contains glaucoma-ai-logo-light.png used during PDF generation
# Must match the path the Go code expects at runtime
COPY assets/ ./assets/

EXPOSE 8081

CMD ["./report-service"]
