const fs = require('fs');
const crypto = require('crypto');

// Load environment variables injected by GitHub Actions
const { APPLE_DEV_TOKEN, APPLE_USER_TOKEN, LASTFM_API_KEY, LASTFM_SHARED_SECRET, LASTFM_SK } = process.env;

const CACHE_FILE = 'cache.json';

async function run() {
    try {
        // 1. Load the Cache
        let cache = [];
        if (fs.existsSync(CACHE_FILE)) {
            cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        }

      // 2. Fetch from Apple Music
        const appleUrl = 'https://api.music.apple.com/v1/me/recent/played/tracks?limit=30';
        const appleRes = await fetch(appleUrl, {
            headers: {
                'Authorization': `Bearer ${APPLE_DEV_TOKEN}`,
                'Music-User-Token': APPLE_USER_TOKEN,
                'Origin': 'https://music.apple.com'
            }
        });
        
        if (!appleRes.ok) throw new Error(`Apple API Error: ${appleRes.status}`);
        const data = await appleRes.json();
        const tracks = data.data || [];
        
        if (tracks.length === 0) {
            console.log("No tracks found in Apple Music.");
            return;
        }

        // 3. Calculate Timestamps
        let trackTimes = [];
        let timeCursor = Math.floor(Date.now() / 1000);
        for (let i = 0; i < tracks.length; i++) {
            const durationSec = Math.floor((tracks[i].attributes?.durationInMillis || 180000) / 1000);
            timeCursor -= durationSec; 
            trackTimes[i] = timeCursor;
        }

        // 4. Find New Tracks
        let newTracks = [];
        let newCacheIds = [];
        
        for (let i = 0; i < tracks.length; i++) {
            const track = tracks[i];
            // If the ID isn't in our cache file, it's a new play
            if (!cache.includes(track.id)) {
                newTracks.push({
                    id: track.id,
                    artist: track.attributes.artistName,
                    track: track.attributes.name,
                    timestamp: trackTimes[i]
                });
                newCacheIds.push(track.id);
            }
        }

        if (newTracks.length === 0) {
            console.log("No new tracks to scrobble.");
            return;
        }

        // 5. Build Last.fm Payload
        let params = {
            api_key: LASTFM_API_KEY,
            method: 'track.scrobble',
            sk: LASTFM_SK
        };

        newTracks.forEach((t, index) => {
            params[`artist[${index}]`] = t.artist;
            params[`track[${index}]`] = t.track;
            params[`timestamp[${index}]`] = t.timestamp;
        });

        // 6. Sign and Send
        params.api_sig = signCall(params, LASTFM_SHARED_SECRET);
        params.format = 'json';

        const formData = new URLSearchParams();
        for (const k in params) formData.append(k, params[k]);

        const lfmRes = await fetch('https://ws.audioscrobbler.com/2.0/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formData.toString()
        });

        if (lfmRes.ok) {
            console.log(`Success! Scrobbled ${newTracks.length} tracks.`);
            // Update cache file: Add new IDs, keep only the latest 100 to prevent bloat
            const updatedCache = [...newCacheIds, ...cache].slice(0, 100);
            fs.writeFileSync(CACHE_FILE, JSON.stringify(updatedCache, null, 2));
        } else {
            console.error("Last.fm Error:", await lfmRes.text());
        }

    } catch (error) {
        console.error("System Error:", error);
    }
}

function signCall(params, secret) {
    const keys = Object.keys(params).sort();
    let sigStr = '';
    for (const k of keys) sigStr += k + params[k];
    sigStr += secret;
    return crypto.createHash('md5').update(sigStr, 'utf8').digest('hex');
}

run();
