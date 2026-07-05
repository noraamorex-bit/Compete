export const CATEGORIES = [
  { id: "olympiad", label: "Olympiad", dot: "#7C6CF6" },
  { id: "hackathon", label: "Hackathon", dot: "#2EA46D" },
  { id: "mun", label: "MUN", dot: "#3B82D6" },
  { id: "debate", label: "Debate", dot: "#E05B8E" },
  { id: "quiz", label: "Quiz", dot: "#EE9B1E" },
  { id: "essay", label: "Essay & Writing", dot: "#9A7B4F" },
  { id: "science", label: "Science Fair", dot: "#12A5A5" },
  { id: "coding", label: "Coding", dot: "#556AF0" },
  { id: "arts", label: "Arts & Design", dot: "#C557D6" },
  { id: "sports", label: "Sports", dot: "#E5484D" },
  { id: "other", label: "Other", dot: "#8B93AB" },
];

export const MODES = [
  { id: "online", label: "Online" },
  { id: "offline", label: "Offline" },
  { id: "hybrid", label: "Hybrid" },
];

export const categoryById = (id) =>
  CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[CATEGORIES.length - 1];

export const CLOSING_SOON_DAYS = 7;
