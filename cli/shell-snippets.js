const fs = require('fs');
const os = require('os');
const path = require('path');

const START_MARKER = '# >>> niyam >>>';
const END_MARKER = '# <<< niyam <<<';

function normalizeShell(shell) {
    const normalized = String(shell || '').trim().toLowerCase();
    if (!['bash', 'zsh'].includes(normalized)) {
        throw new Error('Shell must be zsh or bash');
    }
    return normalized;
}

function getShellRcPath(shell) {
    const normalized = normalizeShell(shell);
    const home = os.homedir();
    return normalized === 'zsh'
        ? path.join(home, '.zshrc')
        : path.join(home, '.bashrc');
}

function renderShellInit(shell, cliBinPath) {
    const normalized = normalizeShell(shell);
    return normalized === 'zsh'
        ? renderZshSnippet(cliBinPath)
        : renderBashSnippet(cliBinPath);
}

function installShellSnippet(shell, cliBinPath) {
    const rcPath = getShellRcPath(shell);
    const snippet = renderShellInit(shell, cliBinPath);
    const next = upsertSnippet(readTextIfExists(rcPath), snippet);
    fs.writeFileSync(rcPath, next, 'utf8');
    return rcPath;
}

function removeShellSnippet(shell) {
    const rcPath = getShellRcPath(shell);
    if (!fs.existsSync(rcPath)) {
        return { rcPath, changed: false };
    }

    const current = fs.readFileSync(rcPath, 'utf8');
    const next = removeSnippet(current);
    if (next === current) {
        return { rcPath, changed: false };
    }

    fs.writeFileSync(rcPath, next, 'utf8');
    return { rcPath, changed: true };
}

function isShellSnippetInstalled(shell) {
    const rcPath = getShellRcPath(shell);
    if (!fs.existsSync(rcPath)) {
        return false;
    }

    const contents = fs.readFileSync(rcPath, 'utf8');
    return contents.includes(START_MARKER) && contents.includes(END_MARKER);
}

function renderZshSnippet(cliBinPath) {
    const quotedBin = shellQuote(cliBinPath);
    return `${START_MARKER}
[[ -o interactive ]] || return 0
export NIYAM_CLI_BIN=${quotedBin}
export NIYAM_INTERCEPT_SESSION_ID="\${NIYAM_INTERCEPT_SESSION_ID:-\${HOST:-shell}-$$}"

niyam-off() {
  command "$NIYAM_CLI_BIN" uninstall --shell zsh || return $?
  exec zsh -l
}

__niyam_zsh_type() {
  local token="$1"
  local desc
  desc="$(whence -w -- "$token" 2>/dev/null)"
  desc="\${desc#*: }"
  case "$desc" in
    *alias*) print alias ;;
    *function*) print function ;;
    *builtin*) print builtin ;;
    *reserved*) print keyword ;;
    *command*|*file*|*hashed*) print external ;;
    *) print unknown ;;
  esac
}

__niyam_zsh_run_local() {
  local raw="$1"
  local dispatch_id="$2"
  local start=\${SECONDS:-0}
  eval "$raw"
  local rc=$?
  local duration=$(( (\${SECONDS:-0} - start) * 1000 ))
  if [[ -n "$dispatch_id" ]]; then
    NIYAM_INTERCEPT_ACTIVE=1 command "$NIYAM_CLI_BIN" report-local-result --dispatch-id "$dispatch_id" --exit-code "$rc" --duration-ms "$duration" >/dev/null 2>&1 || print -u2 -- "niyam-cli: failed to report local result"
  fi
  return $rc
}

__niyam_zsh_begin_command() {
  BUFFER=''
  zle reset-prompt
  print
}

__niyam_accept_line() {
  emulate -L zsh
  local raw="$BUFFER"
  local trimmed="\${raw#"\${raw%%[![:space:]]*}"}"

  if [[ "\${NIYAM_INTERCEPT_ACTIVE:-0}" = "1" ]]; then
    zle .accept-line
    return
  fi

  if [[ -z "\${trimmed//[[:space:]]/}" ]]; then
    zle .accept-line
    return
  fi

  local -a parts
  parts=(\${(z)trimmed})
  local first_token="\${parts[1]}"

  if [[ "\${trimmed[1]}" == "#" || "$first_token" == "niyam-cli" || "$first_token" == "$NIYAM_CLI_BIN" ]]; then
    print -s -- "$raw"
    __niyam_zsh_begin_command
    eval "$raw"
    return $?
  fi

  local first_type="unknown"
  if [[ -n "$first_token" ]]; then
    first_type="$(__niyam_zsh_type "$first_token")"
  fi

  local local_file="\${TMPDIR:-/tmp}/niyam-dispatch.$$.$RANDOM"
  : > "$local_file"
  print -s -- "$raw"
  __niyam_zsh_begin_command
  NIYAM_INTERCEPT_ACTIVE=1 command "$NIYAM_CLI_BIN" dispatch --command "$raw" --shell zsh --session-id "$NIYAM_INTERCEPT_SESSION_ID" --first-token "$first_token" --first-token-type "$first_type" --working-dir "$PWD" --local-output-file "$local_file"
  local rc=$?
  local local_result=''
  if [[ -f "$local_file" ]]; then
    local_result="$(<"$local_file")"
    rm -f "$local_file"
  fi

  case "$rc" in
    85)
      local dispatch_id="\${local_result#dispatch_id=}"
      __niyam_zsh_run_local "$raw" "$dispatch_id"
      return $?
      ;;
    86)
      eval "$raw"
      return $?
      ;;
    *)
      return "$rc"
      ;;
  esac
}

zle -N accept-line __niyam_accept_line
${END_MARKER}
`;
}

