import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { GitHubConnection } from "@prisma/client";
import { GitHubError } from "./errors";

const KEY_BYTES = 32;
const IV_BYTES = 12;
const ALGORITHM = "aes-256-gcm";

export type EncryptedToken = {
  tokenCiphertext: string;
  tokenIv: string;
  tokenTag: string;
  tokenLast4: string;
};

function encryptionKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) {
    throw new GitHubError(
      "encryption_key_missing",
      "APP_ENCRYPTION_KEY is required to store GitHub tokens",
      503,
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new GitHubError(
      "encryption_key_missing",
      "APP_ENCRYPTION_KEY must be a base64-encoded 32-byte key",
      503,
    );
  }
  return key;
}

export function encryptionConfigured(): boolean {
  try {
    encryptionKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptGitHubToken(token: string): EncryptedToken {
  const key = encryptionKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  return {
    tokenCiphertext: ciphertext.toString("base64"),
    tokenIv: iv.toString("base64"),
    tokenTag: cipher.getAuthTag().toString("base64"),
    tokenLast4: token.slice(-4),
  };
}

export function decryptGitHubToken(
  connection: Pick<
    GitHubConnection,
    "tokenCiphertext" | "tokenIv" | "tokenTag"
  >,
): string {
  const key = encryptionKey();
  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(connection.tokenIv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(connection.tokenTag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(connection.tokenCiphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new GitHubError(
      "invalid_token",
      "Stored GitHub token could not be decrypted",
      503,
    );
  }
}

export function envGitHubToken(): string | null {
  const token = process.env.GITHUB_TOKEN?.trim();
  return token ? token : null;
}

export function resolveGitHubToken(
  connection: Pick<
    GitHubConnection,
    "tokenCiphertext" | "tokenIv" | "tokenTag"
  > | null,
): string {
  if (connection) return decryptGitHubToken(connection);
  const token = envGitHubToken();
  if (token) return token;
  throw new GitHubError(
    "not_configured",
    "Connect GitHub or set GITHUB_TOKEN before using GitHub",
    503,
  );
}

export function maskToken(token: string): string {
  return `••••${token.slice(-4)}`;
}
