import { desc } from "drizzle-orm";
import { db } from "@/db";
import { playerStats } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await db.select().from(playerStats).orderBy(desc(playerStats.kills)).limit(10);
    return Response.json({ rows });
  } catch {
    return Response.json({ rows: [] });
  }
}
