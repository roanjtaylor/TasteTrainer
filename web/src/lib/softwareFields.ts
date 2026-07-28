// Curated starter categories for the software domain (7-software-design.md, problem #3):
// unlike hardware, "what are the fields to study?" isn't obvious, so this is the info
// box of suggestions the Curate flow offers instead of a blank topic input. Each is a
// functional category with real, well-archived, long-running examples — the kind that
// can show a clean design history from an early era through today.
export interface SoftwareFieldSuggestion {
  topic: string;
  description: string;
}

export const SOFTWARE_FIELD_SUGGESTIONS: SoftwareFieldSuggestion[] = [
  {
    topic: 'Search engines',
    description: 'Search engines — the query box and results page, from Web 1.0 portals to today.',
  },
  {
    topic: 'Booking systems',
    description: 'Booking systems — flight, hotel, and travel search-to-checkout flows.',
  },
  {
    topic: 'E-commerce checkout',
    description: 'E-commerce checkout — product pages, carts, and payment flows.',
  },
  {
    topic: 'Social networks',
    description: 'Social networks — profile pages, feeds, and messaging, from early web communities to today.',
  },
  {
    topic: 'Developer tools',
    description: 'Developer tools — code editors, IDEs, terminals, and debuggers.',
  },
  {
    topic: 'Email clients',
    description: 'Email clients — the inbox, compose window, and message view.',
  },
  {
    topic: 'File managers & desktops',
    description: 'File managers & desktop shells — the OS chrome for browsing and organising files.',
  },
  {
    topic: 'Spreadsheets',
    description: 'Spreadsheets — the grid, formulas, and toolbar UI.',
  },
  {
    topic: 'Messaging & chat apps',
    description: 'Messaging & chat apps — instant messaging and group chat interfaces.',
  },
  {
    topic: 'Music & audio players',
    description: 'Music & audio players — library browsing and now-playing UI.',
  },
  {
    topic: 'Maps & navigation',
    description: 'Maps & navigation — map rendering, search, and turn-by-turn UI.',
  },
  {
    topic: 'News & media homepages',
    description: 'News & media homepages — the front page of a publication, online.',
  },
  {
    topic: 'Banking & fintech apps',
    description: 'Banking & fintech apps — account dashboards, transfers, and statements.',
  },
  {
    topic: 'SaaS dashboards',
    description: 'SaaS dashboards — data-dense product UI for managing a business.',
  },
];
