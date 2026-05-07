import {
  DEFAULT_DEPOSIT_ASSET,
  MAX_DEPOSIT_AMOUNT,
  SUPPORTED_DEPOSIT_ASSETS,
  type DepositAssetSymbol,
} from "@/lib/config";
import { parseTokenAmount, tokenAmountToRaw } from "@/lib/amounts";
import type {
  KaminoReserveMarket,
  PortfolioSnapshot,
  RouteDecision,
  RoutePlan,
  YieldRoute,
} from "@/lib/types";

const MIN_ROUTE_TVL_USD = 100_000;
const PREFERRED_STABLECOIN_MARKET = "Main Market";

function isPreferredMarket(market: KaminoReserveMarket) {
  return market.marketName.toLowerCase() === PREFERRED_STABLECOIN_MARKET.toLowerCase();
}

function getExecutionScore(market: KaminoReserveMarket) {
  let score = 54;

  if (isPreferredMarket(market)) score += 25;
  if (market.totalSupplyUsd >= 100_000_000) score += 10;
  else if (market.totalSupplyUsd >= 5_000_000) score += 7;
  else if (market.totalSupplyUsd >= 1_000_000) score += 4;
  else score += 1;

  if (market.maxLtv === null) score += 2;
  else if (market.maxLtv >= 0.75) score += 5;
  else if (market.maxLtv >= 0.6) score += 3;

  score += Math.min(Math.max(market.supplyApyPct, 0), 10) * 0.4;

  return Math.min(99, Math.round(score));
}

function getRiskLevel(score: number) {
  if (score >= 85) return "low";
  if (score >= 72) return "medium";
  return "elevated";
}

function getCandidateNotes(market: KaminoReserveMarket) {
  const notes: string[] = [];

  if (isPreferredMarket(market)) {
    notes.push("Preferred stablecoin execution route.");
  } else {
    notes.push("APY candidate; not selected for primary execution.");
  }

  if (market.totalSupplyUsd >= 100_000_000) {
    notes.push("Deep TVL for stablecoin deposits.");
  } else if (market.totalSupplyUsd < 1_000_000) {
    notes.push("Lower TVL, higher execution risk for MVP users.");
  }

  if (market.maxLtv !== null && market.maxLtv > 0) {
    notes.push(`Reserve max LTV: ${(market.maxLtv * 100).toFixed(0)}%.`);
  }

  return notes;
}

function rankStablecoinCandidates(markets: KaminoReserveMarket[]) {
  return [...markets].sort((left, right) => {
    const leftPreferred = isPreferredMarket(left);
    const rightPreferred = isPreferredMarket(right);

    if (leftPreferred !== rightPreferred) {
      return leftPreferred ? -1 : 1;
    }

    if (right.supplyApyPct !== left.supplyApyPct) {
      return right.supplyApyPct - left.supplyApyPct;
    }

    return right.totalSupplyUsd - left.totalSupplyUsd;
  });
}

function buildRouteDecision({
  selected,
  candidates,
}: {
  selected: KaminoReserveMarket;
  candidates: KaminoReserveMarket[];
}): RouteDecision {
  return {
    policy: "stablecoin-main-market-first",
    selectedMarketName: selected.marketName,
    selectedReserveAddress: selected.reserveAddress,
    summary:
      "The router prioritizes a stable Main Market execution path for USDC/USDT before considering APY-only alternatives.",
    candidates: candidates.map((candidate) => {
      const executionScore = getExecutionScore(candidate);

      return {
        marketName: candidate.marketName,
        marketAddress: candidate.marketAddress,
        reserveAddress: candidate.reserveAddress,
        supplyApyPct: candidate.supplyApyPct,
        totalSupplyUsd: candidate.totalSupplyUsd,
        maxLtv: candidate.maxLtv,
        executionScore,
        riskLevel: getRiskLevel(executionScore),
        selected: candidate.reserveAddress === selected.reserveAddress,
        notes: getCandidateNotes(candidate),
      };
    }),
  };
}

export function planUsdcDepositRoute(params: {
  wallet: string;
  portfolio: PortfolioSnapshot;
  markets: KaminoReserveMarket[];
  assetSymbol?: DepositAssetSymbol;
  amountUi?: number | string;
  maxAmount?: number | string;
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
      decision: null,
    };
  }

  const candidates = rankStablecoinCandidates(
    params.markets
      .filter((market) => market.totalSupplyUsd >= MIN_ROUTE_TVL_USD)
      .filter((market) => market.maxLtv === null || market.maxLtv > 0),
  )
    .slice(0, 5);

  const best = candidates[0];

  if (!best) {
    return {
      status: "no_market",
      assetSymbol,
      route: null,
      portfolio: params.portfolio,
      candidates: params.markets.slice(0, 5),
      decision: null,
    };
  }

  const parsedMaxAmount = parseTokenAmount(params.maxAmount);
  const parsedAmountUi = parseTokenAmount(params.amountUi);
  const cap =
    parsedMaxAmount !== null && parsedMaxAmount > 0
      ? parsedMaxAmount
      : MAX_DEPOSIT_AMOUNT;
  const requested =
    parsedAmountUi !== null && parsedAmountUi > 0
      ? parsedAmountUi
      : cap;
  const amountUi = Math.max(0, Math.min(idleAmount, requested, cap));
  const amountRaw = tokenAmountToRaw(amountUi, asset.decimals);

  if (amountRaw === null) {
    throw new Error("Invalid deposit amount");
  }

  const executionScore = getExecutionScore(best);
  const executionMode = isPreferredMarket(best)
    ? "stable-main-market"
    : "apy-fallback";
  const selectionReason = isPreferredMarket(best)
    ? "Main Market is selected first for reliable stablecoin execution and deep liquidity."
    : "Main Market was unavailable, so the router selected the strongest eligible APY fallback.";
  const decision = buildRouteDecision({
    selected: best,
    candidates,
  });

  const route: YieldRoute = {
    action: "kamino_deposit",
    wallet: params.wallet,
    inputMint: asset.mint,
    inputSymbol: assetSymbol,
    amountUi,
    amountRaw,
    marketName: best.marketName,
    marketAddress: best.marketAddress,
    reserveAddress: best.reserveAddress,
    expectedSupplyApyPct: best.supplyApyPct,
    totalSupplyUsd: best.totalSupplyUsd,
    executionScore,
    executionMode,
    selectionReason,
    rationale: [
      `Wallet has idle ${assetSymbol}.`,
      `Selected Kamino ${best.marketName} reserve for the most stable USDC/USDT execution path.`,
      selectionReason,
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
    decision,
  };
}
