const $ = id => document.getElementById(id);
const audio = $("audio");
const fileInput = $("fileInput");

let songs = [];
let currentId = null;
let view = "all";
let query = "";
let shuffle = false;
let repeat = false;
let newestFirst = true;
let nextId = 1;
let history = [];

const currentSong = () => songs.find(s => s.id === currentId);

/* ---------- IndexedDB (persistence) ---------- */
const STORE = "songs";
let dbPromise = null;

function openDB() {
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open("waveform", 1);
            req.onupgradeneeded = () =>
                req.result.createObjectStore(STORE, { keyPath: "id" });
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }
    return dbPromise;
}

async function dbPut(song) {
    try {
        const db = await openDB();
        const { id, name, artist, file, duration, favorite, addedAt } = song;
        db.transaction(STORE, "readwrite")
            .objectStore(STORE)
            .put({ id, name, artist, file, duration, favorite, addedAt });
    } catch (e) {
        console.warn("DB save failed", e);
    }
}

async function dbDelete(id) {
    try {
        const db = await openDB();
        db.transaction(STORE, "readwrite").objectStore(STORE).delete(id);
    } catch (e) {
        console.warn("DB delete failed", e);
    }
}

async function dbAll() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const req = db.transaction(STORE).objectStore(STORE).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/* ---------- Helpers ---------- */
function formatTime(seconds) {
    if (!Number.isFinite(seconds)) return "0:00";
    return Math.floor(seconds / 60) + ":" +
        String(Math.floor(seconds % 60)).padStart(2, "0");
}

function setFavorite(song, value) {
    song.favorite = value;
    dbPut(song);
    render();
}

function updateNowPlaying() {
    const song = currentSong();
    if (!song) return;
    $("currentTitle").textContent = song.name;
    $("currentArtist").textContent = song.artist || "Lokalny plik audio";
}

function chooseFiles() {
    fileInput.click();
}

$("importBtn").onclick = chooseFiles;
$("heroImport").onclick = chooseFiles;
$("emptyImport").onclick = chooseFiles;

fileInput.addEventListener("change", () => {
    const files = Array.from(fileInput.files);
    let added = 0;

    for (const file of files) {
        const audioFile =
            file.type.startsWith("audio/") ||
            /\.(mp3|wav|ogg|flac|m4a|aac|opus|aiff?)$/i.test(file.name);

        if (!audioFile) continue;

        const duplicate = songs.some(song =>
            song.file.name === file.name &&
            song.file.size === file.size &&
            song.file.lastModified === file.lastModified
        );

        if (duplicate) continue;

        const song = {
            id: nextId++,
            name: file.name.replace(/\.[^.]+$/, ""),
            artist: "",
            file,
            url: URL.createObjectURL(file),
            duration: 0,
            favorite: false,
            addedAt: Date.now() + added
        };

        songs.push(song);
        dbPut(song);
        added++;

        const probe = new Audio();
        probe.preload = "metadata";
        probe.src = song.url;

        probe.addEventListener("loadedmetadata", () => {
            song.duration = probe.duration;
            probe.removeAttribute("src");
            dbPut(song);
            render();
        }, { once: true });

        probe.addEventListener("error", () => {
            probe.removeAttribute("src");
        }, { once: true });

        // ID3 tags (title / artist)
        if (window.jsmediatags) {
            window.jsmediatags.read(file, {
                onSuccess: ({ tags }) => {
                    if (!songs.includes(song)) return;
                    if (tags.title) song.name = tags.title;
                    if (tags.artist) song.artist = tags.artist;
                    dbPut(song);
                    render();
                    if (song.id === currentId) updateNowPlaying();
                },
                onError: () => { }
            });
        }
    }

    fileInput.value = "";
    render();

    if (files.length && !added) {
        alert("Nie dodano nowych plików audio. Sprawdź format lub duplikaty.");
    }
});

function visibleSongs() {
    let result = [...songs];

    if (view === "favorites") {
        result = result.filter(song => song.favorite);
    }

    if (view === "recent") {
        result.sort((a, b) => b.addedAt - a.addedAt);
    } else if (newestFirst) {
        result.sort((a, b) => b.addedAt - a.addedAt);
    } else {
        result.sort((a, b) => a.addedAt - b.addedAt);
    }

    if (query.trim()) {
        const q = query.trim().toLowerCase();
        result = result.filter(song =>
            song.name.toLowerCase().includes(q) ||
            (song.artist || "").toLowerCase().includes(q)
        );
    }

    return result;
}

