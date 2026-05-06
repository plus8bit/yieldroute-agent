import {
  DEFAULT_DEPOSIT_ASSET,
  MAX_DEPOSIT_AMOUNT,
  SUPPORTED_DEPOSIT_ASSETS,
  type DepositAssetSymbol,
} from "@/lib/config";
import type {
  KaminoReserveMarket,
  PortfolioSnapshot,
  RoutePlan,
  YieldRoute,
} from "@/lib/types";

const MIN_ROUTE_TVL_USD = 100_000;

function decimalToRawAmount(amount: number, decimals: number) {
  return Math.floor(amount * 10 ** decimals).toString();
}

export function planUsdcDepositRoute(params: {
  wallet: string;
  portfolio: PortfolioSnapshot;
  markets: KaminoReserveMarket[];
  assetSymbol?: DepositAssetSymbol;
  amountUi?: number;
  maxAmount?: number;
}): RoutePlan {
  const assetSymbol = params.assetSymbol || DEFAULT_DEPOSIT_ASSET;
  const asset = SUPPORTED_DEPOSIT_ASSETS[assetSymbol];
  const portfolioAsset = params.portfolio.assets.find(
    (item) => item.symbol === assetSymbol,
  );
  const idleAmount = portfolioAsset?.uiAmount || 0;

  if (idleAmount <= 0) {
    return {
      status: "no_balance",
      assetSymbol,
      route: null,
      portfolio: params.portfolio,
      candidates: params.markets.slice(0, 5),
    };
  }

  const candidates = params.markets
    .filter((market) => market.totalSupplyUsd >= MIN_ROUTE_TVL_USD)
    .filter((market) => market.maxLtv === null || market.maxLtv > 0)
    .slice(0, 5);

  const best = candidates[0];

  if (!best) {
    return {
      status: "no_market",
      assetSymbol,
      route: null,
      portfolio: params.portfolio,
      candidates: params.markets.slice(0, 5),
    };
  }

  const cap = params.maxAmount || MAX_DEPOSIT_AMOUNT;
  const requested =
    params.amountUi && Number.isFinite(params.amountUi) && params.amountUi > 0
      ? params.amountUi
      : cap;
  const amountUi = Math.max(0, Math.min(idleAmount, requested, cap));

  const route: YieldRoute = {
    action: "kamino_deposit",
    wallet: params.wallet,
    inputMint: asset.mint,
    inputSymbol: assetSymbol,
    amountUi,
    amountRaw: decimalToRawAmount(amountUi, asset.decimals),
    marketName: best.marketName,
    marketAddress: best.marketAddress,
    reserveAddress: best.reserveAddress,
    expectedSupplyApyPct: best.supplyApyPct,
    totalSupplyUsd: best.totalSupplyUsd,
    rationale: [
      `Wallet has idle ${assetSymbol}.`,
      `Selected Kamino reserve has the highest available ${assetSymbol} supply APY after route safety filters.`,
      `Route filters out reserves below $${MIN_ROUTE_TVL_USD.toLocaleString("en-US")} TVL and reserves with maxLtv=0 to avoid closed or deposit-limited markets.`,
      "Route keeps signing client-side through Solflare; backend only returns an unsigned transaction.",
    ],
    warnings: [
      "APY is variable and can change after the transaction is signed.",
      "MVP route planner does not yet include user-specific health factor checks for existing Kamino obligations.",
    ],
  };

  return {
    status: "ready",
    assetSymbol,
    route,
    portfolio: params.portfolio,
    candidates,
  };
}
