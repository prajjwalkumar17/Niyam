#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)

PROFILE=""
ENV_FILE=""
PORT=""
ADMIN_USERNAME="admin"
ADMIN_PASSWORD=""
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
PRODUCT_MODE="individual"
TEAM_MODE="n"
STANDALONE_TOKEN_LABELS=""
BOOTSTRAP_TOKENS_JSON=""
ENV_OVERWRITTEN="n"
RENDER_DIR="${NIYAM_SETUP_RENDER_DIR:-$ROOT_DIR/.deploy}"
LOG_DIR="${NIYAM_SETUP_LOG_DIR:-$ROOT_DIR/.local/logs}"

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
    COLOR_RESET=$'\033[0m'
    COLOR_BOLD=$'\033[1m'
    COLOR_DIM=$'\033[2m'
    COLOR_CYAN=$'\033[36m'
    COLOR_GREEN=$'\033[32m'
    COLOR_YELLOW=$'\033[33m'
    COLOR_MAGENTA=$'\033[35m'
else
    COLOR_RESET=""
    COLOR_BOLD=""
    COLOR_DIM=""
    COLOR_CYAN=""
    COLOR_GREEN=""
    COLOR_YELLOW=""
    COLOR_MAGENTA=""
fi

bold() {
    printf '%s%s%s\n' "$COLOR_BOLD" "$1" "$COLOR_RESET"
}

section() {
    printf '%s%s%s%s\n' "$COLOR_BOLD" "$COLOR_CYAN" "$1" "$COLOR_RESET"
}

print_setting() {
    local label=$1
    local value=$2
    local tone=${3:-}
    local color=""

    case "$tone" in
        url) color=$COLOR_CYAN ;;
        secret|warning) color=$COLOR_YELLOW ;;
        command|success) color=$COLOR_GREEN ;;
        accent) color=$COLOR_MAGENTA ;;
        path) color=$COLOR_DIM ;;
    esac

    printf '%s%s:%s %s%s%s\n' "$COLOR_BOLD" "$label" "$COLOR_RESET" "$color" "$value" "$COLOR_RESET"
}

print_command() {
    printf '  %s%s%s\n' "$COLOR_GREEN" "$1" "$COLOR_RESET"
}

info() {
    printf '%s[niyam-setup]%s %s\n' "$COLOR_CYAN" "$COLOR_RESET" "$1"
}

warn() {
    printf '%s[niyam-setup]%s %s\n' "$COLOR_YELLOW" "$COLOR_RESET" "$1" >&2
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

is_noninteractive() {
    [[ "$(env_flag_to_yes_no "${NIYAM_SETUP_NONINTERACTIVE:-}")" == "y" ]]
}

prompt_or_value() {
    local prompt=$1
    local default_value=$2
    local env_value=${3:-}

    if [[ -n "$env_value" ]]; then
        printf '%s' "$env_value"
        return
    fi

    if is_noninteractive; then
        printf '%s' "$default_value"
        return
    fi

    prompt_with_default "$prompt" "$default_value"
}

secret_or_value() {
    local prompt=$1
    local default_value=$2
    local env_value=${3:-}

    if [[ -n "$env_value" ]]; then
        printf '%s' "$env_value"
        return
    fi

    if is_noninteractive; then
        printf '%s' "$default_value"
        return
    fi

    prompt_secret "$prompt" "$default_value"
}

yes_no_or_value() {
    local prompt=$1
    local default_value=${2:-y}
    local env_value=${3:-}

    if [[ -n "$env_value" ]]; then
        env_flag_to_yes_no "$env_value"
        return
    fi

    if is_noninteractive; then
        printf '%s' "$default_value"
        return
    fi

    prompt_yes_no "$prompt" "$default_value"
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

env_flag_to_yes_no() {
    case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
        1|true|yes|on) printf 'y' ;;
        *) printf 'n' ;;
    esac
}

team_mode_env_value() {
    if [[ "$TEAM_MODE" == "y" ]]; then
        printf 'true'
    else
        printf 'false'
    fi
}

product_mode_env_value() {
    printf '%s' "$PRODUCT_MODE"
}

