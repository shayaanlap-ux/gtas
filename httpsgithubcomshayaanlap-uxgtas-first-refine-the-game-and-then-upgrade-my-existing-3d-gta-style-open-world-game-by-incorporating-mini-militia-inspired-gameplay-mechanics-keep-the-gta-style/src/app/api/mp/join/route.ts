import { joinRoom } from "@/server/mp";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const r = joinRoom(body);
  return Response.json(r, { status: "error" in r ? 400 : 200 });
}
