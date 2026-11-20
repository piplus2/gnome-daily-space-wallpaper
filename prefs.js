// SPDX-License-Identifier: MIT

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {CATEGORIES} from './lib/categories.js';

const RESOLUTIONS = [
    {id: 'auto', label: 'Match my screen (up to 4K)'},
    {id: '1080p', label: '1080p (1920 × 1080)'},
    {id: '1440p', label: '1440p (2560 × 1440)'},
    {id: '4k', label: '4K (3840 × 2160)'},
];

export default class DailySpaceWallpaperPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        // Keep the settings object alive as long as the window.
        window._settings = settings;

        const page = new Adw.PreferencesPage({
            title: 'General',
            icon_name: 'preferences-desktop-wallpaper-symbolic',
        });
        window.add(page);

        page.add(this._wallpaperGroup(settings));
        page.add(this._categoriesGroup(settings));
        page.add(this._aboutGroup());
    }

    _wallpaperGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: 'Wallpaper',
            description: 'A new image is picked once a day.',
        });

        const changeNow = new Adw.ActionRow({
            title: 'Change wallpaper now',
            subtitle: 'Pick a different image straight away',
        });
        const changeButton = new Gtk.Button({
            label: 'Change',
            valign: Gtk.Align.CENTER,
        });
        changeButton.connect('clicked', () => {
            // The extension listens for changes to this key.
            settings.set_int('refresh-request', settings.get_int('refresh-request') + 1);
        });
        changeNow.add_suffix(changeButton);
        changeNow.activatable_widget = changeButton;
        group.add(changeNow);

        const resolutionRow = new Adw.ComboRow({
            title: 'Resolution',
            subtitle: 'Smaller images are skipped; larger ones are scaled down',
            model: Gtk.StringList.new(RESOLUTIONS.map(r => r.label)),
        });
        const syncResolution = () => {
            const index = RESOLUTIONS.findIndex(r => r.id === settings.get_string('resolution'));
            resolutionRow.selected = Math.max(index, 0);
        };
        syncResolution();
        resolutionRow.connect('notify::selected', () => {
            settings.set_string('resolution', RESOLUTIONS[resolutionRow.selected].id);
        });
        settings.connect('changed::resolution', syncResolution);
        group.add(resolutionRow);

        const keepRow = Adw.SpinRow.new_with_range(1, 100, 1);
        keepRow.title = 'Wallpapers to keep';
        keepRow.subtitle = 'Older downloads are deleted automatically';
        settings.bind('keep-count', keepRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(keepRow);

        const indicatorRow = new Adw.SwitchRow({
            title: 'Show panel menu',
            subtitle: 'Shows the image title and lets you skip to another image',
        });
        settings.bind('show-indicator', indicatorRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(indicatorRow);

        return group;
    }

    _categoriesGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: 'Topics',
            description: 'Images are picked at random from the enabled topics.',
        });

        for (const category of CATEGORIES) {
            const row = new Adw.SwitchRow({
                title: category.title,
                subtitle: category.subtitle,
                active: settings.get_strv('categories').includes(category.id),
            });
            row.connect('notify::active', () => {
                const enabled = new Set(settings.get_strv('categories'));
                if (row.active)
                    enabled.add(category.id);
                else
                    enabled.delete(category.id);
                settings.set_strv('categories', [...enabled]);
            });
            group.add(row);
        }

        return group;
    }

    _aboutGroup() {
        const group = new Adw.PreferencesGroup({
            title: 'Image source',
            description: 'Images come from the NASA Image and Video Library. ' +
                'NASA material is generally not subject to copyright in the United States; ' +
                'some images credit partner organisations. This extension is not affiliated ' +
                'with or endorsed by NASA.',
        });

        const linkRow = new Adw.ActionRow({
            title: 'NASA Image and Video Library',
            subtitle: 'images.nasa.gov',
            activatable: true,
        });
        linkRow.add_suffix(new Gtk.Image({icon_name: 'adw-external-link-symbolic'}));
        linkRow.connect('activated', () => {
            Gtk.show_uri(linkRow.get_root(), 'https://images.nasa.gov/', 0);
        });
        group.add(linkRow);

        const guidelinesRow = new Adw.ActionRow({
            title: 'NASA media usage guidelines',
            subtitle: 'www.nasa.gov/nasa-brand-center/images-and-media',
            activatable: true,
        });
        guidelinesRow.add_suffix(new Gtk.Image({icon_name: 'adw-external-link-symbolic'}));
        guidelinesRow.connect('activated', () => {
            Gtk.show_uri(guidelinesRow.get_root(),
                'https://www.nasa.gov/nasa-brand-center/images-and-media/', 0);
        });
        group.add(guidelinesRow);

        return group;
    }
}
