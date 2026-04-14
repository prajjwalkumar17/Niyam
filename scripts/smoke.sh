#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/niyam-smoke.XXXXXX")
PORT=${NIYAM_SMOKE_PORT:-3410}
ADMIN_PASSWORD=${NIYAM_SMOKE_ADMIN_PASSWORD:-admin}
METRICS_TOKEN=${NIYAM_SMOKE_METRICS_TOKEN:-metrics-secret}
WRAPPER_TEST=${NIYAM_SMOKE_WRAPPER_TEST:-0}
COOKIE_JAR="$TMP_DIR/cookies.txt"
SERVER_LOG="$TMP_DIR/server.log"
DATA_DIR="$TMP_DIR/data"
SERVER_PID=""

cleanup() {
    if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
        kill "$SERVER_PID" 2>/dev/null || true
        wait "$SERVER_PID" 2>/dev/null || true
    fi
    rm -rf "$TMP_DIR"
}

trap cleanup EXIT INT TERM

mkdir -p "$DATA_DIR"

cd "$ROOT_DIR"

env \
    NIYAM_PORT="$PORT" \
    NIYAM_ADMIN_PASSWORD="$ADMIN_PASSWORD" \
    NIYAM_METRICS_TOKEN="$METRICS_TOKEN" \
    NIYAM_DATA_DIR="$DATA_DIR" \
    NIYAM_EXEC_DEFAULT_MODE=DIRECT \
    NIYAM_EXEC_WRAPPER='["/usr/bin/env"]' \
    node server.js >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!

wait_for_server() {
    attempts=0
    while [ "$attempts" -lt 30 ]; do
        if curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
            return 0
        fi
        attempts=$((attempts + 1))
        sleep 1
    done

    printf 'Smoke test failed: server did not become ready\n' >&2
    cat "$SERVER_LOG" >&2 || true
    exit 1
}

json_field() {
    node -e "const data=JSON.parse(process.argv[1]); const path=process.argv[2].split('.'); let current=data; for (const key of path) current=current?.[key]; if (current === undefined) process.exit(2); if (typeof current === 'object') console.log(JSON.stringify(current)); else console.log(String(current));" "$1" "$2"
}

wait_for_server

health_json=$(curl -sf "http://127.0.0.1:$PORT/api/health")
health_status=$(json_field "$health_json" "status")
[ "$health_status" = "ok" ] || {
    printf 'Smoke test failed: health status was %s\n' "$health_status" >&2
    exit 1
}

login_json=$(curl -sf -c "$COOKIE_JAR" -H 'Content-Type: application/json' \
    -d "{\"username\":\"admin\",\"password\":\"$ADMIN_PASSWORD\"}" \
    "http://127.0.0.1:$PORT/api/auth/login")
login_auth=$(json_field "$login_json" "authenticated")
[ "$login_auth" = "true" ] || {
    printf 'Smoke test failed: login did not authenticate\n' >&2
    exit 1
}

me_json=$(curl -sf -b "$COOKIE_JAR" "http://127.0.0.1:$PORT/api/auth/me")
principal_id=$(json_field "$me_json" "principal.identifier")
[ "$principal_id" = "admin" ] || {
    printf 'Smoke test failed: authenticated principal was %s\n' "$principal_id" >&2
    exit 1
}

metrics_output=$(curl -sf -H "Authorization: Bearer $METRICS_TOKEN" \
    "http://127.0.0.1:$PORT/api/metrics")
printf '%s\n' "$metrics_output" | grep -q 'niyam_http_requests_total' || {
    printf 'Smoke test failed: metrics endpoint missing request counter\n' >&2
    exit 1
}

expected_execution_mode=DIRECT

if [ "$WRAPPER_TEST" = "1" ]; then
    curl -sf -b "$COOKIE_JAR" -H 'Content-Type: application/json' \
        -d '{"name":"Smoke Wrapper Rule","description":"Wrap ls public during smoke test","rule_type":"execution_mode","pattern":"^ls\\s+public$","execution_mode":"WRAPPER","priority":500}' \
        "http://127.0.0.1:$PORT/api/rules" >/dev/null
    expected_execution_mode=WRAPPER
fi

command_json=$(curl -sf -b "$COOKIE_JAR" -H 'Content-Type: application/json' \
    -d "{\"command\":\"ls\",\"args\":[\"public\"],\"workingDir\":\"$ROOT_DIR\"}" \
    "http://127.0.0.1:$PORT/api/commands")
command_id=$(json_field "$command_json" "id")

attempts=0
final_json=''
while [ "$attempts" -lt 20 ]; do
    final_json=$(curl -sf -b "$COOKIE_JAR" "http://127.0.0.1:$PORT/api/commands/$command_id")
    command_status=$(json_field "$final_json" "status")
    if [ "$command_status" = "completed" ]; then
        break
    fi
    if [ "$command_status" = "failed" ] || [ "$command_status" = "rejected" ] || [ "$command_status" = "timeout" ]; then
        printf 'Smoke test failed: command reached terminal status %s\n' "$command_status" >&2
        printf '%s\n' "$final_json" >&2
        exit 1
    fi
    attempts=$((attempts + 1))
    sleep 1
done

command_status=$(json_field "$final_json" "status")
[ "$command_status" = "completed" ] || {
    printf 'Smoke test failed: command did not complete\n' >&2
    printf '%s\n' "$final_json" >&2
    exit 1
}

execution_mode=$(json_field "$final_json" "execution_mode")
[ "$execution_mode" = "$expected_execution_mode" ] || {
    printf 'Smoke test failed: execution mode was %s, expected %s\n' "$execution_mode" "$expected_execution_mode" >&2
    printf '%s\n' "$final_json" >&2
    exit 1
}

exit_code=$(json_field "$final_json" "exit_code")
[ "$exit_code" = "0" ] || {
    printf 'Smoke test failed: exit code was %s\n' "$exit_code" >&2
    printf '%s\n' "$final_json" >&2
    exit 1
}

command_output=$(json_field "$final_json" "output")
printf '%s\n' "$command_output" | grep -q 'index.html' || {
    printf 'Smoke test failed: command output did not include expected file\n' >&2
    printf '%s\n' "$final_json" >&2
    exit 1
}

if [ "$WRAPPER_TEST" = "1" ]; then
    printf 'Wrapper smoke test passed on port %s\n' "$PORT"
else
    printf 'Smoke test passed on port %s\n' "$PORT"
fi
