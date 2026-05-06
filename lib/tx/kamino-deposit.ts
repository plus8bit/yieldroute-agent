import {
  Connection,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  assertNoFractionalRawAmount,
  parseTokenAmount,
  sanitizeTokenAmountInput,
  tokenAmountToRawBigInt,
} from "@/lib/amounts";
import { KAMINO_API_BASE_URL, SUPPORTED_DEPOSIT_ASSETS } from "@/lib/config";
import { getKaminoSdkCapabilities } from "@/lib/kamino/sdk";
import { parseWalletPublicKey, withRpcFallback } from "@/lib/solana/rpc";
import type { YieldRoute } from "@/lib/types";

type BuildDepositInput = {
  wallet: string;
  route: YieldRoute;
  simulate?: boolean;
};

const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

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

function getAssociatedTokenAddress(owner: PublicKey, mint: PublicKey) {
  const [associatedTokenAccount] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  return associatedTokenAccount;
}

async function getSourceAtaBalance(params: {
  connection: Connection;
  owner: PublicKey;
  mint: PublicKey;
}) {
  const sourceAta = getAssociatedTokenAddress(params.owner, params.mint);
  const account = await params.connection.getParsedAccountInfo(
    sourceAta,
    "confirmed",
  );

  if (
    !account.value ||
    !("parsed" in account.value.data) ||
    account.value.data.parsed?.type !== "account"
  ) {
    return {
      sourceAta: sourceAta.toBase58(),
      sourceAtaBalance: "0",
    };
  }

  return {
    sourceAta: sourceAta.toBase58(),
    sourceAtaBalance: String(account.value.data.parsed.info.tokenAmount.amount),
  };
}

export async function buildKaminoDepositTransaction(input: BuildDepositInput) {
  const walletPublicKey = parseWalletPublicKey(input.wallet);

  if (input.route.action !== "kamino_deposit") {
    throw new Error("Unsupported route action");
  }

  if (input.route.wallet !== input.wallet) {
    throw new Error("Route wallet does not match request wallet");
  }

  const asset = SUPPORTED_DEPOSIT_ASSETS[input.route.inputSymbol];
  if (!asset || asset.mint !== input.route.inputMint) {
    throw new Error("Route token mint does not match supported asset config");
  }

  const amountUi = parseTokenAmount(input.route.amountUi);
  if (amountUi === null || amountUi <= 0) {
    throw new Error("Deposit amount must be greater than zero");
  }
  assertNoFractionalRawAmount(input.route.amountUi, asset.decimals);
  const amountRaw = tokenAmountToRawBigInt(input.route.amountUi, asset.decimals);
  if (amountRaw === null) {
    throw new Error("Invalid deposit amount");
  }
  const sanitizedAmount = sanitizeTokenAmountInput(input.route.amountUi);
  const inputMint = new PublicKey(input.route.inputMint);

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
      amount: sanitizedAmount,
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
    const { sourceAta, sourceAtaBalance } = await getSourceAtaBalance({
      connection,
      owner: walletPublicKey,
      mint: inputMint,
    });

    console.log("[tx/build] deposit simulation inputs", {
      wallet: input.wallet,
      inputSymbol: input.route.inputSymbol,
      inputMint: input.route.inputMint,
      market: input.route.marketAddress,
      reserve: input.route.reserveAddress,
      amountUi: sanitizedAmount,
      amountRaw: amountRaw.toString(),
      sourceAta,
      sourceAtaBalance,
      rpcEndpoint: connection.rpcEndpoint,
    });

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
