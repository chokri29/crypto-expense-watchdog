# Walrus Mainnet Publisher — deployment package

This is a provider-neutral deployment recipe for a **private, authenticated Walrus Mainnet publisher** used by Ledger Memory. It targets a small Linux VM with systemd and Nginx; the same files can be adapted to another host. It is not a public, unauthenticated upload service.

> **Deployment status:** these files prepare the service for deployment. They do not provision a VM, create a wallet, fund it, or prove a Mainnet upload. Do not start the publisher until the dedicated wallet has been funded and the operator has explicitly approved that spend.

## Architecture

```text
Ledger Memory browser
  | HTTPS, same-origin app API; short-lived operator session
  v
Vercel backend (issues one-use HS256 JWT per blob)
  | HTTPS PUT /v1/blobs?epochs=... + Authorization: Bearer JWT
  v
Nginx TLS reverse proxy (public DNS, port 443)
  | localhost only
  v
Walrus publisher (JWT verification + replay suppression)
  | Sui Mainnet transactions, paid by dedicated publisher wallet
  v
Walrus Mainnet storage

Reads -> public Mainnet aggregator:
https://aggregator.walrus-mainnet.walrus.space
```

The app's JWT issuer and publisher must share the exact same `WALRUS_JWT_SECRET`. The app currently issues HS256 tokens with a unique `jti`, `iat`, `exp = iat + 90 seconds`, exact `epochs`, `max_size`, and optional `send_object_to`. Therefore this service runs with `--jwt-algorithm HS256 --jwt-expiring-sec 90 --jwt-verify-upload`. The publisher's replay cache rejects reuse of a token; the app creates a fresh token for each blob request.

## 1. Host and network

Use a dedicated Linux VM with:
- A stable public DNS name, e.g. `walrus-publisher.example.com`.
- Ubuntu/Debian or another supported Linux distribution.
- Persistent disk for the Walrus config, wallet config, and publisher sub-wallet directory.
- Inbound TCP 443 only from the internet. Keep publisher port 9001 and metrics port 27183 private.
- Outbound HTTPS access to Sui Mainnet RPC and Walrus storage nodes.

Do not run this publisher inside a short-lived Vercel serverless function. The publisher is a persistent service and stores its sub-wallet state on disk.

## 2. Install and verify the Walrus binary

