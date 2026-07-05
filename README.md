# Compete 🏆

One beautiful place to save competitions you find online and never miss a deadline again.

Built for students — olympiads, hackathons, MUNs, quizzes, essays and more, all tracked with live countdowns. No accounts, no backend: your data lives in your browser.

## Features

- Dashboard with a "next deadline" spotlight and live countdowns
- Closing soon / Upcoming / Recently added / Closed sections
- Add, edit and delete competitions (title, organizer, category, deadline, website, registration link, online/offline/hybrid, location, prize, notes)
- Search across everything
- Category filters and favorites
- Urgency meter on every card
- Dark mode (follows your system, toggleable)
- Fully responsive — great on phones

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5173.

## Build for production

```bash
npm run build
npm run preview
```

The `dist/` folder is a static site — deploy it anywhere (GitHub Pages, Netlify, Vercel).

## Stack

Vite · React 18 · Tailwind CSS. No other runtime dependencies. Data persists in `localStorage`.

## Project structure

```
src/
├── App.jsx                    # Dashboard, sections, filtering, modals
├── components/
│   ├── Header.jsx             # Logo, search, theme toggle, add button
│   ├── Spotlight.jsx          # Next-deadline hero with live countdown
│   ├── CategoryFilter.jsx     # Category chips + favorites toggle
│   ├── CompetitionCard.jsx    # Card with countdown + urgency meter
│   ├── CompetitionForm.jsx    # Add / edit modal
│   ├── CompetitionDetails.jsx # Full details modal
│   ├── ConfirmDialog.jsx      # Delete confirmation
│   ├── EmptyState.jsx
│   ├── Modal.jsx
│   ├── Countdown.jsx
│   └── Icons.jsx              # Hand-drawn SVG icon set
├── hooks/
│   ├── useCompetitions.js     # CRUD + persistence
│   ├── useTheme.js            # Dark mode
│   └── useNow.js              # Ticking clock for countdowns
└── lib/
    ├── constants.js           # Categories, modes
    ├── date.js                # Countdown & formatting helpers
    └── storage.js             # localStorage + first-run sample data
```

## License

MIT — use it, fork it, star it ⭐
