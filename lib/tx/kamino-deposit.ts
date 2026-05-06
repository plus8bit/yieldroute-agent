import { Transaction, VersionedTransaction } from "@solana/web3.js";
import { KAMINO_API_BASE_URL } from "@/lib/config";
import { getKaminoSdkCapabilities } from "@/lib/kamino/sdk";
import { parseWalletPublicKey, withRpcFallback } from "@/lib/solana/rpc";
import type { YieldRoute } from "@/lib/types";

type BuildDepositInput = {
  wallet: string;
  route: YieldRoute;
  simulate?: boolean;
};

function deserializeTransaction(encodedTransaction: string) {
  const bytes = Buffer.from(encodedTransaction, "base64");

  try {
    return {
      kind: "versioned" as const,
      transaction: VersionedTransaction.deserialize(bytes),
      rawBytes: bytes,
    };
  } catch {
    return {
      kind: "legacy" as const,
      transaction: Transaction.from(bytes),
      rawBytes: bytes,
    };
  }
}

export async function buildKaminoDepositTransaction(input: BuildDepositInput) {
  parseWalletPublicKey(input.wallet);

  if (input.route.action !== "kamino_deposit") {
    throw new Error("Unsupported route action");
  }

  if (input.route.wallet !== input.wallet) {
    throw new Error("Route wallet does not match request wallet");
  }

  if (input.route.amountUi <= 0) {
    throw new Error("Deposit amount must be greater than zero");
  }

  const sdkCapabilities = await getKaminoSdkCapabilities();
  const response = await fetch(`${KAMINO_API_BASE_URL}/ktx/klend/deposit`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      wallet: input.wallet,
      market: input.route.marketAddress,
      reserve: input.route.reserveAddress,
      amount: String(input.route.amountUi),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Kamino deposit builder failed ${response.status}: ${body}`);
  }

  const payload = (await response.json()) as { transaction?: string };

  if (!payload.transaction) {
    throw new Error("Kamino deposit builder did not return a transaction");
  }

  const decoded = deserializeTransaction(payload.transaction);
  const simulationResult = await withRpcFallback(async (connection) => {
    const latestBlockhash = await connection.getLatestBlockhash("confirmed");

    let simulation: unknown = null;
    if (input.simulate !== false) {
      if (decoded.kind === "versioned") {
        simulation = await connection.simulateTransaction(decoded.transaction, {
          sigVerify: false,
          replaceRecentBlockhash: true,
        });
      } else {
        decoded.transaction.recentBlockhash = latestBlockhash.blockhash;
        decoded.transaction.feePayer = parseWalletPublicKey(input.wallet);
        simulation = await connection.simulateTransaction(decoded.transaction);
      }
    }

    return {
      latestBlockhash,
      simulation,
      rpcEndpoint: connection.rpcEndpoint,
    };
  });

  return {
    transactionBase64: payload.transaction,
    transactionKind: decoded.kind,
    messageBytes: decoded.rawBytes.length,
    feePayer: input.wallet,
    latestBlockhash: simulationResult.latestBlockhash,
    sdkCapabilities,
    simulation: simulationResult.simulation,
    simulationRpcEndpoint: simulationResult.rpcEndpoint,
    signOnClient: true,
  };
}
