import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import OptionItem from "@/features/questions/OptionItem";
import { Button } from "@/components/ui/button";

export default function ExamCard() {
  const opt = [
    "A. Changes are prohibited once work begins",
    "B. Changes can be considered as new information emerges",
    "C. Changes must wait until the next project",
    "D. Only managers may identify changes",
  ];

  return (
    <div>
      <Card>
        <Badge questionNumber={3} questionType="multiple choice" />
        <h1>
          Which statement best describes how an Agile team response to changing
          requirements?
        </h1>
        <div>
          {opt.map((option) => (
            <OptionItem
              key={option}
              option={option}
              isSelected={false}
              onSelect={() => console.log("clicked")}
            />
          ))}
        </div>
        <div>
          <Button>Previous</Button>
          <Button>Submit answer</Button>
        </div>
      </Card>
    </div>
  );
}
