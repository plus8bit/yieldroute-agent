import { Connection, PublicKey } from "@solana/web3.js";
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
const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

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
  const [associatedTokenAccount] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const account = await connection.getParsedAccountInfo(
    associatedTokenAccount,
    "confirmed",
  );
  let raw = 0n;

  if (
    account.value &&
    "parsed" in account.value.data &&
    account.value.data.parsed?.type === "account"
  ) {
    const parsed = account.value.data.parsed;
    const info = parsed.info;
    const accountMint = info.mint as string | undefined;
    const accountOwner = info.owner as string | undefined;

    if (accountMint === asset.mint && accountOwner === owner.toBase58()) {
      raw = BigInt(info.tokenAmount.amount as string);
    }
  }

  return {
    symbol: asset.symbol,
    mint: asset.mint,
    decimals: asset.decimals,
    uiAmount: Number(raw) / 10 ** asset.decimals,
    rawAmount: raw.toString(),
    source: "spl-token",
    tokenAccount: associatedTokenAccount.toBase58(),
    tokenAccountType: "associated",
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
