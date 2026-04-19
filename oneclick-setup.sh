#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)

PROFILE=""
ENV_FILE=""
PORT=""
ADMIN_USERNAME="admin"
ADMIN_PASSWORD=""
AGENT_TOKEN=""
EXEC_DATA_KEY=""
METRICS_TOKEN=""
DATA_DIR=""
DB_PATH=""
ALLOWED_ORIGINS=""
EXEC_ALLOWED_ROOTS=""
EXEC_DEFAULT_MODE=""
EXEC_WRAPPER=""
BACKUP_DIR=""
INSTALL_DIR=""
DOMAIN=""
RUN_USER=""
RUN_GROUP=""
SHOULD_START="n"
SHOULD_RENDER="n"
SHOULD_STAGE="n"
BACKUP_PASSPHRASE=""
REUSE_EXISTING_ENV="n"
START_ONLY="n"

bold() {
    printf '\033[1m%s\033[0m\n' "$1"
}

info() {
    printf '[niyam-setup] %s\n' "$1"
}

warn() {
    printf '[niyam-setup] %s\n' "$1" >&2
}

require_command() {
    if ! command -v "$1" >/dev/null 2>&1; then
        printf 'Missing required command: %s\n' "$1" >&2
        exit 1
    fi
}

random_secret() {
    if command -v openssl >/dev/null 2>&1; then
        openssl rand -hex 24
        return
    fi

    node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
}

timestamp_for_path() {
    date '+%Y-%m-%dT%H-%M-%S'
}

listening_pids_on_port() {
    local port=$1

    if command -v lsof >/dev/null 2>&1; then
        lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | sort -u
        return
    fi

    if command -v ss >/dev/null 2>&1; then
        ss -ltnp 2>/dev/null | awk -v port=":$port" '$4 ~ port { if (match($0, /pid=([0-9]+)/, m)) print m[1]; }' | sort -u
        return
    fi

    printf ''
}

port_is_available() {
    local port=$1
    node -e "const net = require('net'); const server = net.createServer(); server.once('error', () => process.exit(1)); server.once('listening', () => server.close(() => process.exit(0))); server.listen(${port});"
}

ensure_port_available() {
    local port=$1

    if port_is_available "$port"; then
        return 0
    fi

    local pids
    pids=$(listening_pids_on_port "$port")

    if [[ -n "$pids" ]]; then
        local pid_summary
        pid_summary=$(printf '%s' "$pids" | paste -sd ',' -)
        warn "Port $port is already in use by PID(s) $pid_summary"
        if [[ "$(prompt_yes_no "Terminate listener(s) on port $port and continue?" "n")" == "y" ]]; then
            terminate_port_listeners "$port" "$pids"
            if port_is_available "$port"; then
                info "Freed port $port"
                return 0
            fi
            warn "Port $port is still busy after termination attempts"
            return 1
        fi
    else
        warn "Port $port is already in use"
    fi

    return 1
}

terminate_port_listeners() {
    local port=$1
    local pids=$2
    local pid
    local attempt

    for pid in $pids; do
        kill "$pid" 2>/dev/null || true
    done

    for attempt in 1 2 3 4 5; do
        sleep 1
        if port_is_available "$port"; then
            return 0
        fi
    done

    local remaining
    remaining=$(listening_pids_on_port "$port")
    if [[ -n "$remaining" ]]; then
        warn "Escalating to SIGKILL for PID(s) $(printf '%s' "$remaining" | paste -sd ',' -)"
        for pid in $remaining; do
            kill -9 "$pid" 2>/dev/null || true
        done
        sleep 1
    fi

    port_is_available "$port"
}

prompt_with_default() {
    local prompt=$1
    local default_value=$2
    local answer
    if [[ -n "$default_value" ]]; then
        read -r -p "$prompt [$default_value]: " answer || true
        printf '%s' "${answer:-$default_value}"
        return
    fi

    read -r -p "$prompt: " answer || true
    printf '%s' "$answer"
}

prompt_secret() {
    local prompt=$1
    local default_value=$2
    local answer
    if [[ -n "$default_value" ]]; then
        read -r -s -p "$prompt [press Enter to keep generated value]: " answer || true
        printf '\n' >&2
        printf '%s' "${answer:-$default_value}"
        return
    fi

    read -r -s -p "$prompt: " answer || true
    printf '\n' >&2
    printf '%s' "$answer"
}