prompt_product_mode_setting() {
    local default_value
    default_value=${1:-individual}

    if [[ -n "${NIYAM_SETUP_PRODUCT_MODE:-}" ]]; then
        local env_answer
        env_answer=$(printf '%s' "$NIYAM_SETUP_PRODUCT_MODE" | tr '[:upper:]' '[:lower:]' | xargs)
        case "$env_answer" in
            individual|teams)
                PRODUCT_MODE=$env_answer
                return
                ;;
            *)
                warn "Invalid NIYAM_SETUP_PRODUCT_MODE: $NIYAM_SETUP_PRODUCT_MODE"
                exit 1
                ;;
        esac
    fi

    if is_noninteractive; then
        PRODUCT_MODE=$default_value
        return
    fi

    while true; do
        local answer
        answer=$(prompt_with_default "Product mode (individual or teams)" "$default_value")
        answer=$(printf '%s' "$answer" | tr '[:upper:]' '[:lower:]' | xargs)
        case "$answer" in
            individual|teams)
                PRODUCT_MODE=$answer
                return
                ;;
            *)
                warn "Choose either individual or teams"
                ;;
        esac
    done
}

prompt_team_mode_setting() {
    if [[ "$PRODUCT_MODE" == "teams" ]]; then
        if [[ -n "${NIYAM_SETUP_ENABLE_SELF_SIGNUP:-}" ]]; then
            TEAM_MODE=$(env_flag_to_yes_no "$NIYAM_SETUP_ENABLE_SELF_SIGNUP")
        elif is_noninteractive; then
            TEAM_MODE=${1:-n}
        else
            TEAM_MODE=$(prompt_yes_no "Enable self-signup requests?" "${1:-n}")
        fi
    else
        TEAM_MODE="n"
    fi
}

apply_team_mode_to_env_file() {
    local target=$1
    local temp_file
    temp_file=$(mktemp)

    awk -v value="$(team_mode_env_value)" '
        BEGIN { updated = 0 }
        /^NIYAM_ENABLE_SELF_SIGNUP=/ {
            print "NIYAM_ENABLE_SELF_SIGNUP=" value
            updated = 1
            next
        }
        { print }
        END {
            if (!updated) {
                print "NIYAM_ENABLE_SELF_SIGNUP=" value
            }
        }
    ' "$target" > "$temp_file"

    mv "$temp_file" "$target"
}

apply_product_mode_to_env_file() {
    local target=$1
    local temp_file
    temp_file=$(mktemp)

    awk -v value="$(product_mode_env_value)" '
        BEGIN { updated = 0 }
        /^NIYAM_PRODUCT_MODE=/ {
            print "NIYAM_PRODUCT_MODE=" value
            updated = 1
            next
        }
        { print }
        END {
            if (!updated) {
                print "NIYAM_PRODUCT_MODE=" value
            }
        }
    ' "$target" > "$temp_file"

    mv "$temp_file" "$target"
}

csv_has_label() {
    local csv=$1
    local label=$2
    awk -v target="$label" -F',' '{
        for (i = 1; i <= NF; i++) {
            gsub(/^[[:space:]]+|[[:space:]]+$/, "", $i)
            if ($i == target) {
                found = 1
            }
        }
    } END { exit(found ? 0 : 1) }' <<< "$csv"
}

append_csv_label() {
    local csv=$1
    local label=$2
    if [[ -z "$(printf '%s' "$csv" | tr -d '[:space:]')" ]]; then
        printf '%s' "$label"
    else
        printf '%s, %s' "$csv" "$label"
    fi
}

