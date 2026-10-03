# gojipower.xyz

The site is a single static `index.html` — no build step, no dependencies, no backend.
Market and chain figures are read live in the browser from DexScreener and a public
Solana RPC; anything that cannot be read live carries the date it was read and a link
to its source.

**This history is part of what the site claims.** Section 02 publishes a bar the
strategy must clear before anything is sold, and states that any change to it is
logged with its date, its reason, and how far the strategy was from clearing it at
that moment. A public commit history is what makes that checkable rather than merely
asserted — including for changes nobody announced.

## Deploy

Cloudflare Pages, build command: none, output directory: `/`.

## Local

Open `index.html` in a browser. There is nothing to install.
