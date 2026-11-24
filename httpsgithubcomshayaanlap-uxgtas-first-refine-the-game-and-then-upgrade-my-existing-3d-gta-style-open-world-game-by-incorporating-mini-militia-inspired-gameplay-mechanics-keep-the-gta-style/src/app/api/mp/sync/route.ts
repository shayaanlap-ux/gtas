import { syncRoom } from "@/server/mp";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const r = syncRoom(body);
  return Response.json(r, { status: "error" in r ? 410 : 200 });
}