prompt_yes_no() {
    local prompt=$1
    local default_value=${2:-y}
    local answer
    local suffix="[Y/n]"
    if [[ "$default_value" == "n" ]]; then
        suffix="[y/N]"
    fi

    read -r -p "$prompt $suffix: " answer || true
    answer=${answer:-$default_value}
    case "$(printf '%s' "$answer" | tr '[:upper:]' '[:lower:]')" in
        y|yes) printf 'y' ;;
        n|no) printf 'n' ;;
        *) printf '%s' "$default_value" ;;
    esac
}

shell_quote() {
    local value=$1
    value=${value//\'/\'\"\'\"\'}
    printf "'%s'" "$value"
}

normalize_exec_mode() {
    local mode
    mode=$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]')
    case "$mode" in
        DIRECT|WRAPPER)
            printf '%s' "$mode"
            ;;
        *)
            warn "Invalid execution mode: $1"
            exit 1
            ;;
    esac
}

load_existing_env() {
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +a

    PORT=${NIYAM_PORT:-$PORT}
    ADMIN_USERNAME=${NIYAM_ADMIN_USERNAME:-$ADMIN_USERNAME}
    DATA_DIR=${NIYAM_DATA_DIR:-$DATA_DIR}
    DB_PATH=${NIYAM_DB:-$DB_PATH}
    ALLOWED_ORIGINS=${NIYAM_ALLOWED_ORIGINS:-$ALLOWED_ORIGINS}
    EXEC_ALLOWED_ROOTS=${NIYAM_EXEC_ALLOWED_ROOTS:-$EXEC_ALLOWED_ROOTS}
    EXEC_DEFAULT_MODE=${NIYAM_EXEC_DEFAULT_MODE:-$EXEC_DEFAULT_MODE}
    EXEC_WRAPPER=${NIYAM_EXEC_WRAPPER:-$EXEC_WRAPPER}
    BACKUP_DIR=${NIYAM_BACKUP_DIR:-$BACKUP_DIR}
    ADMIN_PASSWORD=${NIYAM_ADMIN_PASSWORD:-$ADMIN_PASSWORD}
    EXEC_DATA_KEY=${NIYAM_EXEC_DATA_KEY:-$EXEC_DATA_KEY}
    METRICS_TOKEN=${NIYAM_METRICS_TOKEN:-$METRICS_TOKEN}
}

print_dashboard_access() {
    printf 'Dashboard access:\n'
    printf '  URL: http://localhost:%s\n' "$PORT"
    printf '  Username: %s\n' "$ADMIN_USERNAME"
    if [[ -n "$ADMIN_PASSWORD" ]]; then
        printf '  Password: %s\n' "$ADMIN_PASSWORD"
    fi
    printf '  Password source: %s (NIYAM_ADMIN_PASSWORD)\n' "$ENV_FILE"
    printf '\n'
}

default_cli_base_url() {
    if [[ -n "${DOMAIN:-}" ]]; then
        printf 'https://%s' "$DOMAIN"
    else
        printf 'http://127.0.0.1:%s' "$PORT"
    fi
}

default_agent_token() {
    if [[ -n "${AGENT_TOKEN:-}" ]]; then
        printf '%s' "$AGENT_TOKEN"
        return
    fi

    if [[ -z "${NIYAM_AGENT_TOKENS:-}" ]]; then
        return
    fi

    node -e 'const raw = process.argv[1] || "{}"; const parsed = JSON.parse(raw); process.stdout.write(String(parsed["niyam-agent"] || Object.values(parsed)[0] || ""));' "$NIYAM_AGENT_TOKENS"
}

