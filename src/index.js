/**
 * TG-WS-API — Cloudflare Worker + Durable Objects WebSocket Proxy for Telegram
 * 
 * Uses Durable Objects to hold persistent WebSocket connections between
 * the browser client and Telegram's MTProto servers.
 * 
 * Location hints are automatically set based on the target Telegram DC
 * for optimal latency (DO is placed near Telegram's server, not the user).
 * 
 * Routes:
 *   wss://<worker-domain>/<telegram-host>/<path>
 *   wss://<worker-domain>/pluto.web.telegram.org/apiws
 *   wss://<worker-domain>/pluto.web.telegram.org/apiws?locationHint=enam
 */

// ===== Telegram DC → CF Location Hint Mapping =====
// Telegram DC locations:
//   DC1 (pluto/zws1) → Miami, USA
//   DC2 (venus/zws2) → Amsterdam, Netherlands
//   DC3 (aurora/zws3) → Miami, USA
//   DC4 (vesta/zws4) → Amsterdam, Netherlands
//   DC5 (flora/zws5) → Singapore
const DC_LOCATION_MAP = {
  'zws1': 'enam',      // DC1 → Eastern North America (Miami)
  'zws1-1': 'enam',
  'zws2': 'weur',      // DC2 → Western Europe (Amsterdam)
  'zws2-1': 'weur',
  'zws3': 'enam',      // DC3 → Eastern North America (Miami)
  'zws3-1': 'enam',
  'zws4': 'weur',      // DC4 → Western Europe (Amsterdam)
  'zws4-1': 'weur',
  'zws5': 'apac',      // DC5 → Asia Pacific (Singapore)
  'zws5-1': 'apac',
  'pluto': 'enam',     // DC1 aliases
  'venus': 'weur',     // DC2 aliases
  'aurora': 'enam',    // DC3 aliases
  'vesta': 'weur',     // DC4 aliases
  'flora': 'apac',     // DC5 aliases
};

// Valid CF location hints
const VALID_HINTS = new Set([
  'wnam', 'enam', 'sam', 'weur', 'eeur', 'apac', 'oc', 'afr', 'me',
]);

/**
 * Determine the best location hint for a Durable Object based on the target Telegram host.
 * @param {string} targetHost - e.g. "zws2.web.telegram.org" or "venus-1.web.telegram.org"
 * @param {string|null} manualHint - Optional manual override from query param
 * @returns {string|undefined} Location hint or undefined (let CF decide)
 */
function getLocationHint(targetHost, manualHint) {
  // Manual override takes priority
  if (manualHint && VALID_HINTS.has(manualHint.toLowerCase())) {
    return manualHint.toLowerCase();
  }

  // Extract the DC prefix from the hostname (e.g. "zws2" from "zws2.web.telegram.org")
  const dcPrefix = targetHost.split('.')[0].toLowerCase();

  // Direct match
  if (DC_LOCATION_MAP[dcPrefix]) {
    return DC_LOCATION_MAP[dcPrefix];
  }

  // Try without trailing numbers (e.g. "zws2-1" → "zws2")
  const basePrefix = dcPrefix.replace(/-\d+$/, '');
  if (DC_LOCATION_MAP[basePrefix]) {
    return DC_LOCATION_MAP[basePrefix];
  }

  // No match — let CF decide
  return undefined;
}

