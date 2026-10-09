# TODO

Ideas and features planned for later milestones.

## Assets

- **Dynamic (background) asset loading — optional.** Today, images are loaded up front (`await game.assets.loadImages(...)`) before the game starts. Later, add an optional mode where images can be requested while the game is running and load in the background; sprites whose image isn't ready yet are skipped until it arrives. Up-front loading stays the default.
