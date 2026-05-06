import { NextResponse } from "next/server";
import {
  DEFAULT_DEPOSIT_ASSET,
  SUPPORTED_DEPOSIT_ASSETS,
  type DepositAssetSymbol,
} from "@/lib/config";
import { fetchKaminoReserveMarkets } from "@/lib/kamino/markets";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const assetSymbol =
      (url.searchParams.get("assetSymbol") as DepositAssetSymbol | null) ||
      DEFAULT_DEPOSIT_ASSET;

    if (!SUPPORTED_DEPOSIT_ASSETS[assetSymbol]) {
      return NextResponse.json(
        { error: "assetSymbol must be USDC or USDT" },
        { status: 400 },
      );
    }

    const markets = await fetchKaminoReserveMarkets(assetSymbol);
    return NextResponse.json({
      assetSymbol,
      count: markets.length,
      markets,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load Kamino markets",
      },
      { status: 502 },
    );
  }
}
