import Image from 'next/image'
import Link from 'next/link'

interface LogoProps {
  variant?: 'white' | 'color'
}

export function Logo({ variant = 'white' }: LogoProps) {
  const src =
    variant === 'color'
      ? '/lkc-logo-color.png'
      : '/lkc-logo-white.png'

  return (
    <Link
      href="/"
      className="flex flex-col items-center cursor-pointer select-none leading-none"
    >
      <Image
        src={src}
        alt="LKC Fintech"
        width={32}
        height={32}
        className="object-contain"
        priority
      />

      <div
        className={`mt-1 font-bold text-[13px] tracking-tight ${
          variant === 'color' ? 'text-[#0A1628]' : 'text-white'
        }`}
      >
        LKC Fintech
      </div>
    </Link>
  )
}