print_cli_wrapper_instructions() {
    local base_url token
    base_url=$(default_cli_base_url)
    token=$(default_agent_token)

    printf 'To enable the CLI wrapper in another terminal:\n'
    if [[ -f "$ENV_FILE" ]]; then
        printf '  set -a; source %s; set +a\n' "$ENV_FILE"
    fi
    printf '  export NIYAM_CLI_BASE_URL=%s\n' "$(shell_quote "$base_url")"
    printf '  export NIYAM_CLI_REQUESTER=niyam-agent\n'
    if [[ -n "$token" ]]; then
        printf '  export NIYAM_AGENT_TOKEN=%s\n' "$(shell_quote "$token")"
    else
        printf '  export NIYAM_AGENT_TOKEN=<niyam-agent bearer token>\n'
    fi
    printf '  node %s/bin/niyam-cli.js install --shell zsh\n' "$ROOT_DIR"
    printf '  source ~/.zshrc\n'
}

print_local_notes() {
    bold "Local setup notes"
    printf '  - Admin password: dashboard sign-in credential\n'
    printf '  - Agent token: bearer token for agent/API submissions\n'
    printf '  - Execution data key: encrypts stored raw execution payloads in SQLite\n'
    printf '  - Metrics token: protects /api/metrics\n'
    printf '  - Wrapper JSON array: command prefix used only when policy resolves WRAPPER\n'
    printf '\n'
}

print_selfhost_notes() {
    bold "Self-hosted setup notes"
    printf '  - Admin password: dashboard operator login\n'
    printf '  - Agent token: bearer token for the default "niyam-agent" agent\n'
    printf '  - Execution data key: must stay stable for pending encrypted command payloads\n'
    printf '  - Metrics token: protects Prometheus-style metrics access\n'
    printf '  - Wrapper JSON array: isolation command used when rules force WRAPPER\n'
    printf '\n'
}

write_env_file() {
    local target=$1
    mkdir -p "$(dirname "$target")"

    cat > "$target" <<EOF
NODE_ENV=$(shell_quote "$( [[ "$PROFILE" == "local" ]] && printf 'development' || printf 'production' )")
NIYAM_PORT=$(shell_quote "$PORT")
NIYAM_ADMIN_USERNAME=admin
NIYAM_ADMIN_IDENTIFIER=admin
NIYAM_ADMIN_PASSWORD=$(shell_quote "$ADMIN_PASSWORD")
NIYAM_DATA_DIR=$(shell_quote "$DATA_DIR")
NIYAM_DB=$(shell_quote "$DB_PATH")
NIYAM_ALLOWED_ORIGINS=$(shell_quote "$ALLOWED_ORIGINS")
NIYAM_AGENT_TOKENS=$(shell_quote "{\"niyam-agent\":\"$AGENT_TOKEN\"}")
NIYAM_SESSION_TTL_HOURS=12
NIYAM_SESSION_CLEANUP_INTERVAL_MS=300000
NIYAM_LOG_LEVEL=info
NIYAM_METRICS_TOKEN=$(shell_quote "$METRICS_TOKEN")
NIYAM_ALERT_WEBHOOK_URL=
NIYAM_ALERT_MIN_SEVERITY=error
NIYAM_ALERT_EVENTS=command_failed,command_timeout,command_rejected,high_risk_submission
NIYAM_ALERT_TIMEOUT_MS=5000
NIYAM_EXEC_TIMEOUT_MS=30000
NIYAM_EXEC_OUTPUT_LIMIT_BYTES=1048576
NIYAM_EXEC_ALLOWED_ROOTS=$(shell_quote "$EXEC_ALLOWED_ROOTS")
NIYAM_EXEC_REQUIRE_ALLOWED_ROOT=true
NIYAM_EXEC_DEFAULT_MODE=$(shell_quote "$EXEC_DEFAULT_MODE")
NIYAM_EXEC_WRAPPER=$(shell_quote "$EXEC_WRAPPER")
NIYAM_EXEC_DATA_KEY=$(shell_quote "$EXEC_DATA_KEY")
NIYAM_EXEC_ENV_ALLOWLIST=GIT_ASKPASS,GIT_SSH_COMMAND
NIYAM_BACKUP_DIR=$(shell_quote "$BACKUP_DIR")
NIYAM_BACKUP_RETENTION_DAYS=14
NIYAM_BACKUP_COMPRESS=true
NIYAM_BACKUP_ENCRYPT=false
NIYAM_BACKUP_PASSPHRASE_FILE=$(shell_quote "$DATA_DIR/backup-passphrase")
NIYAM_REDACTION_ENABLED=true
NIYAM_REDACTION_REPLACEMENT=[REDACTED]
NIYAM_REDACTION_EXTRA_KEYS=token,password,secret,api_key
NIYAM_REDACTION_DISABLE_HEURISTICS=false
EOF

    if [[ "$PROFILE" == "local" ]]; then
        cat >> "$target" <<EOF
NIYAM_CLI_BASE_URL=$(shell_quote "http://127.0.0.1:$PORT")
NIYAM_CLI_REQUESTER=niyam-agent
EOF
    fi
}

