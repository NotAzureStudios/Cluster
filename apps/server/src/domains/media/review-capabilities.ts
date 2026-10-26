import type { FastifyRequest } from "fastify";
import type { ReviewAssetCapabilities } from "@cluster/shared";
import type { AuthorizationService } from "../access/authorization.js";

export async function resolveReviewAssetCapabilities(
  authorization: AuthorizationService,
  request: FastifyRequest,
  asset: { id: string; projectId: string },
  project: any,
): Promise<ReviewAssetCapabilities> {
  const [canView, canContribute, canManage] = await Promise.all([
    authorization.requestCanTarget(request, "review_asset", asset.id, project, "view"),
    authorization.requestCanTarget(request, "review_asset", asset.id, project, "contribute"),
    authorization.requestCanTarget(request, "review_asset", asset.id, project, "manage"),
  ]);
  return {
    viewAsset: canView,
    viewBasicMetadata: canView,
    viewSensitiveMetadata: canManage,
    viewReviewHistory: canView,
    comment: canContribute,
    annotate: canContribute,
    resolve: canContribute,
    approve: canManage,
    manageVersions: canManage,
    downloadOriginal: canView,
    exportDerivative: canContribute,
    chooseMetadataPreservationPolicy: canManage,
    print: canView,
    copyText: canView,
    copyImage: canView,
    generateDerivatives: canContribute,
    accessDiagnostics: canManage,
  };
}