sync_runtime_metadata_to_env_file() {
    local target=$1
    local temp_file
    temp_file=$(mktemp)

    awk -v profile="$PROFILE" -v env_file="$target" '
        BEGIN { profile_updated = 0; env_updated = 0 }
        /^NIYAM_PROFILE=/ {
            print "NIYAM_PROFILE=" profile
            profile_updated = 1
            next
        }
        /^NIYAM_ENV_FILE=/ {
            print "NIYAM_ENV_FILE='\''" env_file "'\''"
            env_updated = 1
            next
        }
        { print }
        END {
            if (!profile_updated) {
                print "NIYAM_PROFILE=" profile
            }
            if (!env_updated) {
                print "NIYAM_ENV_FILE='\''" env_file "'\''"
            }
        }
    ' "$target" > "$temp_file"

    mv "$temp_file" "$target"
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
    PRODUCT_MODE=${NIYAM_PRODUCT_MODE:-}
    TEAM_MODE=$(env_flag_to_yes_no "${NIYAM_ENABLE_SELF_SIGNUP:-}")
    if [[ -z "$PRODUCT_MODE" ]]; then
        if [[ "$TEAM_MODE" == "y" ]]; then
            PRODUCT_MODE="teams"
        else
            PRODUCT_MODE="individual"
        fi
    fi
}

print_dashboard_access() {
    section "Dashboard access"
    print_setting "URL" "http://localhost:$PORT" "url"
    print_setting "Username" "$ADMIN_USERNAME" "accent"
    print_setting "Product mode" "$PRODUCT_MODE" "accent"
    if [[ "$PRODUCT_MODE" == "teams" && "$TEAM_MODE" == "y" ]]; then
        print_setting "Team signup" "enabled (self-signup requests require admin approval)" "success"
    elif [[ "$PRODUCT_MODE" == "teams" ]]; then
        print_setting "Team signup" "disabled (admin-created users only)" "warning"
    else
        print_setting "Team signup" "disabled in individual mode" "warning"
    fi
    if [[ -n "$ADMIN_PASSWORD" ]]; then
        print_setting "Password" "$ADMIN_PASSWORD" "secret"
    fi
    print_setting "Password source" "$ENV_FILE (NIYAM_ADMIN_PASSWORD)" "path"
    printf '\n'
}

print_cli_wrapper_instructions() {
    section "To enable the CLI wrapper in another terminal"
    print_command "cd $ROOT_DIR"
    print_command "npm run cli:install"
    print_command "source ~/.zshrc"
    printf '\n'
    section "Quick toggle commands after install"
    print_command "niyam-off"
    print_command "niyam-on"
    printf '\n'
    section "To open a pre-authenticated local shell later"
    printf '  %sCreate a CLI token in the dashboard and use the Open Local Shell action shown after token creation.%s\n' "$COLOR_CYAN" "$COLOR_RESET"
    printf '\n'
    section "To fully uninstall the CLI wrapper later"
    print_command "cd $ROOT_DIR"
    print_command "npm run cli:remove"
    print_command "source ~/.zshrc"
    printf '\n'
    section "To remove the CLI wrapper from the current shell only"
    print_command "niyam-off"
}

suggest_shared_base_url() {
    local first_origin

    if [[ -n "$ALLOWED_ORIGINS" ]]; then
        first_origin=${ALLOWED_ORIGINS%%,*}
        first_origin=$(printf '%s' "$first_origin" | xargs)
        case "$first_origin" in
            http://127.0.0.1:*|http://localhost:*|https://127.0.0.1:*|https://localhost:*)
                ;;
            http://*|https://*)
                printf '%s' "$first_origin"
                return
                ;;
        esac
    fi

    if [[ -n "$DOMAIN" ]]; then
        printf 'https://%s' "$DOMAIN"
        return
    fi

    printf 'http://<server-host>:%s' "$PORT"
}

print_multi_machine_wrapper_instructions() {
    local shared_base_url
    shared_base_url=$(suggest_shared_base_url)

    section "For other developer machines using this same Niyam server"
    printf '  - Niyam must be reachable over the network; %slocalhost%s only works on this machine.\n' "$COLOR_YELLOW" "$COLOR_RESET"
    printf '  - On each developer machine, in that machine'"'"'s Niyam checkout:\n'
    print_command "export NIYAM_CLI_BASE_URL=$(shell_quote "$shared_base_url")"
    print_command "npm run cli:install"
    print_command "source ~/.zshrc"
    if [[ "$PRODUCT_MODE" == "teams" ]]; then
        print_command "niyam-cli login --username <user> --password <password>"
        printf '  - Commands from that shell will then appear in this dashboard as that signed-in user.\n'
    else
        print_command "niyam-cli login --token <managed-token>"
        printf '  - Commands from that shell will then appear in this dashboard as the configured standalone CLI identity.\n'
    fi
    printf '\n'
}

