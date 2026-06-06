"use client";

import Image from "next/image";
import { Star, CheckCircle2, XCircle, ExternalLink } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AppMetadata } from "@/types/audit";

interface Props {
  metadata: AppMetadata;
  pending: boolean;
  onConfirm: () => void;
  onReject: () => void;
}

function formatRating(n: number | null): string {
  if (n == null) return "—";
  return n.toFixed(1);
}

function formatCount(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function MetadataConfirmCard({ metadata, pending, onConfirm, onReject }: Props) {
  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>Is this the app you meant?</CardTitle>
        <CardDescription>
          We&apos;ll run a full ASO audit against this listing on confirmation.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex gap-4">
        <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-2xl bg-muted ring-1 ring-foreground/5">
          {}
          <Image
            src={metadata.artworkUrl}
            alt={`${metadata.trackName} icon`}
            fill
            sizes="96px"
            unoptimized
            className="object-cover"
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate font-heading text-base font-medium">{metadata.trackName}</div>
              <div className="truncate text-sm text-muted-foreground">{metadata.artistName}</div>
            </div>
            <a
              href={metadata.appStoreUrl}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground transition-colors hover:text-foreground"
              title="Open on App Store"
            >
              <ExternalLink className="size-4" />
            </a>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {metadata.primaryGenreName && (
              <Badge variant="secondary">{metadata.primaryGenreName}</Badge>
            )}
            <Badge variant="outline" className="uppercase">
              {metadata.storefront}
            </Badge>
            <Badge variant="ghost" className="gap-1">
              <Star className="size-3 fill-current" />
              {formatRating(metadata.averageUserRating)}
              <span className="text-muted-foreground">
                ({formatCount(metadata.userRatingCount)})
              </span>
            </Badge>
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex-wrap gap-2">
        <Button onClick={onConfirm} disabled={pending}>
          <CheckCircle2 className="size-4" />
          Yes, run the audit
        </Button>
        <Button variant="ghost" onClick={onReject} disabled={pending}>
          <XCircle className="size-4" />
          No, try another
        </Button>
      </CardFooter>
    </Card>
  );
}
