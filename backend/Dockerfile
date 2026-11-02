FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HOME=/home/app
WORKDIR /app
RUN groupadd --gid 10001 app && useradd --uid 10001 --gid app --create-home app \
    && mkdir -p /app/media /app/staticfiles /home/app/.paddlex \
    && chown app:app /app/media /app/staticfiles /home/app/.paddlex
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
FROM base AS worker-dependencies
COPY requirements-worker.txt .
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir -r requirements-worker.txt
FROM worker-dependencies AS worker
COPY . .
USER app
FROM base AS api
COPY . .
USER app
EXPOSE 8000
