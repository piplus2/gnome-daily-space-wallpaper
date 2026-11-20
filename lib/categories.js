// SPDX-License-Identifier: MIT
//
// Image categories and the NASA Image Library search queries behind them.
// Shared by the extension and the preferences window, so keep it free of
// Shell-only imports.
//
// Search results are noisy (a query for "Hubble image" also finds photos
// taken from the ISS), so a result is only kept if it was published by one
// of the category's `centers` (NASA centres) and its title or keywords match
// the category's `match` pattern.

export const CATEGORIES = [
    {
        id: 'deep-space',
        title: 'Deep space',
        subtitle: 'Nebulae, galaxies, star clusters and supernova remnants',
        centers: ['JPL', 'GSFC', 'MSFC', 'ARC'],
        match: /nebula|galax|cluster|supernova|star[- ]forming|stellar|stars\b|cosmic|universe/i,
        queries: [
            'nebula',
            'galaxy',
            'star cluster',
            'supernova remnant',
            'star-forming region',
            'Hubble image',
            'Webb image',
            'Spitzer infrared image',
        ],
    },
    {
        id: 'solar-system',
        title: 'Solar System',
        subtitle: 'Planets, moons and the surface of Mars',
        centers: ['JPL', 'GSFC', 'ARC'],
        match: /jupiter|jovian|saturn|mars|martian|pluto|moon|lunar|planet|crater|europa|titan|enceladus|\bio\b|rings?\b/i,
        queries: [
            'Jupiter Juno',
            'Saturn Cassini',
            'Mars landscape',
            'Pluto',
            'Moon surface',
        ],
    },
    {
        id: 'earth',
        title: 'Earth from orbit',
        subtitle: 'Photos from the International Space Station, auroras and city lights',
        centers: ['JSC', 'GSFC'],
        match: /earth|aurora|airglow|city lights|horizon|limb|orbit|space station|\biss\d|expedition/i,
        queries: [
            'aurora',
            'earth observation ISS',
            'night lights earth',
            'sunrise orbit',
        ],
    },
    {
        id: 'milky-way',
        title: 'Milky Way',
        subtitle: 'Our galaxy and wide star fields',
        centers: ['JPL', 'GSFC', 'JSC', 'MSFC', 'ARC'],
        match: /milky way|galactic|star ?field|stars\b/i,
        queries: [
            'milky way',
            'starfield',
        ],
    },
];
