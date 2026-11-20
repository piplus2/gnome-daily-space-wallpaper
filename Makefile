UUID := daily-space-wallpaper@piplus2.github.io
ZIP := $(UUID).shell-extension.zip

.PHONY: pack install lint clean

# Builds the zip to upload to extensions.gnome.org.
pack: clean
	gnome-extensions pack --force --extra-source=lib --extra-source=LICENSE .
	@# extensions.gnome.org rejects compiled schemas for GNOME 45+.
	zip -qd $(ZIP) schemas/gschemas.compiled 2>/dev/null || true
	@unzip -l $(ZIP)

# Installs into ~/.local/share/gnome-shell/extensions. Log out and back in
# (Wayland) or press Alt+F2 then r (X11), then enable it.
install: pack
	gnome-extensions install --force $(ZIP)

lint:
	npx eslint .

clean:
	rm -f $(ZIP) schemas/gschemas.compiled