print_local_notes() {
    section "Local setup notes"
    printf '  - Admin password: dashboard sign-in credential\n'
    printf '  - Managed tokens: preferred for CLI identities in individual mode and optional per-user CLIs in teams mode\n'
    printf '  - Execution data key: encrypts stored raw execution payloads in SQLite\n'
    printf '  - Metrics token: protects /api/metrics\n'
    printf '  - Wrapper JSON array: command prefix used only when policy resolves WRAPPER\n'
    printf '\n'
}

print_selfhost_notes() {
    section "Self-hosted setup notes"
    printf '  - Admin password: dashboard operator login\n'
    printf '  - Managed tokens: preferred for named CLI identities and per-user CLIs\n'
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
NIYAM_PROFILE=$(shell_quote "$PROFILE")
NIYAM_ENV_FILE=$(shell_quote "$target")
NIYAM_PORT=$(shell_quote "$PORT")
NIYAM_ADMIN_USERNAME=admin
NIYAM_ADMIN_IDENTIFIER=admin
NIYAM_ADMIN_PASSWORD=$(shell_quote "$ADMIN_PASSWORD")
NIYAM_PRODUCT_MODE=$(shell_quote "$PRODUCT_MODE")
NIYAM_DATA_DIR=$(shell_quote "$DATA_DIR")
NIYAM_DB=$(shell_quote "$DB_PATH")
NIYAM_ALLOWED_ORIGINS=$(shell_quote "$ALLOWED_ORIGINS")
NIYAM_ENABLE_SELF_SIGNUP=$(team_mode_env_value)
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
EOF
    fi
}

run_npm_install() {
    if [[ "$(env_flag_to_yes_no "${NIYAM_SETUP_SKIP_NPM_INSTALL:-}")" == "y" ]]; then
        info "Skipping npm install because NIYAM_SETUP_SKIP_NPM_INSTALL is enabled"
        return
    fi

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
        export NIYAM_PROFILE="$PROFILE"
        export NIYAM_ENV_FILE="$ENV_FILE"
        # shellcheck disable=SC1090
        source "$ENV_FILE"
        set +a
        npm run init-db
    )
}

reset_database_for_overwrite() {
    local db_dir
    db_dir=$(dirname "$DB_PATH")
    mkdir -p "$db_dir"

    info "Overwrite selected; clearing existing database state at $DB_PATH"
    rm -f "$DB_PATH" "$DB_PATH-shm" "$DB_PATH-wal"
}

bootstrap_managed_tokens() {
    if [[ "$PRODUCT_MODE" != "individual" ]]; then
        BOOTSTRAP_TOKENS_JSON=""
        return
    fi

    if [[ -z "$(printf '%s' "$STANDALONE_TOKEN_LABELS" | tr -d '[:space:]')" ]]; then
        BOOTSTRAP_TOKENS_JSON=""
        return
    fi

    info "Bootstrapping standalone managed tokens"
    BOOTSTRAP_TOKENS_JSON=$(
        set -a
        export NIYAM_PROFILE="$PROFILE"
        export NIYAM_ENV_FILE="$ENV_FILE"
        # shellcheck disable=SC1090
        source "$ENV_FILE"
        set +a
        node scripts/bootstrap_managed_tokens.js --labels "$STANDALONE_TOKEN_LABELS" --created-by oneclick
    )
}