function render() {
    const list = $("songList");
    const items = visibleSongs();

    list.replaceChildren();
    $("empty").hidden = items.length > 0;

    const headings = {
        all: ["Twoja biblioteka", "Wszystkie utwory"],
        recent: ["Ostatnio dodane", "Ostatnio dodane"],
        favorites: ["Ulubione", "Twoje ulubione utwory"]
    };

    $("pageHeading").textContent = headings[view][0];
    $("listHeading").textContent = headings[view][1];
    $("listSubtitle").textContent =
        `${items.length} ${items.length === 1 ? "utwór" : "utworów"}`;

    $("sortBtn").textContent = newestFirst ? "Najnowsze ↓" : "Najstarsze ↑";

    items.forEach((song, position) => {
        const row = document.createElement("div");
        row.className = "song" +
            (song.id === currentId ? " playing" : "");

        const number = document.createElement("div");
        number.className = "song-number";
        number.textContent = song.id === currentId && !audio.paused
            ? "♫" : position + 1;

        const info = document.createElement("div");
        info.className = "song-info";

        const cover = document.createElement("div");
        cover.className = "cover";
        cover.textContent = "♫";

        const details = document.createElement("div");
        details.style.minWidth = "0";

        const title = document.createElement("div");
        title.className = "song-title";
        title.textContent = song.name;

        const artist = document.createElement("div");
        artist.className = "song-artist";
        artist.textContent = song.artist || song.file.name;

        details.append(title, artist);
        info.append(cover, details);

        const duration = document.createElement("div");
        duration.className = "song-duration";
        duration.textContent = formatTime(song.duration);

        const actions = document.createElement("div");
        actions.className = "song-actions";

        const heart = document.createElement("button");
        heart.className = "song-action" + (song.favorite ? " favorited" : "");
        heart.textContent = song.favorite ? "♥" : "♡";
        heart.title = song.favorite ? "Usuń z ulubionych" : "Dodaj do ulubionych";
        heart.onclick = event => {
            event.stopPropagation();
            setFavorite(song, !song.favorite);
        };

        const del = document.createElement("button");
        del.className = "song-action";
        del.textContent = "×";
        del.title = "Usuń z biblioteki";
        del.onclick = event => {
            event.stopPropagation();
            if (confirm(`Usunąć "${song.name}"?`)) removeSong(song.id);
        };

        actions.append(heart, del);

        row.append(number, info, duration, actions);
        row.onclick = () => playSong(song.id);
        list.append(row);
    });

    updateFavoriteButton();
}

function playSong(id) {
    const song = songs.find(s => s.id === id);
    if (!song) return;

    if (currentId !== null && currentId !== id) {
        history.push(currentId);
        if (history.length > 100) history.shift();
    }

    currentId = id;
    audio.src = song.url;
    audio.load();

    updateNowPlaying();
    $("playBtn").textContent = "Ⅱ";

    render();

    audio.play().catch(() => {
        $("playBtn").textContent = "▶";
    });
}

function togglePlay() {
    if (!currentSong()) {
        const first = visibleSongs()[0] || songs[0];
        if (first) playSong(first.id);
        return;
    }

    if (audio.paused) {
        audio.play().catch(() => { });
    } else {
        audio.pause();
    }
}

function playNext(direction = 1) {
    const list = visibleSongs();
    if (!list.length) return;

    // shuffle + previous: go back through what was actually played
    if (shuffle && direction === -1) {
        while (history.length) {
            const prev = history.pop();
            if (songs.some(s => s.id === prev)) {
                const keep = history.slice();
                playSong(prev);
                history = keep; // don't re-push the song we just left
                return;
            }
        }
    }

    let index = list.findIndex(song => song.id === currentId);

    if (shuffle && list.length > 1 && direction === 1) {
        const choices = list.filter(song => song.id !== currentId);
        playSong(choices[Math.floor(Math.random() * choices.length)].id);
        return;
    }

    if (index === -1) index = direction === 1 ? -1 : 0;
    index = (index + direction + list.length) % list.length;
    playSong(list[index].id);
}

