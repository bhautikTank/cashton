import { handleWebhookRequest } from "@/src/modules/conversions/webhook-handler";

export async function POST(request: Request) {
  return handleWebhookRequest("ADMITAD", request);
}

export async function GET(request: Request) {
  return handleWebhookRequest("ADMITAD", request);
}
