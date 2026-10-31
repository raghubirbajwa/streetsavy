import type { NextRequest } from "next/server";
import { storeOtpAction, storeOtpResponse } from "../../../../../../lib/auth/store-otp.ts";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  return storeOtpResponse(() => storeOtpAction(request, action));
}
