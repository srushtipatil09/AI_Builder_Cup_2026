# syntax=docker/dockerfile:1.7
FROM python:3.12-slim AS runtime
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PORT=8080 APP_MODULE=main:app
RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin app
WORKDIR /app
COPY pyproject.toml ./
COPY src ./src
RUN pip install --no-cache-dir .
USER app
EXPOSE 8080
CMD ["sh", "-c", "exec uvicorn saathi.${APP_MODULE} --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
