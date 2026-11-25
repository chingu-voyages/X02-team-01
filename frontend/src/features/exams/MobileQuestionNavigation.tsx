"use client";

import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { QuestionState } from "@/lib/question-states";
import QuestionNavigator from "./QuestionNavigator";

interface MobileQuestionNavigationProps {
  totalQuestions: number;
  currentQuestionIndex: number;
  questionStates?: readonly QuestionState[];
  flaggedQuestionIndices?: readonly number[];
  disabled?: boolean;
  onNavigate: (index: number) => boolean;
}

export default function MobileQuestionNavigation({
  totalQuestions,
  currentQuestionIndex,
  questionStates,
  flaggedQuestionIndices = [],
  disabled = false,
  onNavigate,
}: MobileQuestionNavigationProps) {
  const [open, setOpen] = useState(false);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const savedScrollTop = useRef(0);

  const dialogId = useId();
  const titleId = useId();
  const descriptionId = useId();

  const closeDialog = useCallback(() => {
    savedScrollTop.current =
      scrollRef.current?.scrollTop ?? 0;

    const dialog = dialogRef.current;

    if (dialog?.open) {
      dialog.close();
    }

    setOpen(false);

    triggerRef.current?.focus({
      preventScroll: true,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;

    const dialog = dialogRef.current;

    if (!dialog) return;

    // Native modal behavior provides focus containment
    // and makes background content inert.
    dialog.showModal();

    const previousOverflow =
      document.body.style.overflow;

    document.body.style.overflow = "hidden";

    closeRef.current?.focus({
      preventScroll: true,
    });

    if (scrollRef.current) {
      scrollRef.current.scrollTop =
        savedScrollTop.current;
    }

    return () => {
      if (dialog.open) {
        dialog.close();
      }

      document.body.style.overflow =
        previousOverflow;
    };
  }, [open]);

  function handleNavigate(index: number) {
    // Close only after the requested navigation succeeds.
    if (!disabled && onNavigate(index)) {
      closeDialog();
    }
  }

  return (
    <>
      <div className="lg:hidden">
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? dialogId : undefined}
          disabled={disabled || totalQuestions === 0}
          onClick={() => setOpen(true)}
          className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md border border-[#cbd0d3] bg-white px-4 py-2 text-left text-sm font-semibold text-[#303639] hover:bg-[#f3f4f5] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#343a3e] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span>Question Navigation</span>

          <span className="whitespace-nowrap font-normal text-[#56616a]">
            {currentQuestionIndex + 1} / {totalQuestions}
          </span>
        </button>
      </div>

      {open && (
        <dialog
          ref={dialogRef}
          id={dialogId}
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          aria-modal="true"
          onCancel={(event) => {
            event.preventDefault();
            closeDialog();
          }}
          className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto overscroll-contain rounded-md border border-[#cbd0d3] bg-white p-5 text-[#303639] shadow-lg backdrop:bg-black/40 sm:p-6"
        >
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2
              id={titleId}
              className="text-base font-bold"
            >
              Question Navigation
            </h2>

            <button
              ref={closeRef}
              type="button"
              onClick={closeDialog}
              aria-label="Close question navigation"
              className="min-h-11 shrink-0 rounded-md border border-[#cbd0d3] px-3 text-sm font-medium hover:bg-[#f3f4f5] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#343a3e]"
            >
              Close
            </button>
          </div>

          <p
            id={descriptionId}
            className="mb-4 text-sm text-[#56616a]"
          >
            Question {currentQuestionIndex + 1} of{" "}
            {totalQuestions}. Select a number to jump
            directly to that question.
          </p>

          <QuestionNavigator
            totalQuestions={totalQuestions}
            currentQuestionIndex={currentQuestionIndex}
            questionStates={questionStates}
            flaggedQuestionIndices={flaggedQuestionIndices}
            disabled={disabled}
            onNavigate={handleNavigate}
          />
        </dialog>
      )}
    </>
  );
}