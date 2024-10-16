import { createTree, mplBubblegum } from "@metaplex-foundation/mpl-bubblegum";
import { createSignerFromKeypair, generateSigner, signerIdentity } from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { Connection, Keypair, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { fromWeb3JsKeypair, toWeb3JsInstruction, toWeb3JsKeypair } from "@metaplex-foundation/umi-web3js-adapters";

import { config } from "../config";

const main = async () => {
  const keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(config.SECRET_KEY) as unknown as number[]));

  const umi = createUmi(config.RPC_URL);

  const connection = new Connection(config.RPC_URL, "confirmed");

  umi.use(mplBubblegum()).use(signerIdentity(createSignerFromKeypair(umi, fromWeb3JsKeypair(keypair))));

  const merkleTree = generateSigner(umi);

  const createTreeTxBuilder = await createTree(umi, {
    merkleTree,
    maxDepth: 14,
    maxBufferSize: 64,
  });

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

  const transaction = new VersionedTransaction(
    new TransactionMessage({
      payerKey: keypair.publicKey,
      instructions: [...createTreeTxBuilder.getInstructions().map(toWeb3JsInstruction)],
      recentBlockhash: blockhash,
    }).compileToV0Message()
  );

  transaction.sign([keypair, toWeb3JsKeypair(merkleTree)]);

  const signature = await connection.sendTransaction(transaction);

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
