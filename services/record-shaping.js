function shapeCommandRecord(record) {
    const shaped = { ...record };
    shaped.args = parseJson(shaped.args, []);
    shaped.metadata = parseJson(shaped.metadata, {});
    shaped.redaction_summary = parseJson(shaped.redaction_summary, {});
    shaped.redacted = Boolean(shaped.redacted);
    delete shaped.exec_command;
    delete shaped.exec_args;
    delete shaped.exec_metadata;
    return shaped;
}

function shapeCliDispatchRecord(record) {
    const shaped = { ...record };
    shaped.metadata = parseJson(shaped.metadata, {});
    shaped.redaction_summary = parseJson(shaped.redaction_summary, {});
    shaped.redacted = Boolean(shaped.redacted);
    shaped.has_shell_syntax = Boolean(shaped.has_shell_syntax);
    shaped.interactive_hint = Boolean(shaped.interactive_hint);
    delete shaped.exec_command;
    return shaped;
}

function parseJson(value, fallback) {
    if (value === null || value === undefined || value === '') {
        return fallback;
    }

    try {
        return JSON.parse(value);
    } catch (error) {
        return fallback;
    }
}

module.exports = {
    parseJson,
    shapeCliDispatchRecord,
    shapeCommandRecord
};
