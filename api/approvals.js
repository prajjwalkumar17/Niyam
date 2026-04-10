/**
 * Approvals API - Approval workflow endpoints
 */

const { v4: uuidv4 } = require('uuid');
const { logAudit } = require('./commands');
const { checkTwoPersonApproval } = require('../safety/two-person');
const { validateRationale } = require('../safety/rationale');

function createApprovalsRouter(db, broadcast) {
    const router = require('express').Router();

    // Approve a command
    router.post('/:commandId/approve', (req, res) => {
        const { commandId } = req.params;
        const { approver, rationale } = req.body;
        
        if (!approver) {
            return res.status(400).json({ error: 'Approver is required' });
        }
        
        const cmd = db.prepare('SELECT * FROM commands WHERE id = ?').get(commandId);
        if (!cmd) {
            return res.status(404).json({ error: 'Command not found' });
        }
        
        if (cmd.status !== 'pending') {
            return res.status(400).json({ error: `Command is ${cmd.status}, not pending` });
        }
        
        // Check if timeout has expired
        if (cmd.timeout_at && new Date(cmd.timeout_at) < new Date()) {
            db.prepare("UPDATE commands SET status = 'timeout', updated_at = ? WHERE id = ?")
                .run(new Date().toISOString(), commandId);
            return res.status(400).json({ error: 'Approval window has expired' });
        }
        
        // Validate rationale if required
        if (cmd.rationale_required) {
            const validation = validateRationale(rationale);
            if (!validation.valid) {
                return res.status(400).json({ error: validation.error });
            }
        }
        
        // Check if approver has already approved
        const existingApproval = db.prepare(
            'SELECT * FROM approvals WHERE command_id = ? AND approver = ? AND decision = ?'
        ).get(commandId, approver, 'approved');
        
        if (existingApproval) {
            return res.status(400).json({ error: 'Approver has already approved this command' });
        }
        
        // Check if approver is authorized for this risk level
        const approverRecord = db.prepare(
            'SELECT * FROM approvers WHERE identifier = ? AND enabled = 1'
        ).get(approver);
        
        if (!approverRecord) {
            return res.status(403).json({ error: 'Not an authorized approver' });
        }
        
        if (cmd.risk_level === 'HIGH' && !approverRecord.can_approve_high) {
            return res.status(403).json({ error: 'Not authorized to approve HIGH risk commands' });
        }
        
        // Record the approval
        const approvalId = uuidv4();
        db.prepare(`
            INSERT INTO approvals (id, command_id, approver, decision, rationale, created_at)
            VALUES (?, ?, ?, 'approved', ?, ?)
        `).run(approvalId, commandId, approver, rationale || null, new Date().toISOString());
        
        // Update approval count
        const newCount = cmd.approval_count + 1;
        const now = new Date().toISOString();
        
        // Check if we have enough approvals
        if (newCount >= cmd.required_approvals) {
            db.prepare(`
                UPDATE commands SET status = 'approved', approval_count = ?, updated_at = ?
                WHERE id = ?
            `).run(newCount, now, commandId);
            
            logAudit(db, 'command_approved', 'command', commandId, approver, {
                approvalCount: newCount,
                requiredApprovals: cmd.required_approvals,
                rationale: rationale || null
            });
            
            if (broadcast) {
                broadcast('command_approved', { id: commandId, command: cmd.command, approvals: newCount });
            }
        } else {
            db.prepare(`
                UPDATE commands SET approval_count = ?, updated_at = ? WHERE id = ?
            `).run(newCount, now, commandId);
            
            logAudit(db, 'approval_granted', 'command', commandId, approver, {
                approvalCount: newCount,
                requiredApprovals: cmd.required_approvals,
                stillPending: true,
                rationale: rationale || null
            });
            
            if (broadcast) {
                broadcast('approval_granted', {
                    id: commandId,
                    command: cmd.command,
                    approvals: newCount,
                    required: cmd.required_approvals
                });
            }
        }
        
        res.json({
            approvalId,
            commandId,
            approvalCount: newCount,
            requiredApprovals: cmd.required_approvals,
            fullyApproved: newCount >= cmd.required_approvals
        });
    });

    // Reject a command
    router.post('/:commandId/reject', (req, res) => {
        const { commandId } = req.params;
        const { approver, rationale } = req.body;
        
        if (!approver) {
            return res.status(400).json({ error: 'Approver is required' });
        }
        
        const cmd = db.prepare('SELECT * FROM commands WHERE id = ?').get(commandId);
        if (!cmd) {
            return res.status(404).json({ error: 'Command not found' });
        }
        
        if (cmd.status !== 'pending') {
            return res.status(400).json({ error: `Command is ${cmd.status}, not pending` });
        }
        
        // Record the rejection
        const approvalId = uuidv4();
        db.prepare(`
            INSERT INTO approvals (id, command_id, approver, decision, rationale, created_at)
            VALUES (?, ?, ?, 'rejected', ?, ?)
        `).run(approvalId, commandId, approver, rationale || 'No rationale provided', new Date().toISOString());
        
        // Mark command as rejected
        db.prepare(`
            UPDATE commands SET status = 'rejected', updated_at = ? WHERE id = ?
        `).run(new Date().toISOString(), commandId);
        
        logAudit(db, 'command_rejected', 'command', commandId, approver, {
            rationale: rationale || 'No rationale provided'
        });
        
        if (broadcast) {
            broadcast('command_rejected', { id: commandId, command: cmd.command, rejectedBy: approver });
        }
        
        res.json({
            approvalId,
            commandId,
            status: 'rejected',
            rejectedBy: approver
        });
    });

    // Get approvals for a command
    router.get('/:commandId', (req, res) => {
        const approvals = db.prepare(
            'SELECT * FROM approvals WHERE command_id = ? ORDER BY created_at DESC'
        ).all(req.params.commandId);
        
        res.json(approvals);
    });

    // List pending approvals (commands needing approval)
    router.get('/', (req, res) => {
        const pending = db.prepare(`
            SELECT c.*, 
                   COUNT(CASE WHEN a.decision = 'approved' THEN 1 END) as approval_count_actual
            FROM commands c
            LEFT JOIN approvals a ON c.id = a.command_id
            WHERE c.status = 'pending'
            GROUP BY c.id
            ORDER BY c.created_at DESC
        `).all();
        
        // Parse JSON fields
        pending.forEach(cmd => {
            cmd.args = JSON.parse(cmd.args || '[]');
            cmd.metadata = JSON.parse(cmd.metadata || '{}');
        });
        
        res.json(pending);
    });

    return router;
}

module.exports = { createApprovalsRouter };
