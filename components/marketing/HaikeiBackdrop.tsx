/** Haikei-inspired layered SVG atmosphere for marketing surfaces. */
export default function HaikeiBackdrop({
  variant = 'hero',
}: {
  variant?: 'hero' | 'band' | 'footer'
}) {
  if (variant === 'band') {
    return (
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox="0 0 1440 320"
        preserveAspectRatio="none"
        aria-hidden
      >
        <path
          fill="var(--rm-primary)"
          fillOpacity="0.08"
          d="M0,160L48,170.7C96,181,192,203,288,197.3C384,192,480,160,576,154.7C672,149,768,171,864,186.7C960,203,1056,213,1152,197.3C1248,181,1344,139,1392,117.3L1440,96L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z"
          className="rm-wave-drift"
        />
        <path
          fill="var(--rm-accent)"
          fillOpacity="0.12"
          d="M0,224L60,208C120,192,240,160,360,165.3C480,171,600,213,720,218.7C840,224,960,192,1080,170.7C1200,149,1320,139,1380,133.3L1440,128L1440,320L1380,320C1320,320,1200,320,1080,320C960,320,840,320,720,320C600,320,480,320,360,320C240,320,120,320,60,320L0,320Z"
          className="rm-wave-drift-slow"
        />
      </svg>
    )
  }

  if (variant === 'footer') {
    return (
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="absolute -bottom-24 left-1/2 h-64 w-[120%] -translate-x-1/2 rounded-[100%] bg-[var(--rm-primary)]/15 blur-3xl" />
      </div>
    )
  }

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_70%_20%,rgba(184,137,61,0.22),transparent_55%),radial-gradient(ellipse_70%_50%_at_15%_80%,rgba(31,77,61,0.18),transparent_50%),linear-gradient(165deg,#e8efe9_0%,#f4f7f4_45%,#dce8e1_100%)]" />
      <svg
        className="absolute bottom-0 left-0 h-[55%] w-full opacity-90"
        viewBox="0 0 1440 520"
        preserveAspectRatio="none"
      >
        <path
          fill="#1f4d3d"
          fillOpacity="0.14"
          className="rm-wave-drift"
          d="M0,320L80,298.7C160,277,320,235,480,240C640,245,800,299,960,309.3C1120,320,1280,288,1360,272L1440,256L1440,520L1360,520C1280,520,1120,520,960,520C800,520,640,520,480,520C320,520,160,520,80,520L0,520Z"
        />
        <path
          fill="#b8893d"
          fillOpacity="0.16"
          className="rm-wave-drift-slow"
          d="M0,380L100,364C200,348,400,316,600,320C800,324,1000,364,1200,372C1400,380,1440,356,1440,356L1440,520L0,520Z"
        />
        <path
          fill="#14201c"
          fillOpacity="0.08"
          d="M0,440L120,428C240,416,480,392,720,400C960,408,1200,448,1320,468L1440,488L1440,520L0,520Z"
        />
      </svg>
      <div className="rm-grain absolute inset-0 opacity-[0.35]" />
    </div>
  )
}
