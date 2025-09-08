import type { InputHTMLAttributes } from 'react'

export default function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className = '', ...rest } = props
  const styles = 'w-full rounded-lg border border-input px-4 py-3 bg-white text-tt-charcoal placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-tt-accent'
  return <input className={`${styles} ${className}`} {...rest} />
}