function removeSong(id) {
    const index = songs.findIndex(song => song.id === id);
    if (index === -1) return;

    const song = songs[index];

    if (song.id === currentId) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
        currentId = null;

        $("currentTitle").textContent = "Nic nie odtwarzasz";
        $("currentArtist").textContent = "Wybierz utwór z biblioteki";
        $("elapsed").textContent = "0:00";
        $("total").textContent = "0:00";
        $("progress").value = 0;
        $("playBtn").textContent = "▶";
    }

    URL.revokeObjectURL(song.url);
    songs.splice(index, 1);
    history = history.filter(h => h !== id);
    dbDelete(id);
    render();
}

function toggleFavorite() {
    const song = currentSong();
    if (!song) return;

    setFavorite(song, !song.favorite);
}

function updateFavoriteButton() {
    const song = currentSong();
    const button = $("favoriteCurrent");

    button.textContent = song && song.favorite ? "♥" : "♡";
    button.classList.toggle("favorited", !!song && song.favorite);
}

$("playBtn").onclick = togglePlay;
$("prevBtn").onclick = () => {
    if (audio.currentTime > 3) audio.currentTime = 0;
    else playNext(-1);
};
$("nextBtn").onclick = () => playNext(1);
$("favoriteCurrent").onclick = toggleFavorite;

$("shuffleBtn").onclick = () => {
    shuffle = !shuffle;
    $("shuffleBtn").classList.toggle("selected", shuffle);
};

$("repeatBtn").onclick = () => {
    repeat = !repeat;
    audio.loop = repeat;
    $("repeatBtn").classList.toggle("selected", repeat);
};

$("search").addEventListener("input", event => {
    query = event.target.value;
    render();
});

document.querySelectorAll(".nav[data-view]").forEach(button => {
    button.onclick = () => {
        view = button.dataset.view;

        document.querySelectorAll(".nav[data-view]").forEach(nav => {
            nav.classList.toggle("active", nav === button);
        });

        render();
    };
});

$("sortBtn").onclick = () => {
    newestFirst = !newestFirst;
    render();
};

$("volume").addEventListener("input", event => {
    audio.volume = Number(event.target.value);
});
audio.volume = 0.8;

/* Light update on play/pause so the whole list isn't rebuilt */
function updatePlayingState() {
    $("playBtn").textContent = audio.paused ? "▶" : "Ⅱ";

    const rows = $("songList").children;
    visibleSongs().forEach((song, i) => {
        if (song.id === currentId && rows[i]) {
            rows[i].querySelector(".song-number").textContent =
                audio.paused ? i + 1 : "♫";
        }
    });
}

audio.addEventListener("play", updatePlayingState);
audio.addEventListener("pause", updatePlayingState);

audio.addEventListener("loadedmetadata", () => {
    $("total").textContent = formatTime(audio.duration);
});

audio.addEventListener("timeupdate", () => {
    $("elapsed").textContent = formatTime(audio.currentTime);
    $("total").textContent = formatTime(audio.duration);

    if (Number.isFinite(audio.duration) && audio.duration > 0) {
        $("progress").value = audio.currentTime / audio.duration * 1000;
    }
});

$("progress").addEventListener("input", event => {
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
        audio.currentTime = Number(event.target.value) / 1000 * audio.duration;
    }
});

audio.addEventListener("ended", () => {
    if (!repeat) playNext(1);
});

/* Keyboard shortcuts */
document.addEventListener("keydown", e => {
    const tag = e.target.tagName;
    const isRange = tag === "INPUT" && e.target.type === "range";

    if (tag === "BUTTON") return;
    if (tag === "INPUT" && !isRange) return;

    if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
    } else if (!isRange && e.code === "ArrowRight") {
        audio.currentTime += 5;
    } else if (!isRange && e.code === "ArrowLeft") {
        audio.currentTime -= 5;
    }
});

window.addEventListener("beforeunload", () => {
    songs.forEach(song => URL.revokeObjectURL(song.url));
});

/* Load saved library on startup */
(async () => {
    try {
        const saved = await dbAll();
        songs = saved.map(s => ({
            artist: "",
            ...s,
            url: URL.createObjectURL(s.file)
        }));
        nextId = Math.max(0, ...songs.map(s => s.id)) + 1;
    } catch (e) {
        console.warn("DB load failed", e);
    }

    if (navigator.storage && navigator.storage.persist) {
        navigator.storage.persist().catch(() => { });
    }

    render();
})();

render();