print_bootstrap_tokens() {
    if [[ -z "$BOOTSTRAP_TOKENS_JSON" ]]; then
        return
    fi

    section "Managed standalone tokens"
    BOOTSTRAP_TOKENS_JSON="$BOOTSTRAP_TOKENS_JSON" \
    COLOR_SECRET="$COLOR_YELLOW" \
    COLOR_COMMAND="$COLOR_GREEN" \
    COLOR_RESET="$COLOR_RESET" \
    node <<'EOF'
const payload = JSON.parse(process.env.BOOTSTRAP_TOKENS_JSON || '{"tokens":[]}');
const secret = process.env.COLOR_SECRET || '';
const command = process.env.COLOR_COMMAND || '';
const reset = process.env.COLOR_RESET || '';
for (const token of payload.tokens || []) {
    console.log(`  ${token.label}: ${secret}${token.plainTextToken}${reset}`);
    console.log(`  ${command}niyam-cli login --token '${token.plainTextToken}'${reset}`);
}
EOF
    printf '\n'
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
        export NIYAM_PROFILE="$PROFILE"
        export NIYAM_ENV_FILE="$ENV_FILE"
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
    print_multi_machine_wrapper_instructions
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
        export NIYAM_RENDER_DIR="$RENDER_DIR"
        sh "$ROOT_DIR/scripts/install.sh" render
    )

    mkdir -p "$RENDER_DIR"
    cp "$ENV_FILE" "$RENDER_DIR/niyam.env"
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
        export NIYAM_RENDER_DIR="$RENDER_DIR"
        sh "$ROOT_DIR/scripts/install.sh" install
    )
}

print_summary() {
    bold "Setup complete"
    printf '\n'
    print_setting "Profile" "$PROFILE" "accent"
    print_setting "Env file" "$ENV_FILE" "path"
    print_setting "Port" "$PORT" "accent"
    print_setting "Data dir" "$DATA_DIR" "path"
    print_setting "Allowed roots" "$EXEC_ALLOWED_ROOTS" "path"
    print_setting "Execution mode" "$EXEC_DEFAULT_MODE" "accent"
    print_setting "Product mode" "$PRODUCT_MODE" "accent"
    if [[ "$TEAM_MODE" == "y" ]]; then
        print_setting "Team signup" "enabled" "success"
    else
        print_setting "Team signup" "disabled" "warning"
    fi
    printf '\n'
    print_dashboard_access
    print_bootstrap_tokens

    if [[ "$PROFILE" == "local" ]]; then
        section "To start later"
        print_command "set -a; source $ENV_FILE; set +a; npm start"
        printf '\n'
        print_cli_wrapper_instructions
        print_multi_machine_wrapper_instructions
    else
        section "Deploy artifacts"
        printf '  %s%s/niyam.env%s\n' "$COLOR_DIM" "$RENDER_DIR" "$COLOR_RESET"
        printf '  %s%s/%s.service%s\n' "$COLOR_DIM" "$RENDER_DIR" "${NIYAM_SERVICE_NAME:-niyam}" "$COLOR_RESET"
        printf '  %s%s/%s-backup.service%s\n' "$COLOR_DIM" "$RENDER_DIR" "${NIYAM_SERVICE_NAME:-niyam}" "$COLOR_RESET"
        printf '  %s%s/%s-backup.timer%s\n' "$COLOR_DIM" "$RENDER_DIR" "${NIYAM_SERVICE_NAME:-niyam}" "$COLOR_RESET"
        printf '  %s%s/Caddyfile%s\n' "$COLOR_DIM" "$RENDER_DIR" "$COLOR_RESET"
        printf '\n'
        print_cli_wrapper_instructions
        print_multi_machine_wrapper_instructions
    fi

    if [[ "$PRODUCT_MODE" == "teams" ]]; then
        section "Teams next steps"
        printf '  - Admin creates users from the dashboard\n'
        printf '  - Admin can create an initial token for a user if needed\n'
        printf '  - Each user can later create and block their own CLI tokens from Workspace > My CLI Tokens\n'
        printf '\n'
    fi
}

select_profile() {
    bold "Niyam one-click setup"
    printf '1. Local development (single-user or team mode)\n'
    printf '2. Self-hosted prep (single-user or team mode)\n'
    printf '3. Start existing server env and stream logs (single-user or team mode)\n'
    printf '\n'

    local answer
    answer=$(prompt_or_value "Choose a setup profile" "1" "${NIYAM_SETUP_PROFILE:-}")
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

    ENV_FILE=$(prompt_or_value "Env file to use" "$ROOT_DIR/.env.local" "${NIYAM_SETUP_ENV_FILE:-}")
    if [[ ! -f "$ENV_FILE" ]]; then
        warn "Env file not found: $ENV_FILE"
        exit 1
    fi

    DATA_DIR="$ROOT_DIR/.local/niyam"
    load_existing_env
}

