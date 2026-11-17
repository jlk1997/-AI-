const fs = require("fs");
const { Client } = require("pg");

const env = fs.readFileSync("E:/OpenGame-main/OpenGame-main/.env", "utf8");
const url = (env.match(/^PLATFORM_DATABASE_URL=(.+)$/m) || [])[1]
  ?.trim()
  .replace(/^["']|["']$/g, "");

async function main() {
  const c = new Client({ connectionString: url });
  await c.connect();
  const tables = await c.query(
    "select table_name from information_schema.tables where table_schema='public' and (table_name ilike '%job%' or table_name ilike '%agent%') order by 1",
  );
  console.log(
    "tables",
    tables.rows.map((r) => r.table_name),
  );

  // Prefer jobs-like
  for (const name of ["jobs", "generation_jobs", "agent_jobs", "platform_jobs"]) {
    const hit = tables.rows.find((r) => r.table_name === name);
    if (!hit) continue;
    const cols = await c.query(
      "select column_name from information_schema.columns where table_name=$1 order by ordinal_position",
      [name],
    );
    console.log(name, "cols", cols.rows.map((r) => r.column_name).join(","));
  }

  // Try common query patterns
  const candidates = tables.rows.map((r) => r.table_name);
  for (const t of candidates) {
    if (!/job/i.test(t)) continue;
    try {
      const r = await c.query(
        `select * from ${t} order by 1 desc nulls last limit 5`,
      );
      console.log("\n==", t, "sample keys", Object.keys(r.rows[0] || {}));
      for (const row of r.rows) {
        const slim = {};
        for (const k of Object.keys(row)) {
          if (/id|type|status|state|progress|updated|created|error|name/i.test(k)) {
            const v = row[k];
            slim[k] =
              typeof v === "string" && v.length > 120 ? v.slice(0, 120) + "…" : v;
          }
        }
        console.log(slim);
      }
    } catch (e) {
      console.log(t, "query fail", e.message);
    }
  }
  await c.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
