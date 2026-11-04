# Self-hosted LiveKit port plan (VPS `72.61.224.223`)

This document maps **existing server ports** and defines **safe LiveKit ports** for the shared KVM 4 host. LiveKit runs in a **separate stack** at `/opt/livekit` — not inside EngLeash `docker-compose.yml`.

## Server summary

| Resource | Value |
|----------|--------|
| VPS | Hostinger KVM 4 — 4 vCPU, 16 GB RAM |
| Public IP | `72.61.224.223` |
| Entry | Host **nginx** on **80/443** (17 site configs) |
| EngLeash API | `127.0.0.1:13001` → `api.engleashacademy.com` |
| EngLeash web | `127.0.0.1:18080` → `app.engleashacademy.com` |

## Ports already in use (do not take)

| Port(s) | Protocol | Project / service |
|---------|----------|-----------------|
| 80, 443 | TCP | nginx (all public sites) |
| 13001 | TCP | EngLeash API (Docker) |
| 18080 | TCP | EngLeash web admin (Docker) |
| 3000, 4000 | TCP | PM2 — Samplestore / Trendvibes |
| 3100 | TCP | PM2 — Nutrifreaks Ops API |
| 4341 | TCP | MLW AHSS |
| 5000–5003 | TCP | Flora API, Nammakadai stack |
| 5022–5023 | TCP | Eagleview API + GT06 TCP |
| 5050 | TCP | Flora frontend |
| 5174 | TCP | Floratech admin |
| 5551–5553 | TCP | TheEng / QuizWorld |
| 6060 | TCP | ICRED web (localhost) |
| 6626 | TCP | Korasec (localhost) |
| 6660–6661 | TCP | NGPM Trust |
| 7070–7071 | TCP | Dr Karthikeyan |
| 7701–7703 | TCP | RBS Silver |
| 8080 | TCP | nf-ops Docker web |
| 27017 | TCP | Floratech Mongo (public bind) |
| 6379 | TCP | Host Redis (localhost) |
| 3306 | TCP | MySQL |

## LiveKit ports (reserved — install when ready)

| Port(s) | Protocol | Bind | Purpose |
|---------|----------|------|---------|
| **7880** | TCP | `127.0.0.1` only | LiveKit signaling — public via nginx `wss://` |
| **7881** | TCP | `0.0.0.0` | WebRTC ICE/TCP fallback |
| **50000–60000** | UDP | `0.0.0.0` | WebRTC media (variable class size; widen if needed) |
| **6380** | TCP | `127.0.0.1` | **Dedicated Redis** for LiveKit + Egress (not host 6379) |
| **3478** | UDP | optional | Embedded TURN |
| **5349** | TCP | optional | Embedded TURN/TLS |

**Public URL:** `livekit.engleashacademy.com` → nginx → `http://127.0.0.1:7880`

No conflict with EngLeash (`13001`/`18080`) or other Docker apps (TCP 5xxx are different from UDP 50000+).

## Nginx (add when LiveKit is installed)

1. DNS: `livekit.engleashacademy.com` A → `72.61.224.223`
2. Copy `deploy/nginx-host-livekit.conf` → `/etc/nginx/sites-available/livekit.conf`
3. `ln -s … sites-enabled/` → `nginx -t` → `systemctl reload nginx`
4. Cert: extend existing cert or `certbot -d livekit.engleashacademy.com`

## EngLeash API `.env` (self-hosted only)

```env
LIVE_RTC_PROVIDER=livekit
LIVEKIT_URL=wss://livekit.engleashacademy.com
LIVEKIT_API_KEY=<from livekit.yaml keys:>
LIVEKIT_API_SECRET=<from livekit.yaml keys:>
```

Generate keys on the server:

```bash
docker run --rm livekit/livekit-server:latest generate-keys
```

## Firewall (ufw)

```bash
ufw allow 7881/tcp
ufw allow 50000:60000/udp
# optional TURN:
# ufw allow 3478/udp
# ufw allow 5349/tcp
```

## Pre-install check

```bash
ss -tlnp | grep -E '7880|7881|6380'
ss -ulnp | grep 50000
```

## Stack layout

```text
/opt/livekit/
  docker-compose.yml   # livekit + redis:6380 + egress
  livekit.yaml
  egress.yaml

/root/workspace/EngLeash-Academy/   # unchanged
```
