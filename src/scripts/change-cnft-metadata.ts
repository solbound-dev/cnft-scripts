import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { getAssetWithProof, mplBubblegum, UpdateArgsArgs, updateMetadata } from "@metaplex-foundation/mpl-bubblegum";
import {
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { fromWeb3JsKeypair, fromWeb3JsPublicKey, toWeb3JsInstruction } from "@metaplex-foundation/umi-web3js-adapters";
import { createGenericFile, createSignerFromKeypair, signerIdentity, some } from "@metaplex-foundation/umi";
import { irysUploader } from "@metaplex-foundation/umi-uploader-irys";
import path from "path";
import fs from "fs";

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

  let i = 0;

  const { blockhash: createBlockhash, lastValidBlockHeight: createLastValidBlockheight } =
    await connection.getLatestBlockhash();

  const slot = await connection.getSlot("finalized");

  const [createLookupTableInstruction, lookupTableAddress] = AddressLookupTableProgram.createLookupTable({
    authority: keypair.publicKey,
    payer: keypair.publicKey,
    recentSlot: slot,
  });

  const extendLookupTableInstruction = AddressLookupTableProgram.extendLookupTable({
    payer: keypair.publicKey,
    authority: keypair.publicKey,
    lookupTable: lookupTableAddress,
    addresses: [SystemProgram.programId, constants.COLLECTION_PUBKEY, constants.MERKLE_TREE_PUBKEY],
  });

  const lookupTableTransaction = new VersionedTransaction(
    new TransactionMessage({
      payerKey: keypair.publicKey,
      instructions: [
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 3_500 }),
        createLookupTableInstruction,
        extendLookupTableInstruction,
      ],
      recentBlockhash: createBlockhash,
    }).compileToV0Message()
  );

  lookupTableTransaction.sign([keypair]);

  const lookupTableSignature = await connection.sendTransaction(lookupTableTransaction);

  const lookupTableResult = await connection.confirmTransaction(
    {
      signature: lookupTableSignature,
      blockhash: createBlockhash,
      lastValidBlockHeight: createLastValidBlockheight,
    },
    "finalized"
  );

  console.log(`Lookup Table creation succeeded`);
  console.log({
    lookupTableSignature,
    lookupTableResult,
  });

  for (const asset of assets) {
    const instructions: TransactionInstruction[] = [];

    const updateArgs: UpdateArgsArgs = {
      name: some(constants.ASSET_NAME),
      uri: some(uri),
    };

    const assetWithProof = await getAssetWithProof(umi, fromWeb3JsPublicKey(new PublicKey(asset.id)));

    const updateMetadataTxBuilder = updateMetadata(umi, {
      ...assetWithProof,
      leafOwner: fromWeb3JsPublicKey(new PublicKey(asset.ownership.owner)),
      currentMetadata: assetWithProof.metadata,
      updateArgs,
      authority: createSignerFromKeypair(umi, fromWeb3JsKeypair(keypair)),
      collectionMint: fromWeb3JsPublicKey(constants.COLLECTION_PUBKEY),
    });

    instructions.push(...updateMetadataTxBuilder.getInstructions().map(toWeb3JsInstruction));

    try {
      const lookupTableAccount = await connection.getAddressLookupTable(lookupTableAddress);

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

      const transaction = new VersionedTransaction(
        new TransactionMessage({
          payerKey: keypair.publicKey,
          instructions: [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 3_500 }), ...instructions],
          recentBlockhash: blockhash,
        }).compileToV0Message(lookupTableAccount?.value ? [lookupTableAccount.value!] : [])
      );

      transaction.sign([keypair]);

      const signature = await connection.sendTransaction(transaction);

      const result = await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight,
      });

      console.log(`Tx ${i + 1} out of ${assets.length} succeeded`);
      console.log({
        signature,
        result,
      });
    } catch (error: unknown) {
      console.error(`Tx ${i + 1} out of ${assets.length} failed`);
      console.error(`Error message: ${(error as Error).message}`);
    } finally {
      i++;
    }
  }
};

main();
