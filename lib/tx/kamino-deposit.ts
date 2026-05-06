import {
  AddressLookupTableAccount,
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
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

const COMPUTE_BUDGET_PROGRAM_ID = new PublicKey(
  "ComputeBudget111111111111111111111111111111",
);
const KLEND_PROGRAM_ID = new PublicKey(
  "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD",
);

type ResolvedDepositTokenAccount = {
  officialAta: PublicKey;
  officialAtaBalance: bigint;
  totalTokenBalance: bigint;
  fundingTransfers: Array<{
    tokenAccount: PublicKey;
    tokenAccountBalance: bigint;
    transferAmountRaw: bigint;
  }>;
  syncAmountRaw: bigint;
  tokenAccountCount: number;
};

type RebuiltDepositTransaction =
  | {
      kind: "versioned";
      transaction: VersionedTransaction;
      rawBytes: Buffer;
      transactionBase64: string;
      kaminoSourceVerified: boolean;
    }
  | {
      kind: "legacy";
      transaction: Transaction;
      rawBytes: Buffer;
      transactionBase64: string;
      kaminoSourceVerified: boolean;
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

function getAssociatedTokenAddress(owner: PublicKey, mint: PublicKey) {
  return getAssociatedTokenAddressSync(
    mint,
    owner,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
}

async function resolveDepositTokenAccount(params: {
  connection: Connection;
  owner: PublicKey;
  mint: PublicKey;
  amountRaw: bigint;
}) {
  const officialAta = getAssociatedTokenAddress(params.owner, params.mint);
  const accounts = await params.connection.getParsedTokenAccountsByOwner(
    params.owner,
    { mint: params.mint },
    "confirmed",
  );
  const tokenAccounts: Array<{
    pubkey: PublicKey;
    rawAmount: bigint;
  }> = [];

  for (const tokenAccount of accounts.value) {
    if (!tokenAccount.account.owner.equals(TOKEN_PROGRAM_ID)) continue;

    const data = tokenAccount.account.data;
    if (!("parsed" in data) || data.parsed?.type !== "account") continue;

    const info = data.parsed.info;
    if (
      info.mint !== params.mint.toBase58() ||
      info.owner !== params.owner.toBase58()
    ) {
      continue;
    }

    tokenAccounts.push({
      pubkey: tokenAccount.pubkey,
      rawAmount: BigInt(info.tokenAmount.amount as string),
    });
  }

  const officialTokenAccount = tokenAccounts.find((account) =>
    account.pubkey.equals(officialAta),
  );
  const totalTokenBalance = tokenAccounts.reduce(
    (total, account) => total + account.rawAmount,
    0n,
  );
  const officialAtaBalance = officialTokenAccount?.rawAmount ?? 0n;

  if (params.amountRaw > totalTokenBalance) {
    throw new Error(
      `Insufficient ${params.mint.toBase58()} balance before simulation. requestedRaw=${params.amountRaw.toString()} totalTokenBalance=${totalTokenBalance.toString()} officialAtaBalance=${officialAtaBalance.toString()}`,
    );
  }

  const syncAmountRaw =
    params.amountRaw > officialAtaBalance
      ? params.amountRaw - officialAtaBalance
      : 0n;
  const nonAtaAccounts = tokenAccounts
    .filter((account) => !account.pubkey.equals(officialAta))
    .sort((left, right) =>
      left.rawAmount === right.rawAmount ? 0 : left.rawAmount > right.rawAmount ? -1 : 1,
    );

  if (syncAmountRaw === 0n) {
    return {
      officialAta,
      officialAtaBalance,
      totalTokenBalance,
      fundingTransfers: [],
      syncAmountRaw,
      tokenAccountCount: tokenAccounts.length,
    };
  }

  let remainingSyncAmount = syncAmountRaw;
  const fundingTransfers: ResolvedDepositTokenAccount["fundingTransfers"] = [];

  for (const account of nonAtaAccounts) {
    if (remainingSyncAmount === 0n) break;
    if (account.rawAmount === 0n) continue;

    const transferAmountRaw =
      account.rawAmount >= remainingSyncAmount
        ? remainingSyncAmount
        : account.rawAmount;

    fundingTransfers.push({
      tokenAccount: account.pubkey,
      tokenAccountBalance: account.rawAmount,
      transferAmountRaw,
    });
    remainingSyncAmount -= transferAmountRaw;
  }

  if (remainingSyncAmount > 0n) {
    const largestNonAtaBalance = nonAtaAccounts[0]?.rawAmount ?? 0n;
    throw new Error(
      `Insufficient ${params.mint.toBase58()} balance across token accounts. requestedRaw=${params.amountRaw.toString()} officialAtaBalance=${officialAtaBalance.toString()} shortfallRaw=${syncAmountRaw.toString()} largestNonAtaBalance=${largestNonAtaBalance.toString()} remainingShortfallRaw=${remainingSyncAmount.toString()}`,
    );
  }

  return {
    officialAta,
    officialAtaBalance,
    totalTokenBalance,
    fundingTransfers,
    syncAmountRaw,
    tokenAccountCount: tokenAccounts.length,
  };
}

function buildAtaSyncInstructions(params: {
  owner: PublicKey;
  mint: PublicKey;
  resolvedTokenAccount: ResolvedDepositTokenAccount;
}) {
  if (params.resolvedTokenAccount.syncAmountRaw === 0n) {
    return [];
  }

  return [
    createAssociatedTokenAccountIdempotentInstruction(
      params.owner,
      params.resolvedTokenAccount.officialAta,
      params.owner,
      params.mint,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    ),
    ...params.resolvedTokenAccount.fundingTransfers.map((transfer) =>
      createTransferInstruction(
        transfer.tokenAccount,
        params.resolvedTokenAccount.officialAta,
        params.owner,
        transfer.transferAmountRaw,
        [],
        TOKEN_PROGRAM_ID,
      ),
    ),
  ];
}

function validateFundingTransfers(params: {
  amountRaw: bigint;
  resolvedTokenAccount: ResolvedDepositTokenAccount;
}) {
  const transferTotal = params.resolvedTokenAccount.fundingTransfers.reduce(
    (total, transfer) => total + transfer.transferAmountRaw,
    0n,
  );

  if (transferTotal !== params.resolvedTokenAccount.syncAmountRaw) {
    throw new Error(
      `ATA sync transfer total mismatch. syncAmountRaw=${params.resolvedTokenAccount.syncAmountRaw.toString()} transferTotal=${transferTotal.toString()}`,
    );
  }

  for (const transfer of params.resolvedTokenAccount.fundingTransfers) {
    if (typeof transfer.transferAmountRaw !== "bigint") {
      throw new Error("ATA sync transfer amount must be bigint");
    }

    if (transfer.transferAmountRaw <= 0n) {
      throw new Error("ATA sync transfer amount must be greater than zero");
    }

    if (transfer.transferAmountRaw > transfer.tokenAccountBalance) {
      throw new Error(
        `ATA sync transfer exceeds source token account balance. tokenAccount=${transfer.tokenAccount.toBase58()} transferAmountRaw=${transfer.transferAmountRaw.toString()} tokenAccountBalance=${transfer.tokenAccountBalance.toString()}`,
      );
    }
  }

  const postSyncOfficialBalance =
    params.resolvedTokenAccount.officialAtaBalance + transferTotal;
  if (postSyncOfficialBalance < params.amountRaw) {
    throw new Error(
      `Official ATA remains underfunded after sync. amountRaw=${params.amountRaw.toString()} postSyncOfficialBalance=${postSyncOfficialBalance.toString()}`,
    );
  }
}

function hasExplicitKaminoSourceAccount(
  instructions: TransactionInstruction[],
  sourceAccount: PublicKey,
) {
  return instructions.some(
    (instruction) =>
      instruction.programId.equals(KLEND_PROGRAM_ID) &&
      instruction.keys.some((accountMeta) =>
        accountMeta.pubkey.equals(sourceAccount),
      ),
  );
}

function insertPreInstructions(
  instructions: TransactionInstruction[],
  preInstructions: TransactionInstruction[],
) {
  if (preInstructions.length === 0) {
    return instructions;
  }

  let insertionIndex = 0;
  while (
    insertionIndex < instructions.length &&
    instructions[insertionIndex].programId.equals(COMPUTE_BUDGET_PROGRAM_ID)
  ) {
    insertionIndex += 1;
  }

  return [
    ...instructions.slice(0, insertionIndex),
    ...preInstructions,
    ...instructions.slice(insertionIndex),
  ];
}

async function getAddressLookupTableAccounts(
  connection: Connection,
  transaction: VersionedTransaction,
): Promise<AddressLookupTableAccount[]> {
  const lookups =
    "addressTableLookups" in transaction.message
      ? transaction.message.addressTableLookups
      : [];

  if (lookups.length === 0) {
    return [];
  }

  return Promise.all(
    lookups.map(async (lookup) => {
      const lookupTable = await connection.getAddressLookupTable(lookup.accountKey);
      if (!lookupTable.value) {
        throw new Error(
          `Address lookup table not found: ${lookup.accountKey.toBase58()}`,
        );
      }
      return lookupTable.value;
    }),
  );
}

async function rebuildDepositTransaction(params: {
  connection: Connection;
  decoded: ReturnType<typeof deserializeTransaction>;
  preInstructions: TransactionInstruction[];
  payer: PublicKey;
  blockhash: string;
  kaminoSourceAccount: PublicKey;
}): Promise<RebuiltDepositTransaction> {
  if (params.decoded.kind === "legacy") {
    params.decoded.transaction.recentBlockhash = params.blockhash;
    params.decoded.transaction.feePayer = params.payer;
    params.decoded.transaction.instructions = insertPreInstructions(
      params.decoded.transaction.instructions,
      params.preInstructions,
    );
    const kaminoSourceVerified = hasExplicitKaminoSourceAccount(
      params.decoded.transaction.instructions,
      params.kaminoSourceAccount,
    );

    if (!kaminoSourceVerified) {
      throw new Error(
        `Kamino deposit transaction does not use the resolved source ATA ${params.kaminoSourceAccount.toBase58()}`,
      );
    }

    const rawBytes = params.decoded.transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });

    return {
      kind: "legacy",
      transaction: params.decoded.transaction,
      rawBytes,
      transactionBase64: rawBytes.toString("base64"),
      kaminoSourceVerified,
    };
  }

  const addressLookupTableAccounts = await getAddressLookupTableAccounts(
    params.connection,
    params.decoded.transaction,
  );
  const message = TransactionMessage.decompile(params.decoded.transaction.message, {
    addressLookupTableAccounts,
  });

  message.payerKey = params.payer;
  message.recentBlockhash = params.blockhash;
  message.instructions = insertPreInstructions(
    message.instructions,
    params.preInstructions,
  );
  const kaminoSourceVerified = hasExplicitKaminoSourceAccount(
    message.instructions,
    params.kaminoSourceAccount,
  );

  if (!kaminoSourceVerified) {
    throw new Error(
      `Kamino deposit transaction does not use the resolved source ATA ${params.kaminoSourceAccount.toBase58()}`,
    );
  }

  const transaction = new VersionedTransaction(
    message.compileToV0Message(addressLookupTableAccounts),
  );
  const rawBytes = Buffer.from(transaction.serialize());

  return {
    kind: "versioned",
    transaction,
    rawBytes,
    transactionBase64: rawBytes.toString("base64"),
    kaminoSourceVerified,
  };
}

async function fetchKaminoDepositTransaction(params: {
  wallet: string;
  marketAddress: string;
  reserveAddress: string;
  amountUi: string;
  sourceTokenAccount: PublicKey;
}) {
  const response = await fetch(`${KAMINO_API_BASE_URL}/ktx/klend/deposit`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      wallet: params.wallet,
      market: params.marketAddress,
      reserve: params.reserveAddress,
      amount: params.amountUi,
      sourceTokenAccount: params.sourceTokenAccount.toBase58(),
      userSourceLiquidity: params.sourceTokenAccount.toBase58(),
      userTokenAccount: params.sourceTokenAccount.toBase58(),
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

  return payload.transaction;
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
  const simulationResult = await withRpcFallback(async (connection) => {
    const latestBlockhash = await connection.getLatestBlockhash("confirmed");
    const resolvedTokenAccount = await resolveDepositTokenAccount({
      connection,
      owner: walletPublicKey,
      mint: inputMint,
      amountRaw,
    });
    validateFundingTransfers({
      amountRaw,
      resolvedTokenAccount,
    });
    const kaminoTransactionBase64 = await fetchKaminoDepositTransaction({
      wallet: input.wallet,
      marketAddress: input.route.marketAddress,
      reserveAddress: input.route.reserveAddress,
      amountUi: sanitizedAmount,
      sourceTokenAccount: resolvedTokenAccount.officialAta,
    });
    const decoded = deserializeTransaction(kaminoTransactionBase64);
    const preInstructions = buildAtaSyncInstructions({
      owner: walletPublicKey,
      mint: inputMint,
      resolvedTokenAccount,
    });
    const rebuilt = await rebuildDepositTransaction({
      connection,
      decoded,
      preInstructions,
      payer: walletPublicKey,
      blockhash: latestBlockhash.blockhash,
      kaminoSourceAccount: resolvedTokenAccount.officialAta,
    });

    console.log("[tx/build] deposit simulation inputs", {
      wallet: input.wallet,
      inputSymbol: input.route.inputSymbol,
      inputMint: input.route.inputMint,
      market: input.route.marketAddress,
      reserve: input.route.reserveAddress,
      amountUi: sanitizedAmount,
      amountRaw: amountRaw.toString(),
      amountRawType: typeof amountRaw,
      officialAta: resolvedTokenAccount.officialAta.toBase58(),
      officialAtaBalance: resolvedTokenAccount.officialAtaBalance.toString(),
      officialAtaBalanceType:
        typeof resolvedTokenAccount.officialAtaBalance,
      totalTokenBalance: resolvedTokenAccount.totalTokenBalance.toString(),
      totalTokenBalanceType: typeof resolvedTokenAccount.totalTokenBalance,
      amountRawGreaterThanOfficialAta:
        amountRaw > resolvedTokenAccount.officialAtaBalance,
      amountRawGreaterThanTotal:
        amountRaw > resolvedTokenAccount.totalTokenBalance,
      fundingTransfers: resolvedTokenAccount.fundingTransfers.map((transfer) => ({
        tokenAccount: transfer.tokenAccount.toBase58(),
        tokenAccountBalance: transfer.tokenAccountBalance.toString(),
        transferAmountRaw: transfer.transferAmountRaw.toString(),
        transferAmountRawType: typeof transfer.transferAmountRaw,
      })),
      ataSyncRequired: preInstructions.length > 0,
      ataSyncAmountRaw: resolvedTokenAccount.syncAmountRaw.toString(),
      tokenAccountCount: resolvedTokenAccount.tokenAccountCount,
      kaminoSourceAccount: resolvedTokenAccount.officialAta.toBase58(),
      kaminoSourceVerified: rebuilt.kaminoSourceVerified,
      rpcEndpoint: connection.rpcEndpoint,
    });

    let simulation: unknown = null;
    if (input.simulate !== false) {
      if (rebuilt.kind === "versioned") {
        simulation = await connection.simulateTransaction(rebuilt.transaction, {
          sigVerify: false,
        });
      } else {
        simulation = await connection.simulateTransaction(rebuilt.transaction);
      }
    }

    return {
      latestBlockhash,
      simulation,
      rpcEndpoint: connection.rpcEndpoint,
      transaction: rebuilt,
      ataSyncRequired: preInstructions.length > 0,
      kaminoSourceAccount: resolvedTokenAccount.officialAta.toBase58(),
      kaminoSourceVerified: rebuilt.kaminoSourceVerified,
    };
  });

  return {
    transactionBase64: simulationResult.transaction.transactionBase64,
    transactionKind: simulationResult.transaction.kind,
    messageBytes: simulationResult.transaction.rawBytes.length,
    feePayer: input.wallet,
    latestBlockhash: simulationResult.latestBlockhash,
    sdkCapabilities,
    simulation: simulationResult.simulation,
    simulationRpcEndpoint: simulationResult.rpcEndpoint,
    ataSyncRequired: simulationResult.ataSyncRequired,
    kaminoSourceAccount: simulationResult.kaminoSourceAccount,
    kaminoSourceVerified: simulationResult.kaminoSourceVerified,
    signOnClient: true,
  };
}