run_npm_install() {
    info "Installing npm dependencies"
    if npm install; then
        return
    fi

    warn "npm install failed; retrying better-sqlite3 build-from-source"
    npm install better-sqlite3@^12.9.0 --build-from-source
}

initialize_database() {
    info "Initializing database at $DB_PATH"
    (
        set -a
        # shellcheck disable=SC1090
        source "$ENV_FILE"
        set +a
        npm run init-db
    )
}

start_server() {
    if ! ensure_port_available "$PORT"; then
        warn "Skipping automatic start"
        return
    fi

    info "Starting Niyam with $ENV_FILE"
    info "Dashboard will be available at http://localhost:$PORT"
    print_dashboard_access
    (
        set -a
        # shellcheck disable=SC1090
        source "$ENV_FILE"
        set +a
        npm start
    )
}

start_server_with_logs() {
    local log_dir=$1
    mkdir -p "$log_dir"
    local log_file="$log_dir/niyam-$(timestamp_for_path).log"

    if [[ -z "$PORT" ]]; then
        load_existing_env
    fi

    if ! ensure_port_available "$PORT"; then
        warn "Cannot start another server"
        exit 1
    fi

    info "Starting Niyam from $ENV_FILE"
    info "Streaming logs to terminal and $log_file"
    print_dashboard_access
    print_cli_wrapper_instructions
    (
        set -a
        # shellcheck disable=SC1090
        source "$ENV_FILE"
        set +a
        npm start 2>&1 | tee -a "$log_file"
    )
}

render_deploy_files() {
    info "Rendering deployment artifacts"
    (
        export NIYAM_PORT="$PORT"
        export NIYAM_DATA_DIR="$DATA_DIR"
        export NIYAM_INSTALL_DIR="$INSTALL_DIR"
        export NIYAM_RUN_USER="$RUN_USER"
        export NIYAM_RUN_GROUP="$RUN_GROUP"
        export NIYAM_DOMAIN="$DOMAIN"
        export NIYAM_ADMIN_PASSWORD="$ADMIN_PASSWORD"
        export NIYAM_EXEC_ALLOWED_ROOTS="$EXEC_ALLOWED_ROOTS"
        sh "$ROOT_DIR/scripts/install.sh" render
    )

    cp "$ENV_FILE" "$ROOT_DIR/.deploy/niyam.env"
}

stage_install() {
    info "Staging app into $INSTALL_DIR"
    (
        export NIYAM_PORT="$PORT"
        export NIYAM_DATA_DIR="$DATA_DIR"
        export NIYAM_INSTALL_DIR="$INSTALL_DIR"
        export NIYAM_RUN_USER="$RUN_USER"
        export NIYAM_RUN_GROUP="$RUN_GROUP"
        export NIYAM_DOMAIN="$DOMAIN"
        export NIYAM_ADMIN_PASSWORD="$ADMIN_PASSWORD"
        export NIYAM_EXEC_ALLOWED_ROOTS="$EXEC_ALLOWED_ROOTS"
        sh "$ROOT_DIR/scripts/install.sh" install
    )
}

