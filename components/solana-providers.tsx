"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { Connection } from "@solana/web3.js";
import { Toaster } from "sonner";
import {
  PUBLIC_SOLANA_RPC_ENDPOINT,
  isRpcAccessDenied,
  isRpcUnavailable,
} from "@/lib/solana/rpc-errors";

type RpcFallbackContextValue = {
  activeEndpoint: string;
  fallbackEndpoint: string;
  primaryEndpoint: string;
  isUsingFallback: boolean;
  switchToFallback: (reason: string) => void;
  createFallbackConnection: () => Connection;
};

const RpcFallbackContext = createContext<RpcFallbackContextValue | null>(null);

export function useRpcFallback() {
  const context = useContext(RpcFallbackContext);

  if (!context) {
    throw new Error("useRpcFallback must be used inside SolanaProviders");
  }

  return context;
}

export function SolanaProviders({ children }: { children: React.ReactNode }) {
  const primaryEndpoint =
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() || PUBLIC_SOLANA_RPC_ENDPOINT;
  const fallbackEndpoint = PUBLIC_SOLANA_RPC_ENDPOINT;
  const [activeEndpoint, setActiveEndpoint] = useState(primaryEndpoint);

  const wallets = useMemo(
    () => [new SolflareWalletAdapter({ network: WalletAdapterNetwork.Mainnet })],
    [],
  );
  const isUsingFallback = activeEndpoint === fallbackEndpoint;
  const switchToFallback = useCallback(
    (reason: string) => {
      if (activeEndpoint === fallbackEndpoint) return;

      console.warn(
        `[rpc] ${reason}. Switching ConnectionProvider to ${fallbackEndpoint}`,
      );
      setActiveEndpoint(fallbackEndpoint);
    },
    [activeEndpoint, fallbackEndpoint],
  );
  const createFallbackConnection = useCallback(
    () =>
      new Connection(fallbackEndpoint, {
        commitment: "confirmed",
        confirmTransactionInitialTimeout: 60_000,
      }),
    [fallbackEndpoint],
  );
  const fallbackContextValue = useMemo(
    () => ({
      activeEndpoint,
      fallbackEndpoint,
      primaryEndpoint,
      isUsingFallback,
      switchToFallback,
      createFallbackConnection,
    }),
    [
      activeEndpoint,
      createFallbackConnection,
      fallbackEndpoint,
      isUsingFallback,
      primaryEndpoint,
      switchToFallback,
    ],
  );

  useEffect(() => {
    if (primaryEndpoint === fallbackEndpoint) return;

    const controller = new AbortController();

    async function checkPrimaryEndpoint() {
      try {
        const response = await fetch(primaryEndpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "yieldroute-health",
            method: "getHealth",
          }),
          signal: controller.signal,
        });

        if (response.status === 403) {
          switchToFallback("primary RPC health check returned 403");
          return;
        }

        if (!response.ok) {
          const body = await response.text();
          if (isRpcAccessDenied(`${response.status} ${body}`)) {
            switchToFallback("primary RPC health check was forbidden");
          }
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        if (isRpcUnavailable(error)) {
          switchToFallback("primary RPC health check failed");
        }
      }
    }

    void checkPrimaryEndpoint();

    return () => controller.abort();
  }, [fallbackEndpoint, primaryEndpoint, switchToFallback]);

  return (
    <ConnectionProvider endpoint={activeEndpoint}>
      <RpcFallbackContext.Provider value={fallbackContextValue}>
        <WalletProvider wallets={wallets} autoConnect>
          <WalletModalProvider>
            {children}
            <Toaster
              position="bottom-right"
              theme="dark"
              toastOptions={{
                style: {
                  background: "rgba(24, 24, 27, 0.94)",
                  border: "1px solid rgba(255, 239, 70, 0.28)",
                  color: "#fafafa",
                },
              }}
            />
          </WalletModalProvider>
        </WalletProvider>
      </RpcFallbackContext.Provider>
    </ConnectionProvider>
  );
}
