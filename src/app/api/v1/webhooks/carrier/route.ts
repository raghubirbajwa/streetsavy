import type { NextRequest } from 'next/server';
import { carrierWebhook } from '../../../../../lib/fulfillment/http.ts';
import { fulfillmentResponse } from '../../../../../lib/fulfillment/http-errors.ts';
export const dynamic='force-dynamic';
export async function POST(request:NextRequest){return fulfillmentResponse(()=>carrierWebhook(request));}
