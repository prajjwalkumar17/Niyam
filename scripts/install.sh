#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
ACTION=${1:-render}

SERVICE_NAME=${NIYAM_SERVICE_NAME:-niyam}
RUN_USER=${NIYAM_RUN_USER:-niyam}
RUN_GROUP=${NIYAM_RUN_GROUP:-$RUN_USER}
INSTALL_DIR=${NIYAM_INSTALL_DIR:-/opt/niyam}
DATA_DIR=${NIYAM_DATA_DIR:-/var/lib/niyam}
PORT=${NIYAM_PORT:-3200}
DOMAIN=${NIYAM_DOMAIN:-niyam.example.com}
NODE_BIN=${NIYAM_NODE_BIN:-/usr/bin/node}
ADMIN_PASSWORD=${NIYAM_ADMIN_PASSWORD:-change-me}
EXEC_ALLOWED_ROOTS=${NIYAM_EXEC_ALLOWED_ROOTS:-/srv/repos,/opt/niyam}
RENDER_DIR=${NIYAM_RENDER_DIR:-"$ROOT_DIR/.deploy"}

render_template() {
    template_path=$1
    output_path=$2
    mkdir -p "$(dirname "$output_path")"
    sed \
        -e "s#__SERVICE_NAME__#${SERVICE_NAME}#g" \
        -e "s#__RUN_USER__#${RUN_USER}#g" \
        -e "s#__RUN_GROUP__#${RUN_GROUP}#g" \
        -e "s#__INSTALL_DIR__#${INSTALL_DIR}#g" \
        -e "s#__DATA_DIR__#${DATA_DIR}#g" \
        -e "s#__PORT__#${PORT}#g" \
        -e "s#__DOMAIN__#${DOMAIN}#g" \
        -e "s#__NODE_BIN__#${NODE_BIN}#g" \
        -e "s#__ADMIN_PASSWORD__#${ADMIN_PASSWORD}#g" \
        -e "s#__EXEC_ALLOWED_ROOTS__#${EXEC_ALLOWED_ROOTS}#g" \
        "$template_path" > "$output_path"
}

render_all() {
    mkdir -p "$RENDER_DIR"
    render_template "$ROOT_DIR/deploy/niyam.service.template" "$RENDER_DIR/${SERVICE_NAME}.service"
    render_template "$ROOT_DIR/deploy/Caddyfile.template" "$RENDER_DIR/Caddyfile"
    cp "$ROOT_DIR/deploy/niyam.env.example" "$RENDER_DIR/niyam.env"
}

install_app() {
    mkdir -p "$INSTALL_DIR" "$DATA_DIR"
    tar \
        --exclude=.git \
        --exclude=node_modules \
        --exclude=.dist \
        --exclude=.deploy \
        --exclude='data/*.db' \
        --exclude='data/*.db-shm' \
        --exclude='data/*.db-wal' \
        -cf - -C "$ROOT_DIR" . | tar -xf - -C "$INSTALL_DIR"
    cp "$ROOT_DIR/deploy/niyam.env.example" "$INSTALL_DIR/.env.production"
}

case "$ACTION" in
    render)
        render_all
        printf 'Rendered deploy files to %s\n' "$RENDER_DIR"
        ;;
    install)
        install_app
        render_all
        printf 'Installed app into %s\n' "$INSTALL_DIR"
        printf 'Rendered deploy files to %s\n' "$RENDER_DIR"
        printf 'Next: npm ci --omit=dev --prefix %s\n' "$INSTALL_DIR"
        ;;
    *)
        printf 'Usage: %s [render|install]\n' "$0" >&2
        exit 1
        ;;
esac
