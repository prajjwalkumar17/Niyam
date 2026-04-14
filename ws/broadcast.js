/**
 * WebSocket Broadcast - Real-time updates for dashboard
 */

const { WebSocketServer } = require('ws');
const { logger, metrics } = require('../observability');

class BroadcastManager {
    constructor() {
        this.clients = new Set();
        this.wss = null;
        this.authenticate = null;
    }

    /**
     * Initialize WebSocket server on an HTTP server
     */
    init(server, options = {}) {
        this.authenticate = options.authenticate || null;
        this.wss = new WebSocketServer({ server, path: '/ws' });
        
        this.wss.on('connection', (ws, req) => {
            if (this.authenticate && !this.authenticate(req)) {
                ws.close(4401, 'Authentication required');
                return;
            }

            this.clients.add(ws);
            metrics.setGauge('niyam_websocket_clients', {}, this.clients.size, 'Connected websocket clients');
            logger.info('websocket_connected', { clientCount: this.clients.size });
            
            // Send initial connection message
            ws.send(JSON.stringify({
                type: 'connected',
                message: 'Niyam WebSocket connected',
                timestamp: new Date().toISOString()
            }));
            
            ws.on('close', () => {
                this.clients.delete(ws);
                metrics.setGauge('niyam_websocket_clients', {}, this.clients.size, 'Connected websocket clients');
                logger.info('websocket_disconnected', { clientCount: this.clients.size });
            });
            
            ws.on('error', (err) => {
                logger.error('websocket_error', { error: err.message });
                this.clients.delete(ws);
                metrics.setGauge('niyam_websocket_clients', {}, this.clients.size, 'Connected websocket clients');
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
                    metrics.setGauge('niyam_websocket_clients', {}, this.clients.size, 'Connected websocket clients');
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
        metrics.setGauge('niyam_websocket_clients', {}, 0, 'Connected websocket clients');
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
