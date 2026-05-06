"use client";

import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Connection, VersionedTransaction } from "@solana/web3.js";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Buffer } from "buffer";
import {
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Cpu,
  ExternalLink,
  Flame,
  Loader2,
  LockKeyhole,
  Power,
  RefreshCw,
  Send,
  ShieldCheck,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useRpcFallback } from "@/components/solana-providers";
import { parseTokenAmount, sanitizeTokenAmountInput } from "@/lib/amounts";
import type { DepositAssetSymbol } from "@/lib/config";
import {
  getFriendlyRpcErrorMessage,
  isRpcAccessDenied,
  isRpcRateLimited,
} from "@/lib/solana/rpc-errors";
import type {
  KaminoReserveMarket,
  PortfolioAsset,
  PortfolioSnapshot,
  RoutePlan,
  YieldRoute,
} from "@/lib/types";
import { cn } from "@/lib/utils";

type ScreenState =
  | "disconnected"
  | "loading"
  | "ready"
  | "executing"
  | "success"
  | "retrying"
  | "error";

type TerminalLine = {
  level: "info" | "ok" | "warn" | "error";
  message: string;
  timestamp: string;
};

type ActivePosition = {
  id: string;
  amountUi: number;
  symbol: DepositAssetSymbol;
  marketName: string;
  signature: string;
};

type RoutePlanCacheEntry = {
  plan: RoutePlan;
  fetchedAt: number;
};

type BuildTransactionResponse = {
  transactionBase64: string;
  transactionKind: "versioned" | "legacy";
  messageBytes: number;
  feePayer: string;
  latestBlockhash: {
    blockhash: string;
    lastValidBlockHeight: number;
  };
  simulation: {
    value?: {
      err?: unknown;
      unitsConsumed?: number;
      logs?: string[];
    };
  } | null;
  signOnClient: boolean;
  simulationRpcEndpoint?: string;
  ataSyncRequired?: boolean;
};

const SOLSCAN_BASE = "https://solscan.io/tx";
const KAMINO_APP_URL = "https://app.kamino.finance/lending";
const ROUTE_CACHE_TTL_MS = 60_000;
const RATE_LIMIT_RETRY_MS = 3_000;

const TOKEN_ICONS: Record<PortfolioAsset["symbol"], string> = {
  SOL: "https://assets.coingecko.com/coins/images/4128/large/solana.png",
  USDC: "https://assets.coingecko.com/coins/images/6319/large/USD_Coin_icon.png",
  USDT: "https://assets.coingecko.com/coins/images/325/large/Tether.png",
};

const DEPOSIT_ASSETS: Array<{
  symbol: DepositAssetSymbol;
  name: string;
}> = [
  { symbol: "USDC", name: "USD Coin" },
  { symbol: "USDT", name: "Tether" },
];

function now() {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let data: unknown = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }

  if (!response.ok) {
    const payload = data as { error?: string };
    throw new ApiRequestError(
      payload?.error || `Request failed: ${path}`,
      response.status,
      data,
    );
  }

  return data as T;
}

class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload?: unknown,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

function normalizeClientError(error: unknown) {
  if (isRpcAccessDenied(error)) {
    return getFriendlyRpcErrorMessage(error);
  }

  if (isRpcRateLimited(error)) {
    return getFriendlyRpcErrorMessage(error);
  }

  return error instanceof Error ? error.message : "Transaction failed.";
}

function getProgramLogs(error: unknown) {
  if (!(error instanceof ApiRequestError)) return [];
  const payload = error.payload as { programLogs?: unknown } | null;
  return Array.isArray(payload?.programLogs)
    ? payload.programLogs.filter((line): line is string => typeof line === "string")
    : [];
}

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

function formatAmount(value: number, maximumFractionDigits = 6) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits,
  }).format(value);
}

function formatInputAmount(value: number) {
  return value.toLocaleString("en-US", {
    maximumFractionDigits: 6,
    useGrouping: false,
  });
}

function formatPercent(value: number) {
  return `${formatAmount(value, 2)}%`;
}

