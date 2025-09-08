import type { ButtonHTMLAttributes, PropsWithChildren } from 'react'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary'
}

export default function Button({ children, className = '', variant = 'primary', ...props }: PropsWithChildren<Props>) {
  const base = 'inline-flex items-center justify-center rounded-lg px-6 py-3 font-medium transition-shadow focus:outline-none focus:ring-2 focus:ring-tt-accent shadow-soft'
  const styles = variant === 'primary'
    ? 'bg-tt-accent text-white hover:bg-tt-accent-light'
    : 'bg-secondary text-tt-charcoal hover:bg-muted'
  return (
    <button className={`${base} ${styles} ${className}`} {...props}>
      {children}
    </button>
  )
}
