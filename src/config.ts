import "dotenv/config";

export const config = {
  RPC_URL: process.env.RPC_URL!,
  SECRET_KEY: process.env.SECRET_KEY!,
} as const;
