# Docker (not Render's native Node runtime) because the software-domain screenshot
# pipeline needs headless Chromium (7-software-design.md's Wayback render fix), and
# Chromium's system libraries (libnss3, libgbm, fonts, ...) aren't installable from
# Render's native buildCommand without root/apt access -- a Docker build has both.
#
# Base is a plain Node image, not Microsoft's prebuilt Playwright image: pinning the
# npm `playwright` version (server/package.json) and installing browsers via that
# exact version's own CLI guarantees the browser build matches the library build --
# a mismatch is the #1 cause of "Executable doesn't exist" errors from Playwright.
FROM node:20-bookworm

WORKDIR /app
COPY shared ./shared
COPY server/package.json ./server/package.json

WORKDIR /app/server
RUN npm install
# --with-deps installs Chromium's system libraries via apt -- only possible here
# (Docker build runs as root); Render's native runtime has no apt access at all.
RUN npx playwright@1.56.1 install --with-deps chromium

WORKDIR /app
COPY server ./server

WORKDIR /app/server
ENV PORT=10000
EXPOSE 10000
CMD ["npm", "start"]
