/**
 * Clause-69 consistency gate: generates the canonical TypeScript domain
 * model FROM the live schema produced by packages/db/migrations (source of
 * truth), not the other way around. Run `pnpm db:migrate` first, then
 * `pnpm domain-model:generate`. Re-run and diff in CI so SQL and the
 * domain model cannot drift (see tests/acceptance).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "src", "generated");

const DATABASE_URL = process.env["DATABASE_URL"];
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set. Run packages/db migrations first, then generate.");
  process.exit(1);
}

interface ColumnRow {
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: "YES" | "NO";
  column_default: string | null;
}

interface PrimaryKeyRow {
  table_name: string;
  column_name: string;
}

const EXCLUDED_TABLES = new Set(["schema_migrations"]);

function toPascalCase(snake: string): string {
  return snake
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function toCamelCase(snake: string): string {
  const pascal = toPascalCase(snake);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/** Maps a Postgres type to its canonical TS representation. jsonb/json stay
 * `unknown` here deliberately — each service narrows its own JSONB shapes
 * (policy documents, capability lists, etc.) rather than this shared
 * package guessing at payload shape. */
function pgTypeToTs(dataType: string, udtName: string): string {
  switch (dataType) {
    case "uuid":
    case "character varying":
    case "text":
    case "character":
      return "string";
    case "integer":
    case "smallint":
    case "real":
    case "double precision":
    case "numeric":
      return "number";
    case "bigint":
      // bigint exceeds Number.MAX_SAFE_INTEGER territory for some counters
      // (token counts, cost ledgers) — represented as string to avoid silent
      // precision loss; parse with BigInt() where arithmetic is needed.
      return "string";
    case "boolean":
      return "boolean";
    case "jsonb":
    case "json":
      return "unknown";
    case "timestamp with time zone":
    case "timestamp without time zone":
    case "date":
      return "string";
    case "ARRAY":
      return arrayElementTs(udtName) + "[]";
    case "USER-DEFINED":
      return udtName === "vector" ? "number[]" : "unknown";
    default:
      return "unknown";
  }
}

function arrayElementTs(udtName: string): string {
  // udt_name for an array column is the element type prefixed with "_",
  // e.g. "_text", "_uuid".
  const element = udtName.replace(/^_/, "");
  switch (element) {
    case "uuid":
    case "text":
    case "varchar":
      return "string";
    case "int4":
    case "int8":
    case "numeric":
      return "number";
    default:
      return "unknown";
  }
}

async function main(): Promise<void> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  const { rows: columns } = await client.query<ColumnRow>(`
    SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position;
  `);

  const { rows: primaryKeys } = await client.query<PrimaryKeyRow>(`
    SELECT tc.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public';
  `);

  await client.end();

  const pkByTable = new Map<string, Set<string>>();
  for (const pk of primaryKeys) {
    if (!pkByTable.has(pk.table_name)) pkByTable.set(pk.table_name, new Set());
    pkByTable.get(pk.table_name)!.add(pk.column_name);
  }

  const columnsByTable = new Map<string, ColumnRow[]>();
  for (const col of columns) {
    if (EXCLUDED_TABLES.has(col.table_name)) continue;
    if (!columnsByTable.has(col.table_name)) columnsByTable.set(col.table_name, []);
    columnsByTable.get(col.table_name)!.push(col);
  }

  const tableNames = [...columnsByTable.keys()].sort();
  if (tableNames.length === 0) {
    console.error("No tables found in public schema. Did migrations run against this DATABASE_URL?");
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });

  const header = `/**
 * GENERATED FILE — do not edit by hand.
 * Source of truth: packages/db/migrations/*.sql
 * Regenerate with: pnpm domain-model:generate
 */
`;

  const interfaceBlocks: string[] = [];
  const exportedNames: { typeName: string; tableName: string }[] = [];

  for (const tableName of tableNames) {
    const typeName = toPascalCase(tableName);
    const pk = pkByTable.get(tableName) ?? new Set<string>();
    const cols = columnsByTable.get(tableName)!;

    const fields = cols
      .map((col) => {
        const tsType = pgTypeToTs(col.data_type, col.udt_name);
        const nullable = col.is_nullable === "YES";
        const fieldName = toCamelCase(col.column_name);
        const isPk = pk.has(col.column_name);
        const comment = isPk ? " // primary key" : "";
        return `  ${fieldName}: ${tsType}${nullable ? " | null" : ""};${comment}`;
      })
      .join("\n");

    interfaceBlocks.push(`export interface ${typeName} {\n${fields}\n}`);
    exportedNames.push({ typeName, tableName });
  }

  const tableNameUnion = tableNames.map((t) => `"${t}"`).join(" | ");
  const tableMapEntries = exportedNames.map((e) => `  "${e.tableName}": ${e.typeName};`).join("\n");

  const output = `${header}
${interfaceBlocks.join("\n\n")}

/** Every table name currently in the public schema. */
export type TableName = ${tableNameUnion};

/** Maps a table name to its generated row type — for generic repository code. */
export interface TableRowByName {
${tableMapEntries}
}
`;

  writeFileSync(join(OUT_DIR, "tables.ts"), output, "utf8");
  console.log(`Generated ${tableNames.length} table interfaces -> packages/domain-model/src/generated/tables.ts`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
