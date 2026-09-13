import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const FALLBACK = {
  object: "list",
  data: [
    {
      id: "hidream",
      name: "HiDream",
      description: "Default NanoGPT image model",
      owned_by: "nanogpt",
      supported_parameters: {
        resolutions: ["1024x1024"],
        max_images: 1,
        fixed_image_count: 1,
      },
    },
  ],
  fallback: true,
};

export async function GET() {
  try {
    const response = await fetch("https://nano-gpt.com/api/v1/image-models?detailed=true", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    if (!response.ok) return NextResponse.json(FALLBACK);
    const data = await response.json();
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(FALLBACK);
  }
}
