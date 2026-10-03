
import { BicepsFlexedIcon, BookOpenIcon, Calculator, FootprintsIcon, SquarePowerIcon } from "lucide-react";

/** Suggestion groups for common program builder starting points. */
export const suggestionGroups = [
    {
        label: "Start from scratch",
        highlight: "Empty Template",
        items: [
          "test",
        ],
        icon: <BookOpenIcon />,
    },
    {
      label: "Bodybuilding",
      highlight: "Bodybuilding",
      items: [
        "test",
      ],
      icon: <BicepsFlexedIcon />,
    },
    {
      label: "Powerlifting",
      highlight: "Powerlifting",
      items: [
        "test",
      ],
      icon: <SquarePowerIcon />,
    },
    {
        label: "Weight Loss",
        highlight: "Weight Loss",
        items: [
          "test",
        ],
        icon: <Calculator />,
      },
    {
      label: "Athletic Training",
      highlight: "Athletic Training",
      items: [
        "test",
      ],
      icon: <FootprintsIcon />,
    },

];

/** Quick chip suggestions for one-tap program prompts. */
export const quickTriggerSuggestionChips = [
  "test",
];

/** Quick chips when a program is already in the builder: short review and improvement prompts (sent as the user message on tap). */
export const quickModifyProgramSuggestionChips = [
  "test",
];
