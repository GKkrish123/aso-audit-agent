import { z } from "zod";
import { AppMetadataSchema } from "@/types/audit";

export const MetadataConfirmationSchema = z.object({
  appId: z.string(),
  storefront: z.string(),
  trackName: z.string(),
  artistName: z.string(),
  artworkUrl: z.string().url(),
  primaryGenreName: z.string().optional(),
  appStoreUrl: z.string().url(),
  averageUserRating: z.number().nullable(),
  userRatingCount: z.number().nullable(),
});
export type MetadataConfirmation = z.infer<typeof MetadataConfirmationSchema>;

export const metadataVerificationSkill = {
  id: "metadata-verification",
  description:
    "Trims raw iTunes metadata to the minimum fields needed for the user to confirm app identity.",
  run(input: unknown): MetadataConfirmation {
    const meta = AppMetadataSchema.parse(input);
    return MetadataConfirmationSchema.parse({
      appId: meta.appId,
      storefront: meta.storefront,
      trackName: meta.trackName,
      artistName: meta.artistName,
      artworkUrl: meta.artworkUrl,
      primaryGenreName: meta.primaryGenreName,
      appStoreUrl: meta.appStoreUrl,
      averageUserRating: meta.averageUserRating,
      userRatingCount: meta.userRatingCount,
    });
  },
};
