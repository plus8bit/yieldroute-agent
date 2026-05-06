# YieldRoute Agent

MVP for the Eitherway track: Solflare x Kamino x Quicknode.

The current version implements the data and transaction pipeline:

- read wallet SOL, USDC and USDT balances through Solana RPC;
- fetch Kamino markets and USDC/USDT reserve metrics;
- select a deposit route for idle USDC or USDT;
- build an unsigned Kamino deposit transaction for client-side Solflare signing.
- connect Solflare and submit signed transaction bytes from the browser.

## Run

```bash
npm install
npm run dev
```

Local server:

```text
http://localhost:3000
```

## Environment

Copy `.env.example` to `.env.local` and set:

```bash
QUICKNODE_RPC_URL="https://your-solana-mainnet.quiknode.pro/..."
NEXT_PUBLIC_SOLANA_RPC_URL="https://api.mainnet-beta.solana.com"
KAMINO_API_BASE_URL="https://api.kamino.finance"
MAX_DEPOSIT_AMOUNT="100"
```

If `QUICKNODE_RPC_URL` is still the placeholder, the backend falls back to the public Solana mainnet RPC.
`NEXT_PUBLIC_SOLANA_RPC_URL` is used by the browser `ConnectionProvider` and is visible to users.

## API

### POST /api/portfolio

Request:

```json
{ "wallet": "SOLANA_PUBLIC_KEY" }
```

Returns normalized SOL, USDC and USDT balances.

### GET /api/kamino/markets

Returns fetched reserves from Kamino markets sorted by supply APY.

Optional query:

```text
?assetSymbol=USDC
?assetSymbol=USDT
```

### POST /api/route/plan

Request:

```json
{
  "wallet": "SOLANA_PUBLIC_KEY",
  "assetSymbol": "USDC",
  "amountUi": 25,
  "maxAmount": 25
}
```

Returns the selected Kamino deposit route for the requested asset.

Route planner safety filters:

- minimum reserve TVL: 100,000 USD;
- exclude reserves with `maxLtv=0`;
- cap deposit amount by `MAX_DEPOSIT_AMOUNT` or request override.

### POST /api/tx/build

Request:

```json
{
  "wallet": "SOLANA_PUBLIC_KEY",
  "route": { "...": "route returned by /api/route/plan" }
}
```

Returns:

- unsigned serialized transaction in base64;
- transaction kind (`versioned` or `legacy`);
- simulation result;
- `signOnClient: true`.

The backend does not sign and does not submit transactions.

## Frontend Execution Flow

1. User connects Solflare in the browser.
2. The dashboard calls `POST /api/route/plan`, which returns both portfolio and route data.
3. User selects USDC or USDT and enters the deposit amount.
4. User clicks `Approve & Deposit`.
5. The dashboard calls `POST /api/tx/build`.
6. The server returns a base64 unsigned `VersionedTransaction`.
7. The browser runs `VersionedTransaction.deserialize(Buffer.from(txBase64, "base64"))`.
8. Solflare receives the transaction object through `signTransaction`.
9. The signed bytes are submitted with `connection.sendRawTransaction`.
10. The browser confirms the signature with `connection.confirmTransaction`.
