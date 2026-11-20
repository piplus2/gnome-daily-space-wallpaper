// SPDX-License-Identifier: MIT

import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {CATEGORIES} from './lib/categories.js';
import {NasaImageSource} from './lib/nasa.js';
import {downloadWallpaper, pruneWallpapers} from './lib/storage.js';

// How often to check whether a new day has started (also the retry delay
// after a failed update, e.g. when offline).
const CHECK_INTERVAL_SECONDS = 15 * 60;
// Delay the first check after login so we don't compete with session startup.
const STARTUP_DELAY_SECONDS = 20;
const RECENT_IDS_TO_REMEMBER = 200;
const MAX_TARGET = {width: 3840, height: 2160};
const RESOLUTION_PRESETS = {
    '1080p': {width: 1920, height: 1080},
    '1440p': {width: 2560, height: 1440},
    '4k': {width: 3840, height: 2160},
};
const BACKGROUND_SCHEMA = 'org.gnome.desktop.background';
const USER_AGENT = 'daily-space-wallpaper-gnome-extension';

function today() {
    return GLib.DateTime.new_now_local().format('%Y-%m-%d');
}

function truncate(text, length) {
    return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, extension.metadata.name);
        this._extension = extension;

        this.add_child(new St.Icon({
            icon_name: 'weather-clear-night-symbolic',
            style_class: 'system-status-icon',
        }));

        this._titleItem = new PopupMenu.PopupMenuItem('', {reactive: false});
        this._titleItem.label.add_style_class_name('dsw-title');
        this.menu.addMenuItem(this._titleItem);

        this._creditItem = new PopupMenu.PopupMenuItem('', {reactive: false});
        this._creditItem.label.add_style_class_name('dsw-credit');
        this.menu.addMenuItem(this._creditItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._nextItem = this.menu.addAction('New Wallpaper',
            () => extension.updateWallpaper({force: true}));
        this._detailsItem = this.menu.addAction('View on NASA Image Library',
            () => extension.openCurrentImagePage());
        this.menu.addAction('Open Wallpaper Folder',
            () => extension.openWallpaperFolder());
        this.menu.addAction('Settings',
            () => extension.openPreferences());

        this.sync();
    }

    sync() {
        const {busy, lastError} = this._extension;
        const image = this._extension.currentImage;

        this._titleItem.label.text = image ? truncate(image.title, 50) : 'No wallpaper yet';
        if (busy)
            this._creditItem.label.text = 'Fetching a new image…';
        else if (lastError)
            this._creditItem.label.text = truncate(`Last update failed: ${lastError}`, 60);
        else if (image)
            this._creditItem.label.text = truncate(`${image.credit}${image.date ? `, ${image.date}` : ''}`, 60);
        else
            this._creditItem.label.text = '';

        this._nextItem.setSensitive(!busy);
        this._detailsItem.setSensitive(Boolean(image?.pageUrl));
    }
});

