-- Niyam Database Schema
-- CLI Command Governance System

-- Commands table: stores submitted commands awaiting execution
CREATE TABLE IF NOT EXISTS commands (
    id TEXT PRIMARY KEY,
    command TEXT NOT NULL,
    args TEXT,                    -- JSON array of arguments
    requester TEXT NOT NULL,      -- Agent or user who submitted
    requester_type TEXT DEFAULT 'agent', -- 'agent' or 'user'
    risk_level TEXT NOT NULL,     -- 'HIGH', 'MEDIUM', 'LOW'
    status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'rejected', 'executing', 'completed', 'failed', 'timeout'
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    timeout_at TEXT,              -- When approval window expires
    approval_count INTEGER DEFAULT 0,
    required_approvals INTEGER DEFAULT 1,
    rationale_required INTEGER DEFAULT 0,
    output TEXT,                  -- Command output after execution
    error TEXT,                   -- Error message if failed
    exit_code INTEGER,
    executed_at TEXT,
    metadata TEXT                 -- JSON for additional context
);

-- Approvals table: tracks approval/rejection decisions
CREATE TABLE IF NOT EXISTS approvals (
    id TEXT PRIMARY KEY,
    command_id TEXT NOT NULL,
    approver TEXT NOT NULL,
    decision TEXT NOT NULL,       -- 'approved' or 'rejected'
    rationale TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (command_id) REFERENCES commands(id) ON DELETE CASCADE
);

-- Rules table: policy rules for command classification
CREATE TABLE IF NOT EXISTS rules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    rule_type TEXT NOT NULL,      -- 'allowlist', 'denylist', 'pattern', 'risk_override'
    pattern TEXT,                 -- Regex or glob pattern
    risk_level TEXT,              -- Risk level to apply
    enabled INTEGER DEFAULT 1,
    priority INTEGER DEFAULT 0,   -- Higher priority rules evaluated first
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    metadata TEXT                 -- JSON for additional config
);

-- Audit log: comprehensive audit trail
CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,     -- 'command_submitted', 'approved', 'rejected', 'executed', 'rule_created', etc.
    entity_type TEXT,             -- 'command', 'rule', 'approval'
    entity_id TEXT,
    actor TEXT,                   -- Who performed the action
    details TEXT,                 -- JSON with event details
    ip_address TEXT,
    user_agent TEXT,
    created_at TEXT NOT NULL
);

-- Approvers table: authorized approvers configuration
CREATE TABLE IF NOT EXISTS approvers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,           -- 'user', 'agent', 'role'
    identifier TEXT NOT NULL,     -- Username, agent ID, or role name
    enabled INTEGER DEFAULT 1,
    can_approve_high INTEGER DEFAULT 0,
    can_approve_medium INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    metadata TEXT
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_commands_status ON commands(status);
CREATE INDEX IF NOT EXISTS idx_commands_risk_level ON commands(risk_level);
CREATE INDEX IF NOT EXISTS idx_commands_requester ON commands(requester);
CREATE INDEX IF NOT EXISTS idx_commands_created_at ON commands(created_at);
CREATE INDEX IF NOT EXISTS idx_approvals_command_id ON approvals(command_id);
CREATE INDEX IF NOT EXISTS idx_approvals_approver ON approvals(approver);
CREATE INDEX IF NOT EXISTS idx_audit_log_event_type ON audit_log(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_rules_enabled ON rules(enabled);
CREATE INDEX IF NOT EXISTS idx_rules_priority ON rules(priority DESC);
