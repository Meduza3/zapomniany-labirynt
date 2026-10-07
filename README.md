# Zapomniany Labirynt

A self-hosted, four-player browser game built from your rule sheet, board, and 60 printed path tiles. The interface and game messages are in Polish. Play with one to four people and fill the remaining seats with bots. Human players use their own browsers; hands are private and the server enforces the same rules for everyone.

Hosted game: [Zapomniany Labirynt](https://meduza3.github.io/zapomniany-labirynt/).

The interface uses an illustrated fantasy garden, wooden board frames, brass accents, parchment controls, and locally bundled lettering. The original tile artwork remains on the board. Background-art provenance, the generation prompt, and font licenses are documented in [ARTWORK.md](ARTWORK.md).

## Play in two minutes

1. Open a terminal in this directory. Use Node.js 22 or newer.
2. Run `npm start` (or `node server.mjs`). No dependency installation is needed.
3. Open <http://localhost:3000>, enter your name, and create a room.
4. Invite friends with the room link, or click **Uzupełnij botami** to fill the empty seats. On another device, replace `localhost` in the link with this computer's LAN address, or your server's domain.
5. When all four seats are occupied, the host starts the game.

The running preview on the development computer uses <http://localhost:3177> because port 3000 was already occupied. To start on that port again, run `PORT=3177 npm start`.

In the lobby, each player can choose any unused garden color. Colors held by another person or a bot cannot be selected. The choice is saved, updates for everyone, and determines the starting garden. New players and bots take unused colors.

Each human player needs a separate browser profile/device. For testing four seats on one computer, use four separate profiles. Returning to the room in the same browser restores that player's seat.

## Play with bots

The room host can use **Uzupełnij botami** in the lobby to fill all empty seats, then select **Rozpocznij grę**. One person can play against three bots; groups can mix people and bots up to four seats. Use **Usuń boty** before starting if you want to make room for more friends.

Bots choose their actions on the server with a short delay, so everyone can follow their turns. They seek missing flowers, build paths, and resolve special powers. They receive only the public board and their own hand, and every action goes through the same validation as human moves. Saved games retain bot seats and resume their turns after a server restart.

## Your turn

Move along one visible straight path and place one tile, in either order. Select a tile in your hand to see full-size previews on every eligible board space. Each preview uses a legal orientation. Hover or focus a space and press R, or use the mouse wheel over it, to cycle only through its legal rotations. The rotate button remains available for touch controls. Click or tap a preview once to place exactly that orientation, without a confirmation step. A shovel can also replace an unoccupied path tile. Draw only at the end of your turn, after both actions and any tool or discard decision, until tiles and collected flowers fill four total hand slots.

Newly placed tiles settle onto the board over 320 milliseconds. Tile rotations, including hand and board previews, take 220 milliseconds. Pawns travel along their road in 220–460 milliseconds, collected flowers fly from their garden to the player in 420 milliseconds, and newly drawn tiles slide into the hand in 320 milliseconds. The winner’s three flowers bloom once over 900 milliseconds. These animations do not delay the accepted move; reduced-motion preferences show the final state immediately.

If your normal movement is still unused, you can enter a newly placed tile connected to your visible straight path. Click the highlighted square or **Wejdź na nowy kafelek**.

Pruning and rotation powers are optional and appear as an extra prompt after placement. Resolve the power or choose **Pomiń zdolność**. Any unused legal movement remains available afterward. If no tile in your hand can be placed in any rotation, remove an eligible tile instead. Tiles unseen by every player disappear automatically. Their paths overgrow with vines and leaves over 1.4 seconds, blending into the board’s foliage without blocking play. Reduced-motion preferences show the final foliage immediately. Visit each opponent's garden to collect one flower of each color; the third flower wins immediately. When you collect a flower before building, keep your tiles until you finish the tile action. The placed tile normally makes room for the flower. Only excess tiles still remaining at the end of the turn require a discard choice.

Turns end automatically once movement and the tile action are complete and no tool or discard decision remains. The outgoing player’s hand refills to its flower-adjusted capacity immediately before the next player’s turn. When no legal movement remains after the tile action and its optional power, the server skips the blocked movement and advances to the next player automatically. An optional power with legal targets and any required discard still wait for your choice. A power without legal targets is skipped automatically. Manual finish/skip controls appear only when an older saved turn still needs them.

Each garden displays its remaining flower tokens along the outside edge of the board. Gardens begin with three flowers; a token disappears when an opponent collects that color, and every player's screen updates automatically.

The in-game rules dialog includes the original PDF. [RULES.md](RULES.md) distinguishes the PDF's rules, your clarifications, and operational choices for cases the sheet leaves undefined.

## Deploy with GitHub Pages and Supabase

GitHub Pages serves the built website. Supabase authenticates players, stores rooms and private hands, validates every action, delivers live updates, and runs bot turns. The existing Node server remains available for local play and Docker hosting.

1. Create a Supabase project and a GitHub repository containing this project. Keep the repository's default branch named `main` for the supplied workflow.
2. In GitHub **Settings → Secrets and variables → Actions**, add the three repository variables below and the personal access token as a repository secret.
3. In GitHub **Settings → Pages**, set the source to **GitHub Actions**.
4. Push to `main`, or run **Test and publish game** from the Actions page. The workflow checks the code, deploys the backend, runs real Supabase integration tests, builds `dist/`, and publishes it. A failed backend test prevents website publication.
5. Open the Pages URL shown by the completed deployment, create a room, and share its invitation link.

| GitHub setting | Value |
| --- | --- |
| Variable `SUPABASE_PROJECT_REF` | The Supabase project's reference ID |
| Variable `SUPABASE_URL` | The project URL, such as `https://your-project.supabase.co` |
| Variable `SUPABASE_PUBLISHABLE_KEY` | The project's publishable key, or its legacy `anon` key |
| Secret `SUPABASE_ACCESS_TOKEN` | A Supabase personal access token authorized to deploy this project |
| Optional secret `SUPABASE_SERVICE_KEY` | A secret API key or legacy `service_role` key for integration-test cleanup and lease recovery checks |

Restrict the deployment personal access token to this game project. Initial setup needs read/write access for Project Settings, Database, Migrations, Auth Config, Edge Functions, and Edge Function Secrets. Once anonymous sign-ins and the site URL match the configured values, CI skips Auth mutations and read access to Project Settings suffices for that settings check. Keep write access for database migrations, functions, and function secrets; changing Auth settings later needs the initial write permissions again.

The project URL and publishable key are intentionally included in the website. The access token, database service key, and bot-worker secret stay on the backend and must never be supplied as the website's publishable key. Browser sessions use anonymous Supabase accounts; clearing site data loses access to that seat. [Supabase anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous) describes this session behavior.

Backend deployment applies new migrations, enables anonymous sign-ins, installs both Edge Functions, and configures the private bot secret and recovery schedule. Each bot action is saved separately. Expired worker leases can be retried without applying the same action twice.

For a manual static build, install the locked dependencies with `npm ci`, set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`, and run `npm run build`. Publish only `dist/`. Its relative asset paths work beneath a GitHub repository URL. Building the files does not install the database or deploy the backend.

### Verify a real Supabase backend

Use an already migrated local stack or a disposable hosted project with anonymous sign-ins enabled, the Edge Functions installed, and bot scheduling configured. Local Supabase development needs the Supabase CLI and a Docker-compatible runtime. See the [official local setup](https://supabase.com/docs/guides/local-development).

```sh
export LABIRYNT_SUPABASE_URL="http://127.0.0.1:54321"
export LABIRYNT_SUPABASE_PUBLISHABLE_KEY="your-local-publishable-key"
LABIRYNT_REQUIRE_CLOUD_TESTS=true npm run test:cloud
```

This separate integration harness uses real Auth, HTTP, Postgres permissions, and persisted room views. It checks private hands, unauthorized access, unused color selection, competing actions, request replay, and bot continuation. It creates five anonymous test accounts and two rooms. Optionally set `LABIRYNT_SUPABASE_SERVICE_KEY` in the test environment to verify lease expiry and stale-worker rejection, then delete only that run's fixtures automatically. Without that key, the test prints fixture IDs for cleanup and skips the lease probe. Never include the service key in the website configuration.

Supabase's default anonymous signup limit is 30 per hour per IP, so repeated runs may require waiting or adjusting the test project's limit. [Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits)

Without connection settings, the cloud suite skips during ordinary `npm test`. Setting `LABIRYNT_REQUIRE_CLOUD_TESTS=true` makes missing settings fail immediately; the deployment workflow enables this guard. Local unit and Node-server tests do not prove a hosted Supabase deployment is healthy.

The integration harness covers automatic bot turns, lease recovery, private completed-game statistics, and fixture cleanup against real Supabase. The deployment workflow repeats the hosted checks before publishing Pages.

## Completed-game statistics

Every finished game records one private result automatically on the backend, including wins by bots. On Supabase, open **Table Editor → game_results** in the project dashboard. Local Node hosting stores the same records in the top-level `results` array in `DATA_DIR/rooms.json`.

Each result contains the room code and creation time, finish time, `turn_count`, ordered player results with names, colors, bot status and final flower colors, `starter_id`, `winner_id`, and `first_player_won`. Turn count means individual player turns, including the winning turn, not complete four-player rounds. The starter is the first player in turn order, regardless of garden color.

Results are saved with the finished room state. Repeated requests and restarts do not create duplicates, and room cleanup retains the result. The Supabase migration also records already-finished rooms. Results contain no hands, deck order, authentication IDs, or session credentials. Browser accounts cannot read or change this table; only project administrators and the backend can access it.

## Host with Docker

```sh
docker compose up --build -d
```

The original Docker image built successfully and the Compose configuration validates. Rebuild the image to include the current bot support. On the development computer, Docker Desktop held new containers in “Created” state even without networking, so running-container verification could not complete. Direct Node hosting and its persistence tests passed.

The game listens on port 3000. The named `labyrinth-data` volume retains rooms across container restarts. This is a single-server application: run one instance against its data directory.

For an internet-facing server, point a domain at your server and put an HTTPS reverse proxy in front of port 3000. For example, with Caddy running on the same host:

```caddyfile
game.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Replace the example domain with your own. The proxy must allow long-lived event-stream responses without buffering. Keep the data volume/directory persistent on your hosting provider. This hosting mode needs the Node server. For static hosting, use the Supabase build and deployment steps above; uploading unconfigured `public/` alone does not provide multiplayer.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Listening port |
| `HOST` | `0.0.0.0` | Network interface |
| `DATA_DIR` | `data/` in the project | Persistent room storage |

Room sessions are stored in the browser. Keep that browser's site data to retain your seat. The server stores hashed session credentials and authoritative game state. Invite links contain room codes, not player credentials. A server restart preserves dealt hands, board positions, and turns.

## Verify

```sh
npm test
npm run check
```

Verified on Node.js 22.18.0: the automated rule, bot, browser-controller, server, build, and cloud-command suites pass. The separate hosted integration suite validates the scenarios described above. A four-browser Chrome session completed eight turns, restored the correct seat after reload, and displayed the board at a 390-pixel mobile width without overflow. Additional browser scenarios exercised pruning, rotation, flower discarding, forced removal, shovel replacement, and victory. A separate simulation preserved all 60 tiles and valid player positions through more than 10,000 actions. Bot browser checks verify adding/removing bot seats, three automatic bot turns, movement onto a newly placed tile, reload recovery, and returning to an existing room after opening a new one.

Automatic turn completion is covered for both action orders, blocked movement, optional tools, flower discards, bot turns, persisted state, and private multiplayer updates. A browser check confirms that entering a newly placed tile immediately starts the next player’s turn without an extra button press.

Welcome and waiting-room previews randomly select from 16 layouts reached through legal play. Every path is visible to a pawn, and each physical tile appears at most once. A new visit or reload changes all four pawn positions; typing and lobby updates keep the current preview still. Remaining garden flowers reflect each layout.

The welcome page includes the complete rules below the form and preview, with two columns on desktop and one on phones. Its header rules button scrolls to the section; rooms retain the rules dialog.

At phone widths, the hand and touch rotation control sit directly below the board in a compact tray. Active controls have at least 44-pixel touch targets and account for the bottom safe area. Tile previews use 30% opacity, rising to 45% on the active square. Browser checks at 320px and 390px verified no horizontal overflow or board obstruction, color selection, matching starting gardens, touch rotation, and single-tap placement.

Placement tests verify per-square preview orientations, exact single-click submissions, keyboard and wheel rotation, mixed mouse/keyboard focus, wheel throttling, and cancellation. Browser checks confirmed repeated rotation and a one-click placement at the displayed 270° orientation.

Browser-controller tests validate all 16 layouts on both screens and preview stability across form changes, lobby updates, navigation, and reload. They also exercise animation timing, repeated and stale multiplayer updates, interrupted renders, replacement tiles, navigation, and reduced-motion changes. They use a separate client test file because the rules and HTTP suites do not execute the browser controller.

Engine and bot tests use Node's built-in runner for fast feedback. Bot decision tests have a separate file because choosing a move is distinct from validating the game rules. Server tests use real local HTTP connections and temporary persistent storage to verify room privacy, multiplayer updates, action validation, and recovery without faking the behavior under test.

Collected flowers occupy the hand slots they replace, using the same colored tokens as the gardens. After collecting a flower before building, during a required end-of-turn discard, or at victory, all actual tiles and flowers remain visible even when they temporarily exceed four items. Client tests cover these cases, empty slots when the deck is depleted, and restoration after reload.

Flower display checks cover all counts from zero to three, collection updates across two browsers, reload recovery, repeated garden visits, and mobile layout at 390 pixels wide. The fantasy theme was checked in the welcome screen, lobby, active game, and rules window; desktop and 390-pixel layouts, tile placement, movement onto a new tile, bot turns, and reload recovery passed browser checks. The focused static-serving test and JavaScript syntax checks also pass.

## Files and source material

`server.mjs` serves the client and multiplayer API. `src/engine.mjs` contains the pure game rules; `src/bot.mjs` chooses bot actions from each bot's private view. `public/` contains the browser interface and artwork extracted from the supplied PDFs. `test/` contains the automated checks. `data/` contains runtime state and must remain private.

The supplied materials are “Zapomniany Labirynt Instrukcja2.pdf”, “labirynt toprint kafelki i rewersy.pdf”, and “labirynt toprint 3 plansza.pdf”. The original rule sheet is copied to `public/rules.pdf`. Only front artwork is counted in the 60-tile deck; the reverse sheets do not add tiles. Assets retain their original artwork rather than substituting a generic maze.
