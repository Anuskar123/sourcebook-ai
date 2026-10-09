FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
# Replace this demo-training step with COPY of your evaluated release artifact.
RUN python train_demo.py && useradd --uid 10001 --create-home inference
USER inference
EXPOSE 8001
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001", "--limit-concurrency", "32"]
