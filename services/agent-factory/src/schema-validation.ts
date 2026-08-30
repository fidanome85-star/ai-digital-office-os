import AjvModule from "ajv";

const Ajv = AjvModule.default ?? AjvModule;

export interface SchemaValidationResult {
  valid: boolean;
  errors: string[];
}

// strict:false — agents may declare loose/partial JSON Schema documents at
// this stage (structural draft, not yet validating real payloads against
// it); we only need to know the document itself is well-formed enough for
// Ajv to compile, not enforce every strict-mode nicety.
const ajv = new Ajv({ strict: false });

/** Purely offline — Ajv never makes a network call, even for a schema with
 * a $ref, unless the ref is itself a remote URL the caller adds a loader
 * for (never done here). Compiles the schema; doesn't validate any data
 * against it (there's no agent output yet at this pipeline stage). */
export function validateJsonSchemaShape(schema: unknown, label: string): SchemaValidationResult {
  if (schema === null || schema === undefined) {
    return { valid: true, errors: [] };
  }
  if (typeof schema !== "object" || Array.isArray(schema)) {
    return { valid: false, errors: [`${label} must be a JSON object`] };
  }
  try {
    ajv.compile(schema as Record<string, unknown>);
    return { valid: true, errors: [] };
  } catch (err) {
    return { valid: false, errors: [`${label}: ${err instanceof Error ? err.message : String(err)}`] };
  }
}
