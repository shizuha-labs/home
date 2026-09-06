# HIVE-375 home BFF — stateless async fan-out (FastAPI + uvicorn).
# PLAT-5821: build from the locked uv project (backend/pyproject.toml +
# backend/uv.lock) — the single source of truth. `uv sync --locked` installs the
# exact resolved versions (cryptography 50.0.0) so OSV/Trivy scan the
# actually-deployed versions instead of resolving open `>=` ranges to the range
# floor (the false-positive CVE flood PLAT-1302 identifies). uv is pinned to the
# same 0.11.26 used to generate the lock.
FROM python:3.12-slim
COPY --from=docker.io/astral/uv:0.11.26 /uv /uvx /bin/
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
ENV UV_PYTHON_DOWNLOADS=0 UV_LINK_MODE=copy
WORKDIR /app
# Install dependencies from the lockfile first (cached layer independent of code).
COPY pyproject.toml uv.lock /app/
RUN uv sync --locked --no-dev --no-install-project
COPY app ./app
# Put the synced project venv on PATH so `uvicorn` resolves.
ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8031
# Stateless — safe to run multiple replicas behind the home nginx.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8031"]