// ===== Worker Entry Point =====
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.slice(1);

    // Health check
    if (!path || path === '' || path === 'health') {
      return new Response(JSON.stringify({
        status: 'ok',
        service: 'TG-WS-API',
        type: 'Durable Objects WebSocket Proxy',
        description: 'Telegram WebSocket Proxy for MTProto',
        usage: 'wss://<domain>/<telegram-host>/<path>',
        example: 'wss://<domain>/pluto.web.telegram.org/apiws',
        locationHints: {
          description: 'Auto-detected based on Telegram DC, or override via ?locationHint=<hint>',
          validHints: [...VALID_HINTS],
          dcMapping: DC_LOCATION_MAP,
        },
      }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Parse target
    const segments = path.split('/');
    const targetHost = segments[0];
    const targetPath = segments.slice(1).join('/') || 'apiws';

    // Validate Telegram domain
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

    // WebSocket upgrade — route to Durable Object
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader && upgradeHeader.toLowerCase() === 'websocket') {
      // Determine location hint (auto from DC or manual override)
      const manualHint = url.searchParams.get('locationHint');
      const locationHint = getLocationHint(targetHost, manualHint);

      // Create a unique DO instance per connection with optional location hint
      const idOptions = locationHint ? { locationHint } : {};
      const id = env.WS_PROXY.newUniqueId(idOptions);
      const stub = env.WS_PROXY.get(id);
      
      // Forward to DO with target info in URL
      const doUrl = new URL(request.url);
      doUrl.searchParams.set('targetHost', targetHost);
      doUrl.searchParams.set('targetPath', targetPath);
      if (locationHint) {
        doUrl.searchParams.set('_locationHint', locationHint);
      }
      
      return stub.fetch(new Request(doUrl.toString(), request));
    }

    // Regular HTTP proxy
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

// ===== Durable Object: WebSocket Proxy =====
export class WebSocketProxy {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.clientWs = null;
    this.upstreamWs = null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const targetHost = url.searchParams.get('targetHost');
    const targetPath = url.searchParams.get('targetPath') || 'apiws';

    if (!targetHost) {
      return new Response('Missing targetHost', { status: 400 });
    }

    // Accept the client WebSocket
    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Accept the server side
    server.accept();
    this.clientWs = server;

    // Connect to Telegram upstream
    const upstreamUrl = `https://${targetHost}/${targetPath}`;
    
    try {
      // Forward with Upgrade header and protocol headers that Telegram expects
      const upstreamResp = await fetch(upstreamUrl, {
        headers: {
          'Upgrade': 'websocket',
          'Sec-WebSocket-Protocol': 'binary',
          'Origin': `https://${targetHost}`,
          'Host': targetHost,
        },
      });

      if (!upstreamResp.webSocket) {
        // Upstream didn't return a WebSocket
        const body = await upstreamResp.text().catch(() => '');
        server.send(JSON.stringify({
          error: 'upstream_failed',
          status: upstreamResp.status,
          body: body.substring(0, 200),
        }));
        server.close(1011, `Upstream returned ${upstreamResp.status}`);
        return new Response(null, { status: 101, webSocket: client });
      }

      const upstream = upstreamResp.webSocket;
      upstream.accept();
      this.upstreamWs = upstream;

      // Bridge: upstream → client
      upstream.addEventListener('message', (event) => {
        try {
          server.send(event.data);
        } catch (err) {
          // Client disconnected
          try { upstream.close(1000, 'client gone'); } catch {}
        }
      });

      upstream.addEventListener('close', (event) => {
        try {
          server.close(event.code || 1000, event.reason || 'upstream closed');
        } catch {}
      });

      upstream.addEventListener('error', () => {
        try { server.close(1011, 'upstream error'); } catch {}
      });

      // Bridge: client → upstream
      server.addEventListener('message', (event) => {
        try {
          upstream.send(event.data);
        } catch (err) {
          // Upstream disconnected
          try { server.close(1011, 'upstream gone'); } catch {}
        }
      });

      server.addEventListener('close', (event) => {
        try {
          upstream.close(event.code || 1000, event.reason || 'client closed');
        } catch {}
      });

      server.addEventListener('error', () => {
        try { upstream.close(1011, 'client error'); } catch {}
      });

    } catch (err) {
      server.send(JSON.stringify({ error: 'connection_failed', message: err.message }));
      server.close(1011, err.message);
    }

    // Return the client side of the WebSocket pair
    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }
}