function shortKey(value: string) {
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function getAsset(assets: PortfolioAsset[], symbol: PortfolioAsset["symbol"]) {
  return assets.find((asset) => asset.symbol === symbol);
}

function getTerminalClass(level: TerminalLine["level"]) {
  if (level === "ok") return "text-emerald-300";
  if (level === "warn") return "text-solflare";
  if (level === "error") return "text-red-300";
  return "text-zinc-300";
}

function parseDepositInput(value: string) {
  return parseTokenAmount(value);
}

function getRouteCacheKey({
  wallet,
  assetSymbol,
  amountUi,
}: {
  wallet: string;
  assetSymbol: DepositAssetSymbol;
  amountUi?: number;
}) {
  const amountKey =
    typeof amountUi === "number" && Number.isFinite(amountUi)
      ? amountUi.toFixed(6)
      : "auto";
  return `${wallet}:${assetSymbol}:${amountKey}`;
}

function isCacheFresh(entry: RoutePlanCacheEntry) {
  return Date.now() - entry.fetchedAt < ROUTE_CACHE_TTL_MS;
}

function isRoutePlanRateLimited(error: unknown) {
  if (error instanceof ApiRequestError && error.status === 429) return true;
  return isRpcRateLimited(error);
}

export function YieldRouteDashboard() {
  const { connection } = useConnection();
  const { createFallbackConnection, switchToFallback } = useRpcFallback();
  const {
    publicKey,
    connected,
    connecting,
    disconnect,
    signTransaction,
    wallets,
    wallet,
    select,
    connect,
  } = useWallet();
  const loadRequestId = useRef(0);
  const routePlanCacheRef = useRef(new Map<string, RoutePlanCacheEntry>());
  const retryTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [screenState, setScreenState] = useState<ScreenState>("disconnected");
  const [connectRequested, setConnectRequested] = useState(false);
  const [selectedAsset, setSelectedAsset] =
    useState<DepositAssetSymbol>("USDC");
  const [depositAmount, setDepositAmount] = useState("");
  const [portfolio, setPortfolio] = useState<PortfolioSnapshot | null>(null);
  const [route, setRoute] = useState<YieldRoute | null>(null);
  const [candidates, setCandidates] = useState<KaminoReserveMarket[]>([]);
  const [signature, setSignature] = useState<string | null>(null);
  const [activePositions, setActivePositions] = useState<ActivePosition[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [terminal, setTerminal] = useState<TerminalLine[]>([
    {
      level: "info",
      message: "client.ready waiting for Solflare connection",
      timestamp: now(),
    },
  ]);

  const walletAddress = publicKey?.toBase58() || "";
  const sol = useMemo(
    () => (portfolio ? getAsset(portfolio.assets, "SOL") : null),
    [portfolio],
  );
  const selectedPortfolioAsset = useMemo(
    () => (portfolio ? getAsset(portfolio.assets, selectedAsset) : null),
    [portfolio, selectedAsset],
  );
  const requestedAmount = parseDepositInput(depositAmount);
  const availableAmount = selectedPortfolioAsset?.uiAmount || 0;
  const validAmount =
    requestedAmount !== null &&
    requestedAmount > 0 &&
    requestedAmount <= availableAmount;
  const canExecute =
    Boolean(route) &&
    Boolean(walletAddress) &&
    Boolean(signTransaction) &&
    validAmount &&
    screenState !== "executing";

  const appendTerminal = useCallback(
    (level: TerminalLine["level"], message: string) => {
      setTerminal((current) =>
        [
          ...current,
          {
            level,
            message,
            timestamp: now(),
          },
        ].slice(-14),
      );
    },
    [],
  );

  const applyRoutePlan = useCallback(
    (
      plan: RoutePlan,
      assetSymbol: DepositAssetSymbol,
      options: { fromCache?: boolean } = {},
    ) => {
      setPortfolio(plan.portfolio);
      setRoute(plan.route);
      setCandidates(plan.candidates);
      appendTerminal(
        options.fromCache ? "info" : "ok",
        `${options.fromCache ? "cache.hit" : "portfolio.loaded"} assets=${plan.portfolio.assets.length}`,
      );

      if (plan.status === "ready" && plan.route) {
        setScreenState("ready");
        appendTerminal(
          "ok",
          `route.ready asset=${plan.route.inputSymbol} market=${plan.route.marketName}`,
        );
        return;
      }

      setScreenState("error");
      const message =
        plan.status === "no_balance"
          ? `No idle ${assetSymbol} found.`
          : `No eligible Kamino ${assetSymbol} market found.`;
      setError(message);
      appendTerminal("warn", `route.unavailable status=${plan.status}`);
    },
    [appendTerminal],
  );

  const connectSolflare = useCallback(() => {
    setError(null);
    const solflare = wallets.find((entry) =>
      entry.adapter.name.toLowerCase().includes("solflare"),
    );

    if (!solflare) {
      const message = "Solflare adapter is not registered.";
      setError(message);
      toast.error(message);
      return;
    }

    if (solflare.readyState === WalletReadyState.Unsupported) {
      const message = "Solflare is not supported in this browser.";
      setError(message);
      toast.error(message);
      return;
    }

    select(solflare.adapter.name);
    setConnectRequested(true);
    appendTerminal("info", `wallet.select ${solflare.adapter.name}`);
  }, [appendTerminal, select, wallets]);

  useEffect(() => {
    if (!connectRequested || !wallet) return;
    if (!wallet.adapter.name.toLowerCase().includes("solflare")) return;

    setConnectRequested(false);
    void connect().catch((caught) => {
      const message =
        caught instanceof Error
          ? caught.message
          : "Solflare connection was rejected.";
      setError(message);
      appendTerminal("error", message);
      toast.error(message);
    });
  }, [appendTerminal, connect, connectRequested, wallet]);

  const loadPortfolioAndRoute = useCallback(
    async (params: {
      wallet: string;
      assetSymbol: DepositAssetSymbol;
      amountUi?: number;
      quiet?: boolean;
      force?: boolean;
    }) => {
      const requestId = ++loadRequestId.current;
      const cacheKey = getRouteCacheKey(params);
      const cached = routePlanCacheRef.current.get(cacheKey);

      if (!params.force && cached && isCacheFresh(cached)) {
        setError(null);
        applyRoutePlan(cached.plan, params.assetSymbol, { fromCache: true });
        return;
      }

      if (!params.quiet) {
        setScreenState("loading");
        setRoute(null);
        setCandidates([]);
      }
      setError(null);
      appendTerminal("info", `wallet.connected ${shortKey(params.wallet)}`);
      appendTerminal(
        "info",
        `POST /api/route/plan asset=${params.assetSymbol}${params.force ? " force=true" : ""}`,
      );

      try {
        const plan = await postJson<RoutePlan>("/api/route/plan", {
          wallet: params.wallet,
          assetSymbol: params.assetSymbol,
          amountUi: params.amountUi,
          maxAmount: params.amountUi,
        });
        if (requestId !== loadRequestId.current) return;

        routePlanCacheRef.current.set(cacheKey, {
          plan,
          fetchedAt: Date.now(),
        });
        applyRoutePlan(plan, params.assetSymbol);
      } catch (caught) {
        if (requestId !== loadRequestId.current) return;

        if (isRoutePlanRateLimited(caught)) {
          const message = "Network congested. Retrying in 3 seconds...";
          setError(message);
          toast.warning(message);
          appendTerminal("warn", `rpc.rate_limited retryMs=${RATE_LIMIT_RETRY_MS}`);

          if (cached) {
            applyRoutePlan(cached.plan, params.assetSymbol, { fromCache: true });
            setError("Network congested. Showing cached route while retrying...");
          } else {
            setScreenState("retrying");
            setRoute(null);
            setCandidates([]);
          }

          if (!retryTimersRef.current.has(cacheKey)) {
            const timer = setTimeout(() => {
              retryTimersRef.current.delete(cacheKey);
              void loadPortfolioAndRoute({
                ...params,
                force: true,
                quiet: true,
              });
            }, RATE_LIMIT_RETRY_MS);
            retryTimersRef.current.set(cacheKey, timer);
          }
          return;
        }

        const message =
          caught instanceof Error
            ? getFriendlyRpcErrorMessage(caught)
            : "Failed to load route";
        setError(message);
        setScreenState("error");
        appendTerminal("error", message);
      }
    },
    [appendTerminal, applyRoutePlan],
  );

  useEffect(() => {
    return () => {
      retryTimersRef.current.forEach((timer) => clearTimeout(timer));
      retryTimersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!connected || !walletAddress) {
      loadRequestId.current += 1;
      setScreenState("disconnected");
      setPortfolio(null);
      setRoute(null);
      setCandidates([]);
      setSignature(null);
      setConnectRequested(false);
      setError(null);
      return;
    }

    setConnectRequested(false);
    void loadPortfolioAndRoute({
      wallet: walletAddress,
      assetSymbol: selectedAsset,
    });
  }, [connected, loadPortfolioAndRoute, selectedAsset, walletAddress]);

  const handleAssetSelect = (assetSymbol: DepositAssetSymbol) => {
    setSelectedAsset(assetSymbol);
    setDepositAmount("");
    setSignature(null);
  };

  const handleMax = () => {
    setDepositAmount(formatInputAmount(availableAmount));
  };

  const handleDepositAmountChange = (event: ChangeEvent<HTMLInputElement>) => {
    setDepositAmount(sanitizeTokenAmountInput(event.target.value));
  };

  const executeDeposit = async () => {
    if (!walletAddress || !publicKey || !signTransaction) {
      toast.error("Solflare signing is not available.");
      return;
    }

    if (requestedAmount === null || requestedAmount <= 0) {
      toast.error("Enter a deposit amount.");
      return;
    }

    if (requestedAmount > availableAmount) {
      toast.error(`Amount exceeds available ${selectedAsset} balance.`);
      return;
    }

    setScreenState("executing");
    setError(null);
    appendTerminal(
      "info",
      `POST /api/route/plan asset=${selectedAsset} amount=${requestedAmount}`,
    );

    try {
      const plan = await postJson<RoutePlan>("/api/route/plan", {
        wallet: walletAddress,
        assetSymbol: selectedAsset,
        amountUi: requestedAmount,
        maxAmount: requestedAmount,
      });

      if (plan.status !== "ready" || !plan.route) {
        throw new Error(
          plan.status === "no_balance"
            ? `No idle ${selectedAsset} found.`
            : `No eligible Kamino ${selectedAsset} market found.`,
        );
      }

      const executionRoute = plan.route;
      setPortfolio(plan.portfolio);
      setRoute(executionRoute);
      setCandidates(plan.candidates);
      appendTerminal("info", "POST /api/tx/build");

      const txPayload = await postJson<BuildTransactionResponse>(
        "/api/tx/build",
        {
          wallet: walletAddress,
          route: executionRoute,
        },
      );

      appendTerminal(
        "ok",
        `tx.built kind=${txPayload.transactionKind} bytes=${txPayload.messageBytes}`,
      );
      if (txPayload.ataSyncRequired) {
        appendTerminal("warn", "ata.sync pre-instructions injected");
      }

      if (txPayload.transactionKind !== "versioned") {
        throw new Error("Client execution expects a VersionedTransaction.");
      }

      const simulationError = txPayload.simulation?.value?.err;
      if (simulationError) {
        throw new Error(
          `Simulation failed before signing: ${JSON.stringify(simulationError)}`,
        );
      }

      appendTerminal(
        "ok",
        `simulation.ok units=${txPayload.simulation?.value?.unitsConsumed ?? "n/a"}`,
      );
      appendTerminal("info", "deserialize VersionedTransaction from base64");

      const transaction = VersionedTransaction.deserialize(
        Buffer.from(txPayload.transactionBase64, "base64"),
      );

      appendTerminal("info", "wallet.signTransaction requested");
      const signedTransaction = await signTransaction(transaction);

      const signedBytes = signedTransaction.serialize();

      appendTerminal("info", "connection.sendRawTransaction");
      let broadcastConnection: Connection = connection;
      let txSignature: string;

      try {
        txSignature = await connection.sendRawTransaction(signedBytes, {
          maxRetries: 3,
          skipPreflight: false,
        });
      } catch (sendError) {
        if (!isRpcAccessDenied(sendError)) {
          throw sendError;
        }

        const message = "RPC Access Denied. Switching to public network...";
        appendTerminal("warn", message);
        toast.warning(message);
        switchToFallback("sendRawTransaction returned 403");

        broadcastConnection = createFallbackConnection();
        txSignature = await broadcastConnection.sendRawTransaction(signedBytes, {
          maxRetries: 3,
          skipPreflight: false,
        });
      }

      appendTerminal("info", `confirmTransaction signature=${shortKey(txSignature)}`);
      try {
        await broadcastConnection.confirmTransaction(
          {
            signature: txSignature,
            blockhash: txPayload.latestBlockhash.blockhash,
            lastValidBlockHeight: txPayload.latestBlockhash.lastValidBlockHeight,
          },
          "confirmed",
        );
      } catch (confirmError) {
        if (!isRpcAccessDenied(confirmError)) {
          throw confirmError;
        }

        const message = "RPC Access Denied. Confirming on public network...";
        appendTerminal("warn", message);
        toast.warning(message);
        switchToFallback("confirmTransaction returned 403");

        const fallbackConnection = createFallbackConnection();
        await fallbackConnection.confirmTransaction(
          {
            signature: txSignature,
            blockhash: txPayload.latestBlockhash.blockhash,
            lastValidBlockHeight: txPayload.latestBlockhash.lastValidBlockHeight,
          },
          "confirmed",
        );
      }

      setSignature(txSignature);
      setActivePositions((current) => [
        {
          id: `${txSignature}-${Date.now()}`,
          amountUi: executionRoute.amountUi,
          symbol: executionRoute.inputSymbol,
          marketName: executionRoute.marketName,
          signature: txSignature,
        },
        ...current,
      ]);
      setDepositAmount("");
      setScreenState("success");
      appendTerminal("ok", `tx.confirmed ${txSignature}`);
      toast.success(
        `${formatAmount(executionRoute.amountUi, 6)} ${executionRoute.inputSymbol} deposited.`,
      );

      await loadPortfolioAndRoute({
        wallet: walletAddress,
        assetSymbol: selectedAsset,
        quiet: true,
        force: true,
      });
    } catch (caught) {
      const message = normalizeClientError(caught);
      const programLogs = getProgramLogs(caught);
      const programFailureLog = getLastProgramFailureLog(programLogs);
      setError(message);
      setScreenState("error");
      appendTerminal("error", message);
      if (programFailureLog) {
        appendTerminal("error", programFailureLog);
      }
      toast.error(message);
    }
  };

  if (!connected) {
    return (
      <main className="min-h-screen bg-background text-foreground">
        <div className="mx-auto flex min-h-screen max-w-6xl items-center justify-center px-6">
          <Card className="w-full max-w-lg border-solflare/20 bg-zinc-950/70 shadow-2xl shadow-solflare/10 backdrop-blur-xl">
            <CardHeader className="items-center text-center">
              <div className="mb-4 flex size-16 items-center justify-center rounded-lg border border-solflare/25 bg-solflare/10 text-solflare">
                <Wallet className="size-8" />
              </div>
              <CardTitle className="text-3xl">YieldRoute Agent</CardTitle>
              <CardDescription className="max-w-sm text-zinc-400">
                Connect Solflare to scan idle USDC or USDT, select a Kamino route
                and build a client-signed deposit transaction.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex justify-center">
              <Button
                className="h-12 bg-solflare px-8 text-base text-black hover:bg-solflare/90"
                disabled={connecting || connectRequested}
                onClick={connectSolflare}
              >
                {connecting || connectRequested ? (
                  <Loader2 className="animate-spin" data-icon="inline-start" />
                ) : (
                  <Power data-icon="inline-start" />
                )}
                Connect Solflare
              </Button>
            </CardContent>
            {error ? (
              <CardContent className="pt-0">
                <div className="rounded-lg border border-red-400/20 bg-red-500/10 p-3 text-center text-sm text-red-200">
                  {error}
                </div>
              </CardContent>
            ) : null}
            <CardFooter className="justify-center text-center text-xs text-zinc-500">
              Wallet keys stay inside the browser extension. Backend never
              receives a signature or private key.
            </CardFooter>
          </Card>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-5 py-6 md:px-8">
        <header className="flex flex-col gap-4 rounded-lg border border-white/10 bg-white/[0.03] p-4 backdrop-blur-xl md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-lg bg-solflare text-black">
              <Flame className="size-6" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-normal">
                YieldRoute Agent
              </h1>
              <p className="text-sm text-zinc-400">
                Solflare signing, Kamino routing, Quicknode-ready RPC.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="warning">Mainnet</Badge>
            <Badge variant="outline" className="border-white/10 text-zinc-300">
              {shortKey(walletAddress)}
            </Badge>
            <Button
              variant="outline"
              className="border-white/10 bg-white/[0.03]"
              onClick={() => disconnect()}
            >
              Disconnect
            </Button>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <Card className="border-white/10 bg-zinc-950/70 backdrop-blur-xl">
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle>Portfolio</CardTitle>
                  <CardDescription>
                    Read-only RPC snapshot for the connected wallet.
                  </CardDescription>
                </div>
                <Badge
                  variant={
                    screenState === "loading" || screenState === "retrying"
                      ? "warning"
                      : "success"
                  }
                >
                  {screenState === "loading" || screenState === "retrying"
                    ? "Loading"
                    : "Live"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {screenState === "loading" ? (
                <LoadingPortfolio />
              ) : (
                <>
                  <BalanceRow
                    asset={sol}
                    label="SOL"
                    value={sol ? formatAmount(sol.uiAmount, 4) : "0"}
                    subvalue="Native balance"
                  />
                  {DEPOSIT_ASSETS.map((asset) => {
                    const portfolioAsset = portfolio
                      ? getAsset(portfolio.assets, asset.symbol)
                      : null;
                    return (
                      <BalanceRow
                        accent={selectedAsset === asset.symbol}
                        asset={portfolioAsset}
                        key={asset.symbol}
                        label={asset.symbol}
                        onSelect={() => handleAssetSelect(asset.symbol)}
                        selected={selectedAsset === asset.symbol}
                        subvalue={asset.name}
                        value={
                          portfolioAsset
                            ? formatAmount(portfolioAsset.uiAmount, 6)
                            : "0"
                        }
                      />
                    );
                  })}
                  <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
                    <div className="flex items-center gap-2 text-sm font-medium text-solflare">
                      <ShieldCheck className="size-4" />
                      Transaction boundary
                    </div>
                    <p className="mt-2 text-sm leading-6 text-zinc-400">
                      API returns only an unsigned transaction. Solflare receives
                      the serialized payload in the browser and signs after user
                      approval.
                    </p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="border-solflare/20 bg-zinc-950/75 shadow-2xl shadow-solflare/10 backdrop-blur-xl">
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle>Route Plan</CardTitle>
                  <CardDescription>
                    Idle {selectedAsset} matched against eligible Kamino
                    reserves.
                  </CardDescription>
                </div>
                <Badge variant="warning">Kamino</Badge>
              </div>
            </CardHeader>
            <CardContent>
              {screenState === "loading" ? (
                <LoadingRoute />
              ) : screenState === "retrying" ? (
                <RetryingRoutePlan />
              ) : route ? (
                <div className="flex flex-col gap-5">
                  <div className="grid gap-3 md:grid-cols-3">
                    <Metric label="Market" value={route.marketName} />
                    <Metric
                      highlight
                      label="Supply APY"
                      value={formatPercent(route.expectedSupplyApyPct)}
                    />
                    <Metric
                      label="Available"
                      value={`${formatAmount(availableAmount, 6)} ${selectedAsset}`}
                    />
                  </div>

                  <div className="rounded-lg border border-white/10 bg-black/35 p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
                      <Cpu className="size-4 text-solflare" />
                      Deposit amount
                    </div>
                    <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                      <div className="relative flex-1">
                        <Input
                          inputMode="decimal"
                          min="0"
                          onChange={handleDepositAmountChange}
                          placeholder={`0.00 ${selectedAsset}`}
                          type="text"
                          value={depositAmount}
                        />
                        <Button
                          className="absolute right-1 top-1 h-9 bg-solflare px-3 text-xs text-black hover:bg-solflare/90"
                          disabled={availableAmount <= 0}
                          onClick={handleMax}
                          type="button"
                        >
                          MAX
                        </Button>
                      </div>
                      <Button
                        variant="outline"
                        className="h-11 border-white/10 bg-white/[0.03]"
                        disabled={screenState === "executing"}
                        onClick={() =>
                          loadPortfolioAndRoute({
                            wallet: walletAddress,
                            assetSymbol: selectedAsset,
                            amountUi: requestedAmount || undefined,
                            force: true,
                          })
                        }
                      >
                        <RefreshCw data-icon="inline-start" />
                        Refresh
                      </Button>
                    </div>
                    <div className="mt-3 grid gap-2 text-sm text-zinc-400 md:grid-cols-2">
                      <span>Market: {shortKey(route.marketAddress)}</span>
                      <span>Reserve: {shortKey(route.reserveAddress)}</span>
                      <span>Input mint: {shortKey(route.inputMint)}</span>
                      <span>
                        Amount raw:{" "}
                        {validAmount
                          ? Math.floor(
                              (requestedAmount || 0) *
                                10 ** (selectedPortfolioAsset?.decimals || 6),
                            )
                          : "pending"}
                      </span>
                    </div>
                    {requestedAmount !== null && !validAmount ? (
                      <p className="mt-3 text-sm text-red-300">
                        Enter an amount greater than 0 and no higher than your
                        available {selectedAsset} balance.
                      </p>
                    ) : null}
                  </div>

                  <Button
                    className="h-12 bg-solflare text-base text-black hover:bg-solflare/90"
                    disabled={!canExecute}
                    onClick={executeDeposit}
                  >
                    {screenState === "executing" ? (
                      <Loader2 className="animate-spin" data-icon="inline-start" />
                    ) : (
                      <Send data-icon="inline-start" />
                    )}
                    Approve & Deposit
                  </Button>
                </div>
              ) : (
                <EmptyRoute error={error} selectedAsset={selectedAsset} />
              )}
            </CardContent>
          </Card>
        </section>

        {activePositions.length > 0 ? (
          <Card className="border-solflare/20 bg-zinc-950/75 backdrop-blur-xl">
            <CardHeader>
              <CardTitle>Active Positions</CardTitle>
              <CardDescription>
                Session-confirmed deposits stay visible while you open more
                positions.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {activePositions.map((position) => (
                <div
                  className="rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-4"
                  key={position.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <AssetIcon symbol={position.symbol} />
                      <div>
                        <div className="font-semibold text-emerald-100">
                          Success: {formatAmount(position.amountUi, 6)}{" "}
                          {position.symbol} deposited
                        </div>
                        <div className="mt-1 text-sm text-emerald-100/70">
                          {position.marketName}
                        </div>
                      </div>
                    </div>
                    <CheckCircle2 className="size-5 shrink-0 text-emerald-300" />
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      asChild
                      className="bg-solflare text-black hover:bg-solflare/90"
                      size="sm"
                    >
                      <a href={KAMINO_APP_URL} rel="noreferrer" target="_blank">
                        <ExternalLink data-icon="inline-start" />
                        Manage on Kamino
                      </a>
                    </Button>
                    <Button
                      asChild
                      className="border-white/10 bg-white/[0.03]"
                      size="sm"
                      variant="outline"
                    >
                      <a
                        href={`${SOLSCAN_BASE}/${position.signature}`}
                        rel="noreferrer"
                        target="_blank"
                      >
                        Tx {shortKey(position.signature)}
                      </a>
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}

        <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <Card className="border-white/10 bg-zinc-950/75 backdrop-blur-xl">
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <CardTitle>Transaction Terminal</CardTitle>
                  <CardDescription>
                    Client state, API calls, simulation and wallet signing logs.
                  </CardDescription>
                </div>
                <Badge
                  variant={screenState === "error" ? "warning" : "outline"}
                  className="border-white/10"
                >
                  {screenState}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="min-h-72 rounded-lg border border-white/10 bg-black/70 p-4 font-mono text-sm">
                {terminal.map((line, index) => (
                  <div
                    className="flex flex-col gap-1 py-1 md:flex-row md:gap-3"
                    key={`${line.timestamp}-${line.message}-${index}`}
                  >
                    <span className="shrink-0 text-zinc-600">
                      {line.timestamp}
                    </span>
                    <span className={cn("break-words", getTerminalClass(line.level))}>
                      [{line.level}] {line.message}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-zinc-950/75 backdrop-blur-xl">
            <CardHeader>
              <CardTitle>Execution Status</CardTitle>
              <CardDescription>
                Simulation result and final transaction signature.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <StatusBlock
                active={Boolean(route)}
                icon={LockKeyhole}
                title="Unsigned payload"
                description="Server builds base64 transaction. Browser deserializes it before signing."
              />
              <StatusBlock
                active={screenState === "executing" || screenState === "success"}
                icon={ArrowRight}
                title="Wallet handoff"
                description="VersionedTransaction bytes are passed to Solflare via signTransaction."
              />
              <StatusBlock
                active={Boolean(signature)}
                icon={CheckCircle2}
                title="Confirmed"
                description={
                  signature
                    ? `Latest signature: ${shortKey(signature)}`
                    : "Waiting for signed transaction."
                }
              />
              {error ? (
                <div className="rounded-lg border border-red-400/20 bg-red-500/10 p-4 text-sm text-red-200">
                  <div className="flex items-center gap-2 font-semibold">
                    <CircleAlert className="size-4" />
                    Error
                  </div>
                  <p className="mt-2 break-words text-red-100/80">{error}</p>
                </div>
              ) : null}
              {signature ? (
                <Button
                  asChild
                  variant="outline"
                  className="border-solflare/25 bg-solflare/10 text-solflare hover:bg-solflare/20"
                >
                  <a
                    href={`${SOLSCAN_BASE}/${signature}`}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <ExternalLink data-icon="inline-start" />
                    Open in Solscan
                  </a>
                </Button>
              ) : null}
            </CardContent>
          </Card>
        </section>

        {candidates.length > 0 ? (
          <Card className="border-white/10 bg-zinc-950/70 backdrop-blur-xl">
            <CardHeader>
              <CardTitle>Eligible Kamino Candidates</CardTitle>
              <CardDescription>
                Top {selectedAsset} reserves after backend safety filters.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-3">
              {candidates.slice(0, 3).map((candidate) => (
                <div
                  className="rounded-lg border border-white/10 bg-white/[0.03] p-4"
                  key={`${candidate.marketAddress}-${candidate.reserveAddress}`}
                >
                  <div className="font-semibold text-zinc-100">
                    {candidate.marketName}
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3 text-sm text-zinc-400">
                    <span>APY</span>
                    <span className="font-semibold text-solflare">
                      {formatPercent(candidate.supplyApyPct)}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3 text-sm text-zinc-400">
                    <span>TVL</span>
                    <span>${formatAmount(candidate.totalSupplyUsd, 0)}</span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </main>
  );
}

function BalanceRow({
  asset,
  label,
  value,
  subvalue,
  accent = false,
  selected = false,
  onSelect,
}: {
  asset: PortfolioAsset | null | undefined;
  label: PortfolioAsset["symbol"];
  value: string;
  subvalue: string;
  accent?: boolean;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const content = (
    <>
      <div className="flex items-center gap-3">
        <AssetIcon symbol={label} />
        <div>
          <div className="text-sm text-zinc-500">{label}</div>
          <div className="mt-1 text-3xl font-semibold tracking-normal text-zinc-50">
            {value}
          </div>
        </div>
      </div>
      <Badge variant={accent ? "warning" : "outline"}>
        {selected ? "Selected" : subvalue}
      </Badge>
    </>
  );

  const className = cn(
    "flex items-center justify-between gap-4 rounded-lg border bg-white/[0.03] p-4 text-left transition-colors",
    selected ? "border-solflare/45 bg-solflare/10" : "border-white/10",
    onSelect ? "cursor-pointer hover:border-solflare/35" : "",
  );

  if (onSelect) {
    return (
      <button className={className} onClick={onSelect} type="button">
        {content}
      </button>
    );
  }

  return <div className={className}>{content}</div>;
}

function AssetIcon({ symbol }: { symbol: PortfolioAsset["symbol"] }) {
  return (
    <div className="flex size-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-zinc-900 p-1 shadow-lg shadow-black/20">
      <img
        alt={`${symbol} logo`}
        className="size-8 rounded-full object-contain"
        loading="lazy"
        referrerPolicy="no-referrer"
        src={TOKEN_ICONS[symbol]}
      />
    </div>
  );
}

function Metric({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
        {label}
      </div>
      <div
        className={cn(
          "mt-3 min-h-14 text-2xl font-semibold leading-tight tracking-normal",
          highlight ? "text-solflare" : "text-zinc-50",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function LoadingPortfolio() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-24" />
      <Skeleton className="h-24" />
      <Skeleton className="h-24" />
      <Skeleton className="h-32" />
    </div>
  );
}

function LoadingRoute() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-3">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
      <Skeleton className="h-32" />
      <Skeleton className="h-12" />
    </div>
  );
}

function EmptyRoute({
  error,
  selectedAsset,
}: {
  error: string | null;
  selectedAsset: DepositAssetSymbol;
}) {
  const rateLimited = Boolean(error?.toLowerCase().includes("rate limited"));

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-6 text-center">
      <CircleAlert className="mx-auto size-10 text-solflare" />
      <h2 className="mt-4 text-xl font-semibold">
        {rateLimited ? "Rate limited" : "Route unavailable"}
      </h2>
      <p className="mt-2 text-sm text-zinc-400">
        {error ||
          `Connect wallet and refresh portfolio to calculate a ${selectedAsset} route.`}
      </p>
    </div>
  );
}

function RetryingRoutePlan() {
  return (
    <div className="flex min-h-80 flex-col items-center justify-center rounded-lg border border-solflare/20 bg-solflare/10 p-6 text-center">
      <div className="flex size-12 items-center justify-center rounded-lg bg-solflare text-black">
        <Loader2 className="animate-spin" />
      </div>
      <h2 className="mt-4 text-xl font-semibold text-zinc-50">
        Network congested
      </h2>
      <p className="mt-2 max-w-sm text-sm leading-6 text-zinc-300">
        Retrying in 3 seconds...
      </p>
    </div>
  );
}

function StatusBlock({
  active,
  icon: Icon,
  title,
  description,
}: {
  active: boolean;
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        active
          ? "border-solflare/25 bg-solflare/10"
          : "border-white/10 bg-white/[0.03]",
      )}
    >
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex size-9 items-center justify-center rounded-md",
            active ? "bg-solflare text-black" : "bg-zinc-800 text-zinc-400",
          )}
        >
          <Icon className="size-4" />
        </div>
        <div>
          <div className="font-semibold text-zinc-100">{title}</div>
          <div className="mt-1 text-sm leading-5 text-zinc-400">
            {description}
          </div>
        </div>
      </div>
    </div>
  );
}
