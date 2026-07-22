# assets-src

Full-resolution originals that are **not** shipped — `public/` holds the derived,
web-sized versions. Keep the original here when you downsample something, so the
crop/quality can be redone later without hunting for the source again.

| original | shipped as | why |
|---|---|---|
| `impound.png` — 2412×1604, 4.87 MB | `public/chapters/bull/images/impound.jpg` — 1200×798, 185 KB | It's a card photo in the map chapter; the card's text column is 568 px wide on desktop and 306 px on mobile, so 2412 px was ~4× more than any screen can show. 26× smaller over the wire, and the decoded bitmap drops from 15 MB to 4 MB of phone RAM. |
