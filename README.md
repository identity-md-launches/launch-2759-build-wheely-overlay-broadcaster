# WHEELY Overlay

A broadcaster control room and five transparent Squeekchain browser sources. Plain HTML, CSS and JavaScript: no runtime dependencies, bundler, account, API key, analytics, cookies, tracking, remote fonts or wallet connection.

The finished static website is in **`dist/`**. The editable, directly serveable website is in **`src/`**. Both include every widget as a real exported directory route; a server rewrite is unnecessary. All local asset references are relative, including on a gateway subpath.

## Preview, install and rebuild

There is nothing to install to use the site. Serve `dist/` over HTTP(S); JavaScript modules should not be opened with `file://`. For local preview, use Node.js 20.11 or newer:

```sh
npm run preview
```

Open `http://localhost:4173/`. An optional port can be passed with `npm run preview -- 8080`. Another ordinary static server works too, for example `python3 -m http.server 4173 --directory dist`.

The supplied export is ready to use. After editing `src/`, reproduce it with:

```sh
npm run build
npm test
```

`build` only copies the complete source website into `dist/`; it does not compile or fetch anything. The source itself needs no build step. `package-lock.json` records an empty dependency tree. Do not install dependencies into the repository or add caches to the submission.

Optional development checks use tools installed outside the project:

```sh
npm install --prefix /tmp/wheely-tools --cache /tmp/wheely-npm-cache \
  --ignore-scripts --no-audit --no-fund \
  typescript@5.9.3 playwright@1.56.1 @axe-core/playwright@4.11.0

WHEELY_TSC=/tmp/wheely-tools/node_modules/typescript/lib/tsc.js npm run typecheck

PLAYWRIGHT_BROWSERS_PATH=/tmp/wheely-browsers \
  /tmp/wheely-tools/node_modules/.bin/playwright install chromium webkit

WHEELY_PLAYWRIGHT=/tmp/wheely-tools/node_modules/playwright/index.mjs \
WHEELY_AXE=/tmp/wheely-tools/node_modules/@axe-core/playwright/dist/index.mjs \
PLAYWRIGHT_BROWSERS_PATH=/tmp/wheely-browsers \
  node scripts/validate-browser.mjs
```

Add `--webkit` to the browser validation command to test that engine. Playwright also needs the engine's normal operating-system libraries. None of these development tools or browsers belongs in the submitted site. Typechecking uses TypeScript's strict `checkJs` against JSDoc and `src/scripts/types.d.ts`; the browser still runs ordinary JavaScript.

## Operator workflow

1. Open `index.html` on the static host. Select a widget in the scene preview or its lineup card.
2. Set position, theme, accent, scale, idle behavior and wheel circumference. These controls update the preview and each generated URL. No setting requires a code edit.
3. Select **Copy source URL**. Each lineup card also has its own copy button and an expandable URL/dimensions field.
4. Add that URL to a browser source above the camera/video source in your broadcasting scene.

The illustrated scene is an original local backdrop for checking composition, not a camera connection. Every widget preview uses live public data. The alert preview is normally empty until a real transition occurs. **Test alert** creates an explicitly labeled, temporary preview message inside the control room only; it does not send an event to an OBS source. **Pause preview motion** stops counter interpolation, command rotation and round flashes in previews while data continues to update. It does not change your generated URLs.

No settings or telemetry are stored on disk by the site. A control-room URL can itself include the documented settings to initialize the form. The copied source URL is the complete configuration to save in OBS.

## Exact OBS browser-source settings

| Property | Value |
| --- | --- |
| Sources → Add | **Browser** |
| Local file | **Off** |
| URL | The complete copied widget URL, including query parameters |
| Width | **1920** |
| Height | **1080** |
| Custom frame rate | **30 FPS** if enabled |
| Custom CSS | **Empty**; transparency is already supplied by the page |
| Shutdown source when not visible | **Off**, so polling, event baselines and integrity history survive scene changes |
| Refresh browser when scene becomes active | **Off**, so the log and event baselines are preserved |
| Audio | No audio is emitted; no audio routing is needed |
| Transform | Fit the full browser canvas to the scene, without cropping |
| Source order | Browser source above your camera/video |

