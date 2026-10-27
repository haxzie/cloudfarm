export type BotColor = {
  id: string;
  label: string;
  /** Body fill. */
  value: string;
  /** Eye fill — a darker shade of the body so it reads at small sizes. */
  ink: string;
};

export const BOT_COLORS: BotColor[] = [
  { id: "chalk", label: "Chalk", value: "#f5f5f4", ink: "#3f3f46" },
  { id: "clay", label: "Clay", value: "#a4794a", ink: "#45301a" },
  { id: "coral", label: "Coral", value: "#ef4444", ink: "#5f1515" },
  { id: "amber", label: "Amber", value: "#e8792b", ink: "#5c2a08" },
  { id: "honey", label: "Honey", value: "#eeb429", ink: "#5c4208" },
  { id: "fern", label: "Fern", value: "#49c07c", ink: "#114a2c" },
  { id: "teal", label: "Teal", value: "#35bfae", ink: "#0d4641" },
  { id: "azure", label: "Azure", value: "#3b82f6", ink: "#132f63" },
  { id: "violet", label: "Violet", value: "#9b5cf6", ink: "#331a60" },
  { id: "fuchsia", label: "Fuchsia", value: "#ec4899", ink: "#5c1437" },
  { id: "slate", label: "Slate", value: "#8b8b93", ink: "#333338" },
];

export const DEFAULT_COLOR_ID = "amber";

export function getColor(id: string): BotColor {
  return BOT_COLORS.find((candidate) => candidate.id === id) ?? BOT_COLORS[3]!;
}
