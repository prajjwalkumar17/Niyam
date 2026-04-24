#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
PORT=${NIYAM_SMOKE_PORT:-3410}
ADMIN_PASSWORD=${NIYAM_SMOKE_ADMIN_PASSWORD:-admin}
METRICS_TOKEN=${NIYAM_SMOKE_METRICS_TOKEN:-metrics-secret}
EXEC_DATA_KEY=${NIYAM_SMOKE_EXEC_DATA_KEY:-smoke-test-key}
WRAPPER_TEST=${NIYAM_SMOKE_WRAPPER_TEST:-0}
BASE_URL=${NIYAM_SMOKE_BASE_URL:-"http://127.0.0.1:$PORT"}
WORKING_DIR=${NIYAM_SMOKE_WORKING_DIR:-$ROOT_DIR}
EXTERNAL_SERVER=0
KEEP_ARTIFACTS=${NIYAM_SMOKE_KEEP_ARTIFACTS:-0}
SERVER_PID=""
RAW_SECRET='ghp_abcdefghijklmnopqrstuvwxyz1234567890ABCDE'

if [ -n "${NIYAM_SMOKE_BASE_URL:-}" ]; then
    EXTERNAL_SERVER=1
fi

if [ -n "${NIYAM_SMOKE_ARTIFACT_DIR:-}" ]; then
    TMP_DIR=${NIYAM_SMOKE_ARTIFACT_DIR}
    KEEP_ARTIFACTS=1
    mkdir -p "$TMP_DIR"
else
    TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/niyam-smoke.XXXXXX")
fi

COOKIE_JAR="$TMP_DIR/cookies.txt"
SERVER_LOG="$TMP_DIR/server.log"
DATA_DIR="$TMP_DIR/data"
SERVER_PID=""

cleanup() {
    if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
        kill "$SERVER_PID" 2>/dev/null || true
        wait "$SERVER_PID" 2>/dev/null || true
    fi
    if [ "$KEEP_ARTIFACTS" != "1" ]; then
        rm -rf "$TMP_DIR"
    fi
}

trap cleanup EXIT INT TERM

mkdir -p "$DATA_DIR"

cd "$ROOT_DIR"

if [ "$EXTERNAL_SERVER" != "1" ]; then
    env \
        NIYAM_PORT="$PORT" \
        NIYAM_ADMIN_PASSWORD="$ADMIN_PASSWORD" \
        NIYAM_METRICS_TOKEN="$METRICS_TOKEN" \
        NIYAM_DATA_DIR="$DATA_DIR" \
        NIYAM_EXEC_DEFAULT_MODE=DIRECT \
        NIYAM_EXEC_WRAPPER='["/usr/bin/env"]' \
        NIYAM_EXEC_DATA_KEY="$EXEC_DATA_KEY" \
        node server.js >"$SERVER_LOG" 2>&1 &
    SERVER_PID=$!
fi

