export const PUBLIC_SOLANA_RPC_ENDPOINT = "https://api.mainnet-beta.solana.com";

function stringifyRpcError(error: unknown): string {
  if (error instanceof Error) {
    const cause =
      "cause" in error && error.cause
        ? ` ${stringifyRpcError(error.cause)}`
        : "";
    return `${error.name}: ${error.message}${cause}`;
  }

  if (typeof error === "string") return error;

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function isRpcAccessDenied(error: unknown) {
  const text = stringifyRpcError(error).toLowerCase();

  return (
    text.includes("403") ||
    text.includes("access forbidden") ||
    text.includes("access denied") ||
    text.includes("forbidden")
  );
}

export function isRpcUnavailable(error: unknown) {
  const text = stringifyRpcError(error).toLowerCase();

  return (
    isRpcAccessDenied(error) ||
    text.includes("failed to fetch") ||
    text.includes("networkerror") ||
    text.includes("network error") ||
    text.includes("load failed")
  );
}

export function isRpcRateLimited(error: unknown) {
  const text = stringifyRpcError(error).toLowerCase();

  return (
    text.includes("429") ||
    text.includes("too many requests") ||
    text.includes("rate limit") ||
    text.includes("rate-limited") ||
    text.includes("rate limited")
  );
}

export function getFriendlyRpcErrorMessage(error: unknown) {
  if (isRpcAccessDenied(error)) {
    return "RPC Access Denied. Switching to public network...";
  }

  if (isRpcRateLimited(error)) {
    return "Network congested. Retrying in 3 seconds...";
  }

  return error instanceof Error
    ? error.message
    : "Transaction failed to broadcast due to RPC limits. Please try again.";
}
