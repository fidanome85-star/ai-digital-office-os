/**
 * Same stand-in every other service in this repo defines locally
 * (services/model-router-gateway/src/secrets.ts) — resolves a
 * secrets_vault_references.vault_path of the form "env:VAR_NAME" from
 * process.env, entirely offline. secrets_vault_references stores a
 * pointer, never a raw secret (blueprint clause 46). Duplicated by design
 * rather than shared: it's a ~10-line stand-in for a real Vault/KMS
 * client, and each service owning its own copy avoids a shared package
 * whose only job is "swap this one line later" (see docs/decisions/0004).
 */
export interface SecretResolver {
  resolve(vaultPath: string): Promise<string>;
}

export class EnvSecretResolver implements SecretResolver {
  async resolve(vaultPath: string): Promise<string> {
    const match = /^env:(.+)$/.exec(vaultPath);
    if (!match) {
      throw new Error(`Unsupported vault_path format (expected "env:VAR_NAME"): ${vaultPath}`);
    }
    const varName = match[1]!;
    const value = process.env[varName];
    if (!value) {
      throw new Error(`Environment variable ${varName} is not set.`);
    }
    return value;
  }
}
