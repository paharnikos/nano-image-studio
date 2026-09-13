export type ImageModel = {
  id: string;
  name: string;
  description?: string;
  owned_by?: string;
  pricing?: { per_image?: Record<string, number>; currency?: string };
  capabilities?: {
    image_generation?: boolean;
    image_to_image?: boolean;
    inpainting?: boolean;
  };
  supported_parameters?: {
    resolutions?: string[];
    max_images?: number;
    fixed_image_count?: number;
  };
};

export type GenerationSettings = {
  customCivitaiAir?: string;
  scheduler?: string;
  strength?: number;
  showExplicitContent?: boolean;
  model: string;
  size: string;
  n: number;
  seed?: number;
  guidance_scale: number;
  num_inference_steps: number;
};

export type SourceReference = { generationId: string; variationIndex: number; unresolved?: boolean };

export type GenerationRecord = {
  source?: SourceReference;
  id: string;
  createdAt: number;
  prompt: string;
  negativePrompt?: string;
  settings: GenerationSettings;
  images: string[];
  favorite?: boolean;
  tags?: string[];
  deletedAt?: number;
  cost?: number;
  remainingBalance?: number;
};

export type GenerationMetadata = Omit<GenerationRecord, "images"> & {
  imageCount: number;
  favorite?: boolean;
  tags?: string[];
  deletedAt?: number;
};

export type PromptPreset = {
  id: string;
  name: string;
  createdAt: number;
  prompt: string;
  negativePrompt?: string;
  settings: GenerationSettings;
};
