import { Connection, PublicKey } from "@solana/web3.js";
import {
  QUICKNODE_RPC_URL,
  SUPPORTED_DEPOSIT_ASSETS,
  isPlaceholderRpc,
} from "@/lib/config";
import type { PortfolioAsset, PortfolioSnapshot } from "@/lib/types";

const LAMPORTS_PER_SOL = 1_000_000_000;

export function getConnection() {
  const endpoint = isPlaceholderRpc(QUICKNODE_RPC_URL)
    ? "https://api.mainnet-beta.solana.com"
    : QUICKNODE_RPC_URL;

  return new Connection(endpoint, {
    commitment: "confirmed",
    confirmTransactionInitialTimeout: 60_000,
  });
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
  const accounts = await connection.getParsedTokenAccountsByOwner(owner, {
    mint: new PublicKey(asset.mint),
  });

  const raw = accounts.value.reduce((sum, account) => {
    const parsed = account.account.data.parsed;
    const amount = parsed.info.tokenAmount.amount as string;
    return sum + BigInt(amount);
  }, 0n);

  return {
    symbol: asset.symbol,
    mint: asset.mint,
    decimals: asset.decimals,
    uiAmount: Number(raw) / 10 ** asset.decimals,
    rawAmount: raw.toString(),
    source: "spl-token",
  };
}

export async function fetchPortfolio(wallet: string): Promise<PortfolioSnapshot> {
  const owner = parseWalletPublicKey(wallet);
  const connection = getConnection();

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
}
