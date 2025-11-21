# Login Node + React with Observability (Dockerized)

This repository contains a login application with full observability stack:
- **backend**: Node.js + Express + PostgreSQL (JWT auth) with Prometheus metrics
- **frontend**: React (Vite) built and served by nginx
- **observability**: Prometheus + Grafana + Node Exporter + cAdvisor

## Quick Start (requires Docker)

```bash
# Start all services
docker compose up --build
```

## Services & Ports

| Service | Port | Description |
|---------|------|-------------|
| App (nginx) | 80 | Main application (frontend + API proxy) |
| Grafana | 3000 | Metrics dashboard |
| Prometheus | 9090 | Metrics storage & query |
| cAdvisor | 8080 | Container metrics |
| Backend /metrics | 4000 | Application metrics endpoint |

## Grafana Access

- URL: http://localhost:3000
- **Anonymous access enabled** (no login required)
- Optional login: `admin` / `grafana`
- Pre-configured dashboard: "Login App Observability Dashboard"

## What's Monitored

✅ **Container Metrics** (via cAdvisor):
- CPU usage per container
- Memory usage per container
- Network I/O

✅ **System Metrics** (via Node Exporter):
- Host CPU usage
- Host memory usage
- Disk I/O

✅ **Application Metrics** (via backend /metrics):
- HTTP request rate
- HTTP response time (p95)
- Request count by route and status code
- Node.js process metrics (event loop, heap, etc.)

✅ **Alerts** (configured in Prometheus):
- High CPU usage (> 70% for 1 min)
- High memory usage (> 80% for 2 min)
- Backend down (unhealthy for 30s)

## Viewing Metrics

1. **Grafana Dashboard**: http://localhost:3000
   - Auto-loaded: "Login App Observability Dashboard"
   - Shows CPU, memory, response time, request rate

2. **Prometheus**: http://localhost:9090
   - Query metrics directly
   - View alert status: http://localhost:9090/alerts

3. **Backend Metrics**: http://localhost:4000/metrics
   - Raw Prometheus format metrics

## CI/CD

The GitHub Actions workflow deploys to Azure VM on push to main.
Set repository secrets:
- `AZURE_VM_IP`
- `AZURE_VM_KEY` (SSH private key)
