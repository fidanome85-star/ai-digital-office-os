import { ModelRouterError } from "./errors.js";

export interface SecretResolver {
  resolve(vaultPath: string): Promise<string>;
}

/**
 * Stand-in for a real Vault/KMS-backed resolver (blueprint clause 46 —
 * secrets_vault_references stores a pointer, never a raw secret). Resolves
 * a `vault_path` of the form "env:VAR_NAME" from process.env, entirely
 * offline. `SecretResolver` is the seam: a production deployment swaps in
 * a real Vault/KMS client without changing anything that calls it.
 */
export class EnvSecretResolver implements SecretResolver {
  async resolve(vaultPath: string): Promise<string> {
    const match = /^env:(.+)$/.exec(vaultPath);
    if (!match) {
      throw new ModelRouterError("SECRET_NOT_FOUND", `Unsupported vault_path format (expected "env:VAR_NAME"): ${vaultPath}`);
    }
    const varName = match[1]!;
    const value = process.env[varName];
    if (!value) {
      throw new ModelRouterError("SECRET_NOT_FOUND", `Environment variable ${varName} is not set.`);
    }
    return value;
  }
}
