export const QUICKNODE_RPC_URL =
  process.env.QUICKNODE_RPC_URL?.trim() ||
  "https://api.mainnet-beta.solana.com";

export const KAMINO_API_BASE_URL =
  process.env.KAMINO_API_BASE_URL?.trim() || "https://api.kamino.finance";

export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

export const USDC_DECIMALS = 6;

export const USDT_DECIMALS = 6;

export const SUPPORTED_DEPOSIT_ASSETS = {
  USDC: {
    symbol: "USDC",
    mint: USDC_MINT,
    decimals: USDC_DECIMALS,
  },
  USDT: {
    symbol: "USDT",
    mint: USDT_MINT,
    decimals: USDT_DECIMALS,
  },
} as const;

export type DepositAssetSymbol = keyof typeof SUPPORTED_DEPOSIT_ASSETS;

export const DEFAULT_DEPOSIT_ASSET: DepositAssetSymbol = "USDC";

export const MAX_DEPOSIT_AMOUNT = Number(process.env.MAX_DEPOSIT_AMOUNT || "100");

export const SLOT_DURATION_MS = 400;

export function isPlaceholderRpc(endpoint: string) {
  return endpoint.includes("example.solana-mainnet.quiknode.pro");
}
