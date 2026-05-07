import type { DepositAssetSymbol } from "@/lib/config";

export type PortfolioSymbol = "SOL" | DepositAssetSymbol;

export type PortfolioAsset = {
  symbol: PortfolioSymbol;
  mint: string | null;
  decimals: number;
  uiAmount: number;
  rawAmount: string;
  source: "native" | "spl-token";
  tokenAccount?: string;
  tokenAccountType?: "associated" | "non-associated" | "aggregated";
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
  executionScore: number;
  executionMode: "stable-main-market" | "apy-fallback";
  selectionReason: string;
  rationale: string[];
  warnings: string[];
};

export type RouteCandidateAnalysis = {
  marketName: string;
  marketAddress: string;
  reserveAddress: string;
  supplyApyPct: number;
  totalSupplyUsd: number;
  maxLtv: number | null;
  executionScore: number;
  riskLevel: "low" | "medium" | "elevated";
  selected: boolean;
  notes: string[];
};

export type RouteDecision = {
  policy: "stablecoin-main-market-first";
  selectedMarketName: string;
  selectedReserveAddress: string;
  summary: string;
  candidates: RouteCandidateAnalysis[];
};

export type RoutePlan = {
  status: "ready" | "no_balance" | "no_market";
  assetSymbol: DepositAssetSymbol;
  route: YieldRoute | null;
  portfolio: PortfolioSnapshot;
  candidates: KaminoReserveMarket[];
  decision: RouteDecision | null;
};
