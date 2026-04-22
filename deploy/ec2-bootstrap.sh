#!/bin/bash
# ec2-bootstrap.sh — user-data script for a bowser demo EC2 instance.
#
# Pass as `user_data` on an Amazon Linux 2023 or Ubuntu 24.04 instance with:
#   - an IAM instance profile granting s3:GetObject on the data bucket
#   - port 80 open to the world (security group)
#
# Usage (edit these first):
#   IMAGE=ghcr.io/opera-adt/bowser:latest
#   CATALOG_S3=s3://bowser-demo-data/catalog.toml
#
# Then upload this as instance user-data; cloud-init will run it on boot.
set -euo pipefail

IMAGE="${IMAGE:-ghcr.io/opera-adt/bowser:latest}"
CATALOG_S3="${CATALOG_S3:-s3://bowser-demo-data/catalog.toml}"
CATALOG_LOCAL=/opt/bowser/catalog.toml
LOG=/var/log/bowser-bootstrap.log

exec > >(tee -a "$LOG") 2>&1
echo "[bootstrap] starting at $(date -Iseconds)"

# 1. Install docker + awscli.
#
# On Ubuntu 24.04 (noble) the `awscli` apt package was removed, so we install
# AWS CLI v2 from the upstream bundle instead of `apt install awscli`. That's
# also what AWS recommends — v1 hit end-of-life in 2025.
if ! command -v docker >/dev/null; then
  if command -v dnf >/dev/null; then
    dnf install -y docker
    systemctl enable --now docker
  else
    apt-get update
    apt-get install -y docker.io unzip curl
    systemctl enable --now docker
  fi
fi
if ! command -v aws >/dev/null; then
  tmp=$(mktemp -d)
  curl -sSL https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip \
      -o "$tmp/awscliv2.zip"
  (cd "$tmp" && unzip -q awscliv2.zip && ./aws/install)
  rm -rf "$tmp"
fi

# 2. Pull the catalog from S3. We mount it into the container so catalog
#    updates = re-upload + restart, no image rebuild.
mkdir -p /opt/bowser
aws s3 cp "$CATALOG_S3" "$CATALOG_LOCAL"
echo "[bootstrap] catalog fetched ($(wc -l < "$CATALOG_LOCAL") lines)"

# 3. Grab short-lived IAM role credentials via IMDSv2 and inject them into
#    the container. Reason: s3fs (via aiobotocore) hits a ContextVar conflict
#    when refreshing creds from zarr's sync-over-async path on our pixi
#    runtime; passing them as env vars bypasses the async credential chain.
#    See TECH_DEBT.md item #0 for the upstream issue.
#
#    IMDSv2 (token-based) is used because many modern AMIs disable IMDSv1 by
#    default.
TOKEN=$(curl -sS -X PUT http://169.254.169.254/latest/api/token \
    -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
H="X-aws-ec2-metadata-token: $TOKEN"
ROLE=$(curl -sS -H "$H" http://169.254.169.254/latest/meta-data/iam/security-credentials/)
CREDS=$(curl -sS -H "$H" http://169.254.169.254/latest/meta-data/iam/security-credentials/"$ROLE")
AK=$(echo "$CREDS" | python3 -c "import json,sys; print(json.load(sys.stdin)['AccessKeyId'])")
SK=$(echo "$CREDS" | python3 -c "import json,sys; print(json.load(sys.stdin)['SecretAccessKey'])")
ST=$(echo "$CREDS" | python3 -c "import json,sys; print(json.load(sys.stdin)['Token'])")
REGION=$(curl -sS -H "$H" http://169.254.169.254/latest/meta-data/placement/region)

# 4. Pull + run the image. Port 80 → 8080 in the container.
docker pull "$IMAGE"
docker rm -f bowser 2>/dev/null || true

docker run -d --name bowser \
  --restart unless-stopped \
  -p 80:8080 \
  -v /opt/bowser:/data:ro \
  -e BOWSER_CATALOG_FILE=/data/catalog.toml \
  -e AWS_REGION="$REGION" \
  -e AWS_DEFAULT_REGION="$REGION" \
  -e AWS_ACCESS_KEY_ID="$AK" \
  -e AWS_SECRET_ACCESS_KEY="$SK" \
  -e AWS_SESSION_TOKEN="$ST" \
  "$IMAGE" \
  bowser run --host 0.0.0.0 --port 8080 --workers 4 --log-level info

echo "[bootstrap] done at $(date -Iseconds)"