Use the same 1920 × 1080 source on a 1280 × 720 broadcast and fit it to the scene. Alternatively, the widgets also fit a browser viewport of 1280 × 720. Their content automatically scales down to fit the available canvas. Avoid chroma key: the pixels outside widget surfaces already have alpha transparency. Widget surfaces are opaque for readable text over arbitrary footage; the **page** is fully transparent.

For vMix, use **Add Input → Web Browser**, paste the same URL, use a **1920 × 1080** input with transparent background, and place that input on an overlay above your camera. The website has been tested in browser engines; an actual OBS/vMix compositor was not available for an end-to-end broadcast test.

## Exported routes

All five sources use a recommended **1920 × 1080 px** browser canvas.

| Route | Content and placement |
| --- | --- |
| `/overlay/ticker/` | Slim lower third: RUNNING/ASLEEP, rpm, mm/s, anchor block height and block progress. Numeric changes interpolate over 1.8 seconds; exact very large block heights bypass interpolation. |
| `/overlay/round/` | Top corner: countdown calculated from genesis and round duration, core freshness/paused state, and a brief recorded-round flash. |
| `/overlay/alerts/` | Top corner: transition-only toasts, newest three maximum; each expires after 10 seconds. A compact source-health note remains visible during an outage. |
| `/overlay/integrity/` | Top corner: rolling telemetry checks, implied revolutions, work/revolution, exact numeric evidence, hardware/chain totals, freshness, reported attestation and three recent log rows. |
| `/overlay/commands/` | Lower corner: spin, use, merge, me and help rotate every 8 seconds; all five remain listed, together with fire/water/earth/air/lightning/star and common/uncommon/rare/epic/legendary. |

The canonical directory URLs have trailing slashes. Static hosts normally redirect `/overlay/ticker` to `/overlay/ticker/`; `/overlay/ticker/index.html` also works without rewrites. Under a hosting prefix, preserve that prefix. The control room generates the correct full URL automatically.

The command widget teaches the supplied command names; it does not send chat messages, sign transactions or infer unsupported argument syntax.

## Every query parameter

Parameters work on every overlay route, with `circumferenceMm` affecting integrity calculations only. Unknown parameters are ignored. Use a decimal point for numbers.

| Parameter | Accepted values | Default | Effect |
| --- | --- | --- | --- |
| `side` | `left`, `right` | `left` | Aligns to that physical side of the safe area. Ticker and commands remain at the bottom; the others remain at the top. |
| `scale` | Finite number, clamped to `0.5`–`2` | `1` | Requested content scale. The effective scale is reduced further if needed to fit width or height without cropping. Invalid nonnumeric values use 1. |
| `theme` | `dark`, `light` | `dark` | Changes only widget surfaces and text; the page stays transparent. |
| `accent` | Three or six hexadecimal digits | `ff7c48` | Accent on rails, progress bars and decorative icons. Omit `#`, or encode it as `%23`. Invalid colors fall back to the default. Essential text keeps the theme's contrast colors. |
| `hideWhenIdle` | `0`, `1` | `0` | At 1, hides the widget when a fresh, successfully fetched measurement says the wheel is asleep. Stale/error states remain visible. Alert toasts finish their 10-second lifetime before hiding. |
| `circumferenceMm` | Positive, finite millimeter value | `471` | Rim circumference used for revolutions and work/revolution. Invalid or nonpositive URL values fall back to 471. The form shows an inline error instead of applying an invalid value. |

Example configuration, relative to the site's hosting root:

```text
overlay/integrity/?side=right&scale=1.2&theme=dark&accent=ff7c48&hideWhenIdle=0&circumferenceMm=471
```

The control room's rim field updates its existing exact deltas using the new circumference. Refreshing an iframe preview with a changed URL starts that preview's own log again; the control room keeps its session log. Closing or refreshing any standalone source clears its in-memory log.

## Public endpoints and polling

| Endpoint | Used for |
| --- | --- |
| `GET https://api.squeekchain.com/v1/status` | Hardware measurement, builder anchor, oracle/queue transitions, reported signer and module health |
| `GET https://api.squeekchain.com/v1/core` | Chain work/height, settled round, paused state, genesis/duration and RoundRecorded/BatchSettled events |
| `GET https://api.squeekchain.com/v1/economy/state` | Control-room mining funded blocks, live token supply and economy identity diagnostics |

