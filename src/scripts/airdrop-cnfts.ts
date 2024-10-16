import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { mintToCollectionV1, mplBubblegum } from "@metaplex-foundation/mpl-bubblegum";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { fromWeb3JsKeypair, fromWeb3JsPublicKey, toWeb3JsInstruction } from "@metaplex-foundation/umi-web3js-adapters";
import { chunk, createGenericFile, createSignerFromKeypair, signerIdentity } from "@metaplex-foundation/umi";
import { irysUploader } from "@metaplex-foundation/umi-uploader-irys";
import pLimit from "p-limit";
import path from "path";
import fs from "fs";

import airdropAddresses from "../constants/airdrop-list.json";
import { fetchAllAssetsByCollectionPubkey } from "../utils/asset";
import { config } from "../config";
import { fromArweaveToIrysGateway } from "../utils/irys";

const constants = {
  COLLECTION_PUBKEY: new PublicKey(""),
  MERKLE_TREE_PUBKEY: new PublicKey(""),
  ASSET_NAME: "",
  ASSET_DESCRIPTION: "",
  ASSET_IMAGE_PATH: path.join(process.cwd(), "assets", ""),
  ASSET_IMAGE_OUTPUT_NAME: "",
  ASSET_IMAGE_MIME_TYPE: "",
};

const main = async () => {
  const keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(config.SECRET_KEY) as unknown as number[]));

  const umi = createUmi(config.RPC_URL, "confirmed");

  const connection = new Connection(config.RPC_URL, "confirmed");

  umi
    .use(mplBubblegum())
    .use(irysUploader())
    .use(signerIdentity(createSignerFromKeypair(umi, fromWeb3JsKeypair(keypair))));

  const assets = await fetchAllAssetsByCollectionPubkey(fromWeb3JsPublicKey(constants.COLLECTION_PUBKEY));

  const filteredAirdropAddresses = airdropAddresses.filter(
    (address) => !assets.some((asset) => asset.ownership.owner === address)
  );

  const gif = fs.readFileSync(constants.ASSET_IMAGE_PATH);

  const img = createGenericFile(gif, constants.ASSET_IMAGE_OUTPUT_NAME, {
    contentType: constants.ASSET_IMAGE_MIME_TYPE,
  });

  console.log("Uploading image to irys...");

  const [imageUri] = await umi.uploader.upload([img]);

  console.log(`Image uri: ${fromArweaveToIrysGateway(imageUri)}`);

  console.log("Uploading metadata to irys...");

  const uri = await umi.uploader.uploadJson({
    name: constants.ASSET_NAME,
    description: constants.ASSET_DESCRIPTION,
    image: fromArweaveToIrysGateway(imageUri),
  });

  console.log(`Metadata uri: ${fromArweaveToIrysGateway(uri)}`);

  const promises: Promise<void>[] = [];

  const limit = pLimit(5);

  let i = 0;

  const chunkSize = 3;

  for (const addressesChunk of chunk(
    filteredAirdropAddresses.map(({ address }) => address),
    chunkSize
  )) {
    const instructions: TransactionInstruction[] = [];

    for (const address of addressesChunk) {
      const mintToCollectionTxBuilder = mintToCollectionV1(umi, {
        leafOwner: fromWeb3JsPublicKey(new PublicKey(address)),
        merkleTree: fromWeb3JsPublicKey(constants.MERKLE_TREE_PUBKEY),
        collectionMint: fromWeb3JsPublicKey(constants.COLLECTION_PUBKEY),
        metadata: {
          name: constants.ASSET_NAME,
          uri: fromArweaveToIrysGateway(uri),
          sellerFeeBasisPoints: 0,
          collection: { key: fromWeb3JsPublicKey(constants.COLLECTION_PUBKEY), verified: true },
          creators: [],
        },
      });

      instructions.push(...mintToCollectionTxBuilder.getInstructions().map(toWeb3JsInstruction));
    }

    const promise = limit(async () => {
      try {
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

        const transaction = new VersionedTransaction(
          new TransactionMessage({
            payerKey: keypair.publicKey,
            instructions: [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_500 }), ...instructions],
            recentBlockhash: blockhash,
          }).compileToV0Message()
        );

        transaction.sign([keypair]);

        const signature = await connection.sendTransaction(transaction);

        const result = await connection.confirmTransaction({
          signature,
          blockhash,
          lastValidBlockHeight,
        });

        console.log(`Tx ${i + 1} out of ${Math.ceil(filteredAirdropAddresses.length / chunkSize)} succeeded`);
        console.log({
          signature,
          result,
        });
      } catch {
        console.error(`Tx ${i + 1} out of ${Math.ceil(filteredAirdropAddresses.length / chunkSize)} failed`);
      } finally {
        i++;
      }
    });

    promises.push(promise);
  }

  await Promise.all(promises);
};

main();
