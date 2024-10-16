import {
  createGenericFile,
  createSignerFromKeypair,
  generateSigner,
  percentAmount,
  signerIdentity,
} from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { ComputeBudgetProgram, Connection, Keypair, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { fromWeb3JsKeypair, toWeb3JsInstruction, toWeb3JsKeypair } from "@metaplex-foundation/umi-web3js-adapters";
import { irysUploader } from "@metaplex-foundation/umi-uploader-irys";
import { createV1, mplTokenMetadata, TokenStandard } from "@metaplex-foundation/mpl-token-metadata";
import path from "path";
import fs from "fs";

import { config } from "../config";
import { fromArweaveToIrysGateway } from "../utils/irys";

const constants = {
  COLLECTION_NAME: "",
  COLLECTION_DESCRIPTION: "",
  COLLECTION_IMAGE_PATH: path.join(process.cwd(), "assets", ""),
  NFT_IMAGE_OUTPUT_NAME: "",
  COLLECTION_IMAGE_MIME_TYPE: "",
} as const;

const main = async () => {
  const keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(config.SECRET_KEY) as unknown as number[]));

  const umi = createUmi(config.RPC_URL);

  const connection = new Connection(config.RPC_URL, "confirmed");

  umi
    .use(mplTokenMetadata())
    .use(irysUploader())
    .use(signerIdentity(createSignerFromKeypair(umi, fromWeb3JsKeypair(keypair))));

  const gif = fs.readFileSync(constants.COLLECTION_IMAGE_PATH);

  const img = createGenericFile(gif, constants.NFT_IMAGE_OUTPUT_NAME, {
    contentType: constants.COLLECTION_IMAGE_MIME_TYPE,
  });

  console.log("Uploading image to irys...");

  const [imageUri] = await umi.uploader.upload([img]);

  console.log(`Image uri: ${fromArweaveToIrysGateway(imageUri)}`);

  console.log("Uploading metadata to irys...");

  const uri = await umi.uploader.uploadJson({
    name: constants.COLLECTION_NAME,
    description: constants.COLLECTION_DESCRIPTION,
    image: fromArweaveToIrysGateway(imageUri),
  });

  console.log(`Metadata uri: ${fromArweaveToIrysGateway(uri)}`);

  const collectionSigner = generateSigner(umi);

  const createCollectionTxBuilder = createV1(umi, {
    mint: collectionSigner,
    authority: createSignerFromKeypair(umi, fromWeb3JsKeypair(keypair)),
    name: constants.COLLECTION_NAME,
    tokenStandard: TokenStandard.ProgrammableNonFungible,
    sellerFeeBasisPoints: percentAmount(0),
    uri: fromArweaveToIrysGateway(uri),
    payer: createSignerFromKeypair(umi, fromWeb3JsKeypair(keypair)),
    isCollection: true,
  });

  console.log("Fetching the latest blockhash...");

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

  const transaction = new VersionedTransaction(
    new TransactionMessage({
      payerKey: keypair.publicKey,
      instructions: [
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10500 }),
        ...createCollectionTxBuilder.getInstructions().map(toWeb3JsInstruction),
      ],
      recentBlockhash: blockhash,
    }).compileToV0Message()
  );

  transaction.sign([keypair, toWeb3JsKeypair(collectionSigner)]);

  console.log("Sending the transaction...");

  const signature = await connection.sendTransaction(transaction);

  console.log("Confirming the transaction...");

  const result = await connection.confirmTransaction({
    signature,
    blockhash,
    lastValidBlockHeight,
  });

  console.log({
    signature,
    result,
  });
};

main();
