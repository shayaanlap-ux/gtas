import { roomSummary } from "@/server/mp";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(roomSummary());
}
