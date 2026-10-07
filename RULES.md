# Zapomniany Labirynt — implemented rules

This implementation follows the supplied Polish instruction sheet and the printed board and tile artwork, with the owner's clarifications recorded below. The server validates every action. Clients receive their own hand and only the number of tiles in other players' hands.

## 1. Rules stated by the supplied instruction sheet

The board has 5 × 5 spaces. A turn requires one movement and one tile placement, in either order. The movement may cover several spaces along one visible straight path. A player cannot turn during that movement. Placing a tile immediately opens it as a movement destination if it connects to the player's visible straight path and that turn's movement has not yet been used. Resolve or skip an optional tool before moving. A placed tile must connect to an existing path on at least one edge and be in some player's sight. Other adjacent edges do not all have to match. When no tile in the hand can legally be placed, removing a tile replaces the placement.

Sight follows paths and ends at a hedge, an empty space, a bend, or the tree in a crossing. A visible bend or tree tile remains on the board, but the sight ray does not continue beyond it. After movement, placement, removal, or rotation, tiles no longer visible to any player are discarded.

Visiting opponents' gardens collects one flower of each opponent color. A player cannot collect their own color or collect a color twice. Passing through a garden counts as a visit. The third different opponent flower ends the game immediately, including when that garden is crossed during a longer selected movement.

Four hand slots hold tiles and collected flowers together. One flower leaves room for three tiles; two flowers leave room for two. Tools are optional and activate when their tile is placed. A tool cannot affect a tile occupied by a player. The shovel places its tile over another tile and discards the old tile. The secateurs remove another tile. Rotation turns another tile, which must remain in at least one player's sight afterward. A rotation or removal may cause other tiles to be forgotten. One-way arrows limit movement to the arrow direction; the arrow's exit must not lead outside the board.

## 2. Owner's confirmed clarifications

Four players start in their own gardens. The board artwork fixes the green garden at the middle of the north edge, yellow at the east edge, blue at the south edge, and red at the west edge.

At the end of a turn, after both actions and any optional tool or required discard are resolved, the outgoing player draws random tiles until tiles and flowers together occupy four hand slots. No replacement is drawn immediately after placement. A newly collected flower can therefore use the slot released by that turn’s placement. The end-of-turn refill also applies after forced removal. When the draw stock runs out, discarded tiles are shuffled into a new draw stock; if both are empty, the hand remains short.

A bridge consists of two separate straight paths. Sight travels straight along either path and cannot switch between the bridge's paths. The implementation remembers which path a pawn entered, so the pawn also stays on that path when it moves again.

Movement may be skipped only when no move is possible. This is checked after the tile action and any optional tool have been resolved, so a player must first try the mandatory placement or removal that could open a path. When no movement remains at that point, the server skips it automatically. A completed movement and tile action automatically advance the turn as soon as no tool or discard decision remains. A power without legal targets is skipped automatically. Available movement, optional powers with legal targets, and required hand discards still wait for the player to choose. The default game enables this confirmed rule. The engine's `allowBlockedMoveSkip: false` option exists only for testing the instruction sheet without this clarification.

## 3. Details resolved by the implementation

The following operational details are not specified explicitly in the instruction sheet. They are recorded here to make the adaptation reviewable.

The 60 printed fronts form one shuffled common stock. Each player initially draws four tiles. The first lobby seat goes first, and turns follow lobby seat order. Choosing another garden color does not change turn order. Hands are private. Players may occupy the same space and pass one another because no collision restriction is stated.

Printed gardens are fixed board spaces and cannot be removed, covered, rotated, or forgotten. The first empty space reached by a sight ray is a legal placement frontier. A new tile must also be visible through an open edge after it is placed; a hedge-facing edge cannot make an otherwise invisible tile legal. One-way arrows affect movement, not sight. A pawn on a tree crossing can see and depart in every open direction, while a ray arriving from elsewhere stops at that tree.

The double-bend artwork has two disconnected paths, north–east and south–west before rotation. A pawn stays on its entered path, as on a bridge. A T junction permits straight sight and longer movement along its crossbar, while an approach along the stem ends at the junction. Starting a later movement from that junction allows any connected exit.

A flower collected before placement may temporarily increase the hand beyond four combined items. The player completes the tile action and any optional tool first. Only if the hand still exceeds capacity after both actions does the player choose excess tiles to discard before the end-of-turn refill. This can happen after forced removal, which does not spend a hand tile. Existing saved discard decisions remain playable. No automatic random discard occurs. Winning with a third flower finishes the game immediately, without requiring a subsequent discard or end-turn action.

Forgetting is applied after each complete movement or tile action. A newly placed optional tool is resolved before the next movement or automatic turn completion. Refilling waits until all turn actions and decisions are complete. A tool may be skipped. All unoccupied movable tiles are eligible secateurs targets; rotation additionally requires the result to remain visible. A target cannot be the tool tile that was just placed.

## 4. Exact inventory from the print sheets

Pages 1 and 3 contain 40 and 20 playable fronts. Pages 2 and 4 are backs and do not add tiles.

| Shape | Plain | Secateurs | Shovel | Rotation | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Straight | 5 | 4 | 2 | 4 | 15 |
| Single bend | 7 | 1 | 1 | 9 | 18 |
| Double bend | 4 | 0 | 0 | 0 | 4 |
| One-way straight | 4 | 0 | 0 | 0 | 4 |
| Tree crossing | 6 | 0 | 0 | 0 | 6 |
| Bridge crossing | 3 | 0 | 0 | 0 | 3 |
| T junction | 5 | 1 | 2 | 2 | 10 |
| **Total** | **34** | **6** | **5** | **15** | **60** |

The board sheet also contains the four fixed gardens and three flower tokens per color. Every digital tile's asset name records its print page, row, and column.

## 5. Bots

The host may fill empty lobby seats with bots or remove lobby bots before the game starts. There are always four seats; one to four may be human. Bots follow the same rules and hand limits. They decide using only the public board and their own private hand, and the server validates, saves, and broadcasts each action. Bots seek missing flowers and choose legal paths and tools. A saved bot turn resumes when the server restarts.

## 6. Verification

`node --test test/engine.test.mjs` checks inventory, setup, private views, legal action order, sight, movement, both disconnected crossing shapes, one-way edges, forgetting, tool protection and cascades, forced removal, flower collection and discarding, immediate victory, end-of-turn draws, reshuffling, blocked movement, and state immutability.

The source documents remain available from the application's rules panel. Future rule changes should update the engine and its behavior tests together with this record.
