# Niyam - CLI Command Governance System

A full-stack CLI command approval and execution system for Forger agents with risk classification, approval workflows, and comprehensive audit trails.

## Features

- **Command Classification**: Automatic risk assessment (HIGH/MEDIUM/LOW)
- **Approval Workflow**: Multi-approver support with deny/approve actions
- **Real-time Updates**: WebSocket-based dashboard with live command status
- **Policy Engine**: Configurable rules for command matching and auto-actions
- **Audit Trail**: Complete logging of all actions and decisions
- **Dark Mode Dashboard**: Modern, responsive UI

## Quick Start

```bash
# Install dependencies
npm install

# Start server
npm start

# Open dashboard
open http://localhost:3333
```

## API Endpoints

### Commands
- `POST /api/commands` - Submit a new command
- `GET /api/commands` - List commands (filterable)
- `GET /api/commands/:id` - Get command details
- `POST /api/commands/:id/approve` - Approve a command
- `POST /api/commands/:id/deny` - Deny a command
- `POST /api/commands/:id/kill` - Kill a running command

### Rules
- `GET /api/rules` - List all rules
- `POST /api/rules` - Create/update a rule
- `DELETE /api/rules/:id` - Delete a rule

### Audit
- `GET /api/audit` - Get audit log

### Stats
- `GET /api/stats` - Get dashboard statistics

## Command Submission

```json
POST /api/commands
{
  "command": "npm",
  "args": ["install", "express"],
  "workingDir": "/home/user/project",
  "requesterId": "agent-001",
  "requesterName": "Forger Agent",
  "timeoutSeconds": 300
}
```

## Risk Classification

The policy engine classifies commands based on:

### HIGH Risk
- Commands with elevated privileges (sudo, doas)
- Package installations/removals
- Service management (systemctl)
- Disk operations (dd, mkfs)
- Recursive deletions

### MEDIUM Risk
- Network downloads (curl, wget)
- Git push operations
- Docker commands
- SSH/SCP operations

### LOW Risk
- Read-only commands (cat, ls, head)
- Git status/log/diff
- Version checks

## Configuration

Environment variables:
- `NIYAM_PORT` - Server port (default: 3333)
- `NIYAM_DB` - SQLite database path (default: ./db/niyam.db)

## Systemd Installation

```bash
# Copy service file
sudo cp niyam.service /etc/systemd/system/

# Create data directory
sudo mkdir -p /var/lib/niyam

# Enable and start
sudo systemctl enable niyam
sudo systemctl start niyam
```

## License

MIT
