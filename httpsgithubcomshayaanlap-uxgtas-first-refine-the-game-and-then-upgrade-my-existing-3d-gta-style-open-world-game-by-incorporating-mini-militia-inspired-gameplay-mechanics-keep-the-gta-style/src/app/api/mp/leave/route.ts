import { leaveRoom } from "@/server/mp";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // sendBeacon posts text/plain, so parse leniently
  const txt = await req.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(txt);
  } catch {
    /* ignore */
  }
  return Response.json(leaveRoom(body));
}
