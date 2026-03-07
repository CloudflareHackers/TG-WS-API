/**
 * TG-WS-API — Cloudflare Worker WebSocket Proxy for Telegram
 * 
 * Proxies WebSocket connections from the browser to Telegram's MTProto servers.
 * This allows the TG File Downloader app to work in regions where Telegram is blocked.
 * 
 * Routes:
 *   wss://<worker-domain>/<telegram-host>/<path>
 *   wss://<worker-domain>/pluto.web.telegram.org/apiws
 * 
 * Based on: https://developers.cloudflare.com/workers/examples/websockets/
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.slice(1); // Remove leading /

    // Health check
    if (!path || path === '' || path === 'health') {
      return new Response(JSON.stringify({
        status: 'ok',
        service: 'TG-WS-API',
        description: 'Telegram WebSocket Proxy for MTProto',
        usage: 'wss://<domain>/<telegram-host>/<path>',
        example: 'wss://<domain>/pluto.web.telegram.org/apiws',
      }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Parse: first segment = target host, rest = path
    const segments = path.split('/');
    const targetHost = segments[0];
    const targetPath = segments.slice(1).join('/') || 'apiws';

    // Validate it's a Telegram domain
    const allowedPattern = /^[a-z0-9\-]+\.(?:web\.)?telegram\.org$/i;
    if (!allowedPattern.test(targetHost)) {
      return new Response(JSON.stringify({ error: 'Forbidden: not a Telegram domain', host: targetHost }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // WebSocket upgrade
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader && upgradeHeader.toLowerCase() === 'websocket') {
      return handleWebSocketUpgrade(targetHost, targetPath, request);
    }

    // Regular HTTP proxy (for non-WS requests)
    const targetUrl = `https://${targetHost}/${targetPath}${url.search}`;
    try {
      const resp = await fetch(targetUrl, {
        method: request.method,
        headers: request.headers,
        body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
      });
      const headers = new Headers(resp.headers);
      headers.set('Access-Control-Allow-Origin', '*');
      return new Response(resp.body, { status: resp.status, headers });
    } catch (err) {
      return new Response(`Proxy error: ${err.message}`, { status: 502 });
    }
  },
};

/**
 * Handle WebSocket upgrade.
 * Connects upstream to Telegram via fetch() with Upgrade: websocket,
 * then bridges using WebSocketPair.
 */
async function handleWebSocketUpgrade(targetHost, targetPath, originalRequest) {
  const upstreamUrl = `https://${targetHost}/${targetPath}`;

  try {
    // Build headers for upstream - include Sec-WebSocket-Protocol if present
    const upstreamHeaders = {
      'Upgrade': 'websocket',
    };

    // Forward Sec-WebSocket-Protocol (Telegram requires 'binary')
    const protocol = originalRequest.headers.get('Sec-WebSocket-Protocol');
    if (protocol) {
      upstreamHeaders['Sec-WebSocket-Protocol'] = protocol;
    }

    const upstreamResponse = await fetch(upstreamUrl, {
      headers: upstreamHeaders,
    });

    // Check if we got a WebSocket back
    const upstream = upstreamResponse.webSocket;
    if (!upstream) {
      const body = await upstreamResponse.text().catch(() => '');
      return new Response(JSON.stringify({
        error: 'WebSocket upgrade failed',
        targetHost,
        targetPath,
        upstreamStatus: upstreamResponse.status,
        upstreamBody: body.substring(0, 200),
      }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Create a WebSocketPair for the client
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    // Accept both sides
    upstream.accept();
    server.accept();

    // Bridge: upstream ↔ client (bidirectional)
    upstream.addEventListener('message', event => {
      try { server.send(event.data); } catch {}
    });
    server.addEventListener('message', event => {
      try { upstream.send(event.data); } catch {}
    });

    upstream.addEventListener('close', event => {
      try { server.close(event.code || 1000, event.reason || ''); } catch {}
    });
    server.addEventListener('close', event => {
      try { upstream.close(event.code || 1000, event.reason || ''); } catch {}
    });

    upstream.addEventListener('error', () => {
      try { server.close(1011, 'upstream error'); } catch {}
    });
    server.addEventListener('error', () => {
      try { upstream.close(1011, 'client error'); } catch {}
    });

    // Build response headers
    const responseHeaders = {};
    if (protocol) {
      responseHeaders['Sec-WebSocket-Protocol'] = protocol;
    }

    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: responseHeaders,
    });

  } catch (err) {
    return new Response(JSON.stringify({
      error: 'WS Proxy error',
      message: err.message,
      stack: err.stack,
      targetHost,
      targetPath,
    }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
