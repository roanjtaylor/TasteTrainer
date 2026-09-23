// The messages between the embed widget (inside the iframe) and the page hosting it.
// Edit vs view is the HOST's to decide, so it's never in the iframe's URL — anyone
// visiting the site can edit a URL, but only the host page can post into the frame:
//   host -> widget  MODE    { mode: 'edit' | 'view' }   flips the settings panel on/off
//   widget -> host  READY   {}                          "I've loaded — tell me the mode"
//   widget -> host  CONFIG  { src, world, topic, width, height }
//                           the owner's choices in edit mode; the host saves `src` (and
//                           applies width/height — an iframe can't resize itself).
// The widget starts in view mode and ignores MODE from anything but its parent window.
export const EMBED_MODE_MESSAGE = 'tastetrainer:embed-mode';
export const EMBED_READY_MESSAGE = 'tastetrainer:embed-ready';
export const EMBED_CONFIG_MESSAGE = 'tastetrainer:embed-config';
export type EmbedMode = 'edit' | 'view';