Polling starts immediately and repeats every **5000 ms**. Each request has a **4500 ms** timeout, uses public CORS, omits credentials and requests an uncached response. Fetches run independently in parallel; a failed endpoint cannot erase a successful endpoint's previous value. Malformed required telemetry also preserves the previous value. Initial markup, configuration, copy actions and setup help are available while requests are pending.

The control room polls all three endpoints once per cycle and shares snapshots with same-origin preview iframes. Ticker and commands standalone routes poll status; round, alerts and integrity poll status and core. These sources operate independently when placed in OBS. An embedded source with no cooperating parent starts its own poller after 1.5 seconds.

Each failed poll retains values and last-success timestamps. A running clock displays the measurement age, even with no new fetch. A failed request is explicitly marked STALE with an age; a physically old measurement is independently marked stale even when HTTP requests succeed. Core schedule/chain fields include the age of the last core fetch, with a 15-second old-fetch indication in the integrity/round widgets. Clock accuracy depends on the broadcasting computer's clock.

## Integrity calculations

Implementation: `src/scripts/domain.js` (`IntegrityLog`, `freshness`, exact integer helpers). Each completed poll is logged in a **120-entry** in-memory ring, about ten minutes at the normal cadence. The control room can export that ring as JSON. It includes raw last-known measurements, exact distance/work strings, epoch, observation time, fetch errors, chain work, deltas, verdicts and reasons. Loading placeholders are not counted as polls. Failed polls are recorded but do not replace the last successful baseline.

For previous sample `p` and current sample `c` in the **same counter epoch**:

```text
Δt = (c.observedAt − p.observedAt) / 1000                  [seconds]
Δd = c.distanceMm − p.distanceMm                        [millimeters]
Δw = c.cumulativeWorkUnits − p.cumulativeWorkUnits        [work units]
C  = circumferenceMm                                    [millimeters/revolution]
implied revolutions = Δd / C
work per revolution = Δw / (Δd / C) = Δw × C / Δd
```

Counter values and differences use `BigInt`, including numeric strings larger than JavaScript's safe integer range. Ratios use floating point for presentation and are rounded to three decimals, with the original operands shown. A zero-distance interval has no defined work/revolution ratio and displays a dash. Window totals sum only accepted, fresh, same-epoch intervals; division uses the exact summed numerator before display conversion. This is an observation-based consistency check, not an assertion of a fixed calibration ratio.

| Check | Exact condition and handling |
| --- | --- |
| Work at zero rpm | `Δw > 0 && c.rpmMilli === 0` → **IMPLAUSIBLE**, showing Δwork, rpmMilli and both work totals. |
| Speed bound | `Δd > floor(max(p.speedMmPerSecond, c.speedMmPerSecond) × Δt)` → **IMPLAUSIBLE**, showing distance, both reported speeds, elapsed time and allowed distance. No arbitrary tolerance is added. |
| Counter decrease | `Δd < 0` or `Δw < 0` → **IMPLAUSIBLE**, showing both original totals and negative delta. |
| Hardware restart | `c.counterEpoch !== p.counterEpoch` → **IMPLAUSIBLE**, naming both epochs and totals. **No delta across the boundary is counted.** The current sample becomes the new baseline; later valid same-epoch intervals can count again. |
| Repeated observation | Same observation time and unchanged counters: log the poll, count no interval. Changed counters at a nonadvancing observation time are **IMPLAUSIBLE** with Δt and deltas. |
| Freshness | `age = (browserNow − observedAt) / 1000`; **STALE** when `age > staleAfterSeconds`, when the source reports stale/offline/unavailable/expired, or when timestamps/limits are invalid. An observation more than five seconds in the future is also STALE. The displayed comparison uses millisecond precision. |
| Fetch failure | **STALE**, retaining the previous data and showing its age and the fetch error. It contributes no interval. |
| Chain comparison | Display exact hardware work, `core.cumulativeWork` and their difference. Settlement can lag hardware, so a difference alone is not classified as fabricated work. |