configure_local() {
    local generated_admin generated_exec generated_metrics
    generated_admin=$(random_secret)
    generated_exec=$(random_secret)
    generated_metrics=$(random_secret)

    print_local_notes

    ENV_FILE=$(prompt_or_value "Env file" "$ROOT_DIR/.env.local" "${NIYAM_SETUP_ENV_FILE:-}")
    PORT=$(prompt_or_value "Port" "3000" "${NIYAM_SETUP_PORT:-}")
    DATA_DIR=$(prompt_or_value "Local data directory" "$ROOT_DIR/.local/niyam" "${NIYAM_SETUP_DATA_DIR:-}")
    DB_PATH=${NIYAM_SETUP_DB_PATH:-"$DATA_DIR/niyam.db"}
    ALLOWED_ORIGINS=$(prompt_or_value "Allowed browser origins" "http://localhost:$PORT" "${NIYAM_SETUP_ALLOWED_ORIGINS:-}")
    EXEC_ALLOWED_ROOTS=$(prompt_or_value "Execution allowed roots" "$HOME" "${NIYAM_SETUP_EXEC_ALLOWED_ROOTS:-}")
    EXEC_DEFAULT_MODE=$(normalize_exec_mode "$(prompt_or_value "Default execution mode (DIRECT or WRAPPER)" "DIRECT" "${NIYAM_SETUP_EXEC_DEFAULT_MODE:-}")")
    if [[ "$EXEC_DEFAULT_MODE" == "WRAPPER" ]]; then
        EXEC_WRAPPER=$(prompt_or_value "Wrapper JSON array" '["/usr/bin/env"]' "${NIYAM_SETUP_EXEC_WRAPPER:-}")
    else
        EXEC_WRAPPER=$(prompt_or_value "Wrapper JSON array for rule-driven WRAPPER tests" '["/usr/bin/env"]' "${NIYAM_SETUP_EXEC_WRAPPER:-}")
    fi
    BACKUP_DIR=$(prompt_or_value "Backup directory" "$DATA_DIR/backups" "${NIYAM_SETUP_BACKUP_DIR:-}")
    ADMIN_PASSWORD=$(secret_or_value "Admin password (dashboard login)" "$generated_admin" "${NIYAM_SETUP_ADMIN_PASSWORD:-}")
    EXEC_DATA_KEY=$(secret_or_value "Execution data key (encrypts stored raw command payloads)" "$generated_exec" "${NIYAM_SETUP_EXEC_DATA_KEY:-}")
    METRICS_TOKEN=$(secret_or_value "Metrics token (/api/metrics access)" "$generated_metrics" "${NIYAM_SETUP_METRICS_TOKEN:-}")
    SHOULD_START=$(yes_no_or_value "Start the server when setup finishes?" "y" "${NIYAM_SETUP_START:-}")
}

