# Daily Space Wallpaper

A GNOME Shell extension that sets a new space-themed wallpaper every day, picked at
random from the [NASA Image and Video Library](https://images.nasa.gov/):
nebulae, galaxies, planets, the Milky Way and Earth seen from orbit.

- **Sized for your screen.** It detects your largest monitor (up to 4K) and only picks
  images that cover it. Larger originals are scaled down before saving, to save disk
  space and memory.
- **No API key, no account.** It uses NASA's public search API.
- **Panel menu.** Shows the image title and credit, and lets you skip to another image,
  open its NASA page or open the wallpaper folder.
- **Topics.** Choose any of: deep space, Solar System, Earth from orbit, Milky Way.
- **Tidy.** Keeps only the last *N* downloads (10 by default) in
  `~/.local/share/daily-space-wallpaper/`.

Supports GNOME Shell 45–49.

## Install

From [extensions.gnome.org](https://extensions.gnome.org/) (link once published), or
from source:

```sh
git clone https://github.com/piplus2/gnome-daily-space-wallpaper.git
cd gnome-daily-space-wallpaper
make install
```

Then log out and back in (Wayland), or press <kbd>Alt</kbd>+<kbd>F2</kbd>, type `r`
and press Enter (X11). Enable it with:

```sh
gnome-extensions enable daily-space-wallpaper@piplus2.github.io
```

If you use another wallpaper changer (for example a Bing wallpaper extension),
disable it, otherwise the two will overwrite each other.

## How images are chosen

Once a day (checked every 15 minutes, so it also catches up after suspend or being
offline) the extension:

1. picks a random search term from the enabled topics and a random results page;
2. keeps landscape JPEG/PNG images that are at least 1920×1080 and come from NASA
   centres that publish science imagery. It skips results that look like diagrams,
   charts or press-event photos;
3. prefers images at least as large as your screen, avoiding the last 200 images shown;
4. downloads the original, scales it down to just cover your screen and sets it with
   the *Zoom* option.

The filtering is heuristic. If an unsuitable picture slips through, use
**New Wallpaper** in the panel menu.

## Image credits and licence

Images come from the NASA Image and Video Library. NASA material is generally not
subject to copyright in the United States, but some images credit partner
organisations. The title and credit of the current image appear in the panel menu.
See the [NASA media usage guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/).

This project is not affiliated with or endorsed by NASA.

The extension code is released under the [MIT License](LICENSE).

## Development

```sh
make pack      # builds daily-space-wallpaper@piplus2.github.io.shell-extension.zip
make install   # installs the zip for the current user
```

Watch the logs with `journalctl -f -o cat /usr/bin/gnome-shell`.

Code layout:

| File | Purpose |
| --- | --- |
| `extension.js` | Daily timer, panel menu, applying the wallpaper |
| `prefs.js` | Preferences window (libadwaita) |
| `lib/categories.js` | Topics, their search terms and filters |
| `lib/nasa.js` | Searching the NASA API and choosing an image |
| `lib/storage.js` | Downloading, scaling and pruning old wallpapers |
