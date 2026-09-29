import { createContext, useContext } from 'react';

// Set when the app's screens are being drawn inside the bare /embed widget
// (pages/Embed.tsx) rather than the app itself — null in the app. The screens are the
// same; only what sits above them differs: a back arrow there instead of the Nav.
export interface EmbedChrome {
  /** Where the back arrow goes: one level up, and what that level is called. */
  up: { label: string; go: () => void } | null;
  /** A screen that draws the way back itself (DatasetView's phone layout, whose
   *  widget browser has a place for it) says so here, and the arrow steps aside. */
  setOwnsBack: (owns: boolean) => void;
}

const EmbedChromeContext = createContext<EmbedChrome | null>(null);

export const EmbedChromeProvider = EmbedChromeContext.Provider;

export function useEmbedChrome(): EmbedChrome | null {
  return useContext(EmbedChromeContext);
}
