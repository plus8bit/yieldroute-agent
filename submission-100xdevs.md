# YieldRoute Agent - 100xDevs Frontier Submission Pack

## Positioning

YieldRoute Agent is now positioned for the 100xDevs Frontier track as an explainable Solana DeFi intent router, not just a basic deposit dashboard.

The original MVP proved the critical transaction flow: Solflare wallet connection, QuickNode-backed portfolio reads, Kamino market data, unsigned transaction generation, local Solflare signing, and successful USDC/USDT deposits on Solana Mainnet.

The 100xDevs upgrade adds **Route Intelligence**: an explainable route selection layer that compares eligible Kamino reserves by execution reliability, TVL, LTV, APY, risk level, and policy notes. The router prioritizes stable Main Market execution for USDC/USDT instead of blindly chasing the highest APY. This makes the product more useful for real users because it explains where the app routes liquidity and why that route is safer or more reliable for a first-click stablecoin deposit.

## Product Summary

YieldRoute Agent helps Solana users put idle USDC and USDT to work in Kamino from one simple interface. The app scans a connected Solflare wallet, evaluates eligible Kamino reserves, explains the selected route through Route Intelligence, builds an unsigned deposit transaction on the backend, and lets the user sign locally inside Solflare.

Private keys never touch the backend. The backend only prepares unsigned transaction bytes and returns simulation diagnostics.

## Core Differentiator

Most DeFi dashboards show numbers and leave the user to decide. YieldRoute Agent turns the deposit into an intent-based flow:

1. Detect idle stablecoins.
2. Evaluate route candidates.
3. Explain the chosen route.
4. Build a safe unsigned transaction.
5. Let the user sign locally.

Route Intelligence shows:

- selected Kamino market and reserve;
- execution score;
- risk level;
- supply APY;
- reserve TVL;
- max LTV;
- why Main Market was selected;
- why APY-only alternatives were not selected for primary execution.

## Superteam Form Copy

### Link to Your Submission

```text
https://yieldroute-agent.vercel.app
```

### Tweet Link

```text
Paste your X post link here after publishing the thread
```

### Project Title

```text
YieldRoute Agent
```

### Project Description

```text
YieldRoute Agent is an explainable Solana DeFi intent router for idle USDC and USDT. It connects to Solflare, reads wallet balances through Solana RPC, evaluates Kamino lending routes with Route Intelligence, and builds an unsigned deposit transaction that the user signs locally in the browser.
```

### Project Github Link

```text
https://github.com/plus8bit/yieldroute-agent
```

### Project Website

```text
https://yieldroute-agent.vercel.app
```

### Did you submit this project to the official Frontier Hackathon on Colosseum? (Yes/No)

```text
Yes
```

### Link to your project's Colosseum profile

```text
https://arena.colosseum.org/projects/explore/solana-whale-tracker
```

Note: if you create a dedicated Colosseum project page for YieldRoute Agent, replace the link above with the new YieldRoute Agent Colosseum URL.

### Link to your Loom / Demo Video

```text
Paste your YouTube/Loom link here
```

### Presentation Link

```text

```

### Project Twitter Profile Link

```text
https://x.com/plus8bit
```

### Anything Else?

```text
Built for the 100xDevs Frontier track. The product is live on Solana Mainnet and supports both USDC and USDT deposits into Kamino. Route Intelligence compares eligible reserves by execution score, TVL, LTV, APY, and risk level, then explains why the selected route is used. The backend never receives private keys or signatures; it only returns unsigned transaction bytes for local Solflare signing.
```

## YouTube Demo

### Title

```text
YieldRoute Agent Demo | Explainable Solana DeFi Routing with Solflare + Kamino
```

### Description

```text
YieldRoute Agent is an explainable Solana DeFi intent router for idle USDC and USDT.

In this demo, I connect Solflare, scan a Mainnet wallet, review the Route Intelligence panel, and build a Kamino deposit transaction that is signed locally inside the browser.

Route Intelligence explains why the app chooses a stable Kamino route instead of blindly chasing the highest APY. It compares eligible reserves by execution score, risk level, APY, TVL, and max LTV.

Built with:
- Solflare Wallet Adapter for client-side signing
- Solana RPC / QuickNode-ready backend for portfolio reads
- Kamino market data and deposit transaction builder
- Next.js + Vercel for the frontend and serverless API

App: https://yieldroute-agent.vercel.app
Code: https://github.com/plus8bit/yieldroute-agent
X: https://x.com/plus8bit

Private keys never touch the backend. The server only prepares unsigned transaction bytes, and the user signs securely in Solflare.
```

