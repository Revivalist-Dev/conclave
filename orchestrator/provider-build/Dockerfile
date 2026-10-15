# Conclave-owned build recipe for the local DanyAPI provider image.
#
# This file is written over the copy that ships inside the pinned
# mindflowgo/DanyAPI checkout, so the image Conclave runs is built from a recipe
# Conclave owns rather than from whatever the fork's Dockerfile says today.
# Bootstrap performs the overwrite: orchestrator/src/bootstrap/index.ts.
#
# Base image pinned by manifest-list digest, so the pin stays multi-platform.
#   tag             python:3.14-slim
#   digest          sha256:a2b82f3c48559aa0a8446d9af49826b6e2b2016f4cd2afabfe6013ec53729170  (manifest list)
#   linux/amd64     sha256:cfe2e24a75302a15934d37c2d86412893c0aa934dc3a97cbb439d04c01890ca9
#   base            debian:trixie-slim
#   resolved        2026-10-15, with `docker buildx imagetools inspect python:3.14-slim`
FROM python:3.14-slim@sha256:a2b82f3c48559aa0a8446d9af49826b6e2b2016f4cd2afabfe6013ec53729170

WORKDIR /app

# The checkout's own requirements.txt is left exactly as the fork wrote it — it
# names what is needed. constraints.txt is ours and names which version of each
# is installed, transitively as well as directly, so a later `pip` cannot take a
# newer package than the one resolved here. Both files are written into the
# build context by bootstrap.
COPY requirements.txt .
COPY constraints.txt .
RUN pip install --no-cache-dir -r requirements.txt -c constraints.txt

COPY danyapi ./danyapi

# Same sequence as the fork's recipe: the POW solver is compiled from C at build
# time, then the toolchain is removed again.
RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc libc6-dev nodejs curl \
    && gcc -O3 -pthread -funroll-loops -flto -fomit-frame-pointer -o danyapi/deepseek/pow_solver danyapi/deepseek/pow_solver.c \
    && apt-get purge -y gcc libc6-dev \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1
ENV DANYAPI_HOST=0.0.0.0
ENV DANYAPI_PORT=8000

EXPOSE 8000

CMD ["python", "-m", "danyapi"]
