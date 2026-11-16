/**
 * The app's line icons (16 Nov redesign): 24-unit grid, 1.75 stroke, round joins, drawn for Roomia (no icon package in the
 * project). <Icon name="pano" /> takes the current text colour.
 */
const PATHS = {
  pano: 'M3 8.5c2.6-1.3 5.6-2 9-2s6.4.7 9 2v7c-2.6-1.3-5.6-2-9-2s-6.4.7-9 2zM12 6.5v11',
  photo: 'M4 6h16v12H4zM4 15l4.5-4.5 4 4L15 12l5 5M15.5 9.5h.01',
  plan: 'M4 4h16v16H4zM4 11h7M11 4v10M15 11h5M15 11v9',
  plan3d: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5',
  video: 'M4 6h11v12H4zM15 10l5-3v10l-5-3',
  gallery: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z',
  share: 'M8.5 13.5l7-3.5M8.5 10.5l7 3.5M6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  download: 'M12 4v11M7 10.5l5 5 5-5M5 20h14',
  pin: 'M12 21s-6-5.2-6-10.5A6 6 0 0 1 18 10.5C18 15.8 12 21 12 21zM12 12.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  plus: 'M12 5v14M5 12h14',
  back: 'M15 5l-7 7 7 7',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  cube: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9',
  folder: 'M3 7h6l2 2h10v10H3z',
  sketchup: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM8 9.5l4 2.3 4-2.3M12 11.8V16',
  sun: 'M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  sunset: 'M7.5 15.5a4.5 4.5 0 0 1 9 0M2 15.5h20M5 19h14M12 4v4M4.9 8.4l1.4 1.4M19.1 8.4l-1.4 1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  camera: 'M4 8h3.5L9 6h6l1.5 2H20v11H4zM12 16.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20a7.5 7.5 0 0 1 15 0',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01',
  refresh: 'M20 11a8 8 0 0 0-14.6-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5L20 16M20 20v-4h-4',
  report: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5',
  cpu: 'M7 7h10v10H7zM10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01',
  warn: 'M12 4l9 16H3zM12 10v4M12 17h.01',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  fullscreen: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  turnLeft: 'M9 5L4 10l5 5M4 10h10a6 6 0 0 1 0 12h-2',
  turnRight: 'M15 5l5 5-5 5M20 10H10a6 6 0 0 0 0 12h2',
} as const

export type IconName = keyof typeof PATHS

export default function Icon({ name, size = 18, className, strokeWidth = 1.75 }: { name: IconName; size?: number; className?: string; strokeWidth?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