The panel's overall verdict stays **IMPLAUSIBLE** while any flagged poll remains in the rolling ring; otherwise it is **STALE** when the current measurement is stale/unavailable, and **OK** when the checked data is fresh. Freshness has its own independent verdict. The latest logged sample and the rolling verdict can differ. An initial baseline explicitly says that another observation is needed. An invalid sample is never added to accepted aggregates and becomes the next comparison baseline.

The speed check uses the larger of the two reported endpoint speeds as a conservative bound. Five-second samples cannot prove the wheel's instantaneous speed between observations; real acceleration/deceleration between endpoints can cause a flag. Likewise, a sample can report zero rpm after a short interval of movement. Keep the numeric evidence for investigation rather than treating a flag as a fraud finding.

The attestation line names `signer.kind`, `signer.algorithm`, `signer.keySlot`, and the age of `signer.lastVerifiedAt`, with measurement provenance and counter epoch below. These are **API-reported claims**. No public verification key or independent chain RPC was supplied, so this toolkit does not cryptographically verify signatures or independently authenticate the public API.

## Round and alert rules

Rounds use seconds for `configuration.genesisTimestamp` and `roundDuration` (ISO timestamps are also accepted):

```text
round = floor((browserNowSeconds − genesisTimestamp) / roundDuration)
nextClose = genesisTimestamp + (round + 1) × roundDuration
countdown = ceil(nextClose − browserNowSeconds)
```

The round number is zero-based. Before genesis the timer shows time until the first opening. Paused core state does not move the schedule; it is named beside it. A newly observed `RoundRecorded` for a round watched during this source session triggers a six-second recorded label and three 600 ms outline flashes. Events are identified by their API id or transaction/log identity and round ids are read from the actual event arguments. Historical events in the first response do not flash, and a close alone never pretends that a record landed.

Alerts establish silent status/event baselines on first successful fetch, then react only to:

- Running/asleep transitions (positive rpm or RUNNING/ACTIVE/MOVING is running).
- An increase in anchor block height; jumps show the number of completed blocks.
- A new, deduplicated `BatchSettled` event, including the settled round and chain block.
- The oracle leaving `accepted`, or the settlement queue leaving `submitted`.
- A previously fresh measurement becoming stale, including between fetches.

Initial stale data is labeled as stale without replaying a transition. Stable values and repeated historical events never create extra toasts. The newest three messages are retained and each auto-dismisses in ten seconds. Recovery re-arms subsequent transitions.

Reduced-motion preference stops command rotation and numeric interpolation and removes round flashes; command names, textual recording state and all other evidence remain visible. No widget receives keyboard focus or requires interaction during a broadcast.

## Validation and limitations

The production build and strict typecheck passed; 22 logic/polling tests passed, both Chromium and WebKit passed 21 browser scenarios, and the pinned design probe passed all 16 checks. Actual commands, evidence, findings and the six-domain Better Interface review are recorded in [`artifacts/validation.md`](artifacts/validation.md). The implemented design is documented in [`DESIGN.md`](DESIGN.md). `npm test` validates the poller and arithmetic/transition rules. The browser script serves the **actual `dist/` export under `/preview/`**, exercises operator actions and deterministic telemetry scenarios, and writes reports/screenshots only to disposable `test/scratch/`.

Browser scenarios use clearly separated test fixtures from `test/fixtures.mjs`, which is not exported. Production contains no demo feed, invented balances, simulated live activity or test telemetry. A separate live smoke check used all three supplied public endpoints. Temporary tooling, native libraries, browser binaries and caches were kept outside the repository.

No native OBS/vMix, physical iPhone/Safari, screen-reader session, or browser-native 200% zoom session was available. Tested narrow-screen reflow and accessibility snapshots/scans are not substitutes for those checks. The public APIs, the operator's clock, accurate circumference and upstream event indexing remain external dependencies. A refresh, source shutdown, URL change, or first-time load resets that source's in-memory transition baseline and history.

Design guidance credits and retained licenses are in [`artifacts/ATTRIBUTION.md`](artifacts/ATTRIBUTION.md) and [`artifacts/DESIGN-GUIDANCE-LICENSE.txt`](artifacts/DESIGN-GUIDANCE-LICENSE.txt).
