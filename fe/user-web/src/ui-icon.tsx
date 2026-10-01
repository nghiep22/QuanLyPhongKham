import type { SVGProps } from 'react'

const paths = {
  cross: 'M9 3h6v6h6v6h-6v6H9v-6H3V9h6Z',
  home: 'm3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9',
  compass: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm4-16-2.5 7.5L6 16l2.5-7.5Z',
  news: 'M4 3h16v18H4ZM8 7h8M8 11h8M8 15h3M8 18h8',
  calendar: 'M4 5h16v16H4ZM7 2v6M17 2v6M4 10h16M8 14h2M14 14h2M8 17h2',
  records: 'M7 3h10v3h3v15H4V6h3ZM9 2h6v5H9M8 12h8M8 16h5',
  doctor: 'M5 3v4a4 4 0 0 0 8 0V3M3 3h4M11 3h4M9 11v5a5 5 0 0 0 10 0v-3M19 9a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z',
  service: 'M4 5h16v16H4ZM8 3v4M16 3v4M12 11v6M9 14h6',
  branch: 'M5 21V3h14v18M2 21h20M9 7h1M14 7h1M9 11h1M14 11h1M10 21v-6h4v6',
  heart: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM17 4a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.9',
  user: 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2',
  shield: 'm12 2 8 3v6c0 5-4 9-8 11-4-2-8-6-8-11V5ZM8 12l3 3 5-6',
  search: 'M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm6 14 5 5',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  upRight: 'M6 18 18 6M6 6h12v12',
  menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'm6 6 12 12M6 18 18 6',
  refresh: 'M20 7a9 9 0 1 0 1 8M20 3v5h-5',
  check: 'm5 12 4 4L19 6',
  logout: 'M9 3H4v18h5M14 8l5 4-5 4M8 12h11',
} as const

export type IconName = keyof typeof paths
export function Icon({ name, size = 20, ...props }: SVGProps<SVGSVGElement> & { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}><path d={paths[name]} /></svg>
}
