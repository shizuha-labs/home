# HIVE-375 home BFF — stateless async fan-out (FastAPI + uvicorn).
FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
EXPOSE 8031
# Stateless — safe to run multiple replicas behind the home nginx.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8031"]
