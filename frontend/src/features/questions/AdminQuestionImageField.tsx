"use client";

import {
  useEffect,
  useMemo,
} from "react";

import {
  ImagePlus,
  RotateCcw,
  Trash2,
} from "lucide-react";

import type {
  AdminQuestionImage,
} from "@/types/admin-question-api.types";


type Props = {
  existingImage?: AdminQuestionImage;
  selectedFile: File | null;
  altText: string;
  removeExisting: boolean;
  disabled?: boolean;
  error?: string;

  onFileChange: (
    file: File | null,
  ) => void;

  onAltTextChange: (
    value: string,
  ) => void;

  onRemoveExisting: () => void;

  onRestoreExisting: () => void;
};


export default function AdminQuestionImageField({
  existingImage,
  selectedFile,
  altText,
  removeExisting,
  disabled = false,
  error,
  onFileChange,
  onAltTextChange,
  onRemoveExisting,
  onRestoreExisting,
}: Props) {
  const localPreview =
    useMemo(() => {
      if (!selectedFile) {
        return null;
      }

      return URL.createObjectURL(
        selectedFile,
      );
    }, [
      selectedFile,
    ]);


  useEffect(() => {
    if (!localPreview) {
      return;
    }

    return () => {
      URL.revokeObjectURL(
        localPreview,
      );
    };
  }, [
    localPreview,
  ]);


  const previewUrl =
    localPreview ||
    (
      !removeExisting
        ? existingImage?.url
        : null
    );


  const hasExisting =
    Boolean(
      existingImage,
    );


  const hasImage =
    Boolean(
      selectedFile ||
      (
        existingImage &&
        !removeExisting
      ),
    );


  return (
    <div className="mt-5 rounded-md border border-[#cfd2d5] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">
            Question image
          </p>

          <p className="mt-1 text-xs leading-5 text-[#777e83]">
            Optional. PNG, JPEG, or WebP.
            Maximum 5 MB.
          </p>
        </div>


        {hasExisting &&
          !removeExisting && (
            <button
              type="button"
              disabled={disabled}
              onClick={
                onRemoveExisting
              }
              className="inline-flex items-center gap-2 rounded-md border border-[#cfd2d5] px-3 py-2 text-xs font-medium hover:bg-[#f5f5f5] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2
                aria-hidden="true"
                className="size-4"
              />

              Remove image
            </button>
          )}


        {hasExisting &&
          removeExisting && (
            <button
              type="button"
              disabled={disabled}
              onClick={
                onRestoreExisting
              }
              className="inline-flex items-center gap-2 rounded-md border border-[#cfd2d5] px-3 py-2 text-xs font-medium hover:bg-[#f5f5f5] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RotateCcw
                aria-hidden="true"
                className="size-4"
              />

              Restore image
            </button>
          )}
      </div>


      {previewUrl && (
        <div className="mt-4 rounded-md border border-[#d7dbde] bg-[#f8f9f9] p-3">
          {/* Native img supports runtime R2 URLs and local blob previews. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt={
              altText ||
              "Question image preview"
            }
            className="mx-auto h-auto max-h-72 max-w-full rounded object-contain"
          />
        </div>
      )}


      {removeExisting &&
        !selectedFile && (
          <div className="mt-4 rounded-md border border-dashed border-[#cfd2d5] bg-[#f7f7f7] px-4 py-5 text-center text-xs text-[#687178]">
            The current image will be
            removed when you save.
          </div>
        )}


      <div className="mt-4">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-[#cfd2d5] bg-white px-4 py-2.5 text-sm font-medium hover:bg-[#f5f5f5]">
          <ImagePlus
            aria-hidden="true"
            className="size-4"
          />

          {hasImage
            ? "Choose replacement"
            : "Choose image"}

          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={disabled}
            onChange={(
              event,
            ) => {
              const file =
                event.target
                  .files?.[0] ??
                null;

              onFileChange(
                file,
              );

              event.target.value =
                "";
            }}
            className="sr-only"
          />
        </label>


        {selectedFile && (
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[#626b71]">
            <span>
              {selectedFile.name}
            </span>

            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                onFileChange(
                  null,
                )
              }
              className="font-semibold underline underline-offset-2"
            >
              Clear selection
            </button>
          </div>
        )}
      </div>


      {hasImage && (
        <label className="mt-4 block text-sm font-semibold">
          Alt text *

          <textarea
            value={
              altText
            }
            disabled={
              disabled
            }
            onChange={(
              event,
            ) =>
              onAltTextChange(
                event.target.value,
              )
            }
            placeholder="Describe the information shown in this image..."
            rows={3}
            className="mt-2 w-full resize-y rounded-md border border-[#cfd2d5] px-3 py-3 font-normal disabled:bg-[#f1f1f1]"
          />

          <span className="mt-1 block text-xs font-normal leading-5 text-[#777e83]">
            Describe the information a
            learner needs from the image.
          </span>
        </label>
      )}


      {error && (
        <p className="mt-3 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}