export default class DailySpaceWallpaperExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._backgroundSettings = new Gio.Settings({schema_id: BACKGROUND_SCHEMA});
        this._session = new Soup.Session({user_agent: USER_AGENT, timeout: 60});
        this._source = new NasaImageSource(this._session);
        this._cancellable = new Gio.Cancellable();
        this._wallpaperDir = Gio.File.new_for_path(
            GLib.build_filenamev([GLib.get_user_data_dir(), 'daily-space-wallpaper']));

        this.busy = false;
        this.lastError = null;

        this._settingsChangedIds = [
            this._settings.connect('changed::show-indicator', () => this._syncIndicator()),
            this._settings.connect('changed::refresh-request',
                () => this.updateWallpaper({force: true})),
        ];
        this._syncIndicator();

        this._startupTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,
            STARTUP_DELAY_SECONDS, () => {
                this._startupTimeoutId = 0;
                this.updateWallpaper({force: false});
                return GLib.SOURCE_REMOVE;
            });
        this._checkTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,
            CHECK_INTERVAL_SECONDS, () => {
                this.updateWallpaper({force: false});
                return GLib.SOURCE_CONTINUE;
            });
    }

    disable() {
        // This also runs when the screen locks; a download in progress is
        // cancelled and retried on the next check after unlock.
        this._cancellable.cancel();
        this._cancellable = null;

        if (this._startupTimeoutId)
            GLib.source_remove(this._startupTimeoutId);
        this._startupTimeoutId = 0;
        GLib.source_remove(this._checkTimeoutId);
        this._checkTimeoutId = 0;

        this._settingsChangedIds.forEach(id => this._settings.disconnect(id));
        this._settingsChangedIds = null;

        this._indicator?.destroy();
        this._indicator = null;

        this._session.abort();
        this._session = null;
        this._source = null;
        this._settings = null;
        this._backgroundSettings = null;
        this._wallpaperDir = null;
    }

    get currentImage() {
        try {
            return JSON.parse(this._settings.get_string('current-image')) || null;
        } catch {
            return null;
        }
    }

    _syncIndicator() {
        const show = this._settings.get_boolean('show-indicator');
        if (show && !this._indicator) {
            this._indicator = new Indicator(this);
            Main.panel.addToStatusArea(this.uuid, this._indicator);
        } else if (!show && this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }

    _setBusy(busy, error = null) {
        this.busy = busy;
        this.lastError = error;
        this._indicator?.sync();
    }

    /**
     * Size the wallpaper must cover: the largest monitor in physical pixels
     * (in landscape orientation), capped at 4K, or the user's chosen preset.
     */
    _targetSize() {
        const preset = RESOLUTION_PRESETS[this._settings.get_string('resolution')];
        if (preset)
            return preset;

        let width = 0, height = 0;
        const display = global.display;
        for (let i = 0; i < display.get_n_monitors(); i++) {
            const rect = display.get_monitor_geometry(i);
            const scale = display.get_monitor_scale(i);
            // On Wayland the geometry is in logical pixels; on X11 this may
            // overestimate, which only means we prefer a larger image.
            width = Math.max(width, Math.round(Math.max(rect.width, rect.height) * scale));
            height = Math.max(height, Math.round(Math.min(rect.width, rect.height) * scale));
        }
        if (width === 0)
            return RESOLUTION_PRESETS['1080p'];
        return {
            width: Math.min(width, MAX_TARGET.width),
            height: Math.min(height, MAX_TARGET.height),
        };
    }

    _enabledSearches() {
        const enabled = new Set(this._settings.get_strv('categories'));
        return CATEGORIES.filter(c => enabled.has(c.id))
            .flatMap(category => category.queries.map(query => ({query, category})));
    }

    async updateWallpaper({force}) {
        if (this.busy || (!force && this._settings.get_string('last-update') === today()))
            return;

        const cancellable = this._cancellable;
        this._setBusy(true);
        try {
            const recentIds = this._settings.get_strv('recent-ids');
            const target = this._targetSize();
            const image = await this._source.pickImage({
                searches: this._enabledSearches(),
                target,
                excludeIds: new Set(recentIds),
                cancellable,
            });
            const file = await downloadWallpaper(
                this._session, image, target, this._wallpaperDir, cancellable);

            this._applyWallpaper(file);
            this._settings.set_string('current-image', JSON.stringify(image));
            this._settings.set_strv('recent-ids',
                [image.id, ...recentIds].slice(0, RECENT_IDS_TO_REMEMBER));
            this._settings.set_string('last-update', today());
            this._setBusy(false);

            await pruneWallpapers(this._wallpaperDir,
                this._settings.get_int('keep-count'), file, cancellable);
        } catch (e) {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                return;
            console.warn(`[${this.metadata.name}] Wallpaper update failed: ${e.message}`);
            // The extension may have been disabled while we were waiting.
            if (this._settings)
                this._setBusy(false, e.message);
        }
    }

    _applyWallpaper(file) {
        const uri = file.get_uri();
        this._backgroundSettings.set_string('picture-uri', uri);
        if (this._backgroundSettings.settings_schema.has_key('picture-uri-dark'))
            this._backgroundSettings.set_string('picture-uri-dark', uri);
        this._backgroundSettings.set_string('picture-options', 'zoom');
    }

    _launchUri(uri) {
        try {
            Gio.AppInfo.launch_default_for_uri(uri, global.create_app_launch_context(0, -1));
        } catch (e) {
            console.warn(`[${this.metadata.name}] Could not open ${uri}: ${e.message}`);
        }
    }

    openCurrentImagePage() {
        const url = this.currentImage?.pageUrl;
        if (url)
            this._launchUri(url);
    }

    openWallpaperFolder() {
        try {
            this._wallpaperDir.make_directory_with_parents(null);
        } catch {
            // Already exists.
        }
        this._launchUri(this._wallpaperDir.get_uri());
    }
}
