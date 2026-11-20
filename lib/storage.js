// SPDX-License-Identifier: MIT
//
// Downloads an image, scales it down to the screen size, and removes old
// wallpapers. All slow work is asynchronous so the Shell stays responsive.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GdkPixbuf from 'gi://GdkPixbuf';
import Soup from 'gi://Soup?version=3.0';

Gio._promisify(Soup.Session.prototype, 'send_async');
Gio._promisify(Gio.File.prototype, 'replace_async');
Gio._promisify(Gio.File.prototype, 'read_async');
Gio._promisify(Gio.File.prototype, 'delete_async');
Gio._promisify(Gio.File.prototype, 'enumerate_children_async');
Gio._promisify(Gio.FileEnumerator.prototype, 'next_files_async');
Gio._promisify(Gio.OutputStream.prototype, 'splice_async');
Gio._promisify(Gio.OutputStream.prototype, 'close_async');
Gio._promisify(Gio.InputStream.prototype, 'close_async');

const PRIORITY = GLib.PRIORITY_LOW;
const JPEG_QUALITY = '92';
const WALLPAPER_RE = /\.(jpg|png)$/;
const PART_FILE = '.download.part';

// GdkPixbuf's static async functions can't be wrapped with Gio._promisify,
// because their finish functions aren't methods of the source object.
function loadAtWidth(stream, width, cancellable) {
    return new Promise((resolve, reject) => {
        GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(
            stream, width, -1, true, cancellable, (_source, result) => {
                try {
                    resolve(GdkPixbuf.Pixbuf.new_from_stream_finish(result));
                } catch (e) {
                    reject(e);
                }
            });
    });
}

function saveJpeg(pixbuf, stream, cancellable) {
    return new Promise((resolve, reject) => {
        pixbuf.save_to_streamv_async(
            stream, 'jpeg', ['quality'], [JPEG_QUALITY], cancellable, (_source, result) => {
                try {
                    resolve(GdkPixbuf.Pixbuf.save_to_stream_finish(result));
                } catch (e) {
                    reject(e);
                }
            });
    });
}

function safeFileName(id) {
    return id.replace(/[^A-Za-z0-9._-]/g, '_');
}

/**
 * Downloads `image` into `dir`. If it is larger than needed to cover a
 * `target`-sized screen, it is scaled down and saved as JPEG.
 *
 * @returns {Promise<Gio.File>} the wallpaper file
 */
export async function downloadWallpaper(session, image, target, dir, cancellable) {
    try {
        dir.make_directory_with_parents(cancellable);
    } catch (e) {
        if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
            throw e;
    }

    const partFile = dir.get_child(PART_FILE);
    const message = Soup.Message.new('GET', image.url);
    if (!message)
        throw new Error(`Invalid image URL: ${image.url}`);

    const input = await session.send_async(message, PRIORITY, cancellable);
    if (message.get_status() !== Soup.Status.OK) {
        await input.close_async(PRIORITY, null);
        throw new Error(`Image download failed with HTTP ${message.get_status()}`);
    }
    const output = await partFile.replace_async(
        null, false, Gio.FileCreateFlags.NONE, PRIORITY, cancellable);
    await output.splice_async(input,
        Gio.OutputStreamSpliceFlags.CLOSE_SOURCE | Gio.OutputStreamSpliceFlags.CLOSE_TARGET,
        PRIORITY, cancellable);

    try {
        return await fitToScreen(partFile, image, target, dir, cancellable);
    } finally {
        partFile.delete_async(PRIORITY, null).catch(() => {});
    }
}

async function fitToScreen(file, image, target, dir, cancellable) {
    // Reads only the image header, so this is cheap.
    const [format, width, height] = GdkPixbuf.Pixbuf.get_file_info(file.get_path());
    if (!format)
        throw new Error('The downloaded file is not an image');

    const baseName = safeFileName(image.id);
    // Smallest scale at which the image still covers the whole screen.
    const scale = Math.max(target.width / width, target.height / height);
    const formatName = format.get_name();

    if (scale >= 1 && (formatName === 'jpeg' || formatName === 'png')) {
        const dest = dir.get_child(`${baseName}.${formatName === 'jpeg' ? 'jpg' : 'png'}`);
        file.move(dest, Gio.FileCopyFlags.OVERWRITE, cancellable, null);
        return dest;
    }

    const input = await file.read_async(PRIORITY, cancellable);
    let pixbuf;
    try {
        pixbuf = await loadAtWidth(input, Math.min(width, Math.ceil(width * scale)), cancellable);
    } finally {
        await input.close_async(PRIORITY, null);
    }
    pixbuf = pixbuf.apply_embedded_orientation() ?? pixbuf;

    const dest = dir.get_child(`${baseName}.jpg`);
    const output = await dest.replace_async(
        null, false, Gio.FileCreateFlags.NONE, PRIORITY, cancellable);
    try {
        await saveJpeg(pixbuf, output, cancellable);
    } finally {
        await output.close_async(PRIORITY, null);
    }
    return dest;
}

/**
 * Deletes all but the `keep` newest wallpapers in `dir`. The current
 * wallpaper is never deleted.
 */
export async function pruneWallpapers(dir, keep, currentFile, cancellable) {
    let enumerator;
    try {
        enumerator = await dir.enumerate_children_async(
            'standard::name,time::modified', Gio.FileQueryInfoFlags.NONE,
            PRIORITY, cancellable);
    } catch (e) {
        if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
            return;
        throw e;
    }

    const files = [];
    for (;;) {
        const infos = await enumerator.next_files_async(50, PRIORITY, cancellable);
        if (infos.length === 0)
            break;
        for (const info of infos) {
            if (WALLPAPER_RE.test(info.get_name()))
                files.push({file: dir.get_child(info.get_name()), mtime: info.get_modification_date_time()?.to_unix() ?? 0});
        }
    }

    files.sort((a, b) => b.mtime - a.mtime);
    for (const {file} of files.slice(keep)) {
        if (currentFile && file.equal(currentFile))
            continue;
        await file.delete_async(PRIORITY, cancellable);
    }
}
