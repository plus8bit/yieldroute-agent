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
  const amount = parseTokenAmount(amountUi);
  if (amount === null) return null;

  return Math.floor(amount * 10 ** decimals).toString();
}
