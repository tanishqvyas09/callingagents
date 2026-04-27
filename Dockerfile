FROM python:3.12-slim

WORKDIR /app

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl \
    && rm -rf /var/lib/apt/lists/*

# Python deps (cached layer)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Download noise-cancellation model at build time so container starts fast
RUN python -c "from livekit.plugins import noise_cancellation; noise_cancellation.BVC()" 2>/dev/null || true

# Source code
COPY . .

EXPOSE 8080

# Healthcheck — agents don't expose HTTP but this prevents Docker marking it unhealthy
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD python -c "import sys; sys.exit(0)"

CMD ["python", "ngo_agent.py", "start"]
