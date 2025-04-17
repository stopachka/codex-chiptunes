"use client";

import React, { useState, useRef, Suspense } from "react";
import { init, id, i, InstaQLEntity, User } from "@instantdb/react";
import { useSearchParams } from "next/navigation";

// Helper: convert note name (e.g. C4, A#3) to frequency in Hz
function noteToFrequency(note: string): number {
  const m = note.match(/^([A-G])(#|b)?(\d+)$/);
  if (!m) throw new Error(`Invalid note: ${note}`);
  const [, pitch, accidental, oct] = m;
  const semitones: Record<string, number> = {
    C: 0,
    D: 2,
    E: 4,
    F: 5,
    G: 7,
    A: 9,
    B: 11,
  };
  let sem = semitones[pitch];
  if (accidental === "#") sem++;
  if (accidental === "b") sem--;
  const octave = parseInt(oct, 10);
  const midi = (octave + 1) * 12 + sem;
  const diff = midi - 69; // semitones from A4
  return 440 * Math.pow(2, diff / 12);
}

// Play song data: space-separated NOTE DURATION (in seconds) pairs
function playSong(data: string) {
  try {
    const parts = data.trim().split(/\s+/);
    if (parts.length % 2 !== 0) {
      alert('Data must be in "NOTE DURATION" pairs, e.g. C4 0.5 D4 0.5');
      return;
    }
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioCtx();
    const start = ctx.currentTime;
    let t = start;
    for (let i = 0; i < parts.length; i += 2) {
      const note = parts[i];
      const dur = parseFloat(parts[i + 1]);
      const freq = noteToFrequency(note);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = "square";
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.1, t);
      osc.start(t);
      osc.stop(t + dur);
      t += dur;
    }
  } catch (e) {
    alert("Error playing song: " + e);
  }
}

// Instant App ID - replace with your own Instant App ID
const APP_ID = "3c5161c1-7e56-42b4-a5f7-313ca32c28ac";

// Define the schema: songs with title, data, timestamp, and ownerId
const schema = i.schema({
  entities: {
    songs: i.entity({
      title: i.string(),
      data: i.string(),
      createdAt: i.number(),
      ownerId: i.string(),
    }),
  },
});

// Type for Song entity
type Song = InstaQLEntity<typeof schema, "songs">;

// Initialize Instant DB
const db = init({ appId: APP_ID, schema });

// Human Note: I wrapped `App`, because Next complained about
// how useSearchParams was used in a server component
// This only showed up in a deploy, so codex had no chance to fix it
function AppContainer() {
  return (
    <Suspense fallback={<div />}>
      <App />
    </Suspense>
  );
}

function App() {
  // Check for share link
  const searchParams = useSearchParams();
  const shareId = searchParams.get("songId");

  if (shareId) {
    return <ShareView songId={shareId} />;
  }

  // Handle auth state
  const { isLoading: authLoading, user, error: authError } = db.useAuth();
  if (authLoading) return null;
  if (authError)
    return <div className="text-red-500 p-4">Error: {authError.message}</div>;
  if (!user) return <Login />;

  return <Dashboard user={user} />;
}

// View-only share view for a public song link
function ShareView({ songId }: { songId: string }) {
  const { isLoading, error, data } = db.useQuery({
    songs: { $: { where: { id: songId } } },
  });
  if (isLoading) return null;
  if (error)
    return <div className="text-red-500 p-4">Error: {error.message}</div>;
  const song = data.songs[0];
  if (!song) return <div className="p-4">Song not found.</div>;
  return (
    <div className="p-4 max-w-md mx-auto space-y-2">
      <h1 className="text-2xl font-bold mb-2">{song.title}</h1>
      <pre className="whitespace-pre-wrap bg-gray-100 p-2 rounded">
        {song.data}
      </pre>
      <button
        onClick={() => playSong(song.data)}
        className="px-3 py-1 bg-blue-600 text-white rounded"
      >
        Play
      </button>
    </div>
  );
}

// Main dashboard showing user's songs and composer
function Dashboard({ user }: { user: User }) {
  const { isLoading, error, data } = db.useQuery({
    songs: { $: { where: { ownerId: user.id } } },
  });
  if (isLoading) return null;
  if (error)
    return <div className="text-red-500 p-4">Error: {error.message}</div>;
  return <SongManager songs={data.songs} user={user} />;
}

// Component to list, create, delete, and share songs; manage selection
function SongManager({ songs, user }: { songs: Song[]; user: User }) {
  const [selectedSongId, setSelectedSongId] = useState<string | null>(null);
  const selectedSong = songs.find((s) => s.id === selectedSongId) || null;

  function createSong() {
    const newId = id();
    db.transact(
      db.tx.songs[newId].update({
        title: "Untitled",
        data: "",
        createdAt: Date.now(),
        ownerId: user.id,
      })
    );
    setSelectedSongId(newId);
  }

  function deleteSong(song: Song) {
    db.transact(db.tx.songs[song.id].delete());
    if (song.id === selectedSongId) setSelectedSongId(null);
  }

  function shareSong(song: Song) {
    const url = `${window.location.origin}${window.location.pathname}?songId=${song.id}`;
    navigator.clipboard.writeText(url);
    alert("Shareable link copied to clipboard");
  }

  return (
    <div className="flex space-x-4 p-4">
      <div className="w-1/3">
        <button
          onClick={createSong}
          className="mb-2 px-3 py-1 bg-blue-600 text-white rounded"
        >
          New Song
        </button>
        <ul>
          {songs.map((song) => (
            <li
              key={song.id}
              className={`p-2 border ${
                song.id === selectedSongId ? "bg-blue-100" : ""
              }`}
            >
              <div className="flex justify-between items-center">
                <span
                  className="cursor-pointer"
                  onClick={() => setSelectedSongId(song.id)}
                >
                  {song.title}
                </span>
                <div className="space-x-1">
                  <button
                    onClick={() => shareSong(song)}
                    className="text-sm text-green-600"
                  >
                    Share
                  </button>
                  <button
                    onClick={() => deleteSong(song)}
                    className="text-sm text-red-600"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <div className="w-2/3">
        {selectedSong ? (
          <Composer song={selectedSong} />
        ) : (
          <div>Select or create a song to compose</div>
        )}
      </div>
    </div>
  );
}

// Composer UI for editing title and data of a song
function Composer({ song }: { song: Song }) {
  const [title, setTitle] = useState(song.title);
  const [data, setData] = useState(song.data);

  function save() {
    db.transact(db.tx.songs[song.id].update({ title, data }));
    alert("Saved");
  }

  return (
    <div>
      <div className="mb-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full border px-2 py-1"
        />
      </div>
      <div className="mb-2">
        <textarea
          value={data}
          onChange={(e) => setData(e.target.value)}
          className="w-full h-40 border px-2 py-1 font-mono"
        />
      </div>
      <div className="space-x-2">
        <button
          onClick={save}
          className="px-3 py-1 bg-blue-600 text-white rounded"
        >
          Save
        </button>
        <button
          onClick={() => playSong(data)}
          className="px-3 py-1 bg-green-600 text-white rounded"
        >
          Play
        </button>
      </div>
    </div>
  );
}

// Login flow using magic code auth
function Login() {
  const [sentEmail, setSentEmail] = useState("");
  return (
    <div className="flex justify-center items-center min-h-screen">
      <div className="max-w-sm p-4">
        {!sentEmail ? (
          <EmailStep onSendEmail={setSentEmail} />
        ) : (
          <CodeStep sentEmail={sentEmail} />
        )}
      </div>
    </div>
  );
}

function EmailStep({ onSendEmail }: { onSendEmail: (email: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const email = inputRef.current?.value || "";
    onSendEmail(email);
    db.auth.sendMagicCode({ email }).catch((err) => {
      alert("Error: " + err.body?.message);
      onSendEmail("");
    });
  };
  return (
    <form onSubmit={handleSubmit} className="flex flex-col space-y-4">
      <h2 className="text-xl font-bold">Let's log you in</h2>
      <p className="text-gray-700">
        Enter your email, and we’ll send you a verification code. We’ll create
        an account if you don’t already have one.
      </p>
      <input
        ref={inputRef}
        type="email"
        className="border border-gray-300 px-3 py-1 w-full"
        placeholder="Enter your email"
        required
        autoFocus
      />
      <button
        type="submit"
        className="px-3 py-1 bg-blue-600 text-white font-bold hover:bg-blue-700 w-full"
      >
        Send Code
      </button>
    </form>
  );
}

function CodeStep({ sentEmail }: { sentEmail: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const code = inputRef.current?.value || "";
    db.auth.signInWithMagicCode({ email: sentEmail, code }).catch((err) => {
      inputRef.current!.value = "";
      alert("Error: " + err.body?.message);
    });
  };
  return (
    <form onSubmit={handleSubmit} className="flex flex-col space-y-4">
      <h2 className="text-xl font-bold">Enter your code</h2>
      <p className="text-gray-700">
        We sent an email to <strong>{sentEmail}</strong>. Check your inbox and
        paste the code.
      </p>
      <input
        ref={inputRef}
        type="text"
        className="border border-gray-300 px-3 py-1 w-full"
        placeholder="123456..."
        required
        autoFocus
      />
      <button
        type="submit"
        className="px-3 py-1 bg-blue-600 text-white font-bold hover:bg-blue-700 w-full"
      >
        Verify Code
      </button>
    </form>
  );
}

export default AppContainer;
