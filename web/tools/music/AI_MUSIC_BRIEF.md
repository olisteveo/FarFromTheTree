# Far From the Tree: soundtrack brief (for AI music generation)

The game: the last leaf in Manhattan, late November, riding the wind from Battery Park to Central
Park to plant its seed. Melancholy, small and brave; cold light, bare trees, a city that doesn't
notice you. Think Ghibli / Journey / Gris: piano and strings, intimate, cinematic, never cheesy.

The game crossfades between layers as you change layer (street, rooftops, subway) in time with each
other. So **every track is in D minor at 72 BPM** (the subway at 144, which is double time), and
**instrumental**: no vocals or choir words.

## Settings (Suno)

- **Instrumental:** on.
- **Model:** the newest one.
- **Length:** 2–3 minutes each.
- **Generate 2–4 takes** of each prompt and keep the best. Download **WAV** if your plan has it
  (MP3 is fine otherwise), and **stems** too if available (piano / strings / percussion separately).
- **Don't let it fade out or end.** I'll cut the loop points, so a track that just keeps going is
  ideal. If Suno insists on an ending, that's fine; I'll loop before it.

## The tracks

### 1. title: "The Last Leaf" (the title screen and the start)
**Style:**
`melancholic cinematic piano, solo felt piano with soft cello, warm string ensemble swells, D minor, 72 bpm, intimate, emotional, Ghibli inspired, autumn, wistful, hopeful`

**Lyrics / structure box:**
```
[Instrumental]
[Intro: solo felt piano, sparse, gentle]
[Theme: piano melody, cello joins softly]
[Build: string ensemble swells, warm and aching]
[Theme reprise: piano and cello together]
[Soft piano, lingering]
```

### 2. street: "Down Among the Cabs" (the main gameplay layer, the one you hear most)
**Style:**
`melancholic cinematic piano and strings, steady flowing piano ostinato, cello melody, pizzicato pulse, soft harp, D minor, 72 bpm, gentle forward motion, bittersweet, film score, loopable`

**Lyrics / structure box:**
```
[Instrumental]
[Piano ostinato with pizzicato pulse]
[Cello melody over the piano]
[Violins take the melody, harp arpeggios]
[Piano and strings together, warm]
[Piano ostinato continues]
```

### 3. roof: "Over the Rooftops" (high over the city: open air)
**Style:**
`airy cinematic piano, high violins, shimmering harp and celesta, floating, spacious, D minor, 72 bpm, wistful and hopeful, gentle wind, film score, loopable, no drums`

**Lyrics / structure box:**
```
[Instrumental]
[Sparse high piano and harp]
[High violin melody, floating]
[Celesta sparkles, strings bloom]
[Piano and violins together, open]
```

### 4. subway: "Underground" (the fastest, deadliest layer: urgent)
**Style:**
`dark driving cinematic strings, relentless spiccato cellos and basses, low piano octaves, pounding taiko and timpani, tense brass swells, D minor, 144 bpm, urgent chase, epic, film score, loopable`

**Lyrics / structure box:**
```
[Instrumental]
[Driving spiccato low strings, ticking]
[Low piano octaves join, timpani hits]
[Brass swells, tension rising]
[Full orchestra, relentless]
[Driving strings continue]
```

### 5. (optional) planted: "Next Spring" (planting the seed in Central Park: the end)
**Style:**
`emotional cinematic piano and strings, resolving from D minor to D major, warm, tender, triumphant but quiet, solo piano ending, 72 bpm, film score`

**Lyrics / structure box:**
```
[Instrumental]
[Piano theme, tender]
[Strings rise, the key turns to major]
[Warm full strings, resolution]
[Solo piano, last notes]
```

## Rights
Use a **paid** plan when generating anything that ships: Suno's free tier doesn't give commercial
rights, and the paid plans do, for songs made while subscribed. Udio and ElevenLabs Music are similar.
Check the current terms.

## Hand-off
Put the files in `web/tools/music/incoming/` named `title`, `street`, `roof`, `subway` (and
`planted`): `.wav` or `.mp3`, and stems in a folder per track if you have them. Then tell me, and I'll:
- find seamless loop points on bar lines,
- match their loudness,
- line the layers up so they crossfade in time,
- make the mono, low-rate copies for phones,
- wire them into the game in place of the current score.

If a track misses the key or tempo, I'll crossfade it instead of syncing it.
