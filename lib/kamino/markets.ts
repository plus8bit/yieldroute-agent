import {
  DEFAULT_DEPOSIT_ASSET,
  KAMINO_API_BASE_URL,
  SUPPORTED_DEPOSIT_ASSETS,
  type DepositAssetSymbol,
} from "@/lib/config";
import type { KaminoReserveMarket } from "@/lib/types";

type RawKaminoMarket = {
  lendingMarket?: string;
  address?: string;
  pubkey?: string;
  name?: string;
};

type RawReserveMetric = {
  reserve?: string;
  reservePubkey?: string;
  liquidityToken?: string;
  liquidityTokenMint?: string;
  supplyApy?: string | number;
  supplyInterestAPY?: string | number;
  borrowApy?: string | number;
  borrowInterestAPY?: string | number;
  totalSupplyUsd?: string | number;
  totalBorrowUsd?: string | number;
  depositTvl?: string | number;
  borrowTvl?: string | number;
  maxLtv?: string | number;
};

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function apyToPct(value: unknown) {
  const parsed = toNumber(value);
  return Math.abs(parsed) <= 1 ? parsed * 100 : parsed;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
    },
    next: {
      revalidate: 60,
    },
  });

  if (!response.ok) {
    throw new Error(`Kamino API ${response.status}: ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

export async function fetchKaminoReserveMarkets(
  assetSymbol: DepositAssetSymbol = DEFAULT_DEPOSIT_ASSET,
): Promise<KaminoReserveMarket[]> {
  const asset = SUPPORTED_DEPOSIT_ASSETS[assetSymbol];
  const markets = await fetchJson<RawKaminoMarket[]>(
    `${KAMINO_API_BASE_URL}/v2/kamino-market`,
  );

  const reserveGroups = await Promise.all(
    markets.map(async (market) => {
      const marketAddress = market.lendingMarket || market.address || market.pubkey;
      if (!marketAddress) {
        return [];
      }

      let reserves: RawReserveMetric[];
      try {
        reserves = await fetchJson<RawReserveMetric[]>(
          `${KAMINO_API_BASE_URL}/kamino-market/${marketAddress}/reserves/metrics`,
        );
      } catch {
        return [];
      }

      return reserves
        .filter((reserve) => {
          const token = reserve.liquidityToken?.toUpperCase();
          return token === asset.symbol || reserve.liquidityTokenMint === asset.mint;
        })
        .map((reserve): KaminoReserveMarket => ({
          marketName: market.name || "Kamino Market",
          marketAddress,
          reserveAddress: reserve.reserve || reserve.reservePubkey || "",
          liquidityToken: reserve.liquidityToken || asset.symbol,
          liquidityTokenMint: reserve.liquidityTokenMint || asset.mint,
          supplyApyPct: apyToPct(reserve.supplyApy ?? reserve.supplyInterestAPY),
          borrowApyPct: apyToPct(reserve.borrowApy ?? reserve.borrowInterestAPY),
          totalSupplyUsd: toNumber(reserve.totalSupplyUsd ?? reserve.depositTvl),
          totalBorrowUsd: toNumber(reserve.totalBorrowUsd ?? reserve.borrowTvl),
          maxLtv:
            reserve.maxLtv === undefined || reserve.maxLtv === null
              ? null
              : toNumber(reserve.maxLtv),
        }));
    }),
  );

  return reserveGroups
    .flat()
    .filter((reserve) => reserve.reserveAddress)
    .sort((a, b) => {
      if (b.supplyApyPct !== a.supplyApyPct) {
        return b.supplyApyPct - a.supplyApyPct;
      }
      return b.totalSupplyUsd - a.totalSupplyUsd;
    });
}

export const fetchKaminoUsdcMarkets = () => fetchKaminoReserveMarkets("USDC");
