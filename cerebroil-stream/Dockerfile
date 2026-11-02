FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Not as root: the service only needs to read its files and write the survey CSV.
RUN useradd --create-home --uid 10001 app && chown -R app:app /app
USER app

EXPOSE 5000

CMD ["python", "app.py"]
