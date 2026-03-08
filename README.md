# TG-WS-API

**Cloudflare Worker + Durable Objects** — WebSocket proxy for Telegram MTProto connections.

Allows browser-based Telegram clients (like [TGCFWorkersDLBot](https://github.com/CloudflareHackers/TGCFWorkersDLBot)) to connect to Telegram servers through Cloudflare's network when direct WebSocket connections are blocked.

## One-Click Deploy

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/CloudflareHackers/TG-WS-API)

> Click the button above → authorize your Cloudflare account → done. Your worker will be deployed automatically.

## How It Works

```
Browser (GramJS) → wss://your-worker.workers.dev/pluto.web.telegram.org/apiws → Telegram Server
```

1. Browser connects to your Cloudflare Worker via WebSocket
2. Worker creates a **Durable Object** that holds a persistent WebSocket to Telegram
3. All messages are bridged bidirectionally: browser ↔ Worker ↔ Telegram

## Usage

Once deployed, set your worker domain in the TGCFWorkersDLBot settings:

```
Proxy Worker Domain: tg-ws-api.your-account.workers.dev
```

## Routes

| Route | Description |
|-------|-------------|
| `GET /` | Health check (JSON) |
| `wss://<domain>/<telegram-host>/<path>` | WebSocket proxy to Telegram |
| `wss://<domain>/pluto.web.telegram.org/apiws` | Example: proxy to DC pluto |

## Security

- Only proxies to `*.telegram.org` domains (regex validated)
- Each connection gets its own Durable Object instance
- CORS headers included for cross-origin browser access
- No data is stored — pure pass-through proxy

## Manual Deploy

```bash
npm install
npx wrangler deploy
```

## Architecture

- **Worker**: Routes requests, validates domains, handles CORS
- **Durable Object (`WebSocketProxy`)**: Holds persistent WebSocket pairs (client ↔ upstream)
- **No external dependencies**: Pure Cloudflare Workers runtime

## Free vs Paid Plan

### Free Plan (Default)
Works out of the box with `new_sqlite_classes` (SQLite-backed Durable Objects).

### Workers Paid Plan ($5/month)
For higher performance and limits, upgrade to the paid plan.

**Paid plan benefits:**
- ⚡ **Higher request limits** — 10M+ requests/month (free: 100K/day)
- 🔄 **More Durable Object operations** — 1M+ included (free: 100K/day)
- 🌍 **Global Durable Objects** — lower latency worldwide
- 📊 **Workers Analytics** — detailed request metrics
- 🚀 **No daily limits** — consistent throughput
- 💾 **More DO storage** — 10GB included (free: 1GB)

## License

MIT
