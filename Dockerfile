FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        gdal-bin libgdal-dev gcc g++ git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first (layer-cached separately from source)
COPY pyproject.toml ./
COPY src/bowser/_version.py src/bowser/_version.py
RUN pip install --no-cache-dir \
        "gdal==$(gdal-config --version)" \
        s3fs \
        fsspec \
    && pip install --no-cache-dir -e ".[widget]" || true

# Copy full source + pre-built frontend dist
COPY src/ src/
COPY src/bowser/dist/ src/bowser/dist/

RUN pip install --no-cache-dir --no-build-isolation -e .

ENV BOWSER_HOST=0.0.0.0
ENV BOWSER_PORT=8000

EXPOSE 8000

ENTRYPOINT ["bowser", "run"]
