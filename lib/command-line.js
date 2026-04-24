const DEFAULT_INTERACTIVE_PATTERNS = [
    '^vim(?:\\s|$)',
    '^nvim(?:\\s|$)',
    '^nano(?:\\s|$)',
    '^less(?:\\s|$)',
    '^more(?:\\s|$)',
    '^top(?:\\s|$)',
    '^htop(?:\\s|$)',
    '^man(?:\\s|$)',
    '^watch(?:\\s|$)',
    '^ssh(?:\\s|$)',
    '^sftp(?:\\s|$)',
    '^scp(?:\\s|$)',
    '^tmux(?:\\s|$)',
    '^screen(?:\\s|$)',
    '^sudo(?:\\s|$)',
    '^git\\s+add\\s+-p(?:\\s|$)',
    '^git\\s+rebase\\s+-i(?:\\s|$)'
];

const SHELL_SYNTAX_PATTERNS = [
    /\n/,
    /\|\|/,
    /&&/,
    /[|<>;&]/,
    /\$\(/,
    /`/,
    /\{/,
    /\}/,
    /<<</,
    /<<-/,
    /<<\w/,
    />>/,
    /\(\s*/,
    /\s\)/
];

function tokenizeCommand(commandLine) {
    return tokenizeCommandSpans(commandLine).map(token => token.value);
}

function isNiyamCliInvocation(commandLine) {
    const tokens = tokenizeCommand(commandLine);
    if (tokens.length === 0) {
        return false;
    }

    const firstToken = normalizeCommandToken(tokens[0]);
    if (looksLikeNiyamCliBinary(firstToken)) {
        return true;
    }

    if (looksLikeNodeBinary(firstToken) && tokens.length > 1) {
        return looksLikeNiyamCliScript(normalizeCommandToken(tokens[1]));
    }

    return false;
}

function tokenizeCommandSpans(commandLine) {
    const input = String(commandLine || '').trim();
    const tokens = [];
    let current = '';
    let quote = null;
    let escaping = false;
    let start = -1;

    for (let index = 0; index < input.length; index += 1) {
        const char = input[index];
        if (start === -1 && /\s/.test(char)) {
            continue;
        }

        if (start === -1) {
            start = index;
        }

        if (escaping) {
            current += char;
            escaping = false;
            continue;
        }

        if (char === '\\') {
            escaping = true;
            continue;
        }

        if (quote) {
            if (char === quote) {
                quote = null;
            } else {
                current += char;
            }
            continue;
        }

        if (char === '\'' || char === '"') {
            quote = char;
            continue;
        }

        if (/\s/.test(char)) {
            if (current) {
                tokens.push({ value: current, start, end: index });
                current = '';
                start = -1;
            }
            continue;
        }

        current += char;
    }

    if (current) {
        tokens.push({ value: current, start, end: input.length });
    }

    return tokens;
}

function stripStandaloneFlag(commandLine, flag) {
    let next = String(commandLine || '');
    let found = false;

    while (true) {
        const tokens = tokenizeCommandSpans(next);
        const target = tokens.find(token => token.value === flag);
        if (!target) {
            break;
        }

        found = true;
        let removeStart = target.start;
        let removeEnd = target.end;

        while (removeStart > 0 && /[ \t]/.test(next[removeStart - 1])) {
            removeStart -= 1;
        }

        if (removeStart === target.start) {
            while (removeEnd < next.length && /[ \t]/.test(next[removeEnd])) {
                removeEnd += 1;
            }
        }

        next = `${next.slice(0, removeStart)}${next.slice(removeEnd)}`;
    }

    return {
        found,
        command: next.trim()
    };
}

function hasShellSyntax(commandLine) {
    const input = String(commandLine || '');
    return SHELL_SYNTAX_PATTERNS.some(pattern => pattern.test(input));
}

function isBlankCommand(commandLine) {
    return String(commandLine || '').trim().length === 0;
}

function isCommentOnlyCommand(commandLine) {
    const trimmed = String(commandLine || '').trim();
    return trimmed.startsWith('#');
}

function parseSimpleCommand(commandLine) {
    const tokens = tokenizeCommand(commandLine);
    if (tokens.length === 0) {
        return null;
    }

    return {
        command: tokens[0],
        args: tokens.slice(1)
    };
}

function isLikelyInteractiveCommand(commandLine, patterns = DEFAULT_INTERACTIVE_PATTERNS) {
    const input = String(commandLine || '').trim();
    return patterns.some(pattern => {
        try {
            return new RegExp(pattern, 'i').test(input);
        } catch (error) {
            return false;
        }
    });
}

function normalizeCommandToken(token) {
    return String(token || '').trim().replace(/\\/g, '/');
}

function basenameToken(token) {
    const normalized = normalizeCommandToken(token);
    const parts = normalized.split('/');
    return parts[parts.length - 1] || '';
}

function looksLikeNodeBinary(token) {
    const base = basenameToken(token).toLowerCase();
    return base === 'node' || base === 'node.exe';
}

function looksLikeNiyamCliBinary(token) {
    const base = basenameToken(token).toLowerCase();
    return base === 'niyam-cli' || base === 'niyam-cli.js';
}

function looksLikeNiyamCliScript(token) {
    if (!token) {
        return false;
    }

    const normalized = normalizeCommandToken(token).toLowerCase();
    const base = basenameToken(normalized);
    return base === 'niyam-cli.js'
        || base === 'niyam-cli'
        || normalized.endsWith('/bin/niyam-cli.js')
        || normalized.endsWith('/bin/niyam-cli');
}

module.exports = {
    DEFAULT_INTERACTIVE_PATTERNS,
    hasShellSyntax,
    isBlankCommand,
    isCommentOnlyCommand,
    isNiyamCliInvocation,
    isLikelyInteractiveCommand,
    parseSimpleCommand,
    stripStandaloneFlag,
    tokenizeCommand
};