wait_for_server() {
    attempts=0
    while [ "$attempts" -lt 30 ]; do
        if curl -sf "$BASE_URL/api/health" >/dev/null 2>&1; then
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

health_json=$(curl -sf "$BASE_URL/api/health")
health_status=$(json_field "$health_json" "status")
[ "$health_status" = "ok" ] || {
    printf 'Smoke test failed: health status was %s\n' "$health_status" >&2
    exit 1
}

login_json=$(curl -sf -c "$COOKIE_JAR" -H 'Content-Type: application/json' \
    -d "{\"username\":\"admin\",\"password\":\"$ADMIN_PASSWORD\"}" \
    "$BASE_URL/api/auth/login")
login_auth=$(json_field "$login_json" "authenticated")
[ "$login_auth" = "true" ] || {
    printf 'Smoke test failed: login did not authenticate\n' >&2
    exit 1
}

me_json=$(curl -sf -b "$COOKIE_JAR" "$BASE_URL/api/auth/me")
principal_id=$(json_field "$me_json" "principal.identifier")
[ "$principal_id" = "admin" ] || {
    printf 'Smoke test failed: authenticated principal was %s\n' "$principal_id" >&2
    exit 1
}

managed_token_json=$(curl -sf -b "$COOKIE_JAR" -H 'Content-Type: application/json' \
    -d '{"label":"Smoke CLI","subjectType":"standalone","principalIdentifier":"smoke-cli"}' \
    "$BASE_URL/api/tokens")
MANAGED_TOKEN=$(json_field "$managed_token_json" "plainTextToken")

metrics_output=$(curl -sf -H "Authorization: Bearer $METRICS_TOKEN" \
    "$BASE_URL/api/metrics")
printf '%s\n' "$metrics_output" | grep -q 'niyam_http_requests_total' || {
    printf 'Smoke test failed: metrics endpoint missing request counter\n' >&2
    exit 1
}

simulation_json=$(curl -sf -b "$COOKIE_JAR" -H 'Content-Type: application/json' \
    -d '{"command":"ls","args":["public"]}' \
    "$BASE_URL/api/policy/simulate")
simulation_allowed=$(json_field "$simulation_json" "allowed")
[ "$simulation_allowed" = "true" ] || {
    printf 'Smoke test failed: policy simulation did not allow ls public\n' >&2
    printf '%s\n' "$simulation_json" >&2
    exit 1
}

expected_execution_mode=DIRECT

if [ "$WRAPPER_TEST" = "1" ]; then
    curl -sf -b "$COOKIE_JAR" -H 'Content-Type: application/json' \
        -d '{"name":"Smoke Wrapper Rule","description":"Wrap ls public during smoke test","rule_type":"execution_mode","pattern":"^ls\\s+public$","execution_mode":"WRAPPER","priority":500}' \
        "$BASE_URL/api/rules" >/dev/null
    expected_execution_mode=WRAPPER
fi

pack_list_json=$(curl -sf -b "$COOKIE_JAR" "$BASE_URL/api/rule-packs")
printf '%s\n' "$pack_list_json" | grep -q '"id":"gh"' || {
    printf 'Smoke test failed: built-in rule packs endpoint missing gh pack\n' >&2
    exit 1
}

pack_install_json=$(curl -sf -b "$COOKIE_JAR" -H 'Content-Type: application/json' \
    -d '{"mode":"install_if_missing"}' \
    "$BASE_URL/api/rule-packs/gh/install")
printf '%s\n' "$pack_install_json" | grep -q '"inserted"' || {
    printf 'Smoke test failed: rule pack install did not return inserted summary\n' >&2
    printf '%s\n' "$pack_install_json" >&2
    exit 1
}

gh_simulation_json=$(curl -sf -b "$COOKIE_JAR" -H 'Content-Type: application/json' \
    -d '{"command":"gh","args":["workflow","run","build.yml"]}' \
    "$BASE_URL/api/policy/simulate")
gh_simulation_risk=$(json_field "$gh_simulation_json" "riskLevel")
[ "$gh_simulation_risk" = "HIGH" ] || {
    printf 'Smoke test failed: gh workflow run was %s instead of HIGH\n' "$gh_simulation_risk" >&2
    printf '%s\n' "$gh_simulation_json" >&2
    exit 1
}
gh_simulation_mode=$(json_field "$gh_simulation_json" "executionMode")
[ "$gh_simulation_mode" = "WRAPPER" ] || {
    printf 'Smoke test failed: gh workflow run execution mode was %s instead of WRAPPER\n' "$gh_simulation_mode" >&2
    printf '%s\n' "$gh_simulation_json" >&2
    exit 1
}

command_json=$(curl -sf -b "$COOKIE_JAR" -H 'Content-Type: application/json' \
    -d "{\"command\":\"ls\",\"args\":[\"public\"],\"workingDir\":\"$WORKING_DIR\"}" \
    "$BASE_URL/api/commands")
command_id=$(json_field "$command_json" "id")

attempts=0
final_json=''
while [ "$attempts" -lt 20 ]; do
    final_json=$(curl -sf -b "$COOKIE_JAR" "$BASE_URL/api/commands/$command_id")
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

redaction_command_json=$(curl -sf -H "Authorization: Bearer $MANAGED_TOKEN" -H 'Content-Type: application/json' \
    -d "{\"command\":\"printf\",\"args\":[\"$RAW_SECRET\"]}" \
    "$BASE_URL/api/commands")
redaction_command_id=$(json_field "$redaction_command_json" "id")
printf '%s\n' "$redaction_command_json" | grep -q '\[REDACTED\]' || {
    printf 'Smoke test failed: redacted command response did not mask secret args\n' >&2
    printf '%s\n' "$redaction_command_json" >&2
    exit 1
}
printf '%s\n' "$redaction_command_json" | grep -q "$RAW_SECRET" && {
    printf 'Smoke test failed: raw secret leaked in redacted command response\n' >&2
    printf '%s\n' "$redaction_command_json" >&2
    exit 1
}

curl -sf -b "$COOKIE_JAR" -H 'Content-Type: application/json' \
    -d '{"rationale":"smoke test approval"}' \
    "$BASE_URL/api/approvals/$redaction_command_id/approve" >/dev/null

attempts=0
redaction_final_json=''
while [ "$attempts" -lt 20 ]; do
    redaction_final_json=$(curl -sf -b "$COOKIE_JAR" "$BASE_URL/api/commands/$redaction_command_id")
    redaction_status=$(json_field "$redaction_final_json" "status")
    if [ "$redaction_status" = "completed" ]; then
        break
    fi
    if [ "$redaction_status" = "failed" ] || [ "$redaction_status" = "rejected" ] || [ "$redaction_status" = "timeout" ]; then
        printf 'Smoke test failed: redaction command reached terminal status %s\n' "$redaction_status" >&2
        printf '%s\n' "$redaction_final_json" >&2
        exit 1
    fi
    attempts=$((attempts + 1))
    sleep 1
done

printf '%s\n' "$redaction_final_json" | grep -q '\[REDACTED\]' || {
    printf 'Smoke test failed: redacted execution output did not mask secret\n' >&2
    printf '%s\n' "$redaction_final_json" >&2
    exit 1
}
printf '%s\n' "$redaction_final_json" | grep -q "$RAW_SECRET" && {
    printf 'Smoke test failed: raw secret leaked in command history\n' >&2
    printf '%s\n' "$redaction_final_json" >&2
    exit 1
}

audit_json=$(curl -sf -b "$COOKIE_JAR" "$BASE_URL/api/audit?limit=20")
printf '%s\n' "$audit_json" | grep -q "$RAW_SECRET" && {
    printf 'Smoke test failed: raw secret leaked in audit log\n' >&2
    printf '%s\n' "$audit_json" >&2
    exit 1
}

if [ "$WRAPPER_TEST" = "1" ]; then
    printf 'Wrapper smoke test passed at %s\n' "$BASE_URL"
else
    printf 'Smoke test passed at %s\n' "$BASE_URL"
fi
