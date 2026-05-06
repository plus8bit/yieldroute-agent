import { NextResponse } from "next/server";
import {
  DEFAULT_DEPOSIT_ASSET,
  SUPPORTED_DEPOSIT_ASSETS,
  type DepositAssetSymbol,
} from "@/lib/config";
import { fetchKaminoReserveMarkets } from "@/lib/kamino/markets";
import { planUsdcDepositRoute } from "@/lib/routing/route-planner";
import { fetchPortfolio } from "@/lib/solana/rpc";
import {
  getFriendlyRpcErrorMessage,
  isRpcRateLimited,
} from "@/lib/solana/rpc-errors";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      wallet?: string;
      assetSymbol?: DepositAssetSymbol;
      amountUi?: number;
      maxAmount?: number;
      maxAmountUsdc?: number;
    };

    if (!body.wallet) {
      return NextResponse.json(
        { error: "wallet is required" },
        { status: 400 },
      );
    }

    const assetSymbol = body.assetSymbol || DEFAULT_DEPOSIT_ASSET;
    if (!SUPPORTED_DEPOSIT_ASSETS[assetSymbol]) {
      return NextResponse.json(
        { error: "assetSymbol must be USDC or USDT" },
        { status: 400 },
      );
    }

    const [portfolio, markets] = await Promise.all([
      fetchPortfolio(body.wallet),
      fetchKaminoReserveMarkets(assetSymbol),
    ]);

    const plan = planUsdcDepositRoute({
      wallet: portfolio.wallet,
      portfolio,
      markets,
      assetSymbol,
      amountUi: body.amountUi,
      maxAmount: body.maxAmount ?? body.maxAmountUsdc,
    });

    return NextResponse.json(plan);
  } catch (error) {
    const rateLimited = isRpcRateLimited(error);

    return NextResponse.json(
      {
        error:
          rateLimited
            ? getFriendlyRpcErrorMessage(error)
            : error instanceof Error
              ? error.message
              : "Failed to build route plan",
      },
      { status: rateLimited ? 429 : 400 },
    );
  }
}
