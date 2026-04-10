/**
 * WebSocket Broadcast - Real-time updates for dashboard
 */

const { WebSocketServer } = require('ws');

class BroadcastManager {
    constructor() {
        this.clients = new Set();
        this.wss = null;
    }

    /**
     * Initialize WebSocket server on an HTTP server
     */
    init(server) {
        this.wss = new WebSocketServer({ server, path: '/ws' });
        
        this.wss.on('connection', (ws) => {
            this.clients.add(ws);
            console.log(`WebSocket client connected. Total: ${this.clients.size}`);
            
            // Send initial connection message
            ws.send(JSON.stringify({
                type: 'connected',
                message: 'Niyam WebSocket connected',
                timestamp: new Date().toISOString()
            }));
            
            ws.on('close', () => {
                this.clients.delete(ws);
                console.log(`WebSocket client disconnected. Total: ${this.clients.size}`);
            });
            
            ws.on('error', (err) => {
                console.error('WebSocket error:', err.message);
                this.clients.delete(ws);
            });
            
            ws.on('message', (data) => {
                try {
                    const msg = JSON.parse(data);
                    this._handleClientMessage(ws, msg);
                } catch (e) {
                    // Ignore malformed messages
                }
            });
        });
        
        return this.wss;
    }

    /**
     * Broadcast an event to all connected clients
     * @param {string} eventType - Event type
     * @param {Object} data - Event data
     */
    broadcast(eventType, data) {
        const message = JSON.stringify({
            type: eventType,
            data,
            timestamp: new Date().toISOString()
        });
        
        for (const client of this.clients) {
            if (client.readyState === 1) { // OPEN
                try {
                    client.send(message);
                } catch (e) {
                    this.clients.delete(client);
                }
            }
        }
    }

    /**
     * Handle incoming client messages
     */
    _handleClientMessage(ws, msg) {
        switch (msg.type) {
            case 'ping':
                ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
                break;
            case 'subscribe':
                // Future: support filtered subscriptions
                ws.send(JSON.stringify({
                    type: 'subscribed',
                    timestamp: new Date().toISOString()
                }));
                break;
            default:
                // Unknown message type, ignore
                break;
        }
    }

    /**
     * Get count of connected clients
     */
    getConnectedCount() {
        return this.clients.size;
    }

    /**
     * Close all connections and shut down
     */
    close() {
        for (const client of this.clients) {
            client.close();
        }
        this.clients.clear();
        if (this.wss) {
            this.wss.close();
        }
    }
}

// Create singleton instance
const broadcastManager = new BroadcastManager();

// Export a bound function for easy use in route handlers
function broadcast(eventType, data) {
    broadcastManager.broadcast(eventType, data);
}

module.exports = { BroadcastManager, broadcastManager, broadcast };
