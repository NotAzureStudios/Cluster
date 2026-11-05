import type { RendererQualityTier } from "./render-capabilities";

export type RendererEffectBudget = {
  maxBackdropRegions: number;
  maxBackdropBlurPx: number;
  maxContinuousRenderSurfaces: number;
  maxEffectDevicePixelRatio: number;
  domNodeWarning: number;
  domNodeHardLimit: number;
};

export const RENDERER_EFFECT_BUDGETS = Object.freeze({
  full: Object.freeze({
    maxBackdropRegions: 8,
    maxBackdropBlurPx: 32,
    maxContinuousRenderSurfaces: 3,
    maxEffectDevicePixelRatio: 2,
    domNodeWarning: 7_500,
    domNodeHardLimit: 12_000,
  }),
  balanced: Object.freeze({
    maxBackdropRegions: 4,
    maxBackdropBlurPx: 10,
    maxContinuousRenderSurfaces: 2,
    maxEffectDevicePixelRatio: 1.5,
    domNodeWarning: 6_000,
    domNodeHardLimit: 10_000,
  }),
  reduced: Object.freeze({
    maxBackdropRegions: 0,
    maxBackdropBlurPx: 0,
    maxContinuousRenderSurfaces: 1,
    maxEffectDevicePixelRatio: 1.25,
    domNodeWarning: 5_000,
    domNodeHardLimit: 8_000,
  }),
} satisfies Record<RendererQualityTier, RendererEffectBudget>);

export function rendererEffectBudget(tier: RendererQualityTier): RendererEffectBudget {
  return RENDERER_EFFECT_BUDGETS[tier];
}

/** Cap the user's preferred glass strength without overwriting that preference. */
export function effectiveRendererBlurPx(preferredPx: number, tier: RendererQualityTier): number {
  const valid = Number.isFinite(preferredPx) ? Math.max(0, preferredPx) : 16;
  return Math.min(valid, rendererEffectBudget(tier).maxBackdropBlurPx);
}

