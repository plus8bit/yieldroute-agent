import { NextResponse } from "next/server";
import {
  getFriendlyRpcErrorMessage,
  isRpcAccessDenied,
} from "@/lib/solana/rpc-errors";
import { buildKaminoDepositTransaction } from "@/lib/tx/kamino-deposit";
import type { YieldRoute } from "@/lib/types";

export const runtime = "nodejs";

function getLastProgramFailureLog(logs: string[]) {
  return (
    [...logs]
      .reverse()
      .find((line) => {
        const normalized = line.toLowerCase();
        return normalized.includes("error") || normalized.includes("failed to fill");
      }) || null
  );
}

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

    const simulationValue = (
      transaction.simulation as {
        value?: { err?: unknown; logs?: string[] };
      } | null
    )?.value;
    if (simulationValue?.err) {
      const programLogs = simulationValue.logs || [];
      const failureLog = getLastProgramFailureLog(programLogs);

      return NextResponse.json(
        {
          error: failureLog
            ? `Simulation failed before signing: ${failureLog}`
            : "Simulation failed before signing. Check Transaction Terminal.",
          simulationError: simulationValue.err,
          programFailureLog: failureLog,
          programLogs,
          simulationRpcEndpoint: transaction.simulationRpcEndpoint,
          diagnostics: transaction.diagnostics,
        },
        { status: 400 },
      );
    }

    return NextResponse.json(transaction);
  } catch (error) {
    const rpcAccessDenied = isRpcAccessDenied(error);

    return NextResponse.json(
      {
        error:
          rpcAccessDenied
            ? getFriendlyRpcErrorMessage(error)
            : error instanceof Error
              ? error.message
              : "Failed to build Kamino transaction",
      },
      { status: rpcAccessDenied ? 403 : 400 },
    );
  }
}
