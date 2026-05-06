export async function getKaminoSdkCapabilities() {
  const sdk = await import("@kamino-finance/klend-sdk");

  return {
    hasKaminoMarket: "KaminoMarket" in sdk,
    hasKaminoAction: "KaminoAction" in sdk,
    hasLendingObligation: "LendingObligation" in sdk,
    hasVanillaObligation: "VanillaObligation" in sdk,
  };
}
