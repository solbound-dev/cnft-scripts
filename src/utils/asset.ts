import { PublicKey as UmiPublicKey } from "@metaplex-foundation/umi";
import { DAS } from "helius-sdk";

import { config } from "../config";

export const fetchAllAssetsByCollectionPubkey = async (
  collectionPubkey: UmiPublicKey
): Promise<DAS.GetAssetResponse[]> => {
  const nfts: DAS.GetAssetResponse[] = [];
  let pageNfts: DAS.GetAssetResponse[] = [];

  let page = 1;

  do {
    const response = await fetch(config.RPC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "my-id",
        method: "getAssetsByGroup",
        params: {
          groupKey: "collection",
          groupValue: collectionPubkey,
          limit: 1000,
          page,
          displayOptions: {
            showClosedAccounts: true,
            showZeroBalance: true,
          },
        },
      }),
    });

    page++;

    const { result } = (await response.json()) as { result: DAS.GetAssetResponseList };

    if (!!result) {
      pageNfts = result.items;
      nfts.push(...result.items);
    }
  } while (pageNfts.length > 0);

  return nfts;
};
