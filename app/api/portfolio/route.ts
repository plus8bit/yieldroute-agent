import { NextResponse } from "next/server";
import { fetchPortfolio } from "@/lib/solana/rpc";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { wallet?: string };

    if (!body.wallet) {
      return NextResponse.json(
        { error: "wallet is required" },
        { status: 400 },
      );
    }

    const portfolio = await fetchPortfolio(body.wallet);
    return NextResponse.json(portfolio);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load portfolio",
      },
      { status: 400 },
    );
  }
}
