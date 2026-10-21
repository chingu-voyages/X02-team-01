import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import OptionItem from "@/features/questions/OptionItem";
import { Button } from "@/components/ui/button";
import { RadioGroup } from "@/components/ui/radio-group";
import { useState } from "react";

export default function ExamCard() {
  const [selectedValue, setSelectedValue] = useState("");

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
        <h2 className="text-xl font-semibold my-3">
          Which statement best describes how an Agile team response to changing
          requirements?
        </h2>
        <div className="flex flex-col gap-2">
          <RadioGroup value={selectedValue} onValueChange={setSelectedValue}>
            {opt.map((option) => (
              <OptionItem
                key={option}
                option={option}
                isSelected={selectedValue === option}
                onSelect={() => console.log("clicked")}
              />
            ))}
          </RadioGroup>
        </div>
        <div className="flex gap-2 mt-2">
          <Button
            variant="outline"
            className="hover:cursor-pointer py-5 px-3 text-base border border-gray-300 rounded-sm"
          >
            Previous
          </Button>
          <Button className="hover:cursor-pointer py-5 px-3 text-base border border-gray-300 rounded-sm">
            Submit answer
          </Button>
        </div>
      </Card>
    </div>
  );
}