print_summary() {
    bold "Setup complete"
    printf '\n'
    printf 'Profile: %s\n' "$PROFILE"
    printf 'Env file: %s\n' "$ENV_FILE"
    printf 'Port: %s\n' "$PORT"
    printf 'Data dir: %s\n' "$DATA_DIR"
    printf 'Allowed roots: %s\n' "$EXEC_ALLOWED_ROOTS"
    printf 'Execution mode: %s\n' "$EXEC_DEFAULT_MODE"
    printf '\n'
    print_dashboard_access

    if [[ "$PROFILE" == "local" ]]; then
        printf 'To start later:\n'
        printf '  set -a; source %s; set +a; npm start\n' "$ENV_FILE"
        printf '\n'
        print_cli_wrapper_instructions
    else
        printf 'Deploy artifacts:\n'
        printf '  .deploy/niyam.env\n'
        printf '  .deploy/niyam.service\n'
        printf '  .deploy/niyam-backup.service\n'
        printf '  .deploy/niyam-backup.timer\n'
        printf '  .deploy/Caddyfile\n'
        printf '\n'
        print_cli_wrapper_instructions
    fi
}

select_profile() {
    bold "Niyam one-click setup"
    printf '1. Local development\n'
    printf '2. Self-hosted prep\n'
    printf '3. Start existing server env and stream logs\n'
    printf '\n'

    local answer
    answer=$(prompt_with_default "Choose a setup profile" "1")
    case "$answer" in
        1|local|Local) PROFILE="local" ;;
        2|selfhost|self-hosted|prod|production) PROFILE="selfhost" ;;
        3|start|run|logs)
            PROFILE="start"
            START_ONLY="y"
            ;;
        *)
            warn "Unknown profile: $answer"
            exit 1
            ;;
    esac
}

configure_start_only() {
    bold "Start existing env"
    printf '  - This mode skips setup and just boots Niyam from an existing env file\n'
    printf '  - Logs stream to the terminal and are written under .local/logs\n'
    printf '\n'

    ENV_FILE=$(prompt_with_default "Env file to use" "$ROOT_DIR/.env.local")
    if [[ ! -f "$ENV_FILE" ]]; then
        warn "Env file not found: $ENV_FILE"
        exit 1
    fi

    DATA_DIR="$ROOT_DIR/.local/niyam"
    load_existing_env
}

configure_local() {
    local generated_admin generated_agent generated_exec generated_metrics
    generated_admin=$(random_secret)
    generated_agent=$(random_secret)
    generated_exec=$(random_secret)
    generated_metrics=$(random_secret)

    print_local_notes

    PORT=$(prompt_with_default "Port" "3000")
    DATA_DIR=$(prompt_with_default "Local data directory" "$ROOT_DIR/.local/niyam")
    DB_PATH="$DATA_DIR/niyam.db"
    ALLOWED_ORIGINS=$(prompt_with_default "Allowed browser origins" "http://localhost:$PORT")
    EXEC_ALLOWED_ROOTS=$(prompt_with_default "Execution allowed roots" "$ROOT_DIR")
    EXEC_DEFAULT_MODE=$(normalize_exec_mode "$(prompt_with_default "Default execution mode (DIRECT or WRAPPER)" "DIRECT")")
    if [[ "$EXEC_DEFAULT_MODE" == "WRAPPER" ]]; then
        EXEC_WRAPPER=$(prompt_with_default "Wrapper JSON array" '["/usr/bin/env"]')
    else
        EXEC_WRAPPER=$(prompt_with_default "Wrapper JSON array for rule-driven WRAPPER tests" '["/usr/bin/env"]')
    fi
    BACKUP_DIR=$(prompt_with_default "Backup directory" "$DATA_DIR/backups")
    ADMIN_PASSWORD=$(prompt_secret "Admin password (dashboard login)" "$generated_admin")
    AGENT_TOKEN=$(prompt_secret "Agent token for \"niyam-agent\" (Bearer token)" "$generated_agent")
    EXEC_DATA_KEY=$(prompt_secret "Execution data key (encrypts stored raw command payloads)" "$generated_exec")
    METRICS_TOKEN=$(prompt_secret "Metrics token (/api/metrics access)" "$generated_metrics")
    ENV_FILE="$ROOT_DIR/.env.local"
    SHOULD_START=$(prompt_yes_no "Start the server when setup finishes?" "y")
}

