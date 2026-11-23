"use client";

import { useState } from "react";

import type { ExamImage } from "@/types/exam-api.types";

interface QuestionMediaProps {
  images: ExamImage[];
}

interface HostedQuestionImageProps {
  image: ExamImage;
}

function HostedQuestionImage({
  image,
}: HostedQuestionImageProps) {
  const [loading, setLoading] = useState(
    Boolean(image.url),
  );
  const [failed, setFailed] = useState(false);

  const imageUrl = image.url;

  if (!imageUrl || failed) {
    return (
      <figure className="rounded-md border border-[#d7dbde] bg-[#f8f9f9] p-3 sm:p-4">
        <div
          role="status"
          className="rounded-md border border-dashed border-[#c4c9cd] bg-white px-4 py-6 text-center"
        >
          <p className="text-sm font-semibold text-[#3f474c]">
            Image unavailable
          </p>

          <p className="mt-2 text-sm leading-6 text-[#626b71]">
            {image.alt_text}
          </p>
        </div>
      </figure>
    );
  }

  return (
    <figure
      className="rounded-md border border-[#d7dbde] bg-[#f8f9f9] p-3 sm:p-4"
      aria-busy={loading}
    >
      {loading && (
        <p
          role="status"
          className="mb-3 text-center text-sm text-[#687178]"
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
        className="mx-auto h-auto max-h-104 max-w-full rounded object-contain"
      />
    </figure>
  );
}

export default function QuestionMedia({
  images,
}: QuestionMediaProps) {
  if (images.length === 0) {
    return null;
  }

  const orderedImages = [...images].sort(
    (first, second) =>
      first.position - second.position,
  );

  return (
    <div
      className="mb-5 space-y-4"
      aria-label="Question media"
    >
      {orderedImages.map((image) => (
        <HostedQuestionImage
          key={image.id}
          image={image}
        />
      ))}
    </div>
  );
}