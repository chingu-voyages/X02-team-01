"use client";

import ResultCard from "@/features/exams/ResultCard";

export default function Home() {
  return (
    <div>
      <main>
        <div>
          <ResultCard
            scorePercent={80}
            correctCount={8}
            incorrectCount={2}
            isPassed
          ></ResultCard>
        </div>
      </main>
    </div>
  );
}
