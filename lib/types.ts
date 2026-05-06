import type { DepositAssetSymbol } from "@/lib/config";

export type PortfolioSymbol = "SOL" | DepositAssetSymbol;

export type PortfolioAsset = {
  symbol: PortfolioSymbol;
  mint: string | null;
  decimals: number;
  uiAmount: number;
  rawAmount: string;
  source: "native" | "spl-token";
};

export type PortfolioSnapshot = {
  wallet: string;
  rpcEndpoint: string;
  assets: PortfolioAsset[];
  fetchedAt: string;
};

export type KaminoReserveMarket = {
  marketName: string;
  marketAddress: string;
  reserveAddress: string;
  liquidityToken: string;
  liquidityTokenMint: string;
  supplyApyPct: number;
  borrowApyPct: number;
  totalSupplyUsd: number;
  totalBorrowUsd: number;
  maxLtv: number | null;
};

export type YieldRoute = {
  action: "kamino_deposit";
  wallet: string;
  inputMint: string;
  inputSymbol: DepositAssetSymbol;
  amountUi: number;
  amountRaw: string;
  marketName: string;
  marketAddress: string;
  reserveAddress: string;
  expectedSupplyApyPct: number;
  totalSupplyUsd: number;
  rationale: string[];
  warnings: string[];
};

export type RoutePlan = {
  status: "ready" | "no_balance" | "no_market";
  assetSymbol: DepositAssetSymbol;
  route: YieldRoute | null;
  portfolio: PortfolioSnapshot;
  candidates: KaminoReserveMarket[];
};
