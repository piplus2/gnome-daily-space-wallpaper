// SPDX-License-Identifier: MIT
//
// Picks a random wallpaper-sized image from the NASA Image and Video Library.
// API docs: https://images.nasa.gov/docs/images.nasa.gov_api_docs.pdf
// No API key is needed. Search results include the size of the original
// image, so we can skip unsuitable images before downloading anything.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';

Gio._promisify(Soup.Session.prototype, 'send_and_read_async');

const SEARCH_URL = 'https://images-api.nasa.gov/search';
const DETAILS_URL = 'https://images.nasa.gov/details/';
const PAGE_SIZE = 100;
// The API returns at most 10,000 results per query.
const MAX_PAGE = 100;
// Number of random (query, page) pairs to try before settling for the
// largest image seen so far.
const ATTEMPTS = 6;

const MIN_WIDTH = 1920;
const MIN_HEIGHT = 1080;
// Landscape images only: wide enough for a 4:3 to 21:9 screen without
// cropping away most of the picture.
const MIN_ASPECT = 1.3;
const MAX_ASPECT = 2.5;
const MAX_DOWNLOAD_BYTES = 80 * 1000 * 1000;
const IMAGE_URL_RE = /\.(jpe?g|png)$/i;

// Images whose title, keywords or start of description mention any of
// these are usually diagrams, multi-panel comparisons or photos of people
// and hardware rather than scenery.
const BLOCKLIST_RE = new RegExp(`\\b(${[
    'diagram', 'chart', 'graph', 'plot', 'maps?', 'mapping', 'infographic',
    'labeled', 'annotated', 'comparison', 'versus', 'side-by-side', 'views',
    'wavelengths?', 'spectr\\w*', 'data', 'simulation', 'animation', 'model',
    'logo', 'poster', 'warhol', 'briefing', 'conference', 'ceremony',
    'employee', 'event', 'prelaunch', 'launch', 'rollout', 'technicians?',
    'engineers?', 'clean ?room', 'instrument', 'hardware', 'test(ing)?',
    'team', 'meeting', 'award', 'interior', 'cupola', 'spacesuit',
    'spacewalk', 'training', 'portrait', 'selfie', 'camera', 'lens',
    'installed', 'assembly', 'antenna', 'arrives', 'insignia', 'emblem', 'patch',
    'calendar', 'anniversary', 'module', 'experiment', 'astronauts?',
].join('|')})\\b`, 'i');

function randomInt(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
}

function randomItem(array) {
    return array[randomInt(0, array.length - 1)];
}

function pageCount(totalHits) {
    return Math.max(1, Math.min(MAX_PAGE, Math.ceil(totalHits / PAGE_SIZE)));
}

/**
 * Turns one search result into a wallpaper candidate, or returns null if it
 * isn't suitable.
 *
 * @param {object} item - an entry of `collection.items` from the search API
 * @param {{centers: string[], match: RegExp}} category - see categories.js
 * @returns {object|null}
 */
export function parseItem(item, category) {
    const data = item.data?.[0];
    const original = item.links?.find(l => l.rel === 'canonical');
    if (!data || !original?.width || !original?.height)
        return null;

    const {width, height, size, href} = original;
    const aspect = width / height;
    if (width < MIN_WIDTH || height < MIN_HEIGHT ||
        aspect < MIN_ASPECT || aspect > MAX_ASPECT ||
        (size ?? 0) > MAX_DOWNLOAD_BYTES || !IMAGE_URL_RE.test(href))
        return null;

    if (!category.centers.includes(data.center))
        return null;

    const titleAndKeywords = [data.title, ...(data.keywords ?? [])].join(' ');
    const description = data.description ?? '';
    if (!category.match.test(titleAndKeywords) ||
        BLOCKLIST_RE.test(`${titleAndKeywords} ${description.slice(0, 250)}`))
        return null;

    return {
        id: data.nasa_id,
        title: data.title ?? data.nasa_id,
        credit: data.secondary_creator || data.photographer || `NASA ${data.center}`,
        date: data.date_created?.slice(0, 10) ?? '',
        url: href,
        pageUrl: DETAILS_URL + encodeURIComponent(data.nasa_id),
        width,
        height,
    };
}

export class NasaImageSource {
    /**
     * @param {Soup.Session} session
     */
    constructor(session) {
        this._session = session;
        // query -> total number of hits, learned from the first search
        this._totalHits = new Map();
    }

    async _search(query, page, cancellable) {
        const params = {
            q: query,
            media_type: 'image',
            page_size: String(PAGE_SIZE),
            page: String(page),
        };
        const queryString = Object.entries(params)
            .map(([k, v]) => `${k}=${GLib.Uri.escape_string(v, null, false)}`)
            .join('&');
        const message = Soup.Message.new('GET', `${SEARCH_URL}?${queryString}`);
        const bytes = await this._session.send_and_read_async(
            message, GLib.PRIORITY_DEFAULT, cancellable);

        if (message.get_status() !== Soup.Status.OK)
            throw new Error(`NASA search failed with HTTP ${message.get_status()}`);

        const collection = JSON.parse(new TextDecoder().decode(bytes.get_data())).collection;
        this._totalHits.set(query, collection.metadata?.total_hits ?? 0);
        return collection;
    }

    /**
     * Searches a random page of a random query, and returns the usable
     * candidates on it.
     */
    async _randomCandidates(searches, cancellable) {
        const {query, category} = randomItem(searches);
        let collection;

        if (this._totalHits.has(query)) {
            const page = randomInt(1, pageCount(this._totalHits.get(query)));
            collection = await this._search(query, page, cancellable);
        } else {
            // First time we see this query: page 1 tells us how many pages exist.
            collection = await this._search(query, 1, cancellable);
            const page = randomInt(1, pageCount(this._totalHits.get(query)));
            if (page !== 1)
                collection = await this._search(query, page, cancellable);
        }

        return (collection.items ?? []).map(item => parseItem(item, category)).filter(Boolean);
    }

    /**
     * Picks a random image at least as large as `target`. If none is found
     * after a few searches, returns the largest suitable image seen.
     *
     * @param {object} options
     * @param {{query: string, category: object}[]} options.searches - search
     *   terms to choose from, each with the category its results must fit
     * @param {{width: number, height: number}} options.target - screen size
     * @param {Set<string>} options.excludeIds - recently used image IDs
     * @param {Gio.Cancellable} options.cancellable
     */
    async pickImage({searches, target, excludeIds, cancellable}) {
        if (searches.length === 0)
            throw new Error('No image categories are enabled');

        let largest = null;
        for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
            const candidates = (await this._randomCandidates(searches, cancellable))
                .filter(c => !excludeIds.has(c.id));

            const fullSize = candidates.filter(
                c => c.width >= target.width && c.height >= target.height);
            if (fullSize.length > 0)
                return randomItem(fullSize);

            for (const c of candidates) {
                if (!largest || c.width * c.height > largest.width * largest.height)
                    largest = c;
            }
        }

        if (largest)
            return largest;
        throw new Error('No suitable image found, will try again later');
    }
}
