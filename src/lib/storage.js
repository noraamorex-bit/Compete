const KEY = "compete.competitions.v1";

export function loadCompetitions() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // Corrupt data — start fresh rather than crash.
  }
  const seed = seedData();
  saveCompetitions(seed);
  return seed;
}

export function saveCompetitions(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage full or unavailable; the app keeps working in memory.
  }
}

const days = (n) => new Date(Date.now() + n * 864e5).toISOString();

/** A few examples so the first open never feels empty. Delete freely. */
function seedData() {
  const now = new Date().toISOString();
  return [
    {
      id: crypto.randomUUID(),
      title: "National Science Olympiad",
      organizer: "SOF",
      category: "olympiad",
      deadline: days(4),
      website: "https://sofworld.org",
      registrationLink: "https://sofworld.org/nso",
      mode: "offline",
      location: "Your school centre",
      prize: "Medals, scholarships & international camp",
      notes: "Ask the science coordinator for the school registration code.",
      favorite: true,
      createdAt: now,
    },
    {
      id: crypto.randomUUID(),
      title: "Smart India Hackathon — Junior",
      organizer: "Ministry of Education",
      category: "hackathon",
      deadline: days(12),
      website: "https://sih.gov.in",
      registrationLink: "https://sih.gov.in/register",
      mode: "hybrid",
      location: "Regional centre, New Delhi",
      prize: "₹1,00,000 + incubation support",
      notes: "Team of 6. Problem statements drop two weeks before the deadline.",
      favorite: false,
      createdAt: now,
    },
    {
      id: crypto.randomUUID(),
      title: "Harvard MUN India",
      organizer: "HMUN India",
      category: "mun",
      deadline: days(26),
      website: "https://hmunindia.org",
      registrationLink: "https://hmunindia.org/apply",
      mode: "offline",
      location: "Hyderabad",
      prize: "Best Delegate & committee awards",
      notes: "Prefer UNHRC or DISEC. Draft the position paper early.",
      favorite: true,
      createdAt: now,
    },
    {
      id: crypto.randomUUID(),
      title: "Google Code to Learn",
      organizer: "Google India",
      category: "coding",
      deadline: days(40),
      website: "https://codetolearn.withgoogle.com",
      registrationLink: "https://codetolearn.withgoogle.com/register",
      mode: "online",
      location: "",
      prize: "Chromebooks & certificates",
      notes: "Scratch / App Inventor project. Keep the demo video under 2 min.",
      favorite: false,
      createdAt: now,
    },
  ];
}