## Demo Video Script

Target length: 90-120 seconds.

### 1. Open

```text
Hi, this is YieldRoute Agent, an explainable Solana DeFi intent router built for the 100xDevs Frontier track.
```

Show:

- deployed app: `https://yieldroute-agent.vercel.app`;
- title area with Solflare branding;
- wallet disconnected state.

### 2. Problem

```text
Many Solana users hold idle USDC or USDT, but choosing a lending route manually means checking APY, liquidity, risk, and transaction safety across multiple screens.
```

Show:

- portfolio area;
- USDC/USDT assets after wallet connection.

### 3. Connect Wallet

```text
I connect Solflare. The app reads the wallet portfolio through Solana RPC and detects stablecoin balances without requesting any signature.
```

Show:

- connect Solflare;
- balances for SOL, USDC, USDT;
- transaction boundary text.

### 4. Route Intelligence

```text
The key feature for this version is Route Intelligence. Instead of blindly selecting the highest APY, the router compares Kamino candidates using execution score, TVL, max LTV, risk level, and APY.
```

Show:

- Route Plan card;
- execution score;
- `stable-main-market` badge;
- Route Intelligence section;
- Main Market selected;
- Altcoins Market shown as higher APY but elevated risk / lower TVL.

Important line:

```text
This is why the app can choose a more reliable Main Market route even when another market has a higher APY.
```

### 5. Build and Sign Transaction

```text
When I enter an amount and click Approve & Deposit, the backend builds an unsigned Kamino transaction. The browser deserializes the VersionedTransaction and passes it to Solflare for local signing.
```

Show:

- amount input;
- MAX button if useful;
- Approve & Deposit;
- Solflare approval popup;
- transaction terminal logs.

### 6. Confirmation

```text
After signing, the transaction is sent to Mainnet and the app shows an active position with links to Kamino and Solscan.
```

Show:

- success state;
- Active Positions;
- Manage on Kamino;
- optional Kamino page showing the position.

### 7. Close

```text
YieldRoute Agent is live on Mainnet, supports USDC and USDT, and keeps private keys fully inside the user's wallet.
```

Show:

- app URL;
- GitHub URL.

## X Thread

### Tweet 1

```text
Shipped YieldRoute Agent for the 100xDevs Frontier track.

It is an explainable Solana DeFi intent router that finds idle USDC/USDT, evaluates Kamino routes, and builds a client-signed deposit tx in one click.

🧵 #Solana #Superteam #100xDevs
```

### Tweet 2

```text
New in this version: Route Intelligence.

Instead of blindly chasing the highest APY, the router compares Kamino candidates by:

• execution score
• TVL
• max LTV
• APY
• risk level

Then it explains why the selected route is used.
```

### Tweet 3

```text
Built with:

🔐 @solflare_wallet for local signing
📈 @KaminoFinance for stablecoin lending routes
⚡ Solana RPC / QuickNode-ready backend for portfolio reads

The backend only returns unsigned tx bytes. Private keys never leave the wallet.
```

### Tweet 4

```text
Try it on Mainnet:

App: https://yieldroute-agent.vercel.app
Code: https://github.com/plus8bit/yieldroute-agent

Supports USDC and USDT deposits into Kamino.
```

## Short Pitch

```text
YieldRoute Agent turns stablecoin yield into an intent-based workflow. A user connects Solflare, chooses USDC or USDT, reviews an explainable Kamino route decision, and signs a deposit transaction locally without exposing private keys to the backend.
```

## Technical Architecture

```text
Browser:
Solflare Wallet Adapter -> wallet public key -> dashboard state -> amount input -> VersionedTransaction.deserialize -> signTransaction -> sendRawTransaction

Backend:
/api/route/plan -> portfolio RPC read -> Kamino market metrics -> stablecoin route scoring -> RouteDecision response

/api/tx/build -> validates selected route -> resolves token accounts and ATA state -> calls Kamino transaction builder -> inserts ATA sync pre-instructions if required -> simulates transaction -> returns unsigned base64 transaction

On-chain:
User signs locally in Solflare -> transaction is sent to Solana Mainnet -> Kamino KLend deposit instruction updates the user's lending position
```

## Submission Checklist

- [ ] App URL opens for everyone.
- [ ] GitHub repository is public.
- [ ] Demo video is uploaded as Unlisted, not Private.
- [ ] X thread is published and tweet link copied.
- [ ] Superteam form uses the 100xDevs-specific description above.
- [ ] If possible, create a dedicated Colosseum project page for YieldRoute Agent and replace the current Colosseum link.
