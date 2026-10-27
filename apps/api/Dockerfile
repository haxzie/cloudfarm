# The sandbox image for bot computers. s3fs + FUSE let S3Mount mount the bot's
# R2 folder; sandbox-shim is the helper the SDK's file and mount APIs drive.
FROM node:24-trixie-slim

RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		ca-certificates curl fuse3 git jq ripgrep s3fs \
	&& rm -rf /var/lib/apt/lists/*

COPY --from=docker.io/cloudflare/sandbox:1.0.3 /usr/local/bin/sandbox-shim /usr/local/bin/sandbox-shim

CMD ["sleep", "infinity"]
