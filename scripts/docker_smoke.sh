#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
COMPOSE_FILE="$ROOT_DIR/docker-compose.smoke.yml"
HOST_PORT="${NIYAM_DOCKER_SMOKE_HOST_PORT:-3410}"
KEEP_ARTIFACTS="${NIYAM_DOCKER_SMOKE_KEEP_ARTIFACTS:-0}"

if [[ -n "${NIYAM_DOCKER_SMOKE_ARTIFACT_DIR:-}" ]]; then
    ARTIFACT_DIR="$NIYAM_DOCKER_SMOKE_ARTIFACT_DIR"
    KEEP_ARTIFACTS=1
    mkdir -p "$ARTIFACT_DIR"
else
    ARTIFACT_DIR=$(mktemp -d "${TMPDIR:-/tmp}/niyam-docker-smoke.XXXXXX")
fi

compose() {
    if docker compose version >/dev/null 2>&1; then
        docker compose -f "$COMPOSE_FILE" "$@"
        return
    fi

    if command -v docker-compose >/dev/null 2>&1; then
        docker-compose -f "$COMPOSE_FILE" "$@"
        return
    fi

    echo "docker compose is required" >&2
    exit 1
}

cleanup() {
    compose logs --no-color >"$ARTIFACT_DIR/docker-compose.log" 2>&1 || true
    compose down -v >/dev/null 2>&1 || true
    if [[ "$KEEP_ARTIFACTS" != "1" ]]; then
        rm -rf "$ARTIFACT_DIR"
    fi
}

trap cleanup EXIT INT TERM

cd "$ROOT_DIR"

compose up --build -d

for attempt in {1..40}; do
    if curl -sf "http://127.0.0.1:${HOST_PORT}/api/health" >/dev/null 2>&1; then
        break
    fi
    if [[ "$attempt" -eq 40 ]]; then
        echo "Docker smoke failed: container did not become healthy" >&2
        exit 1
    fi
    sleep 2
done

NIYAM_SMOKE_BASE_URL="http://127.0.0.1:${HOST_PORT}" \
NIYAM_SMOKE_WORKING_DIR=/workspace \
NIYAM_SMOKE_ARTIFACT_DIR="$ARTIFACT_DIR/smoke" \
NIYAM_SMOKE_KEEP_ARTIFACTS=1 \
sh "$ROOT_DIR/scripts/smoke.sh"

echo "Docker smoke test passed using artifacts at $ARTIFACT_DIR"