Follow the current official [Walrus signed-binary verification guide](https://docs.wal.app/docs/operator-guide/verify-binaries) and install a pinned, supported Walrus release. Do not download an arbitrary binary from an unofficial mirror.

The commands below assume the verified binary is installed at `/opt/walrus/bin/walrus`. Create a dedicated OS account and directories:

```bash
sudo useradd --system --home /opt/walrus --shell /usr/sbin/nologin walrus
sudo install -d -o walrus -g walrus -m 0750 /opt/walrus/bin
sudo install -d -o walrus -g walrus -m 0700 /opt/walrus/config/publisher
sudo install -d -o walrus -g walrus -m 0700 /opt/walrus/wallets
```

Install the verified binary at the path above, owned by root and executable by the `walrus` group. Download the official Mainnet client configuration:

```bash
sudo curl -fsSL https://docs.wal.app/setup/client_config_mainnet.yaml \\
  -o /opt/walrus/config/client_config.yaml
sudo chown root:walrus /opt/walrus/config/client_config.yaml
sudo chmod 0640 /opt/walrus/config/client_config.yaml
```

## 3. Create a dedicated publisher wallet — do not use a personal wallet

Generate a new wallet specifically for this publisher:

```bash
sudo -u walrus /opt/walrus/bin/walrus generate-sui-wallet \\
  --path /opt/walrus/config/publisher/sui_client.yaml
sudo cp /opt/walrus/config/client_config.yaml /opt/walrus/config/publisher/client_config.yaml
printf '\\nwallet_config: /opt/walrus/config/publisher/sui_client.yaml\\n' | \\
  sudo tee -a /opt/walrus/config/publisher/client_config.yaml >/dev/null
sudo chown -R walrus:walrus /opt/walrus/config/publisher /opt/walrus/wallets
sudo chmod 0700 /opt/walrus/config/publisher
sudo chmod 0600 /opt/walrus/config/publisher/sui_client.yaml
```

Back up the wallet recovery material securely. Never commit it, upload it to GitHub, or place it in Vercel environment variables.

**Funding is deliberately a separate approval step.** Walrus requires both SUI for gas and WAL for storage. The official operator guide gives a rough minimal-testing guideline of about 2 SUI and 2 WAL per sub-wallet. This package uses `--n-clients 2`, so use the current Walrus guide and live network fees to determine the actual amount before funding. The publisher may fail to start when WAL is insufficient. No wallet funding is performed by this repository.

Official reference: [Operate a Publisher — wallet and funding requirements](https://docs.wal.app/docs/operator-guide/publishers/operating-publisher).

## 4. Configure the publisher JWT secret

Generate two **different** secrets on a trusted machine:

```bash
openssl rand -hex 32   # WALRUS_JWT_SECRET
openssl rand -hex 32   # WALRUS_MAINNET_ADMIN_TOKEN
```

Use the first value as `WALRUS_JWT_SECRET` on both the publisher host and Vercel. Use the second only as `WALRUS_MAINNET_ADMIN_TOKEN` on Vercel. Do not reuse either secret for another purpose.

Create `/etc/walrus/publisher.env` on the publisher host, mode 0600, owned by root:

```dotenv
WALRUS_JWT_SECRET=REPLACE_WITH_THE_FIRST_RANDOM_VALUE
```

The secret is passed to the publisher process through systemd. Do not put it in the Nginx configuration or a public deployment manifest.

## 5. Install the systemd service

Copy [walrus-publisher.service](./walrus-publisher.service) to `/etc/systemd/system/walrus-publisher.service`, then:

```bash
sudo systemctl daemon-reload
# Do not start yet: the wallet must be funded first.
sudo systemctl enable walrus-publisher
```

After funding has been explicitly approved and completed:

```bash
sudo systemctl start walrus-publisher
sudo systemctl status walrus-publisher --no-pager
sudo journalctl -u walrus-publisher -n 100 --no-pager
```

Keep the sub-wallet directory persistent across restarts and backups. Do not delete it while the service is operating.

## 6. Configure TLS reverse proxy

Point DNS to the VM, issue a valid TLS certificate, and adapt [nginx.conf.example](./nginx.conf.example). The example:
- Exposes only `PUT /v1/blobs`.
- Limits request bodies to the app's 256 KiB limit.
- Proxies to localhost; port 9001 is not exposed publicly.
- Applies a conservative per-IP request limit.
- Relies on the publisher's JWT authentication as the authorization boundary.

Do not enable permissive CORS: uploads are sent from the Vercel backend, not directly from the browser. Do not expose publisher metrics publicly.

## 7. Configure Vercel

Set these server-side environment variables for the production deployment:

| Variable | Value |
|---|---|
| `WALRUS_NETWORK` | `mainnet` |
| `WALRUS_PUBLISHER_URL` | `https://walrus-publisher.example.com` (your TLS hostname) |
| `WALRUS_AGGREGATOR_URL` | `https://aggregator.walrus-mainnet.walrus.space` |
| `WALRUS_MEMORY_EPOCHS` | `10` (or another reviewed value) |
| `WALRUS_JWT_SECRET` | Exact same value as the publisher host |
| `WALRUS_MAINNET_ADMIN_TOKEN` | The separate second random value |
| `WALRUS_SUI_OWNER_ADDRESS` | Optional Sui address to receive blob objects |

Do not prefix any of these with `VITE_`. Never expose either secret to the browser bundle. The app exchanges the operator token for a 15-minute HttpOnly, SameSite=Strict cookie; the raw token is not saved in browser storage.

Keep `WALRUS_NETWORK=testnet` until the publisher is deployed, authenticated, and its wallet is funded. Changing this variable switches the backend's Walrus network; it does not migrate Testnet blobs to Mainnet. Testnet and Mainnet root IDs are stored separately in each browser.

## 8. Readiness checks

Before any Mainnet write, verify each item:

- [ ] Dedicated publisher wallet created and recovery material secured.
- [ ] Wallet funded with reviewed SUI and WAL amounts (requires explicit spend approval).
- [ ] Publisher service starts and remains healthy.
- [ ] JWT authentication enabled; a request without a token is rejected.
- [ ] JWT parameter verification enabled; incorrect epochs/size are rejected.
- [ ] Replay suppression rejects reuse of the same `jti`.
- [ ] TLS hostname works and port 9001 is not publicly reachable.
- [ ] Vercel and publisher use the exact same JWT secret.
- [ ] Vercel has the separate operator token and Mainnet environment variables.
- [ ] A controlled small Mainnet write succeeds and is read back from the Mainnet aggregator.

The Memory tab's readiness label reports **configuration only**. It does not claim that the publisher is reachable or funded. A Mainnet write is complete only after the controlled write and aggregator readback succeed.

## 9. Troubleshooting

- **Publisher does not start / insufficient WAL coins:** check the dedicated wallet and sub-wallet balances; do not repeatedly restart without diagnosing the funding error.
- **401 from publisher:** compare the exact JWT secret, algorithm, expiration setting, system clocks, and ensure every upload gets a fresh unique `jti`.
- **JWT upload-parameter rejection:** verify the app's `epochs`, `max_size`, and optional `send_object_to` claims match the query and request body.
- **Vercel reports publisher timeout:** check service logs, reverse-proxy logs, network reachability, and publisher load.
- **Publisher succeeds but app cannot load a blob:** verify the Mainnet aggregator URL and read-after-write propagation.

## Official Walrus references

- [Mainnet Publisher Production Guide](https://docs.wal.app/docs/operator-guide/publishers/mainnet-production-guide)
- [Operate a Publisher](https://docs.wal.app/docs/operator-guide/publishers/operating-publisher)
- [Authenticated Publisher and JWT claims](https://docs.wal.app/docs/operator-guide/publishers/auth-publisher)
- [Network Reference](https://docs.wal.app/docs/network-reference)
