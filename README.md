# TG-WS-API

**Cloudflare Worker + Durable Objects** — WebSocket proxy for Telegram MTProto connections.

Allows browser-based Telegram clients (like [Telegram Web A (MOD)](https://github.com/PBhadoo/telegram-tt)) to connect to Telegram servers through Cloudflare's network when direct WebSocket connections are blocked.

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

Once deployed, set your worker domain in the [Telegram Web A (MOD)](https://github.com/PBhadoo/telegram-tt) proxy settings:

```
Proxy Domain: tg-ws-api.your-account.workers.dev
```

Or set it as an environment variable during build:
```
PROXY_URL=tg-ws-api.your-account.workers.dev
```

## Routes

| Route | Description |
|-------|-------------|
| `GET /` | Health check (JSON) — includes DC mapping info |
| `wss://<domain>/<telegram-host>/<path>` | WebSocket proxy to Telegram |
| `wss://<domain>/pluto.web.telegram.org/apiws` | Example: proxy to DC1 (pluto) |

## Smart Location Hints (Auto DC Placement)

Durable Objects are automatically placed **near the target Telegram DC** for lowest latency using [Cloudflare Location Hints](https://developers.cloudflare.com/durable-objects/reference/data-location/).

### Telegram DC → Cloudflare Region Mapping

| Telegram DC | Hosts | Physical Location | CF Location Hint |
|---|---|---|---|
| DC1 (Pluto) | `zws1.web.telegram.org` | Miami, USA | `enam` |
| DC2 (Venus) | `zws2.web.telegram.org` | Amsterdam, NL | `weur` |
| DC3 (Aurora) | `zws3.web.telegram.org` | Miami, USA | `enam` |
| DC4 (Vesta) | `zws4.web.telegram.org` | Amsterdam, NL | `weur` |
| DC5 (Flora) | `zws5.web.telegram.org` | Singapore | `apac` |

### How It Works

- **Automatic**: The worker detects which Telegram DC you're connecting to and places the DO near it
- **Manual Override**: Add `?locationHint=<hint>` to force a specific region

```
wss://your-worker.workers.dev/zws2.web.telegram.org/apiws              → Auto: weur (Amsterdam)
wss://your-worker.workers.dev/zws5.web.telegram.org/apiws              → Auto: apac (Singapore)
wss://your-worker.workers.dev/zws1.web.telegram.org/apiws?locationHint=wnam  → Override: wnam
```

### Available Location Hints

| Hint | Region |
|------|--------|
| `wnam` | Western North America |
| `enam` | Eastern North America |
| `sam` | South America |
| `weur` | Western Europe |
| `eeur` | Eastern Europe |
| `apac` | Asia Pacific |
| `oc` | Oceania |
| `afr` | Africa |
| `me` | Middle East |

> **Note**: Location hints are *soft preferences* — Cloudflare tries its best but doesn't guarantee exact placement.

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

- **Worker**: Routes requests, validates domains, handles CORS, auto-detects DC location
- **Durable Object (`WebSocketProxy`)**: Holds persistent WebSocket pairs (client ↔ upstream)
- **Location Hints**: DOs placed near Telegram DCs for optimal latency
- **No external dependencies**: Pure Cloudflare Workers runtime

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