function renderBashSnippet(cliBinPath) {
    const quotedBin = shellQuote(cliBinPath);
    return `${START_MARKER}
case $- in
  *i*) ;;
  *) return 0 2>/dev/null || exit 0 ;;
esac
export NIYAM_CLI_BIN=${quotedBin}
export NIYAM_INTERCEPT_SESSION_ID="\${NIYAM_INTERCEPT_SESSION_ID:-\${HOSTNAME:-shell}-$$}"

niyam-off() {
  command "$NIYAM_CLI_BIN" uninstall --shell bash || return $?
  exec bash -l
}

__niyam_bash_first_token() {
  local raw="$1"
  raw="\${raw#"\${raw%%[![:space:]]*}"}"
  printf '%s' "\${raw%%[[:space:];|&<>]*}"
}

__niyam_bash_type() {
  local token="$1"
  local raw_type
  raw_type="$(type -t -- "$token" 2>/dev/null || true)"
  case "$raw_type" in
    file) printf external ;;
    alias) printf alias ;;
    function) printf function ;;
    builtin) printf builtin ;;
    keyword) printf keyword ;;
    *) printf unknown ;;
  esac
}

__niyam_bash_run_local() {
  local raw="$1"
  local dispatch_id="$2"
  local start=$SECONDS
  eval "$raw"
  local rc=$?
  local duration=$(( (SECONDS - start) * 1000 ))
  if [[ -n "$dispatch_id" ]]; then
    NIYAM_INTERCEPT_ACTIVE=1 command "$NIYAM_CLI_BIN" report-local-result --dispatch-id "$dispatch_id" --exit-code "$rc" --duration-ms "$duration" >/dev/null 2>&1 || printf '%s\n' "niyam-cli: failed to report local result" >&2
  fi
  return $rc
}

__niyam_bash_begin_command() {
  READLINE_LINE=
  READLINE_POINT=0
  printf '\n'
}

__niyam_bash_accept_line() {
  local raw="$READLINE_LINE"
  local trimmed="\${raw#"\${raw%%[![:space:]]*}"}"

  if [[ "\${NIYAM_INTERCEPT_ACTIVE:-0}" == "1" ]]; then
    builtin history -s "$raw"
    READLINE_LINE=
    READLINE_POINT=0
    eval "$raw"
    return
  fi

  if [[ -z "\${trimmed//[[:space:]]/}" ]]; then
    READLINE_LINE=
    READLINE_POINT=0
    printf '\n'
    return
  fi

  local first_token
  first_token="$(__niyam_bash_first_token "$trimmed")"

  if [[ "$trimmed" == \#* || "$first_token" == "niyam-cli" || "$first_token" == "$NIYAM_CLI_BIN" ]]; then
    builtin history -s "$raw"
    __niyam_bash_begin_command
    eval "$raw"
    return
  fi

  local first_type="unknown"
  if [[ -n "$first_token" ]]; then
    first_type="$(__niyam_bash_type "$first_token")"
  fi

  local local_file="\${TMPDIR:-/tmp}/niyam-dispatch.$$.$RANDOM"
  : > "$local_file"
  builtin history -s "$raw"
  __niyam_bash_begin_command
  NIYAM_INTERCEPT_ACTIVE=1 command "$NIYAM_CLI_BIN" dispatch --command "$raw" --shell bash --session-id "$NIYAM_INTERCEPT_SESSION_ID" --first-token "$first_token" --first-token-type "$first_type" --working-dir "$PWD" --local-output-file "$local_file"
  local rc=$?
  local local_result=''
  if [[ -f "$local_file" ]]; then
    local_result="$(<"$local_file")"
    rm -f "$local_file"
  fi

  case "$rc" in
    85)
      local dispatch_id="\${local_result#dispatch_id=}"
      __niyam_bash_run_local "$raw" "$dispatch_id"
      return
      ;;
    86)
      eval "$raw"
      return
      ;;
    *)
      return "$rc"
      ;;
  esac
}

bind -x '"\\C-m":"__niyam_bash_accept_line"'
${END_MARKER}
`;
}

function upsertSnippet(current, snippet) {
    const next = removeSnippet(current || '');
    const prefix = next.endsWith('\n') || next.length === 0 ? next : `${next}\n`;
    return `${prefix}${snippet}`;
}

function removeSnippet(current) {
    const input = current || '';
    const pattern = new RegExp(`${escapeRegex(START_MARKER)}[\\s\\S]*?${escapeRegex(END_MARKER)}\\n?`, 'g');
    return input.replace(pattern, '').replace(/\n{3,}/g, '\n\n');
}

function shellQuote(value) {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readTextIfExists(filePath) {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

module.exports = {
    END_MARKER,
    START_MARKER,
    getShellRcPath,
    installShellSnippet,
    isShellSnippetInstalled,
    normalizeShell,
    removeShellSnippet,
    renderShellInit
};
