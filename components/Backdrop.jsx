/**
 * The rooftop the radio plays on.
 *
 * प्रीत is affection, and this is a couple's playlist — so the scene is two
 * people on a terrace ledge at dusk with the radio between them, string lights
 * overhead, city going quiet below.
 *
 * Silhouettes rather than an illustration with detail in it: shapes read
 * cleanly at any size, sit behind the type without competing with it, and cost
 * nothing to load because the whole thing is inline SVG.
 *
 * Anchored to the bottom edge with a minimum width, so on a narrow phone it
 * crops evenly at the sides instead of shrinking to a strip.
 */
export default function Backdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
      <svg
        viewBox="0 0 1440 520"
        preserveAspectRatio="xMidYMax meet"
        className="absolute bottom-0 left-1/2 w-full min-w-[940px] -translate-x-1/2"
      >
        <defs>
          <radialGradient id="warmSpill" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="oklch(0.8 0.15 62)" stopOpacity="0.34" />
            <stop offset="100%" stopColor="oklch(0.8 0.15 62)" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="bulbGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="oklch(0.9 0.13 82)" stopOpacity="0.7" />
            <stop offset="100%" stopColor="oklch(0.9 0.13 82)" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="skyline" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="oklch(0.19 0.032 34)" />
            <stop offset="100%" stopColor="oklch(0.125 0.02 30)" />
          </linearGradient>
        </defs>

        {/* --- the city, far off and settling down ------------------------ */}
        <g fill="url(#skyline)" opacity="0.5">
          <rect x="-20" y="272" width="140" height="180" />
          <rect x="110" y="232" width="104" height="220" />
          <rect x="206" y="292" width="88" height="160" />
          <rect x="286" y="252" width="120" height="200" />
          <rect x="1046" y="264" width="112" height="188" />
          <rect x="1150" y="222" width="96" height="230" />
          <rect x="1238" y="284" width="222" height="168" />
          {/* water tanks on the roofs */}
          <rect x="140" y="208" width="30" height="26" />
          <rect x="1174" y="198" width="26" height="24" />
          <rect x="320" y="230" width="20" height="22" />
        </g>

        {/* scattered lit windows, someone else still awake */}
        <g fill="oklch(0.82 0.14 70)" opacity="0.28">
          <rect x="130" y="256" width="9" height="12" />
          <rect x="160" y="290" width="9" height="12" />
          <rect x="1170" y="248" width="9" height="12" />
          <rect x="1206" y="286" width="9" height="12" />
          <rect x="316" y="286" width="9" height="12" />
          <rect x="1074" y="300" width="9" height="12" />
        </g>

        {/* --- a crescent moon, and a few stars --------------------------- */}
        <path
          d="M1214 74 a44 44 0 1 0 0 88 a33 33 0 1 1 0 -88 z"
          fill="oklch(0.92 0.06 86)"
          opacity="0.22"
        />
        <g fill="oklch(0.95 0.03 84)" opacity="0.4">
          <circle cx="1114" cy="60" r="2.4" />
          <circle cx="1298" cy="118" r="2" />
          <circle cx="1160" cy="182" r="1.8" />
          <circle cx="256" cy="96" r="2.2" />
          <circle cx="404" cy="62" r="1.8" />
        </g>

        {/* a pair of birds heading home together */}
        <g
          fill="none"
          stroke="oklch(0.09 0.02 28)"
          strokeOpacity="0.55"
          strokeWidth="3"
          strokeLinecap="round"
        >
          <path d="M980 118 q12-11 22 0 q10-11 22 0" />
          <path d="M1030 92 q9-8 17 0 q8-8 17 0" />
        </g>

        {/* --- string lights over the terrace ----------------------------- */}
        <g
          fill="none"
          stroke="oklch(0.1 0.02 28)"
          strokeOpacity="0.8"
          strokeWidth="2.5"
          strokeLinecap="round"
        >
          <path d="M-10 54 Q 700 176 1450 46" />
        </g>
        {/* bulbs hanging off it — glow, stem, filament */}
        <g>
          {[
            [140, 108],
            [286, 134],
            [432, 152],
            [578, 164],
            [724, 168],
            [870, 162],
            [1016, 148],
            [1162, 126],
            [1308, 96],
          ].map(([x, y]) => (
            <g key={x}>
              <line
                x1={x}
                y1={y}
                x2={x}
                y2={y + 14}
                stroke="oklch(0.1 0.02 28)"
                strokeOpacity="0.8"
                strokeWidth="2"
              />
              <circle cx={x} cy={y + 22} r="22" fill="url(#bulbGlow)" />
              <circle cx={x} cy={y + 21} r="5" fill="oklch(0.92 0.12 84)" opacity="0.85" />
            </g>
          ))}
        </g>

        {/* --- the two of them -------------------------------------------- */}
        {/* warmth pooling around where they're sitting */}
        <ellipse cx="716" cy="368" rx="300" ry="118" fill="url(#warmSpill)" />

        <g fill="oklch(0.09 0.02 28)">
          {/* left figure, sitting upright */}
          <circle cx="668" cy="292" r="19" />
          <path d="M642 374 q2-54 26-58 q24 4 26 58 z" />
          {/* right figure, head resting on the other's shoulder */}
          <circle cx="722" cy="300" r="18" />
          <path d="M700 374 q0-52 26-56 q26 4 28 56 z" />
          {/* an arm reaching across the shoulders */}
          <path
            d="M696 318 q26-14 46-2 q4 6-2 8 q-20-8-42 3 z"
            opacity="0.95"
          />
          {/* legs hanging over the ledge */}
          <rect x="652" y="374" width="13" height="52" rx="5" />
          <rect x="672" y="374" width="13" height="52" rx="5" />
          <rect x="712" y="374" width="13" height="52" rx="5" />
          <rect x="732" y="374" width="13" height="52" rx="5" />

          {/* the radio, sitting between them and the edge */}
          <rect x="792" y="336" width="76" height="38" rx="5" />
          <line
            x1="862"
            y1="338"
            x2="884"
            y2="308"
            stroke="oklch(0.09 0.02 28)"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </g>
        {/* speaker faces, catching the last of the light */}
        <g fill="oklch(0.8 0.14 70)" opacity="0.34">
          <circle cx="810" cy="355" r="9" />
          <circle cx="848" cy="355" r="9" />
        </g>

        {/* --- terrace plants --------------------------------------------- */}
        <g fill="oklch(0.09 0.02 28)">
          <path d="M540 374 v-26 h32 v26 z" />
          <path d="M556 348 q-24-18-11-38 q15 7 13 31 q7-24 26-26 q4 22-17 33 z" />
          <path d="M934 374 v-22 h26 v22 z" />
          <path d="M947 352 q-19-13-9-30 q13 6 11 26 z" />
        </g>

        {/* --- the ledge they're sitting on -------------------------------- */}
        <rect x="-20" y="374" width="1480" height="16" fill="oklch(0.105 0.022 28)" />
        <rect x="-20" y="374" width="1480" height="3" fill="oklch(0.34 0.06 44)" opacity="0.45" />
        <rect x="-20" y="390" width="1480" height="140" fill="oklch(0.08 0.016 28)" />
      </svg>
    </div>
  )
}
