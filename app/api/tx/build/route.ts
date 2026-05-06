import { NextResponse } from "next/server";
import { buildKaminoDepositTransaction } from "@/lib/tx/kamino-deposit";
import type { YieldRoute } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      wallet?: string;
      route?: YieldRoute;
      simulate?: boolean;
    };

    if (!body.wallet || !body.route) {
      return NextResponse.json(
        { error: "wallet and route are required" },
        { status: 400 },
      );
    }

    const transaction = await buildKaminoDepositTransaction({
      wallet: body.wallet,
      route: body.route,
      simulate: body.simulate,
    });

    return NextResponse.json(transaction);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to build Kamino transaction",
      },
      { status: 400 },
    );
  }
}
