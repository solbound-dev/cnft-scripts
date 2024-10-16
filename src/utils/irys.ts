export const fromArweaveToIrysGateway = (uri: string): string => {
  return uri.replace("https://arweave.net", "https://gateway.irys.xyz");
};
