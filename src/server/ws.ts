import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';

interface ClientMeta {
  ws: WebSocket;
  role: 'patient' | 'staff';
  conversationId?: number;
}

class RealtimeHub {
  private clients = new Set<ClientMeta>();
  private wss: WebSocketServer | null = null;

  attach(server: HttpServer): void {
    if (this.wss) return;
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.wss.on('connection', (ws, req) => {
      const url = new URL(req.url || '/ws', 'http://localhost');
      const roleParam = url.searchParams.get('role') === 'staff' ? 'staff' : 'patient';
      const convIdParam = Number(url.searchParams.get('conversationId') || '0');
      const meta: ClientMeta = {
        ws,
        role: roleParam,
        conversationId: convIdParam > 0 ? convIdParam : undefined,
      };
      this.clients.add(meta);

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(String(raw)) as { type?: string; conversationId?: number };
          if (msg.type === 'subscribe' && typeof msg.conversationId === 'number') {
            meta.conversationId = msg.conversationId;
          }
        } catch {
          // ignore malformed client messages
        }
      });

      ws.on('close', () => {
        this.clients.delete(meta);
      });

      ws.on('error', () => {
        this.clients.delete(meta);
      });
    });
  }

  broadcastConversationMessage(conversationId: number, payload: unknown): void {
    const data = JSON.stringify({ event: 'message:created', conversationId, payload });
    for (const client of this.clients) {
      if (client.ws.readyState !== WebSocket.OPEN) continue;
      if (client.role === 'staff' || client.conversationId === conversationId) {
        client.ws.send(data);
      }
    }
  }

  broadcastTicketUpdate(payload: unknown): void {
    const data = JSON.stringify({ event: 'ticket:updated', payload });
    for (const client of this.clients) {
      if (client.ws.readyState !== WebSocket.OPEN) continue;
      if (client.role === 'staff') {
        client.ws.send(data);
      }
    }
  }
}

export const realtimeHub = new RealtimeHub();
