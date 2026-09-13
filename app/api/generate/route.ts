import { customCivitaiPayload } from "../../../lib/civitai";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type GenerateBody = {
  customCivitaiAir?: string;
  scheduler?: string;
  strength?: number;
  showExplicitContent?: boolean;
  imageDataUrl?: string;
  steps?: number;
  CFGScale?: number;
  resolution?: string;
  nImages?: number;
  apiKey?: string;
  prompt?: string;
  negativePrompt?: string;
  model?: string;
  size?: string;
  n?: number;
  seed?: number;
  guidance_scale?: number;
  num_inference_steps?: number;
};

export async function POST(request: NextRequest) {
  let body: GenerateBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "The request body was not valid JSON." }, { status: 400 });
  }

  if (!body || typeof body !== "object") return NextResponse.json({ error: "Expected a JSON object." }, { status: 400 });
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";

  if (!apiKey) return NextResponse.json({ error: "Add your NanoGPT API key to continue." }, { status: 401 });
  if (!prompt) return NextResponse.json({ error: "Write a prompt before generating." }, { status: 400 });
  if (body.negativePrompt !== undefined && typeof body.negativePrompt !== "string") return NextResponse.json({ error: "Negative prompt must be text." }, { status: 400 });
  if (!body.model) return NextResponse.json({ error: "Choose an image model." }, { status: 400 });

  let payload: Record<string, unknown> = {
    model: body.model,
    prompt: body.negativePrompt?.trim()
      ? `${prompt}\n\nAvoid: ${body.negativePrompt.trim()}`
      : prompt,
    n: Math.min(Math.max(Number(body.n) || 1, 1), 4),
    size: body.size || "1024x1024",
    response_format: "b64_json",
  };

  if (Number.isFinite(body.seed)) payload.seed = body.seed;
  if (Number.isFinite(body.guidance_scale)) payload.guidance_scale = body.guidance_scale;
  if (Number.isFinite(body.num_inference_steps)) payload.num_inference_steps = body.num_inference_steps;

  const custom = body.model === "custom-civitai";
  if (custom) {
    try {
      payload = customCivitaiPayload({ prompt, negativePrompt: body.negativePrompt, imageDataUrl: body.imageDataUrl, settings: {
        model: body.model!, customCivitaiAir: body.customCivitaiAir, scheduler: body.scheduler,
        strength: body.strength, showExplicitContent: body.showExplicitContent, seed: body.seed,
        size: body.resolution ?? body.size ?? "1024x1024", n: body.nImages ?? body.n ?? 1,
        guidance_scale: body.CFGScale ?? body.guidance_scale ?? 7.5, num_inference_steps: body.steps ?? body.num_inference_steps ?? 20,
      } });
      if (body.imageDataUrl !== undefined && (typeof body.imageDataUrl !== "string" || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(body.imageDataUrl) || body.imageDataUrl.length > 42 * 1024 * 1024)) throw new Error("Reference image must be a PNG, JPEG or WebP under 30 MB.");
    } catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
  }

  try {
    const upstream = await fetch(custom ? "https://nano-gpt.com/api/v1/images/generations" : "https://nano-gpt.com/v1/images/generations", {
      method: "POST",
      headers: {
        ...(custom ? { "x-api-key": apiKey } : { Authorization: `Bearer ${apiKey}` }),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    const result = await upstream.json().catch(() => null);
    if (!upstream.ok) {
      const message =
        upstream.status === 401
          ? "NanoGPT rejected this API key. Check it and try again."
          : upstream.status === 429
            ? "NanoGPT is rate-limiting requests. Wait a moment, then try again."
            : result?.error?.message || (typeof result?.error === "string" ? result.error : undefined) || result?.message || "NanoGPT could not complete this generation.";
      return NextResponse.json({ error: message }, { status: upstream.status });
    }

    const output = result?.data ?? result?.images;
    const images = Array.isArray(output)
      ? output
          .map((item: string | { b64_json?: string; url?: string }) =>
            typeof item === "string" ? item : item.b64_json ? `data:image/png;base64,${item.b64_json}` : item.url,
          )
          .filter(Boolean)
      : [];

    if (!images.length) {
      return NextResponse.json({ error: "The generation finished without an image. Try another model." }, { status: 502 });
    }

    return NextResponse.json(
      {
        images,
        created: result.created,
        cost: result.cost,
        remainingBalance: result.remainingBalance,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "The request could not reach NanoGPT. Check your connection and try again." },
      { status: 502 },
    );
  }
}