configure_selfhost() {
    local generated_admin generated_agent generated_exec generated_metrics
    generated_admin=$(random_secret)
    generated_agent=$(random_secret)
    generated_exec=$(random_secret)
    generated_metrics=$(random_secret)

    print_selfhost_notes

    PORT=$(prompt_with_default "Service port" "3200")
    INSTALL_DIR=$(prompt_with_default "Install directory" "/opt/niyam")
    DATA_DIR=$(prompt_with_default "Runtime data directory" "/var/lib/niyam")
    DB_PATH="$DATA_DIR/niyam.db"
    DOMAIN=$(prompt_with_default "Public domain" "niyam.example.com")
    ALLOWED_ORIGINS=$(prompt_with_default "Allowed browser origins" "https://$DOMAIN")
    RUN_USER=$(prompt_with_default "systemd run user" "niyam")
    RUN_GROUP=$(prompt_with_default "systemd run group" "$RUN_USER")
    EXEC_ALLOWED_ROOTS=$(prompt_with_default "Execution allowed roots" "/srv/repos,$INSTALL_DIR")
    EXEC_DEFAULT_MODE=$(normalize_exec_mode "$(prompt_with_default "Default execution mode (DIRECT or WRAPPER)" "DIRECT")")
    if [[ "$EXEC_DEFAULT_MODE" == "WRAPPER" ]]; then
        EXEC_WRAPPER=$(prompt_with_default "Wrapper JSON array" '["bwrap","--unshare-all","--"]')
    else
        EXEC_WRAPPER=$(prompt_with_default "Wrapper JSON array for rule-driven wrapping" '[]')
    fi
    BACKUP_DIR=$(prompt_with_default "Backup directory" "/var/backups/niyam")
    ADMIN_PASSWORD=$(prompt_secret "Admin password (dashboard login)" "$generated_admin")
    AGENT_TOKEN=$(prompt_secret "Agent token for \"niyam-agent\" (Bearer token)" "$generated_agent")
    EXEC_DATA_KEY=$(prompt_secret "Execution data key (encrypts stored raw command payloads)" "$generated_exec")
    METRICS_TOKEN=$(prompt_secret "Metrics token (/api/metrics access)" "$generated_metrics")
    ENV_FILE="$ROOT_DIR/.deploy/niyam.env"
    SHOULD_RENDER=$(prompt_yes_no "Render deploy files into .deploy?" "y")
    SHOULD_STAGE=$(prompt_yes_no "Stage an install into $INSTALL_DIR now?" "n")
}

main() {
    require_command node
    require_command npm

    cd "$ROOT_DIR"
    select_profile

    if [[ "$PROFILE" == "local" ]]; then
        configure_local
    elif [[ "$PROFILE" == "start" ]]; then
        configure_start_only
    else
        configure_selfhost
    fi

    if [[ "$START_ONLY" == "y" ]]; then
        start_server_with_logs "$ROOT_DIR/.local/logs"
        exit 0
    fi

    if [[ -f "$ENV_FILE" ]]; then
        if [[ "$(prompt_yes_no "Env file $ENV_FILE already exists. Overwrite it?" "n")" != "y" ]]; then
            if [[ "$(prompt_yes_no "Reuse existing env file and continue?" "y")" == "y" ]]; then
                REUSE_EXISTING_ENV="y"
                load_existing_env
                info "Reusing existing env file at $ENV_FILE"
            else
                warn "Aborted without changing $ENV_FILE"
                exit 1
            fi
        fi
    fi

    if [[ "$REUSE_EXISTING_ENV" != "y" ]]; then
        write_env_file "$ENV_FILE"
    fi
    mkdir -p "$DATA_DIR" "$BACKUP_DIR"
    if [[ ! -f "$DATA_DIR/backup-passphrase" ]]; then
        BACKUP_PASSPHRASE=$(random_secret)
        printf '%s\n' "$BACKUP_PASSPHRASE" > "$DATA_DIR/backup-passphrase"
    fi

    run_npm_install
    initialize_database

    if [[ "$PROFILE" == "selfhost" && "$SHOULD_RENDER" == "y" ]]; then
        render_deploy_files
    fi

    if [[ "$PROFILE" == "selfhost" && "$SHOULD_STAGE" == "y" ]]; then
        stage_install
    fi

    print_summary

    if [[ "$PROFILE" == "local" && "$SHOULD_START" == "y" ]]; then
        printf '\n'
        start_server
    fi
}

main "$@"