configure_selfhost() {
    local generated_admin generated_exec generated_metrics
    generated_admin=$(random_secret)
    generated_exec=$(random_secret)
    generated_metrics=$(random_secret)

    print_selfhost_notes

    ENV_FILE=$(prompt_or_value "Env file" "$ROOT_DIR/.deploy/niyam.env" "${NIYAM_SETUP_ENV_FILE:-}")
    PORT=$(prompt_or_value "Service port" "3200" "${NIYAM_SETUP_PORT:-}")
    INSTALL_DIR=$(prompt_or_value "Install directory" "/opt/niyam" "${NIYAM_SETUP_INSTALL_DIR:-}")
    DATA_DIR=$(prompt_or_value "Runtime data directory" "/var/lib/niyam" "${NIYAM_SETUP_DATA_DIR:-}")
    DB_PATH=${NIYAM_SETUP_DB_PATH:-"$DATA_DIR/niyam.db"}
    DOMAIN=$(prompt_or_value "Public domain" "niyam.example.com" "${NIYAM_SETUP_DOMAIN:-}")
    ALLOWED_ORIGINS=$(prompt_or_value "Allowed browser origins" "https://$DOMAIN" "${NIYAM_SETUP_ALLOWED_ORIGINS:-}")
    RUN_USER=$(prompt_or_value "systemd run user" "niyam" "${NIYAM_SETUP_RUN_USER:-}")
    RUN_GROUP=$(prompt_or_value "systemd run group" "$RUN_USER" "${NIYAM_SETUP_RUN_GROUP:-}")
    EXEC_ALLOWED_ROOTS=$(prompt_or_value "Execution allowed roots" "/srv/repos,$INSTALL_DIR" "${NIYAM_SETUP_EXEC_ALLOWED_ROOTS:-}")
    EXEC_DEFAULT_MODE=$(normalize_exec_mode "$(prompt_or_value "Default execution mode (DIRECT or WRAPPER)" "DIRECT" "${NIYAM_SETUP_EXEC_DEFAULT_MODE:-}")")
    if [[ "$EXEC_DEFAULT_MODE" == "WRAPPER" ]]; then
        EXEC_WRAPPER=$(prompt_or_value "Wrapper JSON array" '["bwrap","--unshare-all","--"]' "${NIYAM_SETUP_EXEC_WRAPPER:-}")
    else
        EXEC_WRAPPER=$(prompt_or_value "Wrapper JSON array for rule-driven wrapping" '[]' "${NIYAM_SETUP_EXEC_WRAPPER:-}")
    fi
    BACKUP_DIR=$(prompt_or_value "Backup directory" "/var/backups/niyam" "${NIYAM_SETUP_BACKUP_DIR:-}")
    ADMIN_PASSWORD=$(secret_or_value "Admin password (dashboard login)" "$generated_admin" "${NIYAM_SETUP_ADMIN_PASSWORD:-}")
    EXEC_DATA_KEY=$(secret_or_value "Execution data key (encrypts stored raw command payloads)" "$generated_exec" "${NIYAM_SETUP_EXEC_DATA_KEY:-}")
    METRICS_TOKEN=$(secret_or_value "Metrics token (/api/metrics access)" "$generated_metrics" "${NIYAM_SETUP_METRICS_TOKEN:-}")
    SHOULD_RENDER=$(yes_no_or_value "Render deploy files into .deploy?" "y" "${NIYAM_SETUP_RENDER:-}")
    SHOULD_STAGE=$(yes_no_or_value "Stage an install into $INSTALL_DIR now?" "n" "${NIYAM_SETUP_STAGE:-}")
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
        start_server_with_logs "$LOG_DIR"
        exit 0
    fi

    if [[ -f "$ENV_FILE" ]]; then
        if [[ "$(yes_no_or_value "Env file $ENV_FILE already exists. Overwrite it?" "y" "${NIYAM_SETUP_OVERWRITE_ENV:-}")" != "y" ]]; then
            if [[ "$(yes_no_or_value "Reuse existing env file and continue?" "y" "${NIYAM_SETUP_REUSE_ENV:-}")" == "y" ]]; then
                REUSE_EXISTING_ENV="y"
                load_existing_env
                info "Reusing existing env file at $ENV_FILE"
            else
                warn "Aborted without changing $ENV_FILE"
                exit 1
            fi
        else
            ENV_OVERWRITTEN="y"
        fi
    fi

    prompt_product_mode_setting "$PRODUCT_MODE"
    prompt_team_mode_setting "$TEAM_MODE"

    if [[ "$REUSE_EXISTING_ENV" != "y" ]]; then
        write_env_file "$ENV_FILE"
    else
        apply_team_mode_to_env_file "$ENV_FILE"
    fi
    apply_product_mode_to_env_file "$ENV_FILE"
    sync_runtime_metadata_to_env_file "$ENV_FILE"
    mkdir -p "$DATA_DIR" "$BACKUP_DIR"
    if [[ ! -f "$DATA_DIR/backup-passphrase" ]]; then
        BACKUP_PASSPHRASE=$(random_secret)
        printf '%s\n' "$BACKUP_PASSPHRASE" > "$DATA_DIR/backup-passphrase"
    fi

    run_npm_install
    if [[ "$ENV_OVERWRITTEN" == "y" ]]; then
        reset_database_for_overwrite
    fi
    initialize_database
    bootstrap_managed_tokens

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
