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
    const targetPath = segments.slice(1).join('/');

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
      return handleWebSocketUpgrade(targetHost, targetPath);
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
 * Per CF docs: use fetch() to make a WebSocket connection to the upstream,
 * then use WebSocketPair to create a client-facing socket and bridge them.
 */
async function handleWebSocketUpgrade(targetHost, targetPath) {
  // Connect to Telegram upstream via fetch + Upgrade header
  // Per CF Workers docs, use https:// with Upgrade: websocket
  const upstreamUrl = `https://${targetHost}/${targetPath}`;

  const upstreamResponse = await fetch(upstreamUrl, {
    headers: {
      'Upgrade': 'websocket',
    },
  });

  // Check if we got a WebSocket back
  const upstream = upstreamResponse.webSocket;
  if (!upstream) {
    return new Response(`Failed to establish WebSocket to ${targetHost}/${targetPath}. Status: ${upstreamResponse.status}`, {
      status: 502,
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  }

  // Create a WebSocketPair for the client
  const webSocketPair = new WebSocketPair();
  const [client, server] = Object.values(webSocketPair);

  // Accept both sides
  upstream.accept();
  server.accept();

  // Bridge: upstream → client
  upstream.addEventListener('message', event => {
    try {
      server.send(event.data);
    } catch (err) {
      // Client disconnected
    }
  });

  upstream.addEventListener('close', event => {
    try {
      server.close(event.code || 1000, event.reason || 'upstream closed');
    } catch {}
  });

  upstream.addEventListener('error', event => {
    try {
      server.close(1011, 'upstream error');
    } catch {}
  });

  // Bridge: client → upstream
  server.addEventListener('message', event => {
    try {
      upstream.send(event.data);
    } catch (err) {
      // Upstream disconnected
    }
  });

  server.addEventListener('close', event => {
    try {
      upstream.close(event.code || 1000, event.reason || 'client closed');
    } catch {}
  });

  server.addEventListener('error', event => {
    try {
      upstream.close(1011, 'client error');
    } catch {}
  });

  // Return the client WebSocket as the response
  return new Response(null, {
    status: 101,
    webSocket: client,
  });
}
