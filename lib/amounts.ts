export function sanitizeTokenAmountInput(amountUi: unknown) {
  return String(amountUi ?? "")
    .trim()
    .replace(",", ".");
}

export function parseTokenAmount(amountUi: unknown) {
  const sanitizedAmount = sanitizeTokenAmountInput(amountUi);
  if (!sanitizedAmount) return null;

  const amount = Number(sanitizedAmount);
  return Number.isFinite(amount) ? amount : null;
}

export function tokenAmountToRaw(amountUi: unknown, decimals: number) {
  const raw = tokenAmountToRawBigInt(amountUi, decimals);
  return raw === null ? null : raw.toString();
}

export function tokenAmountToRawBigInt(amountUi: unknown, decimals: number) {
  const sanitizedAmount = sanitizeTokenAmountInput(amountUi);
  if (!sanitizedAmount) return null;

  if (!/^\d+(\.\d+)?$/.test(sanitizedAmount)) {
    return null;
  }

  const [wholePart, fractionPart = ""] = sanitizedAmount.split(".");
  const extraPrecision = fractionPart.slice(decimals);

  if (extraPrecision.length > 0 && /[1-9]/.test(extraPrecision)) {
    throw new Error(`Amount has more than ${decimals} decimal places`);
  }

  const paddedFraction = fractionPart.slice(0, decimals).padEnd(decimals, "0");
  return BigInt(wholePart || "0") * 10n ** BigInt(decimals) + BigInt(paddedFraction || "0");
}

export function assertNoFractionalRawAmount(amountUi: unknown, decimals: number) {
  const sanitizedAmount = sanitizeTokenAmountInput(amountUi);
  const scaled = parseFloat(sanitizedAmount) * 10 ** decimals;

  if (!Number.isFinite(scaled) || !Number.isInteger(Math.round(scaled))) {
    throw new Error("Invalid token amount precision");
  }

  return BigInt(Math.round(scaled));
}
