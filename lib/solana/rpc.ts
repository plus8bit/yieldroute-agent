import { Connection, PublicKey } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  QUICKNODE_RPC_URL,
  SUPPORTED_DEPOSIT_ASSETS,
  isPlaceholderRpc,
} from "@/lib/config";
import {
  PUBLIC_SOLANA_RPC_ENDPOINT,
  isRpcAccessDenied,
} from "@/lib/solana/rpc-errors";
import type { PortfolioAsset, PortfolioSnapshot } from "@/lib/types";

const LAMPORTS_PER_SOL = 1_000_000_000;

export function createSolanaConnection(endpoint: string) {
  return new Connection(endpoint, {
    commitment: "confirmed",
    confirmTransactionInitialTimeout: 60_000,
  });
}

export function getPrimaryRpcEndpoint() {
  return isPlaceholderRpc(QUICKNODE_RPC_URL)
    ? PUBLIC_SOLANA_RPC_ENDPOINT
    : QUICKNODE_RPC_URL;
}

export function getConnection() {
  return createSolanaConnection(getPrimaryRpcEndpoint());
}

export function getFallbackConnection() {
  return createSolanaConnection(PUBLIC_SOLANA_RPC_ENDPOINT);
}

export async function withRpcFallback<T>(
  operation: (connection: Connection, endpoint: string) => Promise<T>,
) {
  const primaryEndpoint = getPrimaryRpcEndpoint();
  const primaryConnection = createSolanaConnection(primaryEndpoint);

  try {
    return await operation(primaryConnection, primaryEndpoint);
  } catch (error) {
    if (
      !isRpcAccessDenied(error) ||
      primaryEndpoint === PUBLIC_SOLANA_RPC_ENDPOINT
    ) {
      throw error;
    }

    const fallbackConnection = getFallbackConnection();
    return operation(fallbackConnection, PUBLIC_SOLANA_RPC_ENDPOINT);
  }
}

export function parseWalletPublicKey(wallet: string) {
  try {
    return new PublicKey(wallet);
  } catch {
    throw new Error("Invalid Solana wallet public key");
  }
}

async function fetchSplTokenAsset(
  connection: Connection,
  owner: PublicKey,
  asset: (typeof SUPPORTED_DEPOSIT_ASSETS)[keyof typeof SUPPORTED_DEPOSIT_ASSETS],
): Promise<PortfolioAsset> {
  const mint = new PublicKey(asset.mint);
  const associatedTokenAccount = getAssociatedTokenAddressSync(
    mint,
    owner,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const accounts = await connection.getParsedTokenAccountsByOwner(
    owner,
    { mint },
    "confirmed",
  );

  let raw = 0n;
  let largestRaw = 0n;
  let largestTokenAccount = associatedTokenAccount.toBase58();
  let hasAssociatedBalance = false;
  let nonZeroAccounts = 0;

  for (const tokenAccount of accounts.value) {
    if (!tokenAccount.account.owner.equals(TOKEN_PROGRAM_ID)) continue;

    const data = tokenAccount.account.data;
    if (!("parsed" in data) || data.parsed?.type !== "account") continue;

    const parsed = data.parsed;
    const info = parsed.info;
    const accountMint = info.mint as string | undefined;
    const accountOwner = info.owner as string | undefined;

    if (accountMint === asset.mint && accountOwner === owner.toBase58()) {
      const accountRaw = BigInt(info.tokenAmount.amount as string);
      raw += accountRaw;

      if (accountRaw > 0n) {
        nonZeroAccounts += 1;
      }

      if (tokenAccount.pubkey.equals(associatedTokenAccount) && accountRaw > 0n) {
        hasAssociatedBalance = true;
      }

      if (accountRaw > largestRaw) {
        largestRaw = accountRaw;
        largestTokenAccount = tokenAccount.pubkey.toBase58();
      }
    }
  }

  if (asset.symbol === "USDC") {
    const associatedTokenAccountRaw =
      accounts.value
        .map((tokenAccount) => {
          if (!tokenAccount.pubkey.equals(associatedTokenAccount)) return 0n;

          const data = tokenAccount.account.data;
          if (!("parsed" in data) || data.parsed?.type !== "account") return 0n;

          const info = data.parsed.info;
          if (info.mint !== asset.mint || info.owner !== owner.toBase58()) {
            return 0n;
          }

          return BigInt(info.tokenAmount.amount as string);
        })
        .find((accountRaw) => accountRaw > 0n) ?? 0n;

    return {
      symbol: asset.symbol,
      mint: asset.mint,
      decimals: asset.decimals,
      uiAmount: Number(associatedTokenAccountRaw) / 10 ** asset.decimals,
      rawAmount: associatedTokenAccountRaw.toString(),
      source: "spl-token",
      tokenAccount: associatedTokenAccount.toBase58(),
      tokenAccountType: "associated",
    };
  }

  const tokenAccountType =
    nonZeroAccounts > 1 || hasAssociatedBalance
      ? "aggregated"
      : largestTokenAccount === associatedTokenAccount.toBase58()
        ? "associated"
        : "non-associated";

  return {
    symbol: asset.symbol,
    mint: asset.mint,
    decimals: asset.decimals,
    uiAmount: Number(raw) / 10 ** asset.decimals,
    rawAmount: raw.toString(),
    source: "spl-token",
    tokenAccount: largestTokenAccount,
    tokenAccountType,
  };
}

export async function fetchPortfolio(wallet: string): Promise<PortfolioSnapshot> {
  const owner = parseWalletPublicKey(wallet);

  return withRpcFallback(async (connection) => {
    const [lamports, ...tokenAssets] = await Promise.all([
      connection.getBalance(owner),
      ...Object.values(SUPPORTED_DEPOSIT_ASSETS).map((asset) =>
        fetchSplTokenAsset(connection, owner, asset),
      ),
    ]);

    const assets: PortfolioAsset[] = [
      {
        symbol: "SOL",
        mint: null,
        decimals: 9,
        uiAmount: lamports / LAMPORTS_PER_SOL,
        rawAmount: String(lamports),
        source: "native",
      },
      ...tokenAssets,
    ];

    return {
      wallet: owner.toBase58(),
      rpcEndpoint: connection.rpcEndpoint,
      assets,
      fetchedAt: new Date().toISOString(),
    };
  });
}
