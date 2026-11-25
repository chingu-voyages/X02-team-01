"use client";

import { useState } from "react";
import type { QuestionState } from "@/lib/question-states";
import NavigatorLegend from "../questions/NavigatorLegend";
import QuestionSetPager from "../questions/QuestionSetPager";
import QuestionTile from "../questions/QuestionTile";

const pageSize = 15;

interface QuestionNavigatorProps {
  totalQuestions: number;
  currentQuestionIndex: number;
  questionStates?: readonly QuestionState[];
  flaggedQuestionIndices?: readonly number[];
  disabled?: boolean;
  showHeader?: boolean;
  onNavigate: (index: number) => void;
}

export default function QuestionNavigator({
  totalQuestions,
  currentQuestionIndex,
  questionStates,
  flaggedQuestionIndices = [],
  disabled = false,
  showHeader = true,
  onNavigate,
}: QuestionNavigatorProps) {
  const questionCount = questionStates?.length ?? totalQuestions;
  const totalPages = Math.max(1, Math.ceil(questionCount / pageSize));
  const currentQuestionPage = Math.min(
    totalPages - 1,
    Math.max(0, Math.floor(currentQuestionIndex / pageSize)),
  );

  const [pageState, setPageState] = useState({
    anchorIndex: currentQuestionIndex,
    page: currentQuestionPage,
  });

  const activePage =
    pageState.anchorIndex === currentQuestionIndex
      ? Math.min(totalPages - 1, Math.max(0, pageState.page))
      : currentQuestionPage;

  const flaggedSet = new Set(flaggedQuestionIndices);

  const answeredCount =
    questionStates?.filter((state) => state.responseState === "submitted")
      .length ?? 0;

  const flaggedCount = questionStates
    ? questionStates.filter((state) => state.isFlagged).length
    : flaggedSet.size;

  const unansweredCount = Math.max(0, questionCount - answeredCount);

  const startIndex = activePage * pageSize;
  const endIndex = Math.min(questionCount, startIndex + pageSize);
  const visibleCount = Math.max(0, endIndex - startIndex);

  return (
    <nav aria-label="Question navigation" className="space-y-5">
      {showHeader && (
        <div className="space-y-1">
          <h2 className="text-lg font-bold tracking-tight text-brand-text">
            Question navigation
          </h2>
          <p className="text-xs font-medium text-brand-text/70">
            {answeredCount} answered · {flaggedCount} flagged ·{" "}
            {unansweredCount} unanswered
          </p>
        </div>
      )}

      <NavigatorLegend />

      <div className="border-t border-brand-border" />

      <ol className="grid grid-cols-5 justify-items-center gap-2.5">
        {Array.from({ length: visibleCount }, (_, offset) => {
          const index = startIndex + offset;
          const state = questionStates?.[index];

          const isCurrent =
            state?.isCurrent ?? index === currentQuestionIndex;
          const isAnswered = state?.responseState === "submitted";
          const isFlagged = state?.isFlagged ?? flaggedSet.has(index);

          return (
            <li key={state?.questionId ?? index}>
              <QuestionTile
                questionNumber={index + 1}
                isCurrent={isCurrent}
                isAnswered={isAnswered}
                isFlagged={isFlagged}
                disabled={disabled}
                onSelect={() => onNavigate(index)}
              />
            </li>
          );
        })}
      </ol>

      {totalPages > 1 && (
        <QuestionSetPager
          startIndex={startIndex}
          endIndex={endIndex}
          totalQuestions={questionCount}
          canPrevious={activePage > 0}
          canNext={activePage < totalPages - 1}
          disabled={disabled}
          onPrevious={() =>
            setPageState({
              anchorIndex: currentQuestionIndex,
              page: Math.max(0, activePage - 1),
            })
          }
          onNext={() =>
            setPageState({
              anchorIndex: currentQuestionIndex,
              page: Math.min(totalPages - 1, activePage + 1),
            })
          }
        />
      )}

      <p className="text-xs text-brand-text/65">
        Select any number to navigate.
      </p>
    </nav>
  );
}