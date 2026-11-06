# Walrus Mainnet preparation

This guide prepares Ledger Memory for a privately operated, authenticated Walrus Mainnet publisher. It does **not** deploy a publisher, fund a wallet, or enable Mainnet writes by itself.

## Current application behavior

- The default remains Walrus Testnet. Existing Testnet endpoints and unauthenticated Testnet publishing are preserved.
- Mainnet is opt-in with `WALRUS_NETWORK=mainnet`.
- Mainnet reads default to Mysten Labs' public aggregator: `https://aggregator.walrus-mainnet.walrus.space`.
- Mainnet writes require a privately operated publisher URL and a shared JWT secret.
- The backend signs a fresh HS256 JWT for each individual blob upload. Each token has a unique `jti`, a short expiry, an exact `epochs` claim, and a `max_size` claim. The bearer token is never sent to the browser.
- Every published manifest, snapshot, and memory record is read back from the configured aggregator before the API reports success.

## Environment variables

Configure these only when the private Mainnet publisher has been deployed:

| Variable | Mainnet value |
|---|---|
| `WALRUS_NETWORK` | `mainnet` |
| `WALRUS_PUBLISHER_URL` | HTTPS URL of your private authenticated publisher |
| `WALRUS_AGGREGATOR_URL` | Optional; defaults to `https://aggregator.walrus-mainnet.walrus.space` |
| `WALRUS_JWT_SECRET` | Same 32-byte-or-longer secret configured on the publisher |
| `WALRUS_MEMORY_EPOCHS` | Storage duration, 1–30; application default is 10 |
| `WALRUS_SUI_OWNER_ADDRESS` | Optional Sui address to receive created Blob objects |

Generate a secret on a trusted machine with:

```sh
printf '0x'
openssl rand -hex 32
```

Use the exact same secret in the publisher's `--jwt-decode-secret` setting and the backend's `WALRUS_JWT_SECRET`. Do not commit it, paste it into chat, or expose it as a `VITE_*` variable. The backend accepts a `0x`-prefixed hexadecimal secret or a plain UTF-8 secret of at least 32 bytes.

## Publisher host preparation (no funding yet)

1. Choose a persistent host. A local Linux machine or temporary Codespace can be used for setup checks; a stopped Codespace is not a production endpoint.
2. Install the official Walrus CLI/binary and download the Mainnet client configuration from the Walrus documentation.
3. Create a dedicated publisher wallet and a persistent sub-wallet directory. Do not reuse a personal wallet or commit wallet files.
4. Configure the publisher to bind to localhost during initial setup. Put it behind HTTPS and a private network boundary/reverse proxy before allowing the Vercel backend to reach it.
5. Enable publisher JWT authentication with HS256, a short token lifetime (90 seconds for this app), and upload-parameter verification. Ensure replay suppression is enabled and has enough cache capacity.
6. Keep the service stopped until its dedicated publisher wallet has sufficient Mainnet SUI and WAL. The official Walrus operator guide gives approximately 2 SUI and 2 WAL per sub-wallet as a minimal-testing guideline; actual needs depend on concurrency and storage duration.

The documented authenticated publisher options are:

- `--jwt-decode-secret`
- `--jwt-algorithm HS256`
- `--jwt-expiring-sec 90`
- `--jwt-verify-upload`

The publisher's JWT secret must match `WALRUS_JWT_SECRET` on the backend. The backend creates a new one-use token per PUT because the publisher rejects a reused `jti`.

## Application activation checklist

Do not set `WALRUS_NETWORK=mainnet` on the production Vercel deployment until all of these are true:

- [ ] A private authenticated Mainnet publisher is reachable over HTTPS.
- [ ] Its publisher wallet is deliberately funded with Mainnet SUI and WAL.
- [ ] The publisher JWT secret matches the backend secret.
- [ ] The backend has `WALRUS_NETWORK=mainnet`, `WALRUS_PUBLISHER_URL`, and `WALRUS_JWT_SECRET`.
- [ ] The Mainnet aggregator is reachable.
- [ ] A controlled single-blob write and readback succeeds.
- [ ] The app is confirmed to use a Mainnet-specific root pointer, not a Testnet manifest.
- [ ] The 12 synthetic demo memory records are published and all blob IDs are read back successfully.

Until then, leave the app on Testnet. No WAL or SUI purchase is required for this preparation work.

## Important security notes

- Never run an unauthenticated Mainnet publisher.
- Keep publisher wallet files, JWT secrets, and publisher administration endpoints off GitHub and out of frontend environment variables.
- Apply request rate limits and quotas at the backend/reverse proxy. JWT size/epoch claims constrain an upload but do not implement a financial budget.
- Walrus blobs are public. Do not publish private notes, credentials, or sensitive financial habits.
- Testnet and Mainnet blob IDs/manifests are network-specific and must not be mixed.

## Official references

- [Mainnet Publisher Production Guide](https://docs.wal.app/docs/operator-guide/publishers/mainnet-production-guide)
- [Use the Authenticated Publisher](https://docs.wal.app/docs/operator-guide/publishers/auth-publisher)
- [Operate a Publisher](https://docs.wal.app/docs/operator-guide/publishers/operating-publisher)
- [Walrus Network Reference](https://docs.wal.app/docs/network-reference)
