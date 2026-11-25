"use client";

import { useState } from "react";

import type { ExamImage } from "@/types/exam-api.types";

interface QuestionMediaProps {
  images: ExamImage[];
}

interface HostedQuestionImageProps {
  image: ExamImage;
}

function HostedQuestionImage({ image }: HostedQuestionImageProps) {
  const [loading, setLoading] = useState(Boolean(image.url));
  const [failed, setFailed] = useState(false);

  const imageUrl = image.url;

  if (!imageUrl || failed) {
    return (
      <figure className="rounded-xl border border-brand-border bg-brand-surface p-3 sm:p-4">
        <div
          role="status"
          className="rounded-lg border border-dashed border-brand-border bg-white px-4 py-6 text-center"
        >
          <p className="text-sm font-semibold text-brand-text">
            Image unavailable
          </p>

          <p className="mt-2 text-sm leading-6 text-brand-text/70">
            {image.alt_text}
          </p>
        </div>
      </figure>
    );
  }

  return (
    <figure
      className="rounded-xl border border-brand-border bg-brand-surface p-3 sm:p-4"
      aria-busy={loading}
    >
      {loading && (
        <p
          role="status"
          className="mb-3 text-center text-sm text-brand-text/70"
        >
          Loading image...
        </p>
      )}

      {/* Native img keeps runtime R2 URLs and onError fallback simple. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageUrl}
        alt={image.alt_text}
        loading="eager"
        decoding="async"
        onLoad={() => setLoading(false)}
        onError={() => {
          setLoading(false);
          setFailed(true);
        }}
        className="mx-auto h-auto max-h-104 max-w-full rounded-lg object-contain"
      />
    </figure>
  );
}

export default function QuestionMedia({ images }: QuestionMediaProps) {
  if (images.length === 0) {
    return null;
  }

  const orderedImages = [...images].sort(
    (first, second) => first.position - second.position,
  );

  return (
    <div className="mb-6 space-y-4" aria-label="Question media">
      {orderedImages.map((image) => (
        <HostedQuestionImage key={image.id} image={image} />
      ))}
    </div>
  );
}