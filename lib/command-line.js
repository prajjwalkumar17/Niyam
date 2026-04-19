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
    const input = String(commandLine || '').trim();
    const tokens = [];
    let current = '';
    let quote = null;
    let escaping = false;

    for (const char of input) {
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
                tokens.push(current);
                current = '';
            }
            continue;
        }

        current += char;
    }

    if (current) {
        tokens.push(current);
    }

    return tokens;
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

module.exports = {
    DEFAULT_INTERACTIVE_PATTERNS,
    hasShellSyntax,
    isBlankCommand,
    isCommentOnlyCommand,
    isLikelyInteractiveCommand,
    parseSimpleCommand,
    tokenizeCommand
};
