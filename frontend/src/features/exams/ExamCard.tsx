import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import OptionItem from "@/features/questions/OptionItem";
import { Button } from "@/components/ui/button";
import { RadioGroup } from "@/components/ui/radio-group";
import { useState } from "react";
import practiceData from "../../../src/data/mock-exam-response.json";
import sumbissionsFeedback from "../../../src/data/submissionsFeedback.json";
import ExamCardHeader from "./ExamCardHeader";

export default function ExamCard() {
  // Track which question should be displayed
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState<number>(0);

  // Dictionary state - maps each question's unique version ID to an array of selected option IDs
  const [selectedValuesMap, setSelectedValuesMap] = useState<
    Record<string, string[]>
  >({});

  // Track which question have been submitted
  const [submittedMap, setSubmittedMap] = useState<Record<string, boolean>>({});

  // Store feedback per question version ID
  const [feedbackMap, setFeedbackMap] = useState<
    Record<
      string,
      {
        is_correct: boolean;
        correct_option_ids: string[];
        explanation?: string;
      }
    >
  >({});

  // Grab the question from the array that matches the current index
  const currentQuestion = practiceData.questions[currentQuestionIndex];

  // Safety check to prevent crashes if index is out of bounds
  if (!currentQuestion) {
    return <div>Loading or exam complete...</div>;
  }

  // Extract the details and unique ID of the current question
  const questionId = currentQuestion.id;
  const currentQuestionText = currentQuestion.question_text;
  const currentQuestionOptions = currentQuestion.options;

  // Determine if single or multiple answers are required
  const isMultiple = currentQuestion.allows_multiple_answers;

  // Get the selected options for this specific question or default to an empty array
  const currentSelected = selectedValuesMap[questionId] || [];

  // Check if the questions is already submitted
  const isSubmitted = submittedMap[questionId] || false;

  // Check current feedback
  const currentFeedback = feedbackMap[questionId];

  const handleSelect = (optionId: string) => {
    if (isSubmitted) return; // Prevent changing answers after submission

    if (!isMultiple) {
      // Single choice: set this question's array to just the clicked option ID
      setSelectedValuesMap((prev) => ({
        ...prev,
        [questionId]: [optionId],
      }));
    } else {
      // Multiple choices: toggle the option ID in the specific question's array
      setSelectedValuesMap((prev) => {
        const existingList = prev[questionId] || [];
        const updatedList = existingList.includes(optionId)
          ? existingList.filter((id) => id !== optionId)
          : [...existingList, optionId];

        return {
          ...prev,
          [questionId]: updatedList,
        };
      });
    }
  };

  const handleSubmit = () => {
    // Find the matching feedback from the imported JSON
    const feedbackEntry = sumbissionsFeedback.examples.find(
      (ex) => ex.response.question_version_id === questionId,
    );

    if (!feedbackEntry) return;

    const correctIds = feedbackEntry.response.correct_option_ids;
    const isCorrect =
      currentSelected.length === correctIds.length &&
      currentSelected.every((id) => correctIds.includes(id));

    // Save feedback to state map
    setFeedbackMap((prev) => ({
      ...prev,
      [questionId]: {
        is_correct: isCorrect,
        correct_option_ids: correctIds,
        explanation: feedbackEntry?.response.explanation,
      },
    }));

    // Mark question as submitted
    setSubmittedMap((prev) => ({
      ...prev,
      [questionId]: true,
    }));
  };

  // Move onto next question
  const handleNext = () => {
    setCurrentQuestionIndex((prev) =>
      Math.min(prev + 1, practiceData.questions.length - 1),
    );
  };

  const optionsList = currentQuestionOptions.map((option) => (
    <OptionItem
      key={option.id}
      id={option.id}
      option={option.option_text}
      questionType={isMultiple ? "multiple" : "single"}
      isSelected={currentSelected.includes(option.id)} // Checking against this question's saved state
      onSelect={() => handleSelect(option.id)} // ID is passed on click
      isSubmitted={isSubmitted}
      correctOptionIds={currentFeedback?.correct_option_ids || []}
    />
  ));

  return (
    <div>
      <Card>
        <ExamCardHeader
          currentQuestionIndex={currentQuestionIndex}
          totalQuestions={practiceData.questions.length}
          isMultiple={isMultiple}
          category={currentQuestion.category}
        />
        <Badge
          questionNumber={currentQuestionIndex + 1}
          questionType="multiple choice"
        />
        <h2
          id="question-heading"
          className="text-base sm:text-xl font-semibold my-3"
        >
          {currentQuestionText}
        </h2>
        {isMultiple ? (
          <div
            role="group"
            aria-labelledby="question-heading"
            className="flex flex-col gap-2"
          >
            {optionsList}
          </div>
        ) : (
          <RadioGroup
            value={currentSelected[0] || ""}
            onValueChange={(val) => handleSelect(val)}
            aria-labelledby="question-heading"
            className="flex flex-col gap-2"
          >
            {optionsList}
          </RadioGroup>
        )}

        {currentFeedback?.explanation && (
          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-sm text-sm text-blue-900">
            <strong>Explanation:</strong> {currentFeedback.explanation}
          </div>
        )}

        <div className="flex gap-2 mt-2">
          <Button
            variant="outline"
            onClick={() => {
              setCurrentQuestionIndex((prev) => Math.max(prev - 1, 0));
            }}
            className="hover:cursor-pointer py-5 px-3 text-base border border-gray-300 rounded-sm"
          >
            Previous
          </Button>
          <Button
            disabled={!isSubmitted && currentSelected.length === 0}
            onClick={isSubmitted ? handleNext : handleSubmit}
            className="hover:cursor-pointer py-5 px-3 text-base border border-gray-300 rounded-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitted ? "Next question" : "Submit answer"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
