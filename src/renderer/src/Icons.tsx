interface IconProps {
  size?: number
}

function svg(size: number, children: React.ReactNode): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  )
}

export const Back = ({ size = 16 }: IconProps) => svg(size, <polyline points="15 18 9 12 15 6" />)
export const Forward = ({ size = 16 }: IconProps) => svg(size, <polyline points="9 18 15 12 9 6" />)
export const Reload = ({ size = 15 }: IconProps) =>
  svg(
    size,
    <>
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </>,
  )
export const Link = ({ size = 13 }: IconProps) =>
  svg(
    size,
    <>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </>,
  )
export const Sliders = ({ size = 14 }: IconProps) =>
  svg(
    size,
    <>
      <line x1="4" y1="21" x2="4" y2="14" />
      <line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" />
      <line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="17" y1="16" x2="23" y2="16" />
    </>,
  )
export const Plus = ({ size = 16 }: IconProps) =>
  svg(
    size,
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </>,
  )
export const Close = ({ size = 16 }: IconProps) =>
  svg(
    size,
    <>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </>,
  )
export const WinMin = ({ size = 14 }: IconProps) => svg(size, <line x1="5" y1="12" x2="19" y2="12" />)
export const WinMax = ({ size = 12 }: IconProps) => svg(size, <rect x="5" y="5" width="14" height="14" rx="2" />)
export const User = ({ size = 16 }: IconProps) =>
  svg(
    size,
    <>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </>,
  )
export const Sparkle = ({ size = 16 }: IconProps) =>
  svg(size, <path d="M12 3l1.9 5.6a2 2 0 0 0 1.3 1.3L20.8 12l-5.6 1.9a2 2 0 0 0-1.3 1.3L12 20.8l-1.9-5.6a2 2 0 0 0-1.3-1.3L3.2 12l5.6-1.9a2 2 0 0 0 1.3-1.3z" />)
