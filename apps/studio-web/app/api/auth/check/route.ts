import { getRequestUser, unauthorized } from "../../../../lib/request-user";

export async function GET() {
  const user = await getRequestUser();
  if (!user) return unauthorized();
  return Response.json({ authenticated: true }, { headers: { "Cache-Control": "private, no-store" } });
